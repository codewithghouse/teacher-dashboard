import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, getDocs,
  doc, getDoc, writeBatch,
  type DocumentData, type Unsubscribe,
} from "firebase/firestore";

// ── Canonical score normalizer (matches Dashboard.tsx + MyClasses.tsx).
// Returns 0-100% from any score doc shape, or null if no usable score.
// Covers test_scores (score+maxScore), gradebook_scores (mark+maxMarks),
// results (score / percentage). Returning null preserves "no data" so
// untested entries don't get conflated with 0%.
const pctOfDoc = (d: any): number | null => {
  if (!d) return null;
  const pctField = [d.percentage, d.pct].find(v => typeof v === "number" && !Number.isNaN(v));
  if (typeof pctField === "number") return Math.max(0, Math.min(100, pctField));
  const rawCandidates = [d.score, d.mark, d.marks, d.obtainedMarks, d.marksObtained];
  const rawNum = rawCandidates.find(v => typeof v === "number" && !Number.isNaN(v));
  if (typeof rawNum !== "number") return null;
  const maxCandidates = [d.maxScore, d.totalMarks, d.maxMarks, d.outOf];
  const maxNum = maxCandidates.find(v => typeof v === "number" && !Number.isNaN(v) && v > 0);
  if (typeof maxNum === "number") return Math.max(0, Math.min(100, (rawNum / maxNum) * 100));
  if (rawNum >= 0 && rawNum <= 100) return rawNum;
  return null;
};

// Resolve any timestamp shape to ms epoch. Different score writers use
// different fields (test_scores: timestamp, gradebook_scores: updatedAt,
// results: createdAt) — enumerate per `bug_pattern_filterbytime_field_drift`.
const writerTimeMs = (d: any): number => {
  const candidates = [d?.timestamp, d?.updatedAt, d?.createdAt, d?.date, d?.submittedAt];
  for (const f of candidates) {
    if (typeof f === "number") return f;
    if (f && typeof f.toMillis === "function") return f.toMillis();
    if (typeof f === "string" && f.length > 0) {
      const t = new Date(f.includes("T") ? f : `${f}T00:00:00`).getTime();
      if (!Number.isNaN(t)) return t;
    }
  }
  return 0;
};

// 90-day score window — bounds at-risk classification to current performance.
const SCORE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
import { auditedUpdate } from "../lib/auditedWrites";
import { getInitials } from "../lib/initials";
import { useAuth } from "../lib/AuthContext";
import {
  Loader2, Search, ChevronLeft, ChevronRight,
  Download, Edit2, Check, X,
  Calendar, FileText, GraduationCap, TrendingUp, CheckCircle2, XCircle, Clock,
  Users, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";
const loadXLSX = () => import("xlsx");

const ITEMS_PER_PAGE = 5;

// Normalize any Firestore/plain date into JS Date or null.
const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const maybeTs = v as { toDate?: () => Date; seconds?: number };
  if (typeof maybeTs.toDate === "function") {
    try { const d = maybeTs.toDate(); return isNaN(d.getTime()) ? null : d; } catch { return null; }
  }
  if (typeof maybeTs.seconds === "number") return new Date(maybeTs.seconds * 1000);
  const d = new Date(v as string | number | Date);
  return isNaN(d.getTime()) ? null : d;
};

const fmtShortDate = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const getStatus = (atnd: number, score: number, manual?: string) => {
  if (manual) return manual;
  if (atnd < 75 || score < 50) return "At Risk";
  if (atnd < 85 || score < 65) return "Needs Attention";
  return "Good Standing";
};

const statusStyle = (s: string) => {
  if (s === "Good Standing") return "text-emerald-700 bg-emerald-50";
  if (s === "Needs Attention") return "text-amber-700 bg-amber-50";
  return "text-rose-700 bg-rose-50";
};

