import React, { useState, useEffect } from 'react';
import { ChevronLeft, Check, BrainCircuit, ShieldAlert, Loader2, Sparkles, UserX, Download, Save, Send, FileText, ExternalLink, MoreVertical, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { AIController } from '../ai/controller/ai-controller';
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, doc, setDoc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";
import * as XLSX from 'xlsx';

interface GradeAssignmentProps {
  assignment: any;
  onBack: () => void;
}

const GradeAssignment = ({ assignment, onBack }: GradeAssignmentProps) => {
  const { teacherData } = useAuth();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGrading, setIsGrading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [analyzingStudentId, setAnalyzingStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (!assignment?.id || !teacherData?.id) return;
    
    const fetchEverything = async () => {
        setLoading(true);
        try {
            // 1. Get Enrollments (Class Roster)
            const enrolQ = query(
                collection(db, "enrollments"), 
                where("classId", "==", assignment.classId)
            );
            const rosterSnap = await getDocs(enrolQ);
            
            // 2. Get existing results
            const qGrades = query(collection(db, "results"), where("assignmentId", "==", assignment.id));
            const gradeSnap = await getDocs(qGrades);
            const gradeMap = new Map();
            gradeSnap.docs.forEach(d => gradeMap.set(d.data().studentId, d.data()));

            // 3. Get Student Submissions
            const qSubs = query(collection(db, "submissions"), where("assignmentId", "==", assignment.id));
            const subSnap = await getDocs(qSubs);
            const subMap = new Map();
            subSnap.docs.forEach(d => subMap.set(d.data().studentId, d.data()));

            const roster = rosterSnap.docs.map(d => {
                const data = d.data() as any;
                const sId = data.studentId || d.id;
                const existing = gradeMap.get(sId);
                const sub = subMap.get(sId);
                
                // Calculate latency status
                let status = "Not Submitted";
                let submittedAtStr = "—";
                if (sub) {
                   let subDateIn: Date | null = null;
                   
                   if (sub.submittedAt) {
                      subDateIn = sub.submittedAt.toDate ? sub.submittedAt.toDate() : new Date(sub.submittedAt);
                   } else if (sub.timestamp) {
                      subDateIn = sub.timestamp.toDate ? sub.timestamp.toDate() : new Date(sub.timestamp);
                   }
                   
                   if (subDateIn && !isNaN(subDateIn.getTime())) {
                      submittedAtStr = subDateIn.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                      
                      const dueDate = assignment.deadline || (assignment.dueDate?.toDate ? assignment.dueDate.toDate() : new Date(assignment.dueDate || Date.now()));
                      status = subDateIn > dueDate ? "Late" : "On Time";
                   }
                }

                return {
                    id: sId,
                    name: data.studentName,
                    rollNo: data.rollNo || "801", // dummy fallback for UI match
                    email: data.studentEmail,
                    status: status,
                    submittedAt: submittedAtStr,
                    attachment: sub ? sub.fileName || "artifact.pdf" : "—",
                    fileUrl: sub ? sub.fileUrl : null,
                    grade: existing ? existing.score : "", 
                    feedback: existing ? existing.feedback : "",
                    isPlagiarized: existing ? existing.isPlagiarized : false
                };
            });
            setSubmissions(roster);
        } catch (e) {
            toast.error("Institutional audit failed to load roster.");
        } finally {
            setLoading(false);
        }
    };

    fetchEverything();
  }, [assignment?.id, assignment?.classId, teacherData?.id]);

  const updateSub = (id: string, field: string, value: any) => {
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleExport = () => {
     if (submissions.length === 0) return toast.info("No logs to export.");
     try {
        const data = submissions.map(s => ({
            'Student Name': s.name,
            'Roll Number': s.rollNo,
            'Email': s.email,
            'Submission Status': s.status,
            'Submitted At': s.submittedAt,
            'Grade / 100': s.grade || 'Not Graded',
            'Feedback': s.feedback || 'No Feedback'
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Grades");
        XLSX.writeFile(wb, `${assignment.title}_Grades_Audit.xlsx`);
        toast.success("Institutional logs exported to Excel.");
     } catch (e) {
        toast.error("Export protocol failure.");
     }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
        const promises = submissions.filter(s => s.grade !== "").map(sub => {
            const resRef = doc(db, "results", `${sub.id}_${assignment.id}`);
            return setDoc(resRef, {
                studentId: sub.id,
                studentName: sub.name,
                homeworkId: assignment.id, // Renamed from assignmentId to differentiate from teaching_assignment
                assignmentId: assignment.assignmentId || "legacy", // Enforced Phase 1 spec: tracking the teaching_assignment
                assignmentTitle: assignment.title,
                classId: assignment.classId,
                className: assignment.className || "Class 8-A",
                score: sub.grade,
                feedback: sub.feedback,
                isPlagiarized: sub.isPlagiarized || false,
                teacherId: teacherData.id,
                teacherName: teacherData.name,
                timestamp: serverTimestamp(),
                category: "Assignment",
                type: "score"
            });
        });
        await Promise.all(promises);
        toast.success("Institutional mastery logs published successfully.");
        onBack();
    } catch (e) {
        toast.error("Critical synchronization failure.");
    } finally {
        setIsSaving(false);
    }
  };

  const gradedCount = submissions.filter(s => s.grade !== "").length;
  const totalRoster = submissions.length;
  const progressPercent = totalRoster > 0 ? Math.round((gradedCount / totalRoster) * 100) : 0;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500 pb-20 text-left">
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-6">
        <div className="text-left">
           <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
              Grade: {assignment?.title}
           </h1>
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-3 mt-2">
              {assignment?.className || "Class 8-A"} • {submissions.filter(s => s.status !== "Not Submitted").length} Submissions • Due: {assignment?.deadline?.toLocaleDateString() || "Feb 17, 2025"}
           </p>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="flex-1 md:w-48 bg-white border border-slate-100 p-2.5 rounded-2xl flex items-center justify-between gap-4 mr-2 shadow-sm">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-2">Progress</span>
                <div className="flex-1 h-3 bg-slate-50 border border-slate-100 rounded-full overflow-hidden flex items-center">
                    <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${progressPercent}%` }} />
                </div>
                <span className="text-[10px] font-black text-slate-800 pr-2">{gradedCount}/{totalRoster}</span>
            </div>
            <button onClick={handleExport} className="px-6 py-4 bg-white border-2 border-slate-100 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-all flex items-center gap-2">
                <Download className="w-4 h-4" /> Export Grades
            </button>
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="px-10 py-4 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-emerald-900/10 hover:bg-emerald-700 active:scale-95 transition-all flex items-center gap-2"
            >
              {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save Grades"}
            </button>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border-2 border-slate-50 overflow-hidden shadow-sm">
          <div className="overflow-x-auto text-left">
             <table className="w-full text-left">
                <thead className="bg-slate-50/50">
                    <tr>
                       <th className="px-8 py-7 text-[10px] font-black text-slate-400 uppercase tracking-widest">Student</th>
                       <th className="px-8 py-7 text-[10px] font-black text-slate-400 uppercase tracking-widest">Submitted</th>
                       <th className="px-8 py-7 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                       <th className="px-8 py-7 text-[10px] font-black text-slate-400 uppercase tracking-widest">Attachments</th>
                       <th className="px-8 py-7 text-[10px] font-black text-slate-400 uppercase tracking-widest">Grade</th>
                       <th className="px-8 py-7 text-[10px] font-black text-slate-400 uppercase tracking-widest">Feedback</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                   {loading ? (
                      [1,2,3,4].map(i => (
                         <tr key={i} className="animate-pulse">
                            <td colSpan={6} className="px-8 py-10"><div className="h-10 bg-slate-50 rounded-xl w-full" /></td>
                         </tr>
                      ))
                   ) : (
                      submissions.map((sub, idx) => (
                         <tr key={sub.id} className="hover:bg-slate-50/30 transition-colors group">
                            <td className="px-8 py-5">
                               <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xs font-black text-slate-500">{sub.name?.[0]}{sub.name?.split(' ')?.[1]?.[0] || ""}</div>
                                  <div className="text-left">
                                     <p className="text-sm font-black text-slate-800 uppercase italic leading-tight">{sub.name}</p>
                                     <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">Roll: {sub.rollNo}</p>
                                  </div>
                               </div>
                            </td>
                            <td className="px-8 py-5 text-slate-500 font-bold text-xs">{sub.submittedAt}</td>
                            <td className="px-8 py-5">
                               <span className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                                  sub.status === "On Time" ? "text-emerald-600 bg-emerald-50" : 
                                  sub.status === "Late" ? "text-amber-600 bg-amber-50" : "text-slate-300 bg-slate-50"
                               }`}>
                                  {sub.status}
                               </span>
                            </td>
                            <td className="px-8 py-5">
                               {sub.fileUrl ? (
                                  <a href={sub.fileUrl} target="_blank" rel="noreferrer" className="text-[10px] font-black text-blue-600 hover:underline uppercase tracking-tight flex items-center gap-2">
                                     <FileText className="w-3.5 h-3.5" /> {sub.attachment}
                                  </a>
                               ) : (
                                  <span className="text-slate-200 font-black">—</span>
                               )}
                            </td>
                            <td className="px-8 py-5">
                               <div className="flex items-center gap-2">
                                  <input 
                                    type="text" 
                                    value={sub.grade} 
                                    onChange={(e) => updateSub(sub.id, "grade", e.target.value)}
                                    placeholder="/100" 
                                    className="w-16 h-10 text-center bg-slate-50 border-none rounded-xl text-sm font-black text-[#1e3a8a] outline-none focus:ring-4 focus:ring-blue-50"
                                  />
                               </div>
                            </td>
                            <td className="px-8 py-5">
                               <input 
                                 type="text" 
                                 value={sub.feedback} 
                                 onChange={(e) => updateSub(sub.id, "feedback", e.target.value)}
                                 placeholder={sub.status === "Not Submitted" ? "Pending submission..." : "Enter feedback..."} 
                                 disabled={sub.status === "Not Submitted"}
                                 className="w-full h-10 px-4 bg-slate-50 border-none rounded-xl text-xs font-bold text-slate-600 outline-none focus:ring-4 focus:ring-blue-50"
                               />
                            </td>
                         </tr>
                      ))
                   )}
                </tbody>
             </table>
          </div>
      </div>
      <div className="mt-8 flex justify-start">
          <button onClick={onBack} className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-slate-600 transition-all flex items-center gap-2">
             <ChevronLeft className="w-4 h-4" /> Exit Grading Terminal
          </button>
      </div>
    </div>
  );
};

export default GradeAssignment;
