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
  FileText, Download, Loader2, Sparkles,
  CheckCircle2, AlertTriangle, Layers, UserCircle,
  BarChart3, TrendingUp, Clock,
  ShieldCheck, ShieldAlert,
  Table2 as TableIcon,
} from "lucide-react";
import { toast } from "sonner";
import { db } from "../lib/firebase";
import { collection, query, where, getDocs, serverTimestamp, doc } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { auditedAdd, auditedUpdate } from "../lib/auditedWrites";
import { buildReport, openReportWindow, EDULLENT_NAME } from "../lib/reportTemplate";
const loadXLSX = () => import("xlsx");
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

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
    format: "pdf",
    scope: "class" as "class" | "individual",
  });

  useEffect(() => {
    if (isOpen) {
      setReportResult(null);
      setIsSent(false);
      setCurrentReportId(null);
      // Reset per-modal-open: scope defaults to 'class' for the attendance
      // toggle; clear student so the picker placeholder shows fresh.
      setParams(p => ({ ...p, scope: "class", studentId: "" }));
    }
  }, [isOpen]);

  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId || !isOpen) return;
    const schoolId = teacherData.schoolId;
    let cancelled = false;
    const fetchClassesAndRoster = async () => {
       try {
         const q1 = query(collection(db, "teaching_assignments"), where("schoolId", "==", schoolId), where("teacherId", "==", teacherData.id));
         const q2 = query(collection(db, "classes"), where("schoolId", "==", schoolId), where("teacherId", "==", teacherData.id));

         const [asgnSnap, clsSnap] = await Promise.all([getDocs(q1), getDocs(q2)]);
         if (cancelled) return;
         const combined = [...asgnSnap.docs.map(d => ({id: d.id, ...d.data()})), ...clsSnap.docs.map(d => ({id: d.id, ...d.data()}))];

         // Resolve a usable label for the class — writers across the codebase
         // store the name field under different keys (`name`, `className`,
         // `classTitle`, `title`). When ALL of them are empty, fall back to
         // the subject + section/grade combo, then finally a classId snippet
         // so a class is never rendered as a bare bullet/blank row.
         const pickName = (c: any): string => {
           const cands = [c.className, c.name, c.classTitle, c.title];
           for (const v of cands) {
             if (typeof v === "string" && v.trim()) return v.trim();
           }
           const subj = (c.subjectName || c.subject || "").toString().trim();
           const sect = (c.grade || c.section || c.standard || "").toString().trim();
           if (subj && sect) return `${subj} · ${sect}`;
           if (subj)         return subj;
           const cid = (c.classId || c.id || "").toString();
           return cid ? `Class ${cid.slice(-6)}` : "Unnamed class";
         };

         // Dedupe by classId. When the same classId appears in BOTH
         // teaching_assignments and classes, prefer the doc with a real
         // name field over the placeholder one (e.g. teaching_assignment
         // missing className but classes doc has it).
         const map = new Map<string, any>();
         combined.forEach((c: any) => {
           const classId = c.classId || c.id;
           const candidate = {
             id: c.id,
             classId,
             name: pickName(c),
             subject: c.subjectName || c.subject || "",
             grade: c.grade || c.section || c.standard || "",
           };
           const existing = map.get(classId);
           if (!existing) {
             map.set(classId, candidate);
             return;
           }
           // Upgrade: prefer the candidate with an actual class name (not a
           // synthesised "Class ABCDEF" / "Subject · Section" fallback).
           const existingHasRealName = !!(existing.name && !/^Class [A-Za-z0-9]{1,6}$/.test(existing.name));
           const candidateHasRealName = !!(candidate.name && !/^Class [A-Za-z0-9]{1,6}$/.test(candidate.name));
           if (!existingHasRealName && candidateHasRealName) {
             map.set(classId, candidate);
           }
         });
         setClasses(Array.from(map.values()));

         const qEnrol = query(collection(db, "enrollments"), where("schoolId", "==", schoolId), where("teacherId", "==", teacherData.id));
         const enrolSnap = await getDocs(qEnrol);
         if (cancelled) return;
         setRoster(enrolSnap.docs.map(d => ({ id: d.id, ...d.data() })));
       } catch (error) {
         if (cancelled) return;
         console.error("[GenerateReport] classes/roster fetch failed:", error);
         toast.error("Could not load classes. Please close and retry.");
       }
    };
    fetchClassesAndRoster();
    return () => { cancelled = true; };
  }, [teacherData?.id, teacherData?.schoolId, isOpen]);

  const handleGenerate = async () => {
    if (!params.classId) return toast.error("Please select a class.");
    if (report?.id === "individual_progress" && !params.studentId) return toast.error("Please select a student.");
    if (report?.id === "attendance_summary" && params.scope === "individual" && !params.studentId) {
      return toast.error("Please select a student.");
    }
    if (!teacherData?.schoolId || !teacherData?.id) return toast.error("School session missing — please re-login.");

    setIsGenerating(true);
    setReportResult(null);

    try {
       const schoolId = teacherData.schoolId as string;
       const selectedClass = classes.find(c => c.classId === params.classId || c.id === params.classId);
       const targetClassId = selectedClass?.classId || params.classId;
       let filteredRoster = roster.filter(s => s.classId === targetClassId);

       if (filteredRoster.length === 0) throw new Error("No students enrolled in this class yet.");
       // Scores live in TWO collections per memory `owner_dashboard_alternate_data_sources`:
       // gradebook_scores (continuous assessment) + test_scores (test/exam writes).
       // Reports must read both or it'll miss ~40% of records (typical split).
       // results is a third co-canonical source for tabulated outputs.
       const [allAtt, allScores, allTestScores, allResults, allNotes] = await Promise.all([
          getDocs(query(collection(db, "attendance"),       where("schoolId", "==", schoolId), where("classId", "==", targetClassId))).catch(() => ({ docs: [] as any[] })),
          getDocs(query(collection(db, "gradebook_scores"), where("schoolId", "==", schoolId), where("classId", "==", targetClassId))).catch(() => ({ docs: [] as any[] })),
          getDocs(query(collection(db, "test_scores"),      where("schoolId", "==", schoolId), where("classId", "==", targetClassId))).catch(() => ({ docs: [] as any[] })),
          getDocs(query(collection(db, "results"),          where("schoolId", "==", schoolId), where("classId", "==", targetClassId))).catch(() => ({ docs: [] as any[] })),
          getDocs(query(collection(db, "parent_notes"),     where("schoolId", "==", schoolId), where("teacherId", "==", teacherData.id))).catch(() => ({ docs: [] as any[] })),
       ]);

       const attDocs    = allAtt.docs.map((d: any) => d.data());
       const gradeDocs  = [...allScores.docs.map((d: any) => d.data()), ...allTestScores.docs.map((d: any) => d.data())];
       const resultDocs = allResults.docs.map((d: any) => d.data());
       const noteDocs   = allNotes.docs.map((d: any) => d.data());

       // Strict 3-tier student attribution (memory: pattern_3tier_attribution)
       // Substring `id?.includes` REMOVED — was leaking cross-student matches.
       const filterByStudent = (sId: string, sEmail: string | undefined) => (arr: any[]) => arr.filter(item => {
         if (sId && item.studentId && item.studentId === sId) return true;
         if (sEmail && typeof item.studentEmail === "string" && item.studentEmail.toLowerCase() === sEmail) return true;
         return false;
       });

       // getPct returns null on no-data (memory: bug_pattern_score_zero_no_data
       // + bug_pattern_score_field_singular_mark). Field shape coverage:
       //   1. explicit `percentage` always wins
       //   2. `mark`/`marks`/`score` paired with their max → compute %
       //   3. raw `mark`/`marks`/`score` already in [0,100] AND no max set →
       //      treat as percentage (covers writers who store percent directly)
       const getPct = (sc: any): number | null => {
         const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
         const pct = num(sc?.percentage);
         if (pct !== null) return Math.max(0, Math.min(100, pct));

         const maxMarks = num(sc?.maxMarks);
         const ms = num(sc?.mark);
         if (ms !== null && maxMarks && maxMarks > 0) return Math.max(0, Math.min(100, ms / maxMarks * 100));
         const mp = num(sc?.marks);
         if (mp !== null && maxMarks && maxMarks > 0) return Math.max(0, Math.min(100, mp / maxMarks * 100));
         const score = num(sc?.score);
         const maxScore = num(sc?.maxScore);
         if (score !== null && maxScore && maxScore > 0) return Math.max(0, Math.min(100, score / maxScore * 100));

         // Permissive fallback — raw value already looks like a percentage.
         // Only triggers when no max field is present and value is in [0,100].
         if (ms    !== null && !maxMarks && ms    >= 0 && ms    <= 100) return ms;
         if (mp    !== null && !maxMarks && mp    >= 0 && mp    <= 100) return mp;
         if (score !== null && !maxScore && score >= 0 && score <= 100) return score;
         return null;
       };

       // Behaviour signals — word-boundary regex avoids false positives
       // (e.g. "no distraction at all", "got better at trouble spots").
       // Dropped "trouble"/"distraction"/"weak" — too generic.
       const NEG_NOTE_RE = /\b(aggressive|aggression|bully|bullied|bullying|disruptive|disruption|distracting|refused|fight|fought|misbehav|insubordinat|incomplete|absent without)\b/;

       const enrichedPerformance = filteredRoster.map((student: any) => {
          const sId = student.studentId;
          const sEmail = student.studentEmail?.toLowerCase();
          const sf = filterByStudent(sId, sEmail);

          const sAtt = sf(attDocs);
          const sGrades = [...sf(gradeDocs), ...sf(resultDocs)];
          const sNotes = sf(noteDocs);

          const hasAtt    = sAtt.length > 0;
          const present   = sAtt.filter(a => a.status === 'present' || a.status === 'late').length;
          const atndRate  = hasAtt ? (present / sAtt.length) * 100 : 0;

          const scoreNums = sGrades.map(getPct).filter((v): v is number => v !== null);
          const hasScores = scoreNums.length > 0;
          const avgScore  = hasScores ? (scoreNums.reduce((a, b) => a + b, 0) / scoreNums.length) : 0;

          const hasNegNote = sNotes.some((n: any) => {
             const text = (n.content || n.message || "").toLowerCase();
             return NEG_NOTE_RE.test(text);
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

       // Rule-based summary builder — composes the report's narrative from
       // real numbers without any external AI call. Per memory
       // teacher_dashboard_ai_strategy: Reports stays AI-free.
       const buildClassSummary = (): string => {
          if (studentsWithScores.length === 0 && studentsWithAtt.length === 0) {
             return `No test scores or attendance records yet for this class. The report will populate once data is entered.`;
          }
          const parts: string[] = [];
          const subjLabel = selectedClass?.subject || "this class";
          if (studentsWithScores.length > 0) {
             const tier = classAvg >= 80 ? "performing strongly" : classAvg >= 60 ? "performing steadily" : "below expected levels";
             parts.push(`${subjLabel} is ${tier} with a class average of ${classAvg}%`);
             const struggling = enrichedPerformance.filter(s => s.hasScores && s.score < 60);
             if (struggling.length > 0) {
                parts.push(`${struggling.length} student${struggling.length === 1 ? "" : "s"} ${struggling.length === 1 ? "is" : "are"} below 60% — focused remediation recommended`);
             }
          }
          if (studentsWithAtt.length > 0) {
             const attTier = classAtnd >= 90 ? "excellent" : classAtnd >= 80 ? "good" : classAtnd >= 70 ? "adequate" : "concerning";
             parts.push(`attendance is ${attTier} at ${classAtnd}%`);
          }
          return parts.join(". ").replace(/\.+$/, "") + ".";
       };

       if (report.id === "class_perf") {
          resultData = {
              isClassReport: true,
              subject: selectedClass?.subject || "Subject",
              className: selectedClass?.name,
              aiRemarks: buildClassSummary(),
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
       } else if (
          report.id === "individual_progress"
          || (report.id === "attendance_summary" && params.scope === "individual")
       ) {
          // Both report types resolve to a per-student profile view. The
          // landing page (StudentProfile on /students) already surfaces
          // attendance details, so attendance_summary individual scope
          // routes through the same flow.
          const sel = enrichedPerformance.find(s => (s.studentId === params.studentId || s.email?.toLowerCase() === params.studentId?.toLowerCase())) || enrichedPerformance[0];

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

          // Rule-based remark — only mentions numbers we actually have. No
          // AI call (memory: teacher_dashboard_ai_strategy keeps reports AI-free).
          const remarkParts: string[] = [];
          if (sel.hasScores) remarkParts.push(`score of ${sel.score}%`);
          if (sel.hasAtt)    remarkParts.push(`attendance of ${sel.attendance}%`);
          let studentRemark: string;
          if (remarkParts.length === 0) {
             studentRemark = `No academic or attendance data recorded for ${sel.name} yet — report will populate once data is entered.`;
          } else {
             const standing = sel.hasScores && sel.score >= 75 ? "performing strongly"
                : sel.hasScores && sel.score >= 60 ? "performing steadily"
                : sel.hasScores ? "needs academic support"
                : "data partial";
             studentRemark = `${sel.name} is ${standing} with ${remarkParts.join(" and ")}.`;
             if (sel.hasNegNote) studentRemark += " Behaviour note logged this term — flag for follow-up.";
          }

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
             ai_remark: studentRemark,
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
             aiRemarks: studentsWithAtt.length === 0
                ? `No attendance records yet for this class — summary will populate once attendance is marked.`
                : (() => {
                    const lowCount = enrichedPerformance.filter(s => s.hasAtt && s.attendance < 80).length;
                    const tier = classAtnd >= 90 ? "excellent" : classAtnd >= 80 ? "good" : classAtnd >= 70 ? "adequate" : "concerning";
                    let msg = `Class attendance is ${tier} at ${classAtnd}%.`;
                    if (lowCount > 0) msg += ` ${lowCount} student${lowCount === 1 ? "" : "s"} below 80% — follow up with parents.`;
                    return msg;
                  })(),
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
                ? `${atRisk.length} student${atRisk.length === 1 ? "" : "s"} flagged based on scores, attendance, or behaviour notes. Recommend parent outreach this week.`
                : `No at-risk students detected in this class.`,
             studentsWithDataCount: enrichedPerformance.filter(s => s.hasScores || s.hasAtt).length,
             totalStudents: enrichedPerformance.length,
          };
       }

       // Branding embedded on the doc itself so teacher/parent dashboards
       // render the SAME WYSIWYG report (branch name, logo, theme) without
       // an extra fetch on the school record. Snapshot semantics — if the
       // school updates its logo later, NEW reports get the new logo, OLD
       // reports keep the old (audit trail integrity).
       // Mirrors the principal-dashboard GenerateReport pattern.
       const td = teacherData as any;
       const branchName = td.branchName || td.branch || td.branchTitle || "";
       const firestorePayload: any = {
          schoolId,
          teacherId: teacherData.id || "unknown",
          teacherName: teacherData.name || "Teacher",
          studentId: params.studentId || "all",
          studentName: report.id === "individual_progress" ? (resultData.student_name || "Student") : "Class",
          classId: targetClassId || params.classId || "unknown",
          type: report.id || "general",
          title: report.title || "Academic Report",
          grade: selectedClass?.grade || "N/A",
          className: selectedClass?.name || "Class",
          createdAt: serverTimestamp(),
          status: "Draft",
          format: params.format || "pdf",
          // Branding fields — empty strings fall back to Edullent defaults
          // in reportTemplate.ts (logoUrl → EDULLENT_LOGO_URL, themeColor →
          // EDULLENT_BRAND_COLOR, schoolName → "Edullent").
          branchName,
          schoolName: td.schoolName || "",
          logoUrl:    td.logoUrl    || "",
          themeColor: td.themeColor || "",
          generatedBy: teacherData.name || "Teacher",
          data: JSON.parse(JSON.stringify(resultData)) // Deep-strip all undefineds
       };
       if (teacherData.branchId) firestorePayload.branchId = teacherData.branchId;

       const docRef = await auditedAdd(collection(db, "reports"), firestorePayload);
       setCurrentReportId(docRef.id);
       setIsSent(false);

       // For per-student reports (individual_progress + attendance_summary
       // with individual scope), the modal is the wrong surface — the rich
       // student profile (academic, attendance, subject mastery, behaviour,
       // fees, parent communication, skills) goes straight into the PDF.
       // We open the PDF in a new tab immediately; for Excel we download
       // the row data. Either way, the modal closes after.
       const isIndividualScope =
         report.id === "individual_progress"
         || (report.id === "attendance_summary" && params.scope === "individual");
       if (isIndividualScope) {
         try {
           if (params.format === "excel") {
             const XLSX = await loadXLSX();
             const td = teacherData as any;
             const branchLabel = td?.branchName || td?.branch || td?.schoolName || EDULLENT_NAME;
             const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
             const r = resultData;
             const headerRows: any[][] = [
               [`${EDULLENT_NAME} — ${branchLabel}`],
               [`${r.student_name || "Student"} — ${report.title || "Progress Report"}`],
               [`Generated by ${teacherData?.name || "Teacher"}  ·  ${now}`],
               [],
               ["Field", "Value"],
               ["Name",            r.student_name || "—"],
               ["Roll No",         r.rollNo || "—"],
               ["Class",           r.className || "—"],
               ["Grade",           r.grade || "—"],
               ["Subject",         r.subject || "—"],
               ["Average Score",   r.hasScores ? `${r.score}%` : "—"],
               ["Attendance",      r.hasAtt    ? `${r.atnd}%`  : "—"],
               ["Risk Level",      r.riskLevel || "—"],
               ["Predicted Score", r.predictedScore != null ? `${r.predictedScore}%` : "—"],
               ["Warnings",        r.warnings ?? 0],
               ["Detentions",      r.detentions ?? 0],
               ["Positive Remarks", r.positiveRemarks ?? 0],
               ["Total Fee",       r.totalFee != null ? `₹${r.totalFee}` : "—"],
               ["Paid Fee",        r.paidFee  != null ? `₹${r.paidFee}`  : "—"],
               ["Pending Fee",     r.pendingFee != null ? `₹${r.pendingFee}` : "—"],
               ["Last Payment",    r.lastPayDate || "—"],
             ];
             const ws = XLSX.utils.aoa_to_sheet(headerRows);
             const wb = XLSX.utils.book_new();
             XLSX.utils.book_append_sheet(wb, ws, "Profile");
             const safeName = String(r.student_name || "student").replace(/[^a-z0-9_-]/gi, "_");
             XLSX.writeFile(wb, `Edullent_${safeName}_profile_${new Date().toISOString().slice(0,10)}.xlsx`);
           } else {
             const html = buildReport(buildIndividualPayload(resultData));
             openReportWindow(html);
           }
           toast.success("Report saved. Opened in new tab.");
         } catch (downloadErr) {
           console.error("[GenerateReport] individual export failed", downloadErr);
           toast.error("Could not open report. Try again.");
         }
         onOpenChange(false);
         return;
       }

       // Class / attendance / at-risk: render result view inside the modal
       setReportResult(resultData);
       toast.success("Report generated successfully.");
    } catch (e: unknown) {
       console.error("[GenerateReport] report generation failed", e);
       const err = e as { code?: string; message?: string } | null;
       const msg = err?.code === "permission-denied"
         ? "Permission denied — check your school access."
         : err?.message || "Failed to generate report.";
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
          status: portal === "both" ? "Sent to Parent and Principal" : (portal === "parent" ? "Sent to Parent" : "Sent to Principal"),
          publishedToParent: isToParent,
          sentToPrincipal: isToPrincipal,
          sentAt: serverTimestamp()
       });

       if (isToPrincipal) {
          if (!teacherData?.schoolId) throw new Error("School identity missing — cannot route to principal.");
          const prPayload: Record<string, unknown> = {
             teacherId: teacherData.id || "unknown",
             teacherName: teacherData.name || "Teacher",
             schoolId: teacherData.schoolId,
             reportId: currentReportId,
             reportType: (report.id || "general").toUpperCase(),
             title: `${report.title || "Report"} - ${reportResult.className || "Class"}`,
             content: reportResult.aiRemarks || reportResult.ai_remark || "Report attached.",
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
       toast.success(portal === "both" ? "Sent to Parent and Principal." : portal === "parent" ? "Sent to Parent." : "Sent to Principal.");
    } catch (e: unknown) {
       console.error("[GenerateReport] portal sync failed", e);
       toast.error("Failed to send. Try again.");
    } finally {
       setIsSending(false);
    }
  };

  // Builds the heroStats + sections that buildReport consumes. Mirrors the
  // shape that Reports.tsx history-download builds for old reports.
  // Build the rich student-profile PDF payload from resultData. Mirrors
  // the StudentProfile UI's information density (academic, attendance,
  // behaviour, fees, parent comms, skills, predicted score) so the PDF
  // captures everything a teacher would see on the in-app profile.
  const buildIndividualPayload = (r: any) => {
    const td = teacherData as any;
    const branchLabel = td?.branchName || td?.branch || td?.schoolName || EDULLENT_NAME;

    const heroStats: any[] = [
      { label: "Average Score", value: r.hasScores ? `${r.score}%` : "—",
        color: r.hasScores ? (r.score >= 75 ? "#4ade80" : r.score >= 50 ? "#fbbf24" : "#f87171") : undefined },
      { label: "Attendance",    value: r.hasAtt    ? `${r.atnd}%`  : "—",
        color: r.hasAtt    ? (r.atnd  >= 85 ? "#4ade80" : "#fbbf24") : undefined },
      { label: "Risk Level",    value: r.riskLevel || "—",
        color: r.riskLevel === "LOW" ? "#4ade80" : r.riskLevel === "HIGH" ? "#f87171" : "#fbbf24" },
      { label: "Class",         value: r.className || "—" },
    ];

    const sections: any[] = [];

    sections.push({
      title: "Student Profile",
      type: "stats",
      stats: [
        { label: "Name",     value: r.student_name || "—" },
        { label: "Roll No",  value: r.rollNo       || "—" },
        { label: "Grade",    value: r.grade        || "—" },
        { label: "Subject",  value: r.subject      || "—" },
      ],
    });

    const bars: any[] = [];
    if (r.hasScores) bars.push({ label: "Average Score", value: r.score });
    if (r.hasAtt)    bars.push({ label: "Attendance",    value: r.atnd });
    if (r.predictedScore != null) bars.push({ label: "Predicted Score", value: r.predictedScore, color: "#7B3FF4" });
    if (bars.length > 0) sections.push({ title: "Performance Outlook", type: "bars", bars });

    if (r.ai_remark) {
      sections.push({ title: "Teacher Remarks", type: "text", text: r.ai_remark });
    }

    if ((r.warnings ?? 0) > 0 || (r.detentions ?? 0) > 0 || (r.positiveRemarks ?? 0) > 0) {
      sections.push({
        title: "Behaviour Record",
        type: "stats",
        stats: [
          { label: "Warnings",         value: r.warnings ?? 0,        color: (r.warnings ?? 0) > 0 ? "#dc2626" : undefined },
          { label: "Detentions",       value: r.detentions ?? 0,      color: (r.detentions ?? 0) > 0 ? "#dc2626" : undefined },
          { label: "Positive Remarks", value: r.positiveRemarks ?? 0, color: "#16a34a" },
        ],
      });
    }

    if (r.totalFee != null && r.totalFee > 0) {
      sections.push({
        title: "Fees",
        type: "stats",
        stats: [
          { label: "Total Fee",    value: `₹${r.totalFee}` },
          { label: "Paid",         value: `₹${r.paidFee || 0}`,    color: "#16a34a" },
          { label: "Pending",      value: `₹${r.pendingFee || 0}`, color: r.pendingFee > 0 ? "#dc2626" : "#16a34a" },
          { label: "Last Payment", value: r.lastPayDate || "—" },
        ],
      });
    }

    if (Array.isArray(r.parentContacts) && r.parentContacts.length > 0) {
      sections.push({
        title: "Parent Communication",
        type: "table",
        headers: ["Type", "Date", "Note"],
        rows: r.parentContacts.map((p: any) => ({
          cells: [p.label || "Note", p.date || "—", p.content || "—"],
        })),
      });
    }

    if (Array.isArray(r.skills) && r.skills.length > 0) {
      sections.push({
        title: "Skills & Activities",
        type: "list",
        items: r.skills,
      });
    }

    return {
      title: `${r.student_name || "Student"} — Progress Report`,
      subtitle: `${r.className || "Class"} · Roll ${r.rollNo || "—"} · Generated by ${teacherData?.name || "Teacher"}`,
      badge: r.riskLevel || "",
      schoolName: branchLabel,
      generatedBy: teacherData?.name || "Teacher",
      logoUrl: td?.logoUrl || "",
      themeColor: td?.themeColor || "",
      heroStats,
      sections,
    };
  };

  const buildTemplatePayload = () => {
    const r = reportResult || {};
    const td = teacherData as any;
    const branchLabel = td?.branchName || td?.branch || td?.schoolName || EDULLENT_NAME;

    // Per-template hero stats + sections
    let heroStats: any[] = [];
    let sections: any[] = [];

    if (r.isIndividual) {
      heroStats = [
        { label: "Average Score", value: r.hasScores ? `${r.score}%` : "—", color: r.hasScores ? (r.score >= 75 ? "#4ade80" : "#fbbf24") : undefined },
        { label: "Attendance",    value: r.hasAtt    ? `${r.atnd}%`  : "—", color: r.hasAtt    ? (r.atnd  >= 85 ? "#4ade80" : "#fbbf24") : undefined },
        { label: "Risk Level",    value: r.riskLevel || "—",                color: r.riskLevel === "LOW" ? "#4ade80" : r.riskLevel === "HIGH" ? "#f87171" : "#fbbf24" },
        { label: "Class",         value: r.className || "—" },
      ];
      sections = [
        { title: "Student Profile", type: "stats", stats: [
          { label: "Name",       value: r.student_name || "—" },
          { label: "Roll No",    value: r.rollNo       || "—" },
          { label: "Grade",      value: r.grade        || "—" },
          { label: "Subject",    value: r.subject      || "—" },
        ]},
        { title: "Performance", type: "bars", bars: [
          { label: "Score",      value: r.hasScores ? r.score : 0 },
          { label: "Attendance", value: r.hasAtt    ? r.atnd  : 0 },
          ...(r.predictedScore != null ? [{ label: "Predicted Score", value: r.predictedScore }] : []),
        ]},
        ...(r.ai_remark ? [{ title: "Teacher Remarks", type: "text", text: r.ai_remark }] : []),
        ...(r.totalFee != null && r.totalFee > 0 ? [{ title: "Fees", type: "stats", stats: [
          { label: "Total Fee",   value: `₹${r.totalFee}` },
          { label: "Paid",        value: `₹${r.paidFee || 0}`,    color: "#16a34a" },
          { label: "Pending",     value: `₹${r.pendingFee || 0}`, color: r.pendingFee > 0 ? "#dc2626" : "#16a34a" },
          { label: "Last Payment",value: r.lastPayDate || "—" },
        ]}] : []),
      ];
    } else if (r.isAttendance) {
      heroStats = [
        { label: "Class Avg Attendance", value: r.summary?.attendance || "—" },
        { label: "Mastery",              value: r.summary?.mastery     || "—" },
        { label: "Total Students",       value: r.totalStudents        || 0   },
        { label: "Low Attendance",       value: r.lowAttendance?.length || 0, color: r.lowAttendance?.length > 0 ? "#f87171" : "#4ade80" },
      ];
      sections = [
        ...(r.aiRemarks ? [{ title: "Summary", type: "text", text: r.aiRemarks }] : []),
        ...(r.lowAttendance?.length > 0 ? [{
          title: "Low Attendance Students",
          type: "table",
          headers: ["Student", "Attendance %"],
          rows: r.lowAttendance.map((s: any) => ({ cells: [s.name, `${s.rate}%`], highlight: s.rate < 60 })),
        }] : []),
        {
          title: "Full Class Roster",
          type: "table",
          headers: ["Student", "Score", "Attendance", "Standing"],
          rows: (r.fullList || []).map((s: any) => ({
            cells: [s.name, s.hasScores ? `${s.score}%` : "—", s.hasAtt ? `${s.attendance}%` : "—", s.standing],
          })),
        },
      ];
    } else if (r.isAtRisk) {
      heroStats = [
        { label: "At-Risk Students", value: r.atRiskList?.length || 0, color: r.atRiskList?.length > 0 ? "#f87171" : "#4ade80" },
        { label: "Total Students",   value: r.totalStudents          || 0 },
        { label: "Reviewed",         value: r.studentsWithDataCount  || 0 },
        { label: "Class",            value: r.className              || "—" },
      ];
      sections = [
        ...(r.aiRemarks ? [{ title: "Intervention Summary", type: "text", text: r.aiRemarks }] : []),
        ...(r.atRiskList?.length > 0 ? [{
          title: "Students Needing Intervention",
          type: "table",
          headers: ["Student", "Score", "Attendance", "Standing"],
          rows: r.atRiskList.map((s: any) => ({
            cells: [s.name, s.hasScores ? `${s.score}%` : "—", s.hasAtt ? `${s.attendance}%` : "—", s.standing],
            highlight: true,
          })),
        }] : [{ title: "All Clear", type: "text", text: "No at-risk students detected in this class." }]),
      ];
    } else {
      // Class performance (default)
      heroStats = [
        { label: "Class Average",  value: r.summary?.avg        || "—" },
        { label: "Attendance",     value: r.summary?.attendance || "—" },
        { label: "Mastery Level",  value: r.summary?.mastery    || "—" },
        { label: "Students",       value: r.totalStudents       || 0 },
      ];
      sections = [
        ...(r.aiRemarks ? [{ title: "Class Summary", type: "text", text: r.aiRemarks }] : []),
        {
          title: "Student Breakdown",
          type: "table",
          headers: ["Student", "Score", "Attendance", "Standing"],
          rows: (r.fullList || []).map((s: any) => ({
            cells: [s.name, s.hasScores ? `${s.score}%` : "—", s.hasAtt ? `${s.attendance}%` : "—", s.standing],
            highlight: s.standing === "Critical",
          })),
        },
      ];
    }

    return {
      title: report?.title || "Academic Report",
      subtitle: `${reportResult?.className || ""}${reportResult?.subject ? ` · ${reportResult.subject}` : ""} · Generated by ${teacherData?.name || "Teacher"}`,
      badge: reportResult?.standing || reportResult?.riskLevel || "",
      schoolName: branchLabel,
      generatedBy: teacherData?.name || "Teacher",
      logoUrl: td?.logoUrl || "",      // empty string → reportTemplate uses EDULLENT_LOGO_URL
      themeColor: td?.themeColor || "", // empty → EDULLENT_BRAND_COLOR
      heroStats,
      sections,
    };
  };

  const handleDownload = async () => {
    if (!reportResult) {
      toast.error("Generate the report first.");
      return;
    }
    try {
      if (params.format === 'excel') {
        const XLSX = await loadXLSX();
        const td = teacherData as any;
        const branchLabel = td?.branchName || td?.branch || td?.schoolName || EDULLENT_NAME;
        const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

        // Header rows above the data so the exported sheet carries the same
        // branch identity as the PDF report.
        const headerRows: any[][] = [
          [`${EDULLENT_NAME} — ${branchLabel}`],
          [report?.title || "Academic Report"],
          [`Generated by ${teacherData?.name || "Teacher"}  ·  ${now}`],
          [],
        ];

        const list = reportResult.fullList || reportResult.atRiskList || reportResult.lowAttendance || [reportResult];
        const ws = XLSX.utils.aoa_to_sheet(headerRows);
        XLSX.utils.sheet_add_json(ws, list, { origin: -1 });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Report");
        const safeReportId = String(report?.id || "report").replace(/[^a-z0-9_-]/gi, "_");
        XLSX.writeFile(wb, `Edullent_${safeReportId}_${new Date().toISOString().slice(0,10)}.xlsx`);
      } else {
        // PDF flow — build the official report HTML and open in a new
        // window. The user can then Print → Save as PDF (browsers don't
        // expose a JS-only save-to-PDF that respects styling).
        const html = buildReport(buildTemplatePayload());
        openReportWindow(html);
      }
    } catch (e) {
      console.error("[GenerateReport] download failed", e);
      toast.error("Could not download report. Try again.");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[720px] overflow-hidden p-0 border-none font-sans text-left print:shadow-none print:w-full"
        style={{
          borderRadius: 24,
          background: "#fff",
          boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 18px 44px rgba(0,85,255,.18), 0 6px 16px rgba(0,85,255,.10)",
        }}
      >
        <div
          className="max-h-[90vh] overflow-y-auto custom-scrollbar print:bg-white print:max-h-full print:p-0 print:overflow-visible"
          style={{
            padding: 28,
            background: "#EEF4FF",
          }}
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="print:hidden">
            <DialogHeader className="mb-6 text-left">
              <div
                style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: "linear-gradient(135deg,#0055FF 0%,#1166FF 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 6px 18px rgba(0,85,255,.32), 0 2px 5px rgba(0,85,255,.18)",
                  marginBottom: 16,
                }}
              >
                {report && <report.icon className="w-6 h-6" style={{ color: "#fff" }} />}
              </div>
              <DialogTitle
                style={{
                  fontSize: 24, fontWeight: 700, color: "#001040",
                  letterSpacing: "-0.6px", lineHeight: 1.1, margin: 0,
                }}
              >
                Generate Report
              </DialogTitle>
              <DialogDescription
                style={{
                  fontSize: 12, fontWeight: 600, color: "#5070B0",
                  marginTop: 6, letterSpacing: "-0.1px",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <ShieldCheck className="w-3.5 h-3.5" style={{ color: "#00C853" }} />
                {report?.title || "Academic Report"}
              </DialogDescription>
            </DialogHeader>
          </div>

          {!reportResult ? (
            <div className="print:hidden text-left" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Class select */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Label
                  className="flex items-center gap-1.5"
                  style={{
                    fontSize: 10, fontWeight: 700, color: "#5070B0",
                    letterSpacing: "1.4px", textTransform: "uppercase",
                  }}
                >
                  <Layers className="w-3.5 h-3.5" /> Class
                </Label>
                <Select
                  value={params.classId}
                  onValueChange={(val) => setParams({ ...params, classId: val, studentId: "" })}
                >
                  <SelectTrigger
                    className="border-0"
                    style={{
                      height: 52, borderRadius: 14, padding: "0 16px",
                      background: "#fff",
                      border: "0.5px solid rgba(0,85,255,.12)",
                      boxShadow: "0 1px 2px rgba(0,85,255,.04), 0 2px 8px rgba(0,85,255,.06)",
                      fontSize: 13, fontWeight: 600, color: "#001040",
                    }}
                  >
                    <SelectValue placeholder="Select a class..." />
                  </SelectTrigger>
                  <SelectContent
                    style={{
                      borderRadius: 14, padding: 6,
                      border: "0.5px solid rgba(0,85,255,.12)",
                      boxShadow: "0 8px 24px rgba(0,85,255,.16)",
                    }}
                  >
                    {classes.length === 0 ? (
                      <div style={{ padding: "16px 12px", fontSize: 12, color: "#5070B0", fontWeight: 600, textAlign: "center" }}>
                        No classes assigned to you yet.
                      </div>
                    ) : classes.map(c => {
                      // Compose a single-line label so the SelectTrigger
                      // (which echoes the SelectItem children) renders
                      // cleanly without stacked spans collapsing weirdly.
                      // Subtitle parts only appended when distinct from title.
                      const subjPart = (c.subject || "").trim();
                      const gradePart = (c.grade || "").toString().trim();
                      const tail: string[] = [];
                      if (subjPart && subjPart !== c.name) tail.push(subjPart);
                      if (gradePart) tail.push(`Grade ${gradePart}`);
                      const fullLabel = tail.length > 0 ? `${c.name} — ${tail.join(" · ")}` : c.name;
                      return (
                        <SelectItem
                          key={c.id}
                          value={c.classId}
                          className="hover:bg-[#EEF4FF]"
                          style={{ borderRadius: 10, padding: "10px 12px", marginBottom: 2, fontSize: 13, fontWeight: 600, color: "#001040" }}
                        >
                          {fullLabel}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Scope toggle — only for attendance_summary, choose between
                  class-wide aggregate or per-student detail. */}
              {report?.id === "attendance_summary" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Label
                    style={{
                      fontSize: 10, fontWeight: 700, color: "#5070B0",
                      letterSpacing: "1.4px", textTransform: "uppercase",
                    }}
                  >
                    Scope
                  </Label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {(['class', 'individual'] as const).map((sc) => {
                      const active = params.scope === sc;
                      return (
                        <button
                          type="button"
                          key={sc}
                          onClick={() => setParams({ ...params, scope: sc, studentId: sc === "class" ? "" : params.studentId })}
                          style={{
                            height: 52, borderRadius: 14,
                            background: active
                              ? "linear-gradient(135deg,#0055FF 0%,#1166FF 100%)"
                              : "#fff",
                            color: active ? "#fff" : "#5070B0",
                            border: active ? "none" : "0.5px solid rgba(0,85,255,.12)",
                            boxShadow: active
                              ? "0 6px 18px rgba(0,85,255,.32), 0 2px 5px rgba(0,85,255,.18)"
                              : "0 1px 2px rgba(0,85,255,.04), 0 2px 8px rgba(0,85,255,.06)",
                            fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px",
                            cursor: "pointer", fontFamily: "inherit",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                            transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                          }}
                        >
                          {sc === "class" ? <Layers size={16} /> : <UserCircle size={16} />}
                          {sc === "class" ? "Class-wise" : "Individual"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Student select (conditional) — always for individual_progress;
                  for attendance_summary only when scope === 'individual'. */}
              {(report?.id === "individual_progress" || (report?.id === "attendance_summary" && params.scope === "individual")) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Label
                    className="flex items-center gap-1.5"
                    style={{
                      fontSize: 10, fontWeight: 700, color: "#5070B0",
                      letterSpacing: "1.4px", textTransform: "uppercase",
                    }}
                  >
                    <UserCircle className="w-3.5 h-3.5" /> Student
                  </Label>
                  <Select
                    value={params.studentId}
                    onValueChange={(val) => setParams({ ...params, studentId: val })}
                    disabled={!params.classId}
                  >
                    <SelectTrigger
                      className="border-0"
                      disabled={!params.classId}
                      style={{
                        height: 52, borderRadius: 14, padding: "0 16px",
                        background: !params.classId ? "#F4F7FE" : "#fff",
                        border: "0.5px solid rgba(0,85,255,.12)",
                        boxShadow: "0 1px 2px rgba(0,85,255,.04), 0 2px 8px rgba(0,85,255,.06)",
                        fontSize: 13, fontWeight: 600, color: !params.classId ? "#99AACC" : "#001040",
                        opacity: !params.classId ? 0.7 : 1,
                        cursor: !params.classId ? "not-allowed" : "pointer",
                      }}
                    >
                      <SelectValue placeholder={!params.classId ? "Select a class first…" : "Select a student..."} />
                    </SelectTrigger>
                    <SelectContent
                      style={{
                        borderRadius: 14, padding: 6,
                        border: "0.5px solid rgba(0,85,255,.12)",
                        boxShadow: "0 8px 24px rgba(0,85,255,.16)",
                      }}
                    >
                      {(() => {
                        // STRICT: only show students belonging to the
                        // currently-selected class. No "show all when no
                        // class is set" leak. Empty roster → friendly hint.
                        if (!params.classId) {
                          return (
                            <div style={{ padding: "16px 12px", fontSize: 12, color: "#5070B0", fontWeight: 600, textAlign: "center" }}>
                              Pick a class first to see its students.
                            </div>
                          );
                        }
                        const inClass = roster.filter(s => s.classId === params.classId);
                        if (inClass.length === 0) {
                          return (
                            <div style={{ padding: "16px 12px", fontSize: 12, color: "#5070B0", fontWeight: 600, textAlign: "center" }}>
                              No students enrolled in this class yet.
                            </div>
                          );
                        }
                        return (
                          <>
                            <SelectItem
                              value="all"
                              className="hover:bg-[#EEF4FF]"
                              style={{ borderRadius: 10, padding: "10px 12px", marginBottom: 2, fontSize: 13, fontWeight: 700, color: "#0055FF" }}
                            >
                              All students in class
                            </SelectItem>
                            {inClass.map(s => (
                              <SelectItem
                                key={s.id}
                                value={s.studentId}
                                className="hover:bg-[#EEF4FF]"
                                style={{ borderRadius: 10, padding: "10px 12px", marginBottom: 2, fontSize: 13, fontWeight: 600, color: "#001040" }}
                              >
                                {s.studentName || "Unnamed student"}
                              </SelectItem>
                            ))}
                          </>
                        );
                      })()}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Format toggle */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Label
                  style={{
                    fontSize: 10, fontWeight: 700, color: "#5070B0",
                    letterSpacing: "1.4px", textTransform: "uppercase",
                  }}
                >
                  Format
                </Label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {(['pdf', 'excel'] as const).map((f) => {
                    const active = params.format === f;
                    return (
                      <button
                        type="button"
                        key={f}
                        onClick={() => setParams({ ...params, format: f })}
                        style={{
                          height: 52, borderRadius: 14,
                          background: active
                            ? "linear-gradient(135deg,#0055FF 0%,#1166FF 100%)"
                            : "#fff",
                          color: active ? "#fff" : "#5070B0",
                          border: active ? "none" : "0.5px solid rgba(0,85,255,.12)",
                          boxShadow: active
                            ? "0 6px 18px rgba(0,85,255,.32), 0 2px 5px rgba(0,85,255,.18)"
                            : "0 1px 2px rgba(0,85,255,.04), 0 2px 8px rgba(0,85,255,.06)",
                          fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px",
                          cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                        }}
                      >
                        {f === 'pdf' ? <FileText size={16} /> : <TableIcon size={16} />}
                        {f === 'pdf' ? 'PDF' : 'Excel'}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Generate button — disabled when required fields missing */}
              <DialogFooter style={{ marginTop: 6 }}>
                {(() => {
                  const needsStudent =
                    report?.id === "individual_progress"
                    || (report?.id === "attendance_summary" && params.scope === "individual");
                  const isInvalid = !params.classId || (needsStudent && !params.studentId);
                  const isDisabled = isGenerating || isInvalid;
                  return (
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={isDisabled}
                      style={{
                        width: "100%", height: 52, borderRadius: 14,
                        background: isDisabled
                          ? "rgba(0,85,255,.35)"
                          : "linear-gradient(135deg,#0055FF 0%,#1166FF 100%)",
                        color: "#fff",
                        fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px",
                        border: "none",
                        boxShadow: isDisabled
                          ? "none"
                          : "0 6px 18px rgba(0,85,255,.32), 0 2px 5px rgba(0,85,255,.18)",
                        cursor: isGenerating ? "wait" : isInvalid ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                        opacity: isDisabled ? 0.7 : 1,
                      }}
                    >
                      {isGenerating ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                      ) : (
                        <><Sparkles className="w-4 h-4" /> Generate Report</>
                      )}
                    </button>
                  );
                })()}
              </DialogFooter>
            </div>
          ) : (
            <div className="text-left animate-in fade-in duration-300" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
               <div className="hidden print:block" style={{ borderBottom: "4px solid #0055FF", paddingBottom: 24, marginBottom: 24 }}>
                  <h1 style={{ fontSize: 32, fontWeight: 700, color: "#001040", letterSpacing: "-0.8px", margin: 0 }}>{report?.title || "Academic Report"}</h1>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#5070B0", letterSpacing: "0.8px", textTransform: "uppercase", marginTop: 8 }}>{(teacherData as any)?.branchName || (teacherData as any)?.branch || teacherData?.schoolName || 'Edullent'} · Report ID: {currentReportId?.substring(0,8)}</p>
               </div>

               {reportResult.isClassReport ? (
                 <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                   <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                     <StatCard label="Class Average" val={reportResult.summary?.avg || "N/A"} icon={TrendingUp} color="text-[#0055FF]" />
                     <StatCard label="Attendance"    val={reportResult.summary?.attendance || "N/A"} icon={Clock} color="text-[#00C853]" />
                     <StatCard label="Mastery Level" val={reportResult.summary?.mastery || "—"} icon={ShieldCheck} color="text-[#7B3FF4]" />
                   </div>

                   {reportResult.isAttendance && (
                     <div
                       style={{
                         background: "#fff", borderRadius: 16, padding: 16,
                         border: "0.5px solid rgba(0,85,255,.10)",
                         boxShadow: "0 1px 2px rgba(0,85,255,.06), 0 4px 12px rgba(0,85,255,.08)",
                       }}
                     >
                       <p style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.4px", textTransform: "uppercase", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
                         <AlertTriangle className="w-3.5 h-3.5" style={{ color: "#FF8800" }} /> Low Attendance (&lt;80%)
                       </p>
                       <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                         {reportResult.lowAttendance?.length > 0 ? reportResult.lowAttendance.map((s: any, i: number) => (
                           <div
                             key={i}
                             style={{
                               display: "flex", alignItems: "center", justifyContent: "space-between",
                               padding: "10px 14px", borderRadius: 12,
                               background: "rgba(255,51,85,.04)",
                               border: "0.5px solid rgba(255,51,85,.15)",
                             }}
                           >
                             <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                               <div style={{ width: 32, height: 32, borderRadius: 10, background: "#FF3355", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{s.name[0]}</div>
                               <p style={{ fontSize: 13, fontWeight: 700, color: "#001040", margin: 0, letterSpacing: "-0.2px" }}>{s.name}</p>
                             </div>
                             <p style={{ fontSize: 14, fontWeight: 700, color: "#FF3355", margin: 0, letterSpacing: "-0.3px" }}>{s.rate}%</p>
                           </div>
                         )) : (
                           <p style={{ fontSize: 12, fontWeight: 600, color: "#00C853", textAlign: "center", padding: "16px 0", margin: 0 }}>All students have stable attendance.</p>
                         )}
                       </div>
                     </div>
                   )}

                   {reportResult.isAtRisk && (
                     <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                       <p style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.4px", textTransform: "uppercase", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                         <ShieldAlert className="w-3.5 h-3.5" style={{ color: "#FF3355" }} /> At-Risk Students — {reportResult.atRiskList?.length || 0} flagged
                       </p>
                       {reportResult.atRiskList?.map((s: any, i: number) => (
                         <div
                           key={i}
                           style={{
                             background: "rgba(255,51,85,.04)", borderRadius: 14, padding: 14,
                             border: "0.5px solid rgba(255,51,85,.18)",
                             display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                           }}
                         >
                           <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                             <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#FF3355 0%,#FF6677 100%)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{s.name[0]}</div>
                             <div style={{ minWidth: 0 }}>
                               <h4 style={{ fontSize: 14, fontWeight: 700, color: "#001040", margin: "0 0 6px", letterSpacing: "-0.2px" }}>{s.name}</h4>
                               <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                 <span style={{ padding: "2px 8px", background: "#fff", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#5070B0", border: "0.5px solid rgba(0,85,255,.10)" }}>Score: {s.score}%</span>
                                 <span style={{ padding: "2px 8px", background: "#fff", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#5070B0", border: "0.5px solid rgba(0,85,255,.10)" }}>Att: {s.attendance}%</span>
                                 {s.hasNegNote && <span style={{ padding: "2px 8px", background: "rgba(255,51,85,.08)", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#FF3355", border: "0.5px solid rgba(255,51,85,.20)" }}>Behaviour Note</span>}
                               </div>
                             </div>
                           </div>
                         </div>
                       ))}
                     </div>
                   )}

                   {reportResult.chartData?.length > 0 && (
                     <div
                       style={{
                         background: "#fff", borderRadius: 16, padding: 16,
                         border: "0.5px solid rgba(0,85,255,.10)",
                         boxShadow: "0 1px 2px rgba(0,85,255,.06), 0 4px 12px rgba(0,85,255,.08)",
                       }}
                     >
                       <p style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.4px", textTransform: "uppercase", margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
                         <BarChart3 className="w-3.5 h-3.5" style={{ color: "#0055FF" }} /> Class Performance Distribution
                       </p>
                       <div style={{ height: 240, width: "100%" }}>
                         <ResponsiveContainer width="100%" height="100%">
                           <BarChart data={reportResult.chartData}>
                             <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF4FF" />
                             <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: "#5070B0" }} />
                             <YAxis axisLine={false} tickLine={false} hide />
                             <Tooltip cursor={{ fill: "rgba(0,85,255,.05)" }} contentStyle={{ borderRadius: 12, border: "0.5px solid rgba(0,85,255,.12)", boxShadow: "0 8px 24px rgba(0,85,255,.16)", fontSize: 11, fontWeight: 700, color: "#001040" }} />
                             <Bar dataKey="score" radius={[8, 8, 8, 8]} barSize={28}>
                               {reportResult.chartData?.map((_: any, index: number) => (
                                 <Cell key={`cell-${index}`} fill={["#0055FF", "#1166FF", "#7B3FF4", "#00B8D4", "#00C853"][index % 5]} />
                               ))}
                             </Bar>
                           </BarChart>
                         </ResponsiveContainer>
                       </div>
                     </div>
                   )}

                   {reportResult.aiRemarks && (
                     <div
                       style={{
                         background: "linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)",
                         borderRadius: 16, padding: 18, position: "relative", overflow: "hidden",
                         boxShadow: "0 6px 18px rgba(0,16,64,.32), 0 2px 5px rgba(0,16,64,.18)",
                       }}
                     >
                       <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.7)", letterSpacing: "1.4px", textTransform: "uppercase", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
                         <Sparkles className="w-3.5 h-3.5" /> Summary
                       </p>
                       <p style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,.92)", lineHeight: 1.55, margin: 0, letterSpacing: "-0.1px" }}>"{reportResult.aiRemarks}"</p>
                     </div>
                   )}
                 </div>
               ) : null}

               {/* Action buttons — Blue Apple themed, compact */}
               <div className="print:hidden" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                 {(report.id === "at_risk" || report.id === "attendance_summary") && (
                   <button
                     type="button"
                     onClick={() => handleSendToPortal('both')}
                     disabled={isSending || isSent}
                     style={{
                       gridColumn: "1 / -1",
                       height: 52, borderRadius: 14,
                       background: "linear-gradient(135deg,#001040 0%,#0033CC 70%,#0055FF 100%)",
                       color: "#fff",
                       fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px",
                       border: "none",
                       boxShadow: "0 6px 18px rgba(0,16,64,.32), 0 2px 5px rgba(0,16,64,.18)",
                       cursor: (isSending || isSent) ? "not-allowed" : "pointer", fontFamily: "inherit",
                       display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                       transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                       opacity: (isSending || isSent) ? 0.6 : 1,
                     }}
                   >
                     {isSending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Sparkles className="w-4 h-4" /> Send to Parent and Principal</>}
                   </button>
                 )}
                 <button
                   type="button"
                   onClick={() => handleSendToPortal('parent')}
                   disabled={isSending || isSent}
                   style={{
                     gridColumn: (report.id === "at_risk" || report.id === "attendance_summary") ? "1" : "1 / -1",
                     height: 52, borderRadius: 14,
                     background: "linear-gradient(135deg,#00A746 0%,#00C853 100%)",
                     color: "#fff",
                     fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px",
                     border: "none",
                     boxShadow: "0 6px 18px rgba(0,200,83,.32), 0 2px 5px rgba(0,200,83,.18)",
                     cursor: (isSending || isSent) ? "not-allowed" : "pointer", fontFamily: "inherit",
                     display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                     transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                     opacity: (isSending || isSent) ? 0.6 : 1,
                   }}
                 >
                   {isSending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><CheckCircle2 className="w-4 h-4" /> Send to Parent</>}
                 </button>
                 <button
                   type="button"
                   onClick={() => handleSendToPortal('principal')}
                   disabled={isSending || isSent}
                   style={{
                     gridColumn: (report.id === "at_risk" || report.id === "attendance_summary") ? "2" : "1 / -1",
                     height: 52, borderRadius: 14,
                     background: "linear-gradient(135deg,#0055FF 0%,#1166FF 100%)",
                     color: "#fff",
                     fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px",
                     border: "none",
                     boxShadow: "0 6px 18px rgba(0,85,255,.32), 0 2px 5px rgba(0,85,255,.18)",
                     cursor: (isSending || isSent) ? "not-allowed" : "pointer", fontFamily: "inherit",
                     display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                     transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                     opacity: (isSending || isSent) ? 0.6 : 1,
                   }}
                 >
                   {isSending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><ShieldCheck className="w-4 h-4" /> Send to Principal</>}
                 </button>
                 <button
                   type="button"
                   onClick={handleDownload}
                   style={{
                     gridColumn: "1 / -1",
                     height: 52, borderRadius: 14,
                     background: "#fff", color: "#0055FF",
                     fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px",
                     border: "0.5px solid rgba(0,85,255,.20)",
                     boxShadow: "0 1px 2px rgba(0,85,255,.06), 0 2px 8px rgba(0,85,255,.08)",
                     cursor: "pointer", fontFamily: "inherit",
                     display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                     transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                   }}
                 >
                   <Download className="w-4 h-4" />
                   {params.format === 'pdf' ? 'Open Printable Report' : 'Download Excel'}
                 </button>
               </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const StatCard = ({ label, val, icon: Icon, color }: any) => (
  <div
    style={{
      background: "#fff", borderRadius: 16, padding: 18,
      border: "0.5px solid rgba(0,85,255,.10)",
      boxShadow: "0 1px 2px rgba(0,85,255,.06), 0 4px 12px rgba(0,85,255,.08)",
      textAlign: "center",
    }}
  >
    <div
      className={color}
      style={{
        width: 38, height: 38, borderRadius: 12,
        background: "rgba(0,85,255,.06)",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 10px",
      }}
    >
      <Icon size={18} />
    </div>
    <p style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.2px", textTransform: "uppercase", margin: "0 0 6px" }}>{label}</p>
    <p style={{ fontSize: 22, fontWeight: 700, color: "#001040", letterSpacing: "-0.6px", margin: 0 }}>{val}</p>
  </div>
);

export default GenerateReport;
