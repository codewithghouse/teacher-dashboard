import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, storage } from "../lib/firebase";
import { collection, query, where, addDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Loader2, UploadCloud, X, FileText } from 'lucide-react';
import { toast } from "sonner";

export default function CreateTest({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) {
  const { teacherData } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
     title: "",
     description: "",
     classId: "",
     className: "",
     subject: "",
     testDate: "",
     duration: "",
     marks: ""
  });

  const [topics, setTopics] = useState<string[]>(['Algebraic Expressions', 'Linear Equations', 'Quadratic Equations', 'Polynomials']);
  const [newTopic, setNewTopic] = useState("");
  const [qTypes, setQTypes] = useState<string[]>(['MCQ', 'Short Answer', 'Long Answer']);
  
  const [settings, setSettings] = useState({
     immediateResults: true,
     allowRetake: false,
     shuffleQuestions: true
  });

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const cls = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setClasses(cls);
      if (cls.length > 0 && !formData.classId) {
         setFormData(prev => ({ ...prev, classId: cls[0].id, className: cls[0].name }));
      }
    });
    return () => unsub();
  }, [teacherData?.id]);

  const handleSave = async () => {
    if (!formData.title || !formData.classId) return toast.error("Test Name and Class are required.");
    setIsSaving(true);
    
    try {
      let pdfUrl = "";
      if (pdfFile) {
         toast.info("Uploading Blueprint PDF...");
         const fileRef = ref(storage, `test_blueprints/${teacherData?.id}_${Date.now()}_${pdfFile.name}`);
         await uploadBytes(fileRef, pdfFile);
         pdfUrl = await getDownloadURL(fileRef);
      }

      await addDoc(collection(db, "tests"), {
        ...formData,
        testName: formData.title,
        date: formData.testDate, // Fixed field name for sync
        category: (formData as any).category || "Unit Test",
        teacherId: teacherData.id,
        status: "Upcoming",
        topics,
        questionTypes: qTypes,
        settings,
        blueprintUrl: pdfUrl,
        createdAt: serverTimestamp()
      });

      toast.success("Test completely set up and published globally!");
      onCreate();
    } catch (e) {
      console.error(e);
      toast.error("Failed to publish test.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div>
           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">RESULT OF CLICK: "CREATE TEST"</p>
           <h1 className="text-3xl font-black text-slate-800 tracking-tight leading-none">Create Test</h1>
           <p className="text-sm font-medium text-slate-500 mt-2">Set up a new test for your class.</p>
        </div>
        <div className="flex items-center gap-3">
           <button onClick={onCancel} className="bg-white border border-slate-200 text-slate-700 px-6 py-2.5 rounded-lg text-sm font-semibold shadow-sm hover:bg-slate-50">
              Cancel
           </button>
           <button 
              onClick={handleSave} 
              disabled={isSaving}
              className="bg-[#1e3a8a] text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-sm hover:bg-blue-900 transition-all flex items-center gap-2 disabled:opacity-50"
           >
              {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : null} Create Test
           </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-left grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-8">
         
         {/* LEFT COLUMN */}
         <div className="space-y-6">
            <div>
               <label className="block text-sm font-bold text-slate-900 mb-2">Test Name <span className="text-rose-500">*</span></label>
               <input type="text" value={formData.title} onChange={e=>setFormData({...formData, title: e.target.value})} className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 ring-blue-500" />
            </div>
            
            <div>
               <label className="block text-sm font-bold text-slate-900 mb-2">Description</label>
               <textarea value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full h-32 px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 ring-blue-500 resize-none" />
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Class <span className="text-rose-500">*</span></label>
                  <select 
                     value={formData.classId} 
                     onChange={e => {
                        const sel = classes.find(c => c.id === e.target.value);
                        setFormData({...formData, classId: sel?.id, className: sel?.name});
                     }} 
                     className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 ring-blue-500 appearance-none bg-no-repeat bg-[right_1rem_center]" 
                     style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3e%3c/svg%3e")' }}
                  >
                     {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
               </div>
               <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Category</label>
                  <select 
                     value={(formData as any).category || "Unit Test"} 
                     onChange={e => setFormData({...formData, category: e.target.value} as any)}
                     className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 ring-blue-500 appearance-none bg-no-repeat bg-[right_1rem_center]"
                     style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3e%3c/svg%3e")' }}
                  >
                     <option value="Unit Test">Unit Test (Normal)</option>
                     <option value="Quiz">Quick Quiz</option>
                     <option value="Final Exam">Final Examination</option>
                  </select>
               </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Subject</label>
                  <input type="text" value={formData.subject} onChange={e=>setFormData({...formData, subject: e.target.value})} className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 ring-blue-500" />
               </div>
               <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Total Marks <span className="text-rose-500">*</span></label>
                  <input type="number" value={formData.marks} onChange={e=>setFormData({...formData, marks: e.target.value})} className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 ring-blue-500" />
               </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Test Date <span className="text-rose-500">*</span></label>
                  <input type="date" value={formData.testDate} onChange={e=>setFormData({...formData, testDate: e.target.value})} className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 ring-blue-500 text-slate-500" />
               </div>
               <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Duration <span className="text-rose-500">*</span></label>
                  <input type="text" placeholder="e.g. 45 mins" value={formData.duration} onChange={e=>setFormData({...formData, duration: e.target.value})} className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 ring-blue-500" />
               </div>
            </div>
            
            {/* Custom Requested PDF Upload Feature */}
            <div className="mt-8 border-t border-slate-100 pt-6">
               <label className="block text-[15px] font-bold text-[#1e3a8a] mb-2">Attach Official Paper (PDF)</label>
               <p className="text-xs font-semibold text-slate-500 mb-4">Students and Parents will be able to download the blueprint if you make it available.</p>
               
               <div className="w-full relative">
                  <input 
                     type="file" 
                     accept=".pdf"
                     onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                           setPdfFile(e.target.files[0]);
                        }
                     }}
                     className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                  />
                  <div className={`w-full py-6 border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-colors ${pdfFile ? 'border-emerald-500 bg-emerald-50' : 'border-blue-200 bg-blue-50/50 hover:bg-blue-50'}`}>
                     {pdfFile ? (
                        <>
                           <FileText className="w-8 h-8 text-emerald-600 mb-2" />
                           <p className="text-sm font-bold text-emerald-800">{pdfFile.name}</p>
                           <p className="text-xs font-semibold text-emerald-600">Document Attached</p>
                        </>
                     ) : (
                        <>
                           <UploadCloud className="w-8 h-8 text-blue-500 mb-2" />
                           <p className="text-sm font-bold text-[#1e3a8a]">Click to upload PDF Blueprint</p>
                           <p className="text-xs font-semibold text-slate-500">Max size: 5MB</p>
                        </>
                     )}
                  </div>
                  {pdfFile && (
                     <button 
                        onClick={(e) => { e.preventDefault(); setPdfFile(null); }}
                        className="absolute right-4 top-4 z-20 p-1.5 bg-rose-100 text-rose-600 rounded-lg hover:bg-rose-200"
                     >
                        <X className="w-4 h-4" />
                     </button>
                  )}
               </div>
            </div>
         </div>

         {/* RIGHT COLUMN */}
         <div className="space-y-8">
            <div>
               <label className="block text-sm font-bold text-slate-900 mb-2">Total Marks <span className="text-rose-500">*</span></label>
               <input type="number" value={formData.marks} onChange={e=>setFormData({...formData, marks: e.target.value})} className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 ring-blue-500" />
            </div>

            <div>
               <label className="block text-sm font-bold text-slate-900 mb-3">Topics Covered</label>
               <div className="space-y-3">
                  {topics.map((t, idx) => (
                     <div key={idx} className="w-full px-5 py-3 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white flex justify-between items-center">
                        {t}
                        <button onClick={() => setTopics(topics.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
                     </div>
                  ))}
                  <div className="flex gap-2">
                     <input type="text" value={newTopic} onChange={e=>setNewTopic(e.target.value)} onKeyDown={(e) => {
                        if (e.key === 'Enter' && newTopic) {
                           setTopics([...topics, newTopic]);
                           setNewTopic('');
                        }
                     }} placeholder="Add new topic..." className="flex-1 h-12 px-4 border border-slate-200 rounded-lg text-sm focus:outline-none" />
                     <button onClick={() => { if(newTopic){ setTopics([...topics, newTopic]); setNewTopic(''); } }} className="h-12 px-6 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200">Add</button>
                  </div>
               </div>
            </div>

            <div>
               <label className="block text-sm font-bold text-slate-900 mb-4">Question Types</label>
               <div className="flex flex-wrap gap-3 mb-3">
                  {qTypes.map((q, idx) => (
                     <div key={idx} className="bg-blue-100/60 text-blue-700 px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-2">
                        {q}
                        <button onClick={() => setQTypes(qTypes.filter((_, i) => i !== idx))} className="hover:text-rose-500"><X className="w-3 h-3" /></button>
                     </div>
                  ))}
                  <button className="bg-white border border-slate-200 text-slate-500 px-4 py-2 rounded-full text-sm font-medium hover:bg-slate-50">
                     + Add
                  </button>
               </div>
            </div>

            <div className="pt-2">
               <label className="block text-base font-bold text-slate-900 mb-4">Additional Settings</label>
               <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                     <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${settings.immediateResults ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'}`}>
                        {settings.immediateResults && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                     </div>
                     <span className="text-sm font-medium text-slate-700">Show results to students immediately</span>
                     <input type="checkbox" checked={settings.immediateResults} onChange={e=>setSettings({...settings, immediateResults: e.target.checked})} className="hidden" />
                  </label>
                  
                  <label className="flex items-center gap-3 cursor-pointer">
                     <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${settings.allowRetake ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'}`}>
                        {settings.allowRetake && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                     </div>
                     <span className="text-sm font-medium text-slate-700">Allow retake for failed students</span>
                     <input type="checkbox" checked={settings.allowRetake} onChange={e=>setSettings({...settings, allowRetake: e.target.checked})} className="hidden" />
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                     <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${settings.shuffleQuestions ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'}`}>
                        {settings.shuffleQuestions && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                     </div>
                     <span className="text-sm font-medium text-slate-700">Shuffle questions for each student</span>
                     <input type="checkbox" checked={settings.shuffleQuestions} onChange={e=>setSettings({...settings, shuffleQuestions: e.target.checked})} className="hidden" />
                  </label>
               </div>
            </div>

         </div>

      </div>
    </div>
  );
}
