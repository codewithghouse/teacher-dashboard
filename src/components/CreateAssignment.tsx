import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, storage } from "../lib/firebase";
import { collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { X, Loader2, FileText, UploadCloud } from 'lucide-react';
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
    const schoolId = teacherData.schoolId as string | undefined;
    const branchId = teacherData.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
    if (branchId) SC.push(where("branchId", "==", branchId));

    const q = query(collection(db, "classes"), where("teacherId", "==", teacherData.id), ...SC);
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
      const schoolId = teacherData.schoolId as string | undefined;
      const branchId = teacherData.branchId as string | undefined;
      const SC: any[] = [];
      if (schoolId) SC.push(where("schoolId", "==", schoolId));
      if (branchId) SC.push(where("branchId", "==", branchId));

      let teachingAssignmentId = "legacy";
      const qAssign = query(collection(db, "teaching_assignments"),
          where("teacherId", "==", teacherData.id),
          where("classId", "==", selectedClassId),
          where("status", "==", "active"),
          ...SC
      );
      const assignSnap = await getDocs(qAssign);
      if (!assignSnap.empty) {
          teachingAssignmentId = assignSnap.docs[0].id;
      }

      await addDoc(collection(db, "assignments"), {
        ...formData,
        dueDate: new Date(formData.dueDate),
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        branchId: teacherData.branchId || "",
        assignmentId: teachingAssignmentId,
        teacherName: teacherData.name || "Faculty",
        classId: selectedClassId,
        className: selClass?.name || "",
        grade: selClass?.grade || "",
        gradeClass: selClass?.name || (selClass?.grade ? `${selClass.grade}-A` : ""),
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

  // Design tokens (matches Assignments.tsx)
  const T = {
    ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
    s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
    blue: '#3B5BDB', blueL: '#EDF2FF',
    green2: '#2F9E44', greenL: '#EBFBEE',
    red: '#C92A2A', redL: '#FFF5F5',
    amber: '#C87014', amberL: '#FFF9DB',
  };

  const selClass = classes.find(c => c.id === selectedClassId);

  return (
    <div style={{ background: T.s1, fontFamily: 'inherit', minHeight: '100vh' }} className="text-left pb-10">

      {/* ── Dark Hero ─────────────────────────────────────────────────────── */}
      <div
        style={{ background: T.ink0 }}
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-5"
      >
        <p style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>
          New assignment
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', lineHeight: 1.15 }}>
          Create<br />assignment
        </h1>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.32)', marginTop: 5 }}>
          Fill in details and publish to your class.
        </p>

        {/* Hero actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '9px 16px', borderRadius: 11,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.07)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              flex: 1, padding: '9px 14px', borderRadius: 11,
              background: T.green2, border: 'none',
              color: '#fff', fontSize: 12, fontWeight: 500,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', opacity: isSaving ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            {isSaving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1.5,6.5 4.5,10 10.5,2.5"/>
                </svg>
                Publish now
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Form body ─────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 md:px-0 pt-4 flex flex-col gap-3">

        {/* Form card */}
        <div style={{
          background: T.s0, border: `1px solid ${T.bdr}`,
          borderRadius: 18, overflow: 'hidden',
          padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 14,
        }}>

          {/* Select class */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              Select class
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {classes.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedClassId(c.id)}
                  style={{
                    padding: '8px 16px', borderRadius: 20, fontSize: 12,
                    fontWeight: selectedClassId === c.id ? 500 : 400,
                    border: `1px solid ${selectedClassId === c.id ? T.ink0 : T.bdr}`,
                    background: selectedClassId === c.id ? T.ink0 : T.s1,
                    color: selectedClassId === c.id ? '#fff' : T.ink2,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: T.s2, margin: '0 -14px' }} />

          {/* Title */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              Assignment title
            </div>
            <input
              type="text"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g. Chapter 5 Worksheet"
              style={{
                width: '100%', padding: '11px 12px', borderRadius: 12,
                border: `1px solid ${T.bdr}`, background: T.s1,
                fontSize: 13, color: T.ink1, fontFamily: 'inherit', outline: 'none',
              }}
            />
          </div>

          <div style={{ height: 1, background: T.s2, margin: '0 -14px' }} />

          {/* Due date */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              Due date
            </div>
            <input
              type="date"
              value={formData.dueDate}
              onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
              style={{
                width: '100%', padding: '11px 12px', borderRadius: 12,
                border: `1px solid ${T.bdr}`, background: T.s1,
                fontSize: 13, color: T.ink1, fontFamily: 'inherit', outline: 'none',
              }}
            />
          </div>

          <div style={{ height: 1, background: T.s2, margin: '0 -14px' }} />

          {/* Instructions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              Instructions
            </div>
            <textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe the assignment objectives and what students need to submit..."
              rows={4}
              style={{
                width: '100%', padding: '11px 12px', borderRadius: 12,
                border: `1px solid ${T.bdr}`, background: T.s1,
                fontSize: 13, color: T.ink1, fontFamily: 'inherit', outline: 'none',
                resize: 'none', lineHeight: 1.5,
              }}
            />
          </div>

          <div style={{ height: 1, background: T.s2, margin: '0 -14px' }} />

          {/* PDF upload */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              Attachment (PDF · optional)
            </div>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `1.5px dashed ${T.bdr}`, borderRadius: 14,
                padding: '24px 14px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 8, cursor: 'pointer', background: T.s1,
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                className="hidden"
                accept=".pdf"
              />
              {selectedFile ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: T.s0, padding: '10px 14px', borderRadius: 12,
                  border: `1px solid ${T.bdr}`, width: '100%',
                }}>
                  <FileText size={16} style={{ color: T.blue, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedFile.name}
                    </p>
                    <p style={{ fontSize: 10, color: T.ink2 }}>{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); setSelectedFile(null); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                  >
                    <X size={14} style={{ color: T.red }} />
                  </button>
                </div>
              ) : (
                <>
                  <div style={{
                    width: 38, height: 38, borderRadius: 12, background: T.blueL,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <UploadCloud size={16} style={{ color: T.blue }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: T.blue }}>Click to upload PDF</div>
                  <div style={{ fontSize: 10, color: T.ink2 }}>Max file size 5 MB</div>
                </>
              )}
            </div>
          </div>

        </div>

        {/* Preview card */}
        <div style={{
          background: T.s0, border: `1px solid ${T.bdr}`,
          borderRadius: 16, padding: '12px 13px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.amber }} />
            <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Preview</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: T.ink1, marginBottom: 2 }}>
            {formData.title || "Assignment title"}
          </div>
          <div style={{ fontSize: 10, color: T.ink2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{selClass?.name || "Select a class"}</span>
            <span>·</span>
            <span>Due {formData.dueDate ? new Date(formData.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default CreateAssignment;
