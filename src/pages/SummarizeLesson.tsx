import { useState, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { AIController } from "../ai/controller/ai-controller";
import * as pdfjsLib from "pdfjs-dist";

// NOTE: PDF.js worker is loaded from unpkg CDN. Every summarize request hits
// an external domain, which adds a small privacy/perf/availability cost.
// For production, host the worker alongside the app bundle — Vite supports
// `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

type SummaryDoc = {
  title?: string;
  summary?: string;
  key_concepts?: string[];
  sections?: Array<{ title: string; points: string[] }>;
  definitions?: Array<{ term: string; meaning: string }>;
  formulas?: string[];
  exam_points?: string[];
  revision_points?: string[];
  [key: string]: unknown;
};

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
  pur:   "#6741D9",
  plBg:  "#F3F0FF",
  plBdr: "#D0BFFF",
  grn:   "#087F5B",
  glBg:  "#EBFBEE",
  red:   "#C92A2A",
  rlBg:  "#FFF5F5",
  amb:   "#C87014",
  alBg:  "#FFF9DB",
  alBdr: "#FFE066",
  tea:   "#0C8599",
  tlBg:  "#E3FAFC",
};

// ── "What you'll get" items ───────────────────────────────────────────────────
const WYG_ITEMS = [
  { label: "Brief summary",         bg: T.plBg, color: T.pur,  icon: <path d="M6 1L7.2 4.2H10L7.8 6L8.5 9L6 7.5L3.5 9L4.2 6L2 4.2H4.8Z" /> },
  { label: "Key concepts",          bg: T.blBg, color: T.blue, icon: <><circle cx="6" cy="6" r="4.5" /><circle cx="6" cy="6" r="2" /></> },
  { label: "Section breakdown",     bg: T.glBg, color: T.grn,  icon: <><rect x="1.5" y="1" width="9" height="10" rx="1.5" /><line x1="3.5" y1="4.5" x2="8.5" y2="4.5" /><line x1="3.5" y1="7" x2="6.5" y2="7" /></> },
  { label: "Important definitions", bg: T.alBg, color: T.amb,  icon: <><rect x="1.5" y="1" width="9" height="10" rx="1.5" /><line x1="3.5" y1="4.5" x2="8.5" y2="4.5" /><line x1="3.5" y1="7" x2="7.5" y2="7" /><line x1="3.5" y1="9" x2="6" y2="9" /></> },
  { label: "Formulas & rules",      bg: T.rlBg, color: T.red,  icon: <><line x1="6" y1="1" x2="6" y2="9" /><line x1="3" y1="9" x2="9" y2="9" /><polyline points="3,4 6,1 9,4" /></> },
  { label: "Exam important points", bg: T.alBg, color: T.amb,  icon: <polygon points="6,1 7.5,4.5 11,5 8.5,7.5 9,11 6,9.5 3,11 3.5,7.5 1,5 4.5,4.5" fill={T.amb} stroke="none" /> },
  { label: "Quick revision points", bg: T.tlBg, color: T.tea,  icon: <><polyline points="3,8.5 6,3 9,8.5" /><line x1="4" y1="6.5" x2="8" y2="6.5" /></> },
];


