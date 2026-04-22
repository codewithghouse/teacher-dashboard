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
  const { user, teacherData } = useAuth();
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
      // 1. Upload attachment if selected.
      // NOTE: Storage rules require the filename to start with the caller's
      // Firebase Auth UID (not the teacher doc ID). `teacherData.id` is the
      // Firestore `teachers/{docId}` — usually different from auth.uid.
      if (selectedFile) {
        if (!user?.uid) {
          toast.error("You are signed out. Please sign in again.");
          setIsSaving(false);
          return;
        }
        const safeName = sanitizeStorageName(selectedFile.name);
        const storageRef = ref(storage, `assignments/${user.uid}_${Date.now()}_${safeName}`);
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

      // Hard-guard: schoolId MUST be a non-empty string for Firestore rules to
      // accept the write (rule requires schoolId.size() > 0). Empty string or
      // missing → rule rejects with "permission-denied".
      if (!teacherData.schoolId || typeof teacherData.schoolId !== "string") {
        toast.error("Your teacher profile is missing a school ID. Please sign out and sign in again.");
        setIsSaving(false);
        return;
      }

      // Build payload explicitly — avoid `...formData` spreading unknown keys.
      // Firestore rejects `undefined` values silently with a cryptic error, so
      // every field below is either a concrete value or a safe default.
      const payload = {
        title,
        description: formData.description || "",
        dueDate,
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId,
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
        createdAt: serverTimestamp(),
      };

      await auditedAdd(collection(db, "assignments"), payload);
      toast.success("Assignment published to class roster!");
      onCreate();
    } catch (e: unknown) {
      // Surface the real Firebase error so we can diagnose. The previous
      // generic "Failed to persist curriculum." hid permission-denied,
      // invalid-argument, and quota errors behind identical toast text.
      const err = e as { code?: string; message?: string } | null;
      console.error("[CreateAssignment] save failed", { code: err?.code, message: err?.message, error: e });
      const humanMsg =
        err?.code === "permission-denied"
          ? "Permission denied — your account may not have write access to assignments. Check your role."
          : err?.code === "unauthenticated"
          ? "You are signed out. Please sign in again."
          : err?.code === "invalid-argument"
          ? "Invalid data submitted. Check required fields."
          : err?.message
          ? `Save failed: ${err.message}`
          : "Failed to save assignment.";
      toast.error(humanMsg);
    } finally {
      setIsSaving(false);
    }
  };

  // Design tokens (matches Assignments.tsx — desktop)
  const T = {
    ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
    s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
    blue: '#3B5BDB', blueL: '#EDF2FF',
    green2: '#2F9E44', greenL: '#EBFBEE',
    red: '#C92A2A', redL: '#FFF5F5',
    amber: '#C87014', amberL: '#FFF9DB',
  };

  // Mobile tokens (EduIntellect v2)
  const MA = {
    FONT: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    BG: "#EEF4FF",
    CARD: "#FFFFFF",
    SURFACE: "#F4F7FE",
    P: "#0957F7",
    T1: "#001040", T3: "#5070B0", T4: "#99AACC",
    GREEN: "#00C853",
    RED: "#FF3355",
    ORANGE: "#FF8800",
    GOLD: "#FFAA00",
    SH: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 14px rgba(9,87,247,0.08)",
    SH_SM: "0 0.5px 1px rgba(9,87,247,0.04), 0 2px 10px rgba(9,87,247,0.06)",
    HEADER_GRAD: "linear-gradient(160deg, #000820 0%, #001466 55%, #0033CC 100%)",
  };

  const selClass = classes.find(c => c.id === selectedClassId);

  // Mobile: days-left chip + pretty date string
  const daysLeft = (() => {
    if (!formData.dueDate) return null;
    const due = new Date(`${formData.dueDate}T23:59:59`);
    if (isNaN(due.getTime())) return null;
    const diff = Math.ceil((due.getTime() - Date.now()) / 86400000);
    if (diff < 0)   return { text: `${Math.abs(diff)}d ago`, tone: MA.RED };
    if (diff === 0) return { text: "Today", tone: MA.ORANGE };
    if (diff === 1) return { text: "1d left", tone: MA.ORANGE };
    return { text: `${diff}d left`, tone: MA.ORANGE };
  })();
  const prettyDate = formData.dueDate
    ? new Date(`${formData.dueDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })
    : "Select a date";

  return (
    <div style={{ fontFamily: 'inherit', minHeight: '100vh' }} className="text-left pb-10">

    {/* ═══════════════════ MOBILE VIEW (EduIntellect v2) ═══════════════════ */}
    <div className="md:hidden" style={{ fontFamily: MA.FONT, background: MA.BG, minHeight: "100vh", margin: "-16px -16px 0", paddingBottom: 158 }}>

      {/* Sticky dark gradient header */}
      <div className="sticky top-0 z-20 px-[14px] pt-[10px] pb-[18px] relative"
        style={{ background: MA.HEADER_GRAD, borderRadius: "0 0 24px 24px", boxShadow: "0 8px 24px rgba(0,8,60,0.25)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 45%)", borderRadius: "0 0 24px 24px" }} />
        <div className="relative z-[2]">
          {/* Nav row */}
          <div className="flex items-center justify-between mb-[14px]">
            <button type="button" onClick={onCancel} disabled={isSaving}
              className="py-[6px] pr-[4px] active:opacity-70"
              style={{ color: "#6FB0FF", fontSize: 14, fontWeight: 600, letterSpacing: "-0.2px", fontFamily: MA.FONT, background: "none", border: "none", cursor: isSaving ? "not-allowed" : "pointer", opacity: isSaving ? 0.55 : 1 }}>
              Cancel
            </button>
            <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "1.5px" }}>
              New Assignment
            </div>
            <div style={{ width: 48 }} />
          </div>
          {/* Date block */}
          <div className="pt-[2px] px-[2px]">
            <div className="text-[9px] font-extrabold uppercase mb-[6px]" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "1.8px" }}>
              Step 1 of 1
            </div>
            <div className="text-[26px] font-extrabold leading-[1.1] mb-[5px]" style={{ color: "#fff", letterSpacing: "-1px" }}>
              Create assignment
            </div>
            <div className="text-[12px] font-medium" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "-0.1px" }}>
              Fill in details and publish to your class.
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-[14px] flex flex-col gap-[12px]">

        {/* Select Class */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[10px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="text-[9px] font-extrabold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Select Class <span className="text-[11px] font-black" style={{ color: MA.RED }}>*</span>
          </div>
          {classes.length === 0 ? (
            <div className="text-[12px] font-medium py-[10px]" style={{ color: MA.T3 }}>
              No classes assigned yet. Contact your principal to be added to a class.
            </div>
          ) : (
            <div className="flex gap-[6px] p-[4px] rounded-[12px] overflow-x-auto" style={{ background: MA.SURFACE, scrollbarWidth: "none" as const }}>
              {classes.map(c => {
                const isActive = selectedClassId === c.id;
                return (
                  <button key={c.id} type="button"
                    onClick={() => setSelectedClassId(c.id)}
                    aria-pressed={isActive}
                    className="flex-1 py-[9px] px-[12px] rounded-[9px] text-center transition-all active:scale-[0.96]"
                    style={{
                      background: isActive ? "#fff" : "transparent",
                      color: isActive ? MA.P : MA.T3,
                      fontSize: 13, fontWeight: isActive ? 800 : 700, letterSpacing: "-0.2px",
                      boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.04), 0 3px 8px rgba(9,87,247,0.15)" : "none",
                      fontFamily: MA.FONT, border: "none", cursor: "pointer", whiteSpace: "nowrap", minWidth: 72,
                    }}>
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Title */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[10px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <label htmlFor="assignment-title-mobile" className="block text-[9px] font-extrabold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Assignment Title <span className="text-[11px] font-black" style={{ color: MA.RED }}>*</span>
          </label>
          <input id="assignment-title-mobile"
            type="text"
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter" && !isSaving) handleSave(); }}
            placeholder="e.g. Chapter 5 Worksheet"
            maxLength={200}
            required
            className="w-full outline-none transition-all"
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: formData.title ? "#fff" : MA.SURFACE,
              border: `0.5px solid ${formData.title ? "rgba(9,87,247,0.2)" : "rgba(9,87,247,0.08)"}`,
              fontSize: 14, fontWeight: 600, color: MA.T1, letterSpacing: "-0.2px",
              fontFamily: MA.FONT,
            }} />
          <div className="flex items-center justify-between mt-[6px]">
            <span className="text-[11px] font-medium" style={{ color: MA.T4, letterSpacing: "-0.1px" }}>Make it descriptive for students</span>
            <span className="text-[11px] font-semibold" style={{ color: MA.T3 }}>{formData.title.length} / 200</span>
          </div>
        </div>

        {/* Due Date */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[10px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <label htmlFor="assignment-duedate-mobile" className="block text-[9px] font-extrabold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Due Date <span className="text-[11px] font-black" style={{ color: MA.RED }}>*</span>
          </label>
          <div className="relative flex items-center gap-[12px] px-[14px] py-[12px] rounded-[12px] active:bg-[#EAF0FB] transition-colors"
            style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)", cursor: "pointer" }}>
            <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white flex-shrink-0" style={{ background: MA.ORANGE }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.25px" }}>{prettyDate}</div>
              <div className="text-[11px] font-semibold mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>11:59 PM · Local time</div>
            </div>
            {daysLeft && (
              <div className="px-[10px] py-[4px] rounded-full text-[11px] font-extrabold flex-shrink-0"
                style={{ background: "rgba(255,136,0,0.12)", color: daysLeft.tone, letterSpacing: "-0.1px" }}>
                {daysLeft.text}
              </div>
            )}
            <input id="assignment-duedate-mobile"
              type="date"
              value={formData.dueDate}
              onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
              min={new Date().toISOString().split('T')[0]}
              required
              aria-label="Due date"
              className="absolute inset-0 opacity-0 cursor-pointer"
              style={{ fontFamily: MA.FONT }} />
          </div>
        </div>

        {/* Instructions */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[10px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <label htmlFor="assignment-instructions-mobile" className="block text-[9px] font-extrabold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Instructions
          </label>
          <textarea id="assignment-instructions-mobile"
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the assignment objectives and what students need to submit…"
            rows={4}
            maxLength={4000}
            className="w-full outline-none resize-none"
            style={{
              minHeight: 90,
              padding: "12px 14px",
              borderRadius: 12,
              background: formData.description ? "#fff" : MA.SURFACE,
              border: `0.5px solid ${formData.description ? "rgba(9,87,247,0.2)" : "rgba(9,87,247,0.08)"}`,
              fontSize: 13, fontWeight: 500, color: MA.T1, letterSpacing: "-0.15px",
              fontFamily: MA.FONT, lineHeight: 1.5,
            }} />
          <div className="flex items-center justify-between mt-[6px]">
            <span className="text-[11px] font-medium" style={{ color: MA.T4, letterSpacing: "-0.1px" }}>Optional</span>
            <span className="text-[11px] font-semibold" style={{ color: MA.T3 }}>{formData.description.length} / 4000</span>
          </div>
        </div>

        {/* Attachment */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[10px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="block text-[9px] font-extrabold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Attachment <span className="font-semibold" style={{ color: MA.T4, letterSpacing: 0 }}>(Optional)</span>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
            aria-label="Upload assignment attachment"
            className="rounded-[14px] px-[14px] py-[20px] text-center active:bg-[rgba(9,87,247,0.06)] transition-colors"
            style={{
              border: "1.5px dashed rgba(9,87,247,0.3)",
              background: "rgba(9,87,247,0.03)",
              cursor: "pointer",
            }}>
            {selectedFile ? (
              <div className="flex items-center gap-[10px] bg-white rounded-[12px] px-[14px] py-[10px]"
                style={{ border: "0.5px solid rgba(9,87,247,0.12)" }}>
                <FileText size={16} style={{ color: MA.P, flexShrink: 0 }} aria-hidden="true" />
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[12px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.15px" }}>{selectedFile.name}</div>
                  <div className="text-[10px] font-semibold mt-[1px]" style={{ color: MA.T3 }}>
                    {selectedFile.size >= 1024 * 1024
                      ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`
                      : `${(selectedFile.size / 1024).toFixed(1)} KB`}
                  </div>
                </div>
                <button type="button" aria-label="Remove file"
                  onClick={e => { e.stopPropagation(); setSelectedFile(null); }}
                  className="flex-shrink-0 p-[4px] active:scale-[0.9]"
                  style={{ background: "none", border: "none", cursor: "pointer" }}>
                  <X size={14} style={{ color: MA.RED }} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <div className="mx-auto mb-[10px] w-[46px] h-[46px] rounded-[14px] flex items-center justify-center"
                  style={{ background: "rgba(9,87,247,0.1)", color: MA.P }}>
                  <UploadCloud size={22} strokeWidth={2.2} aria-hidden="true" />
                </div>
                <div className="text-[13px] font-bold mb-[4px]" style={{ color: MA.P, letterSpacing: "-0.2px" }}>Tap to upload file</div>
                <div className="flex gap-[6px] justify-center mt-[10px]">
                  {["PDF", "DOC", "IMG"].map(t => (
                    <span key={t} className="px-[9px] py-[3px] rounded-full text-[9px] font-extrabold bg-white"
                      style={{ color: MA.T3, letterSpacing: "0.6px", boxShadow: "0 1px 3px rgba(9,87,247,0.08)" }}>
                      {t}
                    </span>
                  ))}
                </div>
                <div className="text-[10px] font-semibold mt-[10px]" style={{ color: MA.T4, letterSpacing: "-0.1px" }}>Max file size 10 MB</div>
              </>
            )}
            <input type="file" ref={fileInputRef}
              onChange={e => setSelectedFile(e.target.files?.[0] || null)}
              className="hidden"
              accept=".pdf,.doc,.docx,image/png,image/jpeg" />
          </div>
        </div>

        {/* Live Preview */}
        <div className="rounded-[18px] p-[14px] relative overflow-hidden" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px]" style={{ background: MA.GOLD }} />
          <div className="flex items-center gap-[7px] mb-[10px]">
            <div className="text-[9px] font-black uppercase flex items-center gap-[5px]" style={{ color: MA.GOLD, letterSpacing: "1.6px" }}>
              <span className="w-[6px] h-[6px] rounded-full" style={{ background: MA.GOLD, boxShadow: `0 0 6px ${MA.GOLD}` }} />
              Live Preview
            </div>
          </div>
          <div className="rounded-[12px] p-[12px]" style={{ background: MA.SURFACE }}>
            <div className="text-[14px] font-extrabold truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
              {formData.title || "Assignment title"}
            </div>
            <div className="text-[11px] font-medium mt-[4px] flex items-center gap-[6px] flex-wrap" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
              <span className="px-[7px] py-[2px] rounded-[6px] text-[10px] font-extrabold"
                style={{ background: "rgba(9,87,247,0.08)", color: MA.P }}>
                {selClass?.name || "Select a class"}
              </span>
              <span>·</span>
              <span>Due {formData.dueDate ? new Date(`${formData.dueDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</span>
            </div>
          </div>
        </div>

      </div>

      {/* Sticky Publish bar (above MobileBottomNav at 88px) */}
      <div className="fixed left-0 right-0 z-40 flex gap-[10px] px-4 py-[12px]"
        style={{
          bottom: 88,
          background: "rgba(238,244,255,0.94)",
          backdropFilter: "saturate(220%) blur(32px)",
          WebkitBackdropFilter: "saturate(220%) blur(32px)",
          borderTop: "0.5px solid rgba(9,87,247,0.12)",
        }}>
        <button type="button" onClick={onCancel} disabled={isSaving}
          className="h-[46px] rounded-[14px] active:scale-[0.97] transition-transform"
          style={{
            flex: "0 0 90px",
            background: MA.SURFACE, color: MA.T1,
            fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
            fontFamily: MA.FONT, border: "none",
            cursor: isSaving ? "not-allowed" : "pointer",
            opacity: isSaving ? 0.6 : 1,
          }}>
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={isSaving || !formData.title.trim() || !selectedClassId}
          className="flex-1 h-[46px] rounded-[14px] flex items-center justify-center gap-[6px] active:scale-[0.97] transition-transform"
          style={{
            background: MA.GREEN, color: "#fff",
            fontSize: 14, fontWeight: 800, letterSpacing: "-0.2px",
            boxShadow: "0 1px 2px rgba(0,200,83,0.2), 0 6px 14px rgba(0,200,83,0.35)",
            fontFamily: MA.FONT, border: "none",
            cursor: isSaving ? "not-allowed" : "pointer",
            opacity: (isSaving || !formData.title.trim() || !selectedClassId) ? 0.65 : 1,
          }}>
          {isSaving ? (
            <Loader2 className="w-[14px] h-[14px] animate-spin" />
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Publish now
            </>
          )}
        </button>
      </div>
    </div>

    {/* ═══════════════════ DESKTOP VIEW (unchanged) ═══════════════════ */}
    <div className="hidden md:block" style={{ background: T.s1, minHeight: '100vh' }}>

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
          <button type="button"
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
          <button type="button"
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
    {/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default CreateAssignment;
