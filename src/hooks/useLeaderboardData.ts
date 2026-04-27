// Real-data hooks for the Leaderboard module. Computed client-side from
// existing collections (teaching_assignments, classes, enrollments, attendance,
// test_scores). All hooks are cached via TanStack Query so multiple screens
// hitting the same data don't trigger redundant Firestore reads.
//
// Composite formula (matches the project's at-risk thresholds in Students.tsx):
//   composite = 0.6 * avgScorePct + 0.4 * attendancePct
//
// What's intentionally NOT computed here:
//   - 8-week trajectories  (no weekly snapshots in Firestore yet)
//   - AI diagnosis text     (no Cloud Function deployed)
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

// ── Types ───────────────────────────────────────────────────────────────────
export interface LeaderboardClass {
  classId: string;
  name: string;          // e.g. "6-A"
  subject: string;
  studentCount: number;
}

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
  composite: number;
  rank: number;
  status: "good" | "attention" | "at_risk";
}

export interface ClassLeaderboard {
  classId: string;
  className: string;
  subject: string;
  totalStudents: number;
  classAverage: number;       // mean composite
  classAvgScore: number;      // mean marks
  classAvgAttendance: number; // mean attendance %
  needAttentionCount: number;
  topStudents: LeaderboardStudent[];      // up to top 5 + the rest down to bottom 4
  needAttentionStudents: LeaderboardStudent[]; // bottom 3 sorted ascending by composite
  allStudents: LeaderboardStudent[];      // every student with computed rank
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
  status: "good" | "attention" | "at_risk";
  metrics: {
    marks:       { value: number; classAvg: number; gap: number; severity: "critical" | "warning" | "weak" | "okay" };
    attendance:  { value: number; classAvg: number; gap: number; severity: "critical" | "warning" | "weak" | "okay" };
    assignments: { value: number; classAvg: number; gap: number; severity: "critical" | "warning" | "weak" | "okay" };
    behavior:    null; // not tracked yet — UI hides this when null
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

function tenantConstraints(t: TeacherDoc | null | undefined): QueryConstraint[] | null {
  if (!t?.id || !t?.schoolId) return null;
  const SC: QueryConstraint[] = [where("schoolId", "==", t.schoolId)];
  if (t.branchId) SC.push(where("branchId", "==", t.branchId as string));
  return SC;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) || "ST").toUpperCase();
}

function statusOf(avg: number, att: number): "good" | "attention" | "at_risk" {
  if (avg > 0 && avg < 45) return "at_risk";
  if (avg < 60 || att < 85) return "attention";
  return "good";
}

function severityOf(value: number, classAvg: number, kind: "marks" | "attendance" | "assignments"): "critical" | "warning" | "weak" | "okay" {
  const gap = value - classAvg;
  // Marks/assignments at <50 absolute are critical regardless of class avg
  if (kind !== "attendance" && value < 50) return "critical";
  if (kind === "attendance" && value < 70) return "critical";
  if (gap <= -20) return "critical";
  if (gap <= -10) return "warning";
  if (gap <= -5) return "weak";
  return "okay";
}

// ── Hook 1: teacher's assigned classes (dropdown source) ────────────────────
export function useTeacherClasses() {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<LeaderboardClass[]> = async () => {
    const SC = tenantConstraints(teacherData);
    if (!SC) return [];

    const [activeAssignments, ownedClasses, enrollSnaps] = await Promise.all([
      fetchAll("teaching_assignments", [...SC, where("teacherId", "==", tid as string), where("status", "==", "active")]),
      fetchAll("classes", [...SC, where("teacherId", "==", tid as string)]),
      fetchAll("enrollments", [...SC, where("teacherId", "==", tid as string)]),
    ]);

    const assignedIds = activeAssignments.map(s => s.data.classId).filter(Boolean) as string[];
    const ownedIds = ownedClasses.map(s => s.id);
    const allIds = Array.from(new Set([...assignedIds, ...ownedIds]));
    if (allIds.length === 0) return [];

    // Pull class docs for label + subject
    const allClassSnaps = await fetchAll("classes", SC);
    const classDocsById = new Map<string, DocumentData>(
      allClassSnaps.filter(s => allIds.includes(s.id)).map(s => [s.id, s.data])
    );

    // Per-class enrollment count
    const enrollByClass = new Map<string, number>();
    enrollSnaps.forEach(e => {
      const cid = e.data.classId as string | undefined;
      if (!cid) return;
      enrollByClass.set(cid, (enrollByClass.get(cid) ?? 0) + 1);
    });

    // Find subject from teaching_assignments first, fallback to class doc, fallback to teacher
    const subjectByClass = new Map<string, string>();
    activeAssignments.forEach(a => {
      const cid = a.data.classId as string | undefined;
      if (!cid) return;
      const subj = (a.data.subjectName || a.data.subject) as string | undefined;
      if (subj && !subjectByClass.has(cid)) subjectByClass.set(cid, subj);
    });

    return allIds.map<LeaderboardClass>(cid => {
      const cd = classDocsById.get(cid) || {};
      return {
        classId: cid,
        name: (cd.name as string) || cid,
        subject: subjectByClass.get(cid) || (cd.subject as string) || (teacherData?.subject as string) || "Subject",
        studentCount: enrollByClass.get(cid) ?? 0,
      };
    });
  };

  return useQuery<LeaderboardClass[]>({
    queryKey: ["leaderboard", "classes", tid, sid, bid],
    queryFn,
    enabled: Boolean(tid && sid),
    staleTime: 5 * 60_000,
  });
}

