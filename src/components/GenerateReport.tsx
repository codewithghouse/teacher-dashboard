import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  FileText, Download, Loader2, Calendar, Sparkles, BrainCircuit, 
  CheckCircle2, AlertTriangle, RefreshCw, Layers, UserCircle, Search, 
  BarChart3, PieChart, TrendingUp, Presentation, Clock, Info, BookOpen, 
  ShieldCheck, Activity, Target, ArrowUpRight, GraduationCap, ShieldAlert,
  Bot, Table2 as TableIcon
} from "lucide-react";
import { toast } from "sonner";
import { AIController } from "../ai/controller/ai-controller";
import { db } from "../lib/firebase";
import { collection, query, where, getDocs, serverTimestamp, doc } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { auditedAdd, auditedUpdate } from "../lib/auditedWrites";
const loadXLSX = () => import("xlsx");
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import StudentProfile from "./StudentProfile";

interface GenerateReportProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  report: any;
}

const GenerateReport = ({ isOpen, onOpenChange, report }: GenerateReportProps) => {
  const { teacherData } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportResult, setReportResult] = useState<any>(null);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [roster, setRoster] = useState<any[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [params, setParams] = useState({
    classId: "",
    grade: "",
    studentId: "",
    format: "pdf"
  });

  useEffect(() => {
    if (isOpen) {
      setReportResult(null);
      setIsSent(false);
      setCurrentReportId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId || !isOpen) return;
    const schoolId = teacherData.schoolId;
    const fetchInstitutionalData = async () => {
       try {
         const q1 = query(collection(db, "teaching_assignments"), where("schoolId", "==", schoolId), where("teacherId", "==", teacherData.id));
         const q2 = query(collection(db, "classes"), where("schoolId", "==", schoolId), where("teacherId", "==", teacherData.id));

         const [asgnSnap, clsSnap] = await Promise.all([getDocs(q1), getDocs(q2)]);
         const combined = [...asgnSnap.docs.map(d => ({id: d.id, ...d.data()})), ...clsSnap.docs.map(d => ({id: d.id, ...d.data()}))];

         const map = new Map();
         combined.forEach((c:any) => {
            const id = c.classId || c.id;
            if(!map.has(id)) map.set(id, { id: c.id, classId: id, name: c.className || c.name, subject: c.subjectName || c.subject, grade: c.grade });
         });
         setClasses(Array.from(map.values()));

         const qEnrol = query(collection(db, "enrollments"), where("schoolId", "==", schoolId), where("teacherId", "==", teacherData.id));
         const enrolSnap = await getDocs(qEnrol);
         setRoster(enrolSnap.docs.map(d => ({ id: d.id, ...d.data() })));
       } catch (error) {
         console.error("Critical Registry Load Failure:", error);
       }
    };
    fetchInstitutionalData();
  }, [teacherData?.id, teacherData?.schoolId, isOpen]);

  const handleGenerate = async () => {
    if (!params.classId) return toast.error("Please identify a class subdivision.");
    if (report?.id === "individual_progress" && !params.studentId) return toast.error("Please select a target student.");
    if (!teacherData?.schoolId || !teacherData?.id) return toast.error("School identity missing — please re-login.");

    setIsGenerating(true);
    setReportResult(null);

    try {
       const schoolId = teacherData.schoolId as string;
       const selectedClass = classes.find(c => c.classId === params.classId || c.id === params.classId);
       const targetClassId = selectedClass?.classId || params.classId;
       let filteredRoster = roster.filter(s => s.classId === targetClassId);

       if (filteredRoster.length === 0) throw new Error("No students enrolled in this class yet.");
       const [allAtt, allScores, allResults, allNotes] = await Promise.all([
          getDocs(query(collection(db, "attendance"), where("schoolId", "==", schoolId), where("classId", "==", targetClassId))),
          getDocs(query(collection(db, "gradebook_scores"), where("schoolId", "==", schoolId), where("classId", "==", targetClassId))),
          getDocs(query(collection(db, "results"), where("schoolId", "==", schoolId), where("classId", "==", targetClassId))),
          getDocs(query(collection(db, "parent_notes"), where("schoolId", "==", schoolId), where("teacherId", "==", teacherData.id)))
       ]);

       const attDocs = allAtt.docs.map(d => d.data());
       const gradeDocs = allScores.docs.map(d => d.data());
       const resultDocs = allResults.docs.map(d => d.data());
       const noteDocs = allNotes.docs.map(d => d.data());

       const enrichedPerformance = filteredRoster.map((student: any) => {
          const sId = student.studentId;
          const sEmail = student.studentEmail?.toLowerCase();
          const filterByStudent = (arr: any[]) => arr.filter(item =>
             (sId && (item.studentId === sId || item.id?.includes(sId))) || (sEmail && item.studentEmail?.toLowerCase() === sEmail)
          );

          const sAtt = filterByStudent(attDocs);
          const sGrades = [...filterByStudent(gradeDocs), ...filterByStudent(resultDocs)];
          const sNotes = filterByStudent(noteDocs);

          const hasAtt    = sAtt.length > 0;
          const present   = sAtt.filter(a => a.status === 'present' || a.status === 'late').length;
          const atndRate  = hasAtt ? (present / sAtt.length) * 100 : 0;

          const getPct = (sc: any) => Number(sc.percentage || (sc.mark/sc.maxMarks*100) || (sc.score || 0));
          const scores = sGrades.map(getPct).filter(v => v >= 0);
          const hasScores = scores.length > 0;
          const avgScore  = hasScores ? (scores.reduce((a,b)=>a+b,0) / scores.length) : 0;

          const hasNegNote = sNotes.some((n:any) => {
             const text = (n.content || "").toLowerCase();
             return text.includes("issue") || text.includes("distraction") || text.includes("trouble") || text.includes("weak");
          });

          return {
             studentId: sId,
             name: student.studentName,
             rollNo: student.rollNo,
             email: student.studentEmail,
             score: Math.round(avgScore),
             attendance: Math.round(atndRate),
             hasAtt,
             hasScores,
             hasNegNote,
             standing: !hasScores ? "No Data" : avgScore > 85 ? "Excellence" : avgScore > 65 ? "Stable" : "Critical",
          };
       });

       // Class-level averages: only count students who actually have data
       const studentsWithScores = enrichedPerformance.filter(s => s.hasScores);
       const studentsWithAtt    = enrichedPerformance.filter(s => s.hasAtt);
       const classAvg  = studentsWithScores.length > 0
          ? Math.round(studentsWithScores.reduce((acc, s) => acc + s.score, 0) / studentsWithScores.length)
          : 0;
       const classAtnd = studentsWithAtt.length > 0
          ? Math.round(studentsWithAtt.reduce((acc, s) => acc + s.attendance, 0) / studentsWithAtt.length)
          : 0;

       let resultData: any = {};
       const contextStr = enrichedPerformance.map(s => `${s.name}: ${s.score}% (${s.attendance}% ATND)`).join(", ");

       if (report.id === "class_perf") {
          const aiResponse = await AIController.getDetailedSubjectReport({
             subject: selectedClass?.subject || "Curriculum",
             grade: selectedClass?.grade || "N/A",
             avg_score: classAvg,
             struggles: enrichedPerformance.filter(s => s.score < 60).map(s => s.name),
             mastery_level: classAvg > 80 ? "Proficient" : "Progressing",
             context: contextStr
          });
          resultData = {
              isClassReport: true,
              subject: selectedClass?.subject || "Subject",
              className: selectedClass?.name,
              aiRemarks: aiResponse?.data?.report_content
                 || (studentsWithScores.length > 0
                    ? `Class engagement remains stable at ${classAvg}%.`
                    : `No test scores recorded yet for this class — report will populate once grades are entered.`),
              chartData: studentsWithScores.map(s => ({ name: s.name.split(' ')[0], score: s.score, atnd: s.attendance })),
              summary: {
                 avg:        studentsWithScores.length > 0 ? `${classAvg}%`  : "N/A",
                 attendance: studentsWithAtt.length    > 0 ? `${classAtnd}%` : "N/A",
                 mastery:    studentsWithScores.length === 0 ? "No Data" : classAvg > 80 ? "Distinction" : "Standard"
              },
              fullList: enrichedPerformance,
              studentsWithScoresCount: studentsWithScores.length,
              studentsWithAttCount: studentsWithAtt.length,
              totalStudents: enrichedPerformance.length,
          };
       } else if (report.id === "individual_progress") {
          const sel = enrichedPerformance.find(s => (s.studentId === params.studentId || s.email?.toLowerCase() === params.studentId?.toLowerCase())) || enrichedPerformance[0];
          const aiResponse = await AIController.getIndividualProgressReport({ student_name: sel.name, subject: selectedClass?.subject || "General", score: sel.score, attendance: sel.attendance });

          // Extra fetches for rich individual card
          const [extraStudentSnap, feesSnap, incidentSnap, pfSnap] = await Promise.all([
             getDocs(query(collection(db, "students"), where("schoolId", "==", schoolId), where("studentId", "==", sel.studentId))).catch(() => ({ docs: [] as any[] })),
             getDocs(query(collection(db, "fees"), where("schoolId", "==", schoolId), where("studentId", "==", sel.studentId))).catch(() => ({ docs: [] as any[] })),
             getDocs(query(collection(db, "incidents"), where("schoolId", "==", schoolId), where("studentId", "==", sel.studentId))).catch(() => ({ docs: [] as any[] })),
             getDocs(query(collection(db, "performance_feedback"), where("schoolId", "==", schoolId), where("studentId", "==", sel.studentId))).catch(() => ({ docs: [] as any[] })),
          ]);

          const studentDoc = (extraStudentSnap.docs as any[])[0]?.data() || {};
          const genderRaw = (studentDoc.gender || studentDoc.sex || "male").toLowerCase();
          const gender = genderRaw.startsWith("f") || genderRaw === "girl" ? "female" : "male";
          const dob = studentDoc.dob || studentDoc.dateOfBirth || studentDoc.birthDate || "";
          const age: string | number = dob
             ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
             : studentDoc.age || "—";

          const feeDocs = (feesSnap.docs as any[]).map(d => d.data());
          const totalFee = feeDocs.reduce((s: number, f: any) => s + (f.amount || f.totalAmount || f.feeAmount || 0), 0);
          const paidFee  = feeDocs.reduce((s: number, f: any) => s + (f.paidAmount || f.collectedAmount || (f.status === "paid" ? (f.amount || f.totalAmount || 0) : 0)), 0);
          const pendingFee = Math.max(0, totalFee - paidFee);
          const paidDocs = feeDocs.filter((f: any) => f.paidAmount > 0 || f.collectedAmount > 0 || f.status === "paid");
          const lastPayDate = paidDocs.length > 0
             ? (paidDocs[paidDocs.length - 1].paidDate || paidDocs[paidDocs.length - 1].updatedAt || "").substring(0, 10)
             : "—";

          const incidents = (incidentSnap.docs as any[]).map(d => d.data());
          const warnings   = incidents.filter((i: any) => (i.type || "").toLowerCase().includes("warn") || i.severity === "warning").length;
          const detentions = incidents.filter((i: any) => (i.type || "").toLowerCase().includes("detent")).length;

          const pfDocs = (pfSnap.docs as any[]).map(d => d.data());
          const positiveRemarks = pfDocs.filter((f: any) => {
             const t = (f.content || f.feedback || f.remark || "").toLowerCase();
             return t.includes("good") || t.includes("excel") || t.includes("great") || t.includes("well") || t.includes("positive");
          }).length;

          const rawSkills = studentDoc.skills || studentDoc.activities || studentDoc.extracurricular || [];
          const skills: string[] = Array.isArray(rawSkills) ? rawSkills : typeof rawSkills === "string" ? rawSkills.split(",").map((s: string) => s.trim()).filter(Boolean) : [];

          const selNotes = noteDocs.filter((n: any) => n.studentId === sel.studentId || (sel.email && n.studentEmail?.toLowerCase() === sel.email?.toLowerCase()));
          const latestPf = pfDocs[pfDocs.length - 1];
          const teacherNote = latestPf?.content || latestPf?.feedback || latestPf?.remark || selNotes[selNotes.length - 1]?.content || "";

          const parentContacts = selNotes.slice(-3).map((n: any) => ({
             label: (n.type === "meeting" || (n.content || "").toLowerCase().includes("meet")) ? "Meeting" : "Call",
             date: n.date || (n.createdAt?.toDate?.()?.toLocaleDateString("en-US", { month: "short", day: "numeric" })) || "",
             content: (n.content || "").substring(0, 50),
          }));

          // AI remark only mentions numbers we actually have
          const remarkParts: string[] = [];
          if (sel.hasScores) remarkParts.push(`score of ${sel.score}%`);
          if (sel.hasAtt)    remarkParts.push(`attendance of ${sel.attendance}%`);
          const defaultRemark = remarkParts.length > 0
             ? `${sel.name} currently has ${remarkParts.join(" and ")}.`
             : `No academic or attendance data recorded for ${sel.name} yet — report will populate once data is entered.`;

          // Risk level honest: only compute when we have data
          const riskLevel = (!sel.hasScores && !sel.hasAtt)
             ? "NO DATA"
             : sel.hasScores && sel.hasAtt && sel.score >= 75 && sel.attendance >= 80
                ? "LOW"
                : sel.hasScores && sel.score >= 60
                   ? "MODERATE"
                   : "HIGH";

          // Prediction only when we have a baseline
          const predictedScore = sel.hasScores
             ? Math.min(100, Math.round(sel.score + Math.max(0, (100 - sel.score) * 0.05)))
             : null;

          resultData = {
             isIndividual: true,
             profileStudent: {
                id: sel.studentId,
                studentId: sel.studentId,
                email: sel.email,
                studentEmail: sel.email,
                name: sel.name,
                studentName: sel.name,
                rollNo: sel.rollNo || studentDoc.rollNo || "",
                className: selectedClass?.name || "",
                classId: selectedClass?.classId || params.classId,
             },
             student_name: sel.name,
             score: sel.score,
             atnd: sel.attendance,
             hasScores: sel.hasScores,
             hasAtt:    sel.hasAtt,
             standing: sel.standing,
             ai_remark: aiResponse?.data?.report_content || defaultRemark,
             gender, age,
             grade: studentDoc.grade || studentDoc.class || selectedClass?.grade || "—",
             rollNo: sel.rollNo || studentDoc.rollNo || studentDoc.studentId?.substring(0, 8) || "—",
             className: selectedClass?.name || "—",
             subject: selectedClass?.subject || "—",
             pendingFee, lastPayDate, totalFee, paidFee,
             warnings, detentions, positiveRemarks,
             skills, teacherNote, parentContacts,
             predictedScore, riskLevel,
          };
       } else if (report.id === "attendance_summary") {
          resultData = {
             isClassReport: true,
             isAttendance: true,
             className: selectedClass?.name,
             summary: {
                avg:        studentsWithScores.length > 0 ? `${classAvg}%`  : "N/A",
                attendance: studentsWithAtt.length    > 0 ? `${classAtnd}%` : "N/A",
                mastery:    studentsWithAtt.length === 0 ? "No Data" : classAtnd > 90 ? "Excellent" : "Standard",
             },
             fullList: enrichedPerformance,
             lowAttendance: enrichedPerformance
                .filter(s => s.hasAtt && s.attendance < 80)
                .map(s => ({ name: s.name, rate: s.attendance })),
             aiRemarks: studentsWithAtt.length > 0
                ? `Attendance is sitting at ${classAtnd}%.`
                : `No attendance records yet for this class — summary will populate once attendance is marked.`,
             studentsWithAttCount: studentsWithAtt.length,
             totalStudents: enrichedPerformance.length,
          };
       } else {
          // at-risk: only flag students for reasons supported by actual data
          const atRisk = enrichedPerformance.filter(s =>
             (s.hasScores && s.score < 60) ||
             (s.hasAtt    && s.attendance < 75) ||
             s.hasNegNote
          );
          resultData = {
             isClassReport: true,
             isAtRisk: true,
             className: selectedClass?.name,
             atRiskList: atRisk,
             aiRemarks: atRisk.length > 0
                ? `Intervention Protocol: ${atRisk.length} scholar${atRisk.length !== 1 ? "s" : ""} flagged based on scores, attendance, or teacher notes.`
                : `No at-risk students detected in this class.`,
             studentsWithDataCount: enrichedPerformance.filter(s => s.hasScores || s.hasAtt).length,
             totalStudents: enrichedPerformance.length,
          };
       }

       const firestorePayload: any = {
          schoolId,
          teacherId: teacherData.id || "unknown",
          teacherName: teacherData.name || "Faculty",
          studentId: params.studentId || "all",
          studentName: report.id === "individual_progress" ? (resultData.student_name || "Scholar") : "Class Registry",
          classId: targetClassId || params.classId || "unknown",
          type: report.id || "general",
          title: report.title || "Academic Report",
          grade: selectedClass?.grade || "N/A",
          className: selectedClass?.name || "General Registry",
          createdAt: serverTimestamp(),
          status: "Draft",
          format: params.format || "pdf",
          data: JSON.parse(JSON.stringify(resultData)) // Deep-strip all undefineds
       };
       if (teacherData.branchId) firestorePayload.branchId = teacherData.branchId;

       const docRef = await auditedAdd(collection(db, "reports"), firestorePayload);

       setCurrentReportId(docRef.id);
       setIsSent(false);
       setReportResult(resultData);
       toast.success("Intelligence Harvest Complete!");
    } catch (e: unknown) {
       console.error("[GenerateReport] report generation failed", e);
       const err = e as { code?: string; message?: string } | null;
       const msg = err?.code === "permission-denied"
         ? "Permission denied — check your school access."
         : err?.message || "Harvesting failure.";
       toast.error(msg);
    } finally {
       setIsGenerating(false);
    }
  };

  const handleSendToPortal = async (portal: "parent" | "principal" | "both") => {
    if (!currentReportId) return;
    setIsSending(true);
    try {
       const isToParent = portal === "parent" || portal === "both";
       const isToPrincipal = portal === "principal" || portal === "both";

       await auditedUpdate(doc(db, "reports", currentReportId), {
          status: portal === "both" ? "Global Broadcast Complete" : (portal === "parent" ? "Synced to Parent" : "Reported to Principal"),
          publishedToParent: isToParent,
          sentToPrincipal: isToPrincipal,
          sentAt: serverTimestamp()
       });

       if (isToPrincipal) {
          if (!teacherData?.schoolId) throw new Error("School identity missing — cannot route to principal.");
          const prPayload: Record<string, unknown> = {
             teacherId: teacherData.id || "unknown",
             teacherName: teacherData.name || "Faculty",
             schoolId: teacherData.schoolId,
             reportId: currentReportId,
             reportType: (report.id || "general").toUpperCase(),
             title: `${report.title || "Report"} - ${reportResult.className || "Class"}`,
             content: reportResult.aiRemarks || reportResult.ai_remark || "Intelligence Manifest Attached.",
             metrics: {
                avgScore: reportResult.summary?.avg || reportResult.score || 0,
                attendanceRate: reportResult.summary?.attendance || reportResult.atnd || 0,
                flaggedCount: reportResult.atRiskList?.length || reportResult.lowAttendance?.length || 0
             },
             createdAt: serverTimestamp()
          };
          if (teacherData.branchId) prPayload.branchId = teacherData.branchId;
          await auditedAdd(collection(db, "principal_reports"), prPayload);
       }

       setIsSent(true);
       toast.success(portal === "both" ? "Global Infrastructure Sync Complete!" : "Registry Mirror Updated.");
    } catch (e: unknown) {
       console.error("[GenerateReport] portal sync failed", e);
       toast.error("Mirror sync error.");
    } finally {
       setIsSending(false);
    }
  };

  const handleDownload = async () => {
     if (params.format === 'excel') {
        const XLSX = await loadXLSX();

        const ws = XLSX.utils.json_to_sheet(reportResult.fullList || [reportResult]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Institutional Merit");
        XLSX.writeFile(wb, `Intellect_Report_${report.id}.xlsx`);
     } else {
        window.print();
     }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1150px] overflow-hidden p-0 rounded-[3rem] border-none shadow-2xl font-sans text-left print:shadow-none print:w-full">
        <div className="bg-slate-50/50 p-12 max-h-[90vh] overflow-y-auto custom-scrollbar print:bg-white print:max-h-full print:p-0 print:overflow-visible">
          
          <div className="print:hidden">
            <DialogHeader className="mb-8 text-left">
                <div className={`w-16 h-16 rounded-[2rem] flex items-center justify-center mb-10 shadow-2xl bg-white border border-slate-100`}>
                    {report && <report.icon className="w-8 h-8 text-[#1e3272]" />}
                </div>
                <DialogTitle className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none group">
                Intelligence <span className="text-[#1e3272]">Manifest</span>
                </DialogTitle>
                <DialogDescription className="text-slate-400 font-bold uppercase tracking-[0.3em] text-[11px] mt-4 flex items-center gap-3">
                   <ShieldCheck className="w-4 h-4 text-emerald-500"/> Verified Registry Source • Neural Link Active
                </DialogDescription>
            </DialogHeader>
          </div>

          {!reportResult ? (
             <div className="space-y-10 mt-14 print:hidden text-left animate-in fade-in slide-in-from-bottom-8 duration-700">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                   <div className="space-y-4">
                      <Label className="text-[11px] font-black uppercase text-slate-500 tracking-widest ml-2 flex items-center gap-2"><Layers className="w-4 h-4" /> Subdivision Node</Label>
                      <Select value={params.classId} onValueChange={(val) => setParams({ ...params, classId: val })}>
                        <SelectTrigger className="rounded-[1.5rem] h-20 border border-slate-100 bg-white font-black text-slate-800 flex items-center px-8 shadow-sm">
                           <SelectValue placeholder="Identify Portal..." />
                        </SelectTrigger>
                        <SelectContent className="rounded-[2rem] p-4 border-slate-100 shadow-2xl">
                            {classes.map(c => (
                              <SelectItem key={c.id} value={c.classId} className="rounded-2xl font-black p-4 mb-2 hover:bg-slate-50">
                                 <div className="flex flex-col text-left">
                                    <span className="text-lg uppercase italic tracking-tighter">{c.name}</span>
                                    <span className="text-[9px] text-slate-300 uppercase tracking-widest">{c.subject} • {c.grade} Registry</span>
                                 </div>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                   </div>
                   {(report?.id === "individual_progress" || report?.id === "attendance_summary") && (
                     <div className="space-y-4">
                        <Label className="text-[11px] font-black uppercase text-slate-500 tracking-widest ml-2 flex items-center gap-2"><UserCircle className="w-4 h-4" /> Scholar Target</Label>
                        <Select value={params.studentId} onValueChange={(val) => setParams({ ...params, studentId: val })}>
                          <SelectTrigger className="rounded-[1.5rem] h-20 border border-slate-100 bg-white font-black text-slate-800 px-8 shadow-sm">
                             <SelectValue placeholder="Locate Identity..." />
                          </SelectTrigger>
                          <SelectContent className="rounded-[2rem] p-4 border-slate-100 shadow-2xl">
                             <SelectItem value="all" className="rounded-2xl font-black p-4 mb-2 italic text-indigo-500">Universal Class Manifest</SelectItem>
                             {roster.filter(s => s.classId === params.classId || !params.classId).map(s => (
                               <SelectItem key={s.id} value={s.studentId} className="rounded-2xl font-black p-4 mb-2">{s.studentName}</SelectItem>
                             ))}
                          </SelectContent>
                        </Select>
                     </div>
                   )}
                </div>
                <div className="space-y-4">
                  <Label className="text-[11px] font-black uppercase text-slate-500 tracking-widest ml-2">Export Foundation</Label>
                  <div className="flex gap-6">
                    {['pdf', 'excel'].map((f) => (
                      <button key={f} onClick={() => setParams({ ...params, format: f })} className={`flex-1 h-20 rounded-[1.8rem] border-[3px] text-[12px] font-black uppercase tracking-widest transition-all ${params.format === f ? 'bg-[#1e3272] text-white border-[#1e3272] shadow-2xl' : 'bg-white text-slate-300 border-slate-50 hover:border-slate-200'}`}>
                        {f === 'pdf' ? <div className="flex items-center justify-center gap-3"><FileText size={20}/> Print PDF</div> : <div className="flex items-center justify-center gap-3"><TableIcon size={20}/> Excel Ledger</div>}
                      </button>
                    ))}
                  </div>
                </div>
                <DialogFooter className="pt-10">
                  <button onClick={handleGenerate} disabled={isGenerating} className="w-full h-24 rounded-[2.5rem] bg-[#1e3272] text-white text-[13px] font-black uppercase tracking-[0.3em] hover:bg-black transition-all flex items-center justify-center gap-4 shadow-2xl active:scale-95 disabled:opacity-50">
                    {isGenerating ? <><Loader2 className="w-6 h-6 animate-spin" /> Establishing Sync...</> : <><Sparkles className="w-6 h-6" /> Extract Institutional Merit</>}
                  </button>
                </DialogFooter>
             </div>
          ) : (
            <div className="space-y-12 animate-in slide-in-from-bottom-8 duration-700 mt-0 print:m-0 print:space-y-16 text-left">
               <div className="hidden print:block border-b-8 border-[#1e3272] pb-16 mb-16">
                  <h1 className="text-6xl font-black text-slate-900 uppercase tracking-tighter italic">Registry Intelligence</h1>
                  <p className="text-sm font-black text-slate-400 uppercase tracking-widest mt-3">Institution: {teacherData?.schoolName || 'EDU-INTELLECT MAIN NODE'} • ID: {currentReportId?.substring(0,8)}</p>
               </div>

               {reportResult.isClassReport ? (
                 <div className="space-y-12">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                       <StatCard label="Merit Index" val={reportResult.summary?.avg || "N/A"} icon={TrendingUp} color="text-indigo-600" />
                       <StatCard label="Registry Presence" val={reportResult.summary?.attendance || "N/A"} icon={Clock} color="text-emerald-500" />
                       <StatCard label="Manifest Status" val={reportResult.summary?.mastery || "Verified"} icon={ShieldCheck} color="text-indigo-400" />
                    </div>

                    {reportResult.isAttendance && (
                       <div className="bg-white border border-slate-100 p-12 rounded-[4rem] shadow-sm">
                          <p className="text-[11px] font-black text-slate-300 uppercase tracking-widest mb-10 flex items-center gap-3 italic"><AlertTriangle className="w-5 h-5 text-amber-500"/> Critical Absence Registry (&lt;80%)</p>
                          <div className="space-y-4">
                             {reportResult.lowAttendance?.length > 0 ? reportResult.lowAttendance.map((s:any, i:number) => (
                                <div key={i} className="flex items-center justify-between p-6 bg-slate-50/50 rounded-[2rem] border border-slate-50">
                                   <div className="flex items-center gap-6">
                                      <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center font-black text-slate-400 border border-slate-100">{s.name[0]}</div>
                                      <p className="text-xl font-black text-slate-800 uppercase italic tracking-tighter">{s.name}</p>
                                   </div>
                                   <p className="text-2xl font-black text-rose-500">{s.rate}%</p>
                                </div>
                             )) : <p className="text-sm font-black text-emerald-500 uppercase tracking-widest text-center py-10 italic">Universal attendance manifest is stable.</p>}
                          </div>
                       </div>
                    )}

                    {reportResult.isAtRisk && (
                       <div className="space-y-6">
                          <p className="text-[11px] font-black text-slate-300 uppercase tracking-widest mb-4 flex items-center gap-3 italic"><ShieldAlert className="w-5 h-5 text-rose-500"/> Intervention Registry - {reportResult.atRiskList?.length || 0} scholars flagged</p>
                          {reportResult.atRiskList?.map((s:any, i:number) => (
                             <div key={i} className="bg-rose-50 border border-rose-100 p-10 rounded-[3.5rem] flex items-center justify-between group hover:bg-rose-100 transition-all shadow-sm">
                                <div className="flex items-center gap-8">
                                   <div className="w-20 h-20 rounded-[2rem] bg-white flex items-center justify-center font-black text-rose-500 shadow-sm border border-rose-100 text-3xl font-serif italic">{s.name[0]}</div>
                                   <div>
                                      <h4 className="text-3xl font-black text-slate-900 uppercase tracking-tighter italic leading-none mb-3">{s.name}</h4>
                                      <div className="flex gap-4">
                                         <span className="px-3 py-1 bg-white rounded-lg text-[9px] font-black uppercase text-rose-400 tracking-widest border border-rose-100">Merit: {s.score}%</span>
                                         <span className="px-3 py-1 bg-white rounded-lg text-[9px] font-black uppercase text-rose-400 tracking-widest border border-rose-100">Atnd: {s.attendance}%</span>
                                         {s.hasNegNote && <span className="px-3 py-1 bg-white rounded-lg text-[9px] font-black uppercase text-rose-500 tracking-widest border border-rose-200">Behavior Signal</span>}
                                      </div>
                                   </div>
                                </div>
                                <div className="text-right">
                                   <div className="px-6 py-3 bg-white rounded-[1.5rem] text-[10px] font-black text-rose-600 uppercase tracking-widest shadow-sm border border-rose-100 group-hover:bg-rose-600 group-hover:text-white transition-all">Requires Priority Intervention</div>
                                </div>
                             </div>
                          ))}
                       </div>
                    )}

                    <div className="bg-white border border-slate-100 p-12 rounded-[4rem] shadow-sm print:border-slate-200">
                       <p className="text-[11px] font-black text-slate-300 uppercase tracking-widest mb-12 flex items-center gap-3 italic"><BarChart3 className="w-5 h-5 text-[#1e3272]"/> Institutional Merit Distribution</p>
                       <div className="h-[320px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={reportResult.chartData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontStyle: 'italic', fontWeight: 900, fill: '#64748b' }} />
                                <YAxis axisLine={false} tickLine={false} hide />
                                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '2rem', border: 'none', boxShadow: '0 50px 100px -20px rgb(0 0 0 / 0.15)', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' }}/>
                                <Bar dataKey="score" radius={[16, 16, 16, 16]} barSize={40}>
                                   {reportResult.chartData?.map((_:any, index:number) => (
                                      <Cell key={`cell-${index}`} fill={['#1e3272', '#4f46e5', '#818cf8', '#c7d2fe', '#6366f1'][index % 5]} />
                                   ))}
                                </Bar>
                             </BarChart>
                          </ResponsiveContainer>
                       </div>
                    </div>

                    <div className="bg-[#0f172a] p-12 rounded-[4rem] relative overflow-hidden group shadow-2xl print:bg-slate-50 print:text-slate-900 print:border-slate-200">
                       <p className="text-[11px] font-black text-indigo-300 uppercase tracking-[0.4em] flex items-center gap-4 mb-8 print:text-slate-400 italic">
                          <Bot size={24} className="animate-pulse print:text-indigo-600"/> Neural Intelligence Synthesis
                       </p>
                       <p className="text-xl font-bold text-white leading-relaxed italic relative z-10 print:text-slate-800">"{reportResult.aiRemarks}"</p>
                    </div>
                 </div>
               ) : reportResult.isIndividual && reportResult.profileStudent ? (
                 <div className="bg-slate-50 rounded-[2rem] p-6 border border-slate-100 shadow-sm -mx-4 print:mx-0 print:p-2 print:bg-white print:border-0 print:shadow-none">
                   <StudentProfile embedded student={reportResult.profileStudent} />
                 </div>
               ) : null}

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:hidden">
                  {(report.id === "at_risk" || report.id === "attendance_summary") ? (
                     <button onClick={()=>handleSendToPortal('both')} disabled={isSending || isSent} className="col-span-full h-28 bg-[#0f172a] text-white rounded-[2.8rem] text-[13px] font-black uppercase tracking-[0.3em] flex flex-col items-center justify-center gap-1 shadow-2xl hover:bg-black transition-all hover:translate-y-[-4px] active:scale-95 disabled:opacity-50 group">
                        {isSending ? <Loader2 className="w-8 h-8 animate-spin"/> : <><div className="flex items-center gap-3"><Sparkles className="w-7 h-7 group-hover:rotate-180 transition-all duration-700"/> Broadcast to Both Portals</div><span className="text-[9px] opacity-60 font-bold tracking-widest italic leading-none">Synchronize Parent & Principal Portals Simultaneously</span></>}
                     </button>
                  ) : null}
                  <button onClick={()=>handleSendToPortal('parent')} disabled={isSending || isSent} className={`h-28 bg-emerald-600 text-white rounded-[2.8rem] text-[13px] font-black uppercase tracking-[0.2em] flex flex-col items-center justify-center gap-1 shadow-2xl hover:bg-black transition-all hover:translate-y-[-4px] active:scale-95 disabled:opacity-50 group ${(report.id === "at_risk" || report.id === "attendance_summary") ? 'md:col-span-1' : 'col-span-full'}`}>
                    {isSending ? <Loader2 className="w-8 h-8 animate-spin"/> : <><div className="flex items-center gap-3"><CheckCircle2 className="w-7 h-7 group-hover:scale-110 transition-all"/> Sync to Parent</div><span className="text-[9px] opacity-60 font-bold">Portal Manifest Update</span></>}
                  </button>
                  <button onClick={()=>handleSendToPortal('principal')} disabled={isSending || isSent} className={`h-28 bg-[#1e3272] text-white rounded-[2.8rem] text-[13px] font-black uppercase tracking-[0.2em] flex flex-col items-center justify-center gap-1 shadow-2xl hover:bg-black transition-all hover:translate-y-[-4px] active:scale-95 disabled:opacity-50 group ${(report.id === "at_risk" || report.id === "attendance_summary") ? 'md:col-span-1' : 'col-span-full'}`}>
                    {isSending ? <Loader2 className="w-8 h-8 animate-spin"/> : <><div className="flex items-center gap-3"><ShieldCheck className="w-7 h-7 group-hover:rotate-12 transition-all"/> Transmit to Principal</div><span className="text-[9px] opacity-60 font-bold">Administrative Filing</span></>}
                  </button>
                  <button onClick={handleDownload} className="col-span-full h-24 bg-white border border-slate-100 text-[#1e3272] rounded-[2.8rem] text-[12px] font-black uppercase tracking-widest flex items-center justify-center gap-4 shadow-xl hover:bg-slate-50 transition-all active:scale-95">
                    <Download className="w-7 h-7"/> {params.format === 'pdf' ? 'Initiate Print Protocol' : 'Export Excel Data Registry'}
                  </button>
               </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ReportPanel = ({ title, color, children }: { title: string; color: string; children: React.ReactNode }) => {
  const map: Record<string, string> = {
    blue:    "border-blue-100 bg-blue-50/40",
    emerald: "border-emerald-100 bg-emerald-50/40",
    amber:   "border-amber-100 bg-amber-50/40",
    rose:    "border-rose-100 bg-rose-50/40",
    purple:  "border-purple-100 bg-purple-50/40",
    teal:    "border-teal-100 bg-teal-50/40",
  };
  return (
    <div className={`flex-1 rounded-xl border p-3 ${map[color] || "border-slate-100 bg-white"}`}>
      <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 mb-2">{title}</p>
      {children}
    </div>
  );
};

const StatCard = ({ label, val, icon: Icon, color }: any) => (
   <div className="bg-white p-10 rounded-[3.5rem] border border-slate-100 shadow-sm text-center group hover:shadow-2xl transition-all print:border-slate-200">
      <div className={`w-14 h-14 rounded-[1.8rem] bg-slate-50 flex items-center justify-center mx-auto mb-6 shadow-inner ${color}`}><Icon size={28}/></div>
      <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 italic">{label}</p>
      <p className="text-5xl font-black text-slate-900 tracking-tighter italic">{val}</p>
   </div>
);

export default GenerateReport;
