import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from "../lib/firebase";
import { collection, query, where, addDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { X, Check, BrainCircuit, Sparkles, Loader2, Layers, Key, ChevronLeft } from 'lucide-react';
import { AIController } from '../ai/controller/ai-controller';
import { toast } from "sonner";

const CreateTest = ({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) => {
  const { teacherData } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  
  const [formData, setFormData] = useState({
     title: "",
     topicStr: "",
     duration: "60 mins",
     marks: "50"
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [aiData, setAiData] = useState<any>(null);

  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const cls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setClasses(cls);
      if (cls.length > 0 && !selectedClassId) setSelectedClassId(cls[0].id);
    });
    return () => unsub();
  }, [teacherData?.id]);

  const handleAIPaperGeneration = async () => {
     if (!formData.topicStr) return toast.error("Please enter the core academic topics.");
     if (!selectedClassId) return toast.error("Please select a target group.");
     
     setIsGenerating(true);
     try {
        const selClass = classes.find(c => c.id === selectedClassId);
        const payload = {
           topics: formData.topicStr.split(",").map(t => t.trim()),
           class_target: selClass?.name || "Class Group",
           duration: formData.duration,
           total_marks: formData.marks
        };
        const result = await AIController.getTestCreation(payload);
        if (result.status === "success" && result.data) {
           setAiData(result.data);
           setFormData({ ...formData, title: result.data.generated_paper?.title || formData.title });
           toast.success("Exam Paper & Answer Key Synthesized Successfully!");
        } else {
           toast.error(result.message || "Brain failed to structure a valid paper.");
        }
     } catch (e) {
        console.error(e);
        toast.error("Network error during neural synthesis.");
     } finally {
        setIsGenerating(false);
     }
  };

  const handleSave = async () => {
    if (!formData.title || !selectedClassId || !aiData) return toast.error("Generate an AI paper before publishing.");
    setIsSaving(true);
    try {
      const selClass = classes.find(c => c.id === selectedClassId);
      await addDoc(collection(db, "tests"), {
        ...formData,
        teacherId: teacherData.id,
        classId: selectedClassId,
        className: selClass?.name || "",
        grade: selClass?.grade || "",
        status: "Draft",
        aiData: aiData,
        createdAt: serverTimestamp()
      });
      toast.success("Exam published to academic vault!");
      onCreate();
    } catch (e) {
      toast.error("Persistence failure during publish.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-10 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div className="text-left">
          <button onClick={onCancel} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#1e3a8a] flex items-center gap-1 mb-2 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Exit Blueprint View
          </button>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left flex items-center gap-4">
             <BrainCircuit className="w-10 h-10 text-[#1e3a8a]"/> AI Exam Architect
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            disabled={isSaving || !aiData}
            onClick={handleSave} 
            className="bg-emerald-600 text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-emerald-900/30 hover:translate-y-[-2px] transition-all flex items-center gap-3 active:scale-95 disabled:opacity-50 whitespace-nowrap"
          >
            {isSaving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-6 h-6" />} Finalize & Publish
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-50 rounded-[3.5rem] p-12 shadow-sm mb-10 relative overflow-hidden text-left">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-10">
          <div className="space-y-8">
             <div className="grid grid-cols-2 gap-6">
                 <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Academic Group</label>
                    <select 
                      value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
                      className="w-full h-16 px-6 bg-slate-50 border-none rounded-2xl text-xs font-black uppercase tracking-widest focus:ring-4 ring-blue-50 transition-all cursor-pointer"
                    >
                       {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                 </div>
                 <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Test Duration</label>
                    <input type="text" placeholder="e.g. 90 mins" value={formData.duration} onChange={e=>setFormData({...formData, duration: e.target.value})} className="w-full h-16 px-6 bg-slate-50 border-none rounded-2xl text-[13px] font-black focus:ring-4 ring-blue-50 transition-all"/>
                 </div>
             </div>
             <div className="grid grid-cols-2 gap-6">
                 <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Core Subject Topic(s)</label>
                    <input type="text" placeholder="Topics (Comma Separated)" value={formData.topicStr} onChange={e=>setFormData({...formData, topicStr: e.target.value})} className="w-full h-16 px-6 bg-slate-50 border-none rounded-2xl text-[13px] font-bold focus:ring-4 ring-blue-50 transition-all placeholder:text-slate-200"/>
                 </div>
                 <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Maximum Aggregate Marks</label>
                    <input type="number" value={formData.marks} onChange={e=>setFormData({...formData, marks: e.target.value})} className="w-full h-16 px-6 bg-slate-50 border-none rounded-2xl text-[13px] font-black focus:ring-4 ring-blue-50 transition-all"/>
                 </div>
             </div>
          </div>
          <div className="flex flex-col justify-center">
             <button disabled={isGenerating} onClick={handleAIPaperGeneration} className="w-full h-32 bg-gradient-to-br from-[#1e3a8a] to-blue-600 rounded-[2.5rem] text-white shadow-2xl shadow-blue-900/40 flex flex-col items-center justify-center gap-2 hover:scale-[1.02] transition-all active:scale-95 disabled:opacity-50 relative group">
                <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-10 transition-opacity rounded-[2.5rem]" />
                {isGenerating ? <Loader2 className="w-10 h-10 animate-spin"/> : <Sparkles className="w-10 h-10"/>}
                <span className="text-[13px] font-black uppercase tracking-[0.2em]">{isGenerating ? 'Structuring Intelligence...' : 'Synthesize Balanced Exam Paper'}</span>
             </button>
             <p className="text-[10px] font-bold text-slate-400 text-center mt-6 uppercase tracking-widest leading-relaxed px-10">AI will utilize Bloom's Taxonomy logic to generate a perfectly leveled cognitive assessment paper.</p>
          </div>
        </div>
      </div>

      {aiData && (
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 animate-in fade-in zoom-in-95 duration-700">
            <div className="bg-white border border-slate-50 rounded-[3.5rem] shadow-sm overflow-hidden flex flex-col text-left group">
               <div className="bg-slate-50 border-b border-slate-100 p-10 flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-3">
                     <Layers className="w-6 h-6 text-[#1e3a8a]" /> Auto-Generated Test Paper
                  </h3>
                  <div className="flex gap-2">
                     {aiData.blooms_taxonomy_distribution && Object.entries(aiData.blooms_taxonomy_distribution).slice(0, 2).map(([key, _]) => (
                        <span key={key} className="text-[8px] font-black bg-blue-100 text-[#1e3a8a] px-2 py-0.5 rounded uppercase">{key}</span>
                     ))}
                  </div>
               </div>
               <div className="p-10 flex-1">
                  <div className="bg-slate-50/50 rounded-[2.5rem] p-10 border border-slate-50 flex-1 relative overflow-hidden">
                     <div className="absolute top-0 right-0 w-32 h-32 bg-[#1e3a8a] rounded-bl-[4rem] group-hover:bg-[#1e3a8a] transition-all opacity-5"></div>
                     <h2 className="text-2xl font-black text-center mb-10 border-b border-slate-100 pb-8 text-slate-900 tracking-tight">{aiData.generated_paper?.title}</h2>
                     <div className="space-y-8">
                        {aiData.generated_paper?.questions?.map((q: string, i: number) => (
                           <div key={i} className="flex gap-6">
                              <span className="font-black text-slate-300 w-8 text-lg">0{i+1}.</span>
                              <p className="font-bold text-sm text-slate-700 leading-relaxed">{q}</p>
                           </div>
                        ))}
                     </div>
                  </div>
               </div>
            </div>

            <div className="bg-emerald-50/50 border border-emerald-100 rounded-[3.5rem] shadow-sm overflow-hidden flex flex-col text-left">
               <div className="bg-emerald-100/50 border-b border-emerald-100 p-10 flex justify-between items-center">
                  <h3 className="text-sm font-black text-emerald-900 uppercase tracking-widest flex items-center gap-3">
                     <Key className="w-6 h-6 text-emerald-600" /> Secure Answer Key
                  </h3>
                  <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-full uppercase tracking-widest border border-emerald-200">Confidential Trace</span>
               </div>
               <div className="p-10 flex-1">
                  <div className="space-y-6 max-h-[700px] overflow-y-auto pr-4 custom-scrollbar">
                     {aiData.answer_key?.map((ans: any, i: number) => (
                        <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-emerald-100 shadow-sm relative overflow-hidden group">
                           <div className="absolute top-0 left-0 w-2 h-full bg-emerald-400 group-hover:bg-emerald-500 transition-all opacity-20"></div>
                           <h4 className="text-[10px] font-black text-emerald-700 uppercase tracking-[0.2em] mb-4">Solution Key Audit: Question {ans.question_number}</h4>
                           <div className="mb-6">
                              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-3">Model Acceptable Response(s):</p>
                              <div className="space-y-2">
                                 {ans.possible_answers?.map((p_ans: string, j: number) => (
                                    <p key={j} className="text-sm font-bold text-slate-700 leading-snug flex items-center gap-3">
                                       <div className="w-5 h-5 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600 border border-emerald-100"><Check className="w-3 h-3"/></div>
                                       {p_ans}
                                    </p>
                                 ))}
                              </div>
                           </div>
                           <div className="bg-amber-50 rounded-2xl p-6 border border-amber-100 relative overflow-hidden">
                              <div className="absolute -right-4 -bottom-4 w-12 h-12 bg-amber-200/20 rounded-full blur-xl" />
                              <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mb-2 flex items-center gap-2">
                                 <GraduationCap className="w-4 h-4" /> Grading Logic / Marking Scheme
                              </p>
                              <p className="text-xs font-bold text-amber-900 leading-relaxed italic">{ans.marking_scheme}</p>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};

export default CreateTest;
