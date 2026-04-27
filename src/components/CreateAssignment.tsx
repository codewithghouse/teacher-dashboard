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
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

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
  // eslint-disable-next-line no-control-regex
  name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "file";

const CreateAssignment = ({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) => {
  const { user, teacherData } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  type ClassRow = { id: string; name?: string; grade?: string; teacherId?: string; schoolId?: string; branchId?: string };
  const [isSaving, setIsSaving] = useState(false);
  const [classes, setClasses] = useState<ClassRow[]>([]);
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
      const cls = snap.docs.map(d => ({ ...d.data(), id: d.id })) as ClassRow[];
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

  // Bright-blue Apple tokens (shared mobile + desktop)
  const MA = {
    FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
    BG: "#EEF4FF",
    CARD: "#FFFFFF",
    SURFACE: "#F4F7FE",
    P: "#0055FF",
    T1: "#001040", T3: "#5070B0", T4: "#99AACC",
    GREEN: "#00C853",
    RED: "#FF3355",
    ORANGE: "#FF8800",
    GOLD: "#FFAA00",
    VIOLET: "#7B3FF4",
    SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
    SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
    BDR: "0.5px solid rgba(0,85,255,0.07)",
    HEADER_GRAD: "linear-gradient(160deg, #000A33 0%, #001A66 55%, #0044CC 100%)",
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
    <div className="md:hidden" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "-16px -16px 0", paddingBottom: 158 }}>

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
            <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "1.5px" }}>
              New Assignment
            </div>
            <div style={{ width: 48 }} />
          </div>
          {/* Date block */}
          <div className="pt-[2px] px-[2px]">
            <div className="text-[9px] font-bold uppercase mb-[6px]" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "1.8px" }}>
              Step 1 of 1
            </div>
            <div className="text-[26px] font-bold leading-[1.1] mb-[5px]" style={{ color: "#fff", letterSpacing: "-1px" }}>
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
          <div className="text-[9px] font-bold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Select Class <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
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
          <label htmlFor="assignment-title-mobile" className="block text-[9px] font-bold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Assignment Title <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
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
          <label htmlFor="assignment-duedate-mobile" className="block text-[9px] font-bold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Due Date <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
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
              <div className="px-[10px] py-[4px] rounded-full text-[11px] font-bold flex-shrink-0"
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
          <label htmlFor="assignment-instructions-mobile" className="block text-[9px] font-bold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
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
          <div className="block text-[9px] font-bold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
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
                    <span key={t} className="px-[9px] py-[3px] rounded-full text-[9px] font-bold bg-white"
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
            <div className="text-[9px] font-bold uppercase flex items-center gap-[5px]" style={{ color: MA.GOLD, letterSpacing: "1.6px" }}>
              <span className="w-[6px] h-[6px] rounded-full" style={{ background: MA.GOLD, boxShadow: `0 0 6px ${MA.GOLD}` }} />
              Live Preview
            </div>
          </div>
          <div className="rounded-[12px] p-[12px]" style={{ background: MA.SURFACE }}>
            <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
              {formData.title || "Assignment title"}
            </div>
            <div className="text-[11px] font-medium mt-[4px] flex items-center gap-[6px] flex-wrap" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
              <span className="px-[7px] py-[2px] rounded-[6px] text-[10px] font-bold"
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
            fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
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

    {/* ═══════════════════ DESKTOP VIEW — bright-blue Apple, mobile DNA ═══════════════════ */}
    <div className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh" }}>
      <style>{`
        .ca-card3d { transition: transform .55s cubic-bezier(.22,.61,.36,1), box-shadow .55s cubic-bezier(.22,.61,.36,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .ca-card3d:hover { transform: translateY(-2px) scale(1.006); box-shadow: 0 0 0 0.5px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.18), 0 6px 14px rgba(0,85,255,.12); } }
        .ca-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .ca-press:active { transform: scale(.97); }
        @keyframes caFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .ca-enter > * { animation: caFadeUp .42s cubic-bezier(.34,1.56,.64,1) both; }
        .ca-enter > *:nth-child(1) { animation-delay: .04s; }
        .ca-enter > *:nth-child(2) { animation-delay: .10s; }
        .ca-enter > *:nth-child(3) { animation-delay: .16s; }
        .ca-enter > *:nth-child(4) { animation-delay: .22s; }
        .ca-enter > *:nth-child(5) { animation-delay: .28s; }
      `}</style>

      <div className="max-w-[1400px] mx-auto px-10 pt-8 pb-12">

        {/* Header eyebrow + title */}
        <div className="mb-6 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-[7px] text-[10px] font-bold uppercase mb-[8px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
              <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: MA.P }} />
              Teacher Dashboard · New Assignment
            </div>
            <h1 className="text-[40px] font-bold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.4px" }}>
              Create assignment
            </h1>
            <div className="text-[14px] font-medium mt-[8px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
              Fill in details and publish to your class roster.
            </div>
          </div>
          {/* Quick top-right action bar */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={onCancel} disabled={isSaving}
              className="ca-press px-5 h-[44px] rounded-[12px]"
              style={{
                background: MA.CARD, color: MA.T1,
                fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                fontFamily: MA.FONT, border: MA.BDR, boxShadow: MA.SH_SM,
                cursor: isSaving ? "not-allowed" : "pointer", opacity: isSaving ? 0.55 : 1,
              }}>
              Cancel
            </button>
            <button type="button" onClick={handleSave}
              disabled={isSaving || !formData.title.trim() || !selectedClassId}
              className="ca-press h-[44px] px-6 rounded-[12px] flex items-center gap-[8px]"
              style={{
                background: MA.GREEN, color: "#fff",
                fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
                boxShadow: "0 1px 2px rgba(0,200,83,0.2), 0 6px 16px rgba(0,200,83,0.35)",
                fontFamily: MA.FONT, border: "none",
                cursor: isSaving ? "not-allowed" : "pointer",
                opacity: (isSaving || !formData.title.trim() || !selectedClassId) ? 0.55 : 1,
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

        {/* Dark gradient hero card */}
        <div className="rounded-[26px] px-8 py-7 relative overflow-hidden mb-6"
          style={{ background: MA.HEADER_GRAD, boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 14px 36px rgba(0,8,60,0.28)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
          <div className="relative z-[2] flex items-center justify-between gap-8 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-[52px] h-[52px] rounded-[15px] flex items-center justify-center text-white"
                style={{
                  background: "rgba(255,255,255,0.14)",
                  backdropFilter: "blur(22px)",
                  WebkitBackdropFilter: "blur(22px)",
                  border: "0.5px solid rgba(255,255,255,0.22)",
                  boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-[4px]">
                  <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Step 1 of 1</div>
                  <div className="px-[10px] py-[3px] rounded-full text-[9px] font-bold"
                    style={{ background: "rgba(9,87,247,0.3)", border: "0.5px solid rgba(74,133,255,0.55)", color: "#B5CEFF", letterSpacing: "0.5px" }}>
                    NEW
                  </div>
                </div>
                <div className="text-[22px] font-bold text-white leading-[1.15]" style={{ letterSpacing: "-0.6px" }}>
                  Build a new assignment
                </div>
                <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.62)", letterSpacing: "-0.1px" }}>
                  Tell students what to do, attach reference material, and publish in one click.
                </div>
              </div>
            </div>
            {/* Mini status grid */}
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[420px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              <div className="py-[14px] px-4 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-bold" style={{ color: selectedClassId ? "#6FFFAA" : "#fff", letterSpacing: "-0.4px" }}>
                  {selectedClassId ? (selClass?.name || "—") : "—"}
                </div>
                <div className="text-[9px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Class</div>
              </div>
              <div className="py-[14px] px-4 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-bold" style={{ color: daysLeft ? daysLeft.tone === MA.RED ? "#FF9AA9" : "#FFD060" : "#fff", letterSpacing: "-0.4px" }}>
                  {daysLeft?.text || "—"}
                </div>
                <div className="text-[9px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Due</div>
              </div>
              <div className="py-[14px] px-4 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-bold" style={{ color: selectedFile ? "#6FFFAA" : "#fff", letterSpacing: "-0.4px" }}>
                  {selectedFile ? "Yes" : "—"}
                </div>
                <div className="text-[9px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>File</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main 2-col grid: form (left, span 2) + sticky preview (right) */}
        <div className="grid grid-cols-3 gap-6">

          {/* ── LEFT COL: form cards ─────────────────────────────────────────── */}
          <div className="col-span-2 flex flex-col gap-5 ca-enter">

            {/* CARD 1 — Select Class */}
            <div className="ca-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.P, boxShadow: "0 4px 10px rgba(9,87,247,0.3)" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                      Select Class <span className="font-bold" style={{ color: MA.RED }}>*</span>
                    </div>
                    <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Where will this assignment go?</div>
                  </div>
                </div>
                {selectedClassId && (
                  <div className="px-[12px] py-[5px] rounded-full text-[11px] font-bold flex items-center gap-[5px]"
                    style={{ background: "rgba(0,200,83,0.1)", color: MA.GREEN, letterSpacing: "0.3px" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Selected
                  </div>
                )}
              </div>
              {classes.length === 0 ? (
                <div className="rounded-[14px] px-5 py-6 text-center" style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)" }}>
                  <div className="text-[13px] font-bold" style={{ color: MA.T1 }}>No classes assigned yet</div>
                  <div className="text-[12px] font-medium mt-[4px]" style={{ color: MA.T3 }}>Contact your principal to be added to a class.</div>
                </div>
              ) : (
                <div className="flex gap-[8px] p-[5px] rounded-[14px] flex-wrap" style={{ background: MA.SURFACE }}>
                  {classes.map(c => {
                    const isActive = selectedClassId === c.id;
                    return (
                      <button key={c.id} type="button"
                        onClick={() => setSelectedClassId(c.id)}
                        aria-pressed={isActive}
                        className="ca-press py-[10px] px-[18px] rounded-[10px] transition-all"
                        style={{
                          background: isActive ? MA.P : "transparent",
                          color: isActive ? "#fff" : MA.T3,
                          fontSize: 13, fontWeight: isActive ? 800 : 700, letterSpacing: "-0.2px",
                          boxShadow: isActive ? "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.3)" : "none",
                          fontFamily: MA.FONT, border: "none", cursor: "pointer",
                          minWidth: 96,
                        }}>
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* CARD 2 — Title */}
            <div className="ca-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.P, boxShadow: "0 4px 10px rgba(9,87,247,0.3)" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                  </div>
                  <div>
                    <label htmlFor="ca-title-desktop" className="block text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                      Assignment Title <span className="font-bold" style={{ color: MA.RED }}>*</span>
                    </label>
                    <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Give it a clear, descriptive name</div>
                  </div>
                </div>
                <span className="text-[11px] font-bold" style={{ color: formData.title.length > 180 ? MA.ORANGE : MA.T3 }}>
                  {formData.title.length} / 200
                </span>
              </div>
              <input id="ca-title-desktop"
                type="text"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                onKeyDown={e => { if (e.key === "Enter" && !isSaving) handleSave(); }}
                placeholder="e.g. Chapter 5 Worksheet — Algebraic Expressions"
                maxLength={200}
                required
                className="w-full outline-none transition-all"
                style={{
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: formData.title ? "#fff" : MA.SURFACE,
                  border: `0.5px solid ${formData.title ? "rgba(9,87,247,0.25)" : "rgba(9,87,247,0.08)"}`,
                  fontSize: 15, fontWeight: 600, color: MA.T1, letterSpacing: "-0.2px",
                  fontFamily: MA.FONT,
                }} />
            </div>

            {/* CARD 3 — Due date */}
            <div className="ca-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.ORANGE, boxShadow: "0 4px 10px rgba(255,136,0,0.35)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                <div>
                  <label htmlFor="ca-duedate-desktop" className="block text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                    Due Date <span className="font-bold" style={{ color: MA.RED }}>*</span>
                  </label>
                  <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>When should students submit by?</div>
                </div>
              </div>
              <div className="relative flex items-center gap-4 px-5 py-[14px] rounded-[14px] hover:bg-[#EAF0FB] transition-colors"
                style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)", cursor: "pointer" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>{prettyDate}</div>
                  <div className="text-[12px] font-semibold mt-[3px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>11:59 PM · Local time</div>
                </div>
                {daysLeft && (
                  <div className="px-[14px] py-[6px] rounded-full text-[12px] font-bold flex-shrink-0"
                    style={{ background: daysLeft.tone === MA.RED ? "rgba(255,51,85,0.1)" : "rgba(255,136,0,0.12)", color: daysLeft.tone, letterSpacing: "-0.1px" }}>
                    {daysLeft.text}
                  </div>
                )}
                <input id="ca-duedate-desktop"
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

            {/* CARD 4 — Instructions */}
            <div className="ca-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.VIOLET, boxShadow: "0 4px 10px rgba(123,63,244,0.3)" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
                  </div>
                  <div>
                    <label htmlFor="ca-instructions-desktop" className="block text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                      Instructions <span className="font-semibold" style={{ color: MA.T4 }}>(Optional)</span>
                    </label>
                    <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Describe what students need to submit</div>
                  </div>
                </div>
                <span className="text-[11px] font-bold" style={{ color: formData.description.length > 3500 ? MA.ORANGE : MA.T3 }}>
                  {formData.description.length} / 4000
                </span>
              </div>
              <textarea id="ca-instructions-desktop"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the assignment objectives, what to submit, grading criteria, references…"
                rows={5}
                maxLength={4000}
                className="w-full outline-none resize-none"
                style={{
                  minHeight: 120,
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: formData.description ? "#fff" : MA.SURFACE,
                  border: `0.5px solid ${formData.description ? "rgba(9,87,247,0.25)" : "rgba(9,87,247,0.08)"}`,
                  fontSize: 14, fontWeight: 500, color: MA.T1, letterSpacing: "-0.15px",
                  fontFamily: MA.FONT, lineHeight: 1.55,
                }} />
            </div>

            {/* CARD 5 — Attachment */}
            <div className="ca-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.GOLD, boxShadow: "0 4px 10px rgba(255,170,0,0.35)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                </div>
                <div className="flex-1">
                  <div className="block text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                    Attachment <span className="font-semibold" style={{ color: MA.T4 }}>(Optional)</span>
                  </div>
                  <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Reference PDF, doc, or image — max 10 MB</div>
                </div>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                aria-label="Upload assignment attachment"
                className="rounded-[16px] px-5 py-7 text-center hover:bg-[rgba(9,87,247,0.06)] active:bg-[rgba(9,87,247,0.09)] transition-colors"
                style={{
                  border: "1.5px dashed rgba(9,87,247,0.3)",
                  background: "rgba(9,87,247,0.03)",
                  cursor: "pointer",
                }}>
                {selectedFile ? (
                  <div className="flex items-center gap-[14px] bg-white rounded-[14px] px-5 py-[14px]"
                    style={{ border: "0.5px solid rgba(9,87,247,0.15)", boxShadow: MA.SH_SM }}>
                    <div className="w-[44px] h-[44px] rounded-[12px] flex items-center justify-center text-white flex-shrink-0" style={{ background: MA.P }}>
                      <FileText size={20} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{selectedFile.name}</div>
                      <div className="text-[11px] font-semibold mt-[2px]" style={{ color: MA.T3 }}>
                        {selectedFile.size >= 1024 * 1024
                          ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`
                          : `${(selectedFile.size / 1024).toFixed(1)} KB`}
                        {" · "}
                        Ready to upload
                      </div>
                    </div>
                    <button type="button" aria-label="Remove file"
                      onClick={e => { e.stopPropagation(); setSelectedFile(null); }}
                      className="ca-press flex-shrink-0 w-[34px] h-[34px] rounded-[10px] flex items-center justify-center"
                      style={{ background: "rgba(255,51,85,0.1)", border: "none", cursor: "pointer" }}>
                      <X size={16} style={{ color: MA.RED }} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="mx-auto mb-[12px] w-[56px] h-[56px] rounded-[16px] flex items-center justify-center"
                      style={{ background: "rgba(9,87,247,0.1)", color: MA.P }}>
                      <UploadCloud size={26} strokeWidth={2.2} aria-hidden="true" />
                    </div>
                    <div className="text-[15px] font-bold mb-[5px]" style={{ color: MA.P, letterSpacing: "-0.2px" }}>Click to upload file</div>
                    <div className="text-[12px] font-medium mb-[14px]" style={{ color: MA.T3 }}>Drag-drop coming soon · Click anywhere on this card</div>
                    <div className="flex gap-[7px] justify-center">
                      {["PDF", "DOC", "DOCX", "PNG", "JPG"].map(t => (
                        <span key={t} className="px-[11px] py-[4px] rounded-full text-[10px] font-bold bg-white"
                          style={{ color: MA.T3, letterSpacing: "0.6px", boxShadow: "0 1px 3px rgba(9,87,247,0.08)", border: "0.5px solid rgba(9,87,247,0.08)" }}>
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="text-[10px] font-semibold mt-[12px]" style={{ color: MA.T4, letterSpacing: "-0.1px" }}>Max file size 10 MB</div>
                  </>
                )}
                <input type="file" ref={fileInputRef}
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                  className="hidden"
                  accept=".pdf,.doc,.docx,image/png,image/jpeg" />
              </div>
            </div>

          </div>

          {/* ── RIGHT COL: sticky preview + publish ─────────────────────────── */}
          <div className="col-span-1">
            <div className="sticky top-6 flex flex-col gap-4">

              {/* Live Preview card with golden accent */}
              <div className="ca-card3d rounded-[22px] p-6 relative overflow-hidden"
                {...tilt3D}
                style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
                <div className="absolute left-0 top-0 bottom-0 w-[4px] rounded-r-[4px]" style={{ background: MA.GOLD }} />
                <div className="flex items-center gap-[8px] mb-4">
                  <div className="text-[10px] font-bold uppercase flex items-center gap-[6px]" style={{ color: MA.GOLD, letterSpacing: "1.6px" }}>
                    <span className="w-[7px] h-[7px] rounded-full" style={{ background: MA.GOLD, boxShadow: `0 0 8px ${MA.GOLD}` }} />
                    Live Preview
                  </div>
                </div>
                <div className="rounded-[16px] p-4 mb-3" style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)" }}>
                  <div className="text-[16px] font-bold mb-[6px]" style={{ color: MA.T1, letterSpacing: "-0.3px", wordBreak: "break-word" }}>
                    {formData.title || "Assignment title"}
                  </div>
                  <div className="flex items-center gap-[8px] flex-wrap mb-[8px]">
                    <span className="px-[9px] py-[3px] rounded-[7px] text-[11px] font-bold"
                      style={{ background: "rgba(9,87,247,0.08)", color: MA.P }}>
                      {selClass?.name || "Select a class"}
                    </span>
                    <span className="text-[11px] font-bold" style={{ color: MA.T3 }}>
                      Due {formData.dueDate ? new Date(`${formData.dueDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    </span>
                  </div>
                  {formData.description && (
                    <div className="text-[12px] font-medium mt-[6px] line-clamp-3" style={{ color: MA.T3, letterSpacing: "-0.1px", lineHeight: 1.5 }}>
                      {formData.description}
                    </div>
                  )}
                  {selectedFile && (
                    <div className="flex items-center gap-[8px] mt-[10px] px-[10px] py-[7px] rounded-[10px]"
                      style={{ background: "#fff", border: "0.5px solid rgba(9,87,247,0.12)" }}>
                      <FileText size={13} style={{ color: MA.P }} />
                      <span className="text-[11px] font-bold truncate" style={{ color: MA.T1 }}>{selectedFile.name}</span>
                    </div>
                  )}
                </div>
                <div className="text-[10px] font-bold uppercase" style={{ color: MA.T4, letterSpacing: "1.2px" }}>
                  ↑ This is exactly how students will see it.
                </div>
              </div>

              {/* Publish action card */}
              <div className="rounded-[22px] p-6 relative overflow-hidden"
                style={{
                  background: "linear-gradient(140deg, #001A66 0%, #0044CC 60%, #0055FF 100%)",
                  boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)",
                }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
                <div className="relative z-[2]">
                  <div className="text-[10px] font-bold uppercase mb-[6px]" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "1.8px" }}>
                    Ready to publish?
                  </div>
                  <div className="text-[20px] font-bold text-white mb-[14px]" style={{ letterSpacing: "-0.6px", lineHeight: 1.2 }}>
                    {(!formData.title.trim() || !selectedClassId)
                      ? "Fill required fields first"
                      : "Looks good — let's go!"}
                  </div>
                  {/* Checklist */}
                  <div className="flex flex-col gap-[8px] mb-5">
                    {[
                      { ok: !!selectedClassId, label: "Class selected" },
                      { ok: formData.title.trim().length > 0, label: "Title written" },
                      { ok: !!formData.dueDate, label: "Due date set" },
                      { ok: formData.description.trim().length > 0, label: "Instructions added", optional: true },
                      { ok: !!selectedFile, label: "Attachment uploaded", optional: true },
                    ].map(item => (
                      <div key={item.label} className="flex items-center gap-[8px] text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.1px" }}>
                        <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0"
                          style={{
                            background: item.ok ? "rgba(0,200,83,0.25)" : "rgba(255,255,255,0.08)",
                            border: `0.5px solid ${item.ok ? "rgba(0,200,83,0.4)" : "rgba(255,255,255,0.18)"}`,
                          }}>
                          {item.ok ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#6FFFAA" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : (
                            <span className="w-[5px] h-[5px] rounded-full" style={{ background: "rgba(255,255,255,0.4)" }} />
                          )}
                        </div>
                        <span style={{ opacity: item.ok ? 1 : 0.7 }}>
                          {item.label}
                          {item.optional && <span className="ml-[6px] text-[10px] font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>(optional)</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={handleSave}
                    disabled={isSaving || !formData.title.trim() || !selectedClassId}
                    className="ca-press w-full h-[52px] rounded-[14px] flex items-center justify-center gap-[8px]"
                    style={{
                      background: MA.GREEN, color: "#fff",
                      fontSize: 15, fontWeight: 700, letterSpacing: "-0.2px",
                      boxShadow: "0 1px 2px rgba(0,200,83,0.2), 0 8px 20px rgba(0,200,83,0.4)",
                      fontFamily: MA.FONT, border: "none",
                      cursor: isSaving ? "not-allowed" : "pointer",
                      opacity: (isSaving || !formData.title.trim() || !selectedClassId) ? 0.55 : 1,
                    }}>
                    {isSaving ? (
                      <Loader2 className="w-[16px] h-[16px] animate-spin" />
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Publish to class roster
                      </>
                    )}
                  </button>
                  <button type="button" onClick={onCancel} disabled={isSaving}
                    className="ca-press w-full h-[40px] mt-[10px] rounded-[12px]"
                    style={{
                      background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.85)",
                      fontSize: 12, fontWeight: 700, letterSpacing: "-0.1px",
                      fontFamily: MA.FONT, border: "0.5px solid rgba(255,255,255,0.15)",
                      cursor: isSaving ? "not-allowed" : "pointer", opacity: isSaving ? 0.55 : 1,
                    }}>
                    Cancel
                  </button>
                </div>
              </div>

              {/* Tip card */}
              <div className="rounded-[18px] p-4 flex items-start gap-3"
                style={{ background: MA.CARD, boxShadow: MA.SH_SM, border: MA.BDR }}>
                <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0 text-[18px]"
                  style={{ background: "rgba(255,170,0,0.12)", color: MA.GOLD }}>💡</div>
                <div>
                  <div className="text-[11px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.15px" }}>Pro tip</div>
                  <div className="text-[11px] font-medium mt-[3px] leading-[1.5]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                    Press <kbd className="px-[5px] py-[1px] rounded-[5px] text-[10px] font-bold" style={{ background: MA.SURFACE, color: MA.T1, border: "0.5px solid rgba(9,87,247,0.1)" }}>Enter</kbd> in the title field to publish instantly.
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
    {/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default CreateAssignment;