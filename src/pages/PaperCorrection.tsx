import { useState, useRef, useCallback, useMemo } from "react";
import {
  Loader2,
  Upload,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Target,
  Sparkles,
  GraduationCap,
  RefreshCw,
  Award,
  BookOpen,
  Lightbulb,
  Heart,
  PenLine,
  Eye,
  Users,
  Brain,
  MessageCircle,
  Mail,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
// Bundle the PDF.js worker via Vite so it loads from same-origin (CSP-safe).
// Loading from CDN was being blocked by the page CSP and triggered a blob:
// "fake worker" fallback that is also blocked.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { AIController } from "../ai/controller/ai-controller";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ── Types — must match the JSON shape returned by paper_correction handler ──
type MistakeType =
  | "none" | "conceptual" | "calculation" | "missing_step"
  | "silly_mistake" | "incomplete" | "wrong_method"
  | "presentation" | "no_attempt" | "unreadable";

interface QuestionResult {
  number: string;
  question_text: string;
  max_marks: number;
  marks_awarded: number;
  verdict: "correct" | "partial" | "wrong" | "blank" | "unreadable";
  mistake_type?: MistakeType;
  student_answer_summary: string;
  correct_answer: string;
  comment: string;
  step_marks_breakdown?: string | null;
}

interface ConceptUnderstanding {
  concept: string;
  level: "strong" | "developing" | "weak";
  evidence: string;
}

interface ImprovementItem {
  area: string;
  action: string;
  priority: "high" | "medium" | "low";
}

interface CorrectionResult {
  subject: string;
  grade: string | null;
  totalMarks: number;
  marksScored: number;
  percentage: number;
  grade_band: "A+" | "A" | "B" | "C" | "D" | "E" | "F";
  overall_summary: string;
  handwriting_note?: string;
  presentation_note?: string;
  effort_note?: string;
  questions: QuestionResult[];
  concept_understanding?: ConceptUnderstanding[];
  strengths: string[];
  weaknesses: string[];
  improvement_plan: ImprovementItem[];
  encouragement: string;
  parent_note?: string;
  student_letter?: string;
}

const MAX_PAGES = 8;
const MAX_FILE_MB = 25;
// Target output image size — each page is rendered/downscaled so its longest
// edge equals TARGET_LONG_EDGE_PX. JPEG quality kept low because vision
// models grade handwriting fine at 1100px @ q=0.55. Combined with the page
// cap, total payload stays comfortably under the Firebase Functions 10 MB
// callable request limit (typical: ~80-110 KB per page → ~700 KB for 8 pp).
const TARGET_LONG_EDGE_PX = 1100;
const JPEG_QUALITY = 0.55;
// Hard ceiling on the assembled images payload. We refuse to send more than
// this so the client gets a friendly message instead of a 400 from the
// Functions runtime ("payload too large").
const MAX_TOTAL_IMAGE_BYTES = 7 * 1024 * 1024;

// ── Verdict styling ─────────────────────────────────────────────────────────
const VERDICT_STYLES: Record<QuestionResult["verdict"], { bg: string; ring: string; text: string; label: string; icon: React.ReactNode }> = {
  correct:    { bg: "bg-emerald-50",  ring: "ring-emerald-200",  text: "text-emerald-700",  label: "Correct",     icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  partial:    { bg: "bg-amber-50",    ring: "ring-amber-200",    text: "text-amber-700",    label: "Partial",     icon: <AlertCircle className="w-3.5 h-3.5" /> },
  wrong:      { bg: "bg-rose-50",     ring: "ring-rose-200",     text: "text-rose-700",     label: "Incorrect",   icon: <X className="w-3.5 h-3.5" /> },
  blank:      { bg: "bg-slate-50",    ring: "ring-slate-200",    text: "text-slate-600",    label: "Not attempted", icon: <X className="w-3.5 h-3.5" /> },
  unreadable: { bg: "bg-violet-50",   ring: "ring-violet-200",   text: "text-violet-700",   label: "Unreadable",  icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

const PRIORITY_STYLES: Record<ImprovementItem["priority"], string> = {
  high:   "bg-rose-50 text-rose-700 ring-rose-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low:    "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

// Short, classroom-style labels for the mistake taxonomy returned by the AI.
const MISTAKE_LABELS: Record<MistakeType, string> = {
  none:           "—",
  conceptual:     "Concept gap",
  calculation:    "Calculation slip",
  missing_step:   "Missing step",
  silly_mistake:  "Silly mistake",
  incomplete:     "Incomplete",
  wrong_method:   "Wrong method",
  presentation:   "Presentation",
  no_attempt:     "Not attempted",
  unreadable:     "Unreadable",
};
const MISTAKE_TONE: Record<MistakeType, string> = {
  none:           "bg-slate-50 text-slate-500 ring-slate-200",
  conceptual:     "bg-rose-50 text-rose-700 ring-rose-200",
  calculation:    "bg-amber-50 text-amber-800 ring-amber-200",
  missing_step:   "bg-amber-50 text-amber-800 ring-amber-200",
  silly_mistake:  "bg-yellow-50 text-yellow-800 ring-yellow-200",
  incomplete:     "bg-orange-50 text-orange-700 ring-orange-200",
  wrong_method:   "bg-rose-50 text-rose-700 ring-rose-200",
  presentation:   "bg-blue-50 text-blue-700 ring-blue-200",
  no_attempt:     "bg-slate-100 text-slate-600 ring-slate-200",
  unreadable:     "bg-violet-50 text-violet-700 ring-violet-200",
};

const CONCEPT_LEVEL_STYLES: Record<ConceptUnderstanding["level"], { dot: string; text: string; label: string }> = {
  strong:     { dot: "bg-emerald-500", text: "text-emerald-700", label: "Strong" },
  developing: { dot: "bg-amber-500",   text: "text-amber-700",   label: "Developing" },
  weak:       { dot: "bg-rose-500",    text: "text-rose-700",    label: "Weak" },
};

const GRADE_BAND_STYLES: Record<CorrectionResult["grade_band"], { bg: string; text: string; ring: string }> = {
  "A+": { bg: "bg-emerald-500",  text: "text-white", ring: "ring-emerald-200" },
  "A":  { bg: "bg-emerald-400",  text: "text-white", ring: "ring-emerald-200" },
  "B":  { bg: "bg-blue-500",     text: "text-white", ring: "ring-blue-200" },
  "C":  { bg: "bg-amber-500",    text: "text-white", ring: "ring-amber-200" },
  "D":  { bg: "bg-orange-500",   text: "text-white", ring: "ring-orange-200" },
  "E":  { bg: "bg-rose-500",     text: "text-white", ring: "ring-rose-200" },
  "F":  { bg: "bg-rose-700",     text: "text-white", ring: "ring-rose-200" },
};

// ── Main component ─────────────────────────────────────────────────────────
const PaperCorrection = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CorrectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [studentName, setStudentName] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [answerKey, setAnswerKey] = useState("");

  // ── PDF → JPEG conversion ──────────────────────────────────────────────
  // Each page is rendered to a canvas at a scale chosen so the longest side
  // equals TARGET_LONG_EDGE_PX, then encoded as JPEG. This caps total
  // payload predictably regardless of source PDF DPI.
  const renderPdfToImages = async (f: File): Promise<string[]> => {
    const buf = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pageLimit = Math.min(pdf.numPages, MAX_PAGES);
    const images: string[] = [];

    for (let i = 1; i <= pageLimit; i++) {
      const page = await pdf.getPage(i);
      // Native viewport at scale=1 so we know the source dimensions.
      const baseViewport = page.getViewport({ scale: 1 });
      const longest = Math.max(baseViewport.width, baseViewport.height);
      const targetScale = TARGET_LONG_EDGE_PX / longest;
      const viewport = page.getViewport({ scale: targetScale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context not available.");
      // Fill white so transparent backgrounds don't end up black in JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      images.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    }
    return images;
  };

  // Approximate decoded byte size of a base64 data URL.
  const dataUrlBytes = (dataUrl: string): number => {
    const commaIdx = dataUrl.indexOf(",");
    const base64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
    // base64 expands raw bytes by 4/3.
    return Math.floor(base64Len * 0.75);
  };

  const handleFile = useCallback(async (selectedFile: File) => {
    if (!selectedFile || selectedFile.type !== "application/pdf") {
      setError("Only PDF files are allowed.");
      return;
    }
    if (selectedFile.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File size must be under ${MAX_FILE_MB} MB.`);
      return;
    }
    setError(null);
    setResult(null);
    setFile(selectedFile);
    setExtracting(true);
    try {
      const imgs = await renderPdfToImages(selectedFile);
      setPageImages(imgs);
      setPageCount(imgs.length);
    } catch (e) {
      console.error("[PaperCorrection] PDF render failed", e);
      setError("Could not read PDF. Try a different file or re-scan.");
      setFile(null);
      setPageImages([]);
    }
    setExtracting(false);
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const reset = () => {
    setFile(null);
    setPageImages([]);
    setPageCount(0);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async () => {
    if (!pageImages.length) {
      setError("Upload a scanned paper first.");
      return;
    }
    // Defensive — refuse oversize payloads on the client so the user sees a
    // clear "too many pages" hint instead of a generic 400 from Cloud Run.
    const totalBytes = pageImages.reduce((sum, img) => sum + dataUrlBytes(img), 0);
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      const mb = (totalBytes / 1024 / 1024).toFixed(1);
      setError(`Paper is too large to send (${mb} MB). Try fewer pages or a lower-res scan.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await AIController.getPaperCorrection({
        images: pageImages,
        subject: subject.trim() || undefined,
        grade: grade.trim() || undefined,
        totalMarks: totalMarks ? Number(totalMarks) : undefined,
        studentName: studentName.trim() || undefined,
        answerKey: answerKey.trim() || undefined,
      });
      if (res.status === "success" && res.data) {
        setResult(res.data as CorrectionResult);
        setTimeout(() => {
          document.getElementById("correction-results")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 100);
      } else {
        // All non-success variants (no_data | error | not_implemented) carry message.
        const msg = "message" in res ? res.message : "";
        setError(msg || "Could not correct the paper. Please try again.");
      }
    } catch (e) {
      console.error("[PaperCorrection] submit failed", e);
      setError("AI service failed. Please retry in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-[#fbfbfd]">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1e3272]/10 text-[#1e3272] text-[12px] font-medium mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            AI Paper Correction
          </div>
          <h1 className="text-[28px] sm:text-[32px] font-normal tracking-[-0.02em] text-slate-900 leading-[1.15]">
            Scan, upload, and let AI correct it like a real teacher.
          </h1>
          <p className="mt-2 text-[15px] text-slate-500 max-w-[680px] leading-[1.5]">
            Upload a student's scanned exam paper as PDF. The AI reads every
            question, awards marks, identifies strengths and weaknesses, and
            writes warm Hinglish feedback — just like you would in red pen.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6">
          {/* ── Upload zone ────────────────────────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              className={[
                "relative rounded-2xl border-2 border-dashed transition-all cursor-pointer",
                "flex flex-col items-center justify-center text-center",
                "min-h-[240px] p-6",
                dragging
                  ? "border-[#1e3272] bg-[#1e3272]/5"
                  : file
                    ? "border-emerald-300 bg-emerald-50/40"
                    : "border-slate-300 bg-slate-50 hover:border-[#1e3272]/40 hover:bg-white",
              ].join(" ")}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={onPickFile}
              />

              {extracting ? (
                <>
                  <Loader2 className="w-8 h-8 text-[#1e3272] animate-spin" />
                  <div className="mt-3 text-[14px] font-medium text-slate-700">Reading PDF pages…</div>
                </>
              ) : file ? (
                <>
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <FileText className="w-6 h-6 text-emerald-700" />
                  </div>
                  <div className="mt-3 text-[14px] font-medium text-slate-900 truncate max-w-full">{file.name}</div>
                  <div className="text-[12px] text-slate-500 mt-1">
                    {pageCount} page{pageCount !== 1 ? "s" : ""} · {(file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); reset(); }}
                    className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-900"
                  >
                    <X className="w-3.5 h-3.5" /> Remove
                  </button>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-xl bg-[#1e3272]/10 flex items-center justify-center">
                    <Upload className="w-6 h-6 text-[#1e3272]" />
                  </div>
                  <div className="mt-3 text-[14px] font-medium text-slate-900">
                    Drop scanned paper here, or click to browse
                  </div>
                  <div className="text-[12px] text-slate-500 mt-1">
                    PDF up to {MAX_FILE_MB} MB · max {MAX_PAGES} pages per submission
                  </div>
                </>
              )}
            </div>

            {/* Page thumbnails */}
            {pageImages.length > 0 && !loading && (
              <div className="mt-4">
                <div className="text-[11.5px] font-medium uppercase tracking-wider text-slate-400 mb-2">
                  Pages detected
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {pageImages.map((img, i) => (
                    <div
                      key={i}
                      className="shrink-0 w-20 h-28 rounded-lg overflow-hidden border border-slate-200 bg-white relative"
                    >
                      <img src={img} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent text-white text-[10px] py-0.5 text-center">
                        Page {i + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Metadata side panel ────────────────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
            <div>
              <div className="text-[11.5px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                Paper details (optional but recommended)
              </div>
              <p className="text-[12px] text-slate-500 leading-[1.45]">
                Adding subject, total marks, and your answer key helps the AI
                grade more accurately. Skip any field — AI will infer.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Student name" value={studentName} onChange={setStudentName} placeholder="Aarav Kapoor" />
              <Field label="Subject" value={subject} onChange={setSubject} placeholder="Mathematics" />
              <Field label="Grade / class" value={grade} onChange={setGrade} placeholder="Class 8" />
              <Field label="Total marks" value={totalMarks} onChange={setTotalMarks} placeholder="40" type="number" />
            </div>

            <label className="block">
              <div className="text-[12px] font-medium text-slate-700 mb-1.5">
                Answer key / marking scheme (optional)
              </div>
              <textarea
                value={answerKey}
                onChange={(e) => setAnswerKey(e.target.value)}
                placeholder="Q1: 2x+5=15 → x=5 (2 marks)&#10;Q2: Photosynthesis is the process by which..."
                rows={5}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px] resize-none"
                maxLength={6000}
              />
            </label>

            {error && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[12.5px] px-3 py-2">
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={loading || extracting || !pageImages.length}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#1e3272] hover:bg-[#152244] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium text-[14px] py-3 rounded-xl transition"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Correcting paper… (1-3 min)
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Correct this paper
                </>
              )}
            </button>

            <p className="text-[11px] text-slate-400 text-center leading-[1.45]">
              AI vision reads every page. Larger papers take longer.
              Hand­writing must be reasonably legible for accurate grading.
            </p>
          </div>
        </div>

        {/* ── Results ────────────────────────────────────────────────── */}
        {result && (
          <div id="correction-results" className="mt-10 space-y-6">
            <ResultsHeader result={result} studentName={studentName} onReset={reset} />
            <OverallSummary result={result} />

            {/* Teacher's quick observations — handwriting / presentation / effort */}
            {(result.handwriting_note || result.presentation_note || result.effort_note) && (
              <ObservationsCard
                handwriting={result.handwriting_note}
                presentation={result.presentation_note}
                effort={result.effort_note}
              />
            )}

            <QuestionBreakdown questions={result.questions} />

            {result.concept_understanding && result.concept_understanding.length > 0 && (
              <ConceptUnderstandingCard items={result.concept_understanding} />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StrengthsCard items={result.strengths} />
              <WeaknessesCard items={result.weaknesses} />
            </div>

            <ImprovementPlan items={result.improvement_plan} />

            {/* Personal letter from teacher to student */}
            {result.student_letter && (
              <StudentLetterCard text={result.student_letter} studentName={studentName} />
            )}

            <Encouragement text={result.encouragement} />

            {/* Parent-facing note */}
            {result.parent_note && (
              <ParentNoteCard text={result.parent_note} studentName={studentName} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Sub-components ──────────────────────────────────────────────────────────

const Field = ({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) => (
  <label className="block">
    <div className="text-[12px] font-medium text-slate-700 mb-1.5">{label}</div>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px]"
    />
  </label>
);

const ResultsHeader = ({
  result, studentName, onReset,
}: {
  result: CorrectionResult;
  studentName: string;
  onReset: () => void;
}) => {
  const band = GRADE_BAND_STYLES[result.grade_band] ?? GRADE_BAND_STYLES.C;
  return (
    <div className="bg-gradient-to-br from-[#1e3272] to-[#0f1d4a] text-white rounded-2xl p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-medium uppercase tracking-wider mb-3">
            <GraduationCap className="w-3 h-3" /> Correction complete
          </div>
          <div className="text-[24px] sm:text-[28px] font-normal tracking-[-0.02em] leading-tight">
            {studentName || "Student"}'s {result.subject} paper
          </div>
          {result.grade && (
            <div className="text-[13px] text-white/70 mt-1">{result.grade}</div>
          )}
        </div>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[12.5px] font-medium transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Correct another
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-6 sm:gap-10">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/60">Marks scored</div>
          <div className="text-[42px] sm:text-[52px] font-light tracking-tight leading-none mt-1">
            {result.marksScored}
            <span className="text-[24px] sm:text-[28px] text-white/50 ml-1">/ {result.totalMarks}</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/60">Percentage</div>
          <div className="text-[42px] sm:text-[52px] font-light tracking-tight leading-none mt-1">
            {result.percentage.toFixed(1)}%
          </div>
        </div>
        <div className="ml-auto">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Grade</div>
          <div className={`inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-2xl text-[36px] sm:text-[40px] font-medium ring-4 ring-white/10 ${band.bg} ${band.text}`}>
            {result.grade_band}
          </div>
        </div>
      </div>
    </div>
  );
};

const OverallSummary = ({ result }: { result: CorrectionResult }) => {
  const counts = useMemo(() => {
    const c = { correct: 0, partial: 0, wrong: 0, blank: 0, unreadable: 0 };
    for (const q of result.questions) c[q.verdict] = (c[q.verdict] ?? 0) + 1;
    return c;
  }, [result.questions]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#1e3272]/10 flex items-center justify-center shrink-0">
          <Award className="w-4 h-4 text-[#1e3272]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-slate-900 mb-1">Teacher's overall note</div>
          <p className="text-[14px] text-slate-700 leading-[1.55]">{result.overall_summary}</p>
        </div>
      </div>

      <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Correct" value={counts.correct} tone="emerald" />
        <Stat label="Partial" value={counts.partial} tone="amber" />
        <Stat label="Wrong" value={counts.wrong} tone="rose" />
        <Stat label="Blank" value={counts.blank} tone="slate" />
        <Stat label="Unreadable" value={counts.unreadable} tone="violet" />
      </div>
    </div>
  );
};

const TONE_STYLES: Record<string, { bg: string; text: string }> = {
  emerald: { bg: "bg-emerald-50", text: "text-emerald-700" },
  amber:   { bg: "bg-amber-50",   text: "text-amber-700" },
  rose:    { bg: "bg-rose-50",    text: "text-rose-700" },
  slate:   { bg: "bg-slate-100",  text: "text-slate-600" },
  violet:  { bg: "bg-violet-50",  text: "text-violet-700" },
};

const Stat = ({ label, value, tone }: { label: string; value: number; tone: string }) => {
  const t = TONE_STYLES[tone] ?? TONE_STYLES.slate;
  return (
    <div className={`${t.bg} rounded-xl px-3 py-2.5 text-center`}>
      <div className={`text-[24px] font-light leading-none ${t.text}`}>{value}</div>
      <div className="text-[11px] text-slate-600 mt-1">{label}</div>
    </div>
  );
};

const QuestionBreakdown = ({ questions }: { questions: QuestionResult[] }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-6">
    <div className="flex items-center gap-2 mb-4">
      <BookOpen className="w-4 h-4 text-[#1e3272]" />
      <div className="text-[15px] font-medium text-slate-900">Question-by-question breakdown</div>
    </div>
    <div className="space-y-3">
      {questions.map((q, i) => {
        const v = VERDICT_STYLES[q.verdict] ?? VERDICT_STYLES.partial;
        const mistakeKey: MistakeType = q.mistake_type ?? "none";
        const showMistake = mistakeKey !== "none" && mistakeKey !== "no_attempt" && mistakeKey !== "unreadable";
        return (
          <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div className="text-[13px] font-medium text-slate-900 shrink-0">Q{q.number}</div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${v.bg} ${v.ring} ${v.text}`}>
                {v.icon} {v.label}
              </span>
              {showMistake && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${MISTAKE_TONE[mistakeKey]}`}>
                  {MISTAKE_LABELS[mistakeKey]}
                </span>
              )}
              <div className="ml-auto text-[13px] font-medium text-slate-900 shrink-0">
                {q.marks_awarded} / {q.max_marks}
                <span className="text-[11px] text-slate-500 ml-1">marks</span>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-[13px] text-slate-700 italic">"{q.question_text}"</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Student wrote</div>
                  <div className="text-[12.5px] text-slate-700 bg-slate-50 rounded-lg px-3 py-2 leading-[1.5]">{q.student_answer_summary}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Expected answer</div>
                  <div className="text-[12.5px] text-slate-700 bg-emerald-50 rounded-lg px-3 py-2 leading-[1.5]">{q.correct_answer}</div>
                </div>
              </div>
              {q.step_marks_breakdown && (
                <div className="text-[11.5px] text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
                  <span className="font-medium uppercase tracking-wider text-[10px] text-slate-400">Step marks:</span>
                  <span>{q.step_marks_breakdown}</span>
                </div>
              )}
              <div className="flex items-start gap-2 bg-[#1e3272]/5 rounded-lg px-3 py-2.5">
                <div className="w-5 h-5 rounded-full bg-[#1e3272] text-white flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold">T</span>
                </div>
                <div className="text-[13px] text-slate-800 leading-[1.5]">{q.comment}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const ObservationsCard = ({
  handwriting, presentation, effort,
}: {
  handwriting?: string;
  presentation?: string;
  effort?: string;
}) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-6">
    <div className="flex items-center gap-2 mb-4">
      <Eye className="w-4 h-4 text-[#1e3272]" />
      <div className="text-[15px] font-medium text-slate-900">Teacher's observations</div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {handwriting && (
        <ObsTile icon={<PenLine className="w-4 h-4 text-blue-700" />} bg="bg-blue-100" title="Handwriting" body={handwriting} />
      )}
      {presentation && (
        <ObsTile icon={<BookOpen className="w-4 h-4 text-violet-700" />} bg="bg-violet-100" title="Presentation" body={presentation} />
      )}
      {effort && (
        <ObsTile icon={<TrendingUp className="w-4 h-4 text-emerald-700" />} bg="bg-emerald-100" title="Effort" body={effort} />
      )}
    </div>
  </div>
);

const ObsTile = ({
  icon, bg, title, body,
}: { icon: React.ReactNode; bg: string; title: string; body: string }) => (
  <div className="border border-slate-200 rounded-xl p-4">
    <div className="flex items-center gap-2 mb-1.5">
      <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>{icon}</div>
      <div className="text-[12.5px] font-medium text-slate-900">{title}</div>
    </div>
    <p className="text-[13px] text-slate-700 leading-[1.5]">{body}</p>
  </div>
);

const ConceptUnderstandingCard = ({ items }: { items: ConceptUnderstanding[] }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-6">
    <div className="flex items-center gap-2 mb-4">
      <Brain className="w-4 h-4 text-[#1e3272]" />
      <div>
        <div className="text-[15px] font-medium text-slate-900">Concept understanding</div>
        <div className="text-[12px] text-slate-500">Topic-wise grasp based on this paper</div>
      </div>
    </div>
    <div className="space-y-2.5">
      {items.map((c, i) => {
        const s = CONCEPT_LEVEL_STYLES[c.level] ?? CONCEPT_LEVEL_STYLES.developing;
        return (
          <div key={i} className="flex items-start gap-3 border border-slate-200 rounded-xl p-3.5">
            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${s.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[13.5px] font-medium text-slate-900">{c.concept}</div>
                <span className={`text-[10.5px] font-medium uppercase tracking-wider ${s.text}`}>{s.label}</span>
              </div>
              <div className="text-[12.5px] text-slate-600 mt-1 leading-[1.5]">{c.evidence}</div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const StudentLetterCard = ({ text, studentName }: { text: string; studentName: string }) => (
  <div className="bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><path d=%22M0 39 L40 39%22 stroke=%22%23fef3c7%22 stroke-width=%221%22/></svg>')] bg-amber-50/40 border border-amber-200 rounded-2xl p-6 sm:p-8 relative overflow-hidden">
    <div className="absolute top-4 right-4 opacity-20">
      <MessageCircle className="w-12 h-12 text-amber-700" />
    </div>
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-amber-200 flex items-center justify-center">
        <PenLine className="w-4 h-4 text-amber-800" />
      </div>
      <div>
        <div className="text-[15px] font-medium text-slate-900">A note from your teacher</div>
        <div className="text-[12px] text-slate-600">Personal · written for {studentName || "you"}</div>
      </div>
    </div>
    <div className="text-[14.5px] text-slate-800 leading-[1.65] whitespace-pre-line italic relative z-10">
      {text}
    </div>
  </div>
);

const ParentNoteCard = ({ text, studentName }: { text: string; studentName: string }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-6">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
        <Users className="w-5 h-5 text-blue-700" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <div className="text-[13.5px] font-medium text-slate-900">Note for parent</div>
          <span className="text-[10.5px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
            Share-ready
          </span>
        </div>
        <p className="text-[13.5px] text-slate-700 leading-[1.55]">{text}</p>
        {studentName && (
          <button
            onClick={() => navigator.clipboard?.writeText(text).catch(() => undefined)}
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-blue-700 hover:underline"
          >
            <Mail className="w-3.5 h-3.5" />
            Copy parent note
          </button>
        )}
      </div>
    </div>
  </div>
);

const StrengthsCard = ({ items }: { items: string[] }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-6">
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
        <TrendingUp className="w-4 h-4 text-emerald-700" />
      </div>
      <div>
        <div className="text-[15px] font-medium text-slate-900">Strengths</div>
        <div className="text-[12px] text-slate-500">Yeh sab achha kiya hai</div>
      </div>
    </div>
    <ul className="space-y-2.5">
      {items.map((s, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-slate-700 leading-[1.5]">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  </div>
);

const WeaknessesCard = ({ items }: { items: string[] }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-6">
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
        <TrendingDown className="w-4 h-4 text-amber-700" />
      </div>
      <div>
        <div className="text-[15px] font-medium text-slate-900">Weak areas</div>
        <div className="text-[12px] text-slate-500">Yahan thodi mehnat aur chahiye</div>
      </div>
    </div>
    <ul className="space-y-2.5">
      {items.map((w, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-slate-700 leading-[1.5]">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  </div>
);

const ImprovementPlan = ({ items }: { items: ImprovementItem[] }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-6">
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
        <Target className="w-4 h-4 text-blue-700" />
      </div>
      <div>
        <div className="text-[15px] font-medium text-slate-900">Improvement plan</div>
        <div className="text-[12px] text-slate-500">Specific next steps for this week</div>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((it, i) => (
        <div key={i} className="border border-slate-200 rounded-xl p-4 hover:border-[#1e3272]/30 transition">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="text-[13.5px] font-medium text-slate-900 truncate">{it.area}</div>
            </div>
            <span className={`text-[10.5px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ring-inset ${PRIORITY_STYLES[it.priority]}`}>
              {it.priority}
            </span>
          </div>
          <div className="text-[13px] text-slate-700 leading-[1.5]">{it.action}</div>
        </div>
      ))}
    </div>
  </div>
);

const Encouragement = ({ text }: { text: string }) => (
  <div className="bg-gradient-to-br from-rose-50 to-amber-50 border border-rose-100 rounded-2xl p-6">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-sm">
        <Heart className="w-5 h-5 text-rose-500" />
      </div>
      <div>
        <div className="text-[12px] font-medium uppercase tracking-wider text-rose-700 mb-1">A note from teacher</div>
        <p className="text-[14.5px] text-slate-800 leading-[1.55] italic">"{text}"</p>
      </div>
    </div>
  </div>
);

export default PaperCorrection;
