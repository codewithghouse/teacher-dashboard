import { useState, useEffect } from "react";
import ConceptMasteryDetail from "@/components/ConceptMasteryDetail";
import { BrainCircuit, Loader2, Target, Users, Sparkles, BookOpen, ChevronRight, GraduationCap } from "lucide-react";
import { AIController } from "../ai/controller/ai-controller";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, getDocs, where } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

const cellColor = (pct: number) => {
  if (pct >= 80) return "bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-sm shadow-emerald-500/5";
  if (pct >= 50) return "bg-amber-50 text-amber-600 border border-amber-100 shadow-sm shadow-amber-500/5";
  if (pct > 0) return "bg-rose-50 text-rose-600 border border-rose-100 shadow-sm shadow-rose-500/5";
  return "bg-slate-50 text-slate-300 border border-slate-100 italic";
};

const ConceptMastery = () => {
  const { teacherData } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  
  const [dynamicHeaders, setDynamicHeaders] = useState<string[]>([]);
  const [masteryData, setMasteryData] = useState<any[]>([]);
  const [classAverages, setClassAverages] = useState<number[]>([]);
  const [weakConcepts, setWeakConcepts] = useState<{name: string, avg: number}[]>([]);
  
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

  // 2. Compute Dynamic Mastery Matrix
  useEffect(() => {
    if (!teacherData?.id || !selectedClassId) {
       if (classes.length === 0 && !loading) setLoading(false);
       return;
    }
    setLoading(true);

    const asyncFetch = async () => {
        try {
            // A. Fetch Enrollments
            const qEnroll = query(collection(db, "enrollments"), where("classId", "==", selectedClassId));
            const enrollSnap = await getDocs(qEnroll);
            const roster = enrollSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            // B. Fetch Tests Registry
            const qTests = query(collection(db, "tests_registry"), where("classId", "==", selectedClassId));
            const testsSnap = await getDocs(qTests);
            const classTests = testsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

            // Extract all unique conceptual topics
            const topicsSet = new Set<string>();
            classTests.forEach(t => {
                if (t.topics && Array.isArray(t.topics)) {
                    t.topics.forEach(concept => topicsSet.add(concept));
                }
            });
            const extractedConcepts = Array.from(topicsSet);
            setDynamicHeaders(extractedConcepts);

            // C. Fetch Test Scores — fetch by each testId for reliability
            const testScorePromises = classTests.map(t =>
                getDocs(query(collection(db, "test_scores"), where("testId", "==", t.id)))
            );
            const testScoreSnaps = await Promise.all(testScorePromises);
            const allScores = testScoreSnaps.flatMap(snap => snap.docs.map(d => d.data()));

            // Build Matrix
            const builtMatrix = roster.map((enrollment: any) => {
                const sId = enrollment.studentId || enrollment.id;
                const sScores = allScores.filter((s:any) => s.studentId === sId);

                const conceptAverages = extractedConcepts.map(concept => {
                    // Find all tests that cover this concept
                    const relevantTestIds = classTests.filter(t => t.topics?.includes(concept)).map(t => t.id);
                    // Find student's scores on these relevant tests
                    const relevantScores = sScores.filter((s:any) => relevantTestIds.includes(s.testId));
                    
                    if (relevantScores.length === 0) return 0; // Not assessed

                    let totalPct = 0;
                    let count = 0;
                    relevantScores.forEach((s:any) => {
                        // maxScore is saved by EnterScores.tsx, totalMarks is on the test definition
                        const denominator = Number(s.maxScore) || Number(s.percentage ? s.score / (s.percentage / 100) : 0);
                        if (denominator > 0 && s.score !== null && s.score !== undefined) {
                            const pct = (Number(s.score) / denominator) * 100;
                            totalPct += pct;
                            count++;
                        } else if (s.percentage && s.percentage > 0) {
                            // fallback: use pre-calculated percentage
                            totalPct += Number(s.percentage);
                            count++;
                        }
                    });
                    
                    return count > 0 ? Math.round(totalPct / count) : 0;
                });

                return {
                    id: sId,
                    name: enrollment.studentName,
                    email: enrollment.studentEmail,
                    grade: enrollment.grade || enrollment.className || "N/A",
                    initials: enrollment.studentName?.substring(0,2).toUpperCase() || "ST",
                    color: "bg-[#1e3a8a]",
                    concepts: conceptAverages
                };
            });

            // Remove duplicates
            const uniqueMatrix = Array.from(new Map(builtMatrix.map(item => [item.id, item])).values())
                                      .sort((a,b) => a.name.localeCompare(b.name));
            
            // Calculate Class Averages per concept
            const avgs = extractedConcepts.map((_, colIndex) => {
                let sum = 0;
                let validCount = 0;
                uniqueMatrix.forEach(student => {
                    const score = student.concepts[colIndex];
                    if (score > 0) {
                        sum += score;
                        validCount++;
                    }
                });
                return validCount > 0 ? Math.round(sum / validCount) : 0;
            });

            // Find Weak Concepts (< 75%)
            const weak = extractedConcepts.map((concept, index) => ({
                name: concept,
                avg: avgs[index]
            })).filter(w => w.avg > 0 && w.avg < 75);

            setClassAverages(avgs);
            setWeakConcepts(weak);
            setMasteryData(uniqueMatrix);
        } catch(e) {
            console.error(e);
            toast.error("Failed to sync mastery registry.");
        } finally {
            setLoading(false);
        }
    };

    asyncFetch();
    
    // Using simple fetch without full snap listener to avoid massive cascading reads.
    // Realtime update hook can be added if needed, but standard navigation trigger is optimal here.
  }, [teacherData?.id, selectedClassId]);

  const handleClassGapsAnalysis = async () => {
     if (masteryData.length === 0 || dynamicHeaders.length === 0) return;
     setIsAnalyzing(true);
     try {
        const selClass = classes.find(c => c.id === selectedClassId);
        const result = await AIController.getClassGaps({
           class: selClass?.name || "Class Group",
           topics: dynamicHeaders,
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
    return <ConceptMasteryDetail student={selectedStudent} concepts={dynamicHeaders} scores={selectedStudent.concepts} onBack={() => setSelectedStudent(null)} />;
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
        <div className="flex flex-col gap-8">
          <div className="bg-white border border-slate-100 rounded-[3.5rem] overflow-hidden shadow-2xl relative text-left">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    <th className="py-8 px-10 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] min-w-[280px] text-left border-r border-slate-100 sticky left-0 z-20 bg-slate-50/95 backdrop-blur-md">Scholar Roster</th>
                    {dynamicHeaders.map((h) => (
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
                  
                  {/* Class Average Row */}
                  {classAverages.length > 0 && (
                    <tr className="bg-slate-50/80 border-t border-slate-200">
                      <td className="py-6 px-10 font-black text-slate-900 tracking-tight text-[13px] border-r border-slate-100 sticky left-0 z-10 bg-slate-50 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)]">
                        Class Avg
                      </td>
                      {classAverages.map((avg, i) => (
                        <td key={`avg-${i}`} className="py-6 px-4 text-center border-r border-slate-50 last:border-0">
                          <div className="text-[12px] font-black text-slate-600">
                            {avg > 0 ? `${avg}%` : "—"}
                          </div>
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Weak Concepts Alert Box */}
          {weakConcepts.length > 0 && (
            <div className="bg-rose-50/50 border border-rose-200 rounded-3xl p-8 shadow-sm flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-500">
              <h3 className="text-[14px] font-black text-slate-800 tracking-tight">
                Weak Concepts Requiring Attention
              </h3>
              <div className="flex flex-wrap gap-4">
                {weakConcepts.map((wc, i) => (
                  <div key={`weak-${i}`} className="flex items-center gap-2 bg-white px-5 py-3 rounded-full border border-rose-100 shadow-sm">
                    <span className="text-rose-600 text-[13px] font-black">{wc.name}</span>
                    <span className="text-rose-500/80 text-[12px] font-bold">(Class Avg: {wc.avg}%)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ConceptMastery;
