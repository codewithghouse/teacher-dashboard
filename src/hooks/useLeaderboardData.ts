// Real-data hooks for the Leaderboard module. Computed client-side from
// existing collections (teaching_assignments, classes, enrollments, attendance,
// test_scores, gradebook_scores, student_ratings). All hooks are cached via
// TanStack Query so multiple screens hitting the same data don't trigger
// redundant Firestore reads.
//
// Composite formula (4-metric weighted, re-normalized over present components):
//   marks         × 0.40   — academic performance
//   attendance    × 0.25   — presence
//   behaviour     × 0.20   — teacher rating (1-5 stars × 20)
//   participation × 0.15   — test-taking rate vs class
//   = composite (0–100). Missing components → weights re-normalized over present ones.
//
// Score sources read together (per memory `owner_dashboard_alternate_data_sources`):
//   - test_scores      writes `percentage` + `timestamp`
//   - gradebook_scores writes `mark` + `maxMarks` + `updatedAt`
// Both are co-canonical — reading only one drops ~40% of records.
//
// Behaviour signal (per memory `cross_dashboard_behaviour_sync`):
//   - student_ratings — teacher Quick Rate (1–5 stars), dual-key (studentId + studentEmail)
//
// Tenant scoping (per memory `bug_pattern_branch_filter_on_event_streams`):
//   - Resolution entities (teachers/classes/teaching_assignments) — schoolId + branchId
//   - Event streams       (test_scores/gradebook_scores/attendance/enrollments/student_ratings) — schoolId only
//   Branch isolation on events happens via the resolved teacher set in-memory.
//
// What's intentionally NOT computed here:
//   - 8-week trajectories  (no weekly snapshots in Firestore yet)
//   - Forecasts / scenarios (no model)
//   - School-wide rank      (needs branch-level aggregation cron)
// Screens render empty/placeholder states for those sections — see Leaderboard.tsx.

import { useQuery, type QueryFunction } from "@tanstack/react-query";
import {
  collection, query, where, getDocs,
  type QueryConstraint, type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, type TeacherDoc } from "@/lib/AuthContext";
import { AIController } from "@/ai/controller/ai-controller";
import {
  classPlanKey, studentPlanKey, teacherSelfPlanKey,
  getInflight, setInflight, lsRead, lsWrite,
  fsRead, fsWrite,
  type FirestoreCacheCoords, type TenantContext,
} from "@/lib/leaderboardPlanCache";

// ── Types ───────────────────────────────────────────────────────────────────
export interface LeaderboardClass {
  classId: string;
  name: string;          // e.g. "6-A"
  subject: string;
  studentCount: number;
}

export type StudentStatus = "good" | "attention" | "at_risk" | "no_data";

export interface LeaderboardStudent {
  studentId: string;
  studentEmail?: string;
  name: string;
  initials: string;
  rollNo: string;
  classId: string;
  className: string;
  avgScorePct: number;
  attendancePct: number;
  behaviourPct: number;          // mean rating × 20, falls back to neutral 60 when no ratings
  behaviourFromDefault: boolean; // true when behaviourPct came from neutral default (not real ratings)
  participationPct: number;      // student tests / class avg tests × 100, capped 100
  composite: number;             // weighted over present metrics, re-normalized
  rank: number;
  status: StudentStatus;
  hasData: boolean;
}

export interface ClassLeaderboard {
  classId: string;
  className: string;
  subject: string;
  totalStudents: number;
  classAverage: number;       // mean composite (excludes no-data students)
  classAvgScore: number;      // mean marks
  classAvgAttendance: number; // mean attendance %
  needAttentionCount: number;
  topStudents: LeaderboardStudent[];      // up to top 5 + the rest down to bottom 4
  needAttentionStudents: LeaderboardStudent[]; // bottom 3 sorted ascending by composite
  allStudents: LeaderboardStudent[];      // every student with computed rank
  noDataStudents: LeaderboardStudent[];   // separated so they don't pollute averages or rankings
}

export interface StudentSubjectScore {
  subject: string;
  score: number;
  classAvg: number;
  gap: number;
  status: "critical" | "weak" | "least_weak" | "okay";
  isYourSubject?: boolean;
}

export interface StudentDetail {
  studentId: string;
  name: string;
  initials: string;
  rollNo: string;
  classId: string;
  classLabel: string;
  rank: number;
  totalInClass: number;
  composite: number;
  status: StudentStatus;
  hasData: boolean;
  metrics: {
    marks:         { value: number; classAvg: number; gap: number; severity: "critical" | "warning" | "weak" | "okay" };
    attendance:    { value: number; classAvg: number; gap: number; severity: "critical" | "warning" | "weak" | "okay" };
    behaviour:     { value: number; classAvg: number; gap: number; severity: "critical" | "warning" | "weak" | "okay"; ratingCount: number; fromDefault: boolean };
    participation: { value: number; classAvg: number; gap: number; severity: "critical" | "warning" | "weak" | "okay" };
  };
  subjects: StudentSubjectScore[];
}

export interface TeacherClassSummary {
  classId: string;
  label: string;        // "6-A · Math"
  studentCount: number;
  classAverage: number;
  classAvgScore: number;
  classAvgAttendance: number;
}

export interface TeacherSelfMetrics {
  teacherId: string;
  name: string;
  subject: string;
  branch: string;
  totalStudents: number;
  composite: number;          // weighted aggregate across teacher's classes
  studentsAvg: number;        // mean of student composites
  classAvgScore: number;
  classAvgAttendance: number;
  classes: TeacherClassSummary[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────
type Snap = { id: string; data: DocumentData };

function fetchAll(coll: string, constraints: QueryConstraint[]): Promise<Snap[]> {
  return getDocs(query(collection(db, coll), ...constraints))
    .then(s => s.docs.map(d => ({ id: d.id, data: d.data() })));
}

/** Resolution entities (teachers/classes/teaching_assignments) — schoolId + branchId. */
function entConstraints(t: TeacherDoc | null | undefined): QueryConstraint[] | null {
  if (!t?.id || !t?.schoolId) return null;
  const SC: QueryConstraint[] = [where("schoolId", "==", t.schoolId)];
  if (t.branchId) SC.push(where("branchId", "==", t.branchId as string));
  return SC;
}

/** Event streams (test_scores/gradebook_scores/attendance/enrollments) — schoolId only.
 *  Branch isolation on events comes from the resolved teacher set, not a Firestore filter
 *  — branchId backfill has 1-2s lag and silently drops fresh writes (memory `branchid_inference_lag`). */
function evtConstraints(t: TeacherDoc | null | undefined): QueryConstraint[] | null {
  if (!t?.id || !t?.schoolId) return null;
  return [where("schoolId", "==", t.schoolId)];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) || "ST").toUpperCase();
}

// ── Composite weights (single source of truth — exported for footer text) ───
export const COMPOSITE_WEIGHTS = {
  marks:         0.40,
  attendance:    0.25,
  behaviour:     0.20,
  participation: 0.15,
} as const;

// Behaviour neutral default: applied when a student has zero teacher ratings.
// Why: re-normalizing the behaviour weight onto other metrics rewarded unrated
// students with rank inflation (a student with no rating could outrank a rated
// student because the absent metric was "free"). Treating missing rating as
// neutral 60/100 (3 stars) keeps the comparison apples-to-apples and gives
// teachers an incentive to rate (so students can climb above neutral).
export const BEHAVIOUR_NEUTRAL_DEFAULT = 60;

export interface CompositeComponents {
  marks?: number;          // 0-100
  attendance?: number;     // 0-100
  behaviour?: number;      // 0-100 (1-5 stars × 20)
  participation?: number;  // 0-100 (capped)
}

/** Re-normalized weighted composite. Missing components are dropped from both
 *  numerator and denominator, so a student with only marks gets composite = marks. */
export function computeComposite(c: CompositeComponents): { composite: number; presentCount: number } {
  let weightedSum = 0;
  let totalWeight = 0;
  let presentCount = 0;
  if (Number.isFinite(c.marks)) {
    weightedSum += (c.marks as number) * COMPOSITE_WEIGHTS.marks;
    totalWeight += COMPOSITE_WEIGHTS.marks;
    presentCount += 1;
  }
  if (Number.isFinite(c.attendance)) {
    weightedSum += (c.attendance as number) * COMPOSITE_WEIGHTS.attendance;
    totalWeight += COMPOSITE_WEIGHTS.attendance;
    presentCount += 1;
  }
  if (Number.isFinite(c.behaviour)) {
    weightedSum += (c.behaviour as number) * COMPOSITE_WEIGHTS.behaviour;
    totalWeight += COMPOSITE_WEIGHTS.behaviour;
    presentCount += 1;
  }
  if (Number.isFinite(c.participation)) {
    weightedSum += (c.participation as number) * COMPOSITE_WEIGHTS.participation;
    totalWeight += COMPOSITE_WEIGHTS.participation;
    presentCount += 1;
  }
  if (totalWeight === 0) return { composite: 0, presentCount: 0 };
  return { composite: weightedSum / totalWeight, presentCount };
}

