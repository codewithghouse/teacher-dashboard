import { useState, useEffect, useMemo } from "react";
import { db } from "../lib/firebase";
import {
  collection, query, onSnapshot, getDocs,
  doc, where, Timestamp, serverTimestamp,
} from "firebase/firestore";
import { auditedUpdate, auditedAdd } from "../lib/auditedWrites";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

const HALO_SH = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)";
const HALO_BDR = "0.5px solid rgba(0,85,255,0.07)";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Alert {
  id: string;
  studentId: string;
  name: string;
  initials: string;
  severity: "Critical" | "High Priority" | "Medium Priority";
  type: "Attendance" | "Grades" | "Submissions" | "Behavior";
  issue: string;
  details: string[];
  cls: string;
  isSystem?: boolean;
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  hero:  "#08090C",
  bg:    "#F5F6F9",
  white: "#ffffff",
  ink1:  "#08090C",
  ink2:  "#42475A",
  ink3:  "#8C92A4",
  s1:    "#F5F6F9",
  s2:    "#ECEEF4",
  bdr:   "#E2E5EE",
  blue:  "#3B5BDB",
  blBg:  "#EDF2FF",
  blBdr: "#BAC8FF",
  red:   "#C92A2A",
  rlBg:  "#FFF5F5",
  rlBdr: "#FFC9C9",
  amb:   "#C87014",
  alBg:  "#FFF9DB",
  alBdr: "#FFE066",
  grn:   "#087F5B",
  grn2:  "#2F9E44",
  glBg:  "#EBFBEE",
  glBdr: "#8CE99A",
};

// ── Avatar helpers ────────────────────────────────────────────────────────────
// Single Blue Apple palette used by both mobile and desktop avatars.
// Deterministic djb2-style hash → same student → same colour everywhere.
const AV_HEX = ["#7B3FF4", "#0055FF", "#00C853", "#FF8800", "#C2255C", "#00B8D4", "#6741D9"];
const avBg = (name: string) => {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_HEX[h % AV_HEX.length];
};
const getInitials = (name: string) => {
  const p = (name || "").trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
};

// ── getPct ────────────────────────────────────────────────────────────────────
// Returns a percentage in [0,100] when the doc carries enough info to compute
// one, or `null` when no usable shape is present. Returning null (not 0) is
// intentional — score=0 with no data must NOT cascade into "Critical" alerts
// (memory: bug_pattern_score_zero_no_data).
//
// Field shape coverage (memory: bug_pattern_score_field_singular_mark):
//   - explicit `percentage` always wins
//   - `mark` (singular, gradebook writer) + `maxMarks`
//   - `marks` (plural, test_scores writer) + `maxMarks`
//   - `score` + `maxScore`
// Raw `score`/`mark`/`marks` without a max is rejected — we cannot tell whether
// it's already a percentage or raw points.
const getPct = (sc: any): number | null => {
  const num = (v: any): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const pct = num(sc?.percentage);
  if (pct !== null) return Math.max(0, Math.min(100, pct));

  const maxMarks = num(sc?.maxMarks);
  const markSing = num(sc?.mark);
  if (markSing !== null && maxMarks && maxMarks > 0) {
    return Math.max(0, Math.min(100, (markSing / maxMarks) * 100));
  }
  const marksPlural = num(sc?.marks);
  if (marksPlural !== null && maxMarks && maxMarks > 0) {
    return Math.max(0, Math.min(100, (marksPlural / maxMarks) * 100));
  }
  const score = num(sc?.score);
  const maxScore = num(sc?.maxScore);
  if (score !== null && maxScore && maxScore > 0) {
    return Math.max(0, Math.min(100, (score / maxScore) * 100));
  }
  return null;
};

