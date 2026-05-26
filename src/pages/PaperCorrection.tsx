import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  type QueryConstraint,
} from "firebase/firestore";
import {
  Loader2,
  Upload,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Target,
  Sparkles,
  GraduationCap,
  RefreshCw,
  Award,
  BookOpen,
  Lightbulb,
  Heart,
  PenLine,
  Eye,
  Users,
  Brain,
  MessageCircle,
  Mail,
  Send,
  Zap,
  ScrollText,
  Save,
  BookmarkPlus,
  Settings2,
  ChevronRight,
  ListChecks,
  Printer,
} from "lucide-react";

// Brand color used throughout — kept as Tailwind arbitrary class strings
// (`bg-[#1e3272]`) so the static class scanner picks them up. Refactoring
// to a named color would require a tailwind.config theme entry — deferred
// since it's pure cosmetic and the inline arbitrary syntax already works.
import * as pdfjsLib from "pdfjs-dist";
// Bundle the PDF.js worker via Vite so it loads from same-origin (CSP-safe).
// Loading from CDN was being blocked by the page CSP and triggered a blob:
// "fake worker" fallback that is also blocked.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { toast } from "sonner";
import { AIController } from "../ai/controller/ai-controller";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { auditedAdd, auditedSet, auditedUpdate } from "../lib/auditedWrites";
import PushToGradebookModal from "../components/PushToGradebookModal";
import { tilt3D, tilt3DStyle, BLUE_SHADOW } from "../lib/use3DTilt";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ── Category presets ────────────────────────────────────────────────────────
// User-driven design: schools differ in format, so each preset only PRE-FILLS
// sensible defaults — every field stays editable per submission. The grading
// style is forwarded to the AI as `notes` so the prompt nudges accordingly.
type CategoryKey = "20_marks" | "80_marks";
type GradingStyle = "lenient" | "strict";

interface CategoryPreset {
  key: CategoryKey;
  label: string;
  sub: string;
  totalMarks: number;
  durationHint: string;
  questionsHint: string;
  defaultGrading: GradingStyle;
  promptNudge: string;
}

const CATEGORY_PRESETS: CategoryPreset[] = [
  {
    key: "20_marks",
    label: "20 Marks · Quick Test",
    sub: "Unit / surprise test · 30-45 min · 5-10 questions",
    totalMarks: 20,
    durationHint: "30-45 min",
    questionsHint: "5-10 questions",
    defaultGrading: "lenient",
    promptNudge: "This is a 20-mark quick test. Be lenient on partial credit — method right but small calculation slip should still get most of the marks. Expect 5-10 short-form questions.",
  },
  {
    key: "80_marks",
    label: "80 Marks · Major Exam",
    sub: "Mid-term / final · 2-3 hours · 15-25 questions",
    totalMarks: 80,
    durationHint: "2-3 hours",
    questionsHint: "15-25 questions",
    defaultGrading: "strict",
    promptNudge: "This is an 80-mark major exam. Grade strictly — full method must be shown, units and presentation count, expect step marks for multi-mark questions. Expect 15-25 mixed-format questions.",
  },
];

const GRADING_STYLE_NUDGE: Record<GradingStyle, string> = {
  lenient: "Grading style: LENIENT. Award partial marks generously. Method right with calculation slip should not lose more than 1 mark. Focus on whether the student understood the concept.",
  strict:  "Grading style: STRICT. Demand full method shown. Cut marks for missing units, missing steps, sloppy presentation. Method right but final wrong loses calculation marks. Expect step-by-step working.",
};

// ── Types — must match the JSON shape returned by paper_correction handler ──
type MistakeType =
  | "none" | "conceptual" | "calculation" | "missing_step"
  | "silly_mistake" | "incomplete" | "wrong_method"
  | "presentation" | "no_attempt" | "unreadable";

interface QuestionResult {
  number: string;
  question_text: string;
  max_marks: number;
  marks_awarded: number;
  verdict: "correct" | "partial" | "wrong" | "blank" | "unreadable";
  mistake_type?: MistakeType;
  student_answer_summary: string;
  correct_answer: string;
  comment: string;
  step_marks_breakdown?: string | null;
}

interface ConceptUnderstanding {
  concept: string;
  level: "strong" | "developing" | "weak";
  evidence: string;
}

interface ImprovementItem {
  area: string;
  action: string;
  priority: "high" | "medium" | "low";
}

interface CorrectionResult {
  subject: string;
  grade: string | null;
  totalMarks: number;
  marksScored: number;
  percentage: number;
  grade_band: "A+" | "A" | "B" | "C" | "D" | "E" | "F";
  overall_summary: string;
  handwriting_note?: string;
  presentation_note?: string;
  effort_note?: string;
  questions: QuestionResult[];
  concept_understanding?: ConceptUnderstanding[];
  strengths: string[];
  weaknesses: string[];
  improvement_plan: ImprovementItem[];
  encouragement: string;
  parent_note?: string;
  student_letter?: string;
}

const MAX_PAGES = 8;
const MAX_FILE_MB = 25;
// Target output image size — each page is rendered/downscaled so its longest
// edge equals TARGET_LONG_EDGE_PX. JPEG quality kept low because vision
// models grade handwriting fine at 1100px @ q=0.55. Combined with the page
// cap, total payload stays comfortably under the Firebase Functions 10 MB
// callable request limit (typical: ~80-110 KB per page → ~700 KB for 8 pp).
const TARGET_LONG_EDGE_PX = 1100;
const JPEG_QUALITY = 0.55;
// Hard ceiling on the assembled images payload. We refuse to send more than
// this so the client gets a friendly message instead of a 400 from the
// Functions runtime ("payload too large").
const MAX_TOTAL_IMAGE_BYTES = 7 * 1024 * 1024;

