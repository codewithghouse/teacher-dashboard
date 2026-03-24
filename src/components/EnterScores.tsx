import React, { useState, useEffect } from 'react';
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs, doc, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, Search, ChevronLeft } from 'lucide-react';
import { toast } from "sonner";

interface EnterScoresProps {
  test: any;
  onBack: () => void;
}

export default function EnterScores({ test, onBack }: EnterScoresProps) {
  const { teacherData } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  const maxScore = parseFloat(test?.marks) || 50;

  useEffect(() => {
    if (!test?.classId || !teacherData?.id) return;
    
    // Fetch Enrollments to get roster
    const qRoster = query(
      collection(db, "enrollments"), 
      where("classId", "==", test.classId),
      where("teacherId", "==", teacherData.id)
    );
    
    const unsub = onSnapshot(qRoster, async (snap) => {
      // Get existing scores if they were already saved previously
      const qScores = query(collection(db, "test_scores"), where("testId", "==", test.id));
      const scoresSnap = await getDocs(qScores);
      const existingScores = scoresSnap.docs.map(d => d.data());

      const roster = snap.docs.map(d => {
        const data = d.data() as any;
        const studentId = data.studentId || d.id;
        
        const existing = existingScores.find(s => s.studentId === studentId);
        
        return {
          id: studentId,
          name: data.studentName,
          email: data.studentEmail,
          rollNo: data.rollNo || (800 + Math.floor(Math.random() * 100)),
          initials: data.studentName?.substring(0, 2).toUpperCase() || "ST",
          score: existing ? existing.score.toString() : "",
          isAbsent: existing ? existing.isAbsent : false
        };
      });
      
      roster.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
      setStudents(roster);
      setLoading(false);
    });
    return () => unsub();
  }, [test?.classId, test?.id, teacherData?.id]);

  const getMetrics = (scoreStr: string) => {
     if (!scoreStr && scoreStr !== "0") return { grade: '-', pct: 0, color: 'text-slate-400 bg-slate-100', text: 'text-slate-500' };
     const val = parseFloat(scoreStr);
     if (isNaN(val)) return { grade: '-', pct: 0, color: 'text-slate-400 bg-slate-100', text: 'text-slate-500' };
     const pct = (val / maxScore) * 100;
     
     if (pct >= 80) return { grade: 'A', pct, color: 'text-emerald-500 bg-emerald-50 border-emerald-200', text: 'text-emerald-600' };
     if (pct >= 60) return { grade: 'B', pct, color: 'text-blue-500 bg-blue-50 border-blue-200', text: 'text-blue-600' };
     if (pct >= 40) return { grade: 'C', pct, color: 'text-amber-500 bg-amber-50 border-amber-200', text: 'text-amber-600' };
     return { grade: 'D', pct, color: 'text-rose-500 bg-rose-50 border-rose-200', text: 'text-rose-600' };
  };

  const handleScoreChange = (id: string, val: string) => {
     if (parseFloat(val) > maxScore) return; // Cap at max
     setStudents(prev => prev.map(s => s.id === id ? { ...s, score: val } : s));
  };

  const calculateStats = () => {
     let totalScored = 0;
     let countScored = 0;
     const distrib = { a: 0, b: 0, c: 0, d: 0, absent: 0 };

     students.forEach(s => {
        if (s.isAbsent) {
           distrib.absent++;
           return;
        }
        if (s.score !== "") {
           const { grade, pct } = getMetrics(s.score);
           totalScored += parseFloat(s.score);
           countScored++;
           if (grade === 'A') distrib.a++;
           if (grade === 'B') distrib.b++;
           if (grade === 'C') distrib.c++;
           if (grade === 'D') distrib.d++;
        }
     });

     const avg = countScored > 0 ? (totalScored / countScored) : 0;
     const avgPct = countScored > 0 ? (avg / maxScore) * 100 : 0;

     return { avg, avgPct, distrib };
  };

  const { avg, avgPct, distrib } = calculateStats();

  const handleSave = async () => {
    setSaving(true);
    try {
      // Global Save Architecture to test_scores collection
      const promises = students.map(s => {
         const scoreDocRef = doc(db, "test_scores", `${test.id}_${s.id}`);
         const metrics = getMetrics(s.score);
         return setDoc(scoreDocRef, {
            testId: test.id,
            testName: test.title,
            studentId: s.id,
            studentName: s.name,
            classId: test.classId,
            teacherId: teacherData?.id,
            score: s.score === "" ? null : parseFloat(s.score),
            maxScore: maxScore,
            percentage: metrics.pct,
            grade: metrics.grade,
            isAbsent: s.isAbsent,
            timestamp: serverTimestamp()
         });
      });

      await Promise.all(promises);
      
      // Update Test Status
      await updateDoc(doc(db, "tests_registry", test.id), {
         status: "Completed",
         classAverage: avgPct
      });

      toast.success("Scores perfectly synced across all Dashboards!");
      onBack();
    } catch (e) {
      console.error(e);
      toast.error("Failed to sync scores matrix.");
    } finally {
      setSaving(false);
    }
  };

  const filtered = students.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()));
  const totalStudents = filtered.length;
  const totalPages = Math.ceil(totalStudents / itemsPerPage) || 1;
  const paginatedStudents = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getAvatarColor = (initials: string) => {
    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-indigo-500'];
    const idx = initials.charCodeAt(0) % colors.length;
    return colors[idx];
  };

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left bg-transparent">
      
      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row justify-between mb-8">
        <div>
           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1 cursor-pointer hover:text-blue-600 transition-colors w-fit" onClick={onBack}>
              <ChevronLeft className="w-3 h-3" /> RESULT OF CLICK: "ENTER TEST SCORES"
           </p>
           <h1 className="text-3xl font-black text-slate-800 tracking-tight leading-none mb-2">Enter Test Scores</h1>
           <p className="text-sm font-semibold text-slate-500">{test.title} • {test.className} • {maxScore} marks</p>
        </div>
        <div className="flex items-center gap-6 mt-4 md:mt-0">
           <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-400">Class Average:</span>
              <span className="text-lg font-black text-[#1e3a8a]">{avg.toFixed(1)}/{maxScore} ({avgPct.toFixed(0)}%)</span>
           </div>
           <button 
              onClick={handleSave} 
              disabled={saving} 
              className="bg-[#22c55e] text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-sm hover:bg-emerald-600 transition-all flex items-center gap-2 disabled:opacity-50"
           >
              {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null} Save Scores
           </button>
        </div>
      </div>

      {/* ── STATS CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
         <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-center">
            <h3 className="text-3xl font-black text-emerald-500 mb-1">{distrib.a}</h3>
            <p className="text-xs font-semibold text-slate-500">A Grade (80%+)</p>
         </div>
         <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-center">
            <h3 className="text-3xl font-black text-[#1e3a8a] mb-1">{distrib.b}</h3>
            <p className="text-xs font-semibold text-slate-500">B Grade (60-79%)</p>
         </div>
         <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-center">
            <h3 className="text-3xl font-black text-amber-500 mb-1">{distrib.c}</h3>
            <p className="text-xs font-semibold text-slate-500">C Grade (40-59%)</p>
         </div>
         <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-center">
            <h3 className="text-3xl font-black text-rose-500 mb-1">{distrib.d}</h3>
            <p className="text-xs font-semibold text-slate-500">D Grade (&lt;40%)</p>
         </div>
         <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-center">
            <h3 className="text-3xl font-black text-slate-400 mb-1">{distrib.absent}</h3>
            <p className="text-xs font-semibold text-slate-500">Absent</p>
         </div>
      </div>

      {/* ── STUDENT SCORES CONTAINER ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm text-left overflow-hidden">
         <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 leading-tight">Student Scores</h2>
            <div className="flex items-center gap-3">
               <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                  <input type="text" value={search} onChange={(e)=>setSearch(e.target.value)} className="w-48 pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none" placeholder="Search student..." />
               </div>
               <button className="bg-white border border-slate-200 px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50">Import</button>
            </div>
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
                     const metrics = getMetrics(student.score);

                     return (
                        <div key={student.id} className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-slate-300 transition-colors flex flex-col items-start shadow-sm relative overflow-hidden">
                           <div className="flex items-center gap-4 mb-4">
                              <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm ${getAvatarColor(student.initials)}`}>
                                 {student.initials}
                              </div>
                              <div>
                                 <h3 className="text-[15px] font-bold text-slate-900 leading-tight truncate">{student.name}</h3>
                                 <p className="text-xs text-slate-500 mt-1">{student.rollNo}</p>
                              </div>
                           </div>
                           
                           <div className="w-full relative mb-4">
                              <input 
                                 type="number"
                                 value={student.score}
                                 onChange={(e) => handleScoreChange(student.id, e.target.value)}
                                 className="w-full block py-2 px-3 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:border-blue-500"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 select-none">/{maxScore}</span>
                           </div>

                           <div className="w-full flex items-center justify-between mt-auto">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border ${metrics.color}`}>
                                 {metrics.grade}
                              </div>
                              <span className={`text-[15px] font-black ${metrics.text}`}>
                                 {student.score ? `${metrics.pct.toFixed(0)}%` : '-'}
                              </span>
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
}
