import React, { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, getDocs, doc, updateDoc, where, getDoc } from "firebase/firestore";
import { AlertTriangle, UserX, GraduationCap, Clock, CheckCircle2, Loader2, Send, MessageSquare, ShieldAlert, Target } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

interface Alert {
  id: string;
  studentId: string;
  name: string;
  initials: string;
  severity: "Critical" | "High Priority" | "Medium Priority";
  type: "Attendance" | "Grades" | "Submissions" | "Behavior";
  issue: string;
  details: string[];
  cls: string;
  resolved?: boolean;
}

const severityColors: Record<string, string> = {
  Critical: "bg-rose-500 text-white shadow-rose-200 shadow-lg",
  "High Priority": "bg-amber-500 text-white shadow-amber-200 shadow-lg",
  "Medium Priority": "bg-blue-600 text-white shadow-blue-200 shadow-lg",
};

const RisksAlerts = () => {
  const { teacherData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activeTab, setActiveTab] = useState("All Alerts");
  const [stats, setStats] = useState({
    critical: 0,
    high: 0,
    medium: 0,
    resolved: 0
  });

  useEffect(() => {
    if (!teacherData?.id) return;

    // 1. Fetch Teacher's Enrollments
    const qEnroll = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    const unsubscribe = onSnapshot(qEnroll, async (snapshot) => {
      const enrolls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 2. Fetch Datasets
      const attSnap = await getDocs(query(collection(db, "attendance"), where("teacherId", "==", teacherData.id)));
      const gradeSnap = await getDocs(collection(db, "grades")); // Grades are global, but we filter by enrollments
      const risksSnap = await getDocs(query(collection(db, "risks"), where("teacherId", "==", teacherData.id)));

      const allAtt = attSnap.docs.map(d => d.data());
      const allGrades = gradeSnap.docs.map(d => d.data());
      const individualRisks = risksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const generatedAlerts: Alert[] = [];

      enrolls.forEach((e: any) => {
        // Attendance Check
        const studentAtt = allAtt.filter((a: any) => a.studentId === (e.studentId || e.id));
        const presentCount = studentAtt.filter((a: any) => a.status === 'present' || a.status === 'late').length;
        const totalCount = studentAtt.length;
        const rate = totalCount > 0 ? (presentCount / totalCount) * 100 : 100;

        if (rate < 75 && totalCount >= 3) {
          generatedAlerts.push({
            id: `att_${e.studentId || e.id}`,
            studentId: e.studentId || e.id,
            name: e.studentName,
            initials: e.studentName?.substring(0, 2).toUpperCase() || "ST",
            severity: rate < 60 ? "Critical" : "High Priority",
            type: "Attendance",
            issue: `Scholarly presence dropped to ${rate.toFixed(1)}% - ${totalCount - presentCount} absences detected.`,
            details: [`Pattern: Last 3 weeks analysis`, `Sync Rate: ${rate.toFixed(1)}%`],
            cls: e.className || "Class Group"
          });
        }

        // Grades Check
        const sGrade: any = allGrades.find((g: any) => g.studentEmail === e.studentEmail || g.studentId === e.studentId);
        if (sGrade) {
           const total = (sGrade.hw1 || 0) + (sGrade.hw2 || 0) + (sGrade.hw3 || 0) + 
                         (sGrade.q1 || 0) + (sGrade.q2 || 0) + (sGrade.ut1 || 0) + 
                         (sGrade.ut2 || 0) + (sGrade.mid || 0) + (sGrade.proj || 0);
           const avg = (total / 330) * 100;
           if (avg < 50) {
              generatedAlerts.push({
                id: `grd_${e.studentId || e.id}`,
                studentId: e.studentId || e.id,
                name: e.studentName,
                initials: e.studentName?.substring(0, 2).toUpperCase() || "ST",
                severity: "Critical",
                type: "Grades",
                issue: `Academic achievement at ${avg.toFixed(1)}% - Falling below neural risk threshold.`,
                details: [`Current Score: ${avg.toFixed(1)}%`, `Mastery Deficit Detected`],
                cls: e.className || "Class Group"
              });
           }
        }
      });

      // Add Individual AI/Manual Risks
      individualRisks.forEach((r: any) => {
        if (!r.resolved) {
          generatedAlerts.push({
             id: r.id,
             studentId: r.studentId,
             name: r.studentName,
             initials: r.studentName?.substring(0, 2).toUpperCase() || "ST",
             severity: r.severity || "High Priority",
             type: r.type || "Behavior",
             issue: r.issue,
             details: r.details || ["Requires Neural Assessment"],
             cls: r.className || "8-A"
          });
        }
      });

      setAlerts(generatedAlerts);
      setStats({
        critical: generatedAlerts.filter(a => a.severity === 'Critical').length,
        high: generatedAlerts.filter(a => a.severity === 'High Priority').length,
        medium: generatedAlerts.filter(a => a.severity === 'Medium Priority').length,
        resolved: (individualRisks as any[]).filter(r => r.resolved).length
      });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [teacherData?.id]);

  const handleResolve = async (alertId: string) => {
    try {
      if (alertId.startsWith('att_') || alertId.startsWith('grd_')) {
        toast.info("Institutional logic dictates this as a system-generated alert. It will resolve as metrics stabilize.");
        return;
      }
      await updateDoc(doc(db, "risks", alertId), { resolved: true });
      toast.success("Risk trace cleared from neural registry.");
    } catch (e) {
      toast.error("Failed to update risk status.");
    }
  };

  const tabs = ["All Alerts", "Attendance", "Grades", "Submissions", "Behavior"];
  const filteredAlerts = alerts.filter(a => activeTab === "All Alerts" || a.type === activeTab);

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div className="text-left">
          <h1 className="text-4xl font-black text-[#1e293b] tracking-tight">Institutional Safeguarding</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
             <ShieldAlert className="w-4 h-4 text-rose-500 animate-pulse"/> AI-Driven Neural Early Warning Diagnostics
          </p>
        </div>
        <button className="bg-slate-950 text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl hover:bg-[#1e3a8a] transition-all flex items-center gap-3 active:scale-95 whitespace-nowrap">
           <ShieldAlert className="w-6 h-6"/> Trigger Global Sweep
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-rose-500 shadow-xl shadow-rose-200 flex items-center justify-center text-white"><AlertTriangle className="w-7 h-7"/></div>
            <div className="text-left">
              <p className="text-3xl font-black text-slate-900 leading-none">{stats.critical}</p>
              <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mt-1">Critical Faults</p>
            </div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-amber-500 shadow-xl shadow-amber-200 flex items-center justify-center text-white"><AlertTriangle className="w-7 h-7"/></div>
            <div className="text-left">
              <p className="text-3xl font-black text-slate-900 leading-none">{stats.high}</p>
              <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mt-1">High Urgency</p>
            </div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 shadow-xl shadow-blue-200 flex items-center justify-center text-white"><Clock className="w-7 h-7"/></div>
            <div className="text-left">
              <p className="text-3xl font-black text-slate-900 leading-none">{stats.medium}</p>
              <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mt-1">Metric Variance</p>
            </div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-emerald-600 shadow-xl shadow-emerald-200 flex items-center justify-center text-white"><CheckCircle2 className="w-7 h-7"/></div>
            <div className="text-left">
              <p className="text-3xl font-black text-slate-900 leading-none">{stats.resolved}</p>
              <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mt-1">Resolved Gaps</p>
            </div>
        </div>
      </div>

      <div className="bg-white border border-slate-50 rounded-[3.5rem] shadow-2xl overflow-hidden mt-12 relative text-left">
        <div className="flex px-12 pt-6 border-b border-slate-50 overflow-x-auto gap-12 bg-slate-50/50 backdrop-blur-md sticky top-0 z-10">
          {tabs.map((t) => (
            <button 
              key={t} 
              onClick={() => setActiveTab(t)}
              className={`px-2 py-6 text-[11px] font-black uppercase tracking-[0.2em] transition-all relative whitespace-nowrap
                ${activeTab === t ? "text-[#1e3a8a]" : "text-slate-300 hover:text-slate-500"}`}
            >
              {t} {t === "All Alerts" ? `(${alerts.length})` : `(${alerts.filter(a => a.type === t).length})`}
              {activeTab === t && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#1e3a8a] rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        <div className="p-12 space-y-8 bg-white min-h-[400px]">
          {loading ? (
             <div className="py-32 flex flex-col items-center justify-center">
                <Loader2 className="w-16 h-16 text-[#1e3a8a] animate-spin mb-8" />
                <p className="text-[11px] font-black text-[#1e3a8a] uppercase tracking-widest">Scanning Registry Metrics...</p>
             </div>
          ) : filteredAlerts.length === 0 ? (
             <div className="py-32 flex flex-col items-center justify-center text-center px-10">
                <div className="w-24 h-24 bg-emerald-50 rounded-[3rem] shadow-inner flex items-center justify-center mb-8">
                   <CheckCircle2 className="w-12 h-12 text-emerald-200" />
                </div>
                <h3 className="text-3xl font-black text-slate-800 tracking-tight uppercase">Registry Stable</h3>
                <p className="text-sm font-bold text-slate-400 uppercase tracking-tight mt-3 italic">All tracked scholars are currently meeting micro-skill and attendance thresholds.</p>
             </div>
          ) : (
            filteredAlerts.map((a) => (
              <div key={a.id} className={`flex flex-col lg:flex-row items-start lg:items-center gap-10 p-10 rounded-[3rem] border bg-white transition-all hover:shadow-2xl group ${a.severity === 'Critical' ? 'border-rose-100/50 hover:border-rose-200 shadow-rose-500/5' : 'border-slate-50 hover:border-blue-100 shadow-blue-500/5'}`}>
                <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center text-white text-base font-black shadow-xl shrink-0 group-hover:scale-110 transition-transform ${a.severity === 'Critical' ? 'bg-rose-500 shadow-rose-200' : a.severity === 'High Priority' ? 'bg-amber-500 shadow-amber-200' : 'bg-blue-600 shadow-blue-200'}`}>
                    {a.initials}
                </div>
                
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-4 mb-4 flex-wrap">
                    <h3 className="font-black text-2xl text-slate-900 tracking-tight group-hover:text-[#1e3a8a] transition-colors">{a.name}</h3>
                    <div className={`text-[9px] font-black px-4 py-2 rounded-full uppercase tracking-widest flex items-center gap-2 ${severityColors[a.severity]}`}>
                        <Target className="w-3 h-3"/> {a.severity}
                    </div>
                    <span className="text-[10px] font-black text-slate-300 bg-slate-50 px-4 py-2 rounded-full uppercase tracking-widest border border-slate-100/50">{a.cls}</span>
                  </div>
                  
                  <p className="text-lg font-black text-slate-700 mb-6 leading-tight pr-10">{a.issue}</p>
                  
                  <div className="flex items-center gap-8 flex-wrap">
                    {a.details.map((d, j) => (
                      <div key={j} className="flex items-center gap-3">
                         <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{d}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-row lg:flex-col items-center justify-end gap-3 shrink-0 w-full lg:w-48 pt-8 lg:pt-0 border-t lg:border-t-0 border-slate-50 mt-4 lg:mt-0">
                    <button className="flex-1 lg:w-full px-8 py-4 bg-slate-950 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-[#1e3a8a] transition-all flex items-center justify-center gap-3">
                        Take Action
                    </button>
                    <button 
                      onClick={() => handleResolve(a.id)}
                      className="flex-1 lg:w-full px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-white border border-slate-100 text-slate-400 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-600 transition-all flex items-center justify-center gap-3"
                    >
                        Resolved
                    </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default RisksAlerts;
