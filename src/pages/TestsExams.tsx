import { useState, useEffect } from "react";
import StatCard from "@/components/StatCard";
import CreateTest from "@/components/CreateTest";
import EnterScores from "@/components/EnterScores";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, FilePlus, Sparkles, GraduationCap, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";

const TestsExams = () => {
  const { teacherData } = useAuth();
  const [view, setView] = useState<'list' | 'create' | 'enter-scores'>('list');
  const [selectedTest, setSelectedTest] = useState<any>(null);
  
  const [testsData, setTestsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teacherData?.id) return;
    
    // Fetch Teacher's Tests
    const q = query(collection(db, "tests"), where("teacherId", "==", teacherData.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setTestsData(fetched);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [teacherData?.id]);

  const handleEnterScores = (test: any) => {
    setSelectedTest(test);
    setView('enter-scores');
  };

  if (view === 'create') return <CreateTest onCancel={() => setView('list')} onCreate={() => setView('list')} />;
  if (view === 'enter-scores') return <EnterScores test={selectedTest} onBack={() => setView('list')} />;

  const completedCount = testsData.filter(t => t.status === "Completed").length;
  const pendingCount = testsData.filter(t => t.status !== "Completed").length;

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-12 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div className="text-left">
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left">Examination Vault</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
             <TrendingUp className="w-4 h-4 text-[#1e3a8a]"/> AI Assisted Test Lifecycle & Performance Matrix
          </p>
        </div>
        <button 
          onClick={() => setView('create')}
          className="bg-[#1e3a8a] text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-blue-900/30 hover:translate-y-[-2px] transition-all flex items-center gap-3 active:scale-95 whitespace-nowrap"
        >
          <Sparkles className="w-6 h-6"/> Build Neural Paper
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
           <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm"><FilePlus className="w-6 h-6"/></div>
           <div className="text-left"><p className="text-3xl font-black text-slate-900 leading-none">{testsData.length}</p><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Total Exams</p></div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
           <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm"><CheckCircle2 className="w-6 h-6"/></div>
           <div className="text-left"><p className="text-3xl font-black text-slate-900 leading-none">{completedCount}</p><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Completed</p></div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
           <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shadow-sm"><AlertTriangle className="w-6 h-6"/></div>
           <div className="text-left"><p className="text-3xl font-black text-slate-900 leading-none">{pendingCount}</p><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Pending Audit</p></div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
           <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shadow-sm"><TrendingUp className="w-6 h-6"/></div>
           <div className="text-left"><p className="text-3xl font-black text-slate-900 leading-none">78%</p><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Expected Avg</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 flex flex-col gap-8 text-left">
           <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              Assessment Roster
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
           </h2>
           
           {loading ? (
             <div className="flex-1 flex flex-col items-center justify-center p-32 bg-white border border-dashed border-slate-100 rounded-[3.5rem]">
               <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-6" />
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Compiling Examination Cache...</p>
             </div>
           ) : testsData.length === 0 ? (
             <div className="flex-1 flex flex-col items-center justify-center py-32 bg-white border border-dashed border-slate-200 rounded-[3.5rem] text-center px-10">
               <div className="w-24 h-24 bg-blue-50/50 rounded-[2.5rem] flex items-center justify-center mb-10 group hover:bg-[#1e3a8a] transition-all duration-500">
                  <FilePlus className="w-12 h-12 text-blue-300 group-hover:text-white transition-all" />
               </div>
               <h3 className="text-3xl font-black text-slate-800 mb-4 tracking-tight">Vault is Currently Vacant</h3>
               <p className="text-sm font-bold text-slate-400 max-w-sm mx-auto uppercase tracking-tighter leading-relaxed mb-10 italic">
                 No upcoming assessments found. Utilize the Brain to instantly synthesize high-stability exam papers with auto-generated answer keys!
               </p>
               <button onClick={() => setView('create')} className="px-12 py-5 bg-slate-900 text-white font-black rounded-2xl hover:bg-[#1e3a8a] transition-all text-[11px] uppercase tracking-[0.2em] shadow-xl">Synthesize First Paper</button>
             </div>
           ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               {testsData.map((test, i) => (
                 <div key={i} className="bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm hover:shadow-2xl transition-all group relative overflow-hidden flex flex-col text-left">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50/50 rounded-bl-[3rem] group-hover:bg-[#1e3a8a] transition-colors duration-500 flex items-center justify-center p-6">
                       <GraduationCap className="w-8 h-8 text-blue-300 group-hover:text-white transition-colors" />
                    </div>
                    
                    <h3 className="text-2xl font-black text-slate-900 mb-2 leading-tight pr-12 group-hover:text-[#1e3a8a] transition-all">{test.title}</h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-10">{test.className || "General Group"} • {test.duration || "60"} MINS • {test.marks || "100"} TOTAL MARKS</p>
                    
                    <div className="flex gap-4 mt-auto">
                       <button onClick={() => handleEnterScores(test)} className="flex-1 bg-white border-2 border-slate-900 text-slate-900 text-[10px] font-black uppercase tracking-widest py-4 rounded-2xl hover:bg-slate-900 hover:text-white transition-all active:scale-95 shadow-sm">
                          Audit Performance
                       </button>
                       <button className="w-14 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center hover:bg-[#1e3a8a] hover:text-white transition-all border border-slate-100">
                          <TrendingUp className="w-5 h-5" />
                       </button>
                    </div>
                 </div>
               ))}
             </div>
           )}
        </div>

        <div className="bg-white rounded-[3.5rem] border border-slate-50 p-12 shadow-sm text-left h-fit lg:sticky lg:top-8">
          <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-10 border-b border-slate-50 pb-6 flex items-center gap-3">
             <div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Mastery Benchmarks
          </h2>
          
          <div className="space-y-10">
            {[
              { label: "Class 10-B", pct: 84, color: "bg-emerald-500 shadow-emerald-500/30" },
              { label: "Physics Year 11", pct: 72, color: "bg-blue-500 shadow-blue-500/30" },
              { label: "Mathematics", pct: 64, color: "bg-amber-500 shadow-amber-500/30" }
            ].map((c, i) => (
              <div key={i} className="group">
                <div className="flex justify-between items-end mb-3">
                  <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest">{c.label}</span>
                  <span className="text-lg font-black text-slate-900">{c.pct}%</span>
                </div>
                <div className="w-full bg-slate-50 rounded-full h-2.5 overflow-hidden border border-slate-100 p-0.5">
                  <div className={`h-full rounded-full ${c.color} transition-all duration-1000 shadow-sm`} style={{ width: `${c.pct}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-16 bg-slate-950 p-10 rounded-[2.5rem] text-white overflow-hidden relative group">
             <div className="absolute top-0 right-0 w-32 h-32 bg-[#1e3a8a] blur-[80px] opacity-20 group-hover:opacity-40 transition-all -mr-10 -mt-10" />
             <h3 className="text-[9px] font-black text-blue-300 uppercase tracking-widest mb-4 relative z-10">Topic Variance Alert</h3>
             <p className="text-lg font-black leading-tight relative z-10">Mastery in "Trigonometry" is 12% below the global academic median.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestsExams;
