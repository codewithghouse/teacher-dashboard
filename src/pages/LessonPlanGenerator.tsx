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
    <div style={{ minHeight: "100vh", background: T.bg }}>

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
            <button
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
            <button
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
              <button
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
              <button
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
                    <button
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
              <button
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
              <button
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

    </div>
  );
};

export default LessonPlanGenerator;