// ── Hook 2: leaderboard for one class ──────────────────────────────────────
export function useClassLeaderboard(classId: string | null | undefined) {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<ClassLeaderboard | null> = async () => {
    const SC = tenantConstraints(teacherData);
    if (!SC || !classId) return null;

    // teacherId filter is required by existing security rules — scores/attendance
    // are scoped per teacher in this project's data model.
    const [enrollSnaps, scoreSnaps, attSnaps, classSnaps, assignSnaps] = await Promise.all([
      fetchAll("enrollments", [...SC, where("classId", "==", classId)]),
      fetchAll("test_scores", [...SC, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("attendance",  [...SC, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("classes",     [...SC]),
      fetchAll("teaching_assignments", [...SC, where("classId", "==", classId), where("status", "==", "active")]),
    ]);

    const classDoc = classSnaps.find(c => c.id === classId)?.data;
    const className = (classDoc?.name as string) || classId;
    const subject = (assignSnaps[0]?.data.subjectName || assignSnaps[0]?.data.subject ||
                     classDoc?.subject || teacherData?.subject || "Subject") as string;

    if (enrollSnaps.length === 0) {
      return {
        classId, className, subject,
        totalStudents: 0, classAverage: 0, classAvgScore: 0, classAvgAttendance: 0,
        needAttentionCount: 0, topStudents: [], needAttentionStudents: [], allStudents: [],
      };
    }

    // Build per-student composite. Dedupe by studentId or studentEmail.
    type Bucket = {
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
    };
    const byKey = new Map<string, Bucket>();
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
        className: (d.className as string) || className,
        scoreSum: 0, scoreCount: 0, presentCount: 0, attTotal: 0,
      });
    });

    const matchKey = (rec: DocumentData): string | null => {
      if (rec.studentId && byKey.has(rec.studentId as string)) return rec.studentId as string;
      const email = (rec.studentEmail as string | undefined)?.toLowerCase();
      if (email) {
        for (const [k, v] of byKey) if (v.studentEmail === email) return k;
      }
      return null;
    };

    scoreSnaps.forEach(s => {
      const key = matchKey(s.data);
      if (!key) return;
      const b = byKey.get(key)!;
      const pct = Number(s.data.percentage);
      if (!s.data.isAbsent && Number.isFinite(pct)) {
        b.scoreSum += pct;
        b.scoreCount += 1;
      }
    });

    attSnaps.forEach(a => {
      const key = matchKey(a.data);
      if (!key) return;
      const b = byKey.get(key)!;
      const status = String(a.data.status ?? "").toLowerCase();
      if (status === "present" || status === "late") b.presentCount += 1;
      b.attTotal += 1;
    });

    // Compute composite + status
    const students: LeaderboardStudent[] = Array.from(byKey.values()).map(b => {
      const avg = b.scoreCount > 0 ? b.scoreSum / b.scoreCount : 0;
      const att = b.attTotal > 0 ? (b.presentCount / b.attTotal) * 100 : 100;
      const composite = 0.6 * avg + 0.4 * att;
      return {
        studentId: b.studentId,
        studentEmail: b.studentEmail,
        name: b.name,
        initials: initialsOf(b.name),
        rollNo: b.rollNo,
        classId: b.classId,
        className: b.className,
        avgScorePct: Number(avg.toFixed(1)),
        attendancePct: Number(att.toFixed(1)),
        composite: Number(composite.toFixed(1)),
        rank: 0, // assigned next
        status: statusOf(avg, att),
      };
    });

    students.sort((a, b) => b.composite - a.composite || a.name.localeCompare(b.name));
    students.forEach((s, i) => { s.rank = i + 1; });

    const totalStudents = students.length;
    const classAverage = totalStudents > 0 ? students.reduce((acc, s) => acc + s.composite, 0) / totalStudents : 0;
    const classAvgScore = totalStudents > 0 ? students.reduce((acc, s) => acc + s.avgScorePct, 0) / totalStudents : 0;
    const classAvgAttendance = totalStudents > 0 ? students.reduce((acc, s) => acc + s.attendancePct, 0) / totalStudents : 0;
    const needAttention = students.filter(s => s.status !== "good");

    // Slice for the leaderboard list view: top 5 + a couple in middle + the user-anchored ones.
    // For now the UI shows top 5 + "rank 7" + "rank 15" hardcoded; we just send top 5 + 3 mid samples.
    const top5 = students.slice(0, 5);
    const mid = totalStudents > 8 ? [students[Math.floor(totalStudents * 0.4)], students[Math.floor(totalStudents * 0.6)]] : [];
    const topStudents = [...top5, ...mid].filter((s, i, arr) => arr.findIndex(x => x.studentId === s.studentId) === i);

    const needAttentionStudents = students.slice(-3).reverse(); // bottom 3, worst first

    return {
      classId,
      className,
      subject,
      totalStudents,
      classAverage: Number(classAverage.toFixed(1)),
      classAvgScore: Number(classAvgScore.toFixed(1)),
      classAvgAttendance: Number(classAvgAttendance.toFixed(1)),
      needAttentionCount: needAttention.length,
      topStudents,
      needAttentionStudents,
      allStudents: students,
    };
  };

  return useQuery<ClassLeaderboard | null>({
    queryKey: ["leaderboard", "class", classId, tid, sid, bid],
    queryFn,
    enabled: Boolean(tid && sid && classId),
    staleTime: 5 * 60_000,
  });
}

