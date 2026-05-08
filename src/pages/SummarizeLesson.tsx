import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/AuthContext";
import { AIController } from "../ai/controller/ai-controller";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, doc, serverTimestamp,
} from "firebase/firestore";
import { auditedAdd, auditedDelete } from "../lib/auditedWrites";
import {
  summaryCacheKey, getInflight, setInflight, lsRead, lsWrite, formatAge,
  type SummaryFingerprint,
} from "../lib/summaryCache";
import * as pdfjsLib from "pdfjs-dist";
// Bundle the PDF.js worker via Vite so it loads from same-origin (CSP-safe).
// The previous CDN URL was being blocked by CSP and triggered a `blob:`
// "fake worker" fallback that is also blocked.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type KeyConcept = string | { concept?: string; explanation?: string; definition?: string };
type Definition = { term: string; definition?: string; meaning?: string };
type Formula = string | { formula?: string };
type SectionBreak = { section?: string; title?: string; points?: string[] };
type ExamPoint = string | { point?: string; text?: string };
type RevisionPoint = string | { point?: string; text?: string };

type SummaryDoc = {
  title?: string;
  summary?: string;
  brief_summary?: string;
  key_concepts?: KeyConcept[];
  important_definitions?: Definition[];
  definitions?: Definition[];
  key_formulas_or_rules?: Formula[];
  formulas?: Formula[];
  section_breakdown?: SectionBreak[];
  sections?: SectionBreak[];
  exam_important_points?: ExamPoint[];
  exam_points?: ExamPoint[];
  quick_revision?: RevisionPoint[];
  revision_points?: RevisionPoint[];
  estimated_study_time?: string;
};

