import React, { useState, useEffect, useMemo } from "react";
import CreateTest from "../components/CreateTest";
import EnterScores from "../components/EnterScores";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, Plus, Search } from "lucide-react";

const statusStyle = (s: string) => {
  if (s === "Completed")      return "bg-emerald-50 text-emerald-700";
  if (s === "Pending Scores") return "bg-amber-50 text-amber-700";
  if (s === "Draft")          return "bg-slate-100 text-slate-500";
  return "bg-blue-50 text-blue-700";
};

const daysLabel = (dateStr: string) => {
  if (!dateStr) return "";
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (diff < 0)   return `${Math.abs(diff)}d ago`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `In ${diff} days`;
};

const daysUrgent = (dateStr: string) => {
  if (!dateStr) return false;
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  return diff >= 0 && diff <= 3;
};

export default function TestsExams() {
  const { teacherData } = useAuth();
  const [view, setView]               = useState<"list" | "create" | "enter-scores">("list");
  const [selectedTest, setSelectedTest] = useState<any>(null);
  const [tests, setTests]             = useState<any[]>([]);
  const [scores, setScores]           = useState<any[]>([]);
  const [classes, setClasses]         = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState("");

  // Fetch tests (real-time)
  useEffect(() => {
    if (!teacherData?.id) return;
    const unsub = onSnapshot(
      query(collection(db, "tests"), where("teacherId", "==", teacherData.id)),
      async (snap) => {
        const raw = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        raw.sort((a, b) => {
          const dA = a.testDate ? new Date(a.testDate).getTime() : (a.createdAt?.toDate?.()?.getTime?.() || 0);
          const dB = b.testDate ? new Date(b.testDate).getTime() : (b.createdAt?.toDate?.()?.getTime?.() || 0);
          return dA - dB;
        });

        // Enrich each test with student count from enrollments
        const enriched = await Promise.all(raw.map(async t => {
          if (!t.classId) return { ...t, studentsCount: 0 };
          const enSnap = await getDocs(query(collection(db, "enrollments"), where("classId", "==", t.classId)));
          return { ...t, studentsCount: enSnap.size };
        }));
        setTests(enriched);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [teacherData?.id]);

  // Fetch test_scores for this teacher (real-time — for avg calculation)
  useEffect(() => {
    if (!teacherData?.id) return;
    const unsub = onSnapshot(
      query(collection(db, "test_scores"), where("teacherId", "==", teacherData.id)),
      snap => setScores(snap.docs.map(d => d.data()))
    );
    return () => unsub();
  }, [teacherData?.id]);

  // Fetch classes for per-class avg
  useEffect(() => {
    if (!teacherData?.id) return;
    getDocs(query(collection(db, "classes"), where("teacherId", "==", teacherData.id)))
      .then(snap => setClasses(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [teacherData?.id]);

  // Stats
  const stats = useMemo(() => {
    const upcoming      = tests.filter(t => t.status !== "Completed" && t.status !== "Pending Scores").length;
    const completed     = tests.filter(t => t.status === "Completed").length;
    const pendingScores = tests.filter(t => t.status === "Pending Scores" || t.status === "Draft").length;
    const total         = scores.length;
    const sum           = scores.reduce((a, s) => a + parseFloat(s.percentage || s.score || 0), 0);
    const classAvg      = total > 0 ? (sum / total).toFixed(1) : "—";
    return { upcoming, completed, pendingScores, classAvg };
  }, [tests, scores]);

  // Per-class average (right panel)
  const classPerf = useMemo(() => {
    return classes.map(cls => {
      const clsScores = scores.filter(s => {
        // match by classId if available, else just show all teacher scores per class
        return true; // test_scores may not have classId — show overall per class enrolled
      });
      // Use test-level matching: tests for this class
      const clsTests  = tests.filter(t => t.classId === cls.id).map(t => t.id);
      const clsScoreArr = scores.filter(s => clsTests.includes(s.testId || ""));
      const avg = clsScoreArr.length > 0
        ? clsScoreArr.reduce((a, s) => a + parseFloat(s.percentage || s.score || 0), 0) / clsScoreArr.length
        : null;
      return { name: cls.name, avg };
    }).filter(c => c.avg !== null);
  }, [classes, tests, scores]);

  // Per-topic performance (from test titles / topics field)
  const topicPerf = useMemo(() => {
    const map: Record<string, number[]> = {};
    scores.forEach(s => {
      const topic = s.topic || s.subject || s.testTitle || "General";
      if (!map[topic]) map[topic] = [];
      map[topic].push(parseFloat(s.percentage || s.score || 0));
    });
    return Object.entries(map)
      .map(([name, arr]) => ({ name, avg: arr.reduce((a, b) => a + b, 0) / arr.length }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);
  }, [scores]);

  if (view === "create")      return <CreateTest onCancel={() => setView("list")} onCreate={() => setView("list")} />;
  if (view === "enter-scores") return <EnterScores test={selectedTest} onBack={() => setView("list")} />;

  const filtered = tests.filter(t =>
    (t.title || "").toLowerCase().includes(search.toLowerCase()) ||
    (t.className || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="text-left space-y-6">

      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
            Result of click: "Tests & Exams"
          </p>
          <h1 className="text-3xl font-bold text-slate-800">Tests & Exams</h1>
          <p className="text-slate-500 text-sm mt-1">Manage tests, enter scores and analyze performance.</p>
        </div>
        <button
          onClick={() => setView("create")}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1e3272] text-white rounded-xl text-sm font-semibold hover:bg-[#162558] transition-all shadow-sm"
        >
          <Plus size={16} /> Create Test
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Upcoming",       value: stats.upcoming,      color: "bg-amber-100"   },
          { label: "Completed",      value: stats.completed,     color: "bg-blue-100"    },
          { label: "Pending Scores", value: stats.pendingScores, color: "bg-rose-100"    },
          { label: "Class Avg",      value: stats.classAvg === "—" ? "—" : `${stats.classAvg}%`, color: "bg-emerald-100" },
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

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Tests List */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
            <h2 className="text-base font-bold text-slate-800">Test Schedule</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search tests..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-4 h-9 w-44 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="p-4 space-y-3">
            {loading ? (
              <div className="py-20 flex justify-center">
                <Loader2 className="w-7 h-7 text-[#1e3272] animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center text-sm text-slate-300 font-semibold">
                No tests yet. Create your first test!
              </div>
            ) : (
              filtered.map(test => {
                const urgent = daysUrgent(test.testDate);
                return (
                  <div
                    key={test.id}
                    className={`rounded-2xl border p-5 ${urgent ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-800">{test.title || "Untitled Test"}</h3>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {test.className || "Class"} • {test.studentsCount} students
                        </p>
                      </div>
                      {test.testDate && (
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${
                          urgent ? "bg-amber-400 text-white" : "bg-blue-100 text-blue-700"
                        }`}>
                          {daysLabel(test.testDate)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500 mb-4">
                      {test.testDate  && <span>{new Date(test.testDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                      {test.duration  && <span>{test.duration}</span>}
                      {test.marks     && <span>{test.marks} marks</span>}
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${statusStyle(test.status || "Active")}`}>
                        {test.status || "Active"}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => { setSelectedTest(test); setView("enter-scores"); }}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                          urgent
                            ? "bg-[#1e3272] text-white hover:bg-[#162558]"
                            : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {urgent ? "Enter Scores" : "View Scores"}
                      </button>
                      {urgent && (
                        <button className="px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all">
                          Print
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Analytics */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 self-start">
          <h2 className="text-base font-bold text-slate-800 mb-1">Performance Overview</h2>
          <p className="text-xs text-slate-500 mb-5">Based on recorded scores</p>

          {classPerf.length > 0 ? (
            <div className="space-y-4 border-b border-slate-100 pb-5 mb-5">
              {classPerf.map((c, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-slate-700">{c.name}</span>
                    <span className={c.avg! >= 75 ? "text-emerald-500" : c.avg! >= 60 ? "text-amber-500" : "text-rose-500"}>
                      {c.avg!.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${c.avg! >= 75 ? "bg-emerald-500" : c.avg! >= 60 ? "bg-amber-500" : "bg-rose-500"}`}
                      style={{ width: `${Math.min(100, c.avg!)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-slate-300 font-semibold border-b border-slate-100 mb-5">
              No class data yet
            </div>
          )}

          <h3 className="text-sm font-bold text-slate-800 mb-3">Topic Performance</h3>
          {topicPerf.length > 0 ? (
            <div className="space-y-2.5">
              {topicPerf.map((t, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-slate-500 truncate max-w-[130px]">{t.name}</span>
                  <span className={`font-semibold ${t.avg >= 75 ? "text-emerald-500" : t.avg >= 60 ? "text-amber-500" : "text-rose-500"}`}>
                    {t.avg.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-300 font-semibold text-center py-4">No score data yet</p>
          )}
        </div>

      </div>
    </div>
  );
}
