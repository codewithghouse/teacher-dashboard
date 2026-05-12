/**
 * ResultPredictor.tsx — "Pre-Result Predictor" page.
 *
 * The headline USP from `pitch_script_100crmeeting.md` Section 5:
 *   "the moment a teacher finalises a paper — *before* the exam — Edullent
 *    will predict how the class is likely to perform, and tell her exactly
 *    what to fix while there is still time. The school stops reacting to
 *    results. It starts engineering them."
 *
 * Inputs:
 *   1. Question paper — pick an existing saved test (with attached AI paper
 *      from Save-as-Test), OR upload a fresh PDF, OR paste manually.
 *   2. Syllabus — auto-resolved from `syllabi` collection by classId + subject
 *      (with optional override-upload).
 *   3. Class — auto-resolved from selected test, or chosen for upload/paste.
 *
 * Output:
 *   1. Class forecast — expected pass %, predicted class average, top struggle
 *      questions, headline + pre-exam class actions.
 *   2. Per-student tier — Pass / Borderline / Fail with predicted score range,
 *      reasoning that cites past scores by name + number, recommended
 *      pre-exam action per student.
 *   3. Drill-down panel on click for full reasoning.
 *
 * Cache: 3-tier (in-flight / localStorage / Firestore `result_predictions`),
 * 24h TTL, paper-hash + roster-hash + day keyed. Same teacher firing predict
 * twice on the same paper = ONE OpenAI call.
 *
 * Cross-dashboard impact: pure reader of existing collections (tests,
 * enrollments, test_scores, gradebook_scores, attendance, student_ratings,
 * syllabi). One new collection: `result_predictions` (cache only — not
 * audit-grade).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2, Sparkles, Upload, FileText,
  Download, ChevronRight, AlertTriangle,
  CheckCircle2, XCircle, GaugeCircle, ListChecks,
  X as XIcon, Library, Clock,
} from "lucide-react";
import { collection, query, where, onSnapshot, getDocs, type DocumentData } from "firebase/firestore";
import * as pdfjsLib from "pdfjs-dist";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite handles the `?url` query at build time.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { db } from "../lib/firebase";
import { useAuth } from "../lib/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { AIController } from "../ai/controller/ai-controller";
import {
  getPredictionWithCache,
  paperHash as makePaperHash,
  rosterHash as makeRosterHash,
  formatAge,
  type FirestoreCacheCoords,
  type TenantContext,
} from "../lib/resultPredictorCache";
import { buildReport, openReportWindow, type ReportSection } from "../lib/reportTemplate";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";
import type { GeneratedPaper, GeneratedSection, GeneratedQuestion } from "./exam-types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ── Design tokens (module scope so the page never re-creates them per render) ─
const T = {
  FONT: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  BG2: "#E0ECFF",
  CARD: "#FFFFFF",
  B1: "#0055FF",
  B2: "#1166FF",
  B3: "#2277FF",
  B4: "#4499FF",
  T1: "#001040",
  T2: "#002080",
  T3: "#5070B0",
  T4: "#99AACC",
  GREEN: "#00C853",
  GREEN2: "#00A040",
  GOLD: "#FFAA00",
  GOLD2: "#CC8800",
  RED: "#FF3355",
  RED2: "#CC1144",
  VIOLET: "#7B3FF4",
  TEAL: "#00C4B4",
  BLUE_BDR: "rgba(0,85,255,0.12)",
  SH: "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)",
  SH_LG: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.14)",
  SH_BTN: "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)",
  HERO_GRAD: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
};

// ── Types for the AI response ────────────────────────────────────────────────
interface StudentPrediction {
  studentId: string;
  name: string;
  predicted_band: "pass" | "borderline" | "fail";
  predicted_score_min: number;
  predicted_score_max: number;
  confidence: "high" | "medium" | "low";
  top_strengths_for_paper: string[];
  gaps_for_paper: string[];
  reasoning: string;
  recommended_pre_exam_action: string;
}

interface PredictionResult {
  paper_summary: {
    topics_detected: string[];
    difficulty_estimate: "easy" | "medium" | "hard";
    questions_overview: string;
  };
  class_forecast: {
    expected_pass_pct: number;
    predicted_class_average: number;
    expected_top_struggle_questions: string[];
    headline: string;
    pre_exam_class_actions: string[];
  };
  students: StudentPrediction[];
}

// ── PDF text extraction ──────────────────────────────────────────────────────
async function extractPdfText(file: File): Promise<{ text: string; pages: number }> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  const pageCount = pdf.numPages;
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it: any) => (it as { str?: string }).str || "").join(" ") + "\n\n";
    page.cleanup();
  }
  pdf.destroy();
  return { text: text.trim(), pages: pageCount };
}

// Convert a stored AI-generated paper (GeneratedPaper) into a flat text blob
// for the predictor — same shape AI sees regardless of input source.
function paperToText(p: GeneratedPaper): string {
  const lines: string[] = [];
  if (p.title) lines.push(p.title);
  if (p.subject || p.grade) lines.push(`${p.subject || ""} ${p.grade || ""}`.trim());
  if (p.totalMarks) lines.push(`Total marks: ${p.totalMarks}`);
  if (p.duration) lines.push(`Duration: ${p.duration}`);
  if (p.generalInstructions?.length) {
    lines.push("\nInstructions:");
    p.generalInstructions.forEach(i => lines.push(`- ${i}`));
  }
  (p.sections || []).forEach((sec: GeneratedSection, sIdx) => {
    lines.push(`\n${sec.title || `Section ${sIdx + 1}`}${sec.marks ? ` (${sec.marks} marks)` : ""}`);
    if (sec.instructions) lines.push(sec.instructions);
    (sec.questions || []).forEach((q: GeneratedQuestion, qIdx) => {
      const num = q.number ?? qIdx + 1;
      const m = q.marks ? ` [${q.marks} marks]` : "";
      lines.push(`${num}. ${q.question || ""}${m}`);
      (q.options || []).forEach(o => lines.push(`   ${o}`));
    });
  });
  return lines.join("\n");
}

// ── Per-student history builder ──────────────────────────────────────────────
interface RawScoreDoc { studentId?: string; studentEmail?: string; score?: number; mark?: number; marks?: number; maxScore?: number; maxMarks?: number; percentage?: number; subject?: string; topic?: string; topics?: string[]; testName?: string; columnName?: string; timestamp?: any; updatedAt?: any; }
interface RawAttDoc { studentId?: string; studentEmail?: string; status?: string; date?: string; }
interface RawRatingDoc { studentId?: string; studentEmail?: string; rating?: number; }
interface RosterRow { studentId: string; studentEmail: string; studentName: string; }

interface StudentHistoryBundle {
  studentId: string;
  name: string;
  email: string;
  recentTests: number;
  avgScore: number;            // 0-100
  last3Scores: { name: string; pct: number; topic?: string; subject?: string }[];
  attendancePct: number | null;
  attendedDays: number;
  totalMarkedDays: number;
  behaviourRating: number | null;   // 1-5
  weakTopics: string[];
  strongTopics: string[];
}

const pctOfDoc = (d: RawScoreDoc): number | null => {
  if (typeof d.percentage === "number" && Number.isFinite(d.percentage)) return Math.max(0, Math.min(100, d.percentage));
  const raw = (typeof d.score === "number" ? d.score : null)
    ?? (typeof d.mark === "number" ? d.mark : null)
    ?? (typeof d.marks === "number" ? d.marks : null);
  const max = (typeof d.maxScore === "number" ? d.maxScore : null)
    ?? (typeof d.maxMarks === "number" ? d.maxMarks : null);
  if (raw == null) return null;
  if (max && max > 0) return Math.max(0, Math.min(100, (raw / max) * 100));
  // No max field — assume raw is already 0-100
  if (raw >= 0 && raw <= 100) return raw;
  return null;
};

const docTimeMs = (d: RawScoreDoc): number => {
  const ts = d.timestamp;
  if (ts?.toDate) return (ts.toDate() as Date).getTime();
  if (typeof ts === "number") return ts;
  const u = d.updatedAt;
  if (u?.toDate) return (u.toDate() as Date).getTime();
  if (typeof u === "number") return u;
  return 0;
};

function buildStudentHistory(
  roster: RosterRow[],
  scores: RawScoreDoc[],
  attendance: RawAttDoc[],
  ratings: RawRatingDoc[],
): StudentHistoryBundle[] {
  return roster.map(r => {
    const idLower = r.studentId.toLowerCase();
    const emailLower = r.studentEmail.toLowerCase();
    const matches = (d: { studentId?: string; studentEmail?: string }) => {
      const did = String(d.studentId || "").toLowerCase();
      const dem = String(d.studentEmail || "").toLowerCase();
      return (did && did === idLower) || (emailLower && dem === emailLower);
    };

    // Scores — 90-day window (long enough to capture term history)
    const scoreCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const myScores = scores
      .filter(matches)
      .map(s => ({ s, pct: pctOfDoc(s), ts: docTimeMs(s) }))
      .filter(x => x.pct != null && x.ts > scoreCutoff)
      .sort((a, b) => b.ts - a.ts);

    const last3Scores = myScores.slice(0, 3).map(x => ({
      name: x.s.testName || x.s.columnName || x.s.topic || x.s.subject || "Recent assessment",
      pct: Math.round(x.pct as number),
      topic: x.s.topic || x.s.topics?.[0],
      subject: x.s.subject,
    }));

    const avgScore = myScores.length > 0
      ? Math.round(myScores.reduce((sum, x) => sum + (x.pct as number), 0) / myScores.length)
      : 0;

    // Topic / subject buckets — strong if avg >= 75, weak if avg < 50
    const topicBuckets = new Map<string, { sum: number; n: number }>();
    myScores.forEach(x => {
      const key = (x.s.topic || x.s.topics?.[0] || x.s.subject || "").trim();
      if (!key) return;
      const b = topicBuckets.get(key) || { sum: 0, n: 0 };
      b.sum += x.pct as number;
      b.n += 1;
      topicBuckets.set(key, b);
    });
    const weakTopics: string[] = [];
    const strongTopics: string[] = [];
    topicBuckets.forEach(({ sum, n }, key) => {
      const avg = sum / n;
      if (avg < 50) weakTopics.push(`${key} (${Math.round(avg)}%)`);
      else if (avg >= 75) strongTopics.push(`${key} (${Math.round(avg)}%)`);
    });

    // Attendance — 60-day window, % of marked days that were present-or-late
    const attCutoff = new Date();
    attCutoff.setDate(attCutoff.getDate() - 60);
    const attCutoffStr = attCutoff.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const myAtt = attendance.filter(a => matches(a) && a.date && a.date >= attCutoffStr);
    const attendedDays = myAtt.filter(a => {
      const s = String(a.status || "").toLowerCase();
      return s === "present" || s === "late";
    }).length;
    const totalMarkedDays = myAtt.length;
    const attendancePct = totalMarkedDays > 0 ? Math.round((attendedDays / totalMarkedDays) * 100) : null;

    // Behaviour rating — average of all rating docs for this student (1-5)
    const myRatings = ratings.filter(matches);
    const behaviourRating = myRatings.length > 0
      ? Math.round((myRatings.reduce((s, r) => s + (Number(r.rating) || 0), 0) / myRatings.length) * 10) / 10
      : null;

    return {
      studentId: r.studentId,
      name: r.studentName || "Unnamed student",
      email: r.studentEmail,
      recentTests: myScores.length,
      avgScore,
      last3Scores,
      attendancePct,
      attendedDays,
      totalMarkedDays,
      behaviourRating,
      weakTopics: weakTopics.slice(0, 5),
      strongTopics: strongTopics.slice(0, 5),
    };
  });
}

// ── Tier styling ─────────────────────────────────────────────────────────────
const tierStyle = (band: StudentPrediction["predicted_band"]) => {
  if (band === "pass") return { color: T.GREEN, color2: T.GREEN2, bg: "rgba(0,200,83,0.10)", bdr: "rgba(0,200,83,0.22)", label: "Pass", icon: CheckCircle2 };
  if (band === "borderline") return { color: T.GOLD, color2: T.GOLD2, bg: "rgba(255,170,0,0.10)", bdr: "rgba(255,170,0,0.25)", label: "Borderline", icon: AlertTriangle };
  return { color: T.RED, color2: T.RED2, bg: "rgba(255,51,85,0.10)", bdr: "rgba(255,51,85,0.22)", label: "Fail", icon: XCircle };
};

const confLabel = (c: StudentPrediction["confidence"]) =>
  c === "high" ? "High confidence" : c === "medium" ? "Medium confidence" : "Low confidence";

// ── Main component ───────────────────────────────────────────────────────────
const ResultPredictor = () => {
  const { teacherData } = useAuth();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const syllabusInputRef = useRef<HTMLInputElement>(null);

  // ── Input state ──
  type InputMode = "test" | "upload" | "paste";
  const [inputMode, setInputMode] = useState<InputMode>("test");
  const [selectedTestId, setSelectedTestId] = useState<string>(searchParams.get("testId") || "");
  const [uploadedPaperText, setUploadedPaperText] = useState<string>("");
  const [uploadedPaperName, setUploadedPaperName] = useState<string>("");
  const [pastedText, setPastedText] = useState<string>("");
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [classId, setClassId] = useState<string>(searchParams.get("classId") || "");

  // Override syllabus
  const [overrideSyllabusText, setOverrideSyllabusText] = useState<string>("");
  const [overrideSyllabusName, setOverrideSyllabusName] = useState<string>("");
  const [extractingSyllabus, setExtractingSyllabus] = useState(false);

  // ── Firestore data ──
  const [tests, setTests] = useState<DocumentData[]>([]);
  const [classes, setClasses] = useState<DocumentData[]>([]);
  const [enrollments, setEnrollments] = useState<DocumentData[]>([]);
  const [scores, setScores] = useState<RawScoreDoc[]>([]);
  const [attendance, setAttendance] = useState<RawAttDoc[]>([]);
  const [ratings, setRatings] = useState<RawRatingDoc[]>([]);
  // Auto-resolved syllabus carries ONLY the storage path + filename. The
  // cloud function downloads + extracts the PDF server-side (admin SDK,
  // bypasses browser CORS entirely). Override-uploaded syllabus extracts
  // text client-side because the user provided the File object directly.
  const [autoSyllabusPath, setAutoSyllabusPath] = useState<string>("");
  const [autoSyllabusName, setAutoSyllabusName] = useState<string>("");
  const [resolvingSyllabus, setResolvingSyllabus] = useState(false);

  // ── Output state ──
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predictionCachedAt, setPredictionCachedAt] = useState<number | null>(null);
  const [predictionFromCache, setPredictionFromCache] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // ── Listener: tests by teacherId (for dropdown) ──
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const q = query(
      collection(db, "tests"),
      where("schoolId", "==", teacherData.schoolId),
      where("teacherId", "==", teacherData.id),
    );
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort by testDate / createdAt desc
      rows.sort((a: any, b: any) => {
        const at = a.testDate || a.createdAt?.toDate?.()?.toISOString() || "";
        const bt = b.testDate || b.createdAt?.toDate?.()?.toISOString() || "";
        return String(bt).localeCompare(String(at));
      });
      setTests(rows);
    }, err => console.error("[ResultPredictor] tests listener", err));
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId]);

  // ── Listener: classes assigned to this teacher (school-wide read,
  //     filtered client-side by teacherId / teacherEmail) ──
  useEffect(() => {
    if (!teacherData?.schoolId) return;
    const q = query(collection(db, "classes"), where("schoolId", "==", teacherData.schoolId));
    const unsub = onSnapshot(q, snap => {
      setClasses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error("[ResultPredictor] classes listener", err));
    return () => unsub();
  }, [teacherData?.schoolId]);

  // Auto-fill class from selected test (when in test mode)
  useEffect(() => {
    if (inputMode !== "test" || !selectedTestId) return;
    const t = tests.find(x => x.id === selectedTestId);
    if (t?.classId && t.classId !== classId) setClassId(t.classId);
  }, [inputMode, selectedTestId, tests]);

  // ── Listener: enrollments for the selected class ──
  useEffect(() => {
    if (!teacherData?.schoolId || !classId) { setEnrollments([]); return; }
    const q = query(
      collection(db, "enrollments"),
      where("schoolId", "==", teacherData.schoolId),
      where("classId", "==", classId),
    );
    const unsub = onSnapshot(q, snap => {
      setEnrollments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error("[ResultPredictor] enrollments listener", err));
    return () => unsub();
  }, [teacherData?.schoolId, classId]);

  // ── Roster: dedup by studentId, fall back to enrollment doc id ──
  const roster: RosterRow[] = useMemo(() => {
    const map = new Map<string, RosterRow>();
    enrollments.forEach((e: any) => {
      const sid = String(e.studentId || e.id || "").trim();
      if (!sid) return;
      if (map.has(sid)) return;
      map.set(sid, {
        studentId: sid,
        studentEmail: String(e.studentEmail || "").toLowerCase(),
        studentName: String(e.studentName || "").trim(),
      });
    });
    return [...map.values()];
  }, [enrollments]);

  // ── Listeners: per-class score/attendance/rating event streams ──
  // Memory `bug_pattern_branch_filter_on_event_streams`: NEVER filter event
  // streams by branchId. classId is the isolation key — schoolId only.
  useEffect(() => {
    if (!teacherData?.schoolId || !classId) { setScores([]); return; }
    const q1 = query(collection(db, "test_scores"), where("schoolId", "==", teacherData.schoolId), where("classId", "==", classId));
    const q2 = query(collection(db, "gradebook_scores"), where("schoolId", "==", teacherData.schoolId), where("classId", "==", classId));
    let s1Cache: any[] = [], s2Cache: any[] = [];
    const merge = () => {
      // Memory `bug_pattern_score_field_singular_mark`: gradebook writes `mark`
      // (singular) — pctOfDoc handles all forms. Just merge raw.
      const all: RawScoreDoc[] = [...s1Cache, ...s2Cache];
      setScores(all);
    };
    const u1 = onSnapshot(q1, snap => { s1Cache = snap.docs.map(d => d.data() as RawScoreDoc); merge(); }, err => console.error("[ResultPredictor] test_scores listener", err));
    const u2 = onSnapshot(q2, snap => { s2Cache = snap.docs.map(d => d.data() as RawScoreDoc); merge(); }, err => console.error("[ResultPredictor] gradebook_scores listener", err));
    return () => { u1(); u2(); };
  }, [teacherData?.schoolId, classId]);

  useEffect(() => {
    if (!teacherData?.schoolId || !classId) { setAttendance([]); return; }
    const q = query(collection(db, "attendance"), where("schoolId", "==", teacherData.schoolId), where("classId", "==", classId));
    const unsub = onSnapshot(q, snap => setAttendance(snap.docs.map(d => d.data() as RawAttDoc)),
      err => console.error("[ResultPredictor] attendance listener", err));
    return () => unsub();
  }, [teacherData?.schoolId, classId]);

  useEffect(() => {
    if (!teacherData?.schoolId || !classId) { setRatings([]); return; }
    const q = query(collection(db, "student_ratings"), where("schoolId", "==", teacherData.schoolId), where("classId", "==", classId));
    const unsub = onSnapshot(q, snap => setRatings(snap.docs.map(d => d.data() as RawRatingDoc)),
      err => console.error("[ResultPredictor] ratings listener", err));
    return () => unsub();
  }, [teacherData?.schoolId, classId]);

  // ── Auto-resolve syllabus PDF: query `syllabi` by classId, take latest
  //     active doc, hand the storage path to the cloud function which will
  //     download + extract text server-side (admin SDK = no CORS, no browser
  //     bucket config required). The client never touches the PDF bytes. ──
  useEffect(() => {
    setAutoSyllabusName("");
    setAutoSyllabusPath("");
    if (!teacherData?.schoolId || !classId) return;
    let cancelled = false;
    const run = async () => {
      setResolvingSyllabus(true);
      try {
        const q1 = query(
          collection(db, "syllabi"),
          where("schoolId", "==", teacherData.schoolId),
          where("classId", "==", classId),
        );
        const snap = await getDocs(q1);
        const docs = snap.docs.map(d => d.data() as DocumentData)
          .filter(d => d.isActive !== false);
        if (docs.length === 0 || cancelled) return;
        // Newest active syllabus first
        docs.sort((a, b) => {
          const at = a.uploadedAt?.toDate?.()?.getTime?.() || 0;
          const bt = b.uploadedAt?.toDate?.()?.getTime?.() || 0;
          return bt - at;
        });
        const top = docs[0];
        const path = top.filePath as string | undefined;
        if (!path) return;
        setAutoSyllabusPath(path);
        setAutoSyllabusName(String(top.fileName || top.title || "Syllabus.pdf"));
      } catch (err) {
        console.warn("[ResultPredictor] syllabus auto-resolve failed", err);
      } finally {
        if (!cancelled) setResolvingSyllabus(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [teacherData?.schoolId, classId]);

  // ── Resolved paper text (depends on input mode) ──
  const resolvedPaperText = useMemo(() => {
    if (inputMode === "test") {
      const t: any = tests.find(x => x.id === selectedTestId);
      if (!t) return "";
      if (t.paper) return paperToText(t.paper as GeneratedPaper);
      // Fall back to test metadata if no AI paper attached
      const lines = [
        `Test: ${t.title || t.testName || "Untitled test"}`,
        `Subject: ${t.subject || ""}`,
        `Total marks: ${t.marks || ""}`,
        t.topics?.length ? `Topics: ${(t.topics as string[]).join(", ")}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    }
    if (inputMode === "upload") return uploadedPaperText;
    return pastedText;
  }, [inputMode, selectedTestId, tests, uploadedPaperText, pastedText]);

  // Override-uploaded syllabus = client-side text (already extracted on
  // upload). Auto-resolved syllabus = storage path that the cloud function
  // will download + extract. Override beats auto when both present.
  const resolvedSyllabusText = overrideSyllabusText;
  const resolvedSyllabusPath = overrideSyllabusText ? "" : autoSyllabusPath;
  const resolvedSyllabusName = overrideSyllabusName || autoSyllabusName;

  // Selected class object + subject
  const selectedClass = useMemo(() => classes.find(c => c.id === classId) as any | undefined, [classes, classId]);
  const selectedTest = useMemo(() => tests.find(t => t.id === selectedTestId) as any | undefined, [tests, selectedTestId]);
  const subject = selectedTest?.subject || selectedClass?.subject || teacherData?.subject || "";
  const className = selectedClass?.className || selectedClass?.name || selectedTest?.className || "Class";
  const totalMarks = selectedTest?.marks || 100;

  // ── Build student history bundle (memoized) ──
  const studentHistory = useMemo(
    () => buildStudentHistory(roster, scores, attendance, ratings),
    [roster, scores, attendance, ratings],
  );

  const canPredict = !!teacherData?.id && !!teacherData?.schoolId && !!classId
    && resolvedPaperText.trim().length > 30 && roster.length > 0;

  // ── PDF upload handlers ──
  const handlePaperUpload = async (f: File) => {
    if (f.type !== "application/pdf") { toast.error("Only PDF files are supported."); return; }
    if (f.size > 15 * 1024 * 1024) { toast.error("PDF must be under 15 MB."); return; }
    setExtractingPdf(true);
    try {
      const { text, pages } = await extractPdfText(f);
      if (text.length < 50) {
        toast.warning(`Extracted only ${text.length} chars from ${pages} pages — the PDF may be a scan. Use Paste mode instead.`);
      }
      setUploadedPaperText(text);
      setUploadedPaperName(f.name);
    } catch (err) {
      console.error("[ResultPredictor] paper PDF extract failed", err);
      toast.error("Could not read this PDF. Try a different file or paste the text manually.");
    } finally {
      setExtractingPdf(false);
    }
  };

  const handleSyllabusUpload = async (f: File) => {
    if (f.type !== "application/pdf") { toast.error("Only PDF files are supported."); return; }
    if (f.size > 15 * 1024 * 1024) { toast.error("PDF must be under 15 MB."); return; }
    setExtractingSyllabus(true);
    try {
      const { text } = await extractPdfText(f);
      setOverrideSyllabusText(text);
      setOverrideSyllabusName(f.name);
    } catch (err) {
      console.error("[ResultPredictor] syllabus PDF extract failed", err);
      toast.error("Could not read this syllabus PDF.");
    } finally {
      setExtractingSyllabus(false);
    }
  };

  // ── Run prediction ──
  const runPredict = async (force = false) => {
    if (!canPredict || !teacherData?.id || !teacherData?.schoolId) return;
    setPredicting(true);
    setSelectedStudentId(null);
    try {
      const studentsPayload = studentHistory.map(s => ({
        studentId: s.studentId,
        name: s.name,
        recentTests: s.recentTests,
        avgScore: s.avgScore,
        attendancePct: s.attendancePct,
        behaviourRating: s.behaviourRating,
        weakTopics: s.weakTopics,
        strongTopics: s.strongTopics,
        last3Scores: s.last3Scores,
      }));
      const coords: FirestoreCacheCoords = {
        teacherId: teacherData.id,
        classId,
        paperHash: makePaperHash(resolvedPaperText),
        rosterHash: makeRosterHash(studentsPayload.map(s => ({
          studentId: s.studentId, recentTests: s.recentTests, avgScore: s.avgScore,
        }))),
      };
      const tenant: TenantContext = {
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId,
        branchId: teacherData.branchId || "",
      };
      const { prediction: pred, fromCache, cachedAt } = await getPredictionWithCache({
        coords,
        tenant,
        forceRefresh: force,
        fetchFn: async () => {
          const r = await AIController.getResultPrediction({
            paperText: resolvedPaperText,
            // Override-uploaded syllabus is sent as already-extracted text;
            // auto-resolved syllabus is sent as a storage path so the cloud
            // function downloads + extracts server-side (no CORS).
            syllabusText: resolvedSyllabusText,
            syllabusPath: resolvedSyllabusPath,
            subject,
            className,
            totalMarks,
            passPct: 40,
            students: studentsPayload,
          });
          if (r.status !== "success") {
            throw new Error(r.status === "error" || r.status === "no_data" || r.status === "not_implemented"
              ? r.message
              : "AI service error");
          }
          return r.data as Record<string, unknown>;
        },
      });
      setPrediction(pred as unknown as PredictionResult);
      setPredictionCachedAt(cachedAt);
      setPredictionFromCache(fromCache);
      // Sync url so a refresh restores the same context
      const next = new URLSearchParams(searchParams);
      next.set("classId", classId);
      if (selectedTestId) next.set("testId", selectedTestId);
      setSearchParams(next, { replace: true });
      if (!fromCache) toast.success("Prediction ready.");
    } catch (err: any) {
      console.error("[ResultPredictor] predict failed", err);
      toast.error(typeof err?.message === "string" ? err.message : "Prediction failed. Please try again.");
    } finally {
      setPredicting(false);
    }
  };

  // ── Tier breakdown ──
  const grouped = useMemo(() => {
    const out = { pass: [] as StudentPrediction[], borderline: [] as StudentPrediction[], fail: [] as StudentPrediction[] };
    if (!prediction) return out;
    prediction.students.forEach(s => {
      const tier = s.predicted_band === "pass" ? "pass" : s.predicted_band === "borderline" ? "borderline" : "fail";
      out[tier].push(s);
    });
    // Sort each tier by predicted score DESC
    (Object.keys(out) as Array<keyof typeof out>).forEach(k => {
      out[k].sort((a, b) => (b.predicted_score_max || 0) - (a.predicted_score_max || 0));
    });
    return out;
  }, [prediction]);

  const selectedStudent = useMemo(
    () => prediction?.students.find(s => s.studentId === selectedStudentId) || null,
    [prediction, selectedStudentId],
  );

  // ── Export — proper structured report (hero + tier tables + class actions)
  // via reportTemplate.ts. Replaces the earlier `window.print()` which dumped
  // the entire app chrome (sidebar, hero gradients, hover states) and looked
  // ugly. Now produces an Edullent-branded printable HTML report opened in a
  // secure blob: popup window.
  const handleExport = () => {
    if (!prediction) return;
    try {
      const sections: ReportSection[] = [];

      // 1. Class headline (text)
      sections.push({
        title: "Class Forecast",
        type: "text",
        text: prediction.class_forecast.headline,
      });

      // 2. Paper overview + topics
      sections.push({
        title: "Paper Overview",
        type: "text",
        text: prediction.paper_summary.questions_overview
          + (prediction.paper_summary.topics_detected.length
            ? `\n\nTopics tested: ${prediction.paper_summary.topics_detected.join(", ")}`
            : ""),
      });

      // 3. Where the class will struggle (list)
      if (prediction.class_forecast.expected_top_struggle_questions.length > 0) {
        sections.push({
          title: "Expected Class Struggles",
          type: "list",
          items: prediction.class_forecast.expected_top_struggle_questions,
        });
      }

      // 4. Pre-exam class actions (list)
      if (prediction.class_forecast.pre_exam_class_actions.length > 0) {
        sections.push({
          title: "Recommended Pre-Exam Class Actions",
          type: "list",
          items: prediction.class_forecast.pre_exam_class_actions,
        });
      }

      // 5-7. Tier tables — Pass / Borderline / Fail
      const tiers: { label: string; band: StudentPrediction["predicted_band"]; students: StudentPrediction[] }[] = [
        { label: "On Track to Pass", band: "pass", students: grouped.pass },
        { label: "Borderline — Need Attention", band: "borderline", students: grouped.borderline },
        { label: "Fail Risk — Urgent Intervention", band: "fail", students: grouped.fail },
      ];
      tiers.forEach(({ label, students }) => {
        if (students.length === 0) return;
        sections.push({
          title: `${label} (${students.length})`,
          type: "table",
          headers: ["#", "Student", "Predicted", "Confidence", "Recommended Action"],
          rows: students.map((s, i) => ({
            cells: [
              i + 1,
              s.name,
              `${s.predicted_score_min}–${s.predicted_score_max}%`,
              confLabel(s.confidence),
              s.recommended_pre_exam_action || "—",
            ],
          })),
        });
      });

      // 8. Per-student deep reasoning (text per student) — keep tight for print
      const allWithReasoning = prediction.students.filter(s => s.reasoning?.trim());
      if (allWithReasoning.length > 0) {
        sections.push({
          title: "Per-Student Reasoning",
          type: "text",
          text: allWithReasoning.map(s =>
            `▸ ${s.name} (${tierStyle(s.predicted_band).label}, ${s.predicted_score_min}–${s.predicted_score_max}%)\n${s.reasoning}`
          ).join("\n\n"),
        });
      }

      const branchName = (teacherData as any)?.branchName
        || (teacherData as any)?.branch
        || teacherData?.schoolId
        || "Edullent";

      const html = buildReport({
        title: "Pre-Result Forecast",
        subtitle: `${className}${subject ? ` · ${subject}` : ""} · ${prediction.students.length} students`,
        badge: prediction.paper_summary.difficulty_estimate.toUpperCase(),
        heroStats: [
          { label: "Expected pass", value: `${prediction.class_forecast.expected_pass_pct}%` },
          { label: "Predicted avg", value: `${prediction.class_forecast.predicted_class_average}%` },
          { label: "Topics tested", value: prediction.paper_summary.topics_detected.length },
          { label: "Total marks", value: totalMarks },
        ],
        sections,
        schoolName: branchName,
        generatedBy: teacherData?.name || "Teacher",
        // Edullent brand defaults — buildReport uses these when not overridden.
      });

      openReportWindow(html);
    } catch (err) {
      console.error("[ResultPredictor] export failed", err);
      toast.error("Could not open report. Please try again.");
    }
  };

  // ── Render shell ──
  // Inline component pattern is fine here: shell is rendered once per render
  // tree, no per-second timer that would force a remount cycle (cf. the
  // AIPracticePage flicker bug 2026-05-23).
  const padding = isMobile ? "px-4 pt-4 pb-[88px]" : "px-6 pt-8 pb-12";

  return (
    <div className="min-h-[calc(100vh-64px)] -m-4 sm:-m-6 md:-m-8"
      style={{ fontFamily: T.FONT, background: T.BG }}>
      <div className={`w-full ${padding}`}>

        {/* Page Head */}
        <div className="mb-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-[7px]" style={{ color: T.T4 }}>
            <span className="w-[6px] h-[6px] rounded-full" style={{ background: T.B1, boxShadow: "0 0 0 3px rgba(0,85,255,0.18)" }} />
            Teacher Dashboard · AI Forecast
          </div>
          <h1 className={`${isMobile ? "text-[24px]" : "text-[32px]"} font-bold leading-none`} style={{ color: T.T1, letterSpacing: "-0.6px" }}>
            Pre-Result Predictor
          </h1>
          <div className="text-[13px] font-normal mt-[6px]" style={{ color: T.T3 }}>
            Forecast student outcomes <strong style={{ color: T.B1, fontWeight: 700 }}>before</strong> the exam — and engineer better results.
          </div>
        </div>

        {/* ── SETUP CARD ── */}
        <div {...tilt3D} className="bg-white rounded-[22px] p-6 mb-5 relative overflow-hidden"
          style={{ boxShadow: T.SH_LG, border: `0.5px solid ${T.BLUE_BDR}`, ...tilt3DStyle }}>
          <div className="absolute -top-[40px] -right-[20px] w-[180px] h-[180px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />

          {/* Input mode tabs */}
          <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-2 relative z-10" style={{ color: T.T4 }}>
            Question Paper Source
          </div>
          <div className="flex gap-2 mb-4 relative z-10">
            {([
              { key: "test", label: "Pick saved test", icon: ListChecks },
              { key: "upload", label: "Upload PDF", icon: Upload },
              { key: "paste", label: "Paste text", icon: FileText },
            ] as { key: InputMode; label: string; icon: any }[]).map(t => {
              const Icon = t.icon;
              const active = inputMode === t.key;
              return (
                <button key={t.key} onClick={() => setInputMode(t.key)}
                  className="px-4 py-[10px] rounded-[14px] text-[12px] font-bold flex items-center gap-2 transition-transform hover:scale-[1.01]"
                  style={active ? {
                    background: `linear-gradient(135deg, ${T.B1}, ${T.B2})`, color: "#fff", boxShadow: T.SH_BTN,
                  } : {
                    background: T.BG, color: T.T3, border: `0.5px solid ${T.BLUE_BDR}`, boxShadow: T.SH,
                  }}>
                  <Icon className="w-[14px] h-[14px]" strokeWidth={active ? 2.5 : 2.2} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Per-mode input */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-[0.08em] block mb-2" style={{ color: T.T4 }}>
                {inputMode === "test" ? "Test" : inputMode === "upload" ? "Upload PDF" : "Paste paper text"}
              </label>
              {inputMode === "test" && (
                <select value={selectedTestId} onChange={e => setSelectedTestId(e.target.value)}
                  className="custom-chrome w-full h-12 rounded-[14px] outline-none px-4 text-[13px] font-medium"
                  style={{
                    "--cc-padding": "12px 16px",
                    "--cc-font-size": "13px",
                    background: T.BG, color: T.T1, border: `0.5px solid ${T.BLUE_BDR}`,
                  } as React.CSSProperties}>
                  <option value="">Choose a test…</option>
                  {tests.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.title || t.testName || "(untitled)"} · {t.className || ""} {t.testDate ? `· ${t.testDate}` : ""}
                    </option>
                  ))}
                </select>
              )}
              {inputMode === "upload" && (
                <div>
                  <input ref={fileInputRef} type="file" accept="application/pdf"
                    onChange={e => e.target.files?.[0] && handlePaperUpload(e.target.files[0])} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} disabled={extractingPdf}
                    className="w-full h-12 rounded-[14px] text-[13px] font-bold flex items-center justify-center gap-2 transition-transform hover:scale-[1.01] disabled:opacity-60"
                    style={{ background: T.BG, color: T.T2, border: `0.5px solid ${T.BLUE_BDR}`, boxShadow: T.SH }}>
                    {extractingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" strokeWidth={2.3} />}
                    {extractingPdf ? "Reading PDF…" : uploadedPaperName ? `✓ ${uploadedPaperName}` : "Choose PDF"}
                  </button>
                  {uploadedPaperText && !extractingPdf && (
                    <div className="text-[10px] mt-1" style={{ color: T.T4 }}>
                      Extracted ~{uploadedPaperText.length.toLocaleString()} chars
                    </div>
                  )}
                </div>
              )}
              {inputMode === "paste" && (
                <textarea value={pastedText} onChange={e => setPastedText(e.target.value)}
                  placeholder="Paste the question paper here — every question with marks if possible…"
                  className="w-full p-3 rounded-[14px] outline-none resize-none text-[13px] leading-[1.55] min-h-[120px]"
                  style={{ background: T.BG, color: T.T1, border: `0.5px solid ${T.BLUE_BDR}`, fontFamily: T.FONT }} />
              )}
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-[0.08em] block mb-2" style={{ color: T.T4 }}>
                Class
              </label>
              <select value={classId} onChange={e => setClassId(e.target.value)} disabled={inputMode === "test" && !!selectedTestId}
                className="custom-chrome w-full h-12 rounded-[14px] outline-none px-4 text-[13px] font-medium disabled:opacity-70"
                style={{
                  "--cc-padding": "12px 16px",
                  "--cc-font-size": "13px",
                  background: T.BG, color: T.T1, border: `0.5px solid ${T.BLUE_BDR}`,
                } as React.CSSProperties}>
                <option value="">Choose a class…</option>
                {classes.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.className || c.name || `Class ${c.id.slice(0, 6)}`}
                    {c.subject ? ` · ${c.subject}` : ""}
                  </option>
                ))}
              </select>
              <div className="text-[10px] mt-1" style={{ color: T.T4 }}>
                {inputMode === "test" && selectedTestId
                  ? "Auto-selected from the chosen test"
                  : `${roster.length} student${roster.length === 1 ? "" : "s"} loaded`}
              </div>
            </div>
          </div>

          {/* Syllabus pill */}
          <div className="mt-5 px-4 py-3 rounded-[14px] flex items-start gap-3 relative z-10"
            style={{ background: T.BG, border: `0.5px solid ${T.BLUE_BDR}` }}>
            <div className="w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0"
              style={{ background: "rgba(0,196,180,0.10)", border: "0.5px solid rgba(0,196,180,0.22)" }}>
              <Library className="w-4 h-4" style={{ color: T.TEAL }} strokeWidth={2.3} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: T.TEAL }}>
                Syllabus context
              </div>
              <div className="text-[12px] mt-[2px]" style={{ color: T.T2 }}>
                {resolvingSyllabus
                  ? "Looking up syllabus PDF for this class…"
                  : resolvedSyllabusName
                    ? overrideSyllabusText
                      ? <>Using <strong>{resolvedSyllabusName}</strong> ({overrideSyllabusText.length.toLocaleString()} chars, uploaded)</>
                      : <>Using <strong>{resolvedSyllabusName}</strong> · AI will read the PDF directly</>
                    : "No syllabus PDF found for this class. Predictions still work, but adding one improves accuracy."}
              </div>
            </div>
            <input ref={syllabusInputRef} type="file" accept="application/pdf"
              onChange={e => e.target.files?.[0] && handleSyllabusUpload(e.target.files[0])} className="hidden" />
            <button onClick={() => syllabusInputRef.current?.click()} disabled={extractingSyllabus}
              className="px-3 py-2 rounded-[10px] text-[11px] font-bold whitespace-nowrap shrink-0 transition-transform hover:scale-[1.02] disabled:opacity-60"
              style={{ background: "#fff", color: T.TEAL, border: "0.5px solid rgba(0,196,180,0.30)" }}>
              {extractingSyllabus ? <Loader2 className="w-3 h-3 animate-spin inline" /> : (overrideSyllabusName ? "Replace" : "Override PDF")}
            </button>
          </div>

          {/* Predict button */}
          <button onClick={() => runPredict(false)} disabled={!canPredict || predicting}
            className="mt-5 w-full h-14 rounded-[16px] text-[15px] font-bold text-white flex items-center justify-center gap-2 transition-transform hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden z-10"
            style={{ background: `linear-gradient(135deg, ${T.B1}, ${T.B2})`, boxShadow: T.SH_BTN, letterSpacing: "-0.1px" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, transparent 52%)" }} />
            {predicting ? <Loader2 className="relative z-10 w-5 h-5 animate-spin" /> : <Sparkles className="relative z-10 w-5 h-5" strokeWidth={2.3} />}
            <span className="relative z-10">{predicting ? "Forecasting…" : prediction ? "Recompute Forecast" : "Predict Results"}</span>
          </button>

          {!canPredict && (
            <div className="mt-3 text-[11px] text-center font-medium" style={{ color: T.T4 }}>
              {!classId
                ? "Select a class to load the roster."
                : roster.length === 0
                  ? "No students enrolled in this class yet."
                  : resolvedPaperText.trim().length <= 30
                    ? "Add a question paper above (pick / upload / paste)."
                    : "Sign in again to refresh teacher session."}
            </div>
          )}

          {/* Cached badge */}
          {prediction && predictionFromCache && predictionCachedAt && (
            <div className="mt-3 flex items-center justify-center gap-2 text-[11px] font-bold" style={{ color: T.VIOLET }}>
              <Clock className="w-3 h-3" />
              Cached · {formatAge(predictionCachedAt)} · No new AI billed
              <button onClick={() => runPredict(true)} className="ml-2 underline" style={{ color: T.B1 }}>
                Regenerate fresh
              </button>
            </div>
          )}
        </div>

        {/* ── PREDICTION RESULTS ── */}
        {prediction && (
          <>
            {/* Class forecast hero */}
            <div {...tilt3D} className="rounded-[26px] px-7 py-6 mb-5 relative overflow-hidden"
              style={{ background: T.HERO_GRAD, boxShadow: "0 8px 30px rgba(0,51,204,0.34), 0 0 0 0.5px rgba(255,255,255,0.14)", ...tilt3DStyle }}>
              <div className="absolute -top-[40px] -right-[30px] w-[260px] h-[260px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
              <div className="relative z-10">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Class forecast — {className} · {subject}
                </div>
                <div className="text-[22px] font-bold text-white leading-[1.35] max-w-3xl" style={{ letterSpacing: "-0.4px" }}>
                  {prediction.class_forecast.headline}
                </div>
                <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
                  <HeroStat icon={GaugeCircle} label="Expected pass" value={`${prediction.class_forecast.expected_pass_pct}%`} />
                  <HeroStat icon={CheckCircle2} label="Predicted avg" value={`${prediction.class_forecast.predicted_class_average}%`} />
                  <HeroStat icon={ListChecks} label="Topics tested" value={String(prediction.paper_summary.topics_detected.length)} />
                  <HeroStat icon={AlertTriangle} label="Difficulty" value={prediction.paper_summary.difficulty_estimate.toUpperCase()} />
                </div>
              </div>
            </div>

            {/* Topics + struggle questions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
              <InfoCard title="Topics this paper tests" tint={T.TEAL}>
                <div className="flex flex-wrap gap-2">
                  {prediction.paper_summary.topics_detected.length === 0 && (
                    <span className="text-[12px]" style={{ color: T.T4 }}>None detected.</span>
                  )}
                  {prediction.paper_summary.topics_detected.map((t, i) => (
                    <span key={i} className="px-3 py-[5px] rounded-full text-[11px] font-bold"
                      style={{ background: "rgba(0,196,180,0.10)", color: T.TEAL, border: "0.5px solid rgba(0,196,180,0.22)" }}>
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-3 text-[12px] leading-[1.55]" style={{ color: T.T2 }}>
                  {prediction.paper_summary.questions_overview}
                </div>
              </InfoCard>

              <InfoCard title="Where the class will struggle" tint={T.RED}>
                <ul className="space-y-2">
                  {prediction.class_forecast.expected_top_struggle_questions.length === 0 && (
                    <li className="text-[12px]" style={{ color: T.T4 }}>No high-risk questions identified.</li>
                  )}
                  {prediction.class_forecast.expected_top_struggle_questions.map((q, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12.5px]" style={{ color: T.T2 }}>
                      <AlertTriangle className="w-[14px] h-[14px] mt-[3px] shrink-0" style={{ color: T.RED }} />
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </InfoCard>
            </div>

            {/* Pre-exam class actions */}
            {prediction.class_forecast.pre_exam_class_actions.length > 0 && (
              <div {...tilt3D} className="bg-white rounded-[20px] p-5 mb-5"
                style={{ boxShadow: T.SH, border: `0.5px solid ${T.BLUE_BDR}`, ...tilt3DStyle }}>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4" style={{ color: T.B1 }} strokeWidth={2.3} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.10em]" style={{ color: T.B1 }}>
                    Run these before the exam
                  </span>
                </div>
                <ul className="space-y-2">
                  {prediction.class_forecast.pre_exam_class_actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] leading-[1.55]" style={{ color: T.T2 }}>
                      <ChevronRight className="w-4 h-4 mt-[2px] shrink-0" style={{ color: T.B1 }} />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 3-tier columns */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <TierColumn label="Pass" band="pass" students={grouped.pass} onPick={setSelectedStudentId} />
              <TierColumn label="Borderline" band="borderline" students={grouped.borderline} onPick={setSelectedStudentId} />
              <TierColumn label="Fail risk" band="fail" students={grouped.fail} onPick={setSelectedStudentId} />
            </div>

            {/* Export button */}
            <div className="mt-6 flex justify-end">
              <button onClick={handleExport}
                className="px-5 py-3 rounded-[12px] text-[13px] font-bold flex items-center gap-2 transition-transform hover:scale-[1.02]"
                style={{ background: "#fff", color: T.T2, border: `0.5px solid ${T.BLUE_BDR}`, boxShadow: T.SH }}>
                <Download className="w-4 h-4" strokeWidth={2.3} />
                Export PDF
              </button>
            </div>
          </>
        )}

        {/* Empty state when no prediction yet */}
        {!prediction && !predicting && (
          <div {...tilt3D} className="bg-white rounded-[22px] p-10 flex flex-col items-center justify-center text-center relative overflow-hidden"
            style={{ boxShadow: T.SH_LG, border: `0.5px solid ${T.BLUE_BDR}`, ...tilt3DStyle }}>
            <div className="absolute -top-[60px] -right-[40px] w-[220px] h-[220px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="w-[80px] h-[80px] rounded-[24px] flex items-center justify-center mb-4 relative z-10"
              style={{ background: `linear-gradient(135deg, ${T.B1}, ${T.B3})`, boxShadow: T.SH_BTN }}>
              <Sparkles className="w-[36px] h-[36px] text-white" strokeWidth={2.2} />
            </div>
            <div className="text-[22px] font-bold mb-1 relative z-10" style={{ color: T.T1, letterSpacing: "-0.4px" }}>
              Forecast results before they happen
            </div>
            <div className="text-[14px] font-normal leading-[1.55] max-w-[480px] relative z-10" style={{ color: T.T3 }}>
              Pick a saved test or upload a draft paper, choose the class, and Edullent will tell you exactly which students need attention this week — and which questions the class will struggle on.
            </div>
            <Link to="/tests" className="mt-5 text-[12px] font-bold relative z-10" style={{ color: T.B1 }}>
              Or jump to Tests & Exams →
            </Link>
          </div>
        )}
      </div>

      {/* Student drill-down panel */}
      {selectedStudent && (
        <StudentDetailPanel
          student={selectedStudent}
          history={studentHistory.find(h => h.studentId === selectedStudent.studentId) || null}
          totalMarks={totalMarks}
          onClose={() => setSelectedStudentId(null)}
        />
      )}
    </div>
  );
};

// ── Sub-components (module scope to avoid remount-flicker; tokens hoisted) ───
const HeroStat: React.FC<{ icon: any; label: string; value: string }> = ({ icon: Icon, label, value }) => (
  <div className="px-4 py-3 rounded-[14px]"
    style={{ background: "rgba(255,255,255,0.10)", border: "0.5px solid rgba(255,255,255,0.18)", backdropFilter: "blur(8px)" }}>
    <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(255,255,255,0.55)" }}>
      <Icon className="w-3 h-3" /> {label}
    </div>
    <div className="text-[20px] font-bold text-white mt-1" style={{ letterSpacing: "-0.3px" }}>{value}</div>
  </div>
);

const InfoCard: React.FC<{ title: string; tint: string; children: React.ReactNode }> = ({ title, tint, children }) => (
  <div {...tilt3D} className="bg-white rounded-[20px] p-5"
    style={{ boxShadow: T.SH, border: `0.5px solid ${T.BLUE_BDR}`, ...tilt3DStyle }}>
    <div className="flex items-center gap-2 mb-3">
      <span className="w-[6px] h-[6px] rounded-full" style={{ background: tint, boxShadow: `0 0 0 3px ${tint}22` }} />
      <span className="text-[11px] font-bold uppercase tracking-[0.10em]" style={{ color: tint }}>
        {title}
      </span>
    </div>
    {children}
  </div>
);

const TierColumn: React.FC<{
  label: string;
  band: StudentPrediction["predicted_band"];
  students: StudentPrediction[];
  onPick: (id: string) => void;
}> = ({ label, band, students, onPick }) => {
  const t = tierStyle(band);
  const Icon = t.icon;
  return (
    <div {...tilt3D} className="bg-white rounded-[22px] overflow-hidden"
      style={{ boxShadow: T.SH_LG, border: `0.5px solid ${T.BLUE_BDR}`, ...tilt3DStyle }}>
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ background: t.bg, borderBottom: `0.5px solid ${t.bdr}` }}>
        <div className="flex items-center gap-2">
          <Icon className="w-[18px] h-[18px]" style={{ color: t.color2 }} strokeWidth={2.5} />
          <span className="text-[14px] font-bold uppercase tracking-[0.10em]" style={{ color: t.color2 }}>
            {label}
          </span>
        </div>
        <div className="px-3 py-1 rounded-full text-[12px] font-bold"
          style={{ background: "#fff", color: t.color2, border: `0.5px solid ${t.bdr}` }}>
          {students.length}
        </div>
      </div>
      <div className="p-3 space-y-2 max-h-[520px] overflow-y-auto">
        {students.length === 0 && (
          <div className="text-center py-8 text-[12px]" style={{ color: T.T4 }}>
            No students in this tier.
          </div>
        )}
        {students.map(s => (
          <button key={s.studentId} onClick={() => onPick(s.studentId)}
            className="w-full text-left px-4 py-3 rounded-[14px] transition-transform hover:scale-[1.005]"
            style={{ background: T.BG, border: `0.5px solid ${T.BLUE_BDR}` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-bold truncate pr-2" style={{ color: T.T1 }}>{s.name}</span>
              <span className="text-[12px] font-bold shrink-0" style={{ color: t.color2 }}>
                {s.predicted_score_min}–{s.predicted_score_max}%
              </span>
            </div>
            <div className="text-[11px] font-medium" style={{ color: T.T3 }}>
              {confLabel(s.confidence)}
            </div>
            {(s.gaps_for_paper?.[0] || s.top_strengths_for_paper?.[0]) && (
              <div className="text-[11px] mt-1 truncate" style={{ color: T.T4 }}>
                {s.gaps_for_paper?.[0] || s.top_strengths_for_paper?.[0]}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

const StudentDetailPanel: React.FC<{
  student: StudentPrediction;
  history: StudentHistoryBundle | null;
  totalMarks: number;
  onClose: () => void;
}> = ({ student, history, totalMarks, onClose }) => {
  const t = tierStyle(student.predicted_band);
  const Icon = t.icon;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6"
      style={{ background: "rgba(0, 16, 64, 0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}>
      <div className="bg-white w-full md:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-[24px] md:rounded-[24px] p-6"
        style={{ boxShadow: "0 -10px 40px rgba(0,16,64,0.20)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-[14px] flex items-center justify-center"
              style={{ background: t.bg, border: `0.5px solid ${t.bdr}` }}>
              <Icon className="w-6 h-6" style={{ color: t.color2 }} strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.10em]" style={{ color: t.color2 }}>
                {t.label} · {confLabel(student.confidence)}
              </div>
              <div className="text-[20px] font-bold leading-[1.2]" style={{ color: T.T1 }}>{student.name}</div>
              <div className="text-[12px] mt-[2px]" style={{ color: T.T3 }}>
                Predicted: <strong style={{ color: t.color2 }}>{student.predicted_score_min}–{student.predicted_score_max}%</strong> of {totalMarks} marks
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: T.BG, color: T.T3 }}>
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <Block title="Reasoning" tint={t.color2}>
            <p className="text-[13px] leading-[1.6]" style={{ color: T.T2 }}>{student.reasoning}</p>
          </Block>

          {student.top_strengths_for_paper.length > 0 && (
            <Block title="Strengths for this paper" tint={T.GREEN}>
              <ul className="space-y-2">
                {student.top_strengths_for_paper.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12.5px] leading-[1.55]" style={{ color: T.T2 }}>
                    <CheckCircle2 className="w-[14px] h-[14px] mt-[3px] shrink-0" style={{ color: T.GREEN2 }} />
                    {s}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {student.gaps_for_paper.length > 0 && (
            <Block title="Gaps for this paper" tint={T.RED}>
              <ul className="space-y-2">
                {student.gaps_for_paper.map((g, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12.5px] leading-[1.55]" style={{ color: T.T2 }}>
                    <AlertTriangle className="w-[14px] h-[14px] mt-[3px] shrink-0" style={{ color: T.RED2 }} />
                    {g}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          <Block title="Recommended pre-exam action" tint={T.B1}>
            <p className="text-[13px] leading-[1.6] font-medium" style={{ color: T.T2 }}>
              {student.recommended_pre_exam_action}
            </p>
          </Block>

          {history && (
            <Block title="History snapshot" tint={T.VIOLET}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[12px]" style={{ color: T.T2 }}>
                <Stat label="Recent tests" value={String(history.recentTests)} />
                <Stat label="Avg score" value={`${history.avgScore}%`} />
                <Stat label="Attendance" value={history.attendancePct == null ? "—" : `${history.attendancePct}%`} />
                <Stat label="Behaviour" value={history.behaviourRating == null ? "—" : `${history.behaviourRating} / 5`} />
                <Stat label="Strong topics" value={String(history.strongTopics.length)} />
                <Stat label="Weak topics" value={String(history.weakTopics.length)} />
              </div>
              {history.last3Scores.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-2" style={{ color: T.T4 }}>
                    Last 3 scores
                  </div>
                  <div className="space-y-1">
                    {history.last3Scores.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-[12px]" style={{ color: T.T2 }}>
                        <span className="truncate pr-2">{s.name}</span>
                        <strong>{s.pct}%</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Block>
          )}
        </div>
      </div>
    </div>
  );
};

const Block: React.FC<{ title: string; tint: string; children: React.ReactNode }> = ({ title, tint, children }) => (
  <div className="px-4 py-3 rounded-[14px]" style={{ background: T.BG, border: `0.5px solid ${T.BLUE_BDR}` }}>
    <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-2" style={{ color: tint }}>{title}</div>
    {children}
  </div>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-3 py-2 rounded-[10px] bg-white" style={{ border: `0.5px solid ${T.BLUE_BDR}` }}>
    <div className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: T.T4 }}>{label}</div>
    <div className="text-[15px] font-bold" style={{ color: T.T1 }}>{value}</div>
  </div>
);

export default ResultPredictor;
