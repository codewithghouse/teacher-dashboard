import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, storage } from "../lib/firebase";
import {
  collection, query, where, serverTimestamp, onSnapshot,
  type QueryConstraint,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auditedAdd } from "../lib/auditedWrites";
import { Loader2, UploadCloud, X, FileText } from 'lucide-react';
import { toast } from "sonner";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const sanitizeStorageName = (name: string): string =>
  name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "file";

export default function CreateTest({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) {
  const { user, teacherData } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
     title: "",
     description: "",
     classId: "",
     className: "",
     subject: "",
     testDate: "",
     duration: "",
     marks: "",
     category: "Unit Test",
  });

  const [topics, setTopics] = useState<string[]>([]);
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
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));

    const q = query(collection(db, "classes"), ...SC, where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const cls = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
      setClasses(cls);
      // Use the functional setter so we read the *latest* classId, not the
      // one captured in this effect's closure. Prevents the auto-select from
      // clobbering a user choice when the snapshot re-fires later.
      setFormData(prev =>
        prev.classId || cls.length === 0
          ? prev
          : { ...prev, classId: cls[0].id as string, className: (cls[0] as { name?: string }).name || "" }
      );
    });
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  const handleSave = async (status: "Upcoming" | "Draft" = "Upcoming") => {
    const title = formData.title.trim();
    if (!title || !formData.classId) return toast.error("Test Name and Class are required.");

    if (pdfFile) {
      if (pdfFile.size > MAX_UPLOAD_BYTES) {
        return toast.error(`Attachment exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`);
      }
      if (pdfFile.type && !ALLOWED_UPLOAD_TYPES.has(pdfFile.type)) {
        return toast.error("Unsupported file type. Allowed: PDF, Word, PNG, JPEG.");
      }
    }

    setIsSaving(true);

    try {
      let pdfUrl = "";
      if (pdfFile) {
         // Storage rules require the filename prefix to be the caller's
         // auth.uid — not `teacherData.id` (Firestore teachers doc ID).
         if (!user?.uid) {
           toast.error("You are signed out. Please sign in again.");
           setIsSaving(false);
           return;
         }
         toast.info("Uploading Blueprint PDF...");
         const safeName = sanitizeStorageName(pdfFile.name);
         const fileRef = ref(storage, `test_blueprints/${user.uid}_${Date.now()}_${safeName}`);
         await uploadBytes(fileRef, pdfFile);
         pdfUrl = await getDownloadURL(fileRef);
      }

      await auditedAdd(collection(db, "tests"), {
        ...formData,
        title,
        testName: title,
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        branchId: teacherData.branchId || "",
        status,
        topics,
        questionTypes: qTypes,
        settings,
        blueprintUrl: pdfUrl,
        createdAt: serverTimestamp()
      });

      toast.success(status === "Draft" ? "Draft saved." : "Test completely set up and published globally!");
      onCreate();
    } catch (e) {
      console.error("[CreateTest] save failed", e);
      toast.error(status === "Draft" ? "Failed to save draft." : "Failed to publish test.");
    } finally {
      setIsSaving(false);
    }
  };

  // Design tokens (desktop)
  const T = {
    ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
    s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
    blue: '#3B5BDB', blueL: '#EDF2FF', blueB: '#BAC8FF',
    green2: '#2F9E44', greenL: '#EBFBEE',
    red: '#C92A2A',
  };

  // Mobile tokens (EduIntellect v2)
  const MA = {
    FONT: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    BG: "#EEF4FF",
    CARD: "#FFFFFF",
    SURFACE: "#F4F7FE",
    SURFACE2: "#EAF0FB",
    P: "#0055FF",
    T1: "#001040", T2: "#002080", T3: "#5070B0", T4: "#99AACC",
    GREEN: "#00C853",
    RED: "#FF3355",
    ORANGE: "#FF8800",
    GOLD: "#FFAA00",
    VIOLET: "#7B3FF4",
    SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
    BDR: "0.5px solid rgba(0,85,255,0.07)",
    HEADER_GRAD: "linear-gradient(160deg, #000A33 0%, #001A66 55%, #0044CC 100%)",
  };

  // Parse "45 mins" / "45" / "" → number with default; format back with "mins"
  const parseDuration = (v: string) => {
    const m = /(\d+)/.exec(v || "");
    return m ? parseInt(m[1], 10) : 45;
  };
  const parseMarks = (v: string) => {
    const n = parseInt(v || "", 10);
    return Number.isFinite(n) && n > 0 ? n : 100;
  };
  const setMarks = (n: number) => setFormData(p => ({ ...p, marks: String(Math.max(1, Math.min(1000, n))) }));
  const setDuration = (n: number) => {
    const v = Math.max(5, Math.min(300, n));
    setFormData(p => ({ ...p, duration: `${v} mins` }));
  };

  // Test-date human + days-left
  const daysLeft = (() => {
    if (!formData.testDate) return null;
    const dt = new Date(formData.testDate);
    if (isNaN(dt.getTime())) return null;
    const diff = Math.ceil((dt.getTime() - Date.now()) / 86400000);
    if (diff < 0)   return { text: `${Math.abs(diff)}d ago`, tone: MA.RED };
    if (diff === 0) return { text: "Today",    tone: MA.ORANGE };
    if (diff === 1) return { text: "1d left",  tone: MA.ORANGE };
    return { text: `${diff}d left`, tone: MA.ORANGE };
  })();
  const prettyTestDate = formData.testDate
    ? new Date(`${formData.testDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })
    : "Select a date";

  const inp = {
    width: '100%', padding: '10px 12px', borderRadius: 11,
    border: `1px solid ${T.bdr}`, background: T.s1,
    fontSize: 13, color: T.ink1, fontFamily: 'inherit', outline: 'none',
  };
  const lbl = {
    fontSize: 10, fontWeight: 500, color: T.ink2,
    letterSpacing: '0.07em', textTransform: 'uppercase',
    display: 'flex', alignItems: 'center', gap: 4,
  };
  const divider = <div style={{ height: 1, background: T.s2, margin: '0 -14px' }} />;
  const section = (children: React.ReactNode) => (
    <div style={{ padding: 14 }}>{children}</div>
  );

  return (
    <div style={{ fontFamily: 'inherit', minHeight: '100vh' }} className="text-left pb-10">

    {/* ═══════════════════ MOBILE VIEW (EduIntellect v2) ═══════════════════ */}
    <div className="md:hidden" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "-16px -16px 0", paddingBottom: 158 }}>

      {/* Sticky dark gradient header */}
      <div className="sticky top-0 z-20 px-[14px] pt-[10px] pb-[18px] relative"
        style={{ background: MA.HEADER_GRAD, borderRadius: "0 0 24px 24px", boxShadow: "0 8px 24px rgba(0,8,60,0.25)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 45%)", borderRadius: "0 0 24px 24px" }} />
        <div className="relative z-[2]">
          <div className="flex items-center justify-between mb-[14px]">
            <button type="button" onClick={onCancel} disabled={isSaving}
              className="flex items-center gap-[3px] py-[6px] pr-[4px] active:opacity-70"
              style={{ color: "#6FB0FF", fontSize: 14, fontWeight: 600, letterSpacing: "-0.2px", fontFamily: MA.FONT, background: "none", border: "none", cursor: isSaving ? "not-allowed" : "pointer", opacity: isSaving ? 0.55 : 1 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back to tests
            </button>
            <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "1.5px" }}>
              New Test
            </div>
            <div style={{ width: 44 }} />
          </div>
          <div className="pt-[2px] px-[2px]">
            <div className="text-[9px] font-extrabold uppercase mb-[6px]" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "1.8px" }}>
              Step 1 of 1
            </div>
            <div className="text-[26px] font-extrabold leading-[1.1] mb-[5px]" style={{ color: "#fff", letterSpacing: "-1px" }}>
              Create test
            </div>
            <div className="text-[12px] font-medium" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "-0.1px" }}>
              Set up a new test and publish to your class.
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-[14px]">

        {/* Select Class */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px] mb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
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
                const isActive = formData.classId === c.id;
                return (
                  <button key={c.id} type="button"
                    onClick={() => setFormData({ ...formData, classId: c.id, className: c.name })}
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

        {/* Test Name */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px] mb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <label htmlFor="test-name-mobile" className="block text-[9px] font-extrabold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Test Name <span className="text-[11px] font-black" style={{ color: MA.RED }}>*</span>
          </label>
          <input id="test-name-mobile"
            type="text"
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g. Chapter 5 Unit Test"
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
            <span className="text-[11px] font-medium" style={{ color: MA.T4, letterSpacing: "-0.1px" }}>Displayed to students</span>
            <span className="text-[11px] font-semibold" style={{ color: MA.T3 }}>{formData.title.length} / 200</span>
          </div>
        </div>

        {/* Description */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px] mb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <label htmlFor="test-desc-mobile" className="block text-[9px] font-extrabold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Description
          </label>
          <textarea id="test-desc-mobile"
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the test scope and instructions…"
            rows={3}
            maxLength={500}
            className="w-full outline-none resize-none"
            style={{
              minHeight: 80,
              padding: "12px 14px",
              borderRadius: 12,
              background: formData.description ? "#fff" : MA.SURFACE,
              border: `0.5px solid ${formData.description ? "rgba(9,87,247,0.2)" : "rgba(9,87,247,0.08)"}`,
              fontSize: 13, fontWeight: 500, color: MA.T1, letterSpacing: "-0.15px",
              fontFamily: MA.FONT, lineHeight: 1.5,
            }} />
          <div className="flex items-center justify-between mt-[6px]">
            <span className="text-[11px] font-medium" style={{ color: MA.T4, letterSpacing: "-0.1px" }}>Optional</span>
            <span className="text-[11px] font-semibold" style={{ color: MA.T3 }}>{formData.description.length} / 500</span>
          </div>
        </div>

        {/* Category + Subject */}
        <div className="grid grid-cols-2 gap-[10px] mb-[12px]">
          <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
            <div className="text-[9px] font-extrabold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
              Category
            </div>
            <div className="relative flex items-center gap-[12px] px-[14px] py-[11px] rounded-[12px]"
              style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)" }}>
              <div className="w-[30px] h-[30px] rounded-[10px] flex items-center justify-center text-white flex-shrink-0" style={{ background: MA.VIOLET }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.25px" }}>{formData.category}</div>
              </div>
              <div className="text-[22px] font-normal -mt-[3px]" style={{ color: MA.T4 }}>›</div>
              <select aria-label="Test category"
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="absolute inset-0 opacity-0 cursor-pointer"
                style={{ fontFamily: MA.FONT }}>
                <option value="Unit Test">Unit Test</option>
                <option value="Mid-term">Mid-term</option>
                <option value="Final">Final</option>
              </select>
            </div>
          </div>
          <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
            <label htmlFor="test-subject-mobile" className="block text-[9px] font-extrabold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
              Subject
            </label>
            <input id="test-subject-mobile"
              type="text"
              value={formData.subject}
              onChange={e => setFormData({ ...formData, subject: e.target.value })}
              placeholder="e.g. English"
              className="w-full outline-none"
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: formData.subject ? "#fff" : MA.SURFACE,
                border: `0.5px solid ${formData.subject ? "rgba(9,87,247,0.2)" : "rgba(9,87,247,0.08)"}`,
                fontSize: 14, fontWeight: 600, color: MA.T1, letterSpacing: "-0.2px",
                fontFamily: MA.FONT,
              }} />
          </div>
        </div>

        {/* Total Marks stepper + Duration stepper */}
        <div className="grid grid-cols-2 gap-[10px] mb-[12px]">
          <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
            <div className="text-[9px] font-extrabold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
              Total Marks <span className="text-[11px] font-black" style={{ color: MA.RED }}>*</span>
            </div>
            <div className="flex items-center rounded-[12px] overflow-hidden" style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)" }}>
              <button type="button" aria-label="Decrement marks"
                onClick={() => setMarks(parseMarks(formData.marks) - 5)}
                className="w-[36px] h-[44px] flex items-center justify-center active:bg-[rgba(9,87,247,0.08)]"
                style={{ background: "transparent", color: MA.P, fontSize: 18, fontWeight: 800, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                −
              </button>
              <div className="flex-1 text-center text-[15px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                {parseMarks(formData.marks)}
              </div>
              <button type="button" aria-label="Increment marks"
                onClick={() => setMarks(parseMarks(formData.marks) + 5)}
                className="w-[36px] h-[44px] flex items-center justify-center active:bg-[rgba(9,87,247,0.08)]"
                style={{ background: "transparent", color: MA.P, fontSize: 18, fontWeight: 800, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                +
              </button>
            </div>
          </div>
          <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
            <div className="text-[9px] font-extrabold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
              Duration <span className="text-[11px] font-black" style={{ color: MA.RED }}>*</span>
            </div>
            <div className="flex items-center rounded-[12px] overflow-hidden" style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)" }}>
              <button type="button" aria-label="Decrement duration"
                onClick={() => setDuration(parseDuration(formData.duration) - 5)}
                className="w-[36px] h-[44px] flex items-center justify-center active:bg-[rgba(9,87,247,0.08)]"
                style={{ background: "transparent", color: MA.P, fontSize: 18, fontWeight: 800, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                −
              </button>
              <div className="flex-1 text-center text-[15px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                {parseDuration(formData.duration)}<span className="text-[11px] font-bold ml-[3px]" style={{ color: MA.T3 }}>min</span>
              </div>
              <button type="button" aria-label="Increment duration"
                onClick={() => setDuration(parseDuration(formData.duration) + 5)}
                className="w-[36px] h-[44px] flex items-center justify-center active:bg-[rgba(9,87,247,0.08)]"
                style={{ background: "transparent", color: MA.P, fontSize: 18, fontWeight: 800, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                +
              </button>
            </div>
          </div>
        </div>

        {/* Test Date */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px] mb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <label htmlFor="test-date-mobile" className="block text-[9px] font-extrabold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Test Date <span className="text-[11px] font-black" style={{ color: MA.RED }}>*</span>
          </label>
          <div className="relative flex items-center gap-[12px] px-[14px] py-[11px] rounded-[12px] active:bg-[#EAF0FB] transition-colors"
            style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)", cursor: "pointer" }}>
            <div className="w-[30px] h-[30px] rounded-[10px] flex items-center justify-center text-white flex-shrink-0" style={{ background: MA.ORANGE }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.25px" }}>{prettyTestDate}</div>
              <div className="text-[11px] font-semibold mt-[1px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                {formData.testDate ? "Tap to change" : "Pick a date"}
              </div>
            </div>
            {daysLeft && (
              <div className="px-[10px] py-[4px] rounded-full text-[11px] font-extrabold flex-shrink-0"
                style={{ background: "rgba(255,136,0,0.12)", color: daysLeft.tone, letterSpacing: "-0.1px" }}>
                {daysLeft.text}
              </div>
            )}
            <input id="test-date-mobile"
              type="date"
              value={formData.testDate}
              onChange={e => setFormData({ ...formData, testDate: e.target.value })}
              min={new Date().toISOString().split('T')[0]}
              aria-label="Test date"
              className="absolute inset-0 opacity-0 cursor-pointer"
              style={{ fontFamily: MA.FONT }} />
          </div>
        </div>

        {/* Attach Paper */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px] mb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="block text-[9px] font-extrabold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Attach Paper <span className="font-semibold" style={{ color: MA.T4, letterSpacing: 0 }}>(PDF · Optional)</span>
          </div>
          <label
            className="block rounded-[14px] px-[14px] py-[20px] text-center relative active:bg-[rgba(9,87,247,0.06)] transition-colors"
            style={{
              border: "1.5px dashed rgba(9,87,247,0.3)",
              background: pdfFile ? "rgba(0,200,83,0.05)" : "rgba(9,87,247,0.03)",
              cursor: "pointer",
            }}>
            <input type="file" accept=".pdf,.doc,.docx,image/png,image/jpeg"
              aria-label="Upload test blueprint"
              onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }}
              className="absolute inset-0 opacity-0 cursor-pointer" />
            {pdfFile ? (
              <div className="flex items-center gap-[10px] bg-white rounded-[12px] px-[14px] py-[10px]" style={{ border: "0.5px solid rgba(0,200,83,0.25)" }}>
                <FileText size={16} style={{ color: MA.GREEN, flexShrink: 0 }} aria-hidden="true" />
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[12px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.15px" }}>{pdfFile.name}</div>
                  <div className="text-[10px] font-semibold mt-[1px]" style={{ color: MA.T3 }}>
                    {pdfFile.size >= 1024 * 1024
                      ? `${(pdfFile.size / 1024 / 1024).toFixed(1)} MB`
                      : `${(pdfFile.size / 1024).toFixed(1)} KB`}
                  </div>
                </div>
                <button type="button" aria-label="Remove blueprint"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setPdfFile(null); }}
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
                <div className="text-[13px] font-bold mb-[4px]" style={{ color: MA.P, letterSpacing: "-0.2px" }}>Upload blueprint</div>
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
          </label>
        </div>

        {/* Topics Covered — chip builder */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px] mb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="block text-[9px] font-extrabold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Topics Covered
          </div>
          <div className="flex gap-[8px] mb-[12px]">
            <input type="text" placeholder="Add new topic…"
              value={newTopic}
              onChange={e => setNewTopic(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newTopic.trim()) { setTopics([...topics, newTopic.trim()]); setNewTopic(""); } }}
              className="flex-1 outline-none"
              style={{
                padding: "11px 14px",
                borderRadius: 12,
                background: MA.SURFACE,
                border: "0.5px solid rgba(9,87,247,0.08)",
                fontSize: 13, fontWeight: 500, color: MA.T1, letterSpacing: "-0.15px",
                fontFamily: MA.FONT,
              }} />
            <button type="button"
              onClick={() => { if (newTopic.trim()) { setTopics([...topics, newTopic.trim()]); setNewTopic(""); } }}
              disabled={!newTopic.trim()}
              className="h-[44px] px-[16px] rounded-[12px] active:scale-[0.95] transition-transform"
              style={{
                background: MA.P, color: "#fff",
                fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)",
                fontFamily: MA.FONT, border: "none",
                cursor: newTopic.trim() ? "pointer" : "not-allowed",
                opacity: newTopic.trim() ? 1 : 0.55,
              }}>
              Add
            </button>
          </div>
          {(qTypes.length + topics.length) === 0 ? (
            <div className="text-[11px] font-medium py-[4px]" style={{ color: MA.T4, letterSpacing: "-0.1px" }}>
              No topics added yet.
            </div>
          ) : (
            <div className="flex flex-wrap gap-[7px]">
              {qTypes.map((q, idx) => (
                <div key={`q-${idx}`} className="inline-flex items-center gap-[6px] pl-[12px] pr-[6px] py-[6px] rounded-full text-[12px] font-bold"
                  style={{ background: "rgba(9,87,247,0.08)", color: MA.P, border: "0.5px solid rgba(9,87,247,0.15)", letterSpacing: "-0.15px" }}>
                  {q}
                  <button type="button" aria-label={`Remove ${q}`}
                    onClick={() => setQTypes(qTypes.filter((_, i) => i !== idx))}
                    className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-extrabold active:bg-[#0055FF] active:text-white"
                    style={{ background: "rgba(9,87,247,0.14)", color: MA.P, border: "none", cursor: "pointer" }}>
                    ×
                  </button>
                </div>
              ))}
              {topics.map((t, idx) => (
                <div key={`t-${idx}`} className="inline-flex items-center gap-[6px] pl-[12px] pr-[6px] py-[6px] rounded-full text-[12px] font-bold"
                  style={{ background: "rgba(9,87,247,0.08)", color: MA.P, border: "0.5px solid rgba(9,87,247,0.15)", letterSpacing: "-0.15px" }}>
                  {t}
                  <button type="button" aria-label={`Remove ${t}`}
                    onClick={() => setTopics(topics.filter((_, i) => i !== idx))}
                    className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-extrabold active:bg-[#0055FF] active:text-white"
                    style={{ background: "rgba(9,87,247,0.14)", color: MA.P, border: "none", cursor: "pointer" }}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Additional Settings — iOS toggles */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[6px] mb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="block text-[9px] font-extrabold uppercase mb-[4px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Additional Settings
          </div>
          {([
            {
              key: "immediateResults" as const,
              title: "Show results immediately",
              desc: "Students see scores right after submitting",
              color: MA.P,
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
            },
            {
              key: "allowRetake" as const,
              title: "Allow retake for failed",
              desc: "One retry for students below passing",
              color: MA.ORANGE,
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
            },
            {
              key: "shuffleQuestions" as const,
              title: "Shuffle questions",
              desc: "Random order per student",
              color: MA.VIOLET,
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>,
            },
          ]).map(({ key, title, desc, color, icon }, idx) => {
            const on = settings[key];
            return (
              <button key={key} type="button"
                onClick={() => setSettings({ ...settings, [key]: !on })}
                aria-pressed={on}
                className="w-full flex items-center gap-[12px] py-[14px] text-left active:opacity-80"
                style={{
                  borderTop: idx > 0 ? "0.5px solid rgba(9,87,247,0.08)" : "none",
                  background: "none", border: idx > 0 ? "0.5px solid rgba(9,87,247,0.08)" : "none",
                  borderBottomWidth: 0, borderLeftWidth: 0, borderRightWidth: 0,
                  cursor: "pointer", fontFamily: MA.FONT,
                }}>
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white flex-shrink-0" style={{ background: color }}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{title}</div>
                  <div className="text-[11px] font-medium mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>{desc}</div>
                </div>
                <div className="relative flex-shrink-0" style={{
                  width: 48, height: 28, borderRadius: 100,
                  background: on ? MA.GREEN : "#E5E9F2",
                  boxShadow: on ? "inset 0 1px 2px rgba(0,0,0,0.1)" : "inset 0 1px 2px rgba(0,0,0,0.05)",
                  transition: "background .25s cubic-bezier(.2,.9,.3,1)",
                }}>
                  <div className="absolute rounded-full bg-white" style={{
                    top: 2, left: 2, width: 24, height: 24,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.08), 0 3px 6px rgba(0,0,0,0.12)",
                    transform: on ? "translateX(20px)" : "translateX(0)",
                    transition: "transform .25s cubic-bezier(.34,1.56,.64,1)",
                  }} />
                </div>
              </button>
            );
          })}
        </div>

      </div>

      {/* Sticky form action bar (above MobileBottomNav at 88px) */}
      <div className="fixed left-0 right-0 z-40 flex gap-[10px] px-4 py-[12px]"
        style={{
          bottom: 88,
          background: "rgba(238,244,255,0.94)",
          backdropFilter: "saturate(220%) blur(32px)",
          WebkitBackdropFilter: "saturate(220%) blur(32px)",
          borderTop: "0.5px solid rgba(9,87,247,0.12)",
        }}>
        <button type="button" onClick={() => handleSave("Draft")} disabled={isSaving || !formData.title.trim() || !formData.classId}
          className="h-[46px] rounded-[14px] flex items-center justify-center gap-[5px] active:scale-[0.96] transition-transform"
          style={{
            flex: "0 0 100px",
            background: MA.SURFACE, color: MA.T2,
            fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
            fontFamily: MA.FONT, border: "none",
            cursor: isSaving ? "not-allowed" : "pointer",
            opacity: isSaving || !formData.title.trim() || !formData.classId ? 0.55 : 1,
          }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Draft
        </button>
        <button type="button" onClick={() => handleSave("Upcoming")} disabled={isSaving || !formData.title.trim() || !formData.classId}
          className="flex-1 h-[46px] rounded-[14px] flex items-center justify-center gap-[6px] active:scale-[0.97] transition-transform"
          style={{
            background: MA.P, color: "#fff",
            fontSize: 14, fontWeight: 800, letterSpacing: "-0.2px",
            boxShadow: "0 1px 2px rgba(9,87,247,0.25), 0 6px 16px rgba(9,87,247,0.4)",
            fontFamily: MA.FONT, border: "none",
            cursor: isSaving ? "not-allowed" : "pointer",
            opacity: isSaving || !formData.title.trim() || !formData.classId ? 0.65 : 1,
          }}>
          {isSaving ? (
            <Loader2 className="w-[14px] h-[14px] animate-spin" />
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Create &amp; publish
            </>
          )}
        </button>
      </div>
    </div>

    {/* ═══════════════════ DESKTOP VIEW (unchanged) ═══════════════════ */}
    <div className="hidden md:block" style={{ background: "#EEF4FF", minHeight: '100vh' }}>

      {/* ── Dark Hero ─────────────────────────────────────────────────────── */}
      <div
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-5 bg-[#001A66] md:bg-[#08090C]"
      >
        {/* Back link */}
        <button type="button"
          onClick={onCancel}
          style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.blue} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9,2 4,7 9,12"/>
          </svg>
          <span style={{ fontSize: 12, color: T.blue }}>Back to tests</span>
        </button>

        <p style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>
          New test
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', lineHeight: 1.1 }}>
          Create<br />test
        </h1>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginTop: 4 }}>
          Set up a new test and publish to your class.
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
          <button
            onClick={handleSave}
            disabled={isSaving}
            aria-label={isSaving ? "Creating test" : "Create test"}
            type="button"
            style={{
              flex: 1, padding: '9px 14px', borderRadius: 11,
              background: T.blue, border: 'none',
              color: '#fff', fontSize: 12, fontWeight: 500,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', opacity: isSaving ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            {isSaving ? (
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="1.5,6.5 4.5,10 10.5,2.5"/>
                </svg>
                Create test
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 md:px-0 pt-4 flex flex-col gap-3">

        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden', padding: 0 }}>

          {/* Select class */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>Select class</div>
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
                      onClick={() => setFormData({ ...formData, classId: c.id, className: c.name })}
                      aria-pressed={formData.classId === c.id}
                      style={{
                        padding: '7px 14px', borderRadius: 20, fontSize: 12,
                        fontWeight: formData.classId === c.id ? 500 : 400,
                        border: `1px solid ${formData.classId === c.id ? T.ink0 : T.bdr}`,
                        background: formData.classId === c.id ? T.ink0 : T.s1,
                        color: formData.classId === c.id ? '#fff' : T.ink2,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {c.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
          {divider}

          {/* Test name */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>
                Test name <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.red }} />
              </div>
              <input style={inp} type="text" placeholder="e.g. Chapter 5 Unit Test"
                value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
            </div>
          )}
          {divider}

          {/* Description */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>Description</div>
              <textarea
                style={{ ...inp, resize: 'none', minHeight: 72, lineHeight: 1.5 }}
                placeholder="Describe the test scope and instructions..."
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          )}
          {divider}

          {/* Category + Subject */}
          {section(
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={lbl}>Category</div>
                <div style={{ position: 'relative' }}>
                  <select
                    style={{ ...inp, appearance: 'none', WebkitAppearance: 'none', paddingRight: 28 }}
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    aria-label="Test category"
                  >
                    <option value="Unit Test">Unit Test</option>
                    <option value="Mid-term">Mid-term</option>
                    <option value="Final">Final</option>
                  </select>
                  <svg style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                    width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round">
                    <polyline points="3,5 7,9 11,5"/>
                  </svg>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={lbl}>Subject</div>
                <input style={inp} type="text" placeholder="e.g. English"
                  value={formData.subject} onChange={e => setFormData({ ...formData, subject: e.target.value })} />
              </div>
            </div>
          )}
          {divider}

          {/* Total marks + Duration */}
          {section(
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={lbl}>
                  Total marks <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.red }} />
                </div>
                <input style={inp} type="number" placeholder="e.g. 100"
                  value={formData.marks} onChange={e => setFormData({ ...formData, marks: e.target.value })} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={lbl}>
                  Duration <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.red }} />
                </div>
                <input style={inp} type="text" placeholder="e.g. 45 mins"
                  value={formData.duration} onChange={e => setFormData({ ...formData, duration: e.target.value })} />
              </div>
            </div>
          )}
          {divider}

          {/* Test date */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>
                Test date <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.red }} />
              </div>
              <input style={inp} type="date"
                value={formData.testDate} onChange={e => setFormData({ ...formData, testDate: e.target.value })} />
            </div>
          )}
          {divider}

          {/* PDF upload */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>Attach paper (PDF · optional)</div>
              <div style={{ position: 'relative' }}>
                <input
                  type="file" accept=".pdf,.doc,.docx,image/png,image/jpeg"
                  aria-label="Upload test blueprint"
                  onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 10 }}
                />
                <div style={{
                  border: `1.5px dashed ${T.bdr}`, borderRadius: 13, padding: '20px 14px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                  background: pdfFile ? T.greenL : T.s1,
                  borderColor: pdfFile ? T.green2 : T.bdr,
                }}>
                  {pdfFile ? (
                    <>
                      <FileText size={20} style={{ color: T.green2 }} aria-hidden="true" />
                      <div style={{ fontSize: 12, fontWeight: 500, color: T.green2 }}>{pdfFile.name}</div>
                      <div style={{ fontSize: 10, color: T.ink2 }}>Document attached</div>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 36, height: 36, borderRadius: 11, background: T.blueL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <UploadCloud size={15} style={{ color: T.blue }} aria-hidden="true" />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: T.blue }}>Upload blueprint</div>
                      <div style={{ fontSize: 10, color: T.ink2 }}>PDF / Word / image · Max 10 MB</div>
                    </>
                  )}
                </div>
                {pdfFile && (
                  <button
                    type="button"
                    aria-label="Remove blueprint"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setPdfFile(null); }}
                    style={{ position: 'absolute', right: 10, top: 10, zIndex: 20, background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 8, padding: 4, cursor: 'pointer' }}
                  >
                    <X size={12} style={{ color: T.red }} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}
          {divider}

          {/* Topics */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>Topics covered</div>
              <div style={{ display: 'flex', gap: 7 }}>
                <input
                  style={{ ...inp, flex: 1 }} type="text" placeholder="Add new topic..."
                  value={newTopic} onChange={e => setNewTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newTopic.trim()) { setTopics([...topics, newTopic.trim()]); setNewTopic(''); } }}
                />
                <button type="button"
                  onClick={() => { if (newTopic.trim()) { setTopics([...topics, newTopic.trim()]); setNewTopic(''); } }}
                  style={{ padding: '10px 14px', borderRadius: 11, background: T.ink0, border: 'none', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  Add
                </button>
              </div>

              {/* Question type tags + topic tags */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                {qTypes.map((q, idx) => (
                  <div key={idx} style={{
                    padding: '5px 10px', borderRadius: 20, background: T.blueL, color: T.blue,
                    fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5,
                    border: `1px solid ${T.blueB}`,
                  }}>
                    {q}
                    <button type="button" onClick={() => setQTypes(qTypes.filter((_, i) => i !== idx))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                      <X size={9} style={{ color: T.blue }} />
                    </button>
                  </div>
                ))}
                {topics.map((t, idx) => (
                  <div key={idx} style={{
                    padding: '5px 10px', borderRadius: 20, background: T.blueL, color: T.blue,
                    fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5,
                    border: `1px solid ${T.blueB}`,
                  }}>
                    {t}
                    <button type="button" onClick={() => setTopics(topics.filter((_, i) => i !== idx))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                      <X size={9} style={{ color: T.blue }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {divider}

          {/* Settings */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ ...lbl as any, marginBottom: 10 }}>Additional settings</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { key: 'immediateResults', label: 'Show results to students immediately' },
                  { key: 'allowRetake',      label: 'Allow retake for failed students' },
                  { key: 'shuffleQuestions', label: 'Shuffle questions for each student' },
                ].map(({ key, label }) => {
                  const on = (settings as any)[key];
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                      onClick={() => setSettings({ ...settings, [key]: !on })}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 5,
                        border: `1.5px solid ${on ? T.blue : T.bdr}`,
                        background: on ? T.blue : T.s1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {on && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1.5,5.5 4,8.5 8.5,2"/>
                          </svg>
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: T.ink2 }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Publish footer */}
        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, padding: '13px 14px', display: 'flex', gap: 8 }}>
          <button type="button"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              flex: 1, padding: 11, borderRadius: 11, background: T.blue, border: 'none',
              color: '#fff', fontSize: 13, fontWeight: 500, cursor: isSaving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', opacity: isSaving ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2,7 5.5,11 11.5,2.5"/>
                </svg>
                Create &amp; publish
              </>
            )}
          </button>
          <button type="button"
            onClick={onCancel}
            style={{
              padding: '11px 14px', borderRadius: 11, background: T.s1,
              border: `1px solid ${T.bdr}`, color: T.ink2,
              fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Save draft
          </button>
        </div>

      </div>
    </div>
    {/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
}
