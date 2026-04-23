import { useState, useEffect } from "react";
import ConceptMasteryDetail from "@/components/ConceptMasteryDetail";
import { Loader2 } from "lucide-react";
import { db } from "../lib/firebase";
import {
  collection, query, onSnapshot, getDocs, where,
  type QueryConstraint,
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF', blueB: '#BAC8FF',
  green2: '#2F9E44', greenL: '#EBFBEE', greenB: '#8CE99A', green: '#087F5B',
  red: '#C92A2A', redL: '#FFF5F5', redB: '#FFC9C9',
  amber: '#C87014', amberL: '#FFF9DB', amberB: '#FFE066',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── Avatar palette ────────────────────────────────────────────────────────────
const AV_PALETTES = [
  { bg: '#E8F4FD', color: '#1971C2' },
  { bg: '#EBFBEE', color: '#2F9E44' },
  { bg: '#FFF9DB', color: '#C87014' },
  { bg: '#FFE8CC', color: '#D9480F' },
  { bg: '#F3F0FF', color: '#6741D9' },
  { bg: '#FFF0F6', color: '#C2255C' },
  { bg: '#E6FCF5', color: '#0C8599' },
];
const avStyle = (name: string) => {
  const sum = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AV_PALETTES[sum % AV_PALETTES.length];
};
const getInitials = (name: string) => {
  const p = (name || '').trim().split(' ');
  return (p.length >= 2 ? p[0][0] + p[1][0] : (p[0]?.[0] || '?')).toUpperCase();
};

// Mobile avatar color palette (mockup design)
const MOB_AV_PALETTE = ['#7B3FF4', '#00C853', '#0957F7', '#FF8800', '#00B8D4', '#C2255C', '#6741D9'];
const mobAvatarColor = (name: string) => {
  const sum = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return MOB_AV_PALETTE[sum % MOB_AV_PALETTE.length];
};

// Legacy avatar colors (kept for roster build — not used in render)
const avatarColors = [
  "bg-blue-600", "bg-indigo-600", "bg-violet-600", "bg-teal-600",
  "bg-cyan-600", "bg-rose-500", "bg-amber-500", "bg-emerald-600",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const getMasteryStatus = (pct: number | null) => {
  if (pct === null) return { label: 'Not assessed', bg: T.s2, color: T.ink2 };
  if (pct >= 80)    return { label: 'Mastered',     bg: T.greenL, color: T.green };
  if (pct >= 50)    return { label: 'Developing',   bg: T.amberL, color: T.amber };
  return              { label: 'Weak',             bg: T.redL,   color: T.red   };
};

const getStudentMastery = (student: any): number | null => {
  if (!student.concepts || student.concepts.length === 0) return null;
  const nonZero = student.concepts.filter((c: number) => c > 0);
  if (nonZero.length === 0) return null;
  return Math.round(nonZero.reduce((a: number, b: number) => a + b, 0) / nonZero.length);
};


// ─────────────────────────────────────────────────────────────────────────────
const ConceptMastery = () => {
  const { teacherData } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState<any>(null);

  const [dynamicHeaders, setDynamicHeaders] = useState<string[]>([]);
  const [masteryData, setMasteryData] = useState<any[]>([]);
  const [classAverages, setClassAverages] = useState<number[]>([]);

  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  // ── 1. Fetch Teacher's Active Assignments ─────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));

    let unsub: (() => void) | null = null;
    let cancelled = false;

    const init = async () => {
      const classSnap = await getDocs(query(collection(db, "classes"), ...SC));
      if (cancelled) return;
      const classMap = new Map<string, any>();
      classSnap.docs.forEach(d => classMap.set(d.id, d.data()));
      const legacyOptions = classSnap.docs
        .filter(d => d.data().teacherId === teacherData.id)
        .map(d => ({ id: d.id, classId: d.id, name: d.data().name }));

      const q = query(collection(db, "teaching_assignments"), where("teacherId", "==", teacherData.id), ...SC);
      unsub = onSnapshot(q, (snap) => {
        const assignments = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(a => !a.status || a.status.toLowerCase() === "active");

        const assignmentOptions = assignments.map(a => {
          const cls = classMap.get(a.classId);
          return {
            id: a.id,
            classId: a.classId,
            name: `${cls?.name || "Class"} — ${a.subjectName || a.subject || "Subject"}`,
          };
        });

        const combined = [...assignmentOptions];
        legacyOptions.forEach(lo => { if (!combined.some(c => c.classId === lo.classId)) combined.push(lo); });

        setClasses(combined);
        if (combined.length > 0 && !selectedClassId) setSelectedClassId(combined[0].id);
        if (combined.length === 0) setLoading(false);
      });
    };    init().catch(e => console.error("[ConceptMastery] init failed", e));
    return () => { cancelled = true; unsub?.(); };
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // ── 2. Live Sync Engine ───────────────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !selectedClassId) return;
    setLoading(true);

    const selAssignment = classes.find(c => c.id === selectedClassId);
    const targetClassId = selAssignment?.classId || selectedClassId;

    if (!teacherData.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));

    let gbCols: any[] = [];
    let classTests: any[] = [];
    let roster: any[] = [];
    let s1: any[] = [];
    let s2: any[] = [];
    let s3: any[] = [];
    let computeTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleCompute = () => {
      if (computeTimer) clearTimeout(computeTimer);
      computeTimer = setTimeout(runCompute, 30);
    };

    const runCompute = () => {
      const potentialTopicsSet = new Set<string>();
      classTests.forEach(t => { if (t.topics && Array.isArray(t.topics)) t.topics.forEach((c: string) => potentialTopicsSet.add(c.toUpperCase())); });
      gbCols.forEach(col => { if (col.name) potentialTopicsSet.add(col.name.toUpperCase()); });
      const potentialTopics = Array.from(potentialTopicsSet).sort();

      const activeConceptsMap = new Map<string, boolean>();
      const builtMatrix = roster.map((s: any) => {
        const sEmail = s.email?.toLowerCase();
        const sId = s.realId;
        const filterByStudent = (arr: any[]) => arr.filter(item =>
          (sId && (item.studentId === sId || item.id?.includes(sId))) ||
          (sEmail && item.studentEmail?.toLowerCase() === sEmail)
        );

        const sSum = filterByStudent(s1);
        const sFor = filterByStudent(s2);
        const sRes = filterByStudent(s3);

        const conceptScores = potentialTopics.map(concept => {
          const rSum = sSum.filter(sc => classTests.find(t => t.id === sc.testId)?.topics?.some((t: any) => t.trim().toUpperCase() === concept));
          const rFor = sFor.filter(sc => sc.columnName?.trim().toUpperCase() === concept || sc.columnId === gbCols.find(c => c.name?.trim().toUpperCase() === concept)?.id);
          const rRes = sRes.filter(sc => sc.testName?.trim().toUpperCase() === concept || sc.assignmentTitle?.trim().toUpperCase() === concept || sc.title?.trim().toUpperCase() === concept);

          const combined = [...rSum, ...rFor, ...rRes];
          if (combined.length === 0) return 0;
          activeConceptsMap.set(concept, true);

          let total = 0, count = 0;
          combined.forEach(sc => {
            let rawPct: number;
            if (sc.percentage != null) rawPct = sc.percentage;
            else if (sc.mark != null && sc.maxMarks) rawPct = sc.mark / sc.maxMarks * 100;
            else if (sc.score != null && sc.maxScore) rawPct = sc.score / sc.maxScore * 100;
            else if (sc.score != null) rawPct = sc.score;
            else rawPct = 0;
            const pct = Number(rawPct);
            if (pct >= 0) { total += pct; count++; }
          });
          return count > 0 ? Math.round(total / count) : 0;
        });
        return { ...s, rawConcepts: conceptScores };
      });

      const filteredHeaders = potentialTopics.filter(h => activeConceptsMap.has(h));
      setDynamicHeaders(filteredHeaders);

      const final = builtMatrix.map(s => ({
        ...s,
        concepts: potentialTopics
          .map((h, i) => ({ h, v: s.rawConcepts[i] }))
          .filter(it => activeConceptsMap.has(it.h))
          .map(it => it.v),
      })).sort((a, b) => a.name.localeCompare(b.name));

      const avgs = filteredHeaders.map((_, idx) => {
        let sum = 0, count = 0;
        final.forEach(st => { if (st.concepts[idx] > 0) { sum += st.concepts[idx]; count++; } });
        return count > 0 ? Math.round(sum / count) : 0;
      });

      setClassAverages(avgs);
      setMasteryData(final);
      setLoading(false);
    };

    const unsub1 = onSnapshot(
      query(collection(db, "gradebook_columns"), ...SC, where("classId", "==", targetClassId)),
      (snap) => { gbCols = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)); scheduleCompute(); }
    );
    const unsub2 = onSnapshot(
      query(collection(db, "tests_registry"), ...SC, where("classId", "==", targetClassId)),
      (snap) => { classTests = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)); scheduleCompute(); }
    );
    const unsub3 = onSnapshot(
      query(collection(db, "enrollments"), ...SC, where("classId", "==", targetClassId)),
      (snap) => {
        roster = snap.docs.map((d, idx) => {
          const e = d.data();
          return {
            id: d.id,
            realId: e.studentId,
            email: e.studentEmail,
            name: e.studentName,
            rollNo: e.rollNo || "",
            initials: e.studentName?.substring(0, 2).toUpperCase() || "SC",
            color: avatarColors[idx % avatarColors.length],
          };
        });
        scheduleCompute();
      }
    );
    const unsub4 = onSnapshot(
      query(collection(db, "test_scores"), ...SC, where("classId", "==", targetClassId)),
      (snap) => { s1 = snap.docs.map(d => d.data()); scheduleCompute(); }
    );
    const unsub5 = onSnapshot(
      query(collection(db, "gradebook_scores"), ...SC, where("classId", "==", targetClassId)),
      (snap) => { s2 = snap.docs.map(d => d.data()); scheduleCompute(); }
    );
    const unsub6 = onSnapshot(
      query(collection(db, "results"), ...SC, where("classId", "==", targetClassId)),
      (snap) => { s3 = snap.docs.map(d => d.data()); scheduleCompute(); }
    );

    return () => {
      if (computeTimer) clearTimeout(computeTimer);
      unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6();
    };
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId, selectedClassId, classes]);

  // ── Export ────────────────────────────────────────────────────────────────
  // Defuse CSV injection: if a cell starts with `=`, `+`, `-`, `@`, or a
  // control character, Excel/Sheets will interpret it as a formula. Prefix
  // with a single quote so it's treated as plain text.
  const csvEscape = (value: unknown): string => {
    const raw = String(value ?? "");
    const needsQuote = /[",\n\r]/.test(raw);
    const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return needsQuote ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };

  const exportCSV = () => {
    try {
      const rows = [["Student", ...dynamicHeaders].map(csvEscape).join(",")];
      masteryData.forEach(s => rows.push(
        [csvEscape(s.name), ...s.concepts.map((c: number) => c > 0 ? `${c}%` : "")].join(",")
      ));
      rows.push(["Class Avg", ...classAverages.map(a => a > 0 ? `${a}%` : "")].join(","));
      const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "concept_mastery.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error("[ConceptMastery] CSV export failed", e);
    }
  };

  // ── Computed ──────────────────────────────────────────────────────────────
  const filtered = masteryData.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()));
  const selectedClass = classes.find(c => c.id === selectedClassId);

  const classMasteryPct = (() => {
    const nonZero = classAverages.filter(a => a > 0);
    if (nonZero.length === 0) return null;
    return Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length);
  })();

  const circumference = 2 * Math.PI * 28; // ≈ 175.9
  const ringColor = classMasteryPct === null ? T.s2
    : classMasteryPct >= 80 ? T.green2
    : classMasteryPct >= 50 ? T.amber
    : T.red;
  const dashOffset = classMasteryPct === null
    ? circumference
    : circumference * (1 - classMasteryPct / 100);

  const masteredConceptCount  = classAverages.filter(a => a >= 80).length;
  const developingConceptCount = classAverages.filter(a => a >= 50 && a < 80).length;

  const allMasteries = filtered.map(s => getStudentMastery(s)).filter(v => v !== null) as number[];
  const classAvgMastery = allMasteries.length > 0
    ? Math.round(allMasteries.reduce((a, b) => a + b, 0) / allMasteries.length)
    : null;

  const ringDesc = classMasteryPct === null
    ? `No concepts assessed yet for ${selectedClass?.name || "this class"}.`
    : classMasteryPct >= 80 ? "Class is performing excellently across all concepts."
    : classMasteryPct >= 50 ? "Class needs more practice on some topics."
    : "Class has significant gaps in concept mastery.";

  const heroStatus = classMasteryPct === null
    ? 'Not assessed'
    : `${classMasteryPct}% avg`;

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selectedStudent) {
    return (
      <ConceptMasteryDetail
        student={selectedStudent}
        concepts={dynamicHeaders}
        scores={selectedStudent.concepts}
        className={selectedClass?.name || ""}
        onBack={() => setSelectedStudent(null)}
      />
    );
  }

  // ── Main view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'inherit', minHeight: '100vh' }} className="text-left pb-24">

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <div
        className="md:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px] pb-7"
        style={{
          background: '#EEF4FF',
          minHeight: '100vh',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <style>{`
          .cm-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
          @media (hover:hover) {
            .cm-card3d:hover { transform: translateY(-4px) rotateX(4deg) rotateY(-3deg) scale(1.012); box-shadow: 0 1px 2px rgba(9,87,247,.08), 0 24px 44px rgba(9,87,247,.18), 0 8px 16px rgba(9,87,247,.1); }
          }
          .cm-card3d:active { transform: translateY(-1px) scale(.985); box-shadow: 0 1px 2px rgba(9,87,247,.1), 0 6px 16px rgba(9,87,247,.14); }
          .cm-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
          .cm-press:active { transform: scale(.94); }
          @keyframes cmFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes cmPulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
          .cm-enter > * { animation: cmFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
          .cm-enter > *:nth-child(1) { animation-delay: .04s; }
          .cm-enter > *:nth-child(2) { animation-delay: .10s; }
          .cm-enter > *:nth-child(3) { animation-delay: .16s; }
          .cm-enter > *:nth-child(4) { animation-delay: .22s; }
          .cm-enter > *:nth-child(5) { animation-delay: .28s; }
          .cm-enter > *:nth-child(6) { animation-delay: .34s; }
          .cm-enter > *:nth-child(7) { animation-delay: .40s; }
          .cm-enter > *:nth-child(8) { animation-delay: .46s; }
          .cm-pulse-dot { animation: cmPulse 2s ease-in-out infinite; }
          .cm-unit-fill { transition: width 1s cubic-bezier(.2,.9,.3,1); }
          .cm-search-enter { animation: cmFadeUp .3s cubic-bezier(.34,1.56,.64,1) both; }
        `}</style>

        <div className="cm-enter" style={{ display: 'flex', flexDirection: 'column' }}>

          {/* Page Header */}
          <div style={{ padding: '8px 2px 14px' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 5, height: 5, borderRadius: 2, background: '#0957F7', display: 'inline-block' }} />
              Teacher Dashboard · Mastery
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#001040', letterSpacing: '-1.1px', lineHeight: 1.05, margin: 0 }}>Concept Mastery</h1>
            <div style={{ fontSize: 12, color: '#5070B0', fontWeight: 500, marginTop: 6, letterSpacing: '-0.15px' }}>
              Track student understanding across assessed concepts.
            </div>
          </div>

          {/* Class picker + Search */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <div className="cm-card3d" style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: '#fff', borderRadius: 13,
                boxShadow: '0 0.5px 1px rgba(9,87,247,.04), 0 2px 8px rgba(9,87,247,.06)',
                cursor: 'pointer', minWidth: 0,
              }}>
                <div style={{ width: 30, height: 30, borderRadius: 10, background: '#7B3FF4', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 8, fontWeight: 800, color: '#5070B0', letterSpacing: '1.2px', textTransform: 'uppercase', lineHeight: 1 }}>Viewing</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedClass ? selectedClass.name : (classes.length === 0 ? 'No classes' : 'Select class')}
                  </div>
                </div>
                <div style={{ color: '#99AACC', fontSize: 20, fontWeight: 400, lineHeight: 1, marginTop: -3, flexShrink: 0 }}>›</div>
              </div>
              <select
                value={selectedClassId}
                onChange={e => setSelectedClassId(e.target.value)}
                aria-label="Select class"
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  opacity: 0, cursor: 'pointer', border: 'none', background: 'transparent',
                  appearance: 'none', WebkitAppearance: 'none',
                }}
              >
                {classes.length === 0 && <option value="">No classes</option>}
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowSearch(v => !v)}
              aria-label="Toggle search"
              aria-pressed={showSearch}
              className="cm-press"
              style={{
                width: 42, height: 42, borderRadius: 12,
                background: showSearch ? '#0957F7' : '#fff',
                color: showSearch ? '#fff' : '#0957F7',
                border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, cursor: 'pointer',
                boxShadow: '0 0.5px 1px rgba(9,87,247,.04), 0 2px 8px rgba(9,87,247,.06)',
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>
              </svg>
            </button>
            <button
              type="button"
              onClick={exportCSV}
              disabled={masteryData.length === 0}
              aria-label="Export CSV"
              className="cm-press"
              style={{
                width: 42, height: 42, borderRadius: 12,
                background: '#fff', color: '#0957F7',
                border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, cursor: masteryData.length === 0 ? 'not-allowed' : 'pointer',
                opacity: masteryData.length === 0 ? 0.45 : 1,
                boxShadow: '0 0.5px 1px rgba(9,87,247,.04), 0 2px 8px rgba(9,87,247,.06)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
          </div>

          {/* Search input — toggled */}
          {showSearch && (
            <div className="cm-search-enter" style={{ position: 'relative', marginBottom: 12 }}>
              <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#5070B0' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search student..."
                autoFocus
                style={{
                  width: '100%', padding: '10px 12px 10px 32px', borderRadius: 12,
                  border: 'none', background: '#fff',
                  fontSize: 13, color: '#001040', fontFamily: 'inherit', outline: 'none',
                  boxShadow: '0 0.5px 1px rgba(9,87,247,.04), 0 2px 8px rgba(9,87,247,.06)',
                }}
              />
            </div>
          )}

          {/* HERO — Class Mastery */}
          <div
            className="cm-card3d"
            style={{
              background: 'linear-gradient(135deg, #000820 0%, #001466 32%, #0033CC 68%, #0957F7 100%)',
              borderRadius: 26, padding: 22, marginBottom: 14,
              position: 'relative', overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(0,8,60,.15), 0 12px 32px rgba(0,8,60,.28)',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', zIndex: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                <div style={{ width: 42, height: 42, borderRadius: 13, background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '0.5px solid rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11H3v8h6v-8zM15 3h-6v16h6V3zM21 13h-6v6h6v-6z"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.72)', letterSpacing: '1.8px', textTransform: 'uppercase' }}>Class Mastery</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2, fontWeight: 500, letterSpacing: '-0.1px' }}>
                    {dynamicHeaders.length > 0 ? `${dynamicHeaders.length} ${dynamicHeaders.length === 1 ? 'concept' : 'concepts'} · ${selectedClass?.name || ''}` : 'Not yet assessed'}
                  </div>
                </div>
                {(() => {
                  const label = classMasteryPct === null ? 'N/A' : classMasteryPct >= 80 ? 'Mastered' : classMasteryPct >= 50 ? 'Developing' : 'Weak';
                  const color = classMasteryPct === null ? '#99AACC' : classMasteryPct >= 80 ? '#6FFFAA' : classMasteryPct >= 50 ? '#FFD060' : '#FF9AA9';
                  return (
                    <div style={{ marginLeft: 'auto', background: `${color}33`, border: `0.5px solid ${color}88`, color, padding: '5px 12px', borderRadius: 100, fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.3px' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
                      {label}
                    </div>
                  );
                })()}
              </div>
              <div style={{ fontSize: 56, fontWeight: 800, color: '#fff', letterSpacing: '-2.6px', lineHeight: 1, marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 2 }}>
                {classMasteryPct === null ? '—' : classMasteryPct}
                <span style={{ fontSize: 28, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '-0.8px' }}>%</span>
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.72)', marginBottom: 20, fontWeight: 500, letterSpacing: '-0.15px' }}>
                {(() => {
                  if (classMasteryPct === null) return 'No assessments yet — add scores to see mastery.';
                  const weakCount = filtered.filter(s => { const m = getStudentMastery(s); return m !== null && m < 50; }).length;
                  const masterCount = filtered.filter(s => { const m = getStudentMastery(s); return m !== null && m >= 80; }).length;
                  if (weakCount > 0 && masterCount > 0) return <><b style={{ color: '#fff', fontWeight: 700 }}>Mixed performance</b> — {weakCount} at risk, {masterCount} mastering unit.</>;
                  if (weakCount > 0) return <><b style={{ color: '#fff', fontWeight: 700 }}>Needs attention</b> — {weakCount} student{weakCount === 1 ? '' : 's'} at risk.</>;
                  if (masterCount === filtered.length && filtered.length > 0) return <><b style={{ color: '#fff', fontWeight: 700 }}>Excellent</b> — entire class mastering concepts.</>;
                  return <><b style={{ color: '#fff', fontWeight: 700 }}>On track</b> — class is progressing well.</>;
                })()}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { c: '#00FF88', l: 'Mastered 80+' },
                  { c: '#FFAA00', l: 'Developing 50–79' },
                  { c: '#FF3355', l: 'Weak <50' },
                  { c: 'rgba(255,255,255,.4)', l: 'Not Assessed', glow: false },
                ].map(item => (
                  <div key={item.l} style={{
                    background: 'rgba(255,255,255,.12)',
                    backdropFilter: 'blur(12px)',
                    padding: '5px 10px', borderRadius: 100,
                    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.85)',
                    letterSpacing: '-0.1px', display: 'flex', alignItems: 'center', gap: 5,
                    border: '0.5px solid rgba(255,255,255,.15)',
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.c, boxShadow: item.glow === false ? 'none' : `0 0 6px ${item.c}` }} />
                    {item.l}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section head */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#001040', letterSpacing: '-0.35px' }}>Students</span>
              <span style={{ fontSize: 11, color: '#5070B0', fontWeight: 600, letterSpacing: '-0.1px' }}>
                {filtered.length} assessed · {dynamicHeaders.length} {dynamicHeaders.length === 1 ? 'concept' : 'concepts'}
              </span>
            </div>
          </div>

          {/* Student cards / loading / empty */}
          {loading ? (
            <div className="cm-card3d" style={{ background: '#fff', borderRadius: 20, padding: '40px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, boxShadow: '0 0.5px 1px rgba(9,87,247,.04), 0 4px 14px rgba(9,87,247,.08)' }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#5070B0' }} />
              <span style={{ fontSize: 12, color: '#5070B0' }}>Loading concept data…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="cm-card3d" style={{ background: '#fff', borderRadius: 20, padding: '40px 14px', textAlign: 'center', color: '#5070B0', fontSize: 12, boxShadow: '0 0.5px 1px rgba(9,87,247,.04), 0 4px 14px rgba(9,87,247,.08)' }}>
              {masteryData.length === 0 ? 'No students enrolled yet.' : 'No students match your search.'}
            </div>
          ) : filtered.map(s => {
            const masteryPct = getStudentMastery(s);
            const bandCls = masteryPct === null ? 'developing' : masteryPct >= 80 ? 'mastered' : masteryPct >= 50 ? 'developing' : 'weak';
            const bandColor = bandCls === 'mastered' ? '#00C853' : bandCls === 'developing' ? '#FF8800' : '#FF3355';
            const bandLabel = masteryPct === null ? 'N/A' : masteryPct >= 80 ? 'Mastered' : masteryPct >= 50 ? 'Developing' : 'Weak';
            const avatarColor = mobAvatarColor(s.name || '');
            const assessedCount = s.concepts.filter((c: number) => c > 0).length;

            return (
              <div
                key={s.id}
                onClick={() => setSelectedStudent(s)}
                className="cm-card3d"
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedStudent(s); } }}
                style={{
                  background: '#fff', borderRadius: 20, padding: 16, marginBottom: 10,
                  position: 'relative', overflow: 'hidden', cursor: 'pointer',
                  boxShadow: '0 0.5px 1px rgba(9,87,247,.04), 0 4px 14px rgba(9,87,247,.08)',
                }}
              >
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: bandColor }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 13, background: avatarColor, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 800, letterSpacing: '0.3px', flexShrink: 0,
                  }}>{getInitials(s.name || '')}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#001040', letterSpacing: '-0.35px', lineHeight: 1.2 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: '#5070B0', marginTop: 3, fontWeight: 500, letterSpacing: '-0.1px', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>{selectedClass?.name || ''}</span>
                      <span style={{ color: '#99AACC' }}>·</span>
                      <span>{assessedCount} {assessedCount === 1 ? 'concept' : 'concepts'} assessed</span>
                    </div>
                  </div>
                  <div style={{
                    padding: '4px 10px', borderRadius: 100,
                    background: `${bandColor}1F`, color: bandColor,
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.3px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    <span className={bandCls !== 'mastered' && masteryPct !== null ? 'cm-pulse-dot' : ''} style={{ width: 5, height: 5, borderRadius: '50%', background: bandColor }} />
                    {bandLabel}
                  </div>
                </div>

                {dynamicHeaders.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#99AACC', textAlign: 'center', padding: '8px 0', fontWeight: 600 }}>
                    No concepts tracked yet.
                  </div>
                ) : dynamicHeaders.map((h, i) => {
                  const pct = s.concepts[i] || 0;
                  const cls = pct >= 80 ? 'good' : pct >= 50 ? 'warn' : pct > 0 ? 'bad' : 'na';
                  const color = cls === 'good' ? '#00C853' : cls === 'warn' ? '#FF8800' : cls === 'bad' ? '#FF3355' : '#99AACC';
                  const gradient = cls === 'good' ? 'linear-gradient(90deg, #00E866, #00C853)' : cls === 'warn' ? 'linear-gradient(90deg, #FFAA00, #FF8800)' : cls === 'bad' ? 'linear-gradient(90deg, #FF5577, #FF3355)' : '#EAF0FB';
                  return (
                    <div key={h} style={{
                      background: '#F4F7FE', borderRadius: 14, padding: 12,
                      display: 'flex', alignItems: 'center', gap: 12,
                      marginBottom: i < dynamicHeaders.length - 1 ? 8 : 0,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#002080', letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{h}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color, letterSpacing: '-0.4px', lineHeight: 1, flexShrink: 0 }}>
                            {pct > 0 ? `${pct}%` : '—'}
                          </div>
                        </div>
                        <div style={{ height: 6, background: '#EAF0FB', borderRadius: 100, overflow: 'hidden' }}>
                          <div className="cm-unit-fill" style={{ height: '100%', borderRadius: 100, background: gradient, width: `${Math.max(0, Math.min(100, pct))}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Class Average card */}
          {!loading && filtered.length > 0 && dynamicHeaders.length > 0 && (
            <div
              className="cm-card3d"
              style={{
                background: '#fff', borderRadius: 20, padding: 16,
                border: '0.5px solid rgba(9,87,247,.12)',
                boxShadow: '0 0.5px 1px rgba(9,87,247,.04), 0 4px 14px rgba(9,87,247,.08)',
                marginBottom: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 13, background: '#0957F7', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px' }}>Class Average</div>
                  <div style={{ fontSize: 11, color: '#5070B0', fontWeight: 600, marginTop: 2, letterSpacing: '-0.1px' }}>
                    {dynamicHeaders.length} {dynamicHeaders.length === 1 ? 'concept' : 'concepts'} · {filtered.length} students
                  </div>
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, color: classMasteryPct === null ? '#99AACC' : classMasteryPct >= 80 ? '#00C853' : classMasteryPct >= 50 ? '#FF8800' : '#FF3355', letterSpacing: '-0.9px', lineHeight: 1 }}>
                  {classMasteryPct === null ? '—' : `${classMasteryPct}%`}
                </div>
              </div>
              {dynamicHeaders.map((h, i) => {
                const avg = classAverages[i] || 0;
                const cls = avg >= 80 ? 'good' : avg >= 50 ? 'warn' : avg > 0 ? 'bad' : 'na';
                const color = cls === 'good' ? '#00C853' : cls === 'warn' ? '#FF8800' : cls === 'bad' ? '#FF3355' : '#99AACC';
                const gradient = cls === 'good' ? 'linear-gradient(90deg, #00E866, #00C853)' : cls === 'warn' ? 'linear-gradient(90deg, #FFAA00, #FF8800)' : cls === 'bad' ? 'linear-gradient(90deg, #FF5577, #FF3355)' : '#EAF0FB';
                return (
                  <div key={h} style={{
                    background: cls === 'warn' ? 'rgba(255,170,0,.06)' : '#F4F7FE', borderRadius: 14, padding: 12,
                    display: 'flex', alignItems: 'center', gap: 12,
                    marginBottom: i < dynamicHeaders.length - 1 ? 8 : 0,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#002080', letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{h} overall</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: '-0.3px', flexShrink: 0 }}>{avg > 0 ? `${avg}%` : '—'}</div>
                      </div>
                      <div style={{ height: 6, background: '#EAF0FB', borderRadius: 100, overflow: 'hidden' }}>
                        <div className="cm-unit-fill" style={{ height: '100%', borderRadius: 100, background: gradient, width: `${Math.max(0, Math.min(100, avg))}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Weak Concepts Callout */}
          {!loading && dynamicHeaders.length > 0 && (() => {
            const weak = dynamicHeaders
              .map((h, i) => ({ name: h, avg: classAverages[i] || 0 }))
              .filter(c => c.avg > 0 && c.avg < 75)
              .sort((a, b) => a.avg - b.avg);
            if (weak.length === 0) return null;
            return (
              <div
                className="cm-card3d"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,51,85,.08) 0%, rgba(255,51,85,.04) 100%)',
                  border: '0.5px solid rgba(255,51,85,.25)',
                  borderRadius: 20, padding: 16, position: 'relative', overflow: 'hidden', marginBottom: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 12, background: '#FF3355', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 2px rgba(255,51,85,.25), 0 4px 10px rgba(255,51,85,.3)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2L2 21h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px' }}>Weak Concepts</div>
                    <div style={{ fontSize: 11, color: '#FF3355', fontWeight: 700, marginTop: 2, letterSpacing: '-0.1px' }}>
                      {weak.length} {weak.length === 1 ? 'area' : 'areas'} requiring attention
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {weak.slice(0, 5).map(c => (
                    <div
                      key={c.name}
                      className="cm-press"
                      onClick={() => setSearch(c.name)}
                      role="button"
                      tabIndex={0}
                      style={{
                        background: '#fff', color: '#FF3355',
                        padding: '7px 12px', borderRadius: 100,
                        fontSize: 11, fontWeight: 800, letterSpacing: '-0.1px',
                        display: 'flex', alignItems: 'center', gap: 5,
                        border: '0.5px solid rgba(255,51,85,.2)',
                        boxShadow: '0 1px 2px rgba(255,51,85,.06)',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ background: 'rgba(255,51,85,.12)', color: '#FF3355', padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 900 }}>{c.name}</span>
                      <span>Class Avg</span>
                      <span style={{ color: '#FF3355', fontWeight: 900 }}>{c.avg}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* AI Intelligence */}
          {!loading && dynamicHeaders.length > 0 && filtered.length > 0 && (() => {
            const masteredStu = filtered.filter(s => { const m = getStudentMastery(s); return m !== null && m >= 80; });
            const weakStu = filtered.filter(s => { const m = getStudentMastery(s); return m !== null && m < 50; });
            return (
              <div
                className="cm-card3d"
                style={{
                  background: 'linear-gradient(140deg, #000820 0%, #001888 28%, #0033CC 64%, #0957F7 100%)',
                  borderRadius: 24, padding: 20,
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 1px 2px rgba(0,8,60,.18), 0 12px 32px rgba(0,8,60,.3)',
                }}
              >
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)', pointerEvents: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12, position: 'relative', zIndex: 2 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 13, background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '0.5px solid rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFDD55', fontSize: 19 }}>⚡</div>
                  <div style={{ fontSize: 10, fontWeight: 900, color: 'rgba(255,255,255,.95)', letterSpacing: '1.8px', textTransform: 'uppercase' }}>AI Mastery Intelligence</div>
                  <div style={{ marginLeft: 'auto', background: 'rgba(123,63,244,.3)', border: '0.5px solid rgba(155,95,255,.5)', color: '#DCC8FF', padding: '4px 10px', borderRadius: 100, fontSize: 9, fontWeight: 800, letterSpacing: '0.5px' }}>Insight</div>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,.85)', letterSpacing: '-0.15px', marginBottom: 14, position: 'relative', zIndex: 2 }}>
                  {masteredStu.length > 0 && weakStu.length > 0 ? (
                    <>
                      <strong style={{ color: '#fff', fontWeight: 700 }}>{masteredStu[0].name}</strong> is mastering concepts at <strong style={{ color: '#fff', fontWeight: 700 }}>{getStudentMastery(masteredStu[0])}%</strong> while <strong style={{ color: '#fff', fontWeight: 700 }}>{weakStu[0].name}</strong> is weak at <strong style={{ color: '#fff', fontWeight: 700 }}>{getStudentMastery(weakStu[0])}%</strong>. Large spread suggests pairing them for peer learning — or running a targeted remediation session.
                    </>
                  ) : weakStu.length > 0 ? (
                    <><strong style={{ color: '#fff', fontWeight: 700 }}>{weakStu.length}</strong> student{weakStu.length === 1 ? '' : 's'} at risk across tracked concepts. Schedule a <strong style={{ color: '#fff', fontWeight: 700 }}>remediation session</strong> before the next assessment.</>
                  ) : (
                    <>Class is <strong style={{ color: '#fff', fontWeight: 700 }}>on track</strong> across tracked concepts. Consider enrichment or advanced practice to keep momentum.</>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', background: 'rgba(255,255,255,.1)', borderRadius: 12, padding: 1, gap: 1, overflow: 'hidden', position: 'relative', zIndex: 2 }}>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '11px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#6FFFAA', letterSpacing: '-0.4px' }}>{masteredStu.length}</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>Mastered</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '11px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#FFD060', letterSpacing: '-0.4px' }}>{classMasteryPct === null ? '—' : `${classMasteryPct}%`}</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>Class Avg</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '11px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#FF9AA9', letterSpacing: '-0.4px' }}>{weakStu.length}</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>Weak</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Empty state — no concepts */}
          {!loading && dynamicHeaders.length === 0 && (
            <div className="cm-card3d" style={{
              background: '#fff',
              borderRadius: 20, padding: '20px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
              boxShadow: '0 0.5px 1px rgba(9,87,247,.04), 0 4px 14px rgba(9,87,247,.08)',
              border: '0.5px solid rgba(9,87,247,.1)',
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(9,87,247,.1)', color: '#0957F7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px' }}>No concepts tracked yet</div>
                <div style={{ fontSize: 11, color: '#5070B0', marginTop: 2, lineHeight: 1.4, fontWeight: 500 }}>
                  Add concept scores from the Tests &amp; Exams section to see mastery data here.
                </div>
              </div>
            </div>
          )}

        </div>
      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
      <div className="hidden md:block">

        {/* Header */}
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-slate-900 leading-tight tracking-tight">Concept Mastery</h1>
            <p className="text-sm text-slate-500 mt-1">Track student understanding across assessed concepts.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className="h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 outline-none cursor-pointer"
            >
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="6" cy="6" r="4"/><line x1="9" y1="9" x2="12.5" y2="12.5"/>
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search student..."
                className="w-56 h-10 pl-9 pr-3 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <button type="button"
              onClick={exportCSV}
              disabled={masteryData.length === 0}
              className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Export
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-5 mb-4 px-1">
          {[
            { dot: T.green2, lbl: 'Mastered (80%+)' },
            { dot: T.amber,  lbl: 'Developing (50–79%)' },
            { dot: T.red,    lbl: 'Weak (<50%)' },
            { dot: T.ink2,   lbl: 'Not Assessed' },
          ].map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ background: l.dot }} />
              <span className="text-xs font-medium text-slate-600">{l.lbl}</span>
            </div>
          ))}
        </div>

        {/* Concept table */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
          ) : dynamicHeaders.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-semibold text-slate-700">No concepts tracked yet</p>
              <p className="text-xs text-slate-500 mt-1">Add concept scores from the Tests &amp; Exams section to see mastery data here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide sticky left-0 bg-slate-50">Student</th>
                    {dynamicHeaders.map(h => (
                      <th key={h} className="text-center px-3 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={dynamicHeaders.length + 1} className="py-10 text-center text-sm text-slate-400">No students match your search.</td>
                    </tr>
                  ) : (
                    filtered.map(stu => {
                      const av = avStyle(stu.name || "");
                      return (
                        <tr key={stu.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedStudent(stu)}>
                          <td className="px-5 py-3 sticky left-0 bg-white whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: av.color, color: '#fff' }}>
                                {getInitials(stu.name || "")}
                              </div>
                              <span className="text-sm font-semibold text-slate-900">{stu.name || "—"}</span>
                            </div>
                          </td>
                          {stu.concepts.map((pct: number, i: number) => {
                            const status = getMasteryStatus(pct || null);
                            return (
                              <td key={i} className="px-3 py-3 text-center text-sm font-semibold" style={{ color: status.color }}>
                                {pct > 0 ? `${pct}%` : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                  {filtered.length > 0 && (
                    <tr className="bg-slate-50 font-semibold">
                      <td className="px-5 py-3 text-sm text-slate-900 sticky left-0 bg-slate-50">Class Avg</td>
                      {classAverages.map((avg, i) => {
                        const status = getMasteryStatus(avg);
                        return (
                          <td key={i} className="px-3 py-3 text-center text-sm" style={{ color: status.color }}>
                            {avg > 0 ? `${avg}%` : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Weak concepts card */}
        {classAverages.length > 0 && (
          <div className="mt-5 bg-rose-50 border border-rose-200 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Weak Concepts Requiring Attention</h3>
            <div className="flex flex-wrap gap-2">
              {dynamicHeaders
                .map((h, i) => ({ name: h, avg: classAverages[i] }))
                .filter(c => c.avg > 0 && c.avg < 75)
                .sort((a, b) => a.avg - b.avg)
                .slice(0, 5)
                .map(c => (
                  <span key={c.name} className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-xs font-semibold text-rose-700">
                    {c.name} (Class Avg: {c.avg}%)
                  </span>
                ))}
              {dynamicHeaders.map((h, i) => ({ name: h, avg: classAverages[i] })).filter(c => c.avg > 0 && c.avg < 75).length === 0 && (
                <span className="text-xs text-slate-500">All concepts are above 75% — great class!</span>
              )}
            </div>
          </div>
        )}

      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default ConceptMastery;