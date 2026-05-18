import { useState, useEffect, useRef } from 'react';
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
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

type ClassRow = { id: string; name?: string; grade?: string };

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const sanitizeStorageName = (name: string): string =>
  // eslint-disable-next-line no-control-regex
  name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "file";

export default function CreateTest({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) {
  const { user, teacherData } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  
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

  // Exam categories — driven by principal-dashboard's `exam_structure`
  // collection (cross-dashboard linkage). Falls back to a sensible default
  // set ONLY when the school hasn't configured any exam types yet.
  // Each configured type may carry maxMarks / passingMarks / weightPct
  // which auto-fill the marks field when the teacher picks that category.
  const DEFAULT_EXAM_CATEGORIES = ['Unit Test', 'Mid-term', 'Final'];
  type ExamCategoryConfig = { maxMarks?: number; passingMarks?: number; weightPct?: number; applicableClasses?: string };
  const [examCategories, setExamCategories] = useState<string[]>(DEFAULT_EXAM_CATEGORIES);
  const [examCategoryConfig, setExamCategoryConfig] = useState<Map<string, ExamCategoryConfig>>(new Map());

  // Custom-category inline editor — fires when user picks the "+ Add custom
  // category" option in either the mobile or desktop assessment-type dropdown.
  // The custom value is NOT persisted into examCategories (school-level
  // taxonomy stays in the principal's exam_structure collection); it just
  // overrides this single test/exam's category.
  const CUSTOM_OPTION = '__custom__';
  const [customCatOpen, setCustomCatOpen] = useState(false);
  const [customCatText, setCustomCatText] = useState('');
  const isPreset = (c: string) => examCategories.includes(c);
  const onPickCategory = (value: string) => {
    if (value === CUSTOM_OPTION) {
      setCustomCatOpen(true);
      setCustomCatText(isPreset(formData.category) ? '' : formData.category);
      return;
    }
    setCustomCatOpen(false);
    setFormData(prev => {
      const cfg = examCategoryConfig.get(value);
      const shouldAutoFillMarks =
        cfg?.maxMarks != null && (!prev.marks || prev.marks.trim() === '');
      return {
        ...prev,
        category: value,
        ...(shouldAutoFillMarks ? { marks: String(cfg!.maxMarks) } : {}),
      };
    });
  };
  const saveCustomCategory = () => {
    const val = customCatText.trim();
    if (!val) return;
    setFormData(prev => ({ ...prev, category: val }));
    setCustomCatOpen(false);
  };
  
  const [settings, setSettings] = useState({
     immediateResults: true,
     allowRetake: false,
     shuffleQuestions: true
  });

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Date input refs — used to open the native picker programmatically.
  // The opacity:0-absolute-over-wrapper trick alone is fragile on iOS Safari
  // and some Android browsers (the wrapped <div> can swallow the click before
  // the input's default behavior triggers the picker). Calling showPicker()
  // explicitly + focus() fallback makes this reliable cross-browser.
  const dateMobileRef = useRef<HTMLInputElement>(null);
  const dateDesktopRef = useRef<HTMLInputElement>(null);
  const openDatePicker = (el: HTMLInputElement | null) => {
    if (!el) return;
    // showPicker is the modern, user-gesture-required API; widely supported
    // in Chrome 99+, Edge 99+, Firefox 101+, Safari 16.4+. Fall back to
    // focus() for older browsers (which at least opens the keyboard / cursor).
    try {
      const fn = (el as HTMLInputElement & { showPicker?: () => void }).showPicker;
      if (typeof fn === "function") { fn.call(el); return; }
    } catch { /* showPicker can throw if element isn't connected or not focused */ }
    try { el.focus(); el.click(); } catch { /* noop */ }
  };

  // Mirrors MyClasses.tsx union pattern: a teacher's class list is the union
  // of (a) `teaching_assignments` where teacherId == tId (canonical — set by
  // principal/owner when assigning) and (b) `classes` where teacherId == tId
  // (legacy — older homeroom-style ownership). The single-source `classes`
  // query previously here silently missed any class the teacher was assigned
  // to via the teaching_assignments flow, so the dropdown was empty on freshly
  // assigned teachers. Also dropped the branchId filter on classes — class
  // docs aren't guaranteed to carry branchId, and branch isolation is enforced
  // at the school-scoped query layer in practice.
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const tId = teacherData.id as string;
    const schoolId = teacherData.schoolId as string;

    let assignedIds = new Set<string>();
    let legacyOwnedIds = new Set<string>();
    let allClassDocs: ClassRow[] = [];

    const recompute = () => {
      const allowed = new Set<string>([...assignedIds, ...legacyOwnedIds]);
      const cls = allowed.size === 0 ? [] : allClassDocs.filter(c => allowed.has(c.id));
      setClasses(cls);
      setFormData(prev =>
        prev.classId || cls.length === 0
          ? prev
          : { ...prev, classId: cls[0].id, className: cls[0].name || "" }
      );
    };

    // teaching_assignments — active filter client-side (legacy docs may lack status).
    const u1 = onSnapshot(
      query(collection(db, "teaching_assignments"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => {
        const active = snap.docs.filter(d => {
          const s = (d.data() as any).status;
          return !s || (typeof s === "string" && s.toLowerCase() === "active");
        });
        assignedIds = new Set(active.map(d => (d.data() as any).classId).filter((x: any): x is string => !!x));
        recompute();
      },
    );

    // classes legacy — teacher owns via classes.teacherId field.
    const u2 = onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => {
        legacyOwnedIds = new Set(snap.docs.map(d => d.id));
        recompute();
      },
    );

    // classes school-wide — needed to resolve the metadata of classes the
    // teacher is assigned to (but doesn't directly "own" via teacherId).
    const u3 = onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId)),
      (snap) => {
        allClassDocs = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id })) as ClassRow[];
        recompute();
      },
    );

    return () => { u1(); u2(); u3(); };
  }, [teacherData?.id, teacherData?.schoolId]);

  // Subscribe to `exam_structure` (principal-configured exam types) so the
  // category dropdown reflects what the school has actually defined. This
  // is the cross-dashboard linkage that the previous hardcoded list
  // silently broke (memory: cross_dashboard_linking_rule).
  useEffect(() => {
    if (!teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const inBranch = (raw: any): boolean =>
      !branchId || !raw?.branchId || raw.branchId === branchId;

    const unsub = onSnapshot(
      query(collection(db, "exam_structure"), where("schoolId", "==", schoolId)),
      (snap) => {
        const docs = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
          .filter(inBranch);
        if (docs.length === 0) {
          // No configured types — fall back to defaults so the teacher
          // still has SOMETHING to pick from.
          setExamCategories(DEFAULT_EXAM_CATEGORIES);
          setExamCategoryConfig(new Map());
          return;
        }
        const names: string[] = [];
        const map = new Map<string, ExamCategoryConfig>();
        docs.forEach((d: any) => {
          const name = String(d.name || "").trim();
          if (!name || map.has(name)) return; // dedup defensively
          names.push(name);
          map.set(name, {
            maxMarks:          typeof d.maxMarks === "number" ? d.maxMarks : undefined,
            passingMarks:      typeof d.passingMarks === "number" ? d.passingMarks : undefined,
            weightPct:         typeof d.weightPct === "number" ? d.weightPct : undefined,
            applicableClasses: typeof d.applicableClasses === "string" ? d.applicableClasses : undefined,
          });
        });
        setExamCategories(names);
        setExamCategoryConfig(map);
        // If the current selected category isn't in the configured list,
        // realign to the first configured type so we don't save a stale
        // hardcoded value the principal didn't define.
        setFormData(prev => names.includes(prev.category) ? prev : { ...prev, category: names[0] });
      },
      (err) => console.warn("[CreateTest] exam_structure listener failed:", err),
    );
    return () => unsub();
  }, [teacherData?.schoolId, teacherData?.branchId]);

  const handleSave = async (status: "Upcoming" | "Draft" = "Upcoming") => {
    const title = formData.title.trim();
    if (!title || !formData.classId) return toast.error("Test Name and Class are required.");
    // testDate is required for Upcoming tests — parent dashboard's TestsPage
    // filters by `testDate >= todayKey`, so a test saved with an empty
    // testDate silently disappears for every parent. Drafts may skip the
    // date (still being planned).
    if (status === "Upcoming" && !formData.testDate) {
      return toast.error("Test Date is required to publish. Pick a date or save as draft.");
    }
    // Marks must be a positive number — the +/- UI shows a fake default of 100
    // when formData.marks is empty, but the writer would persist that empty
    // string. EnterScores then falls back to 50 and the teacher sees the wrong
    // out-of value when entering scores. Resolve at the writer to keep the
    // displayed value === the persisted value.
    const numericMarks = parseMarks(formData.marks);
    if (status === "Upcoming" && (!Number.isFinite(numericMarks) || numericMarks <= 0)) {
      return toast.error("Total marks must be a positive number.");
    }

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
        // Persist marks as the value the teacher actually saw on screen
        // (parseMarks resolves "" → 100). Also stamp the canonical numeric
        // `maxMarks` field so every cross-dashboard reader (EnterScores,
        // parent TestsPage, ConceptMastery, AlertsPage, Leaderboard) gets a
        // consistent typed source of truth without parseFloat juggling.
        marks: String(numericMarks),
        maxMarks: numericMarks,
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

  // Bright-blue Apple tokens (shared mobile + desktop)
  const MA = {
    FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
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
            <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "1.5px" }}>
              New Test
            </div>
            <div style={{ width: 44 }} />
          </div>
          <div className="pt-[2px] px-[2px]">
            <div className="text-[9px] font-bold uppercase mb-[6px]" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "1.8px" }}>
              Step 1 of 1
            </div>
            <div className="text-[26px] font-bold leading-[1.1] mb-[5px]" style={{ color: "#fff", letterSpacing: "-1px" }}>
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
          <label htmlFor="test-name-mobile" className="block text-[9px] font-bold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Test Name <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
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
          <label htmlFor="test-desc-mobile" className="block text-[9px] font-bold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
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
            <div className="text-[9px] font-bold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
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
                value={isPreset(formData.category) ? formData.category : CUSTOM_OPTION}
                onChange={e => onPickCategory(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                style={{ fontFamily: MA.FONT }}>
                {examCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value={CUSTOM_OPTION}>+ Add custom category…</option>
              </select>
            </div>
            {customCatOpen && (
              <div className="mt-[10px] flex items-center gap-[8px]">
                <input
                  type="text"
                  value={customCatText}
                  onChange={e => setCustomCatText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveCustomCategory(); } }}
                  placeholder="Type your category…"
                  maxLength={60}
                  autoFocus
                  className="flex-1 outline-none"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#fff',
                    border: '0.5px solid rgba(9,87,247,0.25)',
                    fontSize: 13, fontWeight: 600, color: MA.T1, letterSpacing: '-0.15px',
                    fontFamily: MA.FONT,
                  }}
                />
                <button
                  type="button"
                  onClick={saveCustomCategory}
                  disabled={!customCatText.trim()}
                  style={{
                    padding: '10px 14px', borderRadius: 10,
                    background: MA.P, color: '#fff',
                    fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
                    border: 'none', cursor: 'pointer', flexShrink: 0,
                    opacity: customCatText.trim() ? 1 : 0.5,
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setCustomCatOpen(false)}
                  style={{
                    padding: '10px 12px', borderRadius: 10,
                    background: MA.SURFACE, color: MA.T3,
                    fontSize: 12, fontWeight: 600,
                    border: '0.5px solid rgba(9,87,247,0.08)', cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
            <label htmlFor="test-subject-mobile" className="block text-[9px] font-bold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
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
            <div className="text-[9px] font-bold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
              Total Marks <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
            </div>
            <div className="flex items-center rounded-[12px] overflow-hidden" style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)" }}>
              <button type="button" aria-label="Decrement marks"
                onClick={() => setMarks(parseMarks(formData.marks) - 5)}
                className="w-[36px] h-[44px] flex items-center justify-center active:bg-[rgba(9,87,247,0.08)]"
                style={{ background: "transparent", color: MA.P, fontSize: 18, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                −
              </button>
              <div className="flex-1 text-center text-[15px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                {parseMarks(formData.marks)}
              </div>
              <button type="button" aria-label="Increment marks"
                onClick={() => setMarks(parseMarks(formData.marks) + 5)}
                className="w-[36px] h-[44px] flex items-center justify-center active:bg-[rgba(9,87,247,0.08)]"
                style={{ background: "transparent", color: MA.P, fontSize: 18, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                +
              </button>
            </div>
          </div>
          <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
            <div className="text-[9px] font-bold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
              Duration <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
            </div>
            <div className="flex items-center rounded-[12px] overflow-hidden" style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)" }}>
              <button type="button" aria-label="Decrement duration"
                onClick={() => setDuration(parseDuration(formData.duration) - 5)}
                className="w-[36px] h-[44px] flex items-center justify-center active:bg-[rgba(9,87,247,0.08)]"
                style={{ background: "transparent", color: MA.P, fontSize: 18, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                −
              </button>
              <div className="flex-1 text-center text-[15px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                {parseDuration(formData.duration)}<span className="text-[11px] font-bold ml-[3px]" style={{ color: MA.T3 }}>min</span>
              </div>
              <button type="button" aria-label="Increment duration"
                onClick={() => setDuration(parseDuration(formData.duration) + 5)}
                className="w-[36px] h-[44px] flex items-center justify-center active:bg-[rgba(9,87,247,0.08)]"
                style={{ background: "transparent", color: MA.P, fontSize: 18, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                +
              </button>
            </div>
          </div>
        </div>

        {/* Test Date */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px] mb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <label htmlFor="test-date-mobile" className="block text-[9px] font-bold uppercase mb-[10px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
            Test Date <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
          </label>
          <div
            role="button"
            tabIndex={0}
            onClick={() => openDatePicker(dateMobileRef.current)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDatePicker(dateMobileRef.current); } }}
            className="relative flex items-center gap-[12px] px-[14px] py-[11px] rounded-[12px] active:bg-[#EAF0FB] transition-colors"
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
              <div className="px-[10px] py-[4px] rounded-full text-[11px] font-bold flex-shrink-0"
                style={{ background: "rgba(255,136,0,0.12)", color: daysLeft.tone, letterSpacing: "-0.1px" }}>
                {daysLeft.text}
              </div>
            )}
            {/* Hidden native input drives the picker. Wrapper's onClick calls
                showPicker() — pointer-events:none here keeps the wrapper from
                receiving a duplicate click that would re-open immediately. */}
            <input id="test-date-mobile"
              ref={dateMobileRef}
              type="date"
              value={formData.testDate}
              onChange={e => setFormData({ ...formData, testDate: e.target.value })}
              min={(() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0]; })()}
              aria-label="Test date"
              className="absolute opacity-0 pointer-events-none"
              style={{ width: 1, height: 1, left: "50%", bottom: 0, fontFamily: MA.FONT }} />
          </div>
        </div>

        {/* Attach Paper */}
        <div className="rounded-[18px] px-[14px] pt-[14px] pb-[12px] mb-[12px]" style={{ background: MA.CARD, boxShadow: MA.SH }}>
          <div className="block text-[9px] font-bold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
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
                    <span key={t} className="px-[9px] py-[3px] rounded-full text-[9px] font-bold bg-white"
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
          <div className="block text-[9px] font-bold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
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
                    className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold active:bg-[#0055FF] active:text-white"
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
                    className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold active:bg-[#0055FF] active:text-white"
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
          <div className="block text-[9px] font-bold uppercase mb-[4px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
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
            fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
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


    {/* ═══════════════════ DESKTOP VIEW — bright-blue Apple, mobile DNA ═══════════════════ */}
    <div className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh" }}>
      <style>{`
        .ct-card3d { transition: transform .55s cubic-bezier(.22,.61,.36,1), box-shadow .55s cubic-bezier(.22,.61,.36,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .ct-card3d:hover { transform: translateY(-2px) scale(1.006); box-shadow: 0 0 0 0.5px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.18), 0 6px 14px rgba(0,85,255,.12); } }
        .ct-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .ct-press:active { transform: scale(.97); }
        @keyframes ctFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .ct-enter > * { animation: ctFadeUp .42s cubic-bezier(.34,1.56,.64,1) both; }
        .ct-enter > *:nth-child(1) { animation-delay: .04s; }
        .ct-enter > *:nth-child(2) { animation-delay: .08s; }
        .ct-enter > *:nth-child(3) { animation-delay: .12s; }
        .ct-enter > *:nth-child(4) { animation-delay: .16s; }
        .ct-enter > *:nth-child(5) { animation-delay: .20s; }
        .ct-enter > *:nth-child(6) { animation-delay: .24s; }
        .ct-enter > *:nth-child(7) { animation-delay: .28s; }
        .ct-enter > *:nth-child(8) { animation-delay: .32s; }
        .ct-enter > *:nth-child(9) { animation-delay: .36s; }
      `}</style>

      <div className="max-w-[1400px] mx-auto px-10 pt-8 pb-12">

        {/* Header eyebrow + title + top action bar */}
        <div className="mb-6 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-[7px] text-[10px] font-bold uppercase mb-[8px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
              <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: MA.P }} />
              Teacher Dashboard · New Test
            </div>
            <h1 className="text-[40px] font-bold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.4px" }}>
              Create test
            </h1>
            <div className="text-[14px] font-medium mt-[8px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
              Set up a new test, attach a blueprint, and publish to your class.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onCancel} disabled={isSaving}
              className="ct-press px-5 h-[44px] rounded-[12px]"
              style={{
                background: MA.CARD, color: MA.T1,
                fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                fontFamily: MA.FONT, border: MA.BDR, boxShadow: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10)",
                cursor: isSaving ? "not-allowed" : "pointer", opacity: isSaving ? 0.55 : 1,
              }}>
              Cancel
            </button>
            <button type="button" onClick={() => handleSave("Draft")}
              disabled={isSaving || !formData.title.trim() || !formData.classId}
              className="ct-press px-5 h-[44px] rounded-[12px] flex items-center gap-[6px]"
              style={{
                background: MA.SURFACE, color: MA.T1,
                fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                fontFamily: MA.FONT, border: MA.BDR,
                cursor: isSaving ? "not-allowed" : "pointer",
                opacity: (isSaving || !formData.title.trim() || !formData.classId) ? 0.55 : 1,
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Save draft
            </button>
            <button type="button" onClick={() => handleSave("Upcoming")}
              disabled={isSaving || !formData.title.trim() || !formData.classId}
              className="ct-press h-[44px] px-6 rounded-[12px] flex items-center gap-[8px]"
              style={{
                background: MA.P, color: "#fff",
                fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
                boxShadow: "0 1px 2px rgba(9,87,247,0.25), 0 6px 16px rgba(9,87,247,0.4)",
                fontFamily: MA.FONT, border: "none",
                cursor: isSaving ? "not-allowed" : "pointer",
                opacity: (isSaving || !formData.title.trim() || !formData.classId) ? 0.55 : 1,
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

        {/* Dark gradient hero with live status grid */}
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
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
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
                  Build a new test
                </div>
                <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.62)", letterSpacing: "-0.1px" }}>
                  Configure scoring, timing, topics, and rules — all in one screen.
                </div>
              </div>
            </div>
            {/* 4-col mini status grid */}
            <div className="grid grid-cols-4 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[520px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              <div className="py-[14px] px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[16px] font-bold truncate" style={{ color: formData.classId ? "#6FFFAA" : "#fff", letterSpacing: "-0.4px" }}>
                  {formData.className || "—"}
                </div>
                <div className="text-[9px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Class</div>
              </div>
              <div className="py-[14px] px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[16px] font-bold" style={{ color: daysLeft ? (daysLeft.tone === MA.RED ? "#FF9AA9" : "#FFD060") : "#fff", letterSpacing: "-0.4px" }}>
                  {daysLeft?.text || "—"}
                </div>
                <div className="text-[9px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Date</div>
              </div>
              <div className="py-[14px] px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[16px] font-bold text-white" style={{ letterSpacing: "-0.4px" }}>
                  {parseMarks(formData.marks)}
                </div>
                <div className="text-[9px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Marks</div>
              </div>
              <div className="py-[14px] px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[16px] font-bold text-white" style={{ letterSpacing: "-0.4px" }}>
                  {parseDuration(formData.duration)}<span className="text-[10px] font-bold ml-[2px]" style={{ color: "rgba(255,255,255,0.6)" }}>min</span>
                </div>
                <div className="text-[9px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Duration</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main 2-col grid */}
        <div className="grid grid-cols-3 gap-6">

          {/* ── LEFT: form cards ────────────────────────────────────────────── */}
          <div className="col-span-2 flex flex-col gap-5 ct-enter">

            {/* CARD 1 — Select Class */}
            <div className="ct-card3d rounded-[22px] p-6"
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
                    <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Where will this test run?</div>
                  </div>
                </div>
                {formData.classId && (
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
                    const isActive = formData.classId === c.id;
                    return (
                      <button key={c.id} type="button"
                        onClick={() => setFormData({ ...formData, classId: c.id, className: c.name || "" })}
                        aria-pressed={isActive}
                        className="ct-press py-[10px] px-[18px] rounded-[10px] transition-all"
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

            {/* CARD 2 — Test Name */}
            <div className="ct-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.P, boxShadow: "0 4px 10px rgba(9,87,247,0.3)" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                  </div>
                  <div>
                    <label htmlFor="ct-title-desktop" className="block text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                      Test Name <span className="font-bold" style={{ color: MA.RED }}>*</span>
                    </label>
                    <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Displayed to students on the test card</div>
                  </div>
                </div>
                <span className="text-[11px] font-bold" style={{ color: formData.title.length > 180 ? MA.ORANGE : MA.T3 }}>
                  {formData.title.length} / 200
                </span>
              </div>
              <input id="ct-title-desktop"
                type="text"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. Chapter 5 Unit Test — Algebraic Expressions"
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

            {/* CARD 3 — Description */}
            <div className="ct-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.VIOLET, boxShadow: "0 4px 10px rgba(123,63,244,0.3)" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
                  </div>
                  <div>
                    <label htmlFor="ct-desc-desktop" className="block text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                      Description <span className="font-semibold" style={{ color: MA.T4 }}>(Optional)</span>
                    </label>
                    <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Scope, syllabus refs, instructions for students</div>
                  </div>
                </div>
                <span className="text-[11px] font-bold" style={{ color: formData.description.length > 450 ? MA.ORANGE : MA.T3 }}>
                  {formData.description.length} / 500
                </span>
              </div>
              <textarea id="ct-desc-desktop"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the test scope, syllabus chapters, and instructions students should follow…"
                rows={4}
                maxLength={500}
                className="w-full outline-none resize-none"
                style={{
                  minHeight: 110,
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: formData.description ? "#fff" : MA.SURFACE,
                  border: `0.5px solid ${formData.description ? "rgba(9,87,247,0.25)" : "rgba(9,87,247,0.08)"}`,
                  fontSize: 14, fontWeight: 500, color: MA.T1, letterSpacing: "-0.15px",
                  fontFamily: MA.FONT, lineHeight: 1.55,
                }} />
            </div>

            {/* CARDS 4+5 — Category + Subject (2 col) */}
            <div className="grid grid-cols-2 gap-5">
              <div className="ct-card3d rounded-[22px] p-6"
                {...tilt3D}
                style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-[36px] h-[36px] rounded-[11px] flex items-center justify-center text-white" style={{ background: MA.VIOLET, boxShadow: "0 4px 10px rgba(123,63,244,0.3)" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>Category</div>
                    <div className="text-[12px] font-bold mt-[1px]" style={{ color: MA.T1, letterSpacing: "-0.15px" }}>Type of assessment</div>
                  </div>
                </div>
                <div className="relative flex items-center gap-3 px-4 py-[13px] rounded-[14px]"
                  style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)", cursor: "pointer" }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.25px" }}>{formData.category}</div>
                  </div>
                  <div className="text-[20px] font-normal -mt-[3px]" style={{ color: MA.T4 }}>›</div>
                  <select aria-label="Test category"
                    value={isPreset(formData.category) ? formData.category : CUSTOM_OPTION}
                    onChange={e => onPickCategory(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    style={{ fontFamily: MA.FONT }}>
                    {examCategories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    <option value={CUSTOM_OPTION}>+ Add custom category…</option>
                  </select>
                </div>
                {customCatOpen && (
                  <div className="mt-4 flex items-center gap-[10px]">
                    <input
                      type="text"
                      value={customCatText}
                      onChange={e => setCustomCatText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveCustomCategory(); } }}
                      placeholder="Type your category…"
                      maxLength={60}
                      autoFocus
                      className="flex-1 outline-none"
                      style={{
                        padding: '12px 14px',
                        borderRadius: 12,
                        background: '#fff',
                        border: '0.5px solid rgba(9,87,247,0.25)',
                        fontSize: 14, fontWeight: 600, color: MA.T1, letterSpacing: '-0.2px',
                        fontFamily: MA.FONT,
                      }}
                    />
                    <button
                      type="button"
                      onClick={saveCustomCategory}
                      disabled={!customCatText.trim()}
                      style={{
                        padding: '12px 16px', borderRadius: 12,
                        background: MA.P, color: '#fff',
                        fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
                        border: 'none', cursor: 'pointer', flexShrink: 0,
                        opacity: customCatText.trim() ? 1 : 0.5,
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomCatOpen(false)}
                      style={{
                        padding: '12px 14px', borderRadius: 12,
                        background: MA.SURFACE, color: MA.T3,
                        fontSize: 13, fontWeight: 600,
                        border: '0.5px solid rgba(9,87,247,0.08)', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              <div className="ct-card3d rounded-[22px] p-6"
                {...tilt3D}
                style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-[36px] h-[36px] rounded-[11px] flex items-center justify-center text-white" style={{ background: MA.GOLD, boxShadow: "0 4px 10px rgba(255,170,0,0.35)" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
                  </div>
                  <div>
                    <label htmlFor="ct-subject-desktop" className="block text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>Subject</label>
                    <div className="text-[12px] font-bold mt-[1px]" style={{ color: MA.T1, letterSpacing: "-0.15px" }}>e.g. Math, Science, English</div>
                  </div>
                </div>
                <input id="ct-subject-desktop"
                  type="text"
                  value={formData.subject}
                  onChange={e => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="e.g. English"
                  className="w-full outline-none"
                  style={{
                    padding: "13px 16px",
                    borderRadius: 14,
                    background: formData.subject ? "#fff" : MA.SURFACE,
                    border: `0.5px solid ${formData.subject ? "rgba(9,87,247,0.25)" : "rgba(9,87,247,0.08)"}`,
                    fontSize: 15, fontWeight: 600, color: MA.T1, letterSpacing: "-0.2px",
                    fontFamily: MA.FONT,
                  }} />
              </div>
            </div>

            {/* CARDS 6+7 — Marks + Duration steppers (2 col) */}
            <div className="grid grid-cols-2 gap-5">
              <div className="ct-card3d rounded-[22px] p-6"
                {...tilt3D}
                style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-[36px] h-[36px] rounded-[11px] flex items-center justify-center text-white" style={{ background: MA.GREEN, boxShadow: "0 4px 10px rgba(0,200,83,0.35)" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                      Total Marks <span className="font-bold" style={{ color: MA.RED }}>*</span>
                    </div>
                    <div className="text-[12px] font-bold mt-[1px]" style={{ color: MA.T1, letterSpacing: "-0.15px" }}>Maximum score · 5-mark steps</div>
                  </div>
                </div>
                <div className="flex items-center rounded-[14px] overflow-hidden" style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)" }}>
                  <button type="button" aria-label="Decrement marks"
                    onClick={() => setMarks(parseMarks(formData.marks) - 5)}
                    className="ct-press w-[52px] h-[56px] flex items-center justify-center hover:bg-[rgba(9,87,247,0.06)]"
                    style={{ background: "transparent", color: MA.P, fontSize: 22, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                    −
                  </button>
                  <div className="flex-1 text-center text-[24px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.6px" }}>
                    {parseMarks(formData.marks)}
                  </div>
                  <button type="button" aria-label="Increment marks"
                    onClick={() => setMarks(parseMarks(formData.marks) + 5)}
                    className="ct-press w-[52px] h-[56px] flex items-center justify-center hover:bg-[rgba(9,87,247,0.06)]"
                    style={{ background: "transparent", color: MA.P, fontSize: 22, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                    +
                  </button>
                </div>
              </div>
              <div className="ct-card3d rounded-[22px] p-6"
                {...tilt3D}
                style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-[36px] h-[36px] rounded-[11px] flex items-center justify-center text-white" style={{ background: MA.ORANGE, boxShadow: "0 4px 10px rgba(255,136,0,0.35)" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                      Duration <span className="font-bold" style={{ color: MA.RED }}>*</span>
                    </div>
                    <div className="text-[12px] font-bold mt-[1px]" style={{ color: MA.T1, letterSpacing: "-0.15px" }}>Time limit · 5–300 minutes</div>
                  </div>
                </div>
                <div className="flex items-center rounded-[14px] overflow-hidden" style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)" }}>
                  <button type="button" aria-label="Decrement duration"
                    onClick={() => setDuration(parseDuration(formData.duration) - 5)}
                    className="ct-press w-[52px] h-[56px] flex items-center justify-center hover:bg-[rgba(9,87,247,0.06)]"
                    style={{ background: "transparent", color: MA.P, fontSize: 22, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                    −
                  </button>
                  <div className="flex-1 text-center text-[24px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.6px" }}>
                    {parseDuration(formData.duration)}<span className="text-[14px] font-bold ml-[4px]" style={{ color: MA.T3 }}>min</span>
                  </div>
                  <button type="button" aria-label="Increment duration"
                    onClick={() => setDuration(parseDuration(formData.duration) + 5)}
                    className="ct-press w-[52px] h-[56px] flex items-center justify-center hover:bg-[rgba(9,87,247,0.06)]"
                    style={{ background: "transparent", color: MA.P, fontSize: 22, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* CARD 8 — Test Date */}
            <div className="ct-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.ORANGE, boxShadow: "0 4px 10px rgba(255,136,0,0.35)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                <div>
                  <label htmlFor="ct-date-desktop" className="block text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                    Test Date <span className="font-bold" style={{ color: MA.RED }}>*</span>
                  </label>
                  <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>When students will sit for this test</div>
                </div>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => openDatePicker(dateDesktopRef.current)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDatePicker(dateDesktopRef.current); } }}
                className="relative flex items-center gap-4 px-5 py-[14px] rounded-[14px] hover:bg-[#EAF0FB] transition-colors"
                style={{ background: MA.SURFACE, border: "0.5px solid rgba(9,87,247,0.08)", cursor: "pointer" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>{prettyTestDate}</div>
                  <div className="text-[12px] font-semibold mt-[3px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                    {formData.testDate ? "Click to change" : "Pick a date"}
                  </div>
                </div>
                {daysLeft && (
                  <div className="px-[14px] py-[6px] rounded-full text-[12px] font-bold flex-shrink-0"
                    style={{ background: daysLeft.tone === MA.RED ? "rgba(255,51,85,0.1)" : "rgba(255,136,0,0.12)", color: daysLeft.tone, letterSpacing: "-0.1px" }}>
                    {daysLeft.text}
                  </div>
                )}
                <input id="ct-date-desktop"
                  ref={dateDesktopRef}
                  type="date"
                  value={formData.testDate}
                  onChange={e => setFormData({ ...formData, testDate: e.target.value })}
                  min={(() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0]; })()}
                  aria-label="Test date"
                  className="absolute opacity-0 pointer-events-none"
                  style={{ width: 1, height: 1, left: "50%", bottom: 0, fontFamily: MA.FONT }} />
              </div>
            </div>

            {/* CARD 9 — Attach Paper / Blueprint */}
            <div className="ct-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.GOLD, boxShadow: "0 4px 10px rgba(255,170,0,0.35)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                </div>
                <div className="flex-1">
                  <div className="text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                    Attach Blueprint <span className="font-semibold" style={{ color: MA.T4 }}>(Optional)</span>
                  </div>
                  <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Upload PDF/Word/image of the question paper — max 10 MB</div>
                </div>
              </div>
              <label
                className="block rounded-[16px] px-5 py-7 text-center relative hover:bg-[rgba(9,87,247,0.06)] active:bg-[rgba(9,87,247,0.09)] transition-colors"
                style={{
                  border: "1.5px dashed rgba(9,87,247,0.3)",
                  background: pdfFile ? "rgba(0,200,83,0.04)" : "rgba(9,87,247,0.03)",
                  cursor: "pointer",
                }}>
                <input type="file" accept=".pdf,.doc,.docx,image/png,image/jpeg"
                  aria-label="Upload test blueprint"
                  onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
                {pdfFile ? (
                  <div className="flex items-center gap-[14px] bg-white rounded-[14px] px-5 py-[14px]" style={{ border: "0.5px solid rgba(0,200,83,0.25)", boxShadow: "0 0 0 0.5px rgba(0,200,83,.1), 0 6px 18px rgba(0,200,83,.12)" }}>
                    <div className="w-[44px] h-[44px] rounded-[12px] flex items-center justify-center text-white flex-shrink-0" style={{ background: MA.GREEN }}>
                      <FileText size={20} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{pdfFile.name}</div>
                      <div className="text-[11px] font-semibold mt-[2px]" style={{ color: MA.T3 }}>
                        {pdfFile.size >= 1024 * 1024
                          ? `${(pdfFile.size / 1024 / 1024).toFixed(1)} MB`
                          : `${(pdfFile.size / 1024).toFixed(1)} KB`}
                        {" · "}
                        Ready to upload
                      </div>
                    </div>
                    <button type="button" aria-label="Remove blueprint"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); setPdfFile(null); }}
                      className="ct-press flex-shrink-0 w-[34px] h-[34px] rounded-[10px] flex items-center justify-center"
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
                    <div className="text-[15px] font-bold mb-[5px]" style={{ color: MA.P, letterSpacing: "-0.2px" }}>Click to upload blueprint</div>
                    <div className="text-[12px] font-medium mb-[14px]" style={{ color: MA.T3 }}>Helps you remember which paper this test maps to</div>
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
              </label>
            </div>

            {/* CARD 10 — Topics & Question Types (chip builder) */}
            <div className="ct-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.P, boxShadow: "0 4px 10px rgba(9,87,247,0.3)" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>Topics & Question Types</div>
                    <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Tag the test for filtering and AI suggestions</div>
                  </div>
                </div>
                <span className="text-[11px] font-bold px-[10px] py-[4px] rounded-full"
                  style={{ background: "rgba(9,87,247,0.08)", color: MA.P, letterSpacing: "0.3px" }}>
                  {qTypes.length + topics.length} tag{qTypes.length + topics.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex gap-[10px] mb-4">
                <input type="text" placeholder="Add a topic… (Algebra, Photosynthesis, Mughal Empire…)"
                  value={newTopic}
                  onChange={e => setNewTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newTopic.trim()) { setTopics([...topics, newTopic.trim()]); setNewTopic(""); } }}
                  className="flex-1 outline-none"
                  style={{
                    padding: "13px 16px",
                    borderRadius: 14,
                    background: MA.SURFACE,
                    border: "0.5px solid rgba(9,87,247,0.08)",
                    fontSize: 14, fontWeight: 500, color: MA.T1, letterSpacing: "-0.15px",
                    fontFamily: MA.FONT,
                  }} />
                <button type="button"
                  onClick={() => { if (newTopic.trim()) { setTopics([...topics, newTopic.trim()]); setNewTopic(""); } }}
                  disabled={!newTopic.trim()}
                  className="ct-press h-[48px] px-6 rounded-[14px] flex items-center gap-[6px]"
                  style={{
                    background: MA.P, color: "#fff",
                    fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
                    boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.3)",
                    fontFamily: MA.FONT, border: "none",
                    cursor: newTopic.trim() ? "pointer" : "not-allowed",
                    opacity: newTopic.trim() ? 1 : 0.55,
                  }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add topic
                </button>
              </div>
              {(qTypes.length + topics.length) === 0 ? (
                <div className="rounded-[14px] px-5 py-6 text-center" style={{ background: MA.SURFACE, border: "0.5px dashed rgba(9,87,247,0.15)" }}>
                  <div className="text-[12px] font-bold" style={{ color: MA.T3 }}>No tags yet — add a few to help AI surface this test later.</div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-[8px]">
                  {qTypes.map((q, idx) => (
                    <div key={`q-${idx}`} className="inline-flex items-center gap-[7px] pl-[14px] pr-[6px] py-[7px] rounded-full text-[13px] font-bold"
                      style={{ background: "rgba(9,87,247,0.08)", color: MA.P, border: "0.5px solid rgba(9,87,247,0.15)", letterSpacing: "-0.15px" }}>
                      {q}
                      <button type="button" aria-label={`Remove ${q}`}
                        onClick={() => setQTypes(qTypes.filter((_, i) => i !== idx))}
                        className="ct-press w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-bold"
                        style={{ background: "rgba(9,87,247,0.14)", color: MA.P, border: "none", cursor: "pointer" }}>
                        ×
                      </button>
                    </div>
                  ))}
                  {topics.map((t, idx) => (
                    <div key={`t-${idx}`} className="inline-flex items-center gap-[7px] pl-[14px] pr-[6px] py-[7px] rounded-full text-[13px] font-bold"
                      style={{ background: "rgba(0,200,83,0.08)", color: MA.GREEN, border: "0.5px solid rgba(0,200,83,0.18)", letterSpacing: "-0.15px" }}>
                      {t}
                      <button type="button" aria-label={`Remove ${t}`}
                        onClick={() => setTopics(topics.filter((_, i) => i !== idx))}
                        className="ct-press w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-bold"
                        style={{ background: "rgba(0,200,83,0.16)", color: MA.GREEN, border: "none", cursor: "pointer" }}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CARD 11 — Additional Settings */}
            <div className="ct-card3d rounded-[22px] p-6"
              {...tilt3D}
              style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.VIOLET, boxShadow: "0 4px 10px rgba(123,63,244,0.3)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase" style={{ color: MA.T3, letterSpacing: "1.5px" }}>Additional Settings</div>
                  <div className="text-[13px] font-bold mt-[2px]" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Behavior options for the test</div>
                </div>
              </div>
              <div className="flex flex-col">
                {([
                  { key: "immediateResults" as const, title: "Show results immediately", desc: "Students see scores right after submitting", color: MA.P, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> },
                  { key: "allowRetake" as const, title: "Allow retake for failed attempts", desc: "One retry for students below passing score", color: MA.ORANGE, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg> },
                  { key: "shuffleQuestions" as const, title: "Shuffle questions per student", desc: "Random order helps prevent copying", color: MA.VIOLET, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg> },
                ]).map(({ key, title, desc, color, icon }, idx) => {
                  const on = settings[key];
                  return (
                    <button key={key} type="button"
                      onClick={() => setSettings({ ...settings, [key]: !on })}
                      aria-pressed={on}
                      className="w-full flex items-center gap-4 py-4 text-left hover:bg-[rgba(9,87,247,0.03)] transition-colors rounded-[12px] px-3 -mx-3"
                      style={{
                        borderTop: idx > 0 ? "0.5px solid rgba(9,87,247,0.08)" : "none",
                        background: "none", border: "none",
                        cursor: "pointer", fontFamily: MA.FONT,
                      }}>
                      <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center text-white flex-shrink-0" style={{ background: color, boxShadow: `0 4px 10px ${color}55` }}>
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{title}</div>
                        <div className="text-[12px] font-medium mt-[3px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>{desc}</div>
                      </div>
                      <div className="relative flex-shrink-0" style={{
                        width: 52, height: 30, borderRadius: 100,
                        background: on ? MA.GREEN : "#E5E9F2",
                        boxShadow: on ? "inset 0 1px 2px rgba(0,0,0,0.1)" : "inset 0 1px 2px rgba(0,0,0,0.05)",
                        transition: "background .25s cubic-bezier(.2,.9,.3,1)",
                      }}>
                        <div className="absolute rounded-full bg-white" style={{
                          top: 2, left: 2, width: 26, height: 26,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.08), 0 3px 6px rgba(0,0,0,0.12)",
                          transform: on ? "translateX(22px)" : "translateX(0)",
                          transition: "transform .25s cubic-bezier(.34,1.56,.64,1)",
                        }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* ── RIGHT: sticky Live Preview + Publish ────────────────────────── */}
          <div className="col-span-1">
            <div className="sticky top-6 flex flex-col gap-4">

              {/* Live Preview card */}
              <div className="ct-card3d rounded-[22px] p-6 relative overflow-hidden"
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
                    {formData.title || "Test name"}
                  </div>
                  <div className="flex items-center gap-[8px] flex-wrap mb-[8px]">
                    <span className="px-[9px] py-[3px] rounded-[7px] text-[11px] font-bold"
                      style={{ background: "rgba(9,87,247,0.08)", color: MA.P }}>
                      {formData.className || "Select a class"}
                    </span>
                    <span className="px-[9px] py-[3px] rounded-[7px] text-[11px] font-bold"
                      style={{ background: "rgba(123,63,244,0.08)", color: MA.VIOLET }}>
                      {formData.category}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-[1px] rounded-[10px] overflow-hidden p-[1px] mb-[8px]" style={{ background: "rgba(9,87,247,0.08)" }}>
                    <div className="py-[8px] px-[6px] text-center bg-white">
                      <div className="text-[13px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{parseMarks(formData.marks)}</div>
                      <div className="text-[8px] font-bold uppercase mt-[2px]" style={{ color: MA.T3, letterSpacing: "0.8px" }}>Marks</div>
                    </div>
                    <div className="py-[8px] px-[6px] text-center bg-white">
                      <div className="text-[13px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>{parseDuration(formData.duration)}m</div>
                      <div className="text-[8px] font-bold uppercase mt-[2px]" style={{ color: MA.T3, letterSpacing: "0.8px" }}>Time</div>
                    </div>
                    <div className="py-[8px] px-[6px] text-center bg-white">
                      <div className="text-[13px] font-bold" style={{ color: formData.testDate ? MA.ORANGE : MA.T4, letterSpacing: "-0.2px" }}>
                        {formData.testDate ? new Date(`${formData.testDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                      </div>
                      <div className="text-[8px] font-bold uppercase mt-[2px]" style={{ color: MA.T3, letterSpacing: "0.8px" }}>Date</div>
                    </div>
                  </div>
                  {formData.description && (
                    <div className="text-[12px] font-medium mt-[6px] line-clamp-3" style={{ color: MA.T3, letterSpacing: "-0.1px", lineHeight: 1.5 }}>
                      {formData.description}
                    </div>
                  )}
                  {pdfFile && (
                    <div className="flex items-center gap-[8px] mt-[10px] px-[10px] py-[7px] rounded-[10px]"
                      style={{ background: "#fff", border: "0.5px solid rgba(0,200,83,0.18)" }}>
                      <FileText size={13} style={{ color: MA.GREEN }} />
                      <span className="text-[11px] font-bold truncate" style={{ color: MA.T1 }}>{pdfFile.name}</span>
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
                    {(!formData.title.trim() || !formData.classId)
                      ? "Fill required fields first"
                      : "Looks good — let's go!"}
                  </div>
                  <div className="flex flex-col gap-[8px] mb-5">
                    {[
                      { ok: !!formData.classId, label: "Class selected" },
                      { ok: formData.title.trim().length > 0, label: "Test name written" },
                      { ok: !!formData.testDate, label: "Test date set", optional: true },
                      { ok: parseMarks(formData.marks) > 0, label: "Total marks chosen" },
                      { ok: parseDuration(formData.duration) > 0, label: "Duration chosen" },
                      { ok: !!pdfFile, label: "Blueprint uploaded", optional: true },
                      { ok: topics.length > 0 || qTypes.length > 0, label: "Topics tagged", optional: true },
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
                  <button type="button" onClick={() => handleSave("Upcoming")}
                    disabled={isSaving || !formData.title.trim() || !formData.classId}
                    className="ct-press w-full h-[52px] rounded-[14px] flex items-center justify-center gap-[8px]"
                    style={{
                      background: MA.GREEN, color: "#fff",
                      fontSize: 15, fontWeight: 700, letterSpacing: "-0.2px",
                      boxShadow: "0 1px 2px rgba(0,200,83,0.2), 0 8px 20px rgba(0,200,83,0.4)",
                      fontFamily: MA.FONT, border: "none",
                      cursor: isSaving ? "not-allowed" : "pointer",
                      opacity: (isSaving || !formData.title.trim() || !formData.classId) ? 0.55 : 1,
                    }}>
                    {isSaving ? (
                      <Loader2 className="w-[16px] h-[16px] animate-spin" />
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Create &amp; publish test
                      </>
                    )}
                  </button>
                  <button type="button" onClick={() => handleSave("Draft")}
                    disabled={isSaving || !formData.title.trim() || !formData.classId}
                    className="ct-press w-full h-[42px] mt-[10px] rounded-[12px] flex items-center justify-center gap-[6px]"
                    style={{
                      background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.95)",
                      fontSize: 13, fontWeight: 700, letterSpacing: "-0.15px",
                      fontFamily: MA.FONT, border: "0.5px solid rgba(255,255,255,0.2)",
                      cursor: isSaving ? "not-allowed" : "pointer",
                      opacity: (isSaving || !formData.title.trim() || !formData.classId) ? 0.55 : 1,
                    }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    Save as draft
                  </button>
                  <button type="button" onClick={onCancel} disabled={isSaving}
                    className="ct-press w-full h-[36px] mt-[8px] rounded-[10px]"
                    style={{
                      background: "transparent", color: "rgba(255,255,255,0.6)",
                      fontSize: 12, fontWeight: 600, letterSpacing: "-0.1px",
                      fontFamily: MA.FONT, border: "none",
                      cursor: isSaving ? "not-allowed" : "pointer", opacity: isSaving ? 0.5 : 1,
                    }}>
                    Cancel
                  </button>
                </div>
              </div>

              {/* Pro tip card */}
              <div className="rounded-[18px] p-4 flex items-start gap-3"
                style={{ background: MA.CARD, boxShadow: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10)", border: MA.BDR }}>
                <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0 text-[18px]"
                  style={{ background: "rgba(255,170,0,0.12)", color: MA.GOLD }}>💡</div>
                <div>
                  <div className="text-[11px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.15px" }}>Pro tip</div>
                  <div className="text-[11px] font-medium mt-[3px] leading-[1.5]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                    Press <kbd className="px-[5px] py-[1px] rounded-[5px] text-[10px] font-bold" style={{ background: MA.SURFACE, color: MA.T1, border: "0.5px solid rgba(9,87,247,0.1)" }}>Enter</kbd> in the topic field to add it instantly. Save as draft if you want to come back later.
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
}