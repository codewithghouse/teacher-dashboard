import { useState, useEffect } from "react";
import ConceptMasteryDetail from "@/components/ConceptMasteryDetail";
import { BrainCircuit, Loader2, Target, Users, Sparkles, BookOpen, ChevronRight, GraduationCap } from "lucide-react";
import { AIController } from "../ai/controller/ai-controller";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, getDocs, where } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

const conceptHeaders = [
  "Algebraic Expressions", "Linear Equations", "Quadratic Equations", "Polynomials",
  "Geometry", "Triangles", "Circles", "Statistics", "Probability"
];

const cellColor = (pct: number) => {
  if (pct >= 80) return "bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-sm shadow-emerald-500/5";
  if (pct >= 50) return "bg-amber-50 text-amber-600 border border-amber-100 shadow-sm shadow-amber-500/5";
  if (pct > 0) return "bg-rose-50 text-rose-600 border border-rose-100 shadow-sm shadow-rose-500/5";
  return "bg-slate-50 text-slate-300 border border-slate-100 italic";
};

const ConceptMastery = () => {
  const { teacherData } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [masteryData, setMasteryData] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [aiGaps, setAiGaps] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // 1. Fetch Teacher's Classes
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const cls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setClasses(cls);
      if (cls.length > 0 && !selectedClassId) setSelectedClassId(cls[0].id);
    });
    return () => unsub();
  }, [teacherData?.id]);

  // 2. Fetch Enrollments & Mastery
  useEffect(() => {
    if (!teacherData?.id || !selectedClassId) {
       if (classes.length === 0 && !loading) setLoading(false);
       return;
    }
    setLoading(true);

    const q = query(
      collection(db, "enrollments"), 
      where("teacherId", "==", teacherData.id),
      where("classId", "==", selectedClassId)
    );
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      try {
        const masterySnap = await getDocs(collection(db, "concept_mastery"));
        const masteryDocs = masterySnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const data = snapshot.docs.map(doc => {
          const e = doc.data();
          const mastery: any = masteryDocs.find((m: any) => 
            m.studentId === e.studentId || m.id === e.studentId || (m.studentEmail && m.studentEmail === e.studentEmail)
          ) || {};
          
          const scores = conceptHeaders.map(h => mastery.scores?.[h] || 0);

          return {
            id: e.studentId || doc.id,
            name: e.studentName,
            email: e.studentEmail,
            grade: e.grade || e.className || "8",
            initials: e.studentName?.substring(0,2).toUpperCase() || "ST",
            color: "bg-[#1e3a8a]",
            concepts: scores
          };
        });

        setMasteryData(data);
      } catch (e) {
        toast.error("Failed to sync mastery registry.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [teacherData?.id, selectedClassId, classes]);

  const handleClassGapsAnalysis = async () => {
     if (masteryData.length === 0) return;
     setIsAnalyzing(true);
     try {
        const selClass = classes.find(c => c.id === selectedClassId);
        const result = await AIController.getClassGaps({
           class: selClass?.name || "Class Group",
           topics: conceptHeaders,
           student_averages: masteryData.map(s => ({
              name: s.name,
              scores: s.concepts
           }))
        });
        if (result.status === "success" && result.data) {
           setAiGaps(result.data);
           toast.success("Learning Gap Audit Complete.");
        }
     } catch (e) {
        toast.error("Audit protocol failed.");
     } finally {
        setIsAnalyzing(false);
     }
  };

  if (selectedStudent) {
    return <ConceptMasteryDetail student={selectedStudent} concepts={conceptHeaders} scores={selectedStudent.concepts} onBack={() => setSelectedStudent(null)} />;
  }

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-10 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div className="text-left">
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left">Concept Mastery Matrix</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
             <Target className="w-4 h-4 text-[#1e3a8a]"/> Real-time Scholar Micro-Skill Trajectory Monitoring
          </p>
        </div>
        <div className="flex items-center gap-4">
           <select 
             value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
             className="h-16 px-6 bg-slate-50 border-none rounded-2xl text-[11px] font-black uppercase tracking-widest focus:ring-4 ring-blue-50 transition-all cursor-pointer min-w-[200px]"
           >
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
           </select>
           <button 
              onClick={handleClassGapsAnalysis} disabled={isAnalyzing || masteryData.length === 0}
              className="bg-[#1e3a8a] text-white px-8 py-5 rounded-[2rem] text-[10px] font-black uppercase tracking-widest shadow-2xl shadow-blue-900/40 hover:translate-y-[-2px] transition-all flex items-center gap-3 active:scale-95 disabled:opacity-50"
           >
             {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin"/> : <BrainCircuit className="w-5 h-5"/>} Audit Learning Gaps
           </button>
        </div>
      </div>

      <div className="flex items-center gap-8 mb-10 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 pl-4 border-l-4 border-slate-100">
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-lg bg-emerald-500 shadow-lg shadow-emerald-500/20" /> Mastered (80%+)</div>
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-lg bg-amber-400 shadow-lg shadow-amber-500/20" /> Developing (50-79%)</div>
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-lg bg-rose-500 shadow-lg shadow-rose-500/20" /> Critical (&lt;50%)</div>
      </div>

      {aiGaps?.class_level_gaps?.length > 0 && (
         <div className="bg-rose-50/30 border border-rose-100 rounded-[3rem] p-10 shadow-sm mb-12 animate-in slide-in-from-top-6 duration-700">
            <h2 className="text-[11px] font-black text-rose-800 uppercase tracking-[0.2em] mb-8 flex items-center gap-3">
               <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" /> institutional Logic Failures Detected
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
               {aiGaps.class_level_gaps.map((gap: any, i:number) => (
                  <div key={i} className="bg-white p-6 rounded-[2rem] border border-rose-100 shadow-sm group hover:border-[#1e3a8a] transition-all">
                     <div className="flex justify-between items-center mb-4">
                        <span className="bg-rose-100 text-rose-800 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full">{gap.concept}</span>
                        <ChevronRight className="w-4 h-4 text-rose-200 group-hover:text-[#1e3a8a] transition-all" />
                     </div>
                     <p className="text-[11px] font-bold text-slate-500 mb-6 leading-relaxed italic">"{gap.failure_reason}"</p>
                     <div className="bg-slate-50 rounded-2xl p-4 border border-slate-50">
                        <p className="text-[9px] uppercase font-black tracking-tighter text-indigo-500 mb-1 flex items-center gap-2"><Sparkles className="w-3 h-3"/> Re-Calibration Plan</p>
                        <p className="text-[10px] font-bold text-slate-900 leading-snug">{gap.suggested_class_action}</p>
                     </div>
                  </div>
               ))}
            </div>
         </div>
      )}

      {loading ? (
        <div className="py-40 flex flex-col items-center justify-center bg-white border border-slate-50 rounded-[3.5rem] shadow-sm">
           <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-6" />
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Synthesizing Mastery Data Matrix...</p>
        </div>
      ) : masteryData.length === 0 ? (
        <div className="py-40 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-[3.5rem] shadow-sm text-center px-10">
           <div className="w-24 h-24 bg-blue-50/50 rounded-[2.5rem] flex items-center justify-center mb-8">
              <Sparkles className="w-12 h-12 text-blue-300" />
           </div>
           <h2 className="text-3xl font-black text-slate-800 mb-4 tracking-tight uppercase">Registry Idle</h2>
           <p className="text-sm font-bold text-slate-400 max-w-sm mx-auto uppercase tracking-tighter leading-relaxed mb-10 italic">
             No scholars detected in the current class audit. Assign curriculum modules to automatically populate micro-skill trajectories.
           </p>
           <button className="px-12 py-5 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl hover:bg-[#1e3a8a] transition-all flex items-center gap-3">
             <GraduationCap className="w-5 h-5"/> Deploy Mastery Protocol
           </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-[3.5rem] overflow-hidden shadow-2xl relative text-left">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100">
                  <th className="py-8 px-10 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] min-w-[280px] text-left border-r border-slate-100 sticky left-0 z-20 bg-slate-50/95 backdrop-blur-md">Scholar Roster</th>
                  {conceptHeaders.map((h) => (
                    <th key={h} className="text-center py-8 px-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] min-w-[160px] leading-tight border-r border-slate-50 last:border-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {masteryData.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td onClick={() => setSelectedStudent(s)} className="py-6 px-10 cursor-pointer border-r border-slate-100 sticky left-0 z-10 bg-white group-hover:bg-slate-50/50 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)] transition-colors">
                      <div className="flex items-center gap-5">
                        <div className={`w-14 h-14 rounded-2xl ${s.color} flex items-center justify-center text-white text-xs font-black shadow-lg group-hover:scale-110 transition-transform`}>{s.initials}</div>
                        <div className="text-left overflow-hidden">
                          <p className="font-black text-slate-900 text-base whitespace-nowrap group-hover:text-[#1e3a8a] transition-colors">{s.name}</p>
                          <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mt-1 whitespace-nowrap">{s.email}</p>
                        </div>
                      </div>
                    </td>
                    {s.concepts.map((c:number, i:number) => (
                      <td key={i} className="py-6 px-4 text-center border-r border-slate-50 last:border-0">
                        <div className={`text-[11px] font-black px-6 py-3 rounded-2xl inline-flex items-center justify-center min-w-[70px] transition-all group-hover:scale-105 ${cellColor(c)}`}>
                          {c > 0 ? `${c}%` : "—"}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConceptMastery;
