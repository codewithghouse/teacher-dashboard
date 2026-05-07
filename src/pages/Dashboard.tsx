import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import {
  collection, query, where, onSnapshot, doc,
  type QueryConstraint, type Unsubscribe,
} from 'firebase/firestore';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tilt3D, tilt3DStyle, BLUE_SHADOW, BLUE_SHADOW_LG } from '../lib/use3DTilt';

// ── Score normalization (canonical) ───────────────────────────────────────────
// Returns 0-100 percentage from any score doc shape, or null if no data.
// Covers: test_scores (score+maxScore), gradebook_scores (mark+maxMarks),
// results (score, sometimes percentage). Returning null (not 0) preserves
// the "no data" signal so untested students aren't conflated with 0% scorers.
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
  // No max → assume already 0-100 if in range
  if (rawNum >= 0 && rawNum <= 100) return rawNum;
  return null;
};

// Local-date YYYY-MM-DD (matches teacher writers like MarkAttendance).
// `new Date().toISOString().split('T')[0]` returns UTC date — for IST users
// past 6:30 PM, it advances to "tomorrow" and breaks day-key joins.
const todayLocalKey = () => new Date().toLocaleDateString("en-CA");

// Day-of-week label matching common timetable storage ("Mon"/"Tue" etc.)
const todayDayLabels = (): string[] => {
  const long = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const short = new Date().toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  return [long, short]; // assignments may store either form
};

// Parse "HH:MM" / "HH:MM AM" → minutes since midnight; null if unparseable.
const parseStartMinutes = (raw: any): number | null => {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]); const mm = Number(m[2]); const ap = m[3]?.toLowerCase();
  if (Number.isNaN(h) || Number.isNaN(mm)) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h * 60 + mm;
};

// Resolve a doc's writer timestamp from any of the known fields. Different
// score writers use different fields (test_scores: timestamp, gradebook_scores:
// updatedAt, results: createdAt) — enumerate per `bug_pattern_filterbytime_field_drift`.
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

// 90-day score window — scores older than this don't reflect a student's
// CURRENT performance. Bounds the "is this student at-risk right now"
// assessment so a student who recovered after an early slump isn't still
// flagged years later.
const SCORE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// ── Timetable types + parser ──────────────────────────────────────────────
// Singleton doc: timetable_documents/{schoolId}_{branchSeg}. Sheets are stored
// as {name, headers, rows: [{cells: [...]}]} (cells wrapped due to Firestore's
// no-nested-arrays rule).
interface TimetableSheet { name: string; headers: string[]; rows: { cells: string[] }[]; }
interface TimetableDoc { sheets?: TimetableSheet[]; fileName?: string; }

interface TodayClassEntry {
  className: string;
  classId: string | null;
  subject: string;
  time: string;
  period: string;
  startMin: number | null;
  endMin: number | null;
  isNow: boolean;
  students: number;
  source: "timetable" | "assignments";
}

// Normalize ANY class label form into a stable key — mirrors the canonical
// pattern from `bug_pattern_class_label_normalization` memory. Critical: must
// produce SAME key for "Class 9A" / "Class 9 A" / "Grade 9-A" / "9A" / "9 A"
// so timetable sheet names match attendance.className regardless of input.
//
// Rules:
//  - strip "Class/Grade/Gr/Std/Standard" prefix
//  - strip ALL separators between digit-run and section letter (space, dash,
//    underscore) — "9 A" / "9-A" / "9_A" all collapse to "9a"
//  - preserve stream qualifiers ("Class 11 Science" stays distinct from
//    "Class 11 Commerce")
//  - handle Roman numerals (I, II, ... XII)
const ROMAN_TO_NUM: Record<string, string> = {
  i:"1", ii:"2", iii:"3", iv:"4", v:"5", vi:"6", vii:"7",
  viii:"8", ix:"9", x:"10", xi:"11", xii:"12",
};
const normalizeClassKey = (raw: any): string => {
  if (typeof raw !== "string") return "";
  let s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  s = s.replace(/^(class|grade|gr|standard|std)\s+/, "");

  // Path A — leading digit-run with optional separator + letter suffix + rest.
  // "10a" / "10 a" / "10-a" / "10_a" all collapse to "10a".
  // "Class 11 Science" / "Class 11 Commerce" stay distinct via the rest.
  const mLead = s.match(/^(\d{1,2})\s*[-_\s]*([a-z]*)\s*(.*)$/);
  if (mLead) {
    const [, num, suffix, rest] = mLead;
    const tailClean = rest.trim().replace(/\s+/g, "");
    return `${num}${suffix || ""}${tailClean}`;
  }

  // Path B — Roman numeral leading token (I, II, ..., XII)
  const tok = s.split(/\s+/)[0];
  if (ROMAN_TO_NUM[tok]) {
    const tail = s.replace(new RegExp(`^${tok}\\s*`), "").trim().replace(/\s+/g, "");
    return `${ROMAN_TO_NUM[tok]}${tail}`;
  }

  // Path C — digit-run anywhere (covers "Math 9A" / "Sec 9 A" / weird formats).
  // Match first digit + adjacent optional letter so "Math 9A" → "9a" matches
  // class doc "Class 9A" → "9a".
  const mAny = s.match(/(\d{1,2})\s*[-_\s]*([a-z]?)/);
  if (mAny) {
    const [, num, suffix] = mAny;
    return `${num}${suffix || ""}`;
  }

  // Path D — non-numeric labels (Nursery / LKG / UKG / Pre-K)
  return s.replace(/[^a-z0-9]+/g, "");
};

// Day-label detector: any string starting with sun/mon/tue/wed/thu/fri/sat.
const dayLikeRe = /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)/i;
const isDayLabel = (s: any): boolean =>
  typeof s === "string" && dayLikeRe.test(s.trim());

const matchesToday = (s: any): boolean => {
  if (typeof s !== "string") return false;
  const t = s.trim().toLowerCase();
  if (!t) return false;
  const long = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const short = new Date().toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  return t === long || t === short || t.startsWith(short);
};

// Walk every sheet/row/cell. For each cell containing the teacher's name AND
// where the day axis (row's first cell OR column header) matches today,
// produce a TodayClassEntry. Layout-agnostic — covers both rows-as-days and
// columns-as-days timetables.
const parseTodayFromTimetable = (
  tt: TimetableDoc | null,
  teacherName: string,
  classNameToId: Map<string, string>,
  enrollmentsByClassId: Map<string, number>,
): Omit<TodayClassEntry, "isNow">[] => {
  if (!tt?.sheets || !teacherName.trim()) return [];
  const teacherLower = teacherName.trim().toLowerCase();
  const out: Omit<TodayClassEntry, "isNow">[] = [];

  for (const sheet of tt.sheets) {
    const className = String(sheet.name || "").trim();
    const headers = sheet.headers || [];
    const rows = sheet.rows || [];

    // Layout heuristic: look at first 7 rows' first cells AND headers.
    const headerDayCount = headers.filter(isDayLabel).length;
    const firstColDayCount = rows.slice(0, 8).filter(r => isDayLabel(r.cells?.[0] || "")).length;
    const layoutRowsAreDays = firstColDayCount >= 2 && firstColDayCount >= headerDayCount;
    const layoutColsAreDays = headerDayCount >= 2 && headerDayCount > firstColDayCount;

    rows.forEach(row => {
      const cells = row.cells || [];
      cells.forEach((cell, ci) => {
        if (typeof cell !== "string" || !cell.trim()) return;
        if (!cell.toLowerCase().includes(teacherLower)) return;

        let dayCell: string | null = null;
        let timeCell: string | null = null;

        if (layoutRowsAreDays) {
          dayCell = cells[0] || null;
          timeCell = headers[ci] || null;
        } else if (layoutColsAreDays) {
          dayCell = headers[ci] || null;
          timeCell = cells[0] || null;
        } else {
          // Fallback: try whichever side is a day-label
          if (isDayLabel(cells[0])) { dayCell = cells[0]; timeCell = headers[ci] || null; }
          else if (isDayLabel(headers[ci])) { dayCell = headers[ci]; timeCell = cells[0] || null; }
        }

        if (!dayCell || !matchesToday(dayCell)) return;

        // Subject: take the segment before " - " or "(" or newline (cell often
        // looks like "Math - Mr. Khan" or "Math\nKhan"). Fallback to raw.
        const subjectGuess = cell.split(/[\n(]|\s+-\s+/)[0]?.trim() || cell.trim();

        // Time parse: split "8:00-9:00 AM" / "8 - 9" / "8:00 to 9:00"
        const timeRange = String(timeCell || "");
        const [startStr, endStr] = timeRange.split(/[-–—]|to/i).map(s => (s || "").trim());
        const startMin = parseStartMinutes(startStr);
        const endMin = parseStartMinutes(endStr);

        const classId = classNameToId.get(normalizeClassKey(className)) || null;
        const studentCount = classId ? (enrollmentsByClassId.get(classId) || 0) : 0;

        out.push({
          className,
          classId,
          subject: subjectGuess,
          time: timeRange || (startStr || "—"),
          period: "",
          startMin,
          endMin,
          students: studentCount,
          source: "timetable",
        });
      });
    });
  }

  return out;
};

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  surface0: '#FFFFFF', surface1: '#F5F6F9', surface2: '#ECEEF4',
  border: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF', blueB: '#BAC8FF',
  green: '#087F5B', greenL: '#EBFBEE', greenB: '#8CE99A',
  red: '#C92A2A', redL: '#FFF5F5', redB: '#FFC9C9',
  amber: '#C87014', amberL: '#FFF9DB', amberB: '#FFE066',
  purple: '#6741D9', purpleL: '#F3F0FF', purpleB: '#D0BFFF',
  teal: '#0C8599', tealL: '#E3FAFC',
  orange: '#D9480F', orangeL: '#FFF4E6',
};

// ── Inline SVG stroke icons (1.5px, round caps) ───────────────────────────────
const IcoBarChart = ({ size = 16, color = T.blue }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="8.5" width="3" height="6" rx="0.5"/>
    <rect x="6.5" y="5.5" width="3" height="9" rx="0.5"/>
    <rect x="11.5" y="2.5" width="3" height="12" rx="0.5"/>
  </svg>
);
const IcoClipboard = ({ size = 16, color = T.amber }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="2.5" width="10" height="12" rx="1.5"/>
    <path d="M6 2.5V1.5"/>
    <path d="M10 2.5V1.5"/>
    <path d="M5.5 2.5h5"/>
    <line x1="5" y1="7" x2="11" y2="7"/>
    <line x1="5" y1="10" x2="9" y2="10"/>
  </svg>
);
const IcoAlert = ({ size = 16, color = T.red }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2L1.5 13.5h13L8 2z"/>
    <line x1="8" y1="6.5" x2="8" y2="9.5"/>
    <circle cx="8" cy="11.5" r="0.5" fill={color} stroke="none"/>
  </svg>
);
const IcoHome = ({ size = 16, color = T.purple }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 7L8 1.5 14 7"/>
    <path d="M3.5 6V14H12.5V6"/>
    <rect x="6" y="10" width="4" height="4" rx="0.5"/>
  </svg>
);
const IcoCalendar = ({ size = 16, color = T.blue }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="2.5" width="13" height="12" rx="1.5"/>
    <line x1="1.5" y1="6.5" x2="14.5" y2="6.5"/>
    <line x1="5" y1="1" x2="5" y2="4"/>
    <line x1="11" y1="1" x2="11" y2="4"/>
  </svg>
);
const IcoCheck = ({ size = 16, color = T.amber }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6"/>
    <path d="M5.5 8.5l2 2 3.5-4"/>
  </svg>
);
const IcoBell = ({ size = 20, color = 'rgba(255,255,255,0.7)' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 3a5 5 0 015 5v3.5l1.5 2H3.5L5 11.5V8a5 5 0 015-5z"/>
    <path d="M8 15.5a2 2 0 004 0"/>
  </svg>
);
const IcoCheckFilled = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6l2.5 2.5 5-5"/>
  </svg>
);

