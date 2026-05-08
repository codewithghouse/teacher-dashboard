import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import {
  collection, query, onSnapshot, where,
  doc, writeBatch, getDocs,
  type QueryConstraint,
} from "firebase/firestore";
import { auditedSet, auditedDelete } from "../lib/auditedWrites";
import { useAuth } from "../lib/AuthContext";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import EnterScores from "../components/EnterScores";
import GradeAssignment from "../components/GradeAssignment";
// xlsx loaded dynamically to reduce bundle size (~500KB)
const loadXLSX = () => import("xlsx");

// ── Cross-source row types — Tests + Assignments unified into one section ────
// Rendered as one list under "Tests, Exams & Assignments" so a teacher can
// jump straight from Gradebook into EnterScores (for tests) or GradeAssignment
// (for assignments) without leaving the page. Both components are imported
// and mounted inline as full-screen overlays via the `view` discriminator.
interface TestDoc {
  id: string;
  testName?: string;
  title?: string;
  subject?: string;
  topic?: string;
  topics?: string[];
  testDate?: string;
  marks?: string | number;
  category?: string;
  classId?: string;
  className?: string;
  status?: string;
  [key: string]: unknown;
}
interface AssignmentDoc {
  id: string;
  title?: string;
  description?: string;
  subject?: string;
  type?: string;
  dueDate?: string;
  maxMarks?: number | string;
  classId?: string;
  className?: string;
  [key: string]: unknown;
}

// "Test" vs "Exam" tag derived from category — exams are mid-term / final / term.
const isExamCategory = (cat: string | undefined): boolean => {
  const c = (cat || "").toLowerCase();
  return c.includes("exam") || c.includes("mid-term") || c.includes("midterm") || c.includes("final") || c.includes("term");
};

// ── Types ─────────────────────────────────────────────────────────────────────
// Carries enough to rehydrate subject/className on writes — without this,
// every score doc lands with empty `subject`/`topic` and the 22 cross-dashboard
// readers fall back to "General topics" or skip the doc entirely (memory:
// `bug_pattern_fallback_bucket_alone`).
interface ClassData {
  id: string;
  name: string;
  classId: string;
  subject?: string;
  className?: string;
}
interface CustomColumn { id: string; name: string; maxMarks: number; createdAt?: number; }

// P2-3: explicit student row type — was `students: any[]`. Tightening this
// catches typos in field access at compile time + documents the row shape
// that EnterScores / GradeAssignment overlays both consume.
interface StudentRow {
  id: string;
  realId: string;
  email: string;
  name: string;
  rollNo: string;
  initials: string;
}

// `${(stu.email || stu.id).toLowerCase()}_${col.id}` keyed map — values are
// numbers from Firestore reads, strings from in-progress input edits.
type ScoresMap = Record<string, number | string | null | undefined>;

// ── Score input guard (P0-5) ──────────────────────────────────────────────────
// Rejects input that would exceed `max` or fall below 0. Returns the same
// string when valid, the previous value when not. Surfaces a toast so the
// user knows why their keystroke was dropped.
const validScoreInput = (raw: string, max: number): { ok: boolean; reason?: string } => {
  if (raw === "") return { ok: true };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, reason: "Numbers only." };
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return { ok: false, reason: "Invalid number." };
  if (n < 0) return { ok: false, reason: "Score cannot be negative." };
  if (max > 0 && n > max) return { ok: false, reason: `Score cannot exceed ${max}.` };
  return { ok: true };
};

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF',
  green2: '#2F9E44', greenL: '#EBFBEE',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  purple: '#6741D9', purpleL: '#F3F0FF',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── Avatar color palette ───────────────────────────────────────────────────────
const AV_PALETTES = [
  { bg: '#E8F4FD', color: '#1971C2' },
  { bg: '#EBFBEE', color: '#2F9E44' },
  { bg: '#FFF9DB', color: '#C87014' },
  { bg: '#FFE8CC', color: '#D9480F' },
  { bg: '#F3F0FF', color: '#6741D9' },
  { bg: '#FFF0F6', color: '#C2255C' },
  { bg: '#E6FCF5', color: '#0C8599' },
];
const avStyle = (name: string) => {
  const sum = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AV_PALETTES[sum % AV_PALETTES.length];
};
const getInitials = (name: string) => {
  const p = (name || '').trim().split(' ');
  return (p.length >= 2 ? p[0][0] + p[1][0] : (p[0]?.[0] || '?')).toUpperCase();
};

// ── Grade helpers (P0-4 canonical 6-band scale) ───────────────────────────────
// Single source of truth — replaces the three diverging scales (`simpleGrade`,
// `getGrade`, `letterGrade`) that were giving the same student different
// letters in different cards on the same page. Bands match the export format
// + most Indian school boards.
type GradeTone = 'a+' | 'a' | 'b' | 'c' | 'd' | 'f';
interface GradeInfo { label: string; color: string; bg: string; tone: GradeTone }

const getGradeInfo = (pct: number): GradeInfo => {
  if (pct >= 90) return { label: 'A+', color: '#00C853', bg: T.greenL, tone: 'a+' };
  if (pct >= 80) return { label: 'A',  color: '#00C853', bg: T.greenL, tone: 'a'  };
  if (pct >= 70) return { label: 'B',  color: '#0055FF', bg: T.blueL,  tone: 'b'  };
  if (pct >= 60) return { label: 'C',  color: '#FFAA00', bg: T.amberL, tone: 'c'  };
  if (pct >= 50) return { label: 'D',  color: '#FF8800', bg: T.amberL, tone: 'd'  };
  return { label: 'F', color: '#FF3355', bg: T.redL, tone: 'f' };
};
// Aliases for existing call sites — same shape, just back-compat.
const simpleGrade = (pct: number): GradeInfo => getGradeInfo(pct);
const getGrade = (pct: number): string => getGradeInfo(pct).label;

// ── Inline SVG icons ──────────────────────────────────────────────────────────
const IcoCheck = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,6.5 4.5,10 10.5,2.5"/>
  </svg>
);
const IcoChevron = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="10,3 5,8 10,13"/>
  </svg>
);
const IcoPlus = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="5.5" y1="2" x2="5.5" y2="9"/><line x1="2" y1="5.5" x2="9" y2="5.5"/>
  </svg>
);
const IcoDownload = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 2v7M4 7l3 3 3-3M2 12h10"/>
  </svg>
);
const IcoSearch = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="6" cy="6" r="4"/><line x1="9" y1="9" x2="12.5" y2="12.5"/>
  </svg>
);


