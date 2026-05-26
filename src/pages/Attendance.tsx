import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MarkAttendance from "@/components/MarkAttendance";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  type QueryConstraint, type DocumentData,
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { getInitials } from "../lib/initials";
import { Loader2, CalendarDays } from "lucide-react";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";
import { subscribeSchoolHolidays, type SchoolHoliday } from "../lib/schoolHolidays";

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
  FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  CARD: "#FFFFFF",
  SURFACE: "#F4F7FE",
  P: "#0055FF", PD: "#0044CC",
  T1: "#001040", T3: "#5070B0", T4: "#99AACC",
  GREEN: "#00C853", GREEN_B: "#00E866",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
  SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
  BDR: "0.5px solid rgba(0,85,255,0.07)",
  HERO_GRAD: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
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
// localStorage key — selectedClassId persistence per-teacher (multi-class
// teachers shouldn't lose context on refresh).
const SELECTED_CLASS_KEY = (teacherId: string) => `teacher_attendance_selected_class:${teacherId}`;

const Attendance = () => {
  const { teacherData } = useAuth();
  const navigate = useNavigate();

  const [marking, setMarking]               = useState(false);
  const [markingClassId, setMarkingClassId] = useState<string>("");
  // Split loading flags — page renders as soon as classes are ready; records
  // stream in without flipping the page back to a full loader (prevents the
  // flicker that happens when classes.length changes mid-session).
  const [classesLoading, setClassesLoading] = useState(true);
  const [classes, setClasses]               = useState<ClassDoc[]>([]);
  const [enrollments, setEnrollments]       = useState<EnrollmentDoc[]>([]);
  const [records, setRecords]               = useState<AttendanceRecord[]>([]);
  const [schoolHolidays, setSchoolHolidays] = useState<SchoolHoliday[]>([]);
  // Bumped after MarkAttendance saves — forces the records onSnapshot to
  // tear down and re-subscribe so we never display stale "not marked" state
  // while waiting for a snapshot fire to land.
  const [refreshKey, setRefreshKey]         = useState(0);
  // Hydrate selectedClassId from localStorage on mount; empty when no teacher
  // (gets resolved in the classes effect once we know who's signed in).
  const [selectedClassId, setSelectedClassId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem("teacher_attendance_selected_class") || ""; }
    catch { return ""; }
  });

  // Persist selectedClassId on every change (per-teacher key once teacher
  // resolves, plus a generic key as fallback during initial mount).
  useEffect(() => {
    if (!selectedClassId) return;
    try {
      localStorage.setItem("teacher_attendance_selected_class", selectedClassId);
      if (teacherData?.id) {
        localStorage.setItem(SELECTED_CLASS_KEY(teacherData.id), selectedClassId);
      }
    } catch { /* localStorage may be disabled — silent fail is fine */ }
  }, [selectedClassId, teacherData?.id]);

  // 1. Classes — UNION pattern matching MyClasses / CreateTest fix.
  // Read teacher's classes from BOTH:
  //   (a) teaching_assignments where teacherId == tId  → modern canonical
  //   (b) classes.teacherId == tId                     → legacy homeroom field
  // Single-source `classes.teacherId` previously missed any class the teacher
  // was assigned to via teaching_assignments only → a freshly onboarded
  // teacher saw zero classes in Attendance even though MyClasses showed the
  // class correctly. Memory: bug_pattern_teacher_class_pickers_single_source.
  // Drops the branchId filter on classes (not all class docs carry branchId).
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    const teacherId = teacherData.id;

    let assignedIds = new Set<string>();
    let legacyOwnedIds = new Set<string>();
    let allClassDocs: ClassDoc[] = [];

    const recompute = () => {
      const allowed = new Set<string>([...assignedIds, ...legacyOwnedIds]);
      const cls = allowed.size === 0 ? [] : allClassDocs.filter(c => allowed.has(c.id));
      setClasses(cls);
      setSelectedClassId(prev => {
        let pref = prev;
        if (!pref) {
          try {
            pref = localStorage.getItem(SELECTED_CLASS_KEY(teacherId)) ||
                   localStorage.getItem("teacher_attendance_selected_class") || "";
          } catch { /* noop */ }
        }
        if (pref && cls.some(c => c.id === pref)) return pref;
        return cls[0]?.id || "";
      });
      setClassesLoading(false);
    };

    // (a) teaching_assignments — active-only filter applied client-side
    const uTa = onSnapshot(
      query(collection(db, "teaching_assignments"), where("schoolId", "==", schoolId), where("teacherId", "==", teacherId)),
      (snap) => {
        const active = snap.docs.filter(d => {
          const s = (d.data() as { status?: unknown }).status;
          return !s || (typeof s === "string" && s.toLowerCase() === "active");
        });
        assignedIds = new Set(active.map(d => (d.data() as { classId?: string }).classId).filter((x): x is string => !!x));
        recompute();
      },
      (err) => console.warn("[Attendance/teaching_assignments]", err.code),
    );

    // (b) classes.teacherId — legacy denormalized primary teacher
    const uLegacy = onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId), where("teacherId", "==", teacherId)),
      (snap) => { legacyOwnedIds = new Set(snap.docs.map(d => d.id)); recompute(); },
      (err) => console.warn("[Attendance/classes-legacy]", err.code),
    );

    // (c) all school classes — resolves metadata for assigned-but-not-owned classes
    const uAll = onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId)),
      (snap) => {
        allClassDocs = snap.docs.map(d => ({ ...d.data(), id: d.id } as ClassDoc));
        recompute();
      },
      (err) => console.warn("[Attendance/classes-all]", err.code),
    );

    return () => { uTa(); uLegacy(); uAll(); };
  }, [teacherData?.id, teacherData?.schoolId]);

  // School-wide holidays (principal-declared) — banner + future calendar.
  useEffect(() => {
    if (!teacherData?.schoolId) return;
    const unsub = subscribeSchoolHolidays(
      teacherData.schoolId,
      (rows) => setSchoolHolidays(rows),
      (err) => console.error("[teacher/Attendance] school_holidays:", err),
    );
    return () => unsub();
  }, [teacherData?.schoolId]);
  const todaySchoolHoliday = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA");
    return schoolHolidays.find(h => h.date === today) || null;
  }, [schoolHolidays]);

  // 2. Enrollments — live listener (was one-shot getDocs, which missed
  // mid-session enrollment changes). Per-class onSnapshot with a Map-based
  // accumulator keyed by classId so a single class update only replaces its
  // own slice.
  useEffect(() => {
    if (!classes.length || !teacherData?.schoolId) { setEnrollments([]); return; }
    const schoolId = teacherData.schoolId;
    const byClass = new Map<string, EnrollmentDoc[]>();
    const flush = () => {
      const all: EnrollmentDoc[] = [];
      byClass.forEach(rows => rows.forEach(r => all.push(r)));
      setEnrollments(all);
    };
    const unsubs = classes.map(c => onSnapshot(
      query(
        collection(db, "enrollments"),
        where("schoolId", "==", schoolId),
        where("classId", "==", c.id),
      ),
      snap => {
        byClass.set(c.id, snap.docs.map(d => ({ ...d.data(), id: d.id })));
        flush();
      },
      err => console.warn("[Attendance/enrollments]", c.id, err.code),
    ));
    return () => unsubs.forEach(u => u());
  }, [classes, teacherData?.schoolId]);

  // 3. Attendance records — read by classId (NOT teacherId). The previous
  // `where teacherId == X` was a single-source read on a denormalized field
  // that's set by the WRITER (whoever marked attendance), not refreshed when
  // class teachers change. A fresh teacher inheriting an existing class saw
  // historical attendance disappear, and their own marks sometimes never
  // populated the cards if the auditedSet wrote with a different teacher ref.
  // Canonical join: attendance.classId → class.id. Memory:
  // bug_pattern_branch_filter_on_event_streams + bug_pattern_teacher_class_pickers_single_source.
  // NEVER branchId on event streams (silent killer during inference-lag).
  // Chunked `in` queries because Firestore caps `in` to 10 values per query.
  useEffect(() => {
    if (!teacherData?.schoolId || !classes.length) { setRecords([]); return; }
    const schoolId = teacherData.schoolId;
    const classIds = Array.from(new Set(classes.map(c => c.id).filter(Boolean)));
    if (!classIds.length) { setRecords([]); return; }

    const chunks: string[][] = [];
    for (let i = 0; i < classIds.length; i += 10) chunks.push(classIds.slice(i, i + 10));

    const chunkBuckets: AttendanceRecord[][] = chunks.map(() => []);
    const flush = () => {
      const seen = new Set<string>();
      const merged: AttendanceRecord[] = [];
      chunkBuckets.flat().forEach(r => {
        if (seen.has(r.id)) return;
        seen.add(r.id);
        merged.push(r);
      });
      setRecords(merged);
    };

    const unsubs = chunks.map((chunk, idx) =>
      onSnapshot(
        query(
          collection(db, "attendance"),
          where("schoolId", "==", schoolId),
          where("classId", "in", chunk),
        ),
        (snap) => {
          chunkBuckets[idx] = snap.docs.map(d => ({ ...d.data(), id: d.id } as AttendanceRecord));
          flush();
        },
        (err) => console.warn("[Attendance/records]", err.code),
      )
    );

    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherData?.schoolId, classes, refreshKey]);

  const loading = classesLoading;

  const todayStr = todayISO();

  // Defensive class match — primary check is classId === selectedClassId, but
  // also accept className === selectedClass.name as a fallback so legacy
  // records (imported from Excel uploads or written by older code paths that
  // stored only className) still match. Without this fallback, a teacher
  // could mark attendance, see the success toast, and the day card would
  // still show "Not marked" because the historical/imported records used a
  // different identifier shape.
  const selectedClass = classes.find(c => c.id === selectedClassId);
  const recordMatchesSelectedClass = (r: AttendanceRecord) => {
    if (!selectedClassId) return false;
    if (r.classId === selectedClassId) return true;
    if (selectedClass && (r as { className?: string }).className === selectedClass.name) return true;
    return false;
  };

  // Stats — hero rate is now scoped to TODAY + selectedClassId so the
  // "Today · {className}" header is honest. Cumulative all-time rate was
  // misleading. Includes a separate `hasAnyRecord` flag so genuine 0% turnout
  // (everyone absent today) renders as "0.0%" instead of "No data".
  const stats = useMemo(() => {
    // Exclude holiday-status records — whole-class declared off-days don't
    // belong in the rate.
    const todayRec = records.filter(r => r.date === todayStr && r.status !== "holiday" && (!selectedClassId || recordMatchesSelectedClass(r)));
    const presentToday = todayRec.filter(r => r.status === "present").length;
    const absentToday  = todayRec.filter(r => r.status === "absent").length;
    const lateToday    = todayRec.filter(r => r.status === "late").length;
    const totalToday   = todayRec.length;
    const rate = totalToday > 0 ? ((presentToday + lateToday) / totalToday) * 100 : 0;
    return {
      rateNum: Number(rate.toFixed(1)),
      hasAnyRecord: totalToday > 0,
      presentToday, absentToday, lateToday,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, todayStr, selectedClassId, selectedClass?.name]);

  // Weekly days — 5 cards (2 past + today + 2 upcoming) so the entire row
  // fits on screen without horizontal scrolling. Used to be 8 cards which
  // forced a swipe interaction users disliked, and pushed today's card off
  // the visible area into a horizontal scroll region.
  const weeklyDays = useMemo(() => {
    const todayDate = new Date(); todayDate.setHours(0,0,0,0);
    const makeDay = (d: Date, isFuture = false) => {
      const dateStr = d.toLocaleDateString("en-CA");
      const dayRecs = records.filter(r => r.date === dateStr && r.status !== "holiday" && recordMatchesSelectedClass(r));
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
    while (past.length < 2) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, enrollments, selectedClassId, todayStr, selectedClass?.name]);

  // Concerns — month-to-date, scoped to the currently-selected class. Used to
  // be teacher-wide which conflicted with the visual context (panel sits
  // beside the class-tabbed Weekly Overview).
  const concerns = useMemo(() => {
    const ms = todayStr.slice(0, 7);
    const map: Record<string, { name: string; absent: number; late: number }> = {};
    records
      .filter(r => r.date?.startsWith(ms) && (!selectedClassId || recordMatchesSelectedClass(r)))
      .forEach(r => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, todayStr, selectedClassId, selectedClass?.name]);

  const activeClass  = selectedClass;

  // Sync selectedClassId from MarkAttendance — if the user switched classes
  // inside that screen and saved a different one, Attendance must reflect
  // that, otherwise the day card for the original class would still show
  // "Tap to mark" even though the OTHER class was just marked.
  // Also bump refreshKey so the records onSnapshot re-subscribes — guards
  // against the rare case where the live snapshot hasn't yet observed our
  // own write, leaving the day card stuck on "Not marked" / "Tap to mark"
  // even though the data exists in Firestore.
  if (marking) return <MarkAttendance
    initialClassId={markingClassId || selectedClassId}
    onBack={(savedClassId) => {
      setMarking(false);
      if (savedClassId) {
        if (savedClassId !== selectedClassId) {
          setSelectedClassId(savedClassId);
        }
        setRefreshKey(k => k + 1);
      }
    }}
  />;

  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: T.blue }} />
    </div>
  );

  return (
    <div style={{ fontFamily: 'inherit' }} className="text-left pb-8">

      {/* ═══════════════════ MOBILE VIEW (EduIntellect v2) ═══════════════════ */}
      <div className="md:hidden -mt-0" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "0 -16px", paddingBottom: 8 }}>

        {/* School holiday banner — principal-declared, top of page */}
        {todaySchoolHoliday && (
          <div
            role="alert"
            className="mx-4 mt-3 mb-1 rounded-[16px] px-[14px] py-[12px] flex items-start gap-[10px]"
            style={{
              background: "linear-gradient(135deg, #7B3FF4 0%, #9B6FFF 100%)",
              boxShadow: "0 6px 18px rgba(123,63,244,0.32)",
            }}
          >
            <CalendarDays className="w-[18px] h-[18px] text-white shrink-0 mt-[1px]" strokeWidth={2.3} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.16em" }}>
                School Holiday Today
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff", marginTop: 2, letterSpacing: "-0.2px" }}>
                {todaySchoolHoliday.reason || "Declared holiday"}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.82)", marginTop: 3, lineHeight: 1.45 }}>
                No attendance marking needed.{todaySchoolHoliday.declaredByName ? ` Declared by ${todaySchoolHoliday.declaredByName}.` : ""}
              </div>
            </div>
          </div>
        )}

        {/* Page header */}
        <div className="px-4 pt-3 pb-[14px]">
          <div className="flex items-center gap-[7px] text-[9px] font-bold uppercase mb-[6px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
            <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: MA.P }} />
            Teacher Dashboard · Attendance
          </div>
          <h1 className="text-[28px] font-bold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.1px" }}>
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
                <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Overall Rate</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Today · {activeClass?.name || "All classes"}</div>
              </div>
              <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-bold"
                style={{
                  background: !stats.hasAnyRecord ? "rgba(255,255,255,0.14)" : stats.rateNum >= 85 ? "rgba(0,232,102,0.18)" : stats.rateNum >= 70 ? "rgba(255,170,0,0.22)" : "rgba(255,51,85,0.18)",
                  border: `0.5px solid ${!stats.hasAnyRecord ? "rgba(255,255,255,0.22)" : stats.rateNum >= 85 ? "rgba(0,232,102,0.5)" : stats.rateNum >= 70 ? "rgba(255,170,0,0.5)" : "rgba(255,51,85,0.5)"}`,
                  color: !stats.hasAnyRecord ? "rgba(255,255,255,0.72)" : stats.rateNum >= 85 ? "#6FFFAA" : stats.rateNum >= 70 ? "#FFD166" : "#FF99AA",
                  letterSpacing: "0.3px",
                }}>
                <span className="w-[6px] h-[6px] rounded-full" style={{
                  background: !stats.hasAnyRecord ? "#fff" : stats.rateNum >= 85 ? "#00FF88" : stats.rateNum >= 70 ? "#FFCC22" : "#FF5577",
                  boxShadow: `0 0 8px ${!stats.hasAnyRecord ? "#fff" : stats.rateNum >= 85 ? "#00FF88" : stats.rateNum >= 70 ? "#FFCC22" : "#FF5577"}`,
                }} />
                {!stats.hasAnyRecord ? "No data" : stats.rateNum >= 85 ? "On Track" : stats.rateNum >= 70 ? "Watch" : "Low"}
              </div>
            </div>
            <div className="text-[56px] font-bold text-white leading-none mb-[8px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-2.6px" }}>
              {stats.hasAnyRecord ? stats.rateNum.toFixed(1) : "—"}
              {stats.hasAnyRecord && <span className="text-[28px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-0.8px" }}>%</span>}
            </div>
            <div className="text-[13px] font-medium mb-[20px]" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
              <b className="text-white font-bold">
                {!stats.hasAnyRecord ? "No records yet" : stats.rateNum >= 85 ? "Excellent turnout" : stats.rateNum >= 70 ? "Steady turnout" : stats.rateNum > 0 ? "Needs attention" : "Critical turnout"}
              </b>
              {stats.hasAnyRecord ? " today — tracking class performance." : " — mark today to start tracking."}
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              <div className="py-[13px] px-[6px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[20px] font-bold" style={{ color: "#6FFFAA", letterSpacing: "-0.6px" }}>{stats.presentToday}</div>
                <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>Present</div>
              </div>
              <div className="py-[13px] px-[6px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[20px] font-bold" style={{ color: "#FF9AA9", letterSpacing: "-0.6px" }}>{stats.absentToday}</div>
                <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>Absent</div>
              </div>
              <div className="py-[13px] px-[6px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[20px] font-bold" style={{ color: "#FFD060", letterSpacing: "-0.6px" }}>{stats.lateToday}</div>
                <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>Late</div>
              </div>
            </div>
          </div>
        </div>

        {/* Mark today CTA */}
        <div className="px-4 mb-[14px]">
          <button type="button"
            onClick={() => { setMarkingClassId(selectedClassId); setMarking(true); }}
            className="w-full h-[48px] rounded-[14px] flex items-center justify-center gap-[6px] active:scale-[0.98] transition-transform"
            style={{ background: MA.GREEN, color: "#fff", fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px", fontFamily: MA.FONT }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            {stats.hasAnyRecord ? "Edit today's attendance" : "Mark today's attendance"}
          </button>
        </div>

        {/* 3 stat cards */}
        <div className="grid grid-cols-3 gap-[10px] px-4 mb-[14px]">
          {([
            { key: "present", color: MA.GREEN, value: stats.presentToday, label: "Present", onClick: () => navigate('/students'),
              tintBg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)", tintBorder: "rgba(0,200,83,0.16)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><polyline points="17 11 19 13 23 9"/></svg>,
              decor: <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><polyline points="17 11 19 13 23 9"/></svg> },
            { key: "absent", color: MA.RED, value: stats.absentToday, label: "Absent", onClick: () => navigate('/risks-alerts'),
              tintBg: "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)", tintBorder: "rgba(255,51,85,0.14)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/></svg>,
              decor: <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/></svg> },
            { key: "late", color: MA.ORANGE, value: stats.lateToday, label: "Late", onClick: () => navigate('/risks-alerts'),
              tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)", tintBorder: "rgba(255,136,0,0.14)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
              decor: <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
          ] as const).map(s => (
            <button key={s.key} type="button" onClick={s.onClick}
              {...tilt3D}
              className="rounded-[18px] p-[14px] text-left relative overflow-hidden active:scale-[0.96] transition-transform"
              style={{ background: s.tintBg, boxShadow: "0 6px 18px rgba(20,40,90,0.05), 0 1px 3px rgba(20,40,90,0.04)", border: `0.5px solid ${s.tintBorder}`, fontFamily: MA.FONT, ...tilt3DStyle }}>
              <div className="absolute pointer-events-none" style={{ right: 6, bottom: 4, color: s.color, opacity: 0.22 }}>
                {s.decor}
              </div>
              <div className="w-[28px] h-[28px] rounded-[9px] flex items-center justify-center mb-[8px]" style={{ background: `${s.color}1F`, color: s.color }}>
                {s.icon}
              </div>
              <div className="text-[9px] font-bold uppercase mb-[4px]" style={{ color: s.color, letterSpacing: "1.1px" }}>{s.label}</div>
              <div className="text-[24px] font-bold leading-none" style={{ color: MA.T1, letterSpacing: "-0.9px" }}>{s.value}</div>
            </button>
          ))}
        </div>

        {/* Class tabs */}
        {classes.length > 0 && (
          <div className="mx-4 mb-[14px] p-[5px] rounded-[14px] flex gap-[7px]"
            style={{ background: MA.CARD, boxShadow: MA.SH_SM, border: MA.BDR, overflowX: "auto", scrollbarWidth: "none" as const }}>
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
        <div className="mx-4 mb-[14px] p-[16px] rounded-[20px]" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[10px]">
              <div className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center text-white" style={{ background: MA.P }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div>
                <div className="text-[14px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Weekly Overview</div>
                {activeClass && weeklyDays.length > 0 && (
                  <div className="text-[11px] font-semibold mt-[1px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                    {activeClass.name} · {weeklyDays[0]?.dateLabel} – {weeklyDays[weeklyDays.length - 1]?.dateLabel}
                  </div>
                )}
              </div>
            </div>
            <button type="button"
              onClick={() => selectedClassId && navigate(`/my-classes/${selectedClassId}`)}
              disabled={!selectedClassId}
              aria-label="Open this class's full attendance log"
              className="text-[12px] font-bold flex items-center gap-[2px] active:opacity-70 disabled:opacity-40" style={{ color: MA.P }}>
              View all <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
            </button>
          </div>

          {/* Fixed 5-col grid — fits the full week-view on screen, no swipe. */}
          <div className="grid grid-cols-5 gap-[6px]">
            {weeklyDays.map((day, i) => {
              const isPending = day.isToday && !day.hasData && !day.isWeekend;
              const onClickCard = isPending ? () => { setMarkingClassId(selectedClassId); setMarking(true); } : undefined;
              return (
                <div key={i}
                  onClick={onClickCard}
                  onKeyDown={onClickCard ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClickCard(); } }) : undefined}
                  role={onClickCard ? "button" : undefined}
                  tabIndex={onClickCard ? 0 : undefined}
                  aria-label={onClickCard ? "Mark today's attendance" : undefined}
                  className={`min-w-0 rounded-[14px] p-[8px] relative overflow-hidden ${onClickCard ? "active:scale-[0.97]" : ""}`}
                  style={{
                    background: day.isToday ? "linear-gradient(145deg, #0055FF 0%, #2970FF 100%)" : MA.SURFACE,
                    boxShadow: day.isToday ? "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.35)" : "none",
                    opacity: day.isFuture ? 0.92 : 1,
                    cursor: onClickCard ? "pointer" : "default",
                    transition: "transform .15s ease",
                  }}>
                  {day.isToday && (
                    <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 45%)" }} />
                  )}
                  <div className="relative z-[2]">
                    <div className="text-[8px] font-bold uppercase truncate" style={{ color: day.isToday ? "rgba(255,255,255,0.8)" : MA.T3, letterSpacing: "1.1px", marginBottom: 2 }}>
                      {day.isToday ? "Today" : day.label}
                    </div>
                    <div className="text-[12px] font-bold mb-[6px] truncate" style={{ color: day.isToday ? "#fff" : MA.T1, letterSpacing: "-0.3px" }}>
                      {day.dateLabel}
                    </div>
                    {day.hasData ? (
                      <div className="text-[13px] font-bold truncate" style={{
                        color: day.isToday ? "#fff" : (parseFloat(day.rate!) >= 85 ? MA.GREEN : parseFloat(day.rate!) >= 70 ? MA.ORANGE : MA.RED),
                        letterSpacing: "-0.4px",
                      }}>{day.rate}</div>
                    ) : isPending ? (
                      <div className="text-[10px] font-bold truncate" style={{ color: "#FFFFFF", textShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>Tap ›</div>
                    ) : (
                      <div className="text-[9px] font-semibold truncate" style={{ color: day.isFuture ? MA.PD : day.isForgotten ? MA.ORANGE : MA.T3 }}>
                        {day.isWeekend ? "Off" : day.isFuture ? "Upcoming" : day.isForgotten ? "Not marked" : "—"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Attendance Concerns */}
        <div className="mx-4 mb-[14px] p-[16px] rounded-[20px]" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[10px]">
              <div className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center text-white" style={{ background: MA.RED }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 21h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg>
              </div>
              <div>
                <div className="text-[14px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Attendance Concerns</div>
                <div className="text-[11px] font-semibold mt-[1px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                  {concerns.length === 0 ? "No flagged students" : `${concerns.length} student${concerns.length === 1 ? "" : "s"} need follow up`}{activeClass ? ` · ${activeClass.name}` : ""}
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
              <div className="text-[15px] font-bold mb-[4px]" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>All good here ✨</div>
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
                  <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center flex-shrink-0 text-white text-[12px] font-bold"
                    style={{ background: s.av.color, letterSpacing: "0.3px" }}>
                    {s.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{s.name}</div>
                    <div className="text-[11px] font-semibold mt-[1px] truncate" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>{s.issue}</div>
                  </div>
                  <span className="px-[10px] py-[4px] rounded-full text-[10px] font-bold flex-shrink-0"
                    style={{ background: s.badge.bg, color: s.badge.color, letterSpacing: "0.3px" }}>
                    {s.badge.text}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Attendance Insights — rule-based summary, was previously labeled
            "AI" which violated the AI strategy memo (no model behind these
            threshold templates). Renamed for honesty. */}
        {(() => {
          const unmarkedCount = weeklyDays.filter(d => d.isForgotten).length;
          const roster = enrollments.filter(e => e.classId === selectedClassId).length;
          const rateLabel = stats.hasAnyRecord ? `${stats.rateNum.toFixed(1)}%` : "—";
          return (
            <div className="mx-4 mb-[14px] rounded-[24px] p-[20px] relative overflow-hidden"
              style={{
                background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
                boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
              }}>
              <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
              <div className="relative z-[2]">
                <div className="flex items-center gap-[11px] mb-[12px]">
                  <div className="w-10 h-10 rounded-[13px] flex items-center justify-center"
                    style={{
                      background: "rgba(255,255,255,0.14)",
                      backdropFilter: "blur(22px)",
                      WebkitBackdropFilter: "blur(22px)",
                      border: "0.5px solid rgba(255,255,255,0.22)",
                    }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
                  </div>
                  <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.8px" }}>
                    Attendance Insights
                  </div>
                </div>
                <div className="text-[13px] leading-[1.6] mb-[14px]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                  {!stats.hasAnyRecord ? (
                    <>No attendance has been recorded yet. <strong className="text-white font-bold">Tap "Mark today"</strong> to begin tracking turnout for this class.</>
                  ) : stats.rateNum >= 85 ? (
                    <>Turnout is <strong className="text-white font-bold">strong</strong> at <strong className="text-white font-bold">{rateLabel}</strong>.{unmarkedCount > 0 && <> <strong className="text-white font-bold">{unmarkedCount} day{unmarkedCount === 1 ? "" : "s"}</strong> {unmarkedCount === 1 ? "was" : "were"} unmarked — mark retroactively to improve accuracy.</>}</>
                  ) : stats.rateNum >= 70 ? (
                    <>Turnout is <strong className="text-white font-bold">steady</strong> at <strong className="text-white font-bold">{rateLabel}</strong>. Keep an eye on repeat absences this week.</>
                  ) : stats.rateNum > 0 ? (
                    <>Today's rate of <strong className="text-white font-bold">{rateLabel}</strong> is <strong className="text-white font-bold">below target</strong>. Review concerns and follow up with parents.</>
                  ) : (
                    <>Today's rate is <strong className="text-white font-bold">0%</strong>. Every student is currently marked absent — confirm or correct.</>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[12px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[17px] font-bold" style={{ color: stats.hasAnyRecord && stats.rateNum >= 85 ? "#6FFFAA" : "#fff", letterSpacing: "-0.4px" }}>{rateLabel}</div>
                    <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Rate</div>
                  </div>
                  <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[17px] font-bold text-white" style={{ letterSpacing: "-0.4px" }}>
                      {stats.presentToday}{roster > 0 ? `/${roster}` : ""}
                    </div>
                    <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Present</div>
                  </div>
                  <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[17px] font-bold text-white" style={{ letterSpacing: "-0.4px" }}>{unmarkedCount}</div>
                    <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Unmarked</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      </div>

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh" }}>
        <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-12">

          {/* School holiday banner — principal-declared, top of page */}
          {todaySchoolHoliday && (
            <div
              role="alert"
              className="rounded-[18px] px-6 py-4 mb-5 flex items-center gap-4"
              style={{
                background: "linear-gradient(135deg, #7B3FF4 0%, #9B6FFF 100%)",
                boxShadow: "0 8px 22px rgba(123,63,244,0.32), 0 2px 6px rgba(123,63,244,0.18)",
              }}
            >
              <div className="w-12 h-12 rounded-[14px] shrink-0 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.18)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)" }}>
                <CalendarDays className="w-[22px] h-[22px] text-white" strokeWidth={2.3} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.78)", textTransform: "uppercase", letterSpacing: "0.18em" }}>
                  School Holiday Today
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginTop: 3, letterSpacing: "-0.3px" }}>
                  {todaySchoolHoliday.reason || "Declared holiday"}
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.85)", marginTop: 4 }}>
                  No attendance marking needed today.{todaySchoolHoliday.declaredByName ? ` Declared by ${todaySchoolHoliday.declaredByName}.` : ""}
                </div>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-[7px] text-[10px] font-bold uppercase mb-[8px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
              <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: MA.P }} />
              Teacher Dashboard · Attendance
            </div>
            <h1 className="text-[40px] font-bold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.4px" }}>Attendance</h1>
            <div className="text-[14px] font-medium mt-[8px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
              Track and manage student attendance across all classes.
            </div>
          </div>

          {/* Hero banner */}
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
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Overall Rate</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Today · {activeClass?.name || "All classes"}</div>
                </div>
                <div className="ml-auto flex items-center gap-[6px] px-4 py-[7px] rounded-full text-[11px] font-bold"
                  style={{
                    background: !stats.hasAnyRecord ? "rgba(255,255,255,0.14)" : stats.rateNum >= 85 ? "rgba(0,232,102,0.18)" : stats.rateNum >= 70 ? "rgba(255,170,0,0.22)" : "rgba(255,51,85,0.18)",
                    border: `0.5px solid ${!stats.hasAnyRecord ? "rgba(255,255,255,0.22)" : stats.rateNum >= 85 ? "rgba(0,232,102,0.5)" : stats.rateNum >= 70 ? "rgba(255,170,0,0.5)" : "rgba(255,51,85,0.5)"}`,
                    color: !stats.hasAnyRecord ? "rgba(255,255,255,0.72)" : stats.rateNum >= 85 ? "#6FFFAA" : stats.rateNum >= 70 ? "#FFD166" : "#FF99AA",
                    letterSpacing: "0.3px",
                  }}>
                  <span className="w-[6px] h-[6px] rounded-full" style={{
                    background: !stats.hasAnyRecord ? "#fff" : stats.rateNum >= 85 ? "#00FF88" : stats.rateNum >= 70 ? "#FFCC22" : "#FF5577",
                    boxShadow: `0 0 8px ${!stats.hasAnyRecord ? "#fff" : stats.rateNum >= 85 ? "#00FF88" : stats.rateNum >= 70 ? "#FFCC22" : "#FF5577"}`,
                  }} />
                  {!stats.hasAnyRecord ? "No data" : stats.rateNum >= 85 ? "On Track" : stats.rateNum >= 70 ? "Watch" : "Low"}
                </div>
              </div>
              <div className="flex items-end justify-between gap-8 flex-wrap">
                <div>
                  <div className="font-bold text-white leading-none mb-[6px] flex items-baseline gap-[2px]" style={{ letterSpacing: "-3.8px", fontSize: stats.hasAnyRecord ? 84 : 64 }}>
                    {stats.hasAnyRecord ? (
                      <>
                        {stats.rateNum.toFixed(1)}
                        <span className="text-[40px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-1px" }}>%</span>
                      </>
                    ) : (
                      <span style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "-2.4px" }}>
                        —.—<span style={{ fontSize: 32, color: "rgba(255,255,255,0.4)", marginLeft: 2 }}>%</span>
                      </span>
                    )}
                  </div>
                  <div className="text-[14px] font-medium" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
                    <b className="text-white font-bold">
                      {!stats.hasAnyRecord ? "No records yet" : stats.rateNum >= 85 ? "Excellent turnout" : stats.rateNum >= 70 ? "Steady turnout" : stats.rateNum > 0 ? "Needs attention" : "Critical turnout"}
                    </b>
                    {stats.hasAnyRecord ? " today — tracking class performance." : " — mark today to start tracking."}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[380px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-bold" style={{ color: "#6FFFAA", letterSpacing: "-0.8px" }}>{stats.presentToday}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>Present</div>
                  </div>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-bold" style={{ color: "#FF9AA9", letterSpacing: "-0.8px" }}>{stats.absentToday}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>Absent</div>
                  </div>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-bold" style={{ color: "#FFD060", letterSpacing: "-0.8px" }}>{stats.lateToday}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.2px" }}>Late</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Mark today CTA + 3 stat cards row */}
          <div className="grid grid-cols-4 gap-4 mb-5">
            <button type="button"
              onClick={() => { setMarkingClassId(selectedClassId); setMarking(true); }}
              className="h-auto rounded-[22px] flex flex-col items-center justify-center gap-2 p-5 hover:scale-[1.02] active:scale-[0.98] transition-transform"
              style={{ background: MA.GREEN, color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px", fontFamily: MA.FONT }}>
              <div className="w-11 h-11 rounded-[12px] flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>{stats.hasAnyRecord ? "Edit today's attendance" : "Mark today's attendance"}</div>
            </button>
            {([
              { key: "present", color: MA.GREEN, value: stats.presentToday, label: "Present", onClick: () => navigate('/students'),
                tintBg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)", tintBorder: "rgba(0,200,83,0.16)",
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><polyline points="17 11 19 13 23 9"/></svg>,
                decor: <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><polyline points="17 11 19 13 23 9"/></svg> },
              { key: "absent", color: MA.RED, value: stats.absentToday, label: "Absent", onClick: () => navigate('/risks-alerts'),
                tintBg: "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)", tintBorder: "rgba(255,51,85,0.14)",
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/></svg>,
                decor: <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0112 0"/><line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/></svg> },
              { key: "late", color: MA.ORANGE, value: stats.lateToday, label: "Late", onClick: () => navigate('/risks-alerts'),
                tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)", tintBorder: "rgba(255,136,0,0.14)",
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
                decor: <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
            ] as const).map(s => (
              <button key={s.key} type="button" onClick={s.onClick}
                {...tilt3D}
                className="rounded-[22px] p-5 relative flex flex-col text-left overflow-hidden active:scale-[0.98] transition-all"
                style={{ background: s.tintBg, boxShadow: "0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04)", border: `0.5px solid ${s.tintBorder}`, fontFamily: MA.FONT, ...tilt3DStyle }}>
                <div className="absolute pointer-events-none" style={{ right: 14, bottom: 12, color: s.color, opacity: 0.22 }}>
                  {s.decor}
                </div>
                <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center mb-[14px]" style={{ background: `${s.color}1F`, color: s.color }}>
                  {s.icon}
                </div>
                <div className="text-[11px] font-bold uppercase mb-[8px]" style={{ color: s.color, letterSpacing: "1px" }}>{s.label}</div>
                <div className="text-[36px] font-bold leading-none" style={{ color: MA.T1, letterSpacing: "-1.6px" }}>{s.value}</div>
              </button>
            ))}
          </div>

          {/* Class tabs */}
          {classes.length > 0 && (
            <div className="mb-5 p-[5px] rounded-[14px] flex gap-[7px]"
              style={{ background: MA.CARD, boxShadow: MA.SH_SM, border: MA.BDR, overflowX: "auto", scrollbarWidth: "none" as const }}>
              {classes.map(cls => {
                const isActive = selectedClassId === cls.id;
                return (
                  <button key={cls.id} type="button" onClick={() => setSelectedClassId(cls.id)}
                    className="py-[10px] px-5 rounded-[10px] text-[13px] font-bold text-center transition-all active:scale-[0.96]"
                    style={{
                      background: isActive ? MA.P : "transparent",
                      color: isActive ? "#fff" : MA.T3,
                      letterSpacing: "-0.2px",
                      fontFamily: MA.FONT,
                      whiteSpace: "nowrap",
                      minWidth: 120,
                      boxShadow: isActive ? "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" : "none",
                    }}>
                    {cls.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* 2-column: Weekly overview + Attendance Concerns */}
          <div className="grid grid-cols-2 gap-4 mb-5">

            {/* Weekly Overview */}
            <div className="p-6 rounded-[22px]" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white" style={{ background: MA.P }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  </div>
                  <div>
                    <div className="text-[16px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.35px" }}>Weekly Overview</div>
                    {activeClass && weeklyDays.length > 0 && (
                      <div className="text-[12px] font-semibold mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                        {activeClass.name} · {weeklyDays[0]?.dateLabel} – {weeklyDays[weeklyDays.length - 1]?.dateLabel}
                      </div>
                    )}
                  </div>
                </div>
                <button type="button"
                  onClick={() => selectedClassId && navigate(`/my-classes/${selectedClassId}`)}
                  disabled={!selectedClassId}
                  aria-label="Open this class's full attendance log"
                  className="text-[13px] font-bold flex items-center gap-[2px] active:opacity-70 hover:bg-[#EEF4FF] py-1 px-2 rounded-[8px] transition-colors disabled:opacity-40 disabled:hover:bg-transparent" style={{ color: MA.P }}>
                  View all <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
                </button>
              </div>

              {/* Fixed 5-col grid — full week view, no swipe needed. */}
              <div className="grid grid-cols-5 gap-[10px]">
                {weeklyDays.map((day, i) => {
                  const isPending = day.isToday && !day.hasData && !day.isWeekend;
                  const onClickCard = isPending ? () => { setMarkingClassId(selectedClassId); setMarking(true); } : undefined;
                  return (
                    <div key={i}
                      onClick={onClickCard}
                      onKeyDown={onClickCard ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClickCard(); } }) : undefined}
                      role={onClickCard ? "button" : undefined}
                      tabIndex={onClickCard ? 0 : undefined}
                      aria-label={onClickCard ? "Mark today's attendance" : undefined}
                      className={`min-w-0 rounded-[16px] p-[12px] relative overflow-hidden ${onClickCard ? "active:scale-[0.97]" : ""}`}
                      style={{
                        background: day.isToday ? "linear-gradient(145deg, #0055FF 0%, #2970FF 100%)" : MA.SURFACE,
                        boxShadow: day.isToday ? "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.35)" : "none",
                        opacity: day.isFuture ? 0.92 : 1,
                        cursor: onClickCard ? "pointer" : "default",
                        transition: "transform .15s ease",
                      }}>
                      {day.isToday && (
                        <>
                          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 45%)" }} />
                          <div className="absolute top-[10px] right-[10px] text-[8px] font-bold px-[7px] py-[3px] rounded-full uppercase"
                            style={{ background: "rgba(255,255,255,0.25)", backdropFilter: "blur(8px)", color: "#fff", border: "0.5px solid rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                            Today
                          </div>
                        </>
                      )}
                      {day.isFuture && (
                        <div className="absolute top-[10px] right-[10px] text-[8px] font-bold px-[7px] py-[3px] rounded-full uppercase"
                          style={{ background: "rgba(9,87,247,0.1)", color: MA.P, letterSpacing: "0.5px" }}>
                          Upcoming
                        </div>
                      )}
                      <div className="relative z-[2]">
                        <div className="text-[9px] font-bold uppercase" style={{ color: day.isToday ? "rgba(255,255,255,0.8)" : MA.T3, letterSpacing: "1.3px", marginBottom: 3 }}>
                          {day.label}
                        </div>
                        <div className="text-[17px] font-bold mb-[10px]" style={{ color: day.isToday ? "#fff" : MA.T1, letterSpacing: "-0.5px" }}>
                          {day.dateLabel}
                        </div>
                        {day.hasData ? (
                          <>
                            <div className="flex flex-col gap-[5px] mb-[10px]">
                              <div className="flex justify-between items-center text-[10px]">
                                <span className="font-semibold" style={{ color: day.isToday ? "rgba(255,255,255,0.7)" : MA.T3 }}>Present</span>
                                <span className="font-bold" style={{ color: day.isToday ? "#6FFFAA" : MA.GREEN, letterSpacing: "-0.2px" }}>{day.present}</span>
                              </div>
                              <div className="flex justify-between items-center text-[10px]">
                                <span className="font-semibold" style={{ color: day.isToday ? "rgba(255,255,255,0.7)" : MA.T3 }}>Absent</span>
                                <span className="font-bold" style={{ color: day.isToday ? "#FF9AA9" : MA.RED, letterSpacing: "-0.2px" }}>{day.absent}</span>
                              </div>
                            </div>
                            <div className="text-[17px] font-bold" style={{
                              color: day.isToday ? "#fff" : (parseFloat(day.rate!) >= 85 ? MA.GREEN : parseFloat(day.rate!) >= 70 ? MA.ORANGE : MA.RED),
                              letterSpacing: "-0.5px",
                            }}>{day.rate}</div>
                          </>
                        ) : (
                          <>
                            <div className="flex flex-col gap-[5px] mb-[10px]" style={{ minHeight: 50 }} />
                            {isPending ? (
                              <div className="text-[11px] font-bold" style={{ color: "#FFFFFF", textShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>Tap to mark ›</div>
                            ) : (
                              <div className="text-[10px] font-semibold" style={{ color: day.isFuture ? MA.PD : day.isForgotten ? MA.ORANGE : MA.T3, letterSpacing: "-0.1px" }}>
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
            <div className="p-6 rounded-[22px]" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white" style={{ background: MA.RED }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 21h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg>
                  </div>
                  <div>
                    <div className="text-[16px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.35px" }}>Attendance Concerns</div>
                    <div className="text-[12px] font-semibold mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                      {concerns.length === 0 ? "No flagged students" : `${concerns.length} student${concerns.length === 1 ? "" : "s"} need follow up`}{activeClass ? ` · ${activeClass.name}` : ""}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/risks-alerts')}
                  className="text-[13px] font-bold flex items-center gap-[2px] active:opacity-70 hover:bg-[#EEF4FF] py-1 px-2 rounded-[8px] transition-colors" style={{ color: MA.P }}>
                  View all <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
                </button>
              </div>

              {concerns.length === 0 ? (
                <div className="py-[36px] px-[20px] text-center relative">
                  <div className="mx-auto mb-[16px] w-[96px] h-[96px] rounded-[28px] flex items-center justify-center text-white relative"
                    style={{
                      background: `linear-gradient(145deg, ${MA.GREEN_B} 0%, ${MA.GREEN} 100%)`,
                      boxShadow: "0 0 0 10px rgba(0,200,83,0.1), 0 0 0 22px rgba(0,200,83,0.05), 0 8px 20px rgba(0,200,83,0.35)",
                    }}>
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div className="text-[17px] font-bold mb-[5px]" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>All good here ✨</div>
                  <div className="text-[13px] font-medium" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                    <b className="font-bold" style={{ color: MA.GREEN }}>All students</b> have good attendance
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-[10px]">
                  {concerns.map((s, i) => (
                    <button key={i} type="button" onClick={() => navigate('/risks-alerts')}
                      className="w-full flex items-center gap-3 p-[13px] rounded-[14px] hover:brightness-[0.98] active:scale-[0.99] transition text-left"
                      style={{ background: MA.SURFACE }}>
                      <div className="w-[44px] h-[44px] rounded-[13px] flex items-center justify-center flex-shrink-0 text-white text-[13px] font-bold"
                        style={{ background: s.av.color, letterSpacing: "0.3px" }}>
                        {s.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.25px" }}>{s.name}</div>
                        <div className="text-[12px] font-semibold mt-[2px] truncate" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>{s.issue}</div>
                      </div>
                      <span className="px-[12px] py-[5px] rounded-full text-[11px] font-bold flex-shrink-0"
                        style={{ background: s.badge.bg, color: s.badge.color, letterSpacing: "0.3px" }}>
                        {s.badge.text}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Attendance Insights — see mobile note above. */}
          {(() => {
            const unmarkedCount = weeklyDays.filter(d => d.isForgotten).length;
            const roster = enrollments.filter(e => e.classId === selectedClassId).length;
            const rateLabel = stats.hasAnyRecord ? `${stats.rateNum.toFixed(1)}%` : "—";
            return (
              <div className="rounded-[26px] p-7 relative overflow-hidden"
                style={{
                  background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
                  boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
                }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
                <div className="relative z-[2]">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-[48px] h-[48px] rounded-[14px] flex items-center justify-center"
                      style={{
                        background: "rgba(255,255,255,0.14)",
                        backdropFilter: "blur(22px)",
                        WebkitBackdropFilter: "blur(22px)",
                        border: "0.5px solid rgba(255,255,255,0.22)",
                      }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
                    </div>
                    <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>
                      Attendance Insights
                    </div>
                  </div>
                  <div className="text-[14px] leading-[1.6] mb-5" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                    {!stats.hasAnyRecord ? (
                      <>No attendance has been recorded yet. <strong className="text-white font-bold">Click "Mark today"</strong> to begin tracking turnout for this class.</>
                    ) : stats.rateNum >= 85 ? (
                      <>Turnout is <strong className="text-white font-bold">strong</strong> at <strong className="text-white font-bold">{rateLabel}</strong>.{unmarkedCount > 0 && <> <strong className="text-white font-bold">{unmarkedCount} day{unmarkedCount === 1 ? "" : "s"}</strong> {unmarkedCount === 1 ? "was" : "were"} unmarked — mark retroactively to improve accuracy.</>}</>
                    ) : stats.rateNum >= 70 ? (
                      <>Turnout is <strong className="text-white font-bold">steady</strong> at <strong className="text-white font-bold">{rateLabel}</strong>. Keep an eye on repeat absences this week.</>
                    ) : stats.rateNum > 0 ? (
                      <>Today's rate of <strong className="text-white font-bold">{rateLabel}</strong> is <strong className="text-white font-bold">below target</strong>. Review concerns and follow up with parents.</>
                    ) : (
                      <>Today's rate is <strong className="text-white font-bold">0%</strong>. Every student is currently marked absent — confirm or correct.</>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                    <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[22px] font-bold" style={{ color: stats.hasAnyRecord && stats.rateNum >= 85 ? "#6FFFAA" : "#fff", letterSpacing: "-0.6px" }}>{rateLabel}</div>
                      <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Rate</div>
                    </div>
                    <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[22px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>
                        {stats.presentToday}{roster > 0 ? `/${roster}` : ""}
                      </div>
                      <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Present</div>
                    </div>
                    <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                      <div className="text-[22px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{unmarkedCount}</div>
                      <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Unmarked</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default Attendance;
