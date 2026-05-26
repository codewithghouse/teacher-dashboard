/**
 * scanBranchAlertsCron — runs every 4 hours.
 *
 * Owner-dashboard Critical Alerts panel reads from /risks (live onSnapshot).
 * This cron is the auto-generation engine: walks every school, every branch,
 * applies 4 rules, writes new docs to /risks. De-dups against the last 24h
 * of OPEN alerts for the same (branchId, ruleKey) so a stuck condition
 * doesn't spam the feed.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const RULE = {
  LOW_ATT_7D:   "LOW_ATTENDANCE_7D",
  FEE_SURGE:    "FEE_DEFAULTER_SURGE",
  INACTIVE_TCH: "INACTIVE_TEACHER",
  SCORE_DROP:   "SCORE_DROP_MOM",
} as const;

const ATT_WINDOW_DAYS    = 7;
const ATT_WARN_PCT       = 70;
const ATT_CRIT_PCT       = 50;
const ATT_MIN_RECORDS    = 20;     // skip branches with too little data

const FEE_OVERDUE_DAYS   = 30;
const FEE_SURGE_COUNT    = 10;

const TEACHER_IDLE_DAYS  = 5;
const TEACHER_MIN_ROSTER = 1;

const SCORE_DROP_PTS     = 15;
const SCORE_MIN_PER_MONTH = 5;     // need ≥ 5 graded entries / month for signal

const DEDUP_WINDOW_HRS   = 24;

const dayMs  = 24 * 60 * 60 * 1000;
const hourMs =  60 * 60 * 1000;

type Branch = { id: string; name: string };
type AlertSpec = {
  ruleKey: string;
  severity: "critical" | "warning";
  title: string;
  message: string;
  metrics: Record<string, any>;
};

function db() { return admin.firestore(); }

function parseToMillis(raw: any): number | null {
  if (!raw) return null;
  if (typeof raw?.toMillis === "function") {
    try { return raw.toMillis(); } catch { /* fall through */ }
  }
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.getTime();
  if (typeof raw === "string" || typeof raw === "number") {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  if (typeof raw === "object" && typeof (raw as any).seconds === "number") {
    return (raw as any).seconds * 1000;
  }
  return null;
}

async function alreadyOpenRecently(schoolId: string, branchId: string, ruleKey: string): Promise<boolean> {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - DEDUP_WINDOW_HRS * hourMs);
  const snap = await db().collection("risks")
    .where("schoolId", "==", schoolId)
    .where("branchId", "==", branchId)
    .where("ruleKey",  "==", ruleKey)
    .where("createdAt", ">=", cutoff)
    .limit(1)
    .get();
  return !snap.empty;
}

