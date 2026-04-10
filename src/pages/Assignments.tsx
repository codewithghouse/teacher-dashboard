import React, { useState, useEffect } from "react";
import CreateAssignment from "@/components/CreateAssignment";
import GradeAssignment from "@/components/GradeAssignment";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  doc, deleteDoc, getDocs
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import {
  Loader2, Plus, Search, Trash2, ChevronLeft, ChevronRight
} from "lucide-react";
import { toast } from "sonner";

const ITEMS_PER_PAGE = 8;

const statusStyle = (status: string) => {
  if (status.includes("To Grade"))      return "bg-amber-50 text-amber-700";
  if (status === "Fully Submitted")     return "bg-emerald-50 text-emerald-700";
  if (status === "Completed")           return "bg-slate-100 text-slate-500";
  if (status === "Active")              return "bg-blue-50 text-blue-700";
  return "bg-slate-50 text-slate-500";
};

const timeRemaining = (date: Date) => {
  const diff = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (diff === 0)  return "Due Today";
  if (diff === 1)  return "Tomorrow";
  if (diff < 0)   return `${Math.abs(diff)}d ago`;
  return `${diff} days left`;
};

const Assignments = () => {
  const { teacherData } = useAuth();
  const [view, setView]                     = useState<"list" | "create" | "grade">("list");
  const [selectedAssignment, setSelectedAssignment] = useState<any>(null);
  const [assignments, setAssignments]       = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [search, setSearch]                 = useState("");
  const [page, setPage]                     = useState(1);
  const [stats, setStats]                   = useState({
    totalActive: 0, dueThisWeek: 0, pendingGrading: 0, avgSubmission: 0,
  });

  useEffect(() => {
    if (!teacherData?.id) return;
    setLoading(true);

    const unsub = onSnapshot(
      query(
        collection(db, "teaching_assignments"),
        where("teacherId", "==", teacherData.id),
        where("status", "==", "active")
      ),
      async (assignSnap) => {
        const teachingAssignments = assignSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        const assignedClassIds    = teachingAssignments.map(t => t.classId).filter(Boolean);

        // Legacy classes
        const legacySnap    = await getDocs(query(collection(db, "classes"), where("teacherId", "==", teacherData.id)));
        const legacyIds     = legacySnap.docs.map(d => d.id);
        const allClassIds   = Array.from(new Set([...assignedClassIds, ...legacyIds]));

        if (!allClassIds.length) {
          setAssignments([]);
          setStats({ totalActive: 0, dueThisWeek: 0, pendingGrading: 0, avgSubmission: 0 });
          setLoading(false);
          return;
        }

        // Fetch assignments from all class IDs
        const snaps = await Promise.all(
          allClassIds.map(cid =>
            getDocs(query(collection(db, "assignments"), where("classId", "==", cid), where("teacherId", "==", teacherData.id)))
          )
        );
        const map = new Map<string, any>();
        snaps.forEach(s => s.docs.forEach(d => {
          if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
        }));
        const raw = Array.from(map.values());

        const now      = new Date();
        const nextWeek = new Date(now.getTime() + 7 * 86400000);

        const enriched = await Promise.all(raw.map(async (a: any) => {
          // Parse deadline
          let deadline: Date;
          if      (a.dueDate?.toDate)  deadline = a.dueDate.toDate();
          else if (a.dueDate)          deadline = new Date(a.dueDate);
          else if (a.deadline)         deadline = new Date(a.deadline);
          else if (a.createdAt?.toDate) deadline = new Date(a.createdAt.toDate().getTime() + 7 * 86400000);
          else                          deadline = new Date();
          if (isNaN(deadline.getTime())) deadline = new Date();

          // Submissions
          const [s1, s2] = await Promise.all([
            getDocs(query(collection(db, "submissions"), where("homeworkId",   "==", a.id))),
            getDocs(query(collection(db, "submissions"), where("assignmentId", "==", a.id))),
          ]);
          const subMap = new Map<string, any>();
          s1.docs.forEach(d => subMap.set(d.data().studentId || d.data().studentEmail || d.id, d));
          s2.docs.forEach(d => { const k = d.data().studentId || d.data().studentEmail || d.id; if (!subMap.has(k)) subMap.set(k, d); });
          const subCount = subMap.size;

          const [resSnap, enrollSnap] = await Promise.all([
            getDocs(query(collection(db, "results"), where("assignmentId", "==", a.id))),
            getDocs(query(collection(db, "enrollments"), where("classId",   "==", a.classId))),
          ]);
          const expected    = enrollSnap.size || 1;
          const pendingGrading = Math.max(0, subCount - resSnap.size);

          let status = "Active";
          if (pendingGrading > 0)                          status = `${pendingGrading} To Grade`;
          else if (subCount >= expected && expected > 0)   status = "Fully Submitted";
          else if (deadline < now)                          status = "Completed";

          return { ...a, deadline, subCount, expected, pendingGrading, status };
        }));

        enriched.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
        setAssignments(enriched);

        const active        = enriched.filter(a => a.deadline > now).length;
        const dueSoon       = enriched.filter(a => a.deadline > now && a.deadline <= nextWeek).length;
        const pending       = enriched.reduce((acc, a) => acc + a.pendingGrading, 0);
        const totalStudents = enriched.reduce((acc, a) => acc + a.expected, 0);
        const totalSubs     = enriched.reduce((acc, a) => acc + a.subCount, 0);
        setStats({
          totalActive:   active,
          dueThisWeek:   dueSoon,
          pendingGrading: pending,
          avgSubmission: totalStudents > 0 ? Math.round((totalSubs / totalStudents) * 100) : 0,
        });
        setLoading(false);
      }
    );
    return () => unsub();
  }, [teacherData?.id]);

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, "assignments", id));
      toast.success("Assignment deleted.");
    } catch {
      toast.error("Failed to delete assignment.");
    }
  };

  if (view === "create") return <CreateAssignment onCancel={() => setView("list")} onCreate={() => setView("list")} />;
  if (view === "grade")  return <GradeAssignment assignment={selectedAssignment} onBack={() => setView("list")} />;

  const filtered  = assignments.filter(a => a.title?.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated  = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <div className="text-left space-y-5 sm:space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
            Teacher Dashboard
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Assignments</h1>
          <p className="text-slate-500 text-sm mt-1">Create, manage and grade student assignments.</p>
        </div>
        <button
          onClick={() => setView("create")}
          className="self-start sm:self-auto flex items-center gap-2 px-4 sm:px-5 py-2.5 bg-[#1e3272] text-white rounded-xl text-sm font-semibold hover:bg-[#162558] transition-all shadow-sm"
        >
          <Plus size={16} /> Create Assignment
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "Total Active",     value: stats.totalActive,    color: "bg-blue-100"    },
          { label: "Due This Week",    value: stats.dueThisWeek,    color: "bg-amber-100"   },
          { label: "Pending Grading",  value: stats.pendingGrading, color: "bg-rose-100"    },
          { label: "Avg. Submission",  value: `${stats.avgSubmission}%`, color: "bg-emerald-100" },
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

      {/* Search bar */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search assignments..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 h-9 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        {/* Loading / empty states */}
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-6 h-6 text-[#1e3272] animate-spin" />
          </div>
        ) : paginated.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-300 font-semibold">
            No assignments found. Create your first one!
          </div>
        ) : (
          <>
            {/* ── Mobile: card list (hidden on md+) ── */}
            <div className="md:hidden divide-y divide-slate-100">
              {paginated.map(a => (
                <div key={a.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 leading-tight">{a.title}</p>
                      {a.description && (
                        <p className="text-xs text-slate-400 mt-0.5 truncate">{a.description}</p>
                      )}
                    </div>
                    <span className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap ${statusStyle(a.status)}`}>
                      {a.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Class: <strong className="text-slate-700">{a.className || "—"}</strong></span>
                    <span>Due: <strong className="text-slate-700">{timeRemaining(a.deadline)}</strong></span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Submissions</span>
                      <span className="font-semibold text-slate-700">{a.subCount} / {a.expected}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, (a.subCount / a.expected) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => { setSelectedAssignment(a); setView("grade"); }}
                      className="flex-1 py-2 text-xs font-semibold text-white bg-[#1e3272] rounded-xl hover:bg-[#162558] transition-all"
                    >
                      Grade
                    </button>
                    <button
                      onClick={() => handleDelete(a.id, a.title)}
                      className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Desktop: table (hidden on mobile) ── */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500">Assignment</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500">Class</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500">Due Date</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Submissions</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-center">Status</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginated.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold text-slate-800 group-hover:text-[#1e3272] transition-colors">{a.title}</p>
                        {a.description && (
                          <p className="text-xs text-slate-400 mt-0.5 max-w-[200px] truncate">{a.description}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">{a.className || "—"}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-700">{timeRemaining(a.deadline)}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-sm font-semibold text-slate-700">
                            {a.subCount}<span className="text-slate-400 font-normal"> / {a.expected}</span>
                          </span>
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, (a.subCount / a.expected) * 100)}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${statusStyle(a.status)}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => { setSelectedAssignment(a); setView("grade"); }}
                            className="px-3 py-1.5 text-xs font-semibold text-[#1e3272] hover:bg-blue-50 rounded-lg transition-all"
                          >
                            Grade
                          </button>
                          <button
                            onClick={() => handleDelete(a.id, a.title)}
                            className="p-1.5 text-slate-300 hover:text-rose-500 rounded-lg transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Pagination */}
        {!loading && filtered.length > ITEMS_PER_PAGE && (
          <div className="px-4 sm:px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500 hidden sm:block">
              Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-semibold ${
                    p === page ? "bg-[#1e3272] text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Assignments;
