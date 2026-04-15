import { useState, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { AIController } from "../ai/controller/ai-controller";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

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
  const [summary, setSummary]               = useState<any>(null);
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
      full += `\n\n[Page ${i}]\n${content.items.map((item: any) => item.str).join(" ")}`;
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
    } catch {
      setError("Could not read PDF. Try a different file."); setFile(null);
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
        setSummary(result.data);
      } else {
        setError(result.message || "AI could not generate summary. Please try again.");
      }
    } catch {
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
    <div style={{ minHeight: "100vh", background: T.bg, paddingBottom: 0 }}>

      {/* ═══ DARK HERO (form view only) ══════════════════════════════════ */}
      {!showResult && (
        <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8" style={{ background: T.hero, padding: "18px 22px 22px" }}>
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
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>{teacherData?.schoolName || "EduIntellect"} engine</span>
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
                    <button onClick={handleReset} style={{ width: 28, height: 28, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
            <button
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
              <button style={{ padding: 11, borderRadius: 12, background: T.pur, border: "none", color: "#fff", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2,8.5 6,4.5 8.5,7 10.5,4.5" /><line x1="3" y1="11" x2="11" y2="11" />
                </svg>
                Export PDF
              </button>
              <button style={{ padding: 11, borderRadius: 12, background: T.white, border: `1px solid ${T.bdr}`, color: T.ink2, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6,2 6,9" /><polyline points="3,7 6,10 9,7" />
                </svg>
                Save summary
              </button>
              <button
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

export default SummarizeLesson;