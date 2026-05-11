import { useEffect, useMemo, useState, useRef } from "react";
import {
  ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, TrendingUp, MessageSquare,
  FileText, BookOpen, Calendar, BarChart3, Activity, AlertCircle, RefreshCw,
  Award, GraduationCap, Sparkles, ClipboardList, ShieldAlert,
  Users, Send, Pencil, Check, X as XIcon, Trash2, Loader2,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import { doc, collection, query, where, onSnapshot, getDocs, deleteDoc, serverTimestamp, type Unsubscribe } from "firebase/firestore";
import { auditedAdd, auditedUpdate } from "../lib/auditedWrites";
import { useAuth } from "../lib/AuthContext";
import { dedupAttendanceByDay } from "../lib/attendanceDedup";
import { toast } from "sonner";

// ── Canonical score normalizer (matches Dashboard / MyClasses / ClassDetail / Students).
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

const SCORE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

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

// ── Blue Apple theme tokens ─────────────────────────────────────────────────
const T = {
  bg: "#EEF4FF", white: "#FFFFFF", surface: "#F4F7FE", surface2: "#EAF0FB",
  ink: "#001040", ink2: "#5070B0", ink3: "#99AACC", ink4: "#5070B0",
  bdr: "rgba(0,85,255,0.07)", bdr2: "rgba(0,85,255,0.10)",
  s1: "#F4F7FE", s2: "#EAF0FB",
  blue: "#0055FF", blueD: "#0044CC", blBg: "rgba(0,85,255,0.10)",
  grn: "#00C853", glBg: "rgba(0,200,83,0.10)",
  red: "#FF3355", rlBg: "rgba(255,51,85,0.10)",
  amb: "#FF8800", alBg: "rgba(255,136,0,0.10)",
  violet: "#7B3FF4", vlBg: "rgba(123,63,244,0.10)",
  HERO_GRAD: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
  FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
};

// ── Tone palette — light pastel tints (Dashboard-style, soft & airy) ─────────
type Tone = "blue" | "green" | "red" | "amber" | "violet";
const TONE: Record<Tone, { accent: string; tintBg: string; chipBg: string; sub: string; }> = {
  blue:   { accent: "#0055FF", tintBg: "linear-gradient(135deg, #EEF3FF 0%, #F8FAFF 100%)", chipBg: "rgba(0,85,255,0.12)",   sub: "rgba(0,85,255,0.78)" },
  green:  { accent: "#00B050", tintBg: "linear-gradient(135deg, #EBFAF1 0%, #F6FCF8 100%)", chipBg: "rgba(0,176,80,0.13)",   sub: "rgba(0,176,80,0.85)" },
  red:    { accent: "#FF3355", tintBg: "linear-gradient(135deg, #FFEAEE 0%, #FFF5F7 100%)", chipBg: "rgba(255,51,85,0.12)",  sub: "rgba(255,51,85,0.85)" },
  amber:  { accent: "#FF8800", tintBg: "linear-gradient(135deg, #FFF2DD 0%, #FFF8EC 100%)", chipBg: "rgba(255,136,0,0.13)",  sub: "rgba(255,136,0,0.88)" },
  violet: { accent: "#7B3FF4", tintBg: "linear-gradient(135deg, #F0E8FF 0%, #F8F4FF 100%)", chipBg: "rgba(123,63,244,0.13)", sub: "rgba(123,63,244,0.85)" },
};

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const timeAgo = (v: any) => {
  const d = toDate(v); if (!d) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase();
};

// ── VibeCard — Dashboard-style tintBg + icon chip + uppercase label + decor SVG ──
type IconC = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; style?: React.CSSProperties }>;
interface VibeCardProps {
  tone: Tone;
  icon: IconC;
  decorIcon?: IconC;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
const VibeCard = ({ tone, icon: Icon, decorIcon, label, action, children, style }: VibeCardProps) => {
  const t = TONE[tone];
  const Decor = decorIcon || Icon;
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [hov, setHov] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setTilt({
      x: (((e.clientY - r.top) / r.height) - 0.5) * -4,
      y: (((e.clientX - r.left) / r.width) - 0.5) * 4,
    });
  };
  return (
    <div ref={ref}
      onMouseMove={onMove}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => { setTilt({ x: 0, y: 0 }); setHov(false); }}
      style={{
        position: "relative",
        background: t.tintBg,
        border: `0.5px solid ${t.accent}1A`,
        borderRadius: 18,
        overflow: "hidden",
        transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) ${hov ? "translateY(-2px)" : ""}`,
        transformOrigin: "center",
        transition: "transform 0.5s cubic-bezier(0.16,1,0.3,1), box-shadow 0.45s, border-color 0.4s",
        willChange: "transform, box-shadow",
        boxShadow: hov
          ? `0 0 0 0.5px ${t.accent}1F, 0 6px 18px ${t.accent}14, 0 14px 32px ${t.accent}0F`
          : `0 0 0 0.5px ${t.accent}14, 0 2px 8px ${t.accent}0F, 0 8px 22px ${t.accent}0A`,
        ...style,
      }}>
      {/* Decorative SVG bottom-right (soft, low-opacity) */}
      <Decor size={92}
        color={t.accent}
        strokeWidth={1.3}
        style={{ position: "absolute", bottom: -10, right: -10, opacity: 0.13, pointerEvents: "none" }} />

      <div style={{ position: "relative", zIndex: 2, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ background: t.chipBg, padding: 7, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={16} color={t.accent} strokeWidth={2.4} />
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700, color: t.accent,
              textTransform: "uppercase", letterSpacing: "0.7px",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{label}</span>
          </div>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
};

const DLink = ({ tone }: { tone: Tone }) => (
  <span style={{ fontSize: 11, color: TONE[tone].accent, fontWeight: 700, cursor: "pointer", letterSpacing: "-0.1px", whiteSpace: "nowrap" }}>
    Details ›
  </span>
);

// Big-value block (Dashboard-style: BIG NUMBER + colored sub-line with dot)
const Headline = ({ value, sub, subTone, dot = true }: { value: React.ReactNode; sub?: React.ReactNode; subTone: Tone; dot?: boolean }) => (
  <>
    <div style={{ fontSize: 30, fontWeight: 700, color: T.ink, letterSpacing: "-0.7px", lineHeight: 1.1 }}>{value}</div>
    {sub && (
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11, fontWeight: 600, color: TONE[subTone].sub }}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: TONE[subTone].accent }} />}
        <span>{sub}</span>
      </div>
    )}
  </>
);

// ════════════════════════════════════════════════════════════════════════════════
interface Props { student: any; onBack?: () => void; embedded?: boolean; }

export default function StudentProfile({ student, onBack, embedded = false }: Props) {
  const { teacherData } = useAuth();
  const navigate = useNavigate();
  const [masterProfile, setMasterProfile] = useState<any>(null);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [testScores, setTestScores] = useState<any[]>([]);
  const [gradebookScores, setGradebookScores] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [parentNotes, setParentNotes] = useState<any[]>([]);
  const [interventions, setInterventions] = useState<any[]>([]);
  const [classId, setClassId] = useState<string | null>(
    student?.classId || student?.class_id || student?.currentClassId || null,
  );
  // Live enrollment record — used as the primary source for rollNo so an
  // edit reactively updates the displayed roll without needing the parent
  // page to re-pass the prop. Parent / principal / owner dashboards also
  // read enrollment.rollNo first, so this matches their behaviour.
  const [liveEnrollment, setLiveEnrollment] = useState<{ rollNo?: string | number; classId?: string } | null>(null);
  const [calMonth, setCalMonth] = useState(new Date());
  const [feedbackText, setFeedbackText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Roll-number inline edit state. Persists via fan-out to all enrollment
  // docs for this student so parent / principal / owner dashboards (which
  // read enrollment.rollNo first, falling back to students/{id}.rollNo)
  // pick up the new value immediately.
  const [rollEditing, setRollEditing] = useState(false);
  const [rollDraft, setRollDraft]     = useState("");
  const [rollSaving, setRollSaving]   = useState(false);

  // Teacher's own enrollments for this student — used by the "Remove from
  // class" action. Only enrollments stamped with the current teacher's email
  // (post-2026-05-21 invite writer) are removable per Firestore rules; older
  // ones require admin (principal/owner) and won't appear here.
  type MyEnrollmentRow = { id: string; classId: string; className: string };
  const [myEnrollments, setMyEnrollments] = useState<MyEnrollmentRow[]>([]);
  const [removeOpen, setRemoveOpen]       = useState(false);
  const [removingId, setRemovingId]       = useState<string | null>(null);

  const sid = student.id || student.studentId || "";
  const email = (student.email || student.studentEmail || "").toLowerCase();

  const mergeById = (primary: any[], secondary: any[]) => {
    const map = new Map<string, any>();
    primary.forEach(d => map.set(d.id, d));
    secondary.forEach(d => { if (!map.has(d.id)) map.set(d.id, d); });
    return Array.from(map.values());
  };

  // ── Live subscriptions ─────────────────────────────────────────────────────
  // Error policy: enrichment-only listeners (students master doc, enrollments)
  // fail SILENTLY — prop already has visible fields. Data-bearing listeners
  // raise the error banner.
  useEffect(() => {
    if (!sid || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    let cancelled = false;
    const errH = (col: string, opts: { critical?: boolean } = {}) => (err: any) => {
      if (cancelled) return;
      const { critical = true } = opts;
      console.warn(`[StudentProfile/${col}] ${err.code}:`, err.message);
      if (!critical) return;
      if (err.code === "failed-precondition") {
        setError(`${col}: index missing — open the console link to create it.`);
      } else if (err.code === "permission-denied") {
        setError(`Couldn't load ${col}. Check your access for this student.`);
      }
    };
    const unsubs: Unsubscribe[] = [];

    unsubs.push(onSnapshot(
      doc(db, "students", sid),
      d => {
        if (cancelled) return;
        if (d.exists()) {
          setMasterProfile(d.data());
          const cid = (d.data() as any).classId;
          if (cid) setClassId(cid);
        }
      },
      errH("students", { critical: false }),
    ));

    const subscribePair = (
      col: string,
      setter: (arr: any[]) => void,
      cacheRef: { byId: any[]; byEmail: any[] },
    ) => {
      unsubs.push(onSnapshot(
        query(collection(db, col), where("schoolId", "==", schoolId), where("studentId", "==", sid)),
        snap => {
          if (cancelled) return;
          cacheRef.byId = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setter(mergeById(cacheRef.byId, cacheRef.byEmail));
        },
        errH(`${col} byId`),
      ));
      if (email) {
        unsubs.push(onSnapshot(
          query(collection(db, col), where("schoolId", "==", schoolId), where("studentEmail", "==", email)),
          snap => {
            if (cancelled) return;
            cacheRef.byEmail = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setter(mergeById(cacheRef.byId, cacheRef.byEmail));
          },
          errH(`${col} byEmail`),
        ));
      }
    };

    const attCache = { byId: [] as any[], byEmail: [] as any[] };
    // Dedup across (student, day) — see lib/attendanceDedup. Same student
    // in multiple classes can have separate docs per class for the same
    // day; aggregations (attendance %, monthly trend) would double-count.
    subscribePair("attendance", (docs) => setAttendance(dedupAttendanceByDay(docs)), attCache);

    const tsCache = { byId: [] as any[], byEmail: [] as any[] };
    const gsCache = { byId: [] as any[], byEmail: [] as any[] };
    const rsCache = { byId: [] as any[], byEmail: [] as any[] };
    const applyTS = () => { if (!cancelled) setTestScores([
      ...mergeById(tsCache.byId, tsCache.byEmail),
      ...mergeById(rsCache.byId, rsCache.byEmail),
    ]); };
    const applyGS = () => { if (!cancelled) setGradebookScores(mergeById(gsCache.byId, gsCache.byEmail)); };
    subscribePair("test_scores", applyTS, tsCache);
    subscribePair("gradebook_scores", applyGS, gsCache);
    subscribePair("results", applyTS, rsCache);

    const subCache = { byId: [] as any[], byEmail: [] as any[] };
    subscribePair("submissions", setSubmissions, subCache);

    unsubs.push(onSnapshot(
      query(collection(db, "incidents"), where("schoolId", "==", schoolId), where("studentId", "==", sid)),
      snap => { if (!cancelled) setIncidents(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      errH("incidents"),
    ));
    unsubs.push(onSnapshot(
      query(collection(db, "parent_notes"), where("schoolId", "==", schoolId), where("studentId", "==", sid)),
      snap => {
        if (cancelled) return;
        // Sort newest-first client-side — Firestore default order is by doc id,
        // so without this "Last: …" badges and "Recent" lists are random.
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        docs.sort((a, b) => writerTimeMs(b) - writerTimeMs(a));
        setParentNotes(docs);
      },
      errH("parent_notes"),
    ));
    unsubs.push(onSnapshot(
      query(collection(db, "interventions"), where("schoolId", "==", schoolId), where("studentId", "==", sid)),
      snap => { if (!cancelled) setInterventions(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      errH("interventions"),
    ));
    // Enrollments — also captures live rollNo so the inline roll-edit feedback
    // is reactive (saving a new roll triggers this listener which updates the
    // UI without any optimistic local state). Falls through silently on rules
    // denial — prop already carries classId in most entry-points.
    unsubs.push(onSnapshot(
      query(collection(db, "enrollments"), where("schoolId", "==", schoolId), where("studentId", "==", sid)),
      snap => {
        if (cancelled) return;
        if (!snap.empty) {
          const first = snap.docs[0].data() as any;
          if (first.classId) setClassId(first.classId);
          setLiveEnrollment({ rollNo: first.rollNo, classId: first.classId });
        }
      },
      errH("enrollments", { critical: false }),
    ));

    // Teacher's own enrollments for this student — drives the "Remove from
    // class" picker. Query by `teacherId` (always populated, both old and new
    // enrollments) so the button shows up universally. Old enrollments without
    // `teacherEmail` are still listed; the delete handler will lazy-backfill
    // teacherEmail before the actual deleteDoc so the rule passes.
    if (teacherData?.id) {
      unsubs.push(onSnapshot(
        query(collection(db, "enrollments"),
          where("schoolId", "==", schoolId),
          where("studentId", "==", sid),
          where("teacherId", "==", teacherData.id),
        ),
        snap => {
          if (cancelled) return;
          setMyEnrollments(snap.docs.map(d => {
            const dt = d.data() as any;
            return {
              id: d.id,
              classId: (dt.classId as string) || "",
              className: (dt.className as string) || "",
            };
          }));
        },
        errH("enrollments-mine", { critical: false }),
      ));
    }

    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, [sid, email, teacherData?.schoolId, teacherData?.email, refreshKey]);

  useEffect(() => {
    if (!classId || !teacherData?.schoolId) return;
    let cancelled = false;
    const unsub = onSnapshot(
      query(collection(db, "assignments"), where("schoolId", "==", teacherData.schoolId), where("classId", "==", classId)),
      snap => { if (!cancelled) setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      err => console.warn("[StudentProfile/assignments]", err.code),
    );
    return () => { cancelled = true; unsub(); };
  }, [classId, teacherData?.schoolId, refreshKey]);

  // ── Metrics ───────────────────────────────────────────────────────────────
  const allScoreDocs = useMemo(() => [...testScores, ...gradebookScores], [testScores, gradebookScores]);
  const recentScoreDocs = useMemo(() => {
    const cutoff = Date.now() - SCORE_WINDOW_MS;
    return allScoreDocs.filter(d => writerTimeMs(d) >= cutoff);
  }, [allScoreDocs]);

  const m = useMemo(() => {
    const tot = attendance.length;
    const pres = attendance.filter(r => r.status === "present").length;
    const late = attendance.filter(r => r.status === "late").length;
    const abs = tot - pres - late;
    const attRate: number | null = tot > 0 ? ((pres + late) / tot) * 100 : null;

    const recentNonAbsent = recentScoreDocs.filter((t: any) => !t.isAbsent);
    const recentPcts = recentNonAbsent.map(pctOfDoc).filter((v): v is number => v !== null);
    const avg: number | null = recentPcts.length > 0 ? recentPcts.reduce((a, b) => a + b, 0) / recentPcts.length : null;

    const subAcc: Record<string, { total: number; count: number }> = {};
    allScoreDocs.forEach((t: any) => {
      const sub = (t.subject || t.subjectName || "General").toUpperCase();
      const pct = pctOfDoc(t);
      if (pct === null) return;
      if (!subAcc[sub]) subAcc[sub] = { total: 0, count: 0 };
      subAcc[sub].total += pct;
      subAcc[sub].count += 1;
    });
    const subScores: Record<string, number> = {};
    Object.keys(subAcc).forEach(k => { subScores[k] = Math.round(subAcc[k].total / subAcc[k].count); });

    const sorted = [...allScoreDocs].sort((a, b) => writerTimeMs(b) - writerTimeMs(a));
    const r3 = sorted.slice(0, 3).map(pctOfDoc).filter((v): v is number => v !== null);
    const p3 = sorted.slice(3, 6).map(pctOfDoc).filter((v): v is number => v !== null);
    const rA = r3.length ? r3.reduce((a, b) => a + b, 0) / r3.length : null;
    const pA = p3.length ? p3.reduce((a, b) => a + b, 0) / p3.length : null;
    let trend: "up" | "down" | "flat" = "flat";
    if (rA != null && pA != null) {
      if (rA - pA >= 5) trend = "up";
      else if (pA - rA >= 5) trend = "down";
    }

    const now = new Date();
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const mAtt = attendance.filter((r: any) => {
        const ms = writerTimeMs(r) || (r.date ? new Date(r.date).getTime() : 0);
        if (!ms) return false;
        const dt = new Date(ms);
        return dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear();
      });
      const mScores = allScoreDocs.filter((t: any) => {
        const ms = writerTimeMs(t);
        if (!ms) return false;
        const dt = new Date(ms);
        return dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear();
      });
      const mPres = mAtt.filter((r: any) => r.status === "present" || r.status === "late").length;
      const mPcts = mScores.map(pctOfDoc).filter((v): v is number => v !== null);
      const scoreAvg = mPcts.length > 0 ? mPcts.reduce((a, b) => a + b, 0) / mPcts.length : null;
      return {
        month: MONTHS[d.getMonth()],
        score: scoreAvg != null ? Math.round(scoreAvg) : null,
        attendance: mAtt.length > 0 ? Math.round((mPres / mAtt.length) * 100) : null,
      };
    });

    // Submissions filtered to THIS class's assignments only — prevents
    // multi-enrolled students from inflating completion past 100%.
    const classAsgIds = new Set(assignments.map((a: any) => a.id));
    const classSubmissions = submissions.filter((s: any) => classAsgIds.has(s.assignmentId));
    const completion: number | null = assignments.length > 0
      ? Math.min(100, (classSubmissions.length / assignments.length) * 100)
      : null;
    const days = new Set(attendance.map((a: any) => toDate(a.date)?.toDateString())).size;

    return { tot, pres, late, abs, attRate, avg, subScores, trend, monthly, completion, days, subCount: classSubmissions.length, asgCount: assignments.length };
  }, [attendance, allScoreDocs, recentScoreDocs, submissions, assignments]);

  const overallRisk = useMemo<number | null>(() => {
    const parts: number[] = [];
    if (m.attRate != null)    parts.push(Math.max(0, 100 - m.attRate));
    if (m.avg != null)        parts.push(Math.max(0, 100 - m.avg));
    if (m.completion != null) parts.push(Math.max(0, 100 - m.completion));
    if (incidents.length > 0) parts.push(Math.min(100, incidents.length * 25));
    if (parts.length === 0) return null;
    return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }, [m.attRate, m.avg, m.completion, incidents.length]);

  const { riskLevel, riskColor, riskTone } = useMemo<{ riskLevel: string; riskColor: string; riskTone: Tone }>(() => {
    if (overallRisk == null) return { riskLevel: "NO DATA",  riskColor: T.ink3, riskTone: "blue" };
    if (overallRisk < 20)    return { riskLevel: "STABLE",   riskColor: T.grn,  riskTone: "green" };
    if (overallRisk < 45)    return { riskLevel: "MONITOR",  riskColor: T.amb,  riskTone: "amber" };
    if (overallRisk < 70)    return { riskLevel: "ELEVATED", riskColor: T.amb,  riskTone: "amber" };
    return { riskLevel: "CRITICAL", riskColor: T.red, riskTone: "red" };
  }, [overallRisk]);

  const subEntries = Object.entries(m.subScores);
  const radarData = subEntries.map(([s, sc]) => ({ subject: s.slice(0, 10), score: sc, fullMark: 100 }));
  const initials = (student.name || student.studentName || "?").split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
  const sName = student.name || student.studentName || "Student";

  // Calendar — local date-key comparison (avoids ISO/UTC drift in non-UTC TZs).
  const localDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const calY = calMonth.getFullYear(), calM = calMonth.getMonth();
  const firstD = new Date(calY, calM, 1).getDay(), dim = new Date(calY, calM + 1, 0).getDate();
  const calDays = Array.from({ length: 42 }, (_, i) => {
    const dn = i - firstD + 1;
    if (dn < 1 || dn > dim) return null;
    const d = new Date(calY, calM, dn);
    const ds = localDateKey(d);
    const rec = attendance.find((a: any) => {
      const ad = toDate(a.date);
      return ad && localDateKey(ad) === ds;
    });
    return { dayNum: dn, date: d, status: rec?.status || null };
  });
  const calP = attendance.filter((a: any) => { const d = toDate(a.date); return d && d.getMonth() === calM && d.getFullYear() === calY && a.status === "present"; }).length;
  const calL = attendance.filter((a: any) => { const d = toDate(a.date); return d && d.getMonth() === calM && d.getFullYear() === calY && a.status === "late"; }).length;
  const calA = attendance.filter((a: any) => { const d = toDate(a.date); return d && d.getMonth() === calM && d.getFullYear() === calY && a.status === "absent"; }).length;

  const scoreHist = useMemo(() => [...allScoreDocs]
    .sort((a, b) => writerTimeMs(b) - writerTimeMs(a))
    .slice(0, 6),
  [allScoreDocs]);
  // Filter out docs with no extractable score so the bar chart never shows
  // a fake 0% bar where the data was actually missing.
  const barData = useMemo(() => [...scoreHist].reverse()
    .map(t => ({ name: ((t as any).subject || "TEST").slice(0, 8), score: pctOfDoc(t) }))
    .filter(b => b.score != null) as Array<{ name: string; score: number }>,
  [scoreHist]);

  // Trend-aware prediction: extrapolates from the last-3 vs prior-3 slope.
  // Replaces the old "avg + (100-avg)*0.05" formula that always nudged up,
  // contradicting a declining trend.
  const prediction = useMemo<number | null>(() => {
    if (m.avg == null) return null;
    const sorted = [...allScoreDocs].sort((a, b) => writerTimeMs(b) - writerTimeMs(a));
    const r3 = sorted.slice(0, 3).map(pctOfDoc).filter((v): v is number => v != null);
    if (r3.length === 0) return null;
    const rA = r3.reduce((a, b) => a + b, 0) / r3.length;
    const p3 = sorted.slice(3, 6).map(pctOfDoc).filter((v): v is number => v != null);
    if (p3.length === 0) return Math.round(rA);
    const pA = p3.reduce((a, b) => a + b, 0) / p3.length;
    const slope = rA - pA;
    return Math.round(Math.max(0, Math.min(100, rA + slope * 0.5)));
  }, [allScoreDocs, m.avg]);

  // Last write timestamp across every collection — replaces the hardcoded
  // "Data: Live" footer claim with a real freshness signal.
  const lastDataUpdate = useMemo<number | null>(() => {
    const all = [...attendance, ...allScoreDocs, ...submissions, ...incidents, ...parentNotes, ...interventions];
    const ts = all.map(writerTimeMs).filter(t => t > 0);
    return ts.length === 0 ? null : Math.max(...ts);
  }, [attendance, allScoreDocs, submissions, incidents, parentNotes, interventions]);

  // Reply-rate from parents — replaces fabricated `parentNotes.length * 20`
  // engagement metric in the footer.
  const replyRate = useMemo<number | null>(() => {
    if (parentNotes.length === 0) return null;
    return Math.round((parentNotes.filter(n => n.from === "parent").length / parentNotes.length) * 100);
  }, [parentNotes]);

  // Real student status pill — replaces hardcoded "ACTIVE" badge.
  const statusInfo = useMemo<{ label: string; color: string; bg: string }>(() => {
    const raw = (masterProfile?.status || student?.status || "active").toString().toLowerCase();
    if (raw === "active" || raw === "enrolled") return { label: "ACTIVE", color: T.grn, bg: T.glBg };
    if (raw === "inactive")     return { label: "INACTIVE",   color: T.amb,  bg: T.alBg };
    if (raw === "withdrawn")    return { label: "WITHDRAWN",  color: T.red,  bg: T.rlBg };
    if (raw === "transferred")  return { label: "TRANSFERRED", color: T.amb, bg: T.alBg };
    if (raw === "graduated")    return { label: "GRADUATED",  color: T.blue, bg: T.blBg };
    if (raw === "invited")      return { label: "INVITED",    color: T.violet, bg: T.vlBg };
    return { label: raw.toUpperCase(), color: T.ink2, bg: T.s2 };
  }, [masterProfile?.status, student?.status]);

  // Roll-number editor — single source of truth is the enrollments collection.
  // Parent / principal / owner dashboards all read `enrollment.rollNo` first
  // (fallback to students master doc), so updating every matching enrollment
  // propagates the change school-wide. We also best-effort-update the master
  // students doc; current Firestore rules typically deny teacher writes there
  // (only owner/principal/the student can update master), so that write is
  // wrapped in try/catch and logged.
  // Live enrollment is the freshest source (updates the moment we save),
  // followed by the students master doc, then the prop snapshot from the
  // parent page.
  const displayRoll = (
    liveEnrollment?.rollNo ??
    masterProfile?.rollNo ??
    student?.rollNo ??
    student?.roll ??
    ""
  ).toString();

  const startRollEdit = () => { setRollDraft(displayRoll); setRollEditing(true); };

  const saveRoll = async () => {
    if (!sid || !teacherData?.schoolId) return;
    const newRoll = rollDraft.trim();
    setRollSaving(true);
    try {
      // 1) Find every enrollment for this student in this school. Try by
      // studentId first; if that returns nothing, fall back to studentEmail
      // (per dual_query_pattern memory — enrollments may have been written
      // with different identifier shapes).
      let enrDocs: { id: string }[] = [];
      const byIdSnap = await getDocs(query(
        collection(db, "enrollments"),
        where("schoolId", "==", teacherData.schoolId),
        where("studentId", "==", sid),
      ));
      enrDocs = byIdSnap.docs.map(d => ({ id: d.id }));
      if (enrDocs.length === 0 && email) {
        const byEmailSnap = await getDocs(query(
          collection(db, "enrollments"),
          where("schoolId", "==", teacherData.schoolId),
          where("studentEmail", "==", email),
        ));
        enrDocs = byEmailSnap.docs.map(d => ({ id: d.id }));
      }

      // 2) Update every matching enrollment. Use allSettled so a single
      // failure (e.g., a stale doc) doesn't block the rest.
      const enrResults = await Promise.allSettled(
        enrDocs.map(d => auditedUpdate(doc(db, "enrollments", d.id), { rollNo: newRoll })),
      );
      const enrFailed = enrResults.filter(r => r.status === "rejected").length;

      // 3) Best-effort update the students master doc. Rules usually deny
      // teacher writes to /students/{id} — silent on permission failure.
      try {
        await auditedUpdate(doc(db, "students", sid), { rollNo: newRoll });
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err.code !== "permission-denied") {
          console.warn("[StudentProfile] master rollNo update failed:", err);
        }
      }

      if (enrDocs.length === 0) {
        toast.error("No enrollment found for this student");
        return;
      }
      if (enrFailed === enrDocs.length) {
        toast.error("Couldn't update roll number");
        return;
      }
      toast.success(enrFailed > 0
        ? `Roll updated (${enrDocs.length - enrFailed}/${enrDocs.length})`
        : "Roll number updated");
      setRollEditing(false);
    } catch (e) {
      console.error("[StudentProfile] saveRoll failed", e);
      toast.error("Couldn't update roll number");
    } finally {
      setRollSaving(false);
    }
  };

  const handleSendFeedback = async () => {
    const content = feedbackText.trim();
    if (!content || !teacherData?.id) return;
    setSending(true);
    try {
      await auditedAdd(collection(db, "parent_notes"), {
        teacherId: teacherData.id, teacherName: teacherData.name || "Teacher",
        studentId: sid, studentEmail: email, studentName: sName,
        schoolId: teacherData.schoolId || "", branchId: teacherData.branchId || "",
        content, from: "teacher", createdAt: serverTimestamp(),
      });
      setFeedbackText(""); toast.success("Feedback sent!");
    } catch (e) {
      console.error("[StudentProfile] feedback send failed", e);
      toast.error("Failed to send.");
    }
    setSending(false);
  };

  // Remove this student from a specific class the teacher owns. Deletes ONLY
  // the enrollment doc — the student's master record (and other teachers'
  // enrollments) stay intact.
  //
  // For old enrollments (pre-2026-05-21) that lack `teacherEmail`, we do a
  // lazy backfill BEFORE deleting — write the field, then delete. The Firestore
  // rule requires teacherEmail-match, so this two-step keeps the UX one-click
  // while letting old enrollments stay deletable by their owning teacher.
  //
  // Cross-dashboard impact: parent-dashboard class roster shrinks immediately;
  // principal/owner aggregators recompute on next snapshot.
  const handleRemoveFromClass = async (enrollmentId: string, className: string) => {
    if (!enrollmentId) return;
    setRemovingId(enrollmentId);
    try {
      // Lazy backfill teacherEmail so the delete rule's email match passes
      const myEmailLower = (teacherData?.email || "").toLowerCase();
      if (myEmailLower) {
        try {
          await auditedUpdate(doc(db, "enrollments", enrollmentId), {
            teacherEmail: myEmailLower,
          });
        } catch (backfillErr: unknown) {
          // Update may fail (e.g., schoolId immutability triggered by stale
          // server side, or already-deleted doc). Ignore and let deleteDoc
          // surface the real error.
          console.warn("[StudentProfile] teacherEmail backfill failed:", backfillErr);
        }
      }

      await deleteDoc(doc(db, "enrollments", enrollmentId));
      toast.success(`${sName} removed from ${className || "class"}.`);
      // Optimistic local update so the picker shrinks immediately even
      // before the snapshot listener fires
      setMyEnrollments(prev => prev.filter(e => e.id !== enrollmentId));
      // If the teacher just removed their last enrollment for this student,
      // close the dialog and bounce back to the roster.
      if (myEnrollments.length <= 1) {
        setRemoveOpen(false);
        if (onBack) onBack();
      }
    } catch (e: unknown) {
      const err = e as { code?: string };
      console.error("[StudentProfile] remove enrollment failed:", err);
      if (err?.code === "permission-denied") {
        toast.error("Not allowed. Only the class teacher (or principal) can remove this enrollment.");
      } else {
        toast.error("Couldn't remove from class. Try again.");
      }
    } finally {
      setRemovingId(null);
    }
  };

  const today = new Date();
  const fmtPct = (v: number | null) => v != null ? `${Math.round(v)}%` : "—";

  // Tone for academic card based on avg
  const academicTone: Tone = m.avg == null ? "blue" : m.avg >= 75 ? "blue" : m.avg >= 50 ? "amber" : "red";
  const attTone: Tone = m.attRate == null ? "green" : m.attRate >= 85 ? "green" : "amber";

  // CONTACT — deep-links to ParentNotes page and auto-opens this student's
  // chat. ParentNotes reads location.state.autoOpenStudentId/Email and
  // matches dual-key (id then email) — see dual_query_pattern memory and
  // ParentNotes.tsx:164. Same handoff shape as ConceptMasteryDetail's
  // "Contact Parent" button.
  const feedbackInputRef = useRef<HTMLInputElement>(null);
  const handleContact = () => {
    if (embedded) {
      // When rendered inside another page (e.g. Students.tsx) navigation
      // would unmount us; warn rather than crash.
      toast.message("Open Parent Notes to message — coming up.");
    }
    navigate("/parent-notes", {
      state: {
        autoOpenStudentId:    sid,
        autoOpenStudentEmail: email,
        autoOpenStudentName:  sName,
      },
    });
  };

  return (
    <div className="min-h-screen pb-[72px] md:pb-0"
      style={{ minHeight: embedded ? "auto" : "100vh", background: T.bg, fontFamily: T.FONT }}>
      {error && (
        <div className="px-4 pt-3 md:px-6 md:pt-4">
          <div className="rounded-[14px] flex items-start gap-3 px-4 py-3"
            style={{ background: "rgba(255,51,85,0.08)", border: "0.5px solid rgba(255,51,85,0.30)", boxShadow: "0 2px 10px rgba(255,51,85,0.10)" }}>
            <AlertCircle size={18} style={{ color: "#C92A2A", flexShrink: 0, marginTop: 2 }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold" style={{ color: "#7A1414", letterSpacing: "-0.1px" }}>Couldn't load profile</div>
              <div className="text-[11px] mt-[2px]" style={{ color: "#A33333" }}>{error}</div>
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

      <div className="px-4 sm:px-6 py-4 sm:py-6">
        {/* Top action bar */}
        {!embedded && (
          <div className="flex items-center justify-between mb-4 sm:mb-5 gap-2">
            <button type="button" onClick={onBack}
              aria-label="Go back to student list"
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-[10px] active:scale-[0.96] transition-transform text-[12px] sm:text-[13px] font-semibold"
              style={{ background: T.white, border: `0.5px solid ${T.bdr}`, color: T.ink2, boxShadow: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10)" }}>
              <ArrowLeft size={14} /> RETURN
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => window.print()}
                aria-label="Print or export this student profile"
                className="hidden sm:inline-flex items-center px-3 py-2 rounded-[10px] text-[12px] font-semibold active:scale-[0.96] transition-transform"
                style={{ background: T.white, border: `0.5px solid ${T.bdr}`, color: T.ink2, boxShadow: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10)" }}>
                EXPORT
              </button>
              {myEnrollments.length > 0 && (
                <button type="button" onClick={() => setRemoveOpen(true)}
                  aria-label="Remove this student from one of your classes"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[12px] font-bold active:scale-[0.96] transition-transform"
                  style={{ background: T.white, border: "0.5px solid rgba(255,69,58,0.30)", color: "#C71F2D", boxShadow: "0 0 0 0.5px rgba(255,69,58,0.10), 0 2px 10px rgba(255,69,58,0.10)" }}>
                  <Trash2 size={13} /> REMOVE
                </button>
              )}
              <button type="button" onClick={handleContact}
                aria-label="Contact student's parent"
                className="px-3 sm:px-4 py-2 rounded-[10px] text-white text-[12px] font-bold active:scale-[0.96] transition-transform"
                style={{ background: T.blue, boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 10px rgba(9,87,247,0.3)" }}>
                CONTACT
              </button>
            </div>
          </div>
        )}

        {/* ═══ HERO 3-COL — desktop / mobile stack ═══ */}
        <div className="grid gap-4 sm:gap-5 mb-4 sm:mb-5" style={{ gridTemplateColumns: "1fr" }}>
          <div className="hidden lg:grid" style={{ gridTemplateColumns: "1fr 280px 1fr", gap: 20, alignItems: "start" }}>
            {/* LEFT */}
            <div className="flex flex-col gap-4">
              <VibeCard tone={academicTone} icon={GraduationCap} decorIcon={BarChart3} label="Academic Performance">
                <Headline value={fmtPct(m.avg)} sub={
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    Avg · {testScores.length + gradebookScores.length} record{testScores.length + gradebookScores.length === 1 ? "" : "s"}
                    {m.trend === "up" && <TrendingUp size={11} color={T.grn} />}
                    {m.trend === "down" && <TrendingUp size={11} color={T.red} style={{ transform: "rotate(180deg)" }} />}
                  </span>
                } subTone={academicTone} />
                <div style={{ marginTop: 12 }}>
                  {subEntries.length === 0 ? (
                    <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "8px 0" }}>No subject data yet</p>
                  ) : subEntries.slice(0, 4).map(([sub, sc]) => (
                    <div key={sub} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: T.ink2, width: 90, flexShrink: 0, fontWeight: 600 }}>{sub}</span>
                      <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.55)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${sc}%`, background: sc >= 75 ? T.blue : sc >= 50 ? T.amb : T.red, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.ink, width: 26, textAlign: "right" }}>{sc}</span>
                    </div>
                  ))}
                </div>
              </VibeCard>
              <VibeCard tone={attTone} icon={Calendar} label="Attendance">
                <Headline value={fmtPct(m.attRate)} sub={m.attRate != null ? `${m.late} late · ${m.abs} abs` : "Awaiting data"} subTone={attTone} />
                <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                  <div style={{ flex: 1, padding: "6px 8px", background: "rgba(255,255,255,0.55)", borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.grn }}>{m.pres}</div>
                    <div style={{ fontSize: 9, color: T.ink2, fontWeight: 600 }}>PRESENT</div>
                  </div>
                  <div style={{ flex: 1, padding: "6px 8px", background: "rgba(255,255,255,0.55)", borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.amb }}>{m.late}</div>
                    <div style={{ fontSize: 9, color: T.ink2, fontWeight: 600 }}>LATE</div>
                  </div>
                  <div style={{ flex: 1, padding: "6px 8px", background: "rgba(255,255,255,0.55)", borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.red }}>{m.abs}</div>
                    <div style={{ fontSize: 9, color: T.ink2, fontWeight: 600 }}>ABSENT</div>
                  </div>
                </div>
              </VibeCard>
              <VibeCard tone="violet" icon={Activity} label="Subject Mastery" action={<DLink tone="violet" />}>
                {radarData.length >= 3 ? (
                  <div style={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                        <PolarGrid stroke="rgba(123,63,244,0.18)" />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: T.ink2, fontSize: 9, fontWeight: 600 }} />
                        <Radar dataKey="score" stroke={T.violet} fill={T.violet} fillOpacity={0.20} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                ) : subEntries.length > 0 ? (
                  <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "10px 0" }}>Need 3+ subjects for radar</p>
                ) : (
                  <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "12px 0" }}>No subjects tracked</p>
                )}
              </VibeCard>
            </div>

            {/* CENTER avatar */}
            <div className="flex flex-col items-center pt-5">
              <div style={{
                width: 140, height: 140, borderRadius: "50%",
                background: T.HERO_GRAD,
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 16,
                boxShadow: "0 8px 30px rgba(0,85,255,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
                border: "0.5px solid rgba(255,255,255,0.22)",
              }}>
                <span style={{ fontSize: 42, fontWeight: 700, color: "#fff", letterSpacing: "-1.2px" }}>{initials}</span>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: T.ink, textAlign: "center", marginBottom: 4, letterSpacing: "-0.5px" }}>{sName}</h2>
              <p style={{ fontSize: 12, color: T.ink2, textAlign: "center", marginBottom: 4 }}>{student.className || student.class || masterProfile?.className || "—"}</p>
              {!rollEditing ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 12, fontSize: 11, color: T.ink3 }}>
                  <span>Roll: {displayRoll || "—"}</span>
                  <button type="button" onClick={startRollEdit} aria-label="Edit roll number"
                    style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, color: T.blue, display: "flex", alignItems: "center" }}>
                    <Pencil size={11} strokeWidth={2.4} />
                  </button>
                  <span>· ID: {sid.slice(0, 6).toUpperCase()}</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, color: T.ink3 }}>Roll:</span>
                  <input value={rollDraft} onChange={e => setRollDraft(e.target.value)} autoFocus maxLength={20} disabled={rollSaving}
                    aria-label="Roll number"
                    onKeyDown={e => { if (e.key === "Enter") saveRoll(); if (e.key === "Escape") setRollEditing(false); }}
                    style={{ width: 70, fontSize: 11, padding: "3px 7px", borderRadius: 6, border: `0.5px solid ${T.bdr2}`, outline: "none", background: T.white, color: T.ink, fontFamily: T.FONT }} />
                  <button type="button" onClick={saveRoll} disabled={rollSaving} aria-label="Save roll number"
                    style={{ background: T.grn, border: "none", cursor: rollSaving ? "not-allowed" : "pointer", padding: "3px 5px", borderRadius: 5, color: "#fff", display: "flex", alignItems: "center", opacity: rollSaving ? 0.6 : 1 }}>
                    {rollSaving ? <RefreshCw size={10} className="animate-spin" /> : <Check size={11} strokeWidth={3} />}
                  </button>
                  <button type="button" onClick={() => setRollEditing(false)} disabled={rollSaving} aria-label="Cancel"
                    style={{ background: T.s2, border: "none", cursor: "pointer", padding: "3px 5px", borderRadius: 5, color: T.ink2, display: "flex", alignItems: "center" }}>
                    <XIcon size={11} strokeWidth={2.4} />
                  </button>
                </div>
              )}
              <div className="flex gap-1.5 flex-wrap justify-center">
                <span style={{ padding: "4px 12px", borderRadius: 20, background: statusInfo.bg, color: statusInfo.color, fontSize: 10, fontWeight: 700, letterSpacing: "0.4px" }}>{statusInfo.label}</span>
                <span style={{
                  padding: "4px 12px", borderRadius: 20,
                  background: riskColor === T.grn ? T.glBg : riskColor === T.amb ? T.alBg : riskColor === T.red ? T.rlBg : T.s2,
                  color: riskColor, fontSize: 10, fontWeight: 700, letterSpacing: "0.4px",
                }}>{riskLevel}</span>
              </div>
            </div>

            {/* RIGHT */}
            <div className="flex flex-col gap-4">
              <VibeCard tone={incidents.length === 0 ? "green" : "red"} icon={ShieldAlert} decorIcon={AlertCircle} label="Behaviour Record" action={<DLink tone={incidents.length === 0 ? "green" : "red"} />}>
                <Headline value={incidents.length === 0 ? "Clean" : `${incidents.length} event${incidents.length === 1 ? "" : "s"}`}
                  sub={incidents.length === 0 ? "No incidents on record" : "Needs review"}
                  subTone={incidents.length === 0 ? "green" : "red"} />
                <div style={{ marginTop: 10 }}>
                  {incidents.slice(0, 2).map(inc => (
                    <div key={inc.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", background: "rgba(255,255,255,0.55)", borderRadius: 8, marginBottom: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: T.red, marginTop: 6, flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: T.red, letterSpacing: "0.3px" }}>{(inc.type || "INCIDENT").toUpperCase()}</div>
                        <p style={{ fontSize: 10, color: T.ink2, marginTop: 2, lineHeight: 1.4 }}>{(inc.description || inc.content || "").slice(0, 80)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </VibeCard>
              <VibeCard tone={prediction == null ? "blue" : m.trend === "down" ? "amber" : "blue"} icon={Sparkles} decorIcon={TrendingUp} label="Performance Outlook" action={<DLink tone="blue" />}>
                <Headline value={prediction != null ? `${prediction}%` : "—"}
                  sub={prediction == null ? "Awaiting score history"
                    : m.trend === "up" ? "Trending upward"
                    : m.trend === "down" ? "Trending downward"
                    : "Holding steady"}
                  subTone={prediction == null ? "blue" : m.trend === "down" ? "red" : m.trend === "up" ? "green" : "blue"} />
                <p style={{ fontSize: 10, color: T.ink2, marginTop: 8, lineHeight: 1.55 }}>
                  {prediction == null
                    ? "Outlook activates once score data is recorded."
                    : "Trend-based projection from recent vs prior 3 records."}
                </p>
              </VibeCard>
              <VibeCard tone="green" icon={MessageSquare} label="Parent Communication" action={<DLink tone="green" />}>
                <Headline value={parentNotes.length}
                  sub={parentNotes.length === 0 ? "No messages yet" : `Last: ${timeAgo(parentNotes[0]?.createdAt)}`}
                  subTone="green" />
                <div style={{ marginTop: 10 }}>
                  {parentNotes.slice(0, 1).map(n => (
                    <div key={n.id} style={{ padding: "8px 10px", background: "rgba(255,255,255,0.55)", borderRadius: 8 }}>
                      <div style={{ fontSize: 10, color: n.from === "teacher" ? T.blue : T.grn, fontWeight: 700, marginBottom: 2, letterSpacing: "0.3px" }}>
                        {n.from === "teacher" ? (n.teacherName || "TEACHER") : "PARENT"} · {timeAgo(n.createdAt)}
                      </div>
                      <p style={{ fontSize: 10, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{(n.content || n.message || "").slice(0, 90)}</p>
                    </div>
                  ))}
                </div>
              </VibeCard>
              <VibeCard tone="violet" icon={FileText} label="Teacher Observations">
                {parentNotes.filter(n => n.from === "teacher").length > 0 ? (
                  <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.55)", borderLeft: `3px solid ${T.violet}`, borderRadius: 8 }}>
                    <p style={{ fontSize: 11, color: T.ink2, lineHeight: 1.55, margin: 0, fontStyle: "italic" }}>
                      "{(parentNotes.find(n => n.from === "teacher")?.content || "").slice(0, 140)}"
                    </p>
                  </div>
                ) : (
                  <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "10px 0" }}>No observations yet</p>
                )}
              </VibeCard>
            </div>
          </div>

          {/* MOBILE / TABLET */}
          <div className="lg:hidden flex flex-col gap-4 sm:gap-5">
            <div className="flex flex-col items-center py-2">
              <div style={{
                width: 120, height: 120, borderRadius: "50%",
                background: T.HERO_GRAD,
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 12,
                boxShadow: "0 8px 30px rgba(0,85,255,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
                border: "0.5px solid rgba(255,255,255,0.22)",
              }}>
                <span style={{ fontSize: 36, fontWeight: 700, color: "#fff", letterSpacing: "-1px" }}>{initials}</span>
              </div>
              <h2 className="text-[20px] font-bold text-center mb-1" style={{ color: T.ink, letterSpacing: "-0.5px" }}>{sName}</h2>
              <p className="text-[12px] text-center mb-1" style={{ color: T.ink2 }}>{student.className || student.class || masterProfile?.className || "—"}</p>
              {!rollEditing ? (
                <div className="flex items-center justify-center gap-1 mb-2.5" style={{ fontSize: 11, color: T.ink3 }}>
                  <span>Roll: {displayRoll || "—"}</span>
                  <button type="button" onClick={startRollEdit} aria-label="Edit roll number"
                    style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, color: T.blue, display: "flex", alignItems: "center" }}>
                    <Pencil size={11} strokeWidth={2.4} />
                  </button>
                  <span>· ID: {sid.slice(0, 6).toUpperCase()}</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1 mb-2.5">
                  <span style={{ fontSize: 11, color: T.ink3 }}>Roll:</span>
                  <input value={rollDraft} onChange={e => setRollDraft(e.target.value)} autoFocus maxLength={20} disabled={rollSaving}
                    aria-label="Roll number"
                    onKeyDown={e => { if (e.key === "Enter") saveRoll(); if (e.key === "Escape") setRollEditing(false); }}
                    style={{ width: 70, fontSize: 11, padding: "3px 7px", borderRadius: 6, border: `0.5px solid ${T.bdr2}`, outline: "none", background: T.white, color: T.ink, fontFamily: T.FONT }} />
                  <button type="button" onClick={saveRoll} disabled={rollSaving} aria-label="Save roll number"
                    style={{ background: T.grn, border: "none", cursor: rollSaving ? "not-allowed" : "pointer", padding: "3px 5px", borderRadius: 5, color: "#fff", display: "flex", alignItems: "center", opacity: rollSaving ? 0.6 : 1 }}>
                    {rollSaving ? <RefreshCw size={10} className="animate-spin" /> : <Check size={11} strokeWidth={3} />}
                  </button>
                  <button type="button" onClick={() => setRollEditing(false)} disabled={rollSaving} aria-label="Cancel"
                    style={{ background: T.s2, border: "none", cursor: "pointer", padding: "3px 5px", borderRadius: 5, color: T.ink2, display: "flex", alignItems: "center" }}>
                    <XIcon size={11} strokeWidth={2.4} />
                  </button>
                </div>
              )}
              <div className="flex gap-1.5 flex-wrap justify-center">
                <span style={{ padding: "4px 12px", borderRadius: 20, background: statusInfo.bg, color: statusInfo.color, fontSize: 10, fontWeight: 700, letterSpacing: "0.4px" }}>{statusInfo.label}</span>
                <span style={{
                  padding: "4px 12px", borderRadius: 20,
                  background: riskColor === T.grn ? T.glBg : riskColor === T.amb ? T.alBg : riskColor === T.red ? T.rlBg : T.s2,
                  color: riskColor, fontSize: 10, fontWeight: 700, letterSpacing: "0.4px",
                }}>{riskLevel}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <VibeCard tone={academicTone} icon={GraduationCap} decorIcon={BarChart3} label="Academic Performance">
                <Headline value={fmtPct(m.avg)} sub={`Avg · ${testScores.length + gradebookScores.length} record${testScores.length + gradebookScores.length === 1 ? "" : "s"}`} subTone={academicTone} />
                <div style={{ marginTop: 10 }}>
                  {subEntries.length === 0 ? (
                    <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "6px 0" }}>No subject data yet</p>
                  ) : subEntries.slice(0, 4).map(([sub, sc]) => (
                    <div key={sub} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 10, color: T.ink2, width: 80, flexShrink: 0, fontWeight: 600 }}>{sub}</span>
                      <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.55)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${sc}%`, background: sc >= 75 ? T.blue : sc >= 50 ? T.amb : T.red, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.ink, width: 26, textAlign: "right" }}>{sc}</span>
                    </div>
                  ))}
                </div>
              </VibeCard>
              <VibeCard tone={attTone} icon={Calendar} label="Attendance">
                <Headline value={fmtPct(m.attRate)} sub={m.attRate != null ? `${m.late} late · ${m.abs} abs` : "Awaiting data"} subTone={attTone} />
                <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                  <div style={{ flex: 1, padding: "6px", background: "rgba(255,255,255,0.55)", borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.grn }}>{m.pres}</div>
                    <div style={{ fontSize: 9, color: T.ink2, fontWeight: 600 }}>PRESENT</div>
                  </div>
                  <div style={{ flex: 1, padding: "6px", background: "rgba(255,255,255,0.55)", borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.amb }}>{m.late}</div>
                    <div style={{ fontSize: 9, color: T.ink2, fontWeight: 600 }}>LATE</div>
                  </div>
                  <div style={{ flex: 1, padding: "6px", background: "rgba(255,255,255,0.55)", borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.red }}>{m.abs}</div>
                    <div style={{ fontSize: 9, color: T.ink2, fontWeight: 600 }}>ABSENT</div>
                  </div>
                </div>
              </VibeCard>
              <VibeCard tone="violet" icon={Activity} label="Subject Mastery" action={<DLink tone="violet" />}>
                {radarData.length >= 3 ? (
                  <div style={{ height: 140 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                        <PolarGrid stroke="rgba(123,63,244,0.18)" />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: T.ink2, fontSize: 9 }} />
                        <Radar dataKey="score" stroke={T.violet} fill={T.violet} fillOpacity={0.20} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                ) : subEntries.length > 0 ? (
                  <div>
                    {subEntries.slice(0, 6).map(([sub, sc]) => (
                      <div key={sub} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={{ fontSize: 10, color: T.ink2, width: 80, flexShrink: 0, fontWeight: 600 }}>{sub}</span>
                        <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.55)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${sc}%`, background: sc >= 75 ? T.violet : sc >= 50 ? T.amb : T.red, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.ink, width: 26, textAlign: "right" }}>{sc}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 11, color: T.ink3, textAlign: "center" }}>No subjects yet</p>
                )}
              </VibeCard>
              <VibeCard tone={incidents.length === 0 ? "green" : "red"} icon={ShieldAlert} decorIcon={AlertCircle} label="Behaviour Record" action={<DLink tone={incidents.length === 0 ? "green" : "red"} />}>
                <Headline value={incidents.length === 0 ? "Clean" : `${incidents.length}`}
                  sub={incidents.length === 0 ? "No incidents" : `${incidents.length} event${incidents.length === 1 ? "" : "s"}`}
                  subTone={incidents.length === 0 ? "green" : "red"} />
              </VibeCard>
              <VibeCard tone={prediction == null ? "blue" : m.trend === "down" ? "amber" : "blue"} icon={Sparkles} decorIcon={TrendingUp} label="Performance Outlook" action={<DLink tone="blue" />}>
                <Headline value={prediction != null ? `${prediction}%` : "—"}
                  sub={prediction == null ? "Awaiting data"
                    : m.trend === "up" ? "Trending up"
                    : m.trend === "down" ? "Trending down"
                    : "Steady"}
                  subTone={prediction == null ? "blue" : m.trend === "down" ? "red" : m.trend === "up" ? "green" : "blue"} />
              </VibeCard>
              <VibeCard tone="green" icon={MessageSquare} label="Parent Communication" action={<DLink tone="green" />}>
                <Headline value={parentNotes.length} sub={parentNotes.length === 0 ? "No messages" : `Last: ${timeAgo(parentNotes[0]?.createdAt)}`} subTone="green" />
              </VibeCard>
              <VibeCard tone="violet" icon={FileText} label="Teacher Observations" style={{ gridColumn: "1 / -1" }}>
                {parentNotes.filter(n => n.from === "teacher").length > 0 ? (
                  <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.55)", borderLeft: `3px solid ${T.violet}`, borderRadius: 8 }}>
                    <p style={{ fontSize: 11, color: T.ink2, lineHeight: 1.55, margin: 0, fontStyle: "italic" }}>
                      "{(parentNotes.find(n => n.from === "teacher")?.content || "").slice(0, 140)}"
                    </p>
                  </div>
                ) : (
                  <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "8px 0" }}>No observations yet</p>
                )}
              </VibeCard>
            </div>
          </div>
        </div>

        {/* Performance Timeline */}
        <VibeCard tone="blue" icon={TrendingUp} decorIcon={Activity} label="Performance Timeline" action={<DLink tone="blue" />} style={{ marginBottom: 20 }}>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={m.monthly}>
                <defs>
                  <linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={T.blue} stopOpacity={0.30} />
                    <stop offset="95%" stopColor={T.blue} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={T.grn} stopOpacity={0.22} />
                    <stop offset="95%" stopColor={T.grn} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,85,255,0.10)" />
                <XAxis dataKey="month" tick={{ fill: T.ink2, fontSize: 11, fontWeight: 600 }} />
                <YAxis tick={{ fill: T.ink2, fontSize: 11, fontWeight: 600 }} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: T.white, border: `0.5px solid ${T.bdr2}`, borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="score" stroke={T.blue} fill="url(#bg1)" strokeWidth={2.5} connectNulls />
                <Area type="monotone" dataKey="attendance" stroke={T.grn} fill="url(#bg2)" strokeWidth={2} strokeDasharray="5 3" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </VibeCard>

        {/* Assignments + Risk */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 mb-4 sm:mb-5">
          <VibeCard tone="blue" icon={ClipboardList} decorIcon={CheckCircle2}
            label={`Assignments · ${m.subCount}/${m.asgCount}`}
            action={<span style={{ fontSize: 11, color: T.blue, fontWeight: 700, cursor: "pointer" }}>View All ›</span>}>
            <Headline value={fmtPct(m.completion)}
              sub={m.completion == null ? "No assignments yet" : m.completion >= 80 ? "On track" : "Needs follow-up"}
              subTone={m.completion == null ? "blue" : m.completion >= 80 ? "green" : "amber"} />
            <div style={{ marginTop: 10 }}>
              {assignments.length === 0 ? (
                <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "8px 0" }}>No assignments yet</p>
              ) : [...assignments]
                .sort((a, b) => (toDate(b.dueDate)?.getTime() || 0) - (toDate(a.dueDate)?.getTime() || 0))
                .slice(0, 4)
                .map(a => {
                  const sub = submissions.find((s: any) => s.assignmentId === a.id);
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "rgba(255,255,255,0.55)", borderRadius: 8, marginBottom: 5 }}>
                      <CheckCircle2 size={13} color={sub ? T.grn : T.ink3} />
                      <span style={{ fontSize: 12, color: T.ink, flex: 1, fontWeight: 500 }}>{(a.title || "Assignment").slice(0, 35)}</span>
                    </div>
                  );
                })}
            </div>
          </VibeCard>
          <VibeCard tone={riskTone} icon={ShieldAlert} decorIcon={AlertCircle} label="Risk Assessment" action={<DLink tone={riskTone} />}>
            <Headline value={riskLevel} sub={overallRisk != null ? `Composite: ${overallRisk}/100` : "Awaiting data"} subTone={riskTone} />
            <div style={{ marginTop: 10 }}>
              {[
                { l: "ATTENDANCE",  v: m.attRate },
                { l: "ACADEMIC",    v: m.avg },
                { l: "SUBMISSION",  v: m.completion },
                { l: "BEHAVIOURAL", v: incidents.length === 0 ? 100 : Math.max(0, 100 - incidents.length * 25) },
              ].map(r => {
                const noData = r.v == null;
                const v = r.v ?? 0;
                return (
                  <div key={r.l} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: T.ink2, width: 100, flexShrink: 0, fontWeight: 600 }}>{r.l}</span>
                    <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.55)", borderRadius: 3, overflow: "hidden" }}>
                      {!noData && <div style={{ height: "100%", width: `${v}%`, background: v >= 80 ? T.blue : v >= 50 ? T.amb : T.red, borderRadius: 3 }} />}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: noData ? T.ink3 : v >= 80 ? T.blue : v >= 50 ? T.amb : T.red, width: 50, textAlign: "right" }}>
                      {noData ? "—" : r.l === "BEHAVIOURAL" && incidents.length > 0 ? `${incidents.length}ev` : `${Math.round(v)}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          </VibeCard>
        </div>

        {/* Calendar + Support */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 mb-4 sm:mb-5">
          <VibeCard tone="green" icon={Calendar} label="Attendance Calendar">
            <div className="flex items-center justify-center gap-4 mb-3">
              <button type="button" onClick={() => setCalMonth(new Date(calY, calM - 1))} style={{ background: "rgba(255,255,255,0.6)", border: "none", cursor: "pointer", color: T.ink, padding: 4, borderRadius: 6, display: "flex" }}>
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{MONTHS[calM]} {calY}</span>
              <button type="button" onClick={() => setCalMonth(new Date(calY, calM + 1))} style={{ background: "rgba(255,255,255,0.6)", border: "none", cursor: "pointer", color: T.ink, padding: 4, borderRadius: 6, display: "flex" }}>
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { v: calP, c: T.grn, l: "PRESENT" },
                { v: calL, c: T.amb, l: "LATE" },
                { v: calA, c: T.red, l: "ABSENT" },
              ].map(x => (
                <div key={x.l} style={{ textAlign: "center", padding: "8px 0", background: "rgba(255,255,255,0.55)", borderRadius: 10 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: x.c }}>{x.v}</div>
                  <div style={{ fontSize: 9, color: x.c, fontWeight: 700, letterSpacing: "0.4px" }}>{x.l}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i} style={{ fontSize: 9, fontWeight: 700, color: T.ink2, padding: "3px 0", letterSpacing: "0.3px" }}>{d}</div>
              ))}
              {calDays.map((d, i) => {
                if (!d) return <div key={i} />;
                const isT = d.date.toDateString() === today.toDateString();
                const bg = d.status === "present" ? T.grn : d.status === "late" ? T.amb : d.status === "absent" ? T.red : "transparent";
                return (
                  <div key={i} style={{
                    width: 30, height: 30, borderRadius: isT ? "50%" : 7, margin: "0 auto",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: isT ? 700 : 500,
                    color: d.status ? "#fff" : isT ? "#fff" : T.ink,
                    background: isT && !d.status ? T.blue : bg,
                  }}>{d.dayNum}</div>
                );
              })}
            </div>
          </VibeCard>
          <VibeCard tone="amber" icon={Activity} decorIcon={ClipboardList} label="Support Actions" action={<DLink tone="amber" />}>
            <Headline value={interventions.length} sub={interventions.length === 0 ? "No active interventions" : `${interventions.filter(i => i.status === "completed").length} completed`} subTone="amber" />
            <div style={{ marginTop: 10 }}>
              {interventions.length === 0 ? (
                <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "12px 0" }}>No support actions logged yet</p>
              ) : interventions.slice(0, 3).map(iv => (
                <div key={iv.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", background: "rgba(255,255,255,0.55)", borderRadius: 8, marginBottom: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: iv.status === "completed" ? T.grn : T.amb, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9, color: T.ink3, marginBottom: 1, fontWeight: 600 }}>{timeAgo(iv.createdAt)}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>{(iv.actionTitle || iv.title || "Intervention").slice(0, 32)}</div>
                  </div>
                </div>
              ))}
            </div>
          </VibeCard>
        </div>

        {/* Incidents + Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 mb-4 sm:mb-5">
          <VibeCard tone={incidents.length === 0 ? "green" : "red"} icon={AlertCircle} label="Incidents" action={<DLink tone={incidents.length === 0 ? "green" : "red"} />}>
            <Headline value={incidents.length}
              sub={incidents.length === 0 ? "Clean record" : `${incidents.length} on file`}
              subTone={incidents.length === 0 ? "green" : "red"} />
            <div style={{ marginTop: 10 }}>
              {incidents.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px", background: "rgba(255,255,255,0.55)", borderRadius: 8 }}>
                  <CheckCircle2 size={14} color={T.grn} />
                  <span style={{ fontSize: 11, color: T.grn, fontWeight: 600 }}>No incidents on record</span>
                </div>
              ) : incidents.slice(0, 4).map(inc => (
                <div key={inc.id} style={{ padding: "8px 10px", background: "rgba(255,255,255,0.55)", borderRadius: 8, marginBottom: 5 }}>
                  <div className="flex justify-between items-center">
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.red, letterSpacing: "0.3px" }}>● {(inc.type || "INCIDENT").toUpperCase()}</span>
                    <span style={{ fontSize: 9, color: T.ink3, fontWeight: 600 }}>{timeAgo(inc.createdAt || inc.date)}</span>
                  </div>
                  <p style={{ fontSize: 10, color: T.ink2, marginTop: 3, lineHeight: 1.4 }}>{(inc.description || inc.content || "").slice(0, 100)}</p>
                </div>
              ))}
            </div>
          </VibeCard>
          <VibeCard tone="blue" icon={BarChart3} decorIcon={Award} label="Overview" action={<span style={{ fontSize: 11, color: T.blue, fontWeight: 700, cursor: "pointer" }}>Dashboard ›</span>}>
            <Headline value={`${testScores.length + gradebookScores.length} tests`} sub={`${m.days} days on record`} subTone="blue" />
            <div style={{ marginTop: 10 }}>
              {[
                { icon: FileText,        label: "Tests",            val: testScores.length + gradebookScores.length },
                { icon: BookOpen,        label: "Subjects",         val: subEntries.length },
                { icon: Activity,        label: "Avg Attendance",   val: fmtPct(m.attRate) },
                { icon: Users,           label: "Parent Notes",     val: parentNotes.length },
              ].map(item => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "rgba(255,255,255,0.55)", borderRadius: 8, marginBottom: 5 }}>
                  <div className="flex items-center gap-2">
                    <item.icon size={13} color={T.blue} />
                    <span style={{ fontSize: 11, color: T.ink2, fontWeight: 600 }}>{item.label}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>{item.val}</span>
                </div>
              ))}
            </div>
          </VibeCard>
        </div>

        {/* Comms + Score History */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 mb-4 sm:mb-5">
          <VibeCard tone="green" icon={MessageSquare} label={`Communications · ${parentNotes.length} entries`}>
            <div style={{ marginBottom: 10 }}>
              {parentNotes.length === 0 ? (
                <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "10px 0" }}>No messages yet — send one below.</p>
              ) : parentNotes.slice(0, 3).map(n => (
                <div key={n.id} style={{ padding: "8px 10px", background: "rgba(255,255,255,0.55)", borderRadius: 8, marginBottom: 5 }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>
                      {n.from === "teacher" ? (n.teacherName || "TEACHER") : "PARENT"}
                    </span>
                    <span style={{ padding: "1px 7px", borderRadius: 4, background: n.from === "teacher" ? T.blBg : T.glBg, color: n.from === "teacher" ? T.blue : T.grn, fontSize: 9, fontWeight: 700, letterSpacing: "0.3px" }}>
                      {n.from === "teacher" ? "FACULTY" : "PARENT"}
                    </span>
                    <span style={{ fontSize: 9, color: T.ink3, marginLeft: "auto", fontWeight: 600 }}>{timeAgo(n.createdAt)}</span>
                  </div>
                  <p style={{ fontSize: 11, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{(n.content || n.message || "").slice(0, 120)}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input ref={feedbackInputRef}
                value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                placeholder="Send a note to parent..."
                aria-label="Note to parent"
                style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: `0.5px solid ${T.bdr2}`, fontSize: 12, outline: "none", background: T.white, fontFamily: T.FONT, color: T.ink }}
                onKeyDown={e => { if (e.key === "Enter") handleSendFeedback(); }} />
              <button type="button" onClick={handleSendFeedback} disabled={sending || !feedbackText.trim()}
                style={{
                  padding: "8px 14px", borderRadius: 10,
                  background: T.grn, color: "#fff", border: "none",
                  fontSize: 11, fontWeight: 700,
                  cursor: feedbackText.trim() ? "pointer" : "not-allowed",
                  opacity: feedbackText.trim() ? 1 : 0.5,
                  boxShadow: "0 2px 8px rgba(0,200,83,0.3)",
                  display: "flex", alignItems: "center", gap: 5,
                  letterSpacing: "0.3px",
                }}>
                <Send size={11} /> {sending ? "…" : "SEND"}
              </button>
            </div>
          </VibeCard>
          <VibeCard tone="violet" icon={BarChart3} label={`Score History · ${testScores.length + gradebookScores.length} records`}>
            {barData.length > 0 && (
              <div style={{ height: 130, marginBottom: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(123,63,244,0.15)" />
                    <XAxis dataKey="name" tick={{ fill: T.ink2, fontSize: 9, fontWeight: 600 }} />
                    <YAxis tick={{ fill: T.ink2, fontSize: 9, fontWeight: 600 }} domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: T.white, border: `0.5px solid ${T.bdr2}`, borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="score" fill={T.violet} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {scoreHist.length === 0 ? (
              <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "10px 0" }}>No scores recorded yet</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 4px", fontSize: 11 }}>
                  <thead>
                    <tr>
                      {["SUBJECT", "DATE", "SCORE"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "0 8px 4px", fontSize: 9, color: T.ink2, fontWeight: 700, letterSpacing: "0.3px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scoreHist.map(t => {
                      // writerTimeMs covers all 5 timestamp variants (timestamp /
                      // updatedAt / createdAt / date / submittedAt) — was 3.
                      const ms = writerTimeMs(t);
                      const d = ms ? new Date(ms) : null;
                      const pct = pctOfDoc(t);
                      return (
                        <tr key={(t as any).id} style={{ background: "rgba(255,255,255,0.55)" }}>
                          <td style={{ padding: "6px 8px", color: T.ink, fontWeight: 600, borderRadius: "8px 0 0 8px" }}>{((t as any).subject || "TEST").slice(0, 18)}</td>
                          <td style={{ padding: "6px 8px", color: T.ink2, fontWeight: 600 }}>
                            {d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase() : "—"}
                          </td>
                          <td style={{ padding: "6px 8px", fontWeight: 700, color: pct != null ? T.violet : T.ink3, borderRadius: "0 8px 8px 0" }}>
                            {pct != null ? `${Math.round(pct)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </VibeCard>
        </div>

        {/* Footer — real Firebase-backed signals only.
            Reply rate = parent-authored notes / total notes.
            Last update = max writerTimeMs across every loaded collection.
            Removed: fabricated "PARENT ENGAGEMENT %", decorative "Status/Secured". */}
        {!embedded && (
          <div className="hidden md:flex items-center justify-between mt-5 px-5 py-2.5 rounded-[12px]"
            style={{ background: T.white, border: `0.5px solid ${T.bdr2}`, fontSize: 10, color: T.ink3 }}>
            <span>★ PARENT REPLY RATE: {replyRate != null ? `${replyRate}%` : "—"}</span>
            <span>★ STATUS: <span style={{ color: statusInfo.color, fontWeight: 700 }}>{statusInfo.label}</span></span>
            <span>★ LAST UPDATE: {lastDataUpdate ? timeAgo(lastDataUpdate) : "—"}</span>
            <span>★ STUDENT ID: {sid.slice(0, 8).toUpperCase()}</span>
            <span style={{ color: T.blue, fontWeight: 700 }}>
              {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        )}
      </div>

      {/* Remove-from-class dialog. Lists every enrollment owned by this teacher
          for this student. Each row has its own delete action so multi-class
          students can be removed one class at a time. Hard delete — student
          record + other teachers' enrollments stay intact. */}
      {removeOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="remove-dialog-title"
          onClick={() => { if (!removingId) setRemoveOpen(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,16,64,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, zIndex: 50, backdropFilter: "blur(4px)",
          }}>
          <div onClick={e => e.stopPropagation()}
            style={{
              background: "#FFFFFF", borderRadius: 22, padding: 24,
              maxWidth: 460, width: "100%",
              boxShadow: "0 0 0 0.5px rgba(0,85,255,0.10), 0 24px 60px rgba(0,16,64,0.30)",
            }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: "rgba(255,69,58,0.10)", color: "#C71F2D",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <Trash2 size={18} strokeWidth={2.4} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 id="remove-dialog-title" style={{
                  fontSize: 16, fontWeight: 700, color: T.ink, margin: 0, letterSpacing: "-0.3px",
                }}>
                  Remove {sName} from class?
                </h3>
                <p style={{ fontSize: 12, fontWeight: 500, color: T.ink2, margin: "4px 0 0", lineHeight: 1.5 }}>
                  This removes the student from the selected class only. Their
                  master record and other teachers' enrollments are not affected.
                </p>
              </div>
              <button type="button"
                onClick={() => { if (!removingId) setRemoveOpen(false); }}
                aria-label="Close"
                disabled={!!removingId}
                style={{
                  background: "transparent", border: "none", cursor: removingId ? "not-allowed" : "pointer",
                  padding: 4, color: T.ink3, opacity: removingId ? 0.4 : 1,
                }}>
                <XIcon size={18} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {myEnrollments.length === 0 ? (
                <p style={{ fontSize: 12, color: T.ink3, margin: 0, textAlign: "center", padding: "12px 0" }}>
                  No enrollments owned by you for this student.
                </p>
              ) : (
                myEnrollments.map(en => {
                  const isRemoving = removingId === en.id;
                  return (
                    <div key={en.id} style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 14px", borderRadius: 12,
                      background: "rgba(0,85,255,0.04)", border: "0.5px solid rgba(0,85,255,0.10)",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: T.ink, margin: 0, letterSpacing: "-0.2px" }}>
                          {en.className || "Class"}
                        </p>
                        <p style={{ fontSize: 10, fontWeight: 500, color: T.ink3, margin: "1px 0 0", letterSpacing: "0.2px", textTransform: "uppercase" }}>
                          Your enrollment
                        </p>
                      </div>
                      <button type="button"
                        onClick={() => handleRemoveFromClass(en.id, en.className)}
                        disabled={!!removingId}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "7px 12px", borderRadius: 10,
                          background: isRemoving ? "rgba(255,69,58,0.10)" : "#C71F2D",
                          color: isRemoving ? "#C71F2D" : "#FFFFFF",
                          border: "none",
                          fontSize: 11, fontWeight: 700, letterSpacing: "0.4px",
                          cursor: removingId ? "not-allowed" : "pointer",
                          opacity: removingId && !isRemoving ? 0.4 : 1,
                          textTransform: "uppercase",
                        }}>
                        {isRemoving ? (
                          <>
                            <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                            Removing…
                          </>
                        ) : (
                          <>
                            <Trash2 size={11} />
                            Remove
                          </>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <p style={{ fontSize: 10, fontWeight: 500, color: T.ink3, margin: "16px 0 0", lineHeight: 1.5, textAlign: "center" }}>
              The student can be re-invited later from the Students page.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
