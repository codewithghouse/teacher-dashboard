import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, storage } from "../lib/firebase";
import {
  collection, query, where, getDocs, onSnapshot, serverTimestamp,
  type QueryConstraint,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auditedAdd } from "../lib/auditedWrites";
import { X, Loader2, FileText, UploadCloud } from 'lucide-react';
import { toast } from "sonner";

// Upload guardrails. 10 MB is generous for a teacher-facing doc/assignment
// attachment; anything larger is almost certainly a user error (or abuse).
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Strip path separators / control chars from uploaded filenames before
// concatenating them into a Storage object path.
const sanitizeStorageName = (name: string): string =>
  name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "file";

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
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));

    const q = query(collection(db, "classes"), ...SC, where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const cls = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setClasses(cls);
      // Auto-select the first class on initial load only. We use the functional
      // setter so this effect can safely omit `selectedClassId` from deps —
      // otherwise every auto-select would retrigger the snapshot subscription.
      setSelectedClassId(prev => prev || cls[0]?.id || "");
    });
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  const handleSave = async () => {
    const title = formData.title.trim();
    if (!title || !selectedClassId) return toast.error("Title and Class are required.");

    if (selectedFile) {
      if (selectedFile.size > MAX_UPLOAD_BYTES) {
        return toast.error(`Attachment exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`);
      }
      if (selectedFile.type && !ALLOWED_UPLOAD_TYPES.has(selectedFile.type)) {
        return toast.error("Unsupported file type. Allowed: PDF, Word, PNG, JPEG.");
      }
    }

    setIsSaving(true);
    let attachmentUrl = "";
    try {
      // 1. Upload attachment if selected
      if (selectedFile) {
        const safeName = sanitizeStorageName(selectedFile.name);
        const storageRef = ref(storage, `assignments/${teacherData.id}_${Date.now()}_${safeName}`);
        const snap = await uploadBytes(storageRef, selectedFile);
        attachmentUrl = await getDownloadURL(snap.ref);
      }

      const selClass = classes.find(c => c.id === selectedClassId);

      // Fetch the teaching_assignment ID for this specific class and teacher
      const schoolId = teacherData.schoolId as string | undefined;
      const branchId = teacherData.branchId as string | undefined;
      const SC: QueryConstraint[] = [];
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

      // Set due date to end-of-day in the user's local timezone so "due today"
      // doesn't mean "due at 00:00 UTC, which is yesterday in most timezones".
      const dueDate = new Date(`${formData.dueDate}T23:59:59`);

      // Derive gradeClass from the actual class record only. Previously fell
      // back to "<grade>-A" — a placeholder that silently poisoned downstream
      // filtering for any section other than A.
      const gradeClass = selClass?.name || "";

      await auditedAdd(collection(db, "assignments"), {
        ...formData,
        title,
        dueDate,
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        branchId: teacherData.branchId || "",
        assignmentId: teachingAssignmentId,
        teacherName: teacherData.name || "Faculty",
        classId: selectedClassId,
        className: selClass?.name || "",
        grade: selClass?.grade || "",
        gradeClass,
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
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-5 bg-[#162E93] md:bg-[#08090C]"
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
              {classes.length === 0 ? (
                <div style={{ fontSize: 12, color: T.ink2, padding: '10px 0' }}>
                  No classes assigned yet. Contact your principal to be added to a class.
                </div>
              ) : (
                classes.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedClassId(c.id)}
                    aria-pressed={selectedClassId === c.id}
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
                ))
              )}
            </div>
          </div>

          <div style={{ height: 1, background: T.s2, margin: '0 -14px' }} />

          {/* Title */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label
              htmlFor="assignment-title"
              style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}
            >
              Assignment title
            </label>
            <input
              id="assignment-title"
              type="text"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter" && !isSaving) handleSave(); }}
              placeholder="e.g. Chapter 5 Worksheet"
              maxLength={200}
              required
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
            <label
              htmlFor="assignment-duedate"
              style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}
            >
              Due date
            </label>
            <input
              id="assignment-duedate"
              type="date"
              value={formData.dueDate}
              onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
              min={new Date().toISOString().split('T')[0]}
              required
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
            <label
              htmlFor="assignment-instructions"
              style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}
            >
              Instructions
            </label>
            <textarea
              id="assignment-instructions"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe the assignment objectives and what students need to submit..."
              rows={4}
              maxLength={4000}
              style={{
                width: '100%', padding: '11px 12px', borderRadius: 12,
                border: `1px solid ${T.bdr}`, background: T.s1,
                fontSize: 13, color: T.ink1, fontFamily: 'inherit', outline: 'none',
                resize: 'none', lineHeight: 1.5,
              }}
            />
          </div>

          <div style={{ height: 1, background: T.s2, margin: '0 -14px' }} />

          {/* File upload */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              Attachment (optional)
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              aria-label="Upload assignment attachment"
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
                accept=".pdf,.doc,.docx,image/png,image/jpeg"
              />
              {selectedFile ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: T.s0, padding: '10px 14px', borderRadius: 12,
                  border: `1px solid ${T.bdr}`, width: '100%',
                }}>
                  <FileText size={16} style={{ color: T.blue, flexShrink: 0 }} aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedFile.name}
                    </p>
                    <p style={{ fontSize: 10, color: T.ink2 }}>
                      {selectedFile.size >= 1024 * 1024
                        ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`
                        : `${(selectedFile.size / 1024).toFixed(1)} KB`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setSelectedFile(null); }}
                    aria-label="Remove file"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                  >
                    <X size={14} style={{ color: T.red }} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <div style={{
                    width: 38, height: 38, borderRadius: 12, background: T.blueL,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <UploadCloud size={16} style={{ color: T.blue }} aria-hidden="true" />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: T.blue }}>Click to upload PDF / Word / image</div>
                  <div style={{ fontSize: 10, color: T.ink2 }}>Max file size 10 MB</div>
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
