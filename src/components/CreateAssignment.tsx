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
      
      // Fetch the teaching_assignment ID for this specific class and teacher
      let teachingAssignmentId = "legacy";
      const qAssign = query(collection(db, "teaching_assignments"), 
          where("teacherId", "==", teacherData.id), 
          where("classId", "==", selectedClassId),
          where("status", "==", "active")
      );
      const assignSnap = await getDocs(qAssign);
      if (!assignSnap.empty) {
          teachingAssignmentId = assignSnap.docs[0].id;
      }

      await addDoc(collection(db, "assignments"), {
        ...formData,
        dueDate: new Date(formData.dueDate),
        teacherId: teacherData.id,
        assignmentId: teachingAssignmentId, // From Phase 1 spec
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
    <div className="text-left space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onCancel} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 mb-2 transition-colors">
            <ChevronLeft size={14} /> Back to Assignments
          </button>
          <h1 className="text-2xl font-bold text-slate-800">Create Assignment</h1>
          <p className="text-sm text-slate-500 mt-1">Fill in the details and publish to your class.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 bg-[#1e3272] text-white rounded-xl text-sm font-semibold hover:bg-[#162558] transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check size={14} /> Publish</>}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
        {/* Class selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Class</label>
          <div className="flex flex-wrap gap-3">
            {classes.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedClassId(c.id)}
                className={`px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                  selectedClassId === c.id
                    ? "border-[#1e3272] bg-blue-50 text-[#1e3272]"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Title + Due Date */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Assignment Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g. Chapter 5 Worksheet"
              className="w-full h-11 px-4 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100 bg-slate-50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Due Date</label>
            <input
              type="date"
              value={formData.dueDate}
              onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
              className="w-full h-11 px-4 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100 bg-slate-50 text-[#1e3272] font-medium"
            />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Instructions</label>
          <textarea
            rows={4}
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the assignment objectives and what students need to submit..."
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100 bg-slate-50 resize-none"
          />
        </div>

        {/* PDF Upload */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Attachment (PDF)</label>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-slate-200 rounded-xl p-8 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all flex flex-col items-center justify-center gap-2"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={e => setSelectedFile(e.target.files?.[0] || null)}
              className="hidden"
              accept=".pdf"
            />
            {selectedFile ? (
              <div className="flex items-center gap-3 bg-white px-4 py-3 rounded-xl border border-blue-200 shadow-sm">
                <FileText size={18} className="text-blue-600" />
                <div className="text-left">
                  <p className="text-sm font-semibold text-slate-800">{selectedFile.name}</p>
                  <p className="text-xs text-slate-400">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                </div>
                <button onClick={e => { e.stopPropagation(); setSelectedFile(null); }} className="p-1 hover:bg-rose-50 rounded-lg text-rose-400 ml-2">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <UploadCloud size={28} className="text-slate-300" />
                <p className="text-sm font-semibold text-slate-400">Click to upload PDF</p>
                <p className="text-xs text-slate-300">Max 5MB</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateAssignment;
