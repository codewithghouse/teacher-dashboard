import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, getDocs,
  doc, getDoc, updateDoc, writeBatch
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import {
  Loader2, Search, ChevronLeft, ChevronRight,
  Download, Edit2, Check, X
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const ITEMS_PER_PAGE = 5;

const getStatus = (atnd: number, score: number, manual?: string) => {
  if (manual) return manual;
  if (atnd < 75 || score < 50) return "At Risk";
  if (atnd < 85 || score < 65) return "Needs Attention";
  return "Good Standing";
};

const statusStyle = (s: string) => {
  if (s === "Good Standing") return "text-emerald-700 bg-emerald-50";
  if (s === "Needs Attention") return "text-amber-700 bg-amber-50";
  return "text-rose-700 bg-rose-50";
};

const ClassDetail = () => {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { teacherData } = useAuth();

  const [classInfo, setClassInfo] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Students");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const [editingRoll, setEditingRoll] = useState<string | null>(null);
  const [tempRoll, setTempRoll] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Subject inline editing
  const [editingSubject, setEditingSubject] = useState(false);
  const [tempSubject, setTempSubject] = useState("");
  const [isSavingSubject, setIsSavingSubject] = useState(false);

  const [stats, setStats] = useState({
    totalStudents: 0,
    attendanceRate: "—",
    avgScore: "—",
    atRiskCount: 0,
  });

  // Fetch class info
  useEffect(() => {
    if (!classId) return;
    getDoc(doc(db, "classes", classId)).then(snap => {
      if (snap.exists()) setClassInfo(snap.data());
    });
  }, [classId]);

  // Fetch students + compute metrics
  useEffect(() => {
    if (!classId) return;

    const q = query(collection(db, "enrollments"), where("classId", "==", classId));
    const unsub = onSnapshot(q, async (snap) => {
      const roster = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const enriched = await Promise.all(roster.map(async (s: any) => {
        const sid = s.studentId;
        const email = s.studentEmail?.toLowerCase();

        // Attendance
        const attQueries = await Promise.all([
          sid ? getDocs(query(collection(db, "attendance"), where("studentId", "==", sid), where("classId", "==", classId))) : Promise.resolve({ docs: [] }),
          email ? getDocs(query(collection(db, "attendance"), where("studentEmail", "==", email), where("classId", "==", classId))) : Promise.resolve({ docs: [] }),
        ]);
        const uniqueAtt = Array.from(new Map([...attQueries[0].docs, ...attQueries[1].docs].map(d => [d.id, d.data()])).values());
        const present = uniqueAtt.filter((d: any) => d.status === "present" || d.status === "late").length;
        const atndRaw = uniqueAtt.length > 0 ? (present / uniqueAtt.length) * 100 : -1;

        // Scores — try test_scores first, fallback to results
        const scoreQueries = await Promise.all([
          sid ? getDocs(query(collection(db, "test_scores"), where("studentId", "==", sid))) : Promise.resolve({ docs: [] }),
          email ? getDocs(query(collection(db, "test_scores"), where("studentEmail", "==", email))) : Promise.resolve({ docs: [] }),
          sid ? getDocs(query(collection(db, "results"), where("studentId", "==", sid), where("classId", "==", classId))) : Promise.resolve({ docs: [] }),
          email ? getDocs(query(collection(db, "results"), where("studentEmail", "==", email), where("classId", "==", classId))) : Promise.resolve({ docs: [] }),
        ]);
        const uniqueScores = Array.from(new Map([
          ...scoreQueries[0].docs, ...scoreQueries[1].docs,
          ...scoreQueries[2].docs, ...scoreQueries[3].docs
        ].map(d => [d.id, d.data()])).values());
        const totalScore = uniqueScores.reduce((acc, r: any) => acc + parseFloat(r.percentage || r.score || 0), 0);
        const scoreRaw = uniqueScores.length > 0 ? totalScore / uniqueScores.length : -1;

        const initials = (() => {
          const parts = (s.studentName || "ST").trim().split(" ");
          return parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
        })().toUpperCase();

        const atndDisplay = atndRaw >= 0 ? `${atndRaw.toFixed(1)}%` : "—";
        const scoreDisplay = scoreRaw >= 0 ? `${scoreRaw.toFixed(1)}%` : "—";
        const status = getStatus(atndRaw >= 0 ? atndRaw : 100, scoreRaw >= 0 ? scoreRaw : 100, s.manualStatus);

        return { ...s, initials, atndRaw, scoreRaw, attendance: atndDisplay, avg: scoreDisplay, status };
      }));

      setStudents(enriched);

      const totalAtnd = enriched.filter(s => s.atndRaw >= 0).reduce((a, s) => a + s.atndRaw, 0);
      const atndCount = enriched.filter(s => s.atndRaw >= 0).length;
      const totalScore = enriched.filter(s => s.scoreRaw >= 0).reduce((a, s) => a + s.scoreRaw, 0);
      const scoreCount = enriched.filter(s => s.scoreRaw >= 0).length;
      const atRisk = enriched.filter(s => s.status === "At Risk").length;

      setStats({
        totalStudents: enriched.length,
        attendanceRate: atndCount > 0 ? `${(totalAtnd / atndCount).toFixed(1)}%` : "—",
        avgScore: scoreCount > 0 ? `${(totalScore / scoreCount).toFixed(1)}%` : "—",
        atRiskCount: atRisk,
      });
      setLoading(false);
    });

    return () => unsub();
  }, [classId]);

  // Save subject → update classes doc + all enrollment docs for this class
  const handleSaveSubject = async () => {
    if (!tempSubject.trim() || !classId) return;
    setIsSavingSubject(true);
    try {
      // 1. Update the class document
      await updateDoc(doc(db, "classes", classId), { subject: tempSubject.trim() });

      // 2. Batch update all enrollments for this class
      const enrollSnap = await getDocs(query(collection(db, "enrollments"), where("classId", "==", classId)));
      if (enrollSnap.docs.length > 0) {
        const batch = writeBatch(db);
        enrollSnap.docs.forEach(d => batch.update(d.ref, { subject: tempSubject.trim() }));
        await batch.commit();
      }

      setClassInfo((prev: any) => ({ ...prev, subject: tempSubject.trim() }));
      setEditingSubject(false);
      toast.success(`Subject updated to "${tempSubject.trim()}" for all enrollments.`);
    } catch {
      toast.error("Failed to update subject.");
    } finally {
      setIsSavingSubject(false);
    }
  };

  const handleUpdateRoll = async (id: string) => {
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, "enrollments", id), { rollNo: tempRoll });
      toast.success("Roll number updated.");
      setEditingRoll(null);
    } catch {
      toast.error("Failed to update roll number.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleStatus = async (id: string, current: string) => {
    const statuses = ["Good Standing", "Needs Attention", "At Risk"];
    const next = statuses[(statuses.indexOf(current) + 1) % statuses.length];
    try {
      await updateDoc(doc(db, "enrollments", id), { manualStatus: next });
      toast.success(`Status updated to ${next}`);
    } catch {
      toast.error("Failed to update status.");
    }
  };

  const handleExport = () => {
    setExporting(true);
    try {
      const data = students.map(s => ({
        "Student Name": s.studentName,
        "Email": s.studentEmail,
        "Roll No": s.rollNo || "—",
        "Attendance": s.attendance,
        "Avg Score": s.avg,
        "Status": s.status,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Students");
      XLSX.writeFile(wb, `${classInfo?.name || "Class"}_Roster.xlsx`);
      toast.success("Roster exported!");
    } catch {
      toast.error("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  // Pagination
  const filtered = useMemo(() =>
    students.filter(s => s.studentName?.toLowerCase().includes(searchQuery.toLowerCase())),
    [students, searchQuery]
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const goPage = (p: number) => setCurrentPage(Math.max(1, Math.min(p, totalPages)));

  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1e3272] animate-spin" />
    </div>
  );

  return (
    <div className="text-left space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{classInfo?.name || "Class"}</h1>

          {/* Subject — inline editable */}
          <div className="flex items-center gap-2 mt-1">
            {editingSubject ? (
              <>
                <input
                  autoFocus
                  value={tempSubject}
                  onChange={e => setTempSubject(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSaveSubject(); if (e.key === "Escape") setEditingSubject(false); }}
                  placeholder="e.g. Mathematics"
                  className="h-8 px-3 text-sm border border-blue-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 w-44"
                />
                <button
                  onClick={handleSaveSubject}
                  disabled={isSavingSubject}
                  className="h-8 px-3 bg-[#1e3272] text-white rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-[#162558]"
                >
                  {isSavingSubject ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save
                </button>
                <button onClick={() => setEditingSubject(false)} className="h-8 px-2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button
                onClick={() => { setTempSubject(classInfo?.subject || teacherData?.subject || ""); setEditingSubject(true); }}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#1e3272] group"
              >
                <span className={classInfo?.subject ? "text-slate-600 font-medium" : "text-slate-400 italic"}>
                  {classInfo?.subject || teacherData?.subject || "Set subject..."}
                </span>
                <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
            <span className="text-slate-300">•</span>
            <span className="text-sm text-slate-500">{stats.totalStudents} Students</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export
          </button>
          <button
            onClick={() => navigate("/attendance")}
            className="px-5 py-2.5 bg-[#1e3272] text-white rounded-xl text-sm font-semibold hover:bg-[#162558] transition-all"
          >
            Mark Attendance
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 border-b border-slate-200">
        {["Students", "Attendance", "Assignments", "Tests", "Performance"].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-semibold relative transition-colors ${
              activeTab === tab ? "text-[#1e3272]" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {tab}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[#1e3272] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Students", value: stats.totalStudents, color: "bg-blue-100" },
          { label: "Attendance", value: stats.attendanceRate, color: "bg-emerald-100" },
          { label: "Avg. Score", value: stats.avgScore, color: "bg-blue-100" },
          { label: "At Risk", value: stats.atRiskCount, color: "bg-rose-100" },
        ].map(card => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex-shrink-0 ${card.color}`} />
            <div>
              <p className="text-2xl font-bold text-slate-800 leading-none mb-1">{card.value}</p>
              <p className="text-xs text-slate-500 font-medium">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Students Tab Content */}
      {activeTab === "Students" && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Table Header */}
          <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-800">Student List</h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search students..."
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pl-9 pr-4 h-9 w-44 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                onClick={() => navigate("/students")}
                className="px-4 h-9 bg-slate-50 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-100"
              >
                Add Student
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500">Student</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Roll No</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Attendance</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Avg. Score</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Status</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-400 text-sm">
                      No students found
                    </td>
                  </tr>
                ) : (
                  paginated.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-slate-400 mb-1">{s.initials}</span>
                          <span className="text-sm font-semibold text-slate-800">{s.studentName}</span>
                          <span className="text-xs text-slate-400">{s.studentEmail}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {editingRoll === s.id ? (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              className="w-16 h-7 text-center text-xs border border-slate-200 rounded-lg outline-none"
                              value={tempRoll}
                              onChange={e => setTempRoll(e.target.value)}
                              autoFocus
                            />
                            <button onClick={() => handleUpdateRoll(s.id)} disabled={isUpdating} className="text-emerald-500 hover:text-emerald-600">
                              {isUpdating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            </button>
                            <button onClick={() => setEditingRoll(null)} className="text-slate-300 hover:text-slate-500">
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div
                            className="flex items-center justify-center gap-1 cursor-pointer group/roll"
                            onClick={() => { setEditingRoll(s.id); setTempRoll(s.rollNo || ""); }}
                          >
                            <span className="text-sm font-medium text-slate-700">{s.rollNo || "—"}</span>
                            <Edit2 size={10} className="text-slate-300 opacity-0 group-hover/roll:opacity-100" />
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-slate-700">{s.attendance}</td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-slate-700">{s.avg}</td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => handleToggleStatus(s.id, s.status)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${statusStyle(s.status)}`}
                        >
                          {s.status}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => navigate(`/students`)}
                          className="text-sm font-semibold text-[#1e3272] hover:underline"
                        >
                          View Profile
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-6 py-4 flex items-center justify-between border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filtered.length)}–{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} of {filtered.length} students
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <div className="flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => goPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                      p === currentPage
                        ? "bg-[#1e3272] text-white"
                        : "border border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                onClick={() => goPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Tabs — Placeholder */}
      {activeTab !== "Students" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm font-semibold shadow-sm">
          {activeTab} view — coming soon
        </div>
      )}
    </div>
  );
};

export default ClassDetail;
