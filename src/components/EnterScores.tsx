import { useState, useEffect, useRef } from "react";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs, doc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { auditedSet, auditedUpdate } from "../lib/auditedWrites";

// Replace characters that are problematic in filenames across OS filesystems.
const sanitizeFilename = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, "_").trim() || "scores";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
const loadXLSX = () => import("xlsx");

// ── Blue Apple design tokens (matches all other teacher pages) ──────────────
const T = {
  FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
  bg:    "#EEF4FF",
  white: "#FFFFFF",
  ink1:  "#001040",  // T1 primary text
  ink2:  "#5070B0",  // T3 secondary
  ink3:  "#99AACC",  // T4 muted
  s1:    "#F4F7FE",  // surface
  s2:    "#EAF0FB",  // separator
  bdr:   "rgba(0,85,255,0.10)",
  blue:  "#0055FF",  // primary
  blBg:  "rgba(0,85,255,0.10)",
  grn2:  "#00C853",
  glBg:  "rgba(0,200,83,0.10)",
  red:   "#FF3355",
  rlBg:  "rgba(255,51,85,0.10)",
  amb:   "#FF8800",
  alBg:  "rgba(255,136,0,0.10)",
  // Card shadow stack — same Blue Apple halo used elsewhere.
  SH:    "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
  SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
  HERO_GRAD: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
};

// ── Avatar helpers ────────────────────────────────────────────────────────────
const AV = [
  { bg: "#FFF9DB", c: "#C87014" },
  { bg: "#E3FAFC", c: "#0C8599" },
  { bg: "#EDF2FF", c: "#3B5BDB" },
  { bg: "#F3F0FF", c: "#6741D9" },
  { bg: "#EBFBEE", c: "#087F5B" },
  { bg: "#FFF5F5", c: "#C92A2A" },
  { bg: "#FFF4E6", c: "#D9480F" },
];
const avStyle = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV[h % AV.length];
};
// Local to this component: first + last name initials, which fits the
// class-roster display (e.g. "Ram Kumar Sharma" -> "RS"). This is
// intentionally different from `lib/initials.ts` (first + second word)
// which is used for the logged-in teacher's avatar.
const getStudentInitials = (name: string) => {
  const p = (name || "").trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
};

// ── Grade helper ──────────────────────────────────────────────────────────────
const gradeInfo = (score: number, max: number) => {
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(score)) {
    return { label: "—", bg: T.s2, color: T.ink3, band: T.ink3 };
  }
  const pct = (score / max) * 100;
  if (pct >= 80) return { label: "A", bg: T.glBg, color: T.grn2, band: T.grn2 };
  if (pct >= 60) return { label: "B", bg: T.blBg, color: T.blue, band: T.blue };
  if (pct >= 40) return { label: "C", bg: T.alBg, color: T.amb, band: T.amb };
  return { label: "D", bg: T.rlBg, color: T.red, band: T.red };
};

const ITEMS_PER_PAGE = 8;

interface TestDoc {
  id: string;
  classId: string;
  marks?: string | number;
  title?: string;
  testName?: string;
  subject?: string;
  date?: string;
  testDate?: string;
  [key: string]: unknown;
}

