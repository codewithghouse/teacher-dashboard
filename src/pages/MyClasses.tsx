import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, getDocs,
  type QueryConstraint, type DocumentData,
} from "firebase/firestore";

type ClassDoc = DocumentData & { id: string };
type EnrollmentDoc = DocumentData & { id: string; classId?: string };
type AttendanceDoc = DocumentData & { id: string; classId?: string; status?: string };
type ScoreDoc = DocumentData & { id: string; classId?: string; score?: number; percentage?: number };
import {
  Loader2, Search, BarChart2, TrendingUp, Calendar,
  Users, CheckCircle, AlertCircle, LayoutGrid, Home, GraduationCap, Sparkles
} from "lucide-react";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

type FilterType = "All" | "Active" | "Attention";

const getSemesterLabel = () => {
  const month = new Date().getMonth();
  const year  = new Date().getFullYear();
  return `${month < 6 ? "Spring" : "Fall"} Semester · ${year}`;
};

// Blue Apple tokens (shared mobile + desktop)
const B1 = "#0055FF", B2 = "#1166FF", B3 = "#2277FF", B4 = "#4499FF";
const BG_D = "#EEF4FF", BG2_D = "#E0ECFF";
const TT1 = "#001040", TT2 = "#002080", TT3 = "#5070B0", TT4 = "#99AACC";
const GREEN = "#00C853", GREEN_D_COL = "#007830";
const RED = "#FF3355";
const ORANGE = "#FF8800";
const VIOLET = "#6B21E8";
const BLUE_BDR = "rgba(0,85,255,0.12)";
const SEP_D = "rgba(0,85,255,0.07)";
const SH_D = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
const SH_LG_D = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.14)";
const SH_BTN_D = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)";
const FONT_D = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";

const CARD_GRADS = [
  { bg: `linear-gradient(135deg, ${B1}, ${B3})`, sh: "0 3px 10px rgba(0,85,255,0.28)", glow: "rgba(0,85,255,0.08)" },
  { bg: `linear-gradient(135deg, ${VIOLET}, #A87FF8)`, sh: "0 3px 10px rgba(107,33,232,0.28)", glow: "rgba(107,33,232,0.08)" },
  { bg: `linear-gradient(135deg, ${ORANGE}, #FFCC22)`, sh: "0 3px 10px rgba(255,136,0,0.28)", glow: "rgba(255,136,0,0.08)" },
  { bg: `linear-gradient(135deg, ${GREEN}, #22EE66)`, sh: "0 3px 10px rgba(0,200,83,0.28)", glow: "rgba(0,200,83,0.08)" },
  { bg: `linear-gradient(135deg, ${RED}, #FF6688)`, sh: "0 3px 10px rgba(255,51,85,0.28)", glow: "rgba(255,51,85,0.08)" },
];

