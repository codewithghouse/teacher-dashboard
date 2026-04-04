import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, addDoc,
  serverTimestamp, getDocs
} from "firebase/firestore";
import { Loader2, Plus, Search, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type FilterType = "All" | "Active" | "Attention";

const MyClasses = () => {
  const navigate = useNavigate();
  const { teacherData } = useAuth();

  const [classes, setClasses] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [scoresRecords, setScoresRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("All");
  const [isAddClassOpen, setIsAddClassOpen] = useState(false);
  const [newClass, setNewClass] = useState({ name: "", grade: "", section: "", subject: "" });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!teacherData?.id) return;

    const qAssign = query(
      collection(db, "teaching_assignments"),
      where("teacherId", "==", teacherData.id),
      where("status", "==", "active")
    );
    const unsubAssign = onSnapshot(qAssign, async (snap) => {
      const assignedIds = snap.docs.map(d => d.data().classId).filter(Boolean);
      const legacySnap = await getDocs(query(collection(db, "classes"), where("teacherId", "==", teacherData.id)));
      const legacyIds = legacySnap.docs.map(d => d.id);
      const allIds = Array.from(new Set([...assignedIds, ...legacyIds]));
      if (allIds.length === 0) { setClasses([]); setLoading(false); return; }
      const classSnap = await getDocs(collection(db, "classes"));
      setClasses(classSnap.docs.filter(d => allIds.includes(d.id)).map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    const unsubEnrol = onSnapshot(
      query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id)),
      (snap) => setEnrollments(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    const unsubAtnd = onSnapshot(
      query(collection(db, "attendance"), where("teacherId", "==", teacherData.id)),
      (snap) => setAttendanceRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    const unsubScores = onSnapshot(
      query(collection(db, "test_scores"), where("teacherId", "==", teacherData.id)),
      (snap) => setScoresRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    return () => { unsubAssign(); unsubEnrol(); unsubAtnd(); unsubScores(); };
  }, [teacherData?.id]);

  const getMetrics = (classId: string) => {
    const attArr = attendanceRecords.filter(r => r.classId === classId);
    const present = attArr.filter(r => r.status === "present" || r.status === "late").length;
    const atndRaw = attArr.length > 0 ? (present / attArr.length) * 100 : -1;

    const scoreArr = scoresRecords.filter(r => r.classId === classId);
    const totalScore = scoreArr.reduce((acc, r) => acc + parseFloat(r.percentage || r.score || 0), 0);
    const perfRaw = scoreArr.length > 0 ? totalScore / scoreArr.length : -1;

    const studentCount = enrollments.filter(e => e.classId === classId).length;
    const isAttention = atndRaw >= 0 && atndRaw < 85;

    return {
      atndDisplay: atndRaw >= 0 ? `${atndRaw.toFixed(1)}%` : "—",
      perfDisplay: perfRaw >= 0 ? `${perfRaw.toFixed(1)}%` : "—",
      atndRaw,
      perfRaw,
      studentCount,
      isAttention,
    };
  };

  const handleCreateClass = async () => {
    if (!newClass.name || !newClass.grade) return toast.error("Class name and grade are required.");
    if (!teacherData?.schoolId || !teacherData?.branchId)
      return toast.error("School/branch info missing. Please re-login.");
    setIsSaving(true);
    try {
      const docRef = await addDoc(collection(db, "classes"), {
        name: newClass.name,
        grade: newClass.grade,
        section: newClass.section,
        subject: newClass.subject,
        teacherId: teacherData.id,
        teacherName: teacherData.name || "",
        schoolId: teacherData.schoolId,
        branchId: teacherData.branchId,
        createdAt: serverTimestamp(),
        status: "Active",
      });
      await addDoc(collection(db, "teaching_assignments"), {
        teacherId: teacherData.id,
        classId: docRef.id,
        subjectName: newClass.subject,
        schoolId: teacherData.schoolId,
        branchId: teacherData.branchId,
        status: "active",
        createdAt: serverTimestamp(),
      });
      toast.success("Class created successfully!");
      setIsAddClassOpen(false);
      setNewClass({ name: "", grade: "", section: "", subject: "" });
    } catch {
      toast.error("Failed to create class. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return (
    <div className="h-[60vh] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1e3272] animate-spin" />
    </div>
  );

  const classTimes = ["09:00 AM", "10:30 AM", "12:00 PM", "02:00 PM"];

  const filteredClasses = classes.filter(cls => {
    const nameMatch = cls.name?.toLowerCase().includes(searchQuery.toLowerCase());
    if (!nameMatch) return false;
    if (filter === "All") return true;
    const { isAttention } = getMetrics(cls.id);
    return filter === "Attention" ? isAttention : !isAttention;
  });

  return (
    <div className="text-left">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Result of click: "My Classes"</p>
          <h1 className="text-3xl font-bold text-slate-800">My Classes</h1>
          <p className="text-slate-500 text-sm mt-1">Manage all your assigned classes and sections.</p>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search classes..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 h-10 w-52 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            onClick={() => setIsAddClassOpen(true)}
            className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2"
          >
            Filter
          </button>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center gap-3 mb-6">
        {(["All", "Active", "Attention"] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-5 py-2 rounded-xl text-sm font-semibold border transition-all ${
              filter === f
                ? "bg-[#1e3272] text-white border-[#1e3272]"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            }`}
          >
            {f} {f === "All" ? `(${classes.length})` : ""}
          </button>
        ))}
        <button
          onClick={() => setIsAddClassOpen(true)}
          className="ml-auto flex items-center gap-2 px-5 py-2 rounded-xl bg-[#1e3272] text-white text-sm font-semibold hover:bg-[#162558] transition-all"
        >
          <Plus size={16} /> New Class
        </button>
      </div>

      {/* Class Cards Grid */}
      {filteredClasses.length === 0 ? (
        <div className="py-32 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-2xl">
          <p className="text-slate-400 font-semibold text-sm">No classes found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredClasses.map((cls, idx) => {
            const m = getMetrics(cls.id);
            const nextTime = classTimes[idx % classTimes.length];

            return (
              <div key={cls.id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col">
                {/* Icon + Badge */}
                <div className="flex justify-between items-start mb-5">
                  <div className="w-14 h-14 rounded-xl bg-blue-100" />
                  <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                    m.isAttention
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}>
                    {m.isAttention ? "Attention" : "Active"}
                  </span>
                </div>

                {/* Class Info */}
                <h3 className="text-2xl font-bold text-slate-800 mb-1">{cls.name || "Class"}</h3>
                <p className="text-sm text-slate-500 mb-5">
                  {cls.subject || teacherData?.subject || "Subject"} • {m.studentCount} Students
                </p>

                {/* Metrics */}
                <div className="space-y-3 mb-5">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500">Attendance Rate</span>
                    <span className={`text-sm font-bold ${m.atndRaw >= 0 ? "text-emerald-600" : "text-slate-400"}`}>
                      {m.atndDisplay}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500">Avg. Performance</span>
                    <span className={`text-sm font-bold ${m.perfRaw >= 60 ? "text-slate-800" : m.perfRaw >= 0 ? "text-rose-600" : "text-slate-400"}`}>
                      {m.perfDisplay}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500">Next Class</span>
                    <span className="text-sm font-bold text-[#1e3272]">Today, {nextTime}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 mt-auto">
                  <button
                    onClick={() => navigate(`/my-classes/${cls.id}`)}
                    className="flex-1 py-3 bg-[#1e3272] text-white rounded-xl text-sm font-semibold hover:bg-[#162558] transition-all"
                  >
                    View Class
                  </button>
                  <button
                    onClick={() => navigate("/attendance")}
                    className="flex-1 py-3 border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all"
                  >
                    Attendance
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Class Dialog */}
      <Dialog open={isAddClassOpen} onOpenChange={setIsAddClassOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-[480px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-800">Create New Class</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Class Name</Label>
              <Input
                placeholder="e.g. Class 8-A"
                className="h-11 rounded-xl"
                value={newClass.name}
                onChange={e => setNewClass({ ...newClass, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Grade</Label>
                <Input
                  placeholder="e.g. 8"
                  className="h-11 rounded-xl"
                  value={newClass.grade}
                  onChange={e => setNewClass({ ...newClass, grade: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Section</Label>
                <Input
                  placeholder="e.g. A"
                  className="h-11 rounded-xl"
                  value={newClass.section}
                  onChange={e => setNewClass({ ...newClass, section: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Subject</Label>
              <Input
                placeholder="e.g. Mathematics"
                className="h-11 rounded-xl"
                value={newClass.subject}
                onChange={e => setNewClass({ ...newClass, subject: e.target.value })}
              />
            </div>
            <button
              disabled={isSaving}
              onClick={handleCreateClass}
              className="w-full h-11 bg-[#1e3272] text-white rounded-xl text-sm font-semibold hover:bg-[#162558] transition-all flex items-center justify-center gap-2 mt-2"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Create Class
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyClasses;