// ── Main component ────────────────────────────────────────────────────────────
const SummarizeLesson = () => {
  const { teacherData } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile]                     = useState<File | null>(null);
  const [pageCount, setPageCount]           = useState(0);
  const [extracting, setExtracting]         = useState(false);
  const [loading, setLoading]               = useState(false);
  const [summary, setSummary]               = useState<SummaryDoc | null>(null);
  const [error, setError]                   = useState<string | null>(null);
  const [dragging, setDragging]             = useState(false);

  // ── PDF text extraction ─────────────────────────────────────────────────
  const extractTextFromPDF = async (f: File): Promise<{ text: string; pages: number }> => {
    const buf = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let full = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      full += `\n\n[Page ${i}]\n${content.items.map((item: { str?: string }) => item.str ?? "").join(" ")}`;
    }
    return { text: full.trim(), pages: pdf.numPages };
  };

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleFile = async (selectedFile: File) => {
    if (!selectedFile || selectedFile.type !== "application/pdf") {
      setError("Only PDF files are allowed."); return;
    }
    if (selectedFile.size > 20 * 1024 * 1024) {
      setError("File size must be under 20 MB."); return;
    }
    setError(null); setSummary(null); setFile(selectedFile); setExtracting(true);
    try {
      const { pages } = await extractTextFromPDF(selectedFile);
      setPageCount(pages);
    } catch (e) {
      console.error("[SummarizeLesson] PDF extraction failed", e);
      setError("Could not read PDF. Try a different file.");
      setFile(null);
    }
    setExtracting(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, []);

  const handleGenerate = async () => {
    if (!file) return;
    setLoading(true); setError(null); setSummary(null);
    try {
      const { text } = await extractTextFromPDF(file);
      if (!text.trim()) {
        setError("No readable text found. This may be an image-based PDF.");
        setLoading(false); return;
      }
      const result = await AIController.getSummary({ text, fileName: file.name });
      if (result.status === "success" && result.data) {
        setSummary(result.data as SummaryDoc);
      } else {
        setError((result as { message?: string }).message || "AI could not generate summary. Please try again.");
      }
    } catch (e) {
      console.error("[SummarizeLesson] AI call failed", e);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null); setPageCount(0); setSummary(null); setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const showResult = summary && !loading;

  return (
    <>

    {/* ═══════════════════ MOBILE VIEW (new mockup) ═══════════════════ */}
    <MobileSummarizeLesson
      file={file}
      pageCount={pageCount}
      extracting={extracting}
      loading={loading}
      summary={summary}
      error={error}
      dragging={dragging}
      setDragging={setDragging}
      onDrop={handleDrop}
      onPickFile={handleFile}
      onReset={handleReset}
      onGenerate={handleGenerate}
      fileInputRef={fileInputRef}
    />

    {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
    <DesktopSummarizeLesson
      file={file}
      pageCount={pageCount}
      extracting={extracting}
      loading={loading}
      summary={summary}
      error={error}
      dragging={dragging}
      setDragging={setDragging}
      onDrop={handleDrop}
      onPickFile={handleFile}
      onReset={handleReset}
      onGenerate={handleGenerate}
      fileInputRef={fileInputRef}
    />
    {/* Legacy desktop wrapper — kept but never rendered; result view falls through */}
    <div className="hidden" style={{ minHeight: "100vh", background: "#EEF4FF", paddingBottom: 0 }}>

      {/* ═══ DARK HERO (form view only) ══════════════════════════════════ */}
      {!showResult && (
        <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 bg-[#001A66] md:bg-[#08090C]" style={{ padding: "18px 22px 22px" }}>
          {/* AI badge */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 20, background: "rgba(103,65,217,0.25)", border: "1px solid rgba(103,65,217,0.4)", marginBottom: 10 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={T.plBdr} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 1L6.5 4H9L7 6L7.8 9L5 7.5L2.2 9L3 6L1 4H3.5Z" />
            </svg>
            <span style={{ fontSize: 9, fontWeight: 500, color: T.plBdr, letterSpacing: "0.05em", textTransform: "uppercase" }}>AI powered</span>
          </div>

          <h1 style={{ fontSize: 22, fontWeight: 500, color: "#fff", letterSpacing: "-0.4px", lineHeight: 1.1, marginBottom: 5 }}>
            Summarize<br />lesson
          </h1>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.03em", lineHeight: 1.5 }}>
            Upload any PDF — AI reads &<br />summarizes it instantly
          </p>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 12, padding: "5px 10px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)" }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="8" height="8" rx="1.5" /><line x1="3" y1="4" x2="7" y2="4" /><line x1="3" y1="6" x2="5.5" y2="6" />
            </svg>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>{teacherData?.schoolName || "Edullent"} engine</span>
          </div>
        </div>
      )}

      {/* ═══ PURPLE GRADIENT HERO (result view) ══════════════════════════ */}
      {showResult && (
        <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8" style={{ background: "linear-gradient(145deg, #4A2FD6 0%, #6741D9 100%)", padding: "18px 18px 20px" }}>
          {/* File chip */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "7px 10px" }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="1" width="9" height="11" rx="1.5" /><line x1="4.5" y1="5" x2="8.5" y2="5" /><line x1="4.5" y1="7.5" x2="7" y2="7.5" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.8)", flex: 1 }}>{file?.name}</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{file ? `${(file.size / 1024).toFixed(0)} KB` : ""}</span>
          </div>

          <h2 style={{ fontSize: 18, fontWeight: 500, color: "#fff", letterSpacing: "-0.3px", lineHeight: 1.15, marginBottom: 6 }}>
            {summary.title || file?.name?.replace(".pdf", "")} —<br />Complete Summary
          </h2>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
            AI has analysed your PDF and extracted key information across multiple categories.
          </p>

          {/* Chips */}
          <div style={{ display: "flex", gap: 6, marginTop: 13, flexWrap: "wrap" }}>
            <RHChip icon="check" text="Summarised" />
            <RHChip icon="doc" text={`${pageCount} pages`} />
            {summary.estimated_study_time && <RHChip icon="clock" text={summary.estimated_study_time} />}
          </div>
        </div>
      )}

      {/* ═══ BODY ════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: showResult ? 14 : 14 }}>

        {/* ── FORM VIEW ──────────────────────────────────────────────── */}
        {!showResult && !loading && (
          <>
            {/* Upload card */}
            <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.s2}`, display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: T.plBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={T.pur} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6.5,2 6.5,9" /><polyline points="3.5,5 6.5,2 9.5,5" /><line x1="2" y1="11" x2="11" y2="11" />
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1, margin: 0 }}>Upload PDF</p>
                  <p style={{ fontSize: 10, color: T.ink3, marginTop: 1 }}>Max 20 MB · Text-based PDF only</p>
                </div>
              </div>

              <div style={{ padding: "13px 14px" }}>
                {!file ? (
                  /* Dropzone */
                  <div
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: `1.5px dashed ${dragging ? T.pur : T.plBdr}`,
                      borderRadius: 14, padding: "28px 14px",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                      cursor: "pointer", position: "relative",
                      background: dragging ? `${T.pur}18` : T.plBg,
                      transition: "background 80ms, border-color 80ms",
                    }}
                  >
                    <span style={{ position: "absolute", top: 10, right: 10, fontSize: 9, fontWeight: 500, color: T.pur, opacity: 0.5, background: `${T.pur}18`, padding: "3px 7px", borderRadius: 20 }}>
                      Max 20 MB
                    </span>
                    <div style={{ width: 44, height: 44, borderRadius: 14, background: `${T.pur}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={T.pur} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="2" width="14" height="16" rx="2" /><line x1="6.5" y1="7" x2="13.5" y2="7" /><line x1="6.5" y1="10" x2="13.5" y2="10" /><line x1="6.5" y1="13" x2="10" y2="13" />
                      </svg>
                    </div>
                    <p style={{ fontSize: 13, fontWeight: 500, color: T.pur }}>Drop PDF here</p>
                    <p style={{ fontSize: 11, color: T.pur, opacity: 0.55 }}>or tap to browse files</p>
                    <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }}
                      onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
                    />
                  </div>
                ) : (
                  /* File selected */
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: T.plBg, border: `1px solid ${T.plBdr}`, borderRadius: 14 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 11, background: T.white, border: `1px solid ${T.plBdr}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {extracting ? (
                        <Loader2 style={{ width: 16, height: 16, color: T.pur }} className="animate-spin" />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 13 13" fill="none" stroke={T.pur} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="1" width="9" height="11" rx="1.5" /><line x1="4.5" y1="5" x2="8.5" y2="5" /><line x1="4.5" y1="7.5" x2="7" y2="7.5" />
                        </svg>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</p>
                      <p style={{ fontSize: 10, fontWeight: 500, color: T.pur, marginTop: 2 }}>
                        {extracting ? "Reading PDF..." : `${pageCount} pages · ${(file.size / 1024).toFixed(0)} KB`}
                      </p>
                    </div>
                    <button type="button" onClick={handleReset} style={{ width: 28, height: 28, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={T.ink3} strokeWidth="1.8" strokeLinecap="round">
                        <line x1="3" y1="3" x2="11" y2="11" /><line x1="11" y1="3" x2="3" y2="11" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* What you'll get */}
            <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: "hidden" }}>
              <div style={{ padding: "11px 14px", borderBottom: `1px solid ${T.s2}`, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: T.plBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.pur} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 1L7.2 4.2H10L7.8 6L8.5 9L6 7.5L3.5 9L4.2 6L2 4.2H4.8Z" />
                  </svg>
                </div>
                <span style={{ fontSize: 12, fontWeight: 500, color: T.ink1 }}>What you'll get</span>
              </div>
              <div style={{ padding: "0 14px" }}>
                {WYG_ITEMS.map(item => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${T.s2}` }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: item.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={item.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {item.icon}
                      </svg>
                    </div>
                    <span style={{ fontSize: 12, color: T.ink2 }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", background: T.rlBg, border: `1px solid #FFC9C9`, borderRadius: 13 }}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7" cy="7" r="5.5" /><line x1="7" y1="4.5" x2="7" y2="7.5" /><circle cx="7" cy="9.5" r=".7" fill={T.red} stroke="none" />
                </svg>
                <p style={{ fontSize: 11, fontWeight: 500, color: T.red, margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Summarize button */}
            <button type="button"
              onClick={handleGenerate}
              disabled={!file || extracting || loading}
              style={{
                width: "100%", padding: 13, borderRadius: 13,
                background: T.pur, border: "none", color: "#fff",
                fontSize: 13, fontWeight: 500, cursor: !file || extracting ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                opacity: !file || extracting ? 0.5 : 1,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 1L8.5 5H12L9.5 7.5L10.5 11.5L7 9.5L3.5 11.5L4.5 7.5L2 5H5.5Z" />
              </svg>
              Summarize PDF
            </button>

            {/* Empty result state */}
            <div style={{
              background: T.white, border: `1.5px dashed ${T.bdr}`, borderRadius: 18,
              padding: "32px 14px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center",
            }}>
              <div style={{ width: 48, height: 48, borderRadius: 15, background: T.s2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke={T.ink3} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="2" width="14" height="16" rx="2" /><line x1="6.5" y1="7" x2="13.5" y2="7" /><line x1="6.5" y1="10" x2="13.5" y2="10" /><line x1="6.5" y1="13" x2="10" y2="13" />
                </svg>
              </div>
              <p style={{ fontSize: 14, fontWeight: 500, color: T.ink2 }}>Your summary will appear here</p>
              <p style={{ fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>Upload a PDF and click summarize</p>
            </div>
          </>
        )}

        {/* ── LOADING ────────────────────────────────────────────────── */}
        {loading && (
          <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: "60px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: `${T.pur}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Loader2 style={{ width: 28, height: 28, color: T.pur }} className="animate-spin" />
            </div>
            <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1 }}>AI is reading and summarizing...</p>
            <p style={{ fontSize: 10, color: T.ink3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.07em" }}>This may take 15-30 seconds</p>
            <div style={{ width: "100%", maxWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
              {[90, 60, 80, 45, 70].map((w, i) => (
                <div key={i} style={{ height: 3, background: T.s2, borderRadius: 2, width: `${w}%` }} className="animate-pulse" />
              ))}
            </div>
          </div>
        )}

        {/* ── RESULT VIEW ────────────────────────────────────────────── */}
        {showResult && (
          <>
            {/* Brief summary */}
            {summary.brief_summary && (
              <SumSec title="Brief summary" bg={T.plBg} color={T.pur}
                icon={<path d="M6 1L7.2 4.2H10L7.8 6L8.5 9L6 7.5L3.5 9L4.2 6L2 4.2H4.8Z" />}
              >
                <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.6, margin: 0 }}>{summary.brief_summary}</p>
              </SumSec>
            )}

            {/* Key concepts */}
            {summary.key_concepts?.length > 0 && (
              <SumSec title="Key concepts" bg={T.blBg} color={T.blue} count={summary.key_concepts.length}
                icon={<><circle cx="6" cy="6" r="4.5" /><circle cx="6" cy="6" r="2" /></>}
                noPad
              >
                {summary.key_concepts.map((kc: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: i < summary.key_concepts.length - 1 ? `1px solid ${T.s2}` : "none" }}>
                    <div style={{ width: 20, height: 20, borderRadius: 6, background: T.blBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 500, color: T.blue, flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                    <div>
                      <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{typeof kc === "string" ? kc : kc.explanation || kc.concept}</p>
                      {typeof kc !== "string" && kc.concept && (
                        <span style={{ fontSize: 10, fontWeight: 500, color: T.pur, background: T.plBg, padding: "2px 7px", borderRadius: 20, marginTop: 3, display: "inline-block" }}>{kc.concept}</span>
                      )}
                    </div>
                  </div>
                ))}
              </SumSec>
            )}

            {/* Important definitions */}
            {summary.important_definitions?.length > 0 && (
              <SumSec title="Important definitions" bg={T.alBg} color={T.amb} count={summary.important_definitions.length}
                icon={<><rect x="1.5" y="1" width="9" height="10" rx="1.5" /><line x1="3.5" y1="4.5" x2="8.5" y2="4.5" /><line x1="3.5" y1="7" x2="7.5" y2="7" /></>}
                noPad
              >
                {summary.important_definitions.map((d: any, i: number) => (
                  <div key={i} style={{ padding: "9px 0", borderBottom: i < summary.important_definitions.length - 1 ? `1px solid ${T.s2}` : "none" }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, margin: 0 }}>{d.term}</p>
                    <p style={{ fontSize: 11, color: T.ink3, marginTop: 2, lineHeight: 1.4 }}>{d.definition}</p>
                  </div>
                ))}
              </SumSec>
            )}

            {/* Exam important points */}
            {summary.exam_important_points?.length > 0 && (
              <SumSec title="Exam important points" bg={T.alBg} color={T.amb} count={summary.exam_important_points.length}
                icon={<polygon points="6,1 7.5,4.5 11,5 8.5,7.5 9,11 6,9.5 3,11 3.5,7.5 1,5 4.5,4.5" fill={T.amb} stroke="none" />}
                noPad
              >
                {summary.exam_important_points.map((pt: string, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7, padding: "7px 0", borderBottom: i < summary.exam_important_points.length - 1 ? `1px solid ${T.s2}` : "none" }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" style={{ flexShrink: 0, marginTop: 1 }}>
                      <polygon points="8,1.5 10,6 15,6.5 11.5,10 12.5,15 8,12.5 3.5,15 4.5,10 1,6.5 6,6" fill={T.amb} />
                    </svg>
                    <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{pt}</p>
                  </div>
                ))}
              </SumSec>
            )}

            {/* Formulas & rules */}
            {summary.key_formulas_or_rules?.length > 0 && (
              <SumSec title="Formulas & rules" bg={T.rlBg} color={T.red}
                icon={<><line x1="6" y1="1" x2="6" y2="9" /><line x1="3" y1="9" x2="9" y2="9" /><polyline points="3,4 6,1 9,4" /></>}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {summary.key_formulas_or_rules.map((f: string, i: number) => (
                    <div key={i} style={{ padding: "8px 12px", background: T.rlBg, border: `1px solid #FFC9C9`, borderRadius: 10 }}>
                      <p style={{ fontSize: 11, fontWeight: 500, color: T.red, fontFamily: "monospace", lineHeight: 1.5, margin: 0 }}>{f}</p>
                    </div>
                  ))}
                </div>
              </SumSec>
            )}

            {/* Quick revision */}
            {summary.quick_revision?.length > 0 && (
              <SumSec title="Quick revision points" bg={T.tlBg} color={T.tea} count={summary.quick_revision.length}
                icon={<><polyline points="3,8.5 6,3 9,8.5" /><line x1="4" y1="6.5" x2="8" y2="6.5" /></>}
                noPad
              >
                {summary.quick_revision.map((pt: string, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: i < summary.quick_revision.length - 1 ? `1px solid ${T.s2}` : "none" }}>
                    <div style={{ width: 22, height: 22, borderRadius: 7, background: T.alBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="10" height="10" viewBox="0 0 11 11" fill="none" stroke={T.amb} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6.5,1 3.5,6 6,6 4.5,10 8,5 5.5,5Z" />
                      </svg>
                    </div>
                    <p style={{ fontSize: 12, color: T.ink2, margin: 0 }}>{pt}</p>
                  </div>
                ))}
              </SumSec>
            )}

            {/* Section breakdown */}
            {summary.section_breakdown?.length > 0 && (
              <SumSec title="Section breakdown" bg={T.glBg} color={T.grn}
                icon={<><rect x="1.5" y="1" width="9" height="10" rx="1.5" /><line x1="3.5" y1="4.5" x2="8.5" y2="4.5" /><line x1="3.5" y1="7" x2="6.5" y2="7" /></>}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {summary.section_breakdown.map((sec: any, i: number) => (
                    <div key={i} style={{ padding: "8px 10px", background: T.glBg, border: `1px solid ${T.bdr}`, borderRadius: 12 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, margin: "0 0 4px" }}>{sec.section}</p>
                      {sec.points?.map((pt: string, pi: number) => (
                        <p key={pi} style={{ fontSize: 11, color: T.ink2, lineHeight: 1.5, margin: "2px 0", display: "flex", alignItems: "flex-start", gap: 5 }}>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={T.grn} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}>
                            <polyline points="1.5,5.5 3.5,8 8.5,2" />
                          </svg>
                          {pt}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </SumSec>
            )}

            {/* Action buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button type="button" style={{ padding: 11, borderRadius: 12, background: T.pur, border: "none", color: "#fff", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2,8.5 6,4.5 8.5,7 10.5,4.5" /><line x1="3" y1="11" x2="11" y2="11" />
                </svg>
                Export PDF
              </button>
              <button type="button" style={{ padding: 11, borderRadius: 12, background: T.white, border: `1px solid ${T.bdr}`, color: T.ink2, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6,2 6,9" /><polyline points="3,7 6,10 9,7" />
                </svg>
                Save summary
              </button>
              <button type="button"
                onClick={handleReset}
                style={{ gridColumn: "span 2", padding: 11, borderRadius: 12, background: T.white, border: `1px solid ${T.bdr}`, color: T.ink2, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10,6 A4,4 0 1,1 8,3" /><polyline points="8,1 8,3 10,3" />
                </svg>
                Summarize another PDF
              </button>
            </div>
          </>
        )}
      </div>

    </div>
    {/* ═══════════════════ END DESKTOP VIEW ═══════════════════ */}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Mobile-only view (new mockup design)
// ─────────────────────────────────────────────────────────────────────────────
interface MobileSummarizeLessonProps {
  file: File | null;
  pageCount: number;
  extracting: boolean;
  loading: boolean;
  summary: SummaryDoc | null;
  error: string | null;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onPickFile: (f: File) => void;
  onReset: () => void;
  onGenerate: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

const MobileSummarizeLesson = ({
  file, pageCount, extracting, loading, summary, error, dragging, setDragging,
  onDrop, onPickFile, onReset, onGenerate, fileInputRef,
}: MobileSummarizeLessonProps) => {
  const showResult = !!summary && !loading;

  const mobBenefits = [
    { key: "brief",   title: "Brief summary",         sub: "2-3 paragraph overview of the whole lesson", color: "b1",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
    { key: "key",     title: "Key concepts",          sub: "Core ideas highlighted with context", color: "navy",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg> },
    { key: "section", title: "Section breakdown",     sub: "Topic-by-topic structure with subheadings", color: "green",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg> },
    { key: "defs",    title: "Important definitions", sub: "Terms your students must memorize", color: "gold",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg> },
    { key: "formula", title: "Formulas & rules",      sub: "Math/science formulas extracted cleanly", color: "red",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg> },
    { key: "exam",    title: "Exam important points", sub: "High-weightage topics flagged", color: "orange",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg> },
    { key: "revise",  title: "Quick revision points", sub: "Last-minute bullet points before exams", color: "teal",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg> },
  ];

  const colorStyles: Record<string, string> = {
    b1:     "linear-gradient(135deg, #0055FF, #1166FF)",
    navy:   "linear-gradient(135deg, #001A66, #0044CC)",
    green:  "linear-gradient(135deg, #00C853, #00E866)",
    gold:   "linear-gradient(135deg, #FFAA00, #FFDD55)",
    red:    "linear-gradient(135deg, #FF3355, #FF6680)",
    orange: "linear-gradient(135deg, #FF8800, #FFAB33)",
    teal:   "linear-gradient(135deg, #16B8B0, #2FD4CC)",
  };

  // Result sections to render
  const briefSummary = (summary as any)?.brief_summary || (summary as any)?.summary;
  const keyConcepts = ((summary as any)?.key_concepts || []) as any[];
  const examPoints = ((summary as any)?.exam_important_points || []) as any[];
  const quickRevision = ((summary as any)?.quick_revision || []) as any[];
  const definitions = ((summary as any)?.important_definitions || (summary as any)?.definitions || []) as any[];
  const formulas = ((summary as any)?.key_formulas_or_rules || (summary as any)?.formulas || []) as any[];
  const sections = ((summary as any)?.section_breakdown || (summary as any)?.sections || []) as any[];

  const resultCards = [
    briefSummary && { key: "brief", title: "Brief Summary", icon: mobBenefits[0].icon, color: "b1",
      body: <div style={{ fontSize: 12, color: "#002080", lineHeight: 1.55, fontWeight: 500, letterSpacing: "-0.1px" }}>{briefSummary}</div> },
    keyConcepts.length > 0 && { key: "key", title: "Key Concepts", icon: mobBenefits[1].icon, color: "navy",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7, margin: 0, padding: 0 }}>
        {keyConcepts.map((kc: any, i: number) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#002080", lineHeight: 1.5, fontWeight: 500, letterSpacing: "-0.1px" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#0055FF", marginTop: 6, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
            {typeof kc === "string" ? kc : (
              <span>
                {kc.concept && <b style={{ color: "#001040", fontWeight: 700 }}>{kc.concept}: </b>}
                {kc.explanation || kc.definition || ""}
              </span>
            )}
          </li>
        ))}
      </ul> },
    examPoints.length > 0 && { key: "exam", title: "Exam Important Points", icon: mobBenefits[5].icon, color: "gold",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7, margin: 0, padding: 0 }}>
        {examPoints.map((pt: any, i: number) => {
          const text = typeof pt === "string" ? pt : pt.point || pt.text || "";
          return (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#002080", lineHeight: 1.5, fontWeight: 500, letterSpacing: "-0.1px" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#0055FF", marginTop: 6, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
              {text}
            </li>
          );
        })}
      </ul> },
    quickRevision.length > 0 && { key: "revise", title: "Quick Revision Points", icon: mobBenefits[6].icon, color: "green",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7, margin: 0, padding: 0 }}>
        {quickRevision.map((pt: any, i: number) => {
          const text = typeof pt === "string" ? pt : pt.point || pt.text || "";
          return (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#002080", lineHeight: 1.5, fontWeight: 500, letterSpacing: "-0.1px" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#0055FF", marginTop: 6, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
              {text}
            </li>
          );
        })}
      </ul> },
    definitions.length > 0 && { key: "defs", title: "Important Definitions", icon: mobBenefits[3].icon, color: "gold",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7, margin: 0, padding: 0 }}>
        {definitions.map((d: any, i: number) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#002080", lineHeight: 1.5, fontWeight: 500, letterSpacing: "-0.1px" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#0055FF", marginTop: 6, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
            <span><b style={{ color: "#001040", fontWeight: 700 }}>{d.term}: </b>{d.definition || d.meaning}</span>
          </li>
        ))}
      </ul> },
    formulas.length > 0 && { key: "formula", title: "Formulas & Rules", icon: mobBenefits[4].icon, color: "red",
      body: <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {formulas.map((f: any, i: number) => (
          <div key={i} style={{ padding: "8px 12px", background: "rgba(255,51,85,.08)", border: "0.5px solid rgba(255,51,85,.2)", borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#FF3355", fontFamily: "monospace", lineHeight: 1.5 }}>{typeof f === "string" ? f : f.formula || ""}</div>
          </div>
        ))}
      </div> },
    sections.length > 0 && { key: "section", title: "Section Breakdown", icon: mobBenefits[2].icon, color: "green",
      body: <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sections.map((sec: any, i: number) => (
          <div key={i} style={{ padding: "10px 12px", background: "rgba(0,200,83,.06)", border: "0.5px solid rgba(0,200,83,.15)", borderRadius: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#001040", marginBottom: 6, letterSpacing: "-0.2px" }}>{sec.section || sec.title}</div>
            {(sec.points || []).map((pt: string, pi: number) => (
              <div key={pi} style={{ fontSize: 11, color: "#002080", lineHeight: 1.5, margin: "3px 0", display: "flex", alignItems: "flex-start", gap: 5, fontWeight: 500 }}>
                <span style={{ color: "#00C853", fontWeight: 900, flexShrink: 0 }}>✓</span>
                {pt}
              </div>
            ))}
          </div>
        ))}
      </div> },
  ].filter(Boolean) as { key: string; title: string; icon: React.ReactNode; color: string; body: React.ReactNode }[];

  const fileSizeKB = file ? (file.size / 1024).toFixed(0) : "0";
  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : "0";
  const showLargeFormat = file && file.size >= 1024 * 1024;

  return (
    <div
      className="md:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px]"
      style={{
        background: "#EEF4FF",
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
        paddingBottom: !showResult ? 90 : 28,
      }}
    >
      <style>{`
        .sl-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .sl-card3d:hover { transform: translateY(-4px) rotateX(4deg) rotateY(-3deg) scale(1.012); box-shadow: 0 1px 2px rgba(0,85,255,.08), 0 24px 44px rgba(0,85,255,.18), 0 8px 16px rgba(0,85,255,.1); } }
        .sl-card3d:active { transform: translateY(-1px) scale(.985); box-shadow: 0 1px 2px rgba(0,85,255,.1), 0 6px 16px rgba(0,85,255,.14); }
        .sl-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .sl-press:active { transform: scale(.94); }
        @keyframes slFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(1.3); } }
        @keyframes slTwinkle { 0%,100% { opacity: .85; } 50% { opacity: .25; } }
        @keyframes slSpin { to { transform: rotate(360deg); } }
        .sl-pulse { animation: slPulse 1.6s ease-in-out infinite; }
        .sl-enter > * { animation: slFadeUp .45s cubic-bezier(.34,1.56,.64,1) both; }
        .sl-enter > *:nth-child(1) { animation-delay: .04s; }
        .sl-enter > *:nth-child(2) { animation-delay: .10s; }
        .sl-enter > *:nth-child(3) { animation-delay: .16s; }
        .sl-enter > *:nth-child(4) { animation-delay: .22s; }
        .sl-enter > *:nth-child(5) { animation-delay: .28s; }
        .sl-enter > *:nth-child(6) { animation-delay: .34s; }
        .sl-enter > *:nth-child(7) { animation-delay: .40s; }
        .sl-enter > *:nth-child(8) { animation-delay: .46s; }
        .sl-enter > *:nth-child(9) { animation-delay: .52s; }
        .sl-spinner { width: 32px; height: 32px; border-radius: 50%; border: 3px solid rgba(0,85,255,.15); border-top-color: #0055FF; animation: slSpin 1s linear infinite; flex-shrink: 0; }
      `}</style>

      <div className="sl-enter" style={{ display: "flex", flexDirection: "column" }}>

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
            {showResult ? "AI Summary Ready" : "AI Powered"}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>
            {showResult ? (
              <>
                {(summary as any)?.title ? <>{(summary as any).title}{" "}</> : "Chapter "}
                <span style={{
                  background: "linear-gradient(135deg, #0055FF 0%, #1166FF 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}>summarised</span>
              </>
            ) : (
              <>
                Summarize{" "}
                <span style={{
                  background: "linear-gradient(135deg, #0055FF 0%, #1166FF 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}>lesson</span>
              </>
            )}
          </h1>
          <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, marginTop: 6, letterSpacing: "-0.15px" }}>
            {showResult
              ? `Your lesson has been analyzed into ${resultCards.length} section${resultCards.length === 1 ? "" : "s"}.`
              : "Upload any PDF — AI reads & summarizes it instantly."}
          </div>
        </div>

        {!showResult && (
          <>
            {/* AI Hero */}
            <div
              className="sl-card3d"
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
                animation: "slTwinkle 3s ease-in-out infinite",
              }} />
              <div style={{ position: "relative", zIndex: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
                  <div style={{ width: 46, height: 46, borderRadius: 14, background: "rgba(255,255,255,.16)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.28)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFDD55" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,.85)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Powered by Edullent engine</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 2, fontWeight: 500, letterSpacing: "-0.1px" }}>Smart extraction · Real-time</div>
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
                    <span className="sl-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#FFDD55", boxShadow: "0 0 8px #FFDD55" }} />
                    {file ? "Ready" : "Waiting"}
                  </div>
                </div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", letterSpacing: "-1.1px", lineHeight: 1.1, marginBottom: 8 }}>
                  Any PDF → exam notes ✨
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,.82)", marginBottom: 20, fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5 }}>
                  Drop a chapter and get <b style={{ color: "#fff", fontWeight: 700 }}>7 ready-made study sections</b> back in seconds.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden" }}>
                  <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>7</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Sections</div>
                  </div>
                  <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#FFDD55", letterSpacing: "-0.5px" }}>~12s</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Avg Time</div>
                  </div>
                  <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#6FFFAA", letterSpacing: "-0.5px" }}>20MB</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Max Size</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Upload Zone or Uploaded File */}
            {!file ? (
              <div
                className="sl-press"
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                style={{
                  background: "#fff",
                  border: `1.5px dashed ${dragging ? "#0055FF" : "rgba(0,85,255,.22)"}`,
                  borderRadius: 22, padding: "28px 20px",
                  textAlign: "center", position: "relative", overflow: "hidden",
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  cursor: "pointer", transition: "all .25s cubic-bezier(.2,.9,.3,1)",
                  marginBottom: 14,
                }}
              >
                <div style={{
                  position: "absolute", top: -40, left: "50%", transform: "translateX(-50%)",
                  width: 180, height: 80,
                  background: "radial-gradient(ellipse, rgba(0,85,255,.14), transparent 70%)",
                  pointerEvents: "none",
                }} />
                <div style={{
                  position: "absolute", top: 12, right: 12,
                  background: "#F4F7FE", color: "#5070B0",
                  fontSize: 9, fontWeight: 800, padding: "4px 9px", borderRadius: 100,
                  letterSpacing: "0.3px", border: "0.5px solid rgba(0,85,255,.07)",
                }}>MAX 20 MB</div>
                <div style={{
                  width: 64, height: 64, borderRadius: 20,
                  background: "linear-gradient(135deg, #0055FF, #1166FF)",
                  margin: "0 auto 16px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", position: "relative",
                  boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 8px 20px rgba(0,85,255,.3), inset 0 1px 0 rgba(255,255,255,.18)",
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span className="sl-pulse" style={{
                    position: "absolute", top: -5, right: -5,
                    fontSize: 15, color: "#FFDD55",
                    textShadow: "0 0 8px rgba(255,221,85,.8)", lineHeight: 1,
                  }}>✦</span>
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#001040", letterSpacing: "-0.4px", marginBottom: 5 }}>
                  {dragging ? "Release to upload" : "Drop PDF here"}
                </div>
                <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5, marginBottom: 14 }}>
                  or tap to browse files<br />
                  <b style={{ color: "#0055FF", fontWeight: 700 }}>Text-based PDF only</b>
                </div>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "9px 16px",
                  background: "linear-gradient(135deg, #0055FF, #1166FF)",
                  color: "#fff",
                  fontSize: 12, fontWeight: 800, borderRadius: 100,
                  letterSpacing: "-0.15px",
                  boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 4px 12px rgba(0,85,255,.3)",
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  Browse files
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  style={{ display: "none" }}
                  onChange={e => { if (e.target.files?.[0]) onPickFile(e.target.files[0]); }}
                />
              </div>
            ) : (
              <div
                className="sl-card3d"
                style={{
                  background: "#fff", borderRadius: 18, padding: 12, marginBottom: 14,
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                  display: "flex", alignItems: "center", gap: 12,
                }}
              >
                <div style={{
                  width: 40, height: 48,
                  background: "linear-gradient(145deg, #FF4B5C 0%, #E6244A 100%)",
                  borderRadius: 7, position: "relative", flexShrink: 0,
                  boxShadow: "0 1px 2px rgba(230,36,74,.15), 0 3px 10px rgba(230,36,74,.25)",
                  display: "flex", alignItems: "flex-end", justifyContent: "center",
                  paddingBottom: 6,
                }}>
                  <span style={{
                    position: "absolute", top: 0, right: 0,
                    width: 12, height: 12,
                    background: "linear-gradient(225deg, rgba(255,255,255,.35) 50%, transparent 50%)",
                    borderRadius: "0 7px 0 0",
                  }} />
                  <span style={{ fontSize: 8, fontWeight: 900, color: "#fff", letterSpacing: "0.3px" }}>PDF</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#001040", letterSpacing: "-0.25px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 4 }}>{file.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
                    {extracting ? (
                      <>
                        <span style={{ background: "rgba(0,85,255,.1)", color: "#0055FF", padding: "2px 7px", borderRadius: 6, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>
                          <Loader2 style={{ width: 9, height: 9 }} className="animate-spin" />
                          Reading
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ background: "rgba(0,200,83,.1)", color: "#00C853", padding: "2px 7px", borderRadius: 6, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          Ready
                        </span>
                        <span style={{ color: "#99AACC" }}>·</span>
                        <span>{pageCount} page{pageCount === 1 ? "" : "s"}</span>
                        <span style={{ color: "#99AACC" }}>·</span>
                        <span>{showLargeFormat ? `${fileSizeMB} MB` : `${fileSizeKB} KB`}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onReset}
                  aria-label="Remove file"
                  className="sl-press"
                  style={{
                    width: 28, height: 28, borderRadius: 9,
                    background: "#F4F7FE", color: "#5070B0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, cursor: "pointer",
                    border: "0.5px solid rgba(0,85,255,.07)", fontFamily: "inherit",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}

            {/* Loading state — generating card */}
            {loading && (
              <div
                className="sl-card3d"
                style={{
                  background: "linear-gradient(135deg, rgba(0,85,255,.08), rgba(17,102,255,.04))",
                  border: "0.5px solid rgba(0,85,255,.2)",
                  borderRadius: 18, padding: 16,
                  display: "flex", alignItems: "center", gap: 12, marginBottom: 14,
                }}
              >
                <div className="sl-spinner" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#001040", letterSpacing: "-0.25px" }}>AI is summarizing…</div>
                  <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, marginTop: 2, letterSpacing: "-0.1px" }}>This may take 15–30 seconds</div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 13px", background: "rgba(255,51,85,.08)",
                border: "0.5px solid rgba(255,51,85,.25)", borderRadius: 14, marginBottom: 14,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF3355" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>
                </svg>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#FF3355" }}>{error}</span>
              </div>
            )}

            {/* What you'll get section */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 4px 10px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#001040", letterSpacing: "-0.35px", display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#FFAA00"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg>
                  What you'll get
                </span>
              </div>
              <span style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>7 outputs</span>
            </div>
            <div className="sl-card3d" style={{
              background: "#fff", borderRadius: 20, padding: 6, marginBottom: 14,
              boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
              border: "0.5px solid rgba(0,85,255,.07)",
              overflow: "hidden",
            }}>
              {mobBenefits.map((b, idx) => (
                <div
                  key={b.key}
                  className="sl-press"
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "11px 12px", borderRadius: 13,
                    cursor: "pointer", position: "relative",
                    borderTop: idx > 0 ? "0.5px solid rgba(0,85,255,.07)" : "none",
                    transition: "background .15s cubic-bezier(.2,.9,.3,1)",
                  }}
                >
                  <div style={{
                    width: 34, height: 34, borderRadius: 11,
                    background: colorStyles[b.color], color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                    boxShadow: "0 1px 2px rgba(0,85,255,.1), 0 2px 6px rgba(0,85,255,.14)",
                  }}>{b.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#001040", letterSpacing: "-0.25px", lineHeight: 1.2 }}>{b.title}</div>
                    <div style={{ fontSize: 10, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", marginTop: 2 }}>{b.sub}</div>
                  </div>
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%",
                    background: "rgba(0,85,255,.08)",
                    border: "0.5px solid rgba(0,85,255,.07)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#0055FF", flexShrink: 0,
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                </div>
              ))}
            </div>

            {/* Sticky Summarize CTA */}
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
                disabled={!file || extracting || loading}
                className="sl-press"
                style={{
                  width: "100%", height: 52, borderRadius: 16,
                  background: (!file || extracting || loading)
                    ? "#F4F7FE"
                    : "linear-gradient(135deg, #0044CC 0%, #0055FF 50%, #1166FF 100%)",
                  color: (!file || extracting || loading) ? "#99AACC" : "#fff",
                  fontSize: 15, fontWeight: 800, border: "none",
                  cursor: (!file || extracting || loading) ? "not-allowed" : "pointer",
                  letterSpacing: "-0.3px",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: (!file || extracting || loading)
                    ? "0 0.5px 1px rgba(0,85,255,.04)"
                    : "0 1px 2px rgba(0,26,102,.3), 0 8px 22px rgba(0,85,255,.42), inset 0 1px 0 rgba(255,255,255,.2)",
                  fontFamily: "inherit",
                  position: "relative", overflow: "hidden",
                }}
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Summarizing…</>
                ) : extracting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Reading PDF…</>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: (!file || extracting || loading) ? "#99AACC" : "#FFDD55", filter: (!file || extracting || loading) ? "none" : "drop-shadow(0 0 4px rgba(255,221,85,.55))" }}>
                      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/>
                    </svg>
                    {file ? "Summarize PDF" : "Upload PDF to start"}
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {showResult && (
          <>
            {/* Uploaded file card */}
            <div className="sl-card3d" style={{
              background: "#fff", borderRadius: 18, padding: 12, marginBottom: 14,
              boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
              border: "0.5px solid rgba(0,85,255,.07)",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 40, height: 48,
                background: "linear-gradient(145deg, #FF4B5C 0%, #E6244A 100%)",
                borderRadius: 7, position: "relative", flexShrink: 0,
                boxShadow: "0 1px 2px rgba(230,36,74,.15), 0 3px 10px rgba(230,36,74,.25)",
                display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 6,
              }}>
                <span style={{ position: "absolute", top: 0, right: 0, width: 12, height: 12, background: "linear-gradient(225deg, rgba(255,255,255,.35) 50%, transparent 50%)", borderRadius: "0 7px 0 0" }} />
                <span style={{ fontSize: 8, fontWeight: 900, color: "#fff", letterSpacing: "0.3px" }}>PDF</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#001040", letterSpacing: "-0.25px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 4 }}>{file?.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
                  <span style={{ background: "rgba(0,200,83,.1)", color: "#00C853", padding: "2px 7px", borderRadius: 6, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Analysed
                  </span>
                  <span style={{ color: "#99AACC" }}>·</span>
                  <span>{pageCount} page{pageCount === 1 ? "" : "s"}</span>
                  <span style={{ color: "#99AACC" }}>·</span>
                  <span>{showLargeFormat ? `${fileSizeMB} MB` : `${fileSizeKB} KB`}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={onReset}
                aria-label="Close summary"
                className="sl-press"
                style={{
                  width: 28, height: 28, borderRadius: 9,
                  background: "#F4F7FE", color: "#5070B0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, cursor: "pointer",
                  border: "0.5px solid rgba(0,85,255,.07)", fontFamily: "inherit",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* AI Summary section */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 4px 10px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#001040", letterSpacing: "-0.35px", display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#FFAA00"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg>
                  AI Summary
                </span>
                <span style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
                  {resultCards.length} section{resultCards.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* Result cards */}
            {resultCards.map(card => (
              <div
                key={card.key}
                className="sl-card3d"
                style={{
                  background: "#fff", borderRadius: 18, padding: 16, marginBottom: 10,
                  boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  border: "0.5px solid rgba(0,85,255,.07)",
                  position: "relative", overflow: "hidden",
                }}
              >
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                  background: "linear-gradient(180deg, #0055FF, #1166FF)",
                }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: colorStyles[card.color], color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>{card.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#001040", letterSpacing: "-0.25px", flex: 1 }}>{card.title}</div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#FFAA00", letterSpacing: "1px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 3 }}>
                    ✦ AI
                  </div>
                </div>
                {card.body}
              </div>
            ))}

            {/* Action buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => {
                  const text = JSON.stringify(summary, null, 2);
                  const blob = new Blob([text], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${(file?.name || "summary").replace(/\.pdf$/i, "")}_summary.txt`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
                className="sl-press"
                style={{
                  padding: "11px 12px", borderRadius: 12,
                  background: "linear-gradient(135deg, #0055FF, #1166FF)",
                  color: "#fff",
                  fontSize: 12, fontWeight: 800, border: "none",
                  letterSpacing: "-0.2px", cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 4px 12px rgba(0,85,255,.28)",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(summary, null, 2));
                }}
                className="sl-press"
                style={{
                  padding: "11px 12px", borderRadius: 12,
                  background: "#F4F7FE", color: "#002080",
                  border: "0.5px solid rgba(0,85,255,.07)",
                  fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  letterSpacing: "-0.2px",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
                Copy
              </button>
              <button
                type="button"
                onClick={onReset}
                className="sl-press"
                style={{
                  gridColumn: "span 2", padding: "11px 12px", borderRadius: 12,
                  background: "#fff", color: "#002080",
                  border: "0.5px solid rgba(0,85,255,.07)",
                  fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  letterSpacing: "-0.2px",
                  boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 2px 8px rgba(0,85,255,.06)",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0118 0 9 9 0 01-15 6.7L3 16"/><polyline points="3 21 3 16 8 16"/>
                </svg>
                Summarize another PDF
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
};

// ── Helper: Result hero chip ──────────────────────────────────────────────────
const RHChip = ({ icon, text }: { icon: string; text: string }) => (
  <div style={{
    padding: "4px 10px", borderRadius: 20,
    background: "rgba(255,255,255,0.14)",
    border: "1px solid rgba(255,255,255,0.18)",
    fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.8)",
    display: "inline-flex", alignItems: "center", gap: 4,
  }}>
    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {icon === "check" && <polyline points="1.5,6.5 4,9 8.5,2" />}
      {icon === "doc" && <><rect x="1" y="1" width="8" height="8" rx="1.5" /><line x1="3" y1="4" x2="7" y2="4" /><line x1="3" y1="6" x2="5.5" y2="6" /></>}
      {icon === "clock" && <><circle cx="5" cy="5" r="3.5" /><polyline points="5,3 5,5 6.5,5" /></>}
    </svg>
    {text}
  </div>
);

// ── Helper: Summary section card ──────────────────────────────────────────────
const SumSec = ({ title, bg, color, icon, count, noPad, children }: {
  title: string; bg: string; color: string;
  icon: React.ReactNode; count?: number; noPad?: boolean;
  children: React.ReactNode;
}) => (
  <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: "hidden" }}>
    <div style={{ padding: "11px 13px", borderBottom: `1px solid ${T.s2}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {icon}
          </svg>
        </div>
        <span style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>{title}</span>
      </div>
      {count != null && (
        <span style={{ fontSize: 10, fontWeight: 500, background: bg, color, padding: "2px 7px", borderRadius: 20 }}>{count}</span>
      )}
    </div>
    <div style={{ padding: noPad ? "0 13px" : "12px 13px" }}>
      {children}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Desktop-only view — mirrors mobile design in widescreen grid
// ─────────────────────────────────────────────────────────────────────────────
const DesktopSummarizeLesson = ({
  file, pageCount, extracting, loading, summary, error, dragging, setDragging,
  onDrop, onPickFile, onReset, onGenerate, fileInputRef,
}: MobileSummarizeLessonProps) => {
  const showResult = !!summary && !loading;

  const mobBenefits = [
    { key: "brief",   title: "Brief summary",         sub: "2-3 paragraph overview of the whole lesson", color: "b1",
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
    { key: "key",     title: "Key concepts",          sub: "Core ideas highlighted with context", color: "navy",
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg> },
    { key: "section", title: "Section breakdown",     sub: "Topic-by-topic structure with subheadings", color: "green",
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg> },
    { key: "defs",    title: "Important definitions", sub: "Terms your students must memorize", color: "gold",
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg> },
    { key: "formula", title: "Formulas & rules",      sub: "Math/science formulas extracted cleanly", color: "red",
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg> },
    { key: "exam",    title: "Exam important points", sub: "High-weightage topics flagged", color: "orange",
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg> },
    { key: "revise",  title: "Quick revision points", sub: "Last-minute bullet points before exams", color: "teal",
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg> },
  ];

  const colorStyles: Record<string, string> = {
    b1:     "linear-gradient(135deg, #0055FF, #1166FF)",
    navy:   "linear-gradient(135deg, #001A66, #0044CC)",
    green:  "linear-gradient(135deg, #00C853, #00E866)",
    gold:   "linear-gradient(135deg, #FFAA00, #FFDD55)",
    red:    "linear-gradient(135deg, #FF3355, #FF6680)",
    orange: "linear-gradient(135deg, #FF8800, #FFAB33)",
    teal:   "linear-gradient(135deg, #16B8B0, #2FD4CC)",
  };

  const briefSummary = (summary as any)?.brief_summary || (summary as any)?.summary;
  const keyConcepts = ((summary as any)?.key_concepts || []) as any[];
  const examPoints = ((summary as any)?.exam_important_points || []) as any[];
  const quickRevision = ((summary as any)?.quick_revision || []) as any[];
  const definitions = ((summary as any)?.important_definitions || (summary as any)?.definitions || []) as any[];
  const formulas = ((summary as any)?.key_formulas_or_rules || (summary as any)?.formulas || []) as any[];
  const sections = ((summary as any)?.section_breakdown || (summary as any)?.sections || []) as any[];

  const resultCards = [
    briefSummary && { key: "brief", title: "Brief Summary", icon: mobBenefits[0].icon, color: "b1",
      body: <div style={{ fontSize: 14, color: "#002080", lineHeight: 1.6, fontWeight: 500, letterSpacing: "-0.1px" }}>{briefSummary}</div> },
    keyConcepts.length > 0 && { key: "key", title: "Key Concepts", icon: mobBenefits[1].icon, color: "navy",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 9, margin: 0, padding: 0 }}>
        {keyConcepts.map((kc: any, i: number) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#002080", lineHeight: 1.55, fontWeight: 500, letterSpacing: "-0.1px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0055FF", marginTop: 7, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
            {typeof kc === "string" ? kc : (
              <span>
                {kc.concept && <b style={{ color: "#001040", fontWeight: 700 }}>{kc.concept}: </b>}
                {kc.explanation || kc.definition || ""}
              </span>
            )}
          </li>
        ))}
      </ul> },
    examPoints.length > 0 && { key: "exam", title: "Exam Important Points", icon: mobBenefits[5].icon, color: "gold",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 9, margin: 0, padding: 0 }}>
        {examPoints.map((pt: any, i: number) => {
          const text = typeof pt === "string" ? pt : pt.point || pt.text || "";
          return (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#002080", lineHeight: 1.55, fontWeight: 500, letterSpacing: "-0.1px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0055FF", marginTop: 7, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
              {text}
            </li>
          );
        })}
      </ul> },
    quickRevision.length > 0 && { key: "revise", title: "Quick Revision Points", icon: mobBenefits[6].icon, color: "green",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 9, margin: 0, padding: 0 }}>
        {quickRevision.map((pt: any, i: number) => {
          const text = typeof pt === "string" ? pt : pt.point || pt.text || "";
          return (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#002080", lineHeight: 1.55, fontWeight: 500, letterSpacing: "-0.1px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0055FF", marginTop: 7, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
              {text}
            </li>
          );
        })}
      </ul> },
    definitions.length > 0 && { key: "defs", title: "Important Definitions", icon: mobBenefits[3].icon, color: "gold",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 9, margin: 0, padding: 0 }}>
        {definitions.map((d: any, i: number) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#002080", lineHeight: 1.55, fontWeight: 500, letterSpacing: "-0.1px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0055FF", marginTop: 7, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
            <span><b style={{ color: "#001040", fontWeight: 700 }}>{d.term}: </b>{d.definition || d.meaning}</span>
          </li>
        ))}
      </ul> },
    formulas.length > 0 && { key: "formula", title: "Formulas & Rules", icon: mobBenefits[4].icon, color: "red",
      body: <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {formulas.map((f: any, i: number) => (
          <div key={i} style={{ padding: "10px 14px", background: "rgba(255,51,85,.08)", border: "0.5px solid rgba(255,51,85,.2)", borderRadius: 11 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#FF3355", fontFamily: "monospace", lineHeight: 1.55 }}>{typeof f === "string" ? f : f.formula || ""}</div>
          </div>
        ))}
      </div> },
    sections.length > 0 && { key: "section", title: "Section Breakdown", icon: mobBenefits[2].icon, color: "green",
      body: <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sections.map((sec: any, i: number) => (
          <div key={i} style={{ padding: "12px 14px", background: "rgba(0,200,83,.06)", border: "0.5px solid rgba(0,200,83,.15)", borderRadius: 13 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#001040", marginBottom: 7, letterSpacing: "-0.2px" }}>{sec.section || sec.title}</div>
            {(sec.points || []).map((pt: string, pi: number) => (
              <div key={pi} style={{ fontSize: 12, color: "#002080", lineHeight: 1.55, margin: "4px 0", display: "flex", alignItems: "flex-start", gap: 6, fontWeight: 500 }}>
                <span style={{ color: "#00C853", fontWeight: 900, flexShrink: 0 }}>✓</span>
                {pt}
              </div>
            ))}
          </div>
        ))}
      </div> },
  ].filter(Boolean) as { key: string; title: string; icon: React.ReactNode; color: string; body: React.ReactNode }[];

  const fileSizeKB = file ? (file.size / 1024).toFixed(0) : "0";
  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : "0";
  const showLargeFormat = file && file.size >= 1024 * 1024;

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
        .sld-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .sld-card3d:hover { transform: translateY(-3px) scale(1.004); box-shadow: 0 1px 2px rgba(0,85,255,.08), 0 24px 44px rgba(0,85,255,.18), 0 8px 16px rgba(0,85,255,.1); } }
        .sld-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .sld-press:active { transform: scale(.96); }
        @keyframes sldPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(1.3); } }
        @keyframes sldTwinkle { 0%,100% { opacity: .85; } 50% { opacity: .25; } }
        @keyframes sldSpin { to { transform: rotate(360deg); } }
        .sld-pulse { animation: sldPulse 1.6s ease-in-out infinite; }
        .sld-spinner { width: 36px; height: 36px; border-radius: 50%; border: 3px solid rgba(0,85,255,.15); border-top-color: #0055FF; animation: sldSpin 1s linear infinite; flex-shrink: 0; }
      `}</style>

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* Page header row */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            fontSize: 10, fontWeight: 800, color: "#fff",
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
            {showResult ? "AI Summary Ready" : "AI Powered"}
          </div>
          <h1 style={{ fontSize: 42, fontWeight: 800, color: "#001040", letterSpacing: "-1.6px", lineHeight: 1.05, margin: 0 }}>
            {showResult ? (
              <>
                {(summary as any)?.title ? <>{(summary as any).title}{" "}</> : "Chapter "}
                <span style={{
                  background: "linear-gradient(135deg, #0055FF 0%, #1166FF 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}>summarised</span>
              </>
            ) : (
              <>
                Summarize{" "}
                <span style={{
                  background: "linear-gradient(135deg, #0055FF 0%, #1166FF 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}>lesson</span>
              </>
            )}
          </h1>
          <div style={{ fontSize: 15, color: "#5070B0", fontWeight: 500, marginTop: 8, letterSpacing: "-0.15px" }}>
            {showResult
              ? `Your lesson has been analyzed into ${resultCards.length} section${resultCards.length === 1 ? "" : "s"}.`
              : "Upload any PDF — AI reads & summarizes it instantly."}
          </div>
        </div>

        {!showResult && (
          <>
            {/* AI Hero — full width */}
            <div
              className="sld-card3d"
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
                animation: "sldTwinkle 3s ease-in-out infinite",
              }} />
              <div style={{ position: "relative", zIndex: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 15, background: "rgba(255,255,255,.16)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.28)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFDD55" }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(255,255,255,.85)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Powered by Edullent engine</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,.55)", marginTop: 3, fontWeight: 500, letterSpacing: "-0.1px" }}>Smart extraction · Real-time</div>
                  </div>
                  <div style={{
                    marginLeft: "auto",
                    background: "rgba(255,255,255,.18)",
                    border: "0.5px solid rgba(255,255,255,.32)",
                    color: "#fff",
                    padding: "7px 14px", borderRadius: 100,
                    fontSize: 11, fontWeight: 800,
                    display: "flex", alignItems: "center", gap: 7, letterSpacing: "0.3px",
                  }}>
                    <span className="sld-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "#FFDD55", boxShadow: "0 0 8px #FFDD55" }} />
                    {file ? "Ready" : "Waiting"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 42, fontWeight: 800, color: "#fff", letterSpacing: "-1.6px", lineHeight: 1.1, marginBottom: 10 }}>
                      Any PDF → exam notes ✨
                    </div>
                    <div style={{ fontSize: 15, color: "rgba(255,255,255,.82)", fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5 }}>
                      Drop a chapter and get <b style={{ color: "#fff", fontWeight: 700 }}>7 ready-made study sections</b> back in seconds.
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden", minWidth: 380 }}>
                    <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: "-0.7px" }}>7</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Sections</div>
                    </div>
                    <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "#FFDD55", letterSpacing: "-0.7px" }}>~12s</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Avg Time</div>
                    </div>
                    <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "#6FFFAA", letterSpacing: "-0.7px" }}>20MB</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Max Size</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2-column: Upload zone + What you'll get */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>

              {/* Upload zone */}
              <div>
                {!file ? (
                  <div
                    className="sld-press"
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                    style={{
                      background: "#fff",
                      border: `1.5px dashed ${dragging ? "#0055FF" : "rgba(0,85,255,.22)"}`,
                      borderRadius: 22, padding: "56px 24px",
                      textAlign: "center", position: "relative", overflow: "hidden",
                      boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                      cursor: "pointer", transition: "all .25s cubic-bezier(.2,.9,.3,1)",
                      height: "100%",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: -40, left: "50%", transform: "translateX(-50%)",
                      width: 240, height: 100,
                      background: "radial-gradient(ellipse, rgba(0,85,255,.14), transparent 70%)",
                      pointerEvents: "none",
                    }} />
                    <div style={{
                      position: "absolute", top: 16, right: 16,
                      background: "#F4F7FE", color: "#5070B0",
                      fontSize: 10, fontWeight: 800, padding: "5px 11px", borderRadius: 100,
                      letterSpacing: "0.3px", border: "0.5px solid rgba(0,85,255,.07)",
                    }}>MAX 20 MB</div>
                    <div style={{
                      width: 80, height: 80, borderRadius: 22,
                      background: "linear-gradient(135deg, #0055FF, #1166FF)",
                      marginBottom: 18,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", position: "relative",
                      boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 8px 20px rgba(0,85,255,.3), inset 0 1px 0 rgba(255,255,255,.18)",
                    }}>
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                      <span className="sld-pulse" style={{
                        position: "absolute", top: -6, right: -6,
                        fontSize: 18, color: "#FFDD55",
                        textShadow: "0 0 8px rgba(255,221,85,.8)", lineHeight: 1,
                      }}>✦</span>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#001040", letterSpacing: "-0.4px", marginBottom: 6 }}>
                      {dragging ? "Release to upload" : "Drop PDF here"}
                    </div>
                    <div style={{ fontSize: 13, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5, marginBottom: 16 }}>
                      or click to browse files<br />
                      <b style={{ color: "#0055FF", fontWeight: 700 }}>Text-based PDF only</b>
                    </div>
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      padding: "11px 20px",
                      background: "linear-gradient(135deg, #0055FF, #1166FF)",
                      color: "#fff",
                      fontSize: 13, fontWeight: 800, borderRadius: 100,
                      letterSpacing: "-0.15px",
                      boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 4px 12px rgba(0,85,255,.3)",
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                      Browse files
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      style={{ display: "none" }}
                      onChange={e => { if (e.target.files?.[0]) onPickFile(e.target.files[0]); }}
                    />
                  </div>
                ) : (
                  <div
                    className="sld-card3d"
                    style={{
                      background: "#fff", borderRadius: 22, padding: 22,
                      boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                      border: "0.5px solid rgba(0,85,255,.07)",
                      display: "flex", alignItems: "center", gap: 16,
                      height: "100%",
                    }}
                  >
                    <div style={{
                      width: 56, height: 68,
                      background: "linear-gradient(145deg, #FF4B5C 0%, #E6244A 100%)",
                      borderRadius: 10, position: "relative", flexShrink: 0,
                      boxShadow: "0 1px 2px rgba(230,36,74,.15), 0 3px 10px rgba(230,36,74,.25)",
                      display: "flex", alignItems: "flex-end", justifyContent: "center",
                      paddingBottom: 9,
                    }}>
                      <span style={{
                        position: "absolute", top: 0, right: 0,
                        width: 18, height: 18,
                        background: "linear-gradient(225deg, rgba(255,255,255,.35) 50%, transparent 50%)",
                        borderRadius: "0 10px 0 0",
                      }} />
                      <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", letterSpacing: "0.3px" }}>PDF</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 6 }}>{file.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px", flexWrap: "wrap" }}>
                        {extracting ? (
                          <span style={{ background: "rgba(0,85,255,.1)", color: "#0055FF", padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", gap: 5 }}>
                            <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                            Reading
                          </span>
                        ) : (
                          <>
                            <span style={{ background: "rgba(0,200,83,.1)", color: "#00C853", padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", gap: 5 }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              Ready
                            </span>
                            <span style={{ color: "#99AACC" }}>·</span>
                            <span>{pageCount} page{pageCount === 1 ? "" : "s"}</span>
                            <span style={{ color: "#99AACC" }}>·</span>
                            <span>{showLargeFormat ? `${fileSizeMB} MB` : `${fileSizeKB} KB`}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onReset}
                      aria-label="Remove file"
                      className="sld-press"
                      style={{
                        width: 36, height: 36, borderRadius: 11,
                        background: "#F4F7FE", color: "#5070B0",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, cursor: "pointer",
                        border: "0.5px solid rgba(0,85,255,.07)", fontFamily: "inherit",
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {/* What you'll get */}
              <div className="sld-card3d" style={{
                background: "#fff", borderRadius: 22, padding: 8,
                boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                border: "0.5px solid rgba(0,85,255,.07)",
                overflow: "hidden",
              }}>
                <div style={{ padding: "6px 12px 10px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px", display: "flex", alignItems: "center", gap: 6 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#FFAA00"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg>
                    What you'll get
                  </span>
                  <span style={{ fontSize: 11, color: "#5070B0", fontWeight: 700, letterSpacing: "-0.1px" }}>7 outputs</span>
                </div>
                {mobBenefits.map((b, idx) => (
                  <div
                    key={b.key}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 12px", borderRadius: 13,
                      position: "relative",
                      borderTop: idx > 0 ? "0.5px solid rgba(0,85,255,.07)" : "none",
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 11,
                      background: colorStyles[b.color], color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                      boxShadow: "0 1px 2px rgba(0,85,255,.1), 0 2px 6px rgba(0,85,255,.14)",
                    }}>{b.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#001040", letterSpacing: "-0.25px", lineHeight: 1.25 }}>{b.title}</div>
                      <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", marginTop: 3 }}>{b.sub}</div>
                    </div>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%",
                      background: "rgba(0,85,255,.08)",
                      border: "0.5px solid rgba(0,85,255,.07)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#0055FF", flexShrink: 0,
                    }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Loading state */}
            {loading && (
              <div
                className="sld-card3d"
                style={{
                  background: "linear-gradient(135deg, rgba(0,85,255,.08), rgba(17,102,255,.04))",
                  border: "0.5px solid rgba(0,85,255,.2)",
                  borderRadius: 20, padding: 22,
                  display: "flex", alignItems: "center", gap: 16, marginBottom: 18,
                }}
              >
                <div className="sld-spinner" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px" }}>AI is summarizing…</div>
                  <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, marginTop: 3, letterSpacing: "-0.1px" }}>This may take 15–30 seconds</div>
                </div>
              </div>
            )}

            {/* Error */}
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

            {/* Inline Summarize CTA (not sticky on desktop) */}
            <button
              type="button"
              onClick={onGenerate}
              disabled={!file || extracting || loading}
              className="sld-press"
              style={{
                width: "100%", height: 58, borderRadius: 16,
                background: (!file || extracting || loading)
                  ? "#F4F7FE"
                  : "linear-gradient(135deg, #0044CC 0%, #0055FF 50%, #1166FF 100%)",
                color: (!file || extracting || loading) ? "#99AACC" : "#fff",
                fontSize: 17, fontWeight: 800, border: "none",
                cursor: (!file || extracting || loading) ? "not-allowed" : "pointer",
                letterSpacing: "-0.3px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                boxShadow: (!file || extracting || loading)
                  ? "0 0.5px 1px rgba(0,85,255,.04)"
                  : "0 1px 2px rgba(0,26,102,.3), 0 8px 22px rgba(0,85,255,.42), inset 0 1px 0 rgba(255,255,255,.2)",
                fontFamily: "inherit",
                position: "relative", overflow: "hidden",
              }}
            >
              {loading ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Summarizing…</>
              ) : extracting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Reading PDF…</>
              ) : (
                <>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ color: (!file || extracting || loading) ? "#99AACC" : "#FFDD55", filter: (!file || extracting || loading) ? "none" : "drop-shadow(0 0 4px rgba(255,221,85,.55))" }}>
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/>
                  </svg>
                  {file ? "Summarize PDF" : "Upload PDF to start"}
                </>
              )}
            </button>
          </>
        )}

        {showResult && (
          <>
            {/* Uploaded file card */}
            <div className="sld-card3d" style={{
              background: "#fff", borderRadius: 22, padding: 18, marginBottom: 18,
              boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
              border: "0.5px solid rgba(0,85,255,.07)",
              display: "flex", alignItems: "center", gap: 16,
            }}>
              <div style={{
                width: 52, height: 64,
                background: "linear-gradient(145deg, #FF4B5C 0%, #E6244A 100%)",
                borderRadius: 9, position: "relative", flexShrink: 0,
                boxShadow: "0 1px 2px rgba(230,36,74,.15), 0 3px 10px rgba(230,36,74,.25)",
                display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 8,
              }}>
                <span style={{ position: "absolute", top: 0, right: 0, width: 16, height: 16, background: "linear-gradient(225deg, rgba(255,255,255,.35) 50%, transparent 50%)", borderRadius: "0 9px 0 0" }} />
                <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", letterSpacing: "0.3px" }}>PDF</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 6 }}>{file?.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
                  <span style={{ background: "rgba(0,200,83,.1)", color: "#00C853", padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", gap: 5 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Analysed
                  </span>
                  <span style={{ color: "#99AACC" }}>·</span>
                  <span>{pageCount} page{pageCount === 1 ? "" : "s"}</span>
                  <span style={{ color: "#99AACC" }}>·</span>
                  <span>{showLargeFormat ? `${fileSizeMB} MB` : `${fileSizeKB} KB`}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={onReset}
                aria-label="Close summary"
                className="sld-press"
                style={{
                  width: 36, height: 36, borderRadius: 11,
                  background: "#F4F7FE", color: "#5070B0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, cursor: "pointer",
                  border: "0.5px solid rgba(0,85,255,.07)", fontFamily: "inherit",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* AI Summary section head */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 4px 14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: "#001040", letterSpacing: "-0.4px", display: "flex", alignItems: "center", gap: 7 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#FFAA00"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg>
                  AI Summary
                </span>
                <span style={{ fontSize: 13, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
                  {resultCards.length} section{resultCards.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* Result cards — 2-col grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 14 }}>
              {resultCards.map(card => (
                <div
                  key={card.key}
                  className="sld-card3d"
                  style={{
                    background: "#fff", borderRadius: 20, padding: 20,
                    boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                    border: "0.5px solid rgba(0,85,255,.07)",
                    position: "relative", overflow: "hidden",
                  }}
                >
                  <div style={{
                    position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
                    background: "linear-gradient(180deg, #0055FF, #1166FF)",
                  }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 12,
                      background: colorStyles[card.color], color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>{card.icon}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px", flex: 1 }}>{card.title}</div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#FFAA00", letterSpacing: "1px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 3 }}>
                      ✦ AI
                    </div>
                  </div>
                  {card.body}
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  const text = JSON.stringify(summary, null, 2);
                  const blob = new Blob([text], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${(file?.name || "summary").replace(/\.pdf$/i, "")}_summary.txt`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
                className="sld-press"
                style={{
                  padding: "14px 16px", borderRadius: 14,
                  background: "linear-gradient(135deg, #0055FF, #1166FF)",
                  color: "#fff",
                  fontSize: 14, fontWeight: 800, border: "none",
                  letterSpacing: "-0.2px", cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 4px 12px rgba(0,85,255,.28)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(summary, null, 2));
                }}
                className="sld-press"
                style={{
                  padding: "14px 16px", borderRadius: 14,
                  background: "#F4F7FE", color: "#002080",
                  border: "0.5px solid rgba(0,85,255,.07)",
                  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  letterSpacing: "-0.2px",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
                Copy
              </button>
              <button
                type="button"
                onClick={onReset}
                className="sld-press"
                style={{
                  padding: "14px 16px", borderRadius: 14,
                  background: "#fff", color: "#002080",
                  border: "0.5px solid rgba(0,85,255,.07)",
                  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  letterSpacing: "-0.2px",
                  boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 2px 8px rgba(0,85,255,.06)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0118 0 9 9 0 01-15 6.7L3 16"/><polyline points="3 21 3 16 8 16"/>
                </svg>
                Summarize another
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
};

export default SummarizeLesson;