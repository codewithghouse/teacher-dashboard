import { useState, useEffect, useMemo } from "react";
import { db } from "../lib/firebase";
import {
  collection, query, onSnapshot, getDocs,
  doc, where, Timestamp, serverTimestamp,
  type QueryConstraint,
} from "firebase/firestore";
import { auditedUpdate } from "../lib/auditedWrites";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

const HALO_SH = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)";
const HALO_BDR = "0.5px solid rgba(0,85,255,0.07)";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Alert {
  id: string;
  studentId: string;
  name: string;
  initials: string;
  avatarColor: string;
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
const AV_HEX = ["#3B5BDB","#0ea5e9","#10b981","#f59e0b","#8b5cf6","#f43f5e","#06b6d4"];
const avBg = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_HEX[h % AV_HEX.length];
};
const getInitials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
};

// ── Legacy color kept for alert obj field compat ──────────────────────────────
const AVATAR_COLORS = ["bg-rose-500","bg-amber-500","bg-emerald-600","bg-blue-600","bg-violet-600","bg-indigo-600"];
const getAvatarColor = (name: string) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

// ── Severity style map ────────────────────────────────────────────────────────
const SEV: Record<string, { color: string; bg: string; bdr: string; pillBg: string; pillColor: string }> = {
  Critical:          { color: T.red,  bg: T.rlBg, bdr: T.rlBdr, pillBg: "rgba(201,42,42,0.1)",  pillColor: T.red  },
  "High Priority":   { color: T.amb,  bg: T.alBg, bdr: T.alBdr, pillBg: "rgba(200,112,20,0.1)", pillColor: T.amb  },
  "Medium Priority": { color: T.blue, bg: T.blBg, bdr: T.blBdr, pillBg: "rgba(59,91,219,0.1)",  pillColor: T.blue },
};

// ── getPct ────────────────────────────────────────────────────────────────────
const getPct = (sc: any): number => {
  if (sc.percentage != null) return Number(sc.percentage);
  if (sc.mark != null && sc.maxMarks) return sc.mark / sc.maxMarks * 100;
  if (sc.score != null && sc.maxScore) return sc.score / sc.maxScore * 100;
  if (sc.score != null) return Number(sc.score);
  return 0;
};

// ── Sub-components ────────────────────────────────────────────────────────────
const Chip = ({ icon, text }: { icon?: string; text: string }) => (
  <div style={{
    padding: "5px 10px", borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.06)",
    fontSize: 10, color: "rgba(255,255,255,0.6)",
    display: "inline-flex", alignItems: "center", gap: 4,
  }}>
    {icon === "check" && (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1.5,6.5 4,9 8.5,2" />
      </svg>
    )}
    {icon === "clock" && (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="5" r="3.5" /><polyline points="5,3 5,5.5 7,5.5" />
      </svg>
    )}
    {icon === "att" && (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1.5,8.5 6,7 3,4 7,2.5" />
      </svg>
    )}
    {icon === "grades" && (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1.5,7 4,5 6,6.5 8.5,3" />
      </svg>
    )}
    {text}
  </div>
);

interface MetricCardProps {
  label: string; value: number; badge: string;
  color: string; bg: string; bdr: string;
  fillW: number; icon: React.ReactNode;
}
const MetricCard = ({ label, value, badge, color, bg, bdr, fillW, icon }: MetricCardProps) => (
  <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 16, padding: 14 }}>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: `${color}1E`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </div>
      <span style={{ padding: "3px 8px", borderRadius: 20, background: `${color}1A`, color, fontSize: 10, fontWeight: 500 }}>
        {badge}
      </span>
    </div>
    <div style={{ fontSize: 22, fontWeight: 500, color, letterSpacing: "-0.5px", lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 11, color, opacity: 0.7, marginTop: 3 }}>{label}</div>
    <div style={{ height: 3, borderRadius: 2, background: "rgba(0,0,0,0.08)", marginTop: 10, overflow: "hidden" }}>
      <div style={{ height: "100%", borderRadius: 2, background: color, width: `${Math.min(fillW, 100)}%`, transition: "width 0.5s ease" }} />
    </div>
  </div>
);

const ThresholdCard = ({ title, sub, rows }: { title: string; sub: string; rows: { label: string; value: string; color: string }[] }) => (
  <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: "hidden" }}>
    <div style={{ padding: "11px 13px", borderBottom: `1px solid ${T.s2}` }}>
      <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, margin: 0 }}>{title}</p>
      <p style={{ fontSize: 10, color: T.ink3, marginTop: 2, marginBottom: 0 }}>{sub}</p>
    </div>
    {rows.map((row, i) => (
      <div key={i} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 13px",
        borderBottom: i < rows.length - 1 ? `1px solid ${T.s2}` : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: T.ink2 }}>{row.label}</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 500, color: row.color }}>{row.value}</span>
      </div>
    ))}
  </div>
);

