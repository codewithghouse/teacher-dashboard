import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs, doc, getDoc, updateDoc } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { 
  Users, Activity, TrendingUp, AlertTriangle, 
  Search, Filter, ChevronLeft, ChevronRight, 
  MoreVertical, Loader2, Sparkles, UserCheck, Download, Edit2, Check, X
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from 'xlsx';

const ClassDetail = () => {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { teacherData } = useAuth();
  
  const [classInfo, setClassInfo] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Students");
  const [searchQuery, setSearchQuery] = useState("");
  const [exporting, setExporting] = useState(false);

  // Inline editing states
  const [editingRoll, setEditingRoll] = useState<string | null>(null);
  const [tempRoll, setTempRoll] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const [stats, setStats] = useState({
    totalStudents: 0,
    attendanceRate: "0%",
    avgScore: "0%",
    atRiskCount: 0
  });

  useEffect(() => {
    if (!classId) return;

    // 1. Fetch Class Metadata
    const fetchClass = async () => {
      const docRef = doc(db, "classes", classId);
      const snap = await getDoc(docRef);
      if (snap.exists()) setClassInfo(snap.data());
    };
    fetchClass();

    // 2. Fetch Roster & Metrics
    const q = query(collection(db, "enrollments"), where("classId", "==", classId));
    const unsub = onSnapshot(q, async (snap) => {
      const roster = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const enrichedStudents = await Promise.all(roster.map(async (s: any) => {
          const atndQ = query(collection(db, "attendance"), where("studentId", "==", s.studentId), where("classId", "==", classId));
          const atndSnap = await getDocs(atndQ);
          const presentCount = atndSnap.docs.filter(d => d.data().status === 'present' || d.data().status === 'late').length;
          const atndRate = atndSnap.size > 0 ? (presentCount / atndSnap.size) * 100 : 95.0;

          const resQ = query(collection(db, "results"), where("studentId", "==", s.studentId), where("classId", "==", classId));
          const resSnap = await getDocs(resQ);
          const totalScore = resSnap.docs.reduce((acc, curr) => acc + (parseFloat(curr.data().score) || 0), 0);
          const avgScore = resSnap.size > 0 ? totalScore / resSnap.size : 78.5;

          // Use manually set status if exists, otherwise calculate
          let standing = s.manualStatus || (atndRate < 80 || avgScore < 60 ? "At Risk" : (atndRate < 90 || avgScore < 75 ? "Needs Attention" : "Good Standing"));

          return {
             ...s,
             initials: s.studentName?.substring(0, 2).toUpperCase() || "ST",
             rollNo: s.rollNo || "N/A",
             attendance: atndRate.toFixed(1) + "%",
             avg: avgScore.toFixed(1) + "%",
             status: standing,
             atndRaw: atndRate,
             scoreRaw: avgScore
          };
      }));

      setStudents(enrichedStudents);
      
      const totalAtnd = enrichedStudents.reduce((acc, curr) => acc + curr.atndRaw, 0) / (enrichedStudents.length || 1);
      const totalScore = enrichedStudents.reduce((acc, curr) => acc + curr.scoreRaw, 0) / (enrichedStudents.length || 1);
      const atRisk = enrichedStudents.filter(s => s.status === "At Risk").length;

      setStats({
          totalStudents: enrichedStudents.length,
          attendanceRate: totalAtnd.toFixed(1) + "%",
          avgScore: totalScore.toFixed(1) + "%",
          atRiskCount: atRisk
      });
      setLoading(false);
    });

    return () => unsub();
  }, [classId]);

  const handleUpdateRoll = async (id: string) => {
      setIsUpdating(true);
      try {
          await updateDoc(doc(db, "enrollments", id), { rollNo: tempRoll });
          toast.success("Identity Matrix Updated.");
          setEditingRoll(null);
      } catch (e) {
          toast.error("Cloud Sync Failure.");
      } finally {
          setIsUpdating(false);
      }
  };

  const handleToggleStatus = async (id: string, currentStatus: string) => {
      const statuses = ["Good Standing", "Needs Attention", "At Risk"];
      const nextIdx = (statuses.indexOf(currentStatus) + 1) % statuses.length;
      const nextStatus = statuses[nextIdx];
      
      try {
          await updateDoc(doc(db, "enrollments", id), { manualStatus: nextStatus });
          toast.success(`Standing updated to ${nextStatus}`);
      } catch (e) {
          toast.error("Failed to update status.");
      }
  };

  const handleExport = () => {
    setExporting(true);
    try {
      const exportData = students.map(s => ({
        'Student Name': s.studentName,
        'Email': s.studentEmail,
        'Roll Number': s.rollNo,
        'Attendance': s.attendance,
        'Average Score': s.avg,
        'Academic Health': s.status
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Roster");
      XLSX.writeFile(wb, `${classInfo?.name || 'Class'}_Roster.xlsx`);
      toast.success("Roster exported to Excel!");
    } catch (e) {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (loading) return (
     <div className="h-[70vh] flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-6" />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Accessing Roster Ecosystem...</p>
     </div>
  );

  const filtered = students.filter(s => s.studentName?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left space-y-10">
      {/* Header View */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="text-left">
           <h1 className="text-4xl font-black text-slate-800 tracking-tight leading-none mb-3">{classInfo?.name || "Class Group"}</h1>
           <p className="text-sm font-bold text-slate-400">
              {classInfo?.subject || "Curriculum"} • {stats.totalStudents} Students • Mon-Fri 09:00 AM
           </p>
        </div>
        <div className="flex items-center gap-4">
            <button 
              onClick={handleExport}
              disabled={exporting}
              className="px-8 py-4 bg-white border border-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-sm hover:bg-slate-50 transition-all flex items-center gap-2"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4"/>} Export Roster
            </button>
            <button 
              onClick={() => navigate("/attendance")}
              className="bg-[#1e3a8a] text-white px-10 py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-blue-900/10 hover:bg-slate-900 transition-all active:scale-95 whitespace-nowrap"
            >
              Mark Attendance
            </button>
        </div>
      </div>

      {/* Primary Tabs */}
      <div className="flex gap-12 border-b-2 border-slate-50 relative pb-0 overflow-x-auto no-scrollbar">
        {["Students", "Attendance", "Assignments", "Tests", "Performance"].map((t) => (
          <button 
            key={t} 
            onClick={() => setActiveTab(t)}
            className={`pb-5 text-[11px] font-black uppercase tracking-[0.2em] transition-all relative whitespace-nowrap ${activeTab === t ? "text-[#1e3a8a]" : "text-slate-400 hover:text-slate-600"}`}
          >
            {t}
            {activeTab === t && <div className="absolute bottom-[-2px] left-0 w-full h-1 bg-[#1e3a8a] rounded-full animate-in zoom-in duration-500" />}
          </button>
        ))}
      </div>

      {/* Metrics Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
         <MetricMiniCard label="Total Students" value={stats.totalStudents} color="bg-blue-50 text-blue-500" />
         <MetricMiniCard label="Attendance" value={stats.attendanceRate} color="bg-emerald-50 text-emerald-500" />
         <MetricMiniCard label="Avg. Score" value={stats.avgScore} color="bg-blue-50 text-blue-500" />
         <MetricMiniCard label="At Risk" value={stats.atRiskCount} color="bg-rose-50 text-rose-500" />
      </div>

      {/* Institutional Student Roster Table */}
      <div className="bg-white border border-slate-100 rounded-[2rem] shadow-sm overflow-hidden text-left pt-6 pb-2">
          <div className="px-8 flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
             <h2 className="text-xl font-black text-slate-800 tracking-tight">Student List</h2>
             <div className="flex items-center gap-3 w-full md:w-auto">
                <div className="flex-1 md:w-48 relative">
                   <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                   <input 
                      type="text" 
                      placeholder="Search roster..." 
                      className="w-full pl-12 pr-6 h-12 bg-slate-50 border-none rounded-xl text-xs font-bold outline-none"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                   />
                </div>
                <button 
                  onClick={() => navigate("/my-classes")}
                  className="px-6 h-12 bg-indigo-50 text-[#1e3a8a] rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-indigo-100 transition-all"
                >
                   <Users className="w-4 h-4"/> Enroll Student
                </button>
             </div>
          </div>

          <div className="overflow-x-auto">
             <table className="w-full text-left">
                <thead className="bg-[#f8fafc]/50">
                   <tr>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Student</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Roll No</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Attendance</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Avg. Score</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {filtered.length === 0 ? (
                      <tr><td colSpan={6} className="px-8 py-20 text-center uppercase font-black text-slate-200 text-[10px] tracking-widest">No candidates in current view</td></tr>
                   ) : (
                      filtered.map((s) => (
                         <tr key={s.id} className="hover:bg-slate-50/50 transition-all group">
                            <td className="px-8 py-6">
                               <div className="flex flex-col text-left">
                                  <span className="text-[10px] font-black text-slate-400 uppercase mb-2 group-hover:text-[#1e3a8a] transition-colors">{s.initials}</span>
                                  <span className="text-[15px] font-black text-slate-800 leading-tight block">{s.studentName}</span>
                                  <span className="text-[11px] font-bold text-slate-400 block mt-1">{s.studentEmail}</span>
                               </div>
                            </td>
                            <td className="px-8 py-6 text-center">
                               {editingRoll === s.id ? (
                                  <div className="flex items-center justify-center gap-2">
                                     <input 
                                       className="w-16 h-8 text-center text-xs font-black bg-slate-50 border border-slate-200 rounded outline-none" 
                                       value={tempRoll} 
                                       onChange={e=>setTempRoll(e.target.value)}
                                       autoFocus
                                     />
                                     <button onClick={() => handleUpdateRoll(s.id)} className="text-emerald-500"><Check size={14}/></button>
                                     <button onClick={() => setEditingRoll(null)} className="text-slate-300"><X size={14}/></button>
                                  </div>
                               ) : (
                                  <div className="flex items-center justify-center gap-2 group/edit cursor-pointer" onClick={() => { setEditingRoll(s.id); setTempRoll(s.rollNo); }}>
                                     <span className="text-[13px] font-bold text-slate-800">{s.rollNo}</span>
                                     <Edit2 size={10} className="text-slate-200 opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                                  </div>
                               )}
                            </td>
                            <td className="px-8 py-6 text-center text-[13px] font-black text-slate-800 leading-none">{s.attendance}</td>
                            <td className="px-8 py-6 text-center text-[13px] font-black text-slate-800 leading-none">{s.avg}</td>
                            <td className="px-8 py-6 text-center">
                               <button 
                                 onClick={() => handleToggleStatus(s.id, s.status)}
                                 className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                                    s.status === "Good Standing" ? "bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100" : 
                                    s.status === "Needs Attention" ? "bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100" : "bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100"
                                 }`}
                               >
                                  {s.status}
                               </button>
                            </td>
                            <td className="px-8 py-6 text-right">
                               <button 
                                 onClick={() => navigate(`/students?id=${s.studentId}`)}
                                 className="text-xs font-black text-slate-800 hover:text-[#1e3a8a] transition-colors"
                               >
                                  View Profile
                               </button>
                            </td>
                         </tr>
                      ))
                   )}
                </tbody>
             </table>
          </div>

          <div className="px-8 py-8 flex items-center justify-between border-t border-slate-50 mt-4">
             <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Showing {filtered.length} of {stats.totalStudents} students</p>
             <div className="flex items-center gap-2">
                <button className="px-4 py-2 text-[10px] font-black uppercase text-slate-400 border border-slate-100 rounded-lg hover:bg-slate-50 transition-all">Previous</button>
                <div className="flex gap-1">
                   <button className="w-10 h-10 bg-[#1e3a8a] text-white rounded-lg text-xs font-black">1</button>
                   <button className="w-10 h-10 bg-white border border-slate-100 text-slate-400 rounded-lg text-xs font-black">2</button>
                   <button className="w-10 h-10 bg-white border border-slate-100 text-slate-400 rounded-lg text-xs font-black">3</button>
                </div>
                <button className="px-4 py-2 text-[10px] font-black uppercase text-slate-800 border border-slate-100 rounded-lg hover:bg-slate-50 transition-all">Next</button>
             </div>
          </div>
      </div>
    </div>
  );
};

const MetricMiniCard = ({ label, value, color }: any) => (
   <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm flex items-center gap-6 group hover:shadow-xl transition-all">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${color} shadow-inner group-hover:scale-110 transition-transform`} />
      <div className="text-left">
         <p className="text-3xl font-black text-slate-800 leading-none mb-1">{value}</p>
         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      </div>
   </div>
);

export default ClassDetail;
