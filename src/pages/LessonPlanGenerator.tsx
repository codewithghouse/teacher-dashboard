import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { AIController } from "../ai/controller/ai-controller";
import { db } from "../lib/firebase";
import { collection, serverTimestamp, query, where, onSnapshot } from "firebase/firestore";
import { auditedAdd } from "../lib/auditedWrites";
import { toast } from "sonner";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  hero:  "#08090C",
  bg:    "#F5F6F9",
  white: "#ffffff",
  ink1:  "#08090C",
  ink2:  "#42475A",
  ink3:  "#8C92A4",
  s1:    "#F5F6F9",
  s2:    "#ECEEF4",
  bdr:   "#E2E5EE",
  blue:  "#3B5BDB",
  blBg:  "#EDF2FF",
  blBdr: "#BAC8FF",
  pur:   "#6741D9",
  plBg:  "#F3F0FF",
  plBdr: "#D0BFFF",
  grn:   "#087F5B",
  grn2:  "#2F9E44",
  glBg:  "#EBFBEE",
  glBdr: "#8CE99A",
  red:   "#C92A2A",
  rlBg:  "#FFF5F5",
  rlBdr: "#FFC9C9",
  amb:   "#C87014",
  alBg:  "#FFF9DB",
  alBdr: "#FFE066",
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

interface LessonSection {
  heading?: string;
  phase?: string;
  content?: string;
  activities?: string[];
  [key: string]: unknown;
}

interface Lesson {
  title?: string;
  duration?: string;
  objectives?: string[];
  sections?: LessonSection[];
  [key: string]: unknown;
}

interface LessonPlanResult {
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

