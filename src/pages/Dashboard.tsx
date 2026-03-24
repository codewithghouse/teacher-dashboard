import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, limit, getDocs, where, onSnapshot, orderBy, Unsubscribe } from 'firebase/firestore';
import { AIController } from '../ai/controller/ai-controller';
import { Loader2, ShieldAlert, Sparkles, LayoutList, BellRing, TrendingUp, AlertCircle, Calendar, Info, Clock, CheckCircle, FileText } from 'lucide-react';

const Dashboard = () => {
  const { teacherData, user } = useAuth();
  
  const [dataExists, setDataExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiData, setAiData] = useState<any>(null);
  const [placeholderMessage, setPlaceholderMessage] = useState<string | null>(null);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);

  // 1. Dashboard Insights & Metadata Sync
  useEffect(() => {
    const fetchDashboardInsights = async () => {
      try {
        if (!teacherData?.id) return;
        const classesSnap = await getDocs(query(collection(db, "classes"), where("teacherId", "==", teacherData.id), limit(1)));
        const enrollmentsSnap = await getDocs(query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id), limit(1)));
        
        const hasData = !classesSnap.empty && !enrollmentsSnap.empty;
        setDataExists(hasData);

        if (!hasData) {
           setPlaceholderMessage("After you add your class schedule and student roster, these AI features will start working automatically.");
           setLoading(false);
           return;
        }

        const context = {
          teacher_name: teacherData?.name || user?.displayName,
          class_count: classesSnap.size,
          student_count: enrollmentsSnap.size,
          last_updated: new Date().toISOString()
        };

        const result = await AIController.getDashboardInsights(context);
        
        if (result.status === "no_data") {
           setPlaceholderMessage("After you add your class schedule and student roster, these AI features will start working automatically.");
        } else if (result.status === "success" && result.data) {
           setAiData(result.data);
           setPlaceholderMessage(null);
        } else {
           setPlaceholderMessage(result.message || "Error analyzing insights.");
        }
      } catch(e) {
        console.error("Dashboard fetch error:", e);
        setPlaceholderMessage("AI system is waking up. Please add your first class to begin.");
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardInsights();
  }, [teacherData, user]);

  // 2. Real-time Activity Log (Submissions & Results)
  useEffect(() => {
    if (!teacherData?.id) return;

    let unsubSubs: Unsubscribe | null = null;
    
    // Step A: Find all assignments by this teacher
    const qAssign = query(collection(db, "assignments"), where("teacherId", "==", teacherData.id));
    
    const unsubAssign = onSnapshot(qAssign, (aSnap) => {
        if (unsubSubs) unsubSubs();
        
        const aIds = aSnap.docs.map(d => d.id);
        if (aIds.length === 0) return;

        // Step B: Watch submissions for these specific assignments
        const qSub = query(collection(db, "submissions"), where("assignmentId", "in", aIds));
        unsubSubs = onSnapshot(qSub, (sSnap) => {
            const subs = sSnap.docs.map(d => ({
                id: d.id,
                type: 'submission',
                title: `${d.data().studentName || "Student"} submitted ${d.data().fileName || "Homework"}`,
                time: d.data().timestamp?.toDate() || new Date(),
                icon: <FileText className="w-4 h-4 text-blue-500" />
            })).sort((a,b) => b.time - a.time);
            setRecentActivities(prev => {
                const resultsOnly = prev.filter(p => p.type === 'result');
                return [...subs, ...resultsOnly].sort((a,b) => b.time - a.time).slice(0, 10);
            });
        });
    });

    // Step C: Watch results published by this teacher
    const qRes = query(collection(db, "results"), where("teacherId", "==", teacherData.id));
    const unsubRes = onSnapshot(qRes, (rSnap) => {
        const results = rSnap.docs.map(d => ({
            id: d.id,
            type: 'result',
            title: `Graded ${d.data().studentName || "Student"}'s ${d.data().assignmentTitle || "Assessment"}`,
            time: d.data().timestamp?.toDate() || new Date(),
            icon: <TrendingUp className="w-4 h-4 text-emerald-500" />
        })).sort((a,b) => b.time - a.time);
        setRecentActivities(prev => {
            const subsOnly = prev.filter(p => p.type === 'submission');
            return [...results, ...subsOnly].sort((a,b) => b.time - a.time).slice(0, 10);
        });
    });

    return () => {
        unsubAssign();
        if (unsubSubs) unsubSubs();
        unsubRes();
    };
  }, [teacherData?.id]);

  const getTimeAgo = (date: Date) => {
    const diff = (new Date().getTime() - date.getTime()) / 1000;
    if (diff < 60) return "Just Now";
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">Institutional Intelligence Hub</h1>
          <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mt-1">Status: Active Monitor • {teacherData?.name || user?.displayName?.split(' ')[0]}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-5 py-2.5 bg-card border border-border rounded-xl text-sm font-black text-[#1e3a8a] shadow-sm flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-600"/> {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 bg-card border border-dashed border-border rounded-3xl mt-10 shadow-sm text-center px-4">
            <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-4" />
            <h2 className="text-base font-bold text-slate-700 mb-2">Engaging Teacher AI Engine...</h2>
            <p className="text-xs text-slate-500 font-medium max-w-sm">Analyzing daily syllabus, compiling performance records, and generating urgent smart alerts.</p>
        </div>
      ) : !dataExists || placeholderMessage ? (
        <div className="flex flex-col items-center justify-center py-24 bg-card border border-dashed border-border rounded-3xl mt-10 shadow-sm relative overflow-hidden px-6 text-center">
            <div className="absolute top-0 right-0 w-64 h-64 bg-slate-50 rounded-full blur-3xl -mr-20 -mt-20 block opacity-50"></div>
            <Sparkles className="w-16 h-16 text-[#1e3a8a] mb-6 relative z-10 animate-pulse" />
            <h2 className="text-xl font-bold text-slate-700 mb-2 relative z-10">AI Features are Ready!</h2>
            <p className="text-sm text-slate-500 font-medium max-w-md relative z-10 leading-relaxed">
              {placeholderMessage || "After you add your class schedule and student roster, these AI features will start working automatically."}
            </p>
            <div className="mt-8 flex gap-4 relative z-10">
               <div className="px-4 py-2 bg-slate-100 rounded-lg text-[10px] font-black uppercase text-slate-400">Step 1: Add Class</div>
               <div className="px-4 py-2 bg-slate-100 rounded-lg text-[10px] font-black uppercase text-slate-400">Step 2: Add Students</div>
            </div>
        </div>
      ) : (
        <>
          {/* Top Level Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
             <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex justify-between items-start mb-4">
                   <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                      <LayoutList className="w-5 h-5 text-blue-600"/>
                   </div>
                </div>
                <h2 className="text-3xl font-black text-foreground mb-1">{aiData?.ai_daily_planner?.length || 0}</h2>
                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Planned Periods Today</p>
             </div>
             
             <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex justify-between items-start mb-4">
                   <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-green-600"/>
                   </div>
                </div>
                <h2 className="text-3xl font-black text-foreground mb-1">{aiData?.class_performance_summary?.length || 0}</h2>
                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Analytics Generated</p>
             </div>

             <div className="bg-card border border-border rounded-2xl p-6 shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 w-16 h-16 bg-red-500 rounded-bl-full opacity-10 group-hover:opacity-20 transition-opacity"/>
                <div className="flex justify-between items-start mb-4">
                   <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-red-600 animate-pulse"/>
                   </div>
                </div>
                <h2 className="text-3xl font-black text-red-600 mb-1">{aiData?.smart_notifications?.length || 0}</h2>
                <p className="text-sm font-bold text-red-500 uppercase tracking-widest">Critical Alerts</p>
             </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
            
            {/* FEATURE 1: AI Daily Planner */}
            <div className="lg:col-span-8 bg-card border border-border rounded-3xl shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
               <div className="px-7 py-5 border-b border-border bg-slate-50 flex items-center justify-between">
                  <h3 className="text-base font-black text-slate-800 flex items-center gap-2 uppercase tracking-widest leading-none"><Sparkles className="w-5 h-5 text-[#1e3a8a]"/> AI Curriculum Roadmap</h3>
                  <span className="text-[10px] font-black text-slate-400 bg-white border border-slate-200 px-3 py-1 rounded-full uppercase tracking-tighter">Live Session planner</span>
               </div>
               <div className="divide-y divide-border flex-1">
                  {aiData?.ai_daily_planner?.map((plan: any, i: number) => (
                     <div key={i} className="px-7 py-5 hover:bg-slate-50 transition-colors flex items-start gap-4">
                        <div className="w-20 shrink-0 pt-0.5">
                           <p className="text-xs font-black text-[#1e3a8a] flex items-center gap-2"><Clock className="w-3.5 h-3.5"/> {plan.time}</p>
                           <p className="text-[9px] uppercase font-black text-slate-500 tracking-widest mt-2 px-2 py-0.5 bg-white border border-slate-200 rounded-lg w-fit">{plan.class_name}</p>
                        </div>
                        <div className="flex-1 bg-blue-50/30 border border-blue-100 rounded-2xl p-5 group hover:bg-white hover:shadow-sm transition-all">
                           <p className="text-sm text-slate-700 font-bold leading-relaxed italic border-l-4 border-blue-500 pl-6">{plan.plan}</p>
                        </div>
                     </div>
                  ))}
                  {(!aiData?.ai_daily_planner || aiData.ai_daily_planner.length === 0) && (
                     <div className="p-12 text-center flex flex-col items-center">
                        <Info className="w-10 h-10 text-slate-200 mb-4" />
                        <p className="text-sm font-black text-slate-300 uppercase tracking-[0.2em]">Institutional logs standby.</p>
                     </div>
                  )}
               </div>
            </div>

            {/* FEATURE 4: NEW - Institutional Event Log (Touchpoints) */}
            <div className="lg:col-span-4 bg-[#1e3a8a] border border-[#1e3a8a] rounded-3xl shadow-sm overflow-hidden flex flex-col hover:shadow-xl transition-all relative group">
               <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-16 -mt-16"></div>
               <div className="px-7 py-6 border-b border-white/10 flex items-center justify-between">
                  <h3 className="text-sm font-black text-white flex items-center gap-2 uppercase tracking-widest"><TrendingUp className="w-5 h-5 text-emerald-400"/> Audit Stream</h3>
                  <span className="text-[9px] font-black bg-white/10 text-white px-3 py-1 rounded-full border border-white/10">LIVE DATA</span>
               </div>
               <div className="flex-1 p-6 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                  {recentActivities.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-20">
                        <Clock className="w-10 h-10 text-white mb-4 animate-pulse" />
                        <p className="text-[10px] font-black text-white uppercase tracking-widest">Awaiting student artifacts...</p>
                    </div>
                  ) : (
                    recentActivities.map((act) => (
                      <div key={act.id} className="bg-white/5 border border-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all group/item">
                         <div className="flex items-start gap-4">
                            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0 border border-white/5 group-hover/item:scale-110 transition-transform">
                               {act.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                               <p className="text-[13px] font-black text-white leading-tight mb-1">{act.title}</p>
                               <p className="text-[10px] font-black text-blue-300/60 uppercase tracking-widest flex items-center gap-1.5 mt-2">
                                  <Clock className="w-3 h-3" /> {getTimeAgo(act.time)}
                               </p>
                            </div>
                         </div>
                      </div>
                    ))
                  )}
               </div>
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
             {/* FEATURE 2: Class Performance Summary (Half Width) */}
              <div className="lg:col-span-7 bg-white border border-border rounded-3xl shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                 <div className="px-7 py-5 border-b border-border bg-emerald-50/50 flex items-center gap-3">
                     <TrendingUp className="w-5 h-5 text-emerald-600" />
                     <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Class Mastery Analytics</h3>
                 </div>
                 <div className="divide-y divide-border">
                    {aiData?.class_performance_summary?.map((perf: any, i: number) => (
                       <div key={i} className="p-7 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center gap-3 mb-4">
                             <span className="text-[10px] font-black tracking-widest bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full uppercase border border-emerald-200">{perf.class}</span>
                             <span className="text-[10px] font-black tracking-widest bg-slate-100 text-slate-500 px-3 py-1 rounded-full uppercase border border-slate-200">{perf.subject}</span>
                          </div>
                          <p className="text-sm font-bold text-slate-600 leading-relaxed border-l-4 border-emerald-400 pl-6 italic">{perf.summary}</p>
                       </div>
                    ))}
                 </div>
              </div>

              {/* FEATURE 3: Smart Notifications (Remaining Width) */}
              <div className="lg:col-span-5 bg-card border border-border rounded-3xl shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                 <div className="px-7 py-5 border-b border-red-100 bg-red-50/50 flex items-center justify-between">
                    <h3 className="text-sm font-black text-red-900 flex items-center gap-3 uppercase tracking-widest leading-none"><BellRing className="w-5 h-5 text-red-500 animate-pulse"/> Priority Sync Alerts</h3>
                 </div>
                 <div className="divide-y divide-border flex-1">
                    {aiData?.smart_notifications?.map((notif: any, i: number) => {
                       const isCrit = notif.priority?.toUpperCase() === 'CRITICAL' || notif.priority?.toUpperCase() === 'HIGH';
                       return (
                          <div key={i} className="px-7 py-6 hover:bg-red-50/30 transition-colors">
                             <div className="flex items-center gap-3 mb-3">
                               <div className={`w-2 h-2 rounded-full ${isCrit ? 'bg-red-500 animate-ping' : 'bg-amber-500'}`} />
                               <span className={`text-[10px] font-black uppercase tracking-widest ${isCrit ? 'text-red-600' : 'text-amber-600'}`}>{notif.priority} Priority Vector</span>
                             </div>
                             <p className="text-sm font-bold text-slate-800 mb-5 leading-tight">{notif.message}</p>
                             <button className={`w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl transition-all active:scale-95 ${
                               isCrit ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-200' : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700'
                             }`}>
                               {notif.action_required}
                             </button>
                          </div>
                       )
                    })}
                 </div>
              </div>
          </div>
          
        </>
      )}

    </div>
  );
};

export default Dashboard;
