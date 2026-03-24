import React, { useState, useEffect } from "react";
import CreateAssignment from "@/components/CreateAssignment";
import GradeAssignment from "@/components/GradeAssignment";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, doc, deleteDoc, getDocs } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, FilePlus, Sparkles, Plus, GraduationCap, Trash2, Search, Filter, MoreVertical, Edit3, Eye, Calendar, Clock, CheckCircle2, ChevronRight } from "lucide-react";
import { toast } from "sonner";

const Assignments = () => {
  const { teacherData } = useAuth();
  const [view, setView] = useState<'list' | 'create' | 'grade'>('list');
  const [selectedAssignment, setSelectedAssignment] = useState<any>(null);
  
  const [assignmentsData, setAssignmentsData] = useState<any[]>([]);
  const [stats, setStats] = useState({
     totalActive: 0,
     dueThisWeek: 0,
     pendingGrading: 0,
     avgSubmission: 0
  });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!teacherData?.id) return;
    
    setLoading(true);
    const q = query(collection(db, "assignments"), where("teacherId", "==", teacherData.id));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const fetched = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const now = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(now.getDate() + 7);

      const enhanced = await Promise.all(fetched.map(async (a: any) => {
          // Robust Date Parsing
          let deadline: Date;
          if (a.dueDate) {
              deadline = a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
          } else if (a.deadline) {
              deadline = new Date(a.deadline);
          } else if (a.createdAt) {
              // Fallback: 7 days after creation if no deadline set
              const created = a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
              deadline = new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000);
          } else {
              deadline = new Date();
          }

          // Ensure it's a valid date
          if (isNaN(deadline.getTime())) deadline = new Date();

          // Fetch submissions for stats
          const subQ = query(collection(db, "submissions"), where("assignmentId", "==", a.id));
          const subSnap = await getDocs(subQ);
          const subCount = subSnap.size;

          const resQ = query(collection(db, "results"), where("assignmentId", "==", a.id));
          const resSnap = await getDocs(resQ);
          const pendingCount = Math.max(0, subCount - resSnap.size);

          const enrollQ = query(collection(db, "enrollments"), where("classId", "==", a.classId));
          const enrollSnap = await getDocs(enrollQ);
          const expectedCount = enrollSnap.size || 1;

          let calcStatus = "Active";
          if (pendingCount > 0) {
              calcStatus = `${pendingCount} To Grade`;
          } else if (deadline < now) {
              calcStatus = "Completed";
          } else if (subCount === expectedCount && expectedCount > 0) {
              calcStatus = "Fully Submitted";
          }

          return {
             ...a,
             deadline: deadline,
             submissionCount: subCount,
             expectedCount: expectedCount,
             pendingGradingCount: pendingCount,
             status: calcStatus
          };
      }));

      setAssignmentsData(enhanced);
      
      // Calculate Global Stats
      let activeCount = 0;
      let dueSoonCount = 0;
      let totalAssignedStudents = 0;
      let totalReceivedSubmissions = 0;

      enhanced.forEach(a => {
          if (a.deadline > now) activeCount++;
          if (a.deadline > now && a.deadline <= nextWeek) dueSoonCount++;
          totalReceivedSubmissions += a.submissionCount;
          totalAssignedStudents += a.expectedCount;
      });

      setStats({
          totalActive: activeCount,
          dueThisWeek: dueSoonCount,
          pendingGrading: enhanced.reduce((acc, curr) => acc + curr.pendingGradingCount, 0),
          avgSubmission: totalAssignedStudents > 0 ? Math.round((totalReceivedSubmissions / totalAssignedStudents) * 100) : 0
      });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [teacherData?.id]);

  const handleAction = (action: string, assignment: any) => {
    if (action === "Grade") {
      setSelectedAssignment(assignment);
      setView('grade');
    }
  };

  const getStatusStyle = (status: string) => {
      if (status.includes("To Grade")) return "bg-amber-50 text-amber-600 border-amber-100";
      if (status === "Fully Submitted") return "bg-emerald-50 text-emerald-600 border-emerald-100";
      if (status === "Completed") return "bg-slate-50 text-slate-400 border-slate-100";
      if (status === "Active") return "bg-blue-50 text-blue-600 border-blue-100";
      return "bg-slate-50 text-slate-600 border-slate-100";
  };

  const getTimeRemaining = (date: Date) => {
      const now = new Date();
      const diff = date.getTime() - now.getTime();
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
      if (days === 0) return "Today";
      if (days === 1) return "Tomorrow";
      if (days < 0) return `${Math.abs(days)} days ago`;
      return `${days} days left`;
  };

  if (view === 'create') {
    return <CreateAssignment onCancel={() => setView('list')} onCreate={() => setView('list')} />;
  }

  if (view === 'grade') {
    return <GradeAssignment assignment={selectedAssignment} onBack={() => setView('list')} />;
  }

  const filtered = assignmentsData.filter(a => a.title?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 text-left">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="text-left">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Assignments</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-1">Create, manage, and grade student curiculums.</p>
        </div>
        <button 
          onClick={() => setView('create')}
          className="bg-[#1e3a8a] text-white px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl hover:translate-y-[-2px] transition-all flex items-center gap-3 active:scale-95"
        >
          <Plus className="w-5 h-5" /> Create Assignment
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatMiniCard title="Total Active" value={stats.totalActive} color="bg-blue-50 text-blue-600" />
          <StatMiniCard title="Due This Week" value={stats.dueThisWeek} color="bg-amber-50 text-amber-600" />
          <StatMiniCard title="Pending Grading" value={stats.pendingGrading} color="bg-rose-50 text-rose-600" />
          <StatMiniCard title="Avg. Submission" value={`${stats.avgSubmission}%`} color="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="bg-white rounded-[2.5rem] border-2 border-slate-50 overflow-hidden shadow-sm">
          <div className="p-8 border-b border-slate-50 flex flex-col md:flex-row items-center justify-between gap-6">
             <div className="relative flex-1 w-full max-w-md">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                <input 
                  type="text" 
                  placeholder="Search assignments..." 
                  className="w-full pl-12 pr-6 py-3.5 bg-slate-50 border-none rounded-2xl text-xs font-bold focus:ring-4 focus:ring-blue-100 transition-all outline-none"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
             </div>
             <div className="flex items-center gap-3 w-full md:w-auto">
                <button className="flex-1 md:flex-none px-6 py-3.5 bg-white border-2 border-slate-50 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center justify-center gap-2 hover:bg-slate-50 transition-all">
                   <Filter className="w-4 h-4" /> Filter
                </button>
             </div>
          </div>

          <div className="overflow-x-auto">
             <table className="w-full text-left">
                <thead>
                   <tr className="bg-slate-50/30">
                      <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Assignment</th>
                      <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Class</th>
                      <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Due Date</th>
                      <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Submissions</th>
                      <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                      <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                   {loading ? (
                      [1,2,3].map(i => (
                         <tr key={i} className="animate-pulse">
                            <td colSpan={6} className="px-8 py-10"><div className="h-8 bg-slate-50 rounded-xl" /></td>
                         </tr>
                      ))
                   ) : filtered.length === 0 ? (
                      <tr>
                         <td colSpan={6} className="px-8 py-20 text-center text-slate-300 uppercase font-black text-[10px] tracking-widest italic">No Curriculums Found In Registry</td>
                      </tr>
                   ) : (
                      filtered.map((assign) => (
                         <tr key={assign.id} className="hover:bg-slate-50/30 transition-colors group">
                            <td className="px-8 py-6">
                               <div className="flex flex-col text-left">
                                  <span className="text-sm font-black text-slate-800 group-hover:text-[#1e3a8a] transition-colors uppercase">{assign.title}</span>
                                  <span className="text-[9px] font-bold text-slate-400 mt-1 uppercase max-w-[200px] truncate">{assign.description || "Experimental Unit Assessment"}</span>
                               </div>
                            </td>
                            <td className="px-8 py-6 font-bold text-slate-600 text-xs uppercase italic">{assign.className || "Class 8-A"}</td>
                            <td className="px-8 py-6 font-black text-slate-800 text-xs uppercase">{getTimeRemaining(assign.deadline)}</td>
                            <td className="px-8 py-6 text-center">
                               <div className="flex flex-col items-center">
                                  <span className="text-sm font-black text-slate-700">{assign.submissionCount} <span className="text-slate-300 font-bold">/ {assign.expectedCount}</span></span>
                                  <div className="w-16 h-1 bg-slate-100 rounded-full mt-2 overflow-hidden">
                                     <div className="h-full bg-emerald-500" style={{ width: `${(assign.submissionCount/assign.expectedCount)*100}%` }} />
                                  </div>
                               </div>
                            </td>
                            <td className="px-8 py-6 text-center">
                               <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${getStatusStyle(assign.status)}`}>
                                  {assign.status}
                               </span>
                            </td>
                            <td className="px-8 py-6">
                               <div className="flex items-center justify-end gap-2">
                                  <button 
                                    onClick={() => handleAction("Grade", assign)}
                                    className="px-4 py-2 text-[10px] font-black text-[#1e3a8a] hover:bg-blue-50 rounded-xl transition-all"
                                  >
                                    Grade
                                  </button>
                                  <button className="px-4 py-2 text-[10px] font-black text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all">Edit</button>
                                  <button className="p-2 text-slate-300 hover:text-rose-500 rounded-xl transition-all"><Trash2 className="w-4 h-4" /></button>
                               </div>
                            </td>
                         </tr>
                      ))
                   )}
                </tbody>
             </table>
          </div>
      </div>
    </div>
  );
};

const StatMiniCard = ({ title, value, color }: any) => (
   <div className="bg-white border-2 border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center justify-between text-left">
      <div>
         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
         <h3 className="text-3xl font-black text-slate-800 leading-none">{value}</h3>
      </div>
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black ${color}`}>
         <CheckCircle2 className="w-6 h-6" />
      </div>
   </div>
);

export default Assignments;
