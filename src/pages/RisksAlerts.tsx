import { useState, useEffect, useMemo } from "react";
import { db } from "../lib/firebase";
import {
  collection, query, onSnapshot, getDocs,
  doc, updateDoc, where, Timestamp,
} from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
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

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  hero:  "#08090C",
  bg:    "#F5F6F9",
  white: "#ffffff",
  ink1:  "#08090C",
  ink2:  "#42475A",
  ink3:  "#8C92A4",
  s1:    "#F5F6F9",
  s2:    "#ECEEF4",
  bdr:   "#E2E5EE",
  blue:  "#3B5BDB",
  blBg:  "#EDF2FF",
  blBdr: "#BAC8FF",
  red:   "#C92A2A",
  rlBg:  "#FFF5F5",
  rlBdr: "#FFC9C9",
  amb:   "#C87014",
  alBg:  "#FFF9DB",
  alBdr: "#FFE066",
  grn:   "#087F5B",
  grn2:  "#2F9E44",
  glBg:  "#EBFBEE",
  glBdr: "#8CE99A",
};

// ── Avatar helpers ────────────────────────────────────────────────────────────
const AV_HEX = ["#3B5BDB","#0ea5e9","#10b981","#f59e0b","#8b5cf6","#f43f5e","#06b6d4"];
const avBg = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_HEX[h % AV_HEX.length];
};
const getInitials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
};

// ── Legacy color kept for alert obj field compat ──────────────────────────────
const AVATAR_COLORS = ["bg-rose-500","bg-amber-500","bg-emerald-600","bg-blue-600","bg-violet-600","bg-indigo-600"];
const getAvatarColor = (name: string) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

// ── Severity style map ────────────────────────────────────────────────────────
const SEV: Record<string, { color: string; bg: string; bdr: string; pillBg: string; pillColor: string }> = {
  Critical:          { color: T.red,  bg: T.rlBg, bdr: T.rlBdr, pillBg: "rgba(201,42,42,0.1)",  pillColor: T.red  },
  "High Priority":   { color: T.amb,  bg: T.alBg, bdr: T.alBdr, pillBg: "rgba(200,112,20,0.1)", pillColor: T.amb  },
  "Medium Priority": { color: T.blue, bg: T.blBg, bdr: T.blBdr, pillBg: "rgba(59,91,219,0.1)",  pillColor: T.blue },
};

// ── getPct ────────────────────────────────────────────────────────────────────
const getPct = (sc: any): number => {
  if (sc.percentage != null) return Number(sc.percentage);
  if (sc.mark != null && sc.maxMarks) return sc.mark / sc.maxMarks * 100;
  if (sc.score != null && sc.maxScore) return sc.score / sc.maxScore * 100;
  if (sc.score != null) return Number(sc.score);
  return 0;
};

// ── Sub-components ────────────────────────────────────────────────────────────
const Chip = ({ icon, text }: { icon?: string; text: string }) => (
  <div style={{
    padding: "5px 10px", borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.06)",
    fontSize: 10, color: "rgba(255,255,255,0.6)",
    display: "inline-flex", alignItems: "center", gap: 4,
  }}>
    {icon === "check" && (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1.5,6.5 4,9 8.5,2" />
      </svg>
    )}
    {icon === "clock" && (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="5" r="3.5" /><polyline points="5,3 5,5.5 7,5.5" />
      </svg>
    )}
    {icon === "att" && (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1.5,8.5 6,7 3,4 7,2.5" />
      </svg>
    )}
    {icon === "grades" && (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1.5,7 4,5 6,6.5 8.5,3" />
      </svg>
    )}
    {text}
  </div>
);

interface MetricCardProps {
  label: string; value: number; badge: string;
  color: string; bg: string; bdr: string;
  fillW: number; icon: React.ReactNode;
}
const MetricCard = ({ label, value, badge, color, bg, bdr, fillW, icon }: MetricCardProps) => (
  <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 16, padding: 14 }}>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: `${color}1E`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </div>
      <span style={{ padding: "3px 8px", borderRadius: 20, background: `${color}1A`, color, fontSize: 10, fontWeight: 500 }}>
        {badge}
      </span>
    </div>
    <div style={{ fontSize: 22, fontWeight: 500, color, letterSpacing: "-0.5px", lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 11, color, opacity: 0.7, marginTop: 3 }}>{label}</div>
    <div style={{ height: 3, borderRadius: 2, background: "rgba(0,0,0,0.08)", marginTop: 10, overflow: "hidden" }}>
      <div style={{ height: "100%", borderRadius: 2, background: color, width: `${Math.min(fillW, 100)}%`, transition: "width 0.5s ease" }} />
    </div>
  </div>
);