function statusOf(c: CompositeComponents, composite: number, presentCount: number): StudentStatus {
  if (presentCount === 0) return "no_data";
  if (composite > 0 && composite < 45) return "at_risk";
  if (composite < 60) return "attention";
  // Attendance-specific guard: even if composite is OK, sub-85% attendance is "attention"
  if (Number.isFinite(c.attendance) && (c.attendance as number) < 85) return "attention";
  return "good";
}

function severityOf(value: number, classAvg: number, kind: "marks" | "attendance" | "behaviour" | "participation"): "critical" | "warning" | "weak" | "okay" {
  const gap = value - classAvg;
  if (kind === "marks" && value < 50) return "critical";
  if (kind === "attendance" && value < 70) return "critical";
  if (kind === "behaviour" && value > 0 && value < 40) return "critical"; // < 2 stars avg
  if (gap <= -20) return "critical";
  if (gap <= -10) return "warning";
  if (gap <= -5) return "weak";
  return "okay";
}

/** Read percentage from a score doc — handles BOTH test_scores and gradebook_scores shapes.
 *  - test_scores:      `percentage` field (already a %)
 *  - gradebook_scores: `mark` / `maxMarks`     (memory `bug_pattern_score_field_singular_mark`)
 *  Returns null when the doc has no usable score (caller filters those out). */
function readScorePct(d: DocumentData): number | null {
  const pct = Number(d.percentage);
  if (Number.isFinite(pct)) return pct;
  const mark = Number(d.mark);
  const max = Number(d.maxMarks);
  if (Number.isFinite(mark) && Number.isFinite(max) && max > 0) return (mark / max) * 100;
  // Some legacy gradebook docs use `marks` (plural); be tolerant
  const marks = Number(d.marks);
  if (Number.isFinite(marks) && Number.isFinite(max) && max > 0) return (marks / max) * 100;
  return null;
}

/** Pick a human class name. Walks several fields, falls back to subject+section,
 *  finally a short id snippet. Mirrors Reports.tsx pattern. */
function pickClassName(cd: DocumentData | undefined, cid: string): string {
  if (!cd) return cid ? `Class ${cid.slice(0, 6)}` : "Class";
  const direct = (cd.name as string) || (cd.className as string) || (cd.label as string) || (cd.title as string);
  if (direct && direct.trim()) return direct.trim();
  const subj = (cd.subject as string) || "";
  const sect = (cd.section as string) || (cd.grade as string) || "";
  const composed = [subj, sect].filter(Boolean).join(" ");
  if (composed.trim()) return composed.trim();
  return cid ? `Class ${cid.slice(0, 6)}` : "Class";
}

/** 90-day in-memory cutoff for branch event reduction (memory `bug_pattern_filterbytime_field_drift`). */
const BRANCH_WINDOW_DAYS = 90;
const BRANCH_WINDOW_MS = BRANCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
function withinBranchWindow(d: DocumentData, kind: "score" | "att"): boolean {
  const cutoff = Date.now() - BRANCH_WINDOW_MS;
  if (kind === "score") {
    // test_scores → timestamp (Firestore Timestamp), gradebook_scores → updatedAt (ms number)
    const ts = d.timestamp;
    if (ts && typeof ts.toMillis === "function") return ts.toMillis() >= cutoff;
    if (Number.isFinite(d.updatedAt)) return Number(d.updatedAt) >= cutoff;
    return true; // legacy doc without timestamp — keep
  }
  // attendance → date YYYY-MM-DD string
  const dateStr = (d.date as string) || "";
  if (!dateStr) return true;
  const parsed = Date.parse(dateStr);
  if (!Number.isFinite(parsed)) return true;
  return parsed >= cutoff;
}

// ── Score/attendance/behaviour bucket builder — shared between class & student hooks ──
type StudentBucket = {
  studentId: string;
  studentEmail?: string;
  name: string;
  rollNo: string;
  classId: string;
  className: string;
  scoreSum: number;
  scoreCount: number;
  presentCount: number;
  attTotal: number;
  ratingSum: number;
  ratingCount: number;
};

interface ComputedStudent {
  bucket: StudentBucket;
  avgScore: number;
  attendance: number;
  behaviour: number;
  participation: number;
  composite: number;
  presentCount: number;       // metric count, not attendance presence count
  hasScoreData: boolean;
  hasAttData: boolean;
  hasBehData: boolean;            // real teacher ratings exist
  behaviourFromDefault: boolean;  // true when we used BEHAVIOUR_NEUTRAL_DEFAULT
  hasPartData: boolean;
}

function buildBucketsFromEnrollments(
  enrollSnaps: Snap[],
  classId: string,
  classNameFallback: string,
): Map<string, StudentBucket> {
  const byKey = new Map<string, StudentBucket>();
  enrollSnaps.forEach(e => {
    const d = e.data;
    const key = (d.studentId as string) || (d.studentEmail as string);
    if (!key || byKey.has(key)) return;
    byKey.set(key, {
      studentId: (d.studentId as string) || key,
      studentEmail: (d.studentEmail as string | undefined)?.toLowerCase(),
      name: (d.studentName as string) || "Student",
      rollNo: (d.rollNo as string) || "—",
      classId,
      className: (d.className as string) || classNameFallback,
      scoreSum: 0, scoreCount: 0,
      presentCount: 0, attTotal: 0,
      ratingSum: 0, ratingCount: 0,
    });
  });
  return byKey;
}

function makeMatcher(byKey: Map<string, StudentBucket>) {
  return (rec: DocumentData): string | null => {
    if (rec.studentId && byKey.has(rec.studentId as string)) return rec.studentId as string;
    const email = (rec.studentEmail as string | undefined)?.toLowerCase();
    if (email) {
      for (const [k, v] of byKey) if (v.studentEmail === email) return k;
    }
    return null;
  };
}

function applyScoresToBuckets(scoreSnaps: Snap[], byKey: Map<string, StudentBucket>): void {
  const matchKey = makeMatcher(byKey);
  scoreSnaps.forEach(s => {
    const key = matchKey(s.data);
    if (!key) return;
    if (s.data.isAbsent === true) return;
    const pct = readScorePct(s.data);
    if (pct === null) return;
    const b = byKey.get(key)!;
    b.scoreSum += pct;
    b.scoreCount += 1;
  });
}

function applyAttendanceToBuckets(attSnaps: Snap[], byKey: Map<string, StudentBucket>): void {
  const matchKey = makeMatcher(byKey);
  attSnaps.forEach(a => {
    const key = matchKey(a.data);
    if (!key) return;
    const b = byKey.get(key)!;
    const status = String(a.data.status ?? "").toLowerCase();
    if (status === "present" || status === "late") b.presentCount += 1;
    b.attTotal += 1;
  });
}

function applyRatingsToBuckets(ratingSnaps: Snap[], byKey: Map<string, StudentBucket>): void {
  const matchKey = makeMatcher(byKey);
  ratingSnaps.forEach(r => {
    const key = matchKey(r.data);
    if (!key) return;
    const rating = Number(r.data.rating);
    if (!Number.isFinite(rating) || rating <= 0) return;
    const b = byKey.get(key)!;
    b.ratingSum += rating;
    b.ratingCount += 1;
  });
}

/** Compute participation rate per student. Class-level helper — returns the
 *  classAvgTestsPerStudent so participation can be re-used across hooks. */
function computeParticipation(byKey: Map<string, StudentBucket>): {
  classAvgTestsPerStudent: number;
  participationPct: (b: StudentBucket) => number;
} {
  const totalTests = Array.from(byKey.values()).reduce((acc, b) => acc + b.scoreCount, 0);
  const enrolled = Math.max(byKey.size, 1);
  const classAvgTestsPerStudent = totalTests / enrolled;
  return {
    classAvgTestsPerStudent,
    participationPct: (b: StudentBucket) => {
      if (classAvgTestsPerStudent <= 0) return 0;
      return Math.min((b.scoreCount / classAvgTestsPerStudent) * 100, 100);
    },
  };
}

function computeStudentRows(byKey: Map<string, StudentBucket>): ComputedStudent[] {
  const { classAvgTestsPerStudent, participationPct } = computeParticipation(byKey);
  return Array.from(byKey.values()).map(b => {
    const hasScoreData = b.scoreCount > 0;
    const hasAttData = b.attTotal > 0;
    const hasBehData = b.ratingCount > 0;
    // Participation only counts when the class itself has tests on record;
    // otherwise classAvg is 0 and the metric is meaningless.
    const hasPartData = hasScoreData && classAvgTestsPerStudent > 0;
    const avgScore = hasScoreData ? b.scoreSum / b.scoreCount : 0;
    const attendance = hasAttData ? (b.presentCount / b.attTotal) * 100 : 0;
    // Behaviour: real rating average if any, else neutral 60 (3 stars).
    // Neutral default is applied ONLY when the student has at least one other
    // metric on record — students with literally no data fall through to no_data.
    const hasAnyOtherMetric = hasScoreData || hasAttData;
    const useBehaviourDefault = !hasBehData && hasAnyOtherMetric;
    const behaviour = hasBehData
      ? (b.ratingSum / b.ratingCount) * 20
      : (useBehaviourDefault ? BEHAVIOUR_NEUTRAL_DEFAULT : 0);
    const participation = hasPartData ? participationPct(b) : 0;
    const components: CompositeComponents = {
      marks:         hasScoreData ? avgScore : undefined,
      attendance:    hasAttData   ? attendance : undefined,
      // Behaviour now ALWAYS contributes when student has any data — defaults
      // to neutral 60 when no rating, so unrated students can't rank-inflate.
      behaviour:     (hasBehData || useBehaviourDefault) ? behaviour : undefined,
      participation: hasPartData  ? participation : undefined,
    };
    const { composite, presentCount } = computeComposite(components);
    return {
      bucket: b,
      avgScore, attendance, behaviour, participation,
      composite,
      presentCount,
      hasScoreData, hasAttData, hasBehData, hasPartData,
      behaviourFromDefault: useBehaviourDefault,
    };
  });
}

