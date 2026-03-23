import React, { useState, useEffect } from 'react';
import { ChevronLeft, Search, Check, FileSpreadsheet, BrainCircuit, Loader2, Sparkles, TrendingDown, UserX } from 'lucide-react';
import { AIController } from '../ai/controller/ai-controller';
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

interface EnterScoresProps {
  test: any;
  onBack: () => void;
}

const EnterScores = ({ test, onBack }: EnterScoresProps) => {
  const { teacherData } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiData, setAiData] = useState<any>(null);
  const [search, setSearch] = useState("");

  // 1. Fetch Students from Enrollments for this test's class
  useEffect(() => {
    if (!test?.classId || !teacherData?.id) return;
    
    // Pull Enrollments
    const q = query(
      collection(db, "enrollments"), 
      where("classId", "==", test.classId),
      where("teacherId", "==", teacherData.id)
    );
    
    const unsub = onSnapshot(q, async (snap) => {
      const roster = snap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: data.studentId || d.id,
          name: data.studentName,
          email: data.studentEmail,
          roll: (data.studentEmail?.split('@')[0]) || "N/A",
          score: "0",
          grade: "F",
          percentage: "0%"
        };
      });
      setStudents(roster);
      setLoading(false);
    });
    return () => unsub();
  }, [test?.classId, teacherData?.id]);

  const updateScore = (id: string, val: string) => {
    setStudents(prev => prev.map(s => {
      if (s.id === id) {
        const score = parseFloat(val) || 0;
        const total = parseFloat(test?.marks) || 50;
        const pct = (score / total) * 100;
        let grade = "F";
        if (pct >= 90) grade = "A+";
        else if (pct >= 80) grade = "A";
        else if (pct >= 70) grade = "B";
        else if (pct >= 60) grade = "C";
        else if (pct >= 50) grade = "D";

        return { ...s, score: val, grade, percentage: `${pct.toFixed(0)}%` };
      }
      return s;
    }));
  };

  const handleSave = async () => {
    if (students.length === 0) return;
    setSaving(true);
    try {
      // Map test to gradebook column (Logic: check title/tags)
      let col = "q1";
      const title = test.title.toLowerCase();
      if (title.includes("quiz 2")) col = "q2";
      else if (title.includes("mid")) col = "mid";
      else if (title.includes("hw1")) col = "hw1";
      else if (title.includes("ut1")) col = "ut1";
      else if (title.includes("ut2")) col = "ut2";
      else if (title.includes("proj")) col = "proj";

      const promises = students.map(async (s) => {
         const gradeRef = doc(db, "grades", s.email.toLowerCase());
         const existing = await getDoc(gradeRef);
         const current = existing.exists() ? existing.data() : {};
         
         return setDoc(gradeRef, {
            ...current,
            studentId: s.id,
            studentName: s.name,
            studentEmail: s.email,
            [col]: parseFloat(s.score) || 0,
            lastUpdated: serverTimestamp()
         });
      });

      await Promise.all(promises);
      toast.success(`${test.title} scores synced to Gradebook!`);
      onBack();
    } catch (e) {
      console.error(e);
      toast.error("Failed to sync scores.");
    } finally {
      setSaving(false);
    }
  };

  const handleResultAnalysis = async () => {
     if (students.length === 0) return;
     setIsAnalyzing(true);
     try {
        const result = await AIController.getResultAnalysis({
           test_name: test.title,
           total_marks: test.marks || 50,
           scores: students.map(s => ({ name: s.name, score: s.score }))
        });
        if(result.status === "success" && result.data) {
           setAiData(result.data);
           toast.success("Intelligence Report Generated.");
        }
     } catch (e) {
        toast.error("AI Analysis failed.");
     } finally {
        setIsAnalyzing(false);
     }
  };

  const filtered = students.filter(s => 
    s.name?.toLowerCase().includes(search.toLowerCase()) || 
    s.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div className="text-left">
          <button onClick={onBack} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#1e3a8a] flex items-center gap-1 mb-2 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Exit Audit Mode
          </button>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight leading-none mb-1">{test.title}</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
             {test.className} • Max {test.marks} Marks • Performance Matrix Integration
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <button onClick={handleResultAnalysis} disabled={isAnalyzing || students.length === 0} className="bg-slate-950 text-white px-8 py-5 rounded-[2rem] text-[10px] font-black uppercase tracking-widest shadow-2xl hover:bg-[#1e3a8a] transition-all flex items-center gap-3 active:scale-95 disabled:opacity-50">
            {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin"/> : <Sparkles className="w-5 h-5"/>} Deep Analytics AI
          </button>
          <button onClick={handleSave} disabled={saving || loading || students.length === 0} className="bg-emerald-600 text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-emerald-500/20 hover:bg-emerald-700 transition-all flex items-center gap-3 active:scale-95">
            {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-5 h-5" />} Sync to Gradebook
          </button>
        </div>
      </div>

      {aiData && (
         <div className="mb-10 grid grid-cols-1 lg:grid-cols-2 gap-10 animate-in zoom-in-95 duration-700">
            <div className="bg-white border border-slate-50 rounded-[3rem] p-10 shadow-sm">
               <h3 className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest flex items-center gap-2 mb-6 border-b border-slate-50 pb-4">
                  <BrainCircuit className="w-5 h-5"/> Neural Class Insight
               </h3>
               <p className="text-sm font-bold text-slate-500 leading-relaxed italic bg-blue-50/30 p-8 rounded-[2rem] border border-blue-50 shadow-inner">
                  "{aiData.class_insights}"
               </p>
            </div>

            <div className="bg-white border border-slate-50 rounded-[3rem] p-10 shadow-sm">
               <h3 className="text-[10px] font-black text-rose-800 uppercase tracking-widest flex items-center gap-2 mb-6 border-b border-slate-50 pb-4">
                  <TrendingDown className="w-5 h-5"/> Pattern Trace Analysis
               </h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {aiData.question_item_analysis?.map((item: any, i:number) => (
                     <div key={i} className="bg-rose-50/30 p-5 rounded-2xl border border-rose-100 shadow-sm group">
                        <div className="flex justify-between items-center mb-3">
                           <h4 className="font-black text-rose-900 text-[11px] uppercase tracking-tighter">{item.question_topic}</h4>
                           <span className="bg-rose-100 text-rose-700 text-[8px] font-black px-2 py-0.5 rounded tracking-widest">{item.failure_rate} Error</span>
                        </div>
                        <p className="text-[10px] font-bold text-slate-400 group-hover:text-rose-600 transition-colors leading-relaxed">{item.reason}</p>
                     </div>
                  ))}
               </div>
            </div>
         </div>
      )}

      <div className="bg-white border border-slate-50 rounded-[3.5rem] p-10 shadow-sm text-left">
        <div className="flex flex-col md:flex-row items-center justify-between mb-10 pb-8 border-b border-slate-50 gap-6">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Examination Scoring Roster</h2>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
              <input value={search} onChange={e=>setSearch(e.target.value)} type="text" placeholder="Filter roster..." className="pl-12 pr-6 py-4 bg-slate-50 border-none rounded-2xl text-xs font-bold focus:ring-4 ring-blue-50 transition-all w-64 shadow-inner"/>
            </div>
            <button className="flex items-center gap-2 px-8 py-4 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-2xl text-[10px] font-black shadow-sm uppercase tracking-widest hover:bg-emerald-100 transition-all">
              <FileSpreadsheet className="w-4 h-4" /> Import CSV
            </button>
          </div>
        </div>

        {loading ? (
             <div className="py-32 flex flex-col items-center justify-center">
                <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-6" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Accessing Roster Matrix...</p>
             </div>
        ) : filtered.length === 0 ? (
           <div className="py-32 text-center">
              <UserX className="w-16 h-16 text-slate-100 mx-auto mb-6" />
              <p className="text-sm font-black text-slate-300 uppercase tracking-widest">Roster Empty or Not Found</p>
           </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {filtered.map((student) => (
              <div key={student.id} className="p-8 bg-white border border-slate-100 rounded-[3rem] transition-all hover:shadow-2xl hover:border-blue-100 group relative">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-slate-50 group-hover:bg-[#1e3a8a] group-hover:text-white transition-all flex items-center justify-center text-slate-400 font-black text-xs shadow-inner">
                    {student.name?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="text-left overflow-hidden">
                    <h3 className="text-[13px] font-black text-slate-900 leading-tight group-hover:text-[#1e3a8a] truncate">{student.name}</h3>
                    <p className="text-[9px] text-slate-300 font-extrabold uppercase mt-1 tracking-widest truncate">{student.email}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 mb-6 bg-slate-50/50 p-2 rounded-2xl border border-slate-100">
                  <input 
                    type="number" 
                    value={student.score}
                    onChange={(e) => updateScore(student.id, e.target.value)}
                    className="w-full h-14 bg-white rounded-xl border border-slate-100 focus:outline-none focus:ring-4 ring-blue-50 transition-all font-black text-xl text-[#1e3a8a] text-center"
                  />
                  <div className="px-3 border-l border-slate-100">
                    <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Max</p>
                    <p className="text-sm font-black text-slate-500">{test.marks || "50"}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-50 pt-5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black shadow-inner border ${
                    student.grade.includes('A') ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 
                    student.grade === 'B' ? 'bg-blue-50 border-blue-100 text-blue-600' :
                    student.grade === 'C' ? 'bg-amber-50 border-amber-100 text-amber-600' : 
                    'bg-rose-50 border-rose-100 text-rose-600'
                  }`}>
                    {student.grade}
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Stability</p>
                    <p className="text-sm font-black text-slate-900">{student.percentage}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EnterScores;
