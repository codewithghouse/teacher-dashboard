import { useState, useEffect } from 'react';
import { ChevronLeft, Loader2, Download, FileText } from 'lucide-react';
import { db } from "../lib/firebase";
import {
  collection, query, where, doc, getDocs, serverTimestamp,
  type QueryConstraint, type Timestamp, type DocumentData,
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { auditedSet } from "../lib/auditedWrites";
import { getInitials } from "../lib/initials";
import { toast } from "sonner";
const loadXLSX = () => import("xlsx");

// Replace characters that are problematic in filenames across Windows/macOS/Linux.
const sanitizeFilename = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, "_").trim() || "assignment";

// Only http(s) URLs are safe to place in an anchor href — this blocks any
// `javascript:` / `data:` URL that might end up in a Firestore-stored value
// (whether via misconfigured rules or a migrated legacy record).
const isHttpUrl = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
};

// Normalize any Firestore/plain date representation to a Date, or null.
// Handles Firestore Timestamp (`.toDate()`), Date instances, numeric ms,
// and ISO/locale strings. Silently returns null for anything unparseable.
const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "object" && v !== null && typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
  }
  const d = new Date(v as string | number);
  return isNaN(d.getTime()) ? null : d;
};

interface AssignmentDoc {
  id: string;
  classId: string;
  deadline?: Date | string;
  dueDate?: Timestamp | Date | string;
  [key: string]: unknown;
}

interface SubmissionRow {
  id: string;
  name: string;
  rollNo: string;
  email: string;
  status: string;
  submittedAt: string;
  attachment: string;
  fileUrl: string | null;
  grade: number | string;
  feedback: string;
  isPlagiarized: boolean;
}

interface GradeAssignmentProps {
  assignment: AssignmentDoc;
  onBack: () => void;
}

