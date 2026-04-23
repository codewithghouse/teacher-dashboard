import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MarkAttendance from "@/components/MarkAttendance";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, getDocs,
  type QueryConstraint, type DocumentData,
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { getInitials } from "../lib/initials";
import { Loader2 } from "lucide-react";

type ClassDoc = DocumentData & { id: string };
type EnrollmentDoc = DocumentData & { id: string; classId?: string };
type AttendanceRecord = DocumentData & {
  id: string;
  classId?: string;
  date?: string;
  status?: "present" | "absent" | "late";
  studentId?: string;
  studentEmail?: string;
  studentName?: string;
};

// ── Design tokens (desktop) ───────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF',
  green: '#087F5B', green2: '#2F9E44', greenL: '#EBFBEE',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── Mobile Attendance tokens (EduIntellect v2) ────────────────────────────────
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
  SH: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 14px rgba(9,87,247,0.08)",
  SH_SM: "0 0.5px 1px rgba(9,87,247,0.04), 0 2px 10px rgba(9,87,247,0.06)",
  HERO_GRAD: "linear-gradient(135deg, #000820 0%, #001466 32%, #0033CC 68%, #0957F7 100%)",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const todayISO = () => new Date().toLocaleDateString("en-CA");

const AV_BG = ['#E3FAFC','#EBFBEE','#FFF9DB','#EDF2FF','#F3F0FF','#FFF5F5'];
const AV_FG = ['#0C8599','#087F5B','#C87014','#3B5BDB','#6741D9','#C92A2A'];
const avStyle = (name = "") => {
  const i = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_BG.length;
  return { bg: AV_BG[i], color: AV_FG[i] };
};

