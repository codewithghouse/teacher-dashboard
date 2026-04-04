import React, { useState, useEffect } from "react";
import {
  Loader2, Check, ArrowLeft, ChevronLeft, ChevronRight
} from "lucide-react";
import { db } from "../lib/firebase";
import {
  collection, query, getDocs, where,
  serverTimestamp, setDoc, doc, onSnapshot, limit
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

// ── helpers ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-orange-500", "bg-rose-500",
  "bg-violet-500", "bg-pink-500", "bg-teal-500", "bg-amber-500",
  "bg-indigo-500", "bg-cyan-600",
];
const avatarColor = (name = "") =>
  AVATAR_COLORS[[...(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

const getInitials = (name = "") => {
  const p = name.trim().split(" ");
  return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
};

const todayStr = () => new Date().toLocaleDateString("en-CA");
const ITEMS_PER_PAGE = 8;

// ── types ─────────────────────────────────────────────────────────────────────
interface Student {
  id: string;
  enrollId: string;
  name: string;
  email: string;
  rollNo: string | number;
  status: "present" | "absent" | "late" | "none";
  note: string;
  initials: string;
  color: string;
}

interface Props {
  onBack: () => void;
  initialClassId?: string;
}

// ── component ─────────────────────────────────────────────────────────────────
const MarkAttendance = ({ onBack, initialClassId }: Props) => {
  const { teacherData } = useAuth();

  const [classes, setClasses]               = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(initialClassId || "");
  const [students, setStudents]             = useState<Student[]>([]);
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [currentPage, setCurrentPage]       = useState(1);

  // ── fetch classes ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id) return;
    const unsub = onSnapshot(
      query(collection(db, "classes"), where("teacherId", "==", teacherData.id)),
      (snap) => {
        const cls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setClasses(cls);
        if (!selectedClassId && cls.length > 0) setSelectedClassId(cls[0].id);
      }
    );
    return () => unsub();
  }, [teacherData?.id]);

  // ── fetch roster + today's attendance ────────────────────────────────────
  useEffect(() => {
    if (!selectedClassId || !teacherData?.id) return;
    setLoading(true);
    setCurrentPage(1);

    const unsub = onSnapshot(
      query(collection(db, "enrollments"), where("classId", "==", selectedClassId)),
      async (snap) => {
        try {
          // Fetch today's existing attendance logs
          const logsSnap = await getDocs(
            query(
              collection(db, "attendance"),
              where("classId", "==", selectedClassId),
              where("date", "==", todayStr())
            )
          );
          const logs = logsSnap.docs.map(d => d.data());

          const roster: Student[] = snap.docs.map(d => {
            const data = d.data() as any;
            const sId  = data.studentId || d.id;
            const log  = logs.find(l => l.studentId === sId);
            return {
              id:       sId,
              enrollId: d.id,
              name:     data.studentName || "Student",
              email:    data.studentEmail || "",
              rollNo:   data.rollNo || "—",
              status:   (log?.status as any) || "none",
              note:     log?.note || "",
              initials: getInitials(data.studentName),
              color:    avatarColor(data.studentName),
            };
          });

          roster.sort((a, b) => a.name.localeCompare(b.name));
          setStudents(roster);
        } catch (e) {
          console.error("Roster fetch error:", e);
        } finally {
          setLoading(false);
        }
      }
    );
    return () => unsub();
  }, [selectedClassId, teacherData?.id]);

  // ── live counters ──────────────────────────────────────────────────────────
  const counts = {
    present:  students.filter(s => s.status === "present").length,
    absent:   students.filter(s => s.status === "absent").length,
    late:     students.filter(s => s.status === "late").length,
    unmarked: students.filter(s => s.status === "none").length,
  };

  // ── actions ────────────────────────────────────────────────────────────────
  const setStatus = (id: string, status: Student["status"]) =>
    setStudents(prev => prev.map(s => s.id === id ? { ...s, status } : s));

  const setNote = (id: string, note: string) =>
    setStudents(prev => prev.map(s => s.id === id ? { ...s, note } : s));

  const markAllPresent = () => {
    setStudents(prev => prev.map(s => ({ ...s, status: "present" })));
    toast.success("All students marked present!");
  };

  const copyFromYesterday = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "attendance"),
          where("classId", "==", selectedClassId),
          where("teacherId", "==", teacherData.id),
          limit(200)
        )
      );
      const today = todayStr();
      const prevLogs = snap.docs
        .map(d => d.data())
        .filter((l: any) => l.date !== today)
        .sort((a: any, b: any) => b.date.localeCompare(a.date));

      if (!prevLogs.length) {
        toast.error("No previous attendance found.");
        setLoading(false);
        return;
      }
      const latestDate = prevLogs[0].date;
      const latestLogs = prevLogs.filter((l: any) => l.date === latestDate);

      setStudents(prev => prev.map(s => {
        const match = latestLogs.find((l: any) => l.studentId === s.id);
        return match ? { ...s, status: match.status as any, note: match.note || "" } : s;
      }));
      toast.success(`Copied from ${latestDate}`);
    } catch {
      toast.error("Failed to copy previous attendance.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!students.length) return toast.error("No students in this class.");
    if (counts.unmarked > 0) {
      if (!window.confirm(`${counts.unmarked} students are unmarked. Save anyway?`)) return;
    }

    setSaving(true);
    const today   = todayStr();
    const selClass = classes.find(c => c.id === selectedClassId);

    try {
      // Get teaching assignment ID
      let assignmentId = "legacy";
      const aSnap = await getDocs(
        query(
          collection(db, "teaching_assignments"),
          where("teacherId", "==", teacherData.id),
          where("classId", "==", selectedClassId),
          where("status", "==", "active")
        )
      );
      if (!aSnap.empty) assignmentId = aSnap.docs[0].id;

      const marked = students.filter(s => s.status !== "none");
      await Promise.all(
        marked.map(s =>
          setDoc(doc(db, "attendance", `${s.id}_${selectedClassId}_${today}`), {
            studentId:    s.id,
            studentName:  s.name,
            studentEmail: s.email,
            status:       s.status,
            note:         s.note || "",
            date:         today,
            teacherId:    teacherData.id,
            teacherName:  teacherData.name || "",
            schoolId:     teacherData.schoolId || "",
            branchId:     teacherData.branchId || "",
            classId:      selectedClassId,
            className:    selClass?.name || "",
            assignmentId,
            timestamp:    serverTimestamp(),
          })
        )
      );

      toast.success(`Attendance saved! ${marked.length} students recorded.`);
      onBack();
    } catch (e) {
      console.error(e);
      toast.error("Failed to save attendance. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── pagination ─────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(students.length / ITEMS_PER_PAGE));
  const paginated  = students.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const goPage     = (p: number) => setCurrentPage(Math.max(1, Math.min(p, totalPages)));

  const selClass = classes.find(c => c.id === selectedClassId);
  const dateFormatted = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });

  return (
    <div className="text-left space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={onBack}
            className="mt-1 p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
          >
            <ArrowLeft className="w-4 h-4 text-slate-500" />
          </button>
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
              Result of click: "Mark Attendance"
            </p>
            <h1 className="text-3xl font-bold text-slate-800">Mark Attendance</h1>
            <p className="text-sm text-slate-500 mt-1">
              {selClass?.name || "Class"} • {dateFormatted}
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="px-6 py-3 bg-emerald-500 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save Attendance
        </button>
      </div>

      {/* ── Quick Actions Bar ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500">Quick Actions:</span>
          <button
            onClick={markAllPresent}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"
          >
            Mark All Present
          </button>
          <button
            onClick={copyFromYesterday}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"
          >
            Copy from Yesterday
          </button>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span className="text-slate-500">Present:</span>
            <span className="font-bold text-slate-800">{counts.present}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
            <span className="text-slate-500">Absent:</span>
            <span className="font-bold text-slate-800">{counts.absent}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
            <span className="text-slate-500">Late:</span>
            <span className="font-bold text-slate-800">{counts.late}</span>
          </span>
        </div>
      </div>

      {/* ── Student Grid ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">Student Attendance</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {students.length} students • Click to toggle status
          </p>
        </div>

        {loading ? (
          <div className="py-24 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-[#1e3272] animate-spin" />
          </div>
        ) : paginated.length === 0 ? (
          <div className="py-24 text-center text-slate-300 font-semibold text-sm">
            No students enrolled in this class
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {paginated.map(student => (
              <div
                key={student.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col"
              >
                {/* Avatar + Name */}
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${student.color}`}>
                    {student.initials}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800 leading-tight">{student.name}</p>
                    <p className="text-xs text-slate-400">Roll: {student.rollNo}</p>
                  </div>
                </div>

                {/* Status Buttons */}
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setStatus(student.id, "present")}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                      student.status === "present"
                        ? "bg-emerald-500 text-white"
                        : "bg-white border border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-600"
                    }`}
                  >
                    Present
                  </button>
                  <button
                    onClick={() => setStatus(student.id, "absent")}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                      student.status === "absent"
                        ? "bg-rose-500 text-white"
                        : "bg-white border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600"
                    }`}
                  >
                    Absent
                  </button>
                  <button
                    onClick={() => setStatus(student.id, "late")}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                      student.status === "late"
                        ? "bg-amber-500 text-white"
                        : "bg-white border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600"
                    }`}
                  >
                    Late
                  </button>
                </div>

                {/* Note field */}
                <input
                  type="text"
                  placeholder="Add note..."
                  value={student.note}
                  onChange={e => setNote(student.id, e.target.value)}
                  className="w-full h-8 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-blue-100 bg-slate-50"
                />
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && students.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, students.length)}–{Math.min(currentPage * ITEMS_PER_PAGE, students.length)} of {students.length} students
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
        )}
      </div>
    </div>
  );
};

export default MarkAttendance;
