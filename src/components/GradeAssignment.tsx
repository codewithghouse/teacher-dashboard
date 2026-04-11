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
        const schoolId = teacherData?.schoolId as string | undefined;
        const branchId = teacherData?.branchId as string | undefined;
        const SC: any[] = [];
        if (schoolId) SC.push(where("schoolId", "==", schoolId));
        if (branchId) SC.push(where("branchId", "==", branchId));

        try {
            // 1. Get Enrollments (Class Roster) — scoped by school
            const enrolQ = query(
                collection(db, "enrollments"),
                where("classId", "==", assignment.classId),
                ...SC
            );
            const rosterSnap = await getDocs(enrolQ);

            // 2. Get existing results — scoped by school
            const qGrades = query(collection(db, "results"), where("assignmentId", "==", assignment.id), ...SC);
            const gradeSnap = await getDocs(qGrades);
            const gradeMap = new Map();
            gradeSnap.docs.forEach(d => gradeMap.set(d.data().studentId, d.data()));

            // 3. Get Student Submissions — DUAL LOOKUP (scoped by school)
            const subMap = new Map();

            // Query by homeworkId (the assignment's actual doc ID) — this is what parent saves
            const qSubsByHomework = query(collection(db, "submissions"), where("homeworkId", "==", assignment.id), ...SC);
            const subSnapByHomework = await getDocs(qSubsByHomework);
            subSnapByHomework.docs.forEach(d => {
                const data = d.data();
                const key = data.studentId || data.studentEmail;
                if (key) subMap.set(key, { ...data, _docId: d.id });
            });

            // Also query by assignmentId as fallback (for older records)
            const qSubsByAssign = query(collection(db, "submissions"), where("assignmentId", "==", assignment.id), ...SC);
            const subSnapByAssign = await getDocs(qSubsByAssign);
            subSnapByAssign.docs.forEach(d => {
                const data = d.data();
                const key = data.studentId || data.studentEmail;
                if (key && !subMap.has(key)) subMap.set(key, { ...data, _docId: d.id });
            });


            const roster = rosterSnap.docs.map(d => {
                const data = d.data() as any;
                const sId = data.studentId || d.id;
                const sEmail = data.studentEmail || "";
                const existing = gradeMap.get(sId);
                // Check by studentId OR by email (student may be keyed differently)
                const sub = subMap.get(sId) || subMap.get(sEmail) || subMap.get(sEmail.toLowerCase());
                
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
                    rollNo: data.rollNo || "—",
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
    if (field === "grade" && value !== "") {
      const num = parseFloat(value);
      if (!isNaN(num) && (num < 0 || num > 100)) return;
    }
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
    const invalidGrades = submissions.filter(s => s.grade !== "" && (isNaN(parseFloat(s.grade)) || parseFloat(s.grade) < 0 || parseFloat(s.grade) > 100));
    if (invalidGrades.length > 0) {
      toast.error(`Invalid grades detected for: ${invalidGrades.map(s => s.name).join(", ")}. Must be 0-100.`);
      return;
    }
    setIsSaving(true);
    try {
        const promises = submissions.filter(s => s.grade !== "").map(sub => {
            const resRef = doc(db, "results", `${sub.id}_${assignment.id}`);
            return setDoc(resRef, {
                studentId: sub.id,
                studentName: sub.name,
                studentEmail: sub.email,
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
                schoolId: teacherData.schoolId,
                branchId: teacherData.branchId || "",
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
    <div className="text-left space-y-6 pb-10">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 mb-2 transition-colors">
            <ChevronLeft size={14} /> Back to Assignments
          </button>
          <h1 className="text-2xl font-bold text-slate-800">Grade: {assignment?.title}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {assignment?.className} • {submissions.filter(s => s.status !== "Not Submitted").length} submissions • Due: {assignment?.deadline?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) || "—"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-sm">
            <span className="text-xs text-slate-400 font-medium">Progress</span>
            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="text-xs font-semibold text-slate-700">{gradedCount}/{totalRoster}</span>
          </div>
          <button onClick={handleExport} className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2 shadow-sm">
            <Download size={14} /> Export
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Grades"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto text-left">
             <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-slate-100">
                       <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-left">Student</th>
                       <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-left">Submitted</th>
                       <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-left">Status</th>
                       <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-left">Attachment</th>
                       <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-left">Grade /100</th>
                       <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-left">Feedback</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {loading ? (
                      [1,2,3].map(i => (
                         <tr key={i}>
                            <td colSpan={6} className="px-6 py-4"><div className="h-8 bg-slate-100 rounded-lg animate-pulse" /></td>
                         </tr>
                      ))
                   ) : (
                      submissions.map(sub => (
                         <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                               <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 flex-shrink-0">
                                    {(sub.name || "").substring(0,2).toUpperCase()}
                                  </div>
                                  <div>
                                     <p className="text-sm font-semibold text-slate-800">{sub.name}</p>
                                     <p className="text-xs text-slate-400">Roll: {sub.rollNo}</p>
                                  </div>
                               </div>
                            </td>
                            <td className="px-6 py-4 text-xs text-slate-500">{sub.submittedAt}</td>
                            <td className="px-6 py-4">
                               <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                                  sub.status === "On Time"        ? "bg-emerald-50 text-emerald-700" :
                                  sub.status === "Late"           ? "bg-amber-50 text-amber-700"   :
                                                                    "bg-slate-100 text-slate-400"
                               }`}>
                                  {sub.status}
                               </span>
                            </td>
                            <td className="px-6 py-4">
                               {sub.fileUrl ? (
                                  <a href={sub.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                                     <FileText size={12} /> {sub.attachment}
                                  </a>
                               ) : (
                                  <span className="text-slate-300 text-xs">—</span>
                               )}
                            </td>
                            <td className="px-6 py-4">
                               <input
                                 type="number"
                                 min="0" max="100"
                                 value={sub.grade}
                                 onChange={e => updateSub(sub.id, "grade", e.target.value)}
                                 placeholder="—"
                                 className="w-16 h-8 text-center bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-[#1e3272] outline-none focus:ring-2 focus:ring-blue-100"
                               />
                            </td>
                            <td className="px-6 py-4">
                               <input
                                 type="text"
                                 value={sub.feedback}
                                 onChange={e => updateSub(sub.id, "feedback", e.target.value)}
                                 placeholder={sub.status === "Not Submitted" ? "Not submitted" : "Add feedback..."}
                                 disabled={sub.status === "Not Submitted"}
                                 className="w-full h-8 px-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-40"
                               />
                            </td>
                         </tr>
                      ))
                   )}
                </tbody>
             </table>
          </div>
      </div>
    </div>
  );
};

export default GradeAssignment;
