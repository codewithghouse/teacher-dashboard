import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, getDocs, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { 
  Loader2, Users, Activity, TrendingUp, AlertCircle, 
  Calendar, Clock, CheckCircle, FileText, Bell, 
  Layout, GraduationCap, ClipboardCheck, MessageSquare, Sparkles, BrainCircuit, Heart, Search, ArrowUpRight,
  ShieldCheck, Presentation, Zap, ShieldAlert, MoreVertical
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const StatCard = ({ label, value, tag, tagColor, iconColor, unit = "" }: any) => {
   return (
      <div className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
         <div className="flex items-center justify-between mb-6">
            <div className={`w-12 h-12 rounded-lg ${iconColor} flex items-center justify-center`} />
            <div className={`px-3 py-1 rounded-full text-[10px] font-bold ${tagColor}`}>
               {tag}
            </div>
         </div>
         <div>
            <h2 className="text-4xl font-bold text-slate-800 tracking-tight">{value}{unit}</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">{label}</p>
         </div>
      </div>
   );
};

const Dashboard = () => {
  const { teacherData } = useAuth();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    avgAttendance: 0,
    pendingGrading: 0,
    atRiskCount: 0,
    activeClasses: 0
  });

  const [todayClasses, setTodayClasses] = useState<any[]>([]);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [criticalStudents, setCriticalStudents] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Real-time attendance rate — updates immediately after teacher marks attendance
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "attendance"), where("teacherId", "==", teacherData.id));
    return onSnapshot(q, (snap) => {
      const att = snap.docs.map(d => d.data());
      const totalPres = att.filter((a: any) => a.status === 'present' || a.status === 'late').length;
      const avgAtnd = att.length > 0 ? Number(((totalPres / att.length) * 100).toFixed(1)) : 0;
      setStats(prev => ({ ...prev, avgAttendance: avgAtnd }));
    });
  }, [teacherData?.id]);

  useEffect(() => {
    if (!teacherData?.email && !teacherData?.id) return;
    setLoading(true);

    const tId = teacherData.id;
    const tEmail = teacherData.email?.toLowerCase();

    // 1. DATA HARVESTING - WIDER NET (Assignments + Classes by ID/Email)
    const harvestAssignments = async () => {
       try {
         // Query assignments by ID
         const q1 = query(collection(db, "teaching_assignments"), where("teacherId", "==", tId));
         const q2 = query(collection(db, "classes"), where("teacherId", "==", tId));
         
         // Query by email (common secondary identifier)
         const q3 = query(collection(db, "teaching_assignments"), where("teacherEmail", "==", tEmail));
         const q4 = query(collection(db, "classes"), where("teacherEmail", "==", tEmail));
         const q5 = query(collection(db, "classes"), where("teacher_id", "==", tId)); // Underscore check

         const [s1, s2, s3, s4, s5] = await Promise.all([
            getDocs(q1), getDocs(q2), getDocs(q3), getDocs(q4), getDocs(q5)
         ]);

         const allAssignments = [
            ...s1.docs.map(d => ({ id: d.id, ...d.data() })),
            ...s3.docs.map(d => ({ id: d.id, ...d.data() })),
            ...s2.docs.map(d => ({ id: d.id, ...d.data(), classId: d.id, className: d.data().name })),
            ...s4.docs.map(d => ({ id: d.id, ...d.data(), classId: d.id, className: d.data().name })),
            ...s5.docs.map(d => ({ id: d.id, ...d.data(), classId: d.id, className: d.data().name }))
         ];

         const uniqueAssignmentsMap = new Map();
         allAssignments.forEach((a: any) => {
            const cid = a.classId || a.id;
            if (!uniqueAssignmentsMap.has(cid)) uniqueAssignmentsMap.set(cid, a);
         });
         const assignments = Array.from(uniqueAssignmentsMap.values());

         if (assignments.length === 0) {
            setStats({ avgAttendance: 0, pendingGrading: 0, atRiskCount: 0, activeClasses: 0 });
            setTodayClasses([]);
            setPendingTasks([]);
            setCriticalStudents([]);
            setLoading(false);
            return;
         }

         const classIds = assignments.map(a => a.classId || a.id);
         
         // 2. CHILD CONTEXT HARVESTING
         const [studentsSnap, attSnap, scoresSnap, resultsSnap] = await Promise.all([
            getDocs(query(collection(db, "enrollments"), where("classId", "in", classIds))),
            getDocs(query(collection(db, "attendance"), where("teacherId", "==", tId))),
            getDocs(query(collection(db, "gradebook_scores"), where("teacherId", "==", tId))),
            getDocs(query(collection(db, "results"), where("teacherId", "==", tId)))
         ]);

         const students = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
         const att = attSnap.docs.map(d => d.data());
         const scores = [...scoresSnap.docs.map(d => d.data()), ...resultsSnap.docs.map(d => d.data())];

         // Calculations
         const totalPres = att.filter(a => a.status === 'present' || a.status === 'late').length;
         const avgAtnd = att.length > 0 ? (totalPres / att.length) * 100 : 0;
         const pendingRev = scores.filter(s => s.status === 'pending').length;

         setStats({
            avgAttendance: Number(avgAtnd.toFixed(1)),
            pendingGrading: pendingRev,
            atRiskCount: 0, // Calculated below
            activeClasses: assignments.length
         });

         // Pending Tasks Logic
         const tasks: any[] = [];
         const todayStr = new Date().toISOString().split('T')[0];
         const markedToday = new Set(att.filter(a => a.date === todayStr).map(a => a.classId || a.assignmentId));
         const pendingClasses = assignments.filter(a => !markedToday.has(a.classId || a.id));

         if (pendingClasses.length > 0) tasks.push({ title: 'Mark Attendance', sub: `${pendingClasses.length} subdivisions pending`, color: 'bg-amber-500' });
         if (pendingRev > 0) tasks.push({ title: 'Grade Unit Test Papers', sub: `${pendingRev} pending reviewer`, count: pendingRev, color: 'bg-rose-500' });

         setPendingTasks(tasks);

         // Risks & Trajectory
         let rCount = 0;
         const rList = students.map(s => {
            const sId = s.studentId, sEmail = s.studentEmail?.toLowerCase();
            const f = (arr: any[]) => arr.filter(i => (sId && (i.studentId === sId || i.id?.includes(sId))) || (sEmail && i.studentEmail?.toLowerCase() === sEmail));
            const sAtt = f(att);
            const sScores = f(scores);
            const sA = sAtt.length > 0 ? (sAtt.filter(a => a.status === 'present' || a.status === 'late').length / sAtt.length) * 100 : 100;
            const sM = sScores.length > 0 ? (sScores.reduce((acc, c) => acc + Number(c.percentage || (c.mark/c.maxMarks*100) || c.score || 0), 0) / sScores.length) : 80;
            
            let lvl = "stable";
            let trig = "On Track";
            if (sA < 75 || sM < 60) { lvl = "critical"; trig = sA < 75 ? "Attendance Failure" : "Merit Decline"; rCount++; }
            else if (sA < 85 || sM < 70) { lvl = "observation"; trig = "Registry Dip"; }
            return { ...s, level: lvl, trigger: trig, score: sM, atnd: sA };
         }).filter(s => s.level !== "stable").sort((a,b) => (a.level === 'critical' ? -1 : 1)).slice(0, 4);

         setStats(prev => ({ ...prev, atRiskCount: rCount }));
         setCriticalStudents(rList);
         
         setTodayClasses(assignments.slice(0, 4).map((a, i) => ({
            time: i === 0 ? '08:00' : (i === 1 ? '10:00' : (i === 2 ? '12:30' : '02:30')),
            period: i < 2 ? 'AM' : 'PM',
            subject: a.subjectName || a.subject || "Registry",
            class: a.className || a.name || "Class",
            students: students.filter(s => s.classId === (a.classId || a.id)).length,
            isNow: i === 0
         })));

       } catch (error) {
         console.error("Dashboard Harvest Failure:", error);
       } finally {
         setLoading(false);
       }
    };

    harvestAssignments();
  }, [teacherData?.id, teacherData?.email]);

  if (loading) return (
     <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
     </div>
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] p-8 font-sans text-left">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
           <h1 className="text-3xl font-bold text-slate-800">Dashboard</h1>
           <p className="text-slate-500 text-sm mt-1">Welcome back! Here's what's happening today.</p>
        </div>
        <div className="flex items-center gap-4">
           <div className="bg-white px-6 py-2 rounded-xl border border-slate-100 shadow-sm text-sm font-semibold text-slate-600">
              {currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
           </div>
           <div className="relative">
              <div className="w-10 h-10 bg-white rounded-xl border border-slate-100 flex items-center justify-center shadow-sm">
                 <Bell size={20} className="text-slate-400" />
              </div>
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">3</span>
           </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
         <StatCard label="Attendance Rate" value={stats.avgAttendance} unit="%" tag={stats.avgAttendance > 90 ? "Stable" : "Action Required"} tagColor={stats.avgAttendance > 90 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"} iconColor="bg-blue-100" />
         <StatCard label="Pending Grading" value={stats.pendingGrading} tag={stats.pendingGrading > 0 ? "Urgent" : "Sync Complete"} tagColor={stats.pendingGrading > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"} iconColor="bg-amber-100" />
         <StatCard label="At-Risk Students" value={stats.atRiskCount} tag={stats.atRiskCount > 0 ? "Attention" : "Secure"} tagColor={stats.atRiskCount > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"} iconColor="bg-rose-100" />
         <StatCard label="Classes Today" value={stats.activeClasses} tag="Real-time" tagColor="bg-emerald-50 text-emerald-600" iconColor="bg-blue-100" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         
         {/* Today's Classes */}
         <div className="bg-white rounded-2xl border border-slate-100 p-6 flex flex-col shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-6 font-primary">Today's Classes</h3>
            <div className="space-y-4">
               {todayClasses.length > 0 ? todayClasses.map((cls, idx) => (
                  <div key={idx} className="flex gap-4 p-4 rounded-xl border border-slate-50 hover:bg-slate-50 transition-colors group relative cursor-pointer" onClick={() => navigate('/my-classes')}>
                     {cls.isNow && <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-blue-600 rounded-r-full" />}
                     <div className="flex flex-col items-center justify-center min-w-[65px]">
                        <span className="text-sm font-bold text-slate-800">{cls.time}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">{cls.period}</span>
                     </div>
                     <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                           <h4 className="font-bold text-slate-800 truncate leading-tight mb-0.5">{cls.subject}</h4>
                           {cls.isNow && <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded uppercase">Now</span>}
                        </div>
                        <p className="text-[11px] text-slate-500 font-medium italic">Class {cls.class} • {cls.students} scholars</p>
                     </div>
                  </div>
               )) : (
                  <div className="py-20 text-center opacity-30 font-bold uppercase text-[10px] tracking-widest italic">No subdivisions identified.</div>
               )}
            </div>
         </div>

         {/* Pending Tasks */}
         <div className="bg-white rounded-2xl border border-slate-100 p-6 flex flex-col shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-6 font-primary">Pending Tasks</h3>
            <div className="space-y-4">
               {pendingTasks.length > 0 ? pendingTasks.map((task, idx) => (
                  <div key={idx} className="bg-white rounded-xl border border-slate-50 p-4 transition-all hover:shadow-sm group cursor-pointer" onClick={() => navigate(task.title.includes('Attendance') ? '/attendance' : '/gradebook')}>
                     <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-lg ${task.color} flex items-center justify-center text-white shadow-md transition-all group-hover:rotate-6`}>
                           {task.count ? <span className="font-bold">{task.count}</span> : <ClipboardCheck className="w-6 h-6" />}
                        </div>
                        <div className="flex-1">
                           <div className="flex items-center justify-between">
                              <h4 className="font-bold text-slate-800 text-sm leading-tight">{task.title}</h4>
                              {task.count && <span className="w-5 h-5 bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center rounded-full">{task.count}</span>}
                           </div>
                           <p className="text-[10px] text-slate-400 font-black mt-1 uppercase tracking-tighter italic">{task.sub}</p>
                        </div>
                     </div>
                  </div>
               )) : (
                  <div className="py-20 text-center opacity-30 font-bold uppercase text-[10px] tracking-widest italic">Registry synchronized.</div>
               )}
            </div>
         </div>

         {/* Students Needing Attention */}
         <div className="bg-white rounded-2xl border border-slate-100 p-6 flex flex-col shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-6 font-primary">Students Needing Attention</h3>
            <div className="space-y-4">
               {criticalStudents.length > 0 ? criticalStudents.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-4 p-4 rounded-xl border border-slate-50">
                     <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold ${idx % 4 === 0 ? 'bg-rose-500' : (idx % 4 === 1 ? 'bg-amber-500' : (idx % 4 === 2 ? 'bg-orange-500' : 'bg-[#1e3a8a]'))}`}>
                        {s.studentName?.[0]}
                        {s.studentName?.split(' ')[1]?.[0]}
                     </div>
                     <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-slate-800 truncate">{s.studentName}</h4>
                        <p className={`text-[10px] font-black uppercase tracking-tighter ${s.level === 'critical' ? 'text-rose-500' : 'text-amber-500'}`}>{s.trigger}</p>
                     </div>
                     <button onClick={() => navigate('/parent-notes')} className={`px-4 py-1.5 rounded-lg text-[10px] font-bold text-white transition-all active:scale-95 ${idx % 4 === 0 ? 'bg-rose-500 hover:bg-rose-600' : (idx % 4 === 1 ? 'bg-amber-500 hover:bg-amber-600' : (idx % 4 === 2 ? 'bg-orange-500 hover:bg-orange-600' : 'bg-[#1e3a8a] hover:bg-black'))}`}>
                        {idx % 4 === 0 ? 'Notify' : (idx % 4 === 1 ? 'Review' : (idx % 4 === 2 ? 'Remind' : 'Help'))}
                     </button>
                  </div>
               )) : (
                  <div className="py-20 text-center opacity-30 font-bold uppercase text-[10px] tracking-widest italic">Scholar manifest stable.</div>
               )}
            </div>
         </div>

      </div>
    </div>
  );
};

export default Dashboard;
