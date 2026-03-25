import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, getDocs, limit } from 'firebase/firestore';
import { 
  Loader2, Users, Activity, TrendingUp, AlertCircle, 
  Calendar, Clock, CheckCircle, FileText, Bell, 
  Layout, GraduationCap, ClipboardCheck, MessageSquare, Sparkles, BrainCircuit
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AIController } from '../ai/controller/ai-controller';

const Dashboard = () => {
  const { teacherData } = useAuth();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    attendanceRate: "0%",
    pendingGrading: 0,
    atRiskCount: 0,
    classesToday: 0
  });

  const [todayClasses, setTodayClasses] = useState<any[]>([]);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [needingAttention, setNeedingAttention] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!teacherData?.id) return;

    // 1. LIVE CLASSES
    const qClasses = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsubClasses = onSnapshot(qClasses, (snap) => {
      const clsData = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setTodayClasses(clsData);
      setStats(prev => ({ ...prev, classesToday: clsData.length }));

      // 2. LIVE ATTENDANCE TASKS
      const todayString = new Date().toISOString().split('T')[0];
      const qAtndToday = query(collection(db, "attendance"), where("teacherId", "==", teacherData.id), where("date", "==", todayString));
      
      const unsubAtndToday = onSnapshot(qAtndToday, (atndSnap) => {
          const markedClassIds = new Set(atndSnap.docs.map(d => d.data().classId));
          const unmarked = clsData.filter(c => !markedClassIds.has(c.id));
          
          setPendingTasks(prev => {
             const others = prev.filter(t => t.id !== 'mark_atnd');
             if (unmarked.length > 0) {
                return [
                   ...others,
                   {
                      id: 'mark_atnd',
                      title: 'Mark Attendance',
                      desc: `${unmarked[0].name} • Pending Registry`,
                      icon: ClipboardCheck,
                      color: 'bg-amber-500',
                      count: unmarked.length,
                      actionPath: '/attendance'
                   }
                ];
             }
             return others;
          });
      });
    });

    // 3. LIVE PENDING GRADING
    const qPending = query(collection(db, "submissions"), where("teacherId", "==", teacherData.id), where("status", "==", "pending"));
    const unsubPending = onSnapshot(qPending, (snap) => {
      setStats(prev => ({ ...prev, pendingGrading: snap.size }));
      setPendingTasks(prev => {
         const others = prev.filter(t => t.id !== 'grade_papers');
         if (snap.size > 0) {
            return [
               ...others,
               {
                  id: 'grade_papers',
                  title: 'Review Assignments',
                  desc: `${snap.size} real submissions pending`,
                  count: snap.size,
                  icon: FileText,
                  color: 'bg-indigo-500',
                  actionPath: '/gradebook'
               }
            ];
         }
         return others;
      });
    });

    // 4. SMART STUDENT MONITOR (Manual + AI Analysis)
    const qEnrol = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    const unsubEnrol = onSnapshot(qEnrol, async (snap) => {
       const students = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
       
       // Algorithm: Start with manual At-Risk students
       let critical = students.filter(s => s.manualStatus === "At Risk").slice(0, 4);
       
       // AI Fallback Phase
       if (critical.length < 3 && students.length > 0) {
          try {
             const resSnap = await getDocs(query(collection(db, "results"), where("teacherId", "==", teacherData.id), limit(20)));
             const results = resSnap.docs.map(d => d.data());
             
             // Simple AI-like logic if no manual tags: Find students with avg < 60
             const lowPerf = students.filter(s => {
                const sResults = results.filter(r => r.studentId === s.studentId);
                const avg = sResults.length > 0 ? (sResults.reduce((acc, curr) => acc + (curr.score || 0), 0) / sResults.length) : 100;
                return avg < 65 && !critical.find(c => c.id === s.id);
             }).slice(0, 4 - critical.length);
             
             critical = [...critical, ...lowPerf];
          } catch (e) { console.error("AI Fallback failed:", e); }
       }

       setStats(prev => ({ ...prev, atRiskCount: critical.length || 0 }));
       setNeedingAttention(critical.map(s => ({
          id: s.id,
          name: s.studentName || "Scholar",
          initials: (s.studentName?.[0] || 'S'),
          reason: s.manualStatus === "At Risk" ? "Priority Academic Concern" : "Automated Performance Alert",
          action: "Intervene",
          color: "bg-rose-500",
          actionPath: '/parent-notes',
          isAiIdentified: s.manualStatus !== "At Risk"
       })));
    });

    // 5. ATTENDANCE RATE AGGREGATE
    const qAtndRate = query(collection(db, "attendance"), where("teacherId", "==", teacherData.id));
    const unsubAtndRate = onSnapshot(qAtndRate, (snap) => {
       const docs = snap.docs;
       if (docs.length === 0) {
          setStats(prev => ({ ...prev, attendanceRate: "100%" }));
       } else {
          const present = docs.filter(d => d.data().status === 'present').length;
          setStats(prev => ({ ...prev, attendanceRate: `${((present / docs.length) * 100).toFixed(1)}%` }));
       }
    });

    setLoading(false);
    return () => {
      unsubClasses();
      unsubPending();
      unsubEnrol();
      unsubAtndRate();
    };
  }, [teacherData?.id]);

  if (loading) return (
     <div className="h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="relative">
           <div className="w-20 h-20 border-4 border-[#1e3a8a]/20 border-t-[#1e3a8a] rounded-full animate-spin"></div>
           <div className="absolute inset-0 flex items-center justify-center"><BrainCircuit className="w-8 h-8 text-[#1e3a8a] animate-pulse"/></div>
        </div>
        <p className="mt-8 text-[11px] font-black text-slate-400 uppercase tracking-[0.5em] animate-pulse">Engaging Neural Registry...</p>
     </div>
  );

  return (
    <div className="min-h-screen animate-in fade-in slide-in-from-bottom-10 duration-1000 pb-24 text-left font-sans">
      
      {/* ─── HEADER SYSTEM ─── */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-16 px-2">
        <div className="text-left w-full md:w-auto">
           <div className="flex items-center gap-3 mb-5">
              <Sparkles className="w-5 h-5 text-indigo-500 animate-pulse" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Integrated Intelligence Matrix</p>
           </div>
           <h1 className="text-6xl font-black text-slate-900 tracking-tighter leading-none mb-5">Insight Hub</h1>
           <p className="text-lg font-bold text-slate-400">Database synchronization active for subdivision <span className="text-[#1e3a8a] uppercase">{teacherData?.name}</span></p>
        </div>
        
        <div className="flex items-center gap-6 w-full md:w-auto">
           <div className="flex-1 md:flex-none px-12 h-20 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm flex items-center justify-center gap-5 text-base font-black text-slate-700">
              <Calendar className="w-6 h-6 text-[#1e3a8a]"/>
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              <span className="text-slate-200">|</span>
              {currentTime.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
           </div>
           <button className="w-20 h-20 bg-[#1e3a8a] rounded-[2.5rem] flex items-center justify-center text-white relative shadow-2xl shadow-blue-900/40 hover:scale-110 active:scale-95 transition-all">
              <Bell className="w-8 h-8"/>
              <div className="absolute top-5 right-5 w-4 h-4 bg-rose-500 rounded-full border-4 border-[#1e3a8a]" />
           </button>
        </div>
      </div>

      {/* ─── KEY PERFORMANCE INDICATORS ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-20">
         <StatItem label="Avg Attendance" value={stats.attendanceRate} icon={Activity} color="emerald" tag="Stable" />
         <StatItem label="Pending Grading" value={stats.pendingGrading} icon={FileText} color="amber" tag={stats.pendingGrading > 0 ? "Action Required" : "Clean"} />
         <StatItem label="Academic Risk" value={stats.atRiskCount} icon={AlertCircle} color="rose" tag="Critical" />
         <StatItem label="Classes Today" value={stats.classesToday} icon={Users} color="indigo" tag="Live" />
      </div>

      {/* ─── GRID CONTENT ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
         
         {/* COLUMN 1: SESSIONS */}
         <div className="lg:col-span-4 space-y-10 text-left">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.4em] mb-8 flex items-center gap-3 pl-4 border-l-4 border-slate-200">Daily Session Log</h3>
            <div className="space-y-6">
               {todayClasses.length === 0 ? (
                  <EmptyState icon={Clock} text="Registry is currently silent. No active subdivisions." />
               ) : (
                  todayClasses.map((cls, i) => (
                    <div key={cls.id} className="bg-white border border-slate-100 p-8 rounded-[3rem] shadow-sm hover:shadow-2xl hover:-translate-x-3 transition-all group flex items-center gap-8 cursor-pointer relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#1e3a8a]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="text-center relative z-10 min-w-[60px]">
                           <p className="text-2xl font-black text-slate-800 tracking-tighter leading-none">{i === 0 ? '09:00' : (i === 1 ? '11:30' : '02:00')}</p>
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Log Point</p>
                        </div>
                        <div className="w-1.5 h-14 bg-[#1e3a8a] rounded-full relative z-10" />
                        <div className="flex-1 min-w-0 relative z-10">
                           <h4 className="text-xl font-black text-slate-800 truncate mb-1">{cls.name}</h4>
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{cls.grade} • {cls.subject}</p>
                        </div>
                        {i === 0 && <div className="px-5 py-2 rounded-full bg-[#1e3a8a] text-white text-[9px] font-black uppercase tracking-[0.2em] animate-pulse">Now</div>}
                    </div>
                  ))
               )}
            </div>
         </div>

         {/* COLUMN 2: WORKFLOWS */}
         <div className="lg:col-span-4 space-y-10 text-left">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.4em] mb-8 flex items-center gap-3 pl-4 border-l-4 border-amber-200 text-amber-600">Pending Workflow Matrix</h3>
            <div className="space-y-6">
               {pendingTasks.length === 0 ? (
                  <EmptyState icon={CheckCircle} text="All institutional tasks are finalized." color="text-emerald-500" />
               ) : (
                  pendingTasks.map(task => (
                    <div key={task.id} onClick={() => navigate(task.actionPath)} className="bg-white border border-slate-100 p-8 rounded-[3rem] shadow-sm hover:shadow-xl transition-all group cursor-pointer flex items-center gap-8 border-b-4 border-b-slate-50">
                        <div className={`w-16 h-16 rounded-[2rem] ${task.color} flex items-center justify-center text-white shadow-2xl transition-all group-hover:rotate-12`}>
                           <task.icon className="w-8 h-8"/>
                        </div>
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center justify-between gap-4 mb-2">
                              <h4 className="text-base font-black text-slate-800 truncate">{task.title}</h4>
                             {task.count > 0 && <span className="w-8 h-8 bg-rose-500 text-white rounded-full text-[11px] font-black flex items-center justify-center border-2 border-white shadow-xl">{task.count}</span>}
                           </div>
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">{task.desc}</p>
                        </div>
                    </div>
                  ))
               )}
            </div>
         </div>

         {/* COLUMN 3: SMART INTERVENTION */}
         <div className="lg:col-span-4 space-y-10 text-left">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.4em] mb-8 flex items-center gap-3 pl-4 border-l-4 border-rose-200 text-rose-600">Smart Health Monitor</h3>
            <div className="bg-white border border-slate-100 p-3 rounded-[4rem] shadow-sm space-y-2 min-h-[450px]">
               {needingAttention.length === 0 ? (
                  <div className="h-[400px] flex flex-col items-center justify-center px-12 text-center opacity-40">
                     <BrainCircuit className="w-16 h-16 text-slate-200 mb-6" />
                     <p className="text-[11px] font-black uppercase text-slate-400 tracking-widest leading-relaxed">System Scan: Performance is within theoretical thresholds.</p>
                  </div>
               ) : (
                  needingAttention.map(student => (
                    <div key={student.id} className="p-8 hover:bg-slate-50 transition-all group flex items-center gap-6 rounded-[3rem]">
                       <div className={`w-16 h-16 rounded-[1.8rem] ${student.color} flex items-center justify-center text-white font-black text-2xl shadow-xl transition-all group-hover:scale-110`}>
                          {student.initials}
                       </div>
                       <div className="flex-1 min-w-0">
                          <h4 className="text-xl font-black text-slate-800 leading-none mb-2">{student.name}</h4>
                          <p className={`text-[10px] font-bold uppercase tracking-tight flex items-center gap-2 ${student.isAiIdentified ? 'text-indigo-500' : 'text-rose-500'}`}>
                             {student.isAiIdentified && <BrainCircuit className="w-3 h-3"/>}
                             {student.reason}
                          </p>
                       </div>
                       <button onClick={() => navigate(student.actionPath)} className="px-6 h-12 bg-[#1e3a8a] text-white rounded-[1.2rem] text-[10px] font-black uppercase tracking-[0.2em] shadow-xl hover:bg-slate-900 transition-all active:scale-95 shrink-0">
                          {student.action}
                       </button>
                    </div>
                  ))
               )}
            </div>
         </div>

      </div>
    </div>
  );
};

const StatItem = ({ label, value, tag, color, icon: Icon }: any) => (
   <div className="bg-white border border-slate-100 p-10 rounded-[3.5rem] shadow-sm hover:shadow-2xl hover:-translate-y-4 transition-all group relative overflow-hidden">
      <div className="flex items-center justify-between mb-10">
         <div className={`w-16 h-16 rounded-[1.8rem] bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-[#1e3a8a] group-hover:text-white transition-all`}>
            <Icon size={32} />
         </div>
         <div className={`px-5 py-2 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border border-slate-50 bg-slate-50 text-slate-400`}>
            {tag}
         </div>
      </div>
      <h2 className={`text-6xl font-black tracking-tighter mb-2 text-slate-900`}>{value}</h2>
      <p className="text-sm font-black text-slate-400 uppercase tracking-[0.3em]">{label}</p>
   </div>
);

const EmptyState = ({ icon: Icon, text, color="text-slate-200" }: any) => (
   <div className="p-24 border-2 border-dashed border-slate-100 rounded-[4rem] bg-white text-center shadow-inner">
      <Icon className={`w-20 h-20 ${color} mx-auto mb-8 opacity-30`} />
      <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] leading-relaxed italic">{text}</p>
   </div>
);

export default Dashboard;
