import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import CreateTest from "../components/CreateTest";
import EnterScores from "../components/EnterScores";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, Search } from "lucide-react";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

// ── Design tokens (desktop) ──────────────────────────────────────────────────
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

// ── Mobile tokens (EduIntellect v2) ──────────────────────────────────────────
const MA = {
  FONT: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  CARD: "#FFFFFF",
  SURFACE: "#F4F7FE",
  P: "#0055FF", PD: "#0044CC",
  T1: "#001040", T3: "#5070B0", T4: "#99AACC",
  GREEN: "#00C853", GREEN_B: "#00E866",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  GOLD: "#FFAA00",
  VIOLET: "#7B3FF4",
  SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
  SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
  BDR: "0.5px solid rgba(0,85,255,0.07)",
  HERO_GRAD: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
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

type FilterKey = "All" | "Upcoming" | "Completed" | "Pending";

// ── Component ─────────────────────────────────────────────────────────────────
export default function TestsExams() {
  const { teacherData } = useAuth();
  const navigate  = useNavigate();

  const [view, setView]               = useState<"list" | "create" | "enter-scores">("list");
  const [selectedTest, setSelectedTest] = useState<any>(null);
  const [tests, setTests]             = useState<any[]>([]);
  const [scores, setScores]           = useState<any[]>([]);
  const [classes, setClasses]         = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState("");
  const [filter, setFilter]           = useState<FilterKey>("All");

  // Scroll the relevant tests-list panel into view (mobile vs desktop).
  const scrollToTests = () => {
    if (typeof window === "undefined") return;
    const id = window.innerWidth < 768 ? "tests-section-mobile" : "tests-section-desktop";
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const applyFilter = (key: FilterKey) => {
    setFilter(key);
    scrollToTests();
  };

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

  const filterCounts = {
    All:       tests.length,
    Upcoming:  tests.filter(t => t.status !== "Completed" && t.status !== "Pending Scores").length,
    Completed: tests.filter(t => t.status === "Completed").length,
    Pending:   tests.filter(t => t.status === "Pending Scores" || t.status === "Draft").length,
  };

  const filtered = tests.filter(t => {
    const text = ((t.title || "") + " " + (t.className || "")).toLowerCase();
    if (search && !text.includes(search.toLowerCase())) return false;
    if (filter === "Upcoming")  return t.status !== "Completed" && t.status !== "Pending Scores";
    if (filter === "Completed") return t.status === "Completed";
    if (filter === "Pending")   return t.status === "Pending Scores" || t.status === "Draft";
    return true;
  });

  const filterChips: FilterKey[] = ["All", "Upcoming", "Completed", "Pending"];

  return (
    <div style={{ fontFamily: 'inherit' }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ═══════════════════ MOBILE VIEW (EduIntellect v2) ═══════════════════ */}
      <div className="md:hidden" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "0 -16px", paddingBottom: 8 }}>

        {/* Hidden SVG defs for perf ring gradient (shared by all phones) */}
        <svg width="0" height="0" style={{ position: "absolute" }}>
          <defs>
            <linearGradient id="mobilePerfGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00E866"/>
              <stop offset="100%" stopColor="#00C853"/>
            </linearGradient>
          </defs>
        </svg>

        {/* Page header */}
        <div className="px-4 pt-3 pb-[14px]">
          <div className="flex items-center gap-[7px] text-[9px] font-extrabold uppercase mb-[6px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
            <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: MA.P }} />
            Teacher Dashboard · Tests
          </div>
          <h1 className="text-[28px] font-extrabold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.1px" }}>
            Tests &amp; Exams
          </h1>
          <div className="text-[12px] font-medium mt-[6px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
            Manage tests, enter scores, and analyse performance.
          </div>
        </div>

        {/* Hero — gradient with Class Average */}
        <div className="mx-4 mb-[14px] rounded-[26px] p-[22px] relative overflow-hidden"
          style={{ background: MA.HERO_GRAD, boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              </div>
              <div>
                <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Class Average</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Across recorded scores</div>
              </div>
              {(() => {
                const avg = stats.classAvg;
                const band = avg === null ? "no" : avg >= 75 ? "good" : avg >= 60 ? "watch" : "low";
                const bg = band === "good" ? "rgba(0,232,102,0.18)" : band === "watch" ? "rgba(255,170,0,0.22)" : band === "low" ? "rgba(255,51,85,0.18)" : "rgba(255,255,255,0.14)";
                const bd = band === "good" ? "rgba(0,232,102,0.5)" : band === "watch" ? "rgba(255,170,0,0.5)" : band === "low" ? "rgba(255,51,85,0.5)" : "rgba(255,255,255,0.22)";
                const fg = band === "good" ? "#6FFFAA" : band === "watch" ? "#FFD166" : band === "low" ? "#FF99AA" : "rgba(255,255,255,0.72)";
                const dot = band === "good" ? "#00FF88" : band === "watch" ? "#FFCC22" : band === "low" ? "#FF5577" : "#fff";
                const label = band === "good" ? "Strong" : band === "watch" ? "Watch" : band === "low" ? "Low" : "No data";
                return (
                  <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-extrabold"
                    style={{ background: bg, border: `0.5px solid ${bd}`, color: fg, letterSpacing: "0.3px" }}>
                    <span className="w-[6px] h-[6px] rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
                    {label}
                  </div>
                );
              })()}
            </div>
            <div className="text-[56px] font-extrabold text-white leading-none mb-[8px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-2.6px" }}>
              {stats.classAvg !== null ? stats.classAvg.toFixed(1) : "—"}
              {stats.classAvg !== null && <span className="text-[28px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-0.8px" }}>%</span>}
            </div>
            <div className="text-[13px] font-medium mb-[20px]" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
              {stats.classAvg === null ? (
                <><b className="text-white font-bold">No scores yet</b> — create a test and enter scores to unlock analytics.</>
              ) : stats.classAvg >= 75 ? (
                <><b className="text-white font-bold">Solid performance</b> across recent assessments.</>
              ) : stats.classAvg >= 60 ? (
                <><b className="text-white font-bold">Steady progress</b> — room to push the class above 75%.</>
              ) : (
                <><b className="text-white font-bold">Needs attention</b> — review weak topics and plan support.</>
              )}
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              <div className="py-[12px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-extrabold text-white" style={{ letterSpacing: "-0.5px" }}>{stats.upcoming}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Upcoming</div>
              </div>
              <div className="py-[12px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-extrabold" style={{ color: stats.completed > 0 ? "#6FFFAA" : "#fff", letterSpacing: "-0.5px" }}>{stats.completed}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Completed</div>
              </div>
              <div className="py-[12px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-extrabold" style={{ color: stats.pendingScores > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.5px" }}>{stats.pendingScores}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Pending</div>
              </div>
            </div>
          </div>
        </div>

        {/* Create CTA */}
        <div className="px-4 mb-[14px]">
          <button type="button" onClick={() => setView("create")}
            className="w-full h-[48px] rounded-[14px] flex items-center justify-center gap-[6px] active:scale-[0.98] transition-transform"
            style={{
              background: MA.P, color: "#fff",
              fontSize: 13, fontWeight: 800, letterSpacing: "-0.2px",
              boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.3)",
              fontFamily: MA.FONT, border: "none",
            }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create test
          </button>
        </div>

        {/* 2x2 Stats */}
        <div className="grid grid-cols-2 gap-[10px] px-4 mb-[14px]">
          {([
            {
              key: "upcoming", label: "Upcoming", val: `${stats.upcoming}`, color: MA.GOLD,
              sub: stats.upcoming > 0
                ? <span className="font-bold" style={{ color: MA.GOLD }}>● Scheduled</span>
                : <span className="font-semibold" style={{ color: MA.T3 }}>Nothing scheduled</span>,
              onClick: () => applyFilter("Upcoming"),
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
            },
            {
              key: "completed", label: "Completed", val: `${stats.completed}`, color: MA.VIOLET,
              sub: stats.completed > 0
                ? <span className="font-bold" style={{ color: MA.GREEN }}>✓ Done</span>
                : <span className="font-semibold" style={{ color: MA.T3 }}>No history yet</span>,
              onClick: () => applyFilter("Completed"),
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
            },
            {
              key: "pending", label: "Pending Scores", val: `${stats.pendingScores}`, color: stats.pendingScores > 0 ? MA.RED : MA.GREEN,
              sub: stats.pendingScores > 0
                ? <span className="font-bold" style={{ color: MA.RED }}>● Needs entry</span>
                : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All entered</span>,
              onClick: () => applyFilter("Pending"),
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6"/><path d="M9 12h6"/><path d="M9 17h4"/></svg>,
            },
            {
              key: "avg", label: "Class Avg", val: stats.classAvg !== null ? `${stats.classAvg.toFixed(1)}%` : "—",
              color: stats.classAvg === null ? MA.P : stats.classAvg >= 75 ? MA.GREEN : stats.classAvg >= 60 ? MA.GOLD : MA.RED,
              sub: stats.classAvg === null
                ? <span className="font-semibold" style={{ color: MA.T3 }}>Awaiting scores</span>
                : stats.classAvg >= 75
                  ? <span className="font-bold" style={{ color: MA.GREEN }}>↑ Stable</span>
                  : stats.classAvg >= 60
                    ? <span className="font-bold" style={{ color: MA.GOLD }}>● Fair</span>
                    : <span className="font-bold" style={{ color: MA.RED }}>↓ Needs lift</span>,
              onClick: () => navigate("/reports"),
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
            },
          ] as const).map(s => (
            <button key={s.key} type="button" onClick={s.onClick}
              {...tilt3D}
              className="bg-white rounded-[20px] p-4 relative flex flex-col text-left active:scale-[0.96] transition-transform"
              style={{ boxShadow: MA.SH, border: MA.BDR, fontFamily: MA.FONT, ...tilt3DStyle }}>
              <div className="flex items-start gap-[10px] mb-[18px]" style={{ minHeight: 40 }}>
                <div className="flex-1 min-w-0 text-[10px] font-bold uppercase leading-[1.4] pt-[3px]" style={{ color: MA.T3, letterSpacing: "1px" }}>
                  {s.label}
                </div>
                <div className="flex-shrink-0 w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white" style={{ background: s.color }}>
                  {s.icon}
                </div>
              </div>
              <div className="text-[30px] font-extrabold leading-none" style={{ color: s.color, letterSpacing: "-1.3px" }}>{s.val}</div>
              <div className="text-[11px] font-semibold mt-[7px] flex items-center gap-[5px]" style={{ color: MA.T4, letterSpacing: "-0.15px" }}>
                {s.sub}
              </div>
            </button>
          ))}
        </div>

        {/* Upcoming Tests section */}
        <div id="tests-section-mobile" className="mx-4 mb-[14px] p-[18px] rounded-[20px] scroll-mt-4" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[11px]">
              <div className="w-9 h-9 rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.P }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div>
                <div className="text-[15px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                  {filter === "All" ? "Upcoming Tests" : `${filter} Tests`}
                </div>
                <div className="text-[11px] font-semibold mt-[1px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                  {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "test" : "tests"}`}
                </div>
              </div>
            </div>
          </div>

          {/* Filter chips (only shown when there are tests) */}
          {!loading && tests.length > 0 && (
            <div className="mb-[12px] p-[5px] rounded-[14px] flex gap-[7px]"
              style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.06)" }}>
              {filterChips.map(key => {
                const isActive = filter === key;
                return (
                  <button key={key} type="button" onClick={() => setFilter(key)}
                    aria-pressed={isActive}
                    className="flex-1 py-[8px] px-[6px] rounded-[10px] flex items-center justify-center gap-[5px] transition-all active:scale-[0.96]"
                    style={{
                      background: isActive ? MA.P : "transparent",
                      color: isActive ? "#fff" : MA.T3,
                      fontSize: 11, fontWeight: isActive ? 800 : 700, letterSpacing: "-0.2px",
                      boxShadow: isActive ? "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" : "none",
                      fontFamily: MA.FONT, border: "none", cursor: "pointer",
                    }}>
                    {key}
                    <span className="text-[9px] font-extrabold px-[6px] py-[1px] rounded-full min-w-[16px] text-center"
                      style={{ background: isActive ? "rgba(255,255,255,0.22)" : "#fff", color: isActive ? "#fff" : MA.T3 }}>
                      {filterCounts[key]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Search (only shown when there are tests) */}
          {!loading && tests.length > 0 && (
            <div className="flex items-center gap-[8px] py-[9px] px-[13px] rounded-[12px] mb-[12px]"
              style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.06)" }}>
              <Search className="w-[14px] h-[14px] flex-shrink-0" style={{ color: MA.T4 }} strokeWidth={2.4} />
              <input type="text" placeholder="Search tests…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 bg-transparent outline-none text-[12px] font-medium"
                style={{ color: search ? MA.T1 : MA.T4, letterSpacing: "-0.1px", fontFamily: MA.FONT }} />
            </div>
          )}

          {loading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: MA.P }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-[24px] px-[10px] text-center">
              <div className="relative w-[72px] h-[72px] rounded-[22px] flex items-center justify-center mx-auto mb-[14px]"
                style={{
                  background: "linear-gradient(145deg, rgba(9,87,247,0.1) 0%, rgba(123,63,244,0.12) 100%)",
                  color: MA.P,
                  boxShadow: "0 0 0 7px rgba(9,87,247,0.04), inset 0 1px 0 rgba(255,255,255,0.6)",
                }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                <div className="absolute -top-[4px] -right-[4px] w-[26px] h-[26px] rounded-full flex items-center justify-center text-white text-[14px] font-extrabold"
                  style={{ background: MA.P, border: "3px solid #fff", boxShadow: "0 3px 8px rgba(9,87,247,0.35)" }}>
                  +
                </div>
              </div>
              <div className="text-[16px] font-extrabold mb-[5px]" style={{ color: MA.T1, letterSpacing: "-0.4px" }}>
                {search ? "No matches" : filter !== "All" ? `No ${filter.toLowerCase()} tests` : "No tests yet"}
              </div>
              <div className="text-[12px] font-medium leading-[1.5] mb-[14px] px-[14px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                {search ? (
                  <>Try a different search term or clear the query.</>
                ) : filter !== "All" ? (
                  <>Nothing here right now. Try the <b className="font-bold" style={{ color: MA.T1 }}>All</b> filter or create a new test.</>
                ) : (
                  <><b className="font-bold" style={{ color: MA.T1 }}>Create your first test</b> to schedule assessments for your classes.</>
                )}
              </div>
              <button type="button" onClick={() => setView("create")}
                className="inline-flex items-center gap-[6px] px-[22px] py-[12px] rounded-[14px] active:scale-[0.96] transition-transform"
                style={{
                  background: MA.P, color: "#fff",
                  fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                  boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.32)",
                  fontFamily: MA.FONT, border: "none",
                }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create Test
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {filtered.map(test => {
                const isPast = test.testDate && new Date(test.testDate).getTime() < Date.now();
                const statusTone =
                  test.status === "Completed"      ? { bg: "rgba(0,200,83,0.1)",  color: MA.GREEN,  text: "Completed" } :
                  test.status === "Pending Scores" ? { bg: "rgba(255,51,85,0.1)", color: MA.RED,    text: "Pending" } :
                                                     { bg: "rgba(9,87,247,0.08)", color: MA.P,      text: daysLabel(test.testDate) || "Scheduled" };
                return (
                  <div key={test.id}
                    onClick={() => { setSelectedTest(test); setView("enter-scores"); }}
                    role="button" tabIndex={0}
                    className="rounded-[16px] p-[13px] active:scale-[0.985] transition-transform cursor-pointer"
                    style={{ background: MA.SURFACE }}>
                    <div className="flex items-start gap-[10px] mb-[10px]">
                      <div className="w-9 h-9 rounded-[11px] flex items-center justify-center text-white flex-shrink-0" style={{ background: MA.VIOLET }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-[8px]">
                          <div className="text-[14px] font-extrabold truncate capitalize" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>
                            {test.title || test.subject || "Untitled Test"}
                          </div>
                          <span className="px-[9px] py-[3px] rounded-full text-[10px] font-extrabold flex-shrink-0 whitespace-nowrap"
                            style={{ background: statusTone.bg, color: statusTone.color, letterSpacing: "0.3px" }}>
                            {statusTone.text}
                          </span>
                        </div>
                        <div className="text-[11px] font-semibold mt-[3px] truncate" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                          {test.className || "Class"} · {test.studentsCount} student{test.studentsCount === 1 ? "" : "s"}
                          {test.testDate && ` · ${new Date(test.testDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                          {test.marks ? ` · ${test.marks} marks` : ""}
                        </div>
                      </div>
                    </div>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setSelectedTest(test); setView("enter-scores"); }}
                      className="w-full h-[36px] rounded-[11px] flex items-center justify-center gap-[5px] active:scale-[0.97] transition-transform"
                      style={{
                        background: MA.P, color: "#fff",
                        fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                        boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 3px 10px rgba(9,87,247,0.25)",
                        fontFamily: MA.FONT, border: "none",
                      }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/></svg>
                      {isPast ? "View scores" : "Enter scores"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Performance Overview */}
        <div className="mx-4 mb-[14px] p-[18px] rounded-[20px]" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[11px]">
              <div className="w-9 h-9 rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.GOLD }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              </div>
              <div>
                <div className="text-[15px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Performance Overview</div>
                <div className="text-[11px] font-semibold mt-[1px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                  {scores.length > 0 ? `Based on ${scores.length} score${scores.length === 1 ? "" : "s"}` : "No scores recorded yet"}
                </div>
              </div>
            </div>
            <button type="button" onClick={() => navigate('/reports')}
              className="text-[12px] font-bold flex items-center gap-[2px] active:opacity-70" style={{ color: MA.P }}>
              View all <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
            </button>
          </div>

          {stats.classAvg === null && classPerf.length === 0 && topicPerf.length === 0 ? (
            <div className="py-[18px] px-[10px] text-center text-[12px] font-medium" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
              No score data yet. Enter scores to see performance.
            </div>
          ) : (
            <>
              {/* Big performance ring */}
              {stats.classAvg !== null && (() => {
                const pct = Math.max(0, Math.min(100, stats.classAvg));
                const circumference = 2 * Math.PI * 40;
                const offset = circumference * (1 - pct / 100);
                const band = pct >= 75 ? { label: "Strong progress", tone: MA.GREEN } : pct >= 60 ? { label: "Fair progress", tone: MA.GOLD } : { label: "Needs attention", tone: MA.RED };
                return (
                  <div className="flex items-center gap-[18px] pt-[6px] pb-[18px] px-[4px]">
                    <div className="relative flex-shrink-0" style={{ width: 96, height: 96 }}>
                      <svg width="96" height="96" viewBox="0 0 96 96">
                        <circle cx="48" cy="48" r="40" fill="none" stroke={MA.SURFACE} strokeWidth="10"/>
                        <circle cx="48" cy="48" r="40" fill="none" stroke="url(#mobilePerfGradient)" strokeWidth="10" strokeLinecap="round"
                          strokeDasharray={circumference} strokeDashoffset={offset}
                          transform="rotate(-90 48 48)"
                          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.2,.9,.3,1)" }} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="text-[22px] font-extrabold leading-none" style={{ color: MA.T1, letterSpacing: "-0.8px" }}>{pct.toFixed(1)}%</div>
                        <div className="text-[8px] font-extrabold uppercase mt-[3px]" style={{ color: MA.T3, letterSpacing: "1.3px" }}>Avg</div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-extrabold uppercase mb-[6px]" style={{ color: MA.T3, letterSpacing: "1.3px" }}>Class Average</div>
                      <div className="text-[15px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.4px" }}>{band.label}</div>
                      <div className="mt-[6px]">
                        <span className="inline-flex items-center gap-[5px] px-[10px] py-[4px] rounded-full text-[10px] font-extrabold"
                          style={{ background: `${band.tone}1a`, color: band.tone, letterSpacing: "0.3px" }}>
                          <span className="w-[5px] h-[5px] rounded-full" style={{ background: band.tone }} />
                          {pct >= 75 ? "On track" : pct >= 60 ? "Monitor" : "At risk"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Topic performance list */}
              {(classPerf.length > 0 || topicPerf.length > 0) && (
                <>
                  <div className="text-[12px] font-extrabold pt-[12px] pb-[10px] px-[2px]" style={{ color: MA.T1, letterSpacing: "-0.25px", borderTop: "0.5px solid rgba(9,87,247,0.08)" }}>
                    {classPerf.length > 0 ? "Class Performance" : "Topic Performance"}
                  </div>
                  {classPerf.map((c, i) => {
                    const pct = Math.max(0, Math.min(100, c.avg!));
                    const tone = pct >= 75 ? MA.GREEN : pct >= 60 ? MA.GOLD : MA.RED;
                    return (
                      <div key={`cls-${i}`} className="grid items-center gap-[10px] py-[9px]" style={{ gridTemplateColumns: "1fr 70px 48px" }}>
                        <div className="text-[13px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{c.name}</div>
                        <div className="h-[7px] rounded-full overflow-hidden" style={{ background: MA.SURFACE }}>
                          <div className="h-full rounded-full" style={{ background: tone, width: `${pct}%`, transition: "width 1.2s cubic-bezier(.2,.9,.3,1)" }} />
                        </div>
                        <div className="text-[13px] font-extrabold text-right" style={{ color: tone, letterSpacing: "-0.3px" }}>{c.avg!.toFixed(0)}%</div>
                      </div>
                    );
                  })}
                  {topicPerf.map((t, i) => {
                    const pct = Math.max(0, Math.min(100, t.avg));
                    const tone = pct >= 75 ? MA.GREEN : pct >= 60 ? MA.GOLD : MA.RED;
                    return (
                      <div key={`top-${i}`} className="grid items-center gap-[10px] py-[9px]" style={{ gridTemplateColumns: "1fr 70px 48px" }}>
                        <div className="text-[13px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{t.name}</div>
                        <div className="h-[7px] rounded-full overflow-hidden" style={{ background: MA.SURFACE }}>
                          <div className="h-full rounded-full" style={{ background: tone, width: `${pct}%`, transition: "width 1.2s cubic-bezier(.2,.9,.3,1)" }} />
                        </div>
                        <div className="text-[13px] font-extrabold text-right" style={{ color: tone, letterSpacing: "-0.3px" }}>{t.avg.toFixed(0)}%</div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>

        {/* AI Intelligence */}
        <div className="mx-4 mb-[14px] rounded-[24px] p-[20px] relative overflow-hidden"
          style={{
            background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
            boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
          }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
          <div className="relative z-[2]">
            <div className="flex items-center gap-[11px] mb-[12px]">
              <div className="w-10 h-10 rounded-[13px] flex items-center justify-center text-[19px]"
                style={{
                  background: "rgba(255,255,255,0.14)",
                  backdropFilter: "blur(22px)",
                  WebkitBackdropFilter: "blur(22px)",
                  border: "0.5px solid rgba(255,255,255,0.22)",
                  color: "#FFDD55",
                }}>⚡</div>
              <div className="text-[10px] font-black uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.8px" }}>
                AI Tests Intelligence
              </div>
              <div className="ml-auto px-[10px] py-[4px] rounded-full text-[9px] font-extrabold"
                style={{ background: "rgba(123,63,244,0.3)", border: "0.5px solid rgba(155,95,255,0.5)", color: "#DCC8FF", letterSpacing: "0.5px" }}>
                Tip
              </div>
            </div>
            {(() => {
              const avgLabel = stats.classAvg !== null ? `${stats.classAvg.toFixed(1)}%` : "—";
              const weakest = topicPerf.length > 0 ? topicPerf[topicPerf.length - 1] : null;
              const topTopicLabel = topicPerf[0]?.name || "General";
              const topTopicVal = topicPerf[0] ? `${topicPerf[0].avg.toFixed(0)}%` : "—";
              return (
                <>
                  <div className="text-[13px] leading-[1.6] mb-[14px]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                    {stats.pendingScores > 0 ? (
                      <><strong className="text-white font-bold">{stats.pendingScores} test{stats.pendingScores === 1 ? "" : "s"}</strong> waiting for scores. Entering them unlocks performance insights for these classes.</>
                    ) : tests.length === 0 ? (
                      <>No tests scheduled yet. <strong className="text-white font-bold">Create your first test</strong> to begin tracking performance across classes.</>
                    ) : weakest && weakest.avg < 70 ? (
                      <>Class average is <strong className="text-white font-bold">{avgLabel}</strong> — <strong className="text-white font-bold">{weakest.name}</strong> sits at {weakest.avg.toFixed(0)}%. Schedule a <strong className="text-white font-bold">formative test</strong> there to close the gap.</>
                    ) : stats.classAvg !== null && stats.classAvg >= 75 ? (
                      <>Strong class average of <strong className="text-white font-bold">{avgLabel}</strong>. Consider a <strong className="text-white font-bold">stretch assessment</strong> to push top performers further.</>
                    ) : (
                      <>Class average is <strong className="text-white font-bold">{avgLabel}</strong>. Schedule a <strong className="text-white font-bold">targeted test</strong> to nudge scores above the <strong className="text-white font-bold">75%</strong> benchmark.</>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-[1px] rounded-[12px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                    <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[17px] font-extrabold text-white" style={{ letterSpacing: "-0.4px" }}>{avgLabel}</div>
                      <div className="text-[8px] font-extrabold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Class Avg</div>
                    </div>
                    <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[17px] font-extrabold" style={{ color: "#FFD060", letterSpacing: "-0.4px" }}>{topTopicVal}</div>
                      <div className="text-[8px] font-extrabold uppercase mt-[3px] truncate" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>{topTopicLabel}</div>
                    </div>
                    <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[17px] font-extrabold text-white" style={{ letterSpacing: "-0.4px" }}>{stats.upcoming}</div>
                      <div className="text-[8px] font-extrabold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Scheduled</div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh" }}>
        <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-12">

          {/* Shared SVG defs for perf ring gradient */}
          <svg width="0" height="0" style={{ position: "absolute" }}>
            <defs>
              <linearGradient id="desktopPerfGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00E866"/>
                <stop offset="100%" stopColor="#00C853"/>
              </linearGradient>
            </defs>
          </svg>

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-[7px] text-[10px] font-extrabold uppercase mb-[8px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
              <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: MA.P }} />
              Teacher Dashboard · Tests
            </div>
            <h1 className="text-[40px] font-extrabold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.4px" }}>Tests &amp; Exams</h1>
            <div className="text-[14px] font-medium mt-[8px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
              Manage tests, enter scores, and analyse performance.
            </div>
          </div>

          {/* Hero banner — Class Average */}
          <div className="rounded-[28px] px-8 py-8 relative overflow-hidden mb-5"
            style={{ background: MA.HERO_GRAD, boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
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
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Class Average</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Across recorded scores</div>
                </div>
                {(() => {
                  const avg = stats.classAvg;
                  const band = avg === null ? "no" : avg >= 75 ? "good" : avg >= 60 ? "watch" : "low";
                  const bg = band === "good" ? "rgba(0,232,102,0.18)" : band === "watch" ? "rgba(255,170,0,0.22)" : band === "low" ? "rgba(255,51,85,0.18)" : "rgba(255,255,255,0.14)";
                  const bd = band === "good" ? "rgba(0,232,102,0.5)" : band === "watch" ? "rgba(255,170,0,0.5)" : band === "low" ? "rgba(255,51,85,0.5)" : "rgba(255,255,255,0.22)";
                  const fg = band === "good" ? "#6FFFAA" : band === "watch" ? "#FFD166" : band === "low" ? "#FF99AA" : "rgba(255,255,255,0.72)";
                  const dot = band === "good" ? "#00FF88" : band === "watch" ? "#FFCC22" : band === "low" ? "#FF5577" : "#fff";
                  const label = band === "good" ? "Strong" : band === "watch" ? "Watch" : band === "low" ? "Low" : "No data";
                  return (
                    <div className="ml-auto flex items-center gap-[6px] px-4 py-[7px] rounded-full text-[11px] font-extrabold"
                      style={{ background: bg, border: `0.5px solid ${bd}`, color: fg, letterSpacing: "0.3px" }}>
                      <span className="w-[6px] h-[6px] rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
                      {label}
                    </div>
                  );
                })()}
              </div>
              <div className="flex items-end justify-between gap-8 flex-wrap">
                <div>
                  <div className="text-[84px] font-extrabold text-white leading-none mb-[6px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-3.8px" }}>
                    {stats.classAvg !== null ? stats.classAvg.toFixed(1) : "—"}
                    {stats.classAvg !== null && <span className="text-[40px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-1px" }}>%</span>}
                  </div>
                  <div className="text-[14px] font-medium" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
                    {stats.classAvg === null ? (
                      <><b className="text-white font-bold">No scores yet</b> — create a test and enter scores to unlock analytics.</>
                    ) : stats.classAvg >= 75 ? (
                      <><b className="text-white font-bold">Solid performance</b> across recent assessments.</>
                    ) : stats.classAvg >= 60 ? (
                      <><b className="text-white font-bold">Steady progress</b> — room to push the class above 75%.</>
                    ) : (
                      <><b className="text-white font-bold">Needs attention</b> — review weak topics and plan support.</>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[380px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-extrabold text-white" style={{ letterSpacing: "-0.8px" }}>{stats.upcoming}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Upcoming</div>
                  </div>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-extrabold" style={{ color: stats.completed > 0 ? "#6FFFAA" : "#fff", letterSpacing: "-0.8px" }}>{stats.completed}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Completed</div>
                  </div>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-extrabold" style={{ color: stats.pendingScores > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.8px" }}>{stats.pendingScores}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Pending</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Create CTA + 4 stat cards */}
          <div className="grid grid-cols-5 gap-4 mb-5">
            <button type="button" onClick={() => setView("create")}
              className="rounded-[22px] flex flex-col items-center justify-center gap-2 p-5 hover:scale-[1.02] active:scale-[0.98] transition-transform"
              style={{
                background: MA.P, color: "#fff",
                fontSize: 14, fontWeight: 800, letterSpacing: "-0.2px",
                boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.3)",
                fontFamily: MA.FONT, border: "none",
              }}>
              <div className="w-11 h-11 rounded-[12px] flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </div>
              <div>Create test</div>
            </button>
            {([
              {
                key: "upcoming", label: "Upcoming", val: `${stats.upcoming}`, color: MA.GOLD,
                sub: stats.upcoming > 0
                  ? <span className="font-bold" style={{ color: MA.GOLD }}>● Scheduled</span>
                  : <span className="font-semibold" style={{ color: MA.T3 }}>Nothing scheduled</span>,
                onClick: () => applyFilter("Upcoming"),
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
              },
              {
                key: "completed", label: "Completed", val: `${stats.completed}`, color: MA.VIOLET,
                sub: stats.completed > 0
                  ? <span className="font-bold" style={{ color: MA.GREEN }}>✓ Done</span>
                  : <span className="font-semibold" style={{ color: MA.T3 }}>No history yet</span>,
                onClick: () => applyFilter("Completed"),
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
              },
              {
                key: "pending", label: "Pending Scores", val: `${stats.pendingScores}`, color: stats.pendingScores > 0 ? MA.RED : MA.GREEN,
                sub: stats.pendingScores > 0
                  ? <span className="font-bold" style={{ color: MA.RED }}>● Needs entry</span>
                  : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All entered</span>,
                onClick: () => applyFilter("Pending"),
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6"/><path d="M9 12h6"/><path d="M9 17h4"/></svg>,
              },
              {
                key: "avg", label: "Class Avg", val: stats.classAvg !== null ? `${stats.classAvg.toFixed(1)}%` : "—",
                color: stats.classAvg === null ? MA.P : stats.classAvg >= 75 ? MA.GREEN : stats.classAvg >= 60 ? MA.GOLD : MA.RED,
                sub: stats.classAvg === null
                  ? <span className="font-semibold" style={{ color: MA.T3 }}>Awaiting scores</span>
                  : stats.classAvg >= 75
                    ? <span className="font-bold" style={{ color: MA.GREEN }}>↑ Stable</span>
                    : stats.classAvg >= 60
                      ? <span className="font-bold" style={{ color: MA.GOLD }}>● Fair</span>
                      : <span className="font-bold" style={{ color: MA.RED }}>↓ Needs lift</span>,
                onClick: () => navigate("/reports"),
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
              },
            ] as const).map(s => (
              <button key={s.key} type="button" onClick={s.onClick}
                {...tilt3D}
                className="bg-white rounded-[22px] p-5 relative flex flex-col text-left hover:scale-[1.02] active:scale-[0.98] transition-all"
                style={{ boxShadow: MA.SH, border: MA.BDR, fontFamily: MA.FONT, ...tilt3DStyle }}>
                <div className="flex items-start gap-[10px] mb-5" style={{ minHeight: 44 }}>
                  <div className="flex-1 min-w-0 text-[11px] font-bold uppercase leading-[1.4] pt-[4px]" style={{ color: MA.T3, letterSpacing: "1px" }}>
                    {s.label}
                  </div>
                  <div className="flex-shrink-0 w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white" style={{ background: s.color }}>
                    {s.icon}
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none" style={{ color: s.color, letterSpacing: "-1.6px" }}>{s.val}</div>
                <div className="text-[12px] font-semibold mt-2 flex items-center gap-[5px]" style={{ color: MA.T4, letterSpacing: "-0.15px" }}>
                  {s.sub}
                </div>
              </button>
            ))}
          </div>

          {/* 2-column: Upcoming Tests + Performance Overview */}
          <div className="grid grid-cols-2 gap-4 mb-5">

            {/* Upcoming Tests */}
            <div id="tests-section-desktop" className="p-6 rounded-[22px] scroll-mt-4" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white" style={{ background: MA.P }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  </div>
                  <div>
                    <div className="text-[16px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.35px" }}>
                      {filter === "All" ? "Upcoming Tests" : `${filter} Tests`}
                    </div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                      {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "test" : "tests"}`}
                    </div>
                  </div>
                </div>
              </div>

              {!loading && tests.length > 0 && (
                <div className="mb-[14px] p-[5px] rounded-[14px] flex gap-[7px]"
                  style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.06)" }}>
                  {filterChips.map(key => {
                    const isActive = filter === key;
                    return (
                      <button key={key} type="button" onClick={() => setFilter(key)}
                        aria-pressed={isActive}
                        className="flex-1 py-[9px] px-[8px] rounded-[10px] flex items-center justify-center gap-[6px] transition-all hover:brightness-[0.98] active:scale-[0.97]"
                        style={{
                          background: isActive ? MA.P : "transparent",
                          color: isActive ? "#fff" : MA.T3,
                          fontSize: 12, fontWeight: isActive ? 800 : 700, letterSpacing: "-0.2px",
                          boxShadow: isActive ? "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" : "none",
                          fontFamily: MA.FONT, border: "none", cursor: "pointer",
                        }}>
                        {key}
                        <span className="text-[10px] font-extrabold px-[7px] py-[1px] rounded-full min-w-[18px] text-center"
                          style={{ background: isActive ? "rgba(255,255,255,0.22)" : "#fff", color: isActive ? "#fff" : MA.T3 }}>
                          {filterCounts[key]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {!loading && tests.length > 0 && (
                <div className="flex items-center gap-2 py-[10px] px-[14px] rounded-[12px] mb-[14px]"
                  style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.06)" }}>
                  <Search className="w-[15px] h-[15px] flex-shrink-0" style={{ color: MA.T4 }} strokeWidth={2.4} />
                  <input type="text" placeholder="Search tests…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-[13px] font-medium"
                    style={{ color: search ? MA.T1 : MA.T4, letterSpacing: "-0.1px", fontFamily: MA.FONT }} />
                </div>
              )}

              {loading ? (
                <div className="py-14 flex justify-center">
                  <Loader2 className="w-9 h-9 animate-spin" style={{ color: MA.P }} />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-10 px-4 text-center">
                  <div className="relative w-[88px] h-[88px] rounded-[26px] flex items-center justify-center mx-auto mb-[18px]"
                    style={{
                      background: "linear-gradient(145deg, rgba(9,87,247,0.1) 0%, rgba(123,63,244,0.12) 100%)",
                      color: MA.P,
                      boxShadow: "0 0 0 9px rgba(9,87,247,0.04), inset 0 1px 0 rgba(255,255,255,0.6)",
                    }}>
                    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                    <div className="absolute -top-[5px] -right-[5px] w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-[15px] font-extrabold"
                      style={{ background: MA.P, border: "3px solid #fff", boxShadow: "0 3px 8px rgba(9,87,247,0.35)" }}>
                      +
                    </div>
                  </div>
                  <div className="text-[18px] font-extrabold mb-[6px]" style={{ color: MA.T1, letterSpacing: "-0.4px" }}>
                    {search ? "No matches" : filter !== "All" ? `No ${filter.toLowerCase()} tests` : "No tests yet"}
                  </div>
                  <div className="text-[13px] font-medium leading-[1.5] mb-[18px] max-w-[360px] mx-auto" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                    {search ? (
                      <>Try a different search term or clear the query.</>
                    ) : filter !== "All" ? (
                      <>Nothing here right now. Try the <b className="font-bold" style={{ color: MA.T1 }}>All</b> filter or create a new test.</>
                    ) : (
                      <><b className="font-bold" style={{ color: MA.T1 }}>Create your first test</b> to schedule assessments for your classes.</>
                    )}
                  </div>
                  <button type="button" onClick={() => setView("create")}
                    className="inline-flex items-center gap-[7px] px-6 py-[13px] rounded-[14px] hover:scale-[1.02] active:scale-[0.96] transition-transform"
                    style={{
                      background: MA.P, color: "#fff",
                      fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                      boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.32)",
                      fontFamily: MA.FONT, border: "none",
                    }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Create Test
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-[10px] max-h-[640px] overflow-y-auto pr-1">
                  {filtered.map(test => {
                    const isPast = test.testDate && new Date(test.testDate).getTime() < Date.now();
                    const statusTone =
                      test.status === "Completed"      ? { bg: "rgba(0,200,83,0.1)",  color: MA.GREEN,  text: "Completed" } :
                      test.status === "Pending Scores" ? { bg: "rgba(255,51,85,0.1)", color: MA.RED,    text: "Pending" } :
                                                         { bg: "rgba(9,87,247,0.08)", color: MA.P,      text: daysLabel(test.testDate) || "Scheduled" };
                    return (
                      <div key={test.id}
                        onClick={() => { setSelectedTest(test); setView("enter-scores"); }}
                        role="button" tabIndex={0}
                        className="rounded-[16px] p-[14px] hover:brightness-[0.98] active:scale-[0.99] transition cursor-pointer"
                        style={{ background: MA.SURFACE }}>
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 rounded-[12px] flex items-center justify-center text-white flex-shrink-0" style={{ background: MA.VIOLET }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-[8px]">
                              <div className="text-[15px] font-extrabold truncate capitalize" style={{ color: MA.T1, letterSpacing: "-0.25px" }}>
                                {test.title || test.subject || "Untitled Test"}
                              </div>
                              <span className="px-[10px] py-[4px] rounded-full text-[10px] font-extrabold flex-shrink-0 whitespace-nowrap"
                                style={{ background: statusTone.bg, color: statusTone.color, letterSpacing: "0.3px" }}>
                                {statusTone.text}
                              </span>
                            </div>
                            <div className="text-[12px] font-semibold mt-[3px] truncate" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                              {test.className || "Class"} · {test.studentsCount} student{test.studentsCount === 1 ? "" : "s"}
                              {test.testDate && ` · ${new Date(test.testDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                              {test.marks ? ` · ${test.marks} marks` : ""}
                            </div>
                          </div>
                        </div>
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedTest(test); setView("enter-scores"); }}
                          className="w-full h-10 rounded-[11px] flex items-center justify-center gap-[6px] hover:scale-[1.01] active:scale-[0.97] transition-transform"
                          style={{
                            background: MA.P, color: "#fff",
                            fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                            boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 3px 10px rgba(9,87,247,0.25)",
                            fontFamily: MA.FONT, border: "none",
                          }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/></svg>
                          {isPast ? "View scores" : "Enter scores"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Performance Overview */}
            <div className="p-6 rounded-[22px]" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white" style={{ background: MA.GOLD }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                  </div>
                  <div>
                    <div className="text-[16px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.35px" }}>Performance Overview</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                      {scores.length > 0 ? `Based on ${scores.length} score${scores.length === 1 ? "" : "s"}` : "No scores recorded yet"}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/reports')}
                  className="text-[13px] font-bold flex items-center gap-[2px] active:opacity-70 hover:bg-[#EEF4FF] py-1 px-2 rounded-[8px] transition-colors" style={{ color: MA.P }}>
                  View all <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
                </button>
              </div>

              {stats.classAvg === null && classPerf.length === 0 && topicPerf.length === 0 ? (
                <div className="py-14 px-4 text-center text-[13px] font-medium" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                  No score data yet. Enter scores to see performance.
                </div>
              ) : (
                <>
                  {/* Performance ring */}
                  {stats.classAvg !== null && (() => {
                    const pct = Math.max(0, Math.min(100, stats.classAvg));
                    const circumference = 2 * Math.PI * 52;
                    const offset = circumference * (1 - pct / 100);
                    const band = pct >= 75 ? { label: "Strong progress", tone: MA.GREEN } : pct >= 60 ? { label: "Fair progress", tone: MA.GOLD } : { label: "Needs attention", tone: MA.RED };
                    return (
                      <div className="flex items-center gap-6 pt-[6px] pb-5 px-[4px]">
                        <div className="relative flex-shrink-0" style={{ width: 124, height: 124 }}>
                          <svg width="124" height="124" viewBox="0 0 124 124">
                            <circle cx="62" cy="62" r="52" fill="none" stroke={MA.SURFACE} strokeWidth="12"/>
                            <circle cx="62" cy="62" r="52" fill="none" stroke="url(#desktopPerfGradient)" strokeWidth="12" strokeLinecap="round"
                              strokeDasharray={circumference} strokeDashoffset={offset}
                              transform="rotate(-90 62 62)"
                              style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.2,.9,.3,1)" }} />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <div className="text-[26px] font-extrabold leading-none" style={{ color: MA.T1, letterSpacing: "-0.9px" }}>{pct.toFixed(1)}%</div>
                            <div className="text-[9px] font-extrabold uppercase mt-[3px]" style={{ color: MA.T3, letterSpacing: "1.3px" }}>Avg</div>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-extrabold uppercase mb-2" style={{ color: MA.T3, letterSpacing: "1.3px" }}>Class Average</div>
                          <div className="text-[18px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.4px" }}>{band.label}</div>
                          <div className="mt-2">
                            <span className="inline-flex items-center gap-[5px] px-[11px] py-[5px] rounded-full text-[11px] font-extrabold"
                              style={{ background: `${band.tone}1a`, color: band.tone, letterSpacing: "0.3px" }}>
                              <span className="w-[6px] h-[6px] rounded-full" style={{ background: band.tone }} />
                              {pct >= 75 ? "On track" : pct >= 60 ? "Monitor" : "At risk"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Topic/Class performance list */}
                  {(classPerf.length > 0 || topicPerf.length > 0) && (
                    <>
                      <div className="text-[13px] font-extrabold pt-[14px] pb-[12px] px-[2px]" style={{ color: MA.T1, letterSpacing: "-0.25px", borderTop: "0.5px solid rgba(9,87,247,0.08)" }}>
                        {classPerf.length > 0 ? "Class Performance" : "Topic Performance"}
                      </div>
                      {classPerf.map((c, i) => {
                        const pct = Math.max(0, Math.min(100, c.avg!));
                        const tone = pct >= 75 ? MA.GREEN : pct >= 60 ? MA.GOLD : MA.RED;
                        return (
                          <div key={`cls-${i}`} className="grid items-center gap-3 py-[10px]" style={{ gridTemplateColumns: "1fr 100px 56px" }}>
                            <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{c.name}</div>
                            <div className="h-[8px] rounded-full overflow-hidden" style={{ background: MA.SURFACE }}>
                              <div className="h-full rounded-full" style={{ background: tone, width: `${pct}%`, transition: "width 1.2s cubic-bezier(.2,.9,.3,1)" }} />
                            </div>
                            <div className="text-[14px] font-extrabold text-right" style={{ color: tone, letterSpacing: "-0.3px" }}>{c.avg!.toFixed(0)}%</div>
                          </div>
                        );
                      })}
                      {topicPerf.map((t, i) => {
                        const pct = Math.max(0, Math.min(100, t.avg));
                        const tone = pct >= 75 ? MA.GREEN : pct >= 60 ? MA.GOLD : MA.RED;
                        return (
                          <div key={`top-${i}`} className="grid items-center gap-3 py-[10px]" style={{ gridTemplateColumns: "1fr 100px 56px" }}>
                            <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{t.name}</div>
                            <div className="h-[8px] rounded-full overflow-hidden" style={{ background: MA.SURFACE }}>
                              <div className="h-full rounded-full" style={{ background: tone, width: `${pct}%`, transition: "width 1.2s cubic-bezier(.2,.9,.3,1)" }} />
                            </div>
                            <div className="text-[14px] font-extrabold text-right" style={{ color: tone, letterSpacing: "-0.3px" }}>{t.avg.toFixed(0)}%</div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </div>

          </div>

          {/* AI Intelligence */}
          <div className="rounded-[26px] p-7 relative overflow-hidden"
            style={{
              background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
              boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
            }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
            <div className="relative z-[2]">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-[48px] h-[48px] rounded-[14px] flex items-center justify-center text-[22px]"
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    backdropFilter: "blur(22px)",
                    WebkitBackdropFilter: "blur(22px)",
                    border: "0.5px solid rgba(255,255,255,0.22)",
                    color: "#FFDD55",
                  }}>⚡</div>
                <div className="text-[11px] font-black uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>
                  AI Tests Intelligence
                </div>
                <div className="ml-auto px-[11px] py-[5px] rounded-full text-[10px] font-extrabold"
                  style={{ background: "rgba(123,63,244,0.3)", border: "0.5px solid rgba(155,95,255,0.5)", color: "#DCC8FF", letterSpacing: "0.5px" }}>
                  Tip
                </div>
              </div>
              {(() => {
                const avgLabel = stats.classAvg !== null ? `${stats.classAvg.toFixed(1)}%` : "—";
                const weakest = topicPerf.length > 0 ? topicPerf[topicPerf.length - 1] : null;
                const topTopicLabel = topicPerf[0]?.name || "General";
                const topTopicVal = topicPerf[0] ? `${topicPerf[0].avg.toFixed(0)}%` : "—";
                return (
                  <>
                    <div className="text-[14px] leading-[1.6] mb-5" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                      {stats.pendingScores > 0 ? (
                        <><strong className="text-white font-bold">{stats.pendingScores} test{stats.pendingScores === 1 ? "" : "s"}</strong> waiting for scores. Entering them unlocks performance insights for these classes.</>
                      ) : tests.length === 0 ? (
                        <>No tests scheduled yet. <strong className="text-white font-bold">Create your first test</strong> to begin tracking performance across classes.</>
                      ) : weakest && weakest.avg < 70 ? (
                        <>Class average is <strong className="text-white font-bold">{avgLabel}</strong> — <strong className="text-white font-bold">{weakest.name}</strong> sits at {weakest.avg.toFixed(0)}%. Schedule a <strong className="text-white font-bold">formative test</strong> there to close the gap.</>
                      ) : stats.classAvg !== null && stats.classAvg >= 75 ? (
                        <>Strong class average of <strong className="text-white font-bold">{avgLabel}</strong>. Consider a <strong className="text-white font-bold">stretch assessment</strong> to push top performers further.</>
                      ) : (
                        <>Class average is <strong className="text-white font-bold">{avgLabel}</strong>. Schedule a <strong className="text-white font-bold">targeted test</strong> to nudge scores above the <strong className="text-white font-bold">75%</strong> benchmark.</>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                      <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                        <div className="text-[22px] font-extrabold text-white" style={{ letterSpacing: "-0.6px" }}>{avgLabel}</div>
                        <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Class Avg</div>
                      </div>
                      <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                        <div className="text-[22px] font-extrabold" style={{ color: "#FFD060", letterSpacing: "-0.6px" }}>{topTopicVal}</div>
                        <div className="text-[10px] font-extrabold uppercase mt-[4px] truncate" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>{topTopicLabel}</div>
                      </div>
                      <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                        <div className="text-[22px] font-extrabold text-white" style={{ letterSpacing: "-0.6px" }}>{stats.upcoming}</div>
                        <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Scheduled</div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
}