const ThresholdCard = ({ title, sub, rows }: { title: string; sub: string; rows: { label: string; value: string; color: string }[] }) => (
  <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: "hidden" }}>
    <div style={{ padding: "11px 13px", borderBottom: `1px solid ${T.s2}` }}>
      <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, margin: 0 }}>{title}</p>
      <p style={{ fontSize: 10, color: T.ink3, marginTop: 2, marginBottom: 0 }}>{sub}</p>
    </div>
    {rows.map((row, i) => (
      <div key={i} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 13px",
        borderBottom: i < rows.length - 1 ? `1px solid ${T.s2}` : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: T.ink2 }}>{row.label}</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 500, color: row.color }}>{row.value}</span>
      </div>
    ))}
  </div>
);

// ── Inline icon components ────────────────────────────────────────────────────
const TriAlertIco = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 1.5L13 12.5H1L7 1.5z" /><line x1="7" y1="5.5" x2="7" y2="8.5" />
    <circle cx="7" cy="10.2" r=".7" fill={c} stroke="none" />
  </svg>
);
const CircleInfoIco = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="5.5" /><line x1="7" y1="4.5" x2="7" y2="7.5" />
    <circle cx="7" cy="9.5" r=".7" fill={c} stroke="none" />
  </svg>
);
const CheckIco = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,7.5 5.5,11 12.5,3.5" />
  </svg>
);

