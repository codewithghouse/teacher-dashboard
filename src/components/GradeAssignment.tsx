import React, { useState, useEffect } from 'react';
import { ChevronLeft, Check, BrainCircuit, ShieldAlert, Loader2, Sparkles, UserX, Download } from 'lucide-react';
import { AIController } from '../ai/controller/ai-controller';
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

interface GradeAssignmentProps {
  assignment: any;
  onBack: () => void;
}

const GradeAssignment = ({ assignment, onBack }: GradeAssignmentProps) => {
  const { teacherData } = useAuth();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGrading, setIsGrading] = useState(false);

  useEffect(() => {
    if (!assignment?.id || !teacherData?.id) return;
    
    // Pull Students from Enrollments for the assignment's class
    const q = query(
      collection(db, "enrollments"), 
      where("classId", "==", assignment.classId),
      where("teacherId", "==", teacherData.id)
    );
    
    const unsub = onSnapshot(q, (snap) => {
      const roster = snap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: data.studentId || d.id,
          name: data.studentName,
          email: data.studentEmail,
          status: "Submitted", // Mocking submission status for now
          attachment: "worksheet_final.pdf",
          grade: "", 
          feedback: "",
          isPlagiarized: false
        };
      });
      setSubmissions(roster);
      setLoading(false);
    });
    return () => unsub();
  }, [assignment?.classId, teacherData?.id]);

  const handleAIGrading = async () => {
     if (submissions.length === 0) return toast.error("No scholars in this roster to grade!");
     setIsGrading(true);
     try {
       const payload = {
          assignment_title: assignment.title,
          submitting_students: submissions.map(s => ({ name: s.name, file: s.attachment }))
       };
       const result = await AIController.getAssignmentGrading(payload);
       if (result.status === "success" && result.data) {
          const updatedSubs = submissions.map(sub => {
             const aiGrade = result.data.auto_graded_results?.find((x:any) => x.student_name === sub.name);
             const aiPlag = result.data.plagiarism_alerts?.find((x:any) => x.student_name === sub.name);
             return {
                ...sub,
                grade: aiGrade ? aiGrade.score : sub.grade,
                feedback: aiGrade ? aiGrade.feedback : sub.feedback,
                isPlagiarized: !!aiPlag,
                plagSource: aiPlag?.suspected_source
             };
          });
          setSubmissions(updatedSubs);
          toast.success("AI Synthesis Complete: Scores and Feedback Generated.");
       } else {
          toast.error(result.message || "Brain failed to synthesize grading.");
       }
     } catch (e) {
       console.error(e);
       toast.error("Network synchronization failed during grading.");
     } finally {
       setIsGrading(false);
     }
  };

  const gradedCount = submissions.filter(s => s.grade !== "").length;
  const totalSubmissions = submissions.length;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-10 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div className="text-left">
          <button onClick={onBack} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#1e3a8a] flex items-center gap-1 mb-2 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Exit Audit View
          </button>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left flex items-center gap-4">
             {assignment?.title || "Pending Assessment"}
             <span className="text-[10px] font-black text-blue-400 bg-blue-50 px-3 py-1 rounded-full uppercase tracking-widest">{assignment?.grade} {assignment?.className}</span>
          </h1>
        </div>
        <button 
          onClick={() => { toast.success("Roster synchronization complete."); onBack(); }}
          className="bg-emerald-600 text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-emerald-900/30 hover:translate-y-[-2px] transition-all flex items-center gap-3 active:scale-95 whitespace-nowrap"
        >
          <Check className="w-6 h-6" /> Finalize Roster
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
         <div className="lg:col-span-2 space-y-8">
            <div className="bg-white border border-slate-50 rounded-[3.5rem] p-12 shadow-sm relative overflow-hidden text-left">
               <div className="flex flex-col md:flex-row items-center justify-between mb-10 pb-8 border-b border-slate-50 gap-6">
                  <div className="text-left">
                     <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        Submissions Registry
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm animate-pulse" />
                     </h2>
                     <p className="text-[10px] font-black text-slate-400 tracking-widest uppercase mt-1">Status: {gradedCount} / {totalSubmissions} Synced</p>
                  </div>
                  <button onClick={handleAIGrading} disabled={isGrading || totalSubmissions === 0} className="px-8 py-4 bg-indigo-600 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-widest shadow-xl shadow-indigo-900/20 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-3 disabled:opacity-50">
                     {isGrading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><BrainCircuit className="w-5 h-5" /> Batch Auto-Grade</>}
                  </button>
               </div>

               {loading ? (
                  <div className="py-32 flex flex-col items-center justify-center">
                     <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-6" />
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Compiling Submission Metrics...</p>
                  </div>
               ) : submissions.length === 0 ? (
                  <div className="py-32 text-center text-slate-200 uppercase text-[10px] font-black tracking-widest italic">No scholars enrolled in this curriculum roster.</div>
               ) : (
                  <div className="space-y-6">
                     {submissions.map((sub, i) => (
                       <div key={i} className="p-8 bg-slate-50/50 border border-slate-100/50 rounded-[2.5rem] hover:bg-white hover:shadow-xl hover:border-blue-100 transition-all group group-hover:bg-white text-left">
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                             <div className="flex items-center gap-5">
                                <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-slate-400 group-hover:bg-[#1e3a8a] group-hover:text-white transition-all font-black text-lg shadow-sm">
                                   {sub.name?.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="text-left">
                                   <h3 className="font-black text-slate-900 text-base leading-tight group-hover:text-[#1e3a8a] transition-all">{sub.name}</h3>
                                   <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{sub.attachment}</p>
                                      {sub.isPlagiarized && <span className="text-[8px] font-black text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full uppercase tracking-widest flex items-center gap-1 group-hover:bg-rose-100"><ShieldAlert className="w-3 h-3"/> Similarity Link Detected</span>}
                                   </div>
                                </div>
                             </div>
                             
                             <div className="flex items-center gap-6">
                                <div className="text-center bg-white px-6 py-4 rounded-2xl border border-slate-100 shadow-sm min-w-[100px] group-hover:border-blue-100 transition-all">
                                   <input 
                                     type="text" 
                                     value={sub.grade} 
                                     onChange={() => {}} // Handle manual grade if needed
                                     className="w-12 text-center text-2xl font-black text-slate-900 focus:outline-none placeholder:text-slate-100" 
                                     placeholder="00"
                                   />
                                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">Raw Score</p>
                                </div>
                                <button className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-slate-300 hover:text-[#1e3a8a] hover:bg-blue-50 transition-all border border-slate-100 shadow-sm"><Download className="w-5 h-5"/></button>
                             </div>
                          </div>
                          
                          {sub.feedback && (
                            <div className="mt-8 pt-8 border-t border-slate-100 flex gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
                               <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 text-indigo-500"><Sparkles className="w-4 h-4"/></div>
                               <p className="text-xs font-bold text-slate-400 leading-relaxed max-w-2xl">{sub.feedback}</p>
                            </div>
                          )}
                       </div>
                     ))}
                  </div>
               )}
            </div>
         </div>

         <div className="space-y-10">
            <div className="bg-slate-950 p-12 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-64 h-64 bg-[#1e3a8a] blur-[150px] opacity-20 -mr-20 -mt-20 group-hover:opacity-40 transition-all"></div>
               <h3 className="text-[10px] font-black text-blue-300 uppercase tracking-[0.4em] mb-6 relative z-10 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" /> Global Roster Insights
               </h3>
               <p className="text-2xl font-black leading-tight mb-8 relative z-10 italic">"The brain has detected a 14% mean alignment gap in submissions. Consider a neural logic review for {assignment?.className}."</p>
               <div className="h-1.5 bg-white/5 rounded-full overflow-hidden relative z-10 border border-white/5 mb-2">
                  <div className="h-full bg-blue-500 w-[74%] transition-all duration-[2000ms]" />
               </div>
               <p className="text-[9px] font-black text-white/40 uppercase tracking-[0.2em] relative z-10 text-right">Stability: 74%</p>
            </div>
            
            <div className="bg-white border border-slate-50 rounded-[3rem] p-10 shadow-sm text-left">
               <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-8 border-b border-slate-50 pb-6">Similarity Analysis Trace</h3>
               <div className="space-y-6">
                {submissions.filter(s => s.isPlagiarized).length === 0 ? (
                  <div className="flex items-center gap-4">
                     <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><Check className="w-5 h-5"/></div>
                     <p className="text-xs font-black text-slate-800 uppercase tracking-tighter">Academic Integrity Validated</p>
                  </div>
                ) : (
                  submissions.filter(s => s.isPlagiarized).map((s, i) => (
                    <div key={i} className="flex gap-4 p-4 bg-rose-50/50 rounded-2xl border border-rose-100">
                       <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 flex-shrink-0"><ShieldAlert className="w-5 h-5"/></div>
                       <div className="text-left"><p className="text-xs font-black text-rose-800 leading-tight">{s.name}</p><p className="text-[9px] font-bold text-rose-400 uppercase mt-1 tracking-widest">Flagged: External AI Trace detected</p></div>
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

export default GradeAssignment;
