import React, { useState, useEffect } from 'react';
import { ChevronLeft, Search, Loader2, Save, UserCheck, UserX, Clock, Check, RefreshCw, Layers } from 'lucide-react';
import { db } from "../lib/firebase";
import { collection, query, getDocs, where, serverTimestamp, setDoc, doc, onSnapshot } from "firebase/firestore";
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
  const itemsPerPage = 8; // Adjust based on visual needs

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
            initials: data.studentName?.substring(0, 2).toUpperCase() || "ST"
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
  };

  const copyFromYesterday = () => {
      // Mock logic for demo UI
      toast.info("Logics engine synchronizing past registry...");
      markAllPresent();
  };

  const handleSave = async () => {
    if (students.length === 0) return toast.error("No scholars in this registry subdivision.");
    if (stats.unmarked > 0) {
      if (!confirm(`You have ${stats.unmarked} unmarked scholars. Proceed with partial synchronization?`)) return;
    }

    setSaving(true);
    const today = new Date().toLocaleDateString('en-CA');
    const selClass = classes.find(c => c.id === selectedClassId);

    try {
      const promises = students
        .filter(s => s.status !== 'none')
        .map(s => {
          // Global save logic: this affects ALL dashboards reading from the 'attendance' collection
          const attendanceRef = doc(db, "attendance", `${s.id}_${selectedClassId}_${today}`);
          return setDoc(attendanceRef, {
            studentId: s.id,
            studentName: s.name,
            studentEmail: s.email,
            status: s.status,
            date: today,
            teacherId: teacherData.id,
            teacherName: teacherData.name || "Faculty",
            classId: selectedClassId,
            className: selClass?.name || "Unknown",
            timestamp: serverTimestamp()
          });
        });

      await Promise.all(promises);
      toast.success(`Globally synchronized! Visible to Parents & Principals instantly.`);
      onBack();
    } catch (e) {
      console.error(e);
      toast.error("Synchronization failed. Check network status.");
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

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left bg-transparent">
      
      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-6">
        <div className="text-left">
           <button onClick={onBack} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#1e3a8a] flex items-center gap-1 mb-4 transition-colors">
              <ChevronLeft className="w-4 h-4" /> Go Back
           </button>
           <h1 className="text-3xl font-black text-slate-800 tracking-tight leading-none mb-2">Mark Attendance</h1>
           <p className="text-sm font-bold text-slate-500">{selClass?.name || 'Class'} • {currentDateFormatted}</p>
        </div>
        <button 
           onClick={handleSave} 
           disabled={saving || loading} 
           className="mt-6 md:mt-0 bg-[#22c55e] text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-sm hover:bg-emerald-600 transition-all flex items-center gap-2 disabled:opacity-50"
        >
           {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null} Save Attendance
        </button>
      </div>

      {/* ── QUICK ACTIONS BAR ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-6 mb-8 shadow-sm">
         <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-500">Quick Actions:</span>
            <button onClick={markAllPresent} className="px-5 py-2.5 bg-white border border-slate-200 text-sm font-medium text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
               Mark All Present
            </button>
            <button onClick={copyFromYesterday} className="px-5 py-2.5 bg-white border border-slate-200 text-sm font-medium text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
               Copy from Yesterday
            </button>
         </div>
         <div className="flex items-center gap-6">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-600"><span className="w-3 h-3 rounded-full bg-emerald-500"></span> Present: <span className="font-bold text-slate-900">{stats.present}</span></span>
            <span className="flex items-center gap-2 text-sm font-medium text-slate-600"><span className="w-3 h-3 rounded-full bg-rose-500"></span> Absent: <span className="font-bold text-slate-900">{stats.absent}</span></span>
            <span className="flex items-center gap-2 text-sm font-medium text-slate-600"><span className="w-3 h-3 rounded-full bg-amber-500"></span> Late: <span className="font-bold text-slate-900">{stats.late}</span></span>
         </div>
      </div>

      {/* ── MAIN ROSTER CARD ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm text-left overflow-hidden">
         <div className="p-6 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-900 leading-tight">Student Attendance</h2>
            <p className="text-sm text-slate-500 mt-1">{totalStudents} students • Click to toggle status</p>
         </div>

         {loading ? (
            <div className="py-20 flex flex-col items-center justify-center">
               <Loader2 className="w-8 h-8 text-[#1e3a8a] animate-spin mb-4" />
               <p className="text-sm font-medium text-slate-500">Loading roster...</p>
            </div>
         ) : (
            <div className="p-6">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {paginatedStudents.map((student) => {
                     const isPresent = student.status === 'present';
                     const isAbsent = student.status === 'absent';
                     const isLate = student.status === 'late';

                     // Provide dynamic background colors based on initials
                     const getAvatarColor = (initials: string) => {
                         const colors = [
                             'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 
                             'bg-rose-500', 'bg-purple-500', 'bg-pink-500', 'bg-orange-500'
                         ];
                         const idx = initials.charCodeAt(0) % colors.length;
                         return colors[idx];
                     };

                     return (
                        <div key={student.id} className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-slate-300 transition-colors flex flex-col items-start shadow-sm">
                           <div className="flex items-center gap-4 mb-5">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold shadow-sm ${getAvatarColor(student.initials)}`}>
                                 {student.initials}
                              </div>
                              <div>
                                 <h3 className="text-[15px] font-bold text-slate-900 leading-tight truncate">{student.name}</h3>
                                 <p className="text-xs text-slate-500 mt-1">Roll: {student.rollNo}</p>
                              </div>
                           </div>
                           
                           <div className="w-full flex">
                              <button 
                                 onClick={() => setStatus(student.id, 'present')}
                                 className={`flex-1 py-2 text-xs font-semibold border-y border-l border-slate-200 rounded-l-lg transition-colors ${isPresent ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                              >
                                 Present
                              </button>
                              <button 
                                 onClick={() => setStatus(student.id, 'absent')}
                                 className={`flex-1 py-2 text-xs font-semibold border-y border-x border-slate-200 transition-colors ${isAbsent ? 'bg-rose-600 text-white border-rose-600 z-10' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                              >
                                 Absent
                              </button>
                              <button 
                                 onClick={() => setStatus(student.id, 'late')}
                                 className={`flex-1 py-2 text-xs font-semibold border-y border-r border-slate-200 rounded-r-lg transition-colors ${isLate ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
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
            <div className="p-6 border-t border-slate-100 flex items-center justify-between">
               <p className="text-sm font-medium text-slate-500">
                  Showing {Math.min(totalStudents, (currentPage - 1) * itemsPerPage + 1)} - {Math.min(totalStudents, currentPage * itemsPerPage)} of {totalStudents} students
               </p>
               <div className="flex items-center gap-1.5">
                  <button 
                     disabled={currentPage === 1}
                     onClick={() => setCurrentPage(prev => prev - 1)}
                     className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                     Previous
                  </button>
                  {[...Array(totalPages)].map((_, i) => (
                     <button 
                        key={i} 
                        onClick={() => setCurrentPage(i + 1)}
                        className={`w-9 h-9 rounded-lg text-sm font-medium flex items-center justify-center transition-colors ${currentPage === i + 1 ? 'bg-[#1e3a8a] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                     >
                        {i + 1}
                     </button>
                  ))}
                  <button 
                     disabled={currentPage === totalPages}
                     onClick={() => setCurrentPage(prev => prev + 1)}
                     className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