const MyClasses = () => {
  const navigate = useNavigate();
  const { teacherData } = useAuth();

  const [classes, setClasses]                     = useState<ClassDoc[]>([]);
  const [enrollments, setEnrollments]             = useState<EnrollmentDoc[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceDoc[]>([]);
  const [scoresRecords, setScoresRecords]         = useState<ScoreDoc[]>([]);
  const [startTimesMap, setStartTimesMap]         = useState<Map<string, string>>(new Map());
  const [loading, setLoading]                     = useState(true);
  const [searchQuery, setSearchQuery]             = useState("");
  const [filter, setFilter]                       = useState<FilterType>("All");
  const [showSearch, setShowSearch]               = useState(false);

  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    const branchId = teacherData.branchId as string | undefined;
    const BC: QueryConstraint[] = branchId ? [where("branchId", "==", branchId)] : [];

    const qAssign = query(
      collection(db, "teaching_assignments"),
      where("schoolId", "==", schoolId),
      ...BC,
      where("teacherId", "==", teacherData.id),
      where("status", "==", "active")
    );

    // Guard against stale getDocs responses overwriting newer snapshot state.
    let ignore = false;
    const unsubAssign = onSnapshot(qAssign, async (snap) => {
      const assignedIds = snap.docs.map(d => d.data().classId).filter(Boolean);

      const timesMap = new Map<string, string>();
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.classId && (data.startTime || data.scheduleTime)) {
          timesMap.set(data.classId, data.startTime || data.scheduleTime);
        }
      });
      if (ignore) return;
      setStartTimesMap(timesMap);

      const legacySnap = await getDocs(query(
        collection(db, "classes"),
        where("schoolId", "==", schoolId),
        ...BC,
        where("teacherId", "==", teacherData.id),
      ));
      if (ignore) return;
      const legacyIds  = legacySnap.docs.map(d => d.id);
      const allIds     = Array.from(new Set([...assignedIds, ...legacyIds]));
      if (allIds.length === 0) { setClasses([]); setLoading(false); return; }
      // Scoped class fetch — was previously a bare collection() call which
      // loaded every school's classes into the browser.
      const classSnap  = await getDocs(query(
        collection(db, "classes"),
        where("schoolId", "==", schoolId),
        ...BC,
      ));
      if (ignore) return;
      setClasses(classSnap.docs.filter(d => allIds.includes(d.id)).map(d => ({ ...d.data(), id: d.id })));
      setLoading(false);
    });

    const unsubEnrol = onSnapshot(
      query(collection(db, "enrollments"), where("schoolId", "==", schoolId), ...BC, where("teacherId", "==", teacherData.id)),
      (snap) => setEnrollments(snap.docs.map(d => ({ ...d.data(), id: d.id })))
    );
    const unsubAtnd = onSnapshot(
      query(collection(db, "attendance"), where("schoolId", "==", schoolId), ...BC, where("teacherId", "==", teacherData.id)),
      (snap) => setAttendanceRecords(snap.docs.map(d => ({ ...d.data(), id: d.id })))
    );
    const unsubScores = onSnapshot(
      query(collection(db, "test_scores"), where("schoolId", "==", schoolId), ...BC, where("teacherId", "==", teacherData.id)),
      (snap) => setScoresRecords(snap.docs.map(d => ({ ...d.data(), id: d.id })))
    );

    return () => { ignore = true; unsubAssign(); unsubEnrol(); unsubAtnd(); unsubScores(); };
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  const getMetrics = (classId: string) => {
    const attArr   = attendanceRecords.filter(r => r.classId === classId);
    const present  = attArr.filter(r => r.status === "present" || r.status === "late").length;
    const atndRaw  = attArr.length > 0 ? (present / attArr.length) * 100 : -1;

    const scoreArr   = scoresRecords.filter(r => r.classId === classId);
    const totalScore = scoreArr.reduce((acc, r) => acc + parseFloat(String(r.percentage ?? r.score ?? 0)), 0);
    const perfRaw    = scoreArr.length > 0 ? totalScore / scoreArr.length : -1;

    const studentCount = enrollments.filter(e => e.classId === classId).length;
    const isAttention  = atndRaw >= 0 && atndRaw < 85;

    return {
      atndDisplay: atndRaw >= 0 ? `${atndRaw.toFixed(1)}%` : "—",
      perfDisplay: perfRaw >= 0 ? `${perfRaw.toFixed(1)}%` : "—",
      atndRaw,
      perfRaw,
      studentCount,
      isAttention,
    };
  };

  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center" style={{ background: "#EEF4FF" }}>
      <Loader2 className="w-10 h-10 animate-spin" style={{ color: B1 }} />
    </div>
  );

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

  const teacherInitial = (teacherData?.name?.[0] || "T").toUpperCase();

  // ── Derived header values ────────────────────────────────────────
  const allMetrics    = classes.map(cls => getMetrics(cls.id));
  const totalStudents = allMetrics.reduce((s, m) => s + m.studentCount, 0);

  const validAtnd = allMetrics.map(m => m.atndRaw).filter(r => r >= 0);
  const avgAtnd   = validAtnd.length > 0 ? validAtnd.reduce((s, v) => s + v, 0) / validAtnd.length : -1;
  const avgAtndStr = avgAtnd >= 0 ? `${avgAtnd.toFixed(1)}%` : "—";

  const validPerf = allMetrics.map(m => m.perfRaw).filter(r => r >= 0);
  const avgPerf   = validPerf.length > 0 ? validPerf.reduce((s, v) => s + v, 0) / validPerf.length : -1;
  const avgPerfStr = avgPerf >= 0 ? `${avgPerf.toFixed(1)}%` : "—";

  const attentionCount = allMetrics.filter(m => m.isAttention).length;
  const activeCount = classes.length - attentionCount;

  const filteredClasses = classes.filter(cls => {
    const nameMatch = cls.name?.toLowerCase().includes(searchQuery.toLowerCase());
    if (!nameMatch) return false;
    if (filter === "All") return true;
    const { isAttention } = getMetrics(cls.id);
    return filter === "Attention" ? isAttention : !isAttention;
  });

  return (
    <div style={{ fontFamily: FONT_D, background: "#EEF4FF" }} className="min-h-screen text-left">

      {/* ═══════════════════ MOBILE VIEW — EduIntellect v2 ═══════════════════ */}
      <div className="md:hidden animate-in fade-in duration-500" style={{ background: "#EEF4FF", minHeight: "100vh" }}>

        {/* 1. Page title + search toggle + avatar */}
        <div className="flex items-start justify-between gap-3 px-4 pt-[10px] pb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-[7px] text-[9px] font-extrabold uppercase mb-[6px]" style={{ color: TT3, letterSpacing: "1.8px" }}>
              <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: GREEN, boxShadow: "0 0 8px rgba(0,200,83,0.5)" }} />
              Teacher Dashboard · My Classes
            </div>
            <h1 className="text-[28px] font-extrabold leading-[1.05]" style={{ color: TT1, letterSpacing: "-1.1px" }}>My Classes</h1>
            <div className="text-[12px] font-medium mt-[6px]" style={{ color: TT3, letterSpacing: "-0.15px" }}>
              {getSemesterLabel()} · {classes.length} assigned
            </div>
          </div>
          <div className="flex items-center gap-[10px] flex-shrink-0 mt-[22px]">
            <button type="button"
              onClick={() => setShowSearch(s => !s)}
              aria-label={showSearch ? "Close search" : "Search classes"}
              className="w-10 h-10 rounded-[13px] bg-white flex items-center justify-center active:scale-[0.92] transition-transform"
              style={{ color: B1, boxShadow: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 12px rgba(9,87,247,0.08)" }}>
              {showSearch ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              ) : (
                <Search className="w-[18px] h-[18px]" strokeWidth={2.2} />
              )}
            </button>
            <button type="button"
              onClick={() => navigate('/settings')}
              aria-label="Profile"
              className="w-10 h-10 rounded-[13px] flex items-center justify-center text-white text-[15px] font-extrabold active:scale-[0.92] transition-transform"
              style={{ background: B1, letterSpacing: "-0.3px", boxShadow: "0 0.5px 1px rgba(9,87,247,0.2), 0 6px 14px rgba(9,87,247,0.3)" }}>
              {teacherInitial}
            </button>
          </div>
        </div>

        {/* Inline search — revealed by search icon */}
        {showSearch && (
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[15px] h-[15px]" style={{ color: "rgba(0,85,255,0.40)" }} strokeWidth={2.3} />
              <input type="text" placeholder="Search classes…" autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-12 pl-10 pr-4 rounded-[16px] text-[13px] outline-none"
                style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D, color: TT1, letterSpacing: "-0.1px" }} />
            </div>
          </div>
        )}

        {/* 2. Hero banner — Classroom Overview */}
        <div className="mx-4 mb-[14px] rounded-[26px] p-[22px] relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)",
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
                <BarChart2 className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div>
                <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Classroom Overview</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>{getSemesterLabel()}</div>
              </div>
              <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-extrabold"
                style={{
                  background: avgAtnd >= 90 ? "rgba(0,232,102,0.18)" : avgAtnd >= 75 ? "rgba(255,170,0,0.22)" : avgAtnd >= 0 ? "rgba(255,51,85,0.18)" : "rgba(255,255,255,0.14)",
                  border: `0.5px solid ${avgAtnd >= 90 ? "rgba(0,232,102,0.5)" : avgAtnd >= 75 ? "rgba(255,170,0,0.5)" : avgAtnd >= 0 ? "rgba(255,51,85,0.5)" : "rgba(255,255,255,0.22)"}`,
                  color: avgAtnd >= 90 ? "#6FFFAA" : avgAtnd >= 75 ? "#FFD166" : avgAtnd >= 0 ? "#FF99AA" : "rgba(255,255,255,0.72)",
                  letterSpacing: "0.3px",
                }}>
                <span className="w-[6px] h-[6px] rounded-full" style={{
                  background: avgAtnd >= 90 ? "#00FF88" : avgAtnd >= 75 ? "#FFCC22" : avgAtnd >= 0 ? "#FF5577" : "#fff",
                  boxShadow: `0 0 8px ${avgAtnd >= 90 ? "#00FF88" : avgAtnd >= 75 ? "#FFCC22" : avgAtnd >= 0 ? "#FF5577" : "#fff"}`,
                }} />
                {avgAtnd >= 90 ? "Excellent" : avgAtnd >= 75 ? "Good" : avgAtnd >= 0 ? "Watch" : "No data"}
              </div>
            </div>
            <div className="text-[56px] font-extrabold text-white leading-none mb-[8px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-2.6px" }}>
              {avgAtnd >= 0 ? avgAtnd.toFixed(1) : "—"}
              {avgAtnd >= 0 && <span className="text-[28px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-0.8px" }}>%</span>}
            </div>
            <div className="text-[13px] font-medium mb-[20px]" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
              <b className="text-white font-bold">{avgAtnd >= 90 ? "Strong performance" : avgAtnd >= 75 ? "Solid progress" : avgAtnd >= 0 ? "Keep pushing" : "Awaiting data"}</b> across all your classes this term.
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              {[
                { v: avgPerfStr, l: "Perform." },
                { v: `${totalStudents}`, l: "Students" },
                { v: `${activeCount}/${attentionCount}`, l: "Act./Att." },
              ].map(({ v, l }) => (
                <div key={l} className="py-[13px] px-[6px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                  <div className="text-[20px] font-extrabold text-white" style={{ letterSpacing: "-0.6px" }}>{v}</div>
                  <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 3. 2×2 stats — click to filter */}
        <div className="grid grid-cols-2 gap-[10px] px-4 mb-[14px]">
          {[
            {
              label: "Total Classes", val: `${classes.length}`, iconBg: B1, color: B1,
              sub: <span className="font-bold" style={{ color: GREEN }}>✓ All assigned</span>,
              filterKey: "All" as FilterType,
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                </svg>
              ),
            },
            {
              label: "Active", val: `${activeCount}`, iconBg: GREEN, color: GREEN,
              sub: activeCount === classes.length && classes.length > 0
                ? <span className="font-bold" style={{ color: GREEN }}>● All running</span>
                : <span className="font-bold" style={{ color: TT3 }}>● {activeCount} of {classes.length}</span>,
              filterKey: "Active" as FilterType,
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="8 12 11 15 16 9"/>
                </svg>
              ),
            },
            {
              label: "Attention", val: `${attentionCount}`, iconBg: ORANGE, color: ORANGE,
              sub: attentionCount === 0
                ? <span className="font-bold" style={{ color: GREEN }}>✓ All clear</span>
                : <span className="font-bold" style={{ color: ORANGE }}>● Needs focus</span>,
              filterKey: "Attention" as FilterType,
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12" y2="16"/>
                </svg>
              ),
            },
            {
              label: "Students", val: `${totalStudents}`, iconBg: VIOLET, color: VIOLET,
              sub: classes.length > 0
                ? <span className="font-bold" style={{ color: VIOLET }}>● Across {classes.length} {classes.length === 1 ? "class" : "classes"}</span>
                : <span className="font-semibold" style={{ color: TT3 }}>No classes yet</span>,
              filterKey: null,
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                  <path d="M16 3.13a4 4 0 010 7.75"/>
                </svg>
              ),
            },
          ].map(({ label, val, iconBg, color, sub, filterKey, icon }) => {
            const isActive = filterKey !== null && filter === filterKey;
            return (
              <button key={label} type="button"
                onClick={() => {
                  if (filterKey) setFilter(filterKey);
                  else { setFilter("All"); }
                }}
                aria-pressed={isActive}
                {...tilt3D}
                className="bg-white rounded-[20px] p-4 relative flex flex-col text-left active:scale-[0.96] transition-transform"
                style={{
                  boxShadow: isActive ? `${SH_LG_D}, 0 0 0 2px ${color}` : SH_LG_D,
                  border: `0.5px solid ${SEP_D}`,
                  ...tilt3DStyle,
                }}>
                <div className="flex items-start gap-[10px] mb-[18px]" style={{ minHeight: 40 }}>
                  <div className="flex-1 min-w-0 text-[10px] font-bold uppercase leading-[1.4] pt-[3px]" style={{ color: TT3, letterSpacing: "1px" }}>
                    {label}
                  </div>
                  <div className="flex-shrink-0 w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white" style={{ background: iconBg }}>
                    {icon}
                  </div>
                </div>
                <div className="text-[30px] font-extrabold leading-none" style={{ color, letterSpacing: "-1.3px" }}>{val}</div>
                <div className="text-[11px] font-semibold mt-[7px] flex items-center gap-[5px]" style={{ color: TT4, letterSpacing: "-0.15px" }}>
                  {sub}
                </div>
              </button>
            );
          })}
        </div>

        {/* 4. Section header */}
        <div className="flex items-center justify-between px-5 pb-[10px]">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[18px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.5px" }}>Your Classes</h2>
            <span className="text-[12px] font-semibold" style={{ color: TT3, letterSpacing: "-0.1px" }}>
              {filter === "All"
                ? `${classes.length} assigned`
                : `${filteredClasses.length} ${filter.toLowerCase()}`}
            </span>
          </div>
          <button type="button"
            onClick={() => {
              const order: FilterType[] = ["All", "Active", "Attention"];
              setFilter(order[(order.indexOf(filter) + 1) % order.length]);
            }}
            aria-label={`Filter · currently ${filter}`}
            className="h-[30px] px-3 rounded-[10px] bg-white flex items-center gap-[4px] text-[11px] font-bold active:scale-[0.94] transition-transform"
            style={{ color: B1, letterSpacing: "-0.1px", boxShadow: "0 0.5px 1px rgba(9,87,247,0.05), 0 2px 8px rgba(9,87,247,0.06)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6"/>
              <line x1="7" y1="12" x2="17" y2="12"/>
              <line x1="10" y1="18" x2="14" y2="18"/>
            </svg>
            {filter === "All" ? "Sort" : filter}
          </button>
        </div>

        {/* 5. Class cards */}
        {filteredClasses.length === 0 ? (
          <div className="mx-4 bg-white rounded-[22px] py-12 px-6 flex flex-col items-center text-center relative overflow-hidden"
            style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}` }}>
            <div className="absolute -top-[50px] -right-[40px] w-[180px] h-[180px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="w-[64px] h-[64px] rounded-[20px] flex items-center justify-center mb-4 relative z-10"
              style={{ background: B1, boxShadow: SH_BTN_D }}>
              <GraduationCap className="w-7 h-7 text-white" strokeWidth={2.2} />
            </div>
            <div className="text-[17px] font-extrabold mb-1 relative z-10" style={{ color: TT1, letterSpacing: "-0.3px" }}>
              {classes.length === 0 ? "No classes yet" : `No ${filter.toLowerCase()} classes`}
            </div>
            <div className="text-[12px] leading-[1.6] max-w-[240px] relative z-10" style={{ color: TT3 }}>
              {classes.length === 0
                ? "Your principal will assign classes soon. Check back later."
                : searchQuery
                  ? "Try adjusting your search or filters."
                  : `You have no classes in the "${filter}" category.`}
            </div>
          </div>
        ) : (
          <div className="mx-4">
            {filteredClasses.map((cls, idx) => {
              const m        = getMetrics(cls.id);
              const nextTime = startTimesMap.get(cls.id) || cls.startTime || cls.scheduleTime;
              const subject  = cls.subject || teacherData?.subject || "Subject";
              const accent   = idx % 2 === 0 ? B1 : VIOLET;
              const accentName = idx % 2 === 0 ? "blue" : "violet";

              return (
                <div key={cls.id}
                  onClick={() => navigate(`/my-classes/${cls.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/my-classes/${cls.id}`); }}
                  {...tilt3D}
                  className="bg-white rounded-[22px] p-[18px] mb-3 relative overflow-hidden active:scale-[0.99] transition-transform cursor-pointer"
                  style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}
                  aria-label={`Open ${cls.name || "class"}`}>
                  {/* Top accent stripe */}
                  <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: accent }} />

                  {/* Head */}
                  <div className="flex items-start gap-[13px] mb-4">
                    <div className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center text-white flex-shrink-0"
                      style={{ background: accent }}>
                      <Home className="w-[22px] h-[22px]" strokeWidth={2.2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[20px] font-extrabold leading-[1.1] truncate" style={{ color: TT1, letterSpacing: "-0.6px" }}>
                          {cls.name || "Class"}
                        </div>
                        <div className="flex items-center gap-[5px] px-[9px] py-[4px] rounded-full text-[10px] font-extrabold flex-shrink-0"
                          style={m.isAttention
                            ? { background: "rgba(255,136,0,0.12)", color: ORANGE, letterSpacing: "0.2px" }
                            : { background: "rgba(0,200,83,0.12)", color: GREEN, letterSpacing: "0.2px" }}>
                          <span className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: m.isAttention ? ORANGE : GREEN }} />
                          {m.isAttention ? "Attention" : "Active"}
                        </div>
                      </div>
                      <div className="flex items-center gap-[5px] text-[11px] font-bold uppercase mt-[4px]" style={{ color: TT3, letterSpacing: "0.6px" }}>
                        {subject}
                        <span style={{ color: TT4 }}>·</span>
                        {m.studentCount} {m.studentCount === 1 ? "student" : "students"}
                      </div>
                    </div>
                  </div>

                  {/* Metrics group */}
                  <div className="rounded-[14px] mb-3 p-[2px]" style={{ background: "#F4F7FE" }}>
                    {[
                      {
                        label: "Attendance", val: m.atndDisplay,
                        valColor: m.atndRaw >= 85 ? GREEN : m.atndRaw >= 0 ? ORANGE : TT4,
                        iconBg: "rgba(9,87,247,0.12)", iconColor: B1,
                        icon: (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="12" width="4" height="9" rx="1"/>
                            <rect x="10" y="8" width="4" height="13" rx="1"/>
                            <rect x="17" y="4" width="4" height="17" rx="1"/>
                          </svg>
                        ),
                      },
                      {
                        label: "Performance", val: m.perfDisplay,
                        valColor: m.perfRaw >= 60 ? GREEN : m.perfRaw >= 0 ? RED : TT4,
                        iconBg: "rgba(123,63,244,0.14)", iconColor: VIOLET,
                        icon: (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                            <polyline points="17 6 23 6 23 12"/>
                          </svg>
                        ),
                      },
                      {
                        label: "Next Class", val: nextTime || "—",
                        valColor: nextTime ? TT1 : TT4,
                        iconBg: "rgba(255,136,0,0.14)", iconColor: ORANGE,
                        icon: (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                          </svg>
                        ),
                      },
                    ].map((row, i) => (
                      <div key={row.label} className="flex items-center px-[12px] py-[11px] gap-[11px] relative">
                        {i > 0 && (
                          <div className="absolute top-0 left-[46px] right-[12px] h-[0.5px]" style={{ background: "rgba(9,87,247,0.08)" }} />
                        )}
                        <div className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center flex-shrink-0"
                          style={{ background: row.iconBg, color: row.iconColor }}>
                          {row.icon}
                        </div>
                        <div className="flex-1 text-[12px] font-semibold" style={{ color: TT2, letterSpacing: "-0.15px" }}>{row.label}</div>
                        <div className="text-[14px] font-extrabold"
                          style={{ color: row.valColor, letterSpacing: "-0.35px", fontWeight: row.val === "—" ? 700 : 800 }}>
                          {row.val}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/my-classes/${cls.id}`); }}
                      className="flex-1 h-11 rounded-[13px] text-[13px] font-bold text-white flex items-center justify-center gap-[6px] active:scale-[0.96] transition-transform"
                      style={{ background: B1, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.3)" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                      View Class
                    </button>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); navigate('/attendance'); }}
                      className="flex-1 h-11 rounded-[13px] text-[13px] font-bold flex items-center justify-center gap-[6px] active:scale-[0.96] transition-transform"
                      style={{ background: "#F4F7FE", color: B1, letterSpacing: "-0.2px" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 11 12 14 22 4"/>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                      </svg>
                      Attendance
                    </button>
                  </div>
                  {/* keep accent ref to prevent lint warning for unused var */}
                  <span className="hidden" data-accent={accentName} />
                </div>
              );
            })}
          </div>
        )}

        {/* 6. AI Classes Intelligence */}
        <div className="mx-4 mt-[14px] mb-[14px] rounded-[26px] p-[22px] relative overflow-hidden"
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
              <div className="text-[10px] font-black uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>AI Classes Intelligence</div>
              <div className="ml-auto px-[10px] py-[4px] rounded-full text-[9px] font-extrabold"
                style={{
                  background: "rgba(123,63,244,0.3)",
                  border: "0.5px solid rgba(155,95,255,0.5)",
                  color: "#DCC8FF",
                  letterSpacing: "0.5px",
                }}>Tip</div>
            </div>
            <div className="text-[13px] font-normal leading-[1.6] mb-[18px]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
              {classes.length === 0
                ? <>No classes assigned yet — your <strong>principal</strong> will link classes to your account. Once that's done, performance and attendance will show up here.</>
                : attentionCount > 0
                  ? <>
                      <strong>{attentionCount}</strong> {attentionCount === 1 ? "class needs" : "classes need"} attention — tap <strong>Attention</strong> above to filter.
                      {avgAtnd >= 0 && <> Average attendance is <strong>{avgAtndStr}</strong>.</>}
                    </>
                  : <>
                      All classes are <strong>tracking well</strong>
                      {avgAtnd >= 0 && <> — average attendance is <strong>{avgAtndStr}</strong></>}
                      . Keep engaging — check back after the next attendance cycle.
                    </>
              }
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              <button type="button" onClick={() => navigate('/attendance')}
                className="py-[13px] px-[6px] text-center active:brightness-110 transition"
                style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[19px] font-extrabold" style={{ color: avgAtnd >= 75 ? "#6FFFAA" : avgAtnd >= 0 ? "#FF99AA" : "#fff", letterSpacing: "-0.5px" }}>
                  {avgAtndStr}
                </div>
                <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attend.</div>
              </button>
              <button type="button" onClick={() => navigate('/gradebook')}
                className="py-[13px] px-[6px] text-center active:brightness-110 transition"
                style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[19px] font-extrabold" style={{ color: avgPerf >= 60 ? "#B5A0FF" : avgPerf >= 0 ? "#FF99AA" : "#fff", letterSpacing: "-0.5px" }}>
                  {avgPerfStr}
                </div>
                <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Perform.</div>
              </button>
              <button type="button" onClick={() => navigate('/students')}
                className="py-[13px] px-[6px] text-center active:brightness-110 transition"
                style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[19px] font-extrabold text-white" style={{ letterSpacing: "-0.5px" }}>{totalStudents}</div>
                <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Students</div>
              </button>
            </div>
          </div>
        </div>

        <div className="h-2" />
      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div className="hidden md:block animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
        style={{ background: "#EEF4FF" }}>
        <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-12">

          {/* Header row */}
          <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
            <div>
              <div className="flex items-center gap-[7px] text-[10px] font-extrabold uppercase mb-[8px]" style={{ color: TT3, letterSpacing: "1.8px" }}>
                <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: GREEN, boxShadow: "0 0 8px rgba(0,200,83,0.5)" }} />
                Teacher Dashboard · My Classes
              </div>
              <h1 className="text-[36px] font-extrabold leading-[1.05]" style={{ color: TT1, letterSpacing: "-1.2px" }}>My Classes</h1>
              <div className="text-[14px] font-medium mt-[6px]" style={{ color: TT3, letterSpacing: "-0.15px" }}>
                {getSemesterLabel()} · {classes.length} assigned {classes.length === 1 ? "class" : "classes"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[15px] h-[15px]" style={{ color: "rgba(0,85,255,0.40)" }} strokeWidth={2.3} />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search classes…"
                  className="pl-10 pr-5 py-[12px] rounded-[14px] text-[13px] outline-none w-[280px]"
                  style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D, color: TT1, letterSpacing: "-0.1px" }} />
              </div>
              <button type="button"
                onClick={() => navigate('/settings')}
                aria-label="Profile"
                className="w-12 h-12 rounded-[14px] flex items-center justify-center text-white text-[17px] font-extrabold hover:scale-[1.04] active:scale-[0.96] transition-transform"
                style={{ background: B1, letterSpacing: "-0.3px", boxShadow: "0 0.5px 1px rgba(9,87,247,0.2), 0 6px 14px rgba(9,87,247,0.3)" }}>
                {teacherInitial}
              </button>
            </div>
          </div>

          {/* HERO banner — Classroom Overview */}
          <div className="rounded-[28px] px-8 py-8 relative overflow-hidden mb-5"
            style={{
              background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
              boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)",
            }}>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
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
                  <BarChart2 className="w-6 h-6" strokeWidth={2.2} />
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Classroom Overview</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>{getSemesterLabel()}</div>
                </div>
                <div className="ml-auto flex items-center gap-[6px] px-4 py-[7px] rounded-full text-[11px] font-extrabold"
                  style={{
                    background: avgAtnd >= 90 ? "rgba(0,232,102,0.18)" : avgAtnd >= 75 ? "rgba(255,170,0,0.22)" : avgAtnd >= 0 ? "rgba(255,51,85,0.18)" : "rgba(255,255,255,0.14)",
                    border: `0.5px solid ${avgAtnd >= 90 ? "rgba(0,232,102,0.5)" : avgAtnd >= 75 ? "rgba(255,170,0,0.5)" : avgAtnd >= 0 ? "rgba(255,51,85,0.5)" : "rgba(255,255,255,0.22)"}`,
                    color: avgAtnd >= 90 ? "#6FFFAA" : avgAtnd >= 75 ? "#FFD166" : avgAtnd >= 0 ? "#FF99AA" : "rgba(255,255,255,0.72)",
                    letterSpacing: "0.3px",
                  }}>
                  <span className="w-[6px] h-[6px] rounded-full" style={{
                    background: avgAtnd >= 90 ? "#00FF88" : avgAtnd >= 75 ? "#FFCC22" : avgAtnd >= 0 ? "#FF5577" : "#fff",
                    boxShadow: `0 0 8px ${avgAtnd >= 90 ? "#00FF88" : avgAtnd >= 75 ? "#FFCC22" : avgAtnd >= 0 ? "#FF5577" : "#fff"}`,
                  }} />
                  {avgAtnd >= 90 ? "Excellent" : avgAtnd >= 75 ? "Good" : avgAtnd >= 0 ? "Watch" : "No data"}
                </div>
              </div>
              <div className="flex items-end justify-between gap-8 flex-wrap">
                <div>
                  <div className="text-[84px] font-extrabold text-white leading-none mb-[6px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-3.8px" }}>
                    {avgAtnd >= 0 ? avgAtnd.toFixed(1) : "—"}
                    {avgAtnd >= 0 && <span className="text-[40px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-1px" }}>%</span>}
                  </div>
                  <div className="text-[14px] font-medium" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
                    <b className="text-white font-bold">{avgAtnd >= 90 ? "Strong performance" : avgAtnd >= 75 ? "Solid progress" : avgAtnd >= 0 ? "Keep pushing" : "Awaiting data"}</b> across all your classes this term.
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[380px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  {[
                    { v: avgPerfStr, l: "Perform." },
                    { v: `${totalStudents}`, l: "Students" },
                    { v: `${activeCount}/${attentionCount}`, l: "Act./Att." },
                  ].map(({ v, l }) => (
                    <div key={l} className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[26px] font-extrabold text-white" style={{ letterSpacing: "-0.8px" }}>{v}</div>
                      <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 4-column stat cards */}
          <div className="grid grid-cols-4 gap-4 mb-5">
            {[
              {
                label: "Total Classes", val: `${classes.length}`, iconBg: B1, color: B1,
                sub: <span className="font-bold" style={{ color: GREEN }}>✓ All assigned</span>,
                filterKey: "All" as FilterType,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                  </svg>
                ),
              },
              {
                label: "Active", val: `${activeCount}`, iconBg: GREEN, color: GREEN,
                sub: activeCount === classes.length && classes.length > 0
                  ? <span className="font-bold" style={{ color: GREEN }}>● All running</span>
                  : <span className="font-bold" style={{ color: TT3 }}>● {activeCount} of {classes.length}</span>,
                filterKey: "Active" as FilterType,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="8 12 11 15 16 9"/>
                  </svg>
                ),
              },
              {
                label: "Attention", val: `${attentionCount}`, iconBg: ORANGE, color: ORANGE,
                sub: attentionCount === 0
                  ? <span className="font-bold" style={{ color: GREEN }}>✓ All clear</span>
                  : <span className="font-bold" style={{ color: ORANGE }}>● Needs focus</span>,
                filterKey: "Attention" as FilterType,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12" y2="16"/>
                  </svg>
                ),
              },
              {
                label: "Students", val: `${totalStudents}`, iconBg: VIOLET, color: VIOLET,
                sub: classes.length > 0
                  ? <span className="font-bold" style={{ color: VIOLET }}>● Across {classes.length} {classes.length === 1 ? "class" : "classes"}</span>
                  : <span className="font-semibold" style={{ color: TT3 }}>No classes yet</span>,
                filterKey: null,
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                    <path d="M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                ),
              },
            ].map(({ label, val, iconBg, color, sub, filterKey, icon }) => {
              const isActive = filterKey !== null && filter === filterKey;
              return (
                <button key={label} type="button"
                  onClick={() => {
                    if (filterKey) setFilter(filterKey);
                    else { setFilter("All"); }
                  }}
                  aria-pressed={isActive}
                  {...tilt3D}
                  className="bg-white rounded-[22px] p-5 relative flex flex-col text-left active:scale-[0.98] transition-all"
                  style={{
                    boxShadow: isActive ? `${SH_LG_D}, 0 0 0 2px ${color}` : SH_LG_D,
                    border: `0.5px solid ${SEP_D}`,
                    ...tilt3DStyle,
                  }}>
                  <div className="flex items-start gap-[10px] mb-5" style={{ minHeight: 44 }}>
                    <div className="flex-1 min-w-0 text-[11px] font-bold uppercase leading-[1.4] pt-[4px]" style={{ color: TT3, letterSpacing: "1px" }}>
                      {label}
                    </div>
                    <div className="flex-shrink-0 w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white" style={{ background: iconBg }}>
                      {icon}
                    </div>
                  </div>
                  <div className="text-[38px] font-extrabold leading-none" style={{ color, letterSpacing: "-1.6px" }}>{val}</div>
                  <div className="text-[12px] font-semibold mt-2 flex items-center gap-[5px]" style={{ color: TT4, letterSpacing: "-0.15px" }}>
                    {sub}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Section header + sort */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[22px] font-extrabold" style={{ color: TT1, letterSpacing: "-0.6px" }}>Your Classes</h2>
              <span className="text-[13px] font-semibold" style={{ color: TT3, letterSpacing: "-0.1px" }}>
                {filter === "All"
                  ? `${classes.length} assigned`
                  : `${filteredClasses.length} ${filter.toLowerCase()}`}
              </span>
            </div>
            <button type="button"
              onClick={() => {
                const order: FilterType[] = ["All", "Active", "Attention"];
                setFilter(order[(order.indexOf(filter) + 1) % order.length]);
              }}
              aria-label={`Filter · currently ${filter}`}
              className="h-[36px] px-4 rounded-[11px] bg-white flex items-center gap-[6px] text-[12px] font-bold hover:scale-[1.03] active:scale-[0.97] transition-transform"
              style={{ color: B1, letterSpacing: "-0.1px", boxShadow: "0 0.5px 1px rgba(9,87,247,0.05), 0 2px 8px rgba(9,87,247,0.06)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6"/>
                <line x1="7" y1="12" x2="17" y2="12"/>
                <line x1="10" y1="18" x2="14" y2="18"/>
              </svg>
              {filter === "All" ? "Sort" : filter}
            </button>
          </div>

          {/* Class cards grid */}
          {filteredClasses.length === 0 ? (
            <div className="bg-white rounded-[22px] py-16 px-8 flex flex-col items-center text-center relative overflow-hidden mb-5"
              style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}` }}>
              <div className="absolute -top-[60px] -right-[40px] w-[240px] h-[240px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
              <div className="w-[80px] h-[80px] rounded-[22px] flex items-center justify-center mb-5 relative z-10"
                style={{ background: B1, boxShadow: SH_BTN_D }}>
                <GraduationCap className="w-9 h-9 text-white" strokeWidth={2.2} />
              </div>
              <div className="text-[22px] font-extrabold mb-2 relative z-10" style={{ color: TT1, letterSpacing: "-0.5px" }}>
                {classes.length === 0 ? "No classes yet" : `No ${filter.toLowerCase()} classes`}
              </div>
              <div className="text-[14px] leading-[1.6] max-w-[420px] relative z-10" style={{ color: TT3 }}>
                {classes.length === 0
                  ? "Your principal will assign classes soon. Check back later."
                  : searchQuery
                    ? "Try adjusting your search or filters."
                    : `You have no classes in the "${filter}" category.`}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
              {filteredClasses.map((cls, idx) => {
                const m        = getMetrics(cls.id);
                const nextTime = startTimesMap.get(cls.id) || cls.startTime || cls.scheduleTime;
                const subject  = cls.subject || teacherData?.subject || "Subject";
                const accent   = idx % 2 === 0 ? B1 : VIOLET;

                return (
                  <div key={cls.id}
                    onClick={() => navigate(`/my-classes/${cls.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/my-classes/${cls.id}`); }}
                    {...tilt3D}
                    className="bg-white rounded-[22px] p-[22px] relative overflow-hidden active:scale-[0.99] transition-all cursor-pointer"
                    style={{ boxShadow: SH_LG_D, border: `0.5px solid ${SEP_D}`, ...tilt3DStyle }}
                    aria-label={`Open ${cls.name || "class"}`}>
                    {/* Top accent stripe */}
                    <div className="absolute top-0 left-0 right-0 h-[4px]" style={{ background: accent }} />

                    {/* Head */}
                    <div className="flex items-start gap-[14px] mb-4">
                      <div className="w-[54px] h-[54px] rounded-[15px] flex items-center justify-center text-white flex-shrink-0"
                        style={{ background: accent }}>
                        <Home className="w-[26px] h-[26px]" strokeWidth={2.2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[22px] font-extrabold leading-[1.1] truncate" style={{ color: TT1, letterSpacing: "-0.6px" }}>
                            {cls.name || "Class"}
                          </div>
                          <div className="flex items-center gap-[5px] px-[10px] py-[5px] rounded-full text-[10px] font-extrabold flex-shrink-0"
                            style={m.isAttention
                              ? { background: "rgba(255,136,0,0.12)", color: ORANGE, letterSpacing: "0.2px" }
                              : { background: "rgba(0,200,83,0.12)", color: GREEN, letterSpacing: "0.2px" }}>
                            <span className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: m.isAttention ? ORANGE : GREEN }} />
                            {m.isAttention ? "Attention" : "Active"}
                          </div>
                        </div>
                        <div className="flex items-center gap-[5px] text-[11px] font-bold uppercase mt-[5px]" style={{ color: TT3, letterSpacing: "0.6px" }}>
                          {subject}
                          <span style={{ color: TT4 }}>·</span>
                          {m.studentCount} {m.studentCount === 1 ? "student" : "students"}
                        </div>
                      </div>
                    </div>

                    {/* Metrics group */}
                    <div className="rounded-[14px] mb-4 p-[3px]" style={{ background: "#F4F7FE" }}>
                      {[
                        {
                          label: "Attendance", val: m.atndDisplay,
                          valColor: m.atndRaw >= 85 ? GREEN : m.atndRaw >= 0 ? ORANGE : TT4,
                          iconBg: "rgba(9,87,247,0.12)", iconColor: B1,
                          icon: (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="12" width="4" height="9" rx="1"/>
                              <rect x="10" y="8" width="4" height="13" rx="1"/>
                              <rect x="17" y="4" width="4" height="17" rx="1"/>
                            </svg>
                          ),
                        },
                        {
                          label: "Performance", val: m.perfDisplay,
                          valColor: m.perfRaw >= 60 ? GREEN : m.perfRaw >= 0 ? RED : TT4,
                          iconBg: "rgba(123,63,244,0.14)", iconColor: VIOLET,
                          icon: (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                              <polyline points="17 6 23 6 23 12"/>
                            </svg>
                          ),
                        },
                        {
                          label: "Next Class", val: nextTime || "—",
                          valColor: nextTime ? TT1 : TT4,
                          iconBg: "rgba(255,136,0,0.14)", iconColor: ORANGE,
                          icon: (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="4" width="18" height="18" rx="2"/>
                              <line x1="16" y1="2" x2="16" y2="6"/>
                              <line x1="8" y1="2" x2="8" y2="6"/>
                              <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                          ),
                        },
                      ].map((row, i) => (
                        <div key={row.label} className="flex items-center px-[13px] py-[12px] gap-[12px] relative">
                          {i > 0 && (
                            <div className="absolute top-0 left-[50px] right-[13px] h-[0.5px]" style={{ background: "rgba(9,87,247,0.08)" }} />
                          )}
                          <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0"
                            style={{ background: row.iconBg, color: row.iconColor }}>
                            {row.icon}
                          </div>
                          <div className="flex-1 text-[13px] font-semibold" style={{ color: TT2, letterSpacing: "-0.15px" }}>{row.label}</div>
                          <div className="text-[15px] font-extrabold"
                            style={{ color: row.valColor, letterSpacing: "-0.35px", fontWeight: row.val === "—" ? 700 : 800 }}>
                            {row.val}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/my-classes/${cls.id}`); }}
                        className="flex-1 h-12 rounded-[13px] text-[13px] font-bold text-white flex items-center justify-center gap-[6px] hover:scale-[1.02] active:scale-[0.96] transition-transform"
                        style={{ background: B1, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.3)" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                        View Class
                      </button>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); navigate('/attendance'); }}
                        className="flex-1 h-12 rounded-[13px] text-[13px] font-bold flex items-center justify-center gap-[6px] hover:scale-[1.02] active:scale-[0.96] transition-transform"
                        style={{ background: "#F4F7FE", color: B1, letterSpacing: "-0.2px" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 11 12 14 22 4"/>
                          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                        </svg>
                        Attendance
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* AI Classes Intelligence */}
          <div className="rounded-[26px] p-7 relative overflow-hidden"
            style={{
              background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
              boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
            }}>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)"
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
                <div className="text-[11px] font-black uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>AI Classes Intelligence</div>
                <div className="ml-auto px-[11px] py-[5px] rounded-full text-[10px] font-extrabold"
                  style={{
                    background: "rgba(123,63,244,0.3)",
                    border: "0.5px solid rgba(155,95,255,0.5)",
                    color: "#DCC8FF",
                    letterSpacing: "0.5px",
                  }}>Tip</div>
              </div>
              <div className="text-[14px] font-normal leading-[1.6] mb-5" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                {classes.length === 0
                  ? <>No classes assigned yet — your <strong>principal</strong> will link classes to your account. Once that's done, performance and attendance will show up here.</>
                  : attentionCount > 0
                    ? <>
                        <strong>{attentionCount}</strong> {attentionCount === 1 ? "class needs" : "classes need"} attention — click <strong>Attention</strong> above to filter.
                        {avgAtnd >= 0 && <> Average attendance is <strong>{avgAtndStr}</strong>.</>}
                      </>
                    : <>
                        All classes are <strong>tracking well</strong>
                        {avgAtnd >= 0 && <> — average attendance is <strong>{avgAtndStr}</strong></>}
                        . Keep engaging — check back after the next attendance cycle.
                      </>
                }
              </div>
              <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                <button type="button" onClick={() => navigate('/attendance')}
                  className="py-4 px-3 text-center hover:brightness-110 transition"
                  style={{ background: "rgba(0,20,80,0.55)" }}>
                  <div className="text-[22px] font-extrabold" style={{ color: avgAtnd >= 75 ? "#6FFFAA" : avgAtnd >= 0 ? "#FF99AA" : "#fff", letterSpacing: "-0.6px" }}>
                    {avgAtndStr}
                  </div>
                  <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attend.</div>
                </button>
                <button type="button" onClick={() => navigate('/gradebook')}
                  className="py-4 px-3 text-center hover:brightness-110 transition"
                  style={{ background: "rgba(0,20,80,0.55)" }}>
                  <div className="text-[22px] font-extrabold" style={{ color: avgPerf >= 60 ? "#B5A0FF" : avgPerf >= 0 ? "#FF99AA" : "#fff", letterSpacing: "-0.6px" }}>
                    {avgPerfStr}
                  </div>
                  <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Perform.</div>
                </button>
                <button type="button" onClick={() => navigate('/students')}
                  className="py-4 px-3 text-center hover:brightness-110 transition"
                  style={{ background: "rgba(0,20,80,0.55)" }}>
                  <div className="text-[22px] font-extrabold text-white" style={{ letterSpacing: "-0.6px" }}>{totalStudents}</div>
                  <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Students</div>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default MyClasses;