// ── Hook 1: teacher's assigned classes (dropdown source) ────────────────────
export function useTeacherClasses() {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<LeaderboardClass[]> = async () => {
    const SC_ENT = entConstraints(teacherData);
    const SC_EVT = evtConstraints(teacherData);
    if (!SC_ENT || !SC_EVT) return [];

    // Resolution entities — branch-scoped is OK
    const [activeAssignments, ownedClasses] = await Promise.all([
      fetchAll("teaching_assignments", [...SC_ENT, where("teacherId", "==", tid as string)]),
      fetchAll("classes", [...SC_ENT, where("teacherId", "==", tid as string)]),
    ]);

    // Active filter is in-memory so legacy docs without `status` aren't dropped
    const activeAssignmentsKept = activeAssignments.filter(a => {
      const s = String(a.data.status ?? "").toLowerCase();
      return !s || s === "active";
    });

    const assignedIds = activeAssignmentsKept.map(s => s.data.classId).filter(Boolean) as string[];
    const ownedIds = ownedClasses.map(s => s.id);
    const allIds = Array.from(new Set([...assignedIds, ...ownedIds]));
    if (allIds.length === 0) return [];

    // Class docs (full set, then in-memory filter — needed for label rendering)
    const allClassSnaps = await fetchAll("classes", SC_ENT);
    const classDocsById = new Map<string, DocumentData>(
      allClassSnaps.filter(s => allIds.includes(s.id)).map(s => [s.id, s.data])
    );

    // Enrollments: drop teacherId filter — enrollments are class-level, principal-written.
    // Filter in-memory by allIds. Event-stream scoping (schoolId only) per memory.
    const enrollSnaps = await fetchAll("enrollments", SC_EVT);
    const enrollByClass = new Map<string, number>();
    enrollSnaps.forEach(e => {
      const cid = e.data.classId as string | undefined;
      if (!cid || !allIds.includes(cid)) return;
      enrollByClass.set(cid, (enrollByClass.get(cid) ?? 0) + 1);
    });

    // Aggregate subjects when a teacher teaches multiple subjects in the same class
    const subjectsByClass = new Map<string, Set<string>>();
    activeAssignmentsKept.forEach(a => {
      const cid = a.data.classId as string | undefined;
      if (!cid) return;
      const subj = (a.data.subjectName || a.data.subject) as string | undefined;
      if (subj) {
        if (!subjectsByClass.has(cid)) subjectsByClass.set(cid, new Set());
        subjectsByClass.get(cid)!.add(subj.trim());
      }
    });

    return allIds.map<LeaderboardClass>(cid => {
      const cd = classDocsById.get(cid);
      const subjSet = subjectsByClass.get(cid);
      const subject = subjSet && subjSet.size > 0
        ? Array.from(subjSet).join(" · ")
        : (cd?.subject as string) || (teacherData?.subject as string) || "Subject";
      return {
        classId: cid,
        name: pickClassName(cd, cid),
        subject,
        studentCount: enrollByClass.get(cid) ?? 0,
      };
    });
  };

  return useQuery<LeaderboardClass[]>({
    queryKey: ["leaderboard", "classes", tid, sid, bid],
    queryFn,
    enabled: Boolean(tid && sid),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// ── Hook 2: leaderboard for one class ──────────────────────────────────────
export function useClassLeaderboard(classId: string | null | undefined) {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<ClassLeaderboard | null> = async () => {
    const SC_ENT = entConstraints(teacherData);
    const SC_EVT = evtConstraints(teacherData);
    if (!SC_ENT || !SC_EVT || !classId) return null;

    // Event reads are scoped to schoolId + classId (+ teacherId for scores/attendance —
    // they're teacher-owned in this data model). NO branchId filter on streams.
    // student_ratings is class-scoped (any teacher in the class can rate).
    const [enrollSnaps, testScoreSnaps, gradebookSnaps, attSnaps, ratingSnaps, classSnaps, assignSnaps] = await Promise.all([
      fetchAll("enrollments",      [...SC_EVT, where("classId", "==", classId)]),
      fetchAll("test_scores",      [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("gradebook_scores", [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]).catch(() => [] as Snap[]),
      fetchAll("attendance",       [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("student_ratings",  [...SC_EVT, where("classId", "==", classId)]).catch(() => [] as Snap[]),
      fetchAll("classes",          SC_ENT),
      fetchAll("teaching_assignments", [...SC_ENT, where("classId", "==", classId)]),
    ]);

    // Merge canonical score collections (per memory `owner_dashboard_alternate_data_sources`)
    const scoreSnaps: Snap[] = [...testScoreSnaps, ...gradebookSnaps];

    const classDoc = classSnaps.find(c => c.id === classId)?.data;
    const className = pickClassName(classDoc, classId);

    // Aggregate subjects for the assignment label
    const assignSubjects = new Set<string>();
    assignSnaps.forEach(a => {
      const s = String(a.data.status ?? "").toLowerCase();
      if (s && s !== "active") return;
      const subj = (a.data.subjectName || a.data.subject) as string | undefined;
      if (subj) assignSubjects.add(subj.trim());
    });
    const subject = assignSubjects.size > 0
      ? Array.from(assignSubjects).join(" · ")
      : (classDoc?.subject as string) || (teacherData?.subject as string) || "Subject";

    if (enrollSnaps.length === 0) {
      return {
        classId, className, subject,
        totalStudents: 0, classAverage: 0, classAvgScore: 0, classAvgAttendance: 0,
        needAttentionCount: 0, topStudents: [], needAttentionStudents: [], allStudents: [],
        noDataStudents: [],
      };
    }

    const byKey = buildBucketsFromEnrollments(enrollSnaps, classId, className);
    applyScoresToBuckets(scoreSnaps, byKey);
    applyAttendanceToBuckets(attSnaps, byKey);
    applyRatingsToBuckets(ratingSnaps, byKey);

    const computed = computeStudentRows(byKey);

    const ranked = computed.filter(c => c.presentCount > 0);
    const noData = computed.filter(c => c.presentCount === 0);

    const toRow = (c: ComputedStudent, rank: number): LeaderboardStudent => ({
      studentId: c.bucket.studentId,
      studentEmail: c.bucket.studentEmail,
      name: c.bucket.name,
      initials: initialsOf(c.bucket.name),
      rollNo: c.bucket.rollNo,
      classId: c.bucket.classId,
      className: c.bucket.className,
      avgScorePct: Number(c.avgScore.toFixed(1)),
      attendancePct: Number(c.attendance.toFixed(1)),
      behaviourPct: Number(c.behaviour.toFixed(1)),
      behaviourFromDefault: c.behaviourFromDefault,
      participationPct: Number(c.participation.toFixed(1)),
      composite: Number(c.composite.toFixed(1)),
      rank,
      status: statusOf(
        {
          marks: c.hasScoreData ? c.avgScore : undefined,
          attendance: c.hasAttData ? c.attendance : undefined,
          behaviour: c.hasBehData ? c.behaviour : undefined,
          participation: c.hasPartData ? c.participation : undefined,
        },
        c.composite,
        c.presentCount,
      ),
      hasData: c.presentCount > 0,
    });

    ranked.sort((a, b) => b.composite - a.composite || a.bucket.name.localeCompare(b.bucket.name));
    const allStudents = ranked.map((c, i) => toRow(c, i + 1));
    const noDataStudents = noData.map(c => toRow(c, 0));

    const totalRanked = ranked.length;
    const classAverage = totalRanked > 0 ? ranked.reduce((acc, c) => acc + c.composite, 0) / totalRanked : 0;
    const classAvgScore = totalRanked > 0 ? ranked.reduce((acc, c) => acc + c.avgScore, 0) / totalRanked : 0;
    const classAvgAttendance = totalRanked > 0 ? ranked.reduce((acc, c) => acc + c.attendance, 0) / totalRanked : 0;
    const needAttention = allStudents.filter(s => s.status !== "good");

    const top5 = allStudents.slice(0, 5);
    const mid = totalRanked > 8 ? [allStudents[Math.floor(totalRanked * 0.4)], allStudents[Math.floor(totalRanked * 0.6)]] : [];
    const topStudents = [...top5, ...mid].filter((s, i, arr) => arr.findIndex(x => x.studentId === s.studentId) === i);
    const needAttentionStudents = allStudents.slice(-3).reverse();

    return {
      classId,
      className,
      subject,
      totalStudents: totalRanked + noDataStudents.length,
      classAverage: Number(classAverage.toFixed(1)),
      classAvgScore: Number(classAvgScore.toFixed(1)),
      classAvgAttendance: Number(classAvgAttendance.toFixed(1)),
      needAttentionCount: needAttention.length,
      topStudents,
      needAttentionStudents,
      allStudents,
      noDataStudents,
    };
  };

  return useQuery<ClassLeaderboard | null>({
    queryKey: ["leaderboard", "class", classId, tid, sid, bid],
    queryFn,
    enabled: Boolean(tid && sid && classId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

// ── Hook 3: individual student detail ──────────────────────────────────────
export function useStudentDetail(studentId: string | null | undefined, classId: string | null | undefined) {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<StudentDetail | null> = async () => {
    const SC_ENT = entConstraints(teacherData);
    const SC_EVT = evtConstraints(teacherData);
    if (!SC_ENT || !SC_EVT || !studentId || !classId) return null;

    const [enrollSnaps, testScoreSnaps, gradebookSnaps, attSnaps, ratingSnaps, classSnaps] = await Promise.all([
      fetchAll("enrollments",      [...SC_EVT, where("classId", "==", classId)]),
      fetchAll("test_scores",      [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("gradebook_scores", [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]).catch(() => [] as Snap[]),
      fetchAll("attendance",       [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("student_ratings",  [...SC_EVT, where("classId", "==", classId)]).catch(() => [] as Snap[]),
      fetchAll("classes",          SC_ENT),
    ]);
    const scoreSnaps: Snap[] = [...testScoreSnaps, ...gradebookSnaps];

    const target = enrollSnaps.find(e =>
      e.data.studentId === studentId ||
      ((e.data.studentEmail as string | undefined)?.toLowerCase() === studentId.toLowerCase())
    );
    if (!target) return null;

    const targetEmail = (target.data.studentEmail as string | undefined)?.toLowerCase();
    const matchesTarget = (rec: DocumentData) =>
      rec.studentId === studentId ||
      ((rec.studentEmail as string | undefined)?.toLowerCase() === targetEmail);

    // Class-wide buckets — single source of truth for ranking + class averages
    const byKey = buildBucketsFromEnrollments(enrollSnaps, classId, classId);
    applyScoresToBuckets(scoreSnaps, byKey);
    applyAttendanceToBuckets(attSnaps, byKey);
    applyRatingsToBuckets(ratingSnaps, byKey);
    const computed = computeStudentRows(byKey);
    const ranked = computed.filter(c => c.presentCount > 0);

    // Find this specific student's row in the ranked output
    const myRow = computed.find(c => {
      const b = c.bucket;
      return b.studentId === studentId || (targetEmail && b.studentEmail === targetEmail);
    });

    const hasScoreData = !!myRow?.hasScoreData;
    const hasAttData = !!myRow?.hasAttData;
    const hasBehData = !!myRow?.hasBehData;
    const hasPartData = !!myRow?.hasPartData;
    const studentMarks = myRow?.avgScore ?? 0;
    const studentAttPct = myRow?.attendance ?? 0;
    const studentBehaviour = myRow?.behaviour ?? 0;
    const studentParticipation = myRow?.participation ?? 0;
    const studentComposite = myRow?.composite ?? 0;
    const studentPresentMetricCount = myRow?.presentCount ?? 0;
    const ratingCountForStudent = myRow?.bucket.ratingCount ?? 0;

    // Class averages — only over students who have that specific metric
    const scoreSet = ranked.filter(c => c.hasScoreData);
    const attSet   = ranked.filter(c => c.hasAttData);
    const behSet   = ranked.filter(c => c.hasBehData);
    const partSet  = ranked.filter(c => c.hasPartData);
    const meanOf = <T>(arr: T[], pick: (x: T) => number) =>
      arr.length > 0 ? arr.reduce((acc, x) => acc + pick(x), 0) / arr.length : 0;
    const classAvgScore         = meanOf(scoreSet, c => c.avgScore);
    const classAvgAttendance    = meanOf(attSet,   c => c.attendance);
    const classAvgBehaviour     = meanOf(behSet,   c => c.behaviour);
    const classAvgParticipation = meanOf(partSet,  c => c.participation);

    ranked.sort((a, b) => b.composite - a.composite);
    const rank = ranked.findIndex(c => {
      const b = c.bucket;
      return b.studentId === studentId ||
        (targetEmail && b.studentEmail === targetEmail);
    }) + 1;

    // Subject breakdown — group by subject across both score collections
    const subjectGroups = new Map<string, { mine: number[]; allClass: number[] }>();
    scoreSnaps.forEach(s => {
      if (s.data.isAbsent === true) return;
      const subj = (s.data.subject as string) || (s.data.subjectName as string) || "All subjects";
      const pct = readScorePct(s.data);
      if (pct === null) return;
      if (!subjectGroups.has(subj)) subjectGroups.set(subj, { mine: [], allClass: [] });
      const g = subjectGroups.get(subj)!;
      g.allClass.push(pct);
      if (matchesTarget(s.data)) g.mine.push(pct);
    });

    const teacherSubject = teacherData?.subject as string | undefined;
    const subjects: StudentSubjectScore[] = Array.from(subjectGroups.entries())
      .filter(([, g]) => g.mine.length > 0)
      .map(([subj, g]) => {
        const score = g.mine.reduce((a, b) => a + b, 0) / g.mine.length;
        const classAvg = g.allClass.length > 0 ? g.allClass.reduce((a, b) => a + b, 0) / g.allClass.length : 0;
        const gap = score - classAvg;
        let status: StudentSubjectScore["status"] = "okay";
        if (score < 45) status = "critical";
        else if (gap <= -15) status = "weak";
        else if (gap <= -5) status = "least_weak";
        return {
          subject: subj,
          score: Number(score.toFixed(1)),
          classAvg: Number(classAvg.toFixed(1)),
          gap: Number(gap.toFixed(1)),
          status,
          isYourSubject: teacherSubject ? subj.toLowerCase() === teacherSubject.toLowerCase() : false,
        };
      })
      .sort((a, b) => a.score - b.score);

    const classDoc = classSnaps.find(c => c.id === classId)?.data;
    const classLabel = pickClassName(classDoc, classId);

    return {
      studentId,
      name: (target.data.studentName as string) || "Student",
      initials: initialsOf((target.data.studentName as string) || "Student"),
      rollNo: (target.data.rollNo as string) || "—",
      classId,
      classLabel,
      rank,
      totalInClass: ranked.length,
      composite: Number(studentComposite.toFixed(1)),
      status: statusOf(
        {
          marks: hasScoreData ? studentMarks : undefined,
          attendance: hasAttData ? studentAttPct : undefined,
          behaviour: hasBehData ? studentBehaviour : undefined,
          participation: hasPartData ? studentParticipation : undefined,
        },
        studentComposite,
        studentPresentMetricCount,
      ),
      hasData: studentPresentMetricCount > 0,
      metrics: {
        marks: {
          value: Number(studentMarks.toFixed(1)),
          classAvg: Number(classAvgScore.toFixed(1)),
          gap: Number((studentMarks - classAvgScore).toFixed(1)),
          severity: severityOf(studentMarks, classAvgScore, "marks"),
        },
        attendance: {
          value: Number(studentAttPct.toFixed(1)),
          classAvg: Number(classAvgAttendance.toFixed(1)),
          gap: Number((studentAttPct - classAvgAttendance).toFixed(1)),
          severity: severityOf(studentAttPct, classAvgAttendance, "attendance"),
        },
        behaviour: {
          value: Number(studentBehaviour.toFixed(1)),
          classAvg: Number(classAvgBehaviour.toFixed(1)),
          gap: Number((studentBehaviour - classAvgBehaviour).toFixed(1)),
          severity: severityOf(studentBehaviour, classAvgBehaviour, "behaviour"),
          ratingCount: ratingCountForStudent,
          fromDefault: !!myRow?.behaviourFromDefault,
        },
        participation: {
          value: Number(studentParticipation.toFixed(1)),
          classAvg: Number(classAvgParticipation.toFixed(1)),
          gap: Number((studentParticipation - classAvgParticipation).toFixed(1)),
          severity: severityOf(studentParticipation, classAvgParticipation, "participation"),
        },
      },
      subjects,
    };
  };

  return useQuery<StudentDetail | null>({
    queryKey: ["leaderboard", "student", studentId, classId, tid, sid, bid],
    queryFn,
    enabled: Boolean(tid && sid && studentId && classId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// ── Hook 4: teacher's own metrics (aggregate of their classes) ─────────────
export function useTeacherSelfMetrics() {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<TeacherSelfMetrics | null> = async () => {
    const SC_ENT = entConstraints(teacherData);
    const SC_EVT = evtConstraints(teacherData);
    if (!SC_ENT || !SC_EVT || !tid) return null;

    const [activeAssignments, ownedClasses, allEnroll, allTestScores, allGradebook, allAtt, allRatings, allClasses] = await Promise.all([
      fetchAll("teaching_assignments", [...SC_ENT, where("teacherId", "==", tid)]),
      fetchAll("classes", [...SC_ENT, where("teacherId", "==", tid)]),
      fetchAll("enrollments",      SC_EVT),
      fetchAll("test_scores",      [...SC_EVT, where("teacherId", "==", tid)]),
      fetchAll("gradebook_scores", [...SC_EVT, where("teacherId", "==", tid)]).catch(() => [] as Snap[]),
      fetchAll("attendance",       [...SC_EVT, where("teacherId", "==", tid)]),
      fetchAll("student_ratings",  [...SC_EVT, where("teacherId", "==", tid)]).catch(() => [] as Snap[]),
      fetchAll("classes",          SC_ENT),
    ]);
    const allScores: Snap[] = [...allTestScores, ...allGradebook];

    const activeAssignmentsKept = activeAssignments.filter(a => {
      const s = String(a.data.status ?? "").toLowerCase();
      return !s || s === "active";
    });

    const assignedIds = activeAssignmentsKept.map(a => a.data.classId).filter(Boolean) as string[];
    const ownedIds = ownedClasses.map(s => s.id);
    const myClassIds = Array.from(new Set([...assignedIds, ...ownedIds]));
    if (myClassIds.length === 0) return null;

    const subjectsByClass = new Map<string, Set<string>>();
    activeAssignmentsKept.forEach(a => {
      const cid = a.data.classId as string | undefined;
      const subj = (a.data.subjectName || a.data.subject) as string | undefined;
      if (cid && subj) {
        if (!subjectsByClass.has(cid)) subjectsByClass.set(cid, new Set());
        subjectsByClass.get(cid)!.add(subj.trim());
      }
    });

    const labelOf = (cid: string) => {
      const cls = allClasses.find(c => c.id === cid)?.data;
      const name = pickClassName(cls, cid);
      const subjSet = subjectsByClass.get(cid);
      const subj = subjSet && subjSet.size > 0
        ? Array.from(subjSet).join(" · ")
        : (cls?.subject as string) || (teacherData?.subject as string) || "Subject";
      return `${name} · ${subj}`;
    };

    const classes: TeacherClassSummary[] = myClassIds.map(cid => {
      const enroll = allEnroll.filter(e => e.data.classId === cid);
      const scoreRows = allScores
        .filter(s => s.data.classId === cid && s.data.isAbsent !== true)
        .map(s => readScorePct(s.data))
        .filter((p): p is number => p !== null);
      const att = allAtt.filter(a => a.data.classId === cid);
      const ratings = allRatings.filter(r => r.data.classId === cid);
      const present = att.filter(a => ["present", "late"].includes(String(a.data.status ?? "").toLowerCase())).length;
      const avgScore = scoreRows.length > 0 ? scoreRows.reduce((acc, p) => acc + p, 0) / scoreRows.length : 0;
      const avgAtt = att.length > 0 ? (present / att.length) * 100 : 0;
      const ratingValues = ratings
        .map(r => Number(r.data.rating))
        .filter(r => Number.isFinite(r) && r > 0);
      const avgBeh = ratingValues.length > 0 ? (ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length) * 20 : 0;
      // Class-level participation: scoreRows / enrolled students × (test count baseline 1) → not meaningful at class roll-up
      // We exclude participation from the class-aggregate composite to avoid double-counting tests-per-student.
      const components: CompositeComponents = {
        marks:      scoreRows.length > 0 ? avgScore : undefined,
        attendance: att.length > 0       ? avgAtt   : undefined,
        behaviour:  ratingValues.length > 0 ? avgBeh : undefined,
      };
      const { composite } = computeComposite(components);
      return {
        classId: cid,
        label: labelOf(cid),
        studentCount: enroll.length,
        classAverage: Number(composite.toFixed(1)),
        classAvgScore: Number(avgScore.toFixed(1)),
        classAvgAttendance: Number(avgAtt.toFixed(1)),
      };
    });

    const totalStudents = classes.reduce((acc, c) => acc + c.studentCount, 0);
    const studentsAvg = totalStudents > 0
      ? classes.reduce((acc, c) => acc + c.classAverage * c.studentCount, 0) / totalStudents
      : 0;
    const classAvgScore = totalStudents > 0
      ? classes.reduce((acc, c) => acc + c.classAvgScore * c.studentCount, 0) / totalStudents
      : 0;
    const classAvgAttendance = totalStudents > 0
      ? classes.reduce((acc, c) => acc + c.classAvgAttendance * c.studentCount, 0) / totalStudents
      : 0;

    return {
      teacherId: tid,
      name: (teacherData?.name as string) || "Teacher",
      subject: (teacherData?.subject as string) || "Subject",
      branch: (teacherData?.branch as string) || (teacherData?.schoolName as string) || "",
      totalStudents,
      composite: Number(studentsAvg.toFixed(1)),
      studentsAvg: Number(studentsAvg.toFixed(1)),
      classAvgScore: Number(classAvgScore.toFixed(1)),
      classAvgAttendance: Number(classAvgAttendance.toFixed(1)),
      classes,
    };
  };

  return useQuery<TeacherSelfMetrics | null>({
    queryKey: ["leaderboard", "self", tid, sid, bid],
    queryFn,
    enabled: Boolean(tid && sid),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// ── Hook: Branch teacher leaderboard ────────────────────────────────────────
// Computes composite for every teacher in the branch from existing collections.
// Branch isolation is via the resolved teacher set (entConstraints), NOT via
// branchId on event streams (memory `bug_pattern_branch_filter_on_event_streams`).
// Event reads are bounded in-memory to the last 90 days to cap doc volume.

export interface BranchTeacherEntry {
  teacherId: string;
  name: string;
  initials: string;
  subject: string;
  totalStudents: number;
  composite: number;
  classAvgScore: number;
  classAvgAttendance: number;
  classCount: number;
  rank: number;
  isYou: boolean;
  hasData: boolean;
}

export function useBranchTeacherLeaderboard() {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<BranchTeacherEntry[]> = async () => {
    const SC_ENT = entConstraints(teacherData);
    const SC_EVT = evtConstraints(teacherData);
    if (!SC_ENT || !SC_EVT || !tid) return [];

    const [teacherSnaps, classSnaps, assignSnaps, enrollSnaps, testScoreSnaps, gradebookSnaps, attSnaps, ratingSnaps] = await Promise.all([
      fetchAll("teachers",             SC_ENT),
      fetchAll("classes",              SC_ENT),
      fetchAll("teaching_assignments", SC_ENT),
      fetchAll("enrollments",          SC_EVT),
      fetchAll("test_scores",          SC_EVT),
      fetchAll("gradebook_scores",     SC_EVT).catch(() => [] as Snap[]),
      fetchAll("attendance",           SC_EVT),
      fetchAll("student_ratings",      SC_EVT).catch(() => [] as Snap[]),
    ]);

    if (teacherSnaps.length === 0) return [];

    // 90-day window in-memory (memory `bug_pattern_filterbytime_field_drift` —
    // each collection has its own time field; filter per kind)
    const recentScores = [...testScoreSnaps, ...gradebookSnaps].filter(s => withinBranchWindow(s.data, "score"));
    const recentAtt = attSnaps.filter(a => withinBranchWindow(a.data, "att"));
    const recentRatings = ratingSnaps.filter(r => {
      const ts = r.data.createdAt;
      if (ts && typeof ts.toMillis === "function") return ts.toMillis() >= Date.now() - BRANCH_WINDOW_MS;
      return true;
    });

    const activeAssignSnaps = assignSnaps.filter(a => {
      const s = String(a.data.status ?? "").toLowerCase();
      return !s || s === "active";
    });

    type Bucket = {
      teacherId: string;
      name: string;
      subject: string;
      classIds: Set<string>;
      enrollKeys: Set<string>;
      scoreSum: number;
      scoreCount: number;
      presentCount: number;
      attTotal: number;
      ratingSum: number;
      ratingCount: number;
    };
    const byTid = new Map<string, Bucket>();

    teacherSnaps.forEach(t => {
      const isActive = t.data.isActive !== false && t.data.status !== "inactive";
      if (!isActive) return;
      byTid.set(t.id, {
        teacherId: t.id,
        name: (t.data.name as string) || (t.data.displayName as string) || "Teacher",
        subject: (t.data.subject as string) || "Subject",
        classIds: new Set<string>(),
        enrollKeys: new Set<string>(),
        scoreSum: 0,
        scoreCount: 0,
        presentCount: 0,
        attTotal: 0,
        ratingSum: 0,
        ratingCount: 0,
      });
    });

    classSnaps.forEach(c => {
      const owner = c.data.teacherId as string | undefined;
      if (owner && byTid.has(owner)) byTid.get(owner)!.classIds.add(c.id);
    });

    activeAssignSnaps.forEach(a => {
      const owner = a.data.teacherId as string | undefined;
      const cid = a.data.classId as string | undefined;
      if (owner && cid && byTid.has(owner)) byTid.get(owner)!.classIds.add(cid);
    });

    enrollSnaps.forEach(e => {
      const tch = e.data.teacherId as string | undefined;
      // Some enrollments lack teacherId — skip gracefully (per-class roster owned by principal)
      if (!tch || !byTid.has(tch)) return;
      const key = (e.data.studentId as string) || (e.data.studentEmail as string) || `${e.data.classId ?? ""}::${e.id}`;
      byTid.get(tch)!.enrollKeys.add(key);
    });

    recentScores.forEach(s => {
      const tch = s.data.teacherId as string | undefined;
      if (!tch || !byTid.has(tch)) return;
      if (s.data.isAbsent === true) return;
      const pct = readScorePct(s.data);
      if (pct === null) return;
      const b = byTid.get(tch)!;
      b.scoreSum += pct;
      b.scoreCount += 1;
    });

    recentAtt.forEach(a => {
      const tch = a.data.teacherId as string | undefined;
      if (!tch || !byTid.has(tch)) return;
      const status = String(a.data.status ?? "").toLowerCase();
      const b = byTid.get(tch)!;
      if (status === "present" || status === "late") b.presentCount += 1;
      b.attTotal += 1;
    });

    recentRatings.forEach(r => {
      const tch = r.data.teacherId as string | undefined;
      if (!tch || !byTid.has(tch)) return;
      const rating = Number(r.data.rating);
      if (!Number.isFinite(rating) || rating <= 0) return;
      const b = byTid.get(tch)!;
      b.ratingSum += rating;
      b.ratingCount += 1;
    });

    const rows = Array.from(byTid.values()).map(b => {
      const avgScore = b.scoreCount > 0 ? b.scoreSum / b.scoreCount : 0;
      const avgAtt = b.attTotal > 0 ? (b.presentCount / b.attTotal) * 100 : 0;
      const avgBeh = b.ratingCount > 0 ? (b.ratingSum / b.ratingCount) * 20 : 0;
      const hasData = b.scoreCount > 0 || b.attTotal > 0 || b.ratingCount > 0;
      const components: CompositeComponents = {
        marks:      b.scoreCount > 0  ? avgScore : undefined,
        attendance: b.attTotal > 0    ? avgAtt   : undefined,
        behaviour:  b.ratingCount > 0 ? avgBeh   : undefined,
      };
      const { composite } = hasData ? computeComposite(components) : { composite: 0 };
      return {
        teacherId: b.teacherId,
        name: b.name,
        subject: b.subject,
        totalStudents: b.enrollKeys.size,
        composite: Number(composite.toFixed(1)),
        classAvgScore: Number(avgScore.toFixed(1)),
        classAvgAttendance: Number(avgAtt.toFixed(1)),
        classCount: b.classIds.size,
        hasData,
      };
    });

    const filtered = rows.filter(r => r.classCount > 0 || r.teacherId === tid);

    filtered.sort((a, b) => {
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
      if (b.composite !== a.composite) return b.composite - a.composite;
      return b.totalStudents - a.totalStudents;
    });

    return filtered.map((r, i) => ({
      teacherId: r.teacherId,
      name: r.name,
      initials: initialsOf(r.name),
      subject: r.subject,
      totalStudents: r.totalStudents,
      composite: r.composite,
      classAvgScore: r.classAvgScore,
      classAvgAttendance: r.classAvgAttendance,
      classCount: r.classCount,
      rank: i + 1,
      isYou: r.teacherId === tid,
      hasData: r.hasData,
    } satisfies BranchTeacherEntry));
  };

  return useQuery<BranchTeacherEntry[]>({
    queryKey: ["leaderboard", "branchTeachers", sid, bid],
    queryFn,
    enabled: Boolean(tid && sid),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // Permission errors aren't worth retrying; transient network errors get one retry.
    retry: (count, err: unknown) => {
      const code = (err as { code?: string } | undefined)?.code;
      if (code === "permission-denied" || code === "failed-precondition") return false;
      return count < 1;
    },
  });
}

// ── 8-week Trajectory hooks ─────────────────────────────────────────────────
// Computes per-ISO-week composite snapshots from raw event docs. Used by the
// "8-week rank history" / "8-week trend chart" sections on the detail screens.
// On-the-fly aggregation — no separate snapshot collection, no cron job.

const TRAJECTORY_WEEKS = 8;
const ONE_WEEK_MS = 7 * 24 * 60 * 60_000;

export interface TrajectoryPoint {
  weekKey: string;       // "YYYY-Www"
  weekStartIso: string;  // ISO date string of Monday of that week
  composite: number;     // 0-100, NaN when no data that week
  rank: number;          // 0 when not ranked (no data)
  totalInClass: number;  // total students with data that week
  hasData: boolean;
}

export interface ClassTrajectoryPoint {
  weekKey: string;
  weekStartIso: string;
  classAverage: number;  // class-wide composite mean
  totalStudents: number; // students with any data that week
  hasData: boolean;
}

/** Monday 00:00 UTC of the ISO week containing `d`. */
function weekStart(d: Date): Date {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // 0 = Monday
  target.setUTCDate(target.getUTCDate() - dayNum);
  target.setUTCHours(0, 0, 0, 0);
  return target;
}

function isoWeekKeyOf(d: Date): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThursdayDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDay + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / ONE_WEEK_MS);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Extract a millisecond timestamp from any of the per-collection writer fields. */
function eventTimestampMs(d: DocumentData): number {
  // test_scores → `timestamp` (Firestore Timestamp)
  const ts = d.timestamp;
  if (ts && typeof ts.toMillis === "function") return ts.toMillis();
  // gradebook_scores → `updatedAt` (number)
  if (Number.isFinite(d.updatedAt)) return Number(d.updatedAt);
  // attendance → `date` (string YYYY-MM-DD)
  if (typeof d.date === "string") {
    const parsed = Date.parse(d.date);
    if (Number.isFinite(parsed)) return parsed;
  }
  // student_ratings → `createdAt` (Firestore Timestamp)
  const created = d.createdAt;
  if (created && typeof created.toMillis === "function") return created.toMillis();
  return 0;
}

/** Build the last-N-weeks bucket array (oldest → newest). */
function buildWeekWindow(weeks: number): { weekKey: string; weekStartMs: number; weekStartIso: string }[] {
  const now = new Date();
  const currentMonday = weekStart(now);
  const buckets: { weekKey: string; weekStartMs: number; weekStartIso: string }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(currentMonday.getTime() - i * ONE_WEEK_MS);
    buckets.push({
      weekKey: isoWeekKeyOf(ws),
      weekStartMs: ws.getTime(),
      weekStartIso: ws.toISOString().slice(0, 10),
    });
  }
  return buckets;
}

/** Per-week class trajectory: full composite computed against that week's events. */
export function useClassTrajectory(classId: string | null | undefined) {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<ClassTrajectoryPoint[]> = async () => {
    const SC_EVT = evtConstraints(teacherData);
    if (!SC_EVT || !classId) return [];

    const [enrollSnaps, testScoreSnaps, gradebookSnaps, attSnaps, ratingSnaps] = await Promise.all([
      fetchAll("enrollments",      [...SC_EVT, where("classId", "==", classId)]),
      fetchAll("test_scores",      [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("gradebook_scores", [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]).catch(() => [] as Snap[]),
      fetchAll("attendance",       [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("student_ratings",  [...SC_EVT, where("classId", "==", classId)]).catch(() => [] as Snap[]),
    ]);

    const buckets = buildWeekWindow(TRAJECTORY_WEEKS);
    const cutoffMs = buckets[0].weekStartMs;
    const scoreSnaps: Snap[] = [...testScoreSnaps, ...gradebookSnaps];

    return buckets.map(({ weekKey, weekStartMs, weekStartIso }) => {
      const weekEnd = weekStartMs + ONE_WEEK_MS;
      const inWeek = (s: Snap) => {
        const ms = eventTimestampMs(s.data);
        return ms >= weekStartMs && ms < weekEnd;
      };
      const wkScores = scoreSnaps.filter(inWeek);
      const wkAtt = attSnaps.filter(inWeek);
      const wkRatings = ratingSnaps.filter(inWeek);
      // Build buckets fresh per week — only enrollments that participated this week
      const byKey = buildBucketsFromEnrollments(enrollSnaps, classId, classId);
      applyScoresToBuckets(wkScores, byKey);
      applyAttendanceToBuckets(wkAtt, byKey);
      applyRatingsToBuckets(wkRatings, byKey);
      const computed = computeStudentRows(byKey).filter(c => c.presentCount > 0);
      const hasData = computed.length > 0 && weekStartMs >= cutoffMs;
      const classAverage = hasData
        ? computed.reduce((acc, c) => acc + c.composite, 0) / computed.length
        : 0;
      return {
        weekKey,
        weekStartIso,
        classAverage: Number(classAverage.toFixed(1)),
        totalStudents: computed.length,
        hasData,
      };
    });
  };

  return useQuery<ClassTrajectoryPoint[]>({
    queryKey: ["leaderboard", "trajectory", "class", classId, tid, sid, bid],
    queryFn,
    enabled: Boolean(tid && sid && classId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Per-week trajectory for one student — composite + rank within their class. */
export function useStudentTrajectory(studentId: string | null | undefined, classId: string | null | undefined) {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<TrajectoryPoint[]> = async () => {
    const SC_EVT = evtConstraints(teacherData);
    if (!SC_EVT || !classId || !studentId) return [];

    const [enrollSnaps, testScoreSnaps, gradebookSnaps, attSnaps, ratingSnaps] = await Promise.all([
      fetchAll("enrollments",      [...SC_EVT, where("classId", "==", classId)]),
      fetchAll("test_scores",      [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("gradebook_scores", [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]).catch(() => [] as Snap[]),
      fetchAll("attendance",       [...SC_EVT, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("student_ratings",  [...SC_EVT, where("classId", "==", classId)]).catch(() => [] as Snap[]),
    ]);

    const target = enrollSnaps.find(e =>
      e.data.studentId === studentId ||
      ((e.data.studentEmail as string | undefined)?.toLowerCase() === studentId.toLowerCase())
    );
    if (!target) return [];
    const targetEmail = (target.data.studentEmail as string | undefined)?.toLowerCase();
    const targetMatches = (b: StudentBucket) =>
      b.studentId === studentId || (targetEmail && b.studentEmail === targetEmail);

    const buckets = buildWeekWindow(TRAJECTORY_WEEKS);
    const scoreSnaps: Snap[] = [...testScoreSnaps, ...gradebookSnaps];

    return buckets.map(({ weekKey, weekStartMs, weekStartIso }) => {
      const weekEnd = weekStartMs + ONE_WEEK_MS;
      const inWeek = (s: Snap) => {
        const ms = eventTimestampMs(s.data);
        return ms >= weekStartMs && ms < weekEnd;
      };
      const wkScores = scoreSnaps.filter(inWeek);
      const wkAtt = attSnaps.filter(inWeek);
      const wkRatings = ratingSnaps.filter(inWeek);
      const byKey = buildBucketsFromEnrollments(enrollSnaps, classId, classId);
      applyScoresToBuckets(wkScores, byKey);
      applyAttendanceToBuckets(wkAtt, byKey);
      applyRatingsToBuckets(wkRatings, byKey);
      const computed = computeStudentRows(byKey).filter(c => c.presentCount > 0);
      computed.sort((a, b) => b.composite - a.composite);
      const meIdx = computed.findIndex(c => targetMatches(c.bucket));
      const myRow = meIdx >= 0 ? computed[meIdx] : null;
      const hasData = !!myRow;
      return {
        weekKey,
        weekStartIso,
        composite: hasData ? Number(myRow!.composite.toFixed(1)) : NaN,
        rank: hasData ? meIdx + 1 : 0,
        totalInClass: computed.length,
        hasData,
      };
    });
  };

  return useQuery<TrajectoryPoint[]>({
    queryKey: ["leaderboard", "trajectory", "student", studentId, classId, tid, sid, bid],
    queryFn,
    enabled: Boolean(tid && sid && studentId && classId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

// ── AI Hooks ────────────────────────────────────────────────────────────────
// Each calls the deployed Cloud Function getTeacherAIInsights with a specific
// prompt type, fronted by a 2-tier cache (in-flight dedup + localStorage 7-day).
// Per memory `teacher_dashboard_ai_strategy`: cache weekly per leaderboard cycle.

export interface AIDiagnosis { type: "good" | "concern" | "note"; text: string }
export interface AIAction {
  id: string;
  num: string;
  title: string;
  reason: string;
  tracking: "auto" | "auto_pct" | "manual";
  status: "pending" | "in_progress" | "completed";
  subStatus?: string;
}
export interface AIPlan {
  diagnosis: AIDiagnosis[];
  actions: AIAction[];
}

const AI_STALE_MS = 6 * 60 * 60_000;       // 6 hours — re-render same plan within day
const AI_GC_MS    = 7 * 24 * 60 * 60_000;  // keep in TanStack cache for a week

/** Validates and normalises whatever the AI returned into AIPlan, or null. */
function normaliseAIPlan(raw: unknown): AIPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { diagnosis?: unknown; actions?: unknown };
  const diagnosis = Array.isArray(r.diagnosis)
    ? r.diagnosis.filter((d): d is AIDiagnosis =>
        !!d && typeof d === "object" && "type" in d && "text" in d &&
        ["good", "concern", "note"].includes(String((d as AIDiagnosis).type)) &&
        typeof (d as AIDiagnosis).text === "string"
      )
    : [];
  const actions = Array.isArray(r.actions)
    ? r.actions.filter((a): a is AIAction =>
        !!a && typeof a === "object" && "title" in a && typeof (a as AIAction).title === "string"
      ).map((a, i) => ({
        id: a.id || `a${i + 1}`,
        num: a.num || String(i + 1).padStart(2, "0"),
        title: a.title,
        reason: a.reason || "",
        tracking: (["auto", "auto_pct", "manual"].includes(String(a.tracking)) ? a.tracking : "manual") as AIAction["tracking"],
        status: (["pending", "in_progress", "completed"].includes(String(a.status)) ? a.status : "pending") as AIAction["status"],
        subStatus: a.subStatus,
      }))
    : [];
  if (diagnosis.length === 0 && actions.length === 0) return null;
  return { diagnosis, actions };
}

/** Cache-aware AI plan fetcher — 3 tiers:
 *    Tier 1: in-flight dedup (memory)
 *    Tier 2: localStorage 7-day (per-device fast-path)
 *    Tier 3: Firestore 7-day (cross-device weekly enforcement)
 *  Read order: LS → FS → AI. Write order on miss: AI → FS → LS.
 *  AI is billed exactly once per (teacher + context + ISO week) across all devices. */
async function fetchAIPlanWithCache(
  cacheKey: string,
  coords: FirestoreCacheCoords,
  tenant: TenantContext,
  call: () => Promise<unknown>,
): Promise<AIPlan | null> {
  // Tier 2 — localStorage hit (same device, same week)
  const lsCached = lsRead(cacheKey);
  if (lsCached) {
    const normalized = normaliseAIPlan(lsCached.plan);
    if (normalized) return normalized;
  }

  // Tier 1 — in-flight dedup
  const existing = getInflight(cacheKey);
  if (existing) {
    const result = await existing;
    return normaliseAIPlan(result);
  }

  const promise = (async () => {
    // Tier 3 — Firestore hit (cross-device, same week)
    const fsCached = await fsRead(coords);
    if (fsCached) {
      // Warm the localStorage so subsequent same-device hits skip the FS round-trip
      lsWrite(cacheKey, fsCached.plan);
      return fsCached.plan;
    }

    // Cache miss everywhere — call the AI
    const raw = await call();
    if (raw && typeof raw === "object") {
      const plan = raw as Record<string, unknown>;
      // Write FS first so other devices can immediately benefit
      await fsWrite(coords, plan, tenant);
      lsWrite(cacheKey, plan);
    }
    return raw as Record<string, unknown>;
  })();
  setInflight(cacheKey, promise);
  const result = await promise;
  return normaliseAIPlan(result);
}

export function useClassAIPlan(cls: ClassLeaderboard | null | undefined, teacherName: string | undefined) {
  const { teacherData } = useAuth();

  const queryFn: QueryFunction<AIPlan | null> = async () => {
    if (!cls || cls.totalStudents === 0) return null;
    if (!teacherData?.id || !teacherData?.schoolId) return null;
    const cacheKey = classPlanKey({
      classId: cls.classId,
      composite: cls.classAverage,
      totalStudents: cls.totalStudents,
    });
    const coords: FirestoreCacheCoords = {
      kind: "class",
      teacherId: teacherData.id,
      classId: cls.classId,
    };
    const tenant: TenantContext = {
      teacherId: teacherData.id,
      schoolId: teacherData.schoolId,
      branchId: teacherData.branchId as string | undefined,
    };
    return fetchAIPlanWithCache(cacheKey, coords, tenant, async () => {
      const payload = {
        teacherName: teacherName || "Teacher",
        className: cls.className,
        subject: cls.subject,
        totalStudents: cls.totalStudents,
        classMetrics: {
          composite: cls.classAverage,
          avgScore: cls.classAvgScore,
          avgAttendance: cls.classAvgAttendance,
          needAttentionCount: cls.needAttentionCount,
        },
        topStudents: cls.allStudents.slice(0, 5).map(s => ({
          name: s.name, composite: s.composite, marks: s.avgScorePct, attendance: s.attendancePct,
        })),
        atRiskStudents: cls.needAttentionStudents.map(s => ({
          name: s.name, composite: s.composite, marks: s.avgScorePct, attendance: s.attendancePct, status: s.status,
        })),
      };
      const res = await AIController.getClassActionPlan(payload);
      if (res.status !== "success") throw new Error(res.status === "error" ? res.message : "AI returned no data");
      return res.data;
    });
  };

  return useQuery<AIPlan | null>({
    queryKey: ["leaderboard", "ai", "classPlan", cls?.classId, cls?.totalStudents, cls?.classAverage],
    queryFn,
    enabled: Boolean(cls && cls.totalStudents > 0 && teacherData?.id && teacherData?.schoolId),
    staleTime: AI_STALE_MS,
    gcTime: AI_GC_MS,
    retry: 1,
  });
}

export function useStudentAIPlan(student: StudentDetail | null | undefined, teacherName: string | undefined, teacherSubject: string | undefined) {
  const { teacherData } = useAuth();

  const queryFn: QueryFunction<AIPlan | null> = async () => {
    if (!student) return null;
    if (!teacherData?.id || !teacherData?.schoolId) return null;
    const cacheKey = studentPlanKey({
      studentId: student.studentId,
      classId: student.classId,
      composite: student.composite,
    });
    const coords: FirestoreCacheCoords = {
      kind: "student",
      teacherId: teacherData.id,
      classId: student.classId,
      studentId: student.studentId,
    };
    const tenant: TenantContext = {
      teacherId: teacherData.id,
      schoolId: teacherData.schoolId,
      branchId: teacherData.branchId as string | undefined,
    };
    return fetchAIPlanWithCache(cacheKey, coords, tenant, async () => {
      const payload = {
        teacherName: teacherName || "Teacher",
        teacherSubject: teacherSubject || "Subject",
        student: {
          name: student.name,
          classLabel: student.classLabel,
          rank: student.rank,
          totalInClass: student.totalInClass,
          composite: student.composite,
          status: student.status,
        },
        metrics: {
          marks:         { value: student.metrics.marks.value,         classAvg: student.metrics.marks.classAvg,         gap: student.metrics.marks.gap },
          attendance:    { value: student.metrics.attendance.value,    classAvg: student.metrics.attendance.classAvg,    gap: student.metrics.attendance.gap },
          participation: { value: student.metrics.participation.value, classAvg: student.metrics.participation.classAvg, gap: student.metrics.participation.gap },
        },
        subjects: student.subjects.map(s => ({
          name: s.subject, score: s.score, classAvg: s.classAvg, gap: s.gap, status: s.status, isYourSubject: !!s.isYourSubject,
        })),
      };
      const res = await AIController.getStudentActionPlan(payload);
      if (res.status !== "success") throw new Error(res.status === "error" ? res.message : "AI returned no data");
      return res.data;
    });
  };

  return useQuery<AIPlan | null>({
    queryKey: ["leaderboard", "ai", "studentPlan", student?.studentId, student?.composite],
    queryFn,
    enabled: Boolean(student && student.hasData && teacherData?.id && teacherData?.schoolId),
    staleTime: AI_STALE_MS,
    gcTime: AI_GC_MS,
    retry: 1,
  });
}

export function useTeacherSelfAIPlan(self: TeacherSelfMetrics | null | undefined) {
  const { teacherData } = useAuth();

  const queryFn: QueryFunction<AIPlan | null> = async () => {
    if (!self) return null;
    if (!teacherData?.id || !teacherData?.schoolId) return null;
    const cacheKey = teacherSelfPlanKey({
      teacherId: self.teacherId,
      composite: self.composite,
      totalStudents: self.totalStudents,
    });
    const coords: FirestoreCacheCoords = {
      kind: "self",
      teacherId: self.teacherId,
    };
    const tenant: TenantContext = {
      teacherId: teacherData.id,
      schoolId: teacherData.schoolId,
      branchId: teacherData.branchId as string | undefined,
    };
    return fetchAIPlanWithCache(cacheKey, coords, tenant, async () => {
      const payload = {
        teacherName: self.name,
        subject: self.subject,
        branch: self.branch,
        composite: self.composite,
        classAvgScore: self.classAvgScore,
        classAvgAttendance: self.classAvgAttendance,
        totalStudents: self.totalStudents,
        classes: self.classes.map(c => ({
          label: c.label,
          studentCount: c.studentCount,
          classAverage: c.classAverage,
          classAvgScore: c.classAvgScore,
          classAvgAttendance: c.classAvgAttendance,
        })),
      };
      const res = await AIController.getTeacherSelfActionPlan(payload);
      if (res.status !== "success") throw new Error(res.status === "error" ? res.message : "AI returned no data");
      return res.data;
    });
  };

  return useQuery<AIPlan | null>({
    queryKey: ["leaderboard", "ai", "selfPlan", self?.teacherId, self?.composite],
    queryFn,
    enabled: Boolean(self && teacherData?.id && teacherData?.schoolId),
    staleTime: AI_STALE_MS,
    gcTime: AI_GC_MS,
    retry: 1,
  });
}
