import { useState, useEffect } from "react";
import MarkAttendance from "@/components/MarkAttendance";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs, orderBy, limit } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { 
  Loader2, 
  TrendingUp, 
  UserCheck, 
  UserX, 
  Clock, 
  ArrowRight,
  AlertCircle,
  CalendarDays,
  MoreHorizontal
} from "lucide-react";

const Attendance = () => {
  const { teacherData } = useAuth();
  const [isMarking, setIsMarking] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<any[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [stats, setStats] = useState({
    rate: "0%",
    presentToday: 0,
    absentToday: 0,
    lateToday: 0
  });

  // History Journal States
  const [registryDate, setRegistryDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
  const [registryClassId, setRegistryClassId] = useState<string>("");

  // 1. Fetch Teacher's Classes via teaching_assignments & legacy
  const [allClassIds, setAllClassIds] = useState<string[]>([]);
  
  useEffect(() => {
    if (!teacherData?.id) return;
    const qAssign = query(collection(db, "teaching_assignments"), where("teacherId", "==", teacherData.id), where("status", "==", "active"));
    const unsubAssign = onSnapshot(qAssign, async (assignSnap) => {
      const assignments = assignSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const assignedIds = assignments.map(a => a.classId).filter(Boolean);
      
      const qLegacy = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
      const legacySnap = await getDocs(qLegacy);
      const legacyIds = legacySnap.docs.map(d => d.id);
      
      const mergedIds = Array.from(new Set([...assignedIds, ...legacyIds]));
      setAllClassIds(mergedIds);

      if (assignments.length > 0 || legacyIds.length > 0) {
        const qClasses = query(collection(db, "classes"));
        const classSnap = await getDocs(qClasses);
        const classMap = new Map();
        classSnap.docs.forEach(d => classMap.set(d.id, d.data()));
        
        const clsData = assignments.map(a => {
           const cls = classMap.get(a.classId);
           return {
              id: a.id,
              classId: a.classId,
              name: `${cls?.name || 'Class'} - ${a.subjectName || a.subject || 'Subject'}`
           };
        });

        legacyIds.forEach(lid => {
           if (!assignedIds.includes(lid)) {
               const cls = classMap.get(lid);
               clsData.push({ id: lid, classId: lid, name: cls?.name || 'Legacy Class' });
           }
        });

        setClasses(clsData);
        if (clsData.length > 0) {
          if (!selectedClassId) setSelectedClassId(clsData[0].id);
          if (!registryClassId) setRegistryClassId(clsData[0].id);
        }
      } else {
        setClasses([]);
      }
    });
    return () => unsubAssign();
  }, [teacherData?.id, selectedClassId, registryClassId]);

  // 2. Fetch Enrollments
  useEffect(() => {
    if (allClassIds.length === 0) {
        setEnrollments([]);
        return;
    }
    const fetchEnrollments = async () => {
        const promises = allClassIds.map(cid => getDocs(query(collection(db, "enrollments"), where("classId", "==", cid))));
        const snaps = await Promise.all(promises);
        const data: any[] = [];
        snaps.forEach(s => s.docs.forEach(d => data.push({ id: d.id, ...d.data() })));
        setEnrollments(data);
    };
    fetchEnrollments();
  }, [allClassIds]);

  // 3. Fetch Attendance Stats & Weekly Records
  useEffect(() => {
    if (classes.length === 0) {
        setAttendanceRecords([]);
        setLoading(false);
        return;
    }
    
    setLoading(true);
    // Real-time listener per assignmentId (and legacy classId)
    const unsubs = classes.map(c => {
       const isLegacy = c.id === c.classId;
       const q = isLegacy 
             ? query(collection(db, "attendance"), where("classId", "==", c.classId), where("teacherId", "==", teacherData?.id))
             : query(collection(db, "attendance"), where("assignmentId", "==", c.id));
       return onSnapshot(q, () => {
          fetchAllAttendance();
       });
    });

    const fetchAllAttendance = async () => {
       const promises = classes.map(c => {
           const isLegacy = c.id === c.classId;
           const q = isLegacy 
                 ? query(collection(db, "attendance"), where("classId", "==", c.classId), where("teacherId", "==", teacherData?.id))
                 : query(collection(db, "attendance"), where("assignmentId", "==", c.id));
           return getDocs(q);
       });
       const snaps = await Promise.all(promises);
       
       // Fallback fetch: also fetch documents matching teacher + classId just in case some missed Phase 1 conversion
       const legacyPromises = classes.map(c => {
           if (c.id !== c.classId) {
                return getDocs(query(collection(db, "attendance"), where("classId", "==", c.classId), where("teacherId", "==", teacherData?.id)));
           }
           return Promise.resolve({ docs: [] });
       });
       const legacySnaps = await Promise.all(legacyPromises);

       const recordMap = new Map();
       snaps.forEach(s => s.docs.forEach(d => recordMap.set(d.id, { id: d.id, ...d.data() })));
       
       legacySnaps.forEach(s => s.docs.forEach((d: any) => {
            if (!recordMap.has(d.id)) {
                const record = d.data();
                const matchedCol = classes.find(cls => cls.classId === record.classId && cls.id !== cls.classId);
                recordMap.set(d.id, { 
                    id: d.id, 
                    assignmentId: matchedCol ? matchedCol.id : record.classId,
                    ...record 
                 });
            }
       }));
       
       const records = Array.from(recordMap.values());
       setAttendanceRecords(records);

      if (records.length >= 0) {
        const today = new Date().toLocaleDateString('en-CA');
        const todayRecords = records.filter((r: any) => r.date === today);
        
        const presentToday = todayRecords.filter((r: any) => r.status === 'present').length;
        const absentToday = todayRecords.filter((r: any) => r.status === 'absent').length;
        const lateToday = todayRecords.filter((r: any) => r.status === 'late').length;

        const totalOverall = records.length;
        const totalPresentOverall = records.filter((r: any) => r.status === 'present' || r.status === 'late').length;
        const rate = totalOverall > 0 ? ((totalPresentOverall / totalOverall) * 100).toFixed(1) + "%" : "0%";

        setStats({ rate, presentToday, absentToday, lateToday });
      }
      setLoading(false);
    };
    
    // Initial fetch
    fetchAllAttendance();

    return () => unsubs.forEach(unsub => unsub());
  }, [classes, teacherData?.id]);

  const handleMarkToday = () => {
    if (classes.length > 0) {
      if (!selectedClassId) setSelectedClassId(classes[0].id);
      setIsMarking(true);
    }
  };

  // Weekly Overview Logic (Mocking dates for the current week starting Mon)
  const getWeeklyDays = () => {
    const days = [];
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon...
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

    for (let i = 0; i < 5; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dateStr = date.toLocaleDateString('en-CA');
      
      const dayRecords = attendanceRecords.filter((r: any) => r.date === dateStr && (r.assignmentId === selectedClassId || r.classId === selectedClassId));
      const present = dayRecords.filter(r => r.status === 'present' || r.status === 'late').length;
      const absent = dayRecords.filter(r => r.status === 'absent').length;
      const actualClassId = classes.find(c => c.id === selectedClassId)?.classId || selectedClassId;
      const totalInClass = enrollments.filter(e => e.classId === actualClassId).length || 1;
      const rate = dayRecords.length > 0 ? ((present / totalInClass) * 100).toFixed(1) : "-";

      days.push({
        label: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dateStr,
        present,
        absent,
        rate: dayRecords.length > 0 ? `${rate}%` : "-",
        isToday: dateStr === today.toLocaleDateString('en-CA'),
        hasData: dayRecords.length > 0
      });
    }
    return days;
  };

  // Attendance Concerns (Students with many absences)
  const getConcerns = () => {
    const studentAbsences: Record<string, {name: string, count: number, initials: string}> = {};
    attendanceRecords.forEach(r => {
      if (r.status === 'absent') {
        if (!studentAbsences[r.studentId]) {
          studentAbsences[r.studentId] = { 
            name: r.studentName, 
            count: 0,
            initials: r.studentName?.substring(0, 2).toUpperCase() || "ST" 
          };
        }
        studentAbsences[r.studentId].count++;
      }
    });

    return Object.values(studentAbsences)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  };

  if (isMarking) {
    const activeC = classes.find(c => c.id === selectedClassId);
    return <MarkAttendance initialClassId={activeC?.classId || selectedClassId} onBack={() => setIsMarking(false)} />;
  }

  const weeklyDays = getWeeklyDays();
  const concerns = getConcerns();
  const activeClass = classes.find(c => c.id === selectedClassId);

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left bg-transparent">
      
      {/* ── HEADER ── */}
      <div className="flex justify-between items-start mb-10">
        <div>
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">RESULT OF CLICK: "ATTENDANCE"</p>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Attendance</h1>
          <p className="text-sm font-semibold text-slate-400 mt-1">Track and manage student attendance across all classes.</p>
        </div>
        <button 
          onClick={handleMarkToday}
          className="bg-[#1e3a8a] text-white px-8 py-3.5 rounded-2xl text-sm font-black shadow-lg shadow-blue-900/10 hover:bg-blue-900 transition-all flex items-center gap-2 group"
        >
           Mark Today's Attendance
           <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center">
            <TrendingUp className="w-7 h-7 text-emerald-500" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-900">{stats.rate}</h3>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Overall Rate</p>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
            <UserCheck className="w-7 h-7 text-blue-500" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-900">{stats.presentToday}</h3>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Present Today</p>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center">
            <UserX className="w-7 h-7 text-rose-500" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-900">{stats.absentToday}</h3>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Absent Today</p>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center">
            <Clock className="w-7 h-7 text-amber-500" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-900">{stats.lateToday}</h3>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Late Today</p>
          </div>
        </div>
      </div>

      {/* ── WEEKLY OVERVIEW SECTION ── */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] p-4 shadow-sm mb-10">
        <div className="p-6 border-b border-slate-50 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Weekly Attendance Overview</h2>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
              Class {activeClass?.name} • {weeklyDays[0].dateLabel} - {weeklyDays[4].dateLabel}, 2025
            </p>
          </div>
          {/* Class Select */}
          <select 
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {classes.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-6 gap-4">
            {weeklyDays.map((day, i) => (
              <div 
                key={i} 
                className={`p-6 rounded-[2rem] border transition-all ${
                  day.isToday 
                    ? 'bg-white border-amber-400 shadow-md ring-1 ring-amber-400' 
                    : 'bg-slate-50 border-slate-100'
                }`}
              >
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">{day.label}</p>
                <p className="text-xl font-black text-slate-900 mb-6">{day.dateLabel}</p>
                
                <div className="space-y-2 mb-8">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Present</span>
                    <span className="text-sm font-black text-emerald-500">{day.hasData ? day.present : '—'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Absent</span>
                    <span className="text-sm font-black text-rose-500">{day.hasData ? day.absent : '—'}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                   <p className={`text-xl font-black ${day.hasData ? 'text-emerald-500' : 'text-slate-300'}`}>
                      {day.rate}
                   </p>
                   {day.isToday && !day.hasData && (
                     <button 
                       onClick={() => setIsMarking(true)}
                       className="w-full py-3 bg-[#1e3a8a] text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/10"
                     >
                       Mark Now
                     </button>
                   )}
                </div>
              </div>
            ))}

            {/* Upcoming Placeholder */}
            <div className="bg-slate-50/50 border border-dashed border-slate-200 rounded-[2rem] flex flex-col items-center justify-center p-6 text-slate-300">
               <CalendarDays className="w-8 h-8 mb-2" />
               <p className="text-xs font-black uppercase tracking-widest">Upcoming</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── ATTENDANCE CONCERNS ── */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-sm text-left relative overflow-hidden mb-10">
        <div className="flex justify-between items-center mb-10">
          <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Attendance Concerns</h2>
          <button className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest hover:underline">View All</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {concerns.length > 0 ? concerns.map((std, i) => (
             <div key={i} className={`flex items-center gap-4 p-8 rounded-[2.5rem] border ${
               i === 0 ? 'bg-rose-50 border-rose-100' :
               i === 1 ? 'bg-amber-50 border-amber-100' :
               'bg-blue-50 border-blue-100'
             }`}>
                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-white text-base font-black shadow-sm ${
                   i === 0 ? 'bg-rose-500' : i === 1 ? 'bg-amber-500' : 'bg-blue-500'
                }`}>
                  {std.initials}
                </div>
                <div>
                   <h4 className="text-[16px] font-black text-slate-900 leading-tight">{std.name}</h4>
                   <p className={`text-xs font-bold mt-1 ${
                      i === 0 ? 'text-rose-500' : i === 1 ? 'text-amber-500' : 'text-blue-500'
                   }`}>
                      {std.count} absences this month
                   </p>
                </div>
             </div>
          )) : (
            <div className="col-span-3 py-10 flex flex-col items-center justify-center text-slate-300 border border-dashed border-slate-200 rounded-[2.5rem]">
               <UserCheck className="w-10 h-10 mb-4 opacity-20" />
               <p className="text-sm font-black uppercase tracking-widest">Excellent class health detected</p>
            </div>
          )}
        </div>
      </div>

      {/* ── ATTENDANCE REGISTRY JOURNAL ── */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-sm text-left relative overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10 pb-8 border-b border-slate-50">
           <div>
              <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Attendance Registry Journal</h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Historical Roster Records & Logs</p>
           </div>
           <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1.5">
                 <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-1">Select Date</label>
                 <input 
                    type="date" 
                    value={registryDate}
                    onChange={(e) => setRegistryDate(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
              </div>
              <div className="flex flex-col gap-1.5">
                 <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-1">Select Class</label>
                 <select 
                    value={registryClassId}
                    onChange={(e) => setRegistryClassId(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 min-w-[150px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                 >
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                 </select>
              </div>
           </div>
        </div>

        <div className="overflow-x-auto">
           <table className="w-full text-left">
              <thead>
                 <tr className="border-b border-slate-50">
                    <th className="pb-6 text-[11px] font-black text-slate-400 uppercase tracking-widest px-4">Student Name</th>
                    <th className="pb-6 text-[11px] font-black text-slate-400 uppercase tracking-widest px-4">Registry ID</th>
                    <th className="pb-6 text-[11px] font-black text-slate-400 uppercase tracking-widest px-4">Status</th>
                    <th className="pb-6 text-[11px] font-black text-slate-400 uppercase tracking-widest px-4 text-right">Action</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                 {(() => {
                    const activeReg = classes.find(c => c.id === registryClassId);
                    const classRoster = enrollments.filter(e => e.classId === (activeReg?.classId || registryClassId));
                    if (classRoster.length === 0) {
                      return (
                        <tr>
                           <td colSpan={4} className="py-20 text-center">
                              <Loader2 className="w-8 h-8 text-slate-200 animate-spin mx-auto mb-4" />
                              <p className="text-xs font-black text-slate-300 uppercase tracking-widest">Awaiting Registry Data...</p>
                           </td>
                        </tr>
                      );
                    }
                    return classRoster.map((student) => {
                       const log = attendanceRecords.find(r => r.studentId === student.studentId && r.date === registryDate && (r.assignmentId === registryClassId || r.classId === registryClassId));
                       const status = log ? log.status : "unmarked";
                       
                       return (
                          <tr key={student.id} className="group hover:bg-slate-50/50 transition-colors">
                             <td className="py-5 px-4">
                                <div className="flex items-center gap-3">
                                   <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center text-[10px] font-black text-slate-400 group-hover:bg-[#1e3a8a] group-hover:text-white transition-all">
                                      {student.studentName?.substring(0,2).toUpperCase()}
                                   </div>
                                   <span className="text-[14px] font-black text-slate-700">{student.studentName}</span>
                                </div>
                             </td>
                             <td className="py-5 px-4 text-[12px] font-bold text-slate-400 uppercase tracking-widest">
                                {student.studentId?.substring(0, 8)}
                             </td>
                             <td className="py-5 px-4">
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                   status === 'present' ? 'bg-emerald-50 text-emerald-600' :
                                   status === 'absent' ? 'bg-rose-50 text-rose-600' :
                                   status === 'late' ? 'bg-amber-50 text-amber-600' :
                                   'bg-slate-50 text-slate-400'
                                }`}>
                                   {status === 'present' && <UserCheck className="w-3 h-3" />}
                                   {status === 'absent' && <UserX className="w-3 h-3" />}
                                   {status === 'late' && <Clock className="w-3 h-3" />}
                                   {status}
                                </span>
                             </td>
                             <td className="py-5 px-4 text-right">
                                <button className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 transition-all text-slate-300 hover:text-slate-600">
                                   <MoreHorizontal className="w-5 h-5" />
                                </button>
                             </td>
                          </tr>
                       );
                    });
                 })()}
              </tbody>
           </table>
        </div>
      </div>

    </div>
  );
};

export default Attendance;
