import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from "../lib/firebase";
import { collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { AIController } from "../ai/controller/ai-controller";
import { X, Check, BrainCircuit, Loader2, Sparkles, ChevronLeft } from 'lucide-react';
import { toast } from "sonner";

const CreateAssignment = ({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) => {
  const { teacherData } = useAuth();
  
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  
  const [formData, setFormData] = useState({
     title: "",
     description: ""
  });

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

  const handleAIGeneration = async () => {
     if (!topic) return toast.error("Please enter an academic topic first!");
     if (!selectedClassId) return toast.error("Please select a target class.");
     
     setIsGenerating(true);
     try {
       // Pull class enrollment for AI Calibration
       const enrollSnap = await getDocs(query(
         collection(db, "enrollments"), 
         where("classId", "==", selectedClassId),
         where("teacherId", "==", teacherData.id)
       ));
       const roster = enrollSnap.docs.map(d => d.data());

       const payload = {
          topic: topic,
          target_class: classes.find(c => c.id === selectedClassId)?.name || "Class Group",
          students_count: roster.length,
          previous_hw_avg: 72, // Logic for historical avg if needed
          students_list: roster.map((s: any) => s.studentName).slice(0, 5)
       };

       const result = await AIController.getAssignmentCreation(payload);
       if(result.status === "success" && result.data) {
          setFormData({
             title: result.data.generated_assignment?.title || topic,
             description: result.data.generated_assignment?.description || ""
          });
          toast.success("Curriculum calibrated by AI Brain!");
       } else {
          toast.error(result.message || "Brain failed to synthesize curriculum.");
       }
     } catch (e) {
       console.error(e);
       toast.error("Network synchronization failed during generation.");
     } finally {
       setIsGenerating(false);
     }
  };

  const handleSave = async () => {
    if (!formData.title || !selectedClassId) return toast.error("Title and Class are required.");
    setIsSaving(true);
    try {
      const selClass = classes.find(c => c.id === selectedClassId);
      await addDoc(collection(db, "assignments"), {
        ...formData,
        teacherId: teacherData.id,
        classId: selectedClassId,
        className: selClass?.name || "",
        grade: selClass?.grade || "",
        status: "Draft",
        createdAt: serverTimestamp()
      });
      toast.success("Assignment published to class roster!");
      onCreate();
    } catch (e) {
      toast.error("Failed to persist curriculum.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div>
          <button onClick={onCancel} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#1e3a8a] flex items-center gap-1 mb-2 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Cancel Creation
          </button>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left flex items-center gap-4">
             <BrainCircuit className="w-10 h-10 text-[#1e3a8a]"/> AI Curriculum Architect
          </h1>
        </div>
        <button 
          onClick={handleSave} 
          disabled={isSaving || !formData.title}
          className="bg-emerald-600 text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-emerald-900/30 hover:translate-y-[-2px] transition-all flex items-center gap-3 active:scale-95 disabled:opacity-50 whitespace-nowrap"
        >
          {isSaving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-6 h-6" />} Publish Assignment
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
         {/* INPUT SECTION */}
         <div className="bg-white border border-slate-50 rounded-[3.5rem] p-12 shadow-sm relative overflow-hidden text-left">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/50 rounded-bl-[4rem] flex items-center justify-center p-8">
               <Sparkles className="w-10 h-10 text-[#1e3a8a] opacity-20" />
            </div>
            
            <h2 className="text-2xl font-black text-slate-900 mb-10 flex items-center gap-3">
               <div className="w-1.5 h-1.5 rounded-full bg-[#1e3a8a]" /> Generation Payload
            </h2>

            <div className="space-y-8">
               <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Academic Group</label>
                  <select 
                    value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
                    className="w-full h-16 px-6 bg-slate-50 border-none rounded-2xl text-xs font-black uppercase tracking-widest focus:ring-4 ring-blue-50 transition-all cursor-pointer"
                  >
                     {classes.length === 0 && <option>No classes found</option>}
                     {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
               </div>

               <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Academic Topic (Nucleus)</label>
                  <div className="flex gap-4">
                     <input 
                       value={topic} onChange={e => setTopic(e.target.value)}
                       type="text" placeholder="e.g. Modern Genetics, Calculus..."
                       className="flex-1 h-16 px-6 bg-slate-50 border-none rounded-2xl text-[13px] font-bold focus:ring-4 ring-blue-50 transition-all shadow-inner placeholder:text-slate-300"
                     />
                     <button onClick={handleAIGeneration} disabled={isGenerating || !topic} className="w-16 h-16 bg-[#1e3a8a] text-white rounded-2xl flex items-center justify-center shadow-lg hover:bg-slate-900 transition-all active:scale-95 disabled:opacity-50">
                        {isGenerating ? <Loader2 className="w-6 h-6 animate-spin"/> : <Sparkles className="w-6 h-6"/>}
                     </button>
                  </div>
               </div>

               <div className="space-y-4 pt-10 border-t border-slate-50">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Calibrated Title</label>
                  <input 
                    value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})}
                    type="text" placeholder="Synthesizing..."
                    className="w-full h-16 px-6 bg-white border border-slate-100 rounded-2xl text-[13px] font-black text-[#1e3a8a] focus:ring-4 ring-blue-50 transition-all"
                  />
               </div>

               <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Deployment Description</label>
                  <textarea 
                    value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
                    placeholder="Brief description for the scholar..." rows={6}
                    className="w-full px-6 py-5 bg-white border border-slate-100 rounded-[2rem] text-[13px] font-bold focus:ring-4 ring-blue-50 transition-all"
                  />
               </div>
            </div>
         </div>

         {/* TIPS / AI INSIGHT */}
         <div className="space-y-10">
            <div className="bg-slate-950 p-12 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-64 h-64 bg-[#1e3a8a] blur-[150px] opacity-20 -mr-20 -mt-20 group-hover:opacity-40 transition-all"></div>
               <h3 className="text-[10px] font-black text-blue-300 uppercase tracking-[0.4em] mb-6 relative z-10 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" /> AI Designer Insight
               </h3>
               <p className="text-2xl font-black leading-tight mb-8 relative z-10 italic">"The brain has detected a core stability gap in Algebraic Concepts. Difficulty has been recalibrated to 68% for peak retention."</p>
               <div className="flex gap-4 relative z-10 border-t border-white/10 pt-8 mt-8">
                  <div><p className="text-2xl font-black text-blue-400">84%</p><p className="text-[9px] font-black uppercase text-white/40 tracking-widest">Est. Accuracy</p></div>
                  <div className="w-[1px] h-10 bg-white/10 mx-4" />
                  <div><p className="text-2xl font-black text-emerald-400">Low</p><p className="text-[9px] font-black uppercase text-white/40 tracking-widest">Plag. Risk</p></div>
               </div>
            </div>

            <div className="bg-white border border-slate-50 rounded-[3rem] p-10 shadow-sm text-left">
               <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-8 border-b border-slate-50 pb-6 flex items-center gap-3">
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Auto-Grading Protocols
               </h3>
               <div className="space-y-6">
                 {[
                   { label: "Semantic Analysis (Auto-Grade)", enabled: true },
                   { label: "Global Similarity Check", enabled: true },
                   { label: "Critical Feedback Synthesis", enabled: true },
                   { label: "Late Penalty Adaptive Logic", enabled: false }
                 ].map((p, i) => (
                   <div key={i} className="flex items-center justify-between group">
                      <p className="text-xs font-black text-slate-800 group-hover:text-[#1e3a8a] transition-all">{p.label}</p>
                      <div className={`w-10 h-6 rounded-full p-1 transition-all ${p.enabled ? 'bg-emerald-500' : 'bg-slate-100'}`}>
                         <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all ${p.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                      </div>
                   </div>
                 ))}
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default CreateAssignment;
