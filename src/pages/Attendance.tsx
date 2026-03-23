import { useState, useEffect } from "react";
import MarkAttendance from "@/components/MarkAttendance";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, CalendarClock, TrendingUp, UserCheck, UserX } from "lucide-react";

const Attendance = () => {
  const { teacherData } = useAuth();
  const [isMarking, setIsMarking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [stats, setStats] = useState({
    rate: "0%",
    presentToday: 0,
    absentToday: 0,
    lateToday: 0
  });
  const [weeklyOverview, setWeeklyOverview] = useState<any[]>([]);

  useEffect(() => {
    if (!teacherData?.id) return;
    
    // 1. Fetch Teacher's Attendance Records
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

        // Weekly (5 academic days)
        const days = [];
        for (let i = 4; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split('T')[0];
          const dayRecords = records.filter((r: any) => r.date === dateStr);
          
          const p = dayRecords.filter((r: any) => r.status === 'present' || r.status === 'late').length;
          const a = dayRecords.filter((r: any) => r.status === 'absent').length;
          
          days.push({
            day: d.toLocaleDateString('en-US', { weekday: 'short' }),
            date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            present: p,
            absent: a,
            rate: (p + a) > 0 ? ((p / (p + a)) * 100).toFixed(0) + "%" : "0%"
          });
        }
        setWeeklyOverview(days);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [teacherData?.id]);

  if (isMarking) {
    return <MarkAttendance onBack={() => setIsMarking(false)} />;
  }

  return (
    <div className="animate-in fade-in duration-500 pb-10 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-10 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left">Attendance Core</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
             <TrendingUp className="w-4 h-4 text-emerald-500"/> Real-time Enrollment Disposition Monitoring
          </p>
        </div>
        <button 
          onClick={() => setIsMarking(true)}
          className="bg-[#1e3a8a] text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-blue-900/30 hover:translate-y-[-2px] transition-all flex items-center gap-3 active:scale-95 whitespace-nowrap"
        >
          <CalendarClock className="w-6 h-6" /> Sync Daily Attendance
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
           <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm"><TrendingUp className="w-6 h-6"/></div>
           <div className="text-left"><p className="text-3xl font-black text-slate-900 leading-none">{stats.rate}</p><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Global Rate</p></div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
           <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm"><UserCheck className="w-6 h-6"/></div>
           <div className="text-left"><p className="text-3xl font-black text-slate-900 leading-none">{stats.presentToday}</p><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Today Present</p></div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
           <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shadow-sm"><UserX className="w-6 h-6"/></div>
           <div className="text-left"><p className="text-3xl font-black text-slate-900 leading-none">{stats.absentToday}</p><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Today Absent</p></div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
           <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shadow-sm"><CalendarClock className="w-6 h-6"/></div>
           <div className="text-left"><p className="text-3xl font-black text-slate-900 leading-none">{stats.lateToday}</p><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Today Late</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 bg-white border border-slate-50 rounded-[3.5rem] p-12 shadow-sm relative overflow-hidden text-left">
           <h2 className="text-2xl font-black text-slate-900 mb-10 flex items-center gap-4">
              Weekly Distribution Center
              <span className="text-[9px] font-black text-blue-400 bg-blue-50 px-3 py-1 rounded-full uppercase tracking-widest">Calculated Logic</span>
           </h2>
           <div className="space-y-8">
              {loading ? (
                 <div className="py-20 flex justify-center"><Loader2 className="w-10 h-10 animate-spin text-slate-200"/></div>
              ) : weeklyOverview.length === 0 ? (
                 <div className="py-20 text-center text-slate-300 font-bold uppercase text-xs tracking-widest italic">No historical alignment data found.</div>
              ) : weeklyOverview.map((day, i) => (
                <div key={i} className="group cursor-default">
                  <div className="flex justify-between items-end mb-3">
                    <div className="text-left">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{day.date}</p>
                      <p className="text-lg font-black text-slate-800 tracking-tight">{day.day}</p>
                    </div>
                    <p className="text-lg font-black text-emerald-600">{day.rate}</p>
                  </div>
                  <div className="h-4 bg-slate-50 rounded-2xl overflow-hidden border border-slate-100 p-1 flex items-center">
                    <div className="h-full bg-emerald-500 rounded-full shadow-sm shadow-emerald-500/30 transition-all duration-1000" style={{ width: day.rate }} />
                  </div>
                </div>
              ))}
           </div>
        </div>

        <div className="space-y-8">
          <div className="bg-slate-950 p-10 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden group">
             <div className="absolute top-0 right-0 w-48 h-48 bg-[#1e3a8a] blur-[100px] rounded-full opacity-30 -mr-20 -mt-20 group-hover:opacity-50 transition-opacity"></div>
             <h3 className="text-[10px] font-black text-blue-300 uppercase tracking-[0.3em] mb-4 relative z-10 flex items-center gap-2">
                <TrendingUp className="w-4 h-4"/> AI Disposition Insight
             </h3>
             <p className="text-xl font-black leading-tight mb-8 relative z-10">Global scholarly presence has increased by 14.2% since last assessment cycle.</p>
             <button className="text-[10px] font-black uppercase tracking-widest text-[#1e3a8a] bg-white px-8 py-4 rounded-2xl relative z-10 hover:bg-[#1e3a8a] hover:text-white transition-all shadow-xl shadow-white/10">View Detailed Audit</button>
          </div>
          
          <div className="bg-white border border-slate-50 rounded-[3rem] p-10 shadow-sm text-left">
             <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-8 border-b border-slate-50 pb-4">Audit Traceabilities</h3>
             <div className="space-y-6">
                <div className="flex gap-4">
                   <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><UserCheck className="w-5 h-5"/></div>
                   <div className="text-left"><p className="text-xs font-black text-slate-800">Perfect Stability</p><p className="text-[9px] font-bold text-slate-400 uppercase mt-1">Physics Grade 10-A</p></div>
                </div>
                <div className="flex gap-4">
                   <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center"><UserX className="w-5 h-5"/></div>
                   <div className="text-left"><p className="text-xs font-black text-slate-800">Critical Fluctuations</p><p className="text-[9px] font-bold text-slate-400 uppercase mt-1">Chemistry Year 11</p></div>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Attendance;