// ─────────────────────────────────────────────────────────────────────────────
export default function Gradebook() {
  const { teacherData } = useAuth();
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [scores, setScores] = useState<ScoresMap>({});
  const [localScores, setLocalScores] = useState<ScoresMap>({});

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColMax, setNewColMax] = useState("100");

  // View state — extended to host EnterScores + GradeAssignment as full-screen
  // overlays so the teacher can jump from Gradebook into either flow without
  // navigating to a different page.
  const [view, setView] = useState<'main' | 'enter-scores' | 'enter-test' | 'grade-assignment'>('main');
  const [selectedColForEdit, setSelectedColForEdit] = useState<CustomColumn | null>(null);
  const [activeTest, setActiveTest] = useState<TestDoc | null>(null);
  const [activeAssignment, setActiveAssignment] = useState<AssignmentDoc | null>(null);

  // Aggregated activities for the selected class — populated by the listeners
  // below. Kept out of the main scores listener so changing class doesn't tear
  // down the score grid mid-render.
  const [classTests, setClassTests] = useState<TestDoc[]>([]);
  const [classAssignments, setClassAssignments] = useState<AssignmentDoc[]>([]);
  const [testScoreCounts, setTestScoreCounts] = useState<Map<string, number>>(new Map());
  const [assignmentGradeCounts, setAssignmentGradeCounts] = useState<Map<string, number>>(new Map());

  // P2-1: surface listener failures to the user with a retry banner instead
  // of silently console.warn'ing. Bumping `refreshKey` forces every listener
  // useEffect to re-subscribe (memory pattern from Dashboard.tsx).
  const [listenerError, setListenerError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const onListenerErr = (label: string) => (err: { code?: string; message?: string }) => {
    console.warn(`[Gradebook/${label}]`, err.code || err.message);
    setListenerError(`Could not load ${label}. ${err.code === "permission-denied" ? "Permission issue — check access." : "Connection or data issue."}`);
  };

  // ── Effects ────────────────────────────────────────────────────────────────

  // 1. Fetch Classes (scoped by school — no full collection scan)
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));

    let unsub: (() => void) | null = null;
    let cancelled = false;

    const init = async () => {
      const classSnap = await getDocs(query(collection(db, "classes"), ...SC));
      if (cancelled) return;
      const classMap = new Map<string, any>();
      classSnap.docs.forEach(d => classMap.set(d.id, d.data()));
      const legacyOptions: ClassData[] = classSnap.docs
        .filter(d => d.data().teacherId === teacherData.id)
        .map(d => ({
          id: d.id,
          classId: d.id,
          name: d.data().name,
          // P0-2: snapshot subject + className for use in score writes —
          // without these, the 22 cross-dashboard readers fall back to
          // "General topics" (memory: bug_pattern_fallback_bucket_alone).
          subject: d.data().subject || "",
          className: d.data().name || "",
        }));

      const q = query(collection(db, "teaching_assignments"), where("teacherId", "==", teacherData.id), ...SC);
      unsub = onSnapshot(q, (snap) => {
        const assignments = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(a => !a.status || a.status.toLowerCase() === "active");

        let options: ClassData[] = assignments.map(a => ({
          id: a.id,
          classId: a.classId,
          name: `${classMap.get(a.classId)?.name || "Class"} — ${a.subjectName || a.subject || "Subject"}`,
          // P0-2: assignment-derived subject + class name. Subject from the
          // teaching_assignment doc (source of truth for what this teacher
          // is grading) + className from the underlying classes/{classId}.
          subject: a.subjectName || a.subject || "",
          className: classMap.get(a.classId)?.name || "",
        }));

        if (options.length === 0) options = legacyOptions;

        setClasses(options);
        if (options.length > 0 && !selectedClassId) setSelectedClassId(options[0].id);
        else if (options.length === 0) setLoading(false);
      });
    };

    init();
    return () => { cancelled = true; unsub?.(); };
  }, [teacherData?.id]);

  // 2. Fetch Roster & Scores
  useEffect(() => {
    if (!teacherData?.id || !selectedClassId) return;
    setLoading(true);

    const selAssignment = classes.find(c => c.id === selectedClassId);
    const targetClassId = selAssignment?.classId || selectedClassId;

    if (!teacherData.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;

    // P0-1: split constraints by collection type per memory
    // `bug_pattern_branch_filter_on_event_streams`. Resolution entities
    // (enrollments, gradebook_columns) get the branchId filter; event-stream
    // collections (gradebook_scores) MUST NOT — branchId is backfilled by an
    // async trigger with 1-2s lag, so a strict where clause silently drops
    // fresh writes. teacherId/classId/assignmentId already provide branch
    // isolation downstream.
    const SC_RES: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC_RES.push(where("branchId", "==", branchId));
    const SC_EVT: QueryConstraint[] = [where("schoolId", "==", schoolId)];

    // P1-5: race guard — when class switches mid-snapshot the older listener
    // can resolve AFTER the newer one and clobber state. cancelled flag stops
    // the stale callbacks from setting stale state.
    let cancelled = false;

    // P2-1: clear stale error when a fresh attempt starts
    setListenerError(null);

    const u1 = onSnapshot(
      query(collection(db, "enrollments"), ...SC_RES, where("classId", "==", targetClassId)),
      (snap) => {
        if (cancelled) return;
        const studs = snap.docs.map(d => {
          const e = d.data();
          // P2-5: dedup tightened in the helper below — index by both email
          // AND id so two students sharing one but missing the other don't
          // collapse into a single row.
          return {
            id: e.studentId || e.studentEmail,
            realId: e.studentId,
            email: e.studentEmail,
            name: e.studentName,
            rollNo: e.rollNo || "",
            initials: e.studentName?.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) || "ST"
          };
        });
        // P2-5: dedup using composite key — id + lowercased email — so we
        // only collapse when BOTH match. Old `email || id` lost students
        // when one had an email but another only an id with the same value.
        const seen = new Set<string>();
        const dedup = studs.filter(s => {
          const k = `${s.id || ""}::${(s.email || "").toLowerCase()}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        setStudents(dedup.sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      },
      onListenerErr("class roster"),
    );

    const u2 = onSnapshot(
      query(collection(db, "gradebook_columns"), ...SC_RES, where("assignmentId", "==", selectedClassId)),
      (snap) => {
        if (cancelled) return;
        setColumns(
          snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomColumn))
            .sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0))
        );
      },
      onListenerErr("custom units"),
    );

    const u3 = onSnapshot(
      query(collection(db, "gradebook_scores"), ...SC_EVT, where("assignmentId", "==", selectedClassId)),
      (snap) => {
        if (cancelled) return;
        const fetched: Record<string, number | null> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          const key = (data.studentEmail?.toLowerCase() || data.studentId);
          // Coerce to Number on read so the dirty-check (P0-3) compares
          // like-with-like instead of "85" !== 85 always being true.
          const markNum = data.mark != null ? Number(data.mark) : null;
          fetched[`${key}_${data.columnId}`] = Number.isFinite(markNum as number) ? markNum : null;
        });
        setScores(fetched);
        setLocalScores(fetched);
        setLoading(false);
      },
      (err) => { onListenerErr("scores")(err); setLoading(false); },
    );

    return () => { cancelled = true; u1(); u2(); u3(); };
  }, [teacherData?.id, selectedClassId, classes, refreshKey]);

  // 3. Fetch class activities (tests + assignments) + their score counts.
  // Same branchId discipline: SC_RES (resolution entities — tests, assignments)
  // gets branchId; SC_EVT (event streams — test_scores, submissions) does NOT.
  useEffect(() => {
    if (!teacherData?.schoolId || !selectedClassId) return;
    const sel = classes.find(c => c.id === selectedClassId);
    const targetClassId = sel?.classId || selectedClassId;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const SC_RES: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC_RES.push(where("branchId", "==", branchId));
    const SC_EVT: QueryConstraint[] = [where("schoolId", "==", schoolId)];

    let cancelled = false;

    const ut = onSnapshot(
      query(collection(db, "tests"), ...SC_RES, where("classId", "==", targetClassId)),
      (snap) => {
        if (cancelled) return;
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as TestDoc);
        list.sort((a, b) => String(b.testDate || "").localeCompare(String(a.testDate || "")));
        setClassTests(list);
      },
      onListenerErr("tests"),
    );

    const ua = onSnapshot(
      query(collection(db, "assignments"), ...SC_RES, where("classId", "==", targetClassId)),
      (snap) => {
        if (cancelled) return;
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as AssignmentDoc);
        list.sort((a, b) => String(b.dueDate || "").localeCompare(String(a.dueDate || "")));
        setClassAssignments(list);
      },
      onListenerErr("assignments"),
    );

    // test_scores by class — count per testId. Powers the "X of Y graded" chip
    // on each test row + the activities-section progress.
    const usc = onSnapshot(
      query(collection(db, "test_scores"), ...SC_EVT, where("classId", "==", targetClassId)),
      (snap) => {
        if (cancelled) return;
        const m = new Map<string, number>();
        snap.docs.forEach(d => {
          const data = d.data() as { testId?: unknown; score?: unknown };
          if (typeof data.testId === "string" && data.score != null) {
            m.set(data.testId, (m.get(data.testId) || 0) + 1);
          }
        });
        setTestScoreCounts(m);
      },
      onListenerErr("test scores"),
    );

    // submissions by class — counts graded ones (where `score` is set OR
    // status === "graded") per assignmentId. Submissions doc shape varies
    // across CreateAssignment writers (some set `homeworkId` instead of
    // `assignmentId`), so we tally both keys.
    const usu = onSnapshot(
      query(collection(db, "submissions"), ...SC_EVT, where("classId", "==", targetClassId)),
      (snap) => {
        if (cancelled) return;
        const m = new Map<string, number>();
        snap.docs.forEach(d => {
          const data = d.data() as { assignmentId?: unknown; homeworkId?: unknown; score?: unknown; marks?: unknown; status?: unknown };
          const isGraded =
            data.score != null ||
            data.marks != null ||
            String(data.status || "").toLowerCase() === "graded";
          if (!isGraded) return;
          const aid = (typeof data.assignmentId === "string" ? data.assignmentId : "") ||
                      (typeof data.homeworkId   === "string" ? data.homeworkId   : "");
          if (aid) m.set(aid, (m.get(aid) || 0) + 1);
        });
        setAssignmentGradeCounts(m);
      },
      onListenerErr("submissions"),
    );

    return () => { cancelled = true; ut(); ua(); usc(); usu(); };
  }, [teacherData?.schoolId, teacherData?.branchId, selectedClassId, classes, refreshKey]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddColumn = async () => {
    if (!newColName.trim()) return toast.error("Column name required");
    // Validate maxMarks — must be positive finite number. Old code silently
    // fell back to 100 on garbage input (Number("0") || 100 = 100, Number("abc") || 100 = 100).
    const maxN = parseFloat(newColMax);
    if (!Number.isFinite(maxN) || maxN <= 0) {
      return toast.error("Max marks must be a positive number.");
    }
    if (maxN > 1000) {
      return toast.error("Max marks cannot exceed 1000.");
    }
    const colId = `col_${Date.now()}`;
    await auditedSet(doc(db, "gradebook_columns", colId), {
      id: colId,
      assignmentId: selectedClassId,
      classId: classes.find(c => c.id === selectedClassId)?.classId || selectedClassId,
      teacherId: teacherData.id,
      schoolId: teacherData.schoolId || "",
      branchId: teacherData.branchId || "",
      name: newColName.trim(),
      maxMarks: maxN,
      createdAt: Date.now()
    });
    setShowAddCol(false);
    setNewColName("");
    setNewColMax("100");
    toast.success("Column added.");
  };

  const handleDeleteColumn = async (id: string) => {
    if (confirm("Delete this column?")) {
      await auditedDelete(doc(db, "gradebook_columns", id));
      toast.success("Column deleted.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const sel = classes.find(c => c.id === selectedClassId);
    const inheritedSubject = (sel?.subject || "").trim();
    const inheritedClassName = (sel?.className || "").trim();
    const inheritedTopic = inheritedSubject; // gradebook scores have no per-cell topic;
    // subject doubles as the topic key downstream (cross-dashboard readers
    // group by subject || topic). Cleaner than "General topics" fallback.

    // P1-1: Firestore writeBatch caps at 500 ops. 30 students × 17 columns =
    // 510 ops → bulk class fails. Chunk into ≤500-op batches and commit
    // sequentially. Counter still shows total entries actually changed.
    const MAX_BATCH = 500;
    const pending: Array<{ ref: ReturnType<typeof doc>; payload: Record<string, unknown> }> = [];

    students.forEach(stu => {
      columns.forEach(col => {
        const key = `${(stu.email || stu.id).toLowerCase()}_${col.id}`;
        const localRaw = localScores[key];
        const remoteVal = scores[key];

        // P0-3: coerce both sides to Number for the dirty-check. Storing
        // input as string ("85") and reading from Firestore as number (85)
        // made `localScores[key] !== scores[key]` ALWAYS true → save wrote
        // every cell even when nothing changed.
        const localNum = localRaw === "" || localRaw == null ? null : Number(localRaw);
        const remoteNum = remoteVal == null ? null : Number(remoteVal);
        const localIsValid = localNum == null || Number.isFinite(localNum);
        if (!localIsValid) return; // skip garbage like "abc"
        if (localNum === remoteNum) return; // unchanged
        // Edge: both null (cell cleared, never had a value) — nothing to write
        if (localNum == null && remoteNum == null) return;

        // P0-5 defense in depth: clamp at write time too in case the input
        // guard was bypassed (paste, programmatic injection, etc.)
        const maxMarks = Number(col.maxMarks) || 100;
        const finalMark = localNum == null ? null : Math.max(0, Math.min(maxMarks, localNum));

        pending.push({
          ref: doc(db, "gradebook_scores", `${stu.id}_${col.id}`),
          payload: {
            id: `${stu.id}_${col.id}`,
            studentId: stu.realId || stu.id,
            studentEmail: stu.email?.toLowerCase() || "",
            studentName: stu.name,
            teacherId: teacherData.id,
            schoolId: teacherData.schoolId || "",
            branchId: teacherData.branchId || "",
            columnId: col.id,
            columnName: col.name,
            assignmentId: selectedClassId,
            classId: sel?.classId || selectedClassId,
            // P0-2: cross-dashboard fields the 22 readers filter/group by.
            // className lowercased to match EnterScores / TestsExams convention.
            className: inheritedClassName.toLowerCase(),
            subject: inheritedSubject,
            topic: inheritedTopic,
            mark: finalMark,
            maxMarks,
            updatedAt: Date.now(),
          },
        });
      });
    });

    try {
      for (let i = 0; i < pending.length; i += MAX_BATCH) {
        const slice = pending.slice(i, i + MAX_BATCH);
        const batch = writeBatch(db);
        slice.forEach(({ ref, payload }) => batch.set(ref, payload, { merge: true }));
        await batch.commit();
      }
      toast.success(pending.length > 0 ? `Saved ${pending.length} entries` : "No changes to save");
    } catch (e) {
      console.error("[Gradebook] save failed", e);
      const code = (e as { code?: string })?.code;
      toast.error(code === "permission-denied" ? "Permission denied — check your access." : "Save failed. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveColumn = async () => {
    await handleSave();
    setView('main');
  };

  const handleDiscard = () => {
    if (!selectedColForEdit) { setView('main'); return; }
    const revert = { ...localScores };
    students.forEach(stu => {
      const key = `${(stu.email || stu.id).toLowerCase()}_${selectedColForEdit.id}`;
      const orig = scores[key];
      if (orig !== undefined) revert[key] = orig;
      else delete revert[key];
    });
    setLocalScores(revert);
    setView('main');
  };

  const handleExport = async () => {
    const headers = ["Student", ...columns.map(c => `${c.name} (${c.maxMarks})`), "Total", "Grade"];
    const rows = filtered.map(stu => {
      const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0);
      const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
      return [stu.name, ...columns.map(c => localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`] || ""), earned, getGrade(pct)];
    });
    try {
      const XLSX = await loadXLSX();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Gradebook");
      const rawName = selectedClass?.name || "Export";
      const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_").trim() || "Export";
      XLSX.writeFile(wb, `Gradebook_${safeName}.xlsx`);
    } catch (e) {
      console.error("[Gradebook] export failed", e);
      toast.error("Export failed.");
    }
  };

  // ── Computed ───────────────────────────────────────────────────────────────

  const filtered = students.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.email?.toLowerCase().includes(search.toLowerCase())
  );

  const selectedClass = classes.find(c => c.id === selectedClassId);

  // P1-2: include valid zero scores in the column average (a student who
  // scored 0 IS a data point and should drag the average down). Old filter
  // `v > 0` silently excluded zeros and over-stated class performance.
  const colAvgs = columns.map(col => {
    const vals = filtered
      .map(stu => {
        const raw = localScores[`${(stu.email || stu.id).toLowerCase()}_${col.id}`];
        if (raw === "" || raw == null) return NaN;
        return Number(raw);
      })
      .filter(v => Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });

  const totalAvgEarned = colAvgs.reduce((a, b) => a + b, 0);
  const totalMax = columns.reduce((a, c) => a + c.maxMarks, 0);
  const classAvgPct = totalMax > 0 ? (totalAvgEarned / totalMax) * 100 : 0;
  const avgGradeLabel = simpleGrade(classAvgPct);

  // P0-3: dirty check uses Number-coerced comparison so the input field's
  // string "85" matches the snapshot's Number 85. The old JSON.stringify
  // diff was the root cause of "Save" always showing unsaved + every save
  // re-writing every touched cell.
  const hasUnsaved = useMemo(() => {
    const allKeys = new Set([...Object.keys(localScores), ...Object.keys(scores)]);
    for (const k of allKeys) {
      const a = localScores[k];
      const b = scores[k];
      const an = a === "" || a == null ? null : Number(a);
      const bn = b == null ? null : Number(b);
      if (an !== bn && !(an == null && bn == null)) return true;
    }
    return false;
  }, [localScores, scores]);

  // P2-4: beforeunload warning when teacher has unsaved score edits and tries
  // to close tab / navigate away. Browsers ignore the custom message text and
  // show their own confirm — but they DO honor the cancellation, which is the
  // load-bearing part. Skipped while in overlay views (EnterScores /
  // GradeAssignment manage their own dirty state).
  useEffect(() => {
    if (!hasUnsaved || view !== 'main') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // required for Chrome
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsaved, view]);

  // P1-4: removed dead `gradeDist` useMemo — computed an A/B/C/F histogram
  // that was never rendered anywhere. The hero already shows passing/at-risk
  // counts which cover the same intent more meaningfully.

  // ── Render: EnterScores overlay (test/exam from this class) ────────────────
  // The standalone EnterScores component has its own Blue Apple chrome — we
  // just mount it and route onBack back to the main view. test_scores writes
  // happen inside that component using the canonical writer pattern.
  if (view === 'enter-test' && activeTest) {
    return (
      <EnterScores
        test={activeTest}
        onBack={() => { setView('main'); setActiveTest(null); }}
      />
    );
  }

  // ── Render: GradeAssignment overlay (assignment from this class) ───────────
  if (view === 'grade-assignment' && activeAssignment) {
    return (
      <GradeAssignment
        assignment={activeAssignment}
        onBack={() => { setView('main'); setActiveAssignment(null); }}
      />
    );
  }

  // ── Render: Enter Scores View (custom Gradebook unit — existing flow) ──────
  if (view === 'enter-scores' && selectedColForEdit) {
    const col = selectedColForEdit;

    return (
      <div style={{ fontFamily: 'inherit', minHeight: '100vh', background: '#EEF4FF' }} className="text-left pb-24">

        {/* Dark hero */}
        <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-6 bg-[#001A66] md:bg-[#08090C]">
          <button
            type="button"
            aria-label="Back to gradebook"
            onClick={() => setView('main')}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 500,
              fontFamily: 'inherit', padding: '14px 0 10px 0',
            }}
          >
            <IcoChevron />
            Gradebook
          </button>
          <div style={{ fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>
            Enter scores
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.1, marginBottom: 4 }}>
            {col.name}<br />Scores
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginBottom: 14 }}>
            {selectedClass?.name} · Max {col.maxMarks} marks
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {[
              { label: 'Editing' },
              { strong: String(filtered.length), label: ' Students' },
            ].map((chip, i) => (
              <div key={i} style={{
                padding: '5px 10px', borderRadius: 20,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.06)',
                fontSize: 10, color: 'rgba(255,255,255,0.6)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {chip.strong && <strong style={{ color: '#fff', fontWeight: 500 }}>{chip.strong}</strong>}
                {chip.label}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="pt-4 flex flex-col gap-3">

          {/* Unit info card */}
          <div style={{
            background: T.s0, border: `1px solid ${T.bdr}`,
            borderRadius: 14, padding: '12px 13px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: T.purpleL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke={T.purple} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="1.5" width="10" height="11" rx="1.5"/>
                  <line x1="4.5" y1="5" x2="9.5" y2="5"/>
                  <line x1="4.5" y1="7.5" x2="7.5" y2="7.5"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.ink0 }}>{col.name} assessment</div>
                <div style={{ fontSize: 10, color: T.ink2, marginTop: 1 }}>Max {col.maxMarks} marks · {selectedClass?.name}</div>
              </div>
            </div>
            <span style={{ padding: '3px 8px', borderRadius: 20, background: T.purpleL, color: T.purple, fontSize: 10, fontWeight: 500 }}>Active</span>
          </div>

          {/* Section label */}
          <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '0 2px' }}>
            Student scores
          </div>

          {/* Per-student score cards */}
          {filtered.map(stu => {
            const av = avStyle(stu.name || '');
            const initials = getInitials(stu.name || '');
            const key = `${(stu.email || stu.id).toLowerCase()}_${col.id}`;
            const rawVal = localScores[key];
            const numVal = rawVal !== undefined && rawVal !== '' ? Number(rawVal) : null;
            const pct = numVal !== null ? Math.min(100, (numVal / col.maxMarks) * 100) : 0;
            const grd = simpleGrade(numVal !== null ? pct : 0);

            return (
              <div key={stu.email || stu.id} style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ height: 3, background: av.color }} />
                <div style={{ padding: 13 }}>
                  {/* Student info row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 11,
                      background: av.bg, color: av.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 500, flexShrink: 0,
                    }}>
                      {initials}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: T.ink0 }}>{stu.name}</div>
                      <div style={{ fontSize: 10, color: T.ink2, marginTop: 1 }}>
                        {stu.rollNo ? `Roll ${stu.rollNo} · ` : ''}{selectedClass?.name}
                      </div>
                    </div>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 22, borderRadius: 7,
                      fontSize: 11, fontWeight: 500,
                      background: grd.bg, color: grd.color,
                    }}>
                      {grd.label}
                    </div>
                  </div>

                  {/* Score input */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 11 }}>
                    <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      Score — {col.name}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="number"
                        value={rawVal ?? ''}
                        onChange={e => {
                          const v = e.target.value;
                          // P0-5: reject input that exceeds maxMarks or is
                          // negative. HTML max= is ignored on programmatic
                          // typing, so we guard explicitly + warn the user.
                          const check = validScoreInput(v, col.maxMarks);
                          if (!check.ok) {
                            toast.error(check.reason || "Invalid score.");
                            return;
                          }
                          setLocalScores(prev => ({
                            ...prev,
                            [key]: v === '' ? undefined : v,
                          }));
                        }}
                        placeholder="Enter score"
                        min={0}
                        max={col.maxMarks}
                        style={{
                          flex: 1, padding: '10px 12px', borderRadius: 10,
                          border: `1px solid ${T.bdr}`, background: T.s1,
                          fontSize: 14, fontWeight: 500, color: T.ink0,
                          fontFamily: 'inherit', outline: 'none',
                        }}
                      />
                      <div style={{ fontSize: 12, color: T.ink2, whiteSpace: 'nowrap' }}>/ {col.maxMarks}</div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ height: 5, borderRadius: 3, background: T.s2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      background: av.color,
                      width: `${pct}%`,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Grade scale reference */}
          <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: '12px 13px' }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
              Grade scale
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
              {[
                { label: 'A — 90%+', bg: T.greenL, color: T.green2 },
                { label: 'B — 70–89%', bg: T.blueL, color: T.blue },
                { label: 'C — 50–69%', bg: T.amberL, color: T.amber },
                { label: 'F — <50%', bg: T.redL, color: T.red },
              ].map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 9, background: g.bg }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                  <div style={{ fontSize: 11, color: g.color, fontWeight: 500 }}>{g.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Save / Discard footer */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleSaveColumn}
              disabled={saving}
              style={{
                flex: 1, padding: 12, borderRadius: 12, background: T.green2, border: 'none',
                color: '#fff', fontSize: 13, fontWeight: 500,
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', opacity: saving ? 0.7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <IcoCheck />}
              Save scores
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: T.s0, border: `1px solid ${T.bdr}`,
                color: T.ink2, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Discard
            </button>
          </div>

        </div>

      </div>
    );
  }

  // ── Render: Main View ──────────────────────────────────────────────────────
  // Helpers for the mobile mockup design — letterGrade now delegates to the
  // module-scope canonical helper so a student's grade letter matches across
  // every card on the page (audit P0-4).
  const letterGrade = getGradeInfo;
  const band = (pct: number) => {
    if (pct >= 90) return { cls: 'excellent', label: 'Excellent' };
    if (pct >= 70) return { cls: 'good', label: 'Good' };
    if (pct >= 50) return { cls: 'average', label: 'Average' };
    return { cls: 'atrisk', label: 'At Risk' };
  };
  const avatarBg = (name: string) => {
    const palette = ['#7B3FF4', '#00C853', '#0055FF', '#FF8800', '#00B8D4', '#C2255C', '#6741D9'];
    const sum = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return palette[sum % palette.length];
  };
  // Activities row component — renders one test or assignment as a clickable
  // chip that opens the relevant overlay. Used in both mobile + desktop views.
  const ActivityRow = ({ kind, name, sub, scoredCount, total, badge, badgeColor, onOpen }: {
    kind: 'test' | 'exam' | 'assignment';
    name: string;
    sub: string;
    scoredCount: number;
    total: number;
    badge: string;
    badgeColor: string;
    onOpen: () => void;
  }) => {
    const fullyDone = total > 0 && scoredCount >= total;
    const inProgress = scoredCount > 0 && !fullyDone;
    const stateColor = fullyDone ? '#00C853' : inProgress ? '#FF8800' : '#5070B0';
    const stateLabel = fullyDone ? 'Completed' : inProgress ? `${scoredCount}/${total} graded` : (total > 0 ? `0/${total} graded` : 'No roster');
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        className="gb-press"
        style={{
          display: 'flex', alignItems: 'center', gap: 11,
          padding: '12px 13px', background: '#fff', borderRadius: 13,
          border: `0.5px solid ${badgeColor}22`, cursor: 'pointer',
          marginBottom: 8,
        }}
      >
        <div style={{
          width: 38, height: 38, borderRadius: 11,
          background: `${badgeColor}1A`, color: badgeColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, letterSpacing: '0.6px',
          flexShrink: 0, textTransform: 'uppercase',
        }}>
          {badge}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#001040', letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name || 'Untitled'}
          </div>
          <div style={{ fontSize: 11, color: '#5070B0', marginTop: 2, fontWeight: 500, letterSpacing: '-0.1px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: stateColor, flexShrink: 0 }} />
            <span>{stateLabel}</span>
            {sub && <span style={{ color: '#99AACC' }}>·</span>}
            {sub && <span>{sub}</span>}
          </div>
        </div>
        <div style={{
          padding: '7px 13px', borderRadius: 9,
          background: fullyDone ? '#EBFBEE' : '#0055FF',
          color: fullyDone ? '#087F5B' : '#fff',
          fontSize: 11, fontWeight: 700, letterSpacing: '-0.1px',
          flexShrink: 0,
        }}>
          {fullyDone ? 'Edit' : (kind === 'assignment' ? 'Grade' : 'Enter scores')}
        </div>
      </div>
    );
  };

  // Activities section — renders the unified list of class tests, exams, and
  // assignments. Filters out anything without resolvable identity.
  const ActivitiesSection = () => {
    const totalEnrolled = students.length;
    const items: Array<{ key: string; node: React.ReactNode; date: string }> = [];

    classTests.forEach(t => {
      const isExam = isExamCategory(t.category);
      const badge = isExam ? 'EXAM' : (t.category || 'TEST');
      const badgeColor = isExam ? '#7B3FF4' : '#0055FF';
      const subParts = [
        t.subject || '',
        t.testDate || '',
        t.marks ? `${t.marks}m` : '',
      ].filter(Boolean);
      items.push({
        key: `t_${t.id}`,
        date: String(t.testDate || ''),
        node: (
          <ActivityRow
            key={`t_${t.id}`}
            kind={isExam ? 'exam' : 'test'}
            name={t.testName || t.title || 'Untitled test'}
            sub={subParts.join(' · ')}
            scoredCount={testScoreCounts.get(t.id) || 0}
            total={totalEnrolled}
            badge={badge.slice(0, 8)}
            badgeColor={badgeColor}
            onOpen={() => { setActiveTest(t); setView('enter-test'); }}
          />
        ),
      });
    });

    classAssignments.forEach(a => {
      const subParts = [
        a.subject || '',
        a.dueDate ? `Due ${a.dueDate}` : '',
        a.maxMarks ? `${a.maxMarks}m` : '',
      ].filter(Boolean);
      items.push({
        key: `a_${a.id}`,
        date: String(a.dueDate || ''),
        node: (
          <ActivityRow
            key={`a_${a.id}`}
            kind="assignment"
            name={a.title || 'Untitled assignment'}
            sub={subParts.join(' · ')}
            scoredCount={assignmentGradeCounts.get(a.id) || 0}
            total={totalEnrolled}
            badge="ASGN"
            badgeColor="#FF8800"
            onOpen={() => { setActiveAssignment(a); setView('grade-assignment'); }}
          />
        ),
      });
    });

    // Newest first by date
    items.sort((x, y) => y.date.localeCompare(x.date));

    if (classTests.length === 0 && classAssignments.length === 0) {
      return (
        <div style={{
          background: '#fff', borderRadius: 14, padding: '20px 14px', textAlign: 'center',
          color: '#5070B0', fontSize: 12, fontWeight: 500,
          boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10)',
        }}>
          No tests, exams, or assignments scheduled for this class yet.
        </div>
      );
    }
    return <div>{items.map(i => i.node)}</div>;
  };

  // ── Excel-style Custom Units table ────────────────────────────────────────
  // Replaces the per-student card grid with a real spreadsheet:
  //   rows = students, columns = custom units, cells = score inputs.
  // First column (Student) + last 2 columns (Total + Grade) are sticky so
  // they stay pinned during horizontal scroll on narrow screens.
  // Used for both mobile + desktop main views — same render, different
  // outer container handles overflow vs full-width.
  const renderCustomUnitsTable = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ height: 44, borderRadius: 10, background: '#F4F7FE', animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div style={{
          background: '#fff', borderRadius: 14, padding: '22px 14px', textAlign: 'center',
          color: '#5070B0', fontSize: 12, fontWeight: 500,
          boxShadow: '0 0 0 0.5px rgba(0,85,255,.09)',
        }}>
          {search ? 'No students match your search.' : 'No students enrolled yet.'}
        </div>
      );
    }
    if (columns.length === 0) {
      return (
        <div style={{
          background: '#fff', borderRadius: 14, padding: '22px 14px', textAlign: 'center',
          color: '#5070B0', fontSize: 12, fontWeight: 500,
          boxShadow: '0 0 0 0.5px rgba(0,85,255,.09)',
        }}>
          No units yet — click <strong style={{ color: '#0055FF' }}>+ Unit</strong> above to add one.
        </div>
      );
    }

    return (
      <div className="gb-table-wrap" style={{
        background: '#fff', borderRadius: 16, overflow: 'auto',
        boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
        maxWidth: '100%',
      }}>
        <style>{`
          .gb-table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
          .gb-table thead th {
            position: sticky; top: 0;
            background: #F4F7FE; color: #002080;
            font-size: 11px; font-weight: 700; letter-spacing: -0.1px;
            padding: 12px 10px; text-align: left; white-space: nowrap;
            border-bottom: 0.5px solid rgba(9,87,247,.15);
            z-index: 2;
          }
          .gb-table thead th.col-edit { cursor: pointer; }
          .gb-table thead th.col-edit:hover { background: #EAF0FB; }
          .gb-table thead th .col-max { font-size: 10px; color: #5070B0; font-weight: 600; margin-top: 2px; }
          .gb-table tbody td {
            padding: 8px 10px;
            font-size: 12px; color: #001040;
            border-bottom: 0.5px solid rgba(9,87,247,.06);
            vertical-align: middle;
          }
          .gb-table tbody tr:last-child td { border-bottom: none; }
          .gb-table tbody tr:hover td { background: rgba(9,87,247,.03); }
          .gb-table tfoot td {
            padding: 11px 10px;
            font-size: 12px; font-weight: 700; color: #002080;
            background: linear-gradient(90deg, rgba(9,87,247,.06), rgba(9,87,247,.03));
            border-top: 0.5px solid rgba(9,87,247,.12);
          }
          .gb-table .col-sticky-left {
            position: sticky; left: 0;
            background: #fff; z-index: 1;
            box-shadow: 1px 0 0 rgba(9,87,247,.08);
            min-width: 180px;
          }
          .gb-table thead th.col-sticky-left { background: #F4F7FE; z-index: 3; }
          .gb-table tfoot td.col-sticky-left { background: #EAF0FB; z-index: 1; }
          .gb-table .col-sticky-right {
            position: sticky; right: 0;
            background: #fff; z-index: 1;
            box-shadow: -1px 0 0 rgba(9,87,247,.08);
            text-align: center; white-space: nowrap;
          }
          .gb-table thead th.col-sticky-right { background: #F4F7FE; z-index: 3; }
          .gb-table tfoot td.col-sticky-right { background: #EAF0FB; z-index: 1; }
          .gb-table .stu-cell { display: flex; align-items: center; gap: 9px; }
          .gb-table .stu-cell .stu-name { font-weight: 700; font-size: 12.5px; color: #001040; letter-spacing: -0.15px; line-height: 1.2; white-space: nowrap; }
          .gb-table .stu-cell .stu-roll { font-size: 10px; color: #5070B0; font-weight: 500; margin-top: 1px; }
          .gb-table .score-cell { padding: 6px 8px; }
          .gb-table .score-cell input {
            width: 64px; padding: 7px 9px; border-radius: 8px;
            border: 0.5px solid rgba(9,87,247,.12); background: #F4F7FE;
            font-size: 12.5px; font-weight: 700; color: #001040;
            font-family: inherit; outline: none; text-align: center; letter-spacing: -0.1px;
            transition: all .2s ease;
          }
          .gb-table .score-cell input:focus { background: #fff; border-color: #0055FF; box-shadow: 0 0 0 3px rgba(9,87,247,.14); }
          .gb-table .total-num { font-size: 13.5px; font-weight: 700; letter-spacing: -0.2px; }
          .gb-table .grade-badge {
            display: inline-flex; align-items: center; justify-content: center;
            width: 30px; height: 24px; border-radius: 7px;
            font-size: 12px; font-weight: 700; color: #fff;
          }
        `}</style>
        <table className="gb-table">
          <thead>
            <tr>
              <th className="col-sticky-left">Student</th>
              {columns.map(col => (
                <th
                  key={col.id}
                  className="col-edit"
                  onClick={() => { setSelectedColForEdit(col); setView('enter-scores'); }}
                  title={`Edit ${col.name} scores`}
                >
                  {col.name}
                  <div className="col-max">/ {col.maxMarks}</div>
                </th>
              ))}
              <th className="col-sticky-right">Total</th>
              <th className="col-sticky-right" style={{ right: 0, paddingLeft: 0 }}>Grade</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(stu => {
              const key = (stu.email || stu.id).toLowerCase();
              let touchedAny = false;
              const earned = columns.reduce((acc, c) => {
                const v = localScores[`${key}_${c.id}`];
                if (v === "" || v == null) return acc;
                const n = Number(v);
                if (!Number.isFinite(n)) return acc;
                touchedAny = true;
                return acc + n;
              }, 0);
              const pct = totalMax > 0 && touchedAny ? (earned / totalMax) * 100 : 0;
              const grd = letterGrade(pct);
              const av = avatarBg(stu.name || '');
              return (
                <tr key={stu.email || stu.id}>
                  <td className="col-sticky-left">
                    <div className="stu-cell">
                      <div style={{
                        width: 32, height: 32, borderRadius: 10,
                        background: av, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                      }}>
                        {getInitials(stu.name || '')}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="stu-name">{stu.name}</div>
                        {stu.rollNo && <div className="stu-roll">Roll {stu.rollNo}</div>}
                      </div>
                    </div>
                  </td>
                  {columns.map(col => {
                    const scoreKey = `${key}_${col.id}`;
                    const val = localScores[scoreKey];
                    return (
                      <td key={col.id} className="score-cell">
                        <input
                          type="number"
                          value={val ?? ''}
                          min={0}
                          max={col.maxMarks}
                          placeholder="—"
                          onChange={e => {
                            const v = e.target.value;
                            const check = validScoreInput(v, col.maxMarks);
                            if (!check.ok) { toast.error(check.reason || "Invalid score."); return; }
                            setLocalScores(p => ({ ...p, [scoreKey]: v }));
                          }}
                        />
                      </td>
                    );
                  })}
                  <td className="col-sticky-right">
                    <span className="total-num" style={{ color: touchedAny ? grd.color : '#99AACC' }}>
                      {touchedAny ? earned : '—'}
                      <span style={{ fontSize: 10.5, color: '#99AACC', fontWeight: 700, marginLeft: 2 }}>
                        / {totalMax}
                      </span>
                    </span>
                  </td>
                  <td className="col-sticky-right" style={{ right: 0, paddingLeft: 0 }}>
                    <span className="grade-badge" style={{ background: touchedAny ? grd.color : '#E2E5EE', color: touchedAny ? '#fff' : '#99AACC' }}>
                      {touchedAny ? grd.label : '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-sticky-left">Class Avg</td>
              {colAvgs.map((avg, i) => (
                <td key={i} style={{ textAlign: 'center', color: '#FF8800' }}>
                  {avg > 0 ? avg.toFixed(1) : '—'}
                </td>
              ))}
              <td className="col-sticky-right">
                <span className="total-num" style={{ color: avgLetter.color }}>
                  {classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'}
                  <span style={{ fontSize: 10.5, color: '#99AACC', fontWeight: 700, marginLeft: 2 }}>
                    / 100
                  </span>
                </span>
              </td>
              <td className="col-sticky-right" style={{ right: 0, paddingLeft: 0 }}>
                <span className="grade-badge" style={{ background: avgLetter.color, color: '#fff' }}>
                  {avgLetter.label}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  const lowest = filtered.length && columns.length ? Math.min(...filtered.map(stu => columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0))) : 0;
  const highest = filtered.length && columns.length ? Math.max(...filtered.map(stu => columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0))) : 0;
  const avgBand = band(classAvgPct);
  const avgLetter = letterGrade(classAvgPct);
  const passingCount = filtered.filter(stu => {
    const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0);
    const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
    return pct >= 50;
  }).length;
  const atRiskCount = filtered.length - passingCount;

  return (
    <div style={{ fontFamily: 'inherit', minHeight: '100vh' }} className="text-left pb-24">

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <div
        className="md:hidden gradebook-mobile-root -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px] pb-7"
        style={{
          background: '#EEF4FF',
          minHeight: '100vh',
          fontVariantNumeric: 'tabular-nums',
        }}
      >

        {/* Scoped styles for this mobile view only */}
        <style>{`
          .gb-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
          @media (hover:hover) {
            .gb-card3d:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); }
          }
          .gb-card3d:active { transform: translateY(-1px) scale(.99); }
          .gb-press { transition: all 0.3s ease; }
          .gb-press:hover { transform: translateY(-1px); filter: brightness(1.05); }
          .gb-press:active { transform: scale(.94); }
          .gb-score-input { transition: all 0.3s ease; }
          .gb-score-input:focus { background: #fff !important; border-color: #0055FF !important; box-shadow: 0 0 0 3px rgba(9,87,247,.14) !important; }
          @keyframes gbFadeInUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
          .gb-enter > * { animation: gbFadeInUp .5s cubic-bezier(.34,1.56,.64,1) both; }
          .gb-enter > *:nth-child(1) { animation-delay: .04s; }
          .gb-enter > *:nth-child(2) { animation-delay: .10s; }
          .gb-enter > *:nth-child(3) { animation-delay: .16s; }
          .gb-enter > *:nth-child(4) { animation-delay: .22s; }
          .gb-enter > *:nth-child(5) { animation-delay: .28s; }
          .gb-enter > *:nth-child(6) { animation-delay: .34s; }
          .gb-enter > *:nth-child(7) { animation-delay: .40s; }
          .gb-enter > *:nth-child(8) { animation-delay: .46s; }
          .gb-legend-scroll::-webkit-scrollbar { display: none; }
          .gb-legend-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

        <div className="gb-enter" style={{ display: 'flex', flexDirection: 'column' }}>

          {/* Page header */}
          <div style={{ padding: '8px 2px 14px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 5, height: 5, borderRadius: 2, background: '#0055FF', display: 'inline-block' }} />
              Teacher Dashboard · Gradebook
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#001040', letterSpacing: '-1.1px', lineHeight: 1.05, margin: 0 }}>Gradebook</h1>
            <div style={{ fontSize: 12, color: '#5070B0', fontWeight: 500, marginTop: 6, letterSpacing: '-0.15px' }}>
              {selectedClass ? `Complete academic record for ${selectedClass.name}.` : 'Select a class to view gradebook.'}
            </div>
          </div>

          {/* P2-1: listener-failure banner with one-tap retry */}
          {listenerError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
              padding: '10px 12px', borderRadius: 12,
              background: '#FFF5F5', border: '0.5px solid #FFD8D8',
            }}>
              <div style={{ flex: 1, fontSize: 12, color: '#C92A2A', fontWeight: 500, lineHeight: 1.45 }}>
                {listenerError}
              </div>
              <button
                type="button"
                onClick={() => { setListenerError(null); setRefreshKey(k => k + 1); }}
                style={{
                  padding: '6px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: '#C92A2A', color: '#fff', fontSize: 11, fontWeight: 700,
                  fontFamily: 'inherit',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Class picker */}
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <div
              className="gb-card3d"
              style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '12px 14px', background: '#fff',
                borderRadius: 14,
                boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
                cursor: 'pointer',
              }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 12, background: '#7B3FF4', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#5070B0', letterSpacing: '1.3px', textTransform: 'uppercase', marginBottom: 2 }}>Viewing</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selectedClass ? selectedClass.name : (classes.length === 0 ? 'No classes' : 'Select class')}
                </div>
              </div>
              <div style={{ color: '#99AACC', fontSize: 22, fontWeight: 400, lineHeight: 1, marginTop: -3 }}>›</div>
            </div>
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              aria-label="Select class"
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                opacity: 0, cursor: 'pointer', border: 'none', background: 'transparent',
                appearance: 'none', WebkitAppearance: 'none',
              }}
            >
              {classes.length === 0 && <option value="">No classes available</option>}
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* HERO — Class Average */}
          <div
            className="gb-card3d"
            role="button"
            tabIndex={0}
            aria-label="Open class report"
            onClick={() => navigate('/reports')}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
            style={{
              background: 'linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)',
              borderRadius: 26, padding: 22, marginBottom: 14,
              position: 'relative', overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(0,8,60,.15), 0 12px 32px rgba(0,8,60,.28)',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', zIndex: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                <div style={{ width: 42, height: 42, borderRadius: 13, background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '0.5px solid rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.72)', letterSpacing: '1.8px', textTransform: 'uppercase' }}>Class Average</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2, fontWeight: 500, letterSpacing: '-0.1px' }}>
                    {columns.length > 0 ? `${columns.length} ${columns.length === 1 ? 'unit' : 'units'} · ${selectedClass?.name || ''}` : 'No units yet'}
                  </div>
                </div>
                <div style={{
                  marginLeft: 'auto', width: 44, height: 44,
                  background: `linear-gradient(145deg, ${avgLetter.color}, ${avgLetter.color}DD)`,
                  color: '#fff', borderRadius: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px',
                  boxShadow: `0 1px 2px ${avgLetter.color}55, 0 6px 14px ${avgLetter.color}55, inset 0 1px 0 rgba(255,255,255,.25)`,
                }}>
                  {avgLetter.label}
                </div>
              </div>
              <div style={{ fontSize: 56, fontWeight: 700, color: '#fff', letterSpacing: '-2.6px', lineHeight: 1, marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                {classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'}
                <span style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '-0.4px' }}>/ 100</span>
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.72)', marginBottom: 20, fontWeight: 500, letterSpacing: '-0.15px' }}>
                <b style={{ color: '#fff', fontWeight: 700 }}>{avgBand.label} performance</b>
                {atRiskCount > 0 ? ` — ${atRiskCount} student${atRiskCount === 1 ? '' : 's'} need${atRiskCount === 1 ? 's' : ''} remediation.` : ' — all students on track.'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'rgba(255,255,255,.1)', borderRadius: 14, padding: 1, overflow: 'hidden' }}>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '12px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px' }}>{filtered.length}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 3 }}>Students</div>
                </div>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '12px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#6FFFAA', letterSpacing: '-0.5px' }}>{passingCount}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 3 }}>Passing</div>
                </div>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '12px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#FF9AA9', letterSpacing: '-0.5px' }}>{atRiskCount}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 3 }}>At Risk</div>
                </div>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="gb-legend-scroll" style={{ display: 'flex', gap: 6, padding: '10px 12px', background: '#fff', borderRadius: 14, marginBottom: 14, overflowX: 'auto', boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)' }}>
            {[
              { c: '#00C853', l: 'Excellent 90+' },
              { c: '#0055FF', l: 'Good 70–89' },
              { c: '#FF8800', l: 'Average 50–69' },
              { c: '#FF3355', l: 'At Risk <50' },
            ].map(item => (
              <div key={item.l} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: '#F4F7FE', borderRadius: 100, fontSize: 10, fontWeight: 700, color: '#002080', letterSpacing: '-0.1px', flexShrink: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.c }} />
                {item.l}
              </div>
            ))}
          </div>

          {/* Section head: Student Grades + Add Unit + search + export */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.35px' }}>Student Grades</span>
              <span style={{ fontSize: 11, color: '#5070B0', fontWeight: 600, letterSpacing: '-0.1px' }}>
                {filtered.length} student{filtered.length === 1 ? '' : 's'} · {columns.length} unit{columns.length === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                aria-label="Export gradebook to Excel"
                onClick={handleExport}
                className="gb-press"
                style={{ width: 30, height: 30, borderRadius: 10, background: '#fff', color: '#0055FF', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0.5px 1px rgba(9,87,247,.06), 0 2px 8px rgba(9,87,247,.08)' }}
              >
                <IcoDownload />
              </button>
              <button
                type="button"
                onClick={() => setShowAddCol(v => !v)}
                aria-expanded={showAddCol}
                className="gb-press"
                style={{
                  height: 30, padding: '0 12px', borderRadius: 10, background: '#0055FF',
                  color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '-0.1px',
                  display: 'flex', alignItems: 'center', gap: 5, border: 'none',
                  boxShadow: '0 1px 2px rgba(9,87,247,.2), 0 3px 8px rgba(9,87,247,.25)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Unit
              </button>
            </div>
          </div>

          {/* Search + Save row */}
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 10 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#5070B0', pointerEvents: 'none' }}>
                <IcoSearch />
              </div>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search student..."
                style={{
                  width: '100%', padding: '9px 10px 9px 28px', borderRadius: 11,
                  border: 'none', background: '#fff',
                  fontSize: 12, color: '#001040', fontFamily: 'inherit', outline: 'none',
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
                }}
              />
            </div>
            <button
              type="button"
              aria-label={saving ? 'Saving grades' : 'Save grades'}
              onClick={handleSave}
              disabled={saving || !hasUnsaved}
              className="gb-press"
              style={{
                padding: '9px 13px', borderRadius: 11,
                background: hasUnsaved ? '#00C853' : '#EAF0FB',
                border: 'none',
                color: hasUnsaved ? '#fff' : '#5070B0',
                fontSize: 11, fontWeight: 700, letterSpacing: '-0.1px',
                cursor: hasUnsaved && !saving ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                opacity: saving ? 0.7 : 1,
                boxShadow: hasUnsaved ? '0 1px 2px rgba(0,200,83,.2), 0 3px 8px rgba(0,200,83,.25)' : 'none',
              }}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <IcoCheck />}
              Save
            </button>
          </div>

          {/* Activities section — Tests, Exams & Assignments for this class */}
          {selectedClassId && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 4px 8px', marginTop: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.35px' }}>
                  Tests, Exams &amp; Assignments
                </span>
                <span style={{ fontSize: 11, color: '#5070B0', fontWeight: 600, letterSpacing: '-0.1px' }}>
                  {classTests.length + classAssignments.length} item{(classTests.length + classAssignments.length) === 1 ? '' : 's'}
                </span>
              </div>
              <div style={{ marginBottom: 16 }}>
                <ActivitiesSection />
              </div>
              <div style={{ height: 1, background: 'rgba(9,87,247,.08)', margin: '4px 0 16px' }} />
              <div style={{ padding: '4px 4px 10px' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.35px' }}>Custom Units</span>
                <span style={{ fontSize: 11, color: '#5070B0', fontWeight: 600, letterSpacing: '-0.1px', marginLeft: 8 }}>
                  Gradebook columns you create yourself
                </span>
              </div>
            </>
          )}

          {/* Add column panel */}
          {showAddCol && (
            <div style={{
              background: '#fff',
              borderRadius: 16, padding: '14px 13px',
              display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
              border: '0.5px solid rgba(9,87,247,.1)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.3px', textTransform: 'uppercase' }}>
                Add unit
              </div>
              <input
                type="text"
                value={newColName}
                onChange={e => setNewColName(e.target.value)}
                placeholder="Unit name (e.g. Unit 1, Quiz 1)"
                onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
                style={{
                  padding: '10px 12px', borderRadius: 10,
                  border: '0.5px solid rgba(9,87,247,.15)', background: '#F4F7FE',
                  fontSize: 13, color: '#001040', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  value={newColMax}
                  onChange={e => setNewColMax(e.target.value)}
                  style={{
                    width: 90, padding: '10px 12px', borderRadius: 10,
                    border: '0.5px solid rgba(9,87,247,.15)', background: '#F4F7FE',
                    fontSize: 13, color: '#001040', fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <span style={{ fontSize: 11, color: '#5070B0', fontWeight: 600 }}>max marks</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleAddColumn}
                  className="gb-press"
                  style={{
                    flex: 1, padding: 10, borderRadius: 10, background: '#0055FF', border: 'none',
                    color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: '0 1px 2px rgba(9,87,247,.2), 0 3px 8px rgba(9,87,247,.25)',
                  }}
                >
                  Add unit
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddCol(false); setNewColName(''); setNewColMax('100'); }}
                  className="gb-press"
                  style={{
                    padding: '10px 14px', borderRadius: 10, background: '#F4F7FE',
                    border: 'none', color: '#5070B0',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Custom Units — Excel-style row-per-student spreadsheet table.
           * Replaces the per-student card grid with a single horizontally-
           * scrollable table where rows are students and columns are units.
           * Same renderer is used by the desktop view below. */}
          {renderCustomUnitsTable()}
          <div style={{ height: 14 }} />

          {/* Class Avg Card */}
          {!loading && filtered.length > 0 && columns.length > 0 && (
            <div
              className="gb-card3d"
              role="button"
              tabIndex={0}
              aria-label="Open detailed class report"
              onClick={() => navigate('/reports')}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
              style={{
                background: '#fff', borderRadius: 20, padding: 16, marginBottom: 14,
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
                border: '0.5px solid rgba(9,87,247,.1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 13, background: '#0055FF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.35px' }}>Class Average</div>
                  <div style={{ fontSize: 11, color: '#5070B0', fontWeight: 600, marginTop: 2, letterSpacing: '-0.1px' }}>Based on {filtered.length} students</div>
                </div>
                <div style={{
                  width: 44, height: 44, borderRadius: 14,
                  background: avgLetter.color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, fontWeight: 700,
                  boxShadow: `0 1px 2px ${avgLetter.color}40, 0 6px 14px ${avgLetter.color}55`,
                  position: 'relative',
                }}>
                  <span style={{ position: 'absolute', inset: 0, borderRadius: 14, background: 'linear-gradient(145deg, rgba(255,255,255,.25), transparent 50%)' }} />
                  {avgLetter.label}
                </div>
              </div>

              <div style={{ background: '#F4F7FE', borderRadius: 14, padding: 1, marginBottom: 12 }}>
                {columns.map((col, idx) => (
                  <div key={col.id} style={{
                    display: 'flex', alignItems: 'center', padding: '11px 12px', gap: 11,
                    background: '#fff', borderRadius: 13,
                    marginTop: idx > 0 ? 1 : 0,
                    borderTop: idx > 0 ? '0.5px solid rgba(9,87,247,.07)' : 'none',
                  }}>
                    <div style={{ width: 28, height: 28, borderRadius: 9, background: 'rgba(9,87,247,.1)', color: '#0055FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                      {col.name.startsWith('Unit ') ? `U${col.name.replace(/\D/g, '') || idx + 1}` : col.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#002080', letterSpacing: '-0.15px' }}>{col.name} avg</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#FF8800', letterSpacing: '-0.2px', padding: '7px 12px' }}>
                      {colAvgs[idx] > 0 ? colAvgs[idx].toFixed(1) : '—'}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px',
                background: 'linear-gradient(90deg, rgba(9,87,247,.06), rgba(9,87,247,.03))',
                borderRadius: 12,
                border: '0.5px solid rgba(9,87,247,.12)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#0055FF' }} />
                  Overall Avg
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.8px', lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 3, color: classAvgPct >= 70 ? '#00C853' : classAvgPct >= 50 ? '#FF8800' : '#FF3355' }}>
                  {classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'}
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#99AACC', letterSpacing: '-0.2px' }}>/ 100</span>
                </div>
              </div>
            </div>
          )}

          {/* AI Intelligence */}
          {!loading && filtered.length > 0 && columns.length > 0 && (
            <div
              className="gb-card3d"
              role="button"
              tabIndex={0}
              aria-label="Open detailed insights"
              onClick={() => navigate('/reports')}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
              style={{
                background: 'linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)',
                borderRadius: 24, padding: 20,
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 1px 2px rgba(0,8,60,.18), 0 12px 32px rgba(0,8,60,.3)',
              }}
            >
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)', pointerEvents: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12, position: 'relative', zIndex: 2 }}>
                <div style={{ width: 40, height: 40, borderRadius: 13, background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '0.5px solid rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFDD55', fontSize: 19 }}>⚡</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.95)', letterSpacing: '1.8px', textTransform: 'uppercase' }}>AI Gradebook Intelligence</div>
                <div style={{ marginLeft: 'auto', background: 'rgba(123,63,244,.3)', border: '0.5px solid rgba(155,95,255,.5)', color: '#DCC8FF', padding: '4px 10px', borderRadius: 100, fontSize: 9, fontWeight: 700, letterSpacing: '0.5px' }}>Insight</div>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,.85)', letterSpacing: '-0.15px', marginBottom: 14, position: 'relative', zIndex: 2 }}>
                Class average is <strong style={{ color: '#fff', fontWeight: 700 }}>{classAvgPct.toFixed(1)}%</strong> — in the <strong style={{ color: '#fff', fontWeight: 700 }}>{avgBand.label}</strong> band.
                {atRiskCount > 0
                  ? ` ${atRiskCount} student${atRiskCount === 1 ? '' : 's'} scored below 50 — schedule a `
                  : ' All students are on track — consider '}
                <strong style={{ color: '#fff', fontWeight: 700 }}>{atRiskCount > 0 ? 'remediation session' : 'enrichment activities'}</strong> before the next unit.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', background: 'rgba(255,255,255,.1)', borderRadius: 12, padding: 1, gap: 1, overflow: 'hidden', position: 'relative', zIndex: 2 }}>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '11px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#FF9AA9', letterSpacing: '-0.4px' }}>{lowest}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>Lowest</div>
                </div>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '11px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.4px' }}>{classAvgPct.toFixed(1)}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>Avg</div>
                </div>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '11px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#6FFFAA', letterSpacing: '-0.4px' }}>{highest}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>Highest</div>
                </div>
              </div>
            </div>
          )}


        </div>
      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div
        className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8"
        style={{ background: '#EEF4FF', minHeight: '100vh', fontVariantNumeric: 'tabular-nums' }}
      >
        <style>{`
          .gbd-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
          @media (hover:hover) { .gbd-card3d:hover { transform: translateY(-4px) scale(1.008); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); } }
          .gbd-card3d:active { transform: translateY(-1px) scale(.99); }
          .gbd-press { transition: all 0.3s ease; }
          .gbd-press:hover { transform: translateY(-1px); filter: brightness(1.05); }
          .gbd-press:active { transform: scale(.96); }
          .gbd-score-input { transition: all 0.3s ease; }
          .gbd-score-input:focus { background: #fff !important; border-color: #0055FF !important; box-shadow: 0 0 0 3px rgba(9,87,247,.14) !important; }
          .gbd-scroll::-webkit-scrollbar { display: none; }
          .gbd-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '32px 32px 48px' }}>

          {/* P2-1: listener-failure banner with one-tap retry */}
          {listenerError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
              padding: '12px 16px', borderRadius: 14,
              background: '#FFF5F5', border: '0.5px solid #FFD8D8',
            }}>
              <div style={{ flex: 1, fontSize: 13, color: '#C92A2A', fontWeight: 500, lineHeight: 1.5 }}>
                {listenerError}
              </div>
              <button
                type="button"
                onClick={() => { setListenerError(null); setRefreshKey(k => k + 1); }}
                style={{
                  padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: '#C92A2A', color: '#fff', fontSize: 12, fontWeight: 700,
                  fontFamily: 'inherit',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Header row: title + class picker */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: 2, background: '#0055FF', display: 'inline-block' }} />
                Teacher Dashboard · Gradebook
              </div>
              <h1 style={{ fontSize: 40, fontWeight: 700, color: '#001040', letterSpacing: '-1.4px', lineHeight: 1.05, margin: 0 }}>Gradebook</h1>
              <div style={{ fontSize: 14, color: '#5070B0', fontWeight: 500, marginTop: 8, letterSpacing: '-0.15px' }}>
                {selectedClass ? `Complete academic record for ${selectedClass.name}.` : 'Select a class to view gradebook.'}
              </div>
            </div>

            {/* Class picker */}
            <div style={{ position: 'relative', minWidth: 280 }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 18px', background: '#fff',
                  borderRadius: 14,
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 13, background: '#7B3FF4', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.3px', textTransform: 'uppercase', marginBottom: 2 }}>Viewing</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedClass ? selectedClass.name : (classes.length === 0 ? 'No classes' : 'Select class')}
                  </div>
                </div>
                <div style={{ color: '#99AACC', fontSize: 24, fontWeight: 400, lineHeight: 1, marginTop: -3 }}>›</div>
              </div>
              <select
                value={selectedClassId}
                onChange={e => setSelectedClassId(e.target.value)}
                aria-label="Select class"
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  opacity: 0, cursor: 'pointer', border: 'none', background: 'transparent',
                  appearance: 'none', WebkitAppearance: 'none',
                }}
              >
                {classes.length === 0 && <option value="">No classes available</option>}
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* HERO — Class Average */}
          <div
            className="gbd-card3d"
            role="button"
            tabIndex={0}
            aria-label="Open class report"
            onClick={() => navigate('/reports')}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
            style={{
              background: 'linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)',
              borderRadius: 28, padding: 32, marginBottom: 18,
              position: 'relative', overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(0,8,60,.15), 0 12px 32px rgba(0,8,60,.28)',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', zIndex: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <div style={{ width: 52, height: 52, borderRadius: 15, background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '0.5px solid rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.72)', letterSpacing: '1.8px', textTransform: 'uppercase' }}>Class Average</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 3, fontWeight: 500, letterSpacing: '-0.1px' }}>
                    {columns.length > 0 ? `${columns.length} ${columns.length === 1 ? 'unit' : 'units'} · ${selectedClass?.name || ''}` : 'No units yet'}
                  </div>
                </div>
                <div style={{
                  marginLeft: 'auto', width: 56, height: 56,
                  background: `linear-gradient(145deg, ${avgLetter.color}, ${avgLetter.color}DD)`,
                  color: '#fff', borderRadius: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, fontWeight: 700, letterSpacing: '-0.6px',
                  boxShadow: `0 1px 2px ${avgLetter.color}55, 0 8px 18px ${avgLetter.color}55, inset 0 1px 0 rgba(255,255,255,.25)`,
                }}>
                  {avgLetter.label}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 84, fontWeight: 700, color: '#fff', letterSpacing: '-3.8px', lineHeight: 1, marginBottom: 10, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    {classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'}
                    <span style={{ fontSize: 32, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '-0.6px' }}>/ 100</span>
                  </div>
                  <div style={{ fontSize: 14, color: 'rgba(255,255,255,.72)', fontWeight: 500, letterSpacing: '-0.15px' }}>
                    <b style={{ color: '#fff', fontWeight: 700 }}>{avgBand.label} performance</b>
                    {atRiskCount > 0 ? ` — ${atRiskCount} student${atRiskCount === 1 ? '' : 's'} need${atRiskCount === 1 ? 's' : ''} remediation.` : ' — all students on track.'}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'rgba(255,255,255,.1)', borderRadius: 14, padding: 1, overflow: 'hidden', minWidth: 380 }}>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: '-0.8px' }}>{filtered.length}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Students</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: '#6FFFAA', letterSpacing: '-0.8px' }}>{passingCount}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Passing</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: '#FF9AA9', letterSpacing: '-0.8px' }}>{atRiskCount}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>At Risk</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Legend + toolbar row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="gbd-scroll" style={{ flex: 1, minWidth: 280, display: 'flex', gap: 8, padding: '12px 14px', background: '#fff', borderRadius: 14, overflowX: 'auto', boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)' }}>
              {[
                { c: '#00C853', l: 'Excellent 90+' },
                { c: '#0055FF', l: 'Good 70–89' },
                { c: '#FF8800', l: 'Average 50–69' },
                { c: '#FF3355', l: 'At Risk <50' },
              ].map(item => (
                <div key={item.l} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#F4F7FE', borderRadius: 100, fontSize: 11, fontWeight: 700, color: '#002080', letterSpacing: '-0.1px', flexShrink: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.c }} />
                  {item.l}
                </div>
              ))}
            </div>
            <button
              type="button"
              aria-label="Export gradebook to Excel"
              onClick={handleExport}
              className="gbd-press"
              style={{ width: 44, height: 44, borderRadius: 12, background: '#fff', color: '#0055FF', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0.5px 1px rgba(9,87,247,.06), 0 2px 8px rgba(9,87,247,.08)' }}
            >
              <IcoDownload />
            </button>
            <button
              type="button"
              onClick={() => setShowAddCol(v => !v)}
              aria-expanded={showAddCol}
              className="gbd-press"
              style={{
                height: 44, padding: '0 18px', borderRadius: 12, background: '#0055FF',
                color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px',
                display: 'flex', alignItems: 'center', gap: 7, border: 'none',
                boxShadow: '0 1px 2px rgba(9,87,247,.2), 0 3px 8px rgba(9,87,247,.25)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Unit
            </button>
          </div>

          {/* Section head: title + search + save */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#001040', letterSpacing: '-0.4px' }}>Student Grades</span>
              <span style={{ fontSize: 13, color: '#5070B0', fontWeight: 600, letterSpacing: '-0.1px' }}>
                {filtered.length} student{filtered.length === 1 ? '' : 's'} · {columns.length} unit{columns.length === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ position: 'relative', width: 300 }}>
                <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#5070B0', pointerEvents: 'none' }}>
                  <IcoSearch />
                </div>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search student..."
                  style={{
                    width: '100%', padding: '11px 14px 11px 36px', borderRadius: 12,
                    border: 'none', background: '#fff',
                    fontSize: 13, color: '#001040', fontFamily: 'inherit', outline: 'none',
                    boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
                  }}
                />
              </div>
              <button
                type="button"
                aria-label={saving ? 'Saving grades' : 'Save grades'}
                onClick={handleSave}
                disabled={saving || !hasUnsaved}
                className="gbd-press"
                style={{
                  padding: '11px 18px', borderRadius: 12,
                  background: hasUnsaved ? '#00C853' : '#EAF0FB',
                  border: 'none',
                  color: hasUnsaved ? '#fff' : '#5070B0',
                  fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px',
                  cursor: hasUnsaved && !saving ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                  opacity: saving ? 0.7 : 1,
                  boxShadow: hasUnsaved ? '0 1px 2px rgba(0,200,83,.2), 0 3px 8px rgba(0,200,83,.25)' : 'none',
                }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <IcoCheck />}
                Save
              </button>
            </div>
          </div>

          {/* Activities section — Tests, Exams & Assignments for this class */}
          {selectedClassId && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#001040', letterSpacing: '-0.4px' }}>
                  Tests, Exams &amp; Assignments
                </span>
                <span style={{ fontSize: 13, color: '#5070B0', fontWeight: 600, letterSpacing: '-0.1px' }}>
                  {classTests.length + classAssignments.length} item{(classTests.length + classAssignments.length) === 1 ? '' : 's'}
                </span>
              </div>
              <div style={{ marginBottom: 22, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                <ActivitiesSection />
              </div>
              <div style={{ height: 1, background: 'rgba(9,87,247,.08)', margin: '4px 0 18px' }} />
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#001040', letterSpacing: '-0.4px' }}>Custom Units</span>
                <span style={{ fontSize: 13, color: '#5070B0', fontWeight: 600, letterSpacing: '-0.1px', marginLeft: 10 }}>
                  Gradebook columns you create yourself
                </span>
              </div>
            </>
          )}

          {/* Add column panel */}
          {showAddCol && (
            <div style={{
              background: '#fff',
              borderRadius: 18, padding: 20,
              display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
              border: '0.5px solid rgba(9,87,247,.1)',
              flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5070B0', letterSpacing: '1.3px', textTransform: 'uppercase', flexShrink: 0 }}>
                Add unit
              </div>
              <input
                type="text"
                value={newColName}
                onChange={e => setNewColName(e.target.value)}
                placeholder="Unit name (e.g. Unit 1, Quiz 1)"
                onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
                style={{
                  flex: 1, minWidth: 240, padding: '11px 14px', borderRadius: 11,
                  border: '0.5px solid rgba(9,87,247,.15)', background: '#F4F7FE',
                  fontSize: 14, color: '#001040', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <input
                type="number"
                value={newColMax}
                onChange={e => setNewColMax(e.target.value)}
                style={{
                  width: 110, padding: '11px 14px', borderRadius: 11,
                  border: '0.5px solid rgba(9,87,247,.15)', background: '#F4F7FE',
                  fontSize: 14, color: '#001040', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <span style={{ fontSize: 12, color: '#5070B0', fontWeight: 600 }}>max marks</span>
              <button
                type="button"
                onClick={handleAddColumn}
                className="gbd-press"
                style={{
                  padding: '11px 20px', borderRadius: 11, background: '#0055FF', border: 'none',
                  color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 1px 2px rgba(9,87,247,.2), 0 3px 8px rgba(9,87,247,.25)',
                }}
              >
                Add unit
              </button>
              <button
                type="button"
                onClick={() => { setShowAddCol(false); setNewColName(''); setNewColMax('100'); }}
                className="gbd-press"
                style={{
                  padding: '11px 18px', borderRadius: 11, background: '#F4F7FE',
                  border: 'none', color: '#5070B0',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Custom Units — same Excel-style table as the mobile view above.
           * Desktop has more horizontal room so the table renders in full
           * width without scroll most of the time. */}
          <div style={{ marginBottom: 18 }}>
            {renderCustomUnitsTable()}
          </div>

          {/* 2-column: Class Avg + AI Intelligence */}
          {!loading && filtered.length > 0 && columns.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>

              {/* Class Avg Card */}
              <div
                className="gbd-card3d"
                role="button"
                tabIndex={0}
                aria-label="Open detailed class report"
                onClick={() => navigate('/reports')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
                style={{
                  background: '#fff', borderRadius: 22, padding: 22,
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
                  border: '0.5px solid rgba(9,87,247,.1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: '#0055FF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#001040', letterSpacing: '-0.4px' }}>Class Average</div>
                    <div style={{ fontSize: 12, color: '#5070B0', fontWeight: 600, marginTop: 3, letterSpacing: '-0.1px' }}>Based on {filtered.length} students</div>
                  </div>
                  <div style={{
                    width: 52, height: 52, borderRadius: 16,
                    background: avgLetter.color, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26, fontWeight: 700,
                    boxShadow: `0 1px 2px ${avgLetter.color}40, 0 8px 18px ${avgLetter.color}55`,
                    position: 'relative',
                  }}>
                    <span style={{ position: 'absolute', inset: 0, borderRadius: 16, background: 'linear-gradient(145deg, rgba(255,255,255,.25), transparent 50%)' }} />
                    {avgLetter.label}
                  </div>
                </div>

                <div style={{ background: '#F4F7FE', borderRadius: 15, padding: 1, marginBottom: 14 }}>
                  {columns.map((col, idx) => (
                    <div key={col.id} style={{
                      display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 12,
                      background: '#fff', borderRadius: 14,
                      marginTop: idx > 0 ? 1 : 0,
                      borderTop: idx > 0 ? '0.5px solid rgba(9,87,247,.07)' : 'none',
                    }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(9,87,247,.1)', color: '#0055FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                        {col.name.startsWith('Unit ') ? `U${col.name.replace(/\D/g, '') || idx + 1}` : col.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#002080', letterSpacing: '-0.15px' }}>{col.name} avg</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#FF8800', letterSpacing: '-0.2px', padding: '8px 14px' }}>
                        {colAvgs[idx] > 0 ? colAvgs[idx].toFixed(1) : '—'}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px',
                  background: 'linear-gradient(90deg, rgba(9,87,247,.06), rgba(9,87,247,.03))',
                  borderRadius: 13,
                  border: '0.5px solid rgba(9,87,247,.12)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#5070B0', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0055FF' }} />
                    Overall Avg
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.9px', lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 4, color: classAvgPct >= 70 ? '#00C853' : classAvgPct >= 50 ? '#FF8800' : '#FF3355' }}>
                    {classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'}
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#99AACC', letterSpacing: '-0.2px' }}>/ 100</span>
                  </div>
                </div>
              </div>

              {/* AI Intelligence */}
              <div
                className="gbd-card3d"
                role="button"
                tabIndex={0}
                aria-label="Open detailed insights"
                onClick={() => navigate('/reports')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
                style={{
                  background: 'linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)',
                  borderRadius: 26, padding: 28,
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 1px 2px rgba(0,8,60,.18), 0 12px 32px rgba(0,8,60,.3)',
                }}
              >
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)', pointerEvents: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, position: 'relative', zIndex: 2 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '0.5px solid rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFDD55', fontSize: 22 }}>⚡</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.95)', letterSpacing: '1.9px', textTransform: 'uppercase' }}>AI Gradebook Intelligence</div>
                  <div style={{ marginLeft: 'auto', background: 'rgba(123,63,244,.3)', border: '0.5px solid rgba(155,95,255,.5)', color: '#DCC8FF', padding: '5px 11px', borderRadius: 100, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px' }}>Insight</div>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,.85)', letterSpacing: '-0.15px', marginBottom: 20, position: 'relative', zIndex: 2 }}>
                  Class average is <strong style={{ color: '#fff', fontWeight: 700 }}>{classAvgPct.toFixed(1)}%</strong> — in the <strong style={{ color: '#fff', fontWeight: 700 }}>{avgBand.label}</strong> band.
                  {atRiskCount > 0
                    ? ` ${atRiskCount} student${atRiskCount === 1 ? '' : 's'} scored below 50 — schedule a `
                    : ' All students are on track — consider '}
                  <strong style={{ color: '#fff', fontWeight: 700 }}>{atRiskCount > 0 ? 'remediation session' : 'enrichment activities'}</strong> before the next unit.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', background: 'rgba(255,255,255,.1)', borderRadius: 14, padding: 1, gap: 1, overflow: 'hidden', position: 'relative', zIndex: 2 }}>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#FF9AA9', letterSpacing: '-0.6px' }}>{lowest}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Lowest</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.6px' }}>{classAvgPct.toFixed(1)}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Avg</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#6FFFAA', letterSpacing: '-0.6px' }}>{highest}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Highest</div>
                  </div>
                </div>
              </div>

            </div>
          )}


        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
}