async function writeAlert(schoolId: string, branch: Branch, spec: AlertSpec) {
  await db().collection("risks").add({
    schoolId,
    branchId: branch.id,
    branchName: branch.name,
    ruleKey: spec.ruleKey,
    severity: spec.severity,
    title: spec.title,
    message: spec.message,
    description: spec.message,
    status: "open",
    source: "auto-cron",
    metrics: spec.metrics,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Rule 1: Low Attendance (rolling 7-day < 70%) ──────────────────────────
async function checkLowAttendance(schoolId: string, branch: Branch): Promise<AlertSpec | null> {
  const cutoffMs = Date.now() - ATT_WINDOW_DAYS * dayMs;
  const snap = await db().collection("attendance")
    .where("schoolId", "==", schoolId)
    .where("branchId", "==", branch.id)
    .get();
  let total = 0, present = 0;
  snap.forEach(d => {
    const data = d.data() as any;
    const ts = parseToMillis(data.date ?? data.createdAt);
    if (ts != null && ts < cutoffMs) return;
    total++;
    if (String(data.status || "").toLowerCase() === "present") present++;
  });
  if (total < ATT_MIN_RECORDS) return null;
  const pct = Math.round((present / total) * 100);
  if (pct >= ATT_WARN_PCT) return null;
  return {
    ruleKey: RULE.LOW_ATT_7D,
    severity: pct < ATT_CRIT_PCT ? "critical" : "warning",
    title: "Low Attendance",
    message: `${branch.name} attendance ${pct}% over last ${ATT_WINDOW_DAYS} days (target ≥ ${ATT_WARN_PCT}%)`,
    metrics: { windowDays: ATT_WINDOW_DAYS, attendancePct: pct, sampleSize: total },
  };
}

// ── Rule 2: Fee Defaulter Surge (>30 days overdue, ≥ 10 students) ─────────
async function checkFeeSurge(schoolId: string, branch: Branch): Promise<AlertSpec | null> {
  const cutoffMs = Date.now() - FEE_OVERDUE_DAYS * dayMs;
  const snap = await db().collection("fees")
    .where("schoolId", "==", schoolId)
    .where("branchId", "==", branch.id)
    .get();
  const defaulters = new Set<string>();
  snap.forEach(d => {
    const data = d.data() as any;
    if (String(data.status || "").toLowerCase() === "paid") return;
    const due = parseToMillis(data.dueDate ?? data.createdAt);
    if (due == null || due > cutoffMs) return;
    const sid = data.studentId || data.student?.id;
    if (sid) defaulters.add(sid);
  });
  if (defaulters.size < FEE_SURGE_COUNT) return null;
  return {
    ruleKey: RULE.FEE_SURGE,
    severity: "critical",
    title: "Fee Defaulter Surge",
    message: `${branch.name} has ${defaulters.size} students with fees overdue 30+ days`,
    metrics: { defaulterCount: defaulters.size, overdueDays: FEE_OVERDUE_DAYS },
  };
}

// ── Rule 3: Inactive Teachers (no login for 5+ days) ──────────────────────
async function checkInactiveTeachers(schoolId: string, branch: Branch): Promise<AlertSpec | null> {
  const snap = await db().collection("teachers")
    .where("schoolId", "==", schoolId)
    .where("branchId", "==", branch.id)
    .get();
  if (snap.size < TEACHER_MIN_ROSTER) return null;
  const cutoffMs = Date.now() - TEACHER_IDLE_DAYS * dayMs;
  const idle: { name: string; days: number }[] = [];
  snap.forEach(d => {
    const data = d.data() as any;
    if (data.isActive === false || data.status === "Invited") return;
    const last = parseToMillis(data.lastLoginAt);
    if (last == null) {
      idle.push({ name: data.name || data.email || "Teacher", days: TEACHER_IDLE_DAYS });
      return;
    }
    if (last < cutoffMs) {
      idle.push({
        name: data.name || data.email || "Teacher",
        days: Math.floor((Date.now() - last) / dayMs),
      });
    }
  });
  if (idle.length === 0) return null;
  idle.sort((a, b) => b.days - a.days);
  const top = idle.slice(0, 3).map(t => `${t.name} (${t.days}d)`).join(", ");
  return {
    ruleKey: RULE.INACTIVE_TCH,
    severity: "warning",
    title: "Inactive Teachers",
    message: `${branch.name}: ${idle.length} teacher${idle.length === 1 ? "" : "s"} idle 5+ days — ${top}`,
    metrics: { idleCount: idle.length, threshold: TEACHER_IDLE_DAYS },
  };
}

// ── Rule 4: Score Drop (this month vs last month, ≥ 15 pt drop) ───────────
async function checkScoreDrop(schoolId: string, branch: Branch): Promise<AlertSpec | null> {
  const now = new Date();
  const thisMonthKey = now.getFullYear() * 12 + now.getMonth();
  const prevMonthKey = thisMonthKey - 1;

  const [scoresSnap, resultsSnap] = await Promise.all([
    db().collection("test_scores").where("schoolId", "==", schoolId).where("branchId", "==", branch.id).get(),
    db().collection("results")    .where("schoolId", "==", schoolId).where("branchId", "==", branch.id).get(),
  ]);

  const monthBucket = new Map<number, number[]>();
  const bucket = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
    docs.forEach(d => {
      const data = d.data() as any;
      const pct = parseFloat(data.percentage ?? data.score ?? "");
      if (isNaN(pct)) return;
      const ts = parseToMillis(data.createdAt ?? data.date ?? data.examDate);
      if (ts == null) return;
      const dt = new Date(ts);
      const key = dt.getFullYear() * 12 + dt.getMonth();
      let arr = monthBucket.get(key);
      if (!arr) { arr = []; monthBucket.set(key, arr); }
      arr.push(pct);
    });
  };
  bucket(scoresSnap.docs);
  bucket(resultsSnap.docs);

  const thisArr = monthBucket.get(thisMonthKey) ?? [];
  const prevArr = monthBucket.get(prevMonthKey) ?? [];
  if (thisArr.length < SCORE_MIN_PER_MONTH || prevArr.length < SCORE_MIN_PER_MONTH) return null;
  const avg = (a: number[]) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const thisAvg = avg(thisArr);
  const prevAvg = avg(prevArr);
  const drop = prevAvg - thisAvg;
  if (drop < SCORE_DROP_PTS) return null;
  return {
    ruleKey: RULE.SCORE_DROP,
    severity: "critical",
    title: "Score Drop",
    message: `${branch.name} average dropped ${drop} pts MoM (${prevAvg}% → ${thisAvg}%)`,
    metrics: { thisAvg, prevAvg, drop, thisSample: thisArr.length, prevSample: prevArr.length },
  };
}

// ── Scheduled entry — every 4 hours, IST timezone ─────────────────────────
export const scanBranchAlertsCron = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("every 4 hours")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    const start = Date.now();
    const schoolsSnap = await db().collection("schools").get();
    let branchesScanned = 0;
    let alertsWritten = 0;

    for (const schoolDoc of schoolsSnap.docs) {
      const schoolId = schoolDoc.id;
      const branchesSnap = await db().collection("schools").doc(schoolId).collection("branches").get();
      const branches: Branch[] = branchesSnap.docs.map(d => {
        const data = d.data() as any;
        return {
          id:   data.branchId || data.schoolId || d.id,
          name: data.name || data.schoolName || "Branch",
        };
      });

      for (const branch of branches) {
        branchesScanned++;
        let specs: (AlertSpec | null)[] = [];
        try {
          specs = await Promise.all([
            checkLowAttendance (schoolId, branch),
            checkFeeSurge      (schoolId, branch),
            checkInactiveTeachers(schoolId, branch),
            checkScoreDrop     (schoolId, branch),
          ]);
        } catch (err) {
          console.warn(`[scanBranchAlertsCron] rule error school=${schoolId} branch=${branch.id}:`, err);
          continue;
        }
        for (const spec of specs) {
          if (!spec) continue;
          if (await alreadyOpenRecently(schoolId, branch.id, spec.ruleKey)) continue;
          try {
            await writeAlert(schoolId, branch, spec);
            alertsWritten++;
          } catch (err) {
            console.warn(`[scanBranchAlertsCron] write error school=${schoolId} branch=${branch.id} rule=${spec.ruleKey}:`, err);
          }
        }
      }
    }

    const ms = Date.now() - start;
    console.log(`[scanBranchAlertsCron] done schools=${schoolsSnap.size} branches=${branchesScanned} new_alerts=${alertsWritten} took=${ms}ms`);
    return null;
  });