const ClassDetail = () => {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { teacherData } = useAuth();

  const [classInfo, setClassInfo] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Students");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const [editingRoll, setEditingRoll] = useState<string | null>(null);
  const [tempRoll, setTempRoll] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Subject inline editing
  const [editingSubject, setEditingSubject] = useState(false);
  const [tempSubject, setTempSubject] = useState("");
  const [isSavingSubject, setIsSavingSubject] = useState(false);

  const [stats, setStats] = useState({
    totalStudents: 0,
    attendanceRate: "—",
    avgScore: "—",
    atRiskCount: 0,
  });

  // Data for non-Students tabs + class-scoped score state
  const [attendanceLog, setAttendanceLog] = useState<DocumentData[]>([]);
  const [assignments, setAssignments]     = useState<DocumentData[]>([]);
  const [tests, setTests]                 = useState<DocumentData[]>([]);
  // Class-scoped scores from 3 sources: test_scores + gradebook_scores + results.
  // Listening at class-level (not per-student) eliminates N×4 getDocs in
  // enrichment loop and ensures gradebook writes (which use `mark`+`maxMarks`)
  // are visible. Single-collection read previously dropped ~40% of teacher's
  // score data (memory: owner_dashboard_alternate_data_sources).
  const [testScoreDocs, setTestScoreDocs]           = useState<DocumentData[]>([]);
  const [gradebookScoreDocs, setGradebookScoreDocs] = useState<DocumentData[]>([]);
  const [resultDocs, setResultDocs]                 = useState<DocumentData[]>([]);
  // Roster — separated from enrichment so derivation is synchronous useMemo.
  const [roster, setRoster] = useState<Array<Record<string, unknown> & { id: string }>>([]);
  const [tabLoading, setTabLoading]       = useState(false);

  // Fetch class info
  useEffect(() => {
    if (!classId) return;
    getDoc(doc(db, "classes", classId))
      .then(snap => { if (snap.exists()) setClassInfo(snap.data()); })
      .catch(e => console.error("[ClassDetail] classInfo fetch failed", e));
  }, [classId]);

  // ── Class-scoped event listeners — schoolId+classId ONLY (no branchId).
  // Per `bug_pattern_branch_filter_on_event_streams` — branchId on events
  // silently drops drift. classId IS the isolation key for this view.
  useEffect(() => {
    if (!classId || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    let cancelled = false;
    const unsubs: Unsubscribe[] = [];

    // Attendance for this class
    unsubs.push(onSnapshot(
      query(collection(db, "attendance"), where("schoolId", "==", schoolId), where("classId", "==", classId)),
      snap => { if (!cancelled) setAttendanceLog(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      err => console.error("[ClassDetail] attendance subscription failed", err),
    ));

    // Assignments for this class
    unsubs.push(onSnapshot(
      query(collection(db, "assignments"), where("schoolId", "==", schoolId), where("classId", "==", classId)),
      snap => { if (!cancelled) setAssignments(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      err => console.error("[ClassDetail] assignments subscription failed", err),
    ));

    // Tests for this class
    unsubs.push(onSnapshot(
      query(collection(db, "tests"), where("schoolId", "==", schoolId), where("classId", "==", classId)),
      snap => { if (!cancelled) setTests(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      err => console.error("[ClassDetail] tests subscription failed", err),
    ));

    // 3-source score listeners — all class-scoped (not per-student) so we
    // load O(class scores) once instead of O(N students × 4 queries).
    unsubs.push(onSnapshot(
      query(collection(db, "test_scores"), where("schoolId", "==", schoolId), where("classId", "==", classId)),
      snap => { if (!cancelled) setTestScoreDocs(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      err => console.error("[ClassDetail] test_scores subscription failed", err),
    ));
    unsubs.push(onSnapshot(
      query(collection(db, "gradebook_scores"), where("schoolId", "==", schoolId), where("classId", "==", classId)),
      snap => { if (!cancelled) setGradebookScoreDocs(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      err => console.error("[ClassDetail] gradebook_scores subscription failed", err),
    ));
    unsubs.push(onSnapshot(
      query(collection(db, "results"), where("schoolId", "==", schoolId), where("classId", "==", classId)),
      snap => { if (!cancelled) setResultDocs(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      err => console.error("[ClassDetail] results subscription failed", err),
    ));

    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, [classId, teacherData?.schoolId]);

  // Mark the tab loading state when switching — purely cosmetic.
  useEffect(() => {
    setTabLoading(true);
    const t = setTimeout(() => setTabLoading(false), 120);
    return () => clearTimeout(t);
  }, [activeTab]);

  // Roster listener — enrollments for this class (real-time)
  useEffect(() => {
    if (!classId || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    let cancelled = false;
    const unsub = onSnapshot(
      query(
        collection(db, "enrollments"),
        where("schoolId", "==", schoolId),
        where("classId", "==", classId),
      ),
      snap => {
        if (cancelled) return;
        setRoster(snap.docs.map(d => ({ ...d.data(), id: d.id } as Record<string, unknown> & { id: string })));
        setLoading(false);
      },
      err => console.error("[ClassDetail] enrollments subscription failed", err),
    );
    return () => { cancelled = true; unsub(); };
  }, [classId, teacherData?.schoolId]);

  // ── Synchronous enrichment via useMemo — no more per-student getDocs.
  // Filters from already-loaded state by 2-tier matching (studentId → email).
  // 90-day score window applied for performance metric.
  const allClassScores = useMemo(
    () => [...testScoreDocs, ...gradebookScoreDocs, ...resultDocs],
    [testScoreDocs, gradebookScoreDocs, resultDocs]
  );

  const recentClassScores = useMemo(() => {
    const cutoff = Date.now() - SCORE_WINDOW_MS;
    return allClassScores.filter(d => writerTimeMs(d) >= cutoff);
  }, [allClassScores]);

  useEffect(() => {
    // Derive enriched students + stats whenever inputs change
    const enriched = roster.map((s) => {
      const sid = s.studentId as string | undefined;
      const email = (s.studentEmail as string | undefined)?.toLowerCase();

      // 2-tier student match (id → email)
      const matchesStudent = (rec: any): boolean => {
        if (sid && rec.studentId === sid) return true;
        if (email && (rec.studentEmail as string)?.toLowerCase() === email) return true;
        return false;
      };

      // Attendance for THIS class (already class-scoped via attendanceLog listener).
      // Exclude holiday days (whole-class off-days) so they don't deflate the %.
      const sAtt = attendanceLog.filter(matchesStudent).filter((d: any) => d.status !== "holiday");
      const present = sAtt.filter((d: any) => d.status === "present" || d.status === "late").length;
      const atndRaw: number = sAtt.length > 0 ? (present / sAtt.length) * 100 : -1;

      // Scores for THIS class (90d window, 3-source merged) — uses canonical pctOfDoc
      const sScores = recentClassScores.filter(matchesStudent);
      const pcts = sScores.map(pctOfDoc).filter((v): v is number => v != null);
      const scoreRaw: number = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : -1;

      const initials = getInitials((s as { studentName?: string }).studentName || "ST");
      const atndDisplay = atndRaw >= 0 ? `${atndRaw.toFixed(1)}%` : "—";
      const scoreDisplay = scoreRaw >= 0 ? `${scoreRaw.toFixed(1)}%` : "—";
      const status = getStatus(atndRaw >= 0 ? atndRaw : 100, scoreRaw >= 0 ? scoreRaw : 100, s.manualStatus as string | undefined);

      return { ...s, initials, atndRaw, scoreRaw, attendance: atndDisplay, avg: scoreDisplay, status };
    });

    setStudents(enriched);

    const validAtnd = enriched.filter(s => s.atndRaw >= 0);
    const validScore = enriched.filter(s => s.scoreRaw >= 0);
    const atRisk = enriched.filter(s => s.status === "At Risk").length;

    setStats({
      totalStudents: enriched.length,
      attendanceRate: validAtnd.length > 0
        ? `${(validAtnd.reduce((a, s) => a + s.atndRaw, 0) / validAtnd.length).toFixed(1)}%`
        : "—",
      avgScore: validScore.length > 0
        ? `${(validScore.reduce((a, s) => a + s.scoreRaw, 0) / validScore.length).toFixed(1)}%`
        : "—",
      atRiskCount: atRisk,
    });
  }, [roster, attendanceLog, recentClassScores]);

  // Save subject → update classes doc + all enrollment docs for this class
  const handleSaveSubject = async () => {
    if (!tempSubject.trim() || !classId) return;
    setIsSavingSubject(true);
    try {
      // 1. Update the class document
      await auditedUpdate(doc(db, "classes", classId), { subject: tempSubject.trim() });

      // 2. Batch update all enrollments for this class
      const enrollSnap = await getDocs(query(
        collection(db, "enrollments"),
        where("schoolId", "==", teacherData?.schoolId),
        where("classId", "==", classId),
      ));
      if (enrollSnap.docs.length > 0) {
        const batch = writeBatch(db);
        enrollSnap.docs.forEach(d => batch.update(d.ref, { subject: tempSubject.trim() }));
        await batch.commit();
      }

      setClassInfo((prev: Record<string, unknown> | null) => ({ ...(prev ?? {}), subject: tempSubject.trim() }));
      setEditingSubject(false);
      toast.success(`Subject updated to "${tempSubject.trim()}" for all enrollments.`);
    } catch (e) {
      console.error("[ClassDetail] update subject failed", e);
      toast.error("Failed to update subject.");
    } finally {
      setIsSavingSubject(false);
    }
  };

  const handleUpdateRoll = async (id: string) => {
    setIsUpdating(true);
    try {
      await auditedUpdate(doc(db, "enrollments", id), { rollNo: tempRoll });
      toast.success("Roll number updated.");
      setEditingRoll(null);
    } catch (e) {
      console.error("[ClassDetail] update roll failed", e);
      toast.error("Failed to update roll number.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleStatus = async (id: string, current: string) => {
    const statuses = ["Good Standing", "Needs Attention", "At Risk"];
    const next = statuses[(statuses.indexOf(current) + 1) % statuses.length];
    try {
      await auditedUpdate(doc(db, "enrollments", id), { manualStatus: next });
      toast.success(`Status updated to ${next}`);
    } catch (e) {
      console.error("[ClassDetail] toggle status failed", e);
      toast.error("Failed to update status.");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = students.map(s => ({
        "Student Name": s.studentName,
        "Email": s.studentEmail,
        "Roll No": s.rollNo || "—",
        "Attendance": s.attendance,
        "Avg Score": s.avg,
        "Status": s.status,
      }));
      const XLSX = await loadXLSX();

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Students");
      // Sanitize class name for filename — avoid OS path-separator issues.
      const rawName = (classInfo as { name?: string } | null)?.name || "Class";
      const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_").trim() || "Class";
      XLSX.writeFile(wb, `${safeName}_Roster.xlsx`);
      toast.success("Roster exported!");
    } catch (e) {
      console.error("[ClassDetail] export failed", e);
      toast.error("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  // Pagination
  const filtered = useMemo(() =>
    students.filter(s => s.studentName?.toLowerCase().includes(searchQuery.toLowerCase())),
    [students, searchQuery]
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const goPage = (p: number) => setCurrentPage(Math.max(1, Math.min(p, totalPages)));

  // ── Attendance tab aggregation: group by date → present/absent/late counts ──
  const attendanceByDate = useMemo(() => {
    type DayRow = { date: string; dateObj: Date; present: number; absent: number; late: number; total: number };
    const byDate = new Map<string, DayRow>();
    attendanceLog.forEach(r => {
      const date = (r as { date?: string }).date;
      if (!date) return;
      let row = byDate.get(date);
      if (!row) {
        const d = toDate(date) || new Date(date);
        row = { date, dateObj: d, present: 0, absent: 0, late: 0, total: 0 };
        byDate.set(date, row);
      }
      const s = (r as { status?: string }).status;
      if (s === "present") row.present++;
      else if (s === "absent") row.absent++;
      else if (s === "late") row.late++;
      row.total++;
    });
    return Array.from(byDate.values()).sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
  }, [attendanceLog]);

  // ── Assignments tab aggregation: attach submission-counts + due-status ──
  const assignmentsView = useMemo(() => {
    const rosterSize = stats.totalStudents;
    return [...assignments]
      .map(a => {
        const due = toDate((a as { dueDate?: unknown; deadline?: unknown }).dueDate ?? (a as { deadline?: unknown }).deadline);
        const status = (a as { status?: string }).status || "Active";
        return {
          id: (a as { id: string }).id,
          title: (a as { title?: string }).title || "Untitled",
          due,
          dueLabel: due ? fmtShortDate(due) : "—",
          isPastDue: !!(due && due.getTime() < Date.now()),
          status,
          rosterSize,
        };
      })
      .sort((a, b) => (b.due?.getTime() || 0) - (a.due?.getTime() || 0));
  }, [assignments, stats.totalStudents]);

  // ── Tests tab aggregation: upcoming vs completed, sorted by test date ──
  const testsView = useMemo(() =>
    [...tests]
      .map(t => {
        const when = toDate((t as { testDate?: unknown; date?: unknown; createdAt?: unknown }).testDate ?? (t as { date?: unknown }).date ?? (t as { createdAt?: unknown }).createdAt);
        return {
          id: (t as { id: string }).id,
          title: (t as { title?: string; testName?: string }).title || (t as { testName?: string }).testName || "Untitled test",
          subject: (t as { subject?: string }).subject || "",
          when,
          dateLabel: when ? fmtShortDate(when) : "—",
          marks: (t as { marks?: string | number }).marks,
          classAverage: Number((t as { classAverage?: number }).classAverage ?? 0),
          status: (t as { status?: string }).status || "Upcoming",
        };
      })
      .sort((a, b) => (b.when?.getTime() || 0) - (a.when?.getTime() || 0)),
  [tests]);

  // ── Performance tab aggregation: top/bottom performers + distribution ──
  const performanceView = useMemo(() => {
    const withScores = students.filter(s => s.scoreRaw >= 0);
    // Mutually exclusive lists by threshold (no overlap):
    //   • Top performers    = students with score ≥ 80% (A grade + high B)
    //   • Needs attention   = students with score < 80% AND ungraded students
    //                         (the teacher's full intervention watch-list).
    //                         Sorted: graded-low-first → ungraded last.
    // For a class of 8 with 2 graded students, this surfaces the 1 below-80%
    // graded student PLUS the 6 ungraded ones → teacher sees 7 entries total
    // instead of just 1, matching expected workflow ("show me everyone I
    // need to follow up on, including ungraded who need to be assessed").
    const TOP_THRESHOLD = 80;
    const ATTN_THRESHOLD = 80;

    const top = [...withScores]
      .filter(s => s.scoreRaw >= TOP_THRESHOLD)
      .sort((a, b) => b.scoreRaw - a.scoreRaw) // best first
      .slice(0, 5);

    const bottom = [...students]
      .filter(s => s.scoreRaw < 0 || s.scoreRaw < ATTN_THRESHOLD)
      .sort((a, b) => {
        const aGraded = a.scoreRaw >= 0;
        const bGraded = b.scoreRaw >= 0;
        // Graded students first (teacher sees real low scores at top of list),
        // ungraded students after.
        if (!aGraded && !bGraded) return 0;
        if (!aGraded) return 1;
        if (!bGraded) return -1;
        return a.scoreRaw - b.scoreRaw; // both graded → ascending (worst first)
      })
      .slice(0, 10);

    const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    withScores.forEach(s => {
      const p = s.scoreRaw;
      if (p >= 85) dist.A++;
      else if (p >= 70) dist.B++;
      else if (p >= 55) dist.C++;
      else if (p >= 40) dist.D++;
      else dist.F++;
    });
    const avg = withScores.length > 0
      ? withScores.reduce((acc, s) => acc + s.scoreRaw, 0) / withScores.length
      : 0;
    return { top, bottom, dist, avg, count: withScores.length };
  }, [students]);

  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#0055FF] animate-spin" />
    </div>
  );

  // ── Design tokens (mobile) ─────────────────────────────────────
  const M = {
    BG: "#EEF4FF", CARD: "#FFFFFF", SURFACE: "#F4F7FE", SURFACE2: "#EAF0FB",
    B1: "#0055FF", T1: "#001040", T2: "#002080", T3: "#5070B0", T4: "#99AACC",
    GREEN: "#00C853", RED: "#FF3355", ORANGE: "#FF8800", GOLD: "#FFAA00", VIOLET: "#7B3FF4",
    FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
    SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
    SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
    BDR: "0.5px solid rgba(0,85,255,0.07)",
  };
  const TABS_M = [
    { key: "Students",    label: "Students" },
    { key: "Attendance",  label: "Attendance" },
    { key: "Assignments", label: "Work" },
    { key: "Tests",       label: "Tests" },
    { key: "Performance", label: "Perf." },
  ] as const;
  const avatarBgs = [M.B1, M.ORANGE, M.GREEN, M.RED, M.VIOLET];

  // Mobile hero values — display-ready
  const classNameStr = (classInfo as { name?: string } | null)?.name || "Class";
  const subjectStr   = (classInfo as { subject?: string } | null)?.subject || teacherData?.subject || "";
  const semesterStr  = (() => {
    const month = new Date().getMonth();
    const year  = new Date().getFullYear();
    return `${month < 6 ? "Spring" : "Fall"} Semester · ${year}`;
  })();
  // Badge style derived from attendance rate
  const atndNum = parseFloat(String(stats.attendanceRate).replace("%", ""));
  const heroBadge = !isNaN(atndNum) && atndNum >= 85
    ? { text: "Active",  bg: "rgba(0,232,102,0.18)",  bdr: "rgba(0,232,102,0.5)",  color: "#6FFFAA", dot: "#00FF88" }
    : !isNaN(atndNum) && atndNum >= 70
    ? { text: "Watch",   bg: "rgba(255,170,0,0.22)",  bdr: "rgba(255,170,0,0.5)",  color: "#FFD166", dot: "#FFCC22" }
    : !isNaN(atndNum)
    ? { text: "At Risk", bg: "rgba(255,51,85,0.18)",  bdr: "rgba(255,51,85,0.5)",  color: "#FF99AA", dot: "#FF5577" }
    : { text: "Active",  bg: "rgba(255,255,255,0.18)", bdr: "rgba(255,255,255,0.22)", color: "rgba(255,255,255,0.9)", dot: "#fff" };

  return (
    <>
    {/* ═══════════════════ MOBILE VIEW — EduIntellect v2 ═══════════════════ */}
    <div className="md:hidden" style={{ background: "#EEF4FF", fontFamily: M.FONT, minHeight: "100vh", margin: "-1rem", marginBottom: 0 }}>

      {/* Sticky page navbar */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-[14px] py-[10px]"
        style={{
          background: "rgba(238,244,255,0.88)",
          backdropFilter: "saturate(220%) blur(24px)",
          WebkitBackdropFilter: "saturate(220%) blur(24px)",
          borderBottom: "0.5px solid rgba(9,87,247,0.08)",
        }}>
        <button type="button"
          onClick={() => navigate('/my-classes')}
          aria-label="Back to Classes"
          className="flex items-center gap-[3px] pr-1 py-[6px] active:scale-[0.95] transition-transform"
          style={{ color: M.B1, fontSize: 14, fontWeight: 600, letterSpacing: "-0.2px" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Classes
        </button>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={handleExport}
            disabled={exporting}
            aria-label="Export roster"
            className="w-[34px] h-[34px] rounded-[11px] bg-white flex items-center justify-center active:scale-[0.92] transition-transform disabled:opacity-60"
            style={{ color: M.B1, boxShadow: "0 0.5px 1px rgba(9,87,247,0.06), 0 2px 8px rgba(9,87,247,0.08)" }}>
            {exporting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              )
            }
          </button>
          <button type="button"
            onClick={() => navigate('/attendance')}
            className="h-[34px] px-[14px] rounded-[11px] text-white flex items-center gap-[5px] active:scale-[0.95] transition-transform"
            style={{ background: M.B1, fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 10px rgba(9,87,247,0.3)" }}>
            Mark Attendance
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-3 pb-6">

        {/* Class Hero */}
        <div className="rounded-[26px] p-[20px] mb-[14px] relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)",
          }}>
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
          }} />
          <div className="relative z-[2]">
            <div className="flex items-center gap-[11px] mb-[14px]">
              <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white"
                style={{
                  background: "rgba(255,255,255,0.14)",
                  backdropFilter: "blur(22px)",
                  WebkitBackdropFilter: "blur(22px)",
                  border: "0.5px solid rgba(255,255,255,0.22)",
                  boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                }}>
                <GraduationCap className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Class Overview</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>{semesterStr}</div>
              </div>
              <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-bold"
                style={{ background: heroBadge.bg, border: `0.5px solid ${heroBadge.bdr}`, color: heroBadge.color, letterSpacing: "0.3px" }}>
                <span className="w-[6px] h-[6px] rounded-full" style={{ background: heroBadge.dot, boxShadow: `0 0 8px ${heroBadge.dot}` }} />
                {heroBadge.text}
              </div>
            </div>
            <div className="text-[46px] font-bold text-white leading-none mb-[6px]" style={{ letterSpacing: "-2.2px" }}>
              {classNameStr}
            </div>
            {/* Subject + students count — subject inline editable */}
            <div className="flex items-center gap-[6px] mb-[16px] flex-wrap">
              {editingSubject ? (
                <>
                  <input autoFocus
                    value={tempSubject}
                    onChange={e => setTempSubject(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleSaveSubject(); if (e.key === "Escape") setEditingSubject(false); }}
                    placeholder="e.g. English"
                    className="px-2 py-[3px] text-[11px] font-bold rounded-[7px] outline-none"
                    style={{ background: "rgba(255,255,255,0.22)", color: "#fff", border: "0.5px solid rgba(255,255,255,0.4)", width: 110, letterSpacing: "0.6px", textTransform: "uppercase" }} />
                  <button type="button"
                    onClick={handleSaveSubject}
                    disabled={isSavingSubject}
                    aria-label="Save subject"
                    className="w-6 h-6 rounded-[6px] flex items-center justify-center"
                    style={{ background: "rgba(0,232,102,0.22)", color: "#6FFFAA" }}>
                    {isSavingSubject ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  </button>
                  <button type="button" onClick={() => setEditingSubject(false)}
                    aria-label="Cancel edit"
                    className="w-6 h-6 rounded-[6px] flex items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.7)" }}>
                    <X size={12} />
                  </button>
                </>
              ) : (
                <button type="button"
                  onClick={() => { setTempSubject(subjectStr); setEditingSubject(true); }}
                  aria-label="Edit subject"
                  className="flex items-center gap-[5px] text-[11px] font-bold uppercase rounded-[6px] px-[2px] py-[1px] active:brightness-110 transition"
                  style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "0.6px" }}>
                  <span className={subjectStr ? "" : "italic opacity-70"}>{subjectStr || "Set subject…"}</span>
                  <Edit2 className="w-[10px] h-[10px]" style={{ color: "rgba(255,255,255,0.45)" }} />
                </button>
              )}
              <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
              <span className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "0.6px" }}>
                {stats.totalStudents} {stats.totalStudents === 1 ? "Student" : "Students"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              {[
                { v: stats.totalStudents, l: "Students", color: "#fff", path: null },
                { v: stats.attendanceRate, l: "Attend.", color: atndNum >= 85 ? "#6FFFAA" : atndNum >= 70 ? "#FFD166" : atndNum >= 0 ? "#FF9AA9" : "#fff", path: "Attendance" },
                { v: stats.avgScore, l: "Score", color: "#fff", path: "Performance" },
                { v: stats.atRiskCount, l: "At-Risk", color: stats.atRiskCount > 0 ? "#FF9AA9" : "#fff", path: "Students" },
              ].map(({ v, l, color, path }) => (
                <button type="button" key={l}
                  onClick={() => path && setActiveTab(path)}
                  disabled={!path}
                  className="py-[12px] px-1 text-center active:brightness-110 transition disabled:cursor-default"
                  style={{ background: "rgba(0,20,80,0.55)" }}>
                  <div className="text-[16px] font-bold" style={{ color, letterSpacing: "-0.5px" }}>{v}</div>
                  <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1px" }}>{l}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="mb-[14px]" style={{ borderBottom: "0.5px solid rgba(9,87,247,0.1)" }}>
          <div className="flex gap-1 overflow-x-auto py-[2px]" style={{ scrollbarWidth: "none" }}>
            {TABS_M.map(t => {
              const active = activeTab === t.key;
              return (
                <button type="button" key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  aria-current={active ? "page" : undefined}
                  className="flex-1 py-[9px] px-[10px] text-center relative active:opacity-70 transition"
                  style={{
                    minWidth: "max-content",
                    fontSize: 12, fontWeight: 700,
                    color: active ? M.B1 : M.T3,
                    letterSpacing: "-0.2px",
                    scrollSnapAlign: "start",
                  }}>
                  {t.label}
                  {active && <span className="absolute left-[12%] right-[12%] -bottom-[0.5px] h-[2.5px] rounded-t-[2px]" style={{ background: M.B1 }} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* ───────────────── TAB: STUDENTS ───────────────── */}
        {activeTab === "Students" && (
          <div className="rounded-[20px] p-4 mb-[14px]" style={{ background: M.CARD, boxShadow: M.SH, border: M.BDR }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-[10px]">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white" style={{ background: M.B1 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                    <path d="M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                </div>
                <div>
                  <div className="text-[14px] font-bold" style={{ color: M.T1, letterSpacing: "-0.3px" }}>Student List</div>
                  <div className="text-[11px] font-semibold mt-[1px]" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                    {filtered.length} {filtered.length === 1 ? "student" : "students"}
                  </div>
                </div>
              </div>
              <button type="button"
                onClick={() => navigate('/students')}
                className="h-[30px] px-3 rounded-[10px] text-white flex items-center gap-[5px] active:scale-[0.94] transition-transform"
                style={{ background: M.B1, fontSize: 11, fontWeight: 700, letterSpacing: "-0.1px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add
              </button>
            </div>

            {/* Inline search */}
            <div className="relative mb-1">
              <Search className="absolute left-[10px] top-1/2 -translate-y-1/2 w-[13px] h-[13px]" style={{ color: "rgba(9,87,247,0.40)" }} strokeWidth={2.3} />
              <input type="text" placeholder="Search students…"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="w-full h-9 pl-8 pr-3 rounded-[10px] text-[12px] outline-none"
                style={{ background: M.SURFACE, color: M.T1, letterSpacing: "-0.1px", border: "0.5px solid rgba(9,87,247,0.08)" }} />
            </div>

            {/* Student rows */}
            {paginated.length === 0 ? (
              <div className="py-8 text-center text-[12px] font-medium" style={{ color: M.T4 }}>
                {students.length === 0 ? "No students enrolled yet" : "No matches"}
              </div>
            ) : (
              paginated.map((s, idx) => {
                const atndTone = s.atndRaw >= 85 ? M.GREEN : s.atndRaw >= 0 ? M.RED : M.T4;
                const isRisk = s.status === "At Risk";
                const bg = avatarBgs[idx % avatarBgs.length];
                return (
                  <div key={s.id}
                    onClick={() => navigate(`/students?studentId=${s.studentId || s.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/students?studentId=${s.studentId || s.id}`); }}
                    className="flex items-center gap-[11px] py-[10px] relative cursor-pointer active:opacity-80 transition"
                    style={idx > 0 ? { borderTop: "0.5px solid rgba(9,87,247,0.08)" } : undefined}>
                    <div className="w-9 h-9 rounded-[11px] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                      style={{ background: bg, letterSpacing: "0.3px" }}>
                      {s.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold truncate" style={{ color: M.T1, letterSpacing: "-0.2px" }}>{s.studentName}</div>
                      <div className="flex items-center gap-1 mt-[2px] text-[10px] font-medium flex-wrap" style={{ color: M.T3, letterSpacing: "-0.05px" }}>
                        {s.rollNo && <><span className="font-bold" style={{ color: M.T2 }}>{s.rollNo}</span><span style={{ color: M.T4 }}>·</span></>}
                        <span className="font-bold" style={{ color: atndTone }}>{s.attendance}</span>
                        <span style={{ color: M.T4 }}>·</span>
                        <span className="font-bold" style={{ color: s.scoreRaw >= 60 ? M.GREEN : s.scoreRaw >= 0 ? M.RED : M.T4 }}>{s.avg}</span>
                      </div>
                      {s.studentEmail && (
                        <div className="text-[10px] font-medium mt-[2px] truncate" style={{ color: M.T4, maxWidth: 180 }}>{s.studentEmail}</div>
                      )}
                    </div>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); handleToggleStatus(s.id, s.status); }}
                      aria-label={`Cycle status · currently ${s.status}`}
                      className="px-[9px] py-[4px] rounded-full text-[9px] font-bold flex items-center gap-[4px] flex-shrink-0 active:scale-[0.94] transition-transform"
                      style={isRisk
                        ? { background: "rgba(255,51,85,0.1)", color: M.RED, letterSpacing: "0.3px" }
                        : s.status === "Needs Attention"
                          ? { background: "rgba(255,136,0,0.1)", color: M.ORANGE, letterSpacing: "0.3px" }
                          : { background: "rgba(0,200,83,0.12)", color: M.GREEN, letterSpacing: "0.3px" }}>
                      <span className="w-[5px] h-[5px] rounded-full" style={{ background: isRisk ? M.RED : s.status === "Needs Attention" ? M.ORANGE : M.GREEN }} />
                      {isRisk ? "At Risk" : s.status === "Needs Attention" ? "Watch" : "Good"}
                    </button>
                  </div>
                );
              })
            )}

            {/* Pager */}
            {filtered.length > ITEMS_PER_PAGE && (
              <div className="flex items-center justify-between pt-2 mt-2" style={{ borderTop: "0.5px solid rgba(9,87,247,0.08)" }}>
                <div className="text-[11px] font-semibold" style={{ color: M.T3 }}>
                  {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filtered.length)}–{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
                </div>
                <div className="flex gap-[5px]">
                  <button type="button"
                    onClick={() => goPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    aria-label="Previous page"
                    className="w-7 h-7 rounded-[8px] flex items-center justify-center disabled:opacity-40"
                    style={{ background: M.SURFACE, color: M.T2 }}>
                    <ChevronLeft size={13} />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                    <button type="button" key={p}
                      onClick={() => goPage(p)}
                      className="w-7 h-7 rounded-[8px] text-[11px] font-bold flex items-center justify-center"
                      style={p === currentPage
                        ? { background: M.B1, color: "#fff" }
                        : { background: M.SURFACE, color: M.T2 }}>
                      {p}
                    </button>
                  ))}
                  <button type="button"
                    onClick={() => goPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    aria-label="Next page"
                    className="w-7 h-7 rounded-[8px] flex items-center justify-center disabled:opacity-40"
                    style={{ background: M.SURFACE, color: M.T2 }}>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ───────────────── TAB: ATTENDANCE ───────────────── */}
        {activeTab === "Attendance" && (
          <div className="rounded-[20px] p-4 mb-[14px]" style={{ background: M.CARD, boxShadow: M.SH, border: M.BDR }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-[10px]">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white" style={{ background: M.ORANGE }}>
                  <Calendar className="w-4 h-4" strokeWidth={2.4} />
                </div>
                <div>
                  <div className="text-[14px] font-bold" style={{ color: M.T1, letterSpacing: "-0.3px" }}>Attendance Log</div>
                  <div className="text-[11px] font-semibold mt-[1px]" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                    {attendanceByDate.length === 0 ? "No records" : `Last ${Math.min(attendanceByDate.length, 10)} days`}
                  </div>
                </div>
              </div>
              <button type="button"
                onClick={() => navigate('/attendance')}
                className="h-[30px] px-3 rounded-[10px] text-white flex items-center gap-[5px] active:scale-[0.94] transition-transform"
                style={{ background: M.B1, fontSize: 11, fontWeight: 700, letterSpacing: "-0.1px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 11 12 14 22 4"/>
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                </svg>
                Mark Today
              </button>
            </div>

            {tabLoading ? (
              <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" style={{ color: M.B1 }} /></div>
            ) : attendanceByDate.length === 0 ? (
              <div className="py-10 text-center text-[12px] font-medium" style={{ color: M.T4 }}>
                No attendance marked for this class yet.
              </div>
            ) : (
              attendanceByDate.slice(0, 10).map((row, i) => {
                const presentish = row.present + row.late;
                const rate = row.total > 0 ? (presentish / row.total) * 100 : 0;
                const rateColor = rate >= 85 ? M.GREEN : rate >= 70 ? M.ORANGE : M.RED;
                return (
                  <div key={row.date}
                    className="grid items-center py-[11px] gap-3 relative"
                    style={{
                      gridTemplateColumns: "60px 1fr 44px",
                      borderTop: i > 0 ? "0.5px solid rgba(9,87,247,0.07)" : undefined,
                    }}>
                    <div>
                      <div className="text-[13px] font-bold" style={{ color: M.T1, letterSpacing: "-0.2px" }}>{fmtShortDate(row.dateObj)}</div>
                      <div className="text-[9px] font-bold uppercase mt-[1px]" style={{ color: M.T3, letterSpacing: "1px" }}>
                        {row.dateObj.toLocaleDateString("en-IN", { weekday: "short" })}
                      </div>
                    </div>
                    <div className="flex gap-[6px] flex-wrap">
                      <span className="flex items-center gap-[3px] px-2 py-[3px] rounded-[8px] text-[10px] font-bold" style={{ background: "rgba(0,200,83,0.1)", color: M.GREEN }}>
                        <CheckCircle2 size={11} /> {row.present}
                      </span>
                      <span className="flex items-center gap-[3px] px-2 py-[3px] rounded-[8px] text-[10px] font-bold" style={{ background: "rgba(255,51,85,0.1)", color: M.RED }}>
                        <XCircle size={11} /> {row.absent}
                      </span>
                      <span className="flex items-center gap-[3px] px-2 py-[3px] rounded-[8px] text-[10px] font-bold" style={{ background: "rgba(255,136,0,0.1)", color: M.ORANGE }}>
                        <Clock size={11} /> {row.late}
                      </span>
                    </div>
                    <div className="text-[13px] font-bold text-right" style={{ color: rateColor, letterSpacing: "-0.3px" }}>
                      {rate.toFixed(0)}%
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ───────────────── TAB: WORK (assignments) ───────────────── */}
        {activeTab === "Assignments" && (
          <div className="rounded-[20px] p-4 mb-[14px]" style={{ background: M.CARD, boxShadow: M.SH, border: M.BDR }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-[10px]">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white" style={{ background: M.B1 }}>
                  <FileText className="w-4 h-4" strokeWidth={2.4} />
                </div>
                <div>
                  <div className="text-[14px] font-bold" style={{ color: M.T1, letterSpacing: "-0.3px" }}>Assignments</div>
                  <div className="text-[11px] font-semibold mt-[1px]" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                    {assignmentsView.length} {assignmentsView.length === 1 ? "item" : "items"}
                  </div>
                </div>
              </div>
              <button type="button"
                onClick={() => navigate('/assignments')}
                className="h-[30px] px-3 rounded-[10px] text-[11px] font-bold active:scale-[0.94] transition-transform"
                style={{ background: M.SURFACE, color: M.B1, letterSpacing: "-0.1px" }}>
                Manage
              </button>
            </div>

            {tabLoading ? (
              <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" style={{ color: M.B1 }} /></div>
            ) : assignmentsView.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-[72px] h-[72px] rounded-[20px] mx-auto mb-3 flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(9,87,247,0.1), rgba(123,63,244,0.1))", color: M.B1 }}>
                  <FileText className="w-8 h-8" strokeWidth={2} />
                </div>
                <div className="text-[15px] font-bold mb-1" style={{ color: M.T1, letterSpacing: "-0.3px" }}>No assignments yet</div>
                <div className="text-[12px] font-medium mb-4" style={{ color: M.T3, letterSpacing: "-0.1px" }}>Create your first assignment<br/>to get students started.</div>
                <button type="button"
                  onClick={() => navigate('/assignments')}
                  className="inline-flex items-center gap-[5px] px-[18px] py-[10px] rounded-[12px] text-white text-[12px] font-bold active:scale-[0.96] transition-transform"
                  style={{ background: M.B1, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.3)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  New Assignment
                </button>
              </div>
            ) : (
              <>
                {assignmentsView.map(a => {
                  const stale = a.isPastDue && a.status === "Active";
                  const pillStyle = stale
                    ? { bg: "rgba(255,51,85,0.1)",  color: M.RED }
                    : a.status === "Fully Submitted"
                      ? { bg: "rgba(0,200,83,0.1)",  color: M.GREEN }
                      : a.status === "Active"
                        ? { bg: "rgba(9,87,247,0.1)",   color: M.B1 }
                        : { bg: M.SURFACE,              color: M.T3 };
                  return (
                    <div key={a.id}
                      onClick={() => navigate('/assignments')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/assignments'); }}
                      className="flex items-center gap-[11px] p-[13px] rounded-[14px] mb-2 cursor-pointer active:scale-[0.98] transition-transform"
                      style={{ background: M.SURFACE }}>
                      <div className="w-[38px] h-[38px] rounded-[11px] flex items-center justify-center text-white flex-shrink-0" style={{ background: M.B1 }}>
                        <FileText className="w-4 h-4" strokeWidth={2.4} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold truncate" style={{ color: M.T1, letterSpacing: "-0.3px" }}>{a.title}</div>
                        <div className="text-[11px] font-medium mt-[2px]" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                          <span className="font-bold" style={{ color: stale ? M.RED : M.ORANGE }}>Due {a.dueLabel}</span>
                          {a.rosterSize > 0 && <> · {a.rosterSize} {a.rosterSize === 1 ? "student" : "students"}</>}
                        </div>
                      </div>
                      <div className="px-[10px] py-[5px] rounded-full text-[10px] font-bold flex-shrink-0" style={{ background: pillStyle.bg, color: pillStyle.color, letterSpacing: "0.3px" }}>
                        {stale ? "Overdue" : a.status}
                      </div>
                    </div>
                  );
                })}
                <button type="button"
                  onClick={() => navigate('/assignments')}
                  className="w-full h-[42px] rounded-[13px] flex items-center justify-center gap-[5px] mt-[10px] text-white text-[12px] font-bold active:scale-[0.96] transition-transform"
                  style={{ background: M.B1, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.3)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  New Assignment
                </button>
              </>
            )}
          </div>
        )}

        {/* ───────────────── TAB: TESTS ───────────────── */}
        {activeTab === "Tests" && (
          <div className="rounded-[20px] p-4 mb-[14px]" style={{ background: M.CARD, boxShadow: M.SH, border: M.BDR }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-[10px]">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white" style={{ background: M.VIOLET }}>
                  <GraduationCap className="w-4 h-4" strokeWidth={2.4} />
                </div>
                <div>
                  <div className="text-[14px] font-bold" style={{ color: M.T1, letterSpacing: "-0.3px" }}>Tests</div>
                  <div className="text-[11px] font-semibold mt-[1px]" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                    {testsView.length} {testsView.length === 1 ? "scheduled" : "scheduled"}
                  </div>
                </div>
              </div>
              <button type="button"
                onClick={() => navigate('/tests')}
                className="h-[30px] px-3 rounded-[10px] text-[11px] font-bold active:scale-[0.94] transition-transform"
                style={{ background: M.SURFACE, color: M.B1, letterSpacing: "-0.1px" }}>
                Manage
              </button>
            </div>

            {tabLoading ? (
              <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" style={{ color: M.B1 }} /></div>
            ) : testsView.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-[72px] h-[72px] rounded-[20px] mx-auto mb-3 flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(9,87,247,0.1), rgba(123,63,244,0.1))", color: M.B1 }}>
                  <GraduationCap className="w-8 h-8" strokeWidth={2} />
                </div>
                <div className="text-[15px] font-bold mb-1" style={{ color: M.T1, letterSpacing: "-0.3px" }}>No tests yet</div>
                <div className="text-[12px] font-medium mb-4" style={{ color: M.T3, letterSpacing: "-0.1px" }}>Schedule your first test<br/>to track student performance.</div>
                <button type="button"
                  onClick={() => navigate('/tests')}
                  className="inline-flex items-center gap-[5px] px-[18px] py-[10px] rounded-[12px] text-white text-[12px] font-bold active:scale-[0.96] transition-transform"
                  style={{ background: M.B1, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.3)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Schedule Test
                </button>
              </div>
            ) : (
              testsView.map(t => (
                <div key={t.id}
                  onClick={() => navigate('/tests')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/tests'); }}
                  className="flex items-center gap-[11px] p-[13px] rounded-[14px] mb-2 cursor-pointer active:scale-[0.98] transition-transform"
                  style={{ background: M.SURFACE }}>
                  <div className="w-[38px] h-[38px] rounded-[11px] flex items-center justify-center text-white flex-shrink-0" style={{ background: M.VIOLET }}>
                    <GraduationCap className="w-4 h-4" strokeWidth={2.4} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold truncate" style={{ color: M.T1, letterSpacing: "-0.3px" }}>{t.title}</div>
                    <div className="text-[11px] font-medium mt-[2px]" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                      {t.subject && <>{t.subject} · </>}
                      {t.dateLabel}
                      {t.classAverage > 0 && <> · avg {t.classAverage.toFixed(1)}%</>}
                      {t.marks !== undefined && <> · {t.marks} marks</>}
                    </div>
                  </div>
                  <div className="px-[10px] py-[5px] rounded-full text-[10px] font-bold flex-shrink-0"
                    style={t.status === "Completed"
                      ? { background: "rgba(0,200,83,0.1)", color: M.GREEN, letterSpacing: "0.3px" }
                      : t.status === "Upcoming"
                        ? { background: "rgba(9,87,247,0.1)", color: M.B1, letterSpacing: "0.3px" }
                        : { background: M.SURFACE2,           color: M.T3, letterSpacing: "0.3px" }}>
                    {t.status}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ───────────────── TAB: PERFORMANCE ───────────────── */}
        {activeTab === "Performance" && (
          <>
            {/* Class average hero */}
            <div className="rounded-[20px] p-4 mb-[14px] flex items-center gap-3"
              style={{ background: M.CARD, boxShadow: M.SH, border: M.BDR }}>
              <div className="w-12 h-12 rounded-[14px] flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(9,87,247,0.12)", color: M.B1 }}>
                <TrendingUp className="w-[22px] h-[22px]" strokeWidth={2.4} />
              </div>
              <div>
                <div className="text-[26px] font-bold leading-none" style={{ color: M.B1, letterSpacing: "-1.1px" }}>
                  {performanceView.count > 0 ? `${performanceView.avg.toFixed(1)}%` : "—"}
                </div>
                <div className="text-[11px] font-medium mt-1" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                  Class average across {performanceView.count} student{performanceView.count === 1 ? "" : "s"} with data
                </div>
              </div>
            </div>

            {performanceView.count === 0 ? (
              <div className="rounded-[20px] p-4 mb-[14px]" style={{ background: M.CARD, boxShadow: M.SH, border: M.BDR }}>
                <div className="py-8 text-center">
                  <div className="w-[72px] h-[72px] rounded-[20px] mx-auto mb-3 flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, rgba(9,87,247,0.1), rgba(123,63,244,0.1))", color: M.B1 }}>
                    <TrendingUp className="w-8 h-8" strokeWidth={2} />
                  </div>
                  <div className="text-[15px] font-bold mb-1" style={{ color: M.T1, letterSpacing: "-0.3px" }}>No scores yet</div>
                  <div className="text-[12px] font-medium mb-4" style={{ color: M.T3, letterSpacing: "-0.1px" }}>Grade a test or assignment<br/>to see performance breakdown.</div>
                  <button type="button"
                    onClick={() => navigate('/gradebook')}
                    className="inline-flex items-center gap-[5px] px-[18px] py-[10px] rounded-[12px] text-white text-[12px] font-bold active:scale-[0.96] transition-transform"
                    style={{ background: M.B1, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.3)" }}>
                    Open Gradebook
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Grade distribution */}
                <div className="rounded-[20px] p-4 mb-[14px]" style={{ background: M.CARD, boxShadow: M.SH, border: M.BDR }}>
                  <div className="flex items-center gap-[10px] mb-3">
                    <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white" style={{ background: M.B1 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="12" width="4" height="9" rx="1"/>
                        <rect x="10" y="8" width="4" height="13" rx="1"/>
                        <rect x="17" y="4" width="4" height="17" rx="1"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-[14px] font-bold" style={{ color: M.T1, letterSpacing: "-0.3px" }}>Grade Distribution</div>
                      <div className="text-[11px] font-semibold mt-[1px]" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                        {performanceView.count} graded
                      </div>
                    </div>
                  </div>
                  {[
                    { g: "A", range: "85–100%", count: performanceView.dist.A, fill: M.GREEN },
                    { g: "B", range: "70–84%",  count: performanceView.dist.B, fill: M.B1 },
                    { g: "C", range: "55–69%",  count: performanceView.dist.C, fill: M.GOLD },
                    { g: "D", range: "40–54%",  count: performanceView.dist.D, fill: M.ORANGE },
                    { g: "F", range: "<40%",    count: performanceView.dist.F, fill: M.RED },
                  ].map(r => {
                    const pct = performanceView.count > 0 ? (r.count / performanceView.count) * 100 : 0;
                    return (
                      <div key={r.g} className="grid items-center gap-[10px] py-2"
                        style={{ gridTemplateColumns: "20px 52px 1fr 24px" }}>
                        <div className="text-[13px] font-bold" style={{ color: M.T1, letterSpacing: "-0.3px" }}>{r.g}</div>
                        <div className="text-[10px] font-semibold" style={{ color: M.T3, letterSpacing: "-0.1px" }}>{r.range}</div>
                        <div className="h-[7px] rounded-full overflow-hidden" style={{ background: M.SURFACE }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: r.fill }} />
                        </div>
                        <div className="text-[12px] font-bold text-right" style={{ color: M.T1 }}>{r.count}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Top performers */}
                {performanceView.top.length > 0 && (
                  <div className="rounded-[20px] p-4 mb-[14px]" style={{ background: M.CARD, boxShadow: M.SH, border: M.BDR }}>
                    <div className="flex items-center gap-[10px] mb-3">
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white" style={{ background: M.GOLD }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 9H4a2 2 0 01-2-2V5a2 2 0 012-2h2"/>
                          <path d="M18 9h2a2 2 0 002-2V5a2 2 0 00-2-2h-2"/>
                          <path d="M4 22h16"/>
                          <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
                          <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
                          <path d="M18 2H6v7a6 6 0 0012 0V2z"/>
                        </svg>
                      </div>
                      <div>
                        <div className="text-[14px] font-bold" style={{ color: M.T1, letterSpacing: "-0.3px" }}>Top Performers</div>
                        <div className="text-[11px] font-semibold mt-[1px]" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                          {performanceView.top.length} student{performanceView.top.length === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                    {performanceView.top.map((s, i) => (
                      <div key={s.id}
                        onClick={() => navigate(`/students?studentId=${s.studentId || s.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/students?studentId=${s.studentId || s.id}`); }}
                        className="flex items-center gap-[10px] py-[10px] cursor-pointer active:opacity-70 transition"
                        style={i > 0 ? { borderTop: "0.5px solid rgba(9,87,247,0.07)" } : undefined}>
                        <div className="w-[22px] h-[22px] rounded-[7px] text-[11px] font-bold flex items-center justify-center flex-shrink-0"
                          style={i === 0 ? { background: M.GOLD, color: "#fff" } : { background: M.SURFACE, color: M.T2 }}>
                          {i + 1}
                        </div>
                        <div className="flex-1 text-[13px] font-bold truncate" style={{ color: M.T1, letterSpacing: "-0.2px" }}>{s.studentName}</div>
                        <div className="text-[13px] font-bold" style={{ color: s.scoreRaw >= 60 ? M.GREEN : M.RED, letterSpacing: "-0.3px" }}>{s.avg}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Needs attention */}
                {performanceView.bottom.length > 0 && (
                  <div className="rounded-[20px] p-4 mb-[14px]" style={{ background: M.CARD, boxShadow: M.SH, border: M.BDR }}>
                    <div className="flex items-center gap-[10px] mb-3">
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white" style={{ background: M.RED }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2L2 21h20L12 2z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/>
                          <line x1="12" y1="17" x2="12" y2="17"/>
                        </svg>
                      </div>
                      <div>
                        <div className="text-[14px] font-bold" style={{ color: M.T1, letterSpacing: "-0.3px" }}>Needs Attention</div>
                        <div className="text-[11px] font-semibold mt-[1px]" style={{ color: M.T3, letterSpacing: "-0.1px" }}>
                          Lowest scores
                        </div>
                      </div>
                    </div>
                    {performanceView.bottom.map((s, i) => {
                      const ungraded = s.scoreRaw < 0;
                      // Icon + colors: red for genuine low scores, neutral gray
                      // for ungraded (so "—" doesn't mislead as "alarming").
                      const iconBg    = ungraded ? "rgba(140,140,160,0.12)" : "rgba(255,51,85,0.12)";
                      const iconColor = ungraded ? M.T3 : M.RED;
                      const iconChar  = ungraded ? "?" : "!";
                      const valueColor = ungraded ? M.T4
                        : s.scoreRaw >= 60 ? M.GREEN
                        : M.RED;
                      return (
                        <div key={s.id}
                          onClick={() => navigate(`/students?studentId=${s.studentId || s.id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/students?studentId=${s.studentId || s.id}`); }}
                          className="flex items-center gap-[10px] py-[10px] cursor-pointer active:opacity-70 transition"
                          style={i > 0 ? { borderTop: "0.5px solid rgba(9,87,247,0.07)" } : undefined}>
                          <div className="w-[22px] h-[22px] rounded-[7px] text-[11px] font-bold flex items-center justify-center flex-shrink-0"
                            style={{ background: iconBg, color: iconColor }}>{iconChar}</div>
                          <div className="flex-1 text-[13px] font-bold truncate" style={{ color: M.T1, letterSpacing: "-0.2px" }}>{s.studentName}</div>
                          <div className="text-[13px] font-bold" style={{ color: valueColor, letterSpacing: "-0.3px" }}>{s.avg}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* AI Class Intelligence */}
                <div className="rounded-[24px] p-[18px] mt-[14px] relative overflow-hidden"
                  style={{
                    background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
                    boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
                  }}>
                  <div className="absolute inset-0 pointer-events-none" style={{
                    background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
                  }} />
                  <div className="relative z-[2]">
                    <div className="flex items-center gap-[11px] mb-3">
                      <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-[18px]"
                        style={{
                          background: "rgba(255,255,255,0.14)",
                          backdropFilter: "blur(22px)",
                          WebkitBackdropFilter: "blur(22px)",
                          border: "0.5px solid rgba(255,255,255,0.22)",
                          color: "#FFDD55",
                        }}>⚡</div>
                      <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.8px" }}>AI Class Intelligence</div>
                      <div className="ml-auto px-[9px] py-[4px] rounded-full text-[9px] font-bold"
                        style={{
                          background: "rgba(123,63,244,0.3)",
                          border: "0.5px solid rgba(155,95,255,0.5)",
                          color: "#DCC8FF",
                          letterSpacing: "0.5px",
                        }}>Tip</div>
                    </div>
                    <div className="text-[12px] font-normal leading-[1.6]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.1px" }}>
                      <strong className="text-white font-bold">{classNameStr}</strong> has
                      {" "}{!isNaN(atndNum) && atndNum >= 85 ? "strong" : !isNaN(atndNum) && atndNum >= 70 ? "moderate" : "weak"} attendance at
                      {" "}<strong className="text-white font-bold">{stats.attendanceRate}</strong>,
                      {" "}class average is <strong className="text-white font-bold">{performanceView.avg.toFixed(1)}%</strong>
                      {performanceView.bottom.length > 0 && performanceView.bottom[0].scoreRaw < 50 && (
                        <> with <strong className="text-white font-bold">{performanceView.bottom.filter(s => s.scoreRaw < 50).length} student{performanceView.bottom.filter(s => s.scoreRaw < 50).length === 1 ? "" : "s"}</strong> below 50%</>
                      )}
                      . {performanceView.bottom[0]
                        ? <>Focus remediation on <strong className="text-white font-bold">{performanceView.bottom[0].studentName}</strong>
                            {stats.atRiskCount > 0 && <> and schedule a formative test</>}.</>
                        : <>Keep engaging — every student is on track.</>
                      }
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
    {/* ═══════════ END MOBILE VIEW ═══════════ */}

    <div className="hidden md:block text-left space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{classInfo?.name || "Class"}</h1>

          {/* Subject — inline editable */}
          <div className="flex items-center gap-2 mt-1">
            {editingSubject ? (
              <>
                <input
                  autoFocus
                  value={tempSubject}
                  onChange={e => setTempSubject(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSaveSubject(); if (e.key === "Escape") setEditingSubject(false); }}
                  placeholder="e.g. Mathematics"
                  className="h-8 px-3 text-sm border border-blue-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 w-44"
                />
                <button type="button"
                  onClick={handleSaveSubject}
                  disabled={isSavingSubject}
                  className="h-8 px-3 bg-[#0055FF] text-white rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-[#1166FF]"
                >
                  {isSavingSubject ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save
                </button>
                <button type="button" onClick={() => setEditingSubject(false)} className="h-8 px-2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button type="button"
                onClick={() => { setTempSubject(classInfo?.subject || teacherData?.subject || ""); setEditingSubject(true); }}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#0055FF] group"
              >
                <span className={classInfo?.subject ? "text-slate-600 font-medium" : "text-slate-400 italic"}>
                  {classInfo?.subject || teacherData?.subject || "Set subject..."}
                </span>
                <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
            <span className="text-slate-300">•</span>
            <span className="text-sm text-slate-500">{stats.totalStudents} Students</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button"
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export
          </button>
          <button type="button"
            onClick={() => navigate("/attendance")}
            className="px-5 py-2.5 bg-[#0055FF] text-white rounded-xl text-sm font-semibold hover:bg-[#1166FF] transition-all"
          >
            Mark Attendance
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 border-b border-slate-200">
        {["Students", "Attendance", "Assignments", "Tests", "Performance"].map(tab => (
          <button type="button"
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-semibold relative transition-colors ${
              activeTab === tab ? "text-[#0055FF]" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {tab}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[#0055FF] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Stat Cards — Dashboard-vibe (tintBg gradient + decorative SVG + colored icon chip) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Students",
            val: `${stats.totalStudents}`,
            color: M.B1,
            tintBg: "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)",
            tintBorder: "rgba(0,85,255,0.10)",
            sub: stats.totalStudents > 0
              ? <span className="font-bold" style={{ color: M.GREEN }}>● Enrolled</span>
              : <span className="font-bold" style={{ color: M.T3 }}>No students yet</span>,
            icon: <Users className="w-[18px] h-[18px]" strokeWidth={2.4} aria-hidden="true" />,
            decor: <Users className="w-[60px] h-[60px]" strokeWidth={1.5} aria-hidden="true" />,
            route: "/students",
          },
          {
            label: "Attendance",
            val: stats.attendanceRate,
            color: M.GREEN,
            tintBg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)",
            tintBorder: "rgba(0,200,83,0.16)",
            sub: atndNum >= 85
              ? <span className="font-bold" style={{ color: M.GREEN }}>↑ Strong</span>
              : atndNum >= 70
                ? <span className="font-bold" style={{ color: M.ORANGE }}>● Watch</span>
                : atndNum >= 0
                  ? <span className="font-bold" style={{ color: M.RED }}>● Needs focus</span>
                  : <span className="font-bold" style={{ color: M.T3 }}>Awaiting data</span>,
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="12" width="4" height="9" rx="1"/>
                <rect x="10" y="8" width="4" height="13" rx="1"/>
                <rect x="17" y="4" width="4" height="17" rx="1"/>
              </svg>
            ),
            decor: (
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="13" width="4" height="8" rx="1"/>
                <rect x="10" y="9" width="4" height="12" rx="1"/>
                <rect x="17" y="5" width="4" height="16" rx="1"/>
              </svg>
            ),
            route: "/attendance",
          },
          {
            label: "Avg. Score",
            val: stats.avgScore,
            color: M.VIOLET,
            tintBg: "linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)",
            tintBorder: "rgba(123,63,244,0.12)",
            sub: stats.avgScore !== "—"
              ? <span className="font-bold" style={{ color: M.VIOLET }}>● Class average</span>
              : <span className="font-bold" style={{ color: M.T3 }}>Awaiting data</span>,
            icon: <TrendingUp className="w-[18px] h-[18px]" strokeWidth={2.4} aria-hidden="true" />,
            decor: <TrendingUp className="w-[60px] h-[60px]" strokeWidth={1.5} aria-hidden="true" />,
            route: "/gradebook",
          },
          {
            label: "At Risk",
            val: `${stats.atRiskCount}`,
            color: stats.atRiskCount > 0 ? M.RED : M.GREEN,
            tintBg: stats.atRiskCount > 0
              ? "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)"
              : "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)",
            tintBorder: stats.atRiskCount > 0 ? "rgba(255,51,85,0.14)" : "rgba(0,200,83,0.16)",
            sub: stats.atRiskCount === 0
              ? <span className="font-bold" style={{ color: M.GREEN }}>✓ All on track</span>
              : <span className="font-bold" style={{ color: M.RED }}>● Needs outreach</span>,
            icon: <AlertTriangle className="w-[18px] h-[18px]" strokeWidth={2.4} aria-hidden="true" />,
            decor: <AlertTriangle className="w-[60px] h-[60px]" strokeWidth={1.5} aria-hidden="true" />,
            route: "/risks-alerts",
          },
        ].map(({ label, val, color, tintBg, tintBorder, sub, icon, decor, route }) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate(route)}
            {...tilt3D}
            className="rounded-[22px] p-5 relative flex flex-col text-left cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{
              background: tintBg,
              boxShadow: "0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04)",
              border: `0.5px solid ${tintBorder}`,
              ...tilt3DStyle,
            }}
            aria-label={`${label}: ${val}`}
          >
            {/* decorative icon (bottom-right) */}
            <div className="absolute pointer-events-none" style={{ right: 14, bottom: 12, color, opacity: 0.22, transform: "translateZ(4px)" }}>
              {decor}
            </div>
            {/* top-left icon chip */}
            <div className="flex-shrink-0 w-[40px] h-[40px] rounded-[12px] flex items-center justify-center mb-[14px]"
              style={{ background: `${color}1F`, color, transform: "translateZ(18px)" }}>
              {icon}
            </div>
            <div className="text-[11px] font-bold uppercase leading-[1.3] mb-[8px]" style={{ color, letterSpacing: "1px", transform: "translateZ(10px)" }}>
              {label}
            </div>
            <div className="text-[36px] font-bold leading-none" style={{ color: M.T1, letterSpacing: "-1.6px", transform: "translateZ(10px)" }}>{val}</div>
            <div className="text-[12px] font-semibold mt-2 flex items-center gap-[5px] relative" style={{ color: M.T3, letterSpacing: "-0.15px" }}>
              {sub}
            </div>
          </button>
        ))}
      </div>

      {/* Students Tab Content */}
      {activeTab === "Students" && (
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: M.SH, border: M.BDR }}>
          {/* Table Header */}
          <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-800">Student List</h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search students..."
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pl-9 pr-4 h-9 w-44 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button type="button"
                onClick={() => navigate("/students")}
                className="px-4 h-9 bg-slate-50 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-100"
              >
                Add Student
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500">Student</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Roll No</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Attendance</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Avg. Score</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Status</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-400 text-sm">
                      No students found
                    </td>
                  </tr>
                ) : (
                  paginated.map(s => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/students?studentId=${s.studentId || s.id}`)}
                      className="hover:bg-slate-50 transition-colors group cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-slate-400 mb-1">{s.initials}</span>
                          <span className="text-sm font-semibold text-slate-800">{s.studentName}</span>
                          <span className="text-xs text-slate-400">{s.studentEmail}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {editingRoll === s.id ? (
                          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              className="w-16 h-7 text-center text-xs border border-slate-200 rounded-lg outline-none"
                              value={tempRoll}
                              onChange={e => setTempRoll(e.target.value)}
                              autoFocus
                            />
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleUpdateRoll(s.id); }} disabled={isUpdating} className="text-emerald-500 hover:text-emerald-600">
                              {isUpdating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            </button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); setEditingRoll(null); }} className="text-slate-300 hover:text-slate-500">
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div
                            className="flex items-center justify-center gap-1 cursor-pointer group/roll"
                            onClick={(e) => { e.stopPropagation(); setEditingRoll(s.id); setTempRoll(s.rollNo || ""); }}
                          >
                            <span className="text-sm font-medium text-slate-700">{s.rollNo || "—"}</span>
                            <Edit2 size={10} className="text-slate-300 opacity-0 group-hover/roll:opacity-100" />
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-slate-700">{s.attendance}</td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-slate-700">{s.avg}</td>
                      <td className="px-6 py-4 text-center">
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); handleToggleStatus(s.id, s.status); }}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${statusStyle(s.status)}`}
                        >
                          {s.status}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/students?studentId=${s.studentId || s.id}`); }}
                          className="text-sm font-semibold text-[#0055FF] hover:underline"
                        >
                          View Profile
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-6 py-4 flex items-center justify-between border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filtered.length)}–{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} of {filtered.length} students
            </p>
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => goPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <div className="flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button type="button"
                    key={p}
                    onClick={() => goPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                      p === currentPage
                        ? "bg-[#0055FF] text-white"
                        : "border border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button type="button"
                onClick={() => goPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Tab */}
      {activeTab === "Attendance" && (
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: M.SH, border: M.BDR }}>
          <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#0055FF]" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-800">Attendance log</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate("/attendance")}
              className="px-3 h-8 bg-[#0055FF] text-white rounded-lg text-xs font-semibold hover:bg-[#1166FF]"
            >
              Mark today
            </button>
          </div>
          {tabLoading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#0055FF]" aria-hidden="true" />
            </div>
          ) : attendanceByDate.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              No attendance marked for this class yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left" aria-label="Attendance log">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500">Date</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Present</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Absent</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Late</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendanceByDate.slice(0, 30).map(row => {
                    const presentish = row.present + row.late;
                    const rate = row.total > 0 ? (presentish / row.total) * 100 : 0;
                    const rateColor = rate >= 85 ? "text-emerald-600" : rate >= 70 ? "text-amber-600" : "text-rose-600";
                    return (
                      <tr key={row.date} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-slate-800">{fmtShortDate(row.dateObj)}</span>
                            <span className="text-[10px] text-slate-400">{row.dateObj.toLocaleDateString("en-IN", { weekday: "short" })}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                            <CheckCircle2 size={14} aria-hidden="true" /> {row.present}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-rose-700">
                            <XCircle size={14} aria-hidden="true" /> {row.absent}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-700">
                            <Clock size={14} aria-hidden="true" /> {row.late}
                          </span>
                        </td>
                        <td className={`px-6 py-4 text-center text-sm font-bold ${rateColor}`}>
                          {rate.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {attendanceByDate.length > 30 && (
                <div className="px-6 py-3 text-center text-xs text-slate-400 border-t border-slate-100">
                  Showing last 30 days of {attendanceByDate.length} total
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Assignments Tab */}
      {activeTab === "Assignments" && (
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: M.SH, border: M.BDR }}>
          <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#0055FF]" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-800">Assignments ({assignmentsView.length})</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate("/assignments")}
              className="px-3 h-8 bg-[#0055FF] text-white rounded-lg text-xs font-semibold hover:bg-[#1166FF]"
            >
              Manage
            </button>
          </div>
          {tabLoading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#0055FF]" aria-hidden="true" />
            </div>
          ) : assignmentsView.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              No assignments created for this class yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {assignmentsView.map(a => {
                const stale = a.isPastDue && a.status === "Active";
                return (
                  <div
                    key={a.id}
                    className="px-6 py-4 flex items-center justify-between hover:bg-slate-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{a.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Due {a.dueLabel}
                        {a.rosterSize > 0 && <> · {a.rosterSize} students assigned</>}
                      </p>
                    </div>
                    <span
                      className={`ml-4 px-3 py-1 rounded-lg text-xs font-semibold flex-shrink-0 ${
                        stale ? "bg-rose-50 text-rose-700"
                        : a.status === "Fully Submitted" ? "bg-emerald-50 text-emerald-700"
                        : a.status === "Active" ? "bg-blue-50 text-blue-700"
                        : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {stale ? "Overdue" : a.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tests Tab */}
      {activeTab === "Tests" && (
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: M.SH, border: M.BDR }}>
          <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-[#0055FF]" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-800">Tests ({testsView.length})</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate("/tests")}
              className="px-3 h-8 bg-[#0055FF] text-white rounded-lg text-xs font-semibold hover:bg-[#1166FF]"
            >
              Manage
            </button>
          </div>
          {tabLoading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#0055FF]" aria-hidden="true" />
            </div>
          ) : testsView.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              No tests scheduled for this class yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left" aria-label="Tests list">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500">Title</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500">Subject</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Date</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Max</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Class avg</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {testsView.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-800">{t.title}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{t.subject || "—"}</td>
                      <td className="px-6 py-4 text-center text-sm text-slate-600">{t.dateLabel}</td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-slate-700">{t.marks ?? "—"}</td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-slate-700">
                        {t.classAverage > 0 ? `${t.classAverage.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          t.status === "Completed" ? "bg-emerald-50 text-emerald-700" :
                          t.status === "Upcoming" ? "bg-blue-50 text-blue-700" :
                          "bg-slate-100 text-slate-500"
                        }`}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Performance Tab */}
      {activeTab === "Performance" && (
        <div className="space-y-4">
          {/* Summary header */}
          <div className="bg-white rounded-2xl p-5 flex items-center gap-5" style={{ boxShadow: M.SH, border: M.BDR }}>
            <div className="w-12 h-12 rounded-[14px] flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,85,255,0.10)", color: M.B1 }}>
              <TrendingUp className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800 leading-none">
                {performanceView.count > 0 ? `${performanceView.avg.toFixed(1)}%` : "—"}
              </p>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Class average across {performanceView.count} students with data
              </p>
            </div>
          </div>

          {performanceView.count === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400 text-sm" style={{ boxShadow: M.SH, border: M.BDR }}>
              No scores recorded for this class yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Grade distribution */}
              <div className="bg-white rounded-2xl p-5" style={{ boxShadow: M.SH, border: M.BDR }}>
                <h3 className="text-sm font-bold text-slate-800 mb-4">Grade distribution</h3>
                <div className="space-y-3">
                  {[
                    { g: "A", range: "85-100%", count: performanceView.dist.A, color: "bg-emerald-500" },
                    { g: "B", range: "70-84%",  count: performanceView.dist.B, color: "bg-blue-500" },
                    { g: "C", range: "55-69%",  count: performanceView.dist.C, color: "bg-amber-500" },
                    { g: "D", range: "40-54%",  count: performanceView.dist.D, color: "bg-orange-500" },
                    { g: "F", range: "<40%",    count: performanceView.dist.F, color: "bg-rose-500" },
                  ].map(row => {
                    const pct = performanceView.count > 0 ? (row.count / performanceView.count) * 100 : 0;
                    return (
                      <div key={row.g} className="flex items-center gap-3">
                        <span className="w-6 text-sm font-bold text-slate-700">{row.g}</span>
                        <span className="w-20 text-xs text-slate-400">{row.range}</span>
                        <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${row.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-xs font-semibold text-slate-600 text-right">{row.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top & bottom performers */}
              <div className="space-y-4">
                <div className="bg-white rounded-2xl p-5" style={{ boxShadow: M.SH, border: M.BDR }}>
                  <h3 className="text-sm font-bold text-slate-800 mb-3">Top performers</h3>
                  {performanceView.top.length === 0 ? (
                    <p className="text-xs text-slate-400">No scores yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {performanceView.top.map(s => (
                        <li key={s.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-700 truncate">{s.studentName}</span>
                          <span className="text-emerald-700 font-bold ml-2">{s.avg}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="bg-white rounded-2xl p-5" style={{ boxShadow: M.SH, border: M.BDR }}>
                  <h3 className="text-sm font-bold text-slate-800 mb-3">Needs attention</h3>
                  {performanceView.bottom.length === 0 ? (
                    <p className="text-xs text-slate-400">No scores yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {performanceView.bottom.map(s => {
                        const ungraded = s.scoreRaw < 0;
                        // Neutral gray for ungraded so "—" doesn't read as alarming
                        const valueClass = ungraded
                          ? "text-slate-400 font-bold ml-2"
                          : s.scoreRaw >= 60
                            ? "text-amber-700 font-bold ml-2"
                            : "text-rose-700 font-bold ml-2";
                        return (
                          <li key={s.id} className="flex items-center justify-between text-sm">
                            <span className="text-slate-700 truncate">{s.studentName}</span>
                            <span className={valueClass}>{s.avg}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
};

export default ClassDetail;