const Dashboard = () => {
  const { teacherData } = useAuth();
  const navigate = useNavigate();

  // ── Auth-derived constants ─────────────────────────────────────────────────
  const tId = teacherData?.id || null;
  const tEmail = teacherData?.email?.toLowerCase() || null;
  const schoolId = (teacherData?.schoolId as string | undefined) || null;
  const branchId = (teacherData?.branchId as string | undefined) || null;

  // ── Per-collection raw state (real-time onSnapshot) ────────────────────────
  // Resolution entities (subEntity — branch-filtered): classes/assignments are
  // bounded to the principal's branch scope.
  const [teacherAssignments, setTeacherAssignments] = useState<any[]>([]);
  const [teacherClassesById, setTeacherClassesById] = useState<any[]>([]);
  const [teacherClassesByOldKey, setTeacherClassesByOldKey] = useState<any[]>([]);
  const [emailAssignments, setEmailAssignments] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);

  // Event streams (subEvent — schoolId+teacherId only, NEVER branchId).
  // Branch-filter on event collections silently drops rows whose branchId
  // drifts — see bug_pattern_branch_filter_on_event_streams.
  const [attendanceLogs, setAttendanceLogs] = useState<any[]>([]);
  const [testScoreDocs, setTestScoreDocs] = useState<any[]>([]);
  const [gradebookScoreDocs, setGradebookScoreDocs] = useState<any[]>([]);
  const [resultDocs, setResultDocs] = useState<any[]>([]);
  const [gradebookColumnDocs, setGradebookColumnDocs] = useState<any[]>([]);

  // Notifications (bell icon) live in TeacherHeader globally. No state here.

  // Timetable singleton — canonical source for "what's actually scheduled today".
  // Falls back to assignments-based logic when the school hasn't published one.
  const [timetable, setTimetable] = useState<TimetableDoc | null>(null);

  // Loading + error + retry
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Listener wiring ────────────────────────────────────────────────────────
  // Each collection gets its own listener with its own cleanup. `cancelled`
  // flag prevents stale state writes during deps-change tear-down. Errors
  // propagate to a single `error` state which a banner UI can display.

  // Teacher's OWN resolution entities — schoolId only, NOT branchId.
  // teacherId / teacherEmail IS the isolation key here; adding branchId is
  // both redundant (uniqueness already enforced) AND a silent-drop risk
  // when assignment.branchId drifts from teacher.branchId (legacy migrations,
  // multi-branch teachers, branchId inference-lag from cloud trigger).
  // Per `bug_pattern_branch_filter_on_event_streams` — branch filter belongs
  // on principal-style "all teachers in my branch" queries, not the teacher
  // viewing their OWN assignments.
  useEffect(() => {
    if (!tId || !schoolId) return;
    let cancelled = false;
    const unsubs: Unsubscribe[] = [];
    const errH = (err: any) => { if (!cancelled) { console.error("Dashboard listener error:", err); setError(err?.message || "Failed to load data"); } };

    const SC_TENANT: QueryConstraint[] = [where("schoolId", "==", schoolId)];

    // teaching_assignments by teacherId
    unsubs.push(onSnapshot(
      query(collection(db, "teaching_assignments"), where("teacherId", "==", tId), ...SC_TENANT),
      snap => { if (!cancelled) setTeacherAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      errH
    ));

    // teaching_assignments by teacherEmail (covers email-keyed writes — Tier 2)
    if (tEmail) {
      unsubs.push(onSnapshot(
        query(collection(db, "teaching_assignments"), where("teacherEmail", "==", tEmail), ...SC_TENANT),
        snap => { if (!cancelled) setEmailAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
        errH
      ));
    } else {
      setEmailAssignments([]);
    }

    // classes (legacy) by teacherId — exposes class as a pseudo-assignment
    unsubs.push(onSnapshot(
      query(collection(db, "classes"), where("teacherId", "==", tId), ...SC_TENANT),
      snap => { if (!cancelled) setTeacherClassesById(snap.docs.map(d => ({ id: d.id, ...d.data(), classId: d.id, className: (d.data() as any).name }))); },
      errH
    ));

    // classes (legacy) by teacher_id (older snake_case writers)
    unsubs.push(onSnapshot(
      query(collection(db, "classes"), where("teacher_id", "==", tId), ...SC_TENANT),
      snap => { if (!cancelled) setTeacherClassesByOldKey(snap.docs.map(d => ({ id: d.id, ...d.data(), classId: d.id, className: (d.data() as any).name }))); },
      errH
    ));

    return () => {
      cancelled = true;
      unsubs.forEach(u => u());
    };
  }, [tId, tEmail, schoolId, refreshKey]);

  // subEvent — schoolId+teacherId only (no branchId).
  // teacherId IS the attribution key; branchId on events causes silent drops
  // when writer's branchId drifts (legacy migrations, multi-branch teachers).
  useEffect(() => {
    if (!tId || !schoolId) return;
    let cancelled = false;
    const unsubs: Unsubscribe[] = [];
    const errH = (err: any) => { if (!cancelled) { console.error("Dashboard event listener error:", err); setError(err?.message || "Failed to load data"); } };

    const SC_EVT: QueryConstraint[] = [where("schoolId", "==", schoolId), where("teacherId", "==", tId)];

    // Last 30d cutoff for attendance day-string filter (writer uses local YYYY-MM-DD)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toLocaleDateString("en-CA");

    unsubs.push(onSnapshot(
      query(collection(db, "attendance"), ...SC_EVT, where("date", ">=", cutoffStr)),
      snap => { if (!cancelled) setAttendanceLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      errH
    ));

    // test_scores — primary score collection (written by EnterScores). Was
    // previously missing from this dashboard, hiding ~40% of teacher's data.
    unsubs.push(onSnapshot(
      query(collection(db, "test_scores"), ...SC_EVT),
      snap => { if (!cancelled) setTestScoreDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      errH
    ));

    // gradebook_scores — co-canonical with test_scores, uses `mark` (singular)
    unsubs.push(onSnapshot(
      query(collection(db, "gradebook_scores"), ...SC_EVT),
      snap => { if (!cancelled) setGradebookScoreDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      errH
    ));

    // results — assignment grading docs
    unsubs.push(onSnapshot(
      query(collection(db, "results"), ...SC_EVT),
      snap => { if (!cancelled) setResultDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      errH
    ));

    // gradebook_columns — needed to compute true pendingGrading (gap = column×student
    // pairs without a score). The legacy `s.status === 'pending'` filter was wrong
    // because gradebook writers don't set a status field at all.
    unsubs.push(onSnapshot(
      query(collection(db, "gradebook_columns"), ...SC_EVT),
      snap => { if (!cancelled) setGradebookColumnDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      errH
    ));

    return () => {
      cancelled = true;
      unsubs.forEach(u => u());
    };
  }, [tId, schoolId, refreshKey]);

  // Timetable singleton listener — `timetable_documents/{schoolId}_{branchSeg}`.
  // Branch segment defaults to "_default" matching the principal-side writer.
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    const branchSeg = branchId || "_default";
    const unsub = onSnapshot(
      doc(db, "timetable_documents", `${schoolId}_${branchSeg}`),
      (s) => { if (!cancelled) setTimetable(s.exists() ? (s.data() as TimetableDoc) : null); },
      (err) => { if (!cancelled) console.warn("[Dashboard] timetable listener:", err); },
    );
    return () => { cancelled = true; unsub(); };
  }, [schoolId, branchId, refreshKey]);

  // Loading transition: drop loading once auth is ready (listeners stream in
  // independently). Removed the 5-min cache — onSnapshot keeps data live.
  useEffect(() => {
    if (!tId || !schoolId) { setLoading(true); return; }
    setLoading(false);
  }, [tId, schoolId]);

  // ── Derived: teacher's resolved assignments (deduped from 4 sources) ───────
  const assignments = useMemo(() => {
    const all = [
      ...teacherAssignments,
      ...emailAssignments,
      ...teacherClassesById,
      ...teacherClassesByOldKey,
    ];
    const m = new Map<string, any>();
    all.forEach((a: any) => {
      const cid = a.classId || a.id;
      if (!cid) return;
      if (!m.has(cid)) m.set(cid, a);
    });
    return Array.from(m.values());
  }, [teacherAssignments, emailAssignments, teacherClassesById, teacherClassesByOldKey]);

  const classIds = useMemo(() => assignments.map(a => a.classId || a.id).filter(Boolean), [assignments]);

  // ── Enrollments listener — separate because keyed on teacher's classIds ────
  // Same rule as resolution queries above: classId IS the isolation key here,
  // so branchId filter is redundant + risks dropping enrollments where
  // student.branchId drifts from teacher.branchId.
  useEffect(() => {
    if (!schoolId || classIds.length === 0) { setEnrollments([]); return; }
    let cancelled = false;
    const unsubs: Unsubscribe[] = [];
    const errH = (err: any) => { if (!cancelled) console.error("enrollments listener error:", err); };
    const SC_TENANT: QueryConstraint[] = [where("schoolId", "==", schoolId)];

    // Firestore `in` operator caps at 10. Chunk classIds and accumulate per-chunk.
    const chunks: string[][] = [];
    for (let i = 0; i < classIds.length; i += 10) chunks.push(classIds.slice(i, i + 10));
    const chunkBuckets: any[][] = chunks.map(() => []);

    chunks.forEach((ch, i) => {
      unsubs.push(onSnapshot(
        query(collection(db, "enrollments"), where("classId", "in", ch), ...SC_TENANT),
        snap => {
          if (cancelled) return;
          chunkBuckets[i] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setEnrollments(chunkBuckets.flat());
        },
        errH,
      ));
    });

    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, [schoolId, classIds.join("|"), refreshKey]);

  // ── Derived stats / lists ─────────────────────────────────────────────────
  const allScoreDocs = useMemo(
    () => [...testScoreDocs, ...gradebookScoreDocs, ...resultDocs],
    [testScoreDocs, gradebookScoreDocs, resultDocs]
  );

  // Recent (last 90d) score docs — fed to criticalStudents/atRiskCount so
  // ancient data doesn't skew "is this student at risk RIGHT NOW".
  // Older docs missing all timestamp fields fall through to writerTimeMs=0
  // and are excluded — acceptable since those are usually legacy seed data.
  const recentScoreDocs = useMemo(() => {
    const cutoffMs = Date.now() - SCORE_WINDOW_MS;
    return allScoreDocs.filter(d => writerTimeMs(d) >= cutoffMs);
  }, [allScoreDocs]);

  const avgAttendance = useMemo(() => {
    if (attendanceLogs.length === 0) return null; // null = no data; UI shows "—"
    const pres = attendanceLogs.filter(a => a.status === 'present' || a.status === 'late').length;
    return Number(((pres / attendanceLogs.length) * 100).toFixed(1));
  }, [attendanceLogs]);

  // True pendingGrading = (column × enrolled-student) pairs without a mark.
  // Replaces the broken `s.status === 'pending'` filter (gradebook writers
  // don't set a status field at all).
  const pendingGrading = useMemo(() => {
    if (gradebookColumnDocs.length === 0 || enrollments.length === 0) return 0;
    const scoredKeys = new Set<string>();
    gradebookScoreDocs.forEach((s: any) => {
      const sid = s.studentId || s.studentEmail?.toLowerCase();
      const cid = s.columnId;
      if (sid && cid) scoredKeys.add(`${sid}|${cid}`);
    });
    let gap = 0;
    gradebookColumnDocs.forEach((col: any) => {
      const colClassId = col.classId || col.assignmentId;
      if (!colClassId) return;
      enrollments.forEach((e: any) => {
        if (e.classId !== colClassId) return;
        const sid = e.studentId || e.studentEmail?.toLowerCase();
        if (!sid) return;
        if (!scoredKeys.has(`${sid}|${col.id}`)) gap++;
      });
    });
    return gap;
  }, [gradebookColumnDocs, gradebookScoreDocs, enrollments]);

  // className → classId resolution map. Used to (a) tag timetable-derived
  // entries with the canonical classId for downstream attendance matching,
  // (b) compute student counts per class.
  const classNameToIdMap = useMemo(() => {
    const m = new Map<string, string>();
    assignments.forEach((a: any) => {
      const id = a.classId || a.id;
      if (!id) return;
      const candidates: string[] = [];
      if (a.className) candidates.push(a.className);
      if (a.name) candidates.push(a.name);
      candidates.forEach(n => {
        const k = normalizeClassKey(n);
        if (k && !m.has(k)) m.set(k, id);
      });
    });
    return m;
  }, [assignments]);

  // classId → student-count map for both timetable-derived and assignment-derived entries.
  const enrollmentsByClassId = useMemo(() => {
    const m = new Map<string, number>();
    enrollments.forEach((e: any) => {
      if (!e.classId) return;
      m.set(e.classId, (m.get(e.classId) || 0) + 1);
    });
    return m;
  }, [enrollments]);

  // Today's classes — timetable-FIRST, with assignment-based fallback.
  // The timetable_documents singleton is the canonical "what's actually
  // scheduled today" source. Only when no timetable is published do we
  // synthesize from teaching_assignments + classes day-of-week metadata.
  const todayClasses = useMemo<TodayClassEntry[]>(() => {
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const teacherName = String(teacherData?.name || (teacherData as any)?.fullName || "");

    // Path 1 — timetable provides today's slots
    const ttEntries = parseTodayFromTimetable(timetable, teacherName, classNameToIdMap, enrollmentsByClassId);
    if (ttEntries.length > 0) {
      return ttEntries
        .map(e => ({
          ...e,
          isNow: e.startMin != null && e.endMin != null && nowMin >= e.startMin && nowMin <= e.endMin,
        }))
        .sort((a, b) => (a.startMin ?? 99999) - (b.startMin ?? 99999))
        .slice(0, 6);
    }

    // Path 2 — fallback to assignments. Two sub-paths:
    //   (a) Some assignments carry day-of-week metadata that matches today →
    //       show ONLY those (specific & accurate).
    //   (b) None do (the common case for legacy/lightweight data) → show ALL
    //       assigned classes so the teacher sees what they teach. Capped at
    //       6 to keep the card readable; slice(0,4) was over-restrictive.
    if (assignments.length === 0) return [];
    const dayLabels = todayDayLabels();
    const filteredByDay = assignments.filter((a: any) => {
      const days: string[] = [];
      const push = (v: any) => { if (typeof v === "string") days.push(v.toLowerCase()); };
      push(a.day); push(a.dayOfWeek); push(a.weekday);
      if (Array.isArray(a.days)) a.days.forEach(push);
      if (days.length === 0) return false;
      return dayLabels.some(label => days.some(d => d.startsWith(label.slice(0, 3))));
    });
    const source = filteredByDay.length > 0 ? filteredByDay : assignments;

    return source
      .map((a: any): TodayClassEntry => {
        const startRaw = a.startTime || a.scheduleTime || a.start || "";
        const startMin = parseStartMinutes(startRaw);
        const endRaw = a.endTime || a.end || "";
        const endMin = parseStartMinutes(endRaw);
        const cid = a.classId || a.id || null;
        return {
          time: startRaw || "—",
          period: a.period || "",
          subject: a.subjectName || a.subject || "Subject",
          className: a.className || a.name || "Class",
          classId: cid,
          students: cid ? (enrollmentsByClassId.get(cid) || 0) : 0,
          startMin,
          endMin,
          isNow: startMin != null && endMin != null && nowMin >= startMin && nowMin <= endMin,
          source: "assignments",
        };
      })
      .sort((a, b) => {
        // If start times exist, sort ascending. Otherwise alphabetize by class+subject
        // so the list has a stable readable order.
        const sa = a.startMin ?? null;
        const sb = b.startMin ?? null;
        if (sa != null && sb != null) return sa - sb;
        if (sa != null) return -1;
        if (sb != null) return 1;
        const ka = `${a.className} ${a.subject}`.toLowerCase();
        const kb = `${b.className} ${b.subject}`.toLowerCase();
        return ka.localeCompare(kb);
      })
      .slice(0, 6);
  }, [timetable, teacherData?.name, classNameToIdMap, enrollmentsByClassId, assignments]);

  // All flagged students — critical + observation, no slice. Used to derive
  // the class-grouped Needs Attention card AND the top-N flat critical list.
  // 3-tier attribution + untested honesty (no fabricated 80 default).
  const allFlaggedStudents = useMemo(() => {
    if (enrollments.length === 0) return [];

    // Per-enrollment row eval so a student in multiple classes is evaluated
    // PER CLASS (different per-class attribution shouldn't merge). We later
    // group by class for the Needs Attention card, and dedup by studentId
    // for the flat critical list.
    return enrollments.map((s: any) => {
      const sId = s.studentId;
      const sEmail = s.studentEmail?.toLowerCase();
      const sClassId = s.classId;
      const sClassName = s.className || "";

      const matchesStudent = (doc: any): boolean => {
        if (sId && doc.studentId === sId) return true;
        if (sEmail && doc.studentEmail?.toLowerCase() === sEmail) return true;
        return false;
      };

      const sAtt = attendanceLogs.filter(matchesStudent);
      const sScores = recentScoreDocs.filter(matchesStudent);

      const sA = sAtt.length > 0
        ? (sAtt.filter(a => a.status === 'present' || a.status === 'late').length / sAtt.length) * 100
        : null;

      const scorePcts = sScores.map(d => pctOfDoc(d)).filter((v): v is number => v !== null);
      const sM = scorePcts.length > 0
        ? scorePcts.reduce((a, b) => a + b, 0) / scorePcts.length
        : null;

      let level: "critical" | "observation" | "stable" = "stable";
      let trigger = "On Track";

      if ((sA != null && sA < 75) || (sM != null && sM < 60)) {
        level = "critical";
        trigger = (sA != null && sA < 75)
          ? `Attendance dropped to ${Math.round(sA)}%`
          : "Grade dropped significantly";
      } else if ((sA != null && sA < 85) || (sM != null && sM < 70)) {
        level = "observation";
        trigger = (sM != null && sM < 70) ? "Performance below class avg." : "Attendance trending down";
      }

      return {
        ...s,
        level,
        trigger,
        score: sM,
        atnd: sA,
        classId: sClassId,
        className: sClassName,
        untested: sA == null && sM == null,
      };
    }).filter(s => !s.untested && s.level !== "stable");
  }, [enrollments, attendanceLogs, recentScoreDocs]);

  // Flat top-N critical (used by aiMessage for "Prioritise X and Y" naming).
  // Dedup by studentId so multi-class students appear once at their worst.
  const criticalStudents = useMemo(() => {
    const m = new Map<string, any>();
    allFlaggedStudents.forEach(s => {
      const sid = s.studentId || s.studentEmail?.toLowerCase() || s.id;
      if (!sid) return;
      const existing = m.get(sid);
      // Prefer the WORSE record per student (critical over observation,
      // lower score over higher score)
      if (!existing) { m.set(sid, s); return; }
      const aWorse = s.level === "critical" && existing.level !== "critical";
      const sameLevelWorseScore =
        s.level === existing.level &&
        ((s.score ?? 100) < (existing.score ?? 100) || (s.atnd ?? 100) < (existing.atnd ?? 100));
      if (aWorse || sameLevelWorseScore) m.set(sid, s);
    });
    return Array.from(m.values())
      .sort((a, b) => {
        if (a.level === b.level) return (a.score ?? 100) - (b.score ?? 100);
        return a.level === "critical" ? -1 : 1;
      })
      .slice(0, 3);
  }, [allFlaggedStudents]);

  // Class-grouped flagged students — drives the Needs Attention card. Each
  // group: { classId, className, count, students (top 2 worst) }. Groups
  // sorted by count DESC, then by worst-student score ASC. Show top 3 groups.
  const flaggedByClass = useMemo(() => {
    if (allFlaggedStudents.length === 0) return [];
    const groups = new Map<string, { classId: string; className: string; count: number; criticalCount: number; students: any[] }>();
    allFlaggedStudents.forEach(s => {
      const key = s.classId || s.className || "_unassigned";
      let g = groups.get(key);
      if (!g) {
        g = { classId: s.classId || "", className: s.className || "Unassigned", count: 0, criticalCount: 0, students: [] };
        groups.set(key, g);
      }
      g.count++;
      if (s.level === "critical") g.criticalCount++;
      g.students.push(s);
    });
    // Sort each group's students worst-first; cap to 2 per group for card
    groups.forEach(g => {
      g.students.sort((a, b) => {
        if (a.level !== b.level) return a.level === "critical" ? -1 : 1;
        return (a.score ?? 100) - (b.score ?? 100);
      });
      g.students = g.students.slice(0, 2);
    });
    return Array.from(groups.values())
      .sort((a, b) => {
        // Critical-heavier classes first; tiebreak by total count
        if (a.criticalCount !== b.criticalCount) return b.criticalCount - a.criticalCount;
        return b.count - a.count;
      })
      .slice(0, 6); // cap at 6 in card; "View all" goes to /risks-alerts
  }, [allFlaggedStudents]);

  // Stable key per class group (used by accordion expand state).
  const flaggedKey = (g: { classId: string; className: string }) =>
    g.classId || g.className || "_unassigned";

  // Single-expand accordion: one class group is open at a time. Top
  // (most-critical) class auto-expanded on first reach. User can collapse
  // it or open another. Switching tabs preserves their selection until
  // flaggedByClass changes shape.
  const [expandedClassKey, setExpandedClassKey] = useState<string | null>(null);
  useEffect(() => {
    if (flaggedByClass.length === 0) {
      if (expandedClassKey !== null) setExpandedClassKey(null);
      return;
    }
    const validKeys = flaggedByClass.map(flaggedKey);
    if (expandedClassKey === null || !validKeys.includes(expandedClassKey)) {
      setExpandedClassKey(validKeys[0]);
    }
    // Intentionally exclude expandedClassKey from deps — we only want this
    // effect to run on flaggedByClass shape changes, not on user interactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaggedByClass]);

  // At-risk count = unique students at "critical" level (deduped across
  // multi-class enrollments). Single source of truth: derived from
  // allFlaggedStudents so this can never drift from the Needs Attention list.
  const atRiskCount = useMemo(() => {
    const ids = new Set<string>();
    allFlaggedStudents.forEach(s => {
      if (s.level !== "critical") return;
      const sid = s.studentId || s.studentEmail?.toLowerCase() || s.id;
      if (sid) ids.add(sid);
    });
    return ids.size;
  }, [allFlaggedStudents]);

  const pendingTasks = useMemo(() => {
    const tasks: any[] = [];
    const todayStr = todayLocalKey();

    // 3-tier matching set for "is this class marked today?":
    //  - classId (writer's primary key)
    //  - assignmentId (writer also stamps this — covers legacy/dual-id writers)
    //  - normalized className (covers timetable entries whose classId
    //    couldn't be resolved via classNameToIdMap, AND covers legacy
    //    attendance docs that wrote a different id format)
    // This is the same defense-in-depth pattern as `pattern_3tier_attribution`
    // — strict id match silently breaks whenever writer ↔ reader id formats
    // drift, so we cascade through 3 keys.
    const markedClassIds = new Set<string>();
    const markedClassNames = new Set<string>();
    attendanceLogs.forEach(a => {
      if (a.date !== todayStr) return;
      if (a.classId) markedClassIds.add(String(a.classId));
      if (a.assignmentId) markedClassIds.add(String(a.assignmentId));
      if (typeof a.className === "string" && a.className.trim()) {
        markedClassNames.add(normalizeClassKey(a.className));
      }
    });

    const strictUnmarked = todayClasses.filter((c) => {
      // Tier 1: direct classId match (strongest)
      if (c.classId && markedClassIds.has(c.classId)) return false;
      // Tier 2: normalized className match (covers id-format drift +
      // unresolved-classId timetable entries)
      const ck = normalizeClassKey(c.className);
      if (ck && markedClassNames.has(ck)) return false;
      // Tier 3: if the entry has neither a classId nor a usable className,
      // we can't honestly determine state — skip (don't false-alarm).
      if (!c.classId && !ck) return false;
      return true;
    }).length;

    // Safety net: if teacher marked N distinct classes today, pending can't
    // exceed (todayClasses.length - N). Defends against any residual id/name
    // matching gap by falling back to a count-based subtraction. Take the
    // optimistic (smaller) of strict vs count-based to surface progress fast.
    const distinctMarkedToday = markedClassIds.size;
    const countBasedUnmarked = Math.max(0, todayClasses.length - distinctMarkedToday);
    const unmarkedTodayCount = Math.min(strictUnmarked, countBasedUnmarked);

    if (pendingGrading > 0) {
      tasks.push({ title: 'Grade Pending Entries', sub: `${pendingGrading} cell${pendingGrading > 1 ? 's' : ''} · Gradebook`, status: 'Pending', done: false });
    }
    if (unmarkedTodayCount > 0) {
      tasks.push({ title: 'Mark Attendance', sub: `${unmarkedTodayCount} class${unmarkedTodayCount > 1 ? 'es' : ''} · Pending today`, status: 'Todo', done: false });
    }
    return tasks;
  }, [pendingGrading, attendanceLogs, todayClasses]);

  // Stats object — avgAttendance is intentionally `number | null` so UI can
  // distinguish "no data yet" (null → "—") from "actual zero" (0 → "0.0%").
  // hasRoster surfaces empty-class teachers honestly (no "all students on
  // track" lie when they have zero enrolled students at all).
  const stats = useMemo(() => ({
    avgAttendance,
    pendingGrading,
    atRiskCount,
    activeClasses: assignments.length,
  }), [avgAttendance, pendingGrading, atRiskCount, assignments.length]);
  const hasRoster = enrollments.length > 0;

  // Top student across teacher's classes (last 90d). Powers the Class
  // Leaderboard card sub-text — replaces the previous static CTA with real
  // signal. Uses studentId/email match (3-tier — id → email).
  const topStudent = useMemo(() => {
    if (enrollments.length === 0 || recentScoreDocs.length === 0) return null;
    const m = new Map<string, { name: string; total: number; count: number }>();
    enrollments.forEach((e: any) => {
      const sid = e.studentId || e.studentEmail?.toLowerCase();
      if (!sid) return;
      if (!m.has(sid)) m.set(sid, { name: e.studentName || "Student", total: 0, count: 0 });
    });
    recentScoreDocs.forEach((d: any) => {
      const sid = d.studentId || d.studentEmail?.toLowerCase();
      if (!sid) return;
      const pct = pctOfDoc(d);
      if (pct == null) return;
      const entry = m.get(sid);
      if (entry) { entry.total += pct; entry.count++; }
    });
    let best: { name: string; avg: number } | null = null;
    m.forEach(e => {
      if (e.count === 0) return;
      const avg = e.total / e.count;
      if (!best || avg > (best as any).avg) best = { name: e.name, avg };
    });
    return best;
  }, [enrollments, recentScoreDocs]);

  // Average score across all teacher's recent score docs (last 90d). Powers
  // the Teacher Rankings card sub-text. Computing actual rank requires
  // cross-teacher reads — that's the Leaderboard page's job. The dashboard
  // shows a real, honest signal: "Your students average X%".
  const classAvg = useMemo(() => {
    if (recentScoreDocs.length === 0) return null;
    const pcts = recentScoreDocs.map(pctOfDoc).filter((v): v is number => v !== null);
    if (pcts.length === 0) return null;
    return Number((pcts.reduce((a, b) => a + b, 0) / pcts.length).toFixed(1));
  }, [recentScoreDocs]);

  const leaderboardClassSub = topStudent
    ? `Top: ${(topStudent as any).name} · ${Math.round((topStudent as any).avg)}%`
    : enrollments.length > 0
      ? `${enrollments.length} student${enrollments.length === 1 ? '' : 's'} ranked`
      : "See how students rank";

  const leaderboardTeacherSub = classAvg != null
    ? `Your students avg ${classAvg}%`
    : "View your branch ranking";

  if (loading) return (
    <div className="h-screen flex items-center justify-center" style={{ background: T.surface1 }}>
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: T.blue }} />
    </div>
  );

  // ── Derived values ─────────────────────────────────────────────────────────
  const firstName = teacherData?.name?.split(" ")[0] || "Teacher";
  const dayLabel = new Date().toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric' });
  const _hour = new Date().getHours();
  const greeting = _hour < 12 ? "Good Morning" : _hour < 17 ? "Good Afternoon" : "Good Evening";
  const shortDate = new Date().toLocaleDateString("en-US", { weekday: 'short', month: 'short', day: 'numeric' });

  // AI summary line — derived from live stats (no fake data).
  // Three honest states for attendance: null (no data), 0 (all absent — worst
  // case, surface as warning), >0 (banded). Zero-roster teachers get a
  // distinct empty-state message instead of "every student is on track".
  const aiMessage = (() => {
    const a = stats.avgAttendance;
    const attStr = a == null
      ? "No attendance data yet"
      : a >= 85 ? `Attendance is strong at ${a}%`
      : a >= 70 ? `Attendance is holding at ${a}%`
      : a > 0   ? `Attendance is dipping to ${a}%`
      :           "No students marked present in the last 30 days";
    const gradeStr = stats.pendingGrading === 0
      ? "grading is current"
      : `${stats.pendingGrading} grading entr${stats.pendingGrading === 1 ? 'y' : 'ies'} pending`;

    if (!hasRoster) {
      return `Roster is empty — once classes are assigned, this card will track attendance, grading, and at-risk students live.`;
    }
    if (stats.atRiskCount === 0) {
      return `${attStr} and ${gradeStr} — every student is on track today.`;
    }
    const top  = criticalStudents[0]?.studentName;
    const next = criticalStudents[1]?.studentName;
    const namePart = top && next ? ` Prioritise ${top} and ${next}.`
                   : top ?          ` Prioritise ${top}.`
                   : '';
    return `${attStr} and ${gradeStr} — but ${stats.atRiskCount} student${stats.atRiskCount > 1 ? 's need' : ' needs'} immediate outreach.${namePart}`;
  })();

  // ── Attendance display band (shared mobile + desktop) ─────────────────────
  // 4 honest bands: "none" (no data → "—"), "low" (0–69%, includes real zero),
  // "holding" (70–84%), "strong" (≥85%). The "none" band is its own neutral
  // grey so genuine 0% never gets coloured grey-as-no-data and vice versa.
  const attHasData = stats.avgAttendance != null;
  const attValue = stats.avgAttendance ?? 0;
  const attBand: "strong" | "holding" | "low" | "none" =
    !attHasData ? "none"
    : attValue >= 85 ? "strong"
    : attValue >= 70 ? "holding"
    : "low";
  const attTheme = {
    strong:  { bg: "rgba(0,232,102,0.18)",   border: "rgba(0,232,102,0.5)",   txt: "#6FFFAA", dot: "#00FF88", label: "Strong",       subColor: "#00C853", subLabel: "↑ Strong",     gridText: "#6FFFAA" },
    holding: { bg: "rgba(255,170,0,0.22)",   border: "rgba(255,170,0,0.5)",   txt: "#FFD166", dot: "#FFCC22", label: "Holding",      subColor: "#FF8800", subLabel: "● Watch",      gridText: "#FFD166" },
    low:     { bg: "rgba(255,51,85,0.18)",   border: "rgba(255,51,85,0.5)",   txt: "#FF99AA", dot: "#FF5577", label: "Needs focus",  subColor: "#FF3355", subLabel: "● Needs focus",gridText: "#FF8899" },
    none:    { bg: "rgba(140,140,160,0.18)", border: "rgba(140,140,160,0.4)", txt: "#CDD0DC", dot: "#9499AC", label: "No data",      subColor: "#5070B0", subLabel: "Awaiting data",gridText: "#CDD0DC" },
  } as const;
  const attC = attTheme[attBand];
  const attDisplay = attHasData ? attValue.toFixed(1) : "—";
  const attCardVal = attHasData ? `${attValue}%` : "—";

  // ── Blue Apple design tokens (shared mobile + desktop) ─────────────────────
  const B1 = "#0055FF", B2 = "#1166FF", B3 = "#2277FF", B4 = "#4499FF";
  const BG_D = "#EEF4FF", BG2_D = "#E0ECFF";
  const TT1 = "#001040", TT2 = "#002080", TT3 = "#5070B0", TT4 = "#99AACC";
  const GREEN = "#00C853", GREEN_D_COL = "#007830";
  const RED = "#FF3355";
  const ORANGE = "#FF8800";
  const VIOLET = "#6B21E8";
  const BLUE_BDR = "rgba(0,85,255,0.12)";
  const SEP_D = "rgba(0,85,255,0.07)";
  // Shared blue halo — identical to principal dashboard for visual parity
  const SH_D = BLUE_SHADOW;
  const SH_LG_D = BLUE_SHADOW_LG;
  const SH_BTN_D = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)";
  const FONT_D = "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif";

  // 3D tilt handlers (desktop)
  const handle3DEnter = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.style.transition = "transform 0.06s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.2s ease";
  };
  const handle3DMove = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rotX = (((y / rect.height) - 0.5) * -7).toFixed(2);
    const rotY = (((x / rect.width) - 0.5) * 7).toFixed(2);
    el.style.transform = `perspective(1100px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-3px) scale(1.006)`;
    const glow = el.querySelector<HTMLDivElement>('[data-glow]');
    if (glow) {
      glow.style.opacity = "1";
      glow.style.background = `radial-gradient(420px circle at ${x}px ${y}px, rgba(0,85,255,0.13), transparent 45%)`;
    }
  };
  const handle3DLeave = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.style.transition = "transform 0.5s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.3s ease";
    el.style.transform = "perspective(1100px) rotateX(0deg) rotateY(0deg) translateY(0) scale(1)";
    const glow = el.querySelector<HTMLDivElement>('[data-glow]');
    if (glow) glow.style.opacity = "0";
  };

  const avatarInitial = (teacherData?.name?.[0] || "T").toUpperCase();

  return (
    <div style={{ fontFamily: FONT_D, background: "#EEF4FF" }} className="min-h-screen pb-[72px] md:pb-0 text-left">

      {/* Error retry banner — surfaces listener failures (e.g. permission-denied,
          network drops) instead of silently leaving the UI stuck on stale data. */}
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
                Couldn't refresh dashboard
              </div>
              <div className="text-[11px] mt-[2px]" style={{ color: "#A33333" }}>
                {error}
              </div>
            </div>
            <button type="button"
              onClick={() => { setError(null); setRefreshKey(k => k + 1); }}
              className="flex items-center gap-[5px] px-3 py-[7px] rounded-[10px] text-[11px] font-bold text-white active:scale-[0.94] transition-transform"
              style={{ background: "#C92A2A", letterSpacing: "-0.1px" }}>
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════ MOBILE VIEW — EduIntellect v2 ═══════════════════ */}
      <div className="md:hidden animate-in fade-in duration-500" style={{ background: "#EEF4FF", minHeight: "100vh" }}>

      {/* ── Greeting + actions (bell + avatar) ── */}
      <div className="flex items-center justify-between px-4 pt-[10px] pb-[18px]">
        <div>
          <div className="flex items-center gap-[7px] text-[9px] font-bold uppercase mb-[6px]" style={{ color: TT3, letterSpacing: "1.8px" }}>
            <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: B1 }} />
            Teacher Dashboard
          </div>
          <div className="text-[25px] font-bold flex items-center gap-2 leading-[1.05]" style={{ color: TT1, letterSpacing: "-0.9px" }}>
            Hello, {firstName}
            <span className="inline-block" style={{ animation: "tdWave 2.8s ease-in-out infinite", transformOrigin: "70% 70%" }}>👋</span>
          </div>
          <div className="text-[12px] font-medium mt-[5px]" style={{ color: TT3, letterSpacing: "-0.15px" }}>
            Welcome back · {dayLabel}
          </div>
        </div>

        {/* Notifications + profile live in TeacherHeader (global) — no duplication here. */}
      </div>

      {/* ── Hero banner: Attendance Rate ── */}
      <button type="button" onClick={() => navigate('/attendance')}
        className="w-full text-left mx-0 rounded-[26px] px-[22px] py-[22px] relative overflow-hidden active:scale-[0.99] transition-transform"
        style={{
          background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
          boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)",
          marginLeft: "16px", marginRight: "16px", width: "calc(100% - 32px)",
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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18"/>
                <path d="M7 14l4-4 4 4 5-5"/>
              </svg>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Attendance Rate</div>
              <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Last 30 days · All classes</div>
            </div>
            <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-bold"
              style={{
                background: attC.bg,
                border: `0.5px solid ${attC.border}`,
                color: attC.txt,
                letterSpacing: "0.3px",
              }}>
              <span className="w-[6px] h-[6px] rounded-full" style={{
                background: attC.dot,
                boxShadow: `0 0 8px ${attC.dot}`,
              }} />
              {attC.label}
            </div>
          </div>
          <div className="text-[56px] font-bold text-white leading-none mb-[8px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-2.6px" }}>
            {attDisplay}
            {attHasData && <span className="text-[28px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-0.8px" }}>%</span>}
          </div>
          <div className="text-[13px] font-medium mb-[20px]" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
            <b className="text-white font-bold">Keep up the great work</b> — real-time data from your classes.
          </div>
          <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
            {[
              { v: stats.activeClasses, l: "Classes" },
              { v: stats.atRiskCount, l: "At-Risk" },
              { v: stats.pendingGrading, l: "Pending" },
            ].map(({ v, l }) => (
              <div key={l} className="py-[13px] px-[6px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[20px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{v}</div>
                <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </button>

      {/* ── 2×2 stat cards ── */}
      <div className="grid grid-cols-2 gap-[10px] px-4 pt-[14px]">
        {[
          {
            label: "Attendance Rate",
            val: attCardVal,
            color: B1,
            tintBg: "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)",
            tintBorder: "rgba(0,85,255,0.10)",
            sub: !attHasData
              ? <span>Awaiting data</span>
              : <><span className="font-bold" style={{ color: attC.subColor }}>{attC.subLabel}</span> · last 30d</>,
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="12" width="4" height="9" rx="1"/>
                <rect x="10" y="8" width="4" height="13" rx="1"/>
                <rect x="17" y="4" width="4" height="17" rx="1"/>
              </svg>
            ),
            decor: (
              <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="13" width="4" height="8" rx="1"/>
                <rect x="10" y="9" width="4" height="12" rx="1"/>
                <rect x="17" y="5" width="4" height="16" rx="1"/>
              </svg>
            ),
            path: "/attendance",
          },
          {
            label: "Pending Grading",
            val: `${stats.pendingGrading}`,
            color: ORANGE,
            tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)",
            tintBorder: "rgba(255,136,0,0.14)",
            sub: stats.pendingGrading === 0
              ? <span className="font-bold" style={{ color: GREEN }}>✓ All caught up</span>
              : <><span className="font-bold" style={{ color: ORANGE }}>● {stats.pendingGrading} to grade</span></>,
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="3" width="16" height="18" rx="2"/>
                <path d="M9 3v4h6V3"/>
                <path d="M9 13l2 2 4-4"/>
              </svg>
            ),
            decor: (
              <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="3" width="16" height="18" rx="2"/>
                <path d="M9 3v4h6V3"/>
                <path d="M8 12h8M8 16h6"/>
              </svg>
            ),
            path: "/gradebook",
          },
          {
            label: "At-Risk Students",
            val: `${stats.atRiskCount}`,
            color: RED,
            tintBg: "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)",
            tintBorder: "rgba(255,51,85,0.14)",
            sub: stats.atRiskCount === 0
              ? <span className="font-bold" style={{ color: GREEN }}>✓ On track</span>
              : <span className="font-bold" style={{ color: RED }}>● Need outreach</span>,
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 21h20L12 2z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12" y2="17"/>
              </svg>
            ),
            decor: (
              <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3L3 20h18L12 3z"/>
                <line x1="12" y1="10" x2="12" y2="14"/>
                <circle cx="12" cy="17" r="0.6" fill="currentColor"/>
              </svg>
            ),
            path: "/risks-alerts",
          },
          {
            label: "Classes Today",
            val: `${stats.activeClasses}`,
            color: VIOLET,
            tintBg: "linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)",
            tintBorder: "rgba(107,33,232,0.12)",
            sub: todayClasses.some(c => c.isNow)
              ? <span className="font-bold" style={{ color: VIOLET }}>● 1 in progress</span>
              : stats.activeClasses > 0
                ? <span className="font-bold" style={{ color: VIOLET }}>● Scheduled</span>
                : <span>None today</span>,
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11l9-8 9 8"/>
                <path d="M5 10v10h14V10"/>
                <path d="M10 20v-6h4v6"/>
              </svg>
            ),
            decor: (
              <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11l9-8 9 8"/>
                <path d="M5 10v10h14V10"/>
                <path d="M10 20v-6h4v6"/>
              </svg>
            ),
            path: "/timetable",
          },
        ].map(({ label, val, color, tintBg, tintBorder, sub, icon, decor, path }) => (
          <button type="button" key={label}
            onClick={() => navigate(path)}
            {...tilt3D}
            className="rounded-[20px] p-4 relative flex flex-col text-left active:scale-[0.96] transition-transform overflow-hidden"
            style={{ background: tintBg, boxShadow: "0 6px 18px rgba(20,40,90,0.06), 0 1px 3px rgba(20,40,90,0.04)", border: `0.5px solid ${tintBorder}`, ...tilt3DStyle }}>
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
        ))}
      </div>

      {/* ── Leaderboard entry cards ── */}
      <div className="grid grid-cols-2 gap-[10px] px-4 pt-[10px]">
        {[
          {
            label: "Class Leaderboard",
            sub: leaderboardClassSub,
            iconBg: B1,
            path: "/leaderboard",
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 010-5H6"/>
                <path d="M18 9h1.5a2.5 2.5 0 000-5H18"/>
                <path d="M4 22h16"/>
                <path d="M10 14.66V17a2 2 0 002 2v0a2 2 0 002-2v-2.34"/>
                <path d="M18 2H6v7a6 6 0 0012 0V2z"/>
              </svg>
            ),
          },
          {
            label: "Teacher Rankings",
            sub: leaderboardTeacherSub,
            iconBg: VIOLET,
            path: "/leaderboard/teachers",
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l2.4 5.4L20 8l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.6L12 2z"/>
              </svg>
            ),
          },
        ].map(({ label, sub, iconBg, path, icon }) => (
          <button type="button" key={label}
            onClick={() => navigate(path)}
            {...tilt3D}
            className="bg-white rounded-[20px] p-4 relative flex flex-col text-left active:scale-[0.96] transition-transform"
            style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}>
            <div className="flex items-start gap-[10px] mb-[14px]" style={{ minHeight: 40 }}>
              <div className="flex-1 min-w-0 text-[11px] font-bold uppercase leading-[1.3] pt-[3px]" style={{ color: TT3, letterSpacing: "0.6px" }}>
                {label}
              </div>
              <div className="flex-shrink-0 w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white"
                style={{ background: iconBg }}>
                {icon}
              </div>
            </div>
            <div className="text-[12px] font-semibold flex items-center gap-[5px]" style={{ color: TT4, letterSpacing: "-0.1px" }}>
              <span className="flex-1 truncate min-w-0">{sub}</span>
              <span className="ml-auto text-[16px] leading-none flex-shrink-0" style={{ color: B1 }}>›</span>
            </div>
          </button>
        ))}
      </div>

      {/* ── Today's Classes ── */}
      <div {...tilt3D} className="mx-4 mt-[14px] bg-white rounded-[20px] p-[18px]"
        style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}>
        <div className="flex items-center justify-between mb-[14px]">
          <div className="flex items-center gap-[11px]">
            <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white" style={{ background: B1 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div>
              <div className="text-[15px] font-bold" style={{ color: TT1, letterSpacing: "-0.35px" }}>Today's Classes</div>
              <div className="text-[11px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>{todayClasses.length} scheduled</div>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/timetable')}
            className="text-[12px] font-bold flex items-center gap-[2px] py-[6px] active:opacity-70 transition-opacity"
            style={{ color: B1, letterSpacing: "-0.1px" }}>
            Timetable <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
          </button>
        </div>
        {todayClasses.length === 0 ? (
          <div className="py-6 text-center text-[13px] font-medium" style={{ color: TT4 }}>No classes scheduled today</div>
        ) : (
          todayClasses.map((cls, idx) => (
            <button type="button" key={idx}
              onClick={() => navigate('/timetable')}
              className={`w-full flex items-center gap-3 px-[11px] py-[14px] rounded-[14px] text-left active:scale-[0.98] transition ${idx < todayClasses.length - 1 ? "mb-2" : ""}`}
              style={{ background: "#F4F7FE" }}>
              <div className="w-[3px] self-stretch rounded-[3px] flex-shrink-0" style={{
                background: cls.isNow ? GREEN : idx % 2 === 0 ? B1 : VIOLET,
                minHeight: 32,
              }} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.25px" }}>{cls.subject}</div>
                <div className="text-[11px] font-medium mt-[3px] truncate" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                  {cls.className}
                  <span className="mx-[5px]" style={{ color: TT4 }}>·</span>
                  {cls.students} {cls.students === 1 ? "student" : "students"}
                  {cls.time && cls.time !== "—" && !cls.isNow && (
                    <><span className="mx-[5px]" style={{ color: TT4 }}>·</span>{cls.time}</>
                  )}
                </div>
              </div>
              {cls.isNow ? (
                <div className="flex items-center gap-[5px] px-[10px] py-[5px] rounded-full text-[9px] font-bold text-white uppercase flex-shrink-0"
                  style={{ background: GREEN, letterSpacing: "0.6px" }}>
                  <span className="w-[5px] h-[5px] rounded-full bg-white animate-pulse" />
                  Now
                </div>
              ) : (
                <svg className="flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TT4} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              )}
            </button>
          ))
        )}
      </div>

      {/* ── Pending Tasks ── */}
      <div {...tilt3D} className="mx-4 mt-[14px] bg-white rounded-[20px] p-[18px]"
        style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}>
        <div className="flex items-center justify-between mb-[14px]">
          <div className="flex items-center gap-[11px]">
            <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white" style={{ background: ORANGE }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="8 12 11 15 16 9"/>
              </svg>
            </div>
            <div>
              <div className="text-[15px] font-bold" style={{ color: TT1, letterSpacing: "-0.35px" }}>Pending Tasks</div>
              <div className="text-[11px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                {pendingTasks.length} {pendingTasks.length === 1 ? "task to complete" : "tasks to complete"}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/attendance')}
            className="text-[12px] font-bold flex items-center gap-[2px] py-[6px] active:opacity-70 transition-opacity"
            style={{ color: B1, letterSpacing: "-0.1px" }}>
            Add <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
          </button>
        </div>
        {pendingTasks.length === 0 ? (
          <div className="py-6 text-center text-[13px] font-medium" style={{ color: TT4 }}>All tasks complete</div>
        ) : (
          pendingTasks.map((task, idx) => (
            <button type="button" key={idx}
              onClick={() => navigate(task.title.toLowerCase().includes('attendance') ? '/attendance' : '/gradebook')}
              className={`w-full flex items-center gap-3 p-[14px] rounded-[14px] relative overflow-hidden text-left active:scale-[0.98] transition-transform ${idx < pendingTasks.length - 1 ? "mb-2" : ""}`}
              style={{ background: "rgba(255,136,0,0.06)" }}>
              <div className="absolute left-0 top-[14px] bottom-[14px] w-[3px] rounded-r-[3px]" style={{ background: ORANGE }} />
              <div className="w-[36px] h-[36px] rounded-[12px] flex items-center justify-center text-white flex-shrink-0 ml-1"
                style={{ background: ORANGE }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4"/>
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold" style={{ color: TT1, letterSpacing: "-0.25px", textDecoration: task.done ? "line-through" : "none" }}>{task.title}</div>
                <div className="text-[11px] font-bold mt-[3px]" style={{ color: ORANGE, letterSpacing: "-0.1px" }}>{task.sub}</div>
              </div>
              <div className="px-[11px] py-[5px] rounded-full text-[9px] font-bold text-white uppercase flex-shrink-0"
                style={{ background: ORANGE, letterSpacing: "0.7px" }}>
                {task.status === 'Pending' ? 'Pending' : 'Todo'}
              </div>
            </button>
          ))
        )}
      </div>

      {/* ── Needs Attention (class-grouped) ── */}
      <div {...tilt3D} className="mx-4 mt-[14px] bg-white rounded-[20px] p-[18px]"
        style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}>
        <div className="flex items-center justify-between mb-[14px]">
          <div className="flex items-center gap-[11px]">
            <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white" style={{ background: RED }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 21h20L12 2z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12" y2="17"/>
              </svg>
            </div>
            <div>
              <div className="text-[15px] font-bold" style={{ color: TT1, letterSpacing: "-0.35px" }}>Needs Attention</div>
              <div className="text-[11px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                {flaggedByClass.length === 0
                  ? "All students on track"
                  : `${flaggedByClass.length} class${flaggedByClass.length === 1 ? '' : 'es'} flagged`}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/risks-alerts')}
            className="text-[12px] font-bold flex items-center gap-[2px] py-[6px] active:opacity-70 transition-opacity"
            style={{ color: B1, letterSpacing: "-0.1px" }}>
            View all <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
          </button>
        </div>
        {flaggedByClass.length === 0 ? (
          <div className="py-6 text-center text-[13px] font-medium" style={{ color: TT4 }}>All students on track</div>
        ) : (
          flaggedByClass.map((g, gIdx) => {
            const key = flaggedKey(g);
            const isOpen = expandedClassKey === key;
            const headerColor = g.criticalCount > 0 ? RED : ORANGE;
            const headerBg = g.criticalCount > 0 ? "rgba(255,51,85,0.05)" : "rgba(255,136,0,0.05)";
            return (
              <div key={key} className={gIdx < flaggedByClass.length - 1 ? "mb-2" : ""}>
                {/* Accordion header — always visible, click to expand/collapse */}
                <button type="button"
                  onClick={() => setExpandedClassKey(prev => prev === key ? null : key)}
                  aria-expanded={isOpen}
                  aria-controls={`flagged-class-panel-${key}`}
                  className="w-full flex items-center justify-between px-3 py-[10px] rounded-[12px] text-left active:scale-[0.99] transition-all"
                  style={{ background: isOpen ? headerBg : "rgba(0,85,255,0.03)",
                           border: `0.5px solid ${isOpen ? headerColor + "40" : "rgba(0,85,255,0.10)"}` }}>
                  <div className="flex items-center gap-[8px] min-w-0 flex-1">
                    <span className="text-[11px] font-bold uppercase truncate" style={{ color: TT1, letterSpacing: "0.8px" }}>
                      {g.className || "Unassigned"}
                    </span>
                    <span className="text-[9px] font-bold px-[8px] py-[2px] rounded-full flex-shrink-0"
                      style={{ background: g.criticalCount > 0 ? "rgba(255,51,85,0.12)" : "rgba(255,136,0,0.12)",
                               color: headerColor,
                               letterSpacing: "0.4px" }}>
                      {g.count} flagged{g.criticalCount > 0 ? ` · ${g.criticalCount} critical` : ""}
                    </span>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={TT3} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.18s ease", flexShrink: 0 }}
                    aria-hidden="true">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {/* Expandable panel — students */}
                {isOpen && (
                  <div id={`flagged-class-panel-${key}`} className="mt-2">
                    {g.students.map((s, sIdx) => {
                      const name = s.studentName || "Student";
                      const initStr = (() => { const p = name.trim().split(" "); return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].substring(0, 2)).toUpperCase(); })();
                      const isCritical = s.level === "critical";
                      const avatarBg = isCritical ? RED : ORANGE;
                      const accent = isCritical ? RED : ORANGE;
                      return (
                        <div key={`${key}_${s.studentId || sIdx}`}
                          onClick={() => navigate(`/students?studentId=${s.studentId || ''}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/students?studentId=${s.studentId || ''}`); }}
                          className={`flex items-center gap-[11px] p-[10px] pl-3 rounded-[14px] cursor-pointer active:brightness-95 transition ${sIdx < g.students.length - 1 ? "mb-2" : ""}`}
                          style={{ background: isCritical ? "rgba(255,51,85,0.04)" : "rgba(255,136,0,0.04)" }}>
                          <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                            style={{ background: avatarBg, letterSpacing: "0.3px" }}>
                            {initStr}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.25px" }}>{name}</div>
                            <div className="flex items-center gap-[5px] mt-[3px] text-[11px] font-semibold" style={{ color: accent, letterSpacing: "-0.1px" }}>
                              <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: accent }} />
                              <span className="truncate">{s.trigger}</span>
                            </div>
                          </div>
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); navigate('/risks-alerts'); }}
                            className="px-[13px] py-[8px] rounded-[10px] text-[11px] font-bold text-white flex-shrink-0 active:scale-[0.92] transition-transform"
                            style={{ background: accent, letterSpacing: "-0.1px" }}
                            aria-label={`Review at-risk student ${s.studentName || ""} in ${g.className}`}>
                            Review
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── AI Teacher Intelligence ── */}
      <div className="mx-4 mt-[14px] mb-[14px] rounded-[26px] p-[22px] relative overflow-hidden cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => navigate('/risks-alerts')}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/risks-alerts'); } }}
        aria-label="AI Teacher Intelligence — view risks and alerts"
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
            <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>AI Teacher Intelligence</div>
            <div className="ml-auto px-[10px] py-[4px] rounded-full text-[9px] font-bold"
              style={{
                background: "rgba(123,63,244,0.3)",
                border: "0.5px solid rgba(155,95,255,0.5)",
                color: "#DCC8FF",
                letterSpacing: "0.5px",
              }}>Live</div>
          </div>
          <div className="text-[13px] font-normal leading-[1.6] mb-[18px]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
            {aiMessage}
          </div>
          <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/attendance'); }}
              className="py-[13px] px-[6px] text-center active:brightness-110 transition"
              style={{ background: "rgba(0,20,80,0.55)" }}>
              <div className="text-[19px] font-bold" style={{ color: attC.gridText, letterSpacing: "-0.5px" }}>
                {attCardVal}
              </div>
              <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attend.</div>
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/risks-alerts'); }}
              className="py-[13px] px-[6px] text-center active:brightness-110 transition"
              style={{ background: "rgba(0,20,80,0.55)" }}>
              <div className="text-[19px] font-bold" style={{ color: stats.atRiskCount > 0 ? "#FF8899" : "#fff", letterSpacing: "-0.5px" }}>{stats.atRiskCount}</div>
              <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>At-Risk</div>
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/timetable'); }}
              className="py-[13px] px-[6px] text-center active:brightness-110 transition"
              style={{ background: "rgba(0,20,80,0.55)" }}>
              <div className="text-[19px] font-bold text-white" style={{ letterSpacing: "-0.5px" }}>{stats.activeClasses}</div>
              <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Classes</div>
            </button>
          </div>
        </div>
      </div>

      <div className="h-2" />

      {/* wave animation keyframes (scoped inline) */}
      <style>{`
        @keyframes tdWave {
          0%, 60%, 100% { transform: rotate(0deg); }
          10% { transform: rotate(14deg); }
          20% { transform: rotate(-8deg); }
          30% { transform: rotate(14deg); }
          40% { transform: rotate(-4deg); }
          50% { transform: rotate(10deg); }
        }
      `}</style>
      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div className="hidden md:block animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
        style={{ background: "#EEF4FF" }}>
        <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-12">

          {/* ── Header: Greeting + bell + avatar ── */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-[7px] text-[10px] font-bold uppercase mb-[8px]" style={{ color: TT3, letterSpacing: "1.8px" }}>
                <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: B1 }} />
                Teacher Dashboard
              </div>
              <div className="text-[36px] font-bold flex items-center gap-3 leading-[1.05]" style={{ color: TT1, letterSpacing: "-1.2px" }}>
                Hello, {firstName}
                <span className="inline-block text-[34px]" style={{ animation: "tdWave 2.8s ease-in-out infinite", transformOrigin: "70% 70%" }}>👋</span>
              </div>
              <div className="text-[14px] font-medium mt-[6px]" style={{ color: TT3, letterSpacing: "-0.15px" }}>
                Welcome back · {dayLabel}
              </div>
            </div>

            {/* Notifications + profile live in TeacherHeader (global) — no duplication here. */}
          </div>

          {/* ── Hero banner: Attendance Rate (principal-dashboard vibe) ── */}
          <button type="button" onClick={() => navigate('/attendance')}
            {...tilt3D}
            className="w-full text-left rounded-[28px] px-8 py-8 relative overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            style={{
              background: "linear-gradient(135deg, #001040 0%, #001A66 35%, #0044CC 70%, #0055FF 100%)",
              boxShadow: "0 10px 36px rgba(0,51,204,0.30), 0 0 0 0.5px rgba(255,255,255,0.10)",
              ...tilt3DStyle,
            }}>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 45%)"
            }} />
            {/* Radial glow — top-right */}
            <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full pointer-events-none" style={{
              background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)"
            }} />
            {/* Subtle grid overlay — principal dashboard signature */}
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
              backgroundSize: "26px 26px",
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
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18"/>
                    <path d="M7 14l4-4 4 4 5-5"/>
                  </svg>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Attendance Rate</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Last 30 days · All classes</div>
                </div>
                <div className="ml-auto flex items-center gap-[6px] px-4 py-[7px] rounded-full text-[11px] font-bold"
                  style={{
                    background: attC.bg,
                    border: `0.5px solid ${attC.border}`,
                    color: attC.txt,
                    letterSpacing: "0.3px",
                  }}>
                  <span className="w-[6px] h-[6px] rounded-full" style={{
                    background: attC.dot,
                    boxShadow: `0 0 8px ${attC.dot}`,
                  }} />
                  {attC.label}
                </div>
              </div>
              <div className="flex items-end justify-between gap-8 flex-wrap">
                <div>
                  <div className="text-[84px] font-bold text-white leading-none mb-[6px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-3.8px" }}>
                    {attDisplay}
                    {attHasData && <span className="text-[40px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-1px" }}>%</span>}
                  </div>
                  <div className="text-[14px] font-medium" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
                    <b className="text-white font-bold">Keep up the great work</b> — real-time data from your classes.
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[380px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  {[
                    { v: stats.activeClasses, l: "Classes" },
                    { v: stats.atRiskCount, l: "At-Risk" },
                    { v: stats.pendingGrading, l: "Pending" },
                  ].map(({ v, l }) => (
                    <div key={l} className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[26px] font-bold text-white" style={{ letterSpacing: "-0.8px" }}>{v}</div>
                      <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </button>

          {/* ── 4-column stat cards ── */}
          <div className="grid grid-cols-4 gap-4 mt-5">
            {[
              {
                label: "Attendance Rate",
                val: attCardVal,
                color: B1,
                tintBg: "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)",
                tintBorder: "rgba(0,85,255,0.10)",
                sub: !attHasData
                  ? <span>Awaiting data</span>
                  : <><span className="font-bold" style={{ color: attC.subColor }}>{attC.subLabel}</span> · last 30d</>,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="12" width="4" height="9" rx="1"/>
                    <rect x="10" y="8" width="4" height="13" rx="1"/>
                    <rect x="17" y="4" width="4" height="17" rx="1"/>
                  </svg>
                ),
                decor: (
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="13" width="4" height="8" rx="1"/>
                    <rect x="10" y="9" width="4" height="12" rx="1"/>
                    <rect x="17" y="5" width="4" height="16" rx="1"/>
                  </svg>
                ),
                path: "/attendance",
              },
              {
                label: "Pending Grading",
                val: `${stats.pendingGrading}`,
                color: ORANGE,
                tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)",
                tintBorder: "rgba(255,136,0,0.14)",
                sub: stats.pendingGrading === 0
                  ? <span className="font-bold" style={{ color: GREEN }}>✓ All caught up</span>
                  : <><span className="font-bold" style={{ color: ORANGE }}>● {stats.pendingGrading} to grade</span></>,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="3" width="16" height="18" rx="2"/>
                    <path d="M9 3v4h6V3"/>
                    <path d="M9 13l2 2 4-4"/>
                  </svg>
                ),
                decor: (
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="3" width="16" height="18" rx="2"/>
                    <path d="M9 3v4h6V3"/>
                    <path d="M8 12h8M8 16h6"/>
                  </svg>
                ),
                path: "/gradebook",
              },
              {
                label: "At-Risk Students",
                val: `${stats.atRiskCount}`,
                color: RED,
                tintBg: "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)",
                tintBorder: "rgba(255,51,85,0.14)",
                sub: stats.atRiskCount === 0
                  ? <span className="font-bold" style={{ color: GREEN }}>✓ On track</span>
                  : <span className="font-bold" style={{ color: RED }}>● Need outreach</span>,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 21h20L12 2z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12" y2="17"/>
                  </svg>
                ),
                decor: (
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3L3 20h18L12 3z"/>
                    <line x1="12" y1="10" x2="12" y2="14"/>
                    <circle cx="12" cy="17" r="0.6" fill="currentColor"/>
                  </svg>
                ),
                path: "/risks-alerts",
              },
              {
                label: "Classes Today",
                val: `${stats.activeClasses}`,
                color: VIOLET,
                tintBg: "linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)",
                tintBorder: "rgba(107,33,232,0.12)",
                sub: todayClasses.some(c => c.isNow)
                  ? <span className="font-bold" style={{ color: VIOLET }}>● 1 in progress</span>
                  : stats.activeClasses > 0
                    ? <span className="font-bold" style={{ color: VIOLET }}>● Scheduled</span>
                    : <span>None today</span>,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11l9-8 9 8"/>
                    <path d="M5 10v10h14V10"/>
                    <path d="M10 20v-6h4v6"/>
                  </svg>
                ),
                decor: (
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11l9-8 9 8"/>
                    <path d="M5 10v10h14V10"/>
                    <path d="M10 20v-6h4v6"/>
                  </svg>
                ),
                path: "/timetable",
              },
            ].map(({ label, val, color, tintBg, tintBorder, sub, icon, decor, path }) => (
              <button type="button" key={label}
                onClick={() => navigate(path)}
                {...tilt3D}
                className="rounded-[22px] p-5 relative flex flex-col text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40 overflow-hidden"
                style={{
                  background: tintBg,
                  boxShadow: "0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04)",
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
            ))}
          </div>

          {/* ── Leaderboard entry cards ── */}
          <div className="grid grid-cols-2 gap-4 mt-4">
            {[
              {
                label: "Class Leaderboard",
                sub: leaderboardClassSub,
                iconBg: B1,
                path: "/leaderboard",
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9H4.5a2.5 2.5 0 010-5H6"/>
                    <path d="M18 9h1.5a2.5 2.5 0 000-5H18"/>
                    <path d="M4 22h16"/>
                    <path d="M10 14.66V17a2 2 0 002 2v0a2 2 0 002-2v-2.34"/>
                    <path d="M18 2H6v7a6 6 0 0012 0V2z"/>
                  </svg>
                ),
              },
              {
                label: "Teacher Rankings",
                sub: leaderboardTeacherSub,
                iconBg: VIOLET,
                path: "/leaderboard/teachers",
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2l2.4 5.4L20 8l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.6L12 2z"/>
                  </svg>
                ),
              },
            ].map(({ label, sub, iconBg, path, icon }) => (
              <button type="button" key={label}
                onClick={() => navigate(path)}
                {...tilt3D}
                className="bg-white rounded-[22px] p-5 relative flex flex-col text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}>
                <div className="flex items-start gap-[10px] mb-5 relative" style={{ minHeight: 44 }}>
                  <div className="flex-1 min-w-0 text-[12px] font-bold uppercase leading-[1.3] pt-[4px]" style={{ color: TT3, letterSpacing: "0.8px" }}>
                    {label}
                  </div>
                  <div className="flex-shrink-0 w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white"
                    style={{
                      background: `linear-gradient(135deg, ${iconBg}, ${iconBg}DD)`,
                      boxShadow: `0 4px 14px ${iconBg}44`,
                      transform: "translateZ(18px)",
                    }}>
                    {icon}
                  </div>
                </div>
                <div className="text-[14px] font-semibold flex items-center gap-2" style={{ color: TT3, letterSpacing: "-0.15px", transform: "translateZ(10px)" }}>
                  <span className="flex-1 truncate">{sub}</span>
                  <span className="text-[20px] leading-none" style={{ color: B1 }}>›</span>
                </div>
              </button>
            ))}
          </div>

          {/* ── 2-column: Today's Classes + Pending Tasks ── */}
          <div className="grid grid-cols-2 gap-4 mt-4">

            {/* Today's Classes */}
            <div {...tilt3D}
              className="bg-white rounded-[22px] p-6"
              style={{
                boxShadow: SH_LG_D,
                border: `0.5px solid ${SEP_D}`,
                ...tilt3DStyle,
              }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white" style={{ background: B1 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-[17px] font-bold" style={{ color: TT1, letterSpacing: "-0.4px" }}>Today's Classes</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>{todayClasses.length} scheduled</div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/timetable')}
                  className="text-[13px] font-bold flex items-center gap-[2px] py-[6px] px-2 rounded-[8px] hover:bg-[#EEF4FF] transition-colors"
                  style={{ color: B1, letterSpacing: "-0.1px" }}>
                  Timetable <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
                </button>
              </div>
              {todayClasses.length === 0 ? (
                <div className="py-10 text-center text-[13px] font-medium" style={{ color: TT4 }}>No classes scheduled today</div>
              ) : (
                todayClasses.map((cls, idx) => (
                  <button type="button" key={idx}
                    onClick={() => navigate('/timetable')}
                    className={`w-full flex items-center gap-3 px-4 py-[14px] rounded-[14px] text-left hover:brightness-[0.98] active:scale-[0.995] transition ${idx < todayClasses.length - 1 ? "mb-2" : ""}`}
                    style={{ background: "#F4F7FE" }}>
                    <div className="w-[3px] self-stretch rounded-[3px] flex-shrink-0" style={{
                      background: cls.isNow ? GREEN : idx % 2 === 0 ? B1 : VIOLET,
                      minHeight: 36,
                    }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.25px" }}>{cls.subject}</div>
                      <div className="text-[12px] font-medium mt-[3px] truncate" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                        {cls.className}
                        <span className="mx-[5px]" style={{ color: TT4 }}>·</span>
                        {cls.students} {cls.students === 1 ? "student" : "students"}
                        {cls.time && cls.time !== "—" && !cls.isNow && (
                          <><span className="mx-[5px]" style={{ color: TT4 }}>·</span>{cls.time}</>
                        )}
                      </div>
                    </div>
                    {cls.isNow ? (
                      <div className="flex items-center gap-[5px] px-[11px] py-[6px] rounded-full text-[10px] font-bold text-white uppercase flex-shrink-0"
                        style={{ background: GREEN, letterSpacing: "0.6px" }}>
                        <span className="w-[5px] h-[5px] rounded-full bg-white animate-pulse" />
                        Now
                      </div>
                    ) : (
                      <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={TT4} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Pending Tasks */}
            <div {...tilt3D}
              className="bg-white rounded-[22px] p-6"
              style={{
                boxShadow: SH_LG_D,
                border: `0.5px solid ${SEP_D}`,
                ...tilt3DStyle,
              }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white" style={{ background: ORANGE }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="8 12 11 15 16 9"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-[17px] font-bold" style={{ color: TT1, letterSpacing: "-0.4px" }}>Pending Tasks</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                      {pendingTasks.length} {pendingTasks.length === 1 ? "task" : "tasks"} to complete
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/attendance')}
                  className="text-[13px] font-bold flex items-center gap-[2px] py-[6px] px-2 rounded-[8px] hover:bg-[#EEF4FF] transition-colors"
                  style={{ color: B1, letterSpacing: "-0.1px" }}>
                  Add <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
                </button>
              </div>
              {pendingTasks.length === 0 ? (
                <div className="py-10 text-center text-[13px] font-medium" style={{ color: TT4 }}>All tasks complete</div>
              ) : (
                pendingTasks.map((task, idx) => (
                  <button type="button" key={idx}
                    onClick={() => navigate(task.title.toLowerCase().includes('attendance') ? '/attendance' : '/gradebook')}
                    className={`w-full flex items-center gap-3 p-4 rounded-[14px] relative overflow-hidden text-left hover:brightness-[0.98] active:scale-[0.995] transition-transform ${idx < pendingTasks.length - 1 ? "mb-2" : ""}`}
                    style={{ background: "rgba(255,136,0,0.06)" }}>
                    <div className="absolute left-0 top-[16px] bottom-[16px] w-[3px] rounded-r-[3px]" style={{ background: ORANGE }} />
                    <div className="w-[40px] h-[40px] rounded-[13px] flex items-center justify-center text-white flex-shrink-0 ml-1"
                      style={{ background: ORANGE }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 11l3 3L22 4"/>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-bold" style={{ color: TT1, letterSpacing: "-0.25px", textDecoration: task.done ? "line-through" : "none" }}>{task.title}</div>
                      <div className="text-[12px] font-bold mt-[3px]" style={{ color: ORANGE, letterSpacing: "-0.1px" }}>{task.sub}</div>
                    </div>
                    <div className="px-[12px] py-[6px] rounded-full text-[10px] font-bold text-white uppercase flex-shrink-0"
                      style={{ background: ORANGE, letterSpacing: "0.7px" }}>
                      {task.status === 'Pending' ? 'Pending' : 'Todo'}
                    </div>
                  </button>
                ))
              )}
            </div>

          </div>

          {/* ── 2-column: Needs Attention + AI Intelligence ── */}
          <div className="grid grid-cols-2 gap-4 mt-4">

            {/* Needs Attention */}
            <div {...tilt3D}
              className="bg-white rounded-[22px] p-6"
              style={{
                boxShadow: SH_LG_D,
                border: `0.5px solid ${SEP_D}`,
                ...tilt3DStyle,
              }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white" style={{ background: RED }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2L2 21h20L12 2z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12" y2="17"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-[17px] font-bold" style={{ color: TT1, letterSpacing: "-0.4px" }}>Needs Attention</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                      {flaggedByClass.length === 0
                        ? "All students on track"
                        : `${flaggedByClass.length} class${flaggedByClass.length === 1 ? '' : 'es'} flagged`}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/risks-alerts')}
                  className="text-[13px] font-bold flex items-center gap-[2px] py-[6px] px-2 rounded-[8px] hover:bg-[#EEF4FF] transition-colors"
                  style={{ color: B1, letterSpacing: "-0.1px" }}>
                  View all <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
                </button>
              </div>
              {flaggedByClass.length === 0 ? (
                <div className="py-10 text-center text-[13px] font-medium" style={{ color: TT4 }}>All students on track</div>
              ) : (
                flaggedByClass.map((g, gIdx) => {
                  const key = flaggedKey(g);
                  const isOpen = expandedClassKey === key;
                  const headerColor = g.criticalCount > 0 ? RED : ORANGE;
                  const headerBg = g.criticalCount > 0 ? "rgba(255,51,85,0.05)" : "rgba(255,136,0,0.05)";
                  return (
                    <div key={key} className={gIdx < flaggedByClass.length - 1 ? "mb-2" : ""}>
                      {/* Accordion header */}
                      <button type="button"
                        onClick={() => setExpandedClassKey(prev => prev === key ? null : key)}
                        aria-expanded={isOpen}
                        aria-controls={`flagged-class-panel-d-${key}`}
                        className="w-full flex items-center justify-between px-4 py-[12px] rounded-[12px] text-left hover:brightness-[0.98] active:scale-[0.998] transition-all"
                        style={{ background: isOpen ? headerBg : "rgba(0,85,255,0.03)",
                                 border: `0.5px solid ${isOpen ? headerColor + "40" : "rgba(0,85,255,0.10)"}` }}>
                        <div className="flex items-center gap-[10px] min-w-0 flex-1">
                          <span className="text-[12px] font-bold uppercase truncate" style={{ color: TT1, letterSpacing: "0.8px" }}>
                            {g.className || "Unassigned"}
                          </span>
                          <span className="text-[10px] font-bold px-[9px] py-[3px] rounded-full flex-shrink-0"
                            style={{ background: g.criticalCount > 0 ? "rgba(255,51,85,0.12)" : "rgba(255,136,0,0.12)",
                                     color: headerColor,
                                     letterSpacing: "0.4px" }}>
                            {g.count} flagged{g.criticalCount > 0 ? ` · ${g.criticalCount} critical` : ""}
                          </span>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TT3} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.18s ease", flexShrink: 0 }}
                          aria-hidden="true">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </button>
                      {/* Expandable panel */}
                      {isOpen && (
                        <div id={`flagged-class-panel-d-${key}`} className="mt-2">
                          {g.students.map((s, sIdx) => {
                            const name = s.studentName || "Student";
                            const initStr = (() => { const p = name.trim().split(" "); return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].substring(0, 2)).toUpperCase(); })();
                            const isCritical = s.level === "critical";
                            const avatarBg = isCritical ? RED : ORANGE;
                            const accent = isCritical ? RED : ORANGE;
                            return (
                              <div key={`${key}_${s.studentId || sIdx}`}
                                onClick={() => navigate(`/students?studentId=${s.studentId || ''}`)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/students?studentId=${s.studentId || ''}`); }}
                                className={`flex items-center gap-3 p-3 pl-4 rounded-[14px] cursor-pointer hover:brightness-[0.97] transition ${sIdx < g.students.length - 1 ? "mb-2" : ""}`}
                                style={{ background: isCritical ? "rgba(255,51,85,0.04)" : "rgba(255,136,0,0.04)" }}>
                                <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0"
                                  style={{ background: avatarBg, letterSpacing: "0.3px" }}>
                                  {initStr}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[14px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.25px" }}>{name}</div>
                                  <div className="flex items-center gap-[5px] mt-[3px] text-[12px] font-semibold" style={{ color: accent, letterSpacing: "-0.1px" }}>
                                    <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: accent }} />
                                    <span className="truncate">{s.trigger}</span>
                                  </div>
                                </div>
                                <button type="button"
                                  onClick={(e) => { e.stopPropagation(); navigate('/risks-alerts'); }}
                                  className="px-4 py-[9px] rounded-[11px] text-[12px] font-bold text-white flex-shrink-0 hover:scale-[1.04] active:scale-[0.95] transition-transform"
                                  style={{ background: accent, letterSpacing: "-0.1px" }}
                                  aria-label={`Review at-risk student ${name} in ${g.className}`}>
                                  Review
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* AI Teacher Intelligence */}
            <div {...tilt3D}
              role="button"
              tabIndex={0}
              onClick={() => navigate('/risks-alerts')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/risks-alerts'); } }}
              aria-label="AI Teacher Intelligence — view risks and alerts"
              className="rounded-[26px] p-7 relative overflow-hidden cursor-pointer"
              style={{
                background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
                boxShadow: "0 10px 36px rgba(0,51,204,0.30), 0 0 0 0.5px rgba(255,255,255,0.10)",
                ...tilt3DStyle,
              }}>
              <div className="absolute inset-0 pointer-events-none" style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 45%)"
              }} />
              <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full pointer-events-none" style={{
                background: "radial-gradient(circle, rgba(255,221,85,0.14) 0%, transparent 65%)"
              }} />
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
                backgroundSize: "26px 26px",
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
                  <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>AI Teacher Intelligence</div>
                  <div className="ml-auto px-[11px] py-[5px] rounded-full text-[10px] font-bold"
                    style={{
                      background: "rgba(123,63,244,0.3)",
                      border: "0.5px solid rgba(155,95,255,0.5)",
                      color: "#DCC8FF",
                      letterSpacing: "0.5px",
                    }}>Live</div>
                </div>
                <div className="text-[14px] font-normal leading-[1.6] mb-5" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                  {aiMessage}
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/attendance'); }}
                    className="py-4 px-3 text-center hover:brightness-110 transition"
                    style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[22px] font-bold" style={{ color: attC.gridText, letterSpacing: "-0.6px" }}>
                      {attCardVal}
                    </div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attend.</div>
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/risks-alerts'); }}
                    className="py-4 px-3 text-center hover:brightness-110 transition"
                    style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[22px] font-bold" style={{ color: stats.atRiskCount > 0 ? "#FF8899" : "#fff", letterSpacing: "-0.6px" }}>{stats.atRiskCount}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>At-Risk</div>
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/timetable'); }}
                    className="py-4 px-3 text-center hover:brightness-110 transition"
                    style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[22px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{stats.activeClasses}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Classes</div>
                  </button>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

      {/* Global mobile bottom nav is rendered by TeacherLayout — no duplicate here */}

    </div>
  );
};

export default Dashboard;