const GradeAssignment = ({ assignment, onBack }: GradeAssignmentProps) => {
  const { teacherData } = useAuth();
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Wait for teacherData to resolve. Without an else-branch that clears
    // `loading`, a teacher whose schoolId never loads would see a perpetual
    // spinner — so explicitly stop loading when the guard trips.
    if (!assignment?.id || !teacherData?.id || !teacherData?.schoolId) {
      if (!teacherData) return; // still initializing auth
      setLoading(false);
      return;
    }

    const fetchEverything = async () => {
        setLoading(true);
        const schoolId = teacherData.schoolId as string;
        const branchId = teacherData?.branchId as string | undefined;
        const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
        if (branchId) SC.push(where("branchId", "==", branchId));

        try {
            // Fire all four independent queries in parallel. Previously these
            // ran serially which tripled teacher-perceived load time on slow
            // connections.
            const enrolQ = query(
                collection(db, "enrollments"),
                ...SC,
                where("classId", "==", assignment.classId),
            );
            const gradesQ = query(collection(db, "results"), ...SC, where("assignmentId", "==", assignment.id));
            const subsByHomeworkQ = query(collection(db, "submissions"), ...SC, where("homeworkId", "==", assignment.id));
            const subsByAssignQ = query(collection(db, "submissions"), ...SC, where("assignmentId", "==", assignment.id));

            const [rosterSnap, gradeSnap, subSnapByHomework, subSnapByAssign] = await Promise.all([
              getDocs(enrolQ),
              getDocs(gradesQ),
              getDocs(subsByHomeworkQ),
              getDocs(subsByAssignQ),
            ]);

            const gradeMap = new Map<string, DocumentData>();
            gradeSnap.docs.forEach(d => gradeMap.set(d.data().studentId, d.data()));

            // DUAL LOOKUP — homeworkId wins over assignmentId (older records).
            const subMap = new Map<string, DocumentData & { _docId: string }>();
            subSnapByHomework.docs.forEach(d => {
                const data = d.data();
                const key = data.studentId || data.studentEmail;
                if (key) subMap.set(key, { ...data, _docId: d.id });
            });
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
            console.error("[GradeAssignment] roster load failed", e);
            toast.error("Institutional audit failed to load roster.");
        } finally {
            setLoading(false);
        }
    };

    fetchEverything();
  }, [assignment?.id, assignment?.classId, teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  const updateSub = (id: string, field: keyof SubmissionRow, value: unknown) => {
    if (field === "grade" && value !== "") {
      // Reject any input that isn't a finite number in [0, 100]. Previously
      // non-numeric strings (e.g. "abc") slipped through because the guard
      // only fired when parseFloat succeeded *and* was out of range.
      const num = parseFloat(String(value));
      if (!Number.isFinite(num) || num < 0 || num > 100) return;
    }
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleExport = async () => {
     if (submissions.length === 0) { toast.info("No logs to export."); return; }
     try {
        const XLSX = await loadXLSX();
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
        const title = typeof assignment.title === "string" ? assignment.title : "assignment";
        XLSX.writeFile(wb, `${sanitizeFilename(title)}_Grades_Audit.xlsx`);
        toast.success("Institutional logs exported to Excel.");
     } catch (e) {
        console.error("[GradeAssignment] export failed", e);
        toast.error("Export protocol failure.");
     }
  };

  const handleSave = async () => {
    const parsedGrades = submissions.map(s => ({
      sub: s,
      entered: s.grade !== "" && s.grade != null,
      num: parseFloat(String(s.grade)),
    }));
    const invalidGrades = parsedGrades.filter(p => p.entered && (!Number.isFinite(p.num) || p.num < 0 || p.num > 100));
    if (invalidGrades.length > 0) {
      toast.error(`Invalid grades detected for: ${invalidGrades.map(p => p.sub.name).join(", ")}. Must be 0-100.`);
      return;
    }
    // Refuse to stamp a placeholder className onto every result doc — that
    // poisons downstream reporting. Require the caller to pass the real one.
    const className = typeof assignment.className === "string" ? assignment.className : "";
    if (!className) {
      console.error("[GradeAssignment] missing assignment.className — refusing to save with placeholder");
      toast.error("Class information missing. Please reopen the assignment.");
      return;
    }

    setIsSaving(true);
    try {
        const rowsToSave = parsedGrades.filter(p => p.entered);
        const results = await Promise.allSettled(rowsToSave.map(({ sub, num }) => {
            const resRef = doc(db, "results", `${sub.id}_${assignment.id}`);
            return auditedSet(resRef, {
                studentId: sub.id,
                studentName: sub.name,
                studentEmail: sub.email,
                homeworkId: assignment.id, // Renamed from assignmentId to differentiate from teaching_assignment
                assignmentId: (assignment as DocumentData).assignmentId || "legacy", // Enforced Phase 1 spec: tracking the teaching_assignment
                assignmentTitle: (assignment as DocumentData).title,
                classId: assignment.classId,
                className,
                score: Number.isFinite(num) ? num : sub.grade,
                feedback: sub.feedback,
                isPlagiarized: sub.isPlagiarized || false,
                teacherId: teacherData.id,
                teacherName: teacherData.name,
                schoolId: teacherData.schoolId,
                branchId: teacherData.branchId || "",
                timestamp: serverTimestamp(),
                category: "Assignment",
                type: "score",
            });
        }));
        const failed = results
          .map((r, i) => ({ r, name: rowsToSave[i].sub.name }))
          .filter(x => x.r.status === "rejected");
        if (failed.length > 0) {
          console.error("[GradeAssignment] partial save failure", failed);
          toast.error(`Saved ${rowsToSave.length - failed.length}/${rowsToSave.length}. Failed: ${failed.map(f => f.name).join(", ")}`);
          return;
        }
        toast.success("Institutional mastery logs published successfully.");
        onBack();
    } catch (e) {
        console.error("[GradeAssignment] save failed", e);
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
          <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 mb-2 transition-colors">
            <ChevronLeft size={14} aria-hidden="true" /> Back to Assignments
          </button>
          <h1 className="text-2xl font-bold text-slate-800">Grade: {assignment?.title}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {String((assignment as DocumentData)?.className ?? "")} • {submissions.filter(s => s.status !== "Not Submitted").length} submissions • Due: {(() => {
              const d = toDate(assignment?.deadline ?? assignment?.dueDate);
              return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
            })()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl" style={{ boxShadow: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)", border: "0.5px solid rgba(0,85,255,0.07)" }}>
            <span className="text-xs text-slate-400 font-medium">Progress</span>
            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="text-xs font-semibold text-slate-700">{gradedCount}/{totalRoster}</span>
          </div>
          <button type="button" onClick={handleExport} className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2 shadow-sm">
            <Download size={14} aria-hidden="true" /> Export
          </button>
          <button type="button"
            onClick={handleSave}
            disabled={isSaving}
            aria-label={isSaving ? "Saving grades" : "Save grades"}
            className="px-5 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : "Save Grades"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)", border: "0.5px solid rgba(0,85,255,0.07)" }}>
          <div className="overflow-x-auto text-left">
             <table className="w-full text-left" aria-label="Grade entries">
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
                                  <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 flex-shrink-0" aria-hidden="true">
                                    {getInitials(sub.name, "?")}
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
                               {isHttpUrl(sub.fileUrl) ? (
                                  <a href={sub.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                                     <FileText size={12} aria-hidden="true" /> {sub.attachment}
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
                                 aria-label={`Grade for ${sub.name}`}
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
                                 aria-label={`Feedback for ${sub.name}`}
                                 className="w-full h-8 px-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-40"
                               />
                            </td>
                         </tr>
                      ))
                   )}
                   {!loading && submissions.length === 0 && (
                     <tr>
                       <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-400">
                         No students enrolled in this class yet.
                       </td>
                     </tr>
                   )}
                </tbody>
             </table>
          </div>
      </div>
    </div>
  );
};

export default GradeAssignment;