// ── Sub-components ────────────────────────────────────────────────────────────
const TabIcon = ({ type, active }: { type: string; active: boolean }) => {
  const c = active ? T.red : T.ink3;
  const p = { width: 19, height: 19, viewBox: "0 0 18 18", fill: "none", stroke: c, strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (type === "grid") return (
    <svg {...p}><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="11" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="11" width="5" height="5" rx="1.2" /><rect x="11" y="11" width="5" height="5" rx="1.2" /></svg>
  );
  if (type === "students") return (
    <svg {...p}><path d="M2 15V9L9 5l7 4v6" /><rect x="6.5" y="11" width="5" height="4" rx=".5" /></svg>
  );
  if (type === "alert") return (
    <svg {...p}><path d="M9 2L16.5 15.5H1.5L9 2z" /><line x1="9" y1="7" x2="9" y2="11.5" /><circle cx="9" cy="13.5" r="1" fill={c} stroke="none" /></svg>
  );
  if (type === "user") return (
    <svg {...p}><circle cx="9" cy="7" r="3" /><path d="M3 17c0 0 1.5-4 6-4s6 4 6 4" /></svg>
  );
  return null;
};

// ── Main component ────────────────────────────────────────────────────────────
const RisksAlerts = () => {
  const { teacherData } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading]               = useState(true);
  const [alerts, setAlerts]                 = useState<Alert[]>([]);
  const [resolvedCount, setResolvedCount]   = useState(0);
  const [activeTab, setActiveTab]           = useState("All");
  const [resolving, setResolving]           = useState<string | null>(null);
  const [refreshKey, setRefreshKey]         = useState(0);
  const [listenerError, setListenerError]   = useState<string | null>(null);

  // ── Firebase listener ───────────────────────────────────────────────────────
  // Fixed: removed SC (schoolId/branchId) from queries that may not have those
  // fields — Firestore returns 0 docs if a where() field doesn't exist on docs.
  // Only teacherId is used for scoping; classId-based queries use classIds only.
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    setLoading(true);

    const tid = teacherData.id;
    const schoolId = teacherData.schoolId;

    const chunkArr = <X,>(arr: X[], n: number): X[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

    // Listen on classes — re-compute when classes change
    const qClasses = query(
      collection(db, "classes"),
      where("schoolId", "==", schoolId),
      where("teacherId", "==", tid),
    );
    let ignore = false;
    setListenerError(null);
    const unsubscribe = onSnapshot(qClasses, async (classSnap) => {
      try {
        if (ignore) return;
        // Also pick up teaching_assignments. Guarded — a transient failure here
        // shouldn't abort the whole computation, just degrade to class-snap only.
        const taSnap = await getDocs(query(
          collection(db, "teaching_assignments"),
          where("schoolId", "==", schoolId),
          where("teacherId", "==", tid),
        )).catch(err => {
          console.warn("[RisksAlerts] teaching_assignments read failed:", err);
          return { docs: [] as any[] };
        });
        const classIdSet = new Set<string>([
          ...classSnap.docs.map(d => d.id),
          ...taSnap.docs.map((d: any) => d.data().classId).filter(Boolean),
        ]);
        if (ignore) return;
        const classIds = Array.from(classIdSet);

        if (classIds.length === 0) { setAlerts([]); setLoading(false); return; }

        // Enrollments — scoped by school + classId
        const enrollSnaps = await Promise.all(
          chunkArr(classIds, 30).map(ch => getDocs(query(
            collection(db, "enrollments"),
            where("schoolId", "==", schoolId),
            where("classId", "in", ch),
          )))
        );
        const enrolls = enrollSnaps.flatMap(s => s.docs).map(d => ({ enrollId: d.id, ...d.data() })) as any[];

        if (enrolls.length === 0) { setAlerts([]); setLoading(false); return; }

        // Roster dedup. Prefer studentId — the canonical primary key. Fall back
        // to email then name only when id is absent. Whitespace-normalize the
        // key so " John Doe " and "John Doe" don't bucket separately. We
        // intentionally KEEP one row per (student, classId) combo — alerts are
        // class-scoped (memory: bug_pattern_enrollment_row_dedup), so a student
        // in two classes legitimately needs two enrollments through.
        const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
        const rosterMap = new Map();
        enrolls.forEach(e => {
          const idPart = e.studentId
            ? `id:${normKey(String(e.studentId))}`
            : e.studentEmail
              ? `em:${normKey(String(e.studentEmail))}`
              : `nm:${normKey(String(e.studentName || ""))}`;
          const key = `${idPart}|cls:${e.classId || ""}`;
          if (!rosterMap.has(key)) rosterMap.set(key, e);
        });
        const uniqueRoster = Array.from(rosterMap.values());

        // Gradebook scores — scoped by school + classId. Failure logged, returns empty.
        const gbSnapPromise = Promise.all(
          chunkArr(classIds, 30).map(ch => getDocs(query(
            collection(db, "gradebook_scores"),
            where("schoolId", "==", schoolId),
            where("classId", "in", ch),
          )))
        ).then(snaps => ({ docs: snaps.flatMap(s => s.docs) }))
         .catch(err => {
           console.warn("[RisksAlerts] gradebook_scores read failed:", err);
           return { docs: [] as any[] };
         });

        // All other queries — schoolId + teacherId scoped. Per-collection failures
        // log a warning instead of failing silently so issues are diagnosable.
        const safeGet = (col: string, ...filters: any[]) =>
          getDocs(query(collection(db, col), where("schoolId", "==", schoolId), ...filters))
            .catch(err => {
              console.warn(`[RisksAlerts] ${col} read failed:`, err);
              return { docs: [] as any[] };
            });

        const [attSnap, tsSnap, gbSnap, assignSnap, subsSnap, manualSnap, resultsSnap, notesSnap] = await Promise.all([
          safeGet("attendance",    where("teacherId", "==", tid)),
          safeGet("test_scores",   where("teacherId", "==", tid)),
          gbSnapPromise,
          safeGet("assignments",   where("teacherId", "==", tid)),
          safeGet("submissions",   where("teacherId", "==", tid)),
          safeGet("risks",         where("teacherId", "==", tid)),
          safeGet("results",       where("teacherId", "==", tid)),
          safeGet("parent_notes",  where("teacherId", "==", tid)),
        ]);

        const allAtt     = attSnap.docs.map((d: any) => d.data());
        const allTS      = tsSnap.docs.map((d: any) => d.data());
        const allGB      = (gbSnap as any).docs.map((d: any) => d.data());
        const allResults = resultsSnap.docs.map((d: any) => d.data());
        const allAssign  = assignSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];
        const allSubs    = subsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];
        const manuals    = manualSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];
        const allNotes   = notesSnap.docs.map((d: any) => d.data());

        // Resolved this week: only resolved risks whose resolvedAt is within last 7 days
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const resolvedThisWeek = manuals.filter((r: any) => {
          if (!r.resolved) return false;
          let ts = 0;
          if (r.resolvedAt instanceof Timestamp) ts = r.resolvedAt.toMillis();
          else if (r.resolvedAt?.toDate)         ts = r.resolvedAt.toDate().getTime();
          else if (typeof r.resolvedAt === "string") ts = new Date(r.resolvedAt).getTime();
          else if (typeof r.resolvedAt === "number") ts = r.resolvedAt;
          // Legacy docs without resolvedAt: count as "this week" so old data isn't hidden entirely
          return ts === 0 || ts >= weekAgo;
        }).length;
        setResolvedCount(resolvedThisWeek);

        const generated: Alert[] = [];
        const now = Date.now();
        const threeWeeksAgo = now - 21 * 24 * 60 * 60 * 1000;

        // Build a map of classId → assignments for per-class submission matching
        const classAssignMap = new Map<string, any[]>();
        allAssign.forEach((a: any) => {
          const cid = a.classId || "";
          if (!classAssignMap.has(cid)) classAssignMap.set(cid, []);
          classAssignMap.get(cid)!.push(a);
        });

        uniqueRoster.forEach((e: any) => {
          const sId    = e.studentId || e.enrollId;
          const sEmail = e.studentEmail?.toLowerCase();
          const sName  = (e.studentName || "").toLowerCase();
          const name   = e.studentName || "Student";
          // Suffix scopes alert id by class — same student in two classes gets
          // two distinct keys, preventing React key collisions and accidental
          // dedup of one class's signal by another.
          const cidSfx = e.classId ? `_${e.classId}` : "";

          // Strict 3-tier student attribution (memory: pattern_3tier_attribution).
          // Substring `id?.includes(sId)` removed — was leaking cross-student
          // matches (e.g. `s1` matching `s10`, `s100`, `s_xyz_1`). Tier 3 (name)
          // is a defensive fallback for legacy docs that have neither studentId
          // nor studentEmail; it never overrides a doc that DOES have id/email
          // pointing at a different student.
          const sf = (arr: any[]) => arr.filter(item => {
            // Tier 1: canonical id
            if (sId && item.studentId && item.studentId === sId) return true;
            // Tier 2: email (case-insensitive)
            if (sEmail && typeof item.studentEmail === "string" &&
                item.studentEmail.toLowerCase() === sEmail) return true;
            // Tier 3: name fallback — only when doc has no id/email at all
            if (sName && typeof item.studentName === "string" &&
                item.studentName.toLowerCase() === sName &&
                !item.studentId && !item.studentEmail) return true;
            return false;
          });

          // 1. ATTENDANCE — filter by date client-side (avoids composite index)
          const sAtt = sf(allAtt);
          const recentAtt = sAtt.filter((a: any) => {
            let ts = 0;
            if (a.date instanceof Timestamp) ts = a.date.toMillis();
            else if (a.date?.toDate) ts = a.date.toDate().getTime();
            else if (typeof a.date === "string") ts = new Date(a.date).getTime();
            else if (typeof a.date === "number") ts = a.date;
            return ts > threeWeeksAgo;
          });
          if (recentAtt.length >= 2) {
            const absences = recentAtt.filter((a: any) => a.status === "absent").length;
            const lates    = recentAtt.filter((a: any) => a.status === "late").length;
            const rate     = ((recentAtt.length - absences) / recentAtt.length) * 100;
            // Fixed: only flag if 2+ absences OR rate below 75% (was too aggressive at 1 absence)
            if (rate < 75 || absences >= 2) {
              generated.push({
                id: `att_${sId}${cidSfx}`, studentId: sId, name,
                initials: getInitials(name),
                severity: rate < 60 ? "Critical" : rate < 75 ? "High Priority" : "Medium Priority",
                type: "Attendance",
                issue: `Attendance at ${rate.toFixed(0)}% — ${absences} absence${absences > 1 ? "s" : ""} in last 3 weeks`,
                details: [`Late arrivals: ${lates}`, `${recentAtt.length} records in window`],
                cls: e.className || "Class", isSystem: true,
              });
            }
          }

          // 2. GRADES — short-circuit on no-data BEFORE classifying severity.
          // Memory: bug_pattern_score_zero_no_data — `recentAvg = 0` from an
          // empty score window must NOT trigger "Critical". Only flag when
          // there's at least one usable score in the recent window.
          const sScores = [...sf(allTS), ...sf(allGB), ...sf(allResults)];
          if (sScores.length >= 1) {
            // Each writer uses a different timestamp field (memory:
            // bug_pattern_filterbytime_field_drift). Walk the full list to
            // avoid silently sorting ~40% of recent docs to position 0.
            const tsOf = (sc: any): number => {
              const cands = [sc?.timestamp, sc?.date, sc?.updatedAt, sc?.uploadedAt, sc?.createdAt, sc?.gradedAt];
              for (const c of cands) {
                if (!c) continue;
                if (c?.toMillis) return c.toMillis();
                if (c?.toDate)   return c.toDate().getTime();
                if (typeof c === "string") { const n = new Date(c).getTime(); if (!isNaN(n)) return n; }
                if (typeof c === "number") return c;
              }
              return 0;
            };
            const sorted = [...sScores].sort((a, b) => tsOf(a) - tsOf(b));
            const recent3   = sorted.slice(-3).map(getPct).filter((v): v is number => v !== null);
            const past3     = sorted.slice(-6, -3).map(getPct).filter((v): v is number => v !== null);
            // No usable recent scores → no signal → no alert. Skip silently.
            if (recent3.length === 0) {
              // intentionally no alert — protects empty rosters from false Critical
            } else {
              const recentAvg = recent3.reduce((a, b) => a + b, 0) / recent3.length;
              const pastAvg   = past3.length > 0
                ? past3.reduce((a, b) => a + b, 0) / past3.length
                : recentAvg;
              // Drop only meaningful when we have a real pastAvg to compare against
              const drop      = past3.length > 0 ? pastAvg - recentAvg : 0;
              if (recentAvg < 60 || drop > 10) {
                generated.push({
                  id: `grd_${sId}${cidSfx}`, studentId: sId, name,
                  initials: getInitials(name),
                  severity: drop > 20 || recentAvg < 40 ? "Critical" : "High Priority",
                  type: "Grades",
                  issue: drop > 10
                    ? `Grade avg dropped ${drop.toFixed(0)}% — from ${pastAvg.toFixed(0)}% to ${recentAvg.toFixed(0)}%`
                    : `Grade avg at ${recentAvg.toFixed(0)}% — below passing benchmark`,
                  details: [
                    past3.length > 0
                      ? `Trend: ${drop > 0 ? "Declining" : "Stable"}`
                      : `Trend: Insufficient history`,
                    `Based on ${recent3.length} recent score${recent3.length > 1 ? "s" : ""}`,
                  ],
                  cls: e.className || "Class", isSystem: true,
                });
              }
            }
          }

          // 3. SUBMISSIONS — Fixed: only check assignments for THIS student's class
          const studentClassId = e.classId || "";
          const classAssignments = classAssignMap.get(studentClassId) || allAssign;
          const sSubs  = sf(allSubs);
          const subSet = new Set(sSubs.map((s: any) => s.assignmentId));
          const missed = classAssignments.filter((a: any) => {
            let due = 0;
            if (a.dueDate?.toMillis) due = a.dueDate.toMillis();
            else if (a.dueDate?.toDate) due = a.dueDate.toDate().getTime();
            else if (typeof a.dueDate === "string") due = new Date(a.dueDate).getTime();
            else if (typeof a.dueDate === "number") due = a.dueDate;
            return due > 0 && due < now && !subSet.has(a.id);
          });
          if (missed.length >= 2) {
            generated.push({
              id: `sub_${sId}${cidSfx}`, studentId: sId, name,
              initials: getInitials(name),
              severity: missed.length >= 4 ? "Critical" : "High Priority",
              type: "Submissions",
              issue: `Missing ${missed.length} assignment${missed.length > 1 ? "s" : ""} — overdue`,
              details: [`Overdue: ${missed.slice(0, 2).map((m: any) => m.title || "Assignment").join(", ")}`, `Grade impact: -${Math.min(missed.length * 3, 15)}%`],
              cls: e.className || "Class", isSystem: true,
            });
          }

          // 4. BEHAVIOR — only trigger on concrete negative-behaviour signals.
          // Word-boundary regex prevents false positives ("no distraction",
          // "got sick" from a sick-leave note, "no trouble at all"). Dropped
          // "sick"/"trouble" entirely — too generic. "Distraction" tightened
          // to "distracting"/"disruption"/"disruptive" which only appear in
          // negative contexts.
          const BEHAVIOR_RE = /\b(aggressive|aggression|bully|bullied|bullying|disruptive|disruption|distracting|refused|fight|fought|misbehav|insubordinat)\b/;
          const sNotes    = sf(allNotes);
          const negSignals = sNotes.filter((n: any) => {
            const text = (n.content || n.message || "").toLowerCase();
            return BEHAVIOR_RE.test(text);
          });
          if (negSignals.length > 0) {
            generated.push({
              id: `beh_${sId}${cidSfx}`, studentId: sId, name,
              initials: getInitials(name),
              severity: negSignals.length >= 3 ? "Critical" : "High Priority",
              type: "Behavior",
              issue: `${negSignals.length} concerning behaviour note${negSignals.length > 1 ? "s" : ""} logged`,
              details: [`Notes flagged: ${negSignals.length}`, `Requires attention`],
              cls: e.className || "Class", isSystem: true,
            });
          }
        });

        // MANUAL alerts (risks collection). Namespace the id to avoid colliding
        // with system-generated ids (which use att_/grd_/sub_/beh_ prefixes).
        // Dedup is then a real check against duplicate manual docs.
        const seenIds = new Set(generated.map(a => a.id));
        manuals.filter((r: any) => !r.resolved).forEach((r: any) => {
          const mid = `manual_${r.id}`;
          if (seenIds.has(mid)) return;
          seenIds.add(mid);
          generated.push({
            id: mid, studentId: r.studentId,
            name: r.studentName || "Student",
            initials: getInitials(r.studentName || "Student"),
            severity: r.severity || "Medium Priority",
            type: r.type || "Behavior",
            issue: r.issue || r.details || "Manual alert flagged by teacher",
            details: r.details ? [r.details] : ["Flagged for review"],
            cls: r.className || "Class", isSystem: false,
          });
        });

        // Severity bucket — unknown values fall through to medium so the sort
        // never produces NaN (which would scramble the list silently).
        const ORDER: Record<string, number> = { Critical: 0, "High Priority": 1, "Medium Priority": 2 };
        const orderOf = (s: string) => (s in ORDER ? ORDER[s] : 2);
        generated.sort((a, b) => orderOf(a.severity) - orderOf(b.severity));
        if (ignore) return;
        setAlerts(generated);
      } catch (err) {
        if (ignore) return;
        console.error("[RisksAlerts] Error:", err);
        setListenerError(err instanceof Error ? err.message : "Failed to load alerts.");
        toast.error("Failed to load alerts.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }, (err) => {
      if (ignore) return;
      console.error("[RisksAlerts] classes listener error:", err);
      setListenerError(err.message || "Live updates disrupted.");
      setLoading(false);
    });
    return () => { ignore = true; unsubscribe(); };
  }, [teacherData?.id, teacherData?.schoolId, refreshKey]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleResolve = async (a: Alert) => {
    if (a.isSystem) {
      toast.info("System alerts resolve automatically when the issue improves.");
      return;
    }
    // Manual-alert ids are namespaced `manual_${docId}` to avoid collision with
    // system ids — strip the prefix when writing to the `risks` collection.
    const docId = a.id.startsWith("manual_") ? a.id.slice(7) : a.id;
    setResolving(a.id);
    // Snapshot prev state for rollback (memory: optimistic-update safety).
    const prevAlerts = alerts;
    setAlerts(prev => prev.filter(x => x.id !== a.id));
    setResolvedCount(c => c + 1);
    try {
      await auditedUpdate(doc(db, "risks", docId), {
        resolved: true,
        resolvedAt: serverTimestamp(),
      });
      toast.success("Alert marked as resolved.");
    } catch (e) {
      console.error("[RisksAlerts] resolve failed", e);
      // Rollback optimistic state.
      setAlerts(prevAlerts);
      setResolvedCount(c => Math.max(0, c - 1));
      toast.error("Failed to update. Try again.");
    } finally {
      setResolving(null);
    }
  };

  // ── Outreach message builders ────────────────────────────────────────────
  // Pre-fills the parent-communication composer with a context-aware draft.
  // Teachers can edit before sending; reminder messages auto-send because the
  // copy is purely informational ("you have N pending").
  const buildContactMessage = (a: Alert): string => {
    const first = (a.name || "").split(" ")[0] || a.name;
    switch (a.type) {
      case "Attendance":
        return `Hello, this is a quick note about ${a.name}'s attendance in ${a.cls}. ${a.issue}. Could we have a brief conversation about what's keeping ${first} away from class? Please share a time that works for you.`;
      case "Grades":
        return `Hello, I wanted to share an update on ${a.name}'s recent academic performance in ${a.cls}. ${a.issue}. I'd like to set up a short meeting so we can plan some support. Please let me know when you're available.`;
      case "Submissions":
        return `Hi, just a reminder that ${a.name} has pending assignments in ${a.cls}. ${a.issue}. Please ensure ${first} completes and submits them at the earliest. Happy to help if any clarification is needed.`;
      case "Behavior":
        return `Hello, I wanted to discuss ${a.name}'s recent behaviour in ${a.cls}. ${a.issue}. A short conversation would help us support ${first} together — please let me know a convenient time.`;
      default:
        return `Hello, an update on ${a.name} from ${a.cls}: ${a.issue}. Please let me know if we can schedule a quick chat.`;
    }
  };

  const handleContactParent = (a: Alert) => {
    navigate("/parent-notes", {
      state: {
        autoOpenStudentId:    a.studentId || "",
        autoOpenStudentEmail: "", // alerts carry id only; ParentNotes will resolve from roster
        autoMessage:          buildContactMessage(a),
      },
    });
  };

  // Auto-send reminder for Submissions alerts. No modal, no navigation —
  // the copy is informational and routine, so friction is unwelcome.
  const [sending, setSending] = useState<string | null>(null);
  const handleSendReminder = async (a: Alert) => {
    if (!teacherData?.schoolId || !teacherData?.id) {
      toast.error("Missing school context — please refresh.");
      return;
    }
    setSending(a.id);
    try {
      // Resolve studentEmail from enrollments so the parent-side reader can
      // dual-query (memory: dual_query_pattern_studentid_email).
      let studentEmail = "";
      if (a.studentId) {
        const eSnap = await getDocs(query(
          collection(db, "enrollments"),
          where("schoolId", "==", teacherData.schoolId),
          where("studentId", "==", a.studentId),
        )).catch(() => null);
        if (eSnap && !eSnap.empty) {
          studentEmail = (eSnap.docs[0].data() as any).studentEmail?.toLowerCase() || "";
        }
      }
      await auditedAdd(collection(db, "parent_notes"), {
        schoolId:     teacherData.schoolId,
        branchId:     teacherData.branchId || "",
        teacherId:    teacherData.id,
        teacherName:  teacherData.name || "Teacher",
        studentId:    a.studentId || "",
        studentEmail,
        studentName:  a.name,
        parentName:   `Parent of ${a.name}`,
        content:      buildContactMessage(a),
        from:         "teacher",
        status:       "Sent",
        read:         false,
        autoSent:     true,
        sourceAlertId: a.id,
        createdAt:    serverTimestamp(),
      });
      toast.success(`Reminder sent to ${a.name}'s parent.`);
    } catch (err) {
      console.error("[RisksAlerts] reminder send failed", err);
      toast.error("Failed to send reminder. Try again.");
    } finally {
      setSending(null);
    }
  };

  // Single source of truth for the primary outreach button per alert type.
  // Submissions auto-send (routine reminder); everything else navigates to
  // ParentNotes with a prefilled message so the teacher can edit before send.
  const getPrimaryAction = (a: Alert): { label: string; auto: boolean; handler: () => void } => {
    switch (a.type) {
      case "Submissions":
        return { label: "Send Reminder",    auto: true,  handler: () => handleSendReminder(a) };
      case "Attendance":
        return { label: "Contact Parent",   auto: false, handler: () => handleContactParent(a) };
      case "Grades":
        return { label: "Schedule Meeting", auto: false, handler: () => handleContactParent(a) };
      case "Behavior":
        return { label: "Notify Parent",    auto: false, handler: () => handleContactParent(a) };
      default:
        return { label: "Contact Parent",   auto: false, handler: () => handleContactParent(a) };
    }
  };

  // ── Computed values ───────────────────────────────────────────────────────
  const criticalCount = alerts.filter(a => a.severity === "Critical").length;
  const highCount     = alerts.filter(a => a.severity === "High Priority").length;
  const mediumCount   = alerts.filter(a => a.severity === "Medium Priority").length;
  const attCount      = alerts.filter(a => a.type === "Attendance").length;
  const gradesCount   = alerts.filter(a => a.type === "Grades").length;
  const subsCount     = alerts.filter(a => a.type === "Submissions").length;
  const behaviorCount = alerts.filter(a => a.type === "Behavior").length;
  const totalCount    = alerts.length;
  const maxBar        = Math.max(totalCount, 1);

  const visible = useMemo(() => {
    if (activeTab === "Attendance")  return alerts.filter(a => a.type === "Attendance");
    if (activeTab === "Grades")      return alerts.filter(a => a.type === "Grades");
    if (activeTab === "Submissions") return alerts.filter(a => a.type === "Submissions");
    if (activeTab === "Behavior")    return alerts.filter(a => a.type === "Behavior");
    return alerts;
  }, [alerts, activeTab]);

  // Class-wise grouping. Preserves the severity order within each class
  // (alerts already arrive sorted Critical → High → Medium). Map iteration
  // order is insertion order, so the first class to appear in `visible` wins
  // the top section. Class with most-severe alert is naturally first.
  const groupedByClass = useMemo(() => {
    const map = new Map<string, Alert[]>();
    visible.forEach(a => {
      const key = a.cls || "Class";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return map;
  }, [visible]);

  // Hero content changes per tab
  const HERO: Record<string, { eyebrow: string; line1: string; line2: string; sub: string }> = {
    All:         { eyebrow: "Monitoring",             line1: "Risks &",    line2: "alerts",      sub: "Monitor and respond to student concerns." },
    Attendance:  { eyebrow: "Attendance monitoring",  line1: "Attendance", line2: "alerts",      sub: "Students with attendance concerns appear here." },
    Grades:      { eyebrow: "Grade monitoring",       line1: "Grade",      line2: "alerts",      sub: "Students with grade concerns appear here." },
    Submissions: { eyebrow: "Submission monitoring",  line1: "Submission", line2: "reminders",   sub: "Students with overdue assignments appear here." },
    Behavior:    { eyebrow: "Behaviour monitoring",   line1: "Behaviour",  line2: "alerts",      sub: "Students flagged for behaviour concerns appear here." },
  };
  const hc = HERO[activeTab] || HERO.All;

  // Filter tabs config — covers all four alert types so nothing stays hidden
  // behind an unselectable filter.
  const FILTER_TABS = [
    { id: "All",         label: "All",         count: totalCount    },
    { id: "Attendance",  label: "Attendance",  count: attCount      },
    { id: "Grades",      label: "Grades",      count: gradesCount   },
    { id: "Submissions", label: "Submissions", count: subsCount     },
    { id: "Behavior",    label: "Behaviour",   count: behaviorCount },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", paddingBottom: 0 }}>

      {/* ═══════════════════ MOBILE VIEW (new mockup) ═══════════════════ */}
      <div
        className="md:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px] pb-7"
        style={{
          background: "#EEF4FF",
          minHeight: "100vh",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <style>{`
          .ra-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
          @media (hover:hover) { .ra-card3d:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); } }
          .ra-card3d:active { transform: translateY(-1px) scale(.99); }
          .ra-press { transition: all 0.3s ease; }
          .ra-press:hover { transform: translateY(-1px); filter: brightness(1.05); }
          .ra-press:active { transform: scale(.94); }
          @keyframes raFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes raShimmer { 0% { opacity: 0.55; } 50% { opacity: 1; } 100% { opacity: 0.55; } }
          .ra-skeleton { animation: raShimmer 1.4s ease-in-out infinite; }
          @keyframes raPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(1.25); } }
          .ra-pulse { animation: raPulse 1.6s ease-in-out infinite; }
          .ra-enter > * { animation: raFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
          .ra-enter > *:nth-child(1) { animation-delay: .04s; }
          .ra-enter > *:nth-child(2) { animation-delay: .10s; }
          .ra-enter > *:nth-child(3) { animation-delay: .16s; }
          .ra-enter > *:nth-child(4) { animation-delay: .22s; }
          .ra-enter > *:nth-child(5) { animation-delay: .28s; }
          .ra-enter > *:nth-child(6) { animation-delay: .34s; }
          .ra-enter > *:nth-child(7) { animation-delay: .40s; }
        `}</style>

        {(() => {
          // ── derived colours / helpers used in mobile JSX ───────────────────
          const tabColorFor = (type: Alert["type"]) => type === "Attendance" ? "#FF8800" : "#FF3355";
          const tagClsFor   = (type: Alert["type"]) => type === "Attendance" ? "attendance" : "grade";
          // No fabricated fallback — system-generated alerts have no real
          // timestamp, so we show a neutral indicator rather than invent
          // "2h"/"5h"/"1d" by severity (memory: bug_pattern_fabricated_fallback).
          const timeAgo = (a: Alert): string => {
            const anyA = a as any;
            const raw = anyA.createdAt || anyA.timestamp || anyA.resolvedAt;
            let ms = 0;
            if (raw?.toMillis) ms = raw.toMillis();
            else if (raw?.toDate) ms = raw.toDate().getTime();
            else if (typeof raw === "string") ms = new Date(raw).getTime();
            else if (typeof raw === "number") ms = raw;
            if (!ms) return a.isSystem ? "Live" : "—";
            const diff = Date.now() - ms;
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return "now";
            if (mins < 60) return `${mins}m`;
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return `${hrs}h`;
            return `${Math.floor(hrs / 24)}d`;
          };
          // Mobile uses the shared avBg for palette consistency with desktop.
          const mobAvBg = (name: string) => avBg(name);
          // Deterministic class-chip palette derived from class name hash —
          // no hardcoded student/class identifiers. Same class → same colour
          // every render.
          const MOB_CLASS_CHIP_PALETTE = [
            { bg: "rgba(9,87,247,.08)",  color: "#0055FF" },
            { bg: "rgba(123,63,244,.12)", color: "#7B3FF4" },
            { bg: "rgba(0,184,212,.10)", color: "#00B8D4" },
            { bg: "rgba(0,200,83,.10)",  color: "#00A746" },
            { bg: "rgba(255,136,0,.10)", color: "#C25400" },
            { bg: "rgba(194,37,92,.10)", color: "#C2255C" },
          ];
          const mobClassChipColor = (name: string) => {
            const src = (name || "").toLowerCase();
            let h = 0;
            for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
            return MOB_CLASS_CHIP_PALETTE[h % MOB_CLASS_CHIP_PALETTE.length];
          };
          const mobParseCls = (cls: string) => {
            const parts = (cls || "").split(" — ");
            return { className: parts[0] || cls || "Class", subject: parts[1] || "" };
          };

          return (
            <div className="ra-enter" style={{ display: "flex", flexDirection: "column" }}>

              {/* Listener error banner */}
              {listenerError && (
                <div
                  role="alert"
                  style={{
                    background: "linear-gradient(135deg, #FFF1F1 0%, #FFE3E3 100%)",
                    border: "0.5px solid rgba(255,51,85,.25)",
                    borderRadius: 14, padding: "10px 14px", marginBottom: 12,
                    display: "flex", alignItems: "center", gap: 10,
                    boxShadow: "0 4px 12px rgba(255,51,85,.10)",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF3355" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px" }}>Live updates disrupted</div>
                    <div style={{ fontSize: 10, color: "#5070B0", fontWeight: 500, marginTop: 2 }}>{listenerError}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setListenerError(null); setLoading(true); setRefreshKey(k => k + 1); }}
                    style={{
                      padding: "6px 12px", borderRadius: 10,
                      background: "#FF3355", color: "#fff",
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                      border: "none", cursor: "pointer", flexShrink: 0,
                      boxShadow: "0 4px 10px rgba(255,51,85,.28)",
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Page Header */}
              <div style={{ padding: "8px 2px 14px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
                  <span className={criticalCount > 0 ? "ra-pulse" : ""} style={{ width: 5, height: 5, borderRadius: 2, background: "#FF3355", display: "inline-block", boxShadow: "0 0 8px rgba(255,51,85,.5)" }} />
                  Teacher Dashboard · Alerts
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 700, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>Risks &amp; Alerts</h1>
                <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, marginTop: 6, letterSpacing: "-0.15px" }}>
                  Monitor and respond to student concerns.
                </div>
              </div>

              {/* HERO — Dark red gradient */}
              <div
                className="ra-card3d"
                role="button"
                tabIndex={0}
                aria-label="View all alerts"
                onClick={() => { setActiveTab("All"); window.scrollTo({ top: 300, behavior: "smooth" }); }}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveTab("All"); window.scrollTo({ top: 300, behavior: "smooth" }); } }}
                style={{
                  background: "linear-gradient(135deg, #1A0614 0%, #3D0B1E 35%, #8A1530 72%, #FF3355 100%)",
                  borderRadius: 26, padding: 22, marginBottom: 14,
                  position: "relative", overflow: "hidden",
                  boxShadow: "0 1px 2px rgba(138,21,48,.2), 0 12px 32px rgba(138,21,48,.3)",
                }}
              >
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)", pointerEvents: "none" }} />
                <div style={{ position: "relative", zIndex: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 13, background: "rgba(255,255,255,.16)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.24)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 21h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.8)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Critical Alerts</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 2, fontWeight: 500, letterSpacing: "-0.1px" }}>Requires immediate action</div>
                    </div>
                    <div style={{ marginLeft: "auto", background: "rgba(255,255,255,.18)", border: "0.5px solid rgba(255,255,255,.28)", color: "#fff", padding: "5px 12px", borderRadius: 100, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.3px" }}>
                      <span className="ra-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px #fff" }} />
                      Live
                    </div>
                  </div>
                  <div style={{ fontSize: 60, fontWeight: 700, color: "#fff", letterSpacing: "-2.8px", lineHeight: 1, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
                    {criticalCount}
                    <span style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,.7)", letterSpacing: "-0.4px" }}>active</span>
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,.78)", marginBottom: 20, fontWeight: 500, letterSpacing: "-0.15px" }}>
                    {criticalCount === 0 ? (
                      <><b style={{ color: "#fff", fontWeight: 700 }}>All clear</b> — no critical alerts right now.</>
                    ) : (
                      <><b style={{ color: "#fff", fontWeight: 700 }}>{criticalCount} student{criticalCount === 1 ? "" : "s"}</b> need your outreach — flagged critical.</>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden" }}>
                    <div style={{ background: "rgba(40,6,16,.7)", padding: "12px 4px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>{gradesCount}</div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Grades</div>
                    </div>
                    <div style={{ background: "rgba(40,6,16,.7)", padding: "12px 4px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#FFD060", letterSpacing: "-0.5px" }}>{attCount}</div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Attend.</div>
                    </div>
                    <div style={{ background: "rgba(40,6,16,.7)", padding: "12px 4px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#6FFFAA", letterSpacing: "-0.5px" }}>{resolvedCount}</div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Resolved</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats 2x2 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { key: "Critical", label: "Critical", count: criticalCount, color: "#FF3355",
                    tintBg: "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)", tintBorder: "rgba(255,51,85,0.14)",
                    iconStroke: (<><path d="M12 2L2 21h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></>),
                    sub: count => count > 0
                      ? <span style={{ color: "#FF3355", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><span className="ra-pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF3355" }} />Act now</span>
                      : <span style={{ color: "#5070B0", fontWeight: 600 }}>All clear</span>,
                    onClick: () => { setActiveTab("All"); window.scrollTo({ top: 300, behavior: "smooth" }); } },
                  { key: "High Priority", label: "High Priority", count: highCount, color: "#FF8800",
                    tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)", tintBorder: "rgba(255,136,0,0.14)",
                    iconStroke: (<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></>),
                    sub: count => count > 0
                      ? <span style={{ color: "#FF8800", fontWeight: 700 }}>Priority</span>
                      : <span style={{ color: "#5070B0", fontWeight: 600 }}>All clear</span>,
                    onClick: () => setActiveTab("All") },
                  { key: "Medium", label: "Medium", count: mediumCount, color: "#0055FF",
                    tintBg: "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)", tintBorder: "rgba(0,85,255,0.10)",
                    iconStroke: (<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>),
                    sub: count => count > 0
                      ? <span style={{ color: "#0055FF", fontWeight: 700 }}>Watching</span>
                      : <span style={{ color: "#5070B0", fontWeight: 600 }}>Low risk</span>,
                    onClick: () => setActiveTab("All") },
                  { key: "Resolved", label: "Resolved This Week", count: resolvedCount, color: "#00C853",
                    tintBg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)", tintBorder: "rgba(0,200,83,0.16)",
                    iconStroke: (<><polyline points="20 6 9 17 4 12"/></>),
                    sub: count => count > 0
                      ? <span style={{ color: "#00C853", fontWeight: 700 }}>{count} closed</span>
                      : <span style={{ color: "#5070B0", fontWeight: 600 }}>None yet</span>,
                    onClick: () => navigate("/reports") },
                ].map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={s.onClick}
                    className="ra-card3d"
                    style={{
                      background: s.tintBg, borderRadius: 20, padding: 14,
                      display: "flex", flexDirection: "column",
                      position: "relative", overflow: "hidden",
                      border: `0.5px solid ${s.tintBorder}`,
                      boxShadow: "0 6px 18px rgba(20,40,90,0.05), 0 1px 3px rgba(20,40,90,0.04)",
                      textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    <div style={{ position: "absolute", right: 10, bottom: 8, color: s.color, opacity: 0.22, pointerEvents: "none" }}>
                      <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        {s.iconStroke}
                      </svg>
                    </div>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: `${s.color}1F`, color: s.color, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10, position: "relative", zIndex: 1 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        {s.iconStroke}
                      </svg>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: s.color, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6, position: "relative", zIndex: 1 }}>{s.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-1.2px", lineHeight: 1, color: "#001040", position: "relative", zIndex: 1 }}>{s.count}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, letterSpacing: "-0.15px", position: "relative", zIndex: 1 }}>{s.sub(s.count)}</div>
                  </button>
                ))}
              </div>

              {/* Filter Tabs — horizontally scrollable on mobile to fit all 5 */}
              <div
                className="ra-card3d"
                style={{
                  display: "flex", gap: 6, background: "#fff",
                  padding: 5, borderRadius: 14, marginBottom: 12,
                  boxShadow: "0 0.5px 1px rgba(9,87,247,.04), 0 2px 10px rgba(9,87,247,.06)",
                  overflowX: "auto", WebkitOverflowScrolling: "touch",
                  scrollbarWidth: "none",
                }}
              >
                {FILTER_TABS.map(tab => {
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      aria-pressed={active}
                      className="ra-press"
                      style={{
                        flexShrink: 0, padding: "9px 12px", borderRadius: 10,
                        background: active ? "#0055FF" : "transparent",
                        color: active ? "#fff" : "#5070B0",
                        fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                        border: "none", cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                        transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                        boxShadow: active ? "0 1px 2px rgba(9,87,247,.2), 0 3px 10px rgba(9,87,247,.25)" : "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tab.label}
                      <span style={{
                        background: active ? "rgba(255,255,255,.22)" : "#F4F7FE",
                        color: active ? "#fff" : "#5070B0",
                        fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 100,
                      }}>{tab.count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Alerts list */}
              {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="ra-skeleton" style={{
                      background: "#fff", borderRadius: 20, padding: 14, position: "relative", overflow: "hidden",
                      boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.10)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
                        <div style={{ width: 42, height: 42, borderRadius: 13, background: "#E4ECFF" }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ width: "55%", height: 12, borderRadius: 6, background: "#E4ECFF", marginBottom: 6 }} />
                          <div style={{ width: "30%", height: 9, borderRadius: 5, background: "#EEF4FF" }} />
                        </div>
                      </div>
                      <div style={{ height: 60, borderRadius: 12, background: "#F4F7FE", marginBottom: 12 }} />
                      <div style={{ display: "flex", gap: 7 }}>
                        <div style={{ flex: 1, height: 40, borderRadius: 12, background: "#E4ECFF" }} />
                        <div style={{ flex: 1, height: 40, borderRadius: 12, background: "#EEF4FF" }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <div className="ra-card3d" style={{
                  background: "#fff", borderRadius: 20, padding: "32px 20px", textAlign: "center",
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                }}>
                  <div style={{
                    width: 78, height: 78, borderRadius: 24,
                    background: "linear-gradient(145deg, rgba(0,232,102,.14) 0%, rgba(0,200,83,.08) 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 16px", color: "#00C853",
                    boxShadow: "0 0 0 8px rgba(0,200,83,.06), 0 0 0 16px rgba(0,200,83,.03), inset 0 1px 0 rgba(255,255,255,.6)",
                  }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#001040", marginBottom: 6, letterSpacing: "-0.4px" }}>
                    {activeTab === "All" ? "All students on track" : activeTab === "Attendance" ? "No attendance concerns" : "No grade concerns"}
                  </div>
                  <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5 }}>
                    {activeTab === "All"
                      ? <>No alerts in any category. <b style={{ color: "#00C853", fontWeight: 700 }}>Keep up the great work!</b></>
                      : activeTab === "Attendance"
                      ? "All students have good attendance records this week."
                      : "All students are performing within acceptable grade ranges."}
                  </div>
                </div>
              ) : Array.from(groupedByClass.entries()).flatMap(([clsLabel, classAlerts]) => {
                const sectionHeader = (
                  <div
                    key={`hdr_${clsLabel}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "10px 4px 6px", marginTop: 4,
                    }}
                  >
                    <div style={{ width: 4, height: 14, borderRadius: 2, background: "#0055FF", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#001040", letterSpacing: "1.4px", textTransform: "uppercase" }}>
                      {clsLabel}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#0055FF", background: "rgba(0,85,255,.08)", padding: "2px 8px", borderRadius: 999 }}>
                      {classAlerts.length}
                    </span>
                    <div style={{ flex: 1, height: 1, background: "rgba(0,85,255,.08)" }} />
                  </div>
                );
                const cards = classAlerts.map(a => {
                const isAttendance = a.type === "Attendance";
                const accentColor = tabColorFor(a.type);
                const tagCls = tagClsFor(a.type);
                const avatarBgC = mobAvBg(a.name);
                const { className: clsName, subject } = mobParseCls(a.cls);
                const classChip = mobClassChipColor(clsName);
                const time = timeAgo(a);
                const primary = getPrimaryAction(a);
                const isSending = sending === a.id;
                const contactAction = {
                  label: primary.label,
                  color: isAttendance ? "#FF8800" : a.type === "Grades" ? "#FF3355" : accentColor,
                };

                return (
                  <div
                    key={a.id}
                    className="ra-card3d"
                    onClick={() => navigate(`/students?studentId=${a.studentId || ""}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/students?studentId=${a.studentId || ""}`); } }}
                    style={{
                      background: "#fff", borderRadius: 20, padding: 14, marginBottom: 10,
                      position: "relative", overflow: "hidden", cursor: "pointer",
                      boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                    }}
                  >
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accentColor }} />

                    {/* head */}
                    <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
                      <div style={{
                        width: 42, height: 42, borderRadius: 13,
                        background: avatarBgC, color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 700, letterSpacing: "0.3px", flexShrink: 0, position: "relative",
                      }}>
                        {getInitials(a.name)}
                        <div style={{
                          position: "absolute", bottom: -4, right: -4,
                          width: 18, height: 18, borderRadius: "50%",
                          background: accentColor, border: "2.5px solid #fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff",
                          boxShadow: `0 2px 5px ${accentColor}66`,
                        }}>
                          {isAttendance ? (
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                            </svg>
                          ) : (
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/>
                            </svg>
                          )}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px", lineHeight: 1.2 }}>{a.name}</div>
                          <div style={{
                            background: accentColor, color: "#fff",
                            fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 100,
                            letterSpacing: "0.4px", textTransform: "uppercase",
                            display: "flex", alignItems: "center", gap: 4,
                            boxShadow: `0 1px 2px ${accentColor}33, 0 2px 6px ${accentColor}40`,
                          }}>
                            <span className="ra-pulse" style={{ width: 4, height: 4, borderRadius: "50%", background: "#fff" }} />
                            {a.severity}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "#5070B0", marginTop: 3, fontWeight: 500, letterSpacing: "-0.1px", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          <span style={{ background: classChip.bg, color: classChip.color, padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 700 }}>{clsName}</span>
                          {subject && <><span style={{ color: "#99AACC" }}>·</span><span>{subject}</span></>}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#99AACC", letterSpacing: "-0.1px", flexShrink: 0 }}>{time}</div>
                    </div>

                    {/* body */}
                    <div style={{
                      background: isAttendance ? "rgba(255,136,0,.04)" : "rgba(255,51,85,.04)",
                      border: `0.5px solid ${isAttendance ? "rgba(255,136,0,.18)" : "rgba(255,51,85,.15)"}`,
                      borderRadius: 13, padding: 12, marginBottom: 12, position: "relative",
                    }}>
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "3px 8px", borderRadius: 6,
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase",
                        marginBottom: 8,
                        background: tagCls === "attendance" ? "rgba(255,136,0,.12)" : "rgba(255,51,85,.12)",
                        color: accentColor,
                      }}>
                        {isAttendance ? (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                          </svg>
                        ) : (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                          </svg>
                        )}
                        {a.type === "Attendance" ? "Attendance Alert" : a.type === "Grades" ? "Grade Alert" : `${a.type} Alert`}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.25px", lineHeight: 1.4, marginBottom: 8 }}>
                        {a.issue.split(/(\b\d+%|\b\d+\b)/g).map((part, i) =>
                          /^\d+%?$/.test(part) && part !== "0" && part !== ""
                            ? <b key={i} style={{ color: accentColor, fontWeight: 700 }}>{part}</b>
                            : <span key={i}>{part}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {a.details.slice(0, 3).map((d, i) => {
                          const [k, v] = d.split(":").map(s => s.trim());
                          const hasKV = v !== undefined;
                          const isTrend = /trend/i.test(k || "");
                          const isAbsence = /absence/i.test(k || "");
                          const chipStyle = isTrend
                            ? { bg: "rgba(9,87,247,.06)", bdr: "rgba(9,87,247,.15)", vColor: "#0055FF" }
                            : isAbsence
                            ? { bg: "rgba(255,51,85,.08)", bdr: "rgba(255,51,85,.2)", vColor: "#FF3355" }
                            : { bg: "#fff", bdr: "rgba(9,87,247,.08)", vColor: "#001040" };
                          return (
                            <div key={i} style={{
                              background: chipStyle.bg,
                              padding: "4px 9px", borderRadius: 100,
                              fontSize: 10, fontWeight: 700, color: "#5070B0",
                              letterSpacing: "-0.1px", display: "flex", alignItems: "center", gap: 4,
                              border: `0.5px solid ${chipStyle.bdr}`,
                            }}>
                              {hasKV ? (
                                <>
                                  <span style={{ color: "#99AACC", fontWeight: 600 }}>{k}</span>
                                  <span style={{ color: chipStyle.vColor, fontWeight: 700 }}>{v}</span>
                                </>
                              ) : d}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* actions */}
                    <div style={{ display: "flex", gap: 7 }}>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); primary.handler(); }}
                        disabled={isSending}
                        className="ra-press"
                        style={{
                          flex: 1, height: 40, borderRadius: 12,
                          background: contactAction.color, color: "#fff",
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                          border: "none", cursor: isSending ? "wait" : "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                          boxShadow: `0 1px 2px ${contactAction.color}40, 0 4px 12px ${contactAction.color}4D`,
                          opacity: isSending ? 0.7 : 1,
                        }}
                      >
                        {isSending ? (
                          <><Loader2 className="w-3 h-3 animate-spin" />Sending…</>
                        ) : primary.auto ? (
                          <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                            </svg>
                            {contactAction.label}
                          </>
                        ) : (
                          <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                            </svg>
                            {contactAction.label}
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); handleResolve(a); }}
                        disabled={resolving === a.id}
                        className="ra-press"
                        style={{
                          flex: 1, height: 40, borderRadius: 12,
                          background: "rgba(0,200,83,.1)", color: "#00C853",
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                          border: "0.5px solid rgba(0,200,83,.22)",
                          cursor: resolving === a.id ? "wait" : "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                          opacity: resolving === a.id ? 0.7 : 1,
                        }}
                      >
                        {resolving === a.id ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Resolving…</>
                        ) : (
                          <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Resolve
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
                });
                return [sectionHeader, ...cards];
              })}

              {/* AI Risk Intelligence */}
              {!loading && alerts.length > 0 && (() => {
                // Find student appearing in multiple alerts
                const nameCount = new Map<string, number>();
                alerts.forEach(a => nameCount.set(a.name, (nameCount.get(a.name) || 0) + 1));
                const multi = Array.from(nameCount.entries()).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])[0];
                const attAlert = alerts.find(a => a.type === "Attendance");
                return (
                  <div
                    className="ra-card3d"
                    role="button"
                    tabIndex={0}
                    aria-label="Open detailed risk report"
                    onClick={() => navigate('/reports')}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
                    style={{
                      background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
                      borderRadius: 24, padding: 20, marginTop: 14,
                      position: "relative", overflow: "hidden",
                      boxShadow: "0 1px 2px rgba(0,8,60,.18), 0 12px 32px rgba(0,8,60,.3)",
                    }}
                  >
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)", pointerEvents: "none" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12, position: "relative", zIndex: 2 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 13, background: "rgba(255,255,255,.14)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFDD55", fontSize: 19 }}>⚡</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.95)", letterSpacing: "1.8px", textTransform: "uppercase" }}>AI Risk Intelligence</div>
                      <div style={{ marginLeft: "auto", background: "rgba(255,51,85,.25)", border: "0.5px solid rgba(255,51,85,.5)", color: "#FFB5BF", padding: "4px 10px", borderRadius: 100, fontSize: 9, fontWeight: 700, letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: 5 }}>
                        <span className="ra-pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF9AA9" }} />
                        {criticalCount > 0 ? "Critical" : "Insight"}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,.85)", letterSpacing: "-0.15px", marginBottom: 14, position: "relative", zIndex: 2 }}>
                      {multi ? (
                        <><strong style={{ color: "#fff", fontWeight: 700 }}>{multi[0]}</strong> appears in <strong style={{ color: "#fff", fontWeight: 700 }}>{multi[1]} alerts</strong> — consolidate outreach with one parent call covering all classes. </>
                      ) : (
                        <>You have <strong style={{ color: "#fff", fontWeight: 700 }}>{alerts.length}</strong> active alert{alerts.length === 1 ? "" : "s"}. </>
                      )}
                      {attAlert ? (
                        <><strong style={{ color: "#fff", fontWeight: 700 }}>{attAlert.name}</strong>'s attendance is the highest risk — act today.</>
                      ) : criticalCount > 0 ? (
                        <>Prioritise <strong style={{ color: "#fff", fontWeight: 700 }}>{criticalCount} critical</strong> case{criticalCount === 1 ? "" : "s"} first.</>
                      ) : (
                        <>Keep monitoring — no critical cases right now.</>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", background: "rgba(255,255,255,.1)", borderRadius: 12, padding: 1, gap: 1, overflow: "hidden", position: "relative", zIndex: 2 }}>
                      <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#FF9AA9", letterSpacing: "-0.4px" }}>{criticalCount}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Critical</div>
                      </div>
                      <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#FFD060", letterSpacing: "-0.4px" }}>{attCount}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Attend.</div>
                      </div>
                      <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", letterSpacing: "-0.4px" }}>{gradesCount}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Grade</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          );
        })()}


      {/* ── Mobile bottom tab bar ────────────────────────────────────────────── */}
      <div
        className="md:hidden"
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: T.white, borderTop: `1px solid ${T.bdr}`,
          padding: "9px 24px 17px",
          display: "flex", justifyContent: "space-around",
          zIndex: 40,
        }}
      >
        {([
          { label: "Dashboard", type: "grid",     active: false, path: "/dashboard" },
          { label: "Students",  type: "students", active: false, path: "/students" },
          { label: "Alerts",    type: "alert",    active: true,  path: "/risks-alerts" },
          { label: "Profile",   type: "user",     active: false, path: "/settings" },
        ] as const).map(ti => (
          <div
            key={ti.label}
            onClick={() => navigate(ti.path)}
            role="button"
            tabIndex={0}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer" }}
          >
            <TabIcon type={ti.type} active={ti.active} />
            <span style={{ fontSize: 9, color: ti.active ? T.red : T.ink3, fontWeight: ti.active ? 500 : 400 }}>{ti.label}</span>
            {ti.active && <div style={{ width: 13, height: 2.5, borderRadius: 2, background: T.red }} />}
          </div>
        ))}
      </div>

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Blue Apple DNA ═══════════════════ */}
      <div
        className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 -mt-4 sm:-mt-6 md:-mt-8 px-8 pt-6 pb-10"
        style={{
          background: '#EEF4FF',
          minHeight: '100vh',
          fontFamily: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <style>{`
          .rad-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
          @media (hover:hover) {
            .rad-card3d:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); }
          }
          .rad-card3d:active { transform: translateY(-1px) scale(.99); }
          .rad-tile { transition: all 0.3s ease; cursor: pointer; will-change: transform, box-shadow; }
          @media (hover:hover) {
            .rad-tile:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 .5px rgba(255,255,255,.2), 0 18px 44px rgba(0,85,255,.32), 0 6px 16px rgba(0,85,255,.22); }
          }
          .rad-tile:active { transform: translateY(-1px) scale(.99); }
          .rad-btn { transition: all 0.3s ease; }
          .rad-btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
          .rad-btn:active { transform: scale(.96); }
          .rad-row { transition: all 0.3s ease; cursor: pointer; }
          .rad-row:hover { transform: translateX(3px); }
          .rad-chip { transition: all 0.3s ease; }
          .rad-chip:hover { transform: translateY(-1px); }
          @keyframes radFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
          .rad-enter > * { animation: radFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
          .rad-enter > *:nth-child(1) { animation-delay: .04s; }
          .rad-enter > *:nth-child(2) { animation-delay: .10s; }
          .rad-enter > *:nth-child(3) { animation-delay: .16s; }
          .rad-enter > *:nth-child(4) { animation-delay: .22s; }
          .rad-enter > *:nth-child(5) { animation-delay: .28s; }
          .rad-enter > *:nth-child(6) { animation-delay: .34s; }
          @keyframes radPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(1.25); } }
          .rad-pulse-d { animation: radPulse 1.6s ease-in-out infinite; }
        `}</style>

        <div className="rad-enter max-w-[1600px] mx-auto">

          {/* Listener error banner */}
          {listenerError && (
            <div
              role="alert"
              style={{
                background: "linear-gradient(135deg, #FFF1F1 0%, #FFE3E3 100%)",
                border: "0.5px solid rgba(255,51,85,.25)",
                borderRadius: 16, padding: "14px 18px", marginBottom: 18,
                display: "flex", alignItems: "center", gap: 14,
                boxShadow: "0 6px 18px rgba(255,51,85,.10)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF3355" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px" }}>Live updates disrupted</div>
                <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, marginTop: 2 }}>{listenerError}</div>
              </div>
              <button
                type="button"
                onClick={() => { setListenerError(null); setLoading(true); setRefreshKey(k => k + 1); }}
                className="rad-btn"
                style={{
                  padding: "9px 16px", borderRadius: 12,
                  background: "linear-gradient(135deg,#FF3355 0%,#FF6677 100%)", color: "#fff",
                  fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  border: "none", cursor: "pointer", flexShrink: 0,
                  boxShadow: "0 6px 16px rgba(255,51,85,.30)",
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* ═══ Page Head ═══ */}
          <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className={criticalCount > 0 ? 'rad-pulse-d' : ''}
                  style={{
                    width: 6, height: 6, borderRadius: 2,
                    background: criticalCount > 0 ? '#FF3355' : '#0055FF',
                    display: 'inline-block',
                    boxShadow: criticalCount > 0 ? '0 0 10px rgba(255,51,85,.5)' : 'none',
                  }}
                />
                Teacher Dashboard · {hc.eyebrow}
              </div>
              <h1 style={{ fontSize: 34, fontWeight: 700, color: '#001040', letterSpacing: '-1.2px', lineHeight: 1.05, margin: 0 }}>
                {hc.line1} <span style={{ color: criticalCount > 0 ? '#FF3355' : '#0055FF' }}>{hc.line2}</span>
              </h1>
              <div style={{ fontSize: 13, color: '#5070B0', fontWeight: 500, marginTop: 6, letterSpacing: '-0.15px' }}>
                {hc.sub}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {criticalCount > 0 && (
                <div
                  className="rad-chip"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '10px 16px', borderRadius: 14,
                    background: 'linear-gradient(135deg,#FF3355 0%,#FF6677 100%)',
                    color: '#fff',
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    boxShadow: '0 6px 20px rgba(255,51,85,.35), 0 2px 5px rgba(255,51,85,.2)',
                  }}
                >
                  <span className="rad-pulse-d" style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }}/>
                  {criticalCount} Critical{criticalCount > 1 ? ' Alerts' : ' Alert'}
                </div>
              )}
              <button
                type="button"
                onClick={() => navigate('/students')}
                className="rad-btn"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  height: 42, padding: '0 18px', borderRadius: 14,
                  background: '#fff', color: '#0055FF',
                  border: '0.5px solid rgba(0,85,255,.12)',
                  fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 14px rgba(0,85,255,.08)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                View Students
              </button>
            </div>
          </div>

          {/* Dark Hero Banner */}
          {(() => {
            const statusColor = criticalCount > 0 ? '#FF99AA' : totalCount > 0 ? '#FFD088' : '#6FFFAA';
            const statusLabel = criticalCount > 0 ? 'URGENT ACTION' : totalCount > 0 ? 'MONITORING' : 'ALL CLEAR';
            return (
              <div
                className="rad-card3d"
                role="button"
                tabIndex={0}
                aria-label="View all alerts"
                onClick={() => setActiveTab('All')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('All'); } }}
                style={{
                  background: 'linear-gradient(135deg,#000A33 0%,#001A66 32%,#0044CC 68%,#0055FF 100%)',
                  borderRadius: 24, padding: '28px 32px', color: '#fff',
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)',
                  marginBottom: 22,
                }}
              >
                <div style={{ position: 'absolute', top: -60, right: -40, width: 320, height: 320, background: `radial-gradient(circle, ${criticalCount > 0 ? 'rgba(255,51,85,.22)' : 'rgba(255,255,255,.12)'} 0%, transparent 65%)`, borderRadius: '50%', pointerEvents: 'none' }}/>
                <div style={{ position: 'absolute', bottom: -80, left: -60, width: 260, height: 260, background: 'radial-gradient(circle, rgba(111,255,170,.14) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 1, minWidth: 320 }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: 16,
                      background: 'rgba(255,255,255,.16)', border: '0.5px solid rgba(255,255,255,.26)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
                    }}>
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, color: statusColor }}>
                        {statusLabel}
                      </div>
                      <h2 style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-1px', margin: 0, color: '#fff', lineHeight: 1 }}>
                        {criticalCount}
                      </h2>
                      <p style={{ fontSize: 13, color: 'rgba(255,255,255,.78)', fontWeight: 500, margin: '8px 0 0 0', lineHeight: 1.55 }}>
                        {criticalCount === 0 ? (
                          <>All students on track — <b style={{ color: '#fff', fontWeight: 700 }}>{totalCount} alert{totalCount === 1 ? '' : 's'}</b> still open across non-critical severity.</>
                        ) : (
                          <><b style={{ color: '#fff', fontWeight: 700 }}>{criticalCount} student{criticalCount === 1 ? '' : 's'}</b> need your outreach immediately — flagged critical. Resolved {resolvedCount} already this week.</>
                        )}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px,1fr))', gap: 10 }}>
                    {[
                      { label: 'Attendance', value: attCount.toString(), color: '#FFD088' },
                      { label: 'Grades',     value: gradesCount.toString(), color: '#FF99AA' },
                      { label: 'Resolved',   value: resolvedCount.toString(), color: '#6FFFAA' },
                    ].map(s => (
                      <div key={s.label} style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '12px 16px', border: '0.5px solid rgba(255,255,255,.14)' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0, letterSpacing: '-0.5px' }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Matte 4-col KPI Tiles */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              {
                label: 'Critical', value: criticalCount.toString(),
                sub: criticalCount > 0 ? 'Needs outreach now' : 'No critical alerts',
                color: '#FF3355',
                tintBg: 'linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)',
                tintBorder: 'rgba(255,51,85,0.14)',
                iconStroke: (<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>),
                onClick: () => setActiveTab('All'),
              },
              {
                label: 'High Priority', value: highCount.toString(),
                sub: highCount > 0 ? 'Follow up this week' : 'Stable',
                color: '#FF8800',
                tintBg: 'linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)',
                tintBorder: 'rgba(255,136,0,0.14)',
                iconStroke: (<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>),
                onClick: () => setActiveTab('All'),
              },
              {
                label: 'Medium Priority', value: mediumCount.toString(),
                sub: mediumCount > 0 ? 'Keep monitoring' : 'Class is steady',
                color: '#0055FF',
                tintBg: 'linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)',
                tintBorder: 'rgba(0,85,255,0.10)',
                iconStroke: (<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>),
                onClick: () => setActiveTab('All'),
              },
              {
                label: 'Resolved This Week', value: resolvedCount.toString(),
                sub: resolvedCount > 0 ? 'Great follow-through' : 'No resolutions yet',
                color: '#00C853',
                tintBg: 'linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)',
                tintBorder: 'rgba(0,200,83,0.16)',
                iconStroke: (<><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>),
                onClick: () => navigate('/gradebook'),
              },
            ].map(k => (
              <div
                key={k.label}
                onClick={k.onClick}
                role="button"
                tabIndex={0}
                className="rad-tile"
                style={{
                  background: k.tintBg, borderRadius: 22, padding: '22px 24px',
                  position: 'relative', overflow: 'hidden',
                  border: `0.5px solid ${k.tintBorder}`,
                  boxShadow: '0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04)',
                }}
              >
                <div style={{ position: 'absolute', right: 14, bottom: 12, color: k.color, opacity: 0.22, pointerEvents: 'none' }}>
                  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    {k.iconStroke}
                  </svg>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: `${k.color}1F`, color: k.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, position: 'relative', zIndex: 1 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    {k.iconStroke}
                  </svg>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: k.color, letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px 0', position: 'relative', zIndex: 1 }}>{k.label}</div>
                <div style={{ fontSize: 36, fontWeight: 700, color: '#001040', letterSpacing: '-1.6px', margin: 0, lineHeight: 1.05, position: 'relative', zIndex: 1 }}>{k.value}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#5070B0', margin: '8px 0 0 0', position: 'relative', zIndex: 1 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Filter Tabs as chips */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {FILTER_TABS.map(tab => {
              const active = activeTab === tab.id;
              const tabGrad = tab.id === 'Attendance'
                ? 'linear-gradient(135deg,#FF8800 0%,#FFAA44 100%)'
                : tab.id === 'Grades'
                ? 'linear-gradient(135deg,#FF3355 0%,#FF6677 100%)'
                : tab.id === 'Submissions'
                ? 'linear-gradient(135deg,#7B3FF4 0%,#9B5FFF 100%)'
                : tab.id === 'Behavior'
                ? 'linear-gradient(135deg,#C2255C 0%,#D6477A 100%)'
                : 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)';
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={active}
                  className="rad-chip"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '9px 16px', borderRadius: 999,
                    background: active ? tabGrad : '#fff',
                    color: active ? '#fff' : '#5070B0',
                    border: active ? 'none' : '0.5px solid rgba(0,85,255,.12)',
                    boxShadow: active ? '0 6px 18px rgba(0,16,64,.22), 0 2px 5px rgba(0,0,0,.06)' : '0 1px 2px rgba(0,85,255,.06)',
                    fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {tab.label}
                  <span style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                    background: active ? 'rgba(255,255,255,.28)' : 'rgba(0,85,255,.08)',
                    color: active ? '#fff' : '#0055FF',
                  }}>{tab.count}</span>
                </button>
              );
            })}
          </div>

          {/* Alerts List card */}
          <div
            style={{
              background: '#fff', borderRadius: 22,
              border: '0.5px solid rgba(0,85,255,.08)',
              boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 16px rgba(0,85,255,.08), 0 18px 44px rgba(0,85,255,.10)',
              overflow: 'hidden', marginBottom: 22,
            }}
          >
            <div style={{ padding: '16px 22px', borderBottom: '0.5px solid rgba(0,85,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(0,85,255,.28)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h16M4 12h16M4 18h16"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px' }}>
                    {activeTab === 'All' ? 'All Active Alerts' : activeTab === 'Attendance' ? 'Attendance Alerts' : 'Grade Alerts'}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#99AACC', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
                    {visible.length} shown · prioritised by severity
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="ra-skeleton" style={{
                      background: '#F8FAFE', borderRadius: 16,
                      padding: '14px 16px 14px 20px', display: 'flex', alignItems: 'center', gap: 14,
                      border: '0.5px solid rgba(0,85,255,.06)',
                    }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#E4ECFF', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ width: '50%', height: 12, borderRadius: 6, background: '#E4ECFF', marginBottom: 8 }} />
                        <div style={{ width: '85%', height: 10, borderRadius: 5, background: '#EEF4FF' }} />
                      </div>
                      <div style={{ width: 110, height: 32, borderRadius: 11, background: '#E4ECFF' }} />
                      <div style={{ width: 90, height: 32, borderRadius: 11, background: '#EEF4FF' }} />
                    </div>
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg,#00C853 0%,#33DD77 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 24px rgba(0,200,83,.28)' }}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px', margin: 0 }}>
                      {activeTab === 'All' ? 'All students on track' : activeTab === 'Attendance' ? 'No attendance concerns' : activeTab === 'Grades' ? 'No grade concerns' : activeTab === 'Submissions' ? 'No overdue submissions' : 'No behaviour concerns'}
                    </p>
                    <p style={{ fontSize: 13, fontWeight: 500, color: '#5070B0', margin: '6px 0 0 0' }}>
                      Keep it up — no active alerts in this filter.
                    </p>
                  </div>
                </div>
              ) : (
                Array.from(groupedByClass.entries()).flatMap(([clsLabel, classAlerts]) => {
                  const header = (
                    <div
                      key={`hdr_${clsLabel}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '6px 4px 4px',
                      }}
                    >
                      <div style={{ width: 4, height: 18, borderRadius: 2, background: 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#001040', letterSpacing: '1.4px', textTransform: 'uppercase' }}>
                        {clsLabel}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#0055FF', background: 'rgba(0,85,255,.08)', padding: '3px 9px', borderRadius: 999, letterSpacing: '0.04em' }}>
                        {classAlerts.length} alert{classAlerts.length === 1 ? '' : 's'}
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'rgba(0,85,255,.08)' }} />
                    </div>
                  );
                  const cards = classAlerts.map(a => {
                  const sevColor = a.severity === 'Critical' ? '#FF3355' : a.severity === 'High Priority' ? '#FF8800' : '#0055FF';
                  const sevGrad = a.severity === 'Critical'
                    ? 'linear-gradient(135deg,#FF3355 0%,#FF6677 100%)'
                    : a.severity === 'High Priority'
                    ? 'linear-gradient(135deg,#FF8800 0%,#FFAA44 100%)'
                    : 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)';
                  const sevBg = a.severity === 'Critical'
                    ? 'rgba(255,51,85,.05)'
                    : a.severity === 'High Priority'
                    ? 'rgba(255,136,0,.05)'
                    : 'rgba(0,85,255,.035)';
                  const primary = getPrimaryAction(a);
                  const isSending = sending === a.id;
                  return (
                    <div
                      key={a.id}
                      className="rad-row rad-card3d"
                      role="button"
                      tabIndex={0}
                      aria-label={`View ${a.name}`}
                      onClick={() => navigate(`/students?studentId=${a.studentId || ''}`)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/students?studentId=${a.studentId || ''}`); } }}
                      style={{
                        background: sevBg, borderRadius: 16,
                        border: `0.5px solid ${sevColor}33`,
                        padding: '14px 16px 14px 20px',
                        display: 'flex', alignItems: 'flex-start', gap: 14,
                        position: 'relative', overflow: 'hidden',
                      }}
                    >
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: sevGrad }}/>

                      <div style={{
                        width: 44, height: 44, borderRadius: '50%',
                        background: avBg(a.name), color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, flexShrink: 0,
                        boxShadow: `0 4px 12px ${avBg(a.name)}55`,
                      }}>
                        {a.initials || getInitials(a.name)}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <p style={{ fontSize: 14, fontWeight: 700, color: '#001040', letterSpacing: '-0.2px', margin: 0 }}>{a.name}</p>
                          <span
                            style={{
                              fontSize: 9, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                              background: sevGrad, color: '#fff',
                              letterSpacing: '0.1em', textTransform: 'uppercase',
                              boxShadow: `0 3px 8px ${sevColor}40`,
                            }}
                          >
                            {a.severity}
                          </span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                            background: 'rgba(0,85,255,.08)', color: '#0055FF',
                            letterSpacing: '0.04em',
                          }}>
                            {a.cls}
                          </span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                            background: 'rgba(80,112,176,.08)', color: '#5070B0',
                            letterSpacing: '0.04em',
                          }}>
                            {a.type}
                          </span>
                        </div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#001040', margin: '4px 0 0 0', lineHeight: 1.5 }}>{a.issue}</p>
                        {a.details.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                            {a.details.map((d, i) => (
                              <span
                                key={i}
                                style={{
                                  fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
                                  background: '#fff', color: '#5070B0',
                                  border: '0.5px solid rgba(0,85,255,.08)',
                                }}
                              >
                                {d}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, alignSelf: 'center' }}>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); primary.handler(); }}
                          disabled={isSending}
                          className="rad-btn"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '9px 14px', borderRadius: 11,
                            background: sevGrad, color: '#fff',
                            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                            border: 'none', cursor: isSending ? 'wait' : 'pointer', fontFamily: 'inherit',
                            boxShadow: `0 6px 18px ${sevColor}45, 0 2px 5px ${sevColor}22`,
                            opacity: isSending ? 0.7 : 1,
                          }}
                        >
                          {isSending ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Sending</>
                          ) : (
                            primary.label
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); handleResolve(a); }}
                          disabled={resolving === a.id}
                          className="rad-btn"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '9px 14px', borderRadius: 11,
                            background: '#fff', color: '#087F5B',
                            border: '0.5px solid rgba(0,200,83,.28)',
                            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                            cursor: resolving === a.id ? 'not-allowed' : 'pointer',
                            opacity: resolving === a.id ? 0.6 : 1,
                            fontFamily: 'inherit',
                            boxShadow: '0 1px 2px rgba(0,200,83,.08)',
                          }}
                        >
                          {resolving === a.id ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Resolving
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                              Resolved
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                  });
                  return [header, ...cards];
                })
              )}
            </div>
          </div>

          {/* AI Intelligence card */}
          {totalCount > 0 && (() => {
            const mostFlagged = [...visible].reduce((acc, a) => { acc[a.name] = (acc[a.name] || 0) + 1; return acc; }, {} as Record<string, number>);
            const topNames = Object.entries(mostFlagged).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
            const leadLine = criticalCount > 0
              ? `${criticalCount} critical alert${criticalCount!==1?'s':''} need immediate outreach — ${topNames.length > 0 ? `prioritise ${topNames.join(' and ')}` : 'contact parents today'}.`
              : `${totalCount} alert${totalCount!==1?'s':''} open — ${highCount} high-priority item${highCount!==1?'s':''} to follow up this week.`;
            return (
              <div
                className="rad-card3d"
                role="button"
                tabIndex={0}
                aria-label="Open detailed risk report"
                onClick={() => navigate('/reports')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
                style={{
                  background: 'linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)',
                  borderRadius: 22, padding: '24px 28px', color: '#fff',
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)',
                }}
              >
                <div style={{ position: 'absolute', bottom: -50, left: -40, width: 280, height: 280, background: 'radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                <div style={{ position: 'absolute', top: -30, right: -20, width: 200, height: 200, background: `radial-gradient(circle, ${criticalCount > 0 ? 'rgba(255,51,85,.22)' : 'rgba(255,255,255,.12)'} 0%, transparent 70%)`, borderRadius: '50%', pointerEvents: 'none' }}/>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative', zIndex: 1, marginBottom: 18 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: 'rgba(255,255,255,.18)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                      AI Risk Intelligence
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', marginBottom: 6 }}>
                      Risk Summary &amp; Outreach Plan
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.82)', lineHeight: 1.55 }}>
                      {leadLine}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, position: 'relative', zIndex: 1 }}>
                  {[
                    { label: 'Outreach Queue', value: criticalCount.toString(), sub: criticalCount > 0 ? 'Critical · today' : 'All clear', color: criticalCount > 0 ? '#FF99AA' : '#6FFFAA' },
                    { label: 'Attendance',     value: attCount.toString(),     sub: attCount > 0 ? 'Send reminders' : 'On track', color: attCount > 0 ? '#FFD088' : '#6FFFAA' },
                    { label: 'Grade Gaps',     value: gradesCount.toString(),  sub: gradesCount > 0 ? 'Schedule meetings' : 'Healthy', color: gradesCount > 0 ? '#FF99AA' : '#C8A4FF' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(255,255,255,.14)' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: s.color, letterSpacing: '-0.5px', lineHeight: 1 }}>{s.value}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)', margin: '6px 0 0 0' }}>{s.sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 1 }}>
                  <div style={{ flex: 1, height: 10, borderRadius: 999, background: 'rgba(255,255,255,.12)', overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${(criticalCount / maxBar) * 100}%`, background: 'linear-gradient(90deg,#FF3355,#FF6677)', transition: 'width 1s cubic-bezier(.2,.9,.3,1)' }}/>
                    <div style={{ width: `${(highCount / maxBar) * 100}%`, background: 'linear-gradient(90deg,#FF8800,#FFAA44)', transition: 'width 1s cubic-bezier(.2,.9,.3,1)' }}/>
                    <div style={{ width: `${(mediumCount / maxBar) * 100}%`, background: 'linear-gradient(90deg,#0055FF,#2277FF)', transition: 'width 1s cubic-bezier(.2,.9,.3,1)' }}/>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.7)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {totalCount} open
                  </div>
                </div>
              </div>
            );
          })()}

        </div>
      </div>{/* END DESKTOP VIEW */}

    </div>
  );
};

export default RisksAlerts;
