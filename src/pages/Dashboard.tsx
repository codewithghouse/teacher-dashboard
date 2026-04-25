import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import {
  collection, query, where, onSnapshot, getDocs,
  type QueryConstraint,
} from 'firebase/firestore';
import { Loader2, X, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tilt3D, tilt3DStyle, BLUE_SHADOW, BLUE_SHADOW_LG } from '../lib/use3DTilt';

// ── Module-level dashboard cache ──────────────────────────────────────────────
interface _DashboardSnapshot {
  stats: { avgAttendance: number; pendingGrading: number; atRiskCount: number; activeClasses: number };
  todayClasses: any[];
  pendingTasks: any[];
  criticalStudents: any[];
}
let _dashCache: { teacherId: string; expiresAt: number; snapshot: _DashboardSnapshot } | null = null;
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

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

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    avgAttendance: 0, pendingGrading: 0, atRiskCount: 0, activeClasses: 0
  });
  const [todayClasses, setTodayClasses] = useState<any[]>([]);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [criticalStudents, setCriticalStudents] = useState<any[]>([]);
  const [unreadNotes, setUnreadNotes] = useState<any[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Real-time unread parent messages
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const q = query(
      collection(db, "parent_notes"),
      where("schoolId", "==", teacherData.schoolId),
      where("teacherId", "==", teacherData.id),
      where("from", "==", "parent")
    );
    return onSnapshot(q, (snap) => {
      const unread = snap.docs
        .map(d => ({ ...d.data(), id: d.id } as Record<string, unknown> & { id: string; read?: boolean; createdAt?: { toMillis?: () => number } }))
        .filter(n => n.read !== true)
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        .slice(0, 10);
      setUnreadNotes(unread);
    });
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Close notification panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node))
        setShowNotifPanel(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Real-time attendance rate (last 30 days)
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toLocaleDateString("en-CA");
    const q = query(collection(db, "attendance"), ...SC, where("teacherId", "==", teacherData.id), where("date", ">=", cutoffStr));
    return onSnapshot(q, (snap) => {
      const att = snap.docs.map((d: any) => d.data());
      const pres = att.filter((a: any) => a.status === 'present' || a.status === 'late').length;
      setStats(prev => ({ ...prev, avgAttendance: att.length > 0 ? Number(((pres / att.length) * 100).toFixed(1)) : 0 }));
    });
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Main data harvest
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    setLoading(true);
    const tId = teacherData.id;
    const tEmail = teacherData.email?.toLowerCase();
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    // SC is spread into EVERY tenant query below — schoolId is mandatory
    // under claims-based rules; branchId is optional per-deployment scope.
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toLocaleDateString("en-CA");

    const harvest = async () => {
      if (_dashCache && _dashCache.teacherId === tId && _dashCache.expiresAt > Date.now()) {
        const c = _dashCache.snapshot;
        setStats(c.stats); setTodayClasses(c.todayClasses);
        setPendingTasks(c.pendingTasks); setCriticalStudents(c.criticalStudents);
        setLoading(false); return;
      }
      try {
        const q1 = query(collection(db, "teaching_assignments"), where("teacherId", "==", tId), ...SC);
        const q2 = query(collection(db, "classes"), where("teacherId", "==", tId), ...SC);
        const q3 = tEmail ? query(collection(db, "teaching_assignments"), where("teacherEmail", "==", tEmail), ...SC) : null;
        const q5 = query(collection(db, "classes"), where("teacher_id", "==", tId), ...SC);
        const [s1, s2, s3, s5] = await Promise.all([
          getDocs(q1), getDocs(q2),
          q3 ? getDocs(q3) : Promise.resolve({ docs: [] as any[] }),
          getDocs(q5)
        ]);
        const allAssignments = [
          ...s1.docs.map(d => ({ id: d.id, ...d.data() })),
          ...s3.docs.map((d: any) => ({ id: d.id, ...d.data() })),
          ...s2.docs.map(d => ({ id: d.id, ...d.data(), classId: d.id, className: d.data().name })),
          ...s5.docs.map(d => ({ id: d.id, ...d.data(), classId: d.id, className: d.data().name }))
        ];
        const uniqueMap = new Map();
        allAssignments.forEach((a: any) => { const cid = a.classId || a.id; if (!uniqueMap.has(cid)) uniqueMap.set(cid, a); });
        const assignments = Array.from(uniqueMap.values());

        if (assignments.length === 0) {
          const empty: _DashboardSnapshot = { stats: { avgAttendance: 0, pendingGrading: 0, atRiskCount: 0, activeClasses: 0 }, todayClasses: [], pendingTasks: [], criticalStudents: [] };
          _dashCache = { teacherId: tId, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, snapshot: empty };
          setStats(empty.stats); setTodayClasses([]); setPendingTasks([]); setCriticalStudents([]); setLoading(false); return;
        }

        const classIds = assignments.map(a => a.classId || a.id);
        const chunkArr = <T_,>(arr: T_[], n: number): T_[][] =>
          Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
        const classChunks = chunkArr(classIds, 10);
        const studentsSnap = classChunks.length > 0
          ? await Promise.all(classChunks.map(ch => getDocs(query(collection(db, "enrollments"), where("classId", "in", ch), ...SC))))
              .then(snaps => ({ docs: snaps.flatMap(s => s.docs) }))
          : { docs: [] as any[] };

        const [attSnap, scoresSnap, resultsSnap] = await Promise.all([
          getDocs(query(collection(db, "attendance"), where("teacherId", "==", tId), where("date", ">=", cutoffStr), ...SC)),
          getDocs(query(collection(db, "gradebook_scores"), where("teacherId", "==", tId), ...SC)),
          getDocs(query(collection(db, "results"), where("teacherId", "==", tId), ...SC))
        ]);

        const students = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        const att = attSnap.docs.map(d => d.data());
        const scores = [...scoresSnap.docs.map(d => d.data()), ...resultsSnap.docs.map(d => d.data())];

        const pres = att.filter(a => a.status === 'present' || a.status === 'late').length;
        const avgAtnd = att.length > 0 ? (pres / att.length) * 100 : 0;
        const pendingRev = scores.filter(s => s.status === 'pending').length;

        const tasks: any[] = [];
        const todayStr = new Date().toISOString().split('T')[0];
        const markedToday = new Set(att.filter(a => a.date === todayStr).map(a => a.classId || a.assignmentId));
        const pendingCls = assignments.filter(a => !markedToday.has(a.classId || a.id));
        if (pendingRev > 0) tasks.push({ title: 'Grade Unit Test Papers', sub: 'Due Today · Gradebook', status: 'Pending', done: false });
        if (pendingCls.length > 0) tasks.push({ title: 'Mark Attendance', sub: `${pendingCls.length} class${pendingCls.length > 1 ? 'es' : ''} · Pending`, status: 'Todo', done: false });

        let rCount = 0;
        const rList = students.map(s => {
          const sId = s.studentId, sEmail = s.studentEmail?.toLowerCase();
          const f = (arr: any[]) => arr.filter(i => (sId && (i.studentId === sId || i.id?.includes(sId))) || (sEmail && i.studentEmail?.toLowerCase() === sEmail));
          const sAtt = f(att), sScores = f(scores);
          const sA = sAtt.length > 0 ? (sAtt.filter(a => a.status === 'present' || a.status === 'late').length / sAtt.length) * 100 : 100;
          const sM = sScores.length > 0 ? sScores.reduce((acc, c) => acc + Number(c.percentage || (c.mark / c.maxMarks * 100) || c.score || 0), 0) / sScores.length : 80;
          let lvl = "stable", trig = "On Track";
          if (sA < 75 || sM < 60) { lvl = "critical"; trig = sA < 75 ? `Attendance dropped below ${Math.round(sA)}%` : "Grade dropped significantly"; rCount++; }
          else if (sA < 85 || sM < 70) { lvl = "observation"; trig = sM < 70 ? "Missing 2 assignments" : "Performance below class avg."; }
          return { ...s, level: lvl, trigger: trig, score: sM, atnd: sA };
        }).filter(s => s.level !== "stable").sort(a => (a.level === 'critical' ? -1 : 1)).slice(0, 3);

        const finalSnap: _DashboardSnapshot = {
          stats: { avgAttendance: Number(avgAtnd.toFixed(1)), pendingGrading: pendingRev, atRiskCount: rCount, activeClasses: assignments.length },
          todayClasses: assignments.slice(0, 4).map((a, i) => ({
            time: a.startTime || a.scheduleTime || "—",
            period: a.period || "",
            subject: a.subjectName || a.subject || "Subject",
            className: a.className || a.name || "Class",
            students: students.filter(s => s.classId === (a.classId || a.id)).length,
            isNow: i === 0,
          })),
          pendingTasks: tasks,
          criticalStudents: rList,
        };
        _dashCache = { teacherId: tId, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, snapshot: finalSnap };
        setStats(finalSnap.stats); setTodayClasses(finalSnap.todayClasses);
        setPendingTasks(finalSnap.pendingTasks); setCriticalStudents(finalSnap.criticalStudents);
      } catch (e) { console.error("Dashboard Harvest Failure:", e); }
      finally { setLoading(false); }
    };
    harvest();
  }, [teacherData?.id, teacherData?.email, teacherData?.schoolId, teacherData?.branchId]);

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

  // AI summary line — derived from live stats (no fake data)
  const aiMessage = (() => {
    const attStr = stats.avgAttendance >= 85 ? `Attendance is strong at ${stats.avgAttendance}%`
      : stats.avgAttendance >= 70 ? `Attendance is holding at ${stats.avgAttendance}%`
      : stats.avgAttendance > 0   ? `Attendance is dipping to ${stats.avgAttendance}%`
      : `Attendance data still loading`;
    const gradeStr = stats.pendingGrading === 0
      ? "grading is current"
      : `${stats.pendingGrading} grading task${stats.pendingGrading > 1 ? 's' : ''} pending`;
    if (stats.atRiskCount === 0) return `${attStr} and ${gradeStr} — every student is on track today.`;
    const top  = criticalStudents[0]?.studentName;
    const next = criticalStudents[1]?.studentName;
    const namePart = top && next ? ` Prioritise ${top} and ${next}.`
                   : top ?          ` Prioritise ${top}.`
                   : '';
    return `${attStr} and ${gradeStr} — but ${stats.atRiskCount} student${stats.atRiskCount > 1 ? 's need' : ' needs'} immediate outreach.${namePart}`;
  })();

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
  const FONT_D = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";

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
    <div style={{ fontFamily: FONT_D, background: "#EEF4FF" }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ═══════════════════ MOBILE VIEW — EduIntellect v2 ═══════════════════ */}
      <div className="md:hidden animate-in fade-in duration-500" style={{ background: "#EEF4FF", minHeight: "100vh" }}>

      {/* ── Greeting + actions (bell + avatar) ── */}
      <div className="flex items-center justify-between px-4 pt-[10px] pb-[18px]">
        <div>
          <div className="flex items-center gap-[7px] text-[9px] font-extrabold uppercase mb-[6px]" style={{ color: TT3, letterSpacing: "1.8px" }}>
            <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: B1 }} />
            Teacher Dashboard
          </div>
          <div className="text-[25px] font-extrabold flex items-center gap-2 leading-[1.05]" style={{ color: TT1, letterSpacing: "-0.9px" }}>
            Hello, {firstName}
            <span className="inline-block" style={{ animation: "tdWave 2.8s ease-in-out infinite", transformOrigin: "70% 70%" }}>👋</span>
          </div>
          <div className="text-[12px] font-medium mt-[5px]" style={{ color: TT3, letterSpacing: "-0.15px" }}>
            Welcome back · {dayLabel}
          </div>
        </div>

        <div className="flex items-center gap-[10px]" ref={notifRef}>
          <div className="relative">
            <button type="button" onClick={() => setShowNotifPanel(p => !p)}
              aria-label="Notifications"
              className="w-10 h-10 rounded-[13px] bg-white flex items-center justify-center relative active:scale-[0.92] transition-transform"
              style={{ color: B1, boxShadow: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 12px rgba(9,87,247,0.08)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/>
                <path d="M10.3 21a1.94 1.94 0 003.4 0"/>
              </svg>
              {unreadNotes.length > 0 && (
                <span className="absolute top-[3px] right-[3px] min-w-[16px] h-[16px] px-[4px] rounded-full text-white text-[9px] font-extrabold flex items-center justify-center"
                  style={{ background: RED, border: "2px solid white" }}>
                  {unreadNotes.length > 9 ? "9+" : unreadNotes.length}
                </span>
              )}
            </button>
            {showNotifPanel && (
              <div className="absolute right-0 top-12 w-[calc(100vw-2rem)] sm:w-80 max-w-sm rounded-[22px] z-50 overflow-hidden"
                style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_LG_D }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `0.5px solid ${BLUE_BDR}`, background: "#EEF4FF" }}>
                  <div>
                    <p className="text-[14px] font-bold" style={{ color: TT1, letterSpacing: "-0.2px" }}>Notifications</p>
                    <p className="text-[10px] font-medium mt-[1px]" style={{ color: TT3 }}>
                      {unreadNotes.length > 0 ? `${unreadNotes.length} unread from parents` : "All caught up!"}
                    </p>
                  </div>
                  <button type="button" onClick={() => setShowNotifPanel(false)}
                    className="w-7 h-7 rounded-[9px] flex items-center justify-center"
                    style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}` }}>
                    <X size={13} style={{ color: TT3 }} />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {unreadNotes.length === 0 ? (
                    <div className="py-10 text-center text-[13px]" style={{ color: TT4 }}>No new notifications</div>
                  ) : (
                    unreadNotes.map(note => (
                      <button type="button" key={note.id}
                        onClick={() => { setShowNotifPanel(false); navigate("/parent-notes"); }}
                        className="w-full flex items-start gap-3 px-4 py-3 text-left active:bg-[color:var(--hv)]"
                        style={{ borderBottom: `0.5px solid ${SEP_D}`, ["--hv" as any]: BG_D }}>
                        <div className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0"
                          style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 8px rgba(0,85,255,0.28)" }}>
                          <MessageSquare size={15} color="#fff" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.1px" }}>{note.studentName || "Parent Message"}</p>
                          <p className="text-[11px] mt-[2px] truncate" style={{ color: TT3 }}>{(note.content as string) || "New message received"}</p>
                        </div>
                        <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: B1 }} />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button type="button" onClick={() => navigate('/settings')}
            aria-label="Profile"
            className="w-10 h-10 rounded-[13px] flex items-center justify-center text-white text-[15px] font-extrabold active:scale-[0.92] transition-transform"
            style={{ background: B1, letterSpacing: "-0.3px", boxShadow: "0 0.5px 1px rgba(9,87,247,0.2), 0 6px 14px rgba(9,87,247,0.3)" }}>
            {avatarInitial}
          </button>
        </div>
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
              <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Attendance Rate</div>
              <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Last 30 days · All classes</div>
            </div>
            <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-extrabold"
              style={{
                background: stats.avgAttendance >= 85 ? "rgba(0,232,102,0.18)" : stats.avgAttendance >= 70 ? "rgba(255,170,0,0.22)" : "rgba(255,51,85,0.18)",
                border: `0.5px solid ${stats.avgAttendance >= 85 ? "rgba(0,232,102,0.5)" : stats.avgAttendance >= 70 ? "rgba(255,170,0,0.5)" : "rgba(255,51,85,0.5)"}`,
                color: stats.avgAttendance >= 85 ? "#6FFFAA" : stats.avgAttendance >= 70 ? "#FFD166" : "#FF99AA",
                letterSpacing: "0.3px",
              }}>
              <span className="w-[6px] h-[6px] rounded-full" style={{
                background: stats.avgAttendance >= 85 ? "#00FF88" : stats.avgAttendance >= 70 ? "#FFCC22" : "#FF5577",
                boxShadow: `0 0 8px ${stats.avgAttendance >= 85 ? "#00FF88" : stats.avgAttendance >= 70 ? "#FFCC22" : "#FF5577"}`,
              }} />
              {stats.avgAttendance >= 85 ? "Strong" : stats.avgAttendance >= 70 ? "Holding" : stats.avgAttendance > 0 ? "Needs focus" : "No data"}
            </div>
          </div>
          <div className="text-[56px] font-extrabold text-white leading-none mb-[8px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-2.6px" }}>
            {stats.avgAttendance > 0 ? stats.avgAttendance.toFixed(1) : "—"}
            {stats.avgAttendance > 0 && <span className="text-[28px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-0.8px" }}>%</span>}
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
                <div className="text-[20px] font-extrabold text-white" style={{ letterSpacing: "-0.6px" }}>{v}</div>
                <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>{l}</div>
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
            val: stats.avgAttendance > 0 ? `${stats.avgAttendance}%` : "—",
            color: B1, iconBg: B1,
            sub: stats.avgAttendance >= 85
              ? <><span className="font-bold" style={{ color: GREEN }}>↑ Strong</span> · last 30d</>
              : stats.avgAttendance > 0
                ? <><span className="font-bold" style={{ color: ORANGE }}>● Watch</span> · last 30d</>
                : <span>Awaiting data</span>,
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="12" width="4" height="9" rx="1"/>
                <rect x="10" y="8" width="4" height="13" rx="1"/>
                <rect x="17" y="4" width="4" height="17" rx="1"/>
              </svg>
            ),
            path: "/attendance",
          },
          {
            label: "Pending Grading",
            val: `${stats.pendingGrading}`,
            color: ORANGE, iconBg: ORANGE,
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
            path: "/gradebook",
          },
          {
            label: "At-Risk Students",
            val: `${stats.atRiskCount}`,
            color: RED, iconBg: RED,
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
            path: "/risks-alerts",
          },
          {
            label: "Classes Today",
            val: `${stats.activeClasses}`,
            color: VIOLET, iconBg: VIOLET,
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
            path: "/my-classes",
          },
        ].map(({ label, val, color, iconBg, sub, icon, path }) => (
          <button type="button" key={label}
            onClick={() => navigate(path)}
            {...tilt3D}
            className="bg-white rounded-[20px] p-4 relative flex flex-col text-left active:scale-[0.96] transition-transform"
            style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}>
            <div className="flex items-start gap-[10px] mb-[18px]" style={{ minHeight: 40 }}>
              <div className="flex-1 min-w-0 text-[10px] font-bold uppercase leading-[1.4] pt-[3px]" style={{ color: TT3, letterSpacing: "1px" }}>
                {label}
              </div>
              <div className="flex-shrink-0 w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white"
                style={{ background: iconBg }}>
                {icon}
              </div>
            </div>
            <div className="text-[30px] font-extrabold leading-none" style={{ color, letterSpacing: "-1.3px" }}>{val}</div>
            <div className="text-[11px] font-semibold mt-[7px] flex items-center gap-[5px]" style={{ color: TT4, letterSpacing: "-0.15px" }}>
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
            sub: "See how students rank",
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
            sub: `You're #${7} in branch`,
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
              {sub}
              <span className="ml-auto text-[16px] leading-none" style={{ color: B1 }}>›</span>
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
              <div className="text-[15px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.35px" }}>Today's Classes</div>
              <div className="text-[11px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>{todayClasses.length} scheduled</div>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/my-classes')}
            className="text-[12px] font-bold flex items-center gap-[2px] py-[6px] active:opacity-70 transition-opacity"
            style={{ color: B1, letterSpacing: "-0.1px" }}>
            See all <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
          </button>
        </div>
        {todayClasses.length === 0 ? (
          <div className="py-6 text-center text-[13px] font-medium" style={{ color: TT4 }}>No classes scheduled today</div>
        ) : (
          todayClasses.map((cls, idx) => (
            <button type="button" key={idx}
              onClick={() => navigate('/my-classes')}
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
                <div className="flex items-center gap-[5px] px-[10px] py-[5px] rounded-full text-[9px] font-black text-white uppercase flex-shrink-0"
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
              <div className="text-[15px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.35px" }}>Pending Tasks</div>
              <div className="text-[11px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                {pendingTasks.length} {pendingTasks.length === 1 ? "to complete" : "to complete"}
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
              <div className="px-[11px] py-[5px] rounded-full text-[9px] font-black text-white uppercase flex-shrink-0"
                style={{ background: ORANGE, letterSpacing: "0.7px" }}>
                {task.status === 'Pending' ? 'Pending' : 'Todo'}
              </div>
            </button>
          ))
        )}
      </div>

      {/* ── Needs Attention ── */}
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
              <div className="text-[15px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.35px" }}>Needs Attention</div>
              <div className="text-[11px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>{criticalStudents.length} flagged</div>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/risks-alerts')}
            className="text-[12px] font-bold flex items-center gap-[2px] py-[6px] active:opacity-70 transition-opacity"
            style={{ color: B1, letterSpacing: "-0.1px" }}>
            View all <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
          </button>
        </div>
        {criticalStudents.length === 0 ? (
          <div className="py-6 text-center text-[13px] font-medium" style={{ color: TT4 }}>All students on track</div>
        ) : (
          criticalStudents.map((s, idx) => {
            const name = s.studentName || "Student";
            const initStr = (() => { const p = name.trim().split(" "); return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].substring(0, 2)).toUpperCase(); })();
            const avatarBg = [B1, ORANGE, VIOLET][idx % 3];
            return (
              <div key={idx}
                onClick={() => navigate(`/students?studentId=${s.studentId || ''}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/students?studentId=${s.studentId || ''}`); }}
                className={`flex items-center gap-[11px] p-[10px] pl-3 rounded-[14px] cursor-pointer active:brightness-95 transition ${idx < criticalStudents.length - 1 ? "mb-2" : ""}`}
                style={{ background: "rgba(255,51,85,0.04)" }}>
                <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0"
                  style={{ background: avatarBg, letterSpacing: "0.3px" }}>
                  {initStr}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.25px" }}>{name}</div>
                  <div className="flex items-center gap-[5px] mt-[3px] text-[11px] font-semibold" style={{ color: RED, letterSpacing: "-0.1px" }}>
                    <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: RED }} />
                    <span className="truncate">{s.trigger}</span>
                  </div>
                </div>
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); navigate('/risks-alerts'); }}
                  className="px-[13px] py-[8px] rounded-[10px] text-[11px] font-bold text-white flex-shrink-0 active:scale-[0.92] transition-transform"
                  style={{ background: RED, letterSpacing: "-0.1px" }}>
                  Notify
                </button>
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
            <div className="text-[10px] font-black uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>AI Teacher Intelligence</div>
            <div className="ml-auto px-[10px] py-[4px] rounded-full text-[9px] font-extrabold"
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
              <div className="text-[19px] font-extrabold" style={{ color: stats.avgAttendance >= 70 ? "#6FFFAA" : "#FF8899", letterSpacing: "-0.5px" }}>
                {stats.avgAttendance > 0 ? `${stats.avgAttendance}%` : "—"}
              </div>
              <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attend.</div>
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/risks-alerts'); }}
              className="py-[13px] px-[6px] text-center active:brightness-110 transition"
              style={{ background: "rgba(0,20,80,0.55)" }}>
              <div className="text-[19px] font-extrabold" style={{ color: stats.atRiskCount > 0 ? "#FF8899" : "#fff", letterSpacing: "-0.5px" }}>{stats.atRiskCount}</div>
              <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>At-Risk</div>
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/my-classes'); }}
              className="py-[13px] px-[6px] text-center active:brightness-110 transition"
              style={{ background: "rgba(0,20,80,0.55)" }}>
              <div className="text-[19px] font-extrabold text-white" style={{ letterSpacing: "-0.5px" }}>{stats.activeClasses}</div>
              <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Classes</div>
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
              <div className="flex items-center gap-[7px] text-[10px] font-extrabold uppercase mb-[8px]" style={{ color: TT3, letterSpacing: "1.8px" }}>
                <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: B1 }} />
                Teacher Dashboard
              </div>
              <div className="text-[36px] font-extrabold flex items-center gap-3 leading-[1.05]" style={{ color: TT1, letterSpacing: "-1.2px" }}>
                Hello, {firstName}
                <span className="inline-block text-[34px]" style={{ animation: "tdWave 2.8s ease-in-out infinite", transformOrigin: "70% 70%" }}>👋</span>
              </div>
              <div className="text-[14px] font-medium mt-[6px]" style={{ color: TT3, letterSpacing: "-0.15px" }}>
                Welcome back · {dayLabel}
              </div>
            </div>

            <div className="flex items-center gap-3" ref={notifRef}>
              <div className="relative">
                <button type="button" onClick={() => setShowNotifPanel(p => !p)}
                  aria-label="Notifications"
                  className="w-12 h-12 rounded-[14px] bg-white flex items-center justify-center relative hover:scale-[1.04] active:scale-[0.96] transition-transform"
                  style={{ color: B1, boxShadow: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 12px rgba(9,87,247,0.1)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/>
                    <path d="M10.3 21a1.94 1.94 0 003.4 0"/>
                  </svg>
                  {unreadNotes.length > 0 && (
                    <span className="absolute top-[4px] right-[4px] min-w-[18px] h-[18px] px-[5px] rounded-full text-white text-[10px] font-extrabold flex items-center justify-center"
                      style={{ background: RED, border: "2px solid white" }}>
                      {unreadNotes.length > 9 ? "9+" : unreadNotes.length}
                    </span>
                  )}
                </button>
                {showNotifPanel && (
                  <div className="absolute right-0 top-14 w-96 rounded-[22px] z-50 overflow-hidden"
                    style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_LG_D }}>
                    <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `0.5px solid ${BLUE_BDR}`, background: "#EEF4FF" }}>
                      <div>
                        <p className="text-[14px] font-bold" style={{ color: TT1, letterSpacing: "-0.2px" }}>Notifications</p>
                        <p className="text-[10px] font-medium mt-[1px]" style={{ color: TT3 }}>
                          {unreadNotes.length > 0 ? `${unreadNotes.length} unread from parents` : "All caught up!"}
                        </p>
                      </div>
                      <button type="button" onClick={() => setShowNotifPanel(false)}
                        className="w-7 h-7 rounded-[9px] flex items-center justify-center"
                        style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}` }}>
                        <X size={13} style={{ color: TT3 }} />
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {unreadNotes.length === 0 ? (
                        <div className="py-10 text-center text-[13px]" style={{ color: TT4 }}>No new notifications</div>
                      ) : (
                        unreadNotes.map(note => (
                          <button type="button" key={note.id}
                            onClick={() => { setShowNotifPanel(false); navigate("/parent-notes"); }}
                            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[color:var(--hv)]"
                            style={{ borderBottom: `0.5px solid ${SEP_D}`, ["--hv" as any]: BG_D }}>
                            <div className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0"
                              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 8px rgba(0,85,255,0.28)" }}>
                              <MessageSquare size={15} color="#fff" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.1px" }}>{note.studentName || "Parent Message"}</p>
                              <p className="text-[11px] mt-[2px] truncate" style={{ color: TT3 }}>{(note.content as string) || "New message received"}</p>
                            </div>
                            <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: B1 }} />
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button type="button" onClick={() => navigate('/settings')}
                aria-label="Profile"
                className="w-12 h-12 rounded-[14px] flex items-center justify-center text-white text-[17px] font-extrabold hover:scale-[1.04] active:scale-[0.96] transition-transform"
                style={{ background: B1, letterSpacing: "-0.3px", boxShadow: "0 0.5px 1px rgba(9,87,247,0.2), 0 6px 14px rgba(9,87,247,0.3)" }}>
                {avatarInitial}
              </button>
            </div>
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
                  <div className="text-[11px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Attendance Rate</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Last 30 days · All classes</div>
                </div>
                <div className="ml-auto flex items-center gap-[6px] px-4 py-[7px] rounded-full text-[11px] font-extrabold"
                  style={{
                    background: stats.avgAttendance >= 85 ? "rgba(0,232,102,0.18)" : stats.avgAttendance >= 70 ? "rgba(255,170,0,0.22)" : "rgba(255,51,85,0.18)",
                    border: `0.5px solid ${stats.avgAttendance >= 85 ? "rgba(0,232,102,0.5)" : stats.avgAttendance >= 70 ? "rgba(255,170,0,0.5)" : "rgba(255,51,85,0.5)"}`,
                    color: stats.avgAttendance >= 85 ? "#6FFFAA" : stats.avgAttendance >= 70 ? "#FFD166" : "#FF99AA",
                    letterSpacing: "0.3px",
                  }}>
                  <span className="w-[6px] h-[6px] rounded-full" style={{
                    background: stats.avgAttendance >= 85 ? "#00FF88" : stats.avgAttendance >= 70 ? "#FFCC22" : "#FF5577",
                    boxShadow: `0 0 8px ${stats.avgAttendance >= 85 ? "#00FF88" : stats.avgAttendance >= 70 ? "#FFCC22" : "#FF5577"}`,
                  }} />
                  {stats.avgAttendance >= 85 ? "Strong" : stats.avgAttendance >= 70 ? "Holding" : stats.avgAttendance > 0 ? "Needs focus" : "No data"}
                </div>
              </div>
              <div className="flex items-end justify-between gap-8 flex-wrap">
                <div>
                  <div className="text-[84px] font-extrabold text-white leading-none mb-[6px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-3.8px" }}>
                    {stats.avgAttendance > 0 ? stats.avgAttendance.toFixed(1) : "—"}
                    {stats.avgAttendance > 0 && <span className="text-[40px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-1px" }}>%</span>}
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
                      <div className="text-[26px] font-extrabold text-white" style={{ letterSpacing: "-0.8px" }}>{v}</div>
                      <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>{l}</div>
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
                val: stats.avgAttendance > 0 ? `${stats.avgAttendance}%` : "—",
                color: B1, iconBg: B1,
                sub: stats.avgAttendance >= 85
                  ? <><span className="font-bold" style={{ color: GREEN }}>↑ Strong</span> · last 30d</>
                  : stats.avgAttendance > 0
                    ? <><span className="font-bold" style={{ color: ORANGE }}>● Watch</span> · last 30d</>
                    : <span>Awaiting data</span>,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="12" width="4" height="9" rx="1"/>
                    <rect x="10" y="8" width="4" height="13" rx="1"/>
                    <rect x="17" y="4" width="4" height="17" rx="1"/>
                  </svg>
                ),
                path: "/attendance",
              },
              {
                label: "Pending Grading",
                val: `${stats.pendingGrading}`,
                color: ORANGE, iconBg: ORANGE,
                sub: stats.pendingGrading === 0
                  ? <span className="font-bold" style={{ color: GREEN }}>✓ All caught up</span>
                  : <><span className="font-bold" style={{ color: ORANGE }}>● {stats.pendingGrading} to grade</span></>,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="3" width="16" height="18" rx="2"/>
                    <path d="M9 3v4h6V3"/>
                    <path d="M9 13l2 2 4-4"/>
                  </svg>
                ),
                path: "/gradebook",
              },
              {
                label: "At-Risk Students",
                val: `${stats.atRiskCount}`,
                color: RED, iconBg: RED,
                sub: stats.atRiskCount === 0
                  ? <span className="font-bold" style={{ color: GREEN }}>✓ On track</span>
                  : <span className="font-bold" style={{ color: RED }}>● Need outreach</span>,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 21h20L12 2z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12" y2="17"/>
                  </svg>
                ),
                path: "/risks-alerts",
              },
              {
                label: "Classes Today",
                val: `${stats.activeClasses}`,
                color: VIOLET, iconBg: VIOLET,
                sub: todayClasses.some(c => c.isNow)
                  ? <span className="font-bold" style={{ color: VIOLET }}>● 1 in progress</span>
                  : stats.activeClasses > 0
                    ? <span className="font-bold" style={{ color: VIOLET }}>● Scheduled</span>
                    : <span>None today</span>,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11l9-8 9 8"/>
                    <path d="M5 10v10h14V10"/>
                    <path d="M10 20v-6h4v6"/>
                  </svg>
                ),
                path: "/my-classes",
              },
            ].map(({ label, val, color, iconBg, sub, icon, path }) => (
              <button type="button" key={label}
                onClick={() => navigate(path)}
                {...tilt3D}
                className="bg-white rounded-[22px] p-5 relative flex flex-col text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                style={{
                  boxShadow: SH_LG_D,
                  border: `0.5px solid ${SEP_D}`,
                  ...tilt3DStyle,
                }}>
                <div className="flex items-start gap-[10px] mb-5 relative" style={{ minHeight: 44 }}>
                  <div className="flex-1 min-w-0 text-[11px] font-bold uppercase leading-[1.4] pt-[4px]" style={{ color: TT3, letterSpacing: "1px" }}>
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
                <div className="text-[38px] font-extrabold leading-none" style={{ color, letterSpacing: "-1.6px", transform: "translateZ(10px)" }}>{val}</div>
                <div className="text-[12px] font-semibold mt-2 flex items-center gap-[5px]" style={{ color: TT4, letterSpacing: "-0.15px" }}>
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
                sub: "See how students rank this week",
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
                sub: "You're #7 in your branch this week",
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
                    <div className="text-[17px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.4px" }}>Today's Classes</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>{todayClasses.length} scheduled</div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/my-classes')}
                  className="text-[13px] font-bold flex items-center gap-[2px] py-[6px] px-2 rounded-[8px] hover:bg-[#EEF4FF] transition-colors"
                  style={{ color: B1, letterSpacing: "-0.1px" }}>
                  See all <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
                </button>
              </div>
              {todayClasses.length === 0 ? (
                <div className="py-10 text-center text-[13px] font-medium" style={{ color: TT4 }}>No classes scheduled today</div>
              ) : (
                todayClasses.map((cls, idx) => (
                  <button type="button" key={idx}
                    onClick={() => navigate('/my-classes')}
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
                      <div className="flex items-center gap-[5px] px-[11px] py-[6px] rounded-full text-[10px] font-black text-white uppercase flex-shrink-0"
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
                    <div className="text-[17px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.4px" }}>Pending Tasks</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                      {pendingTasks.length} to complete
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
                    <div className="px-[12px] py-[6px] rounded-full text-[10px] font-black text-white uppercase flex-shrink-0"
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
                    <div className="text-[17px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.4px" }}>Needs Attention</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: TT3, letterSpacing: "-0.1px" }}>{criticalStudents.length} flagged</div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/risks-alerts')}
                  className="text-[13px] font-bold flex items-center gap-[2px] py-[6px] px-2 rounded-[8px] hover:bg-[#EEF4FF] transition-colors"
                  style={{ color: B1, letterSpacing: "-0.1px" }}>
                  View all <span className="text-[18px] leading-none opacity-80 -mt-[3px] ml-[2px]">›</span>
                </button>
              </div>
              {criticalStudents.length === 0 ? (
                <div className="py-10 text-center text-[13px] font-medium" style={{ color: TT4 }}>All students on track</div>
              ) : (
                criticalStudents.map((s, idx) => {
                  const name = s.studentName || "Student";
                  const initStr = (() => { const p = name.trim().split(" "); return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].substring(0, 2)).toUpperCase(); })();
                  const avatarBg = [B1, ORANGE, VIOLET][idx % 3];
                  return (
                    <div key={idx}
                      onClick={() => navigate(`/students?studentId=${s.studentId || ''}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/students?studentId=${s.studentId || ''}`); }}
                      className={`flex items-center gap-3 p-3 pl-4 rounded-[14px] cursor-pointer hover:brightness-[0.97] transition ${idx < criticalStudents.length - 1 ? "mb-2" : ""}`}
                      style={{ background: "rgba(255,51,85,0.04)" }}>
                      <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white text-[12px] font-extrabold flex-shrink-0"
                        style={{ background: avatarBg, letterSpacing: "0.3px" }}>
                        {initStr}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold truncate" style={{ color: TT1, letterSpacing: "-0.25px" }}>{name}</div>
                        <div className="flex items-center gap-[5px] mt-[3px] text-[12px] font-semibold" style={{ color: RED, letterSpacing: "-0.1px" }}>
                          <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: RED }} />
                          <span className="truncate">{s.trigger}</span>
                        </div>
                      </div>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); navigate('/risks-alerts'); }}
                        className="px-4 py-[9px] rounded-[11px] text-[12px] font-bold text-white flex-shrink-0 hover:scale-[1.04] active:scale-[0.95] transition-transform"
                        style={{ background: RED, letterSpacing: "-0.1px" }}>
                        Notify
                      </button>
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
                  <div className="text-[11px] font-black uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>AI Teacher Intelligence</div>
                  <div className="ml-auto px-[11px] py-[5px] rounded-full text-[10px] font-extrabold"
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
                    <div className="text-[22px] font-extrabold" style={{ color: stats.avgAttendance >= 70 ? "#6FFFAA" : "#FF8899", letterSpacing: "-0.6px" }}>
                      {stats.avgAttendance > 0 ? `${stats.avgAttendance}%` : "—"}
                    </div>
                    <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attend.</div>
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/risks-alerts'); }}
                    className="py-4 px-3 text-center hover:brightness-110 transition"
                    style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[22px] font-extrabold" style={{ color: stats.atRiskCount > 0 ? "#FF8899" : "#fff", letterSpacing: "-0.6px" }}>{stats.atRiskCount}</div>
                    <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>At-Risk</div>
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/my-classes'); }}
                    className="py-4 px-3 text-center hover:brightness-110 transition"
                    style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[22px] font-extrabold text-white" style={{ letterSpacing: "-0.6px" }}>{stats.activeClasses}</div>
                    <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Classes</div>
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
