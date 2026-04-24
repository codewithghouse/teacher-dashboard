import { useMemo, useState } from "react";
import { Loader2, Printer, Copy, RefreshCw, Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/AuthContext";
import { AIController } from "../ai/controller/ai-controller";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

// ── Mobile tokens (matches Students page) ────────────────────────────────────
const MA = {
  FONT: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  CARD: "#FFFFFF",
  SURFACE: "#F4F7FE",
  SURFACE2: "#EAF0FB",
  P: "#0055FF", PD: "#0044CC",
  T1: "#001040", T2: "#002080", T3: "#5070B0", T4: "#99AACC",
  GREEN: "#00C853",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  GOLD: "#FFAA00",
  VIOLET: "#7B3FF4",
  TEAL: "#16B8B0",
  SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
  SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
  BDR: "0.5px solid rgba(0,85,255,0.07)",
  HERO_GRAD: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
};

// ── Desktop tokens (matches Students page) ───────────────────────────────────
const T = {
  ink0: "#08090C", ink1: "#42475A", ink2: "#8C92A4",
  s0: "#FFFFFF", s1: "#F5F6F9", s2: "#ECEEF4", bdr: "#E2E5EE",
  blue: "#3B5BDB", blueL: "#EDF2FF",
  green: "#087F5B", greenL: "#EBFBEE",
  red: "#C92A2A", redL: "#FFF5F5",
  amber: "#C87014", amberL: "#FFF9DB",
};

// ── Form constants ───────────────────────────────────────────────────────────
const BOARDS = ["CBSE", "ICSE", "State Board", "IB", "Cambridge (IGCSE)", "Other"];
const GRADES = Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`);
const DIFFICULTIES = ["Easy", "Medium", "Hard", "Mixed"];
const DURATIONS = ["30 minutes", "45 minutes", "60 minutes", "90 minutes", "2 hours", "3 hours"];
const QUESTION_TYPES = [
  { key: "mcq",        label: "MCQ",           hint: "1 mark" },
  { key: "short",      label: "Short Answer",  hint: "2–3 marks" },
  { key: "long",       label: "Long Answer",   hint: "5 marks" },
  { key: "numerical",  label: "Numerical",     hint: "3–4 marks" },
  { key: "truefalse",  label: "True / False",  hint: "1 mark" },
  { key: "fillblanks", label: "Fill Blanks",   hint: "1 mark" },
];

interface FormData {
  subject: string;
  grade: string;
  board: string;
  topics: string;
  difficulty: string;
  duration: string;
  totalMarks: number;
  numQuestions: number;
  types: string[];
  instructions: string;
}

interface GeneratedQuestion {
  number?: number | string;
  type?: string;
  marks?: number;
  question?: string;
  options?: string[];
  answer?: string;
  solution?: string;
}

interface GeneratedSection {
  title?: string;
  instructions?: string;
  marks?: number;
  questions?: GeneratedQuestion[];
}

interface GeneratedPaper {
  title?: string;
  subject?: string;
  grade?: string;
  board?: string;
  duration?: string;
  totalMarks?: number;
  generalInstructions?: string[];
  sections?: GeneratedSection[];
}

const DEFAULT_FORM: FormData = {
  subject: "",
  grade: "Class 10",
  board: "CBSE",
  topics: "",
  difficulty: "Medium",
  duration: "60 minutes",
  totalMarks: 50,
  numQuestions: 20,
  types: ["mcq", "short", "long"],
  instructions: "",
};

const Exam = () => {
  const { teacherData } = useAuth();
  const [form, setForm] = useState<FormData>(() => ({
    ...DEFAULT_FORM,
    subject: teacherData?.subject || "",
  }));
  const [loading, setLoading] = useState(false);
  const [paper, setPaper] = useState<GeneratedPaper | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [copied, setCopied] = useState(false);

  const totalQuestionsCount = useMemo(() => {
    if (!paper?.sections) return 0;
    return paper.sections.reduce((sum, s) => sum + (s.questions?.length ?? 0), 0);
  }, [paper]);

  const update = <K extends keyof FormData>(k: K, v: FormData[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const toggleType = (key: string) =>
    setForm((p) => ({
      ...p,
      types: p.types.includes(key)
        ? p.types.filter((t) => t !== key)
        : [...p.types, key],
    }));

  const handleGenerate = async () => {
    if (!form.subject.trim()) return toast.error("Subject daalo.");
    if (!form.topics.trim())  return toast.error("Kam se kam ek topic daalo.");
    if (form.types.length === 0) return toast.error("Ek question type select karo.");
    if (form.totalMarks < 5)     return toast.error("Total marks bahut kam hain.");
    if (form.numQuestions < 1)   return toast.error("Question count valid nahi.");

    setLoading(true);
    setPaper(null);
    try {
      const res = await AIController.getExamPaper({
        subject: form.subject.trim(),
        grade: form.grade,
        board: form.board,
        topics: form.topics.trim(),
        difficulty: form.difficulty,
        duration: form.duration,
        totalMarks: form.totalMarks,
        numQuestions: form.numQuestions,
        questionTypes: form.types,
        instructions: form.instructions.trim(),
        teacherName: teacherData?.name || "",
        schoolName: teacherData?.schoolName || "",
      });

      if (res.status === "success") {
        setPaper(res.data as GeneratedPaper);
        setShowAnswers(false);
        toast.success("Paper generate ho gaya!");
      } else {
        toast.error(res.message || "AI service ne paper generate nahi kiya.");
      }
    } catch (e) {
      console.error("[Exam] generate error", e);
      toast.error("Kuch galat hua — dobara try karo.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setPaper(null);
    setShowAnswers(false);
  };

  const handlePrint = () => window.print();

  const handleCopy = async () => {
    if (!paper) return;
    const txt = paperToText(paper);
    try {
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      toast.success("Paper copy ho gaya!");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Copy nahi hua.");
    }
  };

  return (
    <div style={{ fontFamily: "inherit" }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <div className="md:hidden" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "0 -16px", paddingBottom: 8 }}>

        {/* Header */}
        <div className="px-4 pt-3 pb-[14px]">
          <div className="flex items-center gap-[7px] text-[9px] font-extrabold uppercase mb-[6px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
            <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: MA.P }} />
            Teacher Dashboard · Exam
          </div>
          <h1 className="text-[28px] font-extrabold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.1px" }}>
            Exam Generator
          </h1>
          <div className="text-[12px] font-medium mt-[6px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
            Apni requirements ke hisaab se AI se exam paper banwao.
          </div>
        </div>

        {/* Hero */}
        <div className="mx-4 mb-[14px] rounded-[26px] p-[22px] relative overflow-hidden"
          style={{ background: MA.HERO_GRAD, boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
          <div className="relative z-[2]">
            <div className="flex items-center gap-3 mb-[16px]">
              <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white"
                style={{
                  background: "rgba(255,255,255,0.14)",
                  backdropFilter: "blur(22px)",
                  WebkitBackdropFilter: "blur(22px)",
                  border: "0.5px solid rgba(255,255,255,0.22)",
                  boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
              </div>
              <div>
                <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>AI Exam Paper</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>
                  Subject · Grade · Difficulty
                </div>
              </div>
              <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-extrabold"
                style={{
                  background: "rgba(255,170,0,0.2)",
                  border: "0.5px solid rgba(255,170,0,0.5)",
                  color: "#FFE699",
                  letterSpacing: "0.3px",
                }}>
                <span className="w-[6px] h-[6px] rounded-full" style={{ background: "#FFDD55", boxShadow: "0 0 8px #FFDD55" }} />
                AI
              </div>
            </div>
            <div className="text-[15px] font-semibold text-white leading-[1.45]" style={{ letterSpacing: "-0.2px" }}>
              Customize <b className="font-extrabold">question types, marks, difficulty</b> — AI ek exam-ready paper banayega.
            </div>
          </div>
        </div>

        {/* Form card */}
        <div className="mx-4 mb-[14px] rounded-[22px] p-[16px]" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
          <SectionLabel>Basics</SectionLabel>

          <MField label="Subject">
            <MInput
              value={form.subject}
              onChange={(v) => update("subject", v)}
              placeholder="e.g. Mathematics, Physics"
            />
          </MField>

          <div className="grid grid-cols-2 gap-[10px]">
            <MField label="Grade">
              <MSelect value={form.grade} onChange={(v) => update("grade", v)} options={GRADES} />
            </MField>
            <MField label="Board">
              <MSelect value={form.board} onChange={(v) => update("board", v)} options={BOARDS} />
            </MField>
          </div>

          <MField label="Topics / Chapters">
            <textarea
              value={form.topics}
              onChange={(e) => update("topics", e.target.value)}
              rows={3}
              placeholder="e.g. Quadratic Equations, Arithmetic Progression, Trigonometry"
              className="w-full rounded-[12px] px-[14px] py-[11px] text-[13px] font-medium outline-none resize-none"
              style={{
                background: MA.SURFACE,
                color: MA.T1,
                fontFamily: MA.FONT,
                border: "1px solid transparent",
                letterSpacing: "-0.1px",
              }}
            />
          </MField>

          <div className="h-[1px] my-[14px]" style={{ background: MA.SURFACE2 }} />

          <SectionLabel>Paper Setup</SectionLabel>

          <div className="grid grid-cols-2 gap-[10px]">
            <MField label="Difficulty">
              <MSelect value={form.difficulty} onChange={(v) => update("difficulty", v)} options={DIFFICULTIES} />
            </MField>
            <MField label="Duration">
              <MSelect value={form.duration} onChange={(v) => update("duration", v)} options={DURATIONS} />
            </MField>
          </div>

          <div className="grid grid-cols-2 gap-[10px]">
            <MField label="Total Marks">
              <MInput
                type="number"
                value={String(form.totalMarks)}
                onChange={(v) => update("totalMarks", Math.max(0, parseInt(v || "0", 10)))}
                placeholder="50"
              />
            </MField>
            <MField label="Questions">
              <MInput
                type="number"
                value={String(form.numQuestions)}
                onChange={(v) => update("numQuestions", Math.max(0, parseInt(v || "0", 10)))}
                placeholder="20"
              />
            </MField>
          </div>

          <MField label="Question Types">
            <div className="flex flex-wrap gap-[7px]">
              {QUESTION_TYPES.map((t) => {
                const active = form.types.includes(t.key);
                return (
                  <button type="button" key={t.key}
                    onClick={() => toggleType(t.key)}
                    className="px-[12px] py-[8px] rounded-full flex items-center gap-[5px] active:scale-[0.96] transition-transform"
                    style={{
                      background: active ? MA.P : MA.SURFACE,
                      color: active ? "#fff" : MA.T2,
                      fontSize: 11, fontWeight: 700, letterSpacing: "-0.15px",
                      boxShadow: active
                        ? `0 1px 2px ${MA.P}33, 0 3px 10px ${MA.P}4d`
                        : "none",
                      fontFamily: MA.FONT, border: "none", cursor: "pointer",
                    }}>
                    {active && <span className="w-[5px] h-[5px] rounded-full" style={{ background: "#fff" }} />}
                    {t.label}
                  </button>
                );
              })}
            </div>
          </MField>

          <MField label="Special Instructions (optional)">
            <textarea
              value={form.instructions}
              onChange={(e) => update("instructions", e.target.value)}
              rows={2}
              placeholder="e.g. Include diagrams, focus on application-based questions"
              className="w-full rounded-[12px] px-[14px] py-[11px] text-[13px] font-medium outline-none resize-none"
              style={{
                background: MA.SURFACE,
                color: MA.T1,
                fontFamily: MA.FONT,
                border: "1px solid transparent",
                letterSpacing: "-0.1px",
              }}
            />
          </MField>

          <button type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="w-full mt-[6px] h-[48px] rounded-[14px] flex items-center justify-center gap-[8px] active:scale-[0.98] transition-transform"
            style={{
              background: loading ? MA.T4 : MA.P,
              color: "#fff",
              fontSize: 14, fontWeight: 800, letterSpacing: "-0.2px",
              boxShadow: loading ? "none" : "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.32)",
              fontFamily: MA.FONT, border: "none",
              cursor: loading ? "not-allowed" : "pointer",
            }}>
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.5 7h7.5l-6 4.5L18 21l-6-4.5L6 21l2-7.5L2 9h7.5z"/></svg>
                Generate Paper
              </>
            )}
          </button>
        </div>

        {/* Output */}
        {loading && !paper && (
          <div className="mx-4 bg-white rounded-[22px] py-10 flex flex-col items-center gap-[10px]" style={{ boxShadow: MA.SH, border: MA.BDR }}>
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: MA.P }} />
            <div className="text-[12px] font-semibold" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>AI aapka paper bana raha hai…</div>
          </div>
        )}

        {paper && (
          <div className="mx-4 mb-[14px] rounded-[22px] overflow-hidden" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
            <PaperHeader paper={paper} form={form} />
            <div className="px-[16px] py-[14px]">
              <div className="flex gap-[8px] mb-[14px]">
                <ActionBtn onClick={() => setShowAnswers((p) => !p)} primary={showAnswers} label={showAnswers ? "Hide Answers" : "Show Answers"} />
                <ActionBtn onClick={handleCopy} label={copied ? "Copied" : "Copy"} icon={copied ? <Check className="w-[13px] h-[13px]" /> : <Copy className="w-[13px] h-[13px]" />} />
                <ActionBtn onClick={handlePrint} label="Print" icon={<Printer className="w-[13px] h-[13px]" />} />
              </div>

              <PaperBody paper={paper} showAnswers={showAnswers} />

              <button type="button"
                onClick={handleReset}
                className="w-full mt-[14px] h-[42px] rounded-[12px] flex items-center justify-center gap-[6px] active:scale-[0.98] transition-transform"
                style={{
                  background: MA.SURFACE, color: MA.T2,
                  fontSize: 12, fontWeight: 700, letterSpacing: "-0.15px",
                  fontFamily: MA.FONT, border: "none",
                }}>
                <RefreshCw className="w-[13px] h-[13px]" />
                Start Over
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh" }}>
        <div className="max-w-[1500px] mx-auto px-8 pt-8 pb-12">

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-[7px] text-[10px] font-extrabold uppercase mb-[8px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
              <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: MA.P }} />
              Teacher Dashboard · Exam
            </div>
            <h1 className="text-[40px] font-extrabold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.4px" }}>Exam Generator</h1>
            <div className="text-[14px] font-medium mt-[8px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
              Apni requirements ke hisaab se AI se exam paper banwao.
            </div>
          </div>

          {/* Hero banner */}
          <div className="rounded-[28px] px-8 py-7 relative overflow-hidden mb-5"
            style={{ background: MA.HERO_GRAD, boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
            <div className="relative z-[2]">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-[52px] h-[52px] rounded-[15px] flex items-center justify-center text-white"
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    backdropFilter: "blur(22px)",
                    WebkitBackdropFilter: "blur(22px)",
                    border: "0.5px solid rgba(255,255,255,0.22)",
                    boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                  }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>AI Exam Paper</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>
                    Subject · Grade · Difficulty
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-[6px] px-4 py-[7px] rounded-full text-[11px] font-extrabold"
                  style={{
                    background: "rgba(255,170,0,0.2)",
                    border: "0.5px solid rgba(255,170,0,0.5)",
                    color: "#FFE699",
                    letterSpacing: "0.3px",
                  }}>
                  <span className="w-[6px] h-[6px] rounded-full" style={{ background: "#FFDD55", boxShadow: "0 0 8px #FFDD55" }} />
                  AI
                </div>
              </div>
              <div className="text-[18px] font-semibold text-white leading-[1.45]" style={{ letterSpacing: "-0.2px" }}>
                Customize <b className="font-extrabold">question types, marks, difficulty</b> — AI ek exam-ready paper banayega.
              </div>
            </div>
          </div>

          {/* 2-column: Form (left) + Output (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

            {/* Form card */}
            <div className="lg:col-span-2 rounded-[22px] p-6" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
              <SectionLabel>Basics</SectionLabel>

              <MField label="Subject">
                <MInput
                  value={form.subject}
                  onChange={(v) => update("subject", v)}
                  placeholder="e.g. Mathematics, Physics"
                />
              </MField>

              <div className="grid grid-cols-2 gap-3">
                <MField label="Grade">
                  <MSelect value={form.grade} onChange={(v) => update("grade", v)} options={GRADES} />
                </MField>
                <MField label="Board">
                  <MSelect value={form.board} onChange={(v) => update("board", v)} options={BOARDS} />
                </MField>
              </div>

              <MField label="Topics / Chapters">
                <textarea
                  value={form.topics}
                  onChange={(e) => update("topics", e.target.value)}
                  rows={3}
                  placeholder="e.g. Quadratic Equations, Arithmetic Progression, Trigonometry"
                  className="w-full rounded-[12px] px-[14px] py-[11px] text-[13px] font-medium outline-none resize-none"
                  style={{
                    background: MA.SURFACE,
                    color: MA.T1,
                    fontFamily: MA.FONT,
                    border: "1px solid transparent",
                    letterSpacing: "-0.1px",
                  }}
                />
              </MField>

              <div className="h-[1px] my-4" style={{ background: MA.SURFACE2 }} />

              <SectionLabel>Paper Setup</SectionLabel>

              <div className="grid grid-cols-2 gap-3">
                <MField label="Difficulty">
                  <MSelect value={form.difficulty} onChange={(v) => update("difficulty", v)} options={DIFFICULTIES} />
                </MField>
                <MField label="Duration">
                  <MSelect value={form.duration} onChange={(v) => update("duration", v)} options={DURATIONS} />
                </MField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <MField label="Total Marks">
                  <MInput
                    type="number"
                    value={String(form.totalMarks)}
                    onChange={(v) => update("totalMarks", Math.max(0, parseInt(v || "0", 10)))}
                    placeholder="50"
                  />
                </MField>
                <MField label="Questions">
                  <MInput
                    type="number"
                    value={String(form.numQuestions)}
                    onChange={(v) => update("numQuestions", Math.max(0, parseInt(v || "0", 10)))}
                    placeholder="20"
                  />
                </MField>
              </div>

              <MField label="Question Types">
                <div className="flex flex-wrap gap-2">
                  {QUESTION_TYPES.map((t) => {
                    const active = form.types.includes(t.key);
                    return (
                      <button type="button" key={t.key}
                        onClick={() => toggleType(t.key)}
                        className="px-[14px] py-[9px] rounded-full flex items-center gap-[6px] hover:scale-[1.03] active:scale-[0.96] transition-transform"
                        style={{
                          background: active ? MA.P : MA.SURFACE,
                          color: active ? "#fff" : MA.T2,
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.15px",
                          boxShadow: active
                            ? `0 1px 2px ${MA.P}33, 0 3px 10px ${MA.P}4d`
                            : "none",
                          fontFamily: MA.FONT, border: "none", cursor: "pointer",
                        }}>
                        {active && <span className="w-[5px] h-[5px] rounded-full" style={{ background: "#fff" }} />}
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </MField>

              <MField label="Special Instructions (optional)">
                <textarea
                  value={form.instructions}
                  onChange={(e) => update("instructions", e.target.value)}
                  rows={2}
                  placeholder="e.g. Include diagrams, focus on application-based questions"
                  className="w-full rounded-[12px] px-[14px] py-[11px] text-[13px] font-medium outline-none resize-none"
                  style={{
                    background: MA.SURFACE,
                    color: MA.T1,
                    fontFamily: MA.FONT,
                    border: "1px solid transparent",
                    letterSpacing: "-0.1px",
                  }}
                />
              </MField>

              <button type="button"
                onClick={handleGenerate}
                disabled={loading}
                className="w-full mt-2 h-14 rounded-[14px] flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.98] transition-transform"
                style={{
                  background: loading ? MA.T4 : MA.P,
                  color: "#fff",
                  fontSize: 15, fontWeight: 800, letterSpacing: "-0.2px",
                  boxShadow: loading ? "none" : "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.32)",
                  fontFamily: MA.FONT, border: "none",
                  cursor: loading ? "not-allowed" : "pointer",
                }}>
                {loading ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Generating…</>
                ) : (
                  <>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.5 7h7.5l-6 4.5L18 21l-6-4.5L6 21l2-7.5L2 9h7.5z"/></svg>
                    Generate Paper
                  </>
                )}
              </button>
            </div>

            {/* Output panel */}
            <div className="lg:col-span-3 rounded-[22px] overflow-hidden" style={{ background: MA.CARD, boxShadow: MA.SH, border: MA.BDR }}>
              {!paper && !loading && (
                <div className="h-full flex flex-col items-center justify-center py-24 px-8 text-center">
                  <div className="w-20 h-20 rounded-[22px] flex items-center justify-center mb-5"
                    style={{ background: "linear-gradient(145deg, rgba(9,87,247,0.1) 0%, rgba(123,63,244,0.12) 100%)", color: MA.P, boxShadow: "0 0 0 10px rgba(9,87,247,0.04), inset 0 1px 0 rgba(255,255,255,0.6)" }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </div>
                  <div className="text-[18px] font-extrabold mb-[6px]" style={{ color: MA.T1, letterSpacing: "-0.4px" }}>Paper yahan render hoga</div>
                  <div className="text-[13px] font-medium" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>Form bharo aur <b style={{ color: MA.P, fontWeight: 800 }}>Generate</b> dabao.</div>
                </div>
              )}

              {loading && !paper && (
                <div className="h-full flex flex-col items-center justify-center py-24 gap-3">
                  <Loader2 className="w-9 h-9 animate-spin" style={{ color: MA.P }} />
                  <div className="text-[14px] font-semibold" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>AI aapka paper bana raha hai…</div>
                </div>
              )}

              {paper && (
                <div>
                  <PaperHeader paper={paper} form={form} />
                  <div className="px-6 py-5">
                    <div className="flex gap-2 mb-5">
                      <ActionBtn onClick={() => setShowAnswers((p) => !p)} primary={showAnswers} label={showAnswers ? "Hide Answers" : "Show Answers"} />
                      <ActionBtn onClick={handleCopy} label={copied ? "Copied" : "Copy"} icon={copied ? <Check className="w-[14px] h-[14px]" /> : <Copy className="w-[14px] h-[14px]" />} />
                      <ActionBtn onClick={handlePrint} label="Print" icon={<Printer className="w-[14px] h-[14px]" />} />
                    </div>

                    <PaperBody paper={paper} showAnswers={showAnswers} />

                    <button type="button"
                      onClick={handleReset}
                      className="w-full mt-5 h-12 rounded-[12px] flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.98] transition-transform"
                      style={{
                        background: MA.SURFACE, color: MA.T2,
                        fontSize: 13, fontWeight: 700, letterSpacing: "-0.15px",
                        fontFamily: MA.FONT, border: "none",
                      }}>
                      <RefreshCw className="w-[14px] h-[14px]" />
                      Start Over
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

      {/* Print-only styles */}
      <style>{`
        @media print {
          body { background: #fff !important; }
          .md\\:hidden, aside, nav, header, .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
};

export default Exam;

// ══════════════════════════ Helpers & sub-components ══════════════════════════

const paperToText = (p: GeneratedPaper): string => {
  const lines: string[] = [];
  if (p.title) lines.push(p.title);
  if (p.subject || p.grade) lines.push(`${p.subject ?? ""} ${p.grade ? "· " + p.grade : ""}`.trim());
  if (p.duration || p.totalMarks) lines.push(`Duration: ${p.duration ?? "—"}    Total Marks: ${p.totalMarks ?? "—"}`);
  if (p.generalInstructions?.length) {
    lines.push("\nGeneral Instructions:");
    p.generalInstructions.forEach((ins, i) => lines.push(`${i + 1}. ${ins}`));
  }
  p.sections?.forEach((s) => {
    lines.push(`\n${s.title ?? "Section"}${s.marks ? ` (${s.marks} marks)` : ""}`);
    if (s.instructions) lines.push(s.instructions);
    s.questions?.forEach((q, i) => {
      lines.push(`\n${q.number ?? i + 1}. ${q.question ?? ""}${q.marks ? ` [${q.marks}]` : ""}`);
      q.options?.forEach((o, oi) => lines.push(`   (${String.fromCharCode(97 + oi)}) ${o}`));
    });
  });
  return lines.join("\n");
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[9px] font-extrabold uppercase mb-[10px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
    {children}
  </div>
);

const MField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-[12px]">
    <div className="text-[10px] font-extrabold uppercase mb-[6px]" style={{ color: MA.T2, letterSpacing: "0.8px" }}>{label}</div>
    {children}
  </div>
);

const MInput = ({ value, onChange, placeholder, type = "text" }:
  { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) => (
  <input type={type}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className="w-full rounded-[12px] px-[14px] py-[11px] text-[13px] font-medium outline-none"
    style={{
      background: MA.SURFACE,
      color: MA.T1,
      fontFamily: MA.FONT,
      border: "1px solid transparent",
      letterSpacing: "-0.1px",
    }}
  />
);

const MSelect = ({ value, onChange, options }:
  { value: string; onChange: (v: string) => void; options: string[] }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-[12px] px-[14px] py-[11px] text-[13px] font-medium outline-none appearance-none"
    style={{
      background: MA.SURFACE,
      color: MA.T1,
      fontFamily: MA.FONT,
      border: "1px solid transparent",
      letterSpacing: "-0.1px",
      backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235070B0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>")`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 14px center",
      paddingRight: 36,
    }}
  >
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

const ActionBtn = ({ label, onClick, icon, primary }:
  { label: string; onClick: () => void; icon?: React.ReactNode; primary?: boolean }) => (
  <button type="button"
    onClick={onClick}
    className="flex-1 h-[36px] rounded-[10px] flex items-center justify-center gap-[5px] active:scale-[0.96] transition-transform"
    style={{
      background: primary ? MA.P : MA.SURFACE,
      color: primary ? "#fff" : MA.T2,
      fontSize: 11, fontWeight: 700, letterSpacing: "-0.15px",
      fontFamily: MA.FONT, border: "none", cursor: "pointer",
    }}>
    {icon}
    {label}
  </button>
);

const PaperHeader = ({ paper, form }: { paper: GeneratedPaper; form: FormData }) => (
  <div className="px-[16px] py-[14px] relative overflow-hidden"
    style={{ background: MA.HERO_GRAD }}>
    <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "1.6px" }}>
      {paper.board || form.board} · {paper.grade || form.grade}
    </div>
    <div className="text-[17px] font-extrabold text-white mt-[3px]" style={{ letterSpacing: "-0.4px" }}>
      {paper.title || `${paper.subject || form.subject} — ${form.difficulty}`}
    </div>
    <div className="flex items-center gap-[12px] mt-[8px] text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.78)" }}>
      <span>⏱ {paper.duration || form.duration}</span>
      <span style={{ color: "rgba(255,255,255,0.4)" }}>·</span>
      <span>📝 {paper.totalMarks || form.totalMarks} marks</span>
    </div>
  </div>
);

