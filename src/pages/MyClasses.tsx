import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  type DocumentData, type Unsubscribe,
} from "firebase/firestore";

type ClassDoc = DocumentData & { id: string };
type EnrollmentDoc = DocumentData & { id: string; classId?: string };
type AttendanceDoc = DocumentData & { id: string; classId?: string; status?: string };
type ScoreDoc = DocumentData & { id: string; classId?: string; score?: number; percentage?: number };
import {
  Loader2, Search, BarChart2, Home, GraduationCap, AlertCircle, RefreshCw,
} from "lucide-react";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

type FilterType = "All" | "Active" | "Attention" | "Setup";
type AttentionState = "good" | "attention" | "no-data";

// Indian-context academic year label (June–May). Most US-style "Spring/Fall"
// labels confuse Indian teachers — Indian academic year runs Jun → May.
const getSemesterLabel = () => {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const startYear = month >= 5 ? year : year - 1; // June = month 5
  const endShort = String(startYear + 1).slice(-2);
  return `Academic Year ${startYear}–${endShort}`;
};

// Score window — bounds performance assessment to current data, so a class
// that recovered from an early slump isn't tarnished by 2-year-old scores.
const SCORE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// Note: Timetable parsing was considered for "Next Class" but the school's
// timetable is uploaded as raw Excel (free-form structure, not parseable
// without burdening the data-entry person). Decision: render a "View"
// button on the Next Class row that deep-links to the Timetable page where
// the teacher views the published Excel WYSIWYG.

// Hero attendance band (overall avg). Centralizes the 4-band color/label
// scheme that was previously inlined as a 4-deep ternary in 6+ places
// across mobile + desktop. Single source of truth.
const getAttHeroBand = (v: number | null) => {
  if (v == null) return {
    bg: "rgba(255,255,255,0.14)", border: "rgba(255,255,255,0.22)",
    color: "rgba(255,255,255,0.72)", dotBg: "#fff",
    label: "No data", push: "Awaiting data",
    gridText: "#fff",
  };
  if (v >= 90) return {
    bg: "rgba(0,232,102,0.18)", border: "rgba(0,232,102,0.5)",
    color: "#6FFFAA", dotBg: "#00FF88",
    label: "Excellent", push: "Strong performance",
    gridText: "#6FFFAA",
  };
  if (v >= 75) return {
    bg: "rgba(255,170,0,0.22)", border: "rgba(255,170,0,0.5)",
    color: "#FFD166", dotBg: "#FFCC22",
    label: "Good", push: "Solid progress",
    gridText: "#6FFFAA",
  };
  return {
    bg: "rgba(255,51,85,0.18)", border: "rgba(255,51,85,0.5)",
    color: "#FF99AA", dotBg: "#FF5577",
    label: "Watch", push: "Keep pushing",
    gridText: "#FF8899",
  };
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

// Class-label normalizer (matches Dashboard.tsx canonical pattern).
// Collapses "Class 9A" / "9 A" / "Math 9A" / "Grade 9-A" / "IX-A" into the
// same key so attendance/score docs whose className format drifts from the
// class doc's name still match. Defense for `pattern_3tier_attribution`.
const ROMAN_TO_NUM: Record<string, string> = {
  i:"1", ii:"2", iii:"3", iv:"4", v:"5", vi:"6", vii:"7",
  viii:"8", ix:"9", x:"10", xi:"11", xii:"12",
};
const normalizeClassKey = (raw: any): string => {
  if (typeof raw !== "string") return "";
  let s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  s = s.replace(/^(class|grade|gr|standard|std)\s+/, "");

  const mLead = s.match(/^(\d{1,2})\s*[-_\s]*([a-z]*)\s*(.*)$/);
  if (mLead) {
    const [, num, suffix, rest] = mLead;
    return `${num}${suffix || ""}${rest.trim().replace(/\s+/g, "")}`;
  }
  const tok = s.split(/\s+/)[0];
  if (ROMAN_TO_NUM[tok]) {
    const tail = s.replace(new RegExp(`^${tok}\\s*`), "").trim().replace(/\s+/g, "");
    return `${ROMAN_TO_NUM[tok]}${tail}`;
  }
  const mAny = s.match(/(\d{1,2})\s*[-_\s]*([a-z]?)/);
  if (mAny) {
    const [, num, suffix] = mAny;
    return `${num}${suffix || ""}`;
  }
  return s.replace(/[^a-z0-9]+/g, "");
};

// ── Canonical score normalizer (matches Dashboard.tsx). Returns 0-100 % from
// any score doc shape, or null when the doc has no usable score data.
// Covers test_scores (score+maxScore), gradebook_scores (mark+maxMarks), and
// results (score / percentage). Returning null preserves "no data" so we
// don't conflate untested entries with 0%.
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

// Blue Apple tokens (shared mobile + desktop)
const B1 = "#0055FF";
const TT1 = "#001040", TT2 = "#002080", TT3 = "#5070B0", TT4 = "#99AACC";
const GREEN = "#00C853";
const RED = "#FF3355";
const ORANGE = "#FF8800";
const VIOLET = "#6B21E8";
const BLUE_BDR = "rgba(0,85,255,0.12)";
const SEP_D = "rgba(0,85,255,0.07)";
const SH_D = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
const SH_LG_D = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.14)";
const SH_BTN_D = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)";
const FONT_D = "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif";