// ── SVG Icons (stroke, 1.5px) ─────────────────────────────────────────────────
const IcoBarChart = ({ color = T.blue }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="8" width="2.5" height="4" rx=".4"/><rect x="5.5" y="5" width="2.5" height="7" rx=".4"/>
    <rect x="9.5" y="2" width="2.5" height="10" rx=".4"/>
  </svg>
);
const IcoUserCheck = ({ color = T.green }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5.5" cy="4.5" r="2.5"/>
    <path d="M1.5 12.5c0-2.2 1.8-4 4-4s4 1.8 4 4"/>
    <polyline points="9.5,6 11,7.5 13,5"/>
  </svg>
);
const IcoUserX = ({ color = T.red }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5.5" cy="4.5" r="2.5"/>
    <path d="M1.5 12.5c0-2.2 1.8-4 4-4s4 1.8 4 4"/>
    <line x1="9.5" y1="5" x2="13" y2="8.5"/><line x1="13" y1="5" x2="9.5" y2="8.5"/>
  </svg>
);
const IcoClock = ({ color = T.amber }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="5"/><polyline points="7,4.5 7,7 9.5,7"/>
  </svg>
);
const IcoCheck = ({ color = '#fff', size = 14 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2.5,7.5 5.5,10.5 11.5,4"/>
  </svg>
);
// ── Main component ────────────────────────────────────────────────────────────
const Attendance = () => {
  const { teacherData } = useAuth();
  const navigate = useNavigate();

  const [marking, setMarking]               = useState(false);
  const [markingClassId, setMarkingClassId] = useState<string>("");
  const [loading, setLoading]               = useState(true);
  const [classes, setClasses]               = useState<ClassDoc[]>([]);
  const [enrollments, setEnrollments]       = useState<EnrollmentDoc[]>([]);
  const [records, setRecords]               = useState<AttendanceRecord[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  // 1. Classes
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    const branchId = teacherData.branchId as string | undefined;
    const tenant: QueryConstraint[] = branchId
      ? [where("schoolId", "==", schoolId), where("branchId", "==", branchId)]
      : [where("schoolId", "==", schoolId)];
    return onSnapshot(
      query(
        collection(db, "classes"),
        ...tenant,
        where("teacherId", "==", teacherData.id),
      ),
      (snap) => {
        const cls: ClassDoc[] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        setClasses(cls);
        setSelectedClassId(p => p || cls[0]?.id || "");
        if (!cls.length) setLoading(false);
      }
    );
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // 2. Enrollments
  useEffect(() => {
    if (!classes.length || !teacherData?.schoolId) { setEnrollments([]); return; }
    const schoolId = teacherData.schoolId;
    const branchId = teacherData.branchId as string | undefined;
    const tenant: QueryConstraint[] = branchId
      ? [where("schoolId", "==", schoolId), where("branchId", "==", branchId)]
      : [where("schoolId", "==", schoolId)];
    let ignore = false;
    Promise.all(classes.map(c => getDocs(query(
      collection(db, "enrollments"),
      ...tenant,
      where("classId", "==", c.id),
    ))))
      .then(snaps => {
        if (ignore) return;
        const all: EnrollmentDoc[] = [];
        snaps.forEach(s => s.docs.forEach(d => all.push({ ...d.data(), id: d.id })));
        setEnrollments(all);
      })
      .catch(e => console.error("[Attendance] enrollments fetch failed", e));
    return () => { ignore = true; };
  }, [classes, teacherData?.schoolId, teacherData?.branchId]);

  // 3. Attendance records
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId || !classes.length) { setRecords([]); setLoading(false); return; }
    const schoolId = teacherData.schoolId;
    const branchId = teacherData.branchId as string | undefined;
    const tenant: QueryConstraint[] = branchId
      ? [where("schoolId", "==", schoolId), where("branchId", "==", branchId)]
      : [where("schoolId", "==", schoolId)];
    setLoading(true);
    return onSnapshot(
      query(
        collection(db, "attendance"),
        ...tenant,
        where("teacherId", "==", teacherData.id),
      ),
      (snap) => {
        setRecords(snap.docs.map(d => ({ ...d.data(), id: d.id } as AttendanceRecord)));
        setLoading(false);
      }
    );
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId, classes.length]);

  const todayStr = todayISO();

  // Stats
  const stats = useMemo(() => {
    const todayRec = records.filter(r => r.date === todayStr);
    const total = records.length;
    const pres  = records.filter(r => r.status === "present" || r.status === "late").length;
    const rate  = total > 0 ? (pres / total) * 100 : 0;
    return {
      rateNum: Number(rate.toFixed(1)),
      rateStr: total > 0 ? `${rate.toFixed(1)}%` : "0%",
      presentToday: todayRec.filter(r => r.status === "present").length,
      absentToday:  todayRec.filter(r => r.status === "absent").length,
      lateToday:    todayRec.filter(r => r.status === "late").length,
    };
  }, [records, todayStr]);

  // Weekly days (5 past + today + 2 upcoming)
  const weeklyDays = useMemo(() => {
    const todayDate = new Date(); todayDate.setHours(0,0,0,0);
    const makeDay = (d: Date, isFuture = false) => {
      const dateStr = d.toLocaleDateString("en-CA");
      const dayRecs = records.filter(r => r.date === dateStr && r.classId === selectedClassId);
      const pres    = dayRecs.filter(r => r.status === "present" || r.status === "late").length;
      const abs     = dayRecs.filter(r => r.status === "absent").length;
      const total   = enrollments.filter(e => e.classId === selectedClassId).length || 1;
      const wd      = d.getDay();
      return {
        label:     d.toLocaleDateString("en-US", { weekday: "short" }),
        dateLabel: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        dateStr, present: pres, absent: abs,
        rate: dayRecs.length > 0 ? `${((pres / total) * 100).toFixed(1)}%` : null,
        isToday:    dateStr === todayStr,
        hasData:    dayRecs.length > 0,
        isFuture,
        isWeekend:  wd === 0 || wd === 6,
        isForgotten: !isFuture && dateStr !== todayStr && (wd !== 0 && wd !== 6) && !dayRecs.length,
      };
    };
    const past: ReturnType<typeof makeDay>[] = [];
    const cur = new Date(todayDate); cur.setDate(cur.getDate() - 1);
    while (past.length < 5) {
      if (cur.getDay() !== 0 && cur.getDay() !== 6) past.unshift(makeDay(new Date(cur)));
      cur.setDate(cur.getDate() - 1);
    }
    const upcoming: ReturnType<typeof makeDay>[] = [];
    const fut = new Date(todayDate);
    while (upcoming.length < 2) {
      fut.setDate(fut.getDate() + 1);
      if (fut.getDay() !== 0 && fut.getDay() !== 6) upcoming.push(makeDay(new Date(fut), true));
    }
    return [...past, makeDay(todayDate), ...upcoming];
  }, [records, enrollments, selectedClassId, todayStr]);

  // Concerns
  const concerns = useMemo(() => {
    const ms = todayStr.slice(0, 7);
    const map: Record<string, { name: string; absent: number; late: number }> = {};
    records.filter(r => r.date?.startsWith(ms)).forEach(r => {
      const k = r.studentId || r.studentEmail; if (!k) return;
      if (!map[k]) map[k] = { name: r.studentName || "Student", absent: 0, late: 0 };
      if (r.status === "absent") map[k].absent++;
      if (r.status === "late")   map[k].late++;
    });
    return Object.values(map).filter(s => s.absent >= 2 || s.late >= 3)
      .sort((a, b) => (b.absent + b.late) - (a.absent + a.late)).slice(0, 3)
      .map(s => ({
        name: s.name, initials: getInitials(s.name), av: avStyle(s.name),
        issue: s.absent >= 2 ? `${s.absent} absences this month` : "Frequently late",
        badge: s.absent >= 3
          ? { text: "At risk",   bg: T.redL,   color: T.red   }
          : { text: "Follow up", bg: T.amberL, color: T.amber },
      }));
  }, [records, todayStr]);

  const activeClass  = classes.find(c => c.id === selectedClassId);

  if (marking) return <MarkAttendance initialClassId={markingClassId || selectedClassId} onBack={() => setMarking(false)} />;

  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: T.blue }} />
    </div>
  );

  return (
    <div style={{ fontFamily: 'inherit' }} className="text-left pb-8">

      {/* ═══════════════════ MOBILE VIEW (EduIntellect v2) ═══════════════════ */}
      <div className="md:hidden -mt-0" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "0 -16px", paddingBottom: 8 }}>

        {/* Page header */}
        <div className="px-4 pt-3 pb-[14px]">
          <div className="flex items-center gap-[7px] text-[9px] font-extrabold uppercase mb-[6px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
            <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: MA.P }} />
            Teacher Dashboard · Attendance
          </div>
          <h1 className="text-[28px] font-extrabold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.1px" }}>
            Attendance
          </h1>
          <div className="text-[12px] font-medium mt-[6px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
            Track and manage student attendance across all classes.
          </div>
        </div>

        {/* Hero — gradient with overall rate */}
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
              </div>
              <div>
                <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Overall Rate</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Today · {activeClass?.name || "All classes"}</div>
              </div>
              <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-extrabold"
                style={{
                  background: stats.rateNum >= 85 ? "rgba(0,232,102,0.18)" : stats.rateNum >= 70 ? "rgba(255,170,0,0.22)" : stats.rateNum > 0 ? "rgba(255,51,85,0.18)" : "rgba(255,255,255,0.14)",
                  border: `0.5px solid ${stats.rateNum >= 85 ? "rgba(0,232,102,0.5)" : stats.rateNum >= 70 ? "rgba(255,170,0,0.5)" : stats.rateNum > 0 ? "rgba(255,51,85,0.5)" : "rgba(255,255,255,0.22)"}`,
                  color: stats.rateNum >= 85 ? "#6FFFAA" : stats.rateNum >= 70 ? "#FFD166" : stats.rateNum > 0 ? "#FF99AA" : "rgba(255,255,255,0.72)",
                  letterSpacing: "0.3px",
                }}>
                <span className="w-[6px] h-[6px] rounded-full" style={{
                  background: stats.rateNum >= 85 ? "#00FF88" : stats.rateNum >= 70 ? "#FFCC22" : stats.rateNum > 0 ? "#FF5577" : "#fff",
                  boxShadow: `0 0 8px ${stats.rateNum >= 85 ? "#00FF88" : stats.rateNum >= 70 ? "#FFCC22" : stats.rateNum > 0 ? "#FF5577" : "#fff"}`,
                }} />
                {stats.rateNum >= 85 ? "On Track" : stats.rateNum >= 70 ? "Watch" : stats.rateNum > 0 ? "Low" : "No data"}
              </div>
            </div>
            <div className="text-[56px] font-extrabold text-white leading-none mb-[8px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-2.6px" }}>
              {stats.rateNum > 0 ? stats.rateNum.toFixed(1) : "—"}
              {stats.rateNum > 0 && <span className="text-[28px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-0.8px" }}>%</span>}
            </div>
            <div className="text-[13px] font-medium mb-[20px]" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
              <b className="text-white font-bold">
                {stats.rateNum >= 85 ? "Excellent turnout" : stats.rateNum >= 70 ? "Steady turnout" : stats.rateNum > 0 ? "Needs attention" : "No records yet"}
              </b>
              {stats.rateNum > 0 ? " today — tracking overall performance." : " — mark today to start tracking."}
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              <div className="py-[13px] px-[6px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[20px] font-extrabold" style={{ color: "#6FFFAA", letterSpacing: "-0.6px" }}>{stats.presentToday}</div>
                <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>Present</div>
              </div>
              <div className="py-[13px] px-[6px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[20px] font-extrabold" style={{ color: "#FF9AA9", letterSpacing: "-0.6px" }}>{stats.absentToday}</div>
                <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>Absent</div>
              </div>
              <div className="py-[13px] px-[6px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[20px] font-extrabold" style={{ color: "#FFD060", letterSpacing: "-0.6px" }}>{stats.lateToday}</div>
                <div className="text-[9px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>Late</div>
              </div>
            </div>
          </div>
        </div>

        {/* Mark today CTA */}
        <div className="px-4 mb-[14px]">
          <button type="button"
            onClick={() => { setMarkingClassId(selectedClassId); setMarking(true); }}
            className="w-full h-[48px] rounded-[14px] flex items-center justify-center gap-[6px] active:scale-[0.98] transition-transform"
            style={{ background: MA.GREEN, color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(0,200,83,0.3), 0 6px 16px rgba(0,200,83,0.35)", fontFamily: MA.FONT }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Mark today's attendance
          </button>
        </div>

        {/* 3 stat cards */}
        <div className="grid grid-cols-3 gap-[10px] px-4 mb-[14px]">
          {([
            { key: "present", color: MA.GREEN, value: stats.presentToday, label: "Present", onClick: () => navigate('/students'),
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><polyline points="17 11 19 13 23 9"/></svg> },
            { key: "absent", color: MA.RED, value: stats.absentToday, label: "Absent", onClick: () => navigate('/risks-alerts'),
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/></svg> },
            { key: "late", color: MA.ORANGE, value: stats.lateToday, label: "Late", onClick: () => navigate('/risks-alerts'),
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
          ] as const).map(s => (
            <button key={s.key} type="button" onClick={s.onClick}
              className="bg-white rounded-[18px] p-[14px] text-center active:scale-[0.96] transition-transform"
              style={{ boxShadow: MA.SH, fontFamily: MA.FONT }}>
              <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white mx-auto mb-[8px]" style={{ background: s.color }}>
                {s.icon}
              </div>
              <div className="text-[24px] font-extrabold leading-none" style={{ color: s.color, letterSpacing: "-0.9px" }}>{s.value}</div>
              <div className="text-[9px] font-extrabold uppercase mt-[5px]" style={{ color: MA.T3, letterSpacing: "1.2px" }}>{s.label}</div>
            </button>
          ))}
        </div>

        {/* Class tabs */}
        {classes.length > 0 && (
          <div className="mx-4 mb-[14px] p-[5px] rounded-[14px] flex gap-[7px]"
            style={{ background: MA.CARD, boxShadow: MA.SH_SM, overflowX: "auto", scrollbarWidth: "none" as const }}>
            {classes.map(cls => {
              const isActive = selectedClassId === cls.id;
              return (
                <button key={cls.id} type="button" onClick={() => setSelectedClassId(cls.id)}
                  className="flex-1 py-[9px] px-[10px] rounded-[10px] text-[12px] font-bold text-center transition-all active:scale-[0.96]"
                  style={{
                    background: isActive ? MA.P : "transparent",
                    color: isActive ? "#fff" : MA.T3,
                    letterSpacing: "-0.2px",
                    fontFamily: MA.FONT,
                    whiteSpace: "nowrap",
                    minWidth: 72,
                    boxShadow: isActive ? "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" : "none",
                  }}>
                  {cls.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Weekly Overview */}
        <div className="mx-4 mb-[14px] p-[16px] rounded-[20px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[10px]">
              <div className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center text-white" style={{ background: MA.P }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div>
                <div className="text-[14px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Weekly Overview</div>
                {activeClass && weeklyDays.length > 0 && (
                  <div className="text-[11px] font-semibold mt-[1px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                    {activeClass.name} · {weeklyDays[0]?.dateLabel} – {weeklyDays[weeklyDays.length - 1]?.dateLabel}
                  </div>
                )}
              </div>
            </div>
            <button type="button" onClick={() => navigate('/reports')}
              className="text-[12px] font-bold flex items-center gap-[2px] active:opacity-70" style={{ color: MA.P }}>
              View all <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
            </button>
          </div>

          <div className="flex gap-[10px] overflow-x-auto pb-1 -mx-[16px] px-[16px]" style={{ scrollbarWidth: "none" as const }}>
            {weeklyDays.map((day, i) => {
              const isPending = day.isToday && !day.hasData && !day.isWeekend;
              const onClickCard = isPending ? () => { setMarkingClassId(selectedClassId); setMarking(true); } : undefined;
              return (
                <div key={i}
                  onClick={onClickCard}
                  role={onClickCard ? "button" : undefined}
                  tabIndex={onClickCard ? 0 : undefined}
                  className={`flex-shrink-0 w-[128px] rounded-[16px] p-[12px] relative overflow-hidden ${onClickCard ? "active:scale-[0.97]" : ""}`}
                  style={{
                    background: day.isToday ? "linear-gradient(145deg, #0957F7 0%, #2970FF 100%)" : MA.SURFACE,
                    boxShadow: day.isToday ? "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.35)" : "none",
                    opacity: day.isFuture ? 0.92 : 1,
                    cursor: onClickCard ? "pointer" : "default",
                    transition: "transform .15s ease",
                  }}>
                  {day.isToday && (
                    <>
                      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 45%)" }} />
                      <div className="absolute top-[10px] right-[10px] text-[8px] font-extrabold px-[7px] py-[3px] rounded-full uppercase"
                        style={{ background: "rgba(255,255,255,0.25)", backdropFilter: "blur(8px)", color: "#fff", border: "0.5px solid rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                        Today
                      </div>
                    </>
                  )}
                  {day.isFuture && (
                    <div className="absolute top-[10px] right-[10px] text-[8px] font-extrabold px-[7px] py-[3px] rounded-full uppercase"
                      style={{ background: "rgba(9,87,247,0.1)", color: MA.P, letterSpacing: "0.5px" }}>
                      Upcoming
                    </div>
                  )}
                  <div className="relative z-[2]">
                    <div className="text-[9px] font-extrabold uppercase" style={{ color: day.isToday ? "rgba(255,255,255,0.8)" : MA.T3, letterSpacing: "1.3px", marginBottom: 3 }}>
                      {day.label}
                    </div>
                    <div className="text-[17px] font-extrabold mb-[10px]" style={{ color: day.isToday ? "#fff" : MA.T1, letterSpacing: "-0.5px" }}>
                      {day.dateLabel}
                    </div>
                    {day.hasData ? (
                      <>
                        <div className="flex flex-col gap-[5px] mb-[10px]">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="font-semibold" style={{ color: day.isToday ? "rgba(255,255,255,0.7)" : MA.T3 }}>Present</span>
                            <span className="font-extrabold" style={{ color: day.isToday ? "#6FFFAA" : MA.GREEN, letterSpacing: "-0.2px" }}>{day.present}</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="font-semibold" style={{ color: day.isToday ? "rgba(255,255,255,0.7)" : MA.T3 }}>Absent</span>
                            <span className="font-extrabold" style={{ color: day.isToday ? "#FF9AA9" : MA.RED, letterSpacing: "-0.2px" }}>{day.absent}</span>
                          </div>
                        </div>
                        <div className="text-[17px] font-extrabold" style={{
                          color: day.isToday ? "#fff" : (parseFloat(day.rate!) >= 85 ? MA.GREEN : parseFloat(day.rate!) >= 70 ? MA.ORANGE : MA.RED),
                          letterSpacing: "-0.5px",
                        }}>{day.rate}</div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-col gap-[5px] mb-[10px]" style={{ minHeight: 50 }} />
                        {isPending ? (
                          <div className="text-[11px] font-bold" style={{ color: MA.P }}>Tap to mark ›</div>
                        ) : (
                          <div className="text-[10px] font-semibold italic" style={{ color: day.isFuture ? MA.P : day.isForgotten ? MA.ORANGE : MA.T4, letterSpacing: "-0.1px" }}>
                            {day.isWeekend ? "Weekend" : day.isFuture ? "Upcoming" : day.isForgotten ? "Not marked" : "—"}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Attendance Concerns */}
        <div className="mx-4 mb-[14px] p-[16px] rounded-[20px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[10px]">
              <div className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center text-white" style={{ background: MA.RED }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 21h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg>
              </div>
              <div>
                <div className="text-[14px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Attendance Concerns</div>
                <div className="text-[11px] font-semibold mt-[1px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                  {concerns.length === 0 ? "No flagged students" : `${concerns.length} student${concerns.length === 1 ? "" : "s"} need follow up`}
                </div>
              </div>
            </div>
            <button type="button" onClick={() => navigate('/risks-alerts')}
              className="text-[12px] font-bold flex items-center gap-[2px] active:opacity-70" style={{ color: MA.P }}>
              View all <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
            </button>
          </div>

          {concerns.length === 0 ? (
            <div className="py-[28px] px-[20px] text-center relative">
              <div className="mx-auto mb-[14px] w-[80px] h-[80px] rounded-[24px] flex items-center justify-center text-white relative"
                style={{
                  background: `linear-gradient(145deg, ${MA.GREEN_B} 0%, ${MA.GREEN} 100%)`,
                  boxShadow: "0 0 0 8px rgba(0,200,83,0.1), 0 0 0 18px rgba(0,200,83,0.05), 0 8px 20px rgba(0,200,83,0.35)",
                }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div className="text-[15px] font-extrabold mb-[4px]" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>All good here ✨</div>
              <div className="text-[12px] font-medium" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                <b className="font-bold" style={{ color: MA.GREEN }}>All students</b> have good attendance
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-[8px]">
              {concerns.map((s, i) => (
                <button key={i} type="button" onClick={() => navigate('/risks-alerts')}
                  className="w-full flex items-center gap-[11px] p-[11px] rounded-[14px] active:scale-[0.98] transition-transform text-left"
                  style={{ background: MA.SURFACE }}>
                  <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center flex-shrink-0 text-white text-[12px] font-extrabold"
                    style={{ background: s.av.color, letterSpacing: "0.3px" }}>
                    {s.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-extrabold truncate" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{s.name}</div>
                    <div className="text-[11px] font-semibold mt-[1px] truncate" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>{s.issue}</div>
                  </div>
                  <span className="px-[10px] py-[4px] rounded-full text-[10px] font-extrabold flex-shrink-0"
                    style={{ background: s.badge.bg, color: s.badge.color, letterSpacing: "0.3px" }}>
                    {s.badge.text}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* AI Intelligence */}
        {(() => {
          const unmarkedCount = weeklyDays.filter(d => d.isForgotten).length;
          const roster = enrollments.filter(e => e.classId === selectedClassId).length;
          const rateLabel = stats.rateNum > 0 ? `${stats.rateNum.toFixed(1)}%` : "—";
          return (
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
                    AI Attendance Intelligence
                  </div>
                  <div className="ml-auto px-[9px] py-[4px] rounded-full text-[9px] font-extrabold"
                    style={{ background: "rgba(123,63,244,0.3)", border: "0.5px solid rgba(155,95,255,0.5)", color: "#DCC8FF", letterSpacing: "0.5px" }}>
                    Live
                  </div>
                </div>
                <div className="text-[13px] leading-[1.6] mb-[14px]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                  {stats.rateNum >= 85 ? (
                    <>Turnout is <strong className="text-white font-bold">strong</strong> with an overall rate of <strong className="text-white font-bold">{rateLabel}</strong>.{unmarkedCount > 0 && <> <strong className="text-white font-bold">{unmarkedCount} day{unmarkedCount === 1 ? "" : "s"}</strong> {unmarkedCount === 1 ? "was" : "were"} unmarked — mark retroactively to improve accuracy.</>}</>
                  ) : stats.rateNum >= 70 ? (
                    <>Turnout is <strong className="text-white font-bold">steady</strong> at <strong className="text-white font-bold">{rateLabel}</strong>. Keep an eye on repeat absences this week.</>
                  ) : stats.rateNum > 0 ? (
                    <>Overall rate of <strong className="text-white font-bold">{rateLabel}</strong> is <strong className="text-white font-bold">below target</strong>. Review concerns and follow up with parents.</>
                  ) : (
                    <>No attendance has been recorded yet. <strong className="text-white font-bold">Tap "Mark today"</strong> to begin tracking turnout for this class.</>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[12px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[17px] font-extrabold" style={{ color: stats.rateNum >= 85 ? "#6FFFAA" : "#fff", letterSpacing: "-0.4px" }}>{rateLabel}</div>
                    <div className="text-[8px] font-extrabold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Rate</div>
                  </div>
                  <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[17px] font-extrabold text-white" style={{ letterSpacing: "-0.4px" }}>
                      {stats.presentToday}{roster > 0 ? `/${roster}` : ""}
                    </div>
                    <div className="text-[8px] font-extrabold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Present</div>
                  </div>
                  <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[17px] font-extrabold text-white" style={{ letterSpacing: "-0.4px" }}>{unmarkedCount}</div>
                    <div className="text-[8px] font-extrabold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Unmarked</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      </div>

      {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
      <div className="hidden md:block">

        {/* ── Header row ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-slate-900 leading-tight tracking-tight">Attendance</h1>
            <p className="text-sm text-slate-500 mt-1">Track and manage student attendance across all classes.</p>
          </div>
          <button type="button"
            onClick={() => { setMarkingClassId(selectedClassId); setMarking(true); }}
            className="h-11 px-5 rounded-lg bg-[#1e3272] text-white text-sm font-semibold hover:bg-[#162552] flex items-center gap-2 shadow-sm transition-colors"
          >
            Mark Today's Attendance
          </button>
        </div>

        {/* ── 4-col Stat cards ───────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div
            onClick={() => navigate('/reports')}
            role="button"
            tabIndex={0}
            className="clickable-card bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.greenL }}>
                <IcoBarChart color={T.green} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.rateStr}</p>
                <p className="text-xs text-slate-500 mt-1.5">Overall Rate</p>
              </div>
            </div>
          </div>
          <div
            onClick={() => navigate('/students')}
            role="button"
            tabIndex={0}
            className="clickable-card bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.blueL }}>
                <IcoUserCheck color={T.blue} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.presentToday}</p>
                <p className="text-xs text-slate-500 mt-1.5">Present Today</p>
              </div>
            </div>
          </div>
          <div
            onClick={() => navigate('/risks-alerts')}
            role="button"
            tabIndex={0}
            className="clickable-card bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.redL }}>
                <IcoUserX color={T.red} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.absentToday}</p>
                <p className="text-xs text-slate-500 mt-1.5">Absent Today</p>
              </div>
            </div>
          </div>
          <div
            onClick={() => navigate('/risks-alerts')}
            role="button"
            tabIndex={0}
            className="clickable-card bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.amberL }}>
                <IcoClock color={T.amber} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.lateToday}</p>
                <p className="text-xs text-slate-500 mt-1.5">Late Today</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Class tabs ─────────────────────────────────────────── */}
        {classes.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {classes.map(cls => (
              <button type="button"
                key={cls.id}
                onClick={() => setSelectedClassId(cls.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedClassId === cls.id
                    ? 'bg-[#1e3272] text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {cls.name}
              </button>
            ))}
          </div>
        )}

        {/* ── Weekly Attendance Overview (horizontal day strip) ─── */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mb-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">Weekly Attendance Overview</h2>
            {activeClass && weeklyDays.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                {activeClass.name} • {weeklyDays[0]?.dateLabel} – {weeklyDays[weeklyDays.length - 1]?.dateLabel}, {new Date().getFullYear()}
              </p>
            )}
          </div>

          <div className="grid grid-cols-4 lg:grid-cols-8 gap-3">
            {weeklyDays.map((day, i) => {
              const isPending = day.isToday && !day.hasData && !day.isWeekend;
              return (
                <div
                  key={i}
                  className={`rounded-xl p-3 ${isPending ? 'border-2' : 'border'}`}
                  style={{
                    borderColor: isPending ? T.amber : T.bdr,
                    background: isPending ? '#FFFBEB' : '#fff',
                    opacity: day.isFuture || day.isWeekend ? 0.5 : 1,
                  }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.ink2 }}>{day.label}</p>
                  <p className="text-base font-bold mt-0.5" style={{ color: T.ink0 }}>{day.dateLabel}</p>
                  {day.hasData ? (
                    <>
                      <div className="flex items-center justify-between text-[11px] mt-2">
                        <span style={{ color: T.ink2 }}>Present</span>
                        <span className="font-bold" style={{ color: T.green2 }}>{day.present}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] mt-1">
                        <span style={{ color: T.ink2 }}>Absent</span>
                        <span className="font-bold" style={{ color: T.red }}>{day.absent}</span>
                      </div>
                      <p className="text-sm font-bold mt-2" style={{ color: parseFloat(day.rate!) >= 85 ? T.green : T.amber }}>
                        {day.rate}
                      </p>
                    </>
                  ) : isPending ? (
                    <>
                      <div className="flex items-center justify-between text-[11px] mt-2">
                        <span style={{ color: T.ink2 }}>Present</span>
                        <span style={{ color: T.ink2 }}>—</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] mt-1">
                        <span style={{ color: T.ink2 }}>Absent</span>
                        <span style={{ color: T.ink2 }}>—</span>
                      </div>
                      <button type="button"
                        onClick={() => { setMarkingClassId(selectedClassId); setMarking(true); }}
                        className="mt-2 w-full py-1.5 rounded-md text-[11px] font-semibold text-white"
                        style={{ background: T.blue }}
                      >
                        Mark Now
                      </button>
                    </>
                  ) : (
                    <p className="text-[11px] mt-2" style={{ color: T.ink2 }}>
                      {day.isWeekend ? 'Weekend' : day.isFuture ? 'Upcoming' : day.isForgotten ? 'Not marked' : '—'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Attendance Concerns ────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-900">Attendance Concerns</h2>
            <button type="button" className="text-xs font-medium text-blue-600 hover:text-blue-700">View All</button>
          </div>

          {concerns.length === 0 ? (
            <div className="py-10 text-center">
              <div className="inline-flex w-12 h-12 rounded-xl items-center justify-center mb-2" style={{ background: T.greenL }}>
                <IcoCheck color={T.green} size={18} />
              </div>
              <p className="text-sm" style={{ color: T.ink2 }}>All students have good attendance</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {concerns.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: s.badge.bg }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0"
                    style={{ background: s.av.color, color: '#fff' }}
                  >
                    {s.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: T.ink0 }}>{s.name}</p>
                    <p className="text-[11px] truncate mt-0.5" style={{ color: s.badge.color }}>{s.issue}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default Attendance;