// History row stored in `lessonSummaries`. Same shape pattern as Lesson Planner.
interface HistoryItem {
  id: string;
  fileName?: string;
  pageCount?: number;
  summary?: SummaryDoc;
  createdAt?: { toMillis?: () => number; toDate?: () => Date };
  [key: string]: unknown;
}

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

  // P0-2: cache extracted text so we don't run pdfjs twice (handleFile +
  // handleGenerate were both calling extractTextFromPDF in the old code).
  const [extractedText, setExtractedText]   = useState<string>("");
  // P0-1: cached-result badge — when the displayed summary came from cache,
  // track its age + offer a "Regenerate fresh" override.
  const [cachedAt, setCachedAt]             = useState<number | null>(null);
  // P1-5 back-to-form override (Lesson Planner pattern).
  const [forceShowForm, setForceShowForm]   = useState(false);
  // P0-5 persistence + history.
  const [saving, setSaving]                 = useState(false);
  const [saved, setSaved]                   = useState(false);
  const [savedId, setSavedId]               = useState<string | null>(null);
  const [history, setHistory]               = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError]     = useState<string | null>(null);
  const [refreshKey, setRefreshKey]         = useState(0);
  const [showHistory, setShowHistory]       = useState(false);

  // ── PDF text extraction (P0-4: pdf.cleanup + pdf.destroy) ──────────────
  const extractTextFromPDF = async (f: File): Promise<{ text: string; pages: number }> => {
    const buf = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    try {
      let full = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        try {
          const content = await page.getTextContent();
          full += `\n\n[Page ${i}]\n${content.items.map((item) => ("str" in item ? item.str : "")).join(" ")}`;
        } finally {
          // Release decoded page resources — without this, large multi-page
          // PDFs hold textures in memory until GC eventually fires.
          page.cleanup();
        }
      }
      return { text: full.trim(), pages: pdf.numPages };
    } finally {
      // Tear down the worker connection + cached document data. Critical
      // when teachers upload multiple PDFs in succession.
      await pdf.destroy();
    }
  };

  // P0-5 history listener — scoped by schoolId + teacherId.
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    setHistoryError(null);
    let cancelled = false;
    const q = query(
      collection(db, "lessonSummaries"),
      where("schoolId", "==", teacherData.schoolId),
      where("teacherId", "==", teacherData.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as HistoryItem));
        docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setHistory(docs);
      },
      (e) => {
        console.error("[SummarizeLesson] history subscription failed", e);
        const code = (e as { code?: string })?.code;
        setHistoryError(
          code === "permission-denied"
            ? "Permission denied — check your access."
            : "Could not load saved summaries.",
        );
      },
    );
    return () => { cancelled = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId, refreshKey]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleFile = useCallback(async (selectedFile: File) => {
    if (!selectedFile || selectedFile.type !== "application/pdf") {
      setError("Only PDF files are allowed."); return;
    }
    if (selectedFile.size > 20 * 1024 * 1024) {
      setError("File size must be under 20 MB."); return;
    }
    setError(null); setSummary(null); setFile(selectedFile); setExtracting(true);
    setExtractedText(""); setCachedAt(null); setSaved(false); setSavedId(null); setForceShowForm(false);
    try {
      const { text, pages } = await extractTextFromPDF(selectedFile);
      // P0-2: persist the extracted text — handleGenerate reads it instead
      // of running pdfjs a second time.
      setExtractedText(text);
      setPageCount(pages);
    } catch (e) {
      console.error("[SummarizeLesson] PDF extraction failed", e);
      setError("Could not read PDF. Try a different file.");
      setFile(null);
    }
    setExtracting(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, [handleFile]);

  const handleGenerate = async (forceFresh = false) => {
    if (!file) return;

    // P0-1: cache lookup. Fingerprint = (filename + size + page count).
    const fp: SummaryFingerprint = {
      fileName: file.name,
      fileSize: file.size,
      pageCount,
    };
    const key = summaryCacheKey(fp);

    if (!forceFresh) {
      const cached = lsRead(key);
      if (cached) {
        setSummary(cached.summary as SummaryDoc);
        setCachedAt(cached.cachedAt);
        setError(null); setSaved(false); setForceShowForm(false);
        toast.success(`Loaded cached summary (${formatAge(cached.cachedAt)}).`);
        return;
      }
      const inflightP = getInflight(key);
      if (inflightP) {
        setLoading(true); setError(null); setForceShowForm(false);
        try {
          const s = await inflightP;
          setSummary(s as SummaryDoc); setCachedAt(null);
          toast.success("Summary ready.");
        } catch {
          setError("Something went wrong. Please try again.");
        } finally { setLoading(false); }
        return;
      }
    }

    setLoading(true); setError(null); setSummary(null); setCachedAt(null); setForceShowForm(false);
    setSaved(false); setSavedId(null);

    // P0-2: prefer the cached extracted text. If the user uploaded a fresh
    // file mid-session and we don't have it (edge case), re-extract once.
    const aiCall: Promise<SummaryDoc> = (async () => {
      let text = extractedText;
      if (!text) {
        const r = await extractTextFromPDF(file);
        text = r.text;
        setExtractedText(text); // back-fill so future calls skip extraction
      }
      if (!text.trim()) {
        throw new Error("No readable text found. This may be an image-based PDF.");
      }
      const result = await AIController.getSummary({ text, fileName: file.name });
      if (result.status !== "success" || !result.data) {
        throw new Error(
          (result as { message?: string }).message ||
          "AI could not generate summary. Please try again.",
        );
      }
      return result.data as SummaryDoc;
    })();

    setInflight(key, aiCall as Promise<Record<string, unknown>>);

    try {
      const generated = await aiCall;
      setSummary(generated);
      lsWrite(key, generated as Record<string, unknown>);
      if (forceFresh) toast.success("Summary regenerated.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      console.error("[SummarizeLesson] AI call failed", e);
      // P1-7: surface specific error codes when present.
      const code = (e as { code?: string })?.code;
      setError(code === "permission-denied" ? "Permission denied — check your access." : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null); setPageCount(0); setSummary(null); setError(null);
    setExtractedText(""); setCachedAt(null); setSaved(false); setSavedId(null);
    setForceShowForm(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // P0-5 save the summary to Firestore so it's recoverable on refresh +
  // listed in history. Idempotent enough — clicking Save twice creates two
  // entries (acceptable; teacher can delete dupes). Captures docRef.id so
  // future delete-while-open clears the saved badge cleanly.
  const handleSave = async () => {
    if (!summary || !file || !teacherData?.id) return;
    setSaving(true);
    try {
      const docRef = await auditedAdd(collection(db, "lessonSummaries"), {
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        teacherName: teacherData.name || teacherData.displayName || "",
        fileName: file.name,
        fileSize: file.size,
        pageCount,
        summary,
        createdAt: serverTimestamp(),
        source: "ai_summary",
      });
      setSaved(true); setSavedId(docRef.id);
      toast.success("Summary saved.");
    } catch (e) {
      console.error("[SummarizeLesson] save failed", e);
      const code = (e as { code?: string })?.code;
      toast.error(code === "permission-denied" ? "Permission denied — Firestore rules may not be deployed yet." : "Failed to save summary.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHistory = async (h: HistoryItem) => {
    const label = h.fileName || "this summary";
    const ok = window.confirm(`Delete saved summary for "${label}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await auditedDelete(doc(db, "lessonSummaries", h.id));
      toast.success("Summary deleted.");
      if (savedId === h.id) { setSaved(false); setSavedId(null); }
    } catch (e) {
      console.error("[SummarizeLesson] delete failed", e);
      toast.error("Failed to delete summary.");
    }
  };

  const loadFromHistory = (h: HistoryItem) => {
    setSummary(h.summary ?? null);
    setSaved(true); setSavedId(h.id); setCachedAt(null); setForceShowForm(false);
    setShowHistory(false);
    toast.success(`Loaded saved summary for "${h.fileName || "lesson"}".`);
  };

  // P1-4 copy + P1-1 print helpers
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
    } catch { return false; }
  };

  const summaryToText = (s: SummaryDoc | null, fileName?: string): string => {
    if (!s) return "";
    const lines: string[] = [];
    if (s.title || fileName) lines.push((s.title || fileName?.replace(/\.pdf$/i, "")) || "Summary");
    if (s.estimated_study_time) lines.push(`Estimated study time: ${s.estimated_study_time}`);
    if (s.brief_summary || s.summary) {
      lines.push("\nBrief Summary:");
      lines.push(String(s.brief_summary || s.summary));
    }
    if (s.key_concepts?.length) {
      lines.push("\nKey Concepts:");
      s.key_concepts.forEach((c) => {
        const text = typeof c === "string" ? c : `${c.concept || ""}: ${c.explanation || c.definition || ""}`;
        lines.push(`· ${text}`);
      });
    }
    const defs = s.important_definitions ?? s.definitions ?? [];
    if (defs.length) {
      lines.push("\nImportant Definitions:");
      defs.forEach((d) => lines.push(`· ${d.term}: ${d.definition || d.meaning || ""}`));
    }
    const formulas = s.key_formulas_or_rules ?? s.formulas ?? [];
    if (formulas.length) {
      lines.push("\nFormulas & Rules:");
      formulas.forEach((f) => lines.push(`· ${typeof f === "string" ? f : f.formula || ""}`));
    }
    const sections = s.section_breakdown ?? s.sections ?? [];
    if (sections.length) {
      lines.push("\nSection Breakdown:");
      sections.forEach((sec) => {
        lines.push(`\n${sec.section || sec.title || "Section"}`);
        (sec.points || []).forEach((p) => lines.push(`  · ${p}`));
      });
    }
    const exam = s.exam_important_points ?? s.exam_points ?? [];
    if (exam.length) {
      lines.push("\nExam Important Points:");
      exam.forEach((p) => lines.push(`· ${typeof p === "string" ? p : p.point || p.text || ""}`));
    }
    const revise = s.quick_revision ?? s.revision_points ?? [];
    if (revise.length) {
      lines.push("\nQuick Revision:");
      revise.forEach((p) => lines.push(`· ${typeof p === "string" ? p : p.point || p.text || ""}`));
    }
    return lines.join("\n");
  };

  const handleCopySummary = async () => {
    if (!summary) return;
    const ok = await copyToClipboard(summaryToText(summary, file?.name));
    if (ok) toast.success("Summary copied to clipboard.");
    else toast.error("Copy failed — your browser blocked clipboard access.");
  };

  const handlePrintSummary = () => window.print();

  // ── Word export ─────────────────────────────────────────────────────────
  // Format the summary as styled HTML and download with the .doc extension +
  // Microsoft Word MIME. Word, Google Docs, Pages, LibreOffice — all open
  // it natively with the formatting intact. No new dependency needed.
  // Replaces the previous "dump JSON.stringify into a .txt file" behaviour
  // which was unreadable for teachers.
  const escapeHtml = (s: unknown): string =>
    String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const summaryToHtml = (s: SummaryDoc | null, fileName?: string): string => {
    if (!s) return "";
    const title = escapeHtml(s.title || fileName?.replace(/\.pdf$/i, "") || "Lesson Summary");
    const subtitle = s.estimated_study_time ? `Estimated study time: ${escapeHtml(s.estimated_study_time)}` : "";

    const sections: string[] = [];
    const brief = s.brief_summary || s.summary;
    if (brief) {
      sections.push(`<h2>Brief Summary</h2><p>${escapeHtml(brief)}</p>`);
    }
    if (s.key_concepts?.length) {
      const items = s.key_concepts.map((c) => {
        if (typeof c === "string") return `<li>${escapeHtml(c)}</li>`;
        return `<li><strong>${escapeHtml(c.concept || "")}</strong>${c.concept ? ": " : ""}${escapeHtml(c.explanation || c.definition || "")}</li>`;
      }).join("");
      sections.push(`<h2>Key Concepts</h2><ul>${items}</ul>`);
    }
    const defs = s.important_definitions ?? s.definitions ?? [];
    if (defs.length) {
      const items = defs.map((d) => `<li><strong>${escapeHtml(d.term)}</strong>: ${escapeHtml(d.definition || d.meaning || "")}</li>`).join("");
      sections.push(`<h2>Important Definitions</h2><ul>${items}</ul>`);
    }
    const formulas = s.key_formulas_or_rules ?? s.formulas ?? [];
    if (formulas.length) {
      const items = formulas.map((f) => `<li style="font-family: 'Courier New', monospace;">${escapeHtml(typeof f === "string" ? f : f.formula || "")}</li>`).join("");
      sections.push(`<h2>Formulas &amp; Rules</h2><ul>${items}</ul>`);
    }
    const secs = s.section_breakdown ?? s.sections ?? [];
    if (secs.length) {
      const items = secs.map((sec) => {
        const points = (sec.points || []).map((p) => `<li>${escapeHtml(p)}</li>`).join("");
        return `<h3>${escapeHtml(sec.section || sec.title || "Section")}</h3>${points ? `<ul>${points}</ul>` : ""}`;
      }).join("");
      sections.push(`<h2>Section Breakdown</h2>${items}`);
    }
    const exam = s.exam_important_points ?? s.exam_points ?? [];
    if (exam.length) {
      const items = exam.map((p) => `<li>${escapeHtml(typeof p === "string" ? p : p.point || p.text || "")}</li>`).join("");
      sections.push(`<h2>Exam Important Points</h2><ul>${items}</ul>`);
    }
    const revise = s.quick_revision ?? s.revision_points ?? [];
    if (revise.length) {
      const items = revise.map((p) => `<li>${escapeHtml(typeof p === "string" ? p : p.point || p.text || "")}</li>`).join("");
      sections.push(`<h2>Quick Revision</h2><ul>${items}</ul>`);
    }

    return `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${title}</title>
<style>
  body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #1f2937; line-height: 1.55; padding: 40px; }
  h1 { font-size: 24pt; color: #001040; margin: 0 0 4pt; border-bottom: 2pt solid #0055FF; padding-bottom: 6pt; }
  .subtitle { font-size: 10pt; color: #5070B0; margin: 0 0 18pt; font-style: italic; }
  h2 { font-size: 14pt; color: #0055FF; margin: 18pt 0 6pt; }
  h3 { font-size: 12pt; color: #002080; margin: 12pt 0 4pt; }
  p { font-size: 11pt; margin: 6pt 0; }
  ul { margin: 4pt 0 8pt 22pt; padding: 0; }
  li { font-size: 11pt; margin-bottom: 3pt; }
  strong { color: #001040; }
</style>
</head>
<body>
  <h1>${title}</h1>
  ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
  ${sections.join("\n")}
</body>
</html>`;
  };

  const handleExportWord = () => {
    if (!summary) return;
    try {
      const html = summaryToHtml(summary, file?.name);
      // application/msword + .doc extension is the most-compatible combo:
      // Word, Google Docs, Pages, LibreOffice all open this with the
      // styled HTML rendered as a document.
      const blob = new Blob(["﻿", html], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const baseName = (file?.name || "summary").replace(/\.pdf$/i, "");
      a.href = url;
      a.download = `${baseName}_summary.doc`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Word document downloaded.");
    } catch (e) {
      console.error("[SummarizeLesson] export failed", e);
      toast.error("Export failed.");
    }
  };

  // P1-3 Cmd/Ctrl+Enter triggers Generate from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !loading && !extracting && file) {
        e.preventDefault();
        handleGenerate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleGenerate captures via closure; binding it would re-bind on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, extracting, file]);

  // ── Render ──────────────────────────────────────────────────────────────
  // forceShowForm overrides — when teacher clicks Back from result, show form
  // even though `summary` is still in memory.
  const showResult = !!summary && !loading && !forceShowForm;

  return (
    <>

    {/* P1-6 history-listener failure banner with one-tap retry */}
    {historyError && (
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

    {/* P0-1 cache-result badge — shows above result view */}
    {showResult && cachedAt != null && (
      <div className="exam-no-print" style={{
        margin: "8px 16px 0",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10, padding: "10px 12px", borderRadius: 12,
        background: "rgba(123,63,244,0.07)", border: "0.5px solid rgba(123,63,244,0.20)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, color: "#7B3FF4", letterSpacing: "0.4px", textTransform: "uppercase" }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 1L7.5 4H10L8 6L8.8 9L6 7.5L3.2 9L4 6L2 4H4.5Z" />
          </svg>
          Cached · {formatAge(cachedAt)} · No new AI billed
        </div>
        <button type="button"
          onClick={() => handleGenerate(true)}
          disabled={loading}
          style={{
            fontSize: 11, fontWeight: 700, color: "#7B3FF4",
            background: "none", border: "none", padding: 0,
            cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
          }}>
          Regenerate fresh
        </button>
      </div>
    )}

    {/* P1-1, P1-2, P0-5 result-view toolbar — Back / Save / Copy / Print */}
    {showResult && (
      <div className="exam-no-print" style={{
        margin: "8px 16px 0", display: "flex", flexWrap: "wrap", gap: 8,
      }}>
        <button type="button"
          onClick={() => setForceShowForm(true)}
          aria-label="Back to form"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 12px", borderRadius: 11, border: "0.5px solid rgba(0,85,255,.18)",
            background: "#fff", color: "#001040", fontSize: 12, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.1px",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <button type="button"
          onClick={handleSave}
          disabled={saving || saved}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: 11, border: "none",
            background: saved ? "rgba(0,200,83,.10)" : "#0055FF",
            color: saved ? "#00C853" : "#fff",
            fontSize: 12, fontWeight: 700, cursor: saving || saved ? "default" : "pointer",
            fontFamily: "inherit", letterSpacing: "-0.1px",
            boxShadow: saved ? "none" : "0 1px 2px rgba(0,85,255,.22), 0 3px 10px rgba(0,85,255,.28)",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} /> : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              {saved
                ? <polyline points="20 6 9 17 4 12"/>
                : <><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>}
            </svg>
          )}
          {saved ? "Saved" : saving ? "Saving…" : "Save"}
        </button>
        <button type="button"
          onClick={handleCopySummary}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 12px", borderRadius: 11, border: "0.5px solid rgba(0,85,255,.18)",
            background: "#fff", color: "#001040", fontSize: 12, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.1px",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          Copy
        </button>
        <button type="button"
          onClick={handleExportWord}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 12px", borderRadius: 11, border: "0.5px solid rgba(0,85,255,.18)",
            background: "#fff", color: "#001040", fontSize: 12, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.1px",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          Word
        </button>
        <button type="button"
          onClick={handlePrintSummary}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 12px", borderRadius: 11, border: "0.5px solid rgba(0,85,255,.18)",
            background: "#fff", color: "#001040", fontSize: 12, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.1px",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print / PDF
        </button>
      </div>
    )}

    {/* "View summary" banner — compact one-line chip when teacher hit Back.
        Smaller footprint than before so it doesn't dominate the form view. */}
    {!showResult && summary && forceShowForm && (
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
          Summary ready
        </span>
        <span style={{
          fontSize: 12, fontWeight: 700, color: "#001040",
          letterSpacing: "-0.15px", flex: 1, minWidth: 0,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {summary.title || file?.name || "Tap to view"}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0055FF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    )}

    {/* Saved-summaries flyout removed from top per user feedback —
     * data still persists to Firestore via Save button + listener so the
     * history is preserved for a future side-panel surfacing. handleSave,
     * handleDeleteHistory, loadFromHistory, history state all retained
     * for that future use. */}

    {/* ═══════════════════ MOBILE VIEW (new mockup) ═══════════════════ */}
    <MobileSummarizeLesson
      file={file}
      pageCount={pageCount}
      extracting={extracting}
      loading={loading}
      summary={forceShowForm ? null : summary}
      error={error}
      dragging={dragging}
      setDragging={setDragging}
      onDrop={handleDrop}
      onPickFile={handleFile}
      onReset={handleReset}
      onGenerate={() => handleGenerate()}
      onExportWord={handleExportWord}
      onCopy={handleCopySummary}
      fileInputRef={fileInputRef}
    />

    {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
    <DesktopSummarizeLesson
      file={file}
      pageCount={pageCount}
      extracting={extracting}
      loading={loading}
      summary={forceShowForm ? null : summary}
      error={error}
      dragging={dragging}
      setDragging={setDragging}
      onDrop={handleDrop}
      onPickFile={handleFile}
      onReset={handleReset}
      onGenerate={() => handleGenerate()}
      onExportWord={handleExportWord}
      onCopy={handleCopySummary}
      fileInputRef={fileInputRef}
    />

    {/* P1-1 print stylesheet — strips UI chrome so the summary prints clean. */}
    <style>{`
      @media print {
        html, body { background: #fff !important; }
        aside, nav, header, .no-print, .exam-no-print { display: none !important; }
      }
    `}</style>
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
  /** Download a Word doc (.doc with styled HTML — opens in Word/Pages/Docs). */
  onExportWord: () => void;
  /** Copy formatted plain-text summary to clipboard. */
  onCopy: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

const MobileSummarizeLesson = ({
  file, pageCount, extracting, loading, summary, error, dragging, setDragging,
  onDrop, onPickFile, onReset, onGenerate, onExportWord, onCopy, fileInputRef,
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
  const briefSummary = summary?.brief_summary || summary?.summary;
  const keyConcepts = summary?.key_concepts ?? [];
  const examPoints = summary?.exam_important_points ?? [];
  const quickRevision = summary?.quick_revision ?? [];
  const definitions = summary?.important_definitions ?? summary?.definitions ?? [];
  const formulas = summary?.key_formulas_or_rules ?? summary?.formulas ?? [];
  const sections = summary?.section_breakdown ?? summary?.sections ?? [];

  const resultCards = [
    briefSummary && { key: "brief", title: "Brief Summary", icon: mobBenefits[0].icon, color: "b1",
      body: <div style={{ fontSize: 12, color: "#002080", lineHeight: 1.55, fontWeight: 500, letterSpacing: "-0.1px" }}>{briefSummary}</div> },
    keyConcepts.length > 0 && { key: "key", title: "Key Concepts", icon: mobBenefits[1].icon, color: "navy",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7, margin: 0, padding: 0 }}>
        {keyConcepts.map((kc: KeyConcept, i: number) => (
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
        {examPoints.map((pt: ExamPoint, i: number) => {
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
        {quickRevision.map((pt: ExamPoint, i: number) => {
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
        {definitions.map((d: Definition, i: number) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#002080", lineHeight: 1.5, fontWeight: 500, letterSpacing: "-0.1px" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#0055FF", marginTop: 6, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
            <span><b style={{ color: "#001040", fontWeight: 700 }}>{d.term}: </b>{d.definition || d.meaning}</span>
          </li>
        ))}
      </ul> },
    formulas.length > 0 && { key: "formula", title: "Formulas & Rules", icon: mobBenefits[4].icon, color: "red",
      body: <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {formulas.map((f: Formula, i: number) => (
          <div key={i} style={{ padding: "8px 12px", background: "rgba(255,51,85,.08)", border: "0.5px solid rgba(255,51,85,.2)", borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#FF3355", fontFamily: "monospace", lineHeight: 1.5 }}>{typeof f === "string" ? f : f.formula || ""}</div>
          </div>
        ))}
      </div> },
    sections.length > 0 && { key: "section", title: "Section Breakdown", icon: mobBenefits[2].icon, color: "green",
      body: <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sections.map((sec: SectionBreak, i: number) => (
          <div key={i} style={{ padding: "10px 12px", background: "rgba(0,200,83,.06)", border: "0.5px solid rgba(0,200,83,.15)", borderRadius: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#001040", marginBottom: 6, letterSpacing: "-0.2px" }}>{sec.section || sec.title}</div>
            {(sec.points || []).map((pt: string, pi: number) => (
              <div key={pi} style={{ fontSize: 11, color: "#002080", lineHeight: 1.5, margin: "3px 0", display: "flex", alignItems: "flex-start", gap: 5, fontWeight: 500 }}>
                <span style={{ color: "#00C853", fontWeight: 700, flexShrink: 0 }}>✓</span>
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
            {showResult ? "AI Summary Ready" : "AI Powered"}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>
            {showResult ? (
              <>
                {summary?.title ? <>{summary.title}{" "}</> : "Chapter "}
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
                    <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.85)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Powered by Edullent engine</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 2, fontWeight: 500, letterSpacing: "-0.1px" }}>Smart extraction · Real-time</div>
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
                    <span className="sl-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#FFDD55", boxShadow: "0 0 8px #FFDD55" }} />
                    {file ? "Ready" : "Waiting"}
                  </div>
                </div>
                <div style={{ fontSize: 26, fontWeight: 700, color: "#fff", letterSpacing: "-1.1px", lineHeight: 1.1, marginBottom: 8 }}>
                  Any PDF → exam notes ✨
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,.82)", marginBottom: 20, fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5 }}>
                  Drop a chapter and get <b style={{ color: "#fff", fontWeight: 700 }}>7 ready-made study sections</b> back in seconds.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden" }}>
                  <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>7</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Sections</div>
                  </div>
                  <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#FFDD55", letterSpacing: "-0.5px" }}>~12s</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Avg Time</div>
                  </div>
                  <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#6FFFAA", letterSpacing: "-0.5px" }}>20MB</div>
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
                  fontSize: 9, fontWeight: 700, padding: "4px 9px", borderRadius: 100,
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
                <div style={{ fontSize: 17, fontWeight: 700, color: "#001040", letterSpacing: "-0.4px", marginBottom: 5 }}>
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
                  fontSize: 12, fontWeight: 700, borderRadius: 100,
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
                  <span style={{ fontSize: 8, fontWeight: 700, color: "#fff", letterSpacing: "0.3px" }}>PDF</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.25px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 4 }}>{file.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
                    {extracting ? (
                      <>
                        <span style={{ background: "rgba(0,85,255,.1)", color: "#0055FF", padding: "2px 7px", borderRadius: 6, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                          <Loader2 style={{ width: 9, height: 9 }} className="animate-spin" />
                          Reading
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ background: "rgba(0,200,83,.1)", color: "#00C853", padding: "2px 7px", borderRadius: 6, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.25px" }}>AI is summarizing…</div>
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
                <span style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px", display: "flex", alignItems: "center", gap: 6 }}>
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
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.25px", lineHeight: 1.2 }}>{b.title}</div>
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
                  fontSize: 15, fontWeight: 700, border: "none",
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
                <span style={{ fontSize: 8, fontWeight: 700, color: "#fff", letterSpacing: "0.3px" }}>PDF</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.25px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 4 }}>{file?.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
                  <span style={{ background: "rgba(0,200,83,.1)", color: "#00C853", padding: "2px 7px", borderRadius: 6, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
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
                <span style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px", display: "flex", alignItems: "center", gap: 6 }}>
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.25px", flex: 1 }}>{card.title}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#FFAA00", letterSpacing: "1px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 3 }}>
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
                onClick={onExportWord}
                className="sl-press"
                aria-label="Export as Word document"
                style={{
                  padding: "11px 12px", borderRadius: 12,
                  background: "linear-gradient(135deg, #0055FF, #1166FF)",
                  color: "#fff",
                  fontSize: 12, fontWeight: 700, border: "none",
                  letterSpacing: "-0.2px", cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 4px 12px rgba(0,85,255,.28)",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export Word
              </button>
              <button
                type="button"
                onClick={onCopy}
                className="sl-press"
                aria-label="Copy summary to clipboard"
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

// ─────────────────────────────────────────────────────────────────────────────
// Desktop-only view — mirrors mobile design in widescreen grid
// ─────────────────────────────────────────────────────────────────────────────
const DesktopSummarizeLesson = ({
  file, pageCount, extracting, loading, summary, error, dragging, setDragging,
  onDrop, onPickFile, onReset, onGenerate, onExportWord, onCopy, fileInputRef,
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

  const briefSummary = summary?.brief_summary || summary?.summary;
  const keyConcepts = summary?.key_concepts ?? [];
  const examPoints = summary?.exam_important_points ?? [];
  const quickRevision = summary?.quick_revision ?? [];
  const definitions = summary?.important_definitions ?? summary?.definitions ?? [];
  const formulas = summary?.key_formulas_or_rules ?? summary?.formulas ?? [];
  const sections = summary?.section_breakdown ?? summary?.sections ?? [];

  const resultCards = [
    briefSummary && { key: "brief", title: "Brief Summary", icon: mobBenefits[0].icon, color: "b1",
      body: <div style={{ fontSize: 14, color: "#002080", lineHeight: 1.6, fontWeight: 500, letterSpacing: "-0.1px" }}>{briefSummary}</div> },
    keyConcepts.length > 0 && { key: "key", title: "Key Concepts", icon: mobBenefits[1].icon, color: "navy",
      body: <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 9, margin: 0, padding: 0 }}>
        {keyConcepts.map((kc: KeyConcept, i: number) => (
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
        {examPoints.map((pt: ExamPoint, i: number) => {
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
        {quickRevision.map((pt: ExamPoint, i: number) => {
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
        {definitions.map((d: Definition, i: number) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#002080", lineHeight: 1.55, fontWeight: 500, letterSpacing: "-0.1px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0055FF", marginTop: 7, flexShrink: 0, boxShadow: "0 0 4px rgba(0,85,255,.3)" }} />
            <span><b style={{ color: "#001040", fontWeight: 700 }}>{d.term}: </b>{d.definition || d.meaning}</span>
          </li>
        ))}
      </ul> },
    formulas.length > 0 && { key: "formula", title: "Formulas & Rules", icon: mobBenefits[4].icon, color: "red",
      body: <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {formulas.map((f: Formula, i: number) => (
          <div key={i} style={{ padding: "10px 14px", background: "rgba(255,51,85,.08)", border: "0.5px solid rgba(255,51,85,.2)", borderRadius: 11 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#FF3355", fontFamily: "monospace", lineHeight: 1.55 }}>{typeof f === "string" ? f : f.formula || ""}</div>
          </div>
        ))}
      </div> },
    sections.length > 0 && { key: "section", title: "Section Breakdown", icon: mobBenefits[2].icon, color: "green",
      body: <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sections.map((sec: SectionBreak, i: number) => (
          <div key={i} style={{ padding: "12px 14px", background: "rgba(0,200,83,.06)", border: "0.5px solid rgba(0,200,83,.15)", borderRadius: 13 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", marginBottom: 7, letterSpacing: "-0.2px" }}>{sec.section || sec.title}</div>
            {(sec.points || []).map((pt: string, pi: number) => (
              <div key={pi} style={{ fontSize: 12, color: "#002080", lineHeight: 1.55, margin: "4px 0", display: "flex", alignItems: "flex-start", gap: 6, fontWeight: 500 }}>
                <span style={{ color: "#00C853", fontWeight: 700, flexShrink: 0 }}>✓</span>
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

      <div style={{ width: "100%" }}>

        {/* Page header row */}
        <div style={{ marginBottom: 20 }}>
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
            {showResult ? "AI Summary Ready" : "AI Powered"}
          </div>
          <h1 style={{ fontSize: 42, fontWeight: 700, color: "#001040", letterSpacing: "-1.6px", lineHeight: 1.05, margin: 0 }}>
            {showResult ? (
              <>
                {summary?.title ? <>{summary.title}{" "}</> : "Chapter "}
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
                    <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.85)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Powered by Edullent engine</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,.55)", marginTop: 3, fontWeight: 500, letterSpacing: "-0.1px" }}>Smart extraction · Real-time</div>
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
                    <span className="sld-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "#FFDD55", boxShadow: "0 0 8px #FFDD55" }} />
                    {file ? "Ready" : "Waiting"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 42, fontWeight: 700, color: "#fff", letterSpacing: "-1.6px", lineHeight: 1.1, marginBottom: 10 }}>
                      Any PDF → exam notes ✨
                    </div>
                    <div style={{ fontSize: 15, color: "rgba(255,255,255,.82)", fontWeight: 500, letterSpacing: "-0.15px", lineHeight: 1.5 }}>
                      Drop a chapter and get <b style={{ color: "#fff", fontWeight: 700 }}>7 ready-made study sections</b> back in seconds.
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden", minWidth: 380 }}>
                    <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", letterSpacing: "-0.7px" }}>7</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Sections</div>
                    </div>
                    <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#FFDD55", letterSpacing: "-0.7px" }}>~12s</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Avg Time</div>
                    </div>
                    <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#6FFFAA", letterSpacing: "-0.7px" }}>20MB</div>
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
                      fontSize: 10, fontWeight: 700, padding: "5px 11px", borderRadius: 100,
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
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#001040", letterSpacing: "-0.4px", marginBottom: 6 }}>
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
                      fontSize: 13, fontWeight: 700, borderRadius: 100,
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
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.3px" }}>PDF</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 6 }}>{file.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px", flexWrap: "wrap" }}>
                        {extracting ? (
                          <span style={{ background: "rgba(0,85,255,.1)", color: "#0055FF", padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                            <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                            Reading
                          </span>
                        ) : (
                          <>
                            <span style={{ background: "rgba(0,200,83,.1)", color: "#00C853", padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
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
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px", display: "flex", alignItems: "center", gap: 6 }}>
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
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.25px", lineHeight: 1.25 }}>{b.title}</div>
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
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px" }}>AI is summarizing…</div>
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
                fontSize: 17, fontWeight: 700, border: "none",
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
                <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: "0.3px" }}>PDF</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 6 }}>{file?.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
                  <span style={{ background: "rgba(0,200,83,.1)", color: "#00C853", padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
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
                <span style={{ fontSize: 17, fontWeight: 700, color: "#001040", letterSpacing: "-0.4px", display: "flex", alignItems: "center", gap: 7 }}>
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
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px", flex: 1 }}>{card.title}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#FFAA00", letterSpacing: "1px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 3 }}>
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
                onClick={onExportWord}
                className="sld-press"
                aria-label="Export as Word document"
                style={{
                  padding: "14px 16px", borderRadius: 14,
                  background: "linear-gradient(135deg, #0055FF, #1166FF)",
                  color: "#fff",
                  fontSize: 14, fontWeight: 700, border: "none",
                  letterSpacing: "-0.2px", cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  boxShadow: "0 1px 2px rgba(0,85,255,.22), 0 4px 12px rgba(0,85,255,.28)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export Word
              </button>
              <button
                type="button"
                onClick={onCopy}
                className="sld-press"
                aria-label="Copy summary to clipboard"
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