const MyClasses = () => {
  const navigate = useNavigate();
  const { teacherData } = useAuth();

  // Per-collection raw state. All listeners are real-time (no nested getDocs).
  const [assignedClassIds, setAssignedClassIds]     = useState<string[]>([]);
  const [legacyOwnedClassIds, setLegacyOwnedClassIds] = useState<string[]>([]);
  const [allClassDocs, setAllClassDocs]             = useState<ClassDoc[]>([]);
  const [enrollments, setEnrollments]               = useState<EnrollmentDoc[]>([]);
  const [attendanceRecords, setAttendanceRecords]   = useState<AttendanceDoc[]>([]);
  // Per-source state arrays so we can merge from 3 score collections
  // (test_scores + gradebook_scores + results). Memory:
  // owner_dashboard_alternate_data_sources — gradebook_scores is co-canonical
  // with test_scores; reading only one drops ~40% of teacher's score data.
  const [testScoreDocs, setTestScoreDocs]           = useState<ScoreDoc[]>([]);
  const [gradebookScoreDocs, setGradebookScoreDocs] = useState<ScoreDoc[]>([]);
  const [resultDocs, setResultDocs]                 = useState<ScoreDoc[]>([]);
  const [startTimesMap, setStartTimesMap]           = useState<Map<string, string>>(new Map());
  const [loading, setLoading]                       = useState(true);
  const [error, setError]                           = useState<string | null>(null);
  const [refreshKey, setRefreshKey]                 = useState(0);
  const [searchQuery, setSearchQuery]               = useState("");
  const [filter, setFilter]                         = useState<FilterType>("All");
  const [showSearch, setShowSearch]                 = useState(false);

  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    const tId = teacherData.id;

    let cancelled = false;
    const unsubs: Unsubscribe[] = [];
    const errH = (err: any) => {
      if (cancelled) return;
      console.error("[MyClasses] listener error:", err);
      setError(err?.message || "Failed to load classes");
      setLoading(false);
    };

    // ── Resolution entities — schoolId + teacherId only (NO branchId).
    // teacherId IS the isolation key here; branchId filter is redundant +
    // risks drift drops (legacy migration / multi-branch / inference-lag).
    // Per `bug_pattern_branch_filter_on_event_streams` extended.

    // teaching_assignments — active filter is client-side (legacy docs may
    // not have a status field; server-side `where status==active` excludes them).
    unsubs.push(onSnapshot(
      query(
        collection(db, "teaching_assignments"),
        where("schoolId", "==", schoolId),
        where("teacherId", "==", tId),
      ),
      (snap) => {
        if (cancelled) return;
        const activeDocs = snap.docs.filter(d => {
          const s = (d.data() as any).status;
          return !s || (typeof s === "string" && s.toLowerCase() === "active");
        });
        const ids = activeDocs.map(d => d.data().classId).filter(Boolean);
        const timesMap = new Map<string, string>();
        activeDocs.forEach(d => {
          const data = d.data();
          if (data.classId && (data.startTime || data.scheduleTime)) {
            timesMap.set(data.classId, data.startTime || data.scheduleTime);
          }
        });
        setAssignedClassIds(ids);
        setStartTimesMap(timesMap);
      },
      errH,
    ));

    // classes legacy — teacher "owns" via `teacherId` field on class doc.
    // Real-time so renames + new ownerships flow through without a refresh.
    unsubs.push(onSnapshot(
      query(
        collection(db, "classes"),
        where("schoolId", "==", schoolId),
        where("teacherId", "==", tId),
      ),
      (snap) => {
        if (cancelled) return;
        setLegacyOwnedClassIds(snap.docs.map(d => d.id));
      },
      errH,
    ));

    // classes school-wide — needed because `assignedClassIds` references
    // class docs the teacher doesn't directly "own" (assigned, not
    // homeroom). Real-time so class metadata stays fresh.
    unsubs.push(onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId)),
      (snap) => {
        if (cancelled) return;
        setAllClassDocs(snap.docs.map(d => ({ ...d.data(), id: d.id })));
        setLoading(false);
      },
      errH,
    ));

    // ── Event streams — schoolId + teacherId only (NO branchId per
    // `bug_pattern_branch_filter_on_event_streams`).
    // NOTE: enrollments has its own dedicated listener below (chunked by
    // classId in [...]). It used to live here filtered by teacherId, but
    // many enrollment writers don't stamp teacherId on the doc → silent
    // 0-student count. classId match is the reliable join key.
    unsubs.push(onSnapshot(
      query(collection(db, "attendance"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => { if (!cancelled) setAttendanceRecords(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      errH,
    ));
    // Score sources — 3-source merge (test_scores + gradebook_scores + results).
    unsubs.push(onSnapshot(
      query(collection(db, "test_scores"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => { if (!cancelled) setTestScoreDocs(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      errH,
    ));
    unsubs.push(onSnapshot(
      query(collection(db, "gradebook_scores"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => { if (!cancelled) setGradebookScoreDocs(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      errH,
    ));
    unsubs.push(onSnapshot(
      query(collection(db, "results"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => { if (!cancelled) setResultDocs(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      errH,
    ));

    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, [teacherData?.id, teacherData?.schoolId, refreshKey]);

  // Resolved class list — union of assigned (from teaching_assignments) +
  // legacy-owned (from classes by teacherId), filtered against the school's
  // class docs. Single source of truth for downstream consumers.
  const classes = useMemo<ClassDoc[]>(() => {
    const allowed = new Set<string>([...assignedClassIds, ...legacyOwnedClassIds]);
    if (allowed.size === 0) return [];
    return allClassDocs.filter(c => allowed.has(c.id));
  }, [allClassDocs, assignedClassIds, legacyOwnedClassIds]);

  // Class IDs the teacher teaches — used by enrollments listener to filter
  // by classId rather than (potentially-missing) `teacherId` field on
  // enrollment docs. Stable string key for useEffect deps via .join("|").
  const classIds = useMemo<string[]>(() => classes.map(c => c.id), [classes]);
  const classIdsKey = classIds.join("|");

  // Enrollments — chunked classId match. Replaces the old `teacherId` filter
  // which silently dropped students whose enrollment doc didn't carry the
  // (optional) teacherId field. classId IS the reliable join — every
  // enrollment writer stamps it (memory: bug_pattern_dual_query_studentid_email).
  useEffect(() => {
    const schoolId = teacherData?.schoolId as string | undefined;
    if (!schoolId || classIds.length === 0) { setEnrollments([]); return; }
    let cancelled = false;
    const unsubs: Unsubscribe[] = [];
    const errH = (err: any) => {
      if (cancelled) return;
      console.error("[MyClasses] enrollments listener:", err);
      setError(err?.message || "Failed to load enrollments");
    };

    // Firestore `in` operator caps at 10. Chunk + accumulate per-chunk so
    // partial updates don't clobber other chunks' data.
    const chunks: string[][] = [];
    for (let i = 0; i < classIds.length; i += 10) chunks.push(classIds.slice(i, i + 10));
    const buckets: any[][] = chunks.map(() => []);

    chunks.forEach((ch, i) => {
      unsubs.push(onSnapshot(
        query(
          collection(db, "enrollments"),
          where("schoolId", "==", schoolId),
          where("classId", "in", ch),
        ),
        (snap) => {
          if (cancelled) return;
          buckets[i] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setEnrollments(buckets.flat());
        },
        errH,
      ));
    });

    return () => { cancelled = true; unsubs.forEach(u => u()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherData?.schoolId, classIdsKey, refreshKey]);

  // Recent score docs (last 90d) — bounds performance to current performance,
  // so a class that recovered isn't dragged down by ancient bad scores.
  // writerTimeMs enumerates per-collection timestamp fields.
  const recentScoreDocs = useMemo<ScoreDoc[]>(() => {
    const cutoff = Date.now() - SCORE_WINDOW_MS;
    return [...testScoreDocs, ...gradebookScoreDocs, ...resultDocs]
      .filter(d => writerTimeMs(d) >= cutoff);
  }, [testScoreDocs, gradebookScoreDocs, resultDocs]);

  // Per-class metrics map — memoized so 4 render-time consumers
  // (allMetrics, filteredClasses, mobile card, desktop card) share one
  // computation. Per-class avg O(N records / N classes) instead of full pass.
  const perClassMetrics = useMemo(() => {
    const map = new Map<string, {
      atndDisplay: string;
      perfDisplay: string;
      atndRaw: number | null;
      perfRaw: number | null;
      studentCount: number;
      attentionState: AttentionState;
      isAttention: boolean;
    }>();

    classes.forEach(cls => {
      const classId = cls.id;
      const classKey = normalizeClassKey(cls.name || cls.classId || classId);

      // Tier-2 fallback: match by classId OR normalized className. Defends
      // against id-format drift between writers and class doc id.
      const matches = (rec: any): boolean => {
        if (!rec) return false;
        if (rec.classId && rec.classId === classId) return true;
        if (rec.classId && cls.classId && rec.classId === cls.classId) return true;
        if (rec.className && classKey && normalizeClassKey(rec.className) === classKey) return true;
        return false;
      };

      const attArr  = attendanceRecords.filter(matches);
      const present = attArr.filter(r => r.status === "present" || r.status === "late").length;
      const atndRaw: number | null = attArr.length > 0 ? (present / attArr.length) * 100 : null;

      const scoreArr = recentScoreDocs.filter(matches);
      const pcts     = scoreArr.map(pctOfDoc).filter((v): v is number => v !== null);
      const perfRaw: number | null = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;

      const studentCount = enrollments.filter(matches).length;

      // 3-state attention: "no-data" when both null (don't fabricate "Active"),
      // "attention" when att<85 OR perf<60 (low perf was previously ignored),
      // "good" otherwise.
      let attentionState: AttentionState;
      if (atndRaw == null && perfRaw == null) {
        attentionState = "no-data";
      } else if ((atndRaw != null && atndRaw < 85) || (perfRaw != null && perfRaw < 60)) {
        attentionState = "attention";
      } else {
        attentionState = "good";
      }

      map.set(classId, {
        atndDisplay: atndRaw != null ? `${atndRaw.toFixed(1)}%` : "—",
        perfDisplay: perfRaw != null ? `${perfRaw.toFixed(1)}%` : "—",
        atndRaw,
        perfRaw,
        studentCount,
        attentionState,
        isAttention: attentionState === "attention",
      });
    });

    return map;
  }, [classes, attendanceRecords, recentScoreDocs, enrollments]);

  // Thin accessor — actual computation lives in `perClassMetrics` useMemo.
  // Returns same shape every consumer expects (atndRaw/perfRaw nullable now).
  const getMetrics = (classId: string) => {
    return perClassMetrics.get(classId) ?? {
      atndDisplay: "—",
      perfDisplay: "—",
      atndRaw: null as number | null,
      perfRaw: null as number | null,
      studentCount: 0,
      attentionState: "no-data" as AttentionState,
      isAttention: false,
    };
  };

  // ── Derived header values ────────────────────────────────────────
  // CRITICAL: these `useMemo` calls MUST run on EVERY render — never after a
  // conditional `return`. React identifies hooks by call-order. If we early-
  // return on `loading` before these, hook count differs between renders →
  // "Rendered more hooks than during the previous render" crash.
  const headerStats = useMemo(() => {
    const allMetrics    = classes.map(cls => getMetrics(cls.id));
    const totalStudents = allMetrics.reduce((s, m) => s + m.studentCount, 0);

    // Aggregate avg only over classes with REAL data (null filtered).
    const validAtnd = allMetrics.map(m => m.atndRaw).filter((v): v is number => v != null);
    const avgAtnd: number | null = validAtnd.length > 0
      ? validAtnd.reduce((s, v) => s + v, 0) / validAtnd.length
      : null;

    const validPerf = allMetrics.map(m => m.perfRaw).filter((v): v is number => v != null);
    const avgPerf: number | null = validPerf.length > 0
      ? validPerf.reduce((s, v) => s + v, 0) / validPerf.length
      : null;

    // 3-state distribution. activeCount is goodCount only — no longer
    // `classes.length - attentionCount` (which incorrectly inflated by
    // counting no-data classes as active).
    const goodCount      = allMetrics.filter(m => m.attentionState === "good").length;
    const attentionCount = allMetrics.filter(m => m.attentionState === "attention").length;
    const noDataCount    = allMetrics.filter(m => m.attentionState === "no-data").length;

    return { totalStudents, avgAtnd, avgPerf, goodCount, attentionCount, noDataCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, perClassMetrics]);

  const filteredClasses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return classes.filter(cls => {
      const nameMatch = !q || (cls.name?.toLowerCase().includes(q));
      if (!nameMatch) return false;
      if (filter === "All") return true;
      const m = getMetrics(cls.id);
      // "Active" = good · "Attention" = attention · "Setup" = no-data.
      // Mutually exclusive — no-data classes are NOT silently bucketed as
      // active (they're surfaced via the "Setup" filter so teacher can
      // see exactly which classes still need attendance/scoring data).
      if (filter === "Active")    return m.attentionState === "good";
      if (filter === "Attention") return m.attentionState === "attention";
      if (filter === "Setup")     return m.attentionState === "no-data";
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, searchQuery, filter, perClassMetrics]);

  // Conditional early return — must come AFTER all hooks.
  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center" style={{ background: "#EEF4FF" }}>
      <Loader2 className="w-10 h-10 animate-spin" style={{ color: B1 }} />
    </div>
  );

  // 3D tilt handlers come from `tilt3D` spread (use3DTilt lib) — no local
  // duplicates needed.

  // teacherInitial removed — profile chip lives in TeacherHeader globally.

  const { totalStudents, avgAtnd, avgPerf, goodCount, attentionCount } = headerStats;
  const avgAtndStr  = avgAtnd != null ? `${avgAtnd.toFixed(1)}%` : "—";
  const avgPerfStr  = avgPerf != null ? `${avgPerf.toFixed(1)}%` : "—";
  // Single hero band token — replaces 6+ inline ternary chains across mobile
  // + desktop hero + AI grid for consistent attendance semantics.
  const heroBand = getAttHeroBand(avgAtnd);
  // Performance grid color uses different threshold (60% pass) — small inline.
  const perfGridColor = avgPerf == null ? "#fff" : avgPerf >= 60 ? "#B5A0FF" : "#FF99AA";
  // Back-compat alias — render code reads `activeCount` in many places.
  const activeCount = goodCount;

  return (
    <div style={{ fontFamily: FONT_D, background: "#EEF4FF" }} className="min-h-screen pb-[72px] md:pb-0 text-left">

      {/* Error retry banner — surfaces listener failures (permission denied,
          network, missing index) instead of silently leaving empty UI. */}
      {error && (
        <div className="px-4 pt-3 md:px-8 md:pt-4">
          <div className="rounded-[14px] flex items-start gap-3 px-4 py-3"
            style={{
              background: "rgba(255,51,85,0.08)",
              border: "0.5px solid rgba(255,51,85,0.30)",
              boxShadow: "0 2px 10px rgba(255,51,85,0.10)",
            }}>
            <AlertCircle size={18} style={{ color: "#C92A2A", flexShrink: 0, marginTop: 2 }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold" style={{ color: "#7A1414", letterSpacing: "-0.1px" }}>
                Couldn't load classes
              </div>
              <div className="text-[11px] mt-[2px]" style={{ color: "#A33333" }}>{error}</div>
            </div>
            <button type="button"
              onClick={() => { setError(null); setLoading(true); setRefreshKey(k => k + 1); }}
              className="flex items-center gap-[5px] px-3 py-[7px] rounded-[10px] text-[11px] font-bold text-white active:scale-[0.94] transition-transform"
              style={{ background: "#C92A2A", letterSpacing: "-0.1px" }}>
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════ MOBILE VIEW — EduIntellect v2 ═══════════════════ */}
      <div className="md:hidden animate-in fade-in duration-500" style={{ background: "#EEF4FF", minHeight: "100vh" }}>

        {/* 1. Page title + search toggle + avatar */}
        <div className="flex items-start justify-between gap-3 px-4 pt-[10px] pb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-[7px] text-[9px] font-bold uppercase mb-[6px]" style={{ color: TT3, letterSpacing: "1.8px" }}>
              <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: GREEN, boxShadow: "0 0 8px rgba(0,200,83,0.5)" }} />
              Teacher Dashboard · My Classes
            </div>
            <h1 className="text-[28px] font-bold leading-[1.05]" style={{ color: TT1, letterSpacing: "-1.1px" }}>My Classes</h1>
            <div className="text-[12px] font-medium mt-[6px]" style={{ color: TT3, letterSpacing: "-0.15px" }}>
              {getSemesterLabel()} · {classes.length} assigned
            </div>
          </div>
          <div className="flex items-center gap-[10px] flex-shrink-0 mt-[22px]">
            {/* Search-toggle only — profile + bell live in TeacherHeader globally. */}
            <button type="button"
              onClick={() => {
                // Clear the query when collapsing — otherwise the (invisible)
                // filter remains applied and confuses the user with a partial list.
                if (showSearch) setSearchQuery("");
                setShowSearch(s => !s);
              }}
              aria-label={showSearch ? "Close search" : "Search classes"}
              className="w-10 h-10 rounded-[13px] bg-white flex items-center justify-center active:scale-[0.92] transition-transform"
              style={{ color: B1, boxShadow: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 12px rgba(9,87,247,0.08)" }}>
              {showSearch ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              ) : (
                <Search className="w-[18px] h-[18px]" strokeWidth={2.2} />
              )}
            </button>
          </div>
        </div>

        {/* Inline search — revealed by search icon */}
        {showSearch && (
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[15px] h-[15px]" style={{ color: "rgba(0,85,255,0.40)" }} strokeWidth={2.3} />
              <input type="text" placeholder="Search classes…" autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-12 pl-10 pr-4 rounded-[16px] text-[13px] outline-none"
                style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D, color: TT1, letterSpacing: "-0.1px" }} />
            </div>
          </div>
        )}

        {/* 2. Hero banner — Classroom Overview */}
        <div className="mx-4 mb-[14px] rounded-[26px] p-[22px] relative overflow-hidden cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/attendance')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/attendance'); } }}
          aria-label="Classroom Overview — view attendance details"
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)",
          }}>
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
          }} />
          <div className="relative z-[2]">
            <div className="flex items-center gap-3 mb-[18px]">
              <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white"
                style={{
                  background: "rgba(255,255,255,0.14)",
                  backdropFilter: "blur(22px)",
                  WebkitBackdropFilter: "blur(22px)",
                  border: "0.5px solid rgba(255,255,255,0.22)",
                  boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                }}>
                <BarChart2 className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Classroom Overview</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>{getSemesterLabel()}</div>
              </div>
              <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-bold"
                style={{
                  background: heroBand.bg,
                  border: `0.5px solid ${heroBand.border}`,
                  color: heroBand.color,
                  letterSpacing: "0.3px",
                }}>
                <span className="w-[6px] h-[6px] rounded-full" style={{
                  background: heroBand.dotBg,
                  boxShadow: `0 0 8px ${heroBand.dotBg}`,
                }} />
                {heroBand.label}
              </div>
            </div>
            <div className="text-[56px] font-bold text-white leading-none mb-[8px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-2.6px" }}>
              {avgAtnd != null ? avgAtnd.toFixed(1) : "—"}
              {avgAtnd != null && <span className="text-[28px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-0.8px" }}>%</span>}
            </div>
            <div className="text-[13px] font-medium mb-[20px]" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
              <b className="text-white font-bold">{heroBand.push}</b> across all your classes this term.
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              {[
                { v: avgPerfStr, l: "Perform.", to: '/gradebook' },
                { v: `${totalStudents}`, l: "Students", to: '/students' },
                { v: `${activeCount}/${attentionCount}`, l: "Act./Att.", to: '/risks-alerts' },
              ].map(({ v, l, to }) => (
                <button key={l} type="button"
                  onClick={(e) => { e.stopPropagation(); navigate(to); }}
                  className="py-[13px] px-[6px] text-center active:brightness-110 transition" style={{ background: "rgba(0,20,80,0.55)" }}>
                  <div className="text-[20px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{v}</div>
                  <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>{l}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3. 2×2 stats — click to filter */}
        <div className="grid grid-cols-2 gap-[10px] px-4 mb-[14px]">
          {[
            {
              label: "Total Classes", val: `${classes.length}`, color: B1,
              tintBg: "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)",
              tintBorder: "rgba(0,85,255,0.10)",
              sub: <span className="font-bold" style={{ color: GREEN }}>✓ All assigned</span>,
              filterKey: "All" as FilterType,
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                </svg>
              ),
              decor: (
                <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                </svg>
              ),
            },
            {
              label: "Active", val: `${activeCount}`, color: GREEN,
              tintBg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)",
              tintBorder: "rgba(0,200,83,0.16)",
              sub: activeCount === classes.length && classes.length > 0
                ? <span className="font-bold" style={{ color: GREEN }}>● All running</span>
                : <span className="font-bold" style={{ color: TT3 }}>● {activeCount} of {classes.length}</span>,
              filterKey: "Active" as FilterType,
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="8 12 11 15 16 9"/>
                </svg>
              ),
              decor: (
                <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="8 12 11 15 16 9"/>
                </svg>
              ),
            },
            {
              label: "Attention", val: `${attentionCount}`, color: ORANGE,
              tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)",
              tintBorder: "rgba(255,136,0,0.14)",
              sub: attentionCount === 0
                ? <span className="font-bold" style={{ color: GREEN }}>✓ All clear</span>
                : <span className="font-bold" style={{ color: ORANGE }}>● Needs focus</span>,
              filterKey: "Attention" as FilterType,
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12" y2="16"/>
                </svg>
              ),
              decor: (
                <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <circle cx="12" cy="16" r="0.6" fill="currentColor"/>
                </svg>
              ),
            },
            {
              label: "Students", val: `${totalStudents}`, color: VIOLET,
              tintBg: "linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)",
              tintBorder: "rgba(107,33,232,0.12)",
              sub: classes.length > 0
                ? <span className="font-bold" style={{ color: VIOLET }}>● Across {classes.length} {classes.length === 1 ? "class" : "classes"}</span>
                : <span className="font-semibold" style={{ color: TT3 }}>No classes yet</span>,
              filterKey: null,
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                  <path d="M16 3.13a4 4 0 010 7.75"/>
                </svg>
              ),
              decor: (
                <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                  <path d="M16 3.13a4 4 0 010 7.75"/>
                </svg>
              ),
            },
          ].map(({ label, val, color, tintBg, tintBorder, sub, filterKey, icon, decor }) => {
            const isActive = filterKey !== null && filter === filterKey;
            return (
              <button key={label} type="button"
                onClick={() => {
                  // Filter cards (Total/Active/Attention) drive the filter pill.
                  // Students card (filterKey === null) deep-links to the
                  // Students page — distinct from in-page filtering.
                  if (filterKey) setFilter(filterKey);
                  else navigate('/students');
                }}
                aria-pressed={isActive}
                {...tilt3D}
                className="rounded-[20px] p-4 relative flex flex-col text-left active:scale-[0.96] transition-transform overflow-hidden"
                style={{
                  background: tintBg,
                  boxShadow: isActive
                    ? `0 6px 18px rgba(20,40,90,0.06), 0 1px 3px rgba(20,40,90,0.04), 0 0 0 2px ${color}`
                    : "0 6px 18px rgba(20,40,90,0.06), 0 1px 3px rgba(20,40,90,0.04)",
                  border: `0.5px solid ${tintBorder}`,
                  ...tilt3DStyle,
                }}>
                {/* decorative icon (bottom-right) */}
                <div className="absolute pointer-events-none" style={{ right: 10, bottom: 8, color, opacity: 0.22 }}>
                  {decor}
                </div>
                {/* top-left icon chip */}
                <div className="flex-shrink-0 w-[34px] h-[34px] rounded-[10px] flex items-center justify-center mb-[10px]"
                  style={{ background: `${color}1F`, color }}>
                  {icon}
                </div>
                <div className="text-[10px] font-bold uppercase leading-[1.3] mb-[6px]" style={{ color, letterSpacing: "1px" }}>
                  {label}
                </div>
                <div className="text-[28px] font-bold leading-none" style={{ color: TT1, letterSpacing: "-1.2px" }}>{val}</div>
                <div className="text-[11px] font-semibold mt-[6px] flex items-center gap-[5px] relative" style={{ color: TT3, letterSpacing: "-0.15px" }}>
                  {sub}
                </div>
              </button>
            );
          })}
        </div>

        {/* 4. Section header */}
        <div className="flex items-center justify-between px-5 pb-[10px]">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[18px] font-bold" style={{ color: TT1, letterSpacing: "-0.5px" }}>Your Classes</h2>
            <span className="text-[12px] font-semibold" style={{ color: TT3, letterSpacing: "-0.1px" }}>
              {filter === "All"
                ? `${classes.length} assigned`
                : `${filteredClasses.length} ${filter.toLowerCase()}`}
            </span>
          </div>
          {/* 4-pill filter row — direct selection. Touch target is 36px tall
             (per WCAG 2.5.5 minimum is 44px but compact horizontal lists
             customarily go to 36px). The wrapper adds 6px vertical padding
             so the active hit area is comfortably 48px including margin. */}
          <div role="tablist" aria-label="Filter classes" className="flex items-center gap-[3px] p-[3px] rounded-[12px] bg-white"
            style={{ boxShadow: "0 0.5px 1px rgba(9,87,247,0.05), 0 2px 8px rgba(9,87,247,0.06)" }}>
            {(["All", "Active", "Attention", "Setup"] as FilterType[]).map(f => {
              const isActive = filter === f;
              return (
                <button key={f} type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setFilter(f)}
                  className="h-[36px] px-[10px] rounded-[9px] text-[11px] font-bold transition-all active:scale-[0.94]"
                  style={isActive
                    ? { background: B1, color: "#fff", letterSpacing: "-0.1px", boxShadow: "0 2px 6px rgba(0,85,255,0.28)" }
                    : { background: "transparent", color: TT3, letterSpacing: "-0.1px" }}>
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. Class cards */}
        {filteredClasses.length === 0 ? (
          <div className="mx-4 bg-white rounded-[22px] py-12 px-6 flex flex-col items-center text-center relative overflow-hidden"
            style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}` }}>
            <div className="absolute -top-[50px] -right-[40px] w-[180px] h-[180px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="w-[64px] h-[64px] rounded-[20px] flex items-center justify-center mb-4 relative z-10"
              style={{ background: B1, boxShadow: SH_BTN_D }}>
              <GraduationCap className="w-7 h-7 text-white" strokeWidth={2.2} />
            </div>
            <div className="text-[17px] font-bold mb-1 relative z-10" style={{ color: TT1, letterSpacing: "-0.3px" }}>
              {classes.length === 0 ? "No classes yet" : `No ${filter.toLowerCase()} classes`}
            </div>
            <div className="text-[12px] leading-[1.6] max-w-[240px] relative z-10" style={{ color: TT3 }}>
              {classes.length === 0
                ? "Your principal will assign classes soon. Check back later."
                : searchQuery
                  ? "Try adjusting your search or filters."
                  : `You have no classes in the "${filter}" category.`}
            </div>
          </div>
        ) : (
          <div className="mx-4">
            {filteredClasses.map((cls, idx) => {
              const m        = getMetrics(cls.id);
              const subject  = cls.subject || teacherData?.subject || "Subject";
              const accent   = idx % 2 === 0 ? B1 : VIOLET;

              return (
                <div key={cls.id}
                  onClick={() => navigate(`/my-classes/${cls.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/my-classes/${cls.id}`); }}
                  {...tilt3D}
                  className="bg-white rounded-[22px] p-[18px] mb-3 relative overflow-hidden active:scale-[0.99] transition-transform cursor-pointer"
                  style={{ boxShadow: "0 6px 18px rgba(20,40,90,0.05), 0 1px 3px rgba(20,40,90,0.04)", border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}
                  aria-label={`Open ${cls.name || "class"}`}>
                  {/* Head */}
                  <div className="flex items-start gap-[13px] mb-4">
                    <div className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center flex-shrink-0"
                      style={{ background: `${accent}1A`, color: accent }}>
                      <Home className="w-[22px] h-[22px]" strokeWidth={2.2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[20px] font-bold leading-[1.1] truncate" style={{ color: TT1, letterSpacing: "-0.6px" }}>
                          {cls.name || "Class"}
                        </div>
                        {(() => {
                          const pillTheme = m.attentionState === "attention"
                            ? { bg: "rgba(255,136,0,0.12)", color: ORANGE, dotColor: ORANGE, label: "Attention", pulse: true }
                            : m.attentionState === "no-data"
                              ? { bg: "rgba(140,140,160,0.12)", color: TT3, dotColor: TT4, label: "Setup", pulse: false }
                              : { bg: "rgba(0,200,83,0.12)", color: GREEN, dotColor: GREEN, label: "Active", pulse: true };
                          return (
                            <div className="flex items-center gap-[5px] px-[9px] py-[4px] rounded-full text-[10px] font-bold flex-shrink-0"
                              style={{ background: pillTheme.bg, color: pillTheme.color, letterSpacing: "0.2px" }}>
                              <span className={`w-[6px] h-[6px] rounded-full ${pillTheme.pulse ? "animate-pulse" : ""}`} style={{ background: pillTheme.dotColor }} />
                              {pillTheme.label}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-[5px] text-[11px] font-bold uppercase mt-[4px]" style={{ color: TT3, letterSpacing: "0.6px" }}>
                        {subject}
                        <span style={{ color: TT4 }}>·</span>
                        {m.studentCount} {m.studentCount === 1 ? "student" : "students"}
                      </div>
                    </div>
                  </div>

                  {/* Metrics group */}
                  <div className="rounded-[14px] mb-3 p-[2px]" style={{ background: "#F4F7FE" }}>
                    {[
                      {
                        label: "Attendance", val: m.atndDisplay,
                        valColor: m.atndRaw >= 85 ? GREEN : m.atndRaw != null ? ORANGE : TT4,
                        iconBg: "rgba(9,87,247,0.12)", iconColor: B1,
                        icon: (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="12" width="4" height="9" rx="1"/>
                            <rect x="10" y="8" width="4" height="13" rx="1"/>
                            <rect x="17" y="4" width="4" height="17" rx="1"/>
                          </svg>
                        ),
                      },
                      {
                        label: "Performance", val: m.perfDisplay,
                        valColor: m.perfRaw >= 60 ? GREEN : m.perfRaw != null ? RED : TT4,
                        iconBg: "rgba(123,63,244,0.14)", iconColor: VIOLET,
                        icon: (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                            <polyline points="17 6 23 6 23 12"/>
                          </svg>
                        ),
                      },
                      {
                        label: "Timetable", val: "View",
                        valColor: B1,
                        iconBg: "rgba(255,136,0,0.14)", iconColor: ORANGE,
                        clickable: true,
                        icon: (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                          </svg>
                        ),
                      },
                    ].map((row, i) => (
                      <div key={row.label} className="flex items-center px-[12px] py-[11px] gap-[11px] relative">
                        {i > 0 && (
                          <div className="absolute top-0 left-[46px] right-[12px] h-[0.5px]" style={{ background: "rgba(9,87,247,0.08)" }} />
                        )}
                        <div className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center flex-shrink-0"
                          style={{ background: row.iconBg, color: row.iconColor }}>
                          {row.icon}
                        </div>
                        <div className="flex-1 text-[12px] font-semibold" style={{ color: TT2, letterSpacing: "-0.15px" }}>{row.label}</div>
                        {(row as any).clickable ? (
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); navigate('/timetable'); }}
                            className="flex items-center gap-[3px] px-[10px] py-[4px] rounded-[8px] text-[12px] font-bold active:scale-[0.94] transition-transform"
                            style={{ background: "rgba(0,85,255,0.10)", color: B1, letterSpacing: "-0.2px" }}
                            aria-label="View timetable">
                            View <span className="text-[14px] leading-none -mt-[1px]">›</span>
                          </button>
                        ) : (
                          <div className="text-[14px] font-bold"
                            style={{ color: row.valColor, letterSpacing: "-0.35px", fontWeight: row.val === "—" ? 700 : 800 }}>
                            {row.val}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/my-classes/${cls.id}`); }}
                      className="flex-1 h-11 rounded-[13px] text-[13px] font-bold text-white flex items-center justify-center gap-[6px] active:scale-[0.96] transition-transform"
                      style={{ background: B1, letterSpacing: "-0.2px" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                      View Class
                    </button>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); navigate('/attendance'); }}
                      className="flex-1 h-11 rounded-[13px] text-[13px] font-bold flex items-center justify-center gap-[6px] active:scale-[0.96] transition-transform"
                      style={{ background: "#F4F7FE", color: B1, letterSpacing: "-0.2px" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 11 12 14 22 4"/>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                      </svg>
                      Attendance
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 6. AI Classes Intelligence */}
        <div className="mx-4 mt-[14px] mb-[14px] rounded-[26px] p-[22px] relative overflow-hidden cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/concept-mastery')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/concept-mastery'); } }}
          aria-label="AI Classes Intelligence — view concept mastery insights"
          style={{
            background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
            boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
          }}>
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
          }} />
          <div className="relative z-[2]">
            <div className="flex items-center gap-3 mb-[14px]">
              <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-[20px]"
                style={{
                  background: "rgba(255,255,255,0.14)",
                  backdropFilter: "blur(22px)",
                  WebkitBackdropFilter: "blur(22px)",
                  border: "0.5px solid rgba(255,255,255,0.22)",
                  color: "#FFDD55",
                  boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                }}>⚡</div>
              <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>AI Classes Intelligence</div>
              <div className="ml-auto px-[10px] py-[4px] rounded-full text-[9px] font-bold"
                style={{
                  background: "rgba(123,63,244,0.3)",
                  border: "0.5px solid rgba(155,95,255,0.5)",
                  color: "#DCC8FF",
                  letterSpacing: "0.5px",
                }}>Tip</div>
            </div>
            <div className="text-[13px] font-normal leading-[1.6] mb-[18px]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
              {classes.length === 0
                ? <>No classes assigned yet — your <strong>principal</strong> will link classes to your account. Once that's done, performance and attendance will show up here.</>
                : attentionCount > 0
                  ? <>
                      <strong>{attentionCount}</strong> {attentionCount === 1 ? "class needs" : "classes need"} attention — tap <strong>Attention</strong> above to filter.
                      {avgAtnd != null && <> Average attendance is <strong>{avgAtndStr}</strong>.</>}
                    </>
                  : <>
                      All classes are <strong>tracking well</strong>
                      {avgAtnd != null && <> — average attendance is <strong>{avgAtndStr}</strong></>}
                      . Keep engaging — check back after the next attendance cycle.
                    </>
              }
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/attendance'); }}
                className="py-[13px] px-[6px] text-center active:brightness-110 transition"
                style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[19px] font-bold" style={{ color: heroBand.gridText, letterSpacing: "-0.5px" }}>
                  {avgAtndStr}
                </div>
                <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attend.</div>
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/gradebook'); }}
                className="py-[13px] px-[6px] text-center active:brightness-110 transition"
                style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[19px] font-bold" style={{ color: perfGridColor, letterSpacing: "-0.5px" }}>
                  {avgPerfStr}
                </div>
                <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Perform.</div>
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/students'); }}
                className="py-[13px] px-[6px] text-center active:brightness-110 transition"
                style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[19px] font-bold text-white" style={{ letterSpacing: "-0.5px" }}>{totalStudents}</div>
                <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Students</div>
              </button>
            </div>
          </div>
        </div>

        <div className="h-2" />
      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div className="hidden md:block animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
        style={{ background: "#EEF4FF" }}>
        <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-12">

          {/* Header row */}
          <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
            <div>
              <div className="flex items-center gap-[7px] text-[10px] font-bold uppercase mb-[8px]" style={{ color: TT3, letterSpacing: "1.8px" }}>
                <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: GREEN, boxShadow: "0 0 8px rgba(0,200,83,0.5)" }} />
                Teacher Dashboard · My Classes
              </div>
              <h1 className="text-[36px] font-bold leading-[1.05]" style={{ color: TT1, letterSpacing: "-1.2px" }}>My Classes</h1>
              <div className="text-[14px] font-medium mt-[6px]" style={{ color: TT3, letterSpacing: "-0.15px" }}>
                {getSemesterLabel()} · {classes.length} assigned {classes.length === 1 ? "class" : "classes"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Search only — profile + bell live in TeacherHeader globally. */}
              <div className="relative">
                <Search className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[15px] h-[15px]" style={{ color: "rgba(0,85,255,0.40)" }} strokeWidth={2.3} />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search classes…"
                  className="pl-10 pr-5 py-[12px] rounded-[14px] text-[13px] outline-none w-[280px]"
                  style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D, color: TT1, letterSpacing: "-0.1px" }} />
              </div>
            </div>
          </div>

          {/* HERO banner — Classroom Overview */}
          <div className="rounded-[28px] px-8 py-8 relative overflow-hidden mb-5 cursor-pointer"
            role="button"
            tabIndex={0}
            onClick={() => navigate('/attendance')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/attendance'); } }}
            aria-label="Classroom Overview — view attendance details"
            style={{
              background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
              boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)",
            }}>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
            }} />
            <div className="relative z-[2]">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-[52px] h-[52px] rounded-[15px] flex items-center justify-center text-white"
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    backdropFilter: "blur(22px)",
                    WebkitBackdropFilter: "blur(22px)",
                    border: "0.5px solid rgba(255,255,255,0.22)",
                    boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                  }}>
                  <BarChart2 className="w-6 h-6" strokeWidth={2.2} />
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Classroom Overview</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>{getSemesterLabel()}</div>
                </div>
                <div className="ml-auto flex items-center gap-[6px] px-4 py-[7px] rounded-full text-[11px] font-bold"
                  style={{
                    background: heroBand.bg,
                    border: `0.5px solid ${heroBand.border}`,
                    color: heroBand.color,
                    letterSpacing: "0.3px",
                  }}>
                  <span className="w-[6px] h-[6px] rounded-full" style={{
                    background: heroBand.dotBg,
                    boxShadow: `0 0 8px ${heroBand.dotBg}`,
                  }} />
                  {heroBand.label}
                </div>
              </div>
              <div className="flex items-end justify-between gap-8 flex-wrap">
                <div>
                  <div className="text-[84px] font-bold text-white leading-none mb-[6px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-3.8px" }}>
                    {avgAtnd != null ? avgAtnd.toFixed(1) : "—"}
                    {avgAtnd != null && <span className="text-[40px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-1px" }}>%</span>}
                  </div>
                  <div className="text-[14px] font-medium" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
                    <b className="text-white font-bold">{heroBand.push}</b> across all your classes this term.
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[380px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  {[
                    { v: avgPerfStr, l: "Perform.", to: '/gradebook' },
                    { v: `${totalStudents}`, l: "Students", to: '/students' },
                    { v: `${activeCount}/${attentionCount}`, l: "Act./Att.", to: '/risks-alerts' },
                  ].map(({ v, l, to }) => (
                    <button key={l} type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(to); }}
                      className="py-4 px-5 text-center hover:brightness-110 transition" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[26px] font-bold text-white" style={{ letterSpacing: "-0.8px" }}>{v}</div>
                      <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>{l}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 4-column stat cards */}
          <div className="grid grid-cols-4 gap-4 mb-5">
            {[
              {
                label: "Total Classes", val: `${classes.length}`, color: B1,
                tintBg: "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)",
                tintBorder: "rgba(0,85,255,0.10)",
                sub: <span className="font-bold" style={{ color: GREEN }}>✓ All assigned</span>,
                filterKey: "All" as FilterType,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                  </svg>
                ),
                decor: (
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                  </svg>
                ),
              },
              {
                label: "Active", val: `${activeCount}`, color: GREEN,
                tintBg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)",
                tintBorder: "rgba(0,200,83,0.16)",
                sub: activeCount === classes.length && classes.length > 0
                  ? <span className="font-bold" style={{ color: GREEN }}>● All running</span>
                  : <span className="font-bold" style={{ color: TT3 }}>● {activeCount} of {classes.length}</span>,
                filterKey: "Active" as FilterType,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="8 12 11 15 16 9"/>
                  </svg>
                ),
                decor: (
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="8 12 11 15 16 9"/>
                  </svg>
                ),
              },
              {
                label: "Attention", val: `${attentionCount}`, color: ORANGE,
                tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)",
                tintBorder: "rgba(255,136,0,0.14)",
                sub: attentionCount === 0
                  ? <span className="font-bold" style={{ color: GREEN }}>✓ All clear</span>
                  : <span className="font-bold" style={{ color: ORANGE }}>● Needs focus</span>,
                filterKey: "Attention" as FilterType,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12" y2="16"/>
                  </svg>
                ),
                decor: (
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <circle cx="12" cy="16" r="0.6" fill="currentColor"/>
                  </svg>
                ),
              },
              {
                label: "Students", val: `${totalStudents}`, color: VIOLET,
                tintBg: "linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)",
                tintBorder: "rgba(107,33,232,0.12)",
                sub: classes.length > 0
                  ? <span className="font-bold" style={{ color: VIOLET }}>● Across {classes.length} {classes.length === 1 ? "class" : "classes"}</span>
                  : <span className="font-semibold" style={{ color: TT3 }}>No classes yet</span>,
                filterKey: null,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                    <path d="M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                ),
                decor: (
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                    <path d="M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                ),
              },
            ].map(({ label, val, color, tintBg, tintBorder, sub, filterKey, icon, decor }) => {
              const isActive = filterKey !== null && filter === filterKey;
              return (
                <button key={label} type="button"
                  onClick={() => {
                    if (filterKey) setFilter(filterKey);
                    else navigate('/students');
                  }}
                  aria-pressed={isActive}
                  {...tilt3D}
                  className="rounded-[22px] p-5 relative flex flex-col text-left active:scale-[0.98] transition-all overflow-hidden"
                  style={{
                    background: tintBg,
                    boxShadow: isActive
                      ? `0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04), 0 0 0 2px ${color}`
                      : "0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04)",
                    border: `0.5px solid ${tintBorder}`,
                    ...tilt3DStyle,
                  }}>
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
                  <div className="text-[36px] font-bold leading-none" style={{ color: TT1, letterSpacing: "-1.6px", transform: "translateZ(10px)" }}>{val}</div>
                  <div className="text-[12px] font-semibold mt-2 flex items-center gap-[5px] relative" style={{ color: TT3, letterSpacing: "-0.15px" }}>
                    {sub}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Section header + sort */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[22px] font-bold" style={{ color: TT1, letterSpacing: "-0.6px" }}>Your Classes</h2>
              <span className="text-[13px] font-semibold" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                {filter === "All"
                  ? `${classes.length} assigned`
                  : `${filteredClasses.length} ${filter.toLowerCase()}`}
              </span>
            </div>
            {/* 3-pill filter row — direct selection */}
            <div role="tablist" aria-label="Filter classes" className="flex items-center gap-[4px] p-[3px] rounded-[13px] bg-white"
              style={{ boxShadow: "0 0.5px 1px rgba(9,87,247,0.05), 0 2px 8px rgba(9,87,247,0.06)" }}>
              {(["All", "Active", "Attention", "Setup"] as FilterType[]).map(f => {
                const isActive = filter === f;
                return (
                  <button key={f} type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setFilter(f)}
                    className="h-[30px] px-3 rounded-[10px] text-[12px] font-bold transition-all hover:scale-[1.02] active:scale-[0.96]"
                    style={isActive
                      ? { background: B1, color: "#fff", letterSpacing: "-0.1px", boxShadow: "0 2px 6px rgba(0,85,255,0.28)" }
                      : { background: "transparent", color: TT3, letterSpacing: "-0.1px" }}>
                    {f}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Class cards grid */}
          {filteredClasses.length === 0 ? (
            <div className="bg-white rounded-[22px] py-16 px-8 flex flex-col items-center text-center relative overflow-hidden mb-5"
              style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}` }}>
              <div className="absolute -top-[60px] -right-[40px] w-[240px] h-[240px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
              <div className="w-[80px] h-[80px] rounded-[22px] flex items-center justify-center mb-5 relative z-10"
                style={{ background: B1, boxShadow: SH_BTN_D }}>
                <GraduationCap className="w-9 h-9 text-white" strokeWidth={2.2} />
              </div>
              <div className="text-[22px] font-bold mb-2 relative z-10" style={{ color: TT1, letterSpacing: "-0.5px" }}>
                {classes.length === 0 ? "No classes yet" : `No ${filter.toLowerCase()} classes`}
              </div>
              <div className="text-[14px] leading-[1.6] max-w-[420px] relative z-10" style={{ color: TT3 }}>
                {classes.length === 0
                  ? "Your principal will assign classes soon. Check back later."
                  : searchQuery
                    ? "Try adjusting your search or filters."
                    : `You have no classes in the "${filter}" category.`}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
              {filteredClasses.map((cls, idx) => {
                const m        = getMetrics(cls.id);
                const subject  = cls.subject || teacherData?.subject || "Subject";
                const accent   = idx % 2 === 0 ? B1 : VIOLET;

                return (
                  <div key={cls.id}
                    onClick={() => navigate(`/my-classes/${cls.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/my-classes/${cls.id}`); }}
                    {...tilt3D}
                    className="bg-white rounded-[22px] p-[22px] relative overflow-hidden active:scale-[0.99] transition-all cursor-pointer"
                    style={{ boxShadow: "0 8px 24px rgba(20,40,90,0.05), 0 2px 6px rgba(20,40,90,0.04)", border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}
                    aria-label={`Open ${cls.name || "class"}`}>
                    {/* Head */}
                    <div className="flex items-start gap-[14px] mb-4">
                      <div className="w-[54px] h-[54px] rounded-[15px] flex items-center justify-center flex-shrink-0"
                        style={{ background: `${accent}1A`, color: accent }}>
                        <Home className="w-[26px] h-[26px]" strokeWidth={2.2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[22px] font-bold leading-[1.1] truncate" style={{ color: TT1, letterSpacing: "-0.6px" }}>
                            {cls.name || "Class"}
                          </div>
                          {(() => {
                            const pillTheme = m.attentionState === "attention"
                              ? { bg: "rgba(255,136,0,0.12)", color: ORANGE, dotColor: ORANGE, label: "Attention", pulse: true }
                              : m.attentionState === "no-data"
                                ? { bg: "rgba(140,140,160,0.12)", color: TT3, dotColor: TT4, label: "Setup", pulse: false }
                                : { bg: "rgba(0,200,83,0.12)", color: GREEN, dotColor: GREEN, label: "Active", pulse: true };
                            return (
                              <div className="flex items-center gap-[5px] px-[10px] py-[5px] rounded-full text-[10px] font-bold flex-shrink-0"
                                style={{ background: pillTheme.bg, color: pillTheme.color, letterSpacing: "0.2px" }}>
                                <span className={`w-[6px] h-[6px] rounded-full ${pillTheme.pulse ? "animate-pulse" : ""}`} style={{ background: pillTheme.dotColor }} />
                                {pillTheme.label}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-[5px] text-[11px] font-bold uppercase mt-[5px]" style={{ color: TT3, letterSpacing: "0.6px" }}>
                          {subject}
                          <span style={{ color: TT4 }}>·</span>
                          {m.studentCount} {m.studentCount === 1 ? "student" : "students"}
                        </div>
                      </div>
                    </div>

                    {/* Metrics group */}
                    <div className="rounded-[14px] mb-4 p-[3px]" style={{ background: "#F4F7FE" }}>
                      {[
                        {
                          label: "Attendance", val: m.atndDisplay,
                          valColor: m.atndRaw >= 85 ? GREEN : m.atndRaw != null ? ORANGE : TT4,
                          iconBg: "rgba(9,87,247,0.12)", iconColor: B1,
                          icon: (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="12" width="4" height="9" rx="1"/>
                              <rect x="10" y="8" width="4" height="13" rx="1"/>
                              <rect x="17" y="4" width="4" height="17" rx="1"/>
                            </svg>
                          ),
                        },
                        {
                          label: "Performance", val: m.perfDisplay,
                          valColor: m.perfRaw >= 60 ? GREEN : m.perfRaw != null ? RED : TT4,
                          iconBg: "rgba(123,63,244,0.14)", iconColor: VIOLET,
                          icon: (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                              <polyline points="17 6 23 6 23 12"/>
                            </svg>
                          ),
                        },
                        {
                          label: "Timetable", val: "View",
                          valColor: B1,
                          iconBg: "rgba(255,136,0,0.14)", iconColor: ORANGE,
                          clickable: true,
                          icon: (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="4" width="18" height="18" rx="2"/>
                              <line x1="16" y1="2" x2="16" y2="6"/>
                              <line x1="8" y1="2" x2="8" y2="6"/>
                              <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                          ),
                        },
                      ].map((row, i) => (
                        <div key={row.label} className="flex items-center px-[13px] py-[12px] gap-[12px] relative">
                          {i > 0 && (
                            <div className="absolute top-0 left-[50px] right-[13px] h-[0.5px]" style={{ background: "rgba(9,87,247,0.08)" }} />
                          )}
                          <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0"
                            style={{ background: row.iconBg, color: row.iconColor }}>
                            {row.icon}
                          </div>
                          <div className="flex-1 text-[13px] font-semibold" style={{ color: TT2, letterSpacing: "-0.15px" }}>{row.label}</div>
                          {(row as any).clickable ? (
                            <button type="button"
                              onClick={(e) => { e.stopPropagation(); navigate('/timetable'); }}
                              className="flex items-center gap-[3px] px-3 py-[5px] rounded-[9px] text-[13px] font-bold hover:scale-[1.04] active:scale-[0.96] transition-transform"
                              style={{ background: "rgba(0,85,255,0.10)", color: B1, letterSpacing: "-0.2px" }}
                              aria-label="View timetable">
                              View <span className="text-[15px] leading-none -mt-[1px]">›</span>
                            </button>
                          ) : (
                            <div className="text-[15px] font-bold"
                              style={{ color: row.valColor, letterSpacing: "-0.35px", fontWeight: row.val === "—" ? 700 : 800 }}>
                              {row.val}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/my-classes/${cls.id}`); }}
                        className="flex-1 h-12 rounded-[13px] text-[13px] font-bold text-white flex items-center justify-center gap-[6px] hover:scale-[1.02] active:scale-[0.96] transition-transform"
                        style={{ background: B1, letterSpacing: "-0.2px" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                        View Class
                      </button>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); navigate('/attendance'); }}
                        className="flex-1 h-12 rounded-[13px] text-[13px] font-bold flex items-center justify-center gap-[6px] hover:scale-[1.02] active:scale-[0.96] transition-transform"
                        style={{ background: "#F4F7FE", color: B1, letterSpacing: "-0.2px" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 11 12 14 22 4"/>
                          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                        </svg>
                        Attendance
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* AI Classes Intelligence */}
          <div className="rounded-[26px] p-7 relative overflow-hidden cursor-pointer"
            role="button"
            tabIndex={0}
            onClick={() => navigate('/concept-mastery')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/concept-mastery'); } }}
            aria-label="AI Classes Intelligence — view concept mastery insights"
            style={{
              background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
              boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
            }}>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
            }} />
            <div className="relative z-[2]">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-[48px] h-[48px] rounded-[14px] flex items-center justify-center text-[22px]"
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    backdropFilter: "blur(22px)",
                    WebkitBackdropFilter: "blur(22px)",
                    border: "0.5px solid rgba(255,255,255,0.22)",
                    color: "#FFDD55",
                    boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                  }}>⚡</div>
                <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>AI Classes Intelligence</div>
                <div className="ml-auto px-[11px] py-[5px] rounded-full text-[10px] font-bold"
                  style={{
                    background: "rgba(123,63,244,0.3)",
                    border: "0.5px solid rgba(155,95,255,0.5)",
                    color: "#DCC8FF",
                    letterSpacing: "0.5px",
                  }}>Tip</div>
              </div>
              <div className="text-[14px] font-normal leading-[1.6] mb-5" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                {classes.length === 0
                  ? <>No classes assigned yet — your <strong>principal</strong> will link classes to your account. Once that's done, performance and attendance will show up here.</>
                  : attentionCount > 0
                    ? <>
                        <strong>{attentionCount}</strong> {attentionCount === 1 ? "class needs" : "classes need"} attention — click <strong>Attention</strong> above to filter.
                        {avgAtnd != null && <> Average attendance is <strong>{avgAtndStr}</strong>.</>}
                      </>
                    : <>
                        All classes are <strong>tracking well</strong>
                        {avgAtnd != null && <> — average attendance is <strong>{avgAtndStr}</strong></>}
                        . Keep engaging — check back after the next attendance cycle.
                      </>
                }
              </div>
              <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/attendance'); }}
                  className="py-4 px-3 text-center hover:brightness-110 transition"
                  style={{ background: "rgba(0,20,80,0.55)" }}>
                  <div className="text-[22px] font-bold" style={{ color: heroBand.gridText, letterSpacing: "-0.6px" }}>
                    {avgAtndStr}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attend.</div>
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/gradebook'); }}
                  className="py-4 px-3 text-center hover:brightness-110 transition"
                  style={{ background: "rgba(0,20,80,0.55)" }}>
                  <div className="text-[22px] font-bold" style={{ color: perfGridColor, letterSpacing: "-0.6px" }}>
                    {avgPerfStr}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Perform.</div>
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/students'); }}
                  className="py-4 px-3 text-center hover:brightness-110 transition"
                  style={{ background: "rgba(0,20,80,0.55)" }}>
                  <div className="text-[22px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{totalStudents}</div>
                  <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Students</div>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default MyClasses;