// ── Inline icon components ────────────────────────────────────────────────────
const TriAlertIco = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 1.5L13 12.5H1L7 1.5z" /><line x1="7" y1="5.5" x2="7" y2="8.5" />
    <circle cx="7" cy="10.2" r=".7" fill={c} stroke="none" />
  </svg>
);
const CircleInfoIco = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="5.5" /><line x1="7" y1="4.5" x2="7" y2="7.5" />
    <circle cx="7" cy="9.5" r=".7" fill={c} stroke="none" />
  </svg>
);
const CheckIco = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,7.5 5.5,11 12.5,3.5" />
  </svg>
);

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
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [fetchingContact, setFetchingContact] = useState(false);
  const [subjectHealth, setSubjectHealth]   = useState<{ name: string; avg: number }[]>([]);
  const [refreshKey, setRefreshKey]         = useState(0);

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
    const unsubscribe = onSnapshot(qClasses, async (classSnap) => {
      try {
        // Also pick up teaching_assignments
        const taSnap = await getDocs(query(
          collection(db, "teaching_assignments"),
          where("schoolId", "==", schoolId),
          where("teacherId", "==", tid),
        ));
        const classIdSet = new Set<string>([
          ...classSnap.docs.map(d => d.id),
          ...taSnap.docs.map(d => d.data().classId).filter(Boolean),
        ]);
        if (ignore) return;
        const classIds = Array.from(classIdSet);

        if (classIds.length === 0) { setAlerts([]); setLoading(false); return; }

        // Enrollments — scoped by school + classId
        const enrollSnaps = await Promise.all(
          chunkArr(classIds, 10).map(ch => getDocs(query(
            collection(db, "enrollments"),
            where("schoolId", "==", schoolId),
            where("classId", "in", ch),
          )))
        );
        const enrolls = enrollSnaps.flatMap(s => s.docs).map(d => ({ enrollId: d.id, ...d.data() })) as any[];

        if (enrolls.length === 0) { setAlerts([]); setLoading(false); return; }

        const rosterMap = new Map();
        enrolls.forEach(e => {
          const key = (e.studentId || e.studentEmail || e.studentName || "").toLowerCase();
          if (!rosterMap.has(key)) rosterMap.set(key, e);
        });
        const uniqueRoster = Array.from(rosterMap.values());

        // Gradebook scores — scoped by school + classId
        const gbSnapPromise = Promise.all(
          chunkArr(classIds, 10).map(ch => getDocs(query(
            collection(db, "gradebook_scores"),
            where("schoolId", "==", schoolId),
            where("classId", "in", ch),
          )))
        ).then(snaps => ({ docs: snaps.flatMap(s => s.docs) })).catch(() => ({ docs: [] as any[] }));

        // All other queries — schoolId + teacherId scoped
        const safeGet = (col: string, ...filters: any[]) =>
          getDocs(query(collection(db, col), where("schoolId", "==", schoolId), ...filters)).catch(() => ({ docs: [] as any[] }));

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

        // Subject health computation
        const subMap = new Map<string, { total: number; count: number }>();
        [...allTS, ...allResults].forEach((sc: any) => {
          const subj = sc.subject || sc.testName || "General";
          if (!subj) return;
          const p = getPct(sc);
          if (!subMap.has(subj)) subMap.set(subj, { total: 0, count: 0 });
          subMap.get(subj)!.total += p;
          subMap.get(subj)!.count += 1;
        });
        setSubjectHealth(
          Array.from(subMap.entries())
            .map(([name, { total, count }]) => ({ name, avg: Math.round(total / count) }))
            .sort((a, b) => b.avg - a.avg)
            .slice(0, 5)
        );

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

          // Improved student filter — also matches by studentName
          const sf = (arr: any[]) => arr.filter(item =>
            (sId && (item.studentId === sId || item.id?.includes?.(sId))) ||
            (sEmail && item.studentEmail?.toLowerCase() === sEmail) ||
            (sName && item.studentName?.toLowerCase() === sName)
          );

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
                id: `att_${sId}`, studentId: sId, name,
                initials: getInitials(name), avatarColor: getAvatarColor(name),
                severity: rate < 60 ? "Critical" : rate < 75 ? "High Priority" : "Medium Priority",
                type: "Attendance",
                issue: `Attendance at ${rate.toFixed(0)}% — ${absences} absence${absences > 1 ? "s" : ""} in last 3 weeks`,
                details: [`Late arrivals: ${lates}`, `${recentAtt.length} records in window`],
                cls: e.className || "Class", isSystem: true,
              });
            }
          }

          // 2. GRADES
          const sScores = [...sf(allTS), ...sf(allGB), ...sf(allResults)];
          if (sScores.length >= 1) {
            const sorted    = [...sScores].sort((a, b) =>
              (a.timestamp?.toMillis?.() || a.date?.toMillis?.() || 0) -
              (b.timestamp?.toMillis?.() || b.date?.toMillis?.() || 0)
            );
            const recent3   = sorted.slice(-3).map(getPct).filter(v => v >= 0);
            const past3     = sorted.slice(-6, -3).map(getPct).filter(v => v >= 0);
            const recentAvg = recent3.length > 0 ? recent3.reduce((a, b) => a + b, 0) / recent3.length : 0;
            const pastAvg   = past3.length > 0   ? past3.reduce((a, b) => a + b, 0) / past3.length : recentAvg;
            const drop      = pastAvg - recentAvg;
            if (recentAvg < 60 || drop > 10) {
              generated.push({
                id: `grd_${sId}`, studentId: sId, name,
                initials: getInitials(name), avatarColor: getAvatarColor(name),
                severity: drop > 20 || recentAvg < 40 ? "Critical" : "High Priority",
                type: "Grades",
                issue: drop > 10
                  ? `Grade avg dropped ${drop.toFixed(0)}% — from ${pastAvg.toFixed(0)}% to ${recentAvg.toFixed(0)}%`
                  : `Grade avg at ${recentAvg.toFixed(0)}% — below passing benchmark`,
                details: [`Trend: ${drop > 0 ? "Declining" : "Stable"}`, `Based on ${sScores.length} score${sScores.length > 1 ? "s" : ""}`],
                cls: e.className || "Class", isSystem: true,
              });
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
              id: `sub_${sId}`, studentId: sId, name,
              initials: getInitials(name), avatarColor: getAvatarColor(name),
              severity: missed.length >= 4 ? "Critical" : "High Priority",
              type: "Submissions",
              issue: `Missing ${missed.length} assignment${missed.length > 1 ? "s" : ""} — overdue`,
              details: [`Overdue: ${missed.slice(0, 2).map((m: any) => m.title || "Assignment").join(", ")}`, `Grade impact: -${Math.min(missed.length * 3, 15)}%`],
              cls: e.className || "Class", isSystem: true,
            });
          }

          // 4. BEHAVIOR
          const sNotes    = sf(allNotes);
          const negSignals = sNotes.filter((n: any) => {
            const text = (n.content || n.message || "").toLowerCase();
            return text.includes("aggressive") || text.includes("bully") ||
              text.includes("distraction") || text.includes("refused") ||
              text.includes("sick") || text.includes("trouble");
          });
          if (negSignals.length > 0) {
            generated.push({
              id: `beh_${sId}`, studentId: sId, name,
              initials: getInitials(name), avatarColor: getAvatarColor(name),
              severity: negSignals.length >= 3 ? "Critical" : "High Priority",
              type: "Behavior",
              issue: `${negSignals.length} concerning behaviour note${negSignals.length > 1 ? "s" : ""} logged`,
              details: [`Notes flagged: ${negSignals.length}`, `Requires attention`],
              cls: e.className || "Class", isSystem: true,
            });
          }
        });

        // MANUAL alerts (risks collection)
        manuals.filter((r: any) => !r.resolved).forEach((r: any) => {
          if (!generated.find(a => a.id === r.id)) {
            generated.push({
              id: r.id, studentId: r.studentId,
              name: r.studentName || "Student",
              initials: getInitials(r.studentName || "Student"),
              avatarColor: getAvatarColor(r.studentName),
              severity: r.severity || "Medium Priority",
              type: r.type || "Behavior",
              issue: r.issue || r.details || "Manual alert flagged by teacher",
              details: r.details ? [r.details] : ["Flagged for review"],
              cls: r.className || "Class", isSystem: false,
            });
          }
        });

        const ORDER: Record<string, number> = { Critical: 0, "High Priority": 1, "Medium Priority": 2 };
        generated.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
        if (ignore) return;
        setAlerts(generated);
      } catch (err) {
        if (ignore) return;
        console.error("[RisksAlerts] Error:", err);
        toast.error("Failed to load alerts.");
      } finally {
        if (!ignore) setLoading(false);
      }
    });
    return () => { ignore = true; unsubscribe(); };
  }, [teacherData?.id, refreshKey]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleResolve = async (a: Alert) => {
    if (a.isSystem) {
      toast.info("System alerts resolve automatically when the issue improves.");
      return;
    }
    setResolving(a.id);
    try {
      await auditedUpdate(doc(db, "risks", a.id), {
        resolved: true,
        resolvedAt: serverTimestamp(),
      });
      setAlerts(prev => prev.filter(x => x.id !== a.id));
      setResolvedCount(c => c + 1);
      toast.success("Alert marked as resolved.");
    } catch (e) {
      console.error("[RisksAlerts] resolve failed", e);
      toast.error("Failed to update. Try again.");
    } finally {
      setResolving(null);
    }
  };

  const fetchContact = async (sId: string, sName: string) => {
    if (!teacherData?.schoolId) return;
    setFetchingContact(true);
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData?.branchId as string | undefined;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));
    try {
      // Try enrollments first, then fall back to students collection by studentId
      let phone: string | null = null;
      let parent: string | null = null;

      const q = query(collection(db, "enrollments"), ...SC, where("studentId", "==", sId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0].data();
        phone  = d.parentPhone || d.phone || null;
        parent = d.parentName || null;
      }
      if (!phone) {
        // Fallback: look up the student doc directly
        const sSnap = await getDocs(query(collection(db, "students"), ...SC, where("studentId", "==", sId))).catch(() => null);
        if (sSnap && !sSnap.empty) {
          const d = sSnap.docs[0].data();
          phone  = phone  || d.parentPhone || d.phone || d.guardianPhone || null;
          parent = parent || d.parentName  || d.guardianName             || null;
        }
      }
      setSelectedContact({
        name:   sName,
        parent: parent || `Parent of ${sName}`,
        phone:  phone,  // null when not available — UI shows "Not available"
      });
    } catch (e) {
      console.error("[RisksAlerts] fetchContact failed", e);
      toast.error("Could not fetch contact details.");
    } finally {
      setFetchingContact(false);
    }
  };

  const getActions = (a: Alert): { label: string; primary: boolean; color?: string; onClick: () => void }[] => {
    if (a.type === "Attendance") return [
      { label: "Contact Parent", primary: true, color: T.red,  onClick: () => fetchContact(a.studentId, a.name) },
      { label: "Mark Resolved",  primary: false,               onClick: () => handleResolve(a) },
    ];
    if (a.type === "Grades") return [
      { label: "Schedule Meeting", primary: true, color: T.blue, onClick: () => fetchContact(a.studentId, a.name) },
      { label: "View Profile",     primary: false,               onClick: () => {} },
    ];
    if (a.type === "Submissions") return [
      { label: "Send Reminder",  primary: true, color: T.amb, onClick: () => fetchContact(a.studentId, a.name) },
      { label: "Mark Resolved",  primary: false,               onClick: () => handleResolve(a) },
    ];
    if (a.type === "Behavior") return [
      { label: "Notify Parent",  primary: true, color: T.blue, onClick: () => fetchContact(a.studentId, a.name) },
      { label: "Mark Resolved",  primary: false,               onClick: () => handleResolve(a) },
    ];
    return [
      { label: "View Details",  primary: true, color: T.blue, onClick: () => {} },
      { label: "Mark Resolved", primary: false,               onClick: () => handleResolve(a) },
    ];
  };

  // ── Computed values ───────────────────────────────────────────────────────
  const criticalCount = alerts.filter(a => a.severity === "Critical").length;
  const highCount     = alerts.filter(a => a.severity === "High Priority").length;
  const mediumCount   = alerts.filter(a => a.severity === "Medium Priority").length;
  const attCount      = alerts.filter(a => a.type === "Attendance").length;
  const gradesCount   = alerts.filter(a => a.type === "Grades").length;
  const totalCount    = alerts.length;
  const maxBar        = Math.max(totalCount, 1);

  const visible = useMemo(() => {
    if (activeTab === "Attendance") return alerts.filter(a => a.type === "Attendance");
    if (activeTab === "Grades")     return alerts.filter(a => a.type === "Grades");
    return alerts;
  }, [alerts, activeTab]);

  // Hero content changes per tab
  const HERO: Record<string, { eyebrow: string; line1: string; line2: string; sub: string }> = {
    All:        { eyebrow: "Monitoring",            line1: "Risks &",    line2: "alerts",  sub: "Monitor and respond to student concerns." },
    Attendance: { eyebrow: "Attendance monitoring", line1: "Attendance", line2: "alerts",  sub: "Students with attendance concerns appear here." },
    Grades:     { eyebrow: "Grade monitoring",      line1: "Grade",      line2: "alerts",  sub: "Students with grade concerns appear here." },
  };
  const hc = HERO[activeTab] || HERO.All;

  // Subject health bar color
  const subjColor = (avg: number) =>
    avg >= 80 ? T.grn2 : avg >= 60 ? T.blue : avg >= 40 ? T.amb : T.red;

  // Filter tabs config
  const FILTER_TABS = [
    { id: "All",        label: `All (${totalCount})` },
    { id: "Attendance", label: "Attendance"           },
    { id: "Grades",     label: "Grades"               },
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
          .ra-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
          @media (hover:hover) { .ra-card3d:hover { transform: translateY(-4px) rotateX(4deg) rotateY(-3deg) scale(1.012); box-shadow: 0 1px 2px rgba(9,87,247,.08), 0 24px 44px rgba(9,87,247,.18), 0 8px 16px rgba(9,87,247,.1); } }
          .ra-card3d:active { transform: translateY(-1px) scale(.985); box-shadow: 0 1px 2px rgba(9,87,247,.1), 0 6px 16px rgba(9,87,247,.14); }
          .ra-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
          .ra-press:active { transform: scale(.94); }
          @keyframes raFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
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
          const timeAgo = (a: Alert): string => {
            const anyA = a as any;
            const raw = anyA.createdAt || anyA.timestamp || anyA.resolvedAt;
            let ms = 0;
            if (raw?.toMillis) ms = raw.toMillis();
            else if (raw?.toDate) ms = raw.toDate().getTime();
            else if (typeof raw === "string") ms = new Date(raw).getTime();
            else if (typeof raw === "number") ms = raw;
            if (!ms) {
              if (a.severity === "Critical") return "2h";
              if (a.severity === "High Priority") return "5h";
              return "1d";
            }
            const diff = Date.now() - ms;
            const mins = Math.floor(diff / 60000);
            if (mins < 60) return `${Math.max(1, mins)}m`;
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return `${hrs}h`;
            return `${Math.floor(hrs / 24)}d`;
          };
          const MOB_AV = ["#7B3FF4", "#0055FF", "#00C853", "#FF8800", "#C2255C", "#00B8D4", "#6741D9"];
          const mobAvBg = (name: string) => {
            const sum = (name || "").split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
            return MOB_AV[sum % MOB_AV.length];
          };
          const mobClassChipColor = (name: string) => {
            const lower = (name || "").toLowerCase();
            if (lower.includes("shaik")) return { bg: "rgba(123,63,244,.12)", color: "#7B3FF4" };
            return { bg: "rgba(9,87,247,.08)", color: "#0055FF" };
          };
          const mobParseCls = (cls: string) => {
            const parts = (cls || "").split(" — ");
            return { className: parts[0] || cls || "Class", subject: parts[1] || "" };
          };

          return (
            <div className="ra-enter" style={{ display: "flex", flexDirection: "column" }}>

              {/* Page Header */}
              <div style={{ padding: "8px 2px 14px" }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
                  <span className={criticalCount > 0 ? "ra-pulse" : ""} style={{ width: 5, height: 5, borderRadius: 2, background: "#FF3355", display: "inline-block", boxShadow: "0 0 8px rgba(255,51,85,.5)" }} />
                  Teacher Dashboard · Alerts
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 800, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>Risks &amp; Alerts</h1>
                <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, marginTop: 6, letterSpacing: "-0.15px" }}>
                  Monitor and respond to student concerns.
                </div>
              </div>

              {/* HERO — Dark red gradient */}
              <div
                className="ra-card3d"
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
                      <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,.8)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Critical Alerts</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 2, fontWeight: 500, letterSpacing: "-0.1px" }}>Requires immediate action</div>
                    </div>
                    <div style={{ marginLeft: "auto", background: "rgba(255,255,255,.18)", border: "0.5px solid rgba(255,255,255,.28)", color: "#fff", padding: "5px 12px", borderRadius: 100, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.3px" }}>
                      <span className="ra-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px #fff" }} />
                      Live
                    </div>
                  </div>
                  <div style={{ fontSize: 60, fontWeight: 800, color: "#fff", letterSpacing: "-2.8px", lineHeight: 1, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
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
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>{gradesCount}</div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Grades</div>
                    </div>
                    <div style={{ background: "rgba(40,6,16,.7)", padding: "12px 4px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#FFD060", letterSpacing: "-0.5px" }}>{attCount}</div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Attend.</div>
                    </div>
                    <div style={{ background: "rgba(40,6,16,.7)", padding: "12px 4px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#6FFFAA", letterSpacing: "-0.5px" }}>{resolvedCount}</div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Resolved</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats 2x2 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { key: "Critical", label: "Critical", count: criticalCount, color: "#FF3355",
                    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 21h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg>,
                    sub: count => count > 0
                      ? <span style={{ color: "#FF3355", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><span className="ra-pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF3355" }} />Act now</span>
                      : <span style={{ color: "#5070B0", fontWeight: 600 }}>All clear</span>,
                    onClick: () => { setActiveTab("All"); window.scrollTo({ top: 300, behavior: "smooth" }); } },
                  { key: "High Priority", label: "High Priority", count: highCount, color: "#FF8800",
                    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>,
                    sub: count => count > 0
                      ? <span style={{ color: "#FF8800", fontWeight: 700 }}>Priority</span>
                      : <span style={{ color: "#5070B0", fontWeight: 600 }}>All clear</span>,
                    onClick: () => setActiveTab("All") },
                  { key: "Medium", label: "Medium", count: mediumCount, color: "#0055FF",
                    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>,
                    sub: count => count > 0
                      ? <span style={{ color: "#0055FF", fontWeight: 700 }}>Watching</span>
                      : <span style={{ color: "#5070B0", fontWeight: 600 }}>Low risk</span>,
                    onClick: () => setActiveTab("All") },
                  { key: "Resolved", label: "Resolved This Week", count: resolvedCount, color: "#00C853",
                    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
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
                      background: "#fff", borderRadius: 20, padding: 16,
                      display: "flex", flexDirection: "column",
                      boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                      textAlign: "left", border: "none", cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, minHeight: 40 }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.0px", textTransform: "uppercase", lineHeight: 1.4, paddingTop: 3 }}>{s.label}</div>
                      <div style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", background: s.color }}>{s.icon}</div>
                    </div>
                    <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1.3px", lineHeight: 1, color: s.color }}>{s.count}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, marginTop: 7, letterSpacing: "-0.15px" }}>{s.sub(s.count)}</div>
                  </button>
                ))}
              </div>

              {/* Filter Tabs */}
              <div
                className="ra-card3d"
                style={{
                  display: "flex", gap: 6, background: "#fff",
                  padding: 5, borderRadius: 14, marginBottom: 12,
                  boxShadow: "0 0.5px 1px rgba(9,87,247,.04), 0 2px 10px rgba(9,87,247,.06)",
                }}
              >
                {[
                  { id: "All", label: "All", count: totalCount },
                  { id: "Attendance", label: "Attendance", count: attCount },
                  { id: "Grades", label: "Grades", count: gradesCount },
                ].map(tab => {
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      aria-pressed={active}
                      className="ra-press"
                      style={{
                        flex: 1, padding: "9px 8px", borderRadius: 10,
                        background: active ? "#0055FF" : "transparent",
                        color: active ? "#fff" : "#5070B0",
                        fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                        border: "none", cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                        transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                        boxShadow: active ? "0 1px 2px rgba(9,87,247,.2), 0 3px 10px rgba(9,87,247,.25)" : "none",
                      }}
                    >
                      {tab.label}
                      <span style={{
                        background: active ? "rgba(255,255,255,.22)" : "#F4F7FE",
                        color: active ? "#fff" : "#5070B0",
                        fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 100,
                      }}>{tab.count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Alerts list */}
              {loading ? (
                <div className="ra-card3d" style={{ background: "#fff", borderRadius: 20, padding: "40px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)" }}>
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#5070B0" }} />
                  <span style={{ fontSize: 12, color: "#5070B0" }}>Loading alerts…</span>
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
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#001040", marginBottom: 6, letterSpacing: "-0.4px" }}>
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
              ) : visible.map(a => {
                const isAttendance = a.type === "Attendance";
                const accentColor = tabColorFor(a.type);
                const tagCls = tagClsFor(a.type);
                const avatarBgC = mobAvBg(a.name);
                const { className: clsName, subject } = mobParseCls(a.cls);
                const classChip = mobClassChipColor(clsName);
                const time = timeAgo(a);
                const contactAction = isAttendance
                  ? { label: "Contact Parent", color: "#FF8800" }
                  : a.type === "Grades"
                  ? { label: "Contact Parent", color: "#FF3355" }
                  : { label: "Contact Parent", color: accentColor };

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
                        fontSize: 12, fontWeight: 800, letterSpacing: "0.3px", flexShrink: 0, position: "relative",
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
                          <div style={{ fontSize: 14, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px", lineHeight: 1.2 }}>{a.name}</div>
                          <div style={{
                            background: accentColor, color: "#fff",
                            fontSize: 9, fontWeight: 900, padding: "3px 8px", borderRadius: 100,
                            letterSpacing: "0.4px", textTransform: "uppercase",
                            display: "flex", alignItems: "center", gap: 4,
                            boxShadow: `0 1px 2px ${accentColor}33, 0 2px 6px ${accentColor}40`,
                          }}>
                            <span className="ra-pulse" style={{ width: 4, height: 4, borderRadius: "50%", background: "#fff" }} />
                            {a.severity}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "#5070B0", marginTop: 3, fontWeight: 500, letterSpacing: "-0.1px", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          <span style={{ background: classChip.bg, color: classChip.color, padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 800 }}>{clsName}</span>
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
                        fontSize: 9, fontWeight: 900, letterSpacing: "0.8px", textTransform: "uppercase",
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
                            ? <b key={i} style={{ color: accentColor, fontWeight: 900 }}>{part}</b>
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
                                  <span style={{ color: chipStyle.vColor, fontWeight: 800 }}>{v}</span>
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
                        onClick={e => { e.stopPropagation(); fetchContact(a.studentId, a.name); }}
                        className="ra-press"
                        style={{
                          flex: 1, height: 40, borderRadius: 12,
                          background: contactAction.color, color: "#fff",
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                          border: "none", cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                          boxShadow: `0 1px 2px ${contactAction.color}40, 0 4px 12px ${contactAction.color}4D`,
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
                        </svg>
                        Contact Parent
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
                      <div style={{ fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,.95)", letterSpacing: "1.8px", textTransform: "uppercase" }}>AI Risk Intelligence</div>
                      <div style={{ marginLeft: "auto", background: "rgba(255,51,85,.25)", border: "0.5px solid rgba(255,51,85,.5)", color: "#FFB5BF", padding: "4px 10px", borderRadius: 100, fontSize: 9, fontWeight: 800, letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: 5 }}>
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
                        <div style={{ fontSize: 17, fontWeight: 800, color: "#FF9AA9", letterSpacing: "-0.4px" }}>{criticalCount}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Critical</div>
                      </div>
                      <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: "#FFD060", letterSpacing: "-0.4px" }}>{attCount}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Attend.</div>
                      </div>
                      <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "-0.4px" }}>{gradesCount}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Grade</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          );
        })()}

      {/* ── Contact modal (rendered on mobile; pre-existing desktop behaviour preserved) ── */}
      {(selectedContact || fetchingContact) && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setSelectedContact(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${T.s2}` }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#001040", margin: 0, letterSpacing: "-0.3px" }}>Contact Parent</h3>
              <button
                type="button"
                aria-label="Close contact panel"
                onClick={() => setSelectedContact(null)}
                style={{ width: 28, height: 28, border: "none", background: "#F4F7FE", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#5070B0" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" />
                </svg>
              </button>
            </div>
            {fetchingContact ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 style={{ width: 24, height: 24, color: "#5070B0" }} className="animate-spin" />
              </div>
            ) : selectedContact && (
              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: avBg(selectedContact.name), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>
                    {getInitials(selectedContact.name)}
                  </div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#001040", margin: 0 }}>{selectedContact.name}</p>
                    <p style={{ fontSize: 11, color: "#5070B0", margin: "3px 0 0" }}>{selectedContact.parent}</p>
                  </div>
                </div>
                <div style={{ background: "#F4F7FE", borderRadius: 12, padding: "12px 14px" }}>
                  <p style={{ fontSize: 10, color: "#5070B0", margin: "0 0 4px", fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase" }}>Contact Number</p>
                  {selectedContact.phone ? (
                    <p style={{ fontSize: 17, fontWeight: 800, color: "#0055FF", margin: 0, letterSpacing: "-0.3px" }}>{selectedContact.phone}</p>
                  ) : (
                    <p style={{ fontSize: 13, fontWeight: 500, color: "#99AACC", margin: 0, fontStyle: "italic" }}>
                      Not available — add parent phone in Students
                    </p>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {(() => {
                    const p = (selectedContact.phone || "").trim();
                    const sanitized = p.replace(/[^+\d]/g, "");
                    const waNum = sanitized.replace(/^\+/, "");
                    const disabled = !p;
                    return (
                      <>
                        <a
                          href={disabled ? undefined : `tel:${sanitized}`}
                          onClick={(e) => { if (disabled) { e.preventDefault(); toast.error("No phone number on file."); } }}
                          style={{
                            padding: "12px 0", background: disabled ? "#EAF0FB" : "#0055FF", color: disabled ? "#99AACC" : "#fff",
                            borderRadius: 12, fontSize: 13, fontWeight: 700,
                            textDecoration: "none", cursor: disabled ? "not-allowed" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            boxShadow: disabled ? "none" : "0 1px 2px rgba(9,87,247,.2), 0 4px 10px rgba(9,87,247,.25)",
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={disabled ? "#99AACC" : "#fff"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
                          </svg>
                          Call
                        </a>
                        <a
                          href={disabled ? undefined : `https://wa.me/${waNum}`}
                          target="_blank" rel="noopener noreferrer"
                          onClick={(e) => { if (disabled) { e.preventDefault(); toast.error("No phone number on file."); } }}
                          style={{
                            padding: "12px 0", background: disabled ? "#EAF0FB" : "#25D366", color: disabled ? "#99AACC" : "#fff",
                            borderRadius: 12, fontSize: 13, fontWeight: 700,
                            textDecoration: "none", cursor: disabled ? "not-allowed" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            boxShadow: disabled ? "none" : "0 1px 2px rgba(37,211,102,.2), 0 4px 10px rgba(37,211,102,.25)",
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={disabled ? "#99AACC" : "#fff"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
                          </svg>
                          WhatsApp
                        </a>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden stub — kept for JSX balance; legacy content removed */}
      <div style={{ display: "none" }}>
        <div style={{ paddingTop: 20 }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            {hc.eyebrow}
          </p>
          <h1 style={{ fontSize: 26, fontWeight: 500, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1.1, marginBottom: 6 }}>
            {hc.line1}<br />{hc.line2}
          </h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.5, marginBottom: 16 }}>{hc.sub}</p>

          {/* Chips */}
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {activeTab === "All" && (
              <>
                <Chip icon="check" text={`${criticalCount} Critical`} />
                <Chip icon="check" text={totalCount === 0 ? "All on track" : `${totalCount} active`} />
                <Chip icon="clock" text="Live" />
              </>
            )}
            {activeTab === "Attendance" && (
              <>
                <Chip icon="att" text={`${attCount} Absence alerts`} />
                {attCount === 0 && <Chip icon="check" text="All clear" />}
              </>
            )}
            {activeTab === "Grades" && (
              <>
                <Chip icon="grades" text={`${gradesCount} Grade alerts`} />
                {gradesCount === 0 && <Chip icon="check" text="All passing" />}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16 }}>

        {/* 4-metric grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <MetricCard label="Critical"          value={criticalCount} badge="Urgent"   color={T.red}  bg={T.rlBg} bdr={T.rlBdr} fillW={criticalCount / maxBar * 100} icon={<TriAlertIco c={T.red} />}   />
          <MetricCard label="High priority"     value={highCount}     badge="High"     color={T.amb}  bg={T.alBg} bdr={T.alBdr} fillW={highCount     / maxBar * 100} icon={<CircleInfoIco c={T.amb} />} />
          <MetricCard label="Medium priority"   value={mediumCount}   badge="Medium"   color={T.blue} bg={T.blBg} bdr={T.blBdr} fillW={mediumCount   / maxBar * 100} icon={<CircleInfoIco c={T.blue} />}/>
          <MetricCard label="Resolved this week" value={resolvedCount} badge="Resolved" color={T.grn2} bg={T.glBg} bdr={T.glBdr} fillW={resolvedCount / maxBar * 100} icon={<CheckIco c={T.grn2} />}    />
        </div>

        {/* Filter tab strip */}
        <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: 4, display: "flex", gap: 3 }}>
          {FILTER_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: "8px 6px", borderRadius: 11,
                background: activeTab === tab.id ? T.ink1 : "transparent",
                color: activeTab === tab.id ? "#fff" : T.ink3,
                fontSize: 11, fontWeight: activeTab === tab.id ? 500 : 400,
                border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                transition: "background 0.15s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Alert panel */}
        <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: "hidden" }}>

          {/* Panel header */}
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.s2}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.ink1, display: "flex", alignItems: "center", gap: 7 }}>
              {activeTab === "All" && (
                <>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1.5" y="2" width="11" height="10.5" rx="1.5" /><line x1="4" y1="1" x2="4" y2="3.5" />
                    <line x1="10" y1="1" x2="10" y2="3.5" /><line x1="1.5" y1="5.5" x2="12.5" y2="5.5" />
                  </svg>
                  All alerts
                </>
              )}
              {activeTab === "Attendance" && (
                <>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2,8.5 6,7 3.5,4 7.5,2.5" />
                  </svg>
                  Attendance alerts
                </>
              )}
              {activeTab === "Grades" && (
                <>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#6741D9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2,10 5.5,6.5 8.5,8.5 12.5,3.5" /><polyline points="10.5,3.5 12.5,3.5 12.5,5.5" />
                  </svg>
                  Grade alerts
                </>
              )}
            </div>
            {activeTab === "All" ? (
              <button
                type="button"
                onClick={() => { setLoading(true); setRefreshKey(k => k + 1); }}
                style={{ fontSize: 11, color: T.blue, background: "none", border: "none", cursor: "pointer" }}
              >
                Refresh
              </button>
            ) : (
              <span style={{ padding: "3px 8px", borderRadius: 20, background: T.glBg, color: T.grn2, fontSize: 10, fontWeight: 500 }}>
                {visible.length} active
              </span>
            )}
          </div>

          {/* Panel content */}
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Loader2 style={{ width: 28, height: 28, color: T.ink3 }} className="animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            /* Empty state */
            <div style={{ padding: "32px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: T.glBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={T.grn} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3,11 8,16 19,5" />
                </svg>
              </div>
              <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1, margin: 0 }}>
                {activeTab === "All" ? "All students on track" : activeTab === "Attendance" ? "No attendance concerns" : "No grade concerns"}
              </p>
              <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", lineHeight: 1.5, maxWidth: 200, margin: 0 }}>
                {activeTab === "All"
                  ? "No alerts in any category. Keep up the great work!"
                  : activeTab === "Attendance"
                  ? "All students have good attendance records this week."
                  : "All students are performing within acceptable grade ranges."}
              </p>
              <span style={{ padding: "3px 8px", borderRadius: 20, background: T.glBg, color: T.grn2, fontSize: 10, fontWeight: 500, marginTop: 4 }}>
                {activeTab === "All" ? "0 active alerts" : activeTab === "Attendance" ? "Attendance all clear" : "Grades all clear"}
              </span>
            </div>
          ) : (
            /* Alert list */
            <div>
              {visible.map((a, idx) => {
                const s = SEV[a.severity] || SEV["Medium Priority"];
                const actions = getActions(a);
                return (
                  <div
                    key={a.id}
                    onClick={() => navigate(`/students?studentId=${a.studentId || ''}`)}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "12px 14px",
                      borderBottom: idx < visible.length - 1 ? `1px solid ${T.s2}` : "none",
                      borderLeft: `3px solid ${s.color}`,
                    }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 34, height: 34, borderRadius: 10,
                      background: avBg(a.name), color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, flexShrink: 0,
                    }}>
                      {getInitials(a.name)}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: T.ink1 }}>{a.name}</span>
                        <span style={{ padding: "2px 7px", borderRadius: 20, background: s.pillBg, color: s.pillColor, fontSize: 10, fontWeight: 500 }}>
                          {a.severity}
                        </span>
                        <span style={{ fontSize: 10, color: T.ink3 }}>{a.cls}</span>
                      </div>
                      <p style={{ fontSize: 11, color: T.ink2, marginBottom: 5, lineHeight: 1.4 }}>{a.issue}</p>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                        {a.details.map((d, i) => (
                          <span key={i} style={{ fontSize: 10, color: T.ink3 }}>{d}</span>
                        ))}
                      </div>
                      {/* Action buttons */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {actions.map((action, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={action.onClick}
                            disabled={resolving === a.id}
                            style={{
                              padding: "5px 10px", borderRadius: 8,
                              background: action.primary ? (action.color || T.blue) : "transparent",
                              color: action.primary ? "#fff" : T.ink3,
                              border: action.primary ? "none" : `1px solid ${T.bdr}`,
                              fontSize: 10, fontWeight: 600, cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 4,
                              opacity: resolving === a.id ? 0.6 : 1,
                            }}
                          >
                            {resolving === a.id && !action.primary
                              ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />
                              : action.label
                            }
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Tab-specific supplementary cards ──────────────────────────────── */}

        {/* All tab — status banner + quick actions (only when empty) */}
        {activeTab === "All" && visible.length === 0 && (
          <>
            <div style={{ background: T.glBg, border: `1px solid ${T.glBdr}`, borderRadius: 16, padding: 14, display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: "rgba(47,158,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={T.grn} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2.5,8.5 6,12 13.5,4" />
                </svg>
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: T.grn, margin: "0 0 2px" }}>System all clear</p>
                <p style={{ fontSize: 10, color: T.grn, opacity: 0.75, margin: 0, lineHeight: 1.4 }}>
                  No critical or high priority alerts active. All students performing within expected ranges.
                </p>
              </div>
            </div>

            <p style={{ fontSize: 10, fontWeight: 500, color: T.ink3, letterSpacing: "0.07em", textTransform: "uppercase", margin: "4px 2px 0" }}>
              Quick actions
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {([
                { label: "View at-risk",  sub: "See students needing help", iconBg: T.rlBg, ic: T.red,  svgD: "M6.5 1.5L12 11.5H1L6.5 1.5z", onClick: () => navigate("/students?filter=at-risk") },
                { label: "Go to reports", sub: "Generate alert report",     iconBg: T.blBg, ic: T.blue, svgD: null,                           onClick: () => navigate("/reports") },
                { label: "Refresh data",  sub: "Re-sync latest alerts",     iconBg: T.glBg, ic: T.grn2, svgD: "M1.5,7 5,10.5 11.5,3",         onClick: () => { setLoading(true); setRefreshKey(k => k + 1); } },
                { label: "Export JSON",   sub: "Download alert log",        iconBg: T.alBg, ic: T.amb,  svgD: null,                           onClick: () => {
                  const blob = new Blob([JSON.stringify(alerts, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `alerts_${new Date().toISOString().slice(0,10)}.json`;
                  a.click(); URL.revokeObjectURL(url);
                } },
              ] as const).map((qa) => (
                <button
                  key={qa.label}
                  type="button"
                  onClick={qa.onClick}
                  style={{
                    padding: "11px 10px", borderRadius: 13,
                    border: `1px solid ${T.bdr}`, background: T.white,
                    display: "flex", flexDirection: "column", gap: 6,
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: qa.iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {qa.label === "Go to reports" ? (
                      <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={qa.ic} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2,9.5 L11,9.5 L9,6 L11,2.5 L2,2.5 L4,6 Z" />
                      </svg>
                    ) : qa.label === "Export JSON" ? (
                      <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={qa.ic} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="1.5" width="9" height="10" rx="1.5" /><line x1="4.5" y1="5" x2="8.5" y2="5" /><line x1="4.5" y1="7.5" x2="7" y2="7.5" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={qa.ic} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points={qa.svgD || ""} />
                        {qa.label === "View at-risk" && <path d="M6.5 1.5L12 11.5H1L6.5 1.5z" />}
                      </svg>
                    )}
                  </div>
                  <p style={{ fontSize: 11, fontWeight: 500, color: T.ink1, margin: 0 }}>{qa.label}</p>
                  <p style={{ fontSize: 10, color: T.ink3, margin: 0 }}>{qa.sub}</p>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Attendance tab — thresholds */}
        {activeTab === "Attendance" && (
          <ThresholdCard
            title="Alert thresholds"
            sub="Alerts trigger when students cross these limits"
            rows={[
              { label: "Critical absence rate", value: "< 60%",  color: T.red  },
              { label: "High priority",          value: "60–74%", color: T.amb  },
              { label: "Medium priority",        value: "75–79%", color: T.blue },
            ]}
          />
        )}

        {/* Grades tab — thresholds + subject health */}
        {activeTab === "Grades" && (
          <>
            <ThresholdCard
              title="Grade alert thresholds"
              sub="Alerts trigger when scores fall below"
              rows={[
                { label: "Critical (F grade)", value: "< 40%",  color: T.red  },
                { label: "High priority",      value: "40–49%", color: T.amb  },
                { label: "Medium priority",    value: "50–59%", color: T.blue },
              ]}
            />
            {subjectHealth.length > 0 && (
              <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 16, padding: "12px 13px" }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, margin: "0 0 10px" }}>Subject health check</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {subjectHealth.map(s => (
                    <div key={s.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 7, background: T.blBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="1.5" y="1" width="9" height="10" rx="1.5" /><line x1="3.5" y1="4.5" x2="8.5" y2="4.5" /><line x1="3.5" y1="7" x2="6" y2="7" />
                          </svg>
                        </div>
                        <span style={{ fontSize: 12, color: T.ink2 }}>{s.name}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 60, height: 4, borderRadius: 2, background: T.s2, overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(s.avg, 100)}%`, height: "100%", background: subjColor(s.avg), borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 500, color: subjColor(s.avg) }}>{s.avg}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

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
          { label: "Alerts",    type: "alert",    active: true,  path: "/risks"    },
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

      {/* ── Contact modal ─────────────────────────────────────────────────────── */}
      {(selectedContact || fetchingContact) && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setSelectedContact(null)}
        >
          <div
            style={{ background: T.white, borderRadius: 20, width: "100%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${T.s2}` }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: T.ink1, margin: 0 }}>Contact Parent</h3>
              <button
                type="button"
                aria-label="Close contact panel"
                onClick={() => setSelectedContact(null)}
                style={{ width: 28, height: 28, border: "none", background: T.s1, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={T.ink3} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" />
                </svg>
              </button>
            </div>

            {fetchingContact ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 style={{ width: 24, height: 24, color: T.ink3 }} className="animate-spin" />
              </div>
            ) : selectedContact && (
              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: avBg(selectedContact.name), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>
                    {getInitials(selectedContact.name)}
                  </div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: T.ink1, margin: 0 }}>{selectedContact.name}</p>
                    <p style={{ fontSize: 11, color: T.ink3, margin: "3px 0 0" }}>{selectedContact.parent}</p>
                  </div>
                </div>
                <div style={{ background: T.s1, borderRadius: 12, padding: "12px 14px" }}>
                  <p style={{ fontSize: 10, color: T.ink3, margin: "0 0 4px" }}>Contact Number</p>
                  {selectedContact.phone ? (
                    <p style={{ fontSize: 17, fontWeight: 700, color: T.blue, margin: 0 }}>{selectedContact.phone}</p>
                  ) : (
                    <p style={{ fontSize: 13, fontWeight: 500, color: T.ink3, margin: 0, fontStyle: "italic" }}>
                      Not available — add parent phone in Students
                    </p>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {(() => {
                    const p   = (selectedContact.phone || "").trim();
                    const sanitized = p.replace(/[^+\d]/g, ""); // strip spaces/dashes for tel: / wa.me
                    const waNum     = sanitized.replace(/^\+/, ""); // wa.me wants no leading +
                    const disabled  = !p;
                    return (
                      <>
                        <a
                          href={disabled ? undefined : `tel:${sanitized}`}
                          onClick={(e) => { if (disabled) { e.preventDefault(); toast.error("No phone number on file."); } }}
                          style={{
                            padding: "12px 0", background: disabled ? T.s2 : T.blue, color: disabled ? T.ink3 : "#fff",
                            borderRadius: 12, fontSize: 13, fontWeight: 600,
                            textDecoration: "none", cursor: disabled ? "not-allowed" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={disabled ? T.ink3 : "#fff"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12.5 9.5c0 .4-.1.8-.3 1.1-.2.3-.5.6-.8.8-.5.5-1 .7-1.6.7-.4 0-.9-.1-1.4-.4-1.4-.7-2.6-1.7-3.7-2.8C3.6 7.8 2.6 6.6 1.9 5.3 1.6 4.8 1.5 4.3 1.5 3.9c0-.6.2-1.1.7-1.6.3-.3.6-.5 1-.6C3.5 1.6 3.7 1.5 4 1.5c.1 0 .2 0 .3.1.1 0 .2.1.3.2L6.4 4c.1.1.2.3.2.4 0 .2-.1.3-.2.5l-.6.7c0 .1-.1.2-.1.3 0 .1.1.2.1.3.1.2.7.9 1.4 1.6.7.7 1.4 1.3 1.6 1.4.1.1.2.1.3.1s.2 0 .3-.1l.7-.6c.1-.1.3-.2.5-.2.1 0 .3 0 .4.1l2.2 1.8c.1.1.2.2.2.3.1.1.1.2.1.3z" />
                          </svg>
                          Call
                        </a>
                        <a
                          href={disabled ? undefined : `https://wa.me/${waNum}`}
                          target="_blank" rel="noopener noreferrer"
                          onClick={(e) => { if (disabled) { e.preventDefault(); toast.error("No phone number on file."); } }}
                          style={{
                            padding: "12px 0", background: disabled ? T.s2 : "#25D366", color: disabled ? T.ink3 : "#fff",
                            borderRadius: 12, fontSize: 13, fontWeight: 600,
                            textDecoration: "none", cursor: disabled ? "not-allowed" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={disabled ? T.ink3 : "#fff"} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 1.5C3.96 1.5 1.5 3.96 1.5 7c0 .97.25 1.88.7 2.67L1.5 12.5l2.83-.69C5.12 12.26 6.03 12.5 7 12.5c3.04 0 5.5-2.46 5.5-5.5S10.04 1.5 7 1.5z" />
                            <path d="M5 5.5c.5 1.2 1.4 2.2 2.5 2.5" />
                          </svg>
                          WhatsApp
                        </a>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Blue Apple DNA ═══════════════════ */}
      <div
        className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 -mt-4 sm:-mt-6 md:-mt-8 px-8 pt-6 pb-10"
        style={{
          background: '#EEF4FF',
          minHeight: '100vh',
          fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <style>{`
          .rad-card3d { transition: transform .45s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
          @media (hover:hover) {
            .rad-card3d:hover { transform: perspective(1100px) translateY(-5px) rotateX(3deg) rotateY(-3deg) scale(1.012); box-shadow: 0 1px 2px rgba(0,85,255,.1), 0 24px 54px rgba(0,16,64,.2), 0 6px 18px rgba(0,85,255,.18); }
          }
          .rad-tile { transition: transform .45s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); cursor: pointer; }
          @media (hover:hover) {
            .rad-tile:hover { transform: perspective(1100px) translateY(-8px) rotateX(4deg) rotateY(-4deg) scale(1.025); }
          }
          .rad-btn { transition: transform .2s ease, box-shadow .2s ease, filter .2s ease; }
          .rad-btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
          .rad-btn:active { transform: scale(.96); }
          .rad-row { transition: transform .3s ease; }
          .rad-row:hover { transform: translateX(3px); }
          .rad-chip { transition: all .2s ease; }
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

          {/* ═══ Page Head ═══ */}
          <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
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
              <h1 style={{ fontSize: 34, fontWeight: 800, color: '#001040', letterSpacing: '-1.2px', lineHeight: 1.05, margin: 0 }}>
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
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
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
                  fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
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
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, color: statusColor }}>
                        {statusLabel}
                      </div>
                      <h2 style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', margin: 0, color: '#fff', lineHeight: 1 }}>
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
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: s.color, margin: 0, letterSpacing: '-0.5px' }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Bright 4-col KPI Tiles */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Critical', value: criticalCount.toString(), sub: criticalCount > 0 ? 'Needs outreach now' : 'No critical alerts', grad: 'linear-gradient(135deg,#FF3355 0%,#FF6677 100%)', onClick: () => setActiveTab('All') },
              { label: 'High Priority', value: highCount.toString(), sub: highCount > 0 ? 'Follow up this week' : 'Stable', grad: 'linear-gradient(135deg,#FF8800 0%,#FFAA44 100%)', onClick: () => setActiveTab('All') },
              { label: 'Medium Priority', value: mediumCount.toString(), sub: mediumCount > 0 ? 'Keep monitoring' : 'Class is steady', grad: 'linear-gradient(135deg,#0055FF 0%,#2277FF 100%)', onClick: () => setActiveTab('All') },
              { label: 'Resolved This Week', value: resolvedCount.toString(), sub: resolvedCount > 0 ? 'Great follow-through' : 'No resolutions yet', grad: 'linear-gradient(135deg,#00C853 0%,#33DD77 100%)', onClick: () => navigate('/gradebook') },
            ].map(k => (
              <div
                key={k.label}
                onClick={k.onClick}
                role="button"
                tabIndex={0}
                className="rad-tile"
                style={{
                  background: k.grad, borderRadius: 22, padding: '22px 24px', color: '#fff',
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 0 0 .5px rgba(255,255,255,.15), 0 14px 38px rgba(0,85,255,.26), 0 4px 12px rgba(0,85,255,.18)',
                }}
              >
                <div style={{ position: 'absolute', top: -30, right: -20, width: 120, height: 120, background: 'radial-gradient(circle, rgba(255,255,255,.22) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, position: 'relative', zIndex: 1 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.22)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {k.label === 'Critical' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
                    {k.label === 'High Priority' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
                    {k.label === 'Medium Priority' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>}
                    {k.label === 'Resolved This Week' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
                  </div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.78)', letterSpacing: '.10em', textTransform: 'uppercase', margin: '0 0 6px 0', position: 'relative', zIndex: 1 }}>{k.label}</div>
                <div style={{ fontSize: 34, fontWeight: 800, color: '#fff', letterSpacing: '-0.8px', margin: 0, lineHeight: 1.05, position: 'relative', zIndex: 1 }}>{k.value}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.78)', margin: '8px 0 0 0', position: 'relative', zIndex: 1 }}>{k.sub}</div>
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
                : 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)';
              const tabCount = tab.id === 'All' ? totalCount : tab.id === 'Attendance' ? attCount : gradesCount;
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
                    fontSize: 12, fontWeight: 800, letterSpacing: '0.04em',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {tab.id}
                  <span style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800,
                    background: active ? 'rgba(255,255,255,.28)' : 'rgba(0,85,255,.08)',
                    color: active ? '#fff' : '#0055FF',
                  }}>{tabCount}</span>
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
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px' }}>
                    {activeTab === 'All' ? 'All Active Alerts' : activeTab === 'Attendance' ? 'Attendance Alerts' : 'Grade Alerts'}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#99AACC', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
                    {visible.length} shown · prioritised by severity
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {visible.length === 0 ? (
                <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg,#00C853 0%,#33DD77 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 24px rgba(0,200,83,.28)' }}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px', margin: 0 }}>
                      {activeTab === 'All' ? 'All students on track' : activeTab === 'Attendance' ? 'No attendance concerns' : 'No grade concerns'}
                    </p>
                    <p style={{ fontSize: 13, fontWeight: 500, color: '#5070B0', margin: '6px 0 0 0' }}>
                      Keep it up — no active alerts in this filter.
                    </p>
                  </div>
                </div>
              ) : (
                visible.map(a => {
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
                  const actionLabel = a.severity === 'Critical'
                    ? 'Contact Parent'
                    : a.type === 'Attendance'
                    ? 'Send Reminder'
                    : a.type === 'Grades'
                    ? 'Schedule Meeting'
                    : 'Talk to Student';
                  return (
                    <div
                      key={a.id}
                      className="rad-row rad-card3d"
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
                        fontSize: 13, fontWeight: 800, flexShrink: 0,
                        boxShadow: `0 4px 12px ${avBg(a.name)}55`,
                      }}>
                        {a.initials || getInitials(a.name)}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <p style={{ fontSize: 14, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px', margin: 0 }}>{a.name}</p>
                          <span
                            style={{
                              fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 999,
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
                          onClick={() => fetchContact(a.studentId, a.name)}
                          className="rad-btn"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '9px 14px', borderRadius: 11,
                            background: sevGrad, color: '#fff',
                            fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            boxShadow: `0 6px 18px ${sevColor}45, 0 2px 5px ${sevColor}22`,
                          }}
                        >
                          {actionLabel}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolve(a)}
                          disabled={resolving === a.id}
                          className="rad-btn"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '9px 14px', borderRadius: 11,
                            background: '#fff', color: '#087F5B',
                            border: '0.5px solid rgba(0,200,83,.28)',
                            fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
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
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                      AI Risk Intelligence
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', marginBottom: 6 }}>
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
                      <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.color, letterSpacing: '-0.5px', lineHeight: 1 }}>{s.value}</div>
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
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.7)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
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
