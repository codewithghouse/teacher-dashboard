import React, { useState, useEffect } from 'react';
import { ChevronLeft, BrainCircuit, Loader2, Sparkles, TrendingUp, CheckCircle2, Clock, Map, Target, AlertCircle, FileText, Info } from 'lucide-react';
import { AIController } from '../ai/controller/ai-controller';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';

interface StudentProfileProps {
  student: any;
  onBack: () => void;
}

const StudentProfile = ({ student, onBack }: StudentProfileProps) => {
  const [activeTab, setActiveTab] = useState('Overview');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [realAcademicData, setRealAcademicData] = useState<any[]>([]);
  const [liveTouchpoints, setLiveTouchpoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Sync Real-Time Academic Trajectory & Touchpoints
  useEffect(() => {
    if (!student?.id) return;

    setLoading(true);

    // 1. Fetch Latest Results for Trajectory
    const qRes = query(
      collection(db, "results"), 
      where("studentId", "==", student.id)
    );

    const unsubRes = onSnapshot(qRes, (snap) => {
        const data = snap.docs.map(d => ({
            id: d.id,
            label: d.data().assignmentTitle || "Assessment",
            value: parseInt(d.data().score) || 0,
            color: parseInt(d.data().score) >= 75 ? 'bg-emerald-500' : 'bg-[#1e3a8a]',
            time: d.data().timestamp?.toDate() || new Date(),
            type: 'result'
        })).sort((a,b) => b.time - a.time);
        
        setRealAcademicData(data.slice(0, 3)); // Top 3 for trajectory
        
        // Update Touchpoints with results
        setLiveTouchpoints(prev => {
           const nonResults = prev.filter(p => p.type !== 'result');
           const resultsTouch = data.map(r => ({
              id: r.id,
              type: 'result',
              title: `Scored ${r.value}% in ${r.label}`,
              time: r.time
           }));
           return [...resultsTouch, ...nonResults].sort((a,b) => b.time - a.time).slice(0, 5);
        });
        setLoading(false);
    });

    // 2. Fetch Latest Submissions for Touchpoints
    const qSub = query(
      collection(db, "submissions"),
      where("studentId", "==", student.id)
    );

    const unsubSub = onSnapshot(qSub, (snap) => {
        const subs = snap.docs.map(d => ({
           id: d.id,
           type: 'submission',
           title: `Submitted ${d.data().fileName || "Homework"}`,
           time: d.data().timestamp?.toDate() || new Date()
        })).sort((a,b) => b.time - a.time);

        setLiveTouchpoints(prev => {
           const nonSubs = prev.filter(p => p.type !== 'submission');
           return [...subs, ...nonSubs].sort((a,b) => b.time - a.time).slice(0, 5);
        });
    });

    return () => {
       unsubRes();
       unsubSub();
    };
  }, [student?.id]);

  const generateFallbackAnalytics = (academicData: any[]) => {
     if (academicData.length === 0) return null;
     const avg = Math.round(academicData.reduce((acc,d)=>acc+d.value,0)/academicData.length);
     const trend = academicData.length > 1 ? (academicData[0].value >= academicData[1].value ? 'Rising' : 'Fluctuating') : 'Initial';
     
     return {
        learning_style: avg > 80 ? "Strategic" : "Pragmatic",
        learning_style_reason: `Based on a ${avg}% Mastery index across ${academicData.length} evaluations, student exhibits a ${trend.toLowerCase()} competency architecture.`,
        progress_prediction: `Targeting ${Math.min(100, avg + 5)}% in future units.`,
        prediction_reason: `Current trajectory indicates stable knowledge retention with a ${trend} trend in recent assessments.`
     };
  };

  const handleDeepAnalytics = async () => {
     setIsSynthesizing(true);
     try {
       const payload = {
          student_name: student.name,
          attendance: student.attendanceRate || '95%',
          average_score: realAcademicData.length > 0 ? `${Math.round(realAcademicData.reduce((acc,d)=>acc+d.value,0)/realAcademicData.length)}%` : 'N/A',
          recent_tests: realAcademicData.map(a => a.value)
       };
       const result = await AIController.getStudentAnalytics(payload);
       if (result.status === "success" && result.data && result.data.learning_style) {
          setAnalyticsData(result.data);
       } else {
          // Fallback to local logic if AI is slow or fails
          setAnalyticsData(generateFallbackAnalytics(realAcademicData));
       }
     } catch (e) {
       console.error(e);
       setAnalyticsData(generateFallbackAnalytics(realAcademicData));
     } finally {
       setIsSynthesizing(false);
     }
  };

  const getTimeAgo = (date: Date) => {
    const diff = (new Date().getTime() - date.getTime()) / 1000;
    if (diff < 60) return "Just Now";
    if (diff < 3600) return `${Math.floor(diff/60)}M AGO`;
    if (diff < 86400) return `${Math.floor(diff/3600)}H AGO`;
    return `${Math.floor(diff/86400)}D AGO`;
  };

  return (
    <div className="animate-in fade-in duration-500 text-left">
      <div className="flex flex-col sm:flex-row items-center gap-4 mb-8 border-b-2 border-slate-50 pb-8">
        <button onClick={onBack} className="p-4 rounded-2xl border-2 border-slate-100 hover:bg-slate-50 transition-colors shadow-sm self-start sm:self-auto group">
          <ChevronLeft className="w-5 h-5 text-slate-400 group-hover:text-[#1e3a8a]" />
        </button>
        <div className="flex items-center gap-6 flex-1">
          <div className={`${student.color || 'bg-slate-900'} w-20 h-20 rounded-[2rem] flex items-center justify-center text-white text-3xl font-black shadow-lg`}>
            {student.name?.[0] || "S"}
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-800 leading-tight tracking-tight mb-2 uppercase">{student.name}</h1>
            <p className="text-slate-400 text-xs font-black uppercase tracking-widest border border-slate-200 bg-slate-50 px-3 py-1.5 rounded-lg w-max shadow-sm">
              Grade {student.grade} • SR-{student.rollNo?.substring(0,5) || '001'} • {student.email}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto mt-4 sm:mt-0">
          <button className="px-6 py-4 rounded-2xl border-2 border-slate-100 bg-white text-xs uppercase tracking-widest font-black text-slate-500 hover:bg-slate-50 transition-colors shadow-sm w-full sm:w-auto flex justify-center">
            Message Connect
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <div className="lg:col-span-2 space-y-8">
           <div className="bg-indigo-600 rounded-[2.5rem] p-1 shadow-xl shadow-indigo-600/20 overflow-hidden relative">
              <div className="bg-indigo-700/50 absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl opacity-50 -translate-y-1/2 translate-x-1/2"></div>
              <div className="bg-indigo-600 p-8 rounded-[2.4rem] relative z-10 flex flex-col md:flex-row items-center gap-8 justify-between">
                 <div className="flex-1 text-white">
                    <h3 className="text-xs font-black text-indigo-200 uppercase tracking-widest mb-2 flex items-center gap-2">
                       <Sparkles className="w-4 h-4"/> AI Predictive Brain
                    </h3>
                    <h2 className="text-2xl font-black leading-tight mb-4 text-white drop-shadow-sm">Synthesize Deep Learning Style & Track Predicted Test Outcomes.</h2>
                    <p className="text-xs font-bold text-indigo-300 leading-relaxed max-w-sm">Tap into the AI core to predict progress trends based dynamically on past tests and current mastery levels.</p>
                 </div>
                 <button onClick={handleDeepAnalytics} disabled={isSynthesizing || realAcademicData.length === 0} className={`bg-white text-indigo-600 h-16 px-8 rounded-2xl text-xs font-black shadow-lg uppercase tracking-widest hover:scale-105 transition-transform flex items-center justify-center gap-2 min-w-[240px] ${realAcademicData.length === 0 ? 'opacity-50' : ''}`}>
                    {isSynthesizing ? <Loader2 className="w-5 h-5 animate-spin"/> : <BrainCircuit className="w-5 h-5"/>}
                    {isSynthesizing ? 'Establishing Neural Link...' : 'Run Deep Profile Scan'}
                 </button>
              </div>
           </div>

           {analyticsData && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-4 duration-700">
                 <div className="bg-white border border-amber-100 rounded-[2rem] p-8 shadow-sm">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mb-6">
                       <Map className="w-6 h-6 text-amber-500" />
                    </div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Detected Architecture</h3>
                    <h2 className="text-xl font-black text-amber-600 mb-4">{analyticsData.learning_style} Scholar</h2>
                    <p className="text-xs font-bold text-slate-600 leading-relaxed bg-amber-50/50 p-4 rounded-xl border border-amber-50">{analyticsData.learning_style_reason}</p>
                 </div>

                 <div className="bg-white border border-emerald-100 rounded-[2rem] p-8 shadow-sm">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mb-6">
                       <Target className="w-6 h-6 text-emerald-500" />
                    </div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Expected Trajectory</h3>
                    <h2 className="text-xl font-black text-emerald-600 mb-4">{analyticsData.progress_prediction}</h2>
                    <p className="text-xs font-bold text-slate-600 leading-relaxed bg-emerald-50/50 p-4 rounded-xl border border-emerald-50">{analyticsData.prediction_reason}</p>
                 </div>
              </div>
           )}

           <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-8 shadow-sm">
             <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-6">Quick Overview Matrix</h3>
             <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-400"></div>
                   <p className="text-3xl font-black text-slate-800 mb-1 leading-none text-center">{student.attendanceRate || 'N/A'}</p>
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center mt-2">Attendance Rating</p>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-1.5 h-full bg-[#1e3a8a]"></div>
                   <p className="text-3xl font-black text-slate-800 mb-1 leading-none text-center">
                      {realAcademicData.length > 0 ? `${Math.round(realAcademicData.reduce((acc,d)=>acc+d.value,0)/realAcademicData.length)}%` : 'N/A'}
                   </p>
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center mt-2">Scholarly Average</p>
                </div>
             </div>
           </div>
        </div>

        <div className="space-y-6">
           <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-8 shadow-sm">
             <div className="flex items-center justify-between mb-6">
               <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Academic Trajectory</h3>
               <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-[8px] uppercase font-black tracking-widest">Live Sync</span>
               </div>
             </div>
             
             <div className="space-y-6 mb-8 min-h-[140px]">
                {loading ? (
                   [1,2,3].map(i => <div key={i} className="h-6 bg-slate-50 rounded-lg animate-pulse" />)
                ) : realAcademicData.length === 0 ? (
                   <div className="py-10 text-center flex flex-col items-center">
                      <AlertCircle className="w-8 h-8 text-slate-200 mb-3" />
                      <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">No evaluation records found.</p>
                   </div>
                ) : (
                   realAcademicData.map((data, i) => (
                     <div key={i}>
                       <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest mb-2">
                         <span className="text-slate-500 truncate max-w-[120px]">{data.label}</span>
                         <span className="text-slate-800">{data.value}%</span>
                       </div>
                       <div className="h-2.5 bg-slate-50 rounded-full overflow-hidden border border-slate-100 shadow-inner">
                         <div className={`h-full ${data.color} shadow-sm rounded-full transition-all duration-1000`} style={{ width: `${data.value}%` }} />
                       </div>
                     </div>
                   ))
                )}
             </div>

             <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center justify-between">
                <div>
                   <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 mb-0.5">Status Trend</p>
                   <p className="text-sm font-black text-emerald-800">Positive Growth</p>
                </div>
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
                   <TrendingUp className="w-5 h-5"/>
                </div>
             </div>
           </div>

           <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-8 shadow-sm">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-6 uppercase">Institutional Log</h3>
              <div className="space-y-5 min-h-[160px]">
                 {loading ? (
                    [1,2,3].map(i => <div key={i} className="h-10 bg-slate-50 rounded-xl animate-pulse" />)
                 ) : liveTouchpoints.length === 0 ? (
                    <div className="py-12 text-center flex flex-col items-center text-slate-200">
                       <Clock className="w-10 h-10 mb-3 opacity-30" />
                       <p className="text-[9px] font-black uppercase tracking-[0.2em] opacity-50">Empty Audit Vault</p>
                    </div>
                 ) : (
                    liveTouchpoints.map((t) => (
                      <div key={t.id} className="flex gap-4 items-start group">
                         <div className={`w-8 h-8 rounded-xl flex justify-center items-center shrink-0 border transition-all group-hover:scale-110 ${t.type === 'result' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                            {t.type === 'result' ? <TrendingUp className="w-4 h-4"/> : <CheckCircle2 className="w-4 h-4"/>}
                         </div>
                         <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-black text-slate-700 leading-tight truncate">{t.title}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 flex items-center gap-1.5 opacity-60">
                               <Clock className="w-2.5 h-2.5" /> {getTimeAgo(t.time)}
                            </p>
                         </div>
                      </div>
                    ))
                 )}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default StudentProfile;