interface StudentScoreRow {
  id: string;
  name: string;
  rollNo: string;
  email: string;
  className?: string;
  score: string;
  isAbsent: boolean;
  feedback?: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface EnterScoresProps {
  test: TestDoc;
  onBack: () => void;
}

export default function EnterScores({ test, onBack }: EnterScoresProps) {
  const { teacherData } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [students, setStudents] = useState<StudentScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = ITEMS_PER_PAGE;
  const parsedMarks = parseFloat(test?.marks);
  const maxScore = Number.isFinite(parsedMarks) && parsedMarks > 0 ? parsedMarks : 50;

  // ── Firebase: fetch roster + existing scores ────────────────────────────
  useEffect(() => {
    if (!test?.classId || !teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;

    const qRoster = query(
      collection(db, "enrollments"),
      where("schoolId", "==", schoolId),
      where("classId", "==", test.classId),
    );

    // Guard against a stale `getDocs` response overwriting state from a
    // newer snapshot: if the effect cleans up mid-fetch, ignore the result.
    let ignore = false;
    const unsub = onSnapshot(qRoster, async (snap) => {
      const qScores = query(
        collection(db, "test_scores"),
        where("schoolId", "==", schoolId),
        where("testId", "==", test.id),
      );
      const scoresSnap = await getDocs(qScores);
      if (ignore) return;
      const existingScores = scoresSnap.docs.map(d => d.data());

      const roster: StudentScoreRow[] = snap.docs.map(d => {
        const data = d.data() as Record<string, unknown>;
        const studentId = (data.studentId as string) || d.id;
        const existing = existingScores.find(s => s.studentId === studentId);
        return {
          id: studentId,
          name: (data.studentName as string) || "Student",
          email: (data.studentEmail as string) || "",
          rollNo: (data.rollNo as string) || "—",
          className: (data.className as string) || (test as { className?: string }).className || "",
          score: existing?.score != null ? String(existing.score) : "",
          isAbsent: !!existing?.isAbsent,
        };
      });
      roster.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setStudents(roster);
      setLoading(false);
    });
    return () => { ignore = true; unsub(); };
  }, [test?.classId, test?.id, teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // ── Score change handler ────────────────────────────────────────────────
  const handleScoreChange = (id: string, val: string) => {
    if (val === "") {
      setStudents(prev => prev.map(s => s.id === id ? { ...s, score: "" } : s));
      return;
    }
    // Accept only well-formed positive numbers (digits with optional decimal).
    // Previously "1abc" slipped through because parseFloat stopped at the
    // first non-digit and returned a finite number.
    if (!/^\d+(\.\d+)?$/.test(val)) return;
    const num = parseFloat(val);
    if (!Number.isFinite(num) || num < 0 || num > maxScore) return;
    setStudents(prev => prev.map(s => s.id === id ? { ...s, score: val } : s));
  };

  const toggleAbsent = (id: string) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== id) return s;
      return { ...s, isAbsent: !s.isAbsent, score: !s.isAbsent ? "" : s.score };
    }));
  };

  // ── Stats ───────────────────────────────────────────────────────────────
  const calcStats = () => {
    let total = 0, count = 0;
    const dist = { a: 0, b: 0, c: 0, d: 0, absent: 0 };
    students.forEach(s => {
      if (s.isAbsent) { dist.absent++; return; }
      if (s.score !== "" && !isNaN(parseFloat(s.score))) {
        const v = parseFloat(s.score);
        total += v; count++;
        const pct = (v / maxScore) * 100;
        if (pct >= 80) dist.a++;
        else if (pct >= 60) dist.b++;
        else if (pct >= 40) dist.c++;
        else dist.d++;
      }
    });
    const avg = count > 0 ? total / count : 0;
    const avgPct = count > 0 ? (avg / maxScore) * 100 : 0;
    return { avg, avgPct, dist, count };
  };
  const { avg, avgPct, dist, count: scoredCount } = calcStats();

  // ── Import/Export Excel ─────────────────────────────────────────────────
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const json = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
      let updated = 0;
      setStudents(prev => {
        const copy = [...prev];
        json.forEach(row => {
          const roll = row["Roll No"] || row["RollNo"] || row["rollNo"];
          const name = row["Name"] || row["Student Name"];
          const score = row["Score"] || row["Marks"];
          if (score !== undefined) {
            const idx = copy.findIndex(s =>
              (roll && s.rollNo?.toString() === roll.toString()) ||
              (name && s.name?.toLowerCase() === name.toString().toLowerCase())
            );
            if (idx >= 0) {
              const p = parseFloat(score);
              // Must be finite AND within [0, maxScore] — no negatives, no Infinity.
              if (Number.isFinite(p) && p >= 0 && p <= maxScore) {
                copy[idx] = { ...copy[idx], score: p.toString() };
                updated++;
              }
            }
          }
        });
        return copy;
      });
      toast.success(`${updated} scores imported from Excel.`);
    } catch (err) {
      console.error("[EnterScores] Excel import failed:", err);
      toast.error("Failed to parse Excel file.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleExportExcel = async () => {
    try {
      const XLSX = await loadXLSX();
      const data = students.map(s => ({
        "Test Name": test.title, "Class Name": (test as Record<string, unknown>).className || "",
        "Roll No": s.rollNo, "Student Name": s.name,
        "Score": s.score || "", "Total Marks": maxScore,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Scores");
      const className = typeof (test as Record<string, unknown>).className === "string"
        ? (test as Record<string, string>).className
        : "class";
      const title = typeof test.title === "string" ? test.title : "test";
      XLSX.writeFile(wb, `${sanitizeFilename(className)}_${sanitizeFilename(title)}_Scores.xlsx`);
      toast.success("Excel exported!");
    } catch (err) {
      console.error("[EnterScores] export failed:", err);
      toast.error("Export failed.");
    }
  };

  // ── Save to Firebase ────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      // Firestore doc IDs cannot contain / \ # ? — sanitize before building.
      const safeDocId = (s: string) =>
        s.replace(/[/\\#?]/g, "_").slice(0, 1500);

      const rowsToSave = students.filter(s => s.score !== "" || s.isAbsent);
      // Inherit subject + topic from the parent test doc so the analytics
      // page can group scores by real topic/subject instead of falling back
      // to "General topics" for everything. Subject is the broad area (e.g.
      // "Math"); topic the finer grain (e.g. "Chapter 1 Algebra"). The
      // CreateTest form writes topics as an ARRAY (`topics: ["x","y"]`) so
      // we accept either shape — array first element wins, then singular,
      // then subject, then title as last resort.
      const tDoc = test as { subject?: string; topic?: string; topics?: string[]; title?: string; className?: string };
      const inheritedSubject = (tDoc.subject || "").trim();
      const firstArrayTopic  = Array.isArray(tDoc.topics) && tDoc.topics.length > 0 ? String(tDoc.topics[0] || "").trim() : "";
      const inheritedTopic   = (firstArrayTopic || tDoc.topic || tDoc.subject || tDoc.title || "").trim();
      const inheritedClassName = (tDoc.className || "").toLowerCase().trim();
      const results = await Promise.allSettled(rowsToSave.map(s => {
        const scoreNum = s.score !== "" ? parseFloat(s.score) : null;
        const pct = scoreNum != null ? (scoreNum / maxScore) * 100 : 0;
        const g = scoreNum != null ? gradeInfo(scoreNum, maxScore) : null;
        return auditedSet(doc(db, "test_scores", safeDocId(`${test.id}_${s.id}`)), {
          testId: test.id, testName: test.title,
          studentId: s.id, studentName: s.name, studentEmail: s.email,
          classId: test.classId, className: inheritedClassName,
          subject: inheritedSubject, topic: inheritedTopic,
          teacherId: teacherData?.id,
          schoolId: teacherData?.schoolId || "", branchId: teacherData?.branchId || "",
          score: scoreNum,
          maxScore, percentage: pct, grade: g?.label || "-",
          isAbsent: s.isAbsent, timestamp: serverTimestamp(),
        });
      }));
      const failed = results
        .map((r, i) => ({ r, name: rowsToSave[i].name }))
        .filter(x => x.r.status === "rejected");
      if (failed.length > 0) {
        console.error("[EnterScores] partial save failure", failed);
        toast.error(`Saved ${rowsToSave.length - failed.length}/${rowsToSave.length}. Failed: ${failed.map(f => f.name).join(", ")}`);
        return;
      }
      await auditedUpdate(doc(db, "tests", test.id), { status: "Completed", classAverage: avgPct });
      toast.success("Scores saved successfully!");
      onBack();
    } catch (err) {
      console.error("[EnterScores] save failed:", err);
      toast.error("Failed to save scores.");
    } finally { setSaving(false); }
  };

  // ── Pagination ──────────────────────────────────────────────────────────
  const filtered = students.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.FONT, fontVariantNumeric: "tabular-nums" }}>

      {/* ═══ HERO — Blue Apple gradient ════════════════════════════════════
          Was a flat black `#08090C` panel; replaced with the dashboard-wide
          deep-navy → blue gradient + soft white sheen so Enter Scores feels
          continuous with the rest of the app. */}
      <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 relative overflow-hidden"
        style={{ background: T.HERO_GRAD, boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.30)" }}>
        {/* Diagonal sheen */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
        <div style={{ position: "relative", zIndex: 1, padding: "14px 22px 0" }}>
          {/* Back */}
          <button type="button" onClick={onBack} aria-label="Back to tests"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px 5px 6px", borderRadius: 999,
              background: "rgba(255,255,255,0.12)",
              border: "0.5px solid rgba(255,255,255,0.20)",
              cursor: "pointer", marginBottom: 14,
              fontFamily: T.FONT,
            }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#B5CEFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8,2 3,6.5 8,11" />
            </svg>
            <span style={{ fontSize: 11, color: "#B5CEFF", fontWeight: 700, letterSpacing: "-0.1px" }}>Back to tests</span>
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.65)", letterSpacing: "1.6px", textTransform: "uppercase", marginBottom: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: "#6FB0FF" }} />
            Enter test scores
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>
            Enter test scores
          </h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", marginTop: 8, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", letterSpacing: "-0.1px", fontWeight: 500 }}>
            <span style={{ color: "#fff", fontWeight: 700 }}>{test.title || "Test"}</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,0.4)" }} />
            <span>{(test as { className?: string }).className || "Class"}</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,0.4)" }} />
            <span>{maxScore} marks</span>
          </p>
        </div>

        {/* Class avg + Save — glass panel for the bottom row */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 22px 22px", flexWrap: "wrap" }}>
          <div style={{
            padding: "10px 16px", borderRadius: 14,
            background: "rgba(255,255,255,0.10)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            border: "0.5px solid rgba(255,255,255,0.18)",
            minWidth: 160,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.65)", letterSpacing: "1.4px", textTransform: "uppercase" }}>Class average</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>{avg.toFixed(1)}/{maxScore}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: avgPct >= 75 ? "#6FFFAA" : avgPct >= 60 ? "#FFD166" : avgPct > 0 ? "#FF99AA" : "rgba(255,255,255,0.55)" }}>
                ({avgPct.toFixed(0)}%)
              </span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginTop: 2, letterSpacing: "-0.05px" }}>
              {scoredCount} scored · {dist.absent} absent
            </div>
          </div>
          <button type="button" onClick={handleSave} disabled={saving} style={{
            padding: "11px 20px", borderRadius: 12,
            background: T.grn2, border: "none", color: "#fff",
            fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
            cursor: saving ? "not-allowed" : "pointer",
            fontFamily: T.FONT,
            display: "flex", alignItems: "center", gap: 7,
            opacity: saving ? 0.7 : 1,
            boxShadow: "0 1px 2px rgba(0,200,83,0.30), 0 6px 18px rgba(0,200,83,0.38)",
          }}>
            {saving ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1.5,6.5 4.5,10 10.5,3" />
              </svg>
            )}
            {saving ? "Saving…" : "Save scores"}
          </button>
        </div>
      </div>

      {/* ═══ BODY ════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 18 }}>

        {/* Grade distribution label */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 2px" }}>
          <span style={{ width: 5, height: 5, borderRadius: 2, background: T.blue }} />
          <p style={{ fontSize: 10, fontWeight: 700, color: T.ink2, letterSpacing: "1.5px", textTransform: "uppercase", margin: 0 }}>Grade distribution</p>
        </div>

        {/* Grade grid — Blue Apple tinted card vibe */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { label: "A grade (80%+)",  val: dist.a, color: T.grn2,  tintBg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)", tintBd: "rgba(0,200,83,0.16)" },
            { label: "B grade (60–79%)",val: dist.b, color: T.blue,  tintBg: "linear-gradient(135deg, #EEF3FF 0%, #DCE7FF 100%)", tintBd: "rgba(0,85,255,0.14)"  },
            { label: "C grade (40–59%)",val: dist.c, color: T.amb,   tintBg: "linear-gradient(135deg, #FFF6E0 0%, #FFEDC4 100%)", tintBd: "rgba(255,136,0,0.16)" },
            { label: "D grade (<40%)",  val: dist.d, color: T.red,   tintBg: "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)", tintBd: "rgba(255,51,85,0.16)" },
          ].map(g => {
            const maxBar = Math.max(dist.a, dist.b, dist.c, dist.d, 1);
            return (
              <div key={g.label} style={{ background: g.tintBg, border: `0.5px solid ${g.tintBd}`, borderRadius: 18, padding: 16, boxShadow: "0 6px 18px rgba(20,40,90,0.06), 0 1px 3px rgba(20,40,90,0.04)" }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: `${g.color}1F`, color: g.color, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 11L7 2L12 11Z"/><line x1="4.5" y1="8" x2="9.5" y2="8"/>
                  </svg>
                </div>
                <p style={{ fontSize: 28, fontWeight: 700, color: g.color, letterSpacing: "-0.8px", lineHeight: 1, margin: 0 }}>{g.val}</p>
                <p style={{ fontSize: 11, fontWeight: 600, color: T.ink2, marginTop: 6, letterSpacing: "-0.1px" }}>{g.label}</p>
                <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.55)", marginTop: 10, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2, background: g.color, width: `${(g.val / maxBar) * 100}%`, transition: "width 0.3s" }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Absent card */}
        <div style={{ background: T.white, border: `0.5px solid ${T.bdr}`, borderRadius: 18, padding: 16, display: "flex", alignItems: "center", gap: 14, boxShadow: T.SH_SM }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: T.rlBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={T.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 2L17 16H1L9 2z" /><line x1="9" y1="7" x2="9" y2="11" />
              <circle cx="9" cy="13.5" r="0.9" fill={T.red} stroke="none" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 24, fontWeight: 700, color: T.ink1, letterSpacing: "-0.5px", margin: 0 }}>{dist.absent}</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: T.ink2, marginTop: 2 }}>Absent / not attempted</p>
          </div>
          <div style={{ width: 56, height: 6, borderRadius: 3, background: T.s2, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 3, background: T.red, width: `${students.length > 0 ? (dist.absent / students.length) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Student scores header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 17, fontWeight: 700, color: T.ink1, letterSpacing: "-0.4px", margin: 0 }}>Student scores</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: T.ink2, marginTop: 3, letterSpacing: "-0.1px" }}>{filtered.length} student{filtered.length !== 1 ? "s" : ""} · Click to enter marks</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Search */}
            <div style={{ position: "relative" }}>
              <svg style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={T.ink3} strokeWidth="1.8" strokeLinecap="round">
                <circle cx="6" cy="6" r="4" /><line x1="9" y1="9" x2="12" y2="12" />
              </svg>
              <input
                value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                placeholder="Search…"
                style={{ width: 130, padding: "9px 12px 9px 30px", borderRadius: 11, border: `0.5px solid ${T.bdr}`, background: T.white, fontSize: 12, fontWeight: 500, color: T.ink1, fontFamily: T.FONT, outline: "none" }}
              />
            </div>
            {/* Export — Blue Apple primary button */}
            <button type="button" onClick={handleExportExcel} style={{
              padding: "9px 14px", borderRadius: 11, background: T.blue,
              border: "none", color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: "-0.1px",
              cursor: "pointer", fontFamily: T.FONT,
              display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
              boxShadow: "0 1px 2px rgba(0,85,255,0.20), 0 4px 12px rgba(0,85,255,0.28)",
            }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
                <polyline points="6,2 6,8.5" /><polyline points="3.5,6.5 6,9 8.5,6.5" /><line x1="2" y1="11" x2="10" y2="11" />
              </svg>
              Export
            </button>
          </div>
        </div>

        {/* Hidden file input for import */}
        <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" onChange={handleImportExcel} style={{ display: "none" }} />

        {/* Student cards */}
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
            <Loader2 style={{ width: 24, height: 24, color: T.blue }} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 14px", fontSize: 12, color: T.ink3 }}>No students found</div>
        ) : (
          paginated.map(s => {
            const av = avStyle(s.name || "S");
            const hasScore = s.score !== "" && !isNaN(parseFloat(s.score));
            const scoreVal = hasScore ? parseFloat(s.score) : 0;
            const pct = hasScore ? Math.round((scoreVal / maxScore) * 100) : 0;
            const g = hasScore ? gradeInfo(scoreVal, maxScore) : null;

            return (
              <div key={s.id} style={{ background: T.white, border: `0.5px solid ${T.bdr}`, borderRadius: 18, overflow: "hidden", boxShadow: T.SH_SM }}>
                {/* Color band */}
                <div style={{ height: 3, background: s.isAbsent ? T.red : g ? g.band : T.s2 }} />

                <div style={{ padding: 16 }}>
                  {/* Top: avatar + name + badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
                    <div style={{
                      width: 42, height: 42, borderRadius: 13,
                      background: av.bg, color: av.c,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700, flexShrink: 0, letterSpacing: "0.4px",
                    }}>
                      {getStudentInitials(s.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: T.ink1, letterSpacing: "-0.2px", margin: 0 }}>{s.name}</p>
                      <p style={{ fontSize: 11, fontWeight: 600, color: T.ink2, marginTop: 2 }}>Roll: {s.rollNo}{s.className ? ` · ${s.className}` : ""}</p>
                    </div>
                    <span style={{
                      padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.3px",
                      background: s.isAbsent ? T.rlBg : g ? g.bg : T.s2,
                      color: s.isAbsent ? T.red : g ? g.color : T.ink2,
                      border: `0.5px solid ${s.isAbsent ? "rgba(255,51,85,0.20)" : g ? `${g.color}33` : "rgba(0,85,255,0.10)"}`,
                    }}>
                      {s.isAbsent ? "Absent" : hasScore ? `${scoreVal}/${maxScore}` : "Not entered"}
                    </span>
                  </div>

                  {/* Score input */}
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: T.ink2, letterSpacing: "1.4px", textTransform: "uppercase", marginBottom: 7 }}>
                      Score — {test.title || "Test"}
                    </p>
                    <div style={{ position: "relative" }}>
                      <input
                        type="number"
                        min={0} max={maxScore}
                        value={s.score}
                        disabled={s.isAbsent}
                        onChange={e => handleScoreChange(s.id, e.target.value)}
                        placeholder="Enter score"
                        aria-label={`Score for ${s.name} out of ${maxScore}`}
                        style={{
                          width: "100%", padding: "11px 44px 11px 13px",
                          borderRadius: 12, border: `0.5px solid ${T.bdr}`,
                          background: s.isAbsent ? T.s1 : T.white, fontSize: 15, fontWeight: 600,
                          color: T.ink1, fontFamily: T.FONT, outline: "none",
                          opacity: s.isAbsent ? 0.4 : 1,
                          transition: "border-color 0.2s, box-shadow 0.2s",
                        }}
                      />
                      <span style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", fontSize: 11, fontWeight: 700, color: T.ink2, pointerEvents: "none" }}>
                        /{maxScore}
                      </span>
                    </div>
                  </div>

                  {/* Grade bar (shown when score entered) */}
                  {hasScore && g && (
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
                      <span style={{ padding: "5px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: g.bg, color: g.color, border: `0.5px solid ${g.color}33`, letterSpacing: "0.2px" }}>
                        Grade {g.label}
                      </span>
                      <div style={{ flex: 1, height: 5, borderRadius: 3, background: T.s2, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 3, background: g.band, width: `${pct}%`, transition: "width 0.3s" }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: g.color }}>{pct}%</span>
                    </div>
                  )}

                  {/* Absent toggle — rendered as a button so it's keyboard-accessible */}
                  <button
                    type="button"
                    onClick={() => toggleAbsent(s.id)}
                    aria-pressed={s.isAbsent}
                    aria-label={`Mark ${s.name} as absent`}
                    style={{
                      display: "flex", alignItems: "center", gap: 7, marginTop: 8,
                      cursor: "pointer", background: "none", border: "none", padding: 0,
                      fontFamily: T.FONT,
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: 6,
                      border: s.isAbsent ? "none" : `1.5px solid ${T.bdr}`,
                      background: s.isAbsent ? T.red : T.s1,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "background 80ms",
                    }}>
                      {s.isAbsent && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                          <polyline points="1.5,5 4,8 8.5,2" />
                        </svg>
                      )}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.ink2 }}>Mark as absent</span>
                  </button>
                </div>
              </div>
            );
          })
        )}

        {/* Pager */}
        {!loading && filtered.length > 0 && (
          <div style={{
            background: T.white, border: `0.5px solid ${T.bdr}`, borderRadius: 14,
            padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
            boxShadow: T.SH_SM,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: T.ink2 }}>
              Showing {Math.min(filtered.length, (currentPage - 1) * itemsPerPage + 1)} – {Math.min(filtered.length, currentPage * itemsPerPage)} of {filtered.length}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}
                aria-label="Previous page"
                style={{
                  width: 30, height: 30, borderRadius: 9,
                  border: `0.5px solid ${T.bdr}`, background: T.s1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: currentPage === 1 ? "default" : "pointer",
                  opacity: currentPage === 1 ? 0.4 : 1,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink2} strokeWidth="2" strokeLinecap="round"><polyline points="8,2 4,6 8,10" /></svg>
              </button>
              <div style={{
                minWidth: 30, height: 30, padding: "0 10px", borderRadius: 9, background: T.blue,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: "#fff", letterSpacing: "-0.1px",
                boxShadow: "0 1px 2px rgba(0,85,255,0.20), 0 3px 8px rgba(0,85,255,0.25)",
              }}>
                {currentPage} / {totalPages}
              </div>
              <button type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
                aria-label="Next page"
                style={{
                  width: 30, height: 30, borderRadius: 9,
                  border: `0.5px solid ${T.bdr}`, background: T.s1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: currentPage === totalPages ? "default" : "pointer",
                  opacity: currentPage === totalPages ? 0.4 : 1,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink2} strokeWidth="2" strokeLinecap="round"><polyline points="4,2 8,6 4,10" /></svg>
              </button>
            </div>
          </div>
        )}

        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}