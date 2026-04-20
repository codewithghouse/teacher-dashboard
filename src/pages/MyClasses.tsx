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
  Users, CheckCircle, AlertCircle, LayoutGrid, Home
} from "lucide-react";

type FilterType = "All" | "Active" | "Attention";

const getSemesterLabel = () => {
  const month = new Date().getMonth();
  const year  = new Date().getFullYear();
  return `${month < 6 ? "Spring" : "Fall"} Semester · ${year}`;
};

const CARD_ACCENTS = [
  "from-indigo-500 to-blue-500",
  "from-violet-500 to-purple-500",
  "from-blue-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-rose-500 to-pink-400",
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
    const totalScore = scoreArr.reduce((acc, r) => acc + parseFloat(r.percentage || r.score || 0), 0);
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
    <div className="h-[60vh] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1e3272] animate-spin" />
    </div>
  );

  // ── Derived header values ────────────────────────────────────────
  const allMetrics    = classes.map(cls => getMetrics(cls.id));
  const totalStudents = allMetrics.reduce((s, m) => s + m.studentCount, 0);

  const validAtnd = allMetrics.map(m => m.atndRaw).filter(r => r >= 0);
  const avgAtnd   = validAtnd.length > 0 ? validAtnd.reduce((s, v) => s + v, 0) / validAtnd.length : -1;
  const avgAtndStr = avgAtnd >= 0 ? `${avgAtnd.toFixed(1)}%` : "—";

  const validPerf = allMetrics.map(m => m.perfRaw).filter(r => r >= 0);
  const avgPerf   = validPerf.length > 0 ? validPerf.reduce((s, v) => s + v, 0) / validPerf.length : -1;
  const avgPerfStr = avgPerf >= 0 ? `${avgPerf.toFixed(1)}%` : "—";

  const filteredClasses = classes.filter(cls => {
    const nameMatch = cls.name?.toLowerCase().includes(searchQuery.toLowerCase());
    if (!nameMatch) return false;
    if (filter === "All") return true;
    const { isAttention } = getMetrics(cls.id);
    return filter === "Attention" ? isAttention : !isAttention;
  });

  const filterChips: { key: FilterType; label: string; Icon: typeof LayoutGrid }[] = [
    { key: "All",       label: `All (${classes.length})`, Icon: LayoutGrid   },
    { key: "Active",    label: "Active",                  Icon: CheckCircle  },
    { key: "Attention", label: "Attention",               Icon: AlertCircle  },
  ];

  return (
    <div className="text-left">

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <div className="md:hidden">

      {/* ── Dark Hero ───────────────────────────────────────────── */}
      <div className="bg-[#08090C] -mx-4 sm:-mx-6 px-5 sm:px-8 pt-5 pb-8 mb-5">

        {/* Semester label */}
        <p className="text-[10px] font-semibold text-white/35 uppercase tracking-widest mb-1.5">
          {getSemesterLabel()}
        </p>

        {/* Title + subtitle */}
        <h1 className="text-[26px] font-bold text-white leading-tight mb-1">My classes</h1>
        <p className="text-xs text-white/40 mb-6">
          {classes.length} assigned {classes.length === 1 ? "class" : "classes"} · all sections active
        </p>

        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-2.5">
          {/* Avg attendance */}
          <div className="bg-white/[0.07] rounded-2xl px-3 py-3.5">
            <p className="text-[17px] font-bold text-white leading-none mb-1">{avgAtndStr}</p>
            <p className="text-[10px] text-white/45 leading-snug mb-2">Avg attendance</p>
            {avgAtnd >= 0 ? (
              <p className="text-[10px] text-emerald-400 font-semibold">● all sessions</p>
            ) : (
              <p className="text-[10px] text-white/20">no data yet</p>
            )}
          </div>

          {/* Avg performance */}
          <div className="bg-white/[0.07] rounded-2xl px-3 py-3.5">
            <p className="text-[17px] font-bold text-white leading-none mb-1">{avgPerfStr}</p>
            <p className="text-[10px] text-white/45 leading-snug mb-2">Avg performance</p>
            {avgPerf >= 0 ? (
              <p className="text-[10px] text-emerald-400 font-semibold">● from scores</p>
            ) : (
              <p className="text-[10px] text-white/20">no scores yet</p>
            )}
          </div>

          {/* Students */}
          <div className="bg-white/[0.07] rounded-2xl px-3 py-3.5">
            <p className="text-[17px] font-bold text-white leading-none mb-1">{totalStudents}</p>
            <p className="text-[10px] text-white/45 leading-snug mb-2">Students total</p>
            <p className="text-[10px] text-white/25">
              across {classes.length} {classes.length === 1 ? "class" : "classes"}
            </p>
          </div>
        </div>
      </div>

      {/* ── Search ─────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search classes..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full h-12 pl-11 pr-4 bg-white border border-slate-200 rounded-2xl text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-shadow duration-150"
        />
      </div>

      {/* ── Filter chips ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
        {filterChips.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150 active:scale-95 whitespace-nowrap ${
              filter === key
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-white text-slate-500 border border-slate-200 hover:border-slate-300"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Class Cards ─────────────────────────────────────────── */}
      {filteredClasses.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-2xl text-center px-8">
          <p className="text-slate-500 font-semibold text-sm mb-1">No classes assigned yet</p>
          <p className="text-slate-400 text-xs">Your principal will assign classes to you. Check back soon.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredClasses.map((cls, idx) => {
            const m        = getMetrics(cls.id);
            const nextTime = startTimesMap.get(cls.id) || cls.startTime || cls.scheduleTime;
            const subject  = cls.subject || teacherData?.subject || "Subject";
            const accent   = CARD_ACCENTS[idx % CARD_ACCENTS.length];

            return (
              <div
                key={cls.id}
                onClick={() => navigate(`/my-classes/${cls.id}`)}
                role="button"
                tabIndex={0}
                className="clickable-card bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 flex flex-col"
              >

                {/* Gradient accent strip */}
                <div className={`h-[3px] bg-gradient-to-r ${accent}`} />

                <div className="p-5 flex flex-col flex-1">

                  {/* Icon + badge row */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center">
                      <Home className="w-5 h-5 text-indigo-500" />
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border ${
                      m.isAttention
                        ? "bg-amber-50 text-amber-600 border-amber-100"
                        : "bg-emerald-50 text-emerald-600 border-emerald-100"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${m.isAttention ? "bg-amber-500" : "bg-emerald-500"}`} />
                      {m.isAttention ? "Attention" : "Active"}
                    </span>
                  </div>

                  {/* Class name + subtitle */}
                  <h3 className="text-xl font-bold text-slate-900 leading-tight mb-1.5">
                    {cls.name || "Class"}
                  </h3>
                  <p className="flex items-center gap-1.5 text-xs text-slate-400 mb-4">
                    <Users className="w-3 h-3 flex-shrink-0" />
                    {subject} · {m.studentCount} {m.studentCount === 1 ? "student" : "students"}
                  </p>

                  {/* 3-column metric tiles */}
                  <div className="grid grid-cols-3 gap-2 mb-4">

                    {/* Attendance */}
                    <div className="bg-slate-50 rounded-xl p-3">
                      <BarChart2 className="w-4 h-4 text-blue-500 mb-2" />
                      <p className="text-[10px] text-slate-400 mb-1 leading-none">Attendance</p>
                      <p className={`text-sm font-bold leading-none ${
                        m.atndRaw >= 85
                          ? "text-emerald-500"
                          : m.atndRaw >= 0
                          ? "text-amber-500"
                          : "text-slate-300"
                      }`}>
                        {m.atndDisplay}
                      </p>
                    </div>

                    {/* Performance */}
                    <div className="bg-slate-50 rounded-xl p-3">
                      <TrendingUp className="w-4 h-4 text-violet-500 mb-2" />
                      <p className="text-[10px] text-slate-400 mb-1 leading-none">Performance</p>
                      <p className={`text-sm font-bold leading-none ${
                        m.perfRaw >= 60
                          ? "text-emerald-500"
                          : m.perfRaw >= 0
                          ? "text-rose-500"
                          : "text-slate-300"
                      }`}>
                        {m.perfDisplay}
                      </p>
                    </div>

                    {/* Next class */}
                    <div className="bg-slate-50 rounded-xl p-3">
                      <Calendar className="w-4 h-4 text-orange-500 mb-2" />
                      <p className="text-[10px] text-slate-400 mb-1 leading-none">Next class</p>
                      <p className="text-sm font-bold leading-none text-slate-400">
                        {nextTime || "—"}
                      </p>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-auto">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/my-classes/${cls.id}`); }}
                      className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.97] transition-all duration-150"
                    >
                      View class
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate("/attendance"); }}
                      className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.97] transition-all duration-150 flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle className="w-3.5 h-3.5 text-slate-400" /> Mark
                    </button>
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      )}

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
      <div className="hidden md:block">

        {/* ── Header row ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-slate-900 leading-tight tracking-tight">My Classes</h1>
            <p className="text-sm text-slate-500 mt-1">Manage all your assigned classes and sections.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search classes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-64 h-10 pl-9 pr-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
              />
            </div>
            <button className="h-10 px-4 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
              Filter
            </button>
          </div>
        </div>

        {/* Filter chips desktop */}
        <div className="flex items-center gap-2 mb-5">
          {filterChips.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === key
                  ? "bg-[#1e3272] text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* ── Class cards grid (2-col) ───────────────────────────── */}
        {filteredClasses.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-2xl text-center px-8">
            <p className="text-slate-500 font-semibold text-sm mb-1">No classes assigned yet</p>
            <p className="text-slate-400 text-xs">Your principal will assign classes to you.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {filteredClasses.map((cls) => {
              const m = getMetrics(cls.id);
              const nextTime = startTimesMap.get(cls.id) || cls.startTime || cls.scheduleTime;
              const subject = cls.subject || teacherData?.subject || "Subject";

              return (
                <div
                  key={cls.id}
                  onClick={() => navigate(`/my-classes/${cls.id}`)}
                  role="button"
                  tabIndex={0}
                  className="clickable-card bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
                >

                  {/* Top row: pastel block + status */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: m.isAttention ? '#FFF4E6' : '#EBFBEE' }}>
                      <Home className="w-5 h-5" style={{ color: m.isAttention ? '#C87014' : '#087F5B' }} />
                    </div>
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full text-white ${m.isAttention ? 'bg-amber-500' : 'bg-emerald-500'}`}>
                      {m.isAttention ? 'Attention' : 'Active'}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-xl font-bold text-slate-900 leading-tight mb-1">{cls.name || 'Class'}</h3>
                  <p className="text-sm text-slate-500 mb-4">{subject} • {m.studentCount} Students</p>

                  {/* Stat rows */}
                  <div className="space-y-2.5 mb-5 pb-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Attendance Rate</span>
                      <span className={`text-sm font-bold ${m.atndRaw >= 85 ? 'text-emerald-600' : m.atndRaw >= 0 ? 'text-amber-600' : 'text-slate-400'}`}>{m.atndDisplay}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Avg. Performance</span>
                      <span className={`text-sm font-bold ${m.perfRaw >= 60 ? 'text-emerald-600' : m.perfRaw >= 0 ? 'text-rose-600' : 'text-slate-400'}`}>{m.perfDisplay}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Next Class</span>
                      <span className="text-sm font-bold text-blue-600">{nextTime ? `Today, ${nextTime}` : '—'}</span>
                    </div>
                  </div>

                  {/* Buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/my-classes/${cls.id}`); }}
                      className="py-2.5 rounded-lg bg-[#1e3272] text-white text-sm font-semibold hover:bg-[#162552] transition-colors"
                    >
                      View Class
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate('/attendance'); }}
                      className="py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      Attendance
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default MyClasses;