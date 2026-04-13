import { useState, useEffect } from "react";
import ConceptMasteryDetail from "@/components/ConceptMasteryDetail";
import { Loader2, Search } from "lucide-react";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, getDocs, where } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";

const pctTextColor = (pct: number) => {
  if (pct >= 80) return "text-emerald-600 font-semibold";
  if (pct >= 50) return "text-amber-500 font-semibold";
  if (pct >= 1) return "text-rose-600 font-semibold";
  return "text-slate-300";
};

const avatarColors = [
  "bg-blue-600", "bg-indigo-600", "bg-violet-600", "bg-teal-600",
  "bg-cyan-600", "bg-rose-500", "bg-amber-500", "bg-emerald-600",
];

const ConceptMastery = () => {
  const { teacherData } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState<any>(null);

  const [dynamicHeaders, setDynamicHeaders] = useState<string[]>([]);
  const [masteryData, setMasteryData] = useState<any[]>([]);
  const [classAverages, setClassAverages] = useState<number[]>([]);

  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // 1. Fetch Teacher's Active Assignments (scoped by school)
  useEffect(() => {
    if (!teacherData?.id) return;
    const schoolId = teacherData.schoolId as string | undefined;
    const branchId = teacherData.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
    if (branchId) SC.push(where("branchId", "==", branchId));

    let unsub: (() => void) | null = null;
    let cancelled = false; // Guard against orphaned listeners if component unmounts during getDocs

    // Fetch all school classes ONCE before setting up the listener.
    // Fixes two issues: (a) getDocs was being called inside onSnapshot on every update,
    // causing a read storm; (b) classMap is now stable for the lifetime of the listener.
    const init = async () => {
      const classSnap = await getDocs(query(collection(db, "classes"), ...SC));
      if (cancelled) return; // Component unmounted while getDocs was in flight — abort
      const classMap = new Map<string, any>();
      classSnap.docs.forEach(d => classMap.set(d.id, d.data()));
      // Legacy options: classes directly owned by this teacher (subset of classSnap)
      const legacyOptions = classSnap.docs
        .filter(d => d.data().teacherId === teacherData.id)
        .map(d => ({ id: d.id, classId: d.id, name: d.data().name }));

      // No status filter in Firestore query — filter in memory.
      // Handles "active"/"Active" casing mismatch and legacy docs without a status field.
      const q = query(collection(db, "teaching_assignments"), where("teacherId", "==", teacherData.id), ...SC);
      unsub = onSnapshot(q, (snap) => {
        const assignments = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(a => !a.status || a.status.toLowerCase() === "active");

        const assignmentOptions = assignments.map(a => {
          const cls = classMap.get(a.classId);
          return {
            id: a.id,
            classId: a.classId,
            name: `${cls?.name || "Class"} - ${a.subjectName || a.subject || "Subject"}`,
          };
        });

        const combined = [...assignmentOptions];
        legacyOptions.forEach(lo => { if (!combined.some(c => c.classId === lo.classId)) combined.push(lo); });

        setClasses(combined);
        if (combined.length > 0 && !selectedClassId) setSelectedClassId(combined[0].id);
        if (combined.length === 0) setLoading(false);
      });
    };

    init();
    return () => { cancelled = true; unsub?.(); };
  }, [teacherData?.id]);

  // 2. LIVE SYNC ENGINE — flat parallel listeners, debounced compute, full cleanup
  useEffect(() => {
    if (!teacherData?.id || !selectedClassId) return;
    setLoading(true);

    const selAssignment = classes.find(c => c.id === selectedClassId);
    const targetClassId = selAssignment?.classId || selectedClassId;

    const schoolId = teacherData.schoolId as string | undefined;
    const branchId = teacherData.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
    if (branchId) SC.push(where("branchId", "==", branchId));

    // Shared closure data — updated by each listener independently
    let gbCols: any[] = [];
    let classTests: any[] = [];
    let roster: any[] = [];
    let s1: any[] = [];
    let s2: any[] = [];
    let s3: any[] = [];
    let computeTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleCompute = () => {
      if (computeTimer) clearTimeout(computeTimer);
      computeTimer = setTimeout(runCompute, 30);
    };

    const runCompute = () => {
      const potentialTopicsSet = new Set<string>();
      classTests.forEach(t => { if (t.topics && Array.isArray(t.topics)) t.topics.forEach((c: string) => potentialTopicsSet.add(c.toUpperCase())); });
      gbCols.forEach(col => { if (col.name) potentialTopicsSet.add(col.name.toUpperCase()); });
      const potentialTopics = Array.from(potentialTopicsSet).sort();

      const activeConceptsMap = new Map<string, boolean>();
      const builtMatrix = roster.map((s: any) => {
        const sEmail = s.email?.toLowerCase();
        const sId = s.realId;
        const filterByStudent = (arr: any[]) => arr.filter(item =>
          (sId && (item.studentId === sId || item.id?.includes(sId))) ||
          (sEmail && item.studentEmail?.toLowerCase() === sEmail)
        );

        const sSum = filterByStudent(s1);
        const sFor = filterByStudent(s2);
        const sRes = filterByStudent(s3);

        const conceptScores = potentialTopics.map(concept => {
          const rSum = sSum.filter(sc => classTests.find(t => t.id === sc.testId)?.topics?.some((t: any) => t.trim().toUpperCase() === concept));
          const rFor = sFor.filter(sc => sc.columnName?.trim().toUpperCase() === concept || sc.columnId === gbCols.find(c => c.name?.trim().toUpperCase() === concept)?.id);
          const rRes = sRes.filter(sc => sc.testName?.trim().toUpperCase() === concept || sc.assignmentTitle?.trim().toUpperCase() === concept || sc.title?.trim().toUpperCase() === concept);

          const combined = [...rSum, ...rFor, ...rRes];
          if (combined.length === 0) return 0;
          activeConceptsMap.set(concept, true);

          let total = 0, count = 0;
          combined.forEach(sc => {
            const pct = Number(sc.percentage ?? (sc.mark / sc.maxMarks * 100) ?? (sc.score / sc.maxScore * 100) ?? sc.score ?? 0);
            if (pct >= 0) { total += pct; count++; }
          });
          return count > 0 ? Math.round(total / count) : 0;
        });
        return { ...s, rawConcepts: conceptScores };
      });

      const filteredHeaders = potentialTopics.filter(h => activeConceptsMap.has(h));
      setDynamicHeaders(filteredHeaders);

      const final = builtMatrix.map(s => ({
        ...s,
        concepts: potentialTopics
          .map((h, i) => ({ h, v: s.rawConcepts[i] }))
          .filter(it => activeConceptsMap.has(it.h))
          .map(it => it.v),
      })).sort((a, b) => a.name.localeCompare(b.name));

      const avgs = filteredHeaders.map((_, idx) => {
        let sum = 0, count = 0;
        final.forEach(st => { if (st.concepts[idx] > 0) { sum += st.concepts[idx]; count++; } });
        return count > 0 ? Math.round(sum / count) : 0;
      });

      setClassAverages(avgs);
      setMasteryData(final);
      setLoading(false);
    };

    // 6 parallel flat listeners — all cleaned up on unmount
    const unsub1 = onSnapshot(
      query(collection(db, "gradebook_columns"), where("classId", "==", targetClassId), ...SC),
      (snap) => { gbCols = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)); scheduleCompute(); }
    );
    const unsub2 = onSnapshot(
      query(collection(db, "tests_registry"), where("classId", "==", targetClassId), ...SC),
      (snap) => { classTests = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)); scheduleCompute(); }
    );
    const unsub3 = onSnapshot(
      query(collection(db, "enrollments"), where("classId", "==", targetClassId), ...SC),
      (snap) => {
        roster = snap.docs.map((d, idx) => {
          const e = d.data();
          return {
            id: d.id,
            realId: e.studentId,
            email: e.studentEmail,
            name: e.studentName,
            initials: e.studentName?.substring(0, 2).toUpperCase() || "SC",
            color: avatarColors[idx % avatarColors.length],
          };
        });
        scheduleCompute();
      }
    );
    const unsub4 = onSnapshot(
      query(collection(db, "test_scores"), where("classId", "==", targetClassId), ...SC),
      (snap) => { s1 = snap.docs.map(d => d.data()); scheduleCompute(); }
    );
    const unsub5 = onSnapshot(
      query(collection(db, "gradebook_scores"), where("classId", "==", targetClassId), ...SC),
      (snap) => { s2 = snap.docs.map(d => d.data()); scheduleCompute(); }
    );
    const unsub6 = onSnapshot(
      query(collection(db, "results"), where("classId", "==", targetClassId), ...SC),
      (snap) => { s3 = snap.docs.map(d => d.data()); scheduleCompute(); }
    );

    return () => {
      if (computeTimer) clearTimeout(computeTimer);
      unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6();
    };
  }, [teacherData?.id, selectedClassId, classes]);

  const filtered = masteryData.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()));
  const weakConcepts = dynamicHeaders
    .map((h, i) => ({ h, avg: classAverages[i] }))
    .filter(c => c.avg > 0 && c.avg < 80)
    .sort((a, b) => a.avg - b.avg);

  const selectedClass = classes.find(c => c.id === selectedClassId);

  const exportCSV = () => {
    const rows = [["Student", ...dynamicHeaders].join(",")];
    masteryData.forEach(s => rows.push([`"${s.name}"`, ...s.concepts.map((c: number) => c > 0 ? `${c}%` : "")].join(",")));
    rows.push(["Class Avg", ...classAverages.map(a => a > 0 ? `${a}%` : "")].join(","));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "concept_mastery.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const formatHeader = (h: string) => {
    return h.charAt(0).toUpperCase() + h.slice(1).toLowerCase().replace(/_/g, " ");
  };

  if (selectedStudent) {
    return (
      <ConceptMasteryDetail
        student={selectedStudent}
        concepts={dynamicHeaders}
        scores={selectedStudent.concepts}
        className={selectedClass?.name || ""}
        onBack={() => setSelectedStudent(null)}
      />
    );
  }

  return (
    <div className="animate-in fade-in duration-500 pb-20">

      {/* Header */}
      <div className="mb-6">        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Concept Mastery</h1>
            <p className="text-sm text-slate-400 mt-1">Track student understanding across all assessed concepts.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search student..."
                className="pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-full sm:w-40 bg-white"
              />
            </div>
            <button
              onClick={exportCSV}
              disabled={masteryData.length === 0}
              className="px-3 sm:px-4 py-2 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors bg-white disabled:opacity-40"
            >
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Legend + Class Selector */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        {classes.length > 0 && (
          <select
            value={selectedClassId}
            onChange={e => setSelectedClassId(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none bg-white"
          >
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-5 flex-wrap ml-auto">
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /><span className="text-xs text-slate-500">Mastered (80%+)</span></div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /><span className="text-xs text-slate-500">Developing (50-79%)</span></div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-rose-500 inline-block" /><span className="text-xs text-slate-500">Weak (&lt;50%)</span></div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-slate-200 inline-block" /><span className="text-xs text-slate-500">Not Assessed</span></div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-slate-300" />
        </div>
      ) : masteryData.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center shadow-sm">
          <p className="text-sm text-slate-400">No data found. Add gradebook columns or test scores to see concept mastery.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm mb-5">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="py-4 px-5 text-left text-xs font-semibold text-slate-500 sticky left-0 bg-white z-10 min-w-[180px]">Student</th>
                  {dynamicHeaders.map(h => (
                    <th key={h} className="py-4 px-4 text-center text-xs font-semibold text-slate-500 min-w-[110px]">
                      {formatHeader(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedStudent(s)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="py-3.5 px-5 sticky left-0 bg-white border-r border-slate-50 z-10">
                      <div className="flex items-start gap-2.5">
                        <div className={`w-8 h-8 rounded-lg ${s.color} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5`}>
                          {s.initials}
                        </div>
                        <div>
                          <p className="text-[11px] font-bold text-slate-500">{s.initials}</p>
                          <p className="text-sm font-semibold text-slate-800 whitespace-nowrap">{s.name}</p>
                        </div>
                      </div>
                    </td>
                    {s.concepts.map((c: number, i: number) => (
                      <td key={i} className="py-3.5 px-4 text-center">
                        <span className={`text-sm ${pctTextColor(c)}`}>{c > 0 ? `${c}%` : "—"}</span>
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Class Avg Row */}
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td className="py-3.5 px-5 sticky left-0 bg-slate-50 z-10 border-r border-slate-100">
                    <span className="text-sm font-bold text-slate-700">Class Avg</span>
                  </td>
                  {classAverages.map((avg, i) => (
                    <td key={i} className="py-3.5 px-4 text-center">
                      <span className={`text-sm font-bold ${pctTextColor(avg)}`}>{avg > 0 ? `${avg}%` : "—"}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Weak Concepts Requiring Attention */}
      {!loading && weakConcepts.length > 0 && (
        <div className="border border-rose-200 bg-rose-50/40 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Weak Concepts Requiring Attention</h3>
          <div className="flex flex-wrap gap-2">
            {weakConcepts.map(c => (
              <span
                key={c.h}
                className={`text-xs font-semibold px-4 py-2 rounded-full ${c.avg < 50 ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"}`}
              >
                {formatHeader(c.h)} (Class Avg: {c.avg}%)
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConceptMastery;
