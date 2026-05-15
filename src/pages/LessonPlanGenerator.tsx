import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { AIController } from "../ai/controller/ai-controller";
import { db } from "../lib/firebase";
import { collection, serverTimestamp, query, where, onSnapshot, doc } from "firebase/firestore";
import { auditedAdd, auditedDelete } from "../lib/auditedWrites";
import { toast } from "sonner";
import {
  lessonPlanCacheKey,
  getInflight,
  setInflight,
  lsRead,
  lsWrite,
  formatAge,
  type LessonPlanFormFields,
} from "../lib/lessonPlanCache";

// ── Blue Apple design tokens (matches all other teacher pages) ───────────────
// Was slate-based. Now harmonized with the app-wide Blue Apple palette so the
// result view + history list use the same visual language as Dashboard,
// MyClasses, Gradebook, ConceptMastery, Exam Generator, etc.
const HERO_GRAD = "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)";
const T = {
  hero:  HERO_GRAD,                   // result-view dark hero now Blue Apple
  bg:    "#EEF4FF",                   // page background
  white: "#FFFFFF",
  ink1:  "#001040",                   // primary text
  ink2:  "#5070B0",                   // secondary text
  ink3:  "#99AACC",                   // muted text
  s1:    "#F4F7FE",                   // surface
  s2:    "#EAF0FB",                   // separator
  bdr:   "rgba(0,85,255,0.10)",       // 0.5px Blue Apple border
  blue:  "#0055FF",                   // primary action
  blBg:  "rgba(0,85,255,0.10)",
  blBdr: "rgba(0,85,255,0.22)",
  pur:   "#7B3FF4",                   // AI accent — Blue Apple violet
  plBg:  "rgba(123,63,244,0.10)",
  plBdr: "rgba(123,63,244,0.25)",
  grn:   "#00C853",                   // success / mastered
  grn2:  "#00C853",
  glBg:  "rgba(0,200,83,0.10)",
  glBdr: "rgba(0,200,83,0.22)",
  red:   "#FF3355",                   // error / weak
  rlBg:  "rgba(255,51,85,0.10)",
  rlBdr: "rgba(255,51,85,0.22)",
  amb:   "#FF8800",                   // warning / developing
  alBg:  "rgba(255,136,0,0.10)",
  alBdr: "rgba(255,136,0,0.25)",
  // Card shadow stack — same Blue Apple halo used elsewhere.
  SH:    "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
};

// ── Constants ─────────────────────────────────────────────────────────────────
const BOARDS = ["CBSE", "ICSE", "State Board", "IB", "Cambridge (IGCSE)", "Other"];
const GRADES = ["Class 1","Class 2","Class 3","Class 4","Class 5","Class 6","Class 7","Class 8","Class 9","Class 10","Class 11","Class 12"];
const DURATIONS = ["30 minutes","40 minutes","45 minutes","60 minutes","75 minutes","90 minutes"];
const LESSON_COUNTS = [1, 2, 3, 4, 5];

// Phase color mapping
const PHASE_STYLES: Record<string, { bg: string; bdr: string; color: string }> = {
  introduction: { bg: T.alBg, bdr: T.alBdr, color: T.amb },
  hook:         { bg: T.alBg, bdr: T.alBdr, color: T.amb },
  direct:       { bg: T.blBg, bdr: T.blBdr, color: T.blue },
  instruction:  { bg: T.blBg, bdr: T.blBdr, color: T.blue },
  guided:       { bg: T.plBg, bdr: T.plBdr, color: T.pur },
  independent:  { bg: T.glBg, bdr: T.glBdr, color: T.grn },
  closure:      { bg: T.rlBg, bdr: T.rlBdr, color: T.red },
  summary:      { bg: T.rlBg, bdr: T.rlBdr, color: T.red },
};

const getPhaseStyle = (name: string) => {
  const lower = name.toLowerCase();
  for (const key of Object.keys(PHASE_STYLES)) {
    if (lower.includes(key)) return PHASE_STYLES[key];
  }
  return { bg: T.s1, bdr: T.bdr, color: T.ink2 };
};

interface FormData {
  subject: string;
  grade: string;
  topic: string;
  duration_per_lesson: string;
  num_lessons: number;
  board: string;
  learning_goals: string;
  special_considerations: string;
}

// P0-4: extended every field actually rendered in the result view so the
// previous `as any` casts can be dropped. AI may omit any optional field —
// every render site already null-checks via `?.` chaining.
interface LessonSection {
  name?: string;             // phase name (e.g. "Introduction", "Guided Practice")
  duration?: string;
  teacher_activity?: string;
  student_activity?: string;
  key_questions?: string[];
  // legacy fields kept for back-compat with older saved plans
  heading?: string;
  phase?: string;
  content?: string;
  activities?: string[];
  [key: string]: unknown;
}

interface Lesson {
  lesson_number?: number;
  title?: string;
  duration?: string;
  learning_focus?: string;
  objectives?: string[];
  sections?: LessonSection[];
  [key: string]: unknown;
}

interface LessonPlanResult {
  plan_title?: string;
  overview?: string;
  subject?: string;
  grade?: string;
  board?: string;
  total_duration?: string;
  learning_objectives?: string[];
  materials_needed?: string[];
  prior_knowledge?: string;
  lessons?: Lesson[];
  [key: string]: unknown;
}

interface HistoryItem {
  id: string;
  subject?: string;
  grade?: string;
  topic?: string;
  board?: string;
  plan?: LessonPlanResult;
  createdAt?: { toMillis?: () => number };
  [key: string]: unknown;
}

const defaultForm: FormData = {
  subject: "", grade: "Class 8", topic: "",
  duration_per_lesson: "45 minutes", num_lessons: 1, board: "CBSE",
  learning_goals: "", special_considerations: "",
};

