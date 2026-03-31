import React, { useState, useEffect } from 'react';
import { ChevronLeft, Search, Loader2, Save, UserCheck, UserX, Clock, Check, RefreshCw, Layers, ArrowLeft } from 'lucide-react';
import { db } from "../lib/firebase";
import { collection, query, getDocs, where, serverTimestamp, setDoc, doc, onSnapshot, orderBy, limit } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

interface MarkAttendanceProps { 
  onBack: () => void;
  initialClassId?: string;
}

const MarkAttendance = ({ onBack, initialClassId }: MarkAttendanceProps) => {
  const { teacherData } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(initialClassId || "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8; 

  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const cls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setClasses(cls);
      if (!selectedClassId && cls.length > 0) setSelectedClassId(cls[0].id);
      setLoading(false);
    });
    return () => unsub();
  }, [teacherData?.id, selectedClassId]);

  useEffect(() => {
    if (!selectedClassId || !teacherData?.id) return;
    setLoading(true);
    const today = new Date().toLocaleDateString('en-CA');

    const qRoster = query(
      collection(db, "enrollments"), 
      where("teacherId", "==", teacherData.id),
      where("classId", "==", selectedClassId)
    );
    
    const unsub = onSnapshot(qRoster, async (snap) => {
      try {
        const qToday = query(
          collection(db, "attendance"),
          where("classId", "==", selectedClassId),
          where("date", "==", today)
        );
        const logSnap = await getDocs(qToday);
        const activeLogs = logSnap.docs.map(d => d.data());

        const roster = snap.docs.map(d => {
          const data = d.data() as any;
          const sId = data.studentId || d.id;
          const matchingLog = activeLogs.find(l => l.studentId === sId);
          
          return {
            id: sId,
            enrollId: d.id,
            name: data.studentName,
            email: data.studentEmail,
            rollNo: data.rollNo || (800 + Math.floor(Math.random() * 100)),
            status: matchingLog ? matchingLog.status : 'none',
            initials: data.studentName?.substring(0, 2).toUpperCase() || "ST",
            color: data.avatarColor || `bg-${['blue', 'emerald', 'rose', 'amber', 'indigo'][Math.floor(Math.random()*5)]}-500`
          };
        });
        
        // Sort alphabetically
        roster.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
        setStudents(roster);
      } catch (e) {
        console.error("Roster error:", e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [selectedClassId, teacherData?.id]);

  const stats = {
    present: students.filter(s => s.status === 'present').length,
    absent: students.filter(s => s.status === 'absent').length,
    late: students.filter(s => s.status === 'late').length,
    unmarked: students.filter(s => s.status === 'none').length,
  };

  const setStatus = (id: string, newStatus: string) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
  };

  const markAllPresent = () => {
    setStudents(prev => prev.map(s => ({ ...s, status: 'present' })));
    toast.success("Ready for registry synchronization!");
  };

  const copyFromYesterday = async () => {
    setLoading(true);
    try {
      const qPrev = query(
        collection(db, "attendance"),
        where("classId", "==", selectedClassId),
        where("teacherId", "==", teacherData.id),
        limit(100)
      );
      const snap = await getDocs(qPrev);
      const today = new Date().toLocaleDateString('en-CA');
      
      const prevLogs = snap.docs
        .map(d => d.data())
        .filter(l => l.date !== today)
        .sort((a: any, b: any) => b.date.localeCompare(a.date));
      
      if (prevLogs.length === 0) {
        toast.error("No previous registry found for this subdivision.");
        setLoading(false);
        return;
      }

      const latestDate = prevLogs[0].date;
      const latestLogs = prevLogs.filter(l => l.date === latestDate);

      setStudents(prev => prev.map(s => {
        const match = latestLogs.find(l => l.studentId === s.id);
        return match ? { ...s, status: match.status } : s;
      }));

      toast.success(`Synchronized with registry from ${latestDate}`);
    } catch (e) {
      console.error(e);
      toast.error("Registry lookup failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (students.length === 0) return toast.error("No scholars in this registry subdivision.");
    if (stats.unmarked > 0) {
      if (!confirm(`You have ${stats.unmarked} unmarked scholars. Proceed with full synchronization?`)) return;
    }

    setSaving(true);
    const today = new Date().toLocaleDateString('en-CA');
    const selClass = classes.find(c => c.id === selectedClassId);

    try {
      let teachingAssignmentId = "legacy";
      const qAssign = query(collection(db, "teaching_assignments"), 
          where("teacherId", "==", teacherData.id), 
          where("classId", "==", selectedClassId),
          where("status", "==", "active")
      );
      const assignSnap = await getDocs(qAssign);
      if (!assignSnap.empty) {
          teachingAssignmentId = assignSnap.docs[0].id;
      }

      const promises = students
        .filter(s => s.status !== 'none')
        .map(s => {
          const attendanceRef = doc(db, "attendance", `${s.id}_${selectedClassId}_${today}`);
          return setDoc(attendanceRef, {
            studentId: s.id,
            studentName: s.name,
            studentEmail: s.email,
            status: s.status,
            date: today,
            teacherId: teacherData.id,
            schoolId: teacherData.schoolId || "",
            branch: teacherData.branch || "Main",
            assignmentId: teachingAssignmentId, // From Phase 1 spec
            teacherName: teacherData.name || "Faculty",
            classId: selectedClassId,
            className: selClass?.name || "Unknown",
            timestamp: serverTimestamp()
          });
        });

      await Promise.all(promises);
      toast.success(`Globally synchronized! Visible to Parents & Principals.`);
      onBack();
    } catch (e) {
      console.error(e);
      toast.error("Process aborted. Check connectivity.");
    } finally {
      setSaving(false);
    }
  };

  const selClass = classes.find(c => c.id === selectedClassId);
  const currentDateFormatted = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Pagination Logic
  const totalStudents = students.length;
  const totalPages = Math.ceil(totalStudents / itemsPerPage) || 1;
  const paginatedStudents = students.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getAvatarColor = (initials: string) => {
      const colorMap: Record<string, string> = {
          'A': 'bg-[#1e3a8a]', 'B': 'bg-emerald-500', 'C': 'bg-amber-500', 'D': 'bg-rose-500', 
          'E': 'bg-blue-600', 'F': 'bg-violet-600', 'G': 'bg-[#1e3a8a]', 'H': 'bg-emerald-500'
      };
      return colorMap[initials.charAt(0)] || 'bg-indigo-600';
  };

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left bg-transparent">
      
      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-8">
        <div className="text-left flex items-start gap-4">
           <button onClick={onBack} className="mt-1 p-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm group">
              <ArrowLeft className="w-5 h-5 text-slate-400 group-hover:text-[#1e3a8a]" />
           </button>
           <div>
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">RESULT OF CLICK: "MARK ATTENDANCE"</p>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none mb-2">Mark Attendance</h1>
              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">{selClass?.name || 'Class'} • {currentDateFormatted}</p>
           </div>
        </div>
        <button 
           onClick={handleSave} 
           disabled={saving || loading} 
           className="mt-6 md:mt-0 bg-[#22c55e] text-white px-8 py-3.5 rounded-2xl text-[12px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/10 hover:bg-emerald-600 transition-all flex items-center gap-2 disabled:opacity-50"
        >
           {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>} 
           Save Attendance
        </button>
      </div>

      {/* ── QUICK ACTIONS BAR ── */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] p-6 flex flex-col md:flex-row items-center justify-between gap-6 mb-8 shadow-sm">
         <div className="flex items-center gap-4">
            <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] ml-2">Quick Actions:</span>
            <button onClick={markAllPresent} className="px-6 py-2.5 bg-white border border-slate-200 text-[11px] font-black uppercase tracking-widest text-[#1e3a8a] rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
               Mark All Present
            </button>
            <button onClick={copyFromYesterday} className="px-6 py-2.5 bg-white border border-slate-200 text-[11px] font-black uppercase tracking-widest text-slate-500 rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
               Copy from Yesterday
            </button>
         </div>
         <div className="flex items-center gap-8 pr-4">
            <div className="flex items-center gap-3">
               <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
               <span className="text-[12px] font-bold text-slate-400 uppercase tracking-widest">Present: <span className="font-black text-slate-900 ml-1">{stats.present}</span></span>
            </div>
            <div className="flex items-center gap-3">
               <div className="w-3 h-3 rounded-full bg-rose-500"></div>
               <span className="text-[12px] font-bold text-slate-400 uppercase tracking-widest">Absent: <span className="font-black text-slate-900 ml-1">{stats.absent}</span></span>
            </div>
            <div className="flex items-center gap-3">
               <div className="w-3 h-3 rounded-full bg-amber-500"></div>
               <span className="text-[12px] font-bold text-slate-400 uppercase tracking-widest">Late: <span className="font-black text-slate-900 ml-1">{stats.late}</span></span>
            </div>
         </div>
      </div>

      {/* ── MAIN ROSTER GRID ── */}
      <div className="bg-white border border-slate-200 rounded-[3.5rem] p-4 shadow-sm text-left overflow-hidden">
         <div className="px-10 py-10 border-b border-slate-50">
            <h2 className="text-xl font-black text-slate-900 tracking-tight leading-tight">Student Attendance</h2>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{totalStudents} students • Click to toggle status</p>
         </div>

         {loading ? (
            <div className="py-28 flex flex-col items-center justify-center">
               <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-4" />
               <p className="text-xs font-black uppercase tracking-widest text-slate-300">Synchronizing registry subdivisions...</p>
            </div>
         ) : paginatedStudents.length === 0 ? (
            <div className="py-28 flex flex-col items-center justify-center text-slate-300">
               <Layers className="w-16 h-16 mb-4 opacity-20" />
               <p className="text-sm font-black uppercase tracking-widest">No scholars in this registry</p>
            </div>
         ) : (
            <div className="p-10">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                  {paginatedStudents.map((student) => {
                     const isPresent = student.status === 'present';
                     const isAbsent = student.status === 'absent';
                     const isLate = student.status === 'late';

                     return (
                        <div key={student.id} className="bg-white border border-slate-100 rounded-[2.5rem] p-8 hover:border-blue-100 hover:shadow-2xl transition-all flex flex-col items-start group shadow-sm">
                           <div className="flex items-center gap-4 mb-8">
                              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-base font-black shadow-md ${getAvatarColor(student.initials)} group-hover:scale-110 transition-transform`}>
                                 {student.initials}
                              </div>
                              <div>
                                 <h3 className="text-lg font-black text-slate-900 tracking-tight leading-none mb-1.5">{student.name}</h3>
                                 <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Roll: {student.rollNo}</p>
                              </div>
                           </div>
                           
                           <div className="w-full grid grid-cols-3 bg-slate-50/50 p-1 rounded-2xl border border-slate-50">
                              <button 
                                 onClick={() => setStatus(student.id, 'present')}
                                 className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isPresent ? 'bg-emerald-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                              >
                                 Present
                              </button>
                              <button 
                                 onClick={() => setStatus(student.id, 'absent')}
                                 className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isAbsent ? 'bg-rose-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                              >
                                 Absent
                              </button>
                              <button 
                                 onClick={() => setStatus(student.id, 'late')}
                                 className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isLate ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                              >
                                 Late
                              </button>
                           </div>
                        </div>
                     );
                  })}
               </div>
            </div>
         )}

         {/* ── PAGINATION ── */}
         {!loading && totalStudents > 0 && (
            <div className="px-10 py-10 border-t border-slate-50 flex flex-col sm:flex-row items-center justify-between gap-8">
               <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Showing {Math.min(totalStudents, (currentPage - 1) * itemsPerPage + 1)} - {Math.min(totalStudents, currentPage * itemsPerPage)} of {totalStudents} students
               </p>
               <div className="flex items-center gap-1.5">
                  <button 
                     disabled={currentPage === 1}
                     onClick={() => setCurrentPage(prev => prev - 1)}
                     className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                     Previous
                  </button>
                  <div className="flex gap-1.5">
                     {[...Array(totalPages)].map((_, i) => (
                        <button 
                           key={i} 
                           onClick={() => setCurrentPage(i + 1)}
                           className={`w-10 h-10 rounded-xl text-[12px] font-black flex items-center justify-center transition-all ${currentPage === i + 1 ? 'bg-[#1e3a8a] text-white shadow-xl shadow-blue-900/10' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                        >
                           {i + 1}
                        </button>
                     ))}
                  </div>
                  <button 
                     disabled={currentPage === totalPages}
                     onClick={() => setCurrentPage(prev => prev + 1)}
                     className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                     Next
                  </button>
               </div>
            </div>
         )}
      </div>
    </div>
  );
};

export default MarkAttendance;
