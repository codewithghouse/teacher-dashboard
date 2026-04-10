import React, { useState, useEffect } from "react";
import StudentProfile from "@/components/StudentProfile";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs, deleteDoc, doc as firestoreDoc } from "firebase/firestore";
import { Search, Loader2, Trash2, Users, TrendingUp, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { toast } from "sonner";

const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-indigo-500",
  "bg-purple-500", "bg-rose-500", "bg-amber-500", "bg-teal-500"
];

function getAvatarColor(name: string) {
  return AVATAR_COLORS[Math.abs((name || "").charCodeAt(0)) % AVATAR_COLORS.length];
}

export default function Students() {
  const { teacherData } = useAuth();

  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterClass, setFilterClass] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;


  useEffect(() => {
    if (!teacherData?.id) return;
    setLoading(true);

    try {
      const qEnroll = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));

      const unsubEnroll = onSnapshot(qEnroll, async (snap) => {
        const enrolledDocs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        const uniqueMap = new Map();

        enrolledDocs.forEach(e => {
          const sid = e.studentId || e.studentEmail;
          if (!uniqueMap.has(sid)) {
            uniqueMap.set(sid, {
              id: sid,
              name: e.studentName,
              email: e.studentEmail,
              rollNo: e.rollNo || (800 + Math.floor(Math.random() * 100)).toString(),
              className: e.className,
              classId: e.classId,
              initials: e.studentName?.substring(0, 2).toUpperCase() || "ST",
              attendancePct: 0,
              avgScorePct: 0,
              statusTag: "Good"
            });
          }
        });

        const studentsArray = Array.from(uniqueMap.values());

        const qScores = query(collection(db, "test_scores"), where("teacherId", "==", teacherData.id));
        const scoresSnap = await getDocs(qScores);
        const scoresData = scoresSnap.docs.map(d => d.data());

        const qAtt = query(collection(db, "attendance"), where("teacherId", "==", teacherData.id));
        const attSnap = await getDocs(qAtt);
        const attData = attSnap.docs.map(d => d.data());

        const final = studentsArray.map(stu => {
          const stuScores = scoresData.filter(s =>
            (s.studentId && s.studentId === stu.id) ||
            (s.studentEmail && stu.email && s.studentEmail.toLowerCase() === stu.email.toLowerCase())
          );

          let totalPct = 0, count = 0;
          stuScores.forEach(s => { if (!s.isAbsent && s.percentage) { totalPct += s.percentage; count++; } });
          const avg = count > 0 ? (totalPct / count) : 0;

          const stuAtt = attData.filter(a =>
            (a.studentId && a.studentId === stu.id) ||
            (a.studentEmail && stu.email && a.studentEmail.toLowerCase() === stu.email.toLowerCase())
          );
          const present = stuAtt.filter(a => a.status?.toLowerCase() === "present" || a.status?.toLowerCase() === "late").length;
          const attPct = stuAtt.length > 0 ? (present / stuAtt.length) * 100 : 100;

          let tag = "Good";
          if (avg < 60 || attPct < 85) tag = "Attention";
          if (avg > 0 && avg < 45) tag = "At Risk";

          return { ...stu, avgScorePct: avg, attendancePct: attPct, statusTag: tag };
        });

        final.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setStudents(final);
        setLoading(false);
      });

      return () => { unsubEnroll(); };
    } catch (e) {
      console.error("Students fetch error", e);
      setLoading(false);
    }
  }, [teacherData?.id]);

  const handleDelete = async (student: any) => {
    if (!teacherData?.id) return;
    if (!confirm(`Remove ${student.name} from your class?`)) return;
    try {
      const q = query(
        collection(db, "enrollments"),
        where("teacherId", "==", teacherData.id),
        where("studentEmail", "==", student.email),
        where("classId", "==", student.classId)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        await deleteDoc(firestoreDoc(db, "enrollments", snap.docs[0].id));
        toast.success(`${student.name} removed successfully.`);
      }
    } catch {
      toast.error("Failed to remove student. Please try again.");
    }
  };

  if (selectedStudent) return <StudentProfile student={selectedStudent} onBack={() => setSelectedStudent(null)} />;

  const uniqueClasses = [...new Set(students.map(s => s.className).filter(Boolean))];

  const filtered = students.filter(s => {
    const matchSearch = s.name?.toLowerCase().includes(search.toLowerCase()) || s.rollNo?.includes(search);
    const matchStatus = filterStatus === "All" || s.statusTag === filterStatus;
    const matchClass = filterClass === "All" || s.className === filterClass;
    return matchSearch && matchStatus && matchClass;
  });

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const goodCount = students.filter(s => s.statusTag === "Good").length;
  const attentionCount = students.filter(s => s.statusTag === "Attention").length;
  const atRiskCount = students.filter(s => s.statusTag === "At Risk").length;

  return (
    <div className="animate-in fade-in duration-500 pb-20">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 sm:mb-8 gap-3">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Teacher Dashboard</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Students</h1>
          <p className="text-sm text-slate-500 mt-1">View and manage all your students across classes.</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {[
          { label: "Total Students", value: students.length, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Performing Well", value: goodCount, icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Need Attention", value: attentionCount, icon: TrendingUp, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "At Risk", value: atRiskCount, icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-50" },
        ].map(stat => (
          <div key={stat.label} className="bg-white border border-slate-100 rounded-2xl p-5 flex items-center gap-4 shadow-sm">
            <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{stat.value}</p>
              <p className="text-xs text-slate-400">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-6 sm:mb-8">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
            placeholder="Search by name or roll number..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1); }}
            className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all cursor-pointer"
          >
            <option value="All">All Status</option>
            <option value="Good">Good</option>
            <option value="Attention">Attention</option>
            <option value="At Risk">At Risk</option>
          </select>
          <select
            value={filterClass}
            onChange={e => { setFilterClass(e.target.value); setCurrentPage(1); }}
            className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all cursor-pointer"
          >
            <option value="All">All Classes</option>
            {uniqueClasses.map(cls => (
              <option key={cls} value={cls}>{cls}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Student Grid */}
      {loading ? (
        <div className="py-40 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-10 h-10 text-[#1e3a8a] animate-spin opacity-40" />
          <p className="text-sm text-slate-400">Loading students...</p>
        </div>
      ) : paginated.length === 0 ? (
        <div className="py-32 flex flex-col items-center justify-center gap-3">
          <Users className="w-12 h-12 text-slate-200" />
          <p className="text-slate-500 font-medium">No students found</p>
          <p className="text-sm text-slate-400">Try changing your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {paginated.map(student => {
            const statusStyles = {
              "Good": { badge: "bg-emerald-50 text-emerald-600 border border-emerald-100", bar: "bg-emerald-500" },
              "Attention": { badge: "bg-amber-50 text-amber-600 border border-amber-100", bar: "bg-amber-400" },
              "At Risk": { badge: "bg-rose-50 text-rose-600 border border-rose-100", bar: "bg-rose-500" },
            }[student.statusTag] || { badge: "bg-slate-50 text-slate-500", bar: "bg-slate-300" };

            return (
              <div
                key={student.id}
                className="bg-white border border-slate-100 rounded-2xl p-6 hover:shadow-lg hover:border-slate-200 transition-all flex flex-col group"
              >
                {/* Card Top */}
                <div className="flex justify-between items-start mb-5">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-bold shadow-sm ${getAvatarColor(student.name)}`}>
                    {student.initials}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusStyles.badge}`}>
                      {student.statusTag}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(student); }}
                      className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                      title="Remove student"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Student Info */}
                <h3 className="text-base font-bold text-slate-800 leading-tight mb-0.5">{student.name}</h3>
                <p className="text-xs text-slate-400 mb-5">Class {student.className} &bull; Roll: {student.rollNo}</p>

                {/* Stats */}
                <div className="space-y-3 mb-5">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-slate-400">Attendance</span>
                      <span className={`text-xs font-bold ${student.attendancePct >= 90 ? "text-emerald-600" : student.attendancePct >= 75 ? "text-amber-600" : "text-rose-600"}`}>
                        {student.attendancePct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${student.attendancePct >= 90 ? "bg-emerald-500" : student.attendancePct >= 75 ? "bg-amber-400" : "bg-rose-500"}`}
                        style={{ width: `${Math.min(student.attendancePct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-slate-400">Avg. Score</span>
                      <span className={`text-xs font-bold ${student.avgScorePct >= 75 ? "text-emerald-600" : student.avgScorePct >= 50 ? "text-amber-600" : student.avgScorePct === 0 ? "text-slate-400" : "text-rose-600"}`}>
                        {student.avgScorePct > 0 ? `${student.avgScorePct.toFixed(1)}%` : "No data"}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${student.avgScorePct >= 75 ? "bg-emerald-500" : student.avgScorePct >= 50 ? "bg-amber-400" : "bg-rose-500"}`}
                        style={{ width: `${Math.min(student.avgScorePct, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Action */}
                <button
                  onClick={() => setSelectedStudent(student)}
                  className="w-full mt-auto bg-slate-900 text-white py-2.5 rounded-xl text-xs font-semibold hover:bg-[#1e3a8a] transition-all"
                >
                  View Profile
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 sm:mt-8 gap-2">
          <p className="text-xs text-slate-400 hidden sm:block">
            Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filtered.length)}–{Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length} students
          </p>
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${currentPage === page ? "bg-[#1e3a8a] text-white" : "text-slate-500 hover:bg-slate-50 border border-slate-200"}`}
              >
                {page}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