// ── Main component ────────────────────────────────────────────────────────────
const LessonPlanGenerator = () => {
  const { teacherData } = useAuth();
  const [form, setForm] = useState<FormData>({ ...defaultForm, subject: teacherData?.subject || "" });
  const [loading, setLoading]             = useState(false);
  const [plan, setPlan]                   = useState<LessonPlanResult | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [history, setHistory]             = useState<HistoryItem[]>([]);
  const [expandedLesson, setExpandedLesson] = useState<number>(0);
  const [activeTab, setActiveTab]         = useState<"generate" | "history">("generate");
  const [savedId, setSavedId]             = useState<string | null>(null); // P1-5
  // P0-2: when the displayed plan came from cache, track its age so we can
  // show a "Cached · 2h ago" badge + offer a "Regenerate fresh" override.
  const [cachedAt, setCachedAt]           = useState<number | null>(null);
  // Back-to-form override: when teacher clicks "Back" on result hero, force
  // the form view even though `plan` is still in memory. Cleared on next
  // Generate (so a fresh result returns the user to the result view).
  const [forceShowForm, setForceShowForm] = useState(false);

  // P1-6: surface listener failures + retry pattern (mirrors Gradebook +
  // ConceptMastery). Bumping refreshKey forces the history useEffect to
  // re-subscribe — without this, a network blip / permission-denied silently
  // freezes the history list.
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Subjects this teacher is authorized to plan for. Union of:
  //   1) teaching_assignments rows (canonical — set by principal/owner) and
  //   2) teachers/{id}.subject (legacy single-field on the teacher doc, may
  //      be comma/slash-separated).
  // Dedupe case-insensitively, preserve first-seen casing for display.
  const [assignedSubjects, setAssignedSubjects] = useState<string[]>(() => {
    return (teacherData?.subject || "")
      .split(/[,;/]/)
      .map(s => s.trim())
      .filter(Boolean);
  });
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const seed = (teacherData.subject || "")
      .split(/[,;/]/).map(s => s.trim()).filter(Boolean);
    const unsub = onSnapshot(
      query(
        collection(db, "teaching_assignments"),
        where("schoolId", "==", teacherData.schoolId),
        where("teacherId", "==", teacherData.id),
      ),
      (snap) => {
        const fromAssignments = snap.docs
          .map(d => {
            const data = d.data() as { status?: string; subjectName?: string; subjectId?: string; subject?: string };
            const status = data.status;
            if (status && typeof status === "string" && status.toLowerCase() !== "active") return null;
            return data.subjectName || data.subjectId || data.subject || null;
          })
          .filter((x): x is string => !!x && x.trim().length > 0)
          .map(s => s.trim());
        const seen = new Set<string>();
        const merged: string[] = [];
        [...seed, ...fromAssignments].forEach(s => {
          const k = s.toLowerCase();
          if (seen.has(k)) return;
          seen.add(k);
          merged.push(s);
        });
        setAssignedSubjects(merged);
      },
      (err) => console.warn("[LessonPlanGenerator] teaching_assignments:", err),
    );
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.subject]);

  // Keep form.subject inside the assigned list. If empty / stale, snap to the
  // first allowed subject so the form is always valid for assigned teachers.
  useEffect(() => {
    if (assignedSubjects.length === 0) return;
    const current = (form.subject || "").trim().toLowerCase();
    const inList = assignedSubjects.some(s => s.toLowerCase() === current);
    if (!current || !inList) {
      setForm(prev => ({ ...prev, subject: assignedSubjects[0] }));
    }
    // form.subject intentionally omitted — we only react to the source-of-truth list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedSubjects]);

  // ── Firebase: lesson plan history ───────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    setHistoryError(null);
    // P0-5: race guard — when teacherData.id changes (login flip / school
    // switch) the old listener can resolve AFTER cleanup and clobber state.
    let cancelled = false;
    // Scope by schoolId + teacherId so a misconfigured Firestore rule can't
    // leak another teacher's plans into this list.
    const q = query(
      collection(db, "lessonPlans"),
      where("schoolId", "==", teacherData.schoolId),
      where("teacherId", "==", teacherData.id),
    );
    const unsub = onSnapshot(
      q,
      snap => {
        if (cancelled) return;
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as HistoryItem));
        docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setHistory(docs);
      },
      (e) => {
        console.error("[LessonPlanGenerator] history subscription failed", e);
        const code = (e as { code?: string })?.code;
        setHistoryError(
          code === "permission-denied"
            ? "Permission denied — check your access."
            : "Could not load lesson plan history."
        );
      },
    );
    return () => { cancelled = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId, refreshKey]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleGenerate = async (forceFresh = false) => {
    // Only Subject is required now — Topic + Description are optional. When
    // Topic is empty the AI picks an appropriate topic for the subject + grade
    // + (optional) learning goals. This unlocks "generate me anything for
    // Class 8 Math" flows where the teacher doesn't yet know what to teach.
    if (!form.subject.trim()) {
      setError("Subject is required.");
      return;
    }

    // P0-2: form snapshot captured at click time so the cache key stays
    // consistent even if the form is edited mid-request.
    const cacheableForm: LessonPlanFormFields = {
      subject: form.subject.trim(),
      grade: form.grade,
      topic: form.topic.trim(),
      duration_per_lesson: form.duration_per_lesson,
      num_lessons: form.num_lessons,
      board: form.board,
      learning_goals: form.learning_goals.trim(),
      special_considerations: form.special_considerations.trim(),
    };
    const key = lessonPlanCacheKey(cacheableForm);

    // Tier 1+2 lookup unless explicitly forcing a fresh AI call.
    if (!forceFresh) {
      const cached = lsRead(key);
      if (cached) {
        setPlan(cached.plan as LessonPlanResult);
        setCachedAt(cached.cachedAt);
        setExpandedLesson(0);
        setSaved(false);
        setError(null);
        setForceShowForm(false);
        toast.success(`Loaded cached plan (${formatAge(cached.cachedAt)}).`);
        return;
      }
      const inflightP = getInflight(key);
      if (inflightP) {
        setLoading(true);
        setError(null);
        setForceShowForm(false);
        try {
          const p = await inflightP;
          setPlan(p as LessonPlanResult);
          setCachedAt(null);
          setExpandedLesson(0);
          toast.success("Lesson plan ready.");
        } catch (e) {
          console.error("[LessonPlanGenerator] inflight failed", e);
          setError("Something went wrong. Please try again.");
        } finally {
          setLoading(false);
        }
        return;
      }
    }

    setLoading(true); setError(null); setPlan(null); setSaved(false); setCachedAt(null); setForceShowForm(false);

    const aiCall: Promise<LessonPlanResult> = (async () => {
      const result = await AIController.getLessonPlan({
        ...cacheableForm,
        teacher_name: teacherData?.name || "",
        school_name: teacherData?.schoolName || "",
      });
      if (result.status !== "success" || !result.data) {
        throw new Error((result as { message?: string }).message || "AI could not generate the plan. Please try again.");
      }
      return result.data as LessonPlanResult;
    })();

    // Register inflight even on forceFresh so a double-tap doesn't bill twice.
    setInflight(key, aiCall as Promise<Record<string, unknown>>);

    try {
      const generated = await aiCall;
      setPlan(generated);
      setExpandedLesson(0);
      lsWrite(key, generated as Record<string, unknown>);
      if (forceFresh) toast.success("Plan regenerated.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      console.error("[LessonPlanGenerator] generate failed", e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // P1-1: Cmd/Ctrl+Enter triggers Generate from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !loading && activeTab === "generate") {
        e.preventDefault();
        handleGenerate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleGenerate captures form via closure; binding it would re-bind every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, activeTab]);

  const handleSave = async () => {
    if (!plan || !teacherData?.id) return;
    setSaving(true);
    try {
      const docRef = await auditedAdd(collection(db, "lessonPlans"), {
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        schoolName: teacherData.schoolName || "",
        teacherName: teacherData.name || "",
        subject: form.subject, grade: form.grade,
        topic: form.topic, board: form.board,
        plan, createdAt: serverTimestamp(),
      });
      setSaved(true);
      // P1-5: track the new doc id so future features (delete, link-share,
      // sync status) can act on this specific record without re-querying.
      setSavedId(docRef.id);
      toast.success("Lesson plan saved!");
    } catch (e) {
      console.error("[LessonPlanGenerator] save failed", e);
      toast.error("Failed to save.");
    }
    setSaving(false);
  };

  const handleReset = () => {
    setPlan(null); setError(null); setSaved(false); setSavedId(null); setCachedAt(null);
    setForceShowForm(false);
    setForm({ ...defaultForm, subject: assignedSubjects[0] || "" });
  };

  // P1-4: resilient text-to-clipboard helper. Async API first, falls back to
  // execCommand for HTTP / Android in-app browsers (WhatsApp WebView etc).
  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  // Convert the structured plan into copy-paste-ready plain text. Keeps the
  // sections in order so a teacher can paste into Word / WhatsApp / email
  // and immediately have a readable lesson plan.
  const planToText = (p: LessonPlanResult | null): string => {
    if (!p) return "";
    const lines: string[] = [];
    if (p.plan_title) lines.push(p.plan_title);
    const meta = [p.subject, p.grade, p.board, p.total_duration].filter(Boolean).join(" · ");
    if (meta) lines.push(meta);
    if (p.overview) { lines.push(""); lines.push(p.overview); }
    if (p.learning_objectives?.length) {
      lines.push("\nLearning Objectives:");
      p.learning_objectives.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
    }
    if (p.materials_needed?.length) {
      lines.push("\nMaterials Needed:");
      p.materials_needed.forEach(m => lines.push(`· ${m}`));
    }
    if (p.prior_knowledge) {
      lines.push("\nPrior Knowledge: " + p.prior_knowledge);
    }
    p.lessons?.forEach((lesson, li) => {
      lines.push(`\n${"=".repeat(50)}`);
      lines.push(`Lesson ${lesson.lesson_number || li + 1}: ${lesson.title || "Untitled"}`);
      if (lesson.duration) lines.push(`Duration: ${lesson.duration}`);
      if (lesson.learning_focus) lines.push(`Focus: ${lesson.learning_focus}`);
      lesson.sections?.forEach(section => {
        lines.push(`\n[${section.name || section.phase || "Phase"}${section.duration ? ` · ${section.duration}` : ""}]`);
        if (section.teacher_activity) lines.push(`Teacher: ${section.teacher_activity}`);
        if (section.student_activity) lines.push(`Students: ${section.student_activity}`);
        if (section.key_questions?.length) {
          lines.push("Key Questions:");
          section.key_questions.forEach(q => lines.push(`  › ${q}`));
        }
      });
    });
    return lines.join("\n");
  };

  const handleCopyPlan = async () => {
    if (!plan) return;
    const ok = await copyToClipboard(planToText(plan));
    if (ok) toast.success("Lesson plan copied to clipboard.");
    else toast.error("Copy failed — your browser blocked clipboard access.");
  };

  const handlePrintPlan = () => window.print();

  // P2-3: drift detection — does the AI's lessons.length match what the
  // teacher asked for? Surface as amber banner so they spot it before sharing.
  const drift = (() => {
    if (!plan?.lessons) return null;
    const got = plan.lessons.length;
    const asked = form.num_lessons;
    if (asked > 0 && got !== asked) return { asked, got };
    return null;
  })();

  // P1-7: delete a saved plan from history. Confirm before write since this
  // is irreversible. If the deleted plan happens to be the one currently
  // open in the result view, also clear the result so we don't show a stale
  // copy.
  const handleDeleteHistory = async (h: HistoryItem) => {
    const label = h.plan?.plan_title || h.topic || "this plan";
    const ok = window.confirm(`Delete "${label}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await auditedDelete(doc(db, "lessonPlans", h.id));
      toast.success("Plan deleted.");
      if (savedId === h.id) {
        setSaved(false); setSavedId(null);
      }
    } catch (e) {
      console.error("[LessonPlanGenerator] delete failed", e);
      toast.error("Failed to delete plan.");
    }
  };

  const loadFromHistory = (h: HistoryItem) => {
    setPlan(h.plan ?? null);
    setForm({
      subject: h.subject || "", grade: h.grade || "Class 8",
      topic: h.topic || "",
      duration_per_lesson: h.plan?.lessons?.[0]?.duration || "45 minutes",
      num_lessons: h.plan?.lessons?.length || 1,
      board: h.board || "CBSE",
      learning_goals: "", special_considerations: "",
    });
    setSaved(true); setSavedId(h.id); setCachedAt(null);
    setForceShowForm(false);
    setExpandedLesson(0); setActiveTab("generate");
  };

  const upd = <K extends keyof FormData>(key: K, val: FormData[K]) => setForm(f => ({ ...f, [key]: val }));

  // ── Shared styles ───────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", borderRadius: 11,
    border: `1px solid ${T.bdr}`, background: T.s1,
    fontSize: 13, color: T.ink1, fontFamily: "inherit", outline: "none",
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle, fontSize: 12, appearance: "none" as const, cursor: "pointer",
    paddingRight: 28,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 500, color: T.ink3,
    letterSpacing: "0.07em", textTransform: "uppercase" as const,
    display: "flex", alignItems: "center", gap: 4,
    marginBottom: 6,
  };
  const chevDown = (
    <svg style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" as const }}
      width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round">
      <polyline points="2,4 6,8 10,4" />
    </svg>
  );

  // ── Render ──────────────────────────────────────────────────────────────
  // If plan generated and in generate tab → show result view
  // (unless teacher hit the "Back" button on the result hero — then we
  // force the form view back into focus while the plan stays in memory.)
  const showResult = activeTab === "generate" && plan && !loading && !forceShowForm;

  return (
    <div style={{ minHeight: "100vh", background: "#EEF4FF" }}>

      {/* "View generated plan" — compact one-line chip when teacher hit
          Back. Smaller footprint so it doesn't dominate the form view. */}
      {!showResult && plan && forceShowForm && activeTab === "generate" && (
        <button
          type="button"
          onClick={() => setForceShowForm(false)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            margin: "8px 16px 0", padding: "7px 11px 7px 8px",
            borderRadius: 10, border: "0.5px solid rgba(0,85,255,.18)",
            background: "rgba(0,85,255,.05)",
            cursor: "pointer", fontFamily: "inherit", width: "calc(100% - 32px)",
            textAlign: "left",
          }}
        >
          <span style={{
            fontSize: 9, fontWeight: 700, color: "#0055FF",
            letterSpacing: "1.2px", textTransform: "uppercase",
            padding: "2px 7px", borderRadius: 6,
            background: "rgba(0,85,255,.10)",
            flexShrink: 0,
          }}>
            Plan ready
          </span>
          <span style={{
            fontSize: 12, fontWeight: 700, color: "#001040",
            letterSpacing: "-0.15px", flex: 1, minWidth: 0,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {plan.plan_title || form.topic || "Tap to view"}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0055FF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* P1-6: history-listener failure banner with one-tap retry. Floats at
          top of every view so the user knows their history list is stale. */}
      {historyError && activeTab === "history" && (
        <div style={{
          margin: "10px 16px",
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 12,
          background: "#FFF5F5", border: "0.5px solid #FFD8D8",
        }}>
          <div style={{ flex: 1, fontSize: 12, color: "#C92A2A", fontWeight: 500, lineHeight: 1.45 }}>
            {historyError}
          </div>
          <button
            type="button"
            onClick={() => { setHistoryError(null); setRefreshKey(k => k + 1); }}
            style={{
              padding: "6px 12px", borderRadius: 9, border: "none", cursor: "pointer",
              background: "#C92A2A", color: "#fff", fontSize: 11, fontWeight: 700,
              fontFamily: "inherit",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ═══════════════════ MOBILE VIEW (new mockup) ═══════════════════ */}
      {!showResult && (
        <MobileLessonPlanner
          form={form}
          upd={upd}
          loading={loading}
          error={error}
          history={history}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onGenerate={() => handleGenerate()}
          onLoadHistory={loadFromHistory}
          onDeleteHistory={handleDeleteHistory}
          onReset={handleReset}
          assignedSubjects={assignedSubjects}
        />
      )}

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      {!showResult && (
        <DesktopLessonPlanner
          form={form}
          upd={upd}
          loading={loading}
          error={error}
          history={history}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onGenerate={() => handleGenerate()}
          onLoadHistory={loadFromHistory}
          onDeleteHistory={handleDeleteHistory}
          onReset={handleReset}
          assignedSubjects={assignedSubjects}
        />
      )}

      {/* ═══════════════════ SHARED RESULT VIEW (mobile + desktop) ═══════════════════ */}
      <div className={showResult ? "block" : "hidden"}>

      {/* ═══ DARK HERO ═══════════════════════════════════════════════════ */}
      {!showResult && (
        <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 bg-[#001A66] md:bg-[#08090C]">
          <div style={{ padding: "18px 22px 0" }}>
            {/* AI badge */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 20,
              background: "rgba(103,65,217,0.25)",
              border: "1px solid rgba(103,65,217,0.35)",
              marginBottom: 10,
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={T.plBdr} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 1L6.5 4H9L7 6L7.8 9L5 7.5L2.2 9L3 6L1 4H3.5Z" />
              </svg>
              <span style={{ fontSize: 9, fontWeight: 500, color: T.plBdr, letterSpacing: "0.05em", textTransform: "uppercase" }}>AI powered</span>
            </div>

            <h1 style={{ fontSize: 22, fontWeight: 500, color: "#fff", letterSpacing: "-0.4px", lineHeight: 1.1, marginBottom: 5 }}>
              AI Lesson<br />Planner
            </h1>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.02em" }}>
              Generate classroom-ready lesson plans in seconds
            </p>

            {/* Powered chip */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              marginTop: 12, padding: "5px 10px", borderRadius: 20,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.06)",
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="1" width="8" height="8" rx="1.5" /><line x1="3.5" y1="4" x2="6.5" y2="4" /><line x1="3.5" y1="6" x2="5.5" y2="6" />
              </svg>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>
                {teacherData?.schoolName || "Edullent"} engine
              </span>
            </div>
          </div>

          {/* Action tabs */}
          <div style={{ display: "flex", gap: 7, padding: "18px 22px 20px" }}>
            <button type="button"
              onClick={() => setActiveTab("generate")}
              style={{
                flex: 1, padding: "10px 8px", borderRadius: 12,
                fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer",
                fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                background: activeTab === "generate" ? T.pur : "rgba(255,255,255,0.09)",
                color: activeTab === "generate" ? "#fff" : "rgba(255,255,255,0.7)",
                ...(activeTab !== "generate" ? { border: "1px solid rgba(255,255,255,0.12)" } : {}),
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 1L7.5 4H10L8 6L8.8 9L6 7.5L3.2 9L4 6L2 4H4.5Z" />
              </svg>
              Generate plan
            </button>
            <button type="button"
              onClick={() => setActiveTab("history")}
              style={{
                flex: 1, padding: "10px 8px", borderRadius: 12,
                fontSize: 11, fontWeight: 500, cursor: "pointer",
                fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                background: activeTab === "history" ? T.pur : "rgba(255,255,255,0.09)",
                color: activeTab === "history" ? "#fff" : "rgba(255,255,255,0.7)",
                border: activeTab === "history" ? "none" : "1px solid rgba(255,255,255,0.12)",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="4.5" /><polyline points="6,3.5 6,6 8.5,6" />
              </svg>
              History ({history.length})
            </button>
          </div>
        </div>
      )}

      {/* ═══ BODY ════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: showResult ? 0 : 14 }}>

        {/* ── GENERATE TAB: FORM ─────────────────────────────────────── */}
        {activeTab === "generate" && !plan && !loading && (
          <>
            <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: "hidden" }}>
              {/* Form header */}
              <div style={{ padding: "13px 14px", borderBottom: `1px solid ${T.s2}`, display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: T.plBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={T.pur} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2,10 L11,10 L9,7 L11,4 L2,4 L4,7 Z" />
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1, margin: 0 }}>Plan details</p>
                  <p style={{ fontSize: 10, color: T.ink3, marginTop: 1 }}>Fill in to generate your lesson plan</p>
                </div>
              </div>

              {/* Subject */}
              <div style={{ padding: "13px 14px", borderBottom: `1px solid ${T.s2}` }}>
                <div style={labelStyle}>Subject <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.red }} /></div>
                <input style={inputStyle} value={form.subject} onChange={e => upd("subject", e.target.value)} placeholder="e.g. English" />
              </div>

              {/* Topic — now optional. AI picks an appropriate one when blank. */}
              <div style={{ padding: "13px 14px", borderBottom: `1px solid ${T.s2}` }}>
                <div style={labelStyle}>Topic / chapter <span style={{ fontSize: 9, color: T.ink3, opacity: 0.6, fontStyle: "italic", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
                <input style={inputStyle} value={form.topic} onChange={e => upd("topic", e.target.value)} placeholder="Leave blank to let AI pick" />
              </div>

              {/* Grade + Board */}
              <div style={{ padding: "13px 14px", borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={labelStyle}>Grade</div>
                    <div style={{ position: "relative" }}>
                      <select style={selectStyle} value={form.grade} onChange={e => upd("grade", e.target.value)}>
                        {GRADES.map(g => <option key={g}>{g}</option>)}
                      </select>
                      {chevDown}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Board</div>
                    <div style={{ position: "relative" }}>
                      <select style={selectStyle} value={form.board} onChange={e => upd("board", e.target.value)}>
                        {BOARDS.map(b => <option key={b}>{b}</option>)}
                      </select>
                      {chevDown}
                    </div>
                  </div>
                </div>
              </div>

              {/* Duration + Lessons */}
              <div style={{ padding: "13px 14px", borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={labelStyle}>Duration</div>
                    <div style={{ position: "relative" }}>
                      <select style={selectStyle} value={form.duration_per_lesson} onChange={e => upd("duration_per_lesson", e.target.value)}>
                        {DURATIONS.map(d => <option key={d}>{d}</option>)}
                      </select>
                      {chevDown}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>No. of lessons</div>
                    <div style={{ position: "relative" }}>
                      <select style={selectStyle} value={form.num_lessons} onChange={e => upd("num_lessons", Number(e.target.value))}>
                        {LESSON_COUNTS.map(n => <option key={n}>{n}</option>)}
                      </select>
                      {chevDown}
                    </div>
                  </div>
                </div>
              </div>

              {/* Learning goals */}
              <div style={{ padding: "13px 14px", borderBottom: `1px solid ${T.s2}` }}>
                <div style={labelStyle}>Learning goals <span style={{ fontSize: 9, color: T.ink3, opacity: 0.6, fontStyle: "italic", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
                <textarea
                  style={{ ...inputStyle, fontSize: 12, resize: "none", minHeight: 64, lineHeight: 1.5 }}
                  value={form.learning_goals} onChange={e => upd("learning_goals", e.target.value)}
                  placeholder="What should students know or be able to do after this lesson?"
                />
              </div>

              {/* Special considerations */}
              <div style={{ padding: "13px 14px" }}>
                <div style={labelStyle}>Special considerations <span style={{ fontSize: 9, color: T.ink3, opacity: 0.6, fontStyle: "italic", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
                <textarea
                  style={{ ...inputStyle, fontSize: 12, resize: "none", minHeight: 64, lineHeight: 1.5 }}
                  value={form.special_considerations} onChange={e => upd("special_considerations", e.target.value)}
                  placeholder="e.g. Mixed ability class, no projector available..."
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", background: T.rlBg, border: `1px solid ${T.rlBdr}`, borderRadius: 13 }}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7" cy="7" r="5.5" /><line x1="7" y1="4.5" x2="7" y2="7.5" /><circle cx="7" cy="9.5" r=".7" fill={T.red} stroke="none" />
                </svg>
                <p style={{ fontSize: 11, fontWeight: 500, color: T.red, margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Generate + Reset buttons */}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button"
                onClick={() => handleGenerate()}
                disabled={loading}
                style={{
                  flex: 1, padding: 13, borderRadius: 13,
                  background: T.pur, border: "none", color: "#fff",
                  fontSize: 13, fontWeight: 500, cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  opacity: loading ? 0.7 : 1,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 1L8.5 5H12L9.5 7.5L10.5 11.5L7 9.5L3.5 11.5L4.5 7.5L2 5H5.5Z" />
                </svg>
                Generate plan
              </button>
              <button type="button"
                onClick={handleReset}
                style={{
                  width: 44, height: 44, borderRadius: 13,
                  border: `1px solid ${T.bdr}`, background: T.white,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12,7 A5,5 0 1,1 9.5,3" /><polyline points="9.5,1 9.5,3 11.5,3" />
                </svg>
              </button>
            </div>
          </>
        )}

        {/* ── GENERATE TAB: LOADING — P1-3 skeleton matches result shape ── */}
        {activeTab === "generate" && loading && (
          <>
            <style>{`@keyframes lpPulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }`}</style>
            {/* Hero skeleton (matches Blue Apple gradient hero in result view) */}
            <div style={{
              background: HERO_GRAD,
              borderRadius: 18, padding: "20px 18px",
              boxShadow: "0 1px 2px rgba(0,8,60,.15), 0 12px 32px rgba(0,8,60,.28)",
              marginBottom: 12,
            }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {[60, 80, 70, 50].map((w, i) => (
                  <div key={i} style={{ width: w, height: 18, borderRadius: 20, background: "rgba(255,255,255,.12)", animation: "lpPulse 1.5s ease-in-out infinite" }} />
                ))}
              </div>
              <div style={{ height: 22, borderRadius: 5, background: "rgba(255,255,255,.18)", width: "70%", marginBottom: 8, animation: "lpPulse 1.5s ease-in-out infinite" }} />
              <div style={{ height: 11, borderRadius: 4, background: "rgba(255,255,255,.10)", width: "90%", marginBottom: 4, animation: "lpPulse 1.5s ease-in-out infinite" }} />
              <div style={{ height: 11, borderRadius: 4, background: "rgba(255,255,255,.10)", width: "60%", animation: "lpPulse 1.5s ease-in-out infinite" }} />
            </div>
            {/* Lesson card skeletons */}
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} style={{
                background: T.white, borderRadius: 16, padding: 16,
                boxShadow: T.SH, marginBottom: 10,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 9, background: T.s2, animation: "lpPulse 1.5s ease-in-out infinite" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 13, borderRadius: 4, background: T.s2, width: "65%", marginBottom: 5, animation: "lpPulse 1.5s ease-in-out infinite" }} />
                    <div style={{ height: 10, borderRadius: 4, background: T.s1, width: "40%", animation: "lpPulse 1.5s ease-in-out infinite" }} />
                  </div>
                </div>
                <div style={{ height: 60, borderRadius: 10, background: T.s1, animation: "lpPulse 1.5s ease-in-out infinite" }} />
              </div>
            ))}
            <div style={{ textAlign: "center", padding: "8px 0", fontSize: 11, color: T.ink3, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              <Loader2 className="animate-spin" style={{ width: 12, height: 12, color: T.pur, display: "inline", verticalAlign: "middle", marginRight: 6 }} />
              AI is crafting your lesson plan · 10-20 seconds
            </div>
          </>
        )}

        {/* ── GENERATE TAB: RESULT ───────────────────────────────────── */}
        {showResult && (
          <>
            {/* P0-2: cached-result badge with one-tap "Regenerate fresh" */}
            {cachedAt != null && (
              <div className="exam-no-print" style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10, padding: "10px 12px", borderRadius: 12,
                background: "rgba(123,63,244,0.07)",
                border: "0.5px solid rgba(123,63,244,0.20)",
                marginBottom: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, color: T.pur, letterSpacing: "0.4px", textTransform: "uppercase" }}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 1L7.5 4H10L8 6L8.8 9L6 7.5L3.2 9L4 6L2 4H4.5Z" />
                  </svg>
                  Cached · {formatAge(cachedAt)} · No new AI billed
                </div>
                <button type="button"
                  onClick={() => handleGenerate(true)}
                  disabled={loading}
                  style={{
                    fontSize: 11, fontWeight: 700, color: T.pur,
                    background: "none", border: "none", padding: 0,
                    cursor: loading ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}>
                  Regenerate fresh
                </button>
              </div>
            )}

            {/* Blue Apple hero — was purple gradient (#2D46C8 → #5834C6) */}
            <div
              data-lp-hero=""
              className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8"
              style={{
                background: HERO_GRAD,
                padding: "20px 18px",
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 1px 2px rgba(0,8,60,.15), 0 12px 32px rgba(0,8,60,.28)",
              }}
            >
              {/* Glass highlight overlay */}
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)", pointerEvents: "none" }} />
              <div style={{ position: "relative", zIndex: 2 }}>
              {/* Back button — returns to form view, plan stays in memory.
               * Hidden in print so the hardcopy doesn't carry a meaningless
               * navigation control. */}
              <button type="button"
                onClick={() => setForceShowForm(true)}
                aria-label="Back to form"
                className="exam-no-print"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "rgba(255,255,255,0.10)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                  border: "0.5px solid rgba(255,255,255,0.18)",
                  borderRadius: 10, padding: "6px 12px",
                  color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", letterSpacing: "-0.1px",
                  fontFamily: "inherit", marginBottom: 12,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back to form
              </button>
              {/* Chips */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {[plan.board, plan.grade, plan.total_duration, plan.subject].filter(Boolean).map((c: string, i: number) => (
                  <span key={i} style={{
                    padding: "4px 9px", borderRadius: 20,
                    background: "rgba(255,255,255,0.15)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.85)",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    {c}
                  </span>
                ))}
              </div>

              <h2 style={{ fontSize: 19, fontWeight: 500, color: "#fff", letterSpacing: "-0.3px", lineHeight: 1.2, marginBottom: 8 }}>
                {plan.plan_title}
              </h2>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.55, marginBottom: 14 }}>
                {plan.overview}
              </p>

              {/* Footer */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="1.5" width="10" height="9.5" rx="1.5" /><line x1="3.5" y1="5" x2="8.5" y2="5" /><line x1="3.5" y1="7" x2="6.5" y2="7" />
                  </svg>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>{plan.subject}</span>
                </div>
                <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.2)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="4.5" /><line x1="4" y1="4" x2="4" y2="8" /><line x1="8" y1="4" x2="8" y2="8" />
                  </svg>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>{plan.lessons?.length} lesson(s)</span>
                </div>

                {/* Save badge */}
                <div style={{ marginLeft: "auto" }}>
                  {saved ? (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "5px 10px", borderRadius: 20,
                      background: "rgba(0,200,83,0.25)",
                      border: "1px solid rgba(0,200,83,0.45)",
                    }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#6FFFAA" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1.5,5.5 3.5,8 8.5,2" />
                      </svg>
                      <span style={{ fontSize: 10, color: "#6FFFAA", fontWeight: 500 }}>Saved</span>
                    </div>
                  ) : (
                    <button type="button"
                      onClick={handleSave}
                      disabled={saving}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "5px 10px", borderRadius: 20,
                        background: "rgba(255,255,255,0.12)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: "#fff", fontSize: 10, fontWeight: 500,
                        cursor: "pointer", fontFamily: "inherit",
                        opacity: saving ? 0.6 : 1,
                      }}
                    >
                      {saving ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8.5 9H1.5V1H7L8.5 2.5V9Z" /><rect x="3" y="5.5" width="4" height="3.5" />
                        </svg>
                      )}
                      {saving ? "Saving..." : "Save Plan"}
                    </button>
                  )}
                </div>
              </div>
              </div>{/* end relative-z2 wrapper */}
            </div>

            {/* Learning objectives */}
            {plan.learning_objectives?.length > 0 && (
              <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: "hidden" }}>
                <div style={{ padding: "11px 13px", borderBottom: `1px solid ${T.s2}`, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, background: T.blBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="6" r="4.5" /><circle cx="6" cy="6" r="2" />
                    </svg>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: "0.06em", textTransform: "uppercase" }}>Learning objectives</span>
                </div>
                <div style={{ padding: "0 13px" }}>
                  {plan.learning_objectives.map((obj: string, i: number) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0", borderBottom: i < plan.learning_objectives.length - 1 ? `1px solid ${T.s2}` : "none" }}>
                      <div style={{ width: 18, height: 18, borderRadius: 6, background: T.glBg, border: `1px solid ${T.glBdr}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke={T.grn} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1.5,4.5 3.5,7 7.5,2" />
                        </svg>
                      </div>
                      <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{obj}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Materials */}
            {plan.materials_needed?.length > 0 && (
              <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: "hidden" }}>
                <div style={{ padding: "11px 13px", borderBottom: `1px solid ${T.s2}`, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, background: T.alBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.amb} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1.5" y="1" width="9" height="10" rx="1.5" /><line x1="3.5" y1="4.5" x2="8.5" y2="4.5" /><line x1="3.5" y1="7" x2="7" y2="7" />
                    </svg>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: "0.06em", textTransform: "uppercase" }}>Materials needed</span>
                </div>
                <div style={{ padding: "12px 13px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {plan.materials_needed.map((m: string, i: number) => (
                      <span key={i} style={{ padding: "5px 10px", borderRadius: 20, background: T.alBg, border: `1px solid ${T.alBdr}`, fontSize: 10, fontWeight: 500, color: T.amb }}>
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
                {plan.prior_knowledge && (
                  <>
                    <p style={{ fontSize: 10, fontWeight: 500, color: T.ink3, letterSpacing: "0.06em", textTransform: "uppercase", margin: "10px 13px 5px" }}>Prior knowledge required</p>
                    <p style={{ fontSize: 11, color: T.ink2, lineHeight: 1.5, padding: "0 13px 12px", margin: 0 }}>{plan.prior_knowledge}</p>
                  </>
                )}
              </div>
            )}

            {/* Lesson breakdown */}
            <p style={{ fontSize: 10, fontWeight: 500, color: T.ink3, letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 2px" }}>Lesson breakdown</p>

            {plan.lessons?.map((lesson, li) => (
              <div key={li} data-lp-lesson="" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Lesson number header — P2-6 a11y: keyboard-accessible toggle */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedLesson === li}
                  aria-label={`${expandedLesson === li ? "Collapse" : "Expand"} ${lesson.title || `lesson ${li + 1}`}`}
                  onClick={() => setExpandedLesson(expandedLesson === li ? -1 : li)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedLesson(expandedLesson === li ? -1 : li);
                    }
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "11px 13px",
                    background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 13,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 9, background: T.ink1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, color: "#fff", flexShrink: 0 }}>
                    {lesson.lesson_number || li + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1, margin: 0 }}>{lesson.title}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: T.ink3, marginTop: 2 }}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="6" cy="6" r="4.5" /><polyline points="6,3.5 6,6 8.5,6" />
                      </svg>
                      {lesson.duration}{lesson.learning_focus ? ` · ${lesson.learning_focus}` : ""}
                    </div>
                  </div>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: expandedLesson === li ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}
                  >
                    <polyline points="5,3 9,6.5 5,10" />
                  </svg>
                </div>

                {/* Phase cards */}
                {expandedLesson === li && lesson.sections?.map((section, si) => {
                  const ps = getPhaseStyle(section.name);
                  return (
                    <div key={si} style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${ps.bdr}`, background: ps.bg }}>
                      {/* Phase header */}
                      <div style={{ padding: "10px 13px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 10, fontWeight: 500, color: ps.color, letterSpacing: "0.06em", textTransform: "uppercase" }}>{section.name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 500, color: ps.color }}>
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={ps.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="6" cy="6" r="4.5" /><polyline points="6,3.5 6,6 8.5,6" />
                          </svg>
                          {section.duration}
                        </div>
                      </div>

                      {/* Phase body */}
                      <div style={{ padding: "0 13px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
                        {section.teacher_activity && (
                          <>
                            <span style={{ fontSize: 9, fontWeight: 500, color: ps.color, letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.65 }}>Teacher activity</span>
                            <p style={{ fontSize: 11, color: T.ink2, lineHeight: 1.55, margin: 0 }}>{section.teacher_activity}</p>
                          </>
                        )}
                        {section.student_activity && (
                          <>
                            <span style={{ fontSize: 9, fontWeight: 500, color: ps.color, letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.65 }}>Student activity</span>
                            <p style={{ fontSize: 11, color: T.ink2, lineHeight: 1.55, margin: 0 }}>{section.student_activity}</p>
                          </>
                        )}
                        {section.key_questions?.length > 0 && (
                          <>
                            <span style={{ fontSize: 9, fontWeight: 500, color: ps.color, letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.65 }}>Key questions</span>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {section.key_questions.map((q: string, qi: number) => (
                                <p key={qi} style={{ fontSize: 11, color: T.ink2, lineHeight: 1.4, margin: 0, display: "flex", alignItems: "flex-start", gap: 5 }}>
                                  <span style={{ flexShrink: 0, fontSize: 13, lineHeight: 1.2 }}>›</span>{q}
                                </p>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* P2-3: drift banner — AI returned different number of lessons */}
            {drift && (
              <div className="exam-no-print" style={{
                background: "rgba(255,170,0,.10)", border: "0.5px solid rgba(255,170,0,.32)",
                borderRadius: 12, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C87014" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16.01"/>
                </svg>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#C87014", letterSpacing: "0.6px", textTransform: "uppercase" }}>
                    Heads up — plan does not match your request
                  </div>
                  <div style={{ fontSize: 12, color: "#7A4310", marginTop: 2, lineHeight: 1.4 }}>
                    AI generated {drift.got} lesson{drift.got === 1 ? "" : "s"} instead of {drift.asked}.
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons — Save / Copy / Print / Regenerate */}
            <div className="exam-no-print" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button type="button"
                onClick={handleSave}
                disabled={saving || saved}
                style={{
                  padding: 11, borderRadius: 12,
                  background: T.pur, border: "none", color: "#fff",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  opacity: saved ? 0.6 : 1,
                  letterSpacing: "-0.1px",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8.5 9H1.5V1H7L8.5 2.5V9Z" /><rect x="3" y="5.5" width="4" height="3.5" />
                </svg>
                {saved ? "Saved" : saving ? "Saving..." : "Save Plan"}
              </button>
              <button type="button"
                onClick={handleReset}
                style={{
                  padding: 11, borderRadius: 12,
                  background: T.white, border: `0.5px solid ${T.bdr}`,
                  color: T.ink2, fontSize: 12, cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 600,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  letterSpacing: "-0.1px",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10,6 A4,4 0 1,1 8,3" /><polyline points="8,1 8,3 10,3" />
                </svg>
                Regenerate
              </button>
              <button type="button"
                onClick={handleCopyPlan}
                style={{
                  padding: 11, borderRadius: 12,
                  background: T.s1, border: `0.5px solid ${T.bdr}`,
                  color: T.ink2, fontSize: 12, cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 600,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  letterSpacing: "-0.1px",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3.5" y="3.5" width="6.5" height="7" rx="1" /><path d="M7 3.5V2.5a1 1 0 00-1-1H3a1 1 0 00-1 1V8a1 1 0 001 1h0.5"/>
                </svg>
                Copy
              </button>
              <button type="button"
                onClick={handlePrintPlan}
                style={{
                  padding: 11, borderRadius: 12,
                  background: T.s1, border: `0.5px solid ${T.bdr}`,
                  color: T.ink2, fontSize: 12, cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 600,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  letterSpacing: "-0.1px",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 4 3 1.5 9 1.5 9 4"/><rect x="2" y="4" width="8" height="5" rx="1"/><polyline points="3.5 8 3.5 10.5 8.5 10.5 8.5 8"/>
                </svg>
                Print / PDF
              </button>
            </div>
          </>
        )}

        {/* ── HISTORY TAB ────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <>
            {history.length === 0 ? (
              <div style={{
                background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18,
                padding: "50px 20px",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              }}>
                <div style={{ width: 52, height: 52, borderRadius: 16, background: T.plBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 14 14" fill="none" stroke={T.pur} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="1.5" width="10" height="11" rx="1.5" /><line x1="4.5" y1="5" x2="9.5" y2="5" /><line x1="4.5" y1="7.5" x2="8" y2="7.5" />
                  </svg>
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1 }}>No saved plans yet</p>
                <p style={{ fontSize: 11, color: T.ink3, textAlign: "center" }}>Generate and save your first plan to see it here.</p>
              </div>
            ) : (
              history.map(h => (
                <div
                  key={h.id}
                  onClick={() => loadFromHistory(h)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "13px", background: T.white,
                    border: `1px solid ${T.bdr}`, borderRadius: 16,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: T.plBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke={T.pur} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="1.5" width="10" height="11" rx="1.5" /><line x1="4.5" y1="5" x2="9.5" y2="5" /><line x1="4.5" y1="7.5" x2="8" y2="7.5" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1, margin: 0 }}>{h.plan?.plan_title || h.topic}</p>
                    <p style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>
                      {h.subject} · {h.grade} · {h.board} · {h.plan?.lessons?.length || 1} lesson(s)
                    </p>
                    <p style={{ fontSize: 10, color: T.ink3, opacity: 0.6, marginTop: 2 }}>
                      {h.createdAt?.toDate?.().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  {/* P1-7 delete button — stopPropagation prevents the parent's
                      onClick (loadFromHistory) from also firing on this tap. */}
                  <button type="button"
                    aria-label="Delete plan"
                    onClick={(e) => { e.stopPropagation(); handleDeleteHistory(h); }}
                    style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: T.rlBg, border: "none",
                      color: T.red, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="2,3 10,3"/><path d="M3.5,3 L4,10 A1,1 0 0,0 5,11 H7 A1,1 0 0,0 8,10 L8.5,3"/><line x1="5" y1="5" x2="5" y2="9"/><line x1="7" y1="5" x2="7" y2="9"/>
                    </svg>
                  </button>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="5,3 9,6.5 5,10" />
                  </svg>
                </div>
              ))
            )}
          </>
        )}
      </div>

      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

      {/* P1-2 Print stylesheet — strips UI chrome so the lesson plan prints
       * (or saves as PDF) clean. .exam-no-print marks anything that should
       * NOT appear on print (cache badge, action buttons, drift banner).
       * Hero gradient is flattened to plain B&W so cheap printers don't
       * solidify into illegible ink-heavy blocks. */}
      <style>{`
        @media print {
          html, body { background: #fff !important; }
          aside, nav, header, .no-print, .exam-no-print { display: none !important; }
          /* Flatten hero gradient + AI Tip card on print */
          [data-lp-hero] { background: #fff !important; color: #000 !important; }
          [data-lp-hero] * { color: #000 !important; }
          /* Page-break hints so a multi-lesson plan splits cleanly */
          [data-lp-lesson] { page-break-inside: avoid; }
        }
      `}</style>

    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Mobile-only view (new mockup design)
// ─────────────────────────────────────────────────────────────────────────────
interface MobileLessonPlannerProps {
  form: FormData;
  upd: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  loading: boolean;
  error: string | null;
  history: HistoryItem[];
  activeTab: "generate" | "history";
  setActiveTab: (t: "generate" | "history") => void;
  onGenerate: () => void;
  onLoadHistory: (h: HistoryItem) => void;
  onDeleteHistory: (h: HistoryItem) => void;
  onReset: () => void;
  assignedSubjects: string[];
}

const subjectEmoji = (name: string): string => {
  const n = (name || "").toLowerCase();
  if (n.includes("math")) return "🔢";
  if (n.includes("english") || n.includes("hindi") || n.includes("urdu") || n.includes("arabic") || n.includes("language") || n.includes("literature")) return "📝";
  if (n.includes("phys") || n.includes("chem") || n.includes("bio") || n.includes("science")) return "🔬";
  if (n.includes("social") || n.includes("history") || n.includes("geog") || n.includes("civic") || n.includes("econ")) return "🌍";
  if (n.includes("computer") || n.includes("ict") || n.includes("code") || n.includes("tech")) return "💻";
  if (n.includes("art") || n.includes("draw") || n.includes("paint")) return "🎨";
  if (n.includes("music")) return "🎵";
  if (n.includes("sport") || n.includes("physical edu") || /\bpe\b/.test(n)) return "⚽";
  if (n.includes("moral") || n.includes("value")) return "🧭";
  return "📘";
};
const CLASS_OPTIONS = ["6", "7", "8", "9", "10", "11", "12"];
const BOARD_OPTIONS = ["CBSE", "ICSE", "State Board"];
const PLAN_INCLUSIONS = [
  { key: "objectives",  emoji: "🎯", label: "Learning objectives" },
  { key: "activities",  emoji: "📋", label: "Activities" },
  { key: "quiz",        emoji: "❓", label: "Quiz questions" },
  { key: "homework",    emoji: "📚", label: "Homework" },
  { key: "visual",      emoji: "🎨", label: "Visual aids" },
  { key: "rubric",      emoji: "📊", label: "Rubric" },
];

const parseClassLabel = (grade: string): string => {
  const m = /\d+/.exec(grade || "");
  return m ? m[0] : "8";
};
const classToGrade = (cls: string): string => `Class ${cls}`;
const parseDurationMin = (d: string): number => {
  const m = /\d+/.exec(d || "");
  return m ? Number(m[0]) : 45;
};
const minToDuration = (n: number): string => `${n} minutes`;

const MobileLessonPlanner = ({
  form, upd, loading, error, history,
  activeTab, setActiveTab, onGenerate, onLoadHistory, onDeleteHistory, onReset,
  assignedSubjects,
}: MobileLessonPlannerProps) => {
  const [inclusions, setInclusions] = useState<Set<string>>(new Set(["objectives", "activities", "quiz"]));
  const selectedClass = parseClassLabel(form.grade);
  const durationMin = parseDurationMin(form.duration_per_lesson);

  // Board filtering — mockup shows 3 chips, our backend supports 6. Show 3 main chips + fallback to form.board if it's something else.
  const boardActive = (b: string) => {
    if (form.board === b) return true;
    if (b === "State Board" && /state/i.test(form.board)) return true;
    return false;
  };

  const canGenerate = !!form.subject.trim() && !loading;

  const fmtDate = (ts: any): string => {
    const d: Date | null = ts?.toDate?.() || (ts instanceof Date ? ts : null);
    if (!d) return "";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <div
      className="md:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px]"
      style={{
        background: "#EEF4FF",
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
        paddingBottom: activeTab === "generate" ? 90 : 28,
      }}
    >
      <style>{`
        .lp-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .lp-card3d:hover { transform: translateY(-4px) rotateX(4deg) rotateY(-3deg) scale(1.012); box-shadow: 0 1px 2px rgba(0,85,255,.08), 0 24px 44px rgba(0,85,255,.18), 0 8px 16px rgba(0,85,255,.1); } }
        .lp-card3d:active { transform: translateY(-1px) scale(.985); box-shadow: 0 1px 2px rgba(0,85,255,.1), 0 6px 16px rgba(0,85,255,.14); }
        .lp-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .lp-press:active { transform: scale(.94); }
        @keyframes lpFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes lpPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(1.25); } }
        @keyframes lpTwinkle { 0%,100% { opacity: .85; } 50% { opacity: .25; } }
        .lp-pulse { animation: lpPulse 1.6s ease-in-out infinite; }
        .lp-enter > * { animation: lpFadeUp .45s cubic-bezier(.34,1.56,.64,1) both; }
        .lp-enter > *:nth-child(1) { animation-delay: .04s; }
        .lp-enter > *:nth-child(2) { animation-delay: .10s; }
        .lp-enter > *:nth-child(3) { animation-delay: .16s; }
        .lp-enter > *:nth-child(4) { animation-delay: .22s; }
        .lp-enter > *:nth-child(5) { animation-delay: .28s; }
        .lp-enter > *:nth-child(6) { animation-delay: .34s; }
        .lp-enter > *:nth-child(7) { animation-delay: .40s; }
        .lp-enter > *:nth-child(8) { animation-delay: .46s; }
        .lp-scroll::-webkit-scrollbar { display: none; }
        .lp-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="lp-enter" style={{ display: "flex", flexDirection: "column" }}>

        {/* Page header with AI pill */}
        <div style={{ padding: "8px 2px 14px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 9, fontWeight: 700, color: "#fff",
            letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 12,
            background: "linear-gradient(135deg, #001A66 0%, #0055FF 50%, #1166FF 100%)",
            padding: "6px 12px 6px 8px", borderRadius: 100,
            boxShadow: "0 1px 2px rgba(0,85,255,.25), 0 4px 12px rgba(0,85,255,.3), inset 0 0.5px 0 rgba(255,255,255,.2)",
          }}>
            <span style={{
              width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center",
              color: "#FFDD55", fontSize: 11, lineHeight: 1,
              filter: "drop-shadow(0 0 3px rgba(255,221,85,.6))",
            }}>✦</span>
            AI Powered
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>
            AI Lesson{" "}
            <span style={{
              background: "linear-gradient(135deg, #0055FF 0%, #1166FF 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>Planner</span>
          </h1>
          <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, marginTop: 6, letterSpacing: "-0.15px" }}>
            Generate classroom-ready lesson plans in seconds.
          </div>
        </div>

        {/* AI Hero */}
        <div
          className="lp-card3d"
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            borderRadius: 26, padding: 22, marginBottom: 14,
            position: "relative", overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,26,102,.2), 0 12px 32px rgba(0,26,102,.32)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.12) 0%, transparent 45%)", pointerEvents: "none" }} />
          <div style={{
            position: "absolute", top: 20, right: 28,
            width: 4, height: 4, background: "#FFDD55", borderRadius: "50%",
            boxShadow: "-34px 22px 0 -1px rgba(255,255,255,.7), 18px 34px 0 -1px rgba(255,221,85,.85), -54px 48px 0 -2px rgba(255,255,255,.55), -16px 58px 0 -1px rgba(255,221,85,.9), -76px 14px 0 -2px rgba(255,255,255,.4)",
            pointerEvents: "none",
            animation: "lpTwinkle 3s ease-in-out infinite",
          }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <div style={{ width: 46, height: 46, borderRadius: 14, background: "rgba(255,255,255,.16)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.28)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFDD55" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.85)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Powered by Edullent engine</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 2, fontWeight: 500, letterSpacing: "-0.1px" }}>Curriculum-aligned · Real-time</div>
              </div>
              <div style={{
                marginLeft: "auto",
                background: "rgba(255,255,255,.18)",
                border: "0.5px solid rgba(255,255,255,.32)",
                color: "#fff",
                padding: "5px 12px", borderRadius: 100,
                fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.3px",
              }}>
                <span className="lp-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#FFDD55", boxShadow: "0 0 8px #FFDD55" }} />
                Live
              </div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: "-1.2px", lineHeight: 1.1, marginBottom: 8 }}>
              Craft lessons in seconds ✨
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.82)", marginBottom: 20, fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5 }}>
              Just pick a subject, class, and topic — <b style={{ color: "#fff", fontWeight: 700 }}>the AI handles the rest</b>.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden" }}>
              <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>{history.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Generated</div>
              </div>
              <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#FFDD55", letterSpacing: "-0.5px" }}>~8s</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Avg Time</div>
              </div>
              <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#6FFFAA", letterSpacing: "-0.5px" }}>100%</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Saved</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex", gap: 5, background: "#fff", padding: 5,
            borderRadius: 14, marginBottom: 14,
            boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 2px 10px rgba(0,85,255,.08)",
            border: "0.5px solid rgba(0,85,255,.07)",
          }}
        >
          {[
            { key: "generate", label: "Generate",
              icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg> },
            { key: "history", label: "History", badge: history.length,
              icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
          ].map(tab => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as "generate" | "history")}
                className="lp-press"
                style={{
                  flex: 1, padding: "11px 10px", borderRadius: 10,
                  fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                  color: active ? "#fff" : "#5070B0",
                  background: active ? "linear-gradient(135deg, #0055FF, #1166FF)" : "transparent",
                  boxShadow: active ? "0 1px 2px rgba(0,85,255,.22), 0 3px 10px rgba(0,85,255,.3)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                }}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && (
                  <span style={{
                    background: active ? "rgba(255,255,255,.22)" : "#F4F7FE",
                    color: active ? "#fff" : "#5070B0",
                    fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 100,
                  }}>{tab.badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {activeTab === "generate" ? (
          <>
            {/* AI Tip */}
            <div style={{
              background: "linear-gradient(135deg, rgba(0,85,255,.08), rgba(17,102,255,.04))",
              border: "0.5px solid rgba(0,85,255,.2)",
              borderRadius: 14, padding: "12px 14px",
              display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14,
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: 10,
                background: "linear-gradient(135deg, #0055FF, #1166FF)",
                color: "#FFDD55",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, fontSize: 14,
                boxShadow: "0 1px 2px rgba(0,85,255,.2), 0 3px 8px rgba(0,85,255,.25)",
              }}>⚡</div>
              <div style={{ flex: 1, fontSize: 11, color: "#002080", lineHeight: 1.5, fontWeight: 500, letterSpacing: "-0.1px" }}>
                <b style={{ color: "#0055FF", fontWeight: 700 }}>Pro tip:</b> The more specific your topic, the better the lesson plan. Try "Noun types with examples" instead of just "Nouns".
              </div>
            </div>

            {/* Subject */}
            <div className="lp-card3d" style={{
              background: "#fff", borderRadius: 20, padding: 16, marginBottom: 12,
              boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
              border: "0.5px solid rgba(0,85,255,.07)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                  Subject
                  <span style={{ color: "#FF3355", fontSize: 11, fontWeight: 700 }}>*</span>
                </div>
              </div>
              {assignedSubjects.length === 0 ? (
                <div style={{
                  padding: "12px 14px", borderRadius: 14, background: "#F4F7FE",
                  border: "0.5px dashed rgba(0,85,255,.22)", color: "#5070B0",
                  fontSize: 11, fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5,
                }}>
                  No subjects assigned yet. Please ask your principal or admin to assign a subject to your account.
                </div>
              ) : (
                <div className="lp-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", margin: "0 -4px", padding: "2px 4px 4px" }}>
                  {assignedSubjects.map(sub => {
                    const active = (form.subject || "").trim().toLowerCase() === sub.toLowerCase();
                    return (
                      <button
                        key={sub}
                        type="button"
                        onClick={() => upd("subject", sub)}
                        className="lp-press"
                        style={{
                          flexShrink: 0, padding: "9px 14px", borderRadius: 100,
                          background: active ? "linear-gradient(135deg, #0055FF, #1166FF)" : "#F4F7FE",
                          color: active ? "#fff" : "#002080",
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                          display: "flex", alignItems: "center", gap: 6,
                          border: active ? "0.5px solid #0055FF" : "0.5px solid rgba(0,85,255,.07)",
                          cursor: "pointer", fontFamily: "inherit",
                          boxShadow: active ? "0 1px 2px rgba(0,85,255,.22), 0 3px 10px rgba(0,85,255,.28)" : "none",
                          transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                        }}
                      >
                        <span style={{ fontSize: 13, lineHeight: 1 }}>{subjectEmoji(sub)}</span>
                        {sub}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Class + Board */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div className="lp-card3d" style={{
                background: "#fff", borderRadius: 20, padding: 16,
                boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  Class
                  <span style={{ color: "#FF3355", fontSize: 11, fontWeight: 700 }}>*</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {CLASS_OPTIONS.map(c => {
                    const active = selectedClass === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => upd("grade", classToGrade(c))}
                        className="lp-press"
                        style={{
                          padding: "8px 4px", borderRadius: 9,
                          background: active ? "linear-gradient(135deg, #0055FF, #1166FF)" : "#F4F7FE",
                          color: active ? "#fff" : "#5070B0",
                          fontSize: 12, fontWeight: active ? 800 : 700,
                          textAlign: "center", letterSpacing: "-0.2px",
                          border: active ? "0.5px solid #0055FF" : "0.5px solid rgba(0,85,255,.07)",
                          boxShadow: active ? "0 1px 2px rgba(0,85,255,.22), 0 3px 8px rgba(0,85,255,.25)" : "none",
                          cursor: "pointer", fontFamily: "inherit",
                          transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                        }}
                      >{c}</button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      const v = prompt("Enter class number:");
                      const n = v && /^\d+$/.test(v) ? v : null;
                      if (n) upd("grade", classToGrade(n));
                    }}
                    className="lp-press"
                    style={{
                      padding: "8px 4px", borderRadius: 9,
                      background: "#F4F7FE", color: "#5070B0",
                      fontSize: 12, fontWeight: 700,
                      textAlign: "center", letterSpacing: "-0.2px",
                      border: "0.5px solid rgba(0,85,255,.07)",
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >+</button>
                </div>
              </div>

              <div className="lp-card3d" style={{
                background: "#fff", borderRadius: 20, padding: 16,
                boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10 }}>Board</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, background: "#F4F7FE", padding: 3, borderRadius: 11 }}>
                  {BOARD_OPTIONS.map(b => {
                    const active = boardActive(b);
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => upd("board", b)}
                        className="lp-press"
                        style={{
                          padding: "7px 10px", borderRadius: 8,
                          fontSize: 12, fontWeight: active ? 800 : 700,
                          color: active ? "#0055FF" : "#5070B0",
                          background: active ? "#fff" : "transparent",
                          boxShadow: active ? "0 1px 2px rgba(0,0,0,.04), 0 2px 6px rgba(0,85,255,.15)" : "none",
                          textAlign: "center", letterSpacing: "-0.2px",
                          border: "none", cursor: "pointer", fontFamily: "inherit",
                          transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                        }}
                      >{b === "State Board" ? "State" : b}</button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Topic */}
            <div className="lp-card3d" style={{
              background: "#fff", borderRadius: 20, padding: 16, marginBottom: 12,
              boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
              border: "0.5px solid rgba(0,85,255,.07)",
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                Lesson Topic
                <span style={{ color: "#99AACC", fontSize: 10, fontWeight: 600, letterSpacing: 0, textTransform: "none" }}>(optional)</span>
              </div>
              <input
                type="text"
                value={form.topic}
                onChange={e => upd("topic", e.target.value.slice(0, 120))}
                placeholder="Leave blank to let AI pick"
                maxLength={120}
                style={{
                  width: "100%", padding: "12px 14px",
                  background: form.topic ? "#fff" : "#F4F7FE",
                  border: "0.5px solid rgba(0,85,255,.07)",
                  borderRadius: 12,
                  fontSize: 14, fontWeight: form.topic ? 600 : 500, color: "#001040",
                  fontFamily: "inherit", letterSpacing: "-0.2px", outline: "none",
                  transition: "all .2s cubic-bezier(.2,.9,.3,1)",
                }}
                onFocus={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#0055FF"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,85,255,.12)"; }}
                onBlur={e => { e.currentTarget.style.background = form.topic ? "#fff" : "#F4F7FE"; e.currentTarget.style.borderColor = "rgba(0,85,255,.07)"; e.currentTarget.style.boxShadow = "none"; }}
              />
              <div style={{ fontSize: 11, color: "#99AACC", marginTop: 6, fontWeight: 500, letterSpacing: "-0.1px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>{form.topic ? "Specific topic for the AI" : "AI will choose for you"}</span>
                <span style={{ color: "#5070B0", fontWeight: 600 }}>{form.topic.length} / 120</span>
              </div>
            </div>

            {/* Lessons + Duration steppers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div className="lp-card3d" style={{
                background: "#fff", borderRadius: 20, padding: 16,
                boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10 }}>Lessons</div>
                <div style={{ display: "flex", alignItems: "center", background: "#F4F7FE", border: "0.5px solid rgba(0,85,255,.07)", borderRadius: 12, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => upd("num_lessons", Math.max(1, form.num_lessons - 1))}
                    aria-label="Decrease lessons"
                    className="lp-press"
                    style={{ width: 36, height: 44, background: "transparent", border: "none", color: "#0055FF", fontSize: 18, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >−</button>
                  <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px" }}>{form.num_lessons}</div>
                  <button
                    type="button"
                    onClick={() => upd("num_lessons", Math.min(5, form.num_lessons + 1))}
                    aria-label="Increase lessons"
                    className="lp-press"
                    style={{ width: 36, height: 44, background: "transparent", border: "none", color: "#0055FF", fontSize: 18, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >+</button>
                </div>
              </div>

              <div className="lp-card3d" style={{
                background: "#fff", borderRadius: 20, padding: 16,
                boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10 }}>Duration</div>
                <div style={{ display: "flex", alignItems: "center", background: "#F4F7FE", border: "0.5px solid rgba(0,85,255,.07)", borderRadius: 12, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => upd("duration_per_lesson", minToDuration(Math.max(15, durationMin - 15)))}
                    aria-label="Decrease duration"
                    className="lp-press"
                    style={{ width: 36, height: 44, background: "transparent", border: "none", color: "#0055FF", fontSize: 18, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >−</button>
                  <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px" }}>
                    {durationMin}<span style={{ color: "#5070B0", fontSize: 11, fontWeight: 700, marginLeft: 3 }}>min</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => upd("duration_per_lesson", minToDuration(Math.min(120, durationMin + 15)))}
                    aria-label="Increase duration"
                    className="lp-press"
                    style={{ width: 36, height: 44, background: "transparent", border: "none", color: "#0055FF", fontSize: 18, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >+</button>
                </div>
              </div>
            </div>

            {/* Include in Plan */}
            <div className="lp-card3d" style={{
              background: "#fff", borderRadius: 20, padding: 16, marginBottom: 12,
              boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
              border: "0.5px solid rgba(0,85,255,.07)",
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                Include in Plan
                <span style={{ color: "#99AACC", fontWeight: 600, letterSpacing: 0, textTransform: "none", fontSize: 10, marginLeft: 2 }}>(optional)</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {PLAN_INCLUSIONS.map(p => {
                  const active = inclusions.has(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        const next = new Set(inclusions);
                        if (next.has(p.key)) next.delete(p.key); else next.add(p.key);
                        setInclusions(next);
                        // Sync into learning_goals as a comma list of chosen items
                        const chosen = PLAN_INCLUSIONS.filter(x => next.has(x.key)).map(x => x.label);
                        upd("learning_goals", chosen.join(", "));
                      }}
                      className="lp-press"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "7px 12px", borderRadius: 100,
                        background: active ? "rgba(0,85,255,.1)" : "#F4F7FE",
                        color: active ? "#0055FF" : "#002080",
                        fontSize: 11, fontWeight: 700, letterSpacing: "-0.15px",
                        border: active ? "0.5px solid rgba(0,85,255,.25)" : "0.5px solid rgba(0,85,255,.07)",
                        cursor: "pointer", fontFamily: "inherit",
                        transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                      }}
                    >
                      <span style={{ fontSize: 12 }}>{p.emoji}</span>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 13px", background: "rgba(255,51,85,.08)",
                border: "0.5px solid rgba(255,51,85,.25)", borderRadius: 14, marginBottom: 12,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF3355" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>
                </svg>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#FF3355" }}>{error}</span>
              </div>
            )}

            {/* Reset */}
            <button
              type="button"
              onClick={onReset}
              className="lp-press"
              style={{
                alignSelf: "flex-end", height: 36, padding: "0 14px", borderRadius: 11,
                background: "#fff", color: "#5070B0", border: "0.5px solid rgba(0,85,255,.07)",
                fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
                fontFamily: "inherit", marginLeft: "auto",
                boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 2px 6px rgba(0,85,255,.06)",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0118 0 9 9 0 01-15 6.7L3 16"/><polyline points="3 21 3 16 8 16"/>
              </svg>
              Reset form
            </button>

            {/* Sticky Generate CTA */}
            <div style={{
              position: "fixed", bottom: 88, left: 0, right: 0,
              background: "rgba(238,244,255,.94)",
              backdropFilter: "saturate(220%) blur(32px)",
              WebkitBackdropFilter: "saturate(220%) blur(32px)",
              borderTop: "0.5px solid rgba(0,85,255,.07)",
              padding: "12px 16px 14px",
              zIndex: 50,
            }}>
              <button
                type="button"
                onClick={onGenerate}
                disabled={!canGenerate}
                className="lp-press"
                style={{
                  width: "100%", height: 52, borderRadius: 16,
                  background: canGenerate ? "linear-gradient(135deg, #0044CC 0%, #0055FF 50%, #1166FF 100%)" : "#EAF0FB",
                  color: canGenerate ? "#fff" : "#99AACC",
                  fontSize: 15, fontWeight: 700, border: "none",
                  cursor: canGenerate ? "pointer" : "not-allowed",
                  letterSpacing: "-0.3px",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: canGenerate ? "0 1px 2px rgba(0,26,102,.3), 0 8px 22px rgba(0,85,255,.42), inset 0 1px 0 rgba(255,255,255,.2)" : "none",
                  fontFamily: "inherit",
                  position: "relative", overflow: "hidden",
                }}
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: canGenerate ? "#FFDD55" : "#99AACC", filter: canGenerate ? "drop-shadow(0 0 4px rgba(255,221,85,.55))" : "none" }}>
                      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/>
                    </svg>
                    Generate Lesson Plan
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* History section head */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 4px 10px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px" }}>Recent Plans</span>
                <span style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>{history.length} plan{history.length === 1 ? "" : "s"}</span>
              </div>
            </div>

            {history.length === 0 ? (
              <div className="lp-card3d" style={{
                background: "#fff", borderRadius: 20, padding: "32px 20px", textAlign: "center",
                boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 20,
                  background: "linear-gradient(145deg, rgba(0,85,255,.08), rgba(17,102,255,.04))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 12px", color: "#0055FF",
                  boxShadow: "0 0 0 6px rgba(0,85,255,.05)",
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", marginBottom: 5, letterSpacing: "-0.3px" }}>No plans yet</div>
                <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5 }}>
                  Switch to <b style={{ color: "#0055FF", fontWeight: 700 }}>Generate</b> to create your first lesson plan.
                </div>
              </div>
            ) : history.map(h => (
              <div
                key={h.id}
                className="lp-card3d"
                onClick={() => onLoadHistory(h)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLoadHistory(h); } }}
                style={{
                  background: "#fff", borderRadius: 18, padding: 14, marginBottom: 10,
                  position: "relative", overflow: "hidden", cursor: "pointer",
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                }}
              >
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                  background: "linear-gradient(180deg, #0055FF, #1166FF)",
                }} />
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 13,
                    background: "linear-gradient(135deg, #001A66 0%, #0055FF 55%, #1166FF 100%)",
                    color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, position: "relative",
                    boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 4px 10px rgba(0,85,255,.28), inset 0 0.5px 0 rgba(255,255,255,.15)",
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <span style={{
                      position: "absolute", top: -4, right: -4,
                      fontSize: 13, color: "#FFDD55",
                      textShadow: "0 0 6px rgba(255,221,85,.75)", lineHeight: 1,
                    }}>✦</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px", lineHeight: 1.25, marginBottom: 6 }}>
                      {(h.plan?.plan_title as string) || h.topic || "Untitled plan"}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                      {h.subject && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: "-0.1px", background: "rgba(0,85,255,.1)", color: "#0055FF" }}>{h.subject}</span>}
                      {h.grade && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: "-0.1px", background: "rgba(0,85,255,.04)", color: "#0044CC", border: "0.5px solid rgba(0,85,255,.07)" }}>{h.grade}</span>}
                      {h.board && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: "-0.1px", background: "rgba(0,200,83,.1)", color: "#00C853" }}>{h.board}</span>}
                      {h.plan?.lessons && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: "-0.1px", background: "rgba(255,170,0,.12)", color: "#FFAA00" }}>{h.plan.lessons.length} lesson{h.plan.lessons.length === 1 ? "" : "s"}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px", display: "flex", alignItems: "center", gap: 5 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      {fmtDate(h.createdAt) || "Recently generated"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7 }}>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onLoadHistory(h); }}
                    className="lp-press"
                    style={{
                      flex: 1, height: 36, borderRadius: 11,
                      background: "linear-gradient(135deg, #0055FF, #1166FF)",
                      color: "#fff",
                      fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                      border: "none", cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                      boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 3px 10px rgba(0,85,255,.28)",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                    Open Plan
                  </button>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      onLoadHistory(h);
                      setActiveTab("generate");
                      setTimeout(onGenerate, 100);
                    }}
                    className="lp-press"
                    style={{
                      flex: 1, height: 36, borderRadius: 11,
                      background: "#F4F7FE", color: "#002080",
                      border: "0.5px solid rgba(0,85,255,.07)",
                      fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                      cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
                    </svg>
                    Regenerate
                  </button>
                  {/* P1-7 delete */}
                  <button
                    type="button"
                    aria-label="Delete plan"
                    onClick={e => { e.stopPropagation(); onDeleteHistory(h); }}
                    className="lp-press"
                    style={{
                      width: 36, height: 36, borderRadius: 11,
                      background: "rgba(255,51,85,.10)",
                      border: "0.5px solid rgba(255,51,85,.22)",
                      color: "#FF3355", cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Desktop-only view — mirrors mobile design in widescreen grid
// ─────────────────────────────────────────────────────────────────────────────
const DesktopLessonPlanner = ({
  form, upd, loading, error, history,
  activeTab, setActiveTab, onGenerate, onLoadHistory, onDeleteHistory, onReset,
  assignedSubjects,
}: MobileLessonPlannerProps) => {
  const [inclusions, setInclusions] = useState<Set<string>>(new Set(["objectives", "activities", "quiz"]));
  const selectedClass = parseClassLabel(form.grade);
  const durationMin = parseDurationMin(form.duration_per_lesson);

  const boardActive = (b: string) => {
    if (form.board === b) return true;
    if (b === "State Board" && /state/i.test(form.board)) return true;
    return false;
  };

  const canGenerate = !!form.subject.trim() && !loading;

  const fmtDate = (ts: any): string => {
    const d: Date | null = ts?.toDate?.() || (ts instanceof Date ? ts : null);
    if (!d) return "";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <div
      className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-4 pt-8 pb-12 text-left"
      style={{
        background: "#EEF4FF",
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <style>{`
        .lpd-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .lpd-card3d:hover { transform: translateY(-3px) scale(1.004); box-shadow: 0 1px 2px rgba(0,85,255,.08), 0 24px 44px rgba(0,85,255,.18), 0 8px 16px rgba(0,85,255,.1); } }
        .lpd-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .lpd-press:active { transform: scale(.96); }
        @keyframes lpdPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(1.25); } }
        @keyframes lpdTwinkle { 0%,100% { opacity: .85; } 50% { opacity: .25; } }
        .lpd-pulse { animation: lpdPulse 1.6s ease-in-out infinite; }
      `}</style>

      <div style={{ width: "100%" }}>

        {/* Page header row + tabs */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              fontSize: 10, fontWeight: 700, color: "#fff",
              letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 14,
              background: "linear-gradient(135deg, #001A66 0%, #0055FF 50%, #1166FF 100%)",
              padding: "7px 14px 7px 10px", borderRadius: 100,
              boxShadow: "0 1px 2px rgba(0,85,255,.25), 0 4px 12px rgba(0,85,255,.3), inset 0 0.5px 0 rgba(255,255,255,.2)",
            }}>
              <span style={{
                width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
                color: "#FFDD55", fontSize: 13, lineHeight: 1,
                filter: "drop-shadow(0 0 3px rgba(255,221,85,.6))",
              }}>✦</span>
              AI Powered
            </div>
            <h1 style={{ fontSize: 40, fontWeight: 700, color: "#001040", letterSpacing: "-1.4px", lineHeight: 1.05, margin: 0 }}>
              AI Lesson{" "}
              <span style={{
                background: "linear-gradient(135deg, #0055FF 0%, #1166FF 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}>Planner</span>
            </h1>
            <div style={{ fontSize: 14, color: "#5070B0", fontWeight: 500, marginTop: 8, letterSpacing: "-0.15px" }}>
              Generate classroom-ready lesson plans in seconds.
            </div>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: "flex", gap: 5, background: "#fff", padding: 5,
              borderRadius: 14,
              boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 2px 10px rgba(0,85,255,.08)",
              border: "0.5px solid rgba(0,85,255,.07)",
            }}
          >
            {[
              { key: "generate", label: "Generate",
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg> },
              { key: "history", label: "History", badge: history.length,
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
            ].map(tab => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key as "generate" | "history")}
                  className="lpd-press"
                  style={{
                    padding: "10px 18px", borderRadius: 10,
                    fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                    color: active ? "#fff" : "#5070B0",
                    background: active ? "linear-gradient(135deg, #0055FF, #1166FF)" : "transparent",
                    boxShadow: active ? "0 1px 2px rgba(0,85,255,.22), 0 3px 10px rgba(0,85,255,.3)" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    border: "none", cursor: "pointer", fontFamily: "inherit",
                    transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                  }}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.badge !== undefined && (
                    <span style={{
                      background: active ? "rgba(255,255,255,.22)" : "#F4F7FE",
                      color: active ? "#fff" : "#5070B0",
                      fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 100,
                    }}>{tab.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* AI Hero — full width */}
        <div
          className="lpd-card3d"
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            borderRadius: 28, padding: 32, marginBottom: 18,
            position: "relative", overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,26,102,.2), 0 12px 32px rgba(0,26,102,.32)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.12) 0%, transparent 45%)", pointerEvents: "none" }} />
          <div style={{
            position: "absolute", top: 28, right: 48,
            width: 4, height: 4, background: "#FFDD55", borderRadius: "50%",
            boxShadow: "-34px 22px 0 -1px rgba(255,255,255,.7), 18px 34px 0 -1px rgba(255,221,85,.85), -54px 48px 0 -2px rgba(255,255,255,.55), -16px 58px 0 -1px rgba(255,221,85,.9), -76px 14px 0 -2px rgba(255,255,255,.4)",
            pointerEvents: "none",
            animation: "lpdTwinkle 3s ease-in-out infinite",
          }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: 15, background: "rgba(255,255,255,.16)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.28)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFDD55" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.85)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Powered by Edullent engine</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,.55)", marginTop: 3, fontWeight: 500, letterSpacing: "-0.1px" }}>Curriculum-aligned · Real-time</div>
              </div>
              <div style={{
                marginLeft: "auto",
                background: "rgba(255,255,255,.18)",
                border: "0.5px solid rgba(255,255,255,.32)",
                color: "#fff",
                padding: "7px 14px", borderRadius: 100,
                fontSize: 11, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 7, letterSpacing: "0.3px",
              }}>
                <span className="lpd-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "#FFDD55", boxShadow: "0 0 8px #FFDD55" }} />
                Live
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 42, fontWeight: 700, color: "#fff", letterSpacing: "-1.6px", lineHeight: 1.1, marginBottom: 10 }}>
                  Craft lessons in seconds ✨
                </div>
                <div style={{ fontSize: 15, color: "rgba(255,255,255,.82)", fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5 }}>
                  Just pick a subject, class, and topic — <b style={{ color: "#fff", fontWeight: 700 }}>the AI handles the rest</b>.
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden", minWidth: 380 }}>
                <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", letterSpacing: "-0.7px" }}>{history.length}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Generated</div>
                </div>
                <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#FFDD55", letterSpacing: "-0.7px" }}>~8s</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Avg Time</div>
                </div>
                <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#6FFFAA", letterSpacing: "-0.7px" }}>100%</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Saved</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {activeTab === "generate" ? (
          loading ? (
            /* Loading state */
            <div className="lpd-card3d" style={{
              background: "#fff", borderRadius: 22, padding: "80px 24px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 18,
              boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
              border: "0.5px solid rgba(0,85,255,.07)",
            }}>
              <div style={{
                width: 72, height: 72, borderRadius: 20,
                background: "linear-gradient(135deg, rgba(0,85,255,.12), rgba(17,102,255,.08))",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 0 8px rgba(0,85,255,.04)",
              }}>
                <Loader2 style={{ width: 36, height: 36, color: "#0055FF" }} className="animate-spin" />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#001040", letterSpacing: "-0.4px" }}>AI is crafting your lesson plan…</div>
              <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px" }}>This may take 10-20 seconds</div>
              <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {[80, 55, 90, 45].map((w, i) => (
                  <div key={i} style={{ height: 4, background: "rgba(0,85,255,.1)", borderRadius: 2, width: `${w}%` }} className="animate-pulse" />
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* AI Tip */}
              <div style={{
                background: "linear-gradient(135deg, rgba(0,85,255,.08), rgba(17,102,255,.04))",
                border: "0.5px solid rgba(0,85,255,.2)",
                borderRadius: 16, padding: "14px 18px",
                display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 11,
                  background: "linear-gradient(135deg, #0055FF, #1166FF)",
                  color: "#FFDD55",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, fontSize: 16,
                  boxShadow: "0 1px 2px rgba(0,85,255,.2), 0 3px 8px rgba(0,85,255,.25)",
                }}>⚡</div>
                <div style={{ flex: 1, fontSize: 13, color: "#002080", lineHeight: 1.55, fontWeight: 500, letterSpacing: "-0.1px" }}>
                  <b style={{ color: "#0055FF", fontWeight: 700 }}>Pro tip:</b> The more specific your topic, the better the lesson plan. Try "Noun types with examples" instead of just "Nouns".
                </div>
              </div>

              {/* Form grid: 2-column layout */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

                {/* Subject — full row */}
                <div className="lpd-card3d" style={{
                  gridColumn: "1 / -1",
                  background: "#fff", borderRadius: 22, padding: 22,
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                      Subject
                      <span style={{ color: "#FF3355", fontSize: 12, fontWeight: 700 }}>*</span>
                    </div>
                  </div>
                  {assignedSubjects.length === 0 ? (
                    <div style={{
                      padding: "14px 16px", borderRadius: 16, background: "#F4F7FE",
                      border: "0.5px dashed rgba(0,85,255,.22)", color: "#5070B0",
                      fontSize: 13, fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5,
                    }}>
                      No subjects assigned yet. Please ask your principal or admin to assign a subject to your account.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {assignedSubjects.map(sub => {
                        const active = (form.subject || "").trim().toLowerCase() === sub.toLowerCase();
                        return (
                          <button
                            key={sub}
                            type="button"
                            onClick={() => upd("subject", sub)}
                            className="lpd-press"
                            style={{
                              padding: "10px 18px", borderRadius: 100,
                              background: active ? "linear-gradient(135deg, #0055FF, #1166FF)" : "#F4F7FE",
                              color: active ? "#fff" : "#002080",
                              fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                              display: "flex", alignItems: "center", gap: 7,
                              border: active ? "0.5px solid #0055FF" : "0.5px solid rgba(0,85,255,.07)",
                              cursor: "pointer", fontFamily: "inherit",
                              boxShadow: active ? "0 1px 2px rgba(0,85,255,.22), 0 3px 10px rgba(0,85,255,.28)" : "none",
                              transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                            }}
                          >
                            <span style={{ fontSize: 14, lineHeight: 1 }}>{subjectEmoji(sub)}</span>
                            {sub}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Class */}
                <div className="lpd-card3d" style={{
                  background: "#fff", borderRadius: 22, padding: 22,
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    Class
                    <span style={{ color: "#FF3355", fontSize: 12, fontWeight: 700 }}>*</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
                    {CLASS_OPTIONS.map(c => {
                      const active = selectedClass === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => upd("grade", classToGrade(c))}
                          className="lpd-press"
                          style={{
                            padding: "10px 4px", borderRadius: 10,
                            background: active ? "linear-gradient(135deg, #0055FF, #1166FF)" : "#F4F7FE",
                            color: active ? "#fff" : "#5070B0",
                            fontSize: 13, fontWeight: active ? 800 : 700,
                            textAlign: "center", letterSpacing: "-0.2px",
                            border: active ? "0.5px solid #0055FF" : "0.5px solid rgba(0,85,255,.07)",
                            boxShadow: active ? "0 1px 2px rgba(0,85,255,.22), 0 3px 8px rgba(0,85,255,.25)" : "none",
                            cursor: "pointer", fontFamily: "inherit",
                            transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                          }}
                        >{c}</button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        const v = prompt("Enter class number:");
                        const n = v && /^\d+$/.test(v) ? v : null;
                        if (n) upd("grade", classToGrade(n));
                      }}
                      className="lpd-press"
                      style={{
                        padding: "10px 4px", borderRadius: 10,
                        background: "#F4F7FE", color: "#5070B0",
                        fontSize: 13, fontWeight: 700,
                        textAlign: "center", letterSpacing: "-0.2px",
                        border: "0.5px solid rgba(0,85,255,.07)",
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >+</button>
                  </div>
                </div>

                {/* Board */}
                <div className="lpd-card3d" style={{
                  background: "#fff", borderRadius: 22, padding: 22,
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12 }}>Board</div>
                  <div style={{ display: "flex", gap: 4, background: "#F4F7FE", padding: 4, borderRadius: 12 }}>
                    {BOARD_OPTIONS.map(b => {
                      const active = boardActive(b);
                      return (
                        <button
                          key={b}
                          type="button"
                          onClick={() => upd("board", b)}
                          className="lpd-press"
                          style={{
                            flex: 1, padding: "10px 14px", borderRadius: 9,
                            fontSize: 13, fontWeight: active ? 800 : 700,
                            color: active ? "#0055FF" : "#5070B0",
                            background: active ? "#fff" : "transparent",
                            boxShadow: active ? "0 1px 2px rgba(0,0,0,.04), 0 2px 6px rgba(0,85,255,.15)" : "none",
                            textAlign: "center", letterSpacing: "-0.2px",
                            border: "none", cursor: "pointer", fontFamily: "inherit",
                            transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                          }}
                        >{b}</button>
                      );
                    })}
                  </div>
                </div>

                {/* Topic — full row */}
                <div className="lpd-card3d" style={{
                  gridColumn: "1 / -1",
                  background: "#fff", borderRadius: 22, padding: 22,
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    Lesson Topic
                    <span style={{ color: "#99AACC", fontSize: 11, fontWeight: 600, letterSpacing: 0, textTransform: "none" }}>(optional)</span>
                  </div>
                  <input
                    type="text"
                    value={form.topic}
                    onChange={e => upd("topic", e.target.value.slice(0, 120))}
                    placeholder="Leave blank to let AI pick a topic for you"
                    maxLength={120}
                    style={{
                      width: "100%", padding: "14px 16px",
                      background: form.topic ? "#fff" : "#F4F7FE",
                      border: "0.5px solid rgba(0,85,255,.07)",
                      borderRadius: 13,
                      fontSize: 15, fontWeight: form.topic ? 600 : 500, color: "#001040",
                      fontFamily: "inherit", letterSpacing: "-0.2px", outline: "none",
                      transition: "all .2s cubic-bezier(.2,.9,.3,1)",
                    }}
                    onFocus={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#0055FF"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,85,255,.12)"; }}
                    onBlur={e => { e.currentTarget.style.background = form.topic ? "#fff" : "#F4F7FE"; e.currentTarget.style.borderColor = "rgba(0,85,255,.07)"; e.currentTarget.style.boxShadow = "none"; }}
                  />
                  <div style={{ fontSize: 12, color: "#99AACC", marginTop: 8, fontWeight: 500, letterSpacing: "-0.1px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>{form.topic ? "Specific topic for the AI" : "AI will choose for you"}</span>
                    <span style={{ color: "#5070B0", fontWeight: 600 }}>{form.topic.length} / 120</span>
                  </div>
                </div>

                {/* Lessons */}
                <div className="lpd-card3d" style={{
                  background: "#fff", borderRadius: 22, padding: 22,
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12 }}>Lessons</div>
                  <div style={{ display: "flex", alignItems: "center", background: "#F4F7FE", border: "0.5px solid rgba(0,85,255,.07)", borderRadius: 13, overflow: "hidden" }}>
                    <button
                      type="button"
                      onClick={() => upd("num_lessons", Math.max(1, form.num_lessons - 1))}
                      aria-label="Decrease lessons"
                      className="lpd-press"
                      style={{ width: 46, height: 52, background: "transparent", border: "none", color: "#0055FF", fontSize: 22, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    >−</button>
                    <div style={{ flex: 1, textAlign: "center", fontSize: 18, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px" }}>{form.num_lessons}</div>
                    <button
                      type="button"
                      onClick={() => upd("num_lessons", Math.min(5, form.num_lessons + 1))}
                      aria-label="Increase lessons"
                      className="lpd-press"
                      style={{ width: 46, height: 52, background: "transparent", border: "none", color: "#0055FF", fontSize: 22, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    >+</button>
                  </div>
                </div>

                {/* Duration */}
                <div className="lpd-card3d" style={{
                  background: "#fff", borderRadius: 22, padding: 22,
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12 }}>Duration</div>
                  <div style={{ display: "flex", alignItems: "center", background: "#F4F7FE", border: "0.5px solid rgba(0,85,255,.07)", borderRadius: 13, overflow: "hidden" }}>
                    <button
                      type="button"
                      onClick={() => upd("duration_per_lesson", minToDuration(Math.max(15, durationMin - 15)))}
                      aria-label="Decrease duration"
                      className="lpd-press"
                      style={{ width: 46, height: 52, background: "transparent", border: "none", color: "#0055FF", fontSize: 22, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    >−</button>
                    <div style={{ flex: 1, textAlign: "center", fontSize: 18, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px" }}>
                      {durationMin}<span style={{ color: "#5070B0", fontSize: 13, fontWeight: 700, marginLeft: 4 }}>min</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => upd("duration_per_lesson", minToDuration(Math.min(120, durationMin + 15)))}
                      aria-label="Increase duration"
                      className="lpd-press"
                      style={{ width: 46, height: 52, background: "transparent", border: "none", color: "#0055FF", fontSize: 22, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    >+</button>
                  </div>
                </div>

                {/* Include in Plan — full row */}
                <div className="lpd-card3d" style={{
                  gridColumn: "1 / -1",
                  background: "#fff", borderRadius: 22, padding: 22,
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    Include in Plan
                    <span style={{ color: "#99AACC", fontWeight: 600, letterSpacing: 0, textTransform: "none", fontSize: 11, marginLeft: 2 }}>(optional)</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {PLAN_INCLUSIONS.map(p => {
                      const active = inclusions.has(p.key);
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => {
                            const next = new Set(inclusions);
                            if (next.has(p.key)) next.delete(p.key); else next.add(p.key);
                            setInclusions(next);
                            const chosen = PLAN_INCLUSIONS.filter(x => next.has(x.key)).map(x => x.label);
                            upd("learning_goals", chosen.join(", "));
                          }}
                          className="lpd-press"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            padding: "9px 16px", borderRadius: 100,
                            background: active ? "rgba(0,85,255,.1)" : "#F4F7FE",
                            color: active ? "#0055FF" : "#002080",
                            fontSize: 12, fontWeight: 700, letterSpacing: "-0.15px",
                            border: active ? "0.5px solid rgba(0,85,255,.25)" : "0.5px solid rgba(0,85,255,.07)",
                            cursor: "pointer", fontFamily: "inherit",
                            transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                          }}
                        >
                          <span style={{ fontSize: 14 }}>{p.emoji}</span>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Error banner */}
              {error && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 16px", background: "rgba(255,51,85,.08)",
                  border: "0.5px solid rgba(255,51,85,.25)", borderRadius: 14, marginBottom: 14,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF3355" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#FF3355" }}>{error}</span>
                </div>
              )}

              {/* Action row: Reset + Generate */}
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={onReset}
                  className="lpd-press"
                  style={{
                    height: 52, padding: "0 22px", borderRadius: 14,
                    background: "#fff", color: "#5070B0", border: "0.5px solid rgba(0,85,255,.07)",
                    fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                    display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer",
                    fontFamily: "inherit",
                    boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 2px 6px rgba(0,85,255,.06)",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 0118 0 9 9 0 01-15 6.7L3 16"/><polyline points="3 21 3 16 8 16"/>
                  </svg>
                  Reset form
                </button>
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={!canGenerate}
                  className="lpd-press"
                  style={{
                    flex: 1, height: 52, borderRadius: 16,
                    background: canGenerate ? "linear-gradient(135deg, #0044CC 0%, #0055FF 50%, #1166FF 100%)" : "#EAF0FB",
                    color: canGenerate ? "#fff" : "#99AACC",
                    fontSize: 16, fontWeight: 700, border: "none",
                    cursor: canGenerate ? "pointer" : "not-allowed",
                    letterSpacing: "-0.3px",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    boxShadow: canGenerate ? "0 1px 2px rgba(0,26,102,.3), 0 8px 22px rgba(0,85,255,.42), inset 0 1px 0 rgba(255,255,255,.2)" : "none",
                    fontFamily: "inherit",
                    position: "relative", overflow: "hidden",
                  }}
                >
                  {loading ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Generating…</>
                  ) : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ color: canGenerate ? "#FFDD55" : "#99AACC", filter: canGenerate ? "drop-shadow(0 0 4px rgba(255,221,85,.55))" : "none" }}>
                        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/>
                      </svg>
                      Generate Lesson Plan
                    </>
                  )}
                </button>
              </div>
            </>
          )
        ) : (
          /* HISTORY TAB */
          <>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 4px 14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: "#001040", letterSpacing: "-0.4px" }}>Recent Plans</span>
                <span style={{ fontSize: 13, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>{history.length} plan{history.length === 1 ? "" : "s"}</span>
              </div>
            </div>

            {history.length === 0 ? (
              <div className="lpd-card3d" style={{
                background: "#fff", borderRadius: 22, padding: "56px 24px", textAlign: "center",
                boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{
                  width: 72, height: 72, borderRadius: 22,
                  background: "linear-gradient(145deg, rgba(0,85,255,.08), rgba(17,102,255,.04))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 14px", color: "#0055FF",
                  boxShadow: "0 0 0 6px rgba(0,85,255,.05)",
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#001040", marginBottom: 6, letterSpacing: "-0.3px" }}>No plans yet</div>
                <div style={{ fontSize: 13, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5 }}>
                  Switch to <b style={{ color: "#0055FF", fontWeight: 700 }}>Generate</b> to create your first lesson plan.
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                {history.map(h => (
                  <div
                    key={h.id}
                    className="lpd-card3d"
                    onClick={() => onLoadHistory(h)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLoadHistory(h); } }}
                    style={{
                      background: "#fff", borderRadius: 20, padding: 18,
                      position: "relative", overflow: "hidden", cursor: "pointer",
                      boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                      border: "0.5px solid rgba(0,85,255,.07)",
                    }}
                  >
                    <div style={{
                      position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
                      background: "linear-gradient(180deg, #0055FF, #1166FF)",
                    }} />
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: 14,
                        background: "linear-gradient(135deg, #001A66 0%, #0055FF 55%, #1166FF 100%)",
                        color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, position: "relative",
                        boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 4px 10px rgba(0,85,255,.28), inset 0 0.5px 0 rgba(255,255,255,.15)",
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                        <span style={{
                          position: "absolute", top: -4, right: -4,
                          fontSize: 15, color: "#FFDD55",
                          textShadow: "0 0 6px rgba(255,221,85,.75)", lineHeight: 1,
                        }}>✦</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px", lineHeight: 1.25, marginBottom: 7 }}>
                          {(h.plan?.plan_title as string) || h.topic || "Untitled plan"}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 7 }}>
                          {h.subject && <span style={{ padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700, letterSpacing: "-0.1px", background: "rgba(0,85,255,.1)", color: "#0055FF" }}>{h.subject}</span>}
                          {h.grade && <span style={{ padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700, letterSpacing: "-0.1px", background: "rgba(0,85,255,.04)", color: "#0044CC", border: "0.5px solid rgba(0,85,255,.07)" }}>{h.grade}</span>}
                          {h.board && <span style={{ padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700, letterSpacing: "-0.1px", background: "rgba(0,200,83,.1)", color: "#00C853" }}>{h.board}</span>}
                          {h.plan?.lessons && <span style={{ padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700, letterSpacing: "-0.1px", background: "rgba(255,170,0,.12)", color: "#FFAA00" }}>{h.plan.lessons.length} lesson{h.plan.lessons.length === 1 ? "" : "s"}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px", display: "flex", alignItems: "center", gap: 6 }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                          </svg>
                          {fmtDate(h.createdAt) || "Recently generated"}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onLoadHistory(h); }}
                        className="lpd-press"
                        style={{
                          flex: 1, height: 42, borderRadius: 12,
                          background: "linear-gradient(135deg, #0055FF, #1166FF)",
                          color: "#fff",
                          fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                          border: "none", cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 3px 10px rgba(0,85,255,.28)",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                        </svg>
                        Open Plan
                      </button>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onLoadHistory(h);
                          setActiveTab("generate");
                          setTimeout(onGenerate, 100);
                        }}
                        className="lpd-press"
                        style={{
                          flex: 1, height: 42, borderRadius: 12,
                          background: "#F4F7FE", color: "#002080",
                          border: "0.5px solid rgba(0,85,255,.07)",
                          fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                          cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
                        </svg>
                        Regenerate
                      </button>
                      {/* P1-7 delete */}
                      <button
                        type="button"
                        aria-label="Delete plan"
                        onClick={e => { e.stopPropagation(); onDeleteHistory(h); }}
                        className="lpd-press"
                        style={{
                          width: 42, height: 42, borderRadius: 12,
                          background: "rgba(255,51,85,.10)",
                          border: "0.5px solid rgba(255,51,85,.22)",
                          color: "#FF3355", cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
};

export default LessonPlanGenerator;