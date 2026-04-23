import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import CreateTest from "../components/CreateTest";
import EnterScores from "../components/EnterScores";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, Search } from "lucide-react";

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
  P: "#0957F7", PD: "#0044DD",
  T1: "#001040", T3: "#5070B0", T4: "#99AACC",
  GREEN: "#00C853", GREEN_B: "#00E866",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  GOLD: "#FFAA00",
  VIOLET: "#7B3FF4",
  SH: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 14px rgba(9,87,247,0.08)",
  SH_SM: "0 0.5px 1px rgba(9,87,247,0.04), 0 2px 10px rgba(9,87,247,0.06)",
  HERO_GRAD: "linear-gradient(135deg, #000820 0%, #001466 32%, #0033CC 68%, #0957F7 100%)",
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
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
            },
            {
              key: "completed", label: "Completed", val: `${stats.completed}`, color: MA.VIOLET,
              sub: stats.completed > 0
                ? <span className="font-bold" style={{ color: MA.GREEN }}>✓ Done</span>
                : <span className="font-semibold" style={{ color: MA.T3 }}>No history yet</span>,
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
            },
            {
              key: "pending", label: "Pending Scores", val: `${stats.pendingScores}`, color: stats.pendingScores > 0 ? MA.RED : MA.GREEN,
              sub: stats.pendingScores > 0
                ? <span className="font-bold" style={{ color: MA.RED }}>● Needs entry</span>
                : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All entered</span>,
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
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
            },
          ] as const).map(s => (
            <div key={s.key}
              className="bg-white rounded-[20px] p-4 relative flex flex-col text-left"
              style={{ boxShadow: MA.SH, fontFamily: MA.FONT }}>
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
            </div>
          ))}
        </div>

        {/* Upcoming Tests section */}
        <div className="mx-4 mb-[14px] p-[18px] rounded-[20px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[11px]">
              <div className="w-9 h-9 rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.P }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div>
                <div className="text-[15px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Upcoming Tests</div>
                <div className="text-[11px] font-semibold mt-[1px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                  {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "test" : "tests"}`}
                </div>
              </div>
            </div>
          </div>

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
                {search ? "No matches" : "No tests yet"}
              </div>
              <div className="text-[12px] font-medium leading-[1.5] mb-[14px] px-[14px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                {search ? (
                  <>Try a different search term or clear the query.</>
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
        <div className="mx-4 mb-[14px] p-[18px] rounded-[20px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
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
            background: "linear-gradient(140deg, #000820 0%, #001888 28%, #0033CC 64%, #0957F7 100%)",
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

      {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
      <div className="hidden md:block">

        {/* ── Header row ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-slate-900 leading-tight tracking-tight">Tests &amp; Exams</h1>
            <p className="text-sm text-slate-500 mt-1">Manage tests, enter scores, and analyze performance.</p>
          </div>
          <button type="button"
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
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedTest(test); setView('enter-scores'); }}
                          className="px-4 py-1.5 rounded-lg bg-[#1e3272] text-white text-xs font-semibold hover:bg-[#162552]"
                        >
                          {isPast ? 'View Scores' : 'Enter Scores'}
                        </button>
                        <button type="button" className="px-4 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                        <button type="button" className="px-4 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">Print</button>
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