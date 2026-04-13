import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { Loader2, X, MessageSquare } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

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
const IcoGrid = ({ size = 20, color = T.blue }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="7" height="7" rx="1.5"/>
    <rect x="11" y="2" width="7" height="7" rx="1.5"/>
    <rect x="2" y="11" width="7" height="7" rx="1.5"/>
    <rect x="11" y="11" width="7" height="7" rx="1.5"/>
  </svg>
);
const IcoUser = ({ size = 20, color = T.ink2 }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="7" r="3.5"/>
    <path d="M3 18c0-3.866 3.134-7 7-7s7 3.134 7 7"/>
  </svg>
);

// ── Badge component ────────────────────────────────────────────────────────────
const Badge = ({ text, bg, color }: { text: string; bg: string; color: string }) => (
  <span style={{
    background: bg, color, borderRadius: 20,
    padding: '3px 8px', fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap'
  }}>
    {text}
  </span>
);

// ── Icon box component ─────────────────────────────────────────────────────────
const IconBox = ({ bg, children, size = 32 }: { bg: string; children: React.ReactNode; size?: number }) => (
  <div style={{
    width: size, height: size, background: bg, borderRadius: size === 32 ? 9 : 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
  }}>
    {children}
  </div>
);

const Dashboard = () => {
  const { teacherData } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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
    if (!teacherData?.id) return;
    const q = query(
      collection(db, "parent_notes"),
      where("teacherId", "==", teacherData.id),
      where("from", "==", "parent")
    );
    return onSnapshot(q, (snap) => {
      const unread = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(n => n.read !== true)
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        .slice(0, 10);
      setUnreadNotes(unread);
    });
  }, [teacherData?.id]);

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
    if (!teacherData?.id) return;
    const schoolId = teacherData.schoolId as string | undefined;
    const branchId = teacherData.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
    if (branchId) SC.push(where("branchId", "==", branchId));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toLocaleDateString("en-CA");
    const q = query(collection(db, "attendance"), where("teacherId", "==", teacherData.id), where("date", ">=", cutoffStr), ...SC);
    return onSnapshot(q, (snap) => {
      const att = snap.docs.map((d: any) => d.data());
      const pres = att.filter((a: any) => a.status === 'present' || a.status === 'late').length;
      setStats(prev => ({ ...prev, avgAttendance: att.length > 0 ? Number(((pres / att.length) * 100).toFixed(1)) : 0 }));
    });
  }, [teacherData?.id]);

  // Main data harvest
  useEffect(() => {
    if (!teacherData?.id) return;
    setLoading(true);
    const tId = teacherData.id;
    const tEmail = teacherData.email?.toLowerCase();
    const schoolId = teacherData.schoolId as string | undefined;
    const branchId = teacherData.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
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
  }, [teacherData?.id, teacherData?.email]);

  if (loading) return (
    <div className="h-screen flex items-center justify-center" style={{ background: T.surface1 }}>
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: T.blue }} />
    </div>
  );

  // ── Derived values ─────────────────────────────────────────────────────────
  const firstName = teacherData?.name?.split(" ")[0] || "Teacher";
  const dayLabel = new Date().toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric' });

  // Badge helpers
  const atndBadge  = stats.avgAttendance > 0 ? { text: `+${Math.abs(stats.avgAttendance - 91.8).toFixed(1)}%`, bg: T.greenL, color: T.green } : { text: "No data", bg: T.surface2, color: T.ink2 };
  const gradeBadge = stats.pendingGrading > 0 ? { text: "Urgent", bg: T.redL, color: T.red } : { text: "All clear", bg: T.greenL, color: T.green };
  const riskBadge  = stats.atRiskCount > 0 ? { text: `${stats.atRiskCount} flagged`, bg: T.redL, color: T.red } : { text: "Secure", bg: T.greenL, color: T.green };
  const clsBadge   = { text: "On track", bg: T.greenL, color: T.green };

  // Student avatar colors
  const avatarStyles = [
    { bg: T.blueL, color: T.blue },
    { bg: T.amberL, color: T.amber },
    { bg: T.purpleL, color: T.purple },
  ];

  const studentBadge = (lvl: string) =>
    lvl === 'critical'
      ? { text: "At risk",   bg: T.redL,    color: T.red    }
      : { text: "Follow up", bg: T.amberL,  color: T.amber  };

  const taskBadge = (status: string) =>
    status === 'Done'    ? { text: "Done",    bg: T.greenL,  color: T.green  } :
    status === 'Pending' ? { text: "Pending", bg: T.amberL,  color: T.amber  } :
                           { text: "Todo",    bg: T.blueL,   color: T.blue   };

  const classBadge = (isNow: boolean, idx: number) =>
    isNow ? { text: "Live", bg: T.greenL, color: T.green } :
    idx === 1 ? { text: "Soon", bg: T.amberL, color: T.amber } :
    { text: "Later", bg: T.surface2, color: T.ink2 };

  // Tab bar tabs
  const tabs = [
    { label: "Dashboard", path: "/",           icon: (active: boolean) => <IcoGrid  size={20} color={active ? T.blue : T.ink2} /> },
    { label: "Classes",   path: "/my-classes", icon: (active: boolean) => <IcoHome  size={20} color={active ? T.blue : T.ink2} /> },
    { label: "Schedule",  path: "/attendance", icon: (active: boolean) => <IcoCalendar size={20} color={active ? T.blue : T.ink2} /> },
    { label: "Profile",   path: "/settings",   icon: (active: boolean) => <IcoUser  size={20} color={active ? T.blue : T.ink2} /> },
  ];
  const activeTab = location.pathname;

  return (
    <div style={{ background: T.surface1, fontFamily: 'inherit' }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ── Hero (dark, full-bleed) ─────────────────────────────────────────── */}
      <div
        style={{ background: T.ink0 }}
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-7"
      >
        {/* Welcome row */}
        <div className="flex items-start justify-between pt-2">
          <div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', fontWeight: 400 }}>
              Welcome back
            </p>
            <h1 style={{
              fontSize: 24, fontWeight: 500, color: '#FFFFFF',
              letterSpacing: '-0.5px', lineHeight: 1.2, margin: '2px 0'
            }}>
              Hello, {firstName}
            </h1>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>
              {dayLabel}
            </p>
          </div>

          {/* Bell button */}
          <div className="relative mt-1" ref={notifRef}>
            <button
              onClick={() => setShowNotifPanel(p => !p)}
              style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)',
                border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <IcoBell size={18} />
            </button>
            {unreadNotes.length > 0 && (
              <span style={{
                position: 'absolute', top: -1, right: -1,
                width: 8, height: 8, borderRadius: '50%',
                background: '#FF4757', border: `1.5px solid ${T.ink0}`
              }} />
            )}

            {/* Notification panel */}
            {showNotifPanel && (
              <div className="absolute right-0 top-11 w-[calc(100vw-2.5rem)] sm:w-80 max-w-sm bg-white rounded-2xl shadow-2xl z-50 overflow-hidden"
                style={{ border: `1px solid ${T.border}` }}>
                <div className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: `1px solid ${T.surface2}` }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: T.ink0 }}>Notifications</p>
                    <p style={{ fontSize: 10, color: T.ink2, fontWeight: 400 }}>
                      {unreadNotes.length > 0 ? `${unreadNotes.length} unread from parents` : "All caught up!"}
                    </p>
                  </div>
                  <button onClick={() => setShowNotifPanel(false)}
                    className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
                    <X size={14} className="text-slate-400" />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {unreadNotes.length === 0 ? (
                    <div className="py-10 text-center" style={{ fontSize: 13, color: T.ink2 }}>No new notifications</div>
                  ) : (
                    unreadNotes.map(note => (
                      <button key={note.id}
                        onClick={() => { setShowNotifPanel(false); navigate("/parent-notes"); }}
                        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 text-left"
                        style={{ borderBottom: `1px solid ${T.surface2}` }}>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: T.blueL }}>
                          <MessageSquare size={13} style={{ color: T.blue }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p style={{ fontSize: 12, fontWeight: 500, color: T.ink0 }} className="truncate">
                            {note.studentName || "Parent Message"}
                          </p>
                          <p style={{ fontSize: 11, color: T.ink1, fontWeight: 400 }} className="truncate mt-0.5">
                            {note.content || "New message received"}
                          </p>
                        </div>
                        <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: T.blue }} />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Metric Cards (2×2 grid) ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 pt-5 pb-1">

        {/* Card 1 — Attendance */}
        <div style={{ background: T.surface0, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16 }}>
          <div className="flex items-center justify-between mb-3">
            <IconBox bg={T.blueL}><IcoBarChart size={16} color={T.blue} /></IconBox>
            <Badge text={atndBadge.text} bg={atndBadge.bg} color={atndBadge.color} />
          </div>
          <p style={{ fontSize: 22, fontWeight: 500, color: T.blue, letterSpacing: '-0.5px', lineHeight: 1 }}>
            {stats.avgAttendance > 0 ? `${stats.avgAttendance}%` : "—"}
          </p>
          <p style={{ fontSize: 11, color: T.ink2, fontWeight: 400, marginTop: 4 }}>Attendance rate</p>
          {/* Progress bar */}
          <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: T.blueL, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, background: T.blue, width: `${Math.min(stats.avgAttendance, 100)}%`, transition: 'width 0.5s ease' }} />
          </div>
        </div>

        {/* Card 2 — Pending Grading */}
        <div style={{ background: T.surface0, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16 }}>
          <div className="flex items-center justify-between mb-3">
            <IconBox bg={T.amberL}><IcoClipboard size={16} color={T.amber} /></IconBox>
            <Badge text={gradeBadge.text} bg={gradeBadge.bg} color={gradeBadge.color} />
          </div>
          <p style={{ fontSize: 22, fontWeight: 500, color: T.ink0, letterSpacing: '-0.5px', lineHeight: 1 }}>
            {stats.pendingGrading}
          </p>
          <p style={{ fontSize: 11, color: T.ink2, fontWeight: 400, marginTop: 4 }}>Pending grading</p>
        </div>

        {/* Card 3 — At-risk Students */}
        <div style={{ background: T.surface0, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16 }}>
          <div className="flex items-center justify-between mb-3">
            <IconBox bg={T.redL}><IcoAlert size={16} color={T.red} /></IconBox>
            <Badge text={riskBadge.text} bg={riskBadge.bg} color={riskBadge.color} />
          </div>
          <p style={{ fontSize: 22, fontWeight: 500, color: T.ink0, letterSpacing: '-0.5px', lineHeight: 1 }}>
            {stats.atRiskCount}
          </p>
          <p style={{ fontSize: 11, color: T.ink2, fontWeight: 400, marginTop: 4 }}>At-risk students</p>
        </div>

        {/* Card 4 — Classes Today */}
        <div style={{ background: T.surface0, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16 }}>
          <div className="flex items-center justify-between mb-3">
            <IconBox bg={T.purpleL}><IcoHome size={16} color={T.purple} /></IconBox>
            <Badge text={clsBadge.text} bg={clsBadge.bg} color={clsBadge.color} />
          </div>
          <p style={{ fontSize: 22, fontWeight: 500, color: T.ink0, letterSpacing: '-0.5px', lineHeight: 1 }}>
            {stats.activeClasses}
          </p>
          <p style={{ fontSize: 11, color: T.ink2, fontWeight: 400, marginTop: 4 }}>Classes today</p>
        </div>
      </div>

      {/* ── Today's Classes ──────────────────────────────────────────────────── */}
      <div style={{ background: T.surface0, border: `1px solid ${T.border}`, borderRadius: 20, margin: '16px 0 12px' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <IconBox bg={T.blueL}><IcoCalendar size={16} color={T.blue} /></IconBox>
            <span style={{ fontSize: 15, fontWeight: 500, color: T.ink0 }}>Today's classes</span>
          </div>
          <button onClick={() => navigate('/my-classes')}
            style={{ fontSize: 13, fontWeight: 400, color: T.blue, background: 'none', border: 'none', cursor: 'pointer' }}>
            See all
          </button>
        </div>
        <div style={{ height: 1, background: T.surface2 }} />

        {todayClasses.length === 0 ? (
          <div className="py-10 text-center" style={{ fontSize: 13, color: T.ink2, fontWeight: 400 }}>
            No classes scheduled today
          </div>
        ) : (
          todayClasses.map((cls, idx) => (
            <div key={idx}>
              <button
                onClick={() => navigate('/my-classes')}
                className="w-full text-left flex items-center gap-3 px-4"
                style={{ padding: '12px 16px' }}
              >
                {/* Time */}
                <div style={{ minWidth: 44, textAlign: 'right' }}>
                  <span style={{ fontSize: 12, color: T.ink2, fontWeight: 400, whiteSpace: 'pre' }}>
                    {cls.time || "—"}
                  </span>
                </div>
                {/* Icon */}
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: T.blueL, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <IcoHome size={15} color={T.blue} />
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 13, fontWeight: 500, color: T.ink0 }} className="truncate">
                    {cls.className}
                  </p>
                  <p style={{ fontSize: 11, color: T.ink2, fontWeight: 400, marginTop: 1 }}>
                    {cls.subject} · {cls.students} {cls.students === 1 ? "student" : "students"}
                  </p>
                </div>
                {/* Badge */}
                <Badge {...classBadge(cls.isNow, idx)} />
              </button>
              {idx < todayClasses.length - 1 && <div style={{ height: 1, background: T.surface2, margin: '0 16px' }} />}
            </div>
          ))
        )}
      </div>

      {/* ── Pending Tasks ────────────────────────────────────────────────────── */}
      <div style={{ background: T.surface0, border: `1px solid ${T.border}`, borderRadius: 20, marginBottom: 12 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <IconBox bg={T.amberL}><IcoCheck size={16} color={T.amber} /></IconBox>
            <span style={{ fontSize: 15, fontWeight: 500, color: T.ink0 }}>Pending tasks</span>
          </div>
          <button
            onClick={() => navigate('/attendance')}
            style={{ fontSize: 13, fontWeight: 400, color: T.blue, background: 'none', border: 'none', cursor: 'pointer' }}>
            Add
          </button>
        </div>
        <div style={{ height: 1, background: T.surface2 }} />

        {pendingTasks.length === 0 ? (
          <div className="py-10 text-center" style={{ fontSize: 13, color: T.ink2, fontWeight: 400 }}>
            All tasks complete
          </div>
        ) : (
          pendingTasks.map((task, idx) => {
            const badge = taskBadge(task.status);
            return (
              <div key={idx}>
                <button
                  onClick={() => navigate(task.title.includes('Attendance') ? '/attendance' : '/gradebook')}
                  className="w-full flex items-center gap-3"
                  style={{ padding: '12px 16px', textAlign: 'left' }}
                >
                  {/* Checkbox */}
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: task.done ? T.green : 'transparent',
                    border: task.done ? 'none' : `1px solid ${T.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {task.done && <IcoCheckFilled size={10} />}
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p style={{
                      fontSize: 14, fontWeight: 500, color: task.done ? T.ink2 : T.ink0,
                      textDecoration: task.done ? 'line-through' : 'none'
                    }} className="truncate">
                      {task.title}
                    </p>
                    <p style={{ fontSize: 11, color: T.ink2, fontWeight: 400, marginTop: 1 }}>{task.sub}</p>
                  </div>
                  <Badge text={badge.text} bg={badge.bg} color={badge.color} />
                </button>
                {idx < pendingTasks.length - 1 && <div style={{ height: 1, background: T.surface2, margin: '0 16px' }} />}
              </div>
            );
          })
        )}
      </div>

      {/* ── Needs Attention ──────────────────────────────────────────────────── */}
      <div style={{ background: T.surface0, border: `1px solid ${T.border}`, borderRadius: 20, marginBottom: 20 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <IconBox bg={T.redL}><IcoAlert size={16} color={T.red} /></IconBox>
            <span style={{ fontSize: 15, fontWeight: 500, color: T.ink0 }}>Needs attention</span>
          </div>
          <button onClick={() => navigate('/risks-alerts')}
            style={{ fontSize: 13, fontWeight: 400, color: T.blue, background: 'none', border: 'none', cursor: 'pointer' }}>
            View all
          </button>
        </div>
        <div style={{ height: 1, background: T.surface2 }} />

        {criticalStudents.length === 0 ? (
          <div className="py-10 text-center" style={{ fontSize: 13, color: T.ink2, fontWeight: 400 }}>
            All students on track
          </div>
        ) : (
          criticalStudents.map((s, idx) => {
            const av  = avatarStyles[idx % avatarStyles.length];
            const bdg = studentBadge(s.level);
            const name = s.studentName || "Student";
            const initStr = (() => { const p = name.trim().split(" "); return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].substring(0, 2)).toUpperCase(); })();
            return (
              <div key={idx}>
                <div className="flex items-center gap-3" style={{ padding: '12px 16px' }}>
                  {/* Avatar */}
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: av.bg, color: av.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 500
                  }}>
                    {initStr}
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 14, fontWeight: 500, color: T.ink0 }} className="truncate">{name}</p>
                    <p style={{ fontSize: 12, color: T.ink2, fontWeight: 400, marginTop: 1 }} className="truncate">{s.trigger}</p>
                  </div>
                  <Badge text={bdg.text} bg={bdg.bg} color={bdg.color} />
                </div>
                {idx < criticalStudents.length - 1 && <div style={{ height: 1, background: T.surface2, margin: '0 16px' }} />}
              </div>
            );
          })
        )}
      </div>

      {/* ── Bottom Tab Bar (mobile only) ─────────────────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40"
        style={{ background: T.surface0, borderTop: `1px solid ${T.border}`, padding: '10px 24px 20px' }}>
        <div className="flex items-start justify-around">
          {tabs.map(tab => {
            const isActive = tab.path === "/" ? activeTab === "/" : activeTab.startsWith(tab.path);
            return (
              <button key={tab.label} onClick={() => navigate(tab.path)}
                className="flex flex-col items-center gap-1"
                style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 48 }}>
                {tab.icon(isActive)}
                <span style={{
                  fontSize: 10, fontWeight: 500,
                  color: isActive ? T.blue : T.ink2
                }}>
                  {tab.label}
                </span>
                {isActive && (
                  <div style={{
                    width: 14, height: 2.5, borderRadius: 2,
                    background: T.blue, marginTop: 1
                  }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
};

export default Dashboard;