const PaperBody = ({ paper, showAnswers, desktop }:
  { paper: GeneratedPaper; showAnswers: boolean; desktop?: boolean }) => {
  if (!paper.sections?.length) {
    return (
      <div className="text-[12px] font-medium" style={{ color: MA.T3 }}>
        Paper ka data khaali hai.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[14px]">
      {paper.generalInstructions && paper.generalInstructions.length > 0 && (
        <div className={desktop ? "rounded-lg border p-4" : "rounded-[12px] p-[12px]"}
          style={{
            background: desktop ? T.amberL : "rgba(255,170,0,0.08)",
            border: desktop ? `1px solid ${T.amberL}` : "1px solid rgba(255,170,0,0.25)",
          }}>
          <div className="text-[10px] font-extrabold uppercase mb-[6px]" style={{ color: desktop ? T.amber : MA.ORANGE, letterSpacing: "1.2px" }}>
            General Instructions
          </div>
          <ol className={`${desktop ? "text-[13px]" : "text-[12px]"} font-medium leading-[1.6] pl-[18px]`} style={{ color: desktop ? T.ink1 : MA.T2, listStyle: "decimal" }}>
            {paper.generalInstructions.map((ins, i) => <li key={i}>{ins}</li>)}
          </ol>
        </div>
      )}

      {paper.sections.map((section, si) => (
        <div key={si}>
          <div className="flex items-baseline justify-between mb-[8px]">
            <div className={`${desktop ? "text-[14px]" : "text-[13px]"} font-extrabold`} style={{ color: desktop ? T.ink0 : MA.T1, letterSpacing: "-0.2px" }}>
              {section.title || `Section ${si + 1}`}
            </div>
            {section.marks != null && (
              <div className="text-[10px] font-extrabold px-[8px] py-[3px] rounded-full"
                style={{ background: desktop ? T.blueL : "rgba(9,87,247,0.1)", color: desktop ? T.blue : MA.P, letterSpacing: "0.3px" }}>
                {section.marks} marks
              </div>
            )}
          </div>
          {section.instructions && (
            <div className="text-[11px] font-medium italic mb-[10px]" style={{ color: desktop ? T.ink2 : MA.T3 }}>
              {section.instructions}
            </div>
          )}
          <div className="flex flex-col gap-[10px]">
            {section.questions?.map((q, qi) => (
              <div key={qi} className={desktop ? "border-l-2 pl-4 py-1" : "rounded-[12px] p-[12px]"}
                style={{
                  background: desktop ? "transparent" : MA.SURFACE,
                  borderColor: desktop ? T.bdr : undefined,
                }}>
                <div className="flex items-start gap-[8px]">
                  <span className={`${desktop ? "text-[13px]" : "text-[12px]"} font-extrabold flex-shrink-0`} style={{ color: desktop ? T.blue : MA.P }}>
                    {q.number ?? qi + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`${desktop ? "text-[13.5px]" : "text-[12.5px]"} font-semibold leading-[1.55]`} style={{ color: desktop ? T.ink0 : MA.T1, letterSpacing: "-0.1px" }}>
                      {q.question || "—"}
                      {q.marks != null && (
                        <span className="text-[10px] font-extrabold ml-[6px] px-[6px] py-[1px] rounded-[5px]"
                          style={{ background: desktop ? T.s2 : "rgba(9,87,247,0.08)", color: desktop ? T.ink2 : MA.P }}>
                          {q.marks}m
                        </span>
                      )}
                    </div>
                    {q.options && q.options.length > 0 && (
                      <div className="mt-[8px] flex flex-col gap-[4px] pl-[4px]">
                        {q.options.map((op, oi) => (
                          <div key={oi} className={`${desktop ? "text-[13px]" : "text-[12px]"} font-medium`} style={{ color: desktop ? T.ink1 : MA.T2 }}>
                            <span className="font-bold mr-[6px]" style={{ color: desktop ? T.ink2 : MA.T3 }}>
                              ({String.fromCharCode(97 + oi)})
                            </span>
                            {op}
                          </div>
                        ))}
                      </div>
                    )}
                    {showAnswers && (q.answer || q.solution) && (
                      <div className={`mt-[8px] rounded-[8px] px-[10px] py-[7px] ${desktop ? "text-[12.5px]" : "text-[11.5px]"} font-medium`}
                        style={{
                          background: desktop ? T.greenL : "rgba(0,200,83,0.08)",
                          color: desktop ? T.green : MA.GREEN,
                          border: `1px solid ${desktop ? "#B2F2BB" : "rgba(0,200,83,0.2)"}`,
                        }}>
                        <b className="font-extrabold">Ans: </b>
                        {q.answer && <span>{q.answer}</span>}
                        {q.solution && <div className="mt-[3px] font-medium" style={{ color: desktop ? T.ink1 : MA.T2 }}>{q.solution}</div>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Desktop field helpers ────────────────────────────────────────────────────
const DField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-3">
    <label className="block text-[11px] font-bold uppercase tracking-[1px] mb-1" style={{ color: T.ink2 }}>{label}</label>
    {children}
  </div>
);

const DInput = ({ value, onChange, placeholder, type = "text" }:
  { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) => (
  <input type={type}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className="w-full rounded-lg px-3 py-2 text-[13px] outline-none border"
    style={{ background: T.s1, color: T.ink0, borderColor: T.bdr }}
  />
);

const DSelect = ({ value, onChange, options }:
  { value: string; onChange: (v: string) => void; options: string[] }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-lg px-3 py-2 text-[13px] outline-none border"
    style={{ background: T.s1, color: T.ink0, borderColor: T.bdr }}
  >
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

const PaperHeaderDesktop = ({ paper, form, totalQ }:
  { paper: GeneratedPaper; form: FormData; totalQ: number }) => (
  <div className="text-center border-b pb-5" style={{ borderColor: T.bdr }}>
    <div className="text-[11px] font-bold uppercase tracking-[2px]" style={{ color: T.ink2 }}>
      {paper.board || form.board} · {paper.grade || form.grade}
    </div>
    <div className="text-[22px] font-extrabold mt-1" style={{ color: T.ink0, letterSpacing: "-0.5px" }}>
      {paper.title || `${paper.subject || form.subject} — Examination`}
    </div>
    <div className="flex items-center justify-center gap-4 text-[13px] font-semibold mt-2" style={{ color: T.ink1 }}>
      <span>Duration: {paper.duration || form.duration}</span>
      <span style={{ color: T.ink2 }}>·</span>
      <span>Max Marks: {paper.totalMarks || form.totalMarks}</span>
      <span style={{ color: T.ink2 }}>·</span>
      <span>Questions: {totalQ}</span>
    </div>
  </div>
);