  // ── Firebase: lesson plan history ───────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
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
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as HistoryItem));
        docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setHistory(docs);
      },
      e => console.error("[LessonPlanGenerator] history subscription failed", e),
    );
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!form.subject.trim() || !form.topic.trim()) {
      setError("Subject aur Topic required hain.");
      return;
    }
    setLoading(true); setError(null); setPlan(null); setSaved(false);
    try {
      const result = await AIController.getLessonPlan({
        ...form,
        teacher_name: teacherData?.name || "",
        school_name: teacherData?.schoolName || "",
      });
      if (result.status === "success" && result.data) {
        setPlan(result.data as LessonPlanResult);
        setExpandedLesson(0);
      } else {
        setError((result as { message?: string }).message || "AI could not generate the plan. Please try again.");
      }
    } catch (e) {
      console.error("[LessonPlanGenerator] generate failed", e);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!plan || !teacherData?.id) return;
    setSaving(true);
    try {
      await auditedAdd(collection(db, "lessonPlans"), {
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        schoolName: teacherData.schoolName || "",
        teacherName: teacherData.name || "",
        subject: form.subject, grade: form.grade,
        topic: form.topic, board: form.board,
        plan, createdAt: serverTimestamp(),
      });
      setSaved(true);
      toast.success("Lesson plan saved!");
    } catch (e) {
      console.error("[LessonPlanGenerator] save failed", e);
      toast.error("Failed to save.");
    }
    setSaving(false);
  };

  const handleReset = () => {
    setPlan(null); setError(null); setSaved(false);
    setForm({ ...defaultForm, subject: teacherData?.subject || "" });
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
    setSaved(true); setExpandedLesson(0); setActiveTab("generate");
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
  const showResult = activeTab === "generate" && plan && !loading;

  return (
    <div style={{ minHeight: "100vh", background: "#EEF4FF" }}>

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
          onGenerate={handleGenerate}
          onLoadHistory={loadFromHistory}
          onReset={handleReset}
        />
      )}

      {/* ═══════════════════ DESKTOP VIEW (unchanged when showing form; shared for result) ═══════════════════ */}
      <div className={!showResult ? "hidden md:block" : ""}>

      {/* ═══ DARK HERO ═══════════════════════════════════════════════════ */}
      {!showResult && (
        <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 bg-[#162E93] md:bg-[#08090C]">
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

              {/* Topic */}
              <div style={{ padding: "13px 14px", borderBottom: `1px solid ${T.s2}` }}>
                <div style={labelStyle}>Topic / chapter <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.red }} /></div>
                <input style={inputStyle} value={form.topic} onChange={e => upd("topic", e.target.value)} placeholder="e.g. Parts of speech" />
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
                onClick={handleGenerate}
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

        {/* ── GENERATE TAB: LOADING ──────────────────────────────────── */}
        {activeTab === "generate" && loading && (
          <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: "60px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: `${T.pur}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Loader2 style={{ width: 28, height: 28, color: T.pur }} className="animate-spin" />
            </div>
            <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1 }}>AI is crafting your lesson plan...</p>
            <p style={{ fontSize: 10, color: T.ink3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.07em" }}>This may take 10-20 seconds</p>
            <div style={{ width: "100%", maxWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
              {[80, 55, 90, 45].map((w, i) => (
                <div key={i} style={{ height: 3, background: T.s2, borderRadius: 2, width: `${w}%` }} className="animate-pulse" />
              ))}
            </div>
          </div>
        )}

        {/* ── GENERATE TAB: RESULT ───────────────────────────────────── */}
        {showResult && (
          <>
            {/* Purple gradient hero */}
            <div
              className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8"
              style={{
                background: "linear-gradient(145deg, #2D46C8 0%, #5834C6 100%)",
                padding: "20px 18px",
              }}
            >
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
                      background: "rgba(47,158,68,0.25)",
                      border: "1px solid rgba(47,158,68,0.4)",
                    }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#4CC9A4" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1.5,5.5 3.5,8 8.5,2" />
                      </svg>
                      <span style={{ fontSize: 10, color: "#4CC9A4", fontWeight: 500 }}>Saved</span>
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

            {plan.lessons?.map((lesson: any, li: number) => (
              <div key={li} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Lesson number header */}
                <div
                  onClick={() => setExpandedLesson(expandedLesson === li ? -1 : li)}
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
                {expandedLesson === li && lesson.sections?.map((section: any, si: number) => {
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

            {/* Export + Regenerate buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button type="button"
                onClick={handleSave}
                disabled={saving || saved}
                style={{
                  padding: 11, borderRadius: 12,
                  background: T.pur, border: "none", color: "#fff",
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  opacity: saved ? 0.6 : 1,
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
                  background: T.white, border: `1px solid ${T.bdr}`,
                  color: T.ink2, fontSize: 12, cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10,6 A4,4 0 1,1 8,3" /><polyline points="8,1 8,3 10,3" />
                </svg>
                Regenerate
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
  onReset: () => void;
}

const SUBJECT_CHIPS = [
  { key: "English",     label: "English",  emoji: "📝" },
  { key: "Mathematics", label: "Math",     emoji: "🔢" },
  { key: "Science",     label: "Science",  emoji: "🔬" },
  { key: "Social",      label: "Social",   emoji: "🌍" },
  { key: "Computer",    label: "Computer", emoji: "💻" },
];
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
  activeTab, setActiveTab, onGenerate, onLoadHistory, onReset,
}: MobileLessonPlannerProps) => {
  const [inclusions, setInclusions] = useState<Set<string>>(new Set(["objectives", "activities", "quiz"]));
  const selectedClass = parseClassLabel(form.grade);
  const durationMin = parseDurationMin(form.duration_per_lesson);

  // Derive selected subject chip if it matches any chip key, else custom
  const matchedSubject = SUBJECT_CHIPS.find(s => (form.subject || "").toLowerCase().includes(s.key.toLowerCase()) || s.label.toLowerCase() === (form.subject || "").toLowerCase());

  // Board filtering — mockup shows 3 chips, our backend supports 6. Show 3 main chips + fallback to form.board if it's something else.
  const boardActive = (b: string) => {
    if (form.board === b) return true;
    if (b === "State Board" && /state/i.test(form.board)) return true;
    return false;
  };

  const canGenerate = !!form.subject.trim() && !!form.topic.trim() && !loading;

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
            fontSize: 9, fontWeight: 800, color: "#fff",
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
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>
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
                <div style={{ fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,.85)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Powered by Edullent engine</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 2, fontWeight: 500, letterSpacing: "-0.1px" }}>Curriculum-aligned · Real-time</div>
              </div>
              <div style={{
                marginLeft: "auto",
                background: "rgba(255,255,255,.18)",
                border: "0.5px solid rgba(255,255,255,.32)",
                color: "#fff",
                padding: "5px 12px", borderRadius: 100,
                fontSize: 10, fontWeight: 800,
                display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.3px",
              }}>
                <span className="lp-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#FFDD55", boxShadow: "0 0 8px #FFDD55" }} />
                Live
              </div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-1.2px", lineHeight: 1.1, marginBottom: 8 }}>
              Craft lessons in seconds ✨
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.82)", marginBottom: 20, fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5 }}>
              Just pick a subject, class, and topic — <b style={{ color: "#fff", fontWeight: 700 }}>the AI handles the rest</b>.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden" }}>
              <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>{history.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Generated</div>
              </div>
              <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#FFDD55", letterSpacing: "-0.5px" }}>~8s</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Avg Time</div>
              </div>
              <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#6FFFAA", letterSpacing: "-0.5px" }}>100%</div>
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
                    fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 100,
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
                <b style={{ color: "#0055FF", fontWeight: 800 }}>Pro tip:</b> The more specific your topic, the better the lesson plan. Try "Noun types with examples" instead of just "Nouns".
              </div>
            </div>

            {/* Subject */}
            <div className="lp-card3d" style={{
              background: "#fff", borderRadius: 20, padding: 16, marginBottom: 12,
              boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 4px 14px rgba(0,85,255,.08)",
              border: "0.5px solid rgba(0,85,255,.07)",
            }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                Subject
                <span style={{ color: "#FF3355", fontSize: 11, fontWeight: 900 }}>*</span>
              </div>
              <div className="lp-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", margin: "0 -4px", padding: "2px 4px 4px" }}>
                {SUBJECT_CHIPS.map(sc => {
                  const active = matchedSubject?.key === sc.key;
                  return (
                    <button
                      key={sc.key}
                      type="button"
                      onClick={() => upd("subject", sc.key)}
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
                      <span style={{ fontSize: 13, lineHeight: 1 }}>{sc.emoji}</span>
                      {sc.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Class + Board */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div className="lp-card3d" style={{
                background: "#fff", borderRadius: 20, padding: 16,
                boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 4px 14px rgba(0,85,255,.08)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  Class
                  <span style={{ color: "#FF3355", fontSize: 11, fontWeight: 900 }}>*</span>
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
                boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 4px 14px rgba(0,85,255,.08)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10 }}>Board</div>
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
              boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 4px 14px rgba(0,85,255,.08)",
              border: "0.5px solid rgba(0,85,255,.07)",
            }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                Lesson Topic
                <span style={{ color: "#FF3355", fontSize: 11, fontWeight: 900 }}>*</span>
              </div>
              <input
                type="text"
                value={form.topic}
                onChange={e => upd("topic", e.target.value.slice(0, 120))}
                placeholder="e.g. Understanding Parts of Speech"
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
                <span>What should the AI teach?</span>
                <span style={{ color: "#5070B0", fontWeight: 600 }}>{form.topic.length} / 120</span>
              </div>
            </div>

            {/* Lessons + Duration steppers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div className="lp-card3d" style={{
                background: "#fff", borderRadius: 20, padding: 16,
                boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 4px 14px rgba(0,85,255,.08)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10 }}>Lessons</div>
                <div style={{ display: "flex", alignItems: "center", background: "#F4F7FE", border: "0.5px solid rgba(0,85,255,.07)", borderRadius: 12, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => upd("num_lessons", Math.max(1, form.num_lessons - 1))}
                    aria-label="Decrease lessons"
                    className="lp-press"
                    style={{ width: 36, height: 44, background: "transparent", border: "none", color: "#0055FF", fontSize: 18, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                  >−</button>
                  <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px" }}>{form.num_lessons}</div>
                  <button
                    type="button"
                    onClick={() => upd("num_lessons", Math.min(5, form.num_lessons + 1))}
                    aria-label="Increase lessons"
                    className="lp-press"
                    style={{ width: 36, height: 44, background: "transparent", border: "none", color: "#0055FF", fontSize: 18, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                  >+</button>
                </div>
              </div>

              <div className="lp-card3d" style={{
                background: "#fff", borderRadius: 20, padding: 16,
                boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 4px 14px rgba(0,85,255,.08)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10 }}>Duration</div>
                <div style={{ display: "flex", alignItems: "center", background: "#F4F7FE", border: "0.5px solid rgba(0,85,255,.07)", borderRadius: 12, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => upd("duration_per_lesson", minToDuration(Math.max(15, durationMin - 15)))}
                    aria-label="Decrease duration"
                    className="lp-press"
                    style={{ width: 36, height: 44, background: "transparent", border: "none", color: "#0055FF", fontSize: 18, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                  >−</button>
                  <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px" }}>
                    {durationMin}<span style={{ color: "#5070B0", fontSize: 11, fontWeight: 700, marginLeft: 3 }}>min</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => upd("duration_per_lesson", minToDuration(Math.min(120, durationMin + 15)))}
                    aria-label="Increase duration"
                    className="lp-press"
                    style={{ width: 36, height: 44, background: "transparent", border: "none", color: "#0055FF", fontSize: 18, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                  >+</button>
                </div>
              </div>
            </div>

            {/* Include in Plan */}
            <div className="lp-card3d" style={{
              background: "#fff", borderRadius: 20, padding: 16, marginBottom: 12,
              boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 4px 14px rgba(0,85,255,.08)",
              border: "0.5px solid rgba(0,85,255,.07)",
            }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
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
                  fontSize: 15, fontWeight: 800, border: "none",
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
                <span style={{ fontSize: 15, fontWeight: 800, color: "#001040", letterSpacing: "-0.35px" }}>Recent Plans</span>
                <span style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>{history.length} plan{history.length === 1 ? "" : "s"}</span>
              </div>
            </div>

            {history.length === 0 ? (
              <div className="lp-card3d" style={{
                background: "#fff", borderRadius: 20, padding: "32px 20px", textAlign: "center",
                boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 4px 14px rgba(0,85,255,.08)",
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
                <div style={{ fontSize: 14, fontWeight: 800, color: "#001040", marginBottom: 5, letterSpacing: "-0.3px" }}>No plans yet</div>
                <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5 }}>
                  Switch to <b style={{ color: "#0055FF", fontWeight: 800 }}>Generate</b> to create your first lesson plan.
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
                  boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 4px 14px rgba(0,85,255,.08)",
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
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#001040", letterSpacing: "-0.35px", lineHeight: 1.25, marginBottom: 6 }}>
                      {(h.plan?.plan_title as string) || h.topic || "Untitled plan"}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                      {h.subject && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: "-0.1px", background: "rgba(0,85,255,.1)", color: "#0055FF" }}>{h.subject}</span>}
                      {h.grade && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: "-0.1px", background: "rgba(0,85,255,.04)", color: "#0044CC", border: "0.5px solid rgba(0,85,255,.07)" }}>{h.grade}</span>}
                      {h.board && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: "-0.1px", background: "rgba(0,200,83,.1)", color: "#00C853" }}>{h.board}</span>}
                      {h.plan?.lessons && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: "-0.1px", background: "rgba(255,170,0,.12)", color: "#FFAA00" }}>{h.plan.lessons.length} lesson{h.plan.lessons.length === 1 ? "" : "s"}</span>}
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
                </div>
              </div>
            ))}
          </>
        )}

      </div>
    </div>
  );
};

export default LessonPlanGenerator;