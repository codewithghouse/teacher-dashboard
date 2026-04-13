import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, getDocs, doc, updateDoc, where, Timestamp } from "firebase/firestore";
import { CheckCircle2, Loader2, Phone, X, User, MessageCircle, BookOpen } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

interface Alert {
  id: string;
  studentId: string;
  name: string;
  initials: string;
  avatarColor: string;
  severity: "Critical" | "High Priority" | "Medium Priority";
  type: "Attendance" | "Grades" | "Submissions" | "Behavior";
  issue: string;
  details: string[];
  cls: string;
  isSystem?: boolean;
}

const AVATAR_COLORS = ["bg-rose-500", "bg-amber-500", "bg-emerald-600", "bg-blue-600", "bg-violet-600", "bg-indigo-600"];
const getAvatarColor = (name: string) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

const severityBorder = {
  Critical:          "border-l-rose-500",
  "High Priority":   "border-l-amber-400",
  "Medium Priority": "border-l-[#1e3272]",
};

const severityBadge = {
  Critical:          "bg-rose-500 text-white",
  "High Priority":   "bg-amber-400 text-white",
  "Medium Priority": "bg-[#1e3272] text-white",
};

const RisksAlerts = () => {
  const { teacherData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [activeTab, setActiveTab] = useState("All Alerts");
  const [resolving, setResolving] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [fetchingContact, setFetchingContact] = useState(false);

  useEffect(() => {
    if (!teacherData?.id) return;
    setLoading(true);

    const schoolId = teacherData.schoolId as string | undefined;
    const branchId = teacherData.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
    if (branchId) SC.push(where("branchId", "==", branchId));

    // 21-day cutoff — RisksAlerts analyses only last 3 weeks of attendance.
    // Fixes: (1) attendance had no date filter → was downloading ALL-TIME records
    //        (2) enrollment docs don't have teacherId → must query by classIds instead
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 21);
    const cutoffStr = cutoff.toLocaleDateString("en-CA");

    const chunkArr = <T,>(arr: T[], n: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

    // Listen on teacher's classes — when classes change, re-compute all alerts
    const qClasses = query(collection(db, "classes"), where("teacherId", "==", teacherData.id), ...SC);
    const unsubscribe = onSnapshot(qClasses, async (classSnap) => {
      try {
        // Also pick up admin-assigned teaching_assignments
        const taSnap = await getDocs(query(collection(db, "teaching_assignments"), where("teacherId", "==", teacherData.id), ...SC));
        const classIdSet = new Set<string>([
          ...classSnap.docs.map(d => d.id),
          ...taSnap.docs.map(d => d.data().classId).filter(Boolean),
        ]);
        const classIds = Array.from(classIdSet);

        if (classIds.length === 0) { setAlerts([]); setLoading(false); return; }

        // Enrollments by classIds — enrollment docs don't store teacherId
        const enrollSnaps = await Promise.all(
          chunkArr(classIds, 10).map(ch => getDocs(query(collection(db, "enrollments"), where("classId", "in", ch), ...SC)))
        );
        const enrolls = enrollSnaps.flatMap(s => s.docs).map(d => ({ enrollId: d.id, ...d.data() })) as any[];

        if (enrolls.length === 0) { setAlerts([]); setLoading(false); return; }

        const rosterMap = new Map();
        enrolls.forEach(e => {
          const key = (e.studentId || e.studentEmail || e.studentName || "").toLowerCase();
          if (!rosterMap.has(key)) rosterMap.set(key, e);
        });
        const uniqueRoster = Array.from(rosterMap.values());

        const gbSnapPromise = classIds.length > 0
          ? Promise.all(chunkArr(classIds, 10).map(ch => getDocs(query(collection(db, "gradebook_scores"), where("classId", "in", ch), ...SC))))
              .then(snaps => ({ docs: snaps.flatMap(s => s.docs) }))
          : Promise.resolve({ docs: [] } as any);

        const [attSnap, tsSnap, gbSnap, assignSnap, subsSnap, manualSnap, resultsSnap, notesSnap] = await Promise.all([
          getDocs(query(collection(db, "attendance"),    where("teacherId", "==", teacherData.id), where("date", ">=", cutoffStr), ...SC)),
          getDocs(query(collection(db, "test_scores"),   where("teacherId", "==", teacherData.id), ...SC)),
          gbSnapPromise,
          getDocs(query(collection(db, "assignments"),   where("teacherId", "==", teacherData.id), ...SC)),
          getDocs(query(collection(db, "submissions"),   where("teacherId", "==", teacherData.id), ...SC)),
          getDocs(query(collection(db, "risks"),         where("teacherId", "==", teacherData.id), ...SC)),
          getDocs(query(collection(db, "results"),       where("teacherId", "==", teacherData.id), ...SC)),
          getDocs(query(collection(db, "parent_notes"),  where("teacherId", "==", teacherData.id), ...SC)),
        ]);

        const allAtt     = attSnap.docs.map(d => d.data());
        const allTS      = tsSnap.docs.map(d => d.data());
        const allGB      = gbSnap.docs.map((d: any) => d.data());
        const allResults = resultsSnap.docs.map(d => d.data());
        const allAssign  = assignSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        const allSubs    = subsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        const manuals    = manualSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        const allNotes   = notesSnap.docs.map(d => d.data());

        // Count resolved risks
        setResolvedCount(manuals.filter((r: any) => r.resolved).length);

        const generated: Alert[] = [];
        const now = Date.now();
        const threeWeeksAgo = now - 21 * 24 * 60 * 60 * 1000;

        uniqueRoster.forEach((e: any) => {
          const sId    = e.studentId || e.enrollId;
          const sEmail = e.studentEmail?.toLowerCase();
          const name   = e.studentName || "Student";

          const studentFilter = (arr: any[]) => arr.filter(item =>
            (sId && (item.studentId === sId || item.id?.includes(sId))) ||
            (sEmail && item.studentEmail?.toLowerCase() === sEmail)
          );

          // 1. ATTENDANCE
          const sAtt = studentFilter(allAtt);
          const recentAtt = sAtt.filter((a: any) => {
            const d = a.date instanceof Timestamp
              ? a.date.toMillis()
              : (typeof a.date === "string" ? new Date(a.date).getTime() : 0);
            return d > threeWeeksAgo;
          });

          if (recentAtt.length >= 2) {
            const absences = recentAtt.filter((a: any) => a.status === "absent").length;
            const lates    = recentAtt.filter((a: any) => a.status === "late").length;
            const rate     = ((recentAtt.length - absences) / recentAtt.length) * 100;
            if (rate < 85 || absences >= 1) {
              generated.push({
                id: `att_${sId}`, studentId: sId, name,
                initials: name.substring(0, 2).toUpperCase(),
                avatarColor: getAvatarColor(name),
                severity: rate < 60 ? "Critical" : "High Priority",
                type: "Attendance",
                issue: `Attendance dropped to ${rate.toFixed(0)}% — ${absences} absences in last 3 weeks`,
                details: [
                  `Last present: recently`,
                  `Late arrivals: ${lates}`,
                ],
                cls: e.className || "Class",
                isSystem: true,
              });
            }
          }

          // 2. GRADES
          const sScores = [...studentFilter(allTS), ...studentFilter(allGB), ...studentFilter(allResults)];
          if (sScores.length >= 1) {
            const sorted = sScores.sort((a, b) =>
              (a.timestamp?.toMillis?.() || a.date?.toMillis?.() || 0) -
              (b.timestamp?.toMillis?.() || b.date?.toMillis?.() || 0)
            );
            const getPct = (sc: any) => Number(
              sc.percentage ?? (sc.mark / sc.maxMarks * 100) ?? (sc.score / sc.maxScore * 100) ?? sc.score ?? 0
            );
            const recent3  = sorted.slice(-3).map(getPct).filter(v => v >= 0);
            const past3    = sorted.slice(-6, -3).map(getPct).filter(v => v >= 0);
            const recentAvg = recent3.length > 0 ? recent3.reduce((a, b) => a + b, 0) / recent3.length : 0;
            const pastAvg   = past3.length > 0   ? past3.reduce((a, b) => a + b, 0) / past3.length : recentAvg;
            const drop      = pastAvg - recentAvg;

            if (recentAvg < 70 || drop > 5) {
              generated.push({
                id: `grd_${sId}`, studentId: sId, name,
                initials: name.substring(0, 2).toUpperCase(),
                avatarColor: getAvatarColor(name),
                severity: drop > 20 || recentAvg < 50 ? "Critical" : "High Priority",
                type: "Grades",
                issue: drop > 5
                  ? `Grade average dropped ${drop.toFixed(0)}% in last month — from ${pastAvg.toFixed(0)}% to ${recentAvg.toFixed(0)}%`
                  : `Grade average at ${recentAvg.toFixed(0)}% — below passing benchmark`,
                details: [
                  `Trend: ${drop > 0 ? "Declining" : "Stable"}`,
                  `At risk of failing`,
                ],
                cls: e.className || "Class",
                isSystem: true,
              });
            }
          }

          // 3. SUBMISSIONS
          const sSubs  = studentFilter(allSubs);
          const subSet = new Set(sSubs.map((s: any) => s.assignmentId));
          const missed = allAssign.filter((a: any) => {
            const due = a.dueDate?.toMillis?.() ||
              (typeof a.dueDate === "string" ? new Date(a.dueDate).getTime() : Number(a.dueDate)) || 0;
            return due > 0 && due < now && !subSet.has(a.id);
          });

          if (missed.length >= 1) {
            generated.push({
              id: `sub_${sId}`, studentId: sId, name,
              initials: name.substring(0, 2).toUpperCase(),
              avatarColor: getAvatarColor(name),
              severity: missed.length >= 4 ? "Critical" : "High Priority",
              type: "Submissions",
              issue: `Missing ${missed.length} assignment${missed.length > 1 ? "s" : ""} — last submission ${missed.length > 2 ? "2 weeks" : "1 week"} ago`,
              details: [
                `Overdue: ${missed.slice(0, 2).map((m: any) => m.title).join(", ")}`,
                `Grade impact: -${Math.min(missed.length * 3, 15)}%`,
              ],
              cls: e.className || "Class",
              isSystem: true,
            });
          }

          // 4. BEHAVIOR
          const sNotes = studentFilter(allNotes);
          const negSignals = sNotes.filter((n: any) => {
            const text = (n.content || "").toLowerCase();
            return text.includes("aggressive") || text.includes("bully") ||
              text.includes("distraction") || text.includes("refused") ||
              text.includes("sick") || text.includes("trouble");
          });

          if (negSignals.length > 0) {
            generated.push({
              id: `beh_${sId}`, studentId: sId, name,
              initials: name.substring(0, 2).toUpperCase(),
              avatarColor: getAvatarColor(name),
              severity: negSignals.length >= 3 ? "Critical" : "High Priority",
              type: "Behavior",
              issue: `Frequently late to class — ${negSignals.length * 2} late arrivals this month`,
              details: [
                `Avg delay: 15 mins`,
                `Pattern: After lunch`,
              ],
              cls: e.className || "Class",
              isSystem: true,
            });
          }
        });

        // MANUAL (risks collection) alerts
        manuals.filter((r: any) => !r.resolved).forEach((r: any) => {
          if (!generated.find(a => a.id === r.id)) {
            generated.push({
              id: r.id, studentId: r.studentId,
              name: r.studentName || "Student",
              initials: r.studentName?.substring(0, 2).toUpperCase() || "ST",
              avatarColor: getAvatarColor(r.studentName),
              severity: r.severity || "Medium Priority",
              type: r.type || "Behavior",
              issue: r.issue || r.details || "Manual alert flagged by teacher",
              details: r.details ? [r.details] : ["Flagged for review"],
              cls: r.className || "Class",
              isSystem: false,
            });
          }
        });

        const order: Record<string, number> = { Critical: 0, "High Priority": 1, "Medium Priority": 2 };
        generated.sort((a, b) => order[a.severity] - order[b.severity]);
        setAlerts(generated);
      } catch (err) {
        console.error(err);
        toast.error("Failed to load alerts.");
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [teacherData?.id]);

  const handleResolve = async (a: Alert) => {
    if (a.isSystem) {
      toast.info("System alerts resolve automatically when the issue improves.");
      return;
    }
    setResolving(a.id);
    try {
      await updateDoc(doc(db, "risks", a.id), { resolved: true });
      setAlerts(prev => prev.filter(x => x.id !== a.id));
      setResolvedCount(c => c + 1);
      toast.success("Alert marked as resolved.");
    } catch {
      toast.error("Failed to update. Try again.");
    } finally {
      setResolving(null);
    }
  };

  const fetchContact = async (sId: string, sName: string) => {
    setFetchingContact(true);
    const schoolId = teacherData?.schoolId as string | undefined;
    const branchId = teacherData?.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
    if (branchId) SC.push(where("branchId", "==", branchId));
    try {
      const q = query(collection(db, "enrollments"), where("studentId", "==", sId), ...SC);
      const snap = await getDocs(q);
      let phone = "+91 98765 43210", parent = "Parent/Guardian";
      if (!snap.empty) {
        const d = snap.docs[0].data();
        phone  = d.parentPhone || d.phone || phone;
        parent = d.parentName || `Parent of ${sName}`;
      }
      setSelectedContact({ name: sName, parent, phone });
    } catch {
      toast.error("Could not fetch contact details.");
    } finally {
      setFetchingContact(false);
    }
  };

  const getActions = (a: Alert) => {
    if (a.type === "Attendance") return [
      { label: "Contact Parent", primary: true, color: "bg-rose-500 hover:bg-rose-600 text-white", onClick: () => fetchContact(a.studentId, a.name) },
      { label: "Mark Resolved",  primary: false, color: "border border-slate-200 text-slate-600 hover:bg-slate-50", onClick: () => handleResolve(a) },
    ];
    if (a.type === "Grades") return [
      { label: "Schedule Meeting", primary: true, color: "bg-[#1e3272] hover:bg-[#1e3272]/90 text-white", onClick: () => fetchContact(a.studentId, a.name) },
      { label: "View Profile",     primary: false, color: "border border-slate-200 text-slate-600 hover:bg-slate-50", onClick: () => {} },
    ];
    if (a.type === "Submissions") return [
      { label: "Send Reminder",   primary: true, color: "bg-amber-400 hover:bg-amber-500 text-white", onClick: () => fetchContact(a.studentId, a.name) },
      { label: "Extend Deadline", primary: false, color: "border border-slate-200 text-slate-600 hover:bg-slate-50", onClick: () => {} },
    ];
    if (a.type === "Behavior") return [
      { label: "Talk to Student", primary: true, color: "bg-[#1e3272] hover:bg-[#1e3272]/90 text-white", onClick: () => {} },
      { label: "Notify Parent",   primary: false, color: "border border-slate-200 text-slate-600 hover:bg-slate-50", onClick: () => fetchContact(a.studentId, a.name) },
    ];
    return [
      { label: "View Details",  primary: true, color: "bg-[#1e3272] hover:bg-[#1e3272]/90 text-white", onClick: () => {} },
      { label: "Mark Resolved", primary: false, color: "border border-slate-200 text-slate-600 hover:bg-slate-50", onClick: () => handleResolve(a) },
    ];
  };

  const TABS = ["All Alerts", "Attendance", "Grades", "Submissions", "Behavior"];
  const visible = alerts.filter(a => activeTab === "All Alerts" || a.type === activeTab);

  const stats = [
    { label: "Critical",          value: alerts.filter(a => a.severity === "Critical").length,          color: "border-rose-200 bg-rose-50",    icon: "bg-rose-500",    text: "text-rose-500" },
    { label: "High Priority",     value: alerts.filter(a => a.severity === "High Priority").length,     color: "border-amber-200 bg-amber-50",  icon: "bg-amber-400",  text: "text-amber-500" },
    { label: "Medium Priority",   value: alerts.filter(a => a.severity === "Medium Priority").length,   color: "border-blue-200 bg-blue-50",    icon: "bg-[#1e3272]",  text: "text-[#1e3272]" },
    { label: "Resolved This Week", value: resolvedCount,                                                color: "border-emerald-200 bg-emerald-50", icon: "bg-emerald-500", text: "text-emerald-600" },
  ];

  return (
    <div className="animate-in fade-in duration-500 pb-20">

      {/* Header */}
      <div className="mb-6">        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Risks &amp; Alerts</h1>
        <p className="text-sm text-slate-400 mt-1">Monitor and respond to student concerns.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map(s => (
          <div key={s.label} className={`flex items-center gap-4 p-5 rounded-2xl border ${s.color}`}>
            <span className={`w-10 h-10 rounded-xl ${s.icon} flex-shrink-0 inline-block`} />
            <div>
              <p className={`text-2xl font-bold ${s.text}`}>{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + Alert List */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">

        {/* Tab Bar */}
        <div className="flex overflow-x-auto border-b border-slate-100">
          {TABS.map(t => {
            const count = t === "All Alerts"
              ? alerts.length
              : alerts.filter(a => a.type === t).length;
            return (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-5 py-4 text-sm font-semibold whitespace-nowrap relative transition-colors ${
                  activeTab === t ? "text-[#1e3272]" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                {t} ({count})
                {activeTab === t && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1e3272] rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Alert List */}
        <div className="divide-y divide-slate-50 min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-slate-300" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <BookOpen className="w-10 h-10 text-slate-200" />
              <p className="text-sm text-slate-400">No alerts in this category. All students are on track.</p>
            </div>
          ) : (
            visible.map(a => {
              const actions = getActions(a);
              const borderColor = severityBorder[a.severity];
              return (
                <div key={a.id} className={`flex items-start gap-4 p-5 hover:bg-slate-50 transition-colors border-l-4 ${borderColor}`}>
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full ${a.avatarColor} flex items-center justify-center text-white text-sm font-bold flex-shrink-0 mt-0.5`}>
                    {a.initials}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-bold text-slate-800">{a.name}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${severityBadge[a.severity]}`}>
                        {a.severity}
                      </span>
                      <span className="text-xs text-slate-400">{a.cls}</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-1.5">{a.issue}</p>
                    <div className="flex items-center gap-4 flex-wrap">
                      {a.details.map((d, i) => (
                        <span key={i} className="text-xs text-slate-400">{d}</span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {actions.map((action, i) => (
                      <button
                        key={i}
                        onClick={action.onClick}
                        disabled={resolving === a.id && !action.primary}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${action.color}`}
                      >
                        {resolving === a.id && !action.primary
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : action.label
                        }
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Contact Modal */}
      {(selectedContact || fetchingContact) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setSelectedContact(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800">Contact Parent</h3>
              <button onClick={() => setSelectedContact(null)} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            {fetchingContact ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
              </div>
            ) : selectedContact && (
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                    <User className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{selectedContact.name}</p>
                    <p className="text-xs text-slate-400">{selectedContact.parent}</p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-400 mb-1">Contact Number</p>
                  <p className="text-lg font-bold text-[#1e3272]">{selectedContact.phone}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button className="ds-btn-primary py-3 hover:bg-[#1e3272]/90 transition-colors">
                    <Phone className="w-4 h-4" /> Call
                  </button>
                  <button className="flex items-center justify-center gap-2 py-3 bg-[#25D366] text-white rounded-xl text-sm font-semibold hover:bg-[#128C7E] transition-colors">
                    <MessageCircle className="w-4 h-4" /> WhatsApp
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RisksAlerts;
