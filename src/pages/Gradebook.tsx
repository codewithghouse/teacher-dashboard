import { useState, useEffect, useRef } from "react";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, where, setDoc, doc, writeBatch, deleteDoc, getDocs } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, Search, Download, Plus, Save, X, Settings2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ClassData { id: string; name: string; classId: string; [key: string]: any; }
interface CustomColumn { id: string; name: string; maxMarks: number; createdAt?: number; }

const getGrade = (pct: number) => {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
};

const gradeTextColor = (grade: string) => {
  if (grade === "A+" || grade === "A") return "text-emerald-500";
  if (grade === "B") return "text-blue-600";
  if (grade === "C") return "text-amber-500";
  return "text-rose-500";
};

const scoreColor = (mark: number | undefined, maxMarks: number) => {
  if (!mark && mark !== 0) return "text-slate-300";
  const pct = (mark / maxMarks) * 100;
  if (pct >= 90) return "text-emerald-500";
  if (pct >= 70) return "text-blue-600";
  if (pct >= 50) return "text-amber-500";
  return "text-rose-500";
};

export default function Gradebook() {
  const { teacherData } = useAuth();

  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [students, setStudents] = useState<any[]>([]);
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [scores, setScores] = useState<Record<string, any>>({});
  const [localScores, setLocalScores] = useState<Record<string, any>>({});

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColMax, setNewColMax] = useState("100");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Fetch Classes (scoped by school — no full collection scan)
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
    // Fixes getDocs-inside-onSnapshot read storm and the "active"/"Active" casing bug.
    const init = async () => {
      const classSnap = await getDocs(query(collection(db, "classes"), ...SC));
      if (cancelled) return; // Component unmounted while getDocs was in flight — abort
      const classMap = new Map<string, any>();
      classSnap.docs.forEach(d => classMap.set(d.id, d.data()));
      // Legacy options: classes directly owned by this teacher (subset of classSnap)
      const legacyOptions: ClassData[] = classSnap.docs
        .filter(d => d.data().teacherId === teacherData.id)
        .map(d => ({ id: d.id, classId: d.id, name: d.data().name }));

      // No status filter in Firestore query — filter in memory.
      // Handles "active"/"Active" casing mismatch and legacy docs without a status field.
      const q = query(collection(db, "teaching_assignments"), where("teacherId", "==", teacherData.id), ...SC);
      unsub = onSnapshot(q, (snap) => {
        const assignments = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(a => !a.status || a.status.toLowerCase() === "active");

        let options: ClassData[] = assignments.map(a => ({
          id: a.id,
          classId: a.classId,
          name: `${classMap.get(a.classId)?.name || "Class"} - ${a.subjectName || a.subject || "Subject"}`
        }));

        if (options.length === 0) options = legacyOptions;

        setClasses(options);
        if (options.length > 0 && !selectedClassId) setSelectedClassId(options[0].id);
        else if (options.length === 0) setLoading(false);
      });
    };

    init();
    return () => { cancelled = true; unsub?.(); };
  }, [teacherData?.id]);

  // 2. Fetch Roster & Scores (scoped by school)
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

    const u1 = onSnapshot(query(collection(db, "enrollments"), where("classId", "==", targetClassId), ...SC), (snap) => {
      const studs = snap.docs.map(d => {
        const e = d.data();
        return {
          id: e.studentId || e.studentEmail,
          realId: e.studentId,
          email: e.studentEmail,
          name: e.studentName,
          rollNo: e.rollNo || "",
          initials: e.studentName?.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) || "ST"
        };
      });
      setStudents(Array.from(new Map(studs.map(i => [i.email || i.id, i])).values()).sort((a, b) => a.name.localeCompare(b.name)));
    });

    const u2 = onSnapshot(query(collection(db, "gradebook_columns"), where("assignmentId", "==", selectedClassId), ...SC), (snap) => {
      setColumns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomColumn)).sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0)));
    });

    const u3 = onSnapshot(query(collection(db, "gradebook_scores"), where("assignmentId", "==", selectedClassId), ...SC), (snap) => {
      const fetched: any = {};
      snap.docs.forEach(d => {
        const data = d.data();
        const key = (data.studentEmail?.toLowerCase() || data.studentId);
        fetched[`${key}_${data.columnId}`] = data.mark;
      });
      setScores(fetched);
      setLocalScores(fetched);
      setLoading(false);
    });

    return () => { u1(); u2(); u3(); };
  }, [teacherData?.id, selectedClassId, classes]);

  const handleAddColumn = async () => {
    if (!newColName.trim()) return toast.error("Column name required");
    const colId = `col_${Date.now()}`;
    await setDoc(doc(db, "gradebook_columns", colId), {
      id: colId,
      assignmentId: selectedClassId,
      classId: classes.find(c => c.id === selectedClassId)?.classId || selectedClassId,
      teacherId: teacherData.id,
      schoolId: teacherData.schoolId || "",
      branchId: teacherData.branchId || "",
      name: newColName.trim(),
      maxMarks: Number(newColMax) || 100,
      createdAt: Date.now()
    });
    setShowAddCol(false);
    setNewColName("");
    setNewColMax("100");
    toast.success("Column added.");
  };

  const handleDeleteColumn = async (id: string) => {
    if (confirm("Delete this column?")) {
      await deleteDoc(doc(db, "gradebook_columns", id));
      toast.success("Column deleted.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const batch = writeBatch(db);
    let count = 0;
    students.forEach(stu => {
      columns.forEach(col => {
        const key = `${(stu.email || stu.id).toLowerCase()}_${col.id}`;
        if (localScores[key] !== scores[key]) {
          batch.set(doc(db, "gradebook_scores", `${stu.id}_${col.id}`), {
            id: `${stu.id}_${col.id}`,
            studentId: stu.realId || stu.id,
            studentEmail: stu.email?.toLowerCase() || "",
            studentName: stu.name,
            teacherId: teacherData.id,
            schoolId: teacherData.schoolId || "",
            branchId: teacherData.branchId || "",
            columnId: col.id,
            columnName: col.name,
            assignmentId: selectedClassId,
            classId: classes.find(c => c.id === selectedClassId)?.classId || selectedClassId,
            mark: Number(localScores[key]),
            maxMarks: Number(col.maxMarks) || 100,
            updatedAt: Date.now()
          }, { merge: true });
          count++;
        }
      });
    });
    if (count > 0) await batch.commit();
    setSaving(false);
    toast.success(count > 0 ? `Saved ${count} entries` : "No changes to save");
  };

  const handleExport = () => {
    const headers = ["Student", ...columns.map(c => `${c.name} (${c.maxMarks})`), "Total", "Grade"];
    const totalMax = columns.reduce((a, c) => a + c.maxMarks, 0);
    const rows = filtered.map(stu => {
      const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0);
      const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
      return [stu.name, ...columns.map(c => localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`] || ""), earned, getGrade(pct)];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gradebook");
    XLSX.writeFile(wb, `Gradebook_${selectedClass?.name || "Export"}.xlsx`);
  };

  const filtered = students.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.email?.toLowerCase().includes(search.toLowerCase())
  );

  const selectedClass = classes.find(c => c.id === selectedClassId);

  // Class averages per column
  const colAvgs = columns.map(col => {
    const vals = filtered
      .map(stu => Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${col.id}`]))
      .filter(v => !isNaN(v) && v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });
  const totalAvgEarned = colAvgs.reduce((a, b) => a + b, 0);
  const totalMax = columns.reduce((a, c) => a + c.maxMarks, 0);
  const avgGrade = totalMax > 0 ? getGrade((totalAvgEarned / totalMax) * 100) : "-";

  const hasUnsaved = JSON.stringify(localScores) !== JSON.stringify(scores);

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">

      {/* Header */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Teacher Dashboard</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Gradebook</h1>
            <p className="text-sm text-slate-400 mt-1">
              {selectedClass ? `Complete academic record for ${selectedClass.name}` : "Select a class to view gradebook"}
            </p>
          </div>
          {/* Save button — prominent on mobile */}
          <button
            onClick={handleSave}
            disabled={saving || !hasUnsaved}
            className={`self-start sm:self-auto h-10 px-5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all ${
              hasUnsaved
                ? "bg-[#1e3a8a] text-white hover:bg-blue-900"
                : "bg-slate-100 text-slate-400 cursor-not-allowed"
            }`}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
        {/* Toolbar row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 h-9 px-3 border border-slate-200 rounded-xl bg-white flex-1 min-w-0 max-w-xs">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search student..."
              className="text-sm outline-none bg-transparent text-slate-700 w-full min-w-0"
            />
          </div>
          <button
            onClick={() => setShowAddCol(v => !v)}
            className="h-9 px-3 sm:px-4 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 bg-white hover:bg-slate-50 transition-all flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Column</span><span className="sm:hidden">Column</span>
          </button>
          <button
            onClick={handleExport}
            className="h-9 px-3 sm:px-4 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 bg-white hover:bg-slate-50 transition-all flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" />
        </div>
      </div>

      {/* Class Selector */}
      {classes.length > 1 && (
        <div className="mb-5">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="w-full lg:w-72 h-10 rounded-xl bg-white border border-slate-200 text-sm">
              <SelectValue placeholder="Select class..." />
            </SelectTrigger>
            <SelectContent>
              {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Add Column Panel */}
      {showAddCol && (
        <div className="mb-5 bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row items-end gap-4">
          <div className="flex-1">
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Column Name</label>
            <input
              type="text"
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              placeholder="e.g. HW1, Quiz1, UT1"
              className="w-full h-10 border border-slate-200 rounded-xl px-4 text-sm outline-none focus:border-blue-400 bg-white"
            />
          </div>
          <div className="w-32">
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Max Marks</label>
            <input
              type="number"
              value={newColMax}
              onChange={e => setNewColMax(e.target.value)}
              className="w-full h-10 border border-slate-200 rounded-xl px-4 text-sm outline-none focus:border-blue-400 bg-white text-center"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAddCol(false)} className="h-10 px-4 border border-slate-200 rounded-xl text-sm text-slate-500 bg-white hover:bg-slate-50">Cancel</button>
            <button onClick={handleAddColumn} className="h-10 px-5 bg-[#1e3a8a] text-white rounded-xl text-sm font-semibold hover:bg-blue-900 transition-all">Add</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-300">
            <Loader2 className="w-10 h-10 animate-spin mb-3" />
            <p className="text-sm">Loading gradebook...</p>
          </div>
        ) : columns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-300">
            <Settings2 className="w-12 h-12 mb-4 text-slate-200" />
            <p className="text-base font-semibold text-slate-400">No columns yet</p>
            <p className="text-sm text-slate-300 mt-1 mb-5">Click "Add Column" to get started</p>
            <button onClick={() => setShowAddCol(true)} className="px-5 py-2.5 bg-[#1e3a8a] text-white rounded-xl text-sm font-semibold hover:bg-blue-900 transition-all">
              Add First Column
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-4 text-sm font-semibold text-slate-600 sticky left-0 bg-white z-10 min-w-[180px]">
                    Student
                  </th>
                  {columns.map(col => (
                    <th key={col.id} className="px-4 py-4 text-center min-w-[80px] relative group">
                      <p className="text-sm font-bold text-slate-700">{col.name}</p>
                      <button
                        onClick={() => handleDeleteColumn(col.id)}
                        className="absolute top-1 right-1 p-1 opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-all"
                      >
                        <X size={11} />
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-4 text-center min-w-[80px] bg-slate-50 text-sm font-bold text-slate-800">Total</th>
                  <th className="px-4 py-4 text-center min-w-[70px] bg-slate-50 text-sm font-bold text-slate-800">Grade</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(stu => {
                  const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0);
                  const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
                  const grade = getGrade(pct);
                  return (
                    <tr key={stu.email || stu.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-all">
                      {/* Student */}
                      <td className="px-5 py-3.5 sticky left-0 bg-white hover:bg-slate-50/50">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
                            {stu.initials}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{stu.name}</p>
                            {stu.rollNo && <p className="text-xs text-slate-400">{stu.rollNo}</p>}
                          </div>
                        </div>
                      </td>
                      {/* Score cells */}
                      {columns.map(col => {
                        const key = `${(stu.email || stu.id).toLowerCase()}_${col.id}`;
                        const val = localScores[key];
                        const color = scoreColor(val !== undefined && val !== "" ? Number(val) : undefined, col.maxMarks);
                        return (
                          <td key={col.id} className="px-2 py-2 text-center">
                            <input
                              type="number"
                              value={val ?? ""}
                              onChange={e => setLocalScores(prev => ({ ...prev, [key]: e.target.value === "" ? undefined : e.target.value }))}
                              placeholder="-"
                              min={0}
                              max={col.maxMarks}
                              className={`w-14 h-9 text-center text-sm font-bold bg-transparent outline-none rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all ${color} placeholder:text-slate-300`}
                            />
                          </td>
                        );
                      })}
                      {/* Total */}
                      <td className="px-4 py-3.5 text-center bg-slate-50/50">
                        <p className="text-sm font-bold text-slate-800">{earned}</p>
                      </td>
                      {/* Grade */}
                      <td className="px-4 py-3.5 text-center bg-slate-50/50">
                        <span className={`text-sm font-bold ${gradeTextColor(grade)}`}>{grade}</span>
                      </td>
                    </tr>
                  );
                })}

                {/* Class Avg Row */}
                {filtered.length > 0 && (
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td className="px-5 py-4 sticky left-0 bg-slate-50">
                      <p className="text-sm font-bold text-slate-700">Class Avg</p>
                    </td>
                    {colAvgs.map((avg, i) => (
                      <td key={columns[i]?.id} className="px-2 py-4 text-center">
                        <span className={`text-sm font-bold ${scoreColor(avg, columns[i]?.maxMarks)}`}>
                          {avg > 0 ? avg.toFixed(1) : "-"}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-4 text-center">
                      <p className="text-sm font-bold text-slate-700">{totalAvgEarned.toFixed(1)}</p>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className={`text-sm font-bold ${gradeTextColor(avgGrade)}`}>{avgGrade}</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer Legend */}
      {columns.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-slate-500">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Excellent (90%+)</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" /> Good (70-89%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Average (50-69%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> At Risk (&lt;50%)</div>
          <span className="text-slate-300">·</span>
          <span className="text-slate-400">
            Max marks: {columns.map(c => `${c.name} (${c.maxMarks})`).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}