// ── Hook 3: individual student detail ──────────────────────────────────────
export function useStudentDetail(studentId: string | null | undefined, classId: string | null | undefined) {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<StudentDetail | null> = async () => {
    const SC = tenantConstraints(teacherData);
    if (!SC || !studentId || !classId) return null;

    // Reuse the class leaderboard data — single source of truth for rank/avg.
    // We re-fetch here to keep this hook self-contained, but TanStack will
    // dedupe via the shared queryKey when both hooks are active.
    const [enrollSnaps, scoreSnaps, attSnaps, classSnaps] = await Promise.all([
      fetchAll("enrollments", [...SC, where("classId", "==", classId)]),
      fetchAll("test_scores", [...SC, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("attendance",  [...SC, where("teacherId", "==", tid as string), where("classId", "==", classId)]),
      fetchAll("classes",     [...SC]),
    ]);

    const target = enrollSnaps.find(e =>
      e.data.studentId === studentId ||
      ((e.data.studentEmail as string | undefined)?.toLowerCase() === studentId.toLowerCase())
    );
    if (!target) return null;

    const targetEmail = (target.data.studentEmail as string | undefined)?.toLowerCase();
    const matchesTarget = (rec: DocumentData) =>
      rec.studentId === studentId ||
      ((rec.studentEmail as string | undefined)?.toLowerCase() === targetEmail);

    // Per-student aggregates
    const studentScores = scoreSnaps.filter(s => matchesTarget(s.data) && !s.data.isAbsent);
    const studentAtt = attSnaps.filter(a => matchesTarget(a.data));

    const studentMarks = studentScores.length > 0
      ? studentScores.reduce((acc, s) => acc + Number(s.data.percentage || 0), 0) / studentScores.length
      : 0;
    const presentCount = studentAtt.filter(a => ["present", "late"].includes(String(a.data.status ?? "").toLowerCase())).length;
    const studentAttPct = studentAtt.length > 0 ? (presentCount / studentAtt.length) * 100 : 100;
    const studentAssignmentsRate = studentAtt.length > 0
      // Proxy for assignment timeliness: assume each scored entry was on-time. Real metric needs a "submittedOn" field.
      ? Math.min((studentScores.length / Math.max(scoreSnaps.length / Math.max(enrollSnaps.length, 1), 1)) * 100, 100)
      : 0;

    // Class averages (recompute — small N, cheap)
    const classScoresOnly = scoreSnaps.filter(s => !s.data.isAbsent);
    const classAvgScore = classScoresOnly.length > 0
      ? classScoresOnly.reduce((acc, s) => acc + Number(s.data.percentage || 0), 0) / classScoresOnly.length
      : 0;
    const classPresent = attSnaps.filter(a => ["present", "late"].includes(String(a.data.status ?? "").toLowerCase())).length;
    const classAvgAttendance = attSnaps.length > 0 ? (classPresent / attSnaps.length) * 100 : 100;
    const classAvgAssignments = enrollSnaps.length > 0
      ? Math.min((classScoresOnly.length / enrollSnaps.length) * 10, 100) // rough proxy
      : 0;

    // Rank in class
    type Bucket = { studentId: string; email?: string; composite: number };
    const buckets = new Map<string, Bucket>();
    enrollSnaps.forEach(e => {
      const key = (e.data.studentId as string) || (e.data.studentEmail as string);
      if (!key || buckets.has(key)) return;
      buckets.set(key, { studentId: (e.data.studentId as string) || key, email: (e.data.studentEmail as string | undefined)?.toLowerCase(), composite: 0 });
    });
    buckets.forEach(b => {
      const matches = (rec: DocumentData) => rec.studentId === b.studentId || ((rec.studentEmail as string | undefined)?.toLowerCase() === b.email);
      const sScores = scoreSnaps.filter(s => matches(s.data) && !s.data.isAbsent);
      const sAtt = attSnaps.filter(a => matches(a.data));
      const m = sScores.length > 0 ? sScores.reduce((acc, s) => acc + Number(s.data.percentage || 0), 0) / sScores.length : 0;
      const p = sAtt.filter(a => ["present", "late"].includes(String(a.data.status ?? "").toLowerCase())).length;
      const a = sAtt.length > 0 ? (p / sAtt.length) * 100 : 100;
      b.composite = 0.6 * m + 0.4 * a;
    });
    const sorted = Array.from(buckets.values()).sort((a, b) => b.composite - a.composite);
    const rank = sorted.findIndex(b => b.studentId === studentId) + 1;

    // Subject breakdown — group test_scores by subject
    const subjectGroups = new Map<string, { mine: number[]; allClass: number[] }>();
    scoreSnaps.forEach(s => {
      if (s.data.isAbsent) return;
      const subj = (s.data.subject as string) || (s.data.subjectName as string) || "All subjects";
      const pct = Number(s.data.percentage);
      if (!Number.isFinite(pct)) return;
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
      .sort((a, b) => a.score - b.score); // worst first

    const classDoc = classSnaps.find(c => c.id === classId)?.data;
    const classLabel = (classDoc?.name as string) || classId;

    return {
      studentId,
      name: (target.data.studentName as string) || "Student",
      initials: initialsOf((target.data.studentName as string) || "Student"),
      rollNo: (target.data.rollNo as string) || "—",
      classId,
      classLabel,
      rank,
      totalInClass: sorted.length,
      composite: Number((0.6 * studentMarks + 0.4 * studentAttPct).toFixed(1)),
      status: statusOf(studentMarks, studentAttPct),
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
        assignments: {
          value: Number(studentAssignmentsRate.toFixed(1)),
          classAvg: Number(classAvgAssignments.toFixed(1)),
          gap: Number((studentAssignmentsRate - classAvgAssignments).toFixed(1)),
          severity: severityOf(studentAssignmentsRate, classAvgAssignments, "assignments"),
        },
        behavior: null,
      },
      subjects,
    };
  };

  return useQuery<StudentDetail | null>({
    queryKey: ["leaderboard", "student", studentId, classId, tid, sid, bid],
    queryFn,
    enabled: Boolean(tid && sid && studentId && classId),
    staleTime: 5 * 60_000,
  });
}

// ── Hook 4: teacher's own metrics (aggregate of their classes) ─────────────
export function useTeacherSelfMetrics() {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<TeacherSelfMetrics | null> = async () => {
    const SC = tenantConstraints(teacherData);
    if (!SC || !tid) return null;

    const [activeAssignments, ownedClasses, allEnroll, allScores, allAtt, allClasses] = await Promise.all([
      fetchAll("teaching_assignments", [...SC, where("teacherId", "==", tid), where("status", "==", "active")]),
      fetchAll("classes", [...SC, where("teacherId", "==", tid)]),
      fetchAll("enrollments", [...SC, where("teacherId", "==", tid)]),
      fetchAll("test_scores", [...SC, where("teacherId", "==", tid)]),
      fetchAll("attendance", [...SC, where("teacherId", "==", tid)]),
      fetchAll("classes", SC),
    ]);

    const assignedIds = activeAssignments.map(a => a.data.classId).filter(Boolean) as string[];
    const ownedIds = ownedClasses.map(s => s.id);
    const myClassIds = Array.from(new Set([...assignedIds, ...ownedIds]));
    if (myClassIds.length === 0) return null;

    const subjectByClass = new Map<string, string>();
    activeAssignments.forEach(a => {
      const cid = a.data.classId as string | undefined;
      const subj = (a.data.subjectName || a.data.subject) as string | undefined;
      if (cid && subj && !subjectByClass.has(cid)) subjectByClass.set(cid, subj);
    });

    const labelOf = (cid: string) => {
      const cls = allClasses.find(c => c.id === cid)?.data;
      const name = (cls?.name as string) || cid;
      const subj = subjectByClass.get(cid) || (cls?.subject as string) || (teacherData?.subject as string) || "Subject";
      return `${name} · ${subj}`;
    };

    const classes: TeacherClassSummary[] = myClassIds.map(cid => {
      const enroll = allEnroll.filter(e => e.data.classId === cid);
      const scores = allScores.filter(s => s.data.classId === cid && !s.data.isAbsent);
      const att = allAtt.filter(a => a.data.classId === cid);
      const present = att.filter(a => ["present", "late"].includes(String(a.data.status ?? "").toLowerCase())).length;
      const avgScore = scores.length > 0 ? scores.reduce((acc, s) => acc + Number(s.data.percentage || 0), 0) / scores.length : 0;
      const avgAtt = att.length > 0 ? (present / att.length) * 100 : 100;
      const composite = 0.6 * avgScore + 0.4 * avgAtt;
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
    staleTime: 5 * 60_000,
  });
}

// ── Hook: Branch teacher leaderboard ────────────────────────────────────────
// Computes composite for every teacher in the branch from existing collections.
// Cross-teacher reads of test_scores / attendance are required — if Firestore
// security rules forbid them, the query throws and the UI falls back to the
// locked-section copy. No Cloud Function needed when rules permit branch reads.

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
  hasData: boolean;       // false when teacher has 0 scores AND 0 attendance — keeps composite meaningful
}

export function useBranchTeacherLeaderboard() {
  const { teacherData } = useAuth();
  const tid = teacherData?.id;
  const sid = teacherData?.schoolId;
  const bid = teacherData?.branchId;

  const queryFn: QueryFunction<BranchTeacherEntry[]> = async () => {
    const SC = tenantConstraints(teacherData);
    if (!SC || !tid) return [];

    const [teacherSnaps, classSnaps, assignSnaps, enrollSnaps, scoreSnaps, attSnaps] = await Promise.all([
      fetchAll("teachers", SC),
      fetchAll("classes", SC),
      fetchAll("teaching_assignments", [...SC, where("status", "==", "active")]),
      fetchAll("enrollments", SC),
      fetchAll("test_scores", SC),
      fetchAll("attendance", SC),
    ]);

    if (teacherSnaps.length === 0) return [];

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
    };
    const byTid = new Map<string, Bucket>();

    teacherSnaps.forEach(t => {
      // Skip inactive accounts if explicitly marked
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
      });
    });

    classSnaps.forEach(c => {
      const owner = c.data.teacherId as string | undefined;
      if (owner && byTid.has(owner)) byTid.get(owner)!.classIds.add(c.id);
    });

    assignSnaps.forEach(a => {
      const owner = a.data.teacherId as string | undefined;
      const cid = a.data.classId as string | undefined;
      if (owner && cid && byTid.has(owner)) byTid.get(owner)!.classIds.add(cid);
    });

    enrollSnaps.forEach(e => {
      const tch = e.data.teacherId as string | undefined;
      if (!tch || !byTid.has(tch)) return;
      const key = (e.data.studentId as string) || (e.data.studentEmail as string) || `${e.data.classId ?? ""}::${e.id}`;
      byTid.get(tch)!.enrollKeys.add(key);
    });

    scoreSnaps.forEach(s => {
      const tch = s.data.teacherId as string | undefined;
      if (!tch || !byTid.has(tch)) return;
      if (s.data.isAbsent) return;
      const pct = Number(s.data.percentage);
      if (!Number.isFinite(pct)) return;
      const b = byTid.get(tch)!;
      b.scoreSum += pct;
      b.scoreCount += 1;
    });

    attSnaps.forEach(a => {
      const tch = a.data.teacherId as string | undefined;
      if (!tch || !byTid.has(tch)) return;
      const status = String(a.data.status ?? "").toLowerCase();
      const b = byTid.get(tch)!;
      if (status === "present" || status === "late") b.presentCount += 1;
      b.attTotal += 1;
    });

    const rows = Array.from(byTid.values()).map(b => {
      const avgScore = b.scoreCount > 0 ? b.scoreSum / b.scoreCount : 0;
      const avgAtt = b.attTotal > 0 ? (b.presentCount / b.attTotal) * 100 : 0;
      const hasData = b.scoreCount > 0 || b.attTotal > 0;
      // Composite stays 0 for teachers without any data so they sink to bottom.
      const composite = hasData ? 0.6 * avgScore + 0.4 * avgAtt : 0;
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

    // Active teachers with NO classes assigned aren't useful on a leaderboard.
    // Keep current teacher always so they see their own row even with zero data.
    const filtered = rows.filter(r => r.classCount > 0 || r.teacherId === tid);

    filtered.sort((a, b) => {
      // hasData first, then composite desc, then totalStudents desc as tiebreak
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
    staleTime: 5 * 60_000,
    retry: 0, // permission errors shouldn't be retried
  });
}

// ── AI Hooks ────────────────────────────────────────────────────────────────
// Each calls the deployed Cloud Function getTeacherAIInsights with a specific
// prompt type. Heavy caching (1 hour) since AI responses cost money.

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

const AI_STALE_MS = 60 * 60_000;     // 1 hour
const AI_GC_MS    = 24 * 60 * 60_000; // keep in cache 24h

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

export function useClassAIPlan(cls: ClassLeaderboard | null | undefined, teacherName: string | undefined) {
  const queryFn: QueryFunction<AIPlan | null> = async () => {
    if (!cls || cls.totalStudents === 0) return null;
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
    return normaliseAIPlan(res.data);
  };

  return useQuery<AIPlan | null>({
    queryKey: ["leaderboard", "ai", "classPlan", cls?.classId, cls?.totalStudents, cls?.classAverage],
    queryFn,
    enabled: Boolean(cls && cls.totalStudents > 0),
    staleTime: AI_STALE_MS,
    gcTime: AI_GC_MS,
    retry: 1,
  });
}

export function useStudentAIPlan(student: StudentDetail | null | undefined, teacherName: string | undefined, teacherSubject: string | undefined) {
  const queryFn: QueryFunction<AIPlan | null> = async () => {
    if (!student) return null;
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
        marks:       { value: student.metrics.marks.value, classAvg: student.metrics.marks.classAvg, gap: student.metrics.marks.gap },
        attendance:  { value: student.metrics.attendance.value, classAvg: student.metrics.attendance.classAvg, gap: student.metrics.attendance.gap },
        assignments: { value: student.metrics.assignments.value, classAvg: student.metrics.assignments.classAvg, gap: student.metrics.assignments.gap },
      },
      subjects: student.subjects.map(s => ({
        name: s.subject, score: s.score, classAvg: s.classAvg, gap: s.gap, status: s.status, isYourSubject: !!s.isYourSubject,
      })),
    };
    const res = await AIController.getStudentActionPlan(payload);
    if (res.status !== "success") throw new Error(res.status === "error" ? res.message : "AI returned no data");
    return normaliseAIPlan(res.data);
  };

  return useQuery<AIPlan | null>({
    queryKey: ["leaderboard", "ai", "studentPlan", student?.studentId, student?.composite],
    queryFn,
    enabled: Boolean(student),
    staleTime: AI_STALE_MS,
    gcTime: AI_GC_MS,
    retry: 1,
  });
}

export function useTeacherSelfAIPlan(self: TeacherSelfMetrics | null | undefined) {
  const queryFn: QueryFunction<AIPlan | null> = async () => {
    if (!self) return null;
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
    return normaliseAIPlan(res.data);
  };

  return useQuery<AIPlan | null>({
    queryKey: ["leaderboard", "ai", "selfPlan", self?.teacherId, self?.composite],
    queryFn,
    enabled: Boolean(self),
    staleTime: AI_STALE_MS,
    gcTime: AI_GC_MS,
    retry: 1,
  });
}
