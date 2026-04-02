import React, { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, getDocs, doc, updateDoc, where, Timestamp } from "firebase/firestore";
import { 
  CheckCircle2, Loader2, Phone, X, User, MessageCircle, 
  AlertTriangle, TrendingDown, Clock, BookOpen, AlertCircle, 
  ArrowUpRight, Share2, Video, Calendar, ShieldCheck, Heart
} from "lucide-react";
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
  trend?: "declining" | "stable" | "improving";
}

const SEVERITY_BADGE: Record<string, string> = {
  Critical:         "bg-rose-600 text-white shadow-lg shadow-rose-500/20",
  "High Priority":  "bg-amber-500 text-white shadow-lg shadow-amber-500/20",
  "Medium Priority":"bg-indigo-500 text-white shadow-lg shadow-indigo-500/20",
};

const AVATAR_COLORS = ["bg-rose-500","bg-amber-500","bg-emerald-600","bg-blue-600","bg-violet-600","bg-indigo-600"];
const getAvatarColor = (name: string) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

const RisksAlerts = () => {
  const { teacherData } = useAuth();
  const [loading, setLoading]   = useState(true);
  const [alerts, setAlerts]     = useState<Alert[]>([]);
  const [activeTab, setActiveTab] = useState("All Alerts");
  const [resolving, setResolving] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [fetchingContact, setFetchingContact] = useState(false);

  useEffect(() => {
    if (!teacherData?.id) return;
    setLoading(true);

    const qEnroll = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    const unsubscribe = onSnapshot(qEnroll, async (snapshot) => {
      const enrolls = snapshot.docs.map(d => ({ enrollId: d.id, ...d.data() })) as any[];
      if (enrolls.length === 0) { setLoading(false); return; }

      const rosterMap = new Map();
      enrolls.forEach(e => {
         const key = (e.studentId || e.studentEmail || e.studentName).toLowerCase();
         if (!rosterMap.has(key)) rosterMap.set(key, e);
      });
      const uniqueRoster = Array.from(rosterMap.values());

      try {
        const classIds = [...new Set(enrolls.map((e: any) => e.classId).filter(Boolean))] as string[];

        const [attSnap, tsSnap, gbSnap, assignSnap, subsSnap, manualSnap, resultsSnap, notesSnap] = await Promise.all([
          getDocs(query(collection(db, "attendance"),             where("teacherId", "==", teacherData.id))),
          getDocs(query(collection(db, "test_scores"),            where("teacherId", "==", teacherData.id))),
          classIds.length > 0
            ? getDocs(query(collection(db, "gradebook_scores"),  where("classId", "in", classIds)))
            : Promise.resolve({ docs: [] } as any),
          getDocs(query(collection(db, "assignments"),            where("teacherId", "==", teacherData.id))),
          getDocs(query(collection(db, "submissions"), where("teacherId", "==", teacherData.id))),
          getDocs(query(collection(db, "risks"),                  where("teacherId", "==", teacherData.id))),
          getDocs(query(collection(db, "results"),                 where("teacherId", "==", teacherData.id))),
          getDocs(query(collection(db, "parent_notes"),           where("teacherId", "==", teacherData.id)))
        ]);

        const allAtt    = attSnap.docs.map(d => d.data());
        const allTS     = tsSnap.docs.map(d => d.data());
        const allGB     = gbSnap.docs.map((d: any) => d.data());
        const allResults = resultsSnap.docs.map(d => d.data());
        const allAssign = assignSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        const allSubs   = subsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        const manuals   = manualSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        const allNotes  = notesSnap.docs.map(d => d.data());

        const generated: Alert[] = [];
        const now = Date.now();
        const threeWeeksAgo = now - (21 * 24 * 60 * 60 * 1000);

        uniqueRoster.forEach((e: any) => {
          const sId  = e.studentId || e.enrollId;
          const sEmail = e.studentEmail?.toLowerCase();
          const name = e.studentName || "Scholar";

          const studentFilter = (arr: any[]) => arr.filter(item => 
             (sId && (item.studentId === sId || item.id?.includes(sId))) || (sEmail && item.studentEmail?.toLowerCase() === sEmail)
          );

          // 1. ATTENDANCE SCAN ───────────────────────────
          const sAtt = studentFilter(allAtt);
          const recentAtt = sAtt.filter((a: any) => {
             const d = a.date instanceof Timestamp ? a.date.toMillis() : (typeof a.date === 'string' ? new Date(a.date).getTime() : 0);
             return d > threeWeeksAgo;
          });

          if (recentAtt.length >= 2) {
            const absences = recentAtt.filter((a: any) => a.status === "absent").length;
            const lates = recentAtt.filter((a: any) => a.status === "late").length;
            const rate = ((recentAtt.length - absences) / recentAtt.length) * 100;
            if (rate < 85 || absences >= 1) {
              generated.push({
                id: `att_${sId}`, studentId: sId, name,
                initials: name.substring(0, 2).toUpperCase(),
                avatarColor: getAvatarColor(name),
                severity: rate < 60 ? "Critical" : "High Priority",
                type: "Attendance",
                issue: `Attendance dropped to ${rate.toFixed(0)}% — ${absences} absences detected`,
                details: [`Registry analysis: 21-day window`, `Late arrivals: ${lates}`, `Liaison required`],
                cls: e.className || "Subdivision", isSystem: true,
              });
            }
          }

          // 2. ACADEMIC MERIT SCAN ───────────────────────
          const sScores = [...studentFilter(allTS), ...studentFilter(allGB), ...studentFilter(allResults)];
          if (sScores.length >= 1) {
             const sorted = sScores.sort((a,b) => (a.timestamp?.toMillis?.() || a.date?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || b.date?.toMillis?.() || 0));
             const getPct = (sc: any) => Number(sc.percentage ?? (sc.mark/sc.maxMarks*100) ?? (sc.score/sc.maxScore*100) ?? sc.score ?? 0);
             
             const recent3 = sorted.slice(-3).map(getPct).filter(v => v >= 0);
             const past3 = sorted.slice(-6, -3).map(getPct).filter(v => v >= 0);

             const recentAvg = recent3.length > 0 ? (recent3.reduce((a,b)=>a+b,0) / recent3.length) : 0;
             const pastAvg = past3.length > 0 ? (past3.reduce((a,b)=>a+b,0) / past3.length) : recentAvg;
             const drop = pastAvg - recentAvg;

             if (recentAvg < 70 || drop > 5) {
                generated.push({
                  id: `grd_${sId}`, studentId: sId, name,
                  initials: name.substring(0, 2).toUpperCase(),
                  avatarColor: getAvatarColor(name),
                  severity: drop > 20 || recentAvg < 50 ? "Critical" : "High Priority",
                  type: "Grades",
                  issue: drop > 5 ? `Scholastic decay detected: average dropped ${drop.toFixed(0)}% to ${recentAvg.toFixed(0)}%` : `Performance index at ${recentAvg.toFixed(0)}% — below benchmark`,
                  details: [`Sample size: ${sScores.length} evaluations`, `Trend: ${drop > 0 ? 'Negative' : 'Stable'}`, `At risk of scholastic stagnation`],
                  cls: e.className || "Subdivision", isSystem: true,
                  trend: drop > 0 ? "declining" : "stable"
                });
             }
          }

          // 3. WORKFLOW SUBMISSION SCAN ───────────────────
          const sSubs = studentFilter(allSubs);
          const subSet = new Set(sSubs.map((s: any) => s.assignmentId));
          const missed = allAssign.filter((a: any) => {
            const due = a.dueDate?.toMillis?.() || (typeof a.dueDate === 'string' ? new Date(a.dueDate).getTime() : Number(a.dueDate)) || 0;
            return due > 0 && due < now && !subSet.has(a.id);
          });

          if (missed.length >= 1) {
            generated.push({
              id: `sub_${sId}`, studentId: sId, name,
              initials: name.substring(0, 2).toUpperCase(),
              avatarColor: getAvatarColor(name),
              severity: missed.length >= 4 ? "Critical" : "High Priority",
              type: "Submissions",
              issue: `Disrupted workflow: ${missed.length} pending submissions detected`,
              details: [`Overdue items: ${missed.slice(0,2).map(m=>m.title).join(', ')}`, `Registry Status: Suspended Activity`],
              cls: e.className || "Subdivision", isSystem: true,
            });
          }

          // 4. BEHAVIORAL SIGNAL SCAN ─────────────────────
          const sNotes = studentFilter(allNotes);
          const negSignals = sNotes.filter((n: any) => {
             const text = (n.content || "").toLowerCase();
             return text.includes("aggressive") || text.includes("bully") || text.includes("distraction") || text.includes("refused") || text.includes("sick") || text.includes("trouble");
          });

          if (negSignals.length > 0) {
             generated.push({
               id: `beh_${sId}`, studentId: sId, name,
               initials: name.substring(0, 2).toUpperCase(),
               avatarColor: getAvatarColor(name),
               severity: negSignals.length >= 3 ? "Critical" : "High Priority",
               type: "Behavior",
               issue: `Behavioral Manifestation: ${negSignals.length} negative signals detected in discourse`,
               details: [`Indicators: ${negSignals[0].content.substring(0,30)}...`, `Source: Parent-Teacher Liaison`],
               cls: e.className || "Subdivision", isSystem: true,
             });
          }
        });

        // MANUAL TAGS
        manuals.filter((r: any) => !r.resolved).forEach((r: any) => {
          if (!generated.find(a => a.id === r.id)) {
            generated.push({
              id: r.id, studentId: r.studentId, name: r.studentName || "Scholar",
              initials: r.studentName?.substring(0, 2).toUpperCase() || "SC",
              avatarColor: getAvatarColor(r.studentName),
              severity: r.severity || "Medium Priority",
              type: r.type || "Behavior",
              issue: r.issue || "Manual behavioral alert",
              details: r.details || ["Counseling protocol initiated"],
              cls: r.className || "Subdivision", isSystem: false,
            });
          }
        });

        const order: Record<string, number> = { Critical: 0, "High Priority": 1, "Medium Priority": 2 };
        generated.sort((a, b) => order[a.severity] - order[b.severity]);
        setAlerts(generated);
      } catch (err) {
        console.error(err);
        toast.error("Institutional node de-sync.");
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [teacherData?.id]);

  const handleResolve = async (a: Alert) => {
    if (a.isSystem) { toast.info("Neural Sync: Clears automatically upon merit improvement."); return; }
    setResolving(a.id);
    try {
      await updateDoc(doc(db, "risks", a.id), { resolved: true });
      setAlerts(prev => prev.filter(x => x.id !== a.id));
      toast.success("Anomaly archived.");
    } catch { toast.error("Database failure."); }
    finally { setResolving(null); }
  };

  const fetchContact = async (sId: string, sName: string) => {
    setFetchingContact(true);
    try {
      const q = query(collection(db, "enrollments"), where("studentId", "==", sId));
      const snap = await getDocs(q);
      let phone = "+91 98765 43210", parent = "Parent/Guardian";
      if (!snap.empty) {
         const d = snap.docs[0].data();
         phone = d.parentPhone || d.phone || phone;
         parent = d.parentName || `Liaison for ${sName}`;
      }
      setSelectedContact({ name: sName, parent, phone });
    } catch (e) { toast.error("Registry fetch error."); } finally { setFetchingContact(false); }
  };

  const TABS = ["All Alerts", "Attendance", "Grades", "Submissions", "Behavior"];
  const stats = {
     critical: alerts.filter(a => a.severity === "Critical").length,
     high:     alerts.filter(a => a.severity === "High Priority").length,
     medium:   alerts.filter(a => a.severity === "Medium Priority").length,
     resolved: 14 
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-24 text-left font-sans">
      <div className="flex flex-col md:flex-row items-center justify-between gap-12">
         <div className="text-left">
            <h1 className="text-6xl font-black text-slate-900 tracking-tighter uppercase italic leading-none mb-4">Risks & Alerts</h1>
            <p className="text-lg font-bold text-slate-400">Institutional diagnostic hub. Monitoring all scholarly manifests.</p>
         </div>
         <div className="flex items-center gap-6">
            <button className="h-20 px-12 bg-white border border-slate-100 rounded-[2rem] text-[11px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-4 shadow-sm"><Share2 size={24}/> Export Report</button>
            <div className="h-20 w-20 bg-[#1e3a8a] text-white rounded-[2rem] flex items-center justify-center shadow-2xl animate-pulse"><Heart size={32}/></div>
         </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
         <StatCard label="Critical" value={stats.critical} color="rose" icon={AlertTriangle} />
         <StatCard label="High Priority" value={stats.high} color="amber" icon={TrendingDown} />
         <StatCard label="Medium Priority" value={stats.medium} color="indigo" icon={Clock} />
         <StatCard label="Resolved" value={stats.resolved} color="emerald" icon={CheckCircle2} />
      </div>

      <div className="bg-white border border-slate-100 rounded-[4rem] shadow-sm overflow-hidden text-left relative">
         <div className="flex overflow-x-auto border-b border-slate-100 px-12 bg-slate-50/50 scrollbar-hide">
            {TABS.map(t => (
               <button key={t} onClick={() => setActiveTab(t)} className={`px-12 py-10 text-[12px] font-black uppercase tracking-[0.2em] relative transition-all whitespace-nowrap ${activeTab === t ? "text-[#1e3a8a]" : "text-slate-400 hover:text-slate-900"}`}>
                  {t} <span className="ml-2 font-bold text-[#1e3a8a]">{alerts.filter(a => t === "All Alerts" || a.type === t).length}</span>
                  {activeTab === t && <div className="absolute bottom-0 left-12 right-12 h-2 bg-[#1e3a8a] rounded-t-full shadow-lg shadow-blue-500/30" />}
               </button>
            ))}
         </div>

         <div className="divide-y divide-slate-100 min-h-[500px]">
            {loading ? (
               <div className="py-48 flex flex-col items-center justify-center italic opacity-40"><div className="w-24 h-24 border-4 border-[#1e3a8a]/5 border-t-[#1e3a8a] rounded-full animate-spin flex items-center justify-center mb-8"><BrainCircuit className="w-10 h-10 text-[#1e3a8a] animate-pulse" /></div><p className="text-[12px] font-black uppercase tracking-[0.5em]">Establishing Merit Link...</p></div>
            ) : alerts.filter(a => activeTab === "All Alerts" || a.type === activeTab).length === 0 ? (
               <div className="py-48 flex flex-col items-center justify-center opacity-30 italic text-center px-20"><BookOpen size={80} className="mb-10 text-slate-200" /><p className="text-[14px] font-black uppercase tracking-[0.3em] text-slate-400">Registry Manifest: All scholars are currently within stable trajectory indices.</p></div>
            ) : (
               alerts.filter(a => activeTab === "All Alerts" || a.type === activeTab).map(a => (
                  <div key={a.id} className="p-14 hover:bg-slate-50/50 group transition-all flex flex-col xl:flex-row items-baseline xl:items-center gap-12 relative overflow-hidden">
                     <div className={`absolute left-0 top-0 bottom-0 w-3 shadow-xl ${a.severity === 'Critical' ? 'bg-rose-500' : (a.severity === 'High Priority' ? 'bg-amber-500' : 'bg-indigo-500')}`} />
                     <div className={`w-24 h-24 rounded-[3rem] ${a.avatarColor} flex items-center justify-center text-white text-3xl font-black shadow-2xl group-hover:rotate-6 transition-all shrink-0`}>{a.initials}</div>
                     <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-6 flex-wrap mb-5">
                           <h4 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">{a.name}</h4>
                           <span className={`px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm ${SEVERITY_BADGE[a.severity]}`}>{a.severity}</span>
                           <span className="text-[12px] font-black text-slate-300 uppercase tracking-widest">{a.cls}</span>
                        </div>
                        <p className="text-xl font-bold text-slate-600 mb-8 leading-tight">{a.issue}</p>
                        <div className="flex flex-wrap gap-10">
                           {a.details.map((d, i) => (
                              <div key={i} className="flex items-center gap-3 text-[12px] font-black uppercase tracking-widest text-slate-400"><div className="w-2.5 h-2.5 rounded-full bg-slate-100 shadow-inner" /> {d}</div>
                           ))}
                        </div>
                     </div>
                     <div className="flex items-center gap-6 shrink-0 w-full xl:w-auto mt-10 xl:mt-0">
                        <button onClick={() => fetchContact(a.studentId, a.name)} className="flex-1 xl:flex-none h-24 px-14 bg-[#1e3a8a] text-white rounded-[2.5rem] text-[12px] font-black uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-4 shadow-2xl active:scale-95"><Phone size={24}/> Contact Registry</button>
                        <button onClick={() => handleResolve(a)} disabled={resolving === a.id} className="flex-1 xl:flex-none h-24 px-14 bg-white border border-slate-100 text-slate-400 rounded-[2.5rem] text-[12px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-4"><CheckCircle2 size={24}/> {a.isSystem ? 'Auto-Sync' : 'Resolved'}</button>
                     </div>
                  </div>
               ))
            )}
         </div>
      </div>

      {selectedContact && (
         <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-2xl z-[200] flex items-center justify-center p-12 animate-in fade-in duration-500">
            <div className="bg-white rounded-[5.5rem] w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-500 text-left border border-white/20">
               <div className="bg-[#0f172a] p-20 text-white relative">
                  <button onClick={() => setSelectedContact(null)} className="absolute top-16 right-16 p-4 hover:bg-white/10 rounded-full transition-all text-slate-400 hover:text-white"><X size={48}/></button>
                  <h2 className="text-5xl font-black tracking-tighter uppercase italic mb-3">Liaison Portal</h2>
                  <p className="text-indigo-400 text-[12px] font-black uppercase tracking-[0.5em]">Verified Registry Communications</p>
               </div>
               <div className="p-20 space-y-16">
                  <div className="flex items-start gap-12 border-b border-slate-50 pb-16">
                     <div className="w-28 h-28 bg-slate-50 rounded-[4rem] flex items-center justify-center border border-slate-100 shrink-0"><User size={56} className="text-slate-300"/></div>
                     <div><p className="text-[12px] font-black text-slate-300 uppercase tracking-widest mb-4">Subject Manifest</p><h3 className="text-5xl font-black text-slate-900 tracking-tighter mb-2">{selectedContact.name}</h3><p className="text-2xl font-bold text-slate-400 uppercase tracking-tighter italic">{selectedContact.parent}</p></div>
                  </div>
                  <div className="flex items-start gap-12">
                     <div className="w-28 h-28 bg-indigo-50 rounded-[4rem] flex items-center justify-center text-[#1e3a8a] text-5xl font-black italic shadow-inner">PH</div>
                     <div><p className="text-[12px] font-black text-slate-300 uppercase tracking-widest mb-4">Liaison Contact Node</p><h3 className="text-6xl font-black text-[#1e3a8a] tracking-tight mb-4">{selectedContact.phone}</h3><div className="flex items-center gap-4"><div className="w-4 h-4 rounded-full bg-emerald-500 animate-pulse" /><p className="text-[14px] font-black text-emerald-600 uppercase tracking-[0.2em]">High-Priority Link Active</p></div></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 pt-10">
                     <button className="h-32 bg-[#1e3a8a] text-white rounded-[3rem] font-black text-[13px] uppercase tracking-widest shadow-[0_35px_60px_-15px_rgba(30,58,138,0.3)] hover:bg-black transition-all flex flex-col items-center justify-center gap-4 group"><Phone size={40} className="group-hover:rotate-12 transition-all"/> Registry Call</button>
                     <button className="h-32 bg-[#25D366] text-white rounded-[3rem] font-black text-[13px] uppercase tracking-widest shadow-[0_35px_60px_-15px_rgba(37,211,102,0.3)] hover:bg-[#128C7E] transition-all flex flex-col items-center justify-center gap-4 group"><MessageCircle size={40} className="group-hover:scale-110 transition-all"/> WhatsApp Link</button>
                  </div>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, color, icon: Icon }: any) => {
   const variants: any = {
      rose:    "border-rose-100 bg-rose-50/10 text-rose-600",
      amber:   "border-amber-100 bg-amber-50/10 text-amber-600",
      indigo:  "border-indigo-100 bg-indigo-50/10 text-indigo-600",
      emerald: "border-emerald-100 bg-emerald-50/10 text-emerald-600",
   };
   return (
      <div className={`p-14 rounded-[5rem] border ${variants[color]} flex items-center justify-between shadow-sm hover:shadow-2xl hover:-translate-y-5 transition-all group bg-white`}>
         <div><p className="text-[12px] font-black uppercase tracking-[0.5em] opacity-40 mb-4">{label}</p><h4 className="text-8xl font-black tracking-tighter leading-none">{value}</h4></div>
         <div className={`w-24 h-24 rounded-[3.5rem] bg-white flex items-center justify-center shadow-inner group-hover:rotate-12 transition-all`}><Icon size={48} /></div>
      </div>
   );
};

const BrainCircuit = ({ ...props }) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4.5V2" /><path d="M11 20H8" /><path d="M11 20v2" /><path d="M16 20h3" /><path d="M16 20v2" /><path d="M12 21v-1" /><path d="M8 12h.01" /><path d="M16 12h.01" /><path d="M12 16h.01" /><path d="M12 8h.01" /><path d="M12 12h.01" /><path d="M16 8h.01" /><path d="M8 8h.01" /><path d="M8 16h.01" /><path d="M16 16h.01" /><circle cx="12" cy="12" r="10" />
  </svg>
);

export default RisksAlerts;