const TabIcon = ({ type, active }: { type: string; active: boolean }) => {
  const c = active ? T.red : T.ink3;
  const p = { width: 19, height: 19, viewBox: "0 0 18 18", fill: "none", stroke: c, strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (type === "grid") return (
    <svg {...p}><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="11" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="11" width="5" height="5" rx="1.2" /><rect x="11" y="11" width="5" height="5" rx="1.2" /></svg>
  );
  if (type === "students") return (
    <svg {...p}><path d="M2 15V9L9 5l7 4v6" /><rect x="6.5" y="11" width="5" height="4" rx=".5" /></svg>
  );
  if (type === "alert") return (
    <svg {...p}><path d="M9 2L16.5 15.5H1.5L9 2z" /><line x1="9" y1="7" x2="9" y2="11.5" /><circle cx="9" cy="13.5" r="1" fill={c} stroke="none" /></svg>
  );
  if (type === "user") return (
    <svg {...p}><circle cx="9" cy="7" r="3" /><path d="M3 17c0 0 1.5-4 6-4s6 4 6 4" /></svg>
  );
  return null;
};

// ── Main component ────────────────────────────────────────────────────────────
const RisksAlerts = () => {
  const { teacherData } = useAuth();
  const [loading, setLoading]               = useState(true);
  const [alerts, setAlerts]                 = useState<Alert[]>([]);
  const [resolvedCount, setResolvedCount]   = useState(0);
  const [activeTab, setActiveTab]           = useState("All");
  const [resolving, setResolving]           = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [fetchingContact, setFetchingContact] = useState(false);
  const [subjectHealth, setSubjectHealth]   = useState<{ name: string; avg: number }[]>([]);

  // ── Firebase listener ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id) return;
    setLoading(true);

    const schoolId = teacherData.schoolId as string | undefined;
    const branchId = teacherData.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
    if (branchId) SC.push(where("branchId", "==", branchId));

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 21);
    const cutoffStr = cutoff.toLocaleDateString("en-CA");

    const chunkArr = <X,>(arr: X[], n: number): X[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

    const qClasses = query(collection(db, "classes"), where("teacherId", "==", teacherData.id), ...SC);
    const unsubscribe = onSnapshot(qClasses, async (classSnap) => {
      try {
        const taSnap = await getDocs(query(collection(db, "teaching_assignments"), where("teacherId", "==", teacherData.id), ...SC));
        const classIdSet = new Set<string>([
          ...classSnap.docs.map(d => d.id),
          ...taSnap.docs.map(d => d.data().classId).filter(Boolean),
        ]);
        const classIds = Array.from(classIdSet);

        if (classIds.length === 0) { setAlerts([]); setLoading(false); return; }

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

        setResolvedCount(manuals.filter((r: any) => r.resolved).length);

        // Subject health computation
        const subMap = new Map<string, { total: number; count: number }>();
        [...allTS, ...allResults].forEach((sc: any) => {
          const subj = sc.subject || sc.testName || "General";
          if (!subj) return;
          const p = getPct(sc);
          if (!subMap.has(subj)) subMap.set(subj, { total: 0, count: 0 });
          subMap.get(subj)!.total += p;
          subMap.get(subj)!.count += 1;
        });
        setSubjectHealth(
          Array.from(subMap.entries())
            .map(([name, { total, count }]) => ({ name, avg: Math.round(total / count) }))
            .sort((a, b) => b.avg - a.avg)
            .slice(0, 5)
        );

        const generated: Alert[] = [];
        const now = Date.now();
        const threeWeeksAgo = now - 21 * 24 * 60 * 60 * 1000;

        uniqueRoster.forEach((e: any) => {
          const sId    = e.studentId || e.enrollId;
          const sEmail = e.studentEmail?.toLowerCase();
          const name   = e.studentName || "Student";

          const sf = (arr: any[]) => arr.filter(item =>
            (sId && (item.studentId === sId || item.id?.includes(sId))) ||
            (sEmail && item.studentEmail?.toLowerCase() === sEmail)
          );

          // 1. ATTENDANCE
          const sAtt = sf(allAtt);
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
                initials: getInitials(name), avatarColor: getAvatarColor(name),
                severity: rate < 60 ? "Critical" : "High Priority",
                type: "Attendance",
                issue: `Attendance dropped to ${rate.toFixed(0)}% — ${absences} absences in last 3 weeks`,
                details: [`Late arrivals: ${lates}`, `Last 3 weeks window`],
                cls: e.className || "Class", isSystem: true,
              });
            }
          }

          // 2. GRADES
          const sScores = [...sf(allTS), ...sf(allGB), ...sf(allResults)];
          if (sScores.length >= 1) {
            const sorted    = sScores.sort((a, b) =>
              (a.timestamp?.toMillis?.() || a.date?.toMillis?.() || 0) -
              (b.timestamp?.toMillis?.() || b.date?.toMillis?.() || 0)
            );
            const recent3   = sorted.slice(-3).map(getPct).filter(v => v >= 0);
            const past3     = sorted.slice(-6, -3).map(getPct).filter(v => v >= 0);
            const recentAvg = recent3.length > 0 ? recent3.reduce((a, b) => a + b, 0) / recent3.length : 0;
            const pastAvg   = past3.length > 0   ? past3.reduce((a, b) => a + b, 0) / past3.length : recentAvg;
            const drop      = pastAvg - recentAvg;
            if (recentAvg < 70 || drop > 5) {
              generated.push({
                id: `grd_${sId}`, studentId: sId, name,
                initials: getInitials(name), avatarColor: getAvatarColor(name),
                severity: drop > 20 || recentAvg < 50 ? "Critical" : "High Priority",
                type: "Grades",
                issue: drop > 5
                  ? `Grade avg dropped ${drop.toFixed(0)}% — from ${pastAvg.toFixed(0)}% to ${recentAvg.toFixed(0)}%`
                  : `Grade avg at ${recentAvg.toFixed(0)}% — below passing benchmark`,
                details: [`Trend: ${drop > 0 ? "Declining" : "Stable"}`, `At risk of failing`],
                cls: e.className || "Class", isSystem: true,
              });
            }
          }

          // 3. SUBMISSIONS
          const sSubs  = sf(allSubs);
          const subSet = new Set(sSubs.map((s: any) => s.assignmentId));
          const missed = allAssign.filter((a: any) => {
            const due = a.dueDate?.toMillis?.() ||
              (typeof a.dueDate === "string" ? new Date(a.dueDate).getTime() : Number(a.dueDate)) || 0;
            return due > 0 && due < now && !subSet.has(a.id);
          });
          if (missed.length >= 1) {
            generated.push({
              id: `sub_${sId}`, studentId: sId, name,
              initials: getInitials(name), avatarColor: getAvatarColor(name),
              severity: missed.length >= 4 ? "Critical" : "High Priority",
              type: "Submissions",
              issue: `Missing ${missed.length} assignment${missed.length > 1 ? "s" : ""} — overdue`,
              details: [`Overdue: ${missed.slice(0, 2).map((m: any) => m.title).join(", ")}`, `Grade impact: -${Math.min(missed.length * 3, 15)}%`],
              cls: e.className || "Class", isSystem: true,
            });
          }

          // 4. BEHAVIOR
          const sNotes    = sf(allNotes);
          const negSignals = sNotes.filter((n: any) => {
            const text = (n.content || "").toLowerCase();
            return text.includes("aggressive") || text.includes("bully") ||
              text.includes("distraction") || text.includes("refused") ||
              text.includes("sick") || text.includes("trouble");
          });
          if (negSignals.length > 0) {
            generated.push({
              id: `beh_${sId}`, studentId: sId, name,
              initials: getInitials(name), avatarColor: getAvatarColor(name),
              severity: negSignals.length >= 3 ? "Critical" : "High Priority",
              type: "Behavior",
              issue: `${negSignals.length} concerning behaviour note${negSignals.length > 1 ? "s" : ""} logged`,
              details: [`Notes flagged: ${negSignals.length}`, `Requires attention`],
              cls: e.className || "Class", isSystem: true,
            });
          }
        });

        // MANUAL alerts (risks collection)
        manuals.filter((r: any) => !r.resolved).forEach((r: any) => {
          if (!generated.find(a => a.id === r.id)) {
            generated.push({
              id: r.id, studentId: r.studentId,
              name: r.studentName || "Student",
              initials: getInitials(r.studentName || "Student"),
              avatarColor: getAvatarColor(r.studentName),
              severity: r.severity || "Medium Priority",
              type: r.type || "Behavior",
              issue: r.issue || r.details || "Manual alert flagged by teacher",
              details: r.details ? [r.details] : ["Flagged for review"],
              cls: r.className || "Class", isSystem: false,
            });
          }
        });

        const ORDER: Record<string, number> = { Critical: 0, "High Priority": 1, "Medium Priority": 2 };
        generated.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
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

  // ── Handlers ─────────────────────────────────────────────────────────────
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

  const getActions = (a: Alert): { label: string; primary: boolean; color?: string; onClick: () => void }[] => {
    if (a.type === "Attendance") return [
      { label: "Contact Parent", primary: true, color: T.red,  onClick: () => fetchContact(a.studentId, a.name) },
      { label: "Mark Resolved",  primary: false,               onClick: () => handleResolve(a) },
    ];
    if (a.type === "Grades") return [
      { label: "Schedule Meeting", primary: true, color: T.blue, onClick: () => fetchContact(a.studentId, a.name) },
      { label: "View Profile",     primary: false,               onClick: () => {} },
    ];
    if (a.type === "Submissions") return [
      { label: "Send Reminder",  primary: true, color: T.amb, onClick: () => fetchContact(a.studentId, a.name) },
      { label: "Mark Resolved",  primary: false,               onClick: () => handleResolve(a) },
    ];
    if (a.type === "Behavior") return [
      { label: "Notify Parent",  primary: true, color: T.blue, onClick: () => fetchContact(a.studentId, a.name) },
      { label: "Mark Resolved",  primary: false,               onClick: () => handleResolve(a) },
    ];
    return [
      { label: "View Details",  primary: true, color: T.blue, onClick: () => {} },
      { label: "Mark Resolved", primary: false,               onClick: () => handleResolve(a) },
    ];
  };

  // ── Computed values ───────────────────────────────────────────────────────
  const criticalCount = alerts.filter(a => a.severity === "Critical").length;
  const highCount     = alerts.filter(a => a.severity === "High Priority").length;
  const mediumCount   = alerts.filter(a => a.severity === "Medium Priority").length;
  const attCount      = alerts.filter(a => a.type === "Attendance").length;
  const gradesCount   = alerts.filter(a => a.type === "Grades").length;
  const totalCount    = alerts.length;
  const maxBar        = Math.max(totalCount, 1);

  const visible = useMemo(() => {
    if (activeTab === "Attendance") return alerts.filter(a => a.type === "Attendance");
    if (activeTab === "Grades")     return alerts.filter(a => a.type === "Grades");
    return alerts;
  }, [alerts, activeTab]);

  // Hero content changes per tab
  const HERO: Record<string, { eyebrow: string; line1: string; line2: string; sub: string }> = {
    All:        { eyebrow: "Monitoring",            line1: "Risks &",    line2: "alerts",  sub: "Monitor and respond to student concerns." },
    Attendance: { eyebrow: "Attendance monitoring", line1: "Attendance", line2: "alerts",  sub: "Students with attendance concerns appear here." },
    Grades:     { eyebrow: "Grade monitoring",      line1: "Grade",      line2: "alerts",  sub: "Students with grade concerns appear here." },
  };
  const hc = HERO[activeTab] || HERO.All;

  // Subject health bar color
  const subjColor = (avg: number) =>
    avg >= 80 ? T.grn2 : avg >= 60 ? T.blue : avg >= 40 ? T.amb : T.red;

  // Filter tabs config
  const FILTER_TABS = [
    { id: "All",        label: `All (${totalCount})` },
    { id: "Attendance", label: "Attendance"           },
    { id: "Grades",     label: "Grades"               },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: T.bg, paddingBottom: 88 }}>

      {/* ── Dark hero ───────────────────────────────────────────────────────── */}
      <div
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8"
        style={{ background: T.hero, padding: "0 22px 28px" }}
      >
        <div style={{ paddingTop: 20 }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            {hc.eyebrow}
          </p>
          <h1 style={{ fontSize: 26, fontWeight: 500, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1.1, marginBottom: 6 }}>
            {hc.line1}<br />{hc.line2}
          </h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.5, marginBottom: 16 }}>{hc.sub}</p>

          {/* Chips */}
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {activeTab === "All" && (
              <>
                <Chip icon="check" text={`${criticalCount} Critical`} />
                <Chip icon="check" text={totalCount === 0 ? "All on track" : `${totalCount} active`} />
                <Chip icon="clock" text="Live" />
              </>
            )}
            {activeTab === "Attendance" && (
              <>
                <Chip icon="att" text={`${attCount} Absence alerts`} />
                {attCount === 0 && <Chip icon="check" text="All clear" />}
              </>
            )}
            {activeTab === "Grades" && (
              <>
                <Chip icon="grades" text={`${gradesCount} Grade alerts`} />
                {gradesCount === 0 && <Chip icon="check" text="All passing" />}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16 }}>

        {/* 4-metric grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <MetricCard label="Critical"          value={criticalCount} badge="Urgent"   color={T.red}  bg={T.rlBg} bdr={T.rlBdr} fillW={criticalCount / maxBar * 100} icon={<TriAlertIco c={T.red} />}   />
          <MetricCard label="High priority"     value={highCount}     badge="High"     color={T.amb}  bg={T.alBg} bdr={T.alBdr} fillW={highCount     / maxBar * 100} icon={<CircleInfoIco c={T.amb} />} />
          <MetricCard label="Medium priority"   value={mediumCount}   badge="Medium"   color={T.blue} bg={T.blBg} bdr={T.blBdr} fillW={mediumCount   / maxBar * 100} icon={<CircleInfoIco c={T.blue} />}/>
          <MetricCard label="Resolved this week" value={resolvedCount} badge="Resolved" color={T.grn2} bg={T.glBg} bdr={T.glBdr} fillW={resolvedCount / maxBar * 100} icon={<CheckIco c={T.grn2} />}    />
        </div>

        {/* Filter tab strip */}
        <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: 4, display: "flex", gap: 3 }}>
          {FILTER_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: "8px 6px", borderRadius: 11,
                background: activeTab === tab.id ? T.ink1 : "transparent",
                color: activeTab === tab.id ? "#fff" : T.ink3,
                fontSize: 11, fontWeight: activeTab === tab.id ? 500 : 400,
                border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                transition: "background 0.15s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Alert panel */}
        <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: "hidden" }}>

          {/* Panel header */}
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.s2}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.ink1, display: "flex", alignItems: "center", gap: 7 }}>
              {activeTab === "All" && (
                <>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1.5" y="2" width="11" height="10.5" rx="1.5" /><line x1="4" y1="1" x2="4" y2="3.5" />
                    <line x1="10" y1="1" x2="10" y2="3.5" /><line x1="1.5" y1="5.5" x2="12.5" y2="5.5" />
                  </svg>
                  All alerts
                </>
              )}
              {activeTab === "Attendance" && (
                <>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2,8.5 6,7 3.5,4 7.5,2.5" />
                  </svg>
                  Attendance alerts
                </>
              )}
              {activeTab === "Grades" && (
                <>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#6741D9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2,10 5.5,6.5 8.5,8.5 12.5,3.5" /><polyline points="10.5,3.5 12.5,3.5 12.5,5.5" />
                  </svg>
                  Grade alerts
                </>
              )}
            </div>
            {activeTab === "All" ? (
              <button
                onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 400); }}
                style={{ fontSize: 11, color: T.blue, background: "none", border: "none", cursor: "pointer" }}
              >
                Refresh
              </button>
            ) : (
              <span style={{ padding: "3px 8px", borderRadius: 20, background: T.glBg, color: T.grn2, fontSize: 10, fontWeight: 500 }}>
                {visible.length} active
              </span>
            )}
          </div>

          {/* Panel content */}
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Loader2 style={{ width: 28, height: 28, color: T.ink3 }} className="animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            /* Empty state */
            <div style={{ padding: "32px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: T.glBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={T.grn} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3,11 8,16 19,5" />
                </svg>
              </div>
              <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1, margin: 0 }}>
                {activeTab === "All" ? "All students on track" : activeTab === "Attendance" ? "No attendance concerns" : "No grade concerns"}
              </p>
              <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", lineHeight: 1.5, maxWidth: 200, margin: 0 }}>
                {activeTab === "All"
                  ? "No alerts in any category. Keep up the great work!"
                  : activeTab === "Attendance"
                  ? "All students have good attendance records this week."
                  : "All students are performing within acceptable grade ranges."}
              </p>
              <span style={{ padding: "3px 8px", borderRadius: 20, background: T.glBg, color: T.grn2, fontSize: 10, fontWeight: 500, marginTop: 4 }}>
                {activeTab === "All" ? "0 active alerts" : activeTab === "Attendance" ? "Attendance all clear" : "Grades all clear"}
              </span>
            </div>
          ) : (
            /* Alert list */
            <div>
              {visible.map((a, idx) => {
                const s = SEV[a.severity] || SEV["Medium Priority"];
                const actions = getActions(a);
                return (
                  <div
                    key={a.id}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "12px 14px",
                      borderBottom: idx < visible.length - 1 ? `1px solid ${T.s2}` : "none",
                      borderLeft: `3px solid ${s.color}`,
                    }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 34, height: 34, borderRadius: 10,
                      background: avBg(a.name), color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, flexShrink: 0,
                    }}>
                      {getInitials(a.name)}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: T.ink1 }}>{a.name}</span>
                        <span style={{ padding: "2px 7px", borderRadius: 20, background: s.pillBg, color: s.pillColor, fontSize: 10, fontWeight: 500 }}>
                          {a.severity}
                        </span>
                        <span style={{ fontSize: 10, color: T.ink3 }}>{a.cls}</span>
                      </div>
                      <p style={{ fontSize: 11, color: T.ink2, marginBottom: 5, lineHeight: 1.4 }}>{a.issue}</p>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                        {a.details.map((d, i) => (
                          <span key={i} style={{ fontSize: 10, color: T.ink3 }}>{d}</span>
                        ))}
                      </div>
                      {/* Action buttons */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {actions.map((action, i) => (
                          <button
                            key={i}
                            onClick={action.onClick}
                            disabled={resolving === a.id}
                            style={{
                              padding: "5px 10px", borderRadius: 8,
                              background: action.primary ? (action.color || T.blue) : "transparent",
                              color: action.primary ? "#fff" : T.ink3,
                              border: action.primary ? "none" : `1px solid ${T.bdr}`,
                              fontSize: 10, fontWeight: 600, cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 4,
                              opacity: resolving === a.id ? 0.6 : 1,
                            }}
                          >
                            {resolving === a.id && !action.primary
                              ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />
                              : action.label
                            }
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Tab-specific supplementary cards ──────────────────────────────── */}

        {/* All tab — status banner + quick actions (only when empty) */}
        {activeTab === "All" && visible.length === 0 && (
          <>
            <div style={{ background: T.glBg, border: `1px solid ${T.glBdr}`, borderRadius: 16, padding: 14, display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: "rgba(47,158,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={T.grn} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2.5,8.5 6,12 13.5,4" />
                </svg>
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: T.grn, margin: "0 0 2px" }}>System all clear</p>
                <p style={{ fontSize: 10, color: T.grn, opacity: 0.75, margin: 0, lineHeight: 1.4 }}>
                  No critical or high priority alerts active. All students performing within expected ranges.
                </p>
              </div>
            </div>

            <p style={{ fontSize: 10, fontWeight: 500, color: T.ink3, letterSpacing: "0.07em", textTransform: "uppercase", margin: "4px 2px 0" }}>
              Quick actions
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {([
                { label: "View at-risk",  sub: "See students needing help",  iconBg: T.rlBg, ic: T.red,  svgD: "M6.5 1.5L12 11.5H1L6.5 1.5z", onClick: () => {} },
                { label: "Send alerts",   sub: "Notify parents directly",     iconBg: T.blBg, ic: T.blue, svgD: null, onClick: () => toast.info("Use Contact Parent on individual alerts.") },
                { label: "Mark resolved", sub: "Close active alerts",         iconBg: T.glBg, ic: T.grn2, svgD: "M1.5,7 5,10.5 11.5,3", onClick: () => toast.info("Select an alert to mark it resolved.") },
                { label: "Export report", sub: "Download alert log",          iconBg: T.alBg, ic: T.amb,  svgD: null, onClick: () => toast.info("Export coming soon.") },
              ] as const).map((qa) => (
                <button
                  key={qa.label}
                  onClick={qa.onClick}
                  style={{
                    padding: "11px 10px", borderRadius: 13,
                    border: `1px solid ${T.bdr}`, background: T.white,
                    display: "flex", flexDirection: "column", gap: 6,
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: qa.iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {qa.label === "Send alerts" ? (
                      <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={qa.ic} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2,9.5 L11,9.5 L9,6 L11,2.5 L2,2.5 L4,6 Z" />
                      </svg>
                    ) : qa.label === "Export report" ? (
                      <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={qa.ic} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="1.5" width="9" height="10" rx="1.5" /><line x1="4.5" y1="5" x2="8.5" y2="5" /><line x1="4.5" y1="7.5" x2="7" y2="7.5" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={qa.ic} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points={qa.svgD || ""} />
                        {qa.label === "View at-risk" && <path d="M6.5 1.5L12 11.5H1L6.5 1.5z" />}
                      </svg>
                    )}
                  </div>
                  <p style={{ fontSize: 11, fontWeight: 500, color: T.ink1, margin: 0 }}>{qa.label}</p>
                  <p style={{ fontSize: 10, color: T.ink3, margin: 0 }}>{qa.sub}</p>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Attendance tab — thresholds */}
        {activeTab === "Attendance" && (
          <ThresholdCard
            title="Alert thresholds"
            sub="Alerts trigger when students cross these limits"
            rows={[
              { label: "Critical absence rate", value: "< 60%",  color: T.red  },
              { label: "High priority",          value: "60–74%", color: T.amb  },
              { label: "Medium priority",        value: "75–79%", color: T.blue },
            ]}
          />
        )}

        {/* Grades tab — thresholds + subject health */}
        {activeTab === "Grades" && (
          <>
            <ThresholdCard
              title="Grade alert thresholds"
              sub="Alerts trigger when scores fall below"
              rows={[
                { label: "Critical (F grade)", value: "< 40%",  color: T.red  },
                { label: "High priority",      value: "40–49%", color: T.amb  },
                { label: "Medium priority",    value: "50–59%", color: T.blue },
              ]}
            />
            {subjectHealth.length > 0 && (
              <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 16, padding: "12px 13px" }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, margin: "0 0 10px" }}>Subject health check</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {subjectHealth.map(s => (
                    <div key={s.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 7, background: T.blBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="1.5" y="1" width="9" height="10" rx="1.5" /><line x1="3.5" y1="4.5" x2="8.5" y2="4.5" /><line x1="3.5" y1="7" x2="6" y2="7" />
                          </svg>
                        </div>
                        <span style={{ fontSize: 12, color: T.ink2 }}>{s.name}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 60, height: 4, borderRadius: 2, background: T.s2, overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(s.avg, 100)}%`, height: "100%", background: subjColor(s.avg), borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 500, color: subjColor(s.avg) }}>{s.avg}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Mobile bottom tab bar ────────────────────────────────────────────── */}
      <div
        className="md:hidden"
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: T.white, borderTop: `1px solid ${T.bdr}`,
          padding: "9px 24px 17px",
          display: "flex", justifyContent: "space-around",
          zIndex: 40,
        }}
      >
        {([
          { label: "Dashboard", type: "grid",     active: false },
          { label: "Students",  type: "students", active: false },
          { label: "Alerts",    type: "alert",    active: true  },
          { label: "Profile",   type: "user",     active: false },
        ] as const).map(ti => (
          <div key={ti.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer" }}>
            <TabIcon type={ti.type} active={ti.active} />
            <span style={{ fontSize: 9, color: ti.active ? T.red : T.ink3, fontWeight: ti.active ? 500 : 400 }}>{ti.label}</span>
            {ti.active && <div style={{ width: 13, height: 2.5, borderRadius: 2, background: T.red }} />}
          </div>
        ))}
      </div>

      {/* ── Contact modal ─────────────────────────────────────────────────────── */}
      {(selectedContact || fetchingContact) && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setSelectedContact(null)}
        >
          <div
            style={{ background: T.white, borderRadius: 20, width: "100%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${T.s2}` }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: T.ink1, margin: 0 }}>Contact Parent</h3>
              <button
                onClick={() => setSelectedContact(null)}
                style={{ width: 28, height: 28, border: "none", background: T.s1, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={T.ink3} strokeWidth="1.8" strokeLinecap="round">
                  <line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" />
                </svg>
              </button>
            </div>

            {fetchingContact ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 style={{ width: 24, height: 24, color: T.ink3 }} className="animate-spin" />
              </div>
            ) : selectedContact && (
              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: avBg(selectedContact.name), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>
                    {getInitials(selectedContact.name)}
                  </div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: T.ink1, margin: 0 }}>{selectedContact.name}</p>
                    <p style={{ fontSize: 11, color: T.ink3, margin: "3px 0 0" }}>{selectedContact.parent}</p>
                  </div>
                </div>
                <div style={{ background: T.s1, borderRadius: 12, padding: "12px 14px" }}>
                  <p style={{ fontSize: 10, color: T.ink3, margin: "0 0 4px" }}>Contact Number</p>
                  <p style={{ fontSize: 17, fontWeight: 700, color: T.blue, margin: 0 }}>{selectedContact.phone}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button style={{ padding: "12px 0", background: T.blue, color: "#fff", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12.5 9.5c0 .4-.1.8-.3 1.1-.2.3-.5.6-.8.8-.5.5-1 .7-1.6.7-.4 0-.9-.1-1.4-.4-1.4-.7-2.6-1.7-3.7-2.8C3.6 7.8 2.6 6.6 1.9 5.3 1.6 4.8 1.5 4.3 1.5 3.9c0-.6.2-1.1.7-1.6.3-.3.6-.5 1-.6C3.5 1.6 3.7 1.5 4 1.5c.1 0 .2 0 .3.1.1 0 .2.1.3.2L6.4 4c.1.1.2.3.2.4 0 .2-.1.3-.2.5l-.6.7c0 .1-.1.2-.1.3 0 .1.1.2.1.3.1.2.7.9 1.4 1.6.7.7 1.4 1.3 1.6 1.4.1.1.2.1.3.1s.2 0 .3-.1l.7-.6c.1-.1.3-.2.5-.2.1 0 .3 0 .4.1l2.2 1.8c.1.1.2.2.2.3.1.1.1.2.1.3z" />
                    </svg>
                    Call
                  </button>
                  <button style={{ padding: "12px 0", background: "#25D366", color: "#fff", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 1.5C3.96 1.5 1.5 3.96 1.5 7c0 .97.25 1.88.7 2.67L1.5 12.5l2.83-.69C5.12 12.26 6.03 12.5 7 12.5c3.04 0 5.5-2.46 5.5-5.5S10.04 1.5 7 1.5z" />
                      <path d="M5 5.5c.5 1.2 1.4 2.2 2.5 2.5" />
                    </svg>
                    WhatsApp
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