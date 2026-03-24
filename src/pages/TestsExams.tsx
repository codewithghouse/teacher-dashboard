import React, { useState, useEffect } from "react";
import CreateTest from "../components/CreateTest";
import EnterScores from "../components/EnterScores";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, Plus, Edit, Printer, ChevronRight, BarChart3, TrendingUp } from "lucide-react";

export default function TestsExams() {
  const { teacherData } = useAuth();
  const [view, setView] = useState<'list' | 'create' | 'enter-scores'>('list');
  const [selectedTest, setSelectedTest] = useState<any>(null);
  
  const [tests, setTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "tests_registry"), where("teacherId", "==", teacherData.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: any[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      fetched.sort((a,b) => {
         const dA = new Date(a.testDate || (a.createdAt as any)?.toDate() || 0).getTime();
         const dB = new Date(b.testDate || (b.createdAt as any)?.toDate() || 0).getTime();
         return dA - dB; // closest first
      });
      setTests(fetched);
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

  const completedCount = tests.filter(t => t.status === "Completed").length;
  const pendingCount = tests.filter(t => t.status === "Pending Scores" || t.status === "Draft").length;
  const upcomingCount = tests.filter(t => t.status !== "Completed" && t.status !== "Pending Scores").length;

  const mockTopicData = [
     { name: "Algebra", score: 82, color: "text-emerald-500" },
     { name: "Geometry", score: 71, color: "text-amber-500" },
     { name: "Statistics", score: 79, color: "text-emerald-500" },
     { name: "Trigonometry", score: 64, color: "text-rose-500" },
  ];

  const mockPerfData = [
     { class: "Class 8-A", score: 78.5, fill: "bg-emerald-500" },
     { class: "Class 9-B", score: 72.3, fill: "bg-amber-500" },
     { class: "Class 7-C", score: 81.2, fill: "bg-emerald-500" },
     { class: "Class 10-A", score: 65.8, fill: "bg-rose-500" },
  ];

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div>
           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">RESULT OF CLICK: "TESTS & EXAMS"</p>
           <h1 className="text-3xl font-black text-slate-800 tracking-tight leading-none">Tests & Exams</h1>
           <p className="text-sm font-medium text-slate-500 mt-2">Manage tests, enter scores, and analyze performance.</p>
        </div>
        <button 
           onClick={() => setView('create')} 
           className="bg-[#1e3a8a] text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-sm hover:bg-blue-900 transition-all flex items-center gap-2"
        >
           Create Test
        </button>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
         <div className="bg-white border text-left border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-amber-100/50" />
            <div>
               <h3 className="text-2xl font-black text-slate-800 leading-none">{upcomingCount}</h3>
               <p className="text-xs font-semibold text-slate-500 mt-1">Upcoming</p>
            </div>
         </div>
         <div className="bg-white border text-left border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-100/50" />
            <div>
               <h3 className="text-2xl font-black text-slate-800 leading-none">{completedCount}</h3>
               <p className="text-xs font-semibold text-slate-500 mt-1">Completed</p>
            </div>
         </div>
         <div className="bg-white border text-left border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-rose-100/50" />
            <div>
               <h3 className="text-2xl font-black text-slate-800 leading-none">{pendingCount}</h3>
               <p className="text-xs font-semibold text-slate-500 mt-1">Pending Scores</p>
            </div>
         </div>
         <div className="bg-white border text-left border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-100/50" />
            <div>
               <h3 className="text-2xl font-black text-slate-800 leading-none">74.5%</h3>
               <p className="text-xs font-semibold text-slate-500 mt-1">Class Avg</p>
            </div>
         </div>
      </div>

      {/* Main Grid: Left List, Right Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         
         {/* Left Side: Upcoming Tests */}
         <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col items-start">
            <div className="w-full flex items-center justify-between p-6 border-b border-slate-100">
               <h2 className="text-lg font-bold text-slate-900">Upcoming Tests</h2>
               <input type="text" className="w-32 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none" />
            </div>
            
            <div className="w-full p-4 space-y-4">
               {loading ? (
                 <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 text-[#1e3a8a] animate-spin" /></div>
               ) : tests.length === 0 ? (
                 <div className="py-20 text-center text-sm font-semibold text-slate-400">No tests created yet. Use 'Create Test'.</div>
               ) : tests.map((test, i) => {
                  
                  // Calculate days left logic mock
                  const isSoon = i === 0;

                  return (
                     <div key={test.id} className={`w-full rounded-2xl border p-5 ${isSoon ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
                        <div className="flex items-start justify-between mb-4">
                           <div>
                              <h3 className="text-[17px] font-bold text-slate-900 leading-tight">{test.title || "Untitled Test"}</h3>
                              <p className="text-sm font-medium text-slate-500 mt-1">{test.className || "Class Unknown"} • {test.studentsCount || 0} students</p>
                           </div>
                           <span className={`px-3 py-1 rounded-full text-xs font-semibold ${isSoon ? 'bg-amber-400 text-white' : 'bg-blue-100 text-blue-700'}`}>
                              {isSoon ? "In 2 days" : "In 5 days"}
                           </span>
                        </div>
                        
                        <div className="flex items-center gap-4 text-xs font-semibold text-slate-500 mb-5">
                           <span>{test.testDate || "No Date"}</span>
                           <span>{test.duration || "45 minutes"}</span>
                           <span>{test.marks || "50"} marks</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                           {isSoon ? (
                              <button onClick={() => handleEnterScores(test)} className="bg-[#1e3a8a] text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-900 transition-colors">
                                 Enter Scores
                              </button>
                           ) : (
                              <button onClick={() => handleEnterScores(test)} className="bg-white border border-slate-200 text-slate-700 px-5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                                 View
                              </button>
                           )}
                           <button className="bg-white border border-slate-200 text-slate-700 px-5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                              Edit
                           </button>
                           {isSoon && (
                              <button className="bg-white border border-slate-200 text-slate-700 px-5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                                 Print
                              </button>
                           )}
                        </div>
                     </div>
                  );
               })}
            </div>
         </div>

         {/* Right Side: Analytics */}
         <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-left w-full self-start">
            <h2 className="text-lg font-bold text-slate-900 leading-none mb-1">Performance Overview</h2>
            <p className="text-xs font-medium text-slate-500 mb-6">Last 5 tests</p>

            <div className="space-y-5 border-b border-slate-100 pb-6 mb-6">
               {mockPerfData.map((d, i) => (
                  <div key={i}>
                     <div className="flex justify-between text-xs font-bold mb-1">
                        <span className="text-slate-800">{d.class}</span>
                        <span className={d.score > 75 ? "text-emerald-500" : d.score > 66 ? "text-amber-500" : "text-rose-500"}>{d.score}%</span>
                     </div>
                     <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${d.fill} rounded-full`} style={{ width: `${d.score}%` }} />
                     </div>
                  </div>
               ))}
            </div>

            <h2 className="text-[15px] font-bold text-slate-900 leading-none mb-4">Topic Performance</h2>
            <div className="space-y-3">
               {mockTopicData.map((t, i) => (
                  <div key={i} className="flex justify-between text-sm font-semibold">
                     <span className="text-slate-500">{t.name}</span>
                     <span className={t.color}>{t.score}%</span>
                  </div>
               ))}
            </div>
         </div>

      </div>
    </div>
  );
}
