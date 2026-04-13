import { useState, useRef, useCallback } from "react";
import { useAuth } from "../lib/AuthContext";
import { AIController } from "../ai/controller/ai-controller";
import * as pdfjsLib from "pdfjs-dist";
import {
  FileText, Upload, Sparkles, Loader2, AlertCircle, Layout,
  BookOpen, Brain, Target, Lightbulb, Star, Clock, Zap,
  ChevronDown, ChevronRight, CheckCircle2, BookMarked, X,
  FlaskConical, ScrollText, GraduationCap, RotateCcw
} from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const DIFFICULTY_COLORS: Record<string, string> = {
  Beginner: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Intermediate: "bg-amber-100 text-amber-700 border-amber-200",
  Advanced: "bg-rose-100 text-rose-700 border-rose-200",
};

const SummarizeLesson = () => {
  const { teacherData } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [extracting, setExtracting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});

  const toggleSection = (i: number) =>
    setExpandedSections((prev) => ({ ...prev, [i]: !prev[i] }));

  const extractTextFromPDF = async (file: File): Promise<{ text: string; pages: number }> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      fullText += `\n\n[Page ${i}]\n${pageText}`;
    }
    return { text: fullText.trim(), pages: pdf.numPages };
  };

  const handleFile = async (selectedFile: File) => {
    if (!selectedFile || selectedFile.type !== "application/pdf") {
      setError("Sirf PDF files allowed hain.");
      return;
    }
    if (selectedFile.size > 20 * 1024 * 1024) {
      setError("File size 20MB se zyada nahi honi chahiye.");
      return;
    }
    setError(null);
    setSummary(null);
    setFile(selectedFile);
    setExtracting(true);
    try {
      const { pages } = await extractTextFromPDF(selectedFile);
      setPageCount(pages);
    } catch {
      setError("PDF read karne mein problem aayi. Dusra file try karo.");
      setFile(null);
    }
    setExtracting(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, []);

  const handleGenerate = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setSummary(null);

    try {
      const { text } = await extractTextFromPDF(file);
      if (!text.trim()) {
        setError("PDF mein koi readable text nahi mila. Image-based PDF ho sakta hai.");
        setLoading(false);
        return;
      }

      const result = await AIController.getSummary({ text, fileName: file.name });
      console.log("[Summary] result:", result);

      if (result.status === "success" && result.data) {
        setSummary(result.data);
        setExpandedSections({});
      } else {
        setError(result.message || "AI summary generate nahi kar paya. Please try again.");
      }
    } catch (err: any) {
      console.error("[Summary] error:", err);
      setError("Kuch unexpected error hua. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPageCount(0);
    setSummary(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 pb-16 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-4 mb-8">
        <div>          <h1 className="ds-page-title flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-violet-600 flex items-center justify-center flex-shrink-0">
              <ScrollText className="w-5 h-5 text-white" />
            </span>
            Summarize Lesson
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest leading-none">
            Upload any PDF — AI reads & summarizes it instantly.
          </p>
        </div>
        <div className="flex items-center gap-2 ds-card px-4 sm:px-6 py-3 sm:py-4 self-start">
          <Layout className="w-4 h-4 sm:w-5 sm:h-5 text-[#1e3272]" />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-600 italic truncate max-w-[160px]">
            {teacherData?.schoolName || "EduIntellect"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
        {/* LEFT — Upload Panel */}
        <div className="xl:col-span-2">
          <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm sticky top-6 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                <Upload className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Upload PDF</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Max 20MB • Text-based PDF</p>
              </div>
            </div>

            {/* Drop Zone */}
            {!file ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-4 p-10 rounded-3xl border-2 border-dashed cursor-pointer transition-all ${
                  dragging
                    ? "border-violet-400 bg-violet-50"
                    : "border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50/50"
                }`}
              >
                <div className="w-16 h-16 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-center">
                  <FileText className="w-8 h-8 text-violet-500" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-700">Drop PDF here</p>
                  <p className="text-xs font-semibold text-slate-400 mt-1">or click to browse</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
                />
              </div>
            ) : (
              <div className="p-5 bg-violet-50 border border-violet-100 rounded-2xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white border border-violet-100 flex items-center justify-center flex-shrink-0 shadow-sm">
                  {extracting ? (
                    <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
                  ) : (
                    <FileText className="w-5 h-5 text-violet-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{file.name}</p>
                  <p className="text-[10px] font-bold text-violet-500 uppercase tracking-widest mt-0.5">
                    {extracting ? "Reading PDF..." : `${pageCount} pages • ${(file.size / 1024).toFixed(0)} KB`}
                  </p>
                </div>
                <button
                  onClick={handleReset}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-100 rounded-2xl">
                <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-rose-600">{error}</p>
              </div>
            )}

            {/* What you'll get */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">What you'll get</p>
              {[
                { icon: Brain, label: "Brief Summary", color: "text-violet-600 bg-violet-50" },
                { icon: Target, label: "Key Concepts", color: "text-blue-600 bg-blue-50" },
                { icon: BookOpen, label: "Section Breakdown", color: "text-emerald-600 bg-emerald-50" },
                { icon: ScrollText, label: "Important Definitions", color: "text-amber-600 bg-amber-50" },
                { icon: FlaskConical, label: "Formulas & Rules", color: "text-rose-600 bg-rose-50" },
                { icon: Star, label: "Exam Important Points", color: "text-orange-600 bg-orange-50" },
                { icon: Zap, label: "Quick Revision Points", color: "text-indigo-600 bg-indigo-50" },
              ].map(({ icon: Icon, label, color }) => (
                <div key={label} className="flex items-center gap-3 py-1">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <p className="text-xs font-semibold text-slate-600">{label}</p>
                </div>
              ))}
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleGenerate}
                disabled={!file || extracting || loading}
                className="flex-1 flex items-center justify-center gap-2 bg-violet-600 text-white py-4 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-violet-700 transition-all shadow-lg shadow-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Summarizing...</>
                ) : (
                  <><Sparkles className="w-4 h-4" />Summarize PDF</>
                )}
              </button>
              {(file || summary) && (
                <button
                  onClick={handleReset}
                  className="w-12 h-12 flex items-center justify-center rounded-2xl border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all flex-shrink-0"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — Summary Output */}
        <div className="xl:col-span-3 space-y-6">
          {/* Empty state */}
          {!summary && !loading && (
            <div className="bg-white border-2 border-dashed border-slate-100 rounded-[2.5rem] p-16 flex flex-col items-center justify-center text-center min-h-[400px]">
              <div className="w-20 h-20 rounded-3xl bg-slate-50 flex items-center justify-center mb-6">
                <ScrollText className="w-10 h-10 text-slate-200" />
              </div>
              <p className="text-lg font-bold text-slate-300 tracking-tight">Your summary will appear here</p>
              <p className="text-[11px] font-bold text-slate-200 uppercase tracking-widest mt-2">Upload a PDF and click Summarize</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="bg-white border border-slate-100 rounded-[2.5rem] p-12 shadow-sm flex flex-col items-center justify-center min-h-[400px] space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center animate-pulse">
                <Brain className="w-8 h-8 text-violet-600" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm font-bold text-slate-700">AI is reading and summarizing...</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">This may take 15-30 seconds</p>
              </div>
              <div className="w-full max-w-sm space-y-3">
                {[90, 65, 80, 50, 75].map((w, i) => (
                  <div key={i} className="h-3 bg-slate-100 rounded-full animate-pulse" style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          {summary && !loading && (
            <>
              {/* Hero Card */}
              <div className="bg-gradient-to-br from-[#1e3272] to-violet-800 rounded-[2.5rem] p-8 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4" />
                <div className="relative">
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    <span className="px-3 py-1 bg-white/10 rounded-full text-[9px] font-bold uppercase tracking-widest">
                      {summary.subject || "General"}
                    </span>
                    {summary.difficulty_level && (
                      <span className="px-3 py-1 bg-white/10 rounded-full text-[9px] font-bold uppercase tracking-widest">
                        {summary.difficulty_level}
                      </span>
                    )}
                    {summary.estimated_study_time && (
                      <span className="px-3 py-1 bg-white/10 rounded-full text-[9px] font-bold uppercase tracking-widest flex items-center gap-1">
                        <Clock className="w-3 h-3" />{summary.estimated_study_time}
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight leading-tight mb-3">{summary.title || file?.name}</h2>
                  <p className="text-sm font-medium text-blue-100 leading-relaxed">{summary.brief_summary}</p>
                  <div className="mt-5 pt-5 border-t border-white/10 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-violet-300" />
                    <span className="text-[10px] font-bold text-violet-200 uppercase tracking-widest">{file?.name} • {pageCount} pages</span>
                  </div>
                </div>
              </div>

              {/* Quick Revision */}
              {summary.quick_revision?.length > 0 && (
                <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-[2rem] p-6 text-white shadow-lg shadow-amber-500/20">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
                      <Zap className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest">Quick Revision Points</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {summary.quick_revision.map((point: string, i: number) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                        <p className="text-xs font-semibold leading-snug">{point}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Key Concepts */}
              {summary.key_concepts?.length > 0 && (
                <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                      <Target className="w-4 h-4 text-blue-600" />
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Key Concepts</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {summary.key_concepts.map((kc: any, i: number) => (
                      <div key={i} className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                        <p className="text-xs font-bold text-blue-800 mb-1">{kc.concept}</p>
                        <p className="text-[11px] font-semibold text-blue-700 leading-snug">{kc.explanation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section Breakdown */}
              {summary.section_breakdown?.length > 0 && (
                <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
                      <BookOpen className="w-4 h-4 text-emerald-600" />
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Section Breakdown</p>
                  </div>
                  {summary.section_breakdown.map((sec: any, i: number) => (
                    <div key={i} className="border border-slate-100 rounded-2xl overflow-hidden">
                      <button
                        onClick={() => toggleSection(i)}
                        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-[10px] font-bold text-emerald-700 flex-shrink-0">
                            {i + 1}
                          </div>
                          <p className="text-sm font-bold text-slate-800">{sec.section}</p>
                        </div>
                        {expandedSections[i]
                          ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        }
                      </button>
                      {expandedSections[i] && (
                        <div className="px-5 pb-4 space-y-2">
                          {sec.points?.map((pt: string, pi: number) => (
                            <div key={pi} className="flex items-start gap-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                              <p className="text-xs font-semibold text-slate-700 leading-snug">{pt}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Definitions + Formulas row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Definitions */}
                {summary.important_definitions?.length > 0 && (
                  <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
                        <ScrollText className="w-4 h-4 text-amber-600" />
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Definitions</p>
                    </div>
                    <div className="space-y-3">
                      {summary.important_definitions.map((d: any, i: number) => (
                        <div key={i} className="pb-3 border-b border-slate-50 last:border-0 last:pb-0">
                          <p className="text-xs font-bold text-slate-800">{d.term}</p>
                          <p className="text-[11px] font-semibold text-slate-500 mt-0.5 leading-snug">{d.definition}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Formulas */}
                {summary.key_formulas_or_rules?.length > 0 && (
                  <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center">
                        <FlaskConical className="w-4 h-4 text-rose-600" />
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Formulas & Rules</p>
                    </div>
                    <div className="space-y-2">
                      {summary.key_formulas_or_rules.map((f: string, i: number) => (
                        <div key={i} className="p-3 bg-rose-50 border border-rose-100 rounded-xl">
                          <p className="text-xs font-semibold text-rose-800 font-mono leading-snug">{f}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Exam Important Points */}
              {summary.exam_important_points?.length > 0 && (
                <div className="bg-gradient-to-br from-slate-900 to-[#1e3272] rounded-[2rem] p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
                      <GraduationCap className="w-4 h-4 text-yellow-300" />
                    </div>
                    <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Exam Important Points</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {summary.exam_important_points.map((pt: string, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-white/5 rounded-xl">
                        <Star className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs font-semibold text-white/80 leading-snug">{pt}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Difficulty badge */}
              {summary.difficulty_level && (
                <div className="flex items-center justify-center gap-3 py-2">
                  <div className={`px-4 py-2 rounded-xl border text-xs font-bold uppercase tracking-widest ${DIFFICULTY_COLORS[summary.difficulty_level] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                    {summary.difficulty_level} Level
                  </div>
                  {summary.estimated_study_time && (
                    <div className="px-4 py-2 rounded-xl border border-slate-100 bg-slate-50 text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> {summary.estimated_study_time}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SummarizeLesson;