// ── Verdict styling ─────────────────────────────────────────────────────────
const VERDICT_STYLES: Record<QuestionResult["verdict"], { bg: string; ring: string; text: string; label: string; icon: React.ReactNode }> = {
  correct:    { bg: "bg-emerald-50",  ring: "ring-emerald-200",  text: "text-emerald-700",  label: "Correct",     icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  partial:    { bg: "bg-amber-50",    ring: "ring-amber-200",    text: "text-amber-700",    label: "Partial",     icon: <AlertCircle className="w-3.5 h-3.5" /> },
  wrong:      { bg: "bg-rose-50",     ring: "ring-rose-200",     text: "text-rose-700",     label: "Incorrect",   icon: <X className="w-3.5 h-3.5" /> },
  blank:      { bg: "bg-slate-50",    ring: "ring-slate-200",    text: "text-slate-600",    label: "Not attempted", icon: <X className="w-3.5 h-3.5" /> },
  unreadable: { bg: "bg-violet-50",   ring: "ring-violet-200",   text: "text-violet-700",   label: "Unreadable",  icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

const PRIORITY_STYLES: Record<ImprovementItem["priority"], string> = {
  high:   "bg-rose-50 text-rose-700 ring-rose-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low:    "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

// Short, classroom-style labels for the mistake taxonomy returned by the AI.
const MISTAKE_LABELS: Record<MistakeType, string> = {
  none:           "—",
  conceptual:     "Concept gap",
  calculation:    "Calculation slip",
  missing_step:   "Missing step",
  silly_mistake:  "Silly mistake",
  incomplete:     "Incomplete",
  wrong_method:   "Wrong method",
  presentation:   "Presentation",
  no_attempt:     "Not attempted",
  unreadable:     "Unreadable",
};
const MISTAKE_TONE: Record<MistakeType, string> = {
  none:           "bg-slate-50 text-slate-500 ring-slate-200",
  conceptual:     "bg-rose-50 text-rose-700 ring-rose-200",
  calculation:    "bg-amber-50 text-amber-800 ring-amber-200",
  missing_step:   "bg-amber-50 text-amber-800 ring-amber-200",
  silly_mistake:  "bg-yellow-50 text-yellow-800 ring-yellow-200",
  incomplete:     "bg-orange-50 text-orange-700 ring-orange-200",
  wrong_method:   "bg-rose-50 text-rose-700 ring-rose-200",
  presentation:   "bg-blue-50 text-blue-700 ring-blue-200",
  no_attempt:     "bg-slate-100 text-slate-600 ring-slate-200",
  unreadable:     "bg-violet-50 text-violet-700 ring-violet-200",
};

const CONCEPT_LEVEL_STYLES: Record<ConceptUnderstanding["level"], { dot: string; text: string; label: string }> = {
  strong:     { dot: "bg-emerald-500", text: "text-emerald-700", label: "Strong" },
  developing: { dot: "bg-amber-500",   text: "text-amber-700",   label: "Developing" },
  weak:       { dot: "bg-rose-500",    text: "text-rose-700",    label: "Weak" },
};

const GRADE_BAND_STYLES: Record<CorrectionResult["grade_band"], { bg: string; text: string; ring: string }> = {
  "A+": { bg: "bg-emerald-500",  text: "text-white", ring: "ring-emerald-200" },
  "A":  { bg: "bg-emerald-400",  text: "text-white", ring: "ring-emerald-200" },
  "B":  { bg: "bg-blue-500",     text: "text-white", ring: "ring-blue-200" },
  "C":  { bg: "bg-amber-500",    text: "text-white", ring: "ring-amber-200" },
  "D":  { bg: "bg-orange-500",   text: "text-white", ring: "ring-orange-200" },
  "E":  { bg: "bg-rose-500",     text: "text-white", ring: "ring-rose-200" },
  "F":  { bg: "bg-rose-700",     text: "text-white", ring: "ring-rose-200" },
};

// ── Session types — class-centric batch grading ────────────────────────────
interface ClassRow { id: string; name?: string; grade?: string }
interface TestRow {
  id: string;
  testName?: string;
  title?: string;
  subject?: string;
  topic?: string;
  topics?: string[];
  classId?: string;
  className?: string;
  marks?: string | number;
  testDate?: string;
  category?: string;
}
interface StudentRow { id: string; name?: string; email?: string }

// Safely strip slashes / dots from doc IDs — same defense as EnterScores.
const safeDocId = (raw: string): string => raw.replace(/[/.]/g, "_");

// ── Main component ─────────────────────────────────────────────────────────
const PaperCorrection = () => {
  const { teacherData } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CorrectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Category preset + grading style — both feed into the AI prompt and the
  // saved record. Default to 20-marks lenient so a teacher who just clicks
  // through still gets a sensible run.
  const [category, setCategory] = useState<CategoryKey>("20_marks");
  const [gradingStyle, setGradingStyle] = useState<GradingStyle>("lenient");

  const [studentName, setStudentName] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [answerKey, setAnswerKey] = useState("");

  // Persistence state — once result lands, auto-save to paper_corrections so a
  // page refresh doesn't lose the work + cross-dashboard readers can pick it up.
  const [savedCorrectionId, setSavedCorrectionId] = useState<string | null>(null);
  const [pushModalOpen, setPushModalOpen] = useState(false);

  // ── Grading session state ────────────────────────────────────────────────
  // Class-centric batch grading. Once a session is set (class + test),
  // student field becomes a dropdown of class roster, push happens inline
  // (no modal), and the page tracks which students are already graded.
  const [sessionClassId, setSessionClassId] = useState("");
  const [sessionTestId, setSessionTestId] = useState("");
  const [sessionStudentId, setSessionStudentId] = useState("");
  const [sessionStudentEmail, setSessionStudentEmail] = useState("");
  const [sessionClasses, setSessionClasses] = useState<ClassRow[]>([]);
  const [sessionTests, setSessionTests] = useState<TestRow[]>([]);
  const [sessionStudents, setSessionStudents] = useState<StudentRow[]>([]);
  const [gradedStudentIds, setGradedStudentIds] = useState<Set<string>>(new Set());
  const [setupOpen, setSetupOpen] = useState(false); // session picker modal
  const [pushing, setPushing] = useState(false);     // inline push in flight

  const sessionActive = !!(sessionClassId && sessionTestId);
  const selectedClass = useMemo(() => sessionClasses.find(c => c.id === sessionClassId), [sessionClasses, sessionClassId]);
  const selectedTest = useMemo(() => sessionTests.find(t => t.id === sessionTestId), [sessionTests, sessionTestId]);
  const selectedStudent = useMemo(() => sessionStudents.find(s => s.id === sessionStudentId), [sessionStudents, sessionStudentId]);
  const pendingStudents = useMemo(
    () => sessionStudents.filter(s => !gradedStudentIds.has(s.id)),
    [sessionStudents, gradedStudentIds],
  );

  // P0-1: clicking a category pre-fills the marks field + sets the AI's
  // default grading style. User can still edit any field.
  const applyPreset = (key: CategoryKey) => {
    const preset = CATEGORY_PRESETS.find(p => p.key === key);
    if (!preset) return;
    setCategory(key);
    setTotalMarks(String(preset.totalMarks));
    setGradingStyle(preset.defaultGrading);
  };

  // Apply default preset on mount so the form is never in an unset state.
  // Only runs once — won't clobber user edits afterwards.
  useEffect(() => {
    if (!totalMarks) {
      const preset = CATEGORY_PRESETS.find(p => p.key === category);
      if (preset) setTotalMarks(String(preset.totalMarks));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Session listeners — load classes assigned to this teacher ──────────
  // Union pattern: a teacher's class list = (teaching_assignments by teacherId)
  // ∪ (classes.teacherId by teacherId), filtered against the school's class
  // docs. The previous single-source `classes.teacherId` query silently missed
  // every class a teacher was assigned to ONLY via teaching_assignments → a
  // freshly-onboarded teacher saw an empty class dropdown here. Memory:
  // bug_pattern_teacher_class_pickers_single_source.
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    const tId = teacherData.id;

    let assignedIds = new Set<string>();
    let legacyOwnedIds = new Set<string>();
    let allClassDocs: ClassRow[] = [];

    const recompute = () => {
      const allowed = new Set<string>([...assignedIds, ...legacyOwnedIds]);
      const cls = allowed.size === 0 ? [] : allClassDocs.filter(c => allowed.has(c.id));
      setSessionClasses(cls);
    };

    // teaching_assignments — active filter is client-side (legacy docs may
    // not carry a status field; server-side `status == "active"` would drop them).
    const uTa = onSnapshot(
      query(collection(db, "teaching_assignments"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => {
        const active = snap.docs.filter(d => {
          const s = (d.data() as { status?: unknown }).status;
          return !s || (typeof s === "string" && s.toLowerCase() === "active");
        });
        assignedIds = new Set(active.map(d => (d.data() as { classId?: string }).classId).filter((x): x is string => !!x));
        recompute();
      },
      (err) => console.error("[PaperCorrection] teaching_assignments listener failed", err),
    );

    // classes.teacherId — legacy denormalized primary teacher
    const uLegacy = onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => { legacyOwnedIds = new Set(snap.docs.map(d => d.id)); recompute(); },
      (err) => console.error("[PaperCorrection] classes-legacy listener failed", err),
    );

    // All school classes — resolves metadata for assigned-but-not-owned classes
    const uAll = onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId)),
      (snap) => {
        allClassDocs = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id })) as ClassRow[];
        recompute();
      },
      (err) => console.error("[PaperCorrection] classes-all listener failed", err),
    );

    return () => { uTa(); uLegacy(); uAll(); };
  }, [teacherData?.id, teacherData?.schoolId]);

  // Load tests for the selected class
  useEffect(() => {
    if (!sessionClassId || !teacherData?.schoolId) {
      setSessionTests([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, "tests"),
        where("schoolId", "==", teacherData.schoolId),
        where("classId", "==", sessionClassId),
      ),
      (snap) => {
        const ts = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id })) as TestRow[];
        ts.sort((a, b) => String(b.testDate || "").localeCompare(String(a.testDate || "")));
        setSessionTests(ts);
      },
      (err) => console.error("[PaperCorrection] tests listener failed", err),
    );
    return () => unsub();
  }, [sessionClassId, teacherData?.schoolId]);

  // Load student roster for the selected class
  useEffect(() => {
    if (!sessionClassId || !teacherData?.schoolId) {
      setSessionStudents([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, "enrollments"),
        where("schoolId", "==", teacherData.schoolId),
        where("classId", "==", sessionClassId),
      ),
      (snap) => {
        const list: StudentRow[] = snap.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: String(data.studentId ?? d.id),
            name: typeof data.studentName === "string" ? data.studentName : "",
            email: typeof data.studentEmail === "string" ? (data.studentEmail as string).toLowerCase() : "",
          };
        });
        const seen = new Set<string>();
        const dedup = list.filter(s => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        dedup.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setSessionStudents(dedup);
      },
      (err) => console.error("[PaperCorrection] students listener failed", err),
    );
    return () => unsub();
  }, [sessionClassId, teacherData?.schoolId]);

  // Watch test_scores for the selected test → mark which students are
  // already graded so the picker can show ✓ next to their names.
  useEffect(() => {
    if (!sessionTestId || !teacherData?.schoolId) {
      setGradedStudentIds(new Set());
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, "test_scores"),
        where("schoolId", "==", teacherData.schoolId),
        where("testId", "==", sessionTestId),
      ),
      (snap) => {
        const ids = new Set<string>();
        snap.docs.forEach(d => {
          const data = d.data() as { studentId?: unknown };
          if (typeof data.studentId === "string" && data.studentId) ids.add(data.studentId);
        });
        setGradedStudentIds(ids);
      },
      (err) => console.error("[PaperCorrection] test_scores listener failed", err),
    );
    return () => unsub();
  }, [sessionTestId, teacherData?.schoolId]);

  // When test changes (or set fresh), inherit subject + grade + totalMarks
  // + (P2-3) any answer key / blueprint description hints from the test doc
  // — so AI prompt + form aligns with what the teacher already specified
  // when creating the test in TestsExams.
  useEffect(() => {
    if (!selectedTest) return;
    const inheritedSubject = (selectedTest.subject || "").trim();
    const inheritedClassName = (selectedClass?.name || selectedTest.className || "").trim();
    const inheritedMarks = String(selectedTest.marks ?? "").trim();
    if (inheritedSubject && !subject.trim())   setSubject(inheritedSubject);
    if (inheritedClassName && !grade.trim())   setGrade(inheritedClassName);
    if (inheritedMarks)                         setTotalMarks(inheritedMarks);
    // P2-3: tests doc may carry a description / topic hint that doubles as
    // a marking-scheme nudge for the AI. Only pre-fill when teacher hasn't
    // typed anything in the answer key field yet.
    const testDesc = String((selectedTest as { description?: unknown }).description || "").trim();
    if (testDesc && !answerKey.trim()) {
      setAnswerKey(`Test brief: ${testDesc}`);
    }
  }, [selectedTest, selectedClass]); // eslint-disable-line react-hooks/exhaustive-deps

  // When student picked from session dropdown, mirror name into the existing
  // free-text studentName field so AI prompt + saved record are consistent.
  useEffect(() => {
    if (!selectedStudent) return;
    setStudentName(selectedStudent.name || "");
    setSessionStudentEmail(selectedStudent.email || "");
  }, [selectedStudent]);

  // Auto-open the session setup the FIRST time a teacher with classes lands
  // here — but only if no session is already set + they have classes.
  useEffect(() => {
    if (!sessionActive && sessionClasses.length > 0 && !setupOpen) {
      // Don't auto-open repeatedly — set on first load only via a ref guard.
      // For simplicity, leave it manual — teacher clicks "Start grading session".
    }
  }, [sessionActive, sessionClasses.length, setupOpen]);

  // P2-1: drift derivation — does AI's claimed marksScored match the sum of
  // per-question marks_awarded? Catches the rare case where the model
  // hallucinates a different summary number than its own breakdown supports.
  // Banner is rendered only when there's a real mismatch (>0.5 diff).
  const drift = useMemo(() => {
    if (!result) return null;
    const claimed = Number(result.marksScored);
    const sum = (result.questions || []).reduce(
      (acc, q) => acc + (Number.isFinite(Number(q.marks_awarded)) ? Number(q.marks_awarded) : 0),
      0,
    );
    if (!Number.isFinite(claimed)) return null;
    if (Math.abs(claimed - sum) <= 0.5) return null;
    return { claimed, sum, total: result.totalMarks };
  }, [result]);

  // P2-5: Cmd+Enter / Ctrl+Enter triggers Submit from anywhere on the page.
  // Skipped while loading or extracting so it doesn't fire double calls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !loading && !extracting && pageImages.length > 0) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // submit reads latest state via closure; binding it here would re-bind
    // on every keystroke for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, extracting, pageImages.length]);

  // Quick-pick the next pending student into the session (for "Next student"
  // suggestion after a successful push).
  const goToNextStudent = () => {
    const next = pendingStudents.find(s => s.id !== sessionStudentId);
    if (next) {
      setSessionStudentId(next.id);
      // Clear previous paper but KEEP session context
      setFile(null);
      setPageImages([]);
      setPageCount(0);
      setResult(null);
      setError(null);
      setSavedCorrectionId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.message(`Ready for ${next.name || "next student"}. Upload their paper.`);
    } else {
      toast.success("All students in this class graded for this test!");
    }
  };

  // Inline one-click push — used when session is active. Skips the modal.
  // Writes directly to test_scores using the same shape as EnterScores.tsx.
  //
  // Two safety layers vs blind overwrite:
  //   1. If the student already has a score, ask the teacher to confirm BEFORE
  //      replacing it. Surfaces silently-trampled data the user reported.
  //   2. Use setDoc({merge:true}) so any external fields (e.g. teacher
  //      comment from another flow) survive the AI push.
  // After a successful push, also update the parent `tests` doc status to
  // "Completed" if every enrolled student now has a score — mirrors what
  // EnterScores does at end of its bulk save so TestsExams shows the right
  // green badge.
  const handleQuickPush = async () => {
    if (!result || !sessionActive || !selectedTest || !selectedStudent || !teacherData?.id) return;
    const scoreNum = Number(result.marksScored);
    const maxScore = Number(selectedTest.marks) || result.totalMarks || 0;
    if (!Number.isFinite(scoreNum) || scoreNum < 0) return toast.error("AI returned invalid marks. Cannot push.");
    if (maxScore <= 0) return toast.error("Test has no max marks defined. Edit the test first.");
    if (scoreNum > maxScore) return toast.error(`AI marks (${scoreNum}) exceed test max (${maxScore}). Cannot push.`);

    // Layer 1 — confirmation if overwriting. Native window.confirm keeps the
    // critical-write decision squarely in front of the teacher; previously
    // the only signal was an inline amber badge above the green push button.
    const isAlreadyGraded = gradedStudentIds.has(sessionStudentId);
    if (isAlreadyGraded) {
      const ok = window.confirm(
        `${selectedStudent.name || "This student"} already has a score for ${selectedTest.testName || selectedTest.title || "this test"}.\n\nReplace existing marks with AI-corrected ${scoreNum}/${maxScore}?`,
      );
      if (!ok) return;
    }

    setPushing(true);
    try {
      const inheritedSubject = (selectedTest.subject || subject || "").trim();
      const firstArrayTopic = Array.isArray(selectedTest.topics) && selectedTest.topics.length > 0
        ? String(selectedTest.topics[0] || "").trim() : "";
      const inheritedTopic = (firstArrayTopic || selectedTest.topic || selectedTest.subject || selectedTest.title || "").trim();
      const inheritedClassName = (selectedTest.className || selectedClass?.name || "").toLowerCase().trim();
      const pct = (scoreNum / maxScore) * 100;

      // Layer 2 — merge:true preserves any fields the doc already had
      // (e.g. another tool's comment field) instead of full overwrite.
      await auditedSet(
        doc(db, "test_scores", safeDocId(`${sessionTestId}_${sessionStudentId}`)),
        {
          testId: sessionTestId,
          testName: selectedTest.testName || selectedTest.title || "",
          studentId: sessionStudentId,
          studentName: selectedStudent.name || "",
          studentEmail: sessionStudentEmail || selectedStudent.email || "",
          classId: sessionClassId,
          className: inheritedClassName,
          subject: inheritedSubject,
          topic: inheritedTopic,
          teacherId: teacherData.id,
          schoolId: teacherData.schoolId || "",
          branchId: teacherData.branchId || "",
          score: scoreNum,
          maxScore,
          percentage: pct,
          grade: result.grade_band || "-",
          isAbsent: false,
          timestamp: serverTimestamp(),
          source: "ai_paper_correction",
          correctionId: savedCorrectionId || "",
        },
        { merge: true },
      );

      // Mark paper_corrections as pushed
      if (savedCorrectionId) {
        try {
          await updateDoc(doc(db, "paper_corrections", savedCorrectionId), {
            status: "pushed_to_gradebook",
            pushedToGradebookAt: serverTimestamp(),
            pushedTestId: sessionTestId,
            pushedStudentId: sessionStudentId,
          });
        } catch (e) {
          console.warn("[PaperCorrection] correction status update failed", e);
        }
      }

      // Sync `tests` doc status when this push completes the class — mirrors
      // EnterScores's final step. Without this, TestsExams keeps showing
      // "In Progress" even after the last student is graded.
      const nextGradedSize = gradedStudentIds.size + (isAlreadyGraded ? 0 : 1);
      const enrolledCount = sessionStudents.length;
      if (enrolledCount > 0 && nextGradedSize >= enrolledCount) {
        try {
          await auditedUpdate(doc(db, "tests", sessionTestId), {
            status: "Completed",
          });
        } catch (e) {
          console.warn("[PaperCorrection] tests status update failed", e);
        }
      }

      toast.success(
        isAlreadyGraded
          ? `${selectedStudent.name || "Student"} · marks updated to ${scoreNum}/${maxScore}.`
          : `${selectedStudent.name || "Student"} · ${scoreNum}/${maxScore} saved to gradebook.`,
      );

      // Suggest next student
      const next = pendingStudents.find(s => s.id !== sessionStudentId);
      if (next) {
        setTimeout(() => {
          toast.message(`Next: ${next.name}`, {
            action: { label: "Start", onClick: goToNextStudent },
            duration: 6000,
          });
        }, 500);
      } else {
        setTimeout(() => {
          toast.success("Class complete — every student graded!");
        }, 500);
      }
    } catch (e) {
      console.error("[PaperCorrection] quick push failed", e);
      const code = (e as { code?: string })?.code;
      if (code === "permission-denied") {
        toast.error("Permission denied — Firestore rules not deployed yet. Run `firebase deploy --only firestore:rules`.");
      } else {
        toast.error("Failed to push marks. Try again.");
      }
    } finally {
      setPushing(false);
    }
  };

  const closeSession = () => {
    setSessionClassId("");
    setSessionTestId("");
    setSessionStudentId("");
    setSessionStudentEmail("");
  };

  // ── PDF → JPEG conversion ──────────────────────────────────────────────
  // Each page is rendered to a canvas at a scale chosen so the longest side
  // equals TARGET_LONG_EDGE_PX, then encoded as JPEG. This caps total
  // payload predictably regardless of source PDF DPI.
  const renderPdfToImages = async (f: File): Promise<string[]> => {
    const buf = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    try {
      const pageLimit = Math.min(pdf.numPages, MAX_PAGES);
      const images: string[] = [];

      for (let i = 1; i <= pageLimit; i++) {
        const page = await pdf.getPage(i);
        try {
          // Native viewport at scale=1 so we know the source dimensions.
          const baseViewport = page.getViewport({ scale: 1 });
          const longest = Math.max(baseViewport.width, baseViewport.height);
          const targetScale = TARGET_LONG_EDGE_PX / longest;
          const viewport = page.getViewport({ scale: targetScale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D context not available.");
          // Fill white so transparent backgrounds don't end up black in JPEG.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          images.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
        } finally {
          // P3-1: release the page's underlying resources after we've
          // captured the JPEG. Without this, large multi-page PDFs hold
          // their decoded textures in memory until GC eventually runs.
          page.cleanup();
        }
      }
      return images;
    } finally {
      // Tear down the document worker connection + dispose of cached data.
      // Critical for batch grading sessions where teacher uploads dozens
      // of PDFs in succession.
      await pdf.destroy();
    }
  };

  // Approximate decoded byte size of a base64 data URL.
  const dataUrlBytes = (dataUrl: string): number => {
    const commaIdx = dataUrl.indexOf(",");
    const base64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
    // base64 expands raw bytes by 4/3.
    return Math.floor(base64Len * 0.75);
  };

  // Lenient PDF detection — macOS Safari + drag-from-Preview + some
  // Windows builds report the MIME as empty string OR "application/x-pdf"
  // instead of "application/pdf", which the old strict equality check
  // rejected. Accept any of: known PDF MIMEs, .pdf extension, or magic-byte
  // signature check (sniffs the first 4 bytes for "%PDF").
  const isPdfFile = async (f: File): Promise<boolean> => {
    const okMimes = new Set(["application/pdf", "application/x-pdf", "application/acrobat", "text/pdf"]);
    if (okMimes.has((f.type || "").toLowerCase())) return true;
    if (/\.pdf$/i.test(f.name || "")) return true;
    // Final sanity check — sniff the magic header.
    try {
      const head = await f.slice(0, 5).arrayBuffer();
      const bytes = new Uint8Array(head);
      // %PDF = 0x25 0x50 0x44 0x46
      return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    } catch {
      return false;
    }
  };

  const handleFile = useCallback(async (selectedFile: File) => {
    if (!selectedFile) {
      setError("No file selected.");
      return;
    }
    if (!(await isPdfFile(selectedFile))) {
      setError("Only PDF files are allowed. Drag or pick a .pdf file.");
      return;
    }
    if (selectedFile.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File size must be under ${MAX_FILE_MB} MB.`);
      return;
    }
    if (selectedFile.size === 0) {
      setError("This file is empty (0 bytes). Re-export and try again.");
      return;
    }
    setError(null);
    setResult(null);
    setFile(selectedFile);
    setExtracting(true);
    try {
      const imgs = await renderPdfToImages(selectedFile);
      if (imgs.length === 0) throw new Error("PDF has no readable pages.");
      setPageImages(imgs);
      setPageCount(imgs.length);
    } catch (e) {
      console.error("[PaperCorrection] PDF render failed", e);
      const msg = (e as { message?: string })?.message || "";
      // Surface the actionable cause when we can detect it. Two macOS-
      // specific failure modes worth naming:
      //   1. Password-protected PDFs (Preview-encrypted exports)
      //   2. Pages with embedded fonts pdf.js can't decode
      if (/password|encrypted/i.test(msg)) {
        setError("This PDF is password-protected. Open it in Preview and export as a new unprotected PDF.");
      } else if (/invalid|corrupt|malformed/i.test(msg)) {
        setError("PDF appears corrupt. Re-scan or re-export and try again.");
      } else {
        setError("Could not read PDF. Try a different file or re-scan as a clean PDF.");
      }
      setFile(null);
      setPageImages([]);
    }
    setExtracting(false);
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const reset = () => {
    setFile(null);
    setPageImages([]);
    setPageCount(0);
    setResult(null);
    setError(null);
    setSavedCorrectionId(null);
    setPushModalOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Send-to-parent state — scoped per-correction so re-grading another paper
  // resets the "Sent" pill. Only enabled when the correction has been saved
  // (we need the doc id to flip the flag) AND we have a usable student
  // identifier (studentId or studentEmail) — otherwise the parent dashboard
  // can't match the doc back to a student via its dual-query reader.
  const [sendingToParent, setSendingToParent] = useState(false);
  const [sentToParent, setSentToParent] = useState(false);

  const handleSendToParent = async () => {
    if (!savedCorrectionId) {
      toast.error("Result not saved to cloud yet. Try again in a moment.");
      return;
    }
    if (!result) {
      toast.error("No correction result to send.");
      return;
    }
    if (sentToParent || sendingToParent) return;
    // Student-identity preflight — parent ReportsPage filters via
    // (studentId OR studentEmail). Without either, the publish would be
    // unreachable on the parent side.
    const sId = selectedStudent?.id || sessionStudentId || "";
    const sEmail = (selectedStudent?.email || sessionStudentEmail || "").toLowerCase();
    if (!sId && !sEmail) {
      toast.error("Pick the student first (use 'Start Grading' to select class + student).");
      return;
    }

    // Resolve marks from EVERY possible source — the AI sometimes returns
    // marksScored: 0 at the top level even when per-question marks_awarded
    // sum to a real positive total. Prefer the most-truthful source so the
    // parent's card never shows "0/20" when real marks exist in the result.
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const qSum = Array.isArray(result.questions)
      ? result.questions.reduce((s, q: any) => s + (num(q?.marks_awarded) ?? 0), 0)
      : 0;
    const finalMarksScored =
      (num(result.marksScored) ?? 0) > 0 ? Number(result.marksScored)
      : qSum > 0 ? qSum
      : (num(result.marksScored) ?? 0);
    const finalTotalMarks = num(result.totalMarks) ?? Number(totalMarks) ?? 0;
    const finalPercentage = finalTotalMarks > 0
      ? Math.round((finalMarksScored / finalTotalMarks) * 1000) / 10
      : (num(result.percentage) ?? 0);

    setSendingToParent(true);
    try {
      await updateDoc(doc(db, "paper_corrections", savedCorrectionId), {
        publishedToParent: true,
        publishedToParentAt: serverTimestamp(),
        // Backfill identity fields in case the original write was made before
        // the teacher had selected a student (free-text mode).
        studentId: sId,
        studentEmail: sEmail,
        classId: sessionClassId || "",
        className: selectedClass?.name || "",
        // RE-STAMP marks on every send so the parent always gets the freshest
        // numbers. If the initial save captured marksScored:0 (AI omitted the
        // top-level field) but per-question marks sum to a real total, this
        // overwrite ensures the parent sees the truth.
        marksScored: finalMarksScored,
        totalMarks: finalTotalMarks,
        percentage: finalPercentage,
        gradeBand: result.grade_band || "C",
        // Also refresh the result blob in case the teacher manually edited
        // any question scores in the in-memory result (future-proofing).
        result,
      });
      setSentToParent(true);
      toast.success(`Paper sent to ${selectedStudent?.name || studentName.trim() || "student"}'s parent.`);
    } catch (err) {
      console.error("[PaperCorrection] send-to-parent failed", err);
      toast.error("Couldn't send to parent. Please try again.");
    } finally {
      setSendingToParent(false);
    }
  };

  // Reset sent-to-parent flag whenever the saved correction id changes — a
  // new correction starts fresh, an old one keeps its sent state.
  useEffect(() => { setSentToParent(false); }, [savedCorrectionId]);

  // P0-2: persist the AI correction result to Firestore so it survives refresh
  // and is visible to parent/principal/owner readers. Best-effort: a failed
  // write does NOT block the user from viewing the result on screen — they
  // just lose persistence + push-to-gradebook.
  const persistCorrection = async (correction: CorrectionResult): Promise<string | null> => {
    if (!teacherData?.id || !teacherData?.schoolId) return null;
    try {
      const preset = CATEGORY_PRESETS.find(p => p.key === category);
      // Resolve marks defensively — AI sometimes emits marksScored: 0 at the
      // top level while per-question marks_awarded sum to a real total.
      // Prefer the truthful number so the denormalized field never lies.
      const safeNum = (v: unknown): number => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const qSum = Array.isArray(correction.questions)
        ? correction.questions.reduce((s, q: any) => s + safeNum(q?.marks_awarded), 0)
        : 0;
      const topMarks = safeNum(correction.marksScored);
      const resolvedMarks = topMarks > 0 ? topMarks : (qSum > 0 ? qSum : topMarks);
      const resolvedTotal = safeNum(correction.totalMarks) || safeNum(totalMarks);
      const resolvedPct = resolvedTotal > 0
        ? Math.round((resolvedMarks / resolvedTotal) * 1000) / 10
        : (typeof correction.percentage === "number" ? correction.percentage : 0);

      const docRef = await auditedAdd(collection(db, "paper_corrections"), {
        // Identity
        schoolId: teacherData.schoolId,
        branchId: teacherData.branchId || "",
        teacherId: teacherData.id,
        teacherName: teacherData.name || teacherData.displayName || "",
        // Student identity — populated from the session picker when available
        // (sessionActive ⇒ teacher picked class+student from the side panel),
        // otherwise just the free-text name. studentId + studentEmail let the
        // parent-dashboard ReportsPage filter via the dual-query pattern.
        studentName: (selectedStudent?.name || studentName.trim() || "").toString(),
        studentId: sessionActive ? (selectedStudent?.id || sessionStudentId || "") : "",
        studentEmail: sessionActive ? (selectedStudent?.email || sessionStudentEmail || "").toLowerCase() : "",
        classId: sessionActive ? (sessionClassId || "") : "",
        className: sessionActive ? (selectedClass?.name || "") : "",
        // Paper meta (snapshot of form values at submit time)
        category,
        categoryLabel: preset?.label || "",
        gradingStyle,
        subject: subject.trim() || correction.subject || "",
        grade: grade.trim() || correction.grade || "",
        totalMarks: resolvedTotal,
        totalPages: pageImages.length,
        // Headline result (denormalized for cheap list views)
        marksScored: resolvedMarks,
        percentage: resolvedPct,
        gradeBand: correction.grade_band || "C",
        // Full result blob (consumed by detail views / re-renders)
        result: correction,
        // Status flow: saved → pushed_to_gradebook → published_to_parent (independent flag)
        status: "saved",
        publishedToParent: false,
        source: "ai_paper_correction",
        createdAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (e) {
      console.error("[PaperCorrection] persist failed", e);
      // Quiet failure — toast info, not error, since the on-screen result still works.
      toast.message("Saved locally. Could not sync to cloud — check connection.");
      return null;
    }
  };

  const submit = async () => {
    if (!pageImages.length) {
      setError("Upload a scanned paper first.");
      return;
    }
    if (sessionActive && !sessionStudentId) {
      setError("Pick a student from the class roster first.");
      return;
    }
    // Defensive — refuse oversize payloads on the client so the user sees a
    // clear "too many pages" hint instead of a generic 400 from Cloud Run.
    const totalBytes = pageImages.reduce((sum, img) => sum + dataUrlBytes(img), 0);
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      const mb = (totalBytes / 1024 / 1024).toFixed(1);
      setError(`Paper is too large to send (${mb} MB). Try fewer pages or a lower-res scan.`);
      return;
    }
    setLoading(true);
    setError(null);
    setSavedCorrectionId(null);
    try {
      const preset = CATEGORY_PRESETS.find(p => p.key === category);
      // Compose the AI's `notes` field: category-specific framing + grading
      // style nudge. The cloud function appends this verbatim to the user
      // prompt's "Extra grading notes from teacher" line.
      const aiNotes = [preset?.promptNudge, GRADING_STYLE_NUDGE[gradingStyle]]
        .filter(Boolean)
        .join(" ");

      const res = await AIController.getPaperCorrection({
        images: pageImages,
        subject: subject.trim() || undefined,
        grade: grade.trim() || undefined,
        totalMarks: totalMarks ? Number(totalMarks) : undefined,
        studentName: studentName.trim() || undefined,
        answerKey: answerKey.trim() || undefined,
        notes: aiNotes,
      });
      if (res.status === "success" && res.data) {
        const data = res.data as CorrectionResult;
        // P0-4 defensive: if AI omitted/garbled `percentage`, derive from marks.
        if (typeof data.percentage !== "number" || !Number.isFinite(data.percentage)) {
          const m = Number(data.marksScored);
          const t = Number(data.totalMarks);
          data.percentage = (Number.isFinite(m) && Number.isFinite(t) && t > 0)
            ? Math.round((m / t) * 1000) / 10
            : 0;
        }
        // Defensive: ensure questions array is at least an empty array so .map doesn't blow up
        if (!Array.isArray(data.questions)) data.questions = [];
        setResult(data);
        // Auto-save in background — does not block UI render.
        persistCorrection(data).then(id => { if (id) setSavedCorrectionId(id); });
        setTimeout(() => {
          document.getElementById("correction-results")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 100);
      } else {
        // All non-success variants (no_data | error | not_implemented) carry message.
        const msg = "message" in res ? res.message : "";
        setError(msg || "Could not correct the paper. Please try again.");
      }
    } catch (e) {
      console.error("[PaperCorrection] submit failed", e);
      setError("AI service failed. Please retry in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-[#EEF4FF]">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-8 print-hide">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1e3272]/10 text-[#1e3272] text-[12px] font-medium mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            AI Paper Correction
          </div>
          <h1 className="text-[28px] sm:text-[32px] font-normal tracking-[-0.02em] text-slate-900 leading-[1.15]">
            Scan, upload, and let AI correct it like a real teacher.
          </h1>
          <p className="mt-2 text-[15px] text-slate-500 max-w-[680px] leading-[1.5]">
            Upload a student's scanned exam paper as PDF. The AI reads every
            question, awards marks, identifies strengths and weaknesses, and
            writes warm, personal feedback — just like you would in red pen.
          </p>
        </div>

        {/* ── Grading Session panel (full width, primary CTA) ────────────────
         * Class-centric batch flow: teacher sets class + test ONCE here, then
         * for each student paper they upload, the picker is pre-filtered to
         * the class roster + the push button writes directly to the chosen
         * test (no modal). Standalone single-correction mode still works
         * when no session is active — push opens the modal as before. */}
        <div className="print-hide">
        <SessionPanel
          active={sessionActive}
          classes={sessionClasses}
          tests={sessionTests}
          students={sessionStudents}
          gradedIds={gradedStudentIds}
          classId={sessionClassId}
          testId={sessionTestId}
          studentId={sessionStudentId}
          selectedClass={selectedClass}
          selectedTest={selectedTest}
          onClassChange={(id) => { setSessionClassId(id); setSessionTestId(""); setSessionStudentId(""); }}
          onTestChange={(id) => { setSessionTestId(id); setSessionStudentId(""); }}
          onStudentChange={(id) => setSessionStudentId(id)}
          onClose={closeSession}
          onOpenSetup={() => setSetupOpen(true)}
          setupOpen={setupOpen}
          onCloseSetup={() => setSetupOpen(false)}
        />
        </div>

        {/* ── Category preset picker (full width) ─────────────────────────────
         * Two presets — 20 marks (quick test) and 80 marks (major exam). Each
         * pre-fills sensible defaults but every form field below remains
         * editable per submission so any school's paper format works. The
         * choice also tags the saved correction (analytics) and nudges the AI
         * prompt for grading expectations. */}
        <div {...tilt3D} className="bg-white rounded-2xl p-5 sm:p-6 mb-6 print-hide" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <div className="text-[11.5px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                Step 1 · Choose paper type
              </div>
              <div className="text-[15px] font-medium text-slate-900">Pick a starting template — every field below stays editable.</div>
            </div>
            {/* Grading style toggle */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100">
              <button
                type="button"
                onClick={() => setGradingStyle("lenient")}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition ${
                  gradingStyle === "lenient"
                    ? "bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Lenient grading
              </button>
              <button
                type="button"
                onClick={() => setGradingStyle("strict")}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition ${
                  gradingStyle === "strict"
                    ? "bg-white text-rose-700 shadow-sm ring-1 ring-rose-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Strict grading
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CATEGORY_PRESETS.map(preset => {
              const active = category === preset.key;
              const accent = preset.key === "20_marks" ? "emerald" : "violet";
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => applyPreset(preset.key)}
                  className={`text-left rounded-xl border-2 p-4 transition ${
                    active
                      ? `border-${accent}-400 bg-${accent}-50/60 ring-2 ring-${accent}-100`
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                  style={
                    active
                      ? {
                          borderColor: accent === "emerald" ? "#34d399" : "#a78bfa",
                          background: accent === "emerald" ? "rgba(236, 253, 245, 0.6)" : "rgba(245, 243, 255, 0.6)",
                          boxShadow: `0 0 0 4px ${accent === "emerald" ? "rgba(167, 243, 208, 0.4)" : "rgba(196, 181, 253, 0.4)"}`,
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{
                        background: accent === "emerald" ? "#d1fae5" : "#ede9fe",
                        color: accent === "emerald" ? "#047857" : "#6d28d9",
                      }}
                    >
                      {preset.key === "20_marks" ? <Zap className="w-4 h-4" /> : <ScrollText className="w-4 h-4" />}
                    </div>
                    <div className="text-[14px] font-medium text-slate-900">{preset.label}</div>
                    {active && (
                      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{
                          background: accent === "emerald" ? "#10b981" : "#7c3aed",
                          color: "#fff",
                        }}>
                        Selected
                      </span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-slate-600 leading-[1.5]">{preset.sub}</div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <Pill tone="slate">{preset.totalMarks} marks</Pill>
                    <Pill tone="slate">{preset.durationHint}</Pill>
                    <Pill tone="slate">{preset.questionsHint}</Pill>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6 print-hide">
          {/* ── Upload zone ────────────────────────────────────────────── */}
          <div {...tilt3D} className="bg-white rounded-2xl p-5 sm:p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              className={[
                "relative rounded-2xl border-2 border-dashed transition-all cursor-pointer",
                "flex flex-col items-center justify-center text-center",
                "min-h-[240px] p-6",
                dragging
                  ? "border-[#1e3272] bg-[#1e3272]/5"
                  : file
                    ? "border-emerald-300 bg-emerald-50/40"
                    : "border-slate-300 bg-slate-50 hover:border-[#1e3272]/40 hover:bg-white",
              ].join(" ")}
            >
              <input
                ref={fileInputRef}
                type="file"
                // Accept both MIME and extension — macOS file picker
                // sometimes greys out PDFs when only the MIME is listed.
                // Adding ".pdf" makes the picker always enable PDF files.
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={onPickFile}
              />

              {extracting ? (
                <>
                  <Loader2 className="w-8 h-8 text-[#1e3272] animate-spin" />
                  <div className="mt-3 text-[14px] font-medium text-slate-700">Reading PDF pages…</div>
                </>
              ) : file ? (
                <>
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <FileText className="w-6 h-6 text-emerald-700" />
                  </div>
                  <div className="mt-3 text-[14px] font-medium text-slate-900 truncate max-w-full">{file.name}</div>
                  <div className="text-[12px] text-slate-500 mt-1">
                    {pageCount} page{pageCount !== 1 ? "s" : ""} · {(file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); reset(); }}
                    className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-900"
                  >
                    <X className="w-3.5 h-3.5" /> Remove
                  </button>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-xl bg-[#1e3272]/10 flex items-center justify-center">
                    <Upload className="w-6 h-6 text-[#1e3272]" />
                  </div>
                  <div className="mt-3 text-[14px] font-medium text-slate-900">
                    Drop scanned paper here, or click to browse
                  </div>
                  <div className="text-[12px] text-slate-500 mt-1">
                    PDF up to {MAX_FILE_MB} MB · max {MAX_PAGES} pages per submission
                  </div>
                </>
              )}
            </div>

            {/* Page thumbnails */}
            {pageImages.length > 0 && !loading && (
              <div className="mt-4">
                <div className="text-[11.5px] font-medium uppercase tracking-wider text-slate-400 mb-2">
                  Pages detected
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {pageImages.map((img, i) => (
                    <div
                      key={i}
                      className="shrink-0 w-20 h-28 rounded-lg overflow-hidden border border-slate-200 bg-white relative"
                    >
                      <img src={img} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent text-white text-[10px] py-0.5 text-center">
                        Page {i + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Metadata side panel ────────────────────────────────────── */}
          <div {...tilt3D} className="bg-white rounded-2xl p-5 sm:p-6 space-y-4" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
            <div>
              <div className="text-[11.5px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                Paper details (optional but recommended)
              </div>
              <p className="text-[12px] text-slate-500 leading-[1.45]">
                Adding subject, total marks, and your answer key helps the AI
                grade more accurately. Skip any field — AI will infer.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {sessionActive ? (
                <label className="block col-span-2">
                  <div className="text-[12px] font-medium text-slate-700 mb-1.5 flex items-center justify-between">
                    <span>Student (from {selectedClass?.name || "class"} roster)</span>
                    {pendingStudents.length > 0 && (
                      <span className="text-[11px] text-slate-500">{pendingStudents.length} pending</span>
                    )}
                  </div>
                  <select
                    value={sessionStudentId}
                    onChange={(e) => setSessionStudentId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px]"
                  >
                    <option value="">— Select student —</option>
                    {sessionStudents.map(s => (
                      <option key={s.id} value={s.id}>
                        {gradedStudentIds.has(s.id) ? "✓ " : ""}{s.name || s.email || s.id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Field label="Student name" value={studentName} onChange={setStudentName} placeholder="Aarav Kapoor" />
              )}
              <Field label="Subject" value={subject} onChange={setSubject} placeholder="Mathematics" />
              <Field label="Grade / class" value={grade} onChange={setGrade} placeholder="Class 8" />
              <Field label="Total marks" value={totalMarks} onChange={setTotalMarks} placeholder="40" type="number" />
            </div>

            <label className="block">
              <div className="text-[12px] font-medium text-slate-700 mb-1.5">
                Answer key / marking scheme (optional)
              </div>
              <textarea
                value={answerKey}
                onChange={(e) => setAnswerKey(e.target.value)}
                placeholder="Q1: 2x+5=15 → x=5 (2 marks)&#10;Q2: Photosynthesis is the process by which..."
                rows={5}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px] resize-none"
                maxLength={6000}
              />
            </label>

            {error && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[12.5px] px-3 py-2">
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={loading || extracting || !pageImages.length}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#1e3272] hover:bg-[#152244] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium text-[14px] py-3 rounded-xl transition"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Correcting paper… (1-3 min)
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Correct this paper
                </>
              )}
            </button>

            <p className="text-[11px] text-slate-400 text-center leading-[1.45]">
              AI vision reads every page. Larger papers take longer.
              Hand­writing must be reasonably legible for accurate grading.
            </p>
          </div>
        </div>

        {/* ── AI-call skeleton (P3-3) ───────────────────────────────────
         * Vision passes can take 1-3 minutes. A blank screen for that long
         * makes the page feel broken; the skeleton tells users what shape
         * is loading + reassures them work is in flight. */}
        {loading && !result && (
          <div className="mt-10 space-y-6 print-hide">
            <div className="h-[180px] rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 animate-pulse" />
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[68px] rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
            <div className="h-[300px] rounded-2xl bg-slate-100 animate-pulse" />
            <div className="text-center text-[12.5px] text-slate-500 italic">
              AI is reading every page · 1-3 min for typical papers…
            </div>
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────────── */}
        {result && (
          <div id="correction-results" className="mt-10 space-y-6 paper-results-section">
            <ResultsHeader
              result={result}
              studentName={studentName}
              onReset={reset}
              savedCorrectionId={savedCorrectionId}
              onPush={sessionActive ? handleQuickPush : () => setPushModalOpen(true)}
              pushLabel={sessionActive
                ? (pushing ? "Pushing…" : `Push to ${selectedTest?.testName || selectedTest?.title || "Gradebook"}`)
                : "Push to Gradebook"}
              pushDisabled={pushing || (sessionActive && !sessionStudentId)}
              sessionContext={sessionActive ? {
                className: selectedClass?.name || "",
                testName: selectedTest?.testName || selectedTest?.title || "",
                isGraded: gradedStudentIds.has(sessionStudentId),
                onNext: pendingStudents.length > 0 ? goToNextStudent : undefined,
              } : null}
              onPrint={() => window.print()}
              onSendToParent={handleSendToParent}
              sendingToParent={sendingToParent}
              sentToParent={sentToParent}
              canSendToParent={!!(selectedStudent?.id || sessionStudentId || selectedStudent?.email)}
            />
            {/* P2-1: drift between AI's claimed marksScored and the sum of
             * its own per-question marks_awarded. Surfacing this is what
             * stops a teacher from publishing a hallucinated total. */}
            {drift && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 print-hide">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[13px] font-medium text-amber-900">AI marks don't fully add up</div>
                    <div className="text-[12.5px] text-amber-800 mt-0.5 leading-[1.5]">
                      Total claimed: <b>{drift.claimed}</b>. Sum of per-question marks: <b>{drift.sum.toFixed(1)}</b> out of {drift.total}.
                      Review the per-question breakdown before pushing to the gradebook.
                    </div>
                  </div>
                </div>
              </div>
            )}
            <OverallSummary result={result} />

            {/* Teacher's quick observations — handwriting / presentation / effort */}
            {(result.handwriting_note || result.presentation_note || result.effort_note) && (
              <ObservationsCard
                handwriting={result.handwriting_note}
                presentation={result.presentation_note}
                effort={result.effort_note}
              />
            )}

            <QuestionBreakdown questions={result.questions} />

            {result.concept_understanding && result.concept_understanding.length > 0 && (
              <ConceptUnderstandingCard items={result.concept_understanding} />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StrengthsCard items={result.strengths} />
              <WeaknessesCard items={result.weaknesses} />
            </div>

            <ImprovementPlan items={result.improvement_plan} />

            {/* Personal letter from teacher to student */}
            {result.student_letter && (
              <StudentLetterCard text={result.student_letter} studentName={studentName} />
            )}

            <Encouragement text={result.encouragement} />

            {/* Parent-facing note */}
            {result.parent_note && (
              <ParentNoteCard text={result.parent_note} studentName={studentName} />
            )}
          </div>
        )}

        {/* Push to Gradebook modal — opens on demand from ResultsHeader */}
        {result && (
          <PushToGradebookModal
            open={pushModalOpen}
            onClose={() => setPushModalOpen(false)}
            onSaved={() => setPushModalOpen(false)}
            correction={{
              marksScored: result.marksScored ?? 0,
              totalMarks: result.totalMarks ?? (Number(totalMarks) || 0),
              percentage: typeof result.percentage === "number" ? result.percentage : 0,
              gradeBand: result.grade_band || "C",
              subject: subject.trim() || result.subject || "",
              studentName: studentName.trim() || "",
              correctionId: savedCorrectionId,
            }}
          />
        )}
      </div>

      {/* P1-3: Print stylesheet — strips UI chrome, keeps only the
       * results section so a teacher can print or save-as-PDF a clean
       * correction report for parents / student files.
       *   - .print-hide marks anything that should NOT appear in print
       *     (session panel, presets, upload zone, side metadata, action
       *     buttons, modal, drift banner, skeleton, etc.).
       *   - .paper-results-section is the only block kept; everything
       *     else inside the page wrapper is hidden via :not selector. */}
      <style>{`
        @media print {
          html, body { background: #fff !important; }
          aside, nav, header, .no-print, .print-hide { display: none !important; }
          /* Hero gradient is ink-heavy on cheap printers — flatten to B&W. */
          .paper-results-section [class*="bg-gradient-to-br"] {
            background: #fff !important;
            color: #000 !important;
          }
          .paper-results-section [class*="bg-gradient-to-br"] * {
            color: #000 !important;
          }
          /* Each result card avoids being split mid-flow. */
          .paper-results-section > div { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
};

// ── Sub-components ──────────────────────────────────────────────────────────

// ── Session Panel — class-centric grading session UI ──────────────────────
// Idle state: empty card with CTA "Start grading session" → opens setup modal
// Active state: compact strip showing class · test · progress + Change/End buttons
const SessionPanel: React.FC<{
  active: boolean;
  classes: ClassRow[];
  tests: TestRow[];
  students: StudentRow[];
  gradedIds: Set<string>;
  classId: string;
  testId: string;
  studentId: string;
  selectedClass: ClassRow | undefined;
  selectedTest: TestRow | undefined;
  onClassChange: (id: string) => void;
  onTestChange: (id: string) => void;
  onStudentChange: (id: string) => void;
  onClose: () => void;
  onOpenSetup: () => void;
  setupOpen: boolean;
  onCloseSetup: () => void;
}> = ({
  active, classes, tests, students, gradedIds, classId, testId, studentId,
  selectedClass, selectedTest, onClassChange, onTestChange, onStudentChange,
  onClose, onOpenSetup, setupOpen, onCloseSetup,
}) => {
  const gradedCount = gradedIds.size;
  const totalCount = students.length;

  return (
    <>
      {!active ? (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 sm:p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
            <div className="flex items-start gap-3 min-w-0 md:flex-1">
              <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0">
                <ListChecks className="w-5 h-5 text-blue-700" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700 mb-1">
                  Class-wise grading session
                </div>
                <div className="text-[15px] font-bold text-slate-900 leading-snug">
                  Grade a whole class for one test in one sitting
                </div>
                <p className="text-[12.5px] text-slate-600 mt-1.5 leading-[1.55] max-w-prose">
                  Pick a class &amp; test once, then upload each student's paper. AI corrects, one click pushes marks straight to the gradebook. No re-typing.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenSetup}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#1e3272] hover:bg-[#152244] text-white text-[13px] font-bold shadow-sm shrink-0 w-full md:w-auto md:self-center"
            >
              <Settings2 className="w-4 h-4" /> Start grading session
            </button>
          </div>
        </div>
      ) : (
        <div {...tilt3D} className="bg-white rounded-2xl p-5 sm:p-6 mb-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <ListChecks className="w-5 h-5 text-blue-700" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider text-blue-700">
                  Active grading session
                </div>
                <div className="text-[15px] font-medium text-slate-900 mt-0.5">
                  {selectedClass?.name || "Class"} · {selectedTest?.testName || selectedTest?.title || "Test"}
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5">
                  {gradedCount} of {totalCount} student{totalCount !== 1 ? "s" : ""} graded
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenSetup}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[12.5px] font-medium text-slate-700"
              >
                <Settings2 className="w-3.5 h-3.5" /> Change
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[12.5px] font-medium text-slate-700"
              >
                <X className="w-3.5 h-3.5" /> End
              </button>
            </div>
          </div>
          {/* Progress bar */}
          {totalCount > 0 && (
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-3">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.round((gradedCount / totalCount) * 100)}%` }}
              />
            </div>
          )}
          {/* Student chips — first 12 with status icon */}
          {students.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {students.slice(0, 12).map(s => {
                const graded = gradedIds.has(s.id);
                const isCurrent = s.id === studentId;
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => onStudentChange(s.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium ring-1 transition ${
                      isCurrent
                        ? "bg-blue-600 text-white ring-blue-700"
                        : graded
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
                          : "bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {graded && <CheckCircle2 className="w-3 h-3" />}
                    {s.name || s.id}
                  </button>
                );
              })}
              {students.length > 12 && (
                <span className="px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                  +{students.length - 12} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Setup modal ──────────────────────────────────────────────── */}
      {setupOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Set up grading session"
          className="fixed inset-0 z-[80] flex items-center justify-center px-4"
          style={{ background: "rgba(0,8,40,0.42)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) onCloseSetup(); }}
        >
          <div
            className="w-full max-w-[440px] rounded-2xl overflow-hidden bg-white"
            style={{ boxShadow: "0 0 0 0.5px rgba(0,8,40,0.12), 0 8px 28px rgba(0,8,40,0.25), 0 30px 70px rgba(0,8,40,0.32)" }}
          >
            <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 border-b border-slate-100">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  Grading session
                </div>
                <h2 className="text-[20px] font-medium text-slate-900 mt-[3px]">Set class &amp; test</h2>
                <div className="text-[12px] text-slate-500 mt-[4px]">
                  Pick once — every paper you correct in this session pushes straight to this test.
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onCloseSetup}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-50 text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <label className="block">
                <div className="text-[12px] font-medium text-slate-700 mb-1.5">Class</div>
                {classes.length === 0 ? (
                  <div className="px-3 py-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-[12px] text-amber-800">
                    No classes assigned to you. Ask the principal to assign you a class.
                  </div>
                ) : (
                  <select
                    value={classId}
                    onChange={(e) => onClassChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px]"
                  >
                    <option value="">— Select class —</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
                  </select>
                )}
              </label>
              <label className="block">
                <div className="text-[12px] font-medium text-slate-700 mb-1.5">Test</div>
                {!classId ? (
                  <div className="px-3 py-2 rounded-xl bg-slate-50 text-[12px] text-slate-500">
                    Pick a class first.
                  </div>
                ) : tests.length === 0 ? (
                  <div className="px-3 py-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-[12px] text-amber-800">
                    No tests for this class yet. Create a test in Tests &amp; Exams first.
                  </div>
                ) : (
                  <select
                    value={testId}
                    onChange={(e) => onTestChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px]"
                  >
                    <option value="">— Select test —</option>
                    {tests.map(t => (
                      <option key={t.id} value={t.id}>
                        {(t.testName || t.title || "Untitled")} {t.testDate ? `· ${t.testDate}` : ""} {t.marks ? `· ${t.marks}m` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <button
                type="button"
                onClick={onCloseSetup}
                disabled={!classId || !testId}
                className="w-full h-11 mt-2 rounded-xl bg-[#1e3272] hover:bg-[#152244] disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-[13px] font-medium"
              >
                Start session
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const Field = ({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) => (
  <label className="block">
    <div className="text-[12px] font-medium text-slate-700 mb-1.5">{label}</div>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px]"
    />
  </label>
);

const ResultsHeader = ({
  result, studentName, onReset, savedCorrectionId, onPush, pushLabel = "Push to Gradebook",
  pushDisabled = false, sessionContext = null, onPrint,
  onSendToParent, sendingToParent = false, sentToParent = false, canSendToParent = false,
}: {
  result: CorrectionResult;
  studentName: string;
  onReset: () => void;
  savedCorrectionId: string | null;
  onPush: () => void;
  pushLabel?: string;
  pushDisabled?: boolean;
  sessionContext?: { className: string; testName: string; isGraded: boolean; onNext?: () => void } | null;
  onPrint?: () => void;
  onSendToParent?: () => void;
  sendingToParent?: boolean;
  sentToParent?: boolean;
  canSendToParent?: boolean;
}) => {
  const band = GRADE_BAND_STYLES[result.grade_band] ?? GRADE_BAND_STYLES.C;
  // P0-4 defensive: percentage may have been re-computed in submit() but
  // double-guard here for any code path that bypassed normalisation.
  const pctDisplay = (typeof result.percentage === "number" && Number.isFinite(result.percentage))
    ? result.percentage.toFixed(1)
    : "—";
  // P1-7: avoid double-space in "Aarav's  paper" when subject empty.
  const subjectLabel = (result.subject || "").trim();
  return (
    <div className="bg-gradient-to-br from-[#1e3272] to-[#0f1d4a] text-white rounded-2xl p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex flex-wrap items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-medium uppercase tracking-wider">
              <GraduationCap className="w-3 h-3" /> Correction complete
            </span>
            {savedCorrectionId && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-400/20 text-emerald-100 text-[11px] font-medium uppercase tracking-wider ring-1 ring-emerald-300/30">
                <Save className="w-3 h-3" /> Saved
              </span>
            )}
            {sessionContext && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-400/20 text-blue-100 text-[11px] font-medium uppercase tracking-wider ring-1 ring-blue-300/30">
                Session · {sessionContext.className} · {sessionContext.testName}
              </span>
            )}
            {sessionContext?.isGraded && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/20 text-amber-100 text-[11px] font-medium uppercase tracking-wider ring-1 ring-amber-300/30">
                Already graded — push will overwrite
              </span>
            )}
          </div>
          <div className="text-[24px] sm:text-[28px] font-normal tracking-[-0.02em] leading-tight">
            {studentName || "Student"}'s {subjectLabel ? `${subjectLabel} ` : ""}paper
          </div>
          {result.grade && (
            <div className="text-[13px] text-white/70 mt-1">{result.grade}</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onPush}
            disabled={pushDisabled}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-400 disabled:cursor-not-allowed text-[12.5px] font-medium transition shadow-sm"
          >
            <BookmarkPlus className="w-3.5 h-3.5" /> {pushLabel}
          </button>
          {/* Send to Parent — surfaces on the parent dashboard's Reports
              page under a "Papers" section. Enabled only when (a) the
              correction has been saved (we need its id), (b) we have a
              student identity to address. Idempotent: once sent, the button
              flips to a green "Sent" pill (still clickable for re-publish
              with fresh timestamp). */}
          {onSendToParent && (
            <button
              onClick={onSendToParent}
              disabled={sendingToParent || !savedCorrectionId || !canSendToParent}
              title={!canSendToParent
                ? "Pick a student first (use 'Start Grading' to select class + student)"
                : sentToParent
                  ? "Re-send to parent"
                  : "Send this corrected paper to the parent dashboard"}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12.5px] font-medium transition shadow-sm disabled:cursor-not-allowed ${
                sentToParent
                  ? "bg-emerald-400/25 text-emerald-100 ring-1 ring-emerald-300/40 hover:bg-emerald-400/35"
                  : "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-slate-400"
              }`}
            >
              {sendingToParent ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
              ) : sentToParent ? (
                <><CheckCircle2 className="w-3.5 h-3.5" /> Sent to parent</>
              ) : (
                <><Send className="w-3.5 h-3.5" /> Send to parent</>
              )}
            </button>
          )}
          {sessionContext?.onNext && (
            <button
              onClick={sessionContext.onNext}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[12.5px] font-medium transition min-h-[44px] sm:min-h-0"
            >
              Next student <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          {onPrint && (
            <button
              onClick={onPrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[12.5px] font-medium transition min-h-[44px] sm:min-h-0 print-hide"
              aria-label="Print or save as PDF"
            >
              <Printer className="w-3.5 h-3.5" /> Print / PDF
            </button>
          )}
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[12.5px] font-medium transition min-h-[44px] sm:min-h-0"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Correct another
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-6 sm:gap-10">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/60">Marks scored</div>
          <div className="text-[42px] sm:text-[52px] font-light tracking-tight leading-none mt-1">
            {result.marksScored ?? 0}
            <span className="text-[24px] sm:text-[28px] text-white/50 ml-1">/ {result.totalMarks ?? 0}</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/60">Percentage</div>
          <div className="text-[42px] sm:text-[52px] font-light tracking-tight leading-none mt-1">
            {pctDisplay}%
          </div>
        </div>
        <div className="ml-auto">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Grade</div>
          <div className={`inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-2xl text-[36px] sm:text-[40px] font-medium ring-4 ring-white/10 ${band.bg} ${band.text}`}>
            {result.grade_band}
          </div>
        </div>
      </div>
    </div>
  );
};

const OverallSummary = ({ result }: { result: CorrectionResult }) => {
  const counts = useMemo(() => {
    const c = { correct: 0, partial: 0, wrong: 0, blank: 0, unreadable: 0 };
    for (const q of result.questions) c[q.verdict] = (c[q.verdict] ?? 0) + 1;
    return c;
  }, [result.questions]);

  return (
    <div {...tilt3D} className="bg-white rounded-2xl p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#1e3272]/10 flex items-center justify-center shrink-0">
          <Award className="w-4 h-4 text-[#1e3272]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-slate-900 mb-1">Teacher's overall note</div>
          <p className="text-[14px] text-slate-700 leading-[1.55]">{result.overall_summary}</p>
        </div>
      </div>

      <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Correct" value={counts.correct} tone="emerald" />
        <Stat label="Partial" value={counts.partial} tone="amber" />
        <Stat label="Wrong" value={counts.wrong} tone="rose" />
        <Stat label="Blank" value={counts.blank} tone="slate" />
        <Stat label="Unreadable" value={counts.unreadable} tone="violet" />
      </div>
    </div>
  );
};

const TONE_STYLES: Record<string, { bg: string; text: string }> = {
  emerald: { bg: "bg-emerald-50", text: "text-emerald-700" },
  amber:   { bg: "bg-amber-50",   text: "text-amber-700" },
  rose:    { bg: "bg-rose-50",    text: "text-rose-700" },
  slate:   { bg: "bg-slate-100",  text: "text-slate-600" },
  violet:  { bg: "bg-violet-50",  text: "text-violet-700" },
};

const Pill = ({ tone, children }: { tone: keyof typeof TONE_STYLES; children: React.ReactNode }) => {
  const t = TONE_STYLES[tone] ?? TONE_STYLES.slate;
  return (
    <span className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full ${t.bg} ${t.text}`}>
      {children}
    </span>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: number; tone: string }) => {
  const t = TONE_STYLES[tone] ?? TONE_STYLES.slate;
  return (
    <div className={`${t.bg} rounded-xl px-3 py-2.5 text-center`}>
      <div className={`text-[24px] font-light leading-none ${t.text}`}>{value}</div>
      <div className="text-[11px] text-slate-600 mt-1">{label}</div>
    </div>
  );
};

const QuestionBreakdown = ({ questions }: { questions: QuestionResult[] }) => (
  <div {...tilt3D} className="bg-white rounded-2xl p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
    <div className="flex items-center gap-2 mb-4">
      <BookOpen className="w-4 h-4 text-[#1e3272]" />
      <div className="text-[15px] font-medium text-slate-900">Question-by-question breakdown</div>
    </div>
    {/* P0-5: empty-state when AI returned no questions (e.g. unreadable scan or
     * paper had no recognisable Q-numbers). */}
    {questions.length === 0 ? (
      <div className="text-[13px] text-slate-500 bg-slate-50 rounded-xl px-4 py-6 text-center">
        AI could not identify individual questions in the scan. The overall summary above is still valid; consider re-scanning at a higher resolution or providing an answer key for the next attempt.
      </div>
    ) : (
    <div className="space-y-3">
      {questions.map((q, i) => {
        const v = VERDICT_STYLES[q.verdict] ?? VERDICT_STYLES.partial;
        const mistakeKey: MistakeType = q.mistake_type ?? "none";
        const showMistake = mistakeKey !== "none" && mistakeKey !== "no_attempt" && mistakeKey !== "unreadable";
        return (
          <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div className="text-[13px] font-medium text-slate-900 shrink-0">Q{q.number}</div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${v.bg} ${v.ring} ${v.text}`}>
                {v.icon} {v.label}
              </span>
              {showMistake && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${MISTAKE_TONE[mistakeKey]}`}>
                  {MISTAKE_LABELS[mistakeKey]}
                </span>
              )}
              <div className="ml-auto text-[13px] font-medium text-slate-900 shrink-0">
                {q.marks_awarded} / {q.max_marks}
                <span className="text-[11px] text-slate-500 ml-1">marks</span>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-[13px] text-slate-700 italic">"{q.question_text}"</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Student wrote</div>
                  <div className="text-[12.5px] text-slate-700 bg-slate-50 rounded-lg px-3 py-2 leading-[1.5]">{q.student_answer_summary}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Expected answer</div>
                  <div className="text-[12.5px] text-slate-700 bg-emerald-50 rounded-lg px-3 py-2 leading-[1.5]">{q.correct_answer}</div>
                </div>
              </div>
              {q.step_marks_breakdown && (
                <div className="text-[11.5px] text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
                  <span className="font-medium uppercase tracking-wider text-[10px] text-slate-400">Step marks:</span>
                  <span>{q.step_marks_breakdown}</span>
                </div>
              )}
              <div className="flex items-start gap-2 bg-[#1e3272]/5 rounded-lg px-3 py-2.5">
                <div className="w-5 h-5 rounded-full bg-[#1e3272] text-white flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold">T</span>
                </div>
                <div className="text-[13px] text-slate-800 leading-[1.5]">{q.comment}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
    )}
  </div>
);

const ObservationsCard = ({
  handwriting, presentation, effort,
}: {
  handwriting?: string;
  presentation?: string;
  effort?: string;
}) => (
  <div {...tilt3D} className="bg-white rounded-2xl p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
    <div className="flex items-center gap-2 mb-4">
      <Eye className="w-4 h-4 text-[#1e3272]" />
      <div className="text-[15px] font-medium text-slate-900">Teacher's observations</div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {handwriting && (
        <ObsTile icon={<PenLine className="w-4 h-4 text-blue-700" />} bg="bg-blue-100" title="Handwriting" body={handwriting} />
      )}
      {presentation && (
        <ObsTile icon={<BookOpen className="w-4 h-4 text-violet-700" />} bg="bg-violet-100" title="Presentation" body={presentation} />
      )}
      {effort && (
        <ObsTile icon={<TrendingUp className="w-4 h-4 text-emerald-700" />} bg="bg-emerald-100" title="Effort" body={effort} />
      )}
    </div>
  </div>
);

const ObsTile = ({
  icon, bg, title, body,
}: { icon: React.ReactNode; bg: string; title: string; body: string }) => (
  <div className="border border-slate-200 rounded-xl p-4">
    <div className="flex items-center gap-2 mb-1.5">
      <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>{icon}</div>
      <div className="text-[12.5px] font-medium text-slate-900">{title}</div>
    </div>
    <p className="text-[13px] text-slate-700 leading-[1.5]">{body}</p>
  </div>
);

const ConceptUnderstandingCard = ({ items }: { items: ConceptUnderstanding[] }) => (
  <div {...tilt3D} className="bg-white rounded-2xl p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
    <div className="flex items-center gap-2 mb-4">
      <Brain className="w-4 h-4 text-[#1e3272]" />
      <div>
        <div className="text-[15px] font-medium text-slate-900">Concept understanding</div>
        <div className="text-[12px] text-slate-500">Topic-wise grasp based on this paper</div>
      </div>
    </div>
    <div className="space-y-2.5">
      {items.map((c, i) => {
        const s = CONCEPT_LEVEL_STYLES[c.level] ?? CONCEPT_LEVEL_STYLES.developing;
        return (
          <div key={i} className="flex items-start gap-3 border border-slate-200 rounded-xl p-3.5">
            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${s.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[13.5px] font-medium text-slate-900">{c.concept}</div>
                <span className={`text-[10.5px] font-medium uppercase tracking-wider ${s.text}`}>{s.label}</span>
              </div>
              <div className="text-[12.5px] text-slate-600 mt-1 leading-[1.5]">{c.evidence}</div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const StudentLetterCard = ({ text, studentName }: { text: string; studentName: string }) => (
  <div className="bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><path d=%22M0 39 L40 39%22 stroke=%22%23fef3c7%22 stroke-width=%221%22/></svg>')] bg-amber-50/40 border border-amber-200 rounded-2xl p-6 sm:p-8 relative overflow-hidden">
    <div className="absolute top-4 right-4 opacity-20">
      <MessageCircle className="w-12 h-12 text-amber-700" />
    </div>
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-amber-200 flex items-center justify-center">
        <PenLine className="w-4 h-4 text-amber-800" />
      </div>
      <div>
        <div className="text-[15px] font-medium text-slate-900">A note from your teacher</div>
        <div className="text-[12px] text-slate-600">Personal · written for {studentName || "you"}</div>
      </div>
    </div>
    <div className="text-[14.5px] text-slate-800 leading-[1.65] whitespace-pre-line italic relative z-10">
      {text}
    </div>
  </div>
);

// Resilient text-to-clipboard helper. Tries the async Clipboard API first
// (works on https + secure contexts), falls back to a hidden textarea +
// document.execCommand("copy") for HTTP / Android in-app browsers (e.g.
// WhatsApp link → in-app WebView) where the async API is locked down.
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

const ParentNoteCard = ({ text, studentName }: { text: string; studentName: string }) => {
  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) toast.success("Parent note copied to clipboard.");
    else toast.error("Copy failed — your browser blocked clipboard access.");
  };
  return (
    <div {...tilt3D} className="bg-white rounded-2xl p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
          <Users className="w-5 h-5 text-blue-700" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <div className="text-[13.5px] font-medium text-slate-900">Note for parent</div>
            <span className="text-[10.5px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
              Share-ready
            </span>
            {studentName && (
              <span className="text-[10.5px] text-slate-500">· for {studentName}</span>
            )}
          </div>
          <p className="text-[13.5px] text-slate-700 leading-[1.55]">{text}</p>
          {/* P1-6: always show copy button — gating on studentName was a bug;
           * the note is share-ready regardless of whether a name was entered. */}
          <button
            onClick={handleCopy}
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-blue-700 hover:underline min-h-[44px] sm:min-h-0"
          >
            <Mail className="w-3.5 h-3.5" />
            Copy parent note
          </button>
        </div>
      </div>
    </div>
  );
};

const StrengthsCard = ({ items }: { items: string[] }) => (
  <div {...tilt3D} className="bg-white rounded-2xl p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
        <TrendingUp className="w-4 h-4 text-emerald-700" />
      </div>
      <div>
        <div className="text-[15px] font-medium text-slate-900">Strengths</div>
        <div className="text-[12px] text-slate-500">What the student did well</div>
      </div>
    </div>
    <ul className="space-y-2.5">
      {items.map((s, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-slate-700 leading-[1.5]">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  </div>
);

const WeaknessesCard = ({ items }: { items: string[] }) => (
  <div {...tilt3D} className="bg-white rounded-2xl p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
        <TrendingDown className="w-4 h-4 text-amber-700" />
      </div>
      <div>
        <div className="text-[15px] font-medium text-slate-900">Weak areas</div>
        <div className="text-[12px] text-slate-500">Where more practice is needed</div>
      </div>
    </div>
    <ul className="space-y-2.5">
      {items.map((w, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-slate-700 leading-[1.5]">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  </div>
);

const ImprovementPlan = ({ items }: { items: ImprovementItem[] }) => (
  <div {...tilt3D} className="bg-white rounded-2xl p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
        <Target className="w-4 h-4 text-blue-700" />
      </div>
      <div>
        <div className="text-[15px] font-medium text-slate-900">Improvement plan</div>
        <div className="text-[12px] text-slate-500">Specific next steps for this week</div>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((it, i) => (
        <div key={i} className="border border-slate-200 rounded-xl p-4 hover:border-[#1e3272]/30 transition">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="text-[13.5px] font-medium text-slate-900 truncate">{it.area}</div>
            </div>
            <span className={`text-[10.5px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ring-inset ${PRIORITY_STYLES[it.priority]}`}>
              {it.priority}
            </span>
          </div>
          <div className="text-[13px] text-slate-700 leading-[1.5]">{it.action}</div>
        </div>
      ))}
    </div>
  </div>
);

const Encouragement = ({ text }: { text: string }) => (
  <div className="bg-gradient-to-br from-rose-50 to-amber-50 border border-rose-100 rounded-2xl p-6">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-sm">
        <Heart className="w-5 h-5 text-rose-500" />
      </div>
      <div>
        <div className="text-[12px] font-medium uppercase tracking-wider text-rose-700 mb-1">A note from teacher</div>
        <p className="text-[14.5px] text-slate-800 leading-[1.55] italic">"{text}"</p>
      </div>
    </div>
  </div>
);

export default PaperCorrection;
