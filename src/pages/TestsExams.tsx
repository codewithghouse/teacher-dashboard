import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import CreateTest from "../components/CreateTest";
import EnterScores from "../components/EnterScores";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, Search } from "lucide-react";

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF', blueB: '#BAC8FF',
  purple: '#6741D9', purpleL: '#F3F0FF',
  green: '#087F5B', greenL: '#EBFBEE', green2: '#2F9E44',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── SVG Icons ────────────────────────────────────────────────────────────────
const IcoClock  = ({ color = T.amber }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="5.5"/><polyline points="7,4 7,7 9.5,7"/>
  </svg>
);
const IcoCheck2 = ({ color = T.green }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2,7.5 5.5,11 12,3.5"/>
  </svg>
);
const IcoDoc    = ({ color = T.red }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="1.5" width="10" height="11" rx="1.5"/>
    <line x1="4.5" y1="5.5" x2="9.5" y2="5.5"/><line x1="4.5" y1="8" x2="7" y2="8"/>
  </svg>
);
const IcoTrend  = ({ color = T.blue }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2,10 5,6.5 8,8.5 12,3.5"/><polyline points="10,3.5 12,3.5 12,5.5"/>
  </svg>
);
const IcoPlus = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
    <line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/>
  </svg>
);
const IcoCalSmall = ({ color = T.ink2 }: { color?: string }) => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1.5" width="10" height="9" rx="1.5"/>
    <line x1="3.5" y1="1" x2="3.5" y2="3"/><line x1="8.5" y1="1" x2="8.5" y2="3"/>
    <line x1="1" y1="5" x2="11" y2="5"/>
  </svg>
);
const IcoClockSmall = ({ color = T.ink2 }: { color?: string }) => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
    <circle cx="6" cy="6" r="4.5"/><polyline points="6,3.5 6,6 8.5,6"/>
  </svg>
);
const IcoUser3 = ({ color = T.ink2 }: { color?: string }) => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 9.5c0 0 1.5-2 4-2s4 2 4 2"/><circle cx="6" cy="5" r="2.5"/>
  </svg>
);
const IcoEye = ({ color = T.blue }: { color?: string }) => (
  <svg width="11" height="11" viewBox="0 0 13 13" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6.5" cy="6.5" r="2.5"/>
    <path d="M1,6.5 C1,6.5 3.5,2 6.5,2 C9.5,2 12,6.5 12,6.5 C12,6.5 9.5,11 6.5,11 C3.5,11 1,6.5 1,6.5Z"/>
  </svg>
);
const IcoDots = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="3" r=".8" fill={T.ink2}/><circle cx="6" cy="6" r=".8" fill={T.ink2}/>
    <circle cx="6" cy="9" r=".8" fill={T.ink2}/>
  </svg>
);
const IcoDoc2 = ({ color = T.purple }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="1.5" width="10" height="11" rx="1.5"/>
    <line x1="4.5" y1="5" x2="9.5" y2="5"/><line x1="4.5" y1="7.5" x2="8" y2="7.5"/>
  </svg>
);
// Tab bar
const IcoGrid    = ({ a }: { a: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke={a ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round">
    <rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="11" y="2" width="5" height="5" rx="1.2"/>
    <rect x="2" y="11" width="5" height="5" rx="1.2"/><rect x="11" y="11" width="5" height="5" rx="1.2"/>
  </svg>
);
const IcoAtnd    = ({ a }: { a: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke={a ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round">
    <polyline points="2.5,8.5 6,12 13.5,4"/>
  </svg>
);
const IcoTests   = ({ a }: { a: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke={a ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round">
    <rect x="2" y="2" width="14" height="14" rx="2"/>
    <line x1="5.5" y1="7" x2="12.5" y2="7"/><line x1="5.5" y1="10" x2="9.5" y2="10"/>
  </svg>
);
const IcoUser4   = ({ a }: { a: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke={a ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round">
    <circle cx="9" cy="7" r="3"/><path d="M3 17c0 0 1.5-4 6-4s6 4 6 4"/>
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
const daysLabel = (dateStr: string) => {
  if (!dateStr) return "";
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (diff < 0)   return `${Math.abs(diff)}d ago`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `In ${diff}d`;
};

const perfColor = (avg: number) =>
  avg >= 75 ? T.blue : avg >= 60 ? T.amber : T.red;
const perfBg = (avg: number) =>
  avg >= 75 ? T.blueL : avg >= 60 ? T.amberL : T.redL;

// ── Component ─────────────────────────────────────────────────────────────────
export default function TestsExams() {
  const { teacherData } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [view, setView]               = useState<"list" | "create" | "enter-scores">("list");
  const [selectedTest, setSelectedTest] = useState<any>(null);
  const [tests, setTests]             = useState<any[]>([]);
  const [scores, setScores]           = useState<any[]>([]);
  const [classes, setClasses]         = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState("");

  // Fetch tests
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    const branchId = teacherData.branchId as string | undefined;
    let ignore = false;
    const tenant = branchId
      ? [where("schoolId", "==", schoolId), where("branchId", "==", branchId)]
      : [where("schoolId", "==", schoolId)];
    const unsub = onSnapshot(
      query(
        collection(db, "tests"),
        ...tenant,
        where("teacherId", "==", teacherData.id),
      ),
      async (snap) => {
        const raw = snap.docs.map(d => ({ ...d.data(), id: d.id } as Record<string, unknown> & { id: string; classId?: string; testDate?: string; createdAt?: { toDate?: () => Date } }));
        raw.sort((a, b) => {
          const dA = a.testDate ? new Date(a.testDate).getTime() : (a.createdAt?.toDate?.()?.getTime?.() || 0);
          const dB = b.testDate ? new Date(b.testDate).getTime() : (b.createdAt?.toDate?.()?.getTime?.() || 0);
          return dA - dB;
        });
        const enriched = await Promise.all(raw.map(async t => {
          if (!t.classId) return { ...t, studentsCount: 0 };
          const enSnap = await getDocs(query(
            collection(db, "enrollments"),
            ...tenant,
            where("classId", "==", t.classId),
          ));
          return { ...t, studentsCount: enSnap.size };
        }));
        if (ignore) return;
        setTests(enriched);
        setLoading(false);
      }
    );
    return () => { ignore = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Fetch scores
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    const branchId = teacherData.branchId as string | undefined;
    const tenant = branchId
      ? [where("schoolId", "==", schoolId), where("branchId", "==", branchId)]
      : [where("schoolId", "==", schoolId)];
    const unsub = onSnapshot(
      query(
        collection(db, "test_scores"),
        ...tenant,
        where("teacherId", "==", teacherData.id),
      ),
      snap => setScores(snap.docs.map(d => d.data()))
    );
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Fetch classes
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    getDocs(query(
      collection(db, "classes"),
      where("schoolId", "==", schoolId),
      where("teacherId", "==", teacherData.id),
    ))
      .then(snap => setClasses(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Stats
  const stats = useMemo(() => {
    const upcoming      = tests.filter(t => t.status !== "Completed" && t.status !== "Pending Scores").length;
    const completed     = tests.filter(t => t.status === "Completed").length;
    const pendingScores = tests.filter(t => t.status === "Pending Scores" || t.status === "Draft").length;
    const total         = scores.length;
    const sum           = scores.reduce((a, s) => a + parseFloat(s.percentage || s.score || 0), 0);
    const classAvg      = total > 0 ? (sum / total) : null;
    return { upcoming, completed, pendingScores, classAvg };
  }, [tests, scores]);

  // Per-class performance
  const classPerf = useMemo(() => {
    return classes.map(cls => {
      const clsTests    = tests.filter(t => t.classId === cls.id).map(t => t.id);
      const clsScoreArr = scores.filter(s => clsTests.includes(s.testId || ""));
      const avg = clsScoreArr.length > 0
        ? clsScoreArr.reduce((a, s) => a + parseFloat(s.percentage || s.score || 0), 0) / clsScoreArr.length
        : null;
      return { name: cls.name, avg };
    }).filter(c => c.avg !== null);
  }, [classes, tests, scores]);

  // Per-topic performance
  const topicPerf = useMemo(() => {
    const map: Record<string, number[]> = {};
    scores.forEach(s => {
      const topic = s.topic || s.subject || s.testTitle || "General topics";
      if (!map[topic]) map[topic] = [];
      map[topic].push(parseFloat(s.percentage || s.score || 0));
    });
    return Object.entries(map)
      .map(([name, arr]) => ({ name, avg: arr.reduce((a, b) => a + b, 0) / arr.length }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);
  }, [scores]);

  if (view === "create")       return <CreateTest onCancel={() => setView("list")} onCreate={() => setView("list")} />;
  if (view === "enter-scores") return <EnterScores test={selectedTest} onBack={() => setView("list")} />;

  const filtered = tests.filter(t =>
    (t.title || "").toLowerCase().includes(search.toLowerCase()) ||
    (t.className || "").toLowerCase().includes(search.toLowerCase())
  );

  // Tabs
  const tabs = [
    { label: "Dashboard",  path: "/",           icon: (a: boolean) => <IcoGrid  a={a} /> },
    { label: "Attendance", path: "/attendance",  icon: (a: boolean) => <IcoAtnd  a={a} /> },
    { label: "Tests",      path: "/tests",       icon: (a: boolean) => <IcoTests a={a} /> },
    { label: "Profile",    path: "/settings",    icon: (a: boolean) => <IcoUser4 a={a} /> },
  ];
  const activePath = location.pathname;

  // Metric config
  const metrics = [
    {
      ico: <IcoClock color={T.amber} />, icoBg: T.amberL,
      val: stats.upcoming, valColor: T.ink1,
      lbl: "Upcoming",
      badgeTxt: stats.upcoming === 0 ? "None" : "Scheduled",
      badgeBg: T.s2, badgeColor: T.ink2,
      barFill: T.amber, barW: stats.upcoming > 0 ? Math.min(100, stats.upcoming * 25) : 0,
    },
    {
      ico: <IcoCheck2 color={T.green} />, icoBg: T.greenL,
      val: stats.completed, valColor: stats.completed > 0 ? T.green : T.ink1,
      lbl: "Completed",
      badgeTxt: stats.completed > 0 ? "Done" : "None",
      badgeBg: stats.completed > 0 ? T.greenL : T.s2,
      badgeColor: stats.completed > 0 ? T.green : T.ink2,
      barFill: T.green2, barW: stats.completed > 0 ? Math.min(100, stats.completed * 25) : 0,
    },
    {
      ico: <IcoDoc color={T.red} />, icoBg: T.redL,
      val: stats.pendingScores, valColor: T.ink1,
      lbl: "Pending scores",
      badgeTxt: stats.pendingScores === 0 ? "All clear" : "Pending",
      badgeBg: stats.pendingScores === 0 ? T.greenL : T.amberL,
      badgeColor: stats.pendingScores === 0 ? T.green : T.amber,
      barFill: T.red, barW: stats.pendingScores > 0 ? Math.min(100, stats.pendingScores * 25) : 0,
    },
    {
      ico: <IcoTrend color={T.blue} />, icoBg: T.blueL,
      val: stats.classAvg !== null ? `${stats.classAvg.toFixed(1)}%` : "—",
      valColor: stats.classAvg !== null && stats.classAvg >= 60 ? T.blue : T.ink1,
      lbl: "Class avg",
      badgeTxt: stats.classAvg !== null ? (stats.classAvg >= 75 ? "Good" : "Fair") : "No data",
      badgeBg: stats.classAvg !== null && stats.classAvg >= 75 ? T.blueL : T.s2,
      badgeColor: stats.classAvg !== null && stats.classAvg >= 75 ? T.blue : T.ink2,
      barFill: T.blue, barW: stats.classAvg !== null ? Math.min(100, stats.classAvg) : 0,
    },
  ];

  return (
    <div style={{ fontFamily: 'inherit' }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <div className="md:hidden" style={{ background: T.s1 }}>

      {/* ── Dark Hero ──────────────────────────────────────────────────────── */}
      <div
        className="-mx-4 sm:-mx-6 px-[22px] pb-5 bg-[#162E93] md:bg-[#08090C]"
      >
        <p style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>
          Tests &amp; Exams
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', lineHeight: 1.15 }}>
          Track &amp;<br />analyze performance
        </h1>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.32)', marginTop: 4 }}>
          Manage tests, enter scores and review class progress.
        </p>

        {/* Hero summary chips */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{
            padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.06)', fontSize: 11, color: 'rgba(255,255,255,0.65)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <IcoCheck2 color="rgba(255,255,255,0.45)" />
            <strong style={{ color: '#fff' }}>{stats.completed}</strong> Completed
          </div>
          <div style={{
            padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.06)', fontSize: 11, color: 'rgba(255,255,255,0.65)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <IcoClock color="rgba(255,255,255,0.45)" />
            {stats.upcoming} Upcoming
          </div>
          {stats.classAvg !== null && (
            <div style={{
              padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.06)', fontSize: 11, color: 'rgba(255,255,255,0.65)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <IcoTrend color="rgba(255,255,255,0.45)" />
              <strong style={{ color: '#fff' }}>{stats.classAvg.toFixed(1)}%</strong> Avg
            </div>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 md:px-0 pt-4 flex flex-col gap-3">

        {/* Create CTA */}
        <button
          onClick={() => setView("create")}
          style={{
            width: '100%', padding: 13, borderRadius: 13, background: T.blue,
            border: 'none', color: '#fff', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}
        >
          <IcoPlus /> Create test
        </button>

        {/* Metric grid */}
        <div className="grid grid-cols-2 gap-[9px]">
          {metrics.map((m, i) => (
            <div key={i} style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, padding: 13 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: m.icoBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {m.ico}
                </div>
                <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: m.badgeBg, color: m.badgeColor, whiteSpace: 'nowrap' }}>
                  {m.badgeTxt}
                </span>
              </div>
              <div style={{ fontSize: 21, fontWeight: 500, letterSpacing: '-0.5px', lineHeight: 1, color: m.valColor }}>{m.val}</div>
              <div style={{ fontSize: 11, color: T.ink2, marginTop: 3 }}>{m.lbl}</div>
              <div style={{ height: 3, borderRadius: 2, background: T.s2, marginTop: 9, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, background: m.barFill, width: `${m.barW}%`, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Test Schedule card */}
        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', borderBottom: `1px solid ${T.s2}` }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: T.ink1, display: 'flex', alignItems: 'center', gap: 7 }}>
              <IcoCalSmall color={T.blue} />
              Test schedule
            </div>
            <div style={{ position: 'relative' }}>
              <Search style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, color: T.ink2, pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Search tests..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  padding: '7px 10px 7px 26px', borderRadius: 10,
                  border: `1px solid ${T.bdr}`, background: T.s1,
                  fontSize: 11, color: T.ink1, fontFamily: 'inherit',
                  outline: 'none', width: 120,
                }}
              />
            </div>
          </div>

          {/* Test items */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: T.blue }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '32px 14px', textAlign: 'center', fontSize: 12, color: T.ink2 }}>
              No tests yet — create your first one!
            </div>
          ) : (
            filtered.map((test, idx) => {
              const isPast = test.testDate && new Date(test.testDate).getTime() < Date.now();
              const statusBadge = test.status === "Completed"
                ? { bg: T.greenL, color: T.green, text: "Completed" }
                : test.status === "Pending Scores"
                ? { bg: T.amberL, color: T.amber, text: "Pending Scores" }
                : { bg: T.s2, color: T.ink2, text: daysLabel(test.testDate) };

              return (
                <div
                  key={test.id}
                  onClick={() => { setSelectedTest(test); setView("enter-scores"); }}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer hover:bg-slate-50 transition-colors"
                  style={{ padding: '13px 14px', borderBottom: idx < filtered.length - 1 ? `1px solid ${T.s2}` : 'none' }}
                >

                  {/* Top row: icon + name + badge */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 9, background: T.purpleL, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <IcoDoc2 color={T.purple} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: T.ink1, letterSpacing: '-0.1px', textTransform: 'capitalize' }}>
                          {test.title || test.subject || "Untitled Test"}
                        </div>
                        <div style={{ fontSize: 11, color: T.ink2, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <IcoUser3 />
                          {test.className || "Class"} · {test.studentsCount} students
                        </div>
                      </div>
                    </div>
                    <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: statusBadge.bg, color: statusBadge.color, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {statusBadge.text}
                    </span>
                  </div>

                  {/* Info row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, marginTop: 8, flexWrap: 'wrap' }}>
                    {test.testDate && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.ink2 }}>
                        <IcoCalSmall />
                        {new Date(test.testDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    )}
                    {test.marks && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.ink2 }}>
                        <IcoClockSmall />
                        {test.marks} marks
                      </div>
                    )}
                    {test.studentsCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.ink2 }}>
                        <IcoUser3 />
                        {test.studentsCount} / {test.studentsCount}
                      </div>
                    )}
                    {test.status === "Completed" && (
                      <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: T.greenL, color: T.green }}>
                        Completed
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedTest(test); setView("enter-scores"); }}
                      style={{
                        flex: 1, padding: '9px 12px', borderRadius: 10,
                        background: T.blueL, border: `1px solid ${T.blueB}`,
                        color: T.blue, fontSize: 12, fontWeight: 500,
                        cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      }}
                    >
                      <IcoEye />
                      {isPast ? "View scores" : "Enter scores"}
                    </button>
                    <div style={{
                      width: 32, height: 32, borderRadius: 9, border: `1px solid ${T.bdr}`,
                      background: T.s1, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}>
                      <IcoDots />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Performance Overview card */}
        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ padding: '13px 14px', borderBottom: `1px solid ${T.s2}` }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: T.ink1 }}>Performance overview</div>
            <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>Based on recorded scores</div>
          </div>

          {classPerf.length === 0 && topicPerf.length === 0 ? (
            <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 11, color: T.ink2 }}>
              No score data yet. Enter scores to see performance.
            </div>
          ) : (
            <>
              {classPerf.map((c, i) => (
                <div key={i} style={{ padding: '10px 14px', borderBottom: `1px solid ${T.s2}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: T.ink1 }}>{c.name}</div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: perfColor(c.avg!) }}>{c.avg!.toFixed(1)}%</div>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: T.s2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, background: perfColor(c.avg!), width: `${Math.min(100, c.avg!)}%` }} />
                  </div>
                </div>
              ))}

              {topicPerf.map((t, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderTop: i === 0 ? `1px solid ${T.s2}` : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: T.purpleL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <IcoDoc2 color={T.purple} />
                    </div>
                    <div style={{ fontSize: 12, color: T.ink2, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: perfColor(t.avg) }}>{t.avg.toFixed(1)}%</div>
                </div>
              ))}
            </>
          )}
        </div>

      </div>

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
      <div className="hidden md:block">

        {/* ── Header row ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-slate-900 leading-tight tracking-tight">Tests &amp; Exams</h1>
            <p className="text-sm text-slate-500 mt-1">Manage tests, enter scores, and analyze performance.</p>
          </div>
          <button
            onClick={() => setView("create")}
            className="h-11 px-5 rounded-lg bg-[#1e3272] text-white text-sm font-semibold hover:bg-[#162552] flex items-center gap-2 shadow-sm"
          >
            <IcoPlus /> Create Test
          </button>
        </div>

        {/* ── 4-col Stat cards ───────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.amberL }}>
                <IcoClock color={T.amber} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.upcoming}</p>
                <p className="text-xs text-slate-500 mt-1.5">Upcoming</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.blueL }}>
                <IcoCheck2 color={T.blue} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.completed}</p>
                <p className="text-xs text-slate-500 mt-1.5">Completed</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.redL }}>
                <IcoDoc color={T.red} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.pendingScores}</p>
                <p className="text-xs text-slate-500 mt-1.5">Pending Scores</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.greenL }}>
                <IcoTrend color={T.green} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">
                  {stats.classAvg !== null ? `${stats.classAvg.toFixed(1)}%` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-1.5">Class Avg</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── 2-col: Upcoming Tests | Performance Overview ──────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Upcoming tests (2 cols) */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">Upcoming Tests</h2>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-48 h-9 pl-9 pr-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
            <div className="p-5 space-y-3">
              {loading ? (
                <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
              ) : filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">No tests yet — create your first one!</div>
              ) : (
                filtered.map(test => {
                  const isPast = test.testDate && new Date(test.testDate).getTime() < Date.now();
                  const daysText = daysLabel(test.testDate);
                  const isUrgent = test.testDate && !isPast && new Date(test.testDate).getTime() - Date.now() < 3 * 86400000;
                  return (
                    <div
                      key={test.id}
                      onClick={() => { setSelectedTest(test); setView('enter-scores'); }}
                      role="button"
                      tabIndex={0}
                      className={`clickable-card border-l-4 rounded-xl p-4 ${isUrgent ? 'bg-amber-50 border-amber-400' : 'bg-slate-50 border-slate-200'}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-slate-900">{test.title || test.subject || 'Untitled Test'}</h3>
                          <p className="text-xs text-slate-500 mt-0.5">{test.className || 'Class'} • {test.studentsCount} students</p>
                        </div>
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${isUrgent ? 'bg-amber-500 text-white' : isPast ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                          {daysText}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
                        {test.testDate && (
                          <span>{new Date(test.testDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        )}
                        {test.duration && <span>{test.duration} minutes</span>}
                        {test.marks && <span>{test.marks} marks</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedTest(test); setView('enter-scores'); }}
                          className="px-4 py-1.5 rounded-lg bg-[#1e3272] text-white text-xs font-semibold hover:bg-[#162552]"
                        >
                          {isPast ? 'View Scores' : 'Enter Scores'}
                        </button>
                        <button className="px-4 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                        <button className="px-4 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">Print</button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Performance Overview */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">Performance Overview</h2>
              <p className="text-xs text-slate-500 mt-0.5">Last 5 tests</p>
            </div>
            <div className="p-5 space-y-4">
              {classPerf.length === 0 && topicPerf.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No score data yet.</p>
              ) : (
                <>
                  {classPerf.map((c, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-slate-700">{c.name}</span>
                        <span className="text-sm font-bold" style={{ color: perfColor(c.avg!) }}>{c.avg!.toFixed(1)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ background: perfColor(c.avg!), width: `${Math.min(100, c.avg!)}%` }} />
                      </div>
                    </div>
                  ))}

                  {topicPerf.length > 0 && (
                    <div className="pt-4 border-t border-slate-100">
                      <h3 className="text-sm font-semibold text-slate-900 mb-3">Topic Performance</h3>
                      <div className="space-y-2">
                        {topicPerf.map((t, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-slate-600 truncate pr-2">{t.name}</span>
                            <span className="font-bold" style={{ color: perfColor(t.avg) }}>{t.avg.toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>

      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
}