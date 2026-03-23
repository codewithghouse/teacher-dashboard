import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, limit, getDocs } from 'firebase/firestore';
import { AIController } from '../ai/controller/ai-controller';
import { Loader2, ShieldAlert, Sparkles, LayoutList, BellRing, TrendingUp, AlertCircle, Calendar } from 'lucide-react';

const Dashboard = () => {
  const { teacherData, user } = useAuth();
  
  const [dataExists, setDataExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiData, setAiData] = useState<any>(null);
  const [placeholderMessage, setPlaceholderMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardInsights = async () => {
      try {
        // Real check: Does this teacher have any classes or students?
        if (!teacherData?.id) return;
        const classesSnap = await getDocs(query(collection(db, "classes"), where("teacherId", "==", teacherData.id), limit(1)));
        const studentsSnap = await getDocs(query(collection(db, "students"), where("teacherId", "==", teacherData.id), limit(1)));
        
        const hasData = !classesSnap.empty && !studentsSnap.empty;
        setDataExists(hasData);

        if (!hasData) {
           setPlaceholderMessage("After you add your class schedule and student roster, these AI features will start working automatically.");
           setLoading(false);
           return;
        }

        // If data exists, fetch the real dashboard insights
        // For now, we pass the basic context
        const context = {
          teacher_name: teacherData?.name || user?.displayName,
          class_count: classesSnap.size,
          student_count: studentsSnap.size,
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Teacher Intelligence Dashboard</h1>
          <p className="text-sm font-medium text-muted-foreground mt-1">Welcome back, {teacherData?.name || user?.displayName?.split(' ')[0] || "Teacher"}!</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-5 py-2.5 bg-card border border-border rounded-xl text-sm font-black text-[#1e3a8a] shadow-sm flex items-center gap-2">
            <Calendar className="w-4 h-4"/> {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
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
               <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Class Insights Found</p>
             </div>

             <div className="bg-card border border-border rounded-2xl p-6 shadow-sm relative overflow-hidden group">
               <div className="absolute right-0 top-0 w-16 h-16 bg-red-500 rounded-bl-full opacity-10 group-hover:opacity-20 transition-opacity"/>
               <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
                     <AlertCircle className="w-5 h-5 text-red-600 animate-pulse"/>
                  </div>
               </div>
               <h2 className="text-3xl font-black text-red-600 mb-1">{aiData?.smart_notifications?.length || 0}</h2>
               <p className="text-sm font-bold text-red-500 uppercase tracking-widest">Urgent Smart Alerts</p>
             </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            
            {/* FEATURE 1: AI Daily Planner */}
            <div className="lg:col-span-2 bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
               <div className="px-7 py-5 border-b border-border bg-slate-50 flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#1e3a8a]"/> AI Daily Planner</h3>
               </div>
               <div className="divide-y divide-border flex-1">
                  {aiData?.ai_daily_planner?.map((plan: any, i: number) => (
                     <div key={i} className="px-7 py-5 hover:bg-slate-50 transition-colors flex items-start gap-4">
                        <div className="w-16 shrink-0 pt-0.5">
                           <p className="text-xs font-black text-[#1e3a8a]">{plan.time}</p>
                           <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1 mr-2 px-1 bg-white border border-slate-200 rounded">{plan.class_name}</p>
                        </div>
                        <div className="flex-1 bg-blue-50/50 border border-blue-100 rounded-xl p-4">
                           <p className="text-sm text-slate-700 font-medium leading-relaxed italic">{plan.plan}</p>
                        </div>
                     </div>
                  ))}
                  {(!aiData?.ai_daily_planner || aiData.ai_daily_planner.length === 0) && (
                     <div className="p-8 text-center"><p className="text-sm font-medium text-slate-400">No scheduled periods available.</p></div>
                  )}
               </div>
            </div>

            {/* FEATURE 3: Smart Notifications */}
            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
               <div className="px-7 py-5 border-b border-red-100 bg-red-50 flex items-center justify-between">
                  <h3 className="text-base font-bold text-red-900 flex items-center gap-2"><BellRing className="w-4 h-4 text-red-500 animate-pulse"/> Smart Notifications</h3>
               </div>
               <div className="divide-y divide-border flex-1">
                  {aiData?.smart_notifications?.map((notif: any, i: number) => {
                     const isCrit = notif.priority?.toUpperCase() === 'CRITICAL' || notif.priority?.toUpperCase() === 'HIGH';
                     return (
                        <div key={i} className="px-7 py-5 hover:bg-red-50/30 transition-colors">
                           <div className="flex items-center gap-2 mb-2">
                             <div className={`w-2 h-2 rounded-full ${isCrit ? 'bg-red-500 animate-ping' : 'bg-amber-500'}`} />
                             <span className={`text-[10px] font-black uppercase tracking-widest ${isCrit ? 'text-red-600' : 'text-amber-600'}`}>{notif.priority} Priority</span>
                           </div>
                           <p className="text-sm font-bold text-slate-800 mb-3">{notif.message}</p>
                           <button className={`w-full py-2.5 rounded-lg text-xs font-bold shadow-sm transition-colors ${
                             isCrit ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-card border border-border hover:bg-secondary text-foreground'
                           }`}>
                             {notif.action_required}
                           </button>
                        </div>
                     )
                  })}
               </div>
            </div>

          </div>

          {/* FEATURE 2: Class Performance Summary */}
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow mt-6">
             <div className="px-7 py-5 border-b border-border flex items-center gap-2">
                 <TrendingUp className="w-5 h-5 text-green-600" />
                 <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Class Performance Intelligence</h3>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
                {aiData?.class_performance_summary?.map((perf: any, i: number) => (
                   <div key={i} className="p-7">
                      <div className="flex items-center gap-2 mb-3">
                         <span className="text-[11px] font-black tracking-widest bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-lg uppercase">{perf.class}</span>
                         <span className="text-[11px] font-black tracking-widest bg-slate-100 text-slate-500 px-2.5 py-1 rounded-lg uppercase border border-slate-200">{perf.subject}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-600 leading-relaxed border-l-2 border-green-400 pl-4">{perf.summary}</p>
                   </div>
                ))}
             </div>
          </div>
          
        </>
      )}

    </div>
  );
};

export default Dashboard;
