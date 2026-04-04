import { useState, useEffect, useMemo } from "react";
import MarkAttendance from "@/components/MarkAttendance";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2 } from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────────
const today = () => new Date().toLocaleDateString("en-CA");

const getInitials = (name = "") => {
  const p = name.trim().split(" ");
  return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
};

const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-orange-500", "bg-rose-500",
  "bg-violet-500", "bg-pink-500", "bg-teal-500", "bg-amber-500",
  "bg-indigo-500", "bg-cyan-600",
];
const avatarColor = (name = "") =>
  AVATAR_COLORS[[...(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

// ── component ─────────────────────────────────────────────────────────────────
const Attendance = () => {
  const { teacherData } = useAuth();

  const [marking, setMarking]           = useState(false);
  const [markingClassId, setMarkingClassId] = useState<string>("");
  const [loading, setLoading]           = useState(true);
  const [classes, setClasses]           = useState<any[]>([]);
  const [enrollments, setEnrollments]   = useState<any[]>([]);
  const [records, setRecords]           = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  // 1. Classes (real-time)
  useEffect(() => {
    if (!teacherData?.id) return;
    const unsub = onSnapshot(
      query(collection(db, "classes"), where("teacherId", "==", teacherData.id)),
      (snap) => {
        const cls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setClasses(cls);
        setSelectedClassId(prev => prev || cls[0]?.id || "");
        if (cls.length === 0) setLoading(false);
      }
    );
    return () => unsub();
  }, [teacherData?.id]);

  // 2. Enrollments for all classes
  useEffect(() => {
    if (!classes.length) { setEnrollments([]); return; }
    Promise.all(
      classes.map(c => getDocs(query(collection(db, "enrollments"), where("classId", "==", c.id))))
    ).then(snaps => {
      const all: any[] = [];
      snaps.forEach(s => s.docs.forEach(d => all.push({ id: d.id, ...d.data() })));
      setEnrollments(all);
    });
  }, [classes]);

  // 3. Attendance records (real-time)
  useEffect(() => {
    if (!teacherData?.id || !classes.length) { setRecords([]); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, "attendance"), where("teacherId", "==", teacherData.id)),
      (snap) => {
        setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      }
    );
    return () => unsub();
  }, [teacherData?.id, classes.length]);

  // ── derived stats ───────────────────────────────────────────────────────────
  const todayStr = today();

  const stats = useMemo(() => {
    const todayRec = records.filter(r => r.date === todayStr);
    const total    = records.length;
    const pres     = records.filter(r => r.status === "present" || r.status === "late").length;
    return {
      rate:         total > 0 ? `${((pres / total) * 100).toFixed(1)}%` : "0%",
      presentToday: todayRec.filter(r => r.status === "present").length,
      absentToday:  todayRec.filter(r => r.status === "absent").length,
      lateToday:    todayRec.filter(r => r.status === "late").length,
    };
  }, [records, todayStr]);

  // ── weekly days: last Mon → today + next 3 upcoming working days only ──
  const weeklyDays = useMemo(() => {
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const dow = todayDate.getDay();
    const daysFromMon = dow === 0 ? 6 : dow - 1;

    // start from Monday of previous week to cover "Mon Feb 10 – Mon Feb 17" style
    const startMon = new Date(todayDate);
    startMon.setDate(todayDate.getDate() - daysFromMon - 7);

    const days = [];
    const cur = new Date(startMon);
    while (cur <= todayDate) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) {
        const dateStr  = cur.toLocaleDateString("en-CA");
        const dayRecs  = records.filter(r => r.date === dateStr && r.classId === selectedClassId);
        const pres     = dayRecs.filter(r => r.status === "present" || r.status === "late").length;
        const abs      = dayRecs.filter(r => r.status === "absent").length;
        const total    = enrollments.filter(e => e.classId === selectedClassId).length || 1;
        const rate     = dayRecs.length > 0 ? ((pres / total) * 100).toFixed(1) : null;
        days.push({
          label:     cur.toLocaleDateString("en-US", { weekday: "short" }),
          dateLabel: cur.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          dateStr,
          present:   pres,
          absent:    abs,
          rate:      rate ? `${rate}%` : null,
          isToday:   dateStr === todayStr,
          hasData:   dayRecs.length > 0,
          isFuture:  false,
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    // Add next 3 upcoming working days only
    let future = 0;
    let futureDate = new Date(todayDate);
    const FUTURE_DAYS = 3;
    while (future < FUTURE_DAYS) {
      futureDate.setDate(futureDate.getDate() + 1);
      const d = futureDate.getDay();
      if (d !== 0 && d !== 6) {
        days.push({
          label: futureDate.toLocaleDateString("en-US", { weekday: "short" }),
          dateLabel: futureDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          dateStr: futureDate.toLocaleDateString("en-CA"),
          present: null,
          absent: null,
          rate: null,
          isToday: false,
          hasData: false,
          isFuture: true,
        });
        future++;
      }
    }
    // Show last 6 working days + only 3 future working days
    const last6 = days.filter(d => !d.isFuture).slice(-6);
    const onlyFuture = days.filter(d => d.isFuture).slice(0, FUTURE_DAYS);
    return last6.concat(onlyFuture);
  }, [records, enrollments, selectedClassId, todayStr]);

  // ── attendance concerns ─────────────────────────────────────────────────────
  const concerns = useMemo(() => {
    // current month
    const monthStr = todayStr.slice(0, 7); // "YYYY-MM"
    const monthRecs = records.filter(r => r.date?.startsWith(monthStr));

    const map: Record<string, { name: string; absent: number; late: number }> = {};
    monthRecs.forEach(r => {
      const key = r.studentId || r.studentEmail;
      if (!key) return;
      if (!map[key]) map[key] = { name: r.studentName || "Student", absent: 0, late: 0 };
      if (r.status === "absent") map[key].absent++;
      if (r.status === "late")   map[key].late++;
    });

    return Object.values(map)
      .filter(s => s.absent >= 2 || s.late >= 3)
      .sort((a, b) => (b.absent + b.late) - (a.absent + a.late))
      .slice(0, 3)
      .map(s => ({
        name:    s.name,
        initials: getInitials(s.name),
        color:   avatarColor(s.name),
        issue:   s.absent >= 2
          ? `${s.absent} absences this month`
          : "Frequently late",
        bg:      s.absent >= 3 ? "bg-rose-50 border-rose-100" :
                 s.absent >= 2 ? "bg-amber-50 border-amber-100" : "bg-amber-50 border-amber-100",
        textColor: s.absent >= 3 ? "text-rose-500" : "text-amber-600",
      }));
  }, [records, todayStr]);

  const activeClass = classes.find(c => c.id === selectedClassId);

  // ── mark attendance view ────────────────────────────────────────────────────
  if (marking) {
    return (
      <MarkAttendance
        initialClassId={markingClassId || selectedClassId}
        onBack={() => setMarking(false)}
      />
    );
  }

  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1e3272] animate-spin" />
    </div>
  );

  return (
    <div className="text-left space-y-6">

      {/* ── Header ── */}
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
            Result of click: "Attendance"
          </p>
          <h1 className="text-3xl font-bold text-slate-800">Attendance</h1>
          <p className="text-slate-500 text-sm mt-1">Track and manage student attendance across all classes.</p>
        </div>
        <button
          onClick={() => { setMarkingClassId(selectedClassId); setMarking(true); }}
          className="px-6 py-3 bg-[#1e3272] text-white rounded-xl text-sm font-semibold hover:bg-[#162558] transition-all shadow-sm"
        >
          Mark Today's Attendance
        </button>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Overall Rate",   value: stats.rate,         color: "bg-emerald-100" },
          { label: "Present Today",  value: stats.presentToday, color: "bg-blue-100"    },
          { label: "Absent Today",   value: stats.absentToday,  color: "bg-rose-100"    },
          { label: "Late Today",     value: stats.lateToday,    color: "bg-amber-100"   },
        ].map(c => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex-shrink-0 ${c.color}`} />
            <div>
              <p className="text-2xl font-bold text-slate-800 leading-none mb-1">{c.value}</p>
              <p className="text-xs text-slate-500 font-medium">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Class Selector Tabs ── */}
      {classes.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {classes.map(cls => (
            <button
              key={cls.id}
              onClick={() => setSelectedClassId(cls.id)}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                selectedClassId === cls.id
                  ? "bg-[#1e3272] text-white border-[#1e3272]"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              }`}
            >
              {cls.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Weekly Attendance Overview ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-base font-bold text-slate-800">Weekly Attendance Overview</h2>
            {weeklyDays.length > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                {activeClass?.name} • {weeklyDays[0]?.dateLabel} – {weeklyDays[weeklyDays.length - 1]?.dateLabel}, {new Date().getFullYear()}
              </p>
            )}
          </div>
        </div>

        <div className="p-5">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${weeklyDays.length + 1}, minmax(0,1fr))` }}>
            {weeklyDays.map((day, i) => (
              <div
                key={i}
                className={`rounded-xl p-4 border transition-all ${
                  day.isToday
                    ? "border-amber-400 bg-white ring-1 ring-amber-400 shadow-sm"
                    : "border-slate-100 bg-slate-50"
                }`}
              >
                <p className="text-xs font-semibold text-slate-400 mb-1">{day.label}</p>
                <p className="text-base font-bold text-slate-800 mb-3">{day.dateLabel}</p>

                <div className="space-y-1.5 mb-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">Present</span>
                    <span className="text-sm font-bold text-emerald-500">
                      {day.hasData ? day.present : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">Absent</span>
                    <span className="text-sm font-bold text-rose-500">
                      {day.hasData ? day.absent : "—"}
                    </span>
                  </div>
                </div>

                {day.hasData ? (
                  <p className="text-sm font-bold text-emerald-500">{day.rate}</p>
                ) : day.isToday ? (
                  <button
                    onClick={() => { setMarkingClassId(selectedClassId); setMarking(true); }}
                    className="w-full py-2 bg-[#1e3272] text-white rounded-lg text-xs font-semibold mt-1"
                  >
                    Mark Now
                  </button>
                ) : day.isFuture ? (
                  <p className="text-xs font-semibold text-slate-400">Upcoming</p>
                ) : (
                  <p className="text-xs text-slate-300">—</p>
                )}
              </div>
            ))}

            {/* Removed static Upcoming placeholder; now handled dynamically above */}
          </div>
        </div>
      </div>

      {/* ── Attendance Concerns ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-base font-bold text-slate-800">Attendance Concerns</h2>
          <button className="text-xs font-semibold text-[#1e3272] hover:underline">View All</button>
        </div>

        {concerns.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {concerns.map((s, i) => (
              <div key={i} className={`flex items-center gap-3 p-4 rounded-xl border ${s.bg}`}>
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${s.color}`}>
                  {s.initials}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{s.name}</p>
                  <p className={`text-xs font-semibold mt-0.5 ${s.textColor}`}>{s.issue}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 flex items-center justify-center border border-dashed border-slate-200 rounded-xl">
            <p className="text-sm text-slate-300 font-semibold">All students have good attendance</p>
          </div>
        )}
      </div>

      {/* ── Attendance Log (Date + Class filter) ── */}
      <AttendanceLog
        classes={classes}
        enrollments={enrollments}
        records={records}
      />

    </div>
  );
};

// ── Attendance Log sub-component ───────────────────────────────────────────────
const AttendanceLog = ({ classes, enrollments, records }: any) => {
  const [logDate, setLogDate]       = useState(new Date().toLocaleDateString("en-CA"));
  const [logClassId, setLogClassId] = useState(classes[0]?.id || "");

  useEffect(() => {
    if (!logClassId && classes.length) setLogClassId(classes[0].id);
  }, [classes]);

  const roster = enrollments.filter((e: any) => e.classId === logClassId);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <h2 className="text-base font-bold text-slate-800">Attendance Log</h2>
        <div className="flex items-center gap-3">
          <select
            value={logClassId}
            onChange={e => setLogClassId(e.target.value)}
            className="h-9 px-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white outline-none focus:ring-2 focus:ring-blue-100"
          >
            {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input
            type="date"
            value={logDate}
            onChange={e => setLogDate(e.target.value)}
            className="h-9 px-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-6 py-3 text-xs font-semibold text-slate-500">Student</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roster.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-6 py-12 text-center text-sm text-slate-300 font-semibold">
                  No students enrolled in this class
                </td>
              </tr>
            ) : (
              roster.map((s: any) => {
                const log = records.find((r: any) =>
                  r.studentId === s.studentId && r.date === logDate && r.classId === logClassId
                );
                const status = log?.status || "unmarked";
                const statusStyle =
                  status === "present"  ? "bg-emerald-50 text-emerald-700" :
                  status === "absent"   ? "bg-rose-50 text-rose-700" :
                  status === "late"     ? "bg-amber-50 text-amber-700" :
                                          "bg-slate-50 text-slate-400";
                return (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${avatarColor(s.studentName || "")}`}>
                          {getInitials(s.studentName)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{s.studentName}</p>
                          <p className="text-xs text-slate-400">{s.studentEmail}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-center">
                      <span className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize ${statusStyle}`}>
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Attendance;
