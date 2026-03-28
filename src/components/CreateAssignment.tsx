import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, storage } from "../lib/firebase";
import { collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { AIController } from "../ai/controller/ai-controller";
import { X, Check, Loader2, ChevronLeft, FileText, UploadCloud } from 'lucide-react';
import { toast } from "sonner";

const CreateAssignment = ({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) => {
  const { teacherData } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isSaving, setIsSaving] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const [formData, setFormData] = useState({
     title: "",
     description: "",
     dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
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
  }, [teacherData?.id, selectedClassId]);

  const handleSave = async () => {
    if (!formData.title || !selectedClassId) return toast.error("Title and Class are required.");
    setIsSaving(true);
    let attachmentUrl = "";
    try {
      // 1. Upload PDF if selected
      if (selectedFile) {
        const storageRef = ref(storage, `assignments/${teacherData.id}_${Date.now()}_${selectedFile.name}`);
        const snap = await uploadBytes(storageRef, selectedFile);
        attachmentUrl = await getDownloadURL(snap.ref);
      }

      const selClass = classes.find(c => c.id === selectedClassId);
      await addDoc(collection(db, "assignments"), {
        ...formData,
        dueDate: new Date(formData.dueDate),
        teacherId: teacherData.id,
        teacherName: teacherData.name || "Faculty",
        classId: selectedClassId,
        className: selClass?.name || "",
        grade: selClass?.grade || "",
        gradeClass: selClass?.name || `${selClass?.grade}-A`,
        status: "Active",
        pdfUrl: attachmentUrl,
        fileName: selectedFile?.name || "",
        createdAt: serverTimestamp()
      });
      toast.success("Assignment published to class roster!");
      onCreate();
    } catch (e) {
      console.error(e);
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
            <ChevronLeft className="w-4 h-4" /> Curriculum Vault
          </button>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left">Synthesize Assignment</h1>
        </div>
        <div className="flex items-center gap-4">
           <button onClick={onCancel} className="px-8 py-4 bg-slate-50 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all">Discard Draft</button>
           <button 
             onClick={handleSave} 
             disabled={isSaving}
             className="bg-[#1e3a8a] text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-blue-900/30 hover:translate-y-[-2px] transition-all flex items-center gap-3 active:scale-95 whitespace-nowrap disabled:opacity-50"
           >
             {isSaving ? <Loader2 className="w-6 h-6 animate-spin" /> : <><Check className="w-6 h-6" /> Publish to Class</>}
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
         <div className="lg:col-span-3 space-y-8">
            <div className="bg-white border border-slate-50 rounded-[3.5rem] p-12 shadow-sm relative overflow-hidden text-left">
               <h2 className="text-xl font-black text-slate-800 mb-10 flex items-center gap-3">
                  <FileText className="w-6 h-6 text-[#1e3a8a]" /> Academic Context
               </h2>
               
               <div className="space-y-10">
                  <div className="space-y-4">
                     <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Curriculum Class</label>
                     <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {classes.map(c => (
                           <button 
                             key={c.id}
                             onClick={() => setSelectedClassId(c.id)}
                             className={`p-6 rounded-3xl border-2 transition-all text-left group ${selectedClassId === c.id ? 'border-[#1e3a8a] bg-blue-50/50' : 'border-slate-50 hover:border-blue-100 bg-slate-50/30'}`}
                           >
                              <p className="text-lg font-black text-slate-900 group-hover:text-[#1e3a8a] transition-colors">{c.name}</p>
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Grade {c.grade}</p>
                           </button>
                        ))}
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="space-y-4">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Assignment Title</label>
                        <input 
                           type="text"
                           value={formData.title}
                           onChange={(e) => setFormData({...formData, title: e.target.value})}
                           className="w-full p-8 bg-slate-50 border border-slate-50 rounded-3xl text-xl font-black text-slate-900 focus:bg-white focus:ring-4 focus:ring-blue-100 outline-none transition-all placeholder:text-slate-200"
                           placeholder="Ex: Advanced Trigonometry Worksheet"
                        />
                     </div>
                     <div className="space-y-4">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Submission Deadline</label>
                        <input 
                           type="date"
                           value={formData.dueDate}
                           onChange={(e) => setFormData({...formData, dueDate: e.target.value})}
                           className="w-full p-8 bg-slate-50 border border-slate-50 rounded-3xl text-xl font-black text-[#1e3a8a] focus:bg-white focus:ring-4 focus:ring-blue-100 outline-none transition-all"
                        />
                     </div>
                  </div>

                  <div className="space-y-4">
                     <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Detailed Instruction</label>
                     <textarea 
                        rows={6}
                        value={formData.description}
                        onChange={(e) => setFormData({...formData, description: e.target.value})}
                        className="w-full p-8 bg-slate-50 border border-slate-50 rounded-3xl text-sm font-medium text-slate-600 focus:bg-white focus:ring-4 focus:ring-blue-100 outline-none transition-all resize-none placeholder:text-slate-300"
                        placeholder="Define the learning objectives and specific deliverables for this curriculum segment..."
                     />
                  </div>

                  {/* Attachment Logistics */}
                  <div className="space-y-4">
                     <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Curriculum Artifact (PDF)</label>
                     <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full p-12 border-2 border-dashed border-slate-100 rounded-[2.5rem] bg-slate-50/20 hover:bg-blue-50/30 hover:border-blue-200 transition-all cursor-pointer flex flex-col items-center justify-center text-center group"
                     >
                        <input 
                           type="file" 
                           ref={fileInputRef} 
                           onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                           className="hidden" 
                           accept=".pdf"
                        />
                        {selectedFile ? (
                           <div className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-blue-100">
                              <FileText className="w-8 h-8 text-blue-600" />
                              <div className="text-left">
                                 <p className="text-xs font-black text-slate-900">{selectedFile.name}</p>
                                 <p className="text-[9px] font-black text-slate-400 uppercase mt-1">{(selectedFile.size / 1024).toFixed(1)} KB • PDF Artifact</p>
                              </div>
                              <button 
                                onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                                className="p-2 hover:bg-rose-50 rounded-lg text-rose-400 transition-colors"
                              >
                                 <X className="w-4 h-4" />
                              </button>
                           </div>
                        ) : (
                           <>
                              <div className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                 <UploadCloud className="w-8 h-8 text-slate-300 group-hover:text-[#1e3a8a] transition-colors" />
                              </div>
                              <p className="text-sm font-black text-slate-400 group-hover:text-slate-600">Click to upload worksheet artifact</p>
                              <p className="text-[9px] font-black text-slate-200 uppercase tracking-[0.2em] mt-2">Maximum file size: 5MB</p>
                           </>
                        )}
                     </div>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default CreateAssignment;
