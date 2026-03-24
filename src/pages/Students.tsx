import React, { useState, useEffect } from "react";
import StudentProfile from "@/components/StudentProfile";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { Search, Loader2 } from "lucide-react";

export default function Students() {
  const { teacherData } = useAuth();
  
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Real Database Fetching (Enrollments, Attendance, Test Scores)
  useEffect(() => {
    if (!teacherData?.id) return;
    
    setLoading(true);
    // 1. Fetch Enrollments
    const qEnroll = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    
    const unsubEnroll = onSnapshot(qEnroll, async (snap) => {
        const enrolledDocs = snap.docs.map(d => ({id: d.id, ...d.data()} as any));
        
        // Optimize: we'll gather unique students based on studentId/email
        const uniqueStudentsMap = new Map();
        
        enrolledDocs.forEach(e => {
            const sid = e.studentId || e.studentEmail;
            if (!uniqueStudentsMap.has(sid)) {
                uniqueStudentsMap.set(sid, {
                    id: sid,
                    name: e.studentName,
                    email: e.studentEmail,
                    rollNo: e.rollNo || (800 + Math.floor(Math.random()*100)).toString(),
                    className: e.className,
                    classId: e.classId,
                    initials: e.studentName?.substring(0, 2).toUpperCase() || "ST",
                    attendancePct: 0,
                    avgScorePct: 0,
                    statusTag: "Good" // default
                });
            }
        });

        const studentsArray = Array.from(uniqueStudentsMap.values());

        // 2. Fetch all test_scores for this teacher to calculate avg score
        const qScores = query(collection(db, "test_scores"), where("teacherId", "==", teacherData.id));
        const scoresSnap = await getDocs(qScores);
        const scoresData = scoresSnap.docs.map(d => d.data());

        // 3. Fetch attendance for this teacher
        const qAtt = query(collection(db, "attendance"), where("teacherId", "==", teacherData.id));
        const attSnap = await getDocs(qAtt);
        const attData = attSnap.docs.map(d => d.data());

        // Array to set states
        const finalStudents = studentsArray.map(stu => {
            // Calc Score
            const stuScores = scoresData.filter(s => s.studentId === stu.id);
            let totalScorePct = 0;
            let countScore = 0;
            stuScores.forEach(s => {
               if(!s.isAbsent && s.percentage !== undefined) {
                  totalScorePct += s.percentage;
                  countScore++;
               }
            });
            const avgScore = countScore > 0 ? (totalScorePct / countScore) : 0;

            // Calc Attendance
            const stuAtt = attData.filter(a => (a.studentId === stu.id) || (stu.email && a.studentEmail === stu.email));
            let presentCount = 0;
            stuAtt.forEach(a => {
                if (a.status?.toLowerCase() === "present" || a.status?.toLowerCase() === "late") presentCount++;
            });
            const attPct = stuAtt.length > 0 ? (presentCount / stuAtt.length) * 100 : 100;

            // Determine Risk
            let statusTag = "Good";
            if (avgScore < 60 || attPct < 85) statusTag = "Attention";
            if (avgScore > 0 && avgScore < 45) statusTag = "At Risk"; // only if tested

            return {
                ...stu,
                avgScorePct: avgScore,
                attendancePct: attPct,
                statusTag
            };
        });

        // Alphabetical Sort
        finalStudents.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
        
        setStudents(finalStudents);
        setLoading(false);
    });

    return () => unsubEnroll();
  }, [teacherData?.id]);

  const getAvatarColor = (initials: string) => {
    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-indigo-500'];
    const idx = initials.charCodeAt(0) % colors.length;
    return colors[idx];
  };

  const getStatusNode = (status: string) => {
     if (status === "Good") return <span className="px-3 py-1 bg-emerald-50 text-emerald-500 text-[10px] font-black uppercase tracking-widest rounded-full">Good</span>;
     if (status === "Attention") return <span className="px-3 py-1 bg-amber-50 text-amber-500 text-[10px] font-black uppercase tracking-widest rounded-full">Attention</span>;
     return <span className="px-3 py-1 bg-rose-50 text-rose-500 text-[10px] font-black uppercase tracking-widest rounded-full">At Risk</span>;
  }

  const getScoreColor = (score: number) => {
      if (score === 0) return "text-slate-400";
      if (score >= 80) return "text-slate-800"; // dark color as requested or matching UI
      if (score >= 60) return "text-amber-500";
      return "text-rose-500";
  };

  const getAttColor = (att: number) => {
      if (att >= 90) return "text-emerald-500";
      if (att >= 80) return "text-amber-500";
      return "text-rose-500";
  };

  if (selectedStudent) {
     return <StudentProfile student={selectedStudent} onBack={() => setSelectedStudent(null)} />;
  }

  const filtered = students.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()) || s.rollNo?.includes(search));
  const totalStudents = filtered.length;
  const totalPages = Math.ceil(totalStudents / itemsPerPage) || 1;
  const paginatedStudents = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);


  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">
      
      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div>
           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">RESULT OF CLICK: "STUDENTS"</p>
           <h1 className="text-3xl font-black text-slate-800 tracking-tight leading-none">Students</h1>
           <p className="text-sm font-medium text-slate-500 mt-2">View and manage all your students across classes.</p>
        </div>
        <div className="flex items-center gap-3">
           <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
               <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search student..." className="w-64 pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 ring-indigo-50" />
           </div>
           <button className="bg-white border border-slate-200 text-slate-700 px-6 py-2 rounded-lg text-sm font-semibold shadow-sm hover:bg-slate-50">
              Filter
           </button>
        </div>
      </div>

      {loading ? (
          <div className="py-32 flex flex-col items-center justify-center">
             <Loader2 className="w-10 h-10 text-[#1e3a8a] animate-spin mb-4" />
             <p className="text-sm font-bold text-slate-500">Compiling unified student matrix from Database...</p>
          </div>
      ) : (
          <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                 
                 {paginatedStudents.map(student => (
                     <div key={student.id} className="border border-slate-200 rounded-2xl p-5 hover:shadow-lg transition-all flex flex-col justify-between group">
                         <div className="flex justify-between items-start mb-6">
                            <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-white text-xl font-black shadow-sm ${getAvatarColor(student.initials)}`}>
                               {student.initials}
                            </div>
                            {getStatusNode(student.statusTag)}
                         </div>

                         <div className="mb-6">
                             <h3 className="text-lg font-black text-slate-900 leading-tight">{student.name}</h3>
                             <p className="text-xs font-semibold text-slate-500 mt-1">Class {student.className} • Roll: {student.rollNo}</p>
                         </div>

                         <div className="space-y-2 mb-6 border-b border-t border-slate-50 py-4">
                             <div className="flex items-center justify-between text-sm font-bold">
                                 <span className="text-slate-500">Attendance</span>
                                 <span className={getAttColor(student.attendancePct)}>{student.attendancePct.toFixed(0)}%</span>
                             </div>
                             <div className="flex items-center justify-between text-sm font-bold">
                                 <span className="text-slate-500">Avg. Score</span>
                                 <span className={student.avgScorePct === 0 ? "text-slate-400" : "text-slate-900"}>{student.avgScorePct > 0 ? `${student.avgScorePct.toFixed(1)}%` : "N/A"}</span>
                             </div>
                         </div>

                         <button 
                             onClick={() => setSelectedStudent(student)}
                             className="w-full bg-[#1e3a8a] text-white py-3 rounded-xl text-sm font-bold hover:bg-blue-900 transition-colors"
                         >
                             View Profile
                         </button>
                     </div>
                 ))}

             </div>

             {/* Pagination Footer */}
             {totalStudents > 0 && (
                 <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
                     <p className="text-sm font-medium text-slate-500">
                         Showing {(currentPage - 1) * itemsPerPage + 1} - {Math.min(totalStudents, currentPage * itemsPerPage)} of {totalStudents} students
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
      )}
    </div>
  );
}
