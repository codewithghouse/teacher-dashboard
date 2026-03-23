import { useState, useEffect } from "react";
import MarkAttendance from "@/components/MarkAttendance";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, CalendarClock, TrendingUp, UserCheck, UserX, ChevronRight, GraduationCap, Clock } from "lucide-react";

const Attendance = () => {
  const { teacherData } = useAuth();
  const [isMarking, setIsMarking] = useState(false);
  const [selectedClass, setSelectedClass] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<any[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [stats, setStats] = useState({
    rate: "0%",
    presentToday: 0,
    absentToday: 0,
    lateToday: 0
  });

  // 1. Fetch Teacher's Classes
  useEffect(() => {
    if (!teacherData?.id) return;
    const qClasses = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsubClasses = onSnapshot(qClasses, (snap) => {
      setClasses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubClasses();
  }, [teacherData?.id]);

  // 2. Fetch Teacher's Attendance Stats
  useEffect(() => {
    if (!teacherData?.id) return;
    
    const q = query(collection(db, "attendance"), where("teacherId", "==", teacherData.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAttendanceRecords(records);

      if (records.length >= 0) {
        const today = new Date().toISOString().split('T')[0];
        const todayRecords = records.filter((r: any) => r.date === today);
        
        const presentToday = todayRecords.filter((r: any) => r.status === 'present').length;
        const absentToday = todayRecords.filter((r: any) => r.status === 'absent').length;
        const lateToday = todayRecords.filter((r: any) => r.status === 'late').length;

        const totalOverall = records.length;
        const totalPresentOverall = records.filter((r: any) => r.status === 'present' || r.status === 'late').length;
        const rate = totalOverall > 0 ? ((totalPresentOverall / totalOverall) * 100).toFixed(1) + "%" : "0%";

        setStats({
          rate,
          presentToday,
          absentToday,
          lateToday
        });
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [teacherData?.id]);

  const handleMarkClass = (cls: any) => {
    setSelectedClass(cls);
    setIsMarking(true);
  };

  if (isMarking) {
    return <MarkAttendance initialClassId={selectedClass?.id} onBack={() => setIsMarking(false)} />;
  }

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-12 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div className="text-left">
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left">Attendance Hub</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
             <TrendingUp className="w-4 h-4 text-emerald-500"/> Real-time Disposition Monitoring & Roster Controls
          </p>
        </div>
        <div className="flex items-center gap-3 bg-emerald-50/50 border border-emerald-100 px-8 py-5 rounded-[2.5rem] shadow-sm">
           <UserCheck className="w-6 h-6 text-emerald-600"/>
           <div className="text-left">
              <p className="text-2xl font-black text-emerald-700 leading-none">{stats.rate}</p>
              <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mt-1">Global Health Rate</p>
           </div>
        </div>
      </div>

      <div className="mb-12">
         <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] mb-8 border-l-4 border-[#1e3a8a] pl-6">Active Class Subdivisions</h2>
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {classes.map((cls) => (
               <div 
                  key={cls.id} 
                  onClick={() => handleMarkClass(cls)}
                  className="bg-white border border-slate-100 rounded-[3rem] p-8 shadow-sm hover:shadow-2xl hover:border-[#1e3a8a] transition-all cursor-pointer group relative overflow-hidden flex flex-col items-start text-left"
               >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-bl-[4rem] group-hover:bg-[#1e3a8a] transition-all opacity-20"></div>
                  <div className="w-16 h-16 rounded-[1.5rem] bg-slate-50 group-hover:bg-[#1e3a8a] group-hover:text-white transition-all flex items-center justify-center mb-6 shadow-inner">
                     <GraduationCap className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 leading-tight mb-2 group-hover:text-[#1e3a8a] transition-colors">{cls.name}</h3>
                  <div className="flex items-center gap-2 mb-8">
                     <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{cls.subject || teacherData?.subject}</p>
                     <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                     <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Section {cls.section || 'A'}</p>
                  </div>
                  <div className="mt-auto w-full flex items-center justify-between border-t border-slate-50 pt-6">
                     <span className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest flex items-center gap-1.5">
                        <Clock className="w-3 h-3" /> Mark Daily
                     </span>
                     <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 group-hover:text-[#1e3a8a] group-hover:bg-blue-50 transition-all">
                        <ChevronRight className="w-4 h-4" />
                     </div>
                  </div>
               </div>
            ))}
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         <div className="lg:col-span-2 bg-white border border-slate-50 rounded-[3.5rem] p-10 shadow-sm text-left">
            <h2 className="text-xl font-black text-slate-900 mb-8 flex items-center gap-3">
               <CalendarClock className="w-6 h-6 text-[#1e3a8a]"/> Today's Log Status
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
               <div className="p-8 bg-emerald-50 rounded-[2.5rem] border border-emerald-100 flex flex-col items-start group hover:bg-emerald-100/50 transition-all">
                  <p className="text-3xl font-black text-emerald-600 mb-1 group-hover:scale-110 transition-transform">{stats.presentToday}</p>
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Scholars Present</p>
               </div>
               <div className="p-8 bg-amber-50 rounded-[2.5rem] border border-amber-100 flex flex-col items-start group hover:bg-amber-100/50 transition-all">
                  <p className="text-3xl font-black text-amber-600 mb-1 group-hover:scale-110 transition-transform">{stats.lateToday}</p>
                  <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Arrived Late</p>
               </div>
               <div className="p-8 bg-rose-50 rounded-[2.5rem] border border-rose-100 flex flex-col items-start group hover:bg-rose-100/50 transition-all">
                  <p className="text-3xl font-black text-rose-600 mb-1 group-hover:scale-110 transition-transform">{stats.absentToday}</p>
                  <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Marked Absent</p>
               </div>
            </div>
         </div>
         
         <div className="bg-[#1e3a8a] rounded-[3.5rem] p-10 shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -mr-24 -mt-24 blur-3xl group-hover:bg-white/20 transition-all"></div>
            <h2 className="text-lg font-black text-white mb-4 uppercase tracking-widest">Institutional Note</h2>
            <p className="text-sm font-medium text-blue-100 leading-relaxed mb-8">
               "Daily attendance records are vital for the AI Early Warning System. Accurate logs help us identify at-risk scholars before they fall behind."
            </p>
            <div className="flex items-center gap-3 pt-6 border-t border-white/10">
               <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white"><CalendarClock className="w-5 h-5"/></div>
               <p className="text-[10px] font-black text-white uppercase tracking-widest">Registry Sync Active</p>
            </div>
         </div>
      </div>
    </div>
  );
};

export default Attendance;
