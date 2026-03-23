import React, { useState, useEffect } from "react";
import CreateAssignment from "@/components/CreateAssignment";
import GradeAssignment from "@/components/GradeAssignment";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, FilePlus, Sparkles, Plus, GraduationCap } from "lucide-react";

const Assignments = () => {
  const { teacherData } = useAuth();
  const [view, setView] = useState<'list' | 'create' | 'grade'>('list');
  const [selectedAssignment, setSelectedAssignment] = useState<any>(null);
  
  const [assignmentsData, setAssignmentsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teacherData?.id) return;
    
    // Fetch Teacher's Assignments
    const q = query(collection(db, "assignments"), where("teacherId", "==", teacherData.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setAssignmentsData(fetched);
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

  if (view === 'create') {
    return <CreateAssignment onCancel={() => setView('list')} onCreate={() => setView('list')} />;
  }

  if (view === 'grade') {
    return <GradeAssignment assignment={selectedAssignment} onBack={() => setView('list')} />;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left">Assignment Lab</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
             <Sparkles className="w-4 h-4 text-[#1e3a8a]"/> AI Assisted Curriculum Lifecycle Management
          </p>
        </div>
        <button 
          onClick={() => setView('create')}
          className="bg-[#1e3a8a] text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-blue-900/30 hover:translate-y-[-2px] transition-all flex items-center gap-3 active:scale-95 whitespace-nowrap"
        >
          <Plus className="w-6 h-6" /> Create New Assignment
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div className="text-left">
            <h2 className="text-3xl font-black text-slate-900 leading-none">{assignmentsData.length}</h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Active Curriculums</p>
          </div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shadow-sm">
            <FilePlus className="w-6 h-6" />
          </div>
          <div className="text-left">
            <h2 className="text-3xl font-black text-slate-900 leading-none">0</h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Pending Calibration</p>
          </div>
        </div>
        <div className="bg-white border border-slate-50 rounded-[2.5rem] p-8 shadow-sm flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="text-left">
            <h2 className="text-3xl font-black text-slate-900 leading-none">0%</h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Mean Mastery Score</p>
          </div>
        </div>
      </div>

      {loading ? (
         <div className="py-32 flex flex-col items-center justify-center bg-white border border-dashed border-slate-100 rounded-[3rem]">
            <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-6" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Accessing Curriculum Cache...</p>
         </div>
      ) : assignmentsData.length === 0 ? (
         <div className="py-32 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-[3rem] text-center px-10">
            <FilePlus className="w-20 h-20 text-slate-100 mb-8" />
            <h2 className="text-2xl font-black text-slate-800 mb-3">No Assignments Found</h2>
            <p className="text-sm font-bold text-slate-400 max-w-md uppercase tracking-tight leading-relaxed mb-10">Start by creating an assignment using the AI Brain to automatically calibrate difficulty for your scholar registry.</p>
            <button onClick={() => setView('create')} className="px-12 py-5 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl hover:bg-[#1e3a8a] transition-all">Begin First Creation</button>
         </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {assignmentsData.map((assign) => (
            <div key={assign.id} className="bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm hover:shadow-2xl transition-all group relative overflow-hidden flex flex-col text-left">
               <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-bl-[4rem] group-hover:bg-[#1e3a8a] transition-colors duration-500 p-6">
                  <GraduationCap className="w-8 h-8 text-blue-200 group-hover:text-white transition-colors" />
               </div>
               
               <h3 className="text-2xl font-black text-slate-900 mb-3 leading-tight group-hover:text-[#1e3a8a] transition-all pr-12">{assign.title}</h3>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8">{assign.gradeClass || "Global Group"}</p>
               
               <div className="bg-slate-50 border border-slate-100/50 rounded-2xl p-4 mb-10 mt-auto">
                 <div className="flex justify-between items-center mb-2">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Grading Progress</span>
                    <span className="text-[9px] font-black text-[#1e3a8a]">0%</span>
                 </div>
                 <div className="h-1.5 bg-white rounded-full overflow-hidden border border-slate-100">
                    <div className="h-full bg-[#1e3a8a] w-0 transition-all duration-1000" />
                 </div>
               </div>

               <div className="flex gap-4">
                  <button 
                    onClick={() => handleAction("Grade", assign)}
                    className="flex-1 py-4 bg-white border-2 border-slate-900 text-slate-900 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all active:scale-95"
                  >
                    Manage Grading
                  </button>
               </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Assignments;
