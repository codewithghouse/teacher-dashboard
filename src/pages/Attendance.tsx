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

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF',
  green: '#087F5B', green2: '#2F9E44', greenL: '#EBFBEE',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  teal: '#0C8599', tealL: '#E3FAFC',
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
const IcoAlert = ({ color = T.red }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 1.5L13 12.5H1L7 1.5z"/>
    <line x1="7" y1="5.5" x2="7" y2="8.5"/>
    <circle cx="7" cy="10.2" r=".5" fill={color} stroke="none"/>
  </svg>
);
const IcoCalendar = ({ color = T.blue }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="2" width="11" height="10.5" rx="1.5"/>
    <line x1="4" y1="1" x2="4" y2="3.5"/><line x1="10" y1="1" x2="10" y2="3.5"/>
    <line x1="1.5" y1="5.5" x2="12.5" y2="5.5"/>
  </svg>
);

// ── Tiny components ───────────────────────────────────────────────────────────
const Badge = ({ text, bg, color }: { text: string; bg: string; color: string }) => (
  <span style={{ background: bg, color, borderRadius: 20, padding: '3px 8px', fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap' as const }}>
    {text}
  </span>
);
const IBox = ({ bg, children }: { bg: string; children: React.ReactNode }) => (
  <div style={{ width: 28, height: 28, background: bg, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    {children}
  </div>
);
const MetricCard = ({ iconBg, icon, badgeText, badgeBg, badgeColor, value, valueColor, label, barBg, barFill, barPct, onClick }: any) => (
  <div
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    className={onClick ? "clickable-card" : undefined}
    style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, padding: 13 }}
  >
    <div className="flex items-start justify-between mb-2">
      <div style={{ width: 30, height: 30, background: iconBg, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </div>
      <Badge text={badgeText} bg={badgeBg} color={badgeColor} />
    </div>
    <p style={{ fontSize: 20, fontWeight: 500, color: valueColor, letterSpacing: '-0.5px', lineHeight: 1 }}>{value}</p>
    <p style={{ fontSize: 11, color: T.ink2, marginTop: 3 }}>{label}</p>
    <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: barBg, overflow: 'hidden' }}>
      <div style={{ height: '100%', borderRadius: 2, background: barFill, width: `${barPct}%`, transition: 'width .5s ease' }} />
    </div>
  </div>
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
  const [logDate, setLogDate]               = useState(new Date().toLocaleDateString("en-CA"));
  const [logClassId, setLogClassId]         = useState("");

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
        setLogClassId(p => p || cls[0]?.id || "");
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

  // Week summary
  const weekSummary = useMemo(() => {
    const ws = new Date(); ws.setDate(ws.getDate() - ws.getDay() + 1);
    const wStr = ws.toLocaleDateString("en-CA");
    const wr = records.filter(r => r.date >= wStr && r.classId === logClassId);
    const p  = wr.filter(r => r.status === "present" || r.status === "late").length;
    return {
      present: wr.filter(r => r.status === "present").length,
      absent:  wr.filter(r => r.status === "absent").length,
      rate:    wr.length > 0 ? `${((p / wr.length) * 100).toFixed(1)}%` : "—",
    };
  }, [records, logClassId]);

  const logRoster    = enrollments.filter(e => e.classId === logClassId);
  const activeClass  = classes.find(c => c.id === selectedClassId);

  if (marking) return <MarkAttendance initialClassId={markingClassId || selectedClassId} onBack={() => setMarking(false)} />;

  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: T.blue }} />
    </div>
  );

  return (
    <div style={{ fontFamily: 'inherit' }} className="text-left pb-8">

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <div className="md:hidden">

      {/* ── Dark Hero ──────────────────────────────────────────────────────────── */}
      <div className="-mx-4 sm:-mx-6 px-[22px] pb-7 bg-[#162E93] md:bg-[#08090C]">
        <div className="pt-2 mb-5">
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', lineHeight: 1.2, marginBottom: 4 }}>
            Attendance
          </h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', fontWeight: 400 }}>
            Track and manage student attendance.
          </p>
        </div>
        <button
          onClick={() => { setMarkingClassId(selectedClassId); setMarking(true); }}
          style={{
            width: '100%', padding: 13, borderRadius: 13, background: T.blue,
            border: 'none', color: '#fff', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            fontFamily: 'inherit',
          }}
        >
          <IcoCheck color="#fff" size={14} />
          Mark today's attendance
        </button>
      </div>

      {/* ── Metric Cards (2×2) ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-[9px] pt-4 pb-1">
        <MetricCard
          iconBg={T.blueL} icon={<IcoBarChart color={T.blue} />}
          badgeText={stats.rateNum >= 85 ? "Healthy" : stats.rateNum >= 70 ? "Watch" : "Low"}
          badgeBg={stats.rateNum >= 85 ? T.greenL : stats.rateNum >= 70 ? T.amberL : T.redL}
          badgeColor={stats.rateNum >= 85 ? T.green : stats.rateNum >= 70 ? T.amber : T.red}
          value={stats.rateStr} valueColor={T.blue} label="Overall rate"
          barBg={T.blueL} barFill={T.blue} barPct={Math.min(stats.rateNum, 100)}
          onClick={() => navigate('/reports')}
        />
        <MetricCard
          iconBg={T.greenL} icon={<IcoUserCheck color={T.green} />}
          badgeText="Today" badgeBg={T.blueL} badgeColor={T.blue}
          value={stats.presentToday} valueColor={T.green2} label="Present today"
          barBg={T.greenL} barFill={T.green2} barPct={stats.presentToday > 0 ? 100 : 0}
          onClick={() => navigate('/students')}
        />
        <MetricCard
          iconBg={T.redL} icon={<IcoUserX color={T.red} />}
          badgeText={stats.absentToday > 0 ? "Check" : "Secure"} badgeBg={T.greenL} badgeColor={T.green}
          value={stats.absentToday} valueColor={T.ink0} label="Absent today"
          barBg={T.redL} barFill={T.red} barPct={stats.absentToday > 0 ? 100 : 0}
          onClick={() => navigate('/risks-alerts')}
        />
        <MetricCard
          iconBg={T.amberL} icon={<IcoClock color={T.amber} />}
          badgeText={stats.lateToday > 0 ? "Follow up" : "All clear"} badgeBg={T.greenL} badgeColor={T.green}
          value={stats.lateToday} valueColor={T.ink0} label="Late today"
          barBg={T.amberL} barFill={T.amber} barPct={stats.lateToday > 0 ? 100 : 0}
          onClick={() => navigate('/risks-alerts')}
        />
      </div>

      {/* ── Class Tabs ──────────────────────────────────────────────────────────── */}
      {classes.length > 0 && (
        <div className="flex flex-wrap gap-[7px] py-4">
          {classes.map(cls => (
            <button key={cls.id} onClick={() => setSelectedClassId(cls.id)}
              style={{
                padding: '7px 16px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                fontWeight: selectedClassId === cls.id ? 500 : 400, fontFamily: 'inherit',
                background: selectedClassId === cls.id ? T.ink0 : T.s0,
                color:      selectedClassId === cls.id ? '#fff'  : T.ink1,
                border: `1px solid ${selectedClassId === cls.id ? T.ink0 : T.bdr}`,
                whiteSpace: 'nowrap' as const,
              }}
            >{cls.name}</button>
          ))}
        </div>
      )}

      {/* ── Weekly Overview ─────────────────────────────────────────────────────── */}
      <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, marginBottom: 12, overflow: 'hidden' }}>
        <div style={{ padding: '13px 14px 10px', borderBottom: `1px solid ${T.s2}` }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: T.ink0 }}>Weekly overview</p>
          {activeClass && weeklyDays.length > 0 && (
            <p style={{ fontSize: 10, color: T.ink2, marginTop: 2 }}>
              {activeClass.name} · {weeklyDays[0]?.dateLabel} – {weeklyDays[weeklyDays.length - 1]?.dateLabel}, {new Date().getFullYear()}
            </p>
          )}
        </div>

        {weeklyDays.map((day, i) => {
          const statusText =
            day.hasData ? day.rate! :
            day.isWeekend ? "Weekend" :
            day.isFuture ? "Upcoming" :
            day.isForgotten ? "Not marked" : "—";
          const statusColor =
            day.hasData ? (parseFloat(day.rate!) >= 85 ? T.green : T.amber) :
            day.isForgotten ? T.amber : T.ink2;

          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              borderBottom: i < weeklyDays.length - 1 ? `1px solid ${T.s2}` : 'none',
              background: day.isToday ? '#FAFBFF' : 'transparent',
              opacity: day.isFuture ? 0.5 : 1,
            }}>
              {/* Day label */}
              <div style={{ width: 36, flexShrink: 0 }}>
                <p style={{ fontSize: 9, fontWeight: 500, color: day.isToday ? T.blue : T.ink2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {day.label}
                </p>
                <p style={{ fontSize: 13, fontWeight: 500, color: day.isToday ? T.blue : T.ink0 }}>
                  {day.dateLabel}
                </p>
              </div>

              {/* Dots */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                {day.hasData ? (
                  <>
                    {Array.from({ length: Math.min(day.present, 4) }).map((_, j) => (
                      <div key={`p${j}`} style={{ width: 7, height: 7, borderRadius: '50%', background: T.green2 }} />
                    ))}
                    {day.present > 0 && <span style={{ fontSize: 10, color: T.ink2, marginLeft: 2 }}>{day.present}P</span>}
                    {Array.from({ length: Math.min(day.absent, 4) }).map((_, j) => (
                      <div key={`a${j}`} style={{ width: 7, height: 7, borderRadius: '50%', background: T.red }} />
                    ))}
                    {day.absent > 0 && <span style={{ fontSize: 10, color: T.ink2 }}>{day.absent}A</span>}
                  </>
                ) : (
                  <>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: T.s2 }} />
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: T.s2 }} />
                    <div style={{ width: 12, height: 1.5, background: T.s2, borderRadius: 1 }} />
                  </>
                )}
              </div>

              {/* Status / Mark CTA */}
              {day.isToday && !day.hasData && !day.isWeekend ? (
                <button onClick={() => { setMarkingClassId(selectedClassId); setMarking(true); }}
                  style={{
                    padding: '5px 10px', borderRadius: 8, background: T.blue,
                    border: 'none', color: '#fff', fontSize: 11, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>Mark</button>
              ) : (
                <p style={{ fontSize: 11, fontWeight: 500, color: statusColor, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                  {statusText}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Attendance Concerns ─────────────────────────────────────────────────── */}
      <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, marginBottom: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', borderBottom: `1px solid ${T.s2}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IBox bg={T.redL}><IcoAlert color={T.red} /></IBox>
            <span style={{ fontSize: 14, fontWeight: 500, color: T.ink0 }}>Attendance concerns</span>
          </div>
          <span style={{ fontSize: 12, color: T.blue, cursor: 'pointer' }}>View all</span>
        </div>

        {concerns.length === 0 ? (
          <div style={{ padding: '24px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: T.greenL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IcoCheck color={T.green} size={16} />
            </div>
            <p style={{ fontSize: 12, color: T.ink2, textAlign: 'center' }}>All students have good attendance</p>
            <Badge text="All clear" bg={T.greenL} color={T.green} />
          </div>
        ) : (
          concerns.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
              borderTop: i > 0 ? `1px solid ${T.s2}` : 'none',
            }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: s.av.bg, color: s.av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
                {s.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: T.ink0 }}>{s.name}</p>
                <p style={{ fontSize: 11, color: T.ink2, marginTop: 1 }}>{s.issue}</p>
              </div>
              <Badge text={s.badge.text} bg={s.badge.bg} color={s.badge.color} />
            </div>
          ))
        )}
      </div>

      {/* ── Attendance Log ──────────────────────────────────────────────────────── */}
      <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, marginBottom: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 14px', borderBottom: `1px solid ${T.s2}` }}>
          <IBox bg={T.blueL}><IcoCalendar color={T.blue} /></IBox>
          <span style={{ fontSize: 14, fontWeight: 500, color: T.ink0 }}>Attendance log</span>
        </div>

        {/* Filters */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${T.s2}` }}>
          <select value={logClassId} onChange={e => setLogClassId(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.s1, fontSize: 12, color: T.ink1, fontFamily: 'inherit', outline: 'none', cursor: 'pointer', appearance: 'none' as const }}>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.s1, fontSize: 12, color: T.ink1, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }} />
        </div>

        {/* Column headers */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: T.s1 }}>
          {['Student','Status'].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>{h}</span>
          ))}
        </div>

        {/* Rows */}
        {logRoster.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: T.ink2 }}>No students enrolled in this class</div>
        ) : (
          logRoster.map((s: any) => {
            const log = records.find(r => r.studentId === s.studentId && r.date === logDate && r.classId === logClassId);
            const status = log?.status || "unmarked";
            const bdg =
              status === "present"  ? { text: "Present",  bg: T.greenL, color: T.green } :
              status === "absent"   ? { text: "Absent",   bg: T.redL,   color: T.red   } :
              status === "late"     ? { text: "Late",     bg: T.amberL, color: T.amber } :
                                      { text: "—",        bg: T.s2,     color: T.ink2  };
            const av = avStyle(s.studentName || "");
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderTop: `1px solid ${T.s2}` }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: av.bg, color: av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
                  {getInitials(s.studentName)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: T.ink0 }}>{s.studentName}</p>
                  <p style={{ fontSize: 10, color: T.ink2, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.studentEmail}</p>
                </div>
                <Badge text={bdg.text} bg={bdg.bg} color={bdg.color} />
              </div>
            );
          })
        )}
      </div>

      {/* ── Week Summary ────────────────────────────────────────────────────────── */}
      <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, padding: 14, marginBottom: 8 }}>
        <p style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
          This week summary
        </p>
        {[
          { dot: T.green2, label: 'Total present', value: weekSummary.present, color: T.green  },
          { dot: T.red,    label: 'Total absent',  value: weekSummary.absent,  color: T.red    },
          { dot: T.amber,  label: 'Avg. rate',     value: weekSummary.rate,    color: T.blue   },
        ].map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 2 ? `1px solid ${T.s2}` : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: T.ink1 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: row.dot }} />
              {row.label}
            </div>
            <span style={{ fontSize: 13, fontWeight: 500, color: row.color }}>{row.value}</span>
          </div>
        ))}
      </div>

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
      <div className="hidden md:block">

        {/* ── Header row ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-slate-900 leading-tight tracking-tight">Attendance</h1>
            <p className="text-sm text-slate-500 mt-1">Track and manage student attendance across all classes.</p>
          </div>
          <button
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
              <button
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
                      <button
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
            <button className="text-xs font-medium text-blue-600 hover:text-blue-700">View All</button>
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