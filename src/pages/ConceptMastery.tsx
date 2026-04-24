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
const MOB_AV_PALETTE = ['#7B3FF4', '#00C853', '#0055FF', '#FF8800', '#00B8D4', '#C2255C', '#6741D9'];
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

  // Hover handlers — matches Dashboard vibe: clean translate + scale, no rotation
  // (rotateX/Y causes sub-pixel text blur). Same lift/scale as .cmd-card3d.
  const handle3DEnter = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.style.transition = "transform 0.22s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.22s ease";
    el.style.transform = "translate3d(0,-5px,0) scale(1.02)";
  };
  const handle3DMove = (_e: React.MouseEvent<HTMLElement>) => {
    // no-op — no cursor tracking, keeps text crisp
  };
  const handle3DLeave = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.style.transition = "transform 0.28s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.28s ease";
    el.style.transform = "translate3d(0,0,0) scale(1)";
  };

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
          .cm-card3d { transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease; backface-visibility: hidden; -webkit-backface-visibility: hidden; will-change: transform; }
          @media (hover:hover) { .cm-card3d:hover { transform: translate3d(0,-5px,0) scale(1.02); box-shadow: 0 0 0 .5px rgba(0,85,255,.14), 0 8px 24px rgba(0,85,255,.16), 0 20px 46px rgba(0,85,255,.18) !important; } }
          .cm-card3d:active { transform: translate3d(0,-1px,0) scale(.985); box-shadow: 0 0 0 .5px rgba(0,85,255,.12), 0 6px 16px rgba(0,85,255,.14) !important; }
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
              <span style={{ width: 5, height: 5, borderRadius: 2, background: '#0055FF', display: 'inline-block' }} />
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
                boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
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
                background: showSearch ? '#0055FF' : '#fff',
                color: showSearch ? '#fff' : '#0055FF',
                border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, cursor: 'pointer',
                boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
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
                background: '#fff', color: '#0055FF',
                border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, cursor: masteryData.length === 0 ? 'not-allowed' : 'pointer',
                opacity: masteryData.length === 0 ? 0.45 : 1,
                boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
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
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
                }}
              />
            </div>
          )}

          {/* HERO — Class Mastery */}
          <div
            className="cm-card3d"
            style={{
              background: 'linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)',
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
            <div className="cm-card3d" style={{ background: '#fff', borderRadius: 20, padding: '40px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)' }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#5070B0' }} />
              <span style={{ fontSize: 12, color: '#5070B0' }}>Loading concept data…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="cm-card3d" style={{ background: '#fff', borderRadius: 20, padding: '40px 14px', textAlign: 'center', color: '#5070B0', fontSize: 12, boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)' }}>
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
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
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
                boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
                marginBottom: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 13, background: '#0055FF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
                  background: 'linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)',
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
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
              border: '0.5px solid rgba(9,87,247,.1)',
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(9,87,247,.1)', color: '#0055FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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

      {/* ═══════════════════ DESKTOP VIEW — Blue Apple DNA ═══════════════════ */}
      <div
        className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 -mt-4 sm:-mt-6 md:-mt-8 px-8 pt-6 pb-10"
        style={{
          background: '#EEF4FF',
          minHeight: '100vh',
          fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <style>{`
          .cmd-card3d { transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease; backface-visibility: hidden; -webkit-backface-visibility: hidden; will-change: transform; }
          @media (hover:hover) { .cmd-card3d:hover { transform: translate3d(0,-5px,0) scale(1.02); box-shadow: 0 0 0 .5px rgba(0,85,255,.14), 0 8px 24px rgba(0,85,255,.16), 0 20px 46px rgba(0,85,255,.18) !important; } }
          .cmd-tile { transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease; cursor: pointer; backface-visibility: hidden; -webkit-backface-visibility: hidden; will-change: transform; }
          @media (hover:hover) { .cmd-tile:hover { transform: translate3d(0,-5px,0) scale(1.02); box-shadow: 0 0 0 .5px rgba(0,85,255,.14), 0 8px 24px rgba(0,85,255,.16), 0 20px 46px rgba(0,85,255,.18) !important; } }
          .cmd-row { transition: background .2s ease, transform .2s ease; }
          .cmd-row:hover { background: rgba(0,85,255,.05) !important; transform: translateX(3px); }
          .cmd-btn { transition: transform .2s ease, box-shadow .2s ease, background .2s ease; }
          .cmd-btn:hover { transform: translateY(-1px); }
          @keyframes cmdFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
          .cmd-enter > * { animation: cmdFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
          .cmd-enter > *:nth-child(1) { animation-delay: .04s; }
          .cmd-enter > *:nth-child(2) { animation-delay: .10s; }
          .cmd-enter > *:nth-child(3) { animation-delay: .16s; }
          .cmd-enter > *:nth-child(4) { animation-delay: .22s; }
          .cmd-enter > *:nth-child(5) { animation-delay: .28s; }
          .cmd-enter > *:nth-child(6) { animation-delay: .34s; }
          .cmd-pulse-dot { animation: cmdPulse 2s ease-in-out infinite; }
          @keyframes cmdPulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
        `}</style>

        <div className="cmd-enter max-w-[1600px] mx-auto">

          {/* ═══ Page Head ═══ */}
          <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="cmd-pulse-dot" style={{ width: 6, height: 6, borderRadius: 2, background: '#0055FF', display: 'inline-block' }} />
                Teacher Dashboard · Mastery
              </div>
              <h1 style={{ fontSize: 34, fontWeight: 800, color: '#001040', letterSpacing: '-1.2px', lineHeight: 1.05, margin: 0 }}>
                Concept Mastery
              </h1>
              <div style={{ fontSize: 13, color: '#5070B0', fontWeight: 500, marginTop: 6, letterSpacing: '-0.15px' }}>
                Track student understanding across assessed concepts · {selectedClass?.name || 'Select a class'}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Class picker — violet icon chip */}
              <div className="relative cmd-card3d" style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px 8px 10px', background: '#fff', borderRadius: 14,
                boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 16px rgba(0,85,255,.08)',
                border: '0.5px solid rgba(0,85,255,.1)',
                minWidth: 220,
              }}>
                <div style={{ width: 34, height: 34, borderRadius: 11, background: 'linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 10px rgba(123,63,244,.28)' }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#5070B0', letterSpacing: '1.2px', textTransform: 'uppercase', lineHeight: 1 }}>Viewing</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedClass ? selectedClass.name : (classes.length === 0 ? 'No classes' : 'Select class')}
                  </div>
                </div>
                <span style={{ color: '#99AACC', fontSize: 20, fontWeight: 400, lineHeight: 1, marginTop: -3, flexShrink: 0 }}>›</span>
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

              {/* Search */}
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" viewBox="0 0 14 14" fill="none" stroke="#99AACC" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="6" cy="6" r="4"/><line x1="9" y1="9" x2="12.5" y2="12.5"/>
                </svg>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search student..."
                  style={{
                    width: 240, height: 42, paddingLeft: 38, paddingRight: 14,
                    background: '#fff', border: '0.5px solid rgba(0,85,255,.1)',
                    borderRadius: 14, fontSize: 13, fontWeight: 500, color: '#001040',
                    outline: 'none', fontFamily: 'inherit',
                    boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 14px rgba(0,85,255,.07)',
                  }}
                />
              </div>

              {/* Export */}
              <button
                type="button"
                onClick={exportCSV}
                disabled={masteryData.length === 0}
                className="cmd-btn"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  height: 42, padding: '0 18px', borderRadius: 14,
                  background: masteryData.length === 0 ? '#F5F6F9' : 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)',
                  color: masteryData.length === 0 ? '#99AACC' : '#fff',
                  fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                  border: 'none', cursor: masteryData.length === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: masteryData.length === 0 ? 'none' : '0 6px 20px rgba(0,85,255,.35), 0 2px 5px rgba(0,85,255,.2)',
                  fontFamily: 'inherit',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export
              </button>
            </div>
          </div>

          {/* ═══ Bright KPI Row (4 gradient tiles) ═══ */}
          {!loading && dynamicHeaders.length > 0 && (() => {
            const weakConceptCount = classAverages.filter(a => a > 0 && a < 50).length;
            const totalStudents = filtered.length;
            const kpis = [
              {
                label: 'Total Students', value: totalStudents.toString(), sub: `in ${selectedClass?.name || '—'}`,
                grad: 'linear-gradient(135deg,#0055FF 0%,#2277FF 100%)',
                iconStroke: (
                  <>
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </>
                ),
              },
              {
                label: 'Mastered', value: masteredConceptCount.toString(), sub: `${masteredConceptCount} concept${masteredConceptCount!==1?'s':''} ≥ 80%`,
                grad: 'linear-gradient(135deg,#00C853 0%,#33DD77 100%)',
                iconStroke: (
                  <>
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </>
                ),
              },
              {
                label: 'Developing', value: developingConceptCount.toString(), sub: `${developingConceptCount} concept${developingConceptCount!==1?'s':''} 50-79%`,
                grad: 'linear-gradient(135deg,#FFAA00 0%,#FFCC33 100%)',
                iconStroke: (
                  <>
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                  </>
                ),
              },
              {
                label: 'Weak Concepts', value: weakConceptCount.toString(), sub: `${weakConceptCount > 0 ? 'Needs urgent focus' : 'All strong'}`,
                grad: weakConceptCount > 0 ? 'linear-gradient(135deg,#FF3355 0%,#FF6677 100%)' : 'linear-gradient(135deg,#5070B0 0%,#99AACC 100%)',
                iconStroke: (
                  <>
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </>
                ),
              },
            ];
            return (
              <div className="grid grid-cols-4 gap-4 mb-6">
                {kpis.map(k => (
                  <div
                    key={k.label}
                    className="cmd-tile"
                    style={{
                      background: k.grad, borderRadius: 22, padding: '22px 24px', color: '#fff',
                      position: 'relative', overflow: 'hidden',
                      boxShadow: '0 0 0 .5px rgba(255,255,255,.15), 0 14px 38px rgba(0,85,255,.26), 0 4px 12px rgba(0,85,255,.18)',
                    }}
                  >
                    <div style={{ position: 'absolute', top: -30, right: -20, width: 120, height: 120, background: 'radial-gradient(circle, rgba(255,255,255,.22) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, position: 'relative', zIndex: 1 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.22)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                          {k.iconStroke}
                        </svg>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.75)', letterSpacing: '.10em', textTransform: 'uppercase', margin: '0 0 6px 0', position: 'relative', zIndex: 1 }}>{k.label}</div>
                    <div style={{ fontSize: 34, fontWeight: 800, color: '#fff', letterSpacing: '-0.8px', margin: 0, lineHeight: 1.05, position: 'relative', zIndex: 1 }}>{k.value}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.78)', margin: '8px 0 0 0', position: 'relative', zIndex: 1 }}>{k.sub}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ═══ Hero summary row: Class mastery ring + Concept averages bar ═══ */}
          {!loading && dynamicHeaders.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-6">

              {/* Ring card */}
              <div
                className="cmd-card3d"
                style={{
                  background: '#fff', borderRadius: 22, padding: '22px 24px',
                  border: '0.5px solid rgba(0,85,255,.08)',
                  boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 16px rgba(0,85,255,.08), 0 18px 44px rgba(0,85,255,.10)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#99AACC', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 4 }}>Class Mastery</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px' }}>Overall Understanding</div>
                  </div>
                  <div style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(0,85,255,.08)', border: '0.5px solid rgba(0,85,255,.12)', fontSize: 10, fontWeight: 800, color: '#0055FF', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                    {heroStatus}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
                  <div style={{ position: 'relative', width: 120, height: 120, flexShrink: 0 }}>
                    <svg width="120" height="120" viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="36" cy="36" r="28" fill="none" stroke="#EEF4FF" strokeWidth="8" />
                      <circle cx="36" cy="36" r="28" fill="none" stroke={ringColor} strokeWidth="8"
                        strokeDasharray={circumference} strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.2,.9,.3,1)' }} />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#001040', letterSpacing: '-1px', lineHeight: 1 }}>
                        {classMasteryPct === null ? '—' : `${classMasteryPct}%`}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#99AACC', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 4 }}>Avg</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#5070B0', fontWeight: 500, lineHeight: 1.55, marginBottom: 12 }}>
                      {ringDesc}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(0,200,83,.08)', border: '0.5px solid rgba(0,200,83,.18)' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#087F5B', letterSpacing: '.1em', textTransform: 'uppercase' }}>Mastered</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#087F5B', marginTop: 2 }}>{masteredConceptCount}</div>
                      </div>
                      <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,170,0,.10)', border: '0.5px solid rgba(255,170,0,.22)' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#C87014', letterSpacing: '.1em', textTransform: 'uppercase' }}>Developing</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#C87014', marginTop: 2 }}>{developingConceptCount}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Concept averages bar chart */}
              <div
                className="cmd-card3d col-span-2"
                style={{
                  background: '#fff', borderRadius: 22, padding: '22px 24px',
                  border: '0.5px solid rgba(0,85,255,.08)',
                  boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 16px rgba(0,85,255,.08), 0 18px 44px rgba(0,85,255,.10)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#99AACC', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 4 }}>Concept Averages</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px' }}>Class performance per concept</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {dynamicHeaders.map((h, i) => {
                    const avg = classAverages[i] || 0;
                    const status = getMasteryStatus(avg || null);
                    const barGrad = avg >= 80
                      ? 'linear-gradient(90deg,#00C853,#33DD77)'
                      : avg >= 50
                      ? 'linear-gradient(90deg,#FFAA00,#FFCC33)'
                      : avg > 0
                      ? 'linear-gradient(90deg,#FF3355,#FF6677)'
                      : 'linear-gradient(90deg,#99AACC,#B0C0D8)';
                    return (
                      <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 130, minWidth: 130, fontSize: 11, fontWeight: 700, color: '#001040', letterSpacing: '-0.1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h}
                        </div>
                        <div style={{ flex: 1, height: 10, borderRadius: 999, background: '#EEF4FF', overflow: 'hidden' }}>
                          <div
                            className="cm-unit-fill"
                            style={{
                              width: `${Math.max(avg, 0)}%`,
                              height: '100%', borderRadius: 999, background: barGrad,
                              transition: 'width 1s cubic-bezier(.2,.9,.3,1)',
                            }}
                          />
                        </div>
                        <div style={{ width: 60, textAlign: 'right', fontSize: 13, fontWeight: 800, color: status.color }}>
                          {avg > 0 ? `${avg}%` : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══ Legend strip (gradient pills) ═══ */}
          <div className="flex flex-wrap items-center gap-2.5 mb-5">
            {[
              { lbl: 'Mastered (80%+)',    grad: 'linear-gradient(135deg,#00C853 0%,#33DD77 100%)' },
              { lbl: 'Developing (50–79%)', grad: 'linear-gradient(135deg,#FFAA00 0%,#FFCC33 100%)' },
              { lbl: 'Weak (<50%)',        grad: 'linear-gradient(135deg,#FF3355 0%,#FF6677 100%)' },
              { lbl: 'Not Assessed',       grad: 'linear-gradient(135deg,#99AACC 0%,#B0C0D8 100%)' },
            ].map(l => (
              <div
                key={l.lbl}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '6px 12px', borderRadius: 999,
                  background: '#fff', border: '0.5px solid rgba(0,85,255,.1)',
                  boxShadow: '0 1px 2px rgba(0,85,255,.06)',
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: l.grad, boxShadow: '0 2px 5px rgba(0,0,0,.15)' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '0.02em' }}>{l.lbl}</span>
              </div>
            ))}
          </div>

          {/* ═══ Concept Table ═══ */}
          <div
            className="cmd-card3d"
            style={{
              background: '#fff', borderRadius: 22, overflow: 'hidden',
              border: '0.5px solid rgba(0,85,255,.07)',
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
              marginBottom: 24,
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 22px', borderBottom: '0.5px solid rgba(0,85,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(0,85,255,.28)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px' }}>Student Concept Matrix</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#99AACC', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
                    {filtered.length} student{filtered.length!==1?'s':''} · {dynamicHeaders.length} concept{dynamicHeaders.length!==1?'s':''}
                  </div>
                </div>
              </div>
              {search && (
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5070B0', padding: '5px 10px', borderRadius: 8, background: 'rgba(0,85,255,.05)' }}>
                  Filtering: "{search}"
                </div>
              )}
            </div>

            {loading ? (
              <div style={{ padding: '60px 0', display: 'flex', justifyContent: 'center' }}>
                <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#0055FF' }} />
              </div>
            ) : dynamicHeaders.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px' }}>No concepts tracked yet</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#5070B0', marginTop: 6, maxWidth: 420, margin: '6px auto 0' }}>
                  Add concept scores from the Tests &amp; Exams section to see mastery data here.
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                  <thead>
                    <tr style={{ background: 'rgba(0,85,255,.03)' }}>
                      <th style={{
                        textAlign: 'left', padding: '12px 22px', fontSize: 10, fontWeight: 800,
                        color: '#5070B0', letterSpacing: '0.12em', textTransform: 'uppercase',
                        position: 'sticky', left: 0, background: 'rgba(0,85,255,.03)', zIndex: 2,
                        borderBottom: '0.5px solid rgba(0,85,255,.08)',
                      }}>Student</th>
                      {dynamicHeaders.map(h => (
                        <th key={h} style={{
                          textAlign: 'center', padding: '12px 14px', fontSize: 10, fontWeight: 800,
                          color: '#5070B0', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                          borderBottom: '0.5px solid rgba(0,85,255,.08)',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={dynamicHeaders.length + 1} style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#99AACC' }}>
                          No students match your search.
                        </td>
                      </tr>
                    ) : (
                      filtered.map(stu => {
                        const stuName = stu.name || "—";
                        const avatarBg = mobAvatarColor(stuName);
                        return (
                          <tr
                            key={stu.id}
                            className="cmd-row"
                            style={{ cursor: 'pointer', borderBottom: '0.5px solid rgba(0,85,255,.05)' }}
                            onClick={() => setSelectedStudent(stu)}
                          >
                            <td style={{
                              padding: '12px 22px', position: 'sticky', left: 0, background: '#fff',
                              whiteSpace: 'nowrap', zIndex: 1,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{
                                  width: 36, height: 36, borderRadius: '50%',
                                  background: avatarBg, color: '#fff',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 12, fontWeight: 800, flexShrink: 0,
                                  boxShadow: '0 4px 10px rgba(0,85,255,.18)',
                                }}>
                                  {getInitials(stuName)}
                                </div>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px' }}>{stuName}</div>
                                  {(() => {
                                    const m = getStudentMastery(stu);
                                    if (m === null) return <div style={{ fontSize: 10, fontWeight: 600, color: '#99AACC', marginTop: 1 }}>No assessments yet</div>;
                                    const mc = m >= 80 ? '#087F5B' : m >= 50 ? '#C87014' : '#C92A2A';
                                    return <div style={{ fontSize: 10, fontWeight: 700, color: mc, marginTop: 1, letterSpacing: '.04em' }}>{m}% avg mastery</div>;
                                  })()}
                                </div>
                              </div>
                            </td>
                            {stu.concepts.map((pct: number, i: number) => {
                              const hasVal = pct > 0;
                              let bg = 'transparent', color = '#99AACC';
                              if (hasVal) {
                                if (pct >= 80) { bg = 'rgba(0,200,83,.10)'; color = '#087F5B'; }
                                else if (pct >= 50) { bg = 'rgba(255,170,0,.12)'; color = '#C87014'; }
                                else { bg = 'rgba(255,51,85,.10)'; color = '#C92A2A'; }
                              }
                              return (
                                <td key={i} style={{ padding: '10px 14px', textAlign: 'center' }}>
                                  <div style={{
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    minWidth: 44, padding: '6px 10px', borderRadius: 10,
                                    fontSize: 12, fontWeight: 800,
                                    background: bg, color,
                                  }}>
                                    {hasVal ? `${pct}%` : '—'}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                    {filtered.length > 0 && (
                      <tr style={{ background: 'linear-gradient(90deg,rgba(0,85,255,.04) 0%,rgba(0,85,255,.02) 100%)' }}>
                        <td style={{
                          padding: '14px 22px', position: 'sticky', left: 0,
                          background: '#F5F9FF',
                          fontSize: 12, fontWeight: 800, color: '#001040',
                          letterSpacing: '0.08em', textTransform: 'uppercase',
                          borderTop: '0.5px solid rgba(0,85,255,.12)',
                        }}>Class Avg</td>
                        {classAverages.map((avg, i) => {
                          const status = getMasteryStatus(avg || null);
                          return (
                            <td key={i} style={{
                              padding: '14px 14px', textAlign: 'center',
                              fontSize: 13, fontWeight: 800, color: status.color,
                              borderTop: '0.5px solid rgba(0,85,255,.12)',
                            }}>
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

          {/* ═══ Weak Concepts Hero (red gradient card) ═══ */}
          {classAverages.length > 0 && (() => {
            const weakList = dynamicHeaders
              .map((h, i) => ({ name: h, avg: classAverages[i] }))
              .filter(c => c.avg > 0 && c.avg < 75)
              .sort((a, b) => a.avg - b.avg);
            const hasWeak = weakList.length > 0;
            return (
              <div
                onMouseEnter={handle3DEnter}
                onMouseMove={handle3DMove}
                onMouseLeave={handle3DLeave}
                style={{
                  background: hasWeak
                    ? 'linear-gradient(135deg,#FF3355 0%,#FF5577 50%,#FF8800 100%)'
                    : 'linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)',
                  borderRadius: 22, padding: '22px 26px', color: '#fff',
                  position: 'relative', overflow: 'hidden',
                  boxShadow: hasWeak
                    ? '0 14px 40px rgba(255,51,85,.35), 0 0 0 .5px rgba(255,255,255,.12)'
                    : '0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)',
                  marginBottom: 24,
                  transformStyle: 'preserve-3d',
                  willChange: 'transform',
                }}
              >
                <div style={{ position: 'absolute', top: -40, right: -30, width: 200, height: 200, background: 'radial-gradient(circle, rgba(255,255,255,.18) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative', zIndex: 1 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,.18)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      {hasWeak ? (
                        <>
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </>
                      ) : (
                        <>
                          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                          <polyline points="22 4 12 14.01 9 11.01"/>
                        </>
                      )}
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.72)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
                      {hasWeak ? 'Attention Needed' : 'All Clear'}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.6px', marginBottom: 6 }}>
                      {hasWeak ? 'Weak Concepts Requiring Attention' : 'No weak spots — great class!'}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,.82)', marginBottom: 14 }}>
                      {hasWeak
                        ? `${weakList.length} concept${weakList.length!==1?'s':''} below 75% — consider targeted revision or re-teaching.`
                        : `All ${dynamicHeaders.length} concepts are above 75% class average.`}
                    </div>
                    {hasWeak && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {weakList.slice(0, 8).map(c => (
                          <div
                            key={c.name}
                            className="cmd-btn"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 7,
                              padding: '8px 14px', borderRadius: 12,
                              background: 'rgba(255,255,255,.16)', border: '0.5px solid rgba(255,255,255,.26)',
                              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                              fontSize: 11, fontWeight: 700, color: '#fff',
                              cursor: 'default',
                            }}
                          >
                            <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                            <span style={{
                              padding: '2px 8px', borderRadius: 999,
                              background: c.avg < 50 ? 'rgba(255,51,85,.6)' : 'rgba(255,170,0,.7)',
                              fontSize: 10, fontWeight: 800, letterSpacing: '.04em',
                            }}>
                              {c.avg}%
                            </span>
                          </div>
                        ))}
                        {weakList.length > 8 && (
                          <div style={{
                            display: 'inline-flex', alignItems: 'center',
                            padding: '8px 14px', borderRadius: 12,
                            background: 'rgba(255,255,255,.10)', border: '0.5px solid rgba(255,255,255,.18)',
                            fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '.04em',
                          }}>
                            +{weakList.length - 8} more
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ═══ AI Intelligence Card ═══ */}
          {!loading && dynamicHeaders.length > 0 && (() => {
            const weakCnt = classAverages.filter(a => a > 0 && a < 50).length;
            const devCnt = developingConceptCount;
            const masteredCnt = masteredConceptCount;
            const totalCnt = dynamicHeaders.length;
            const studentsAtRisk = filtered.filter(s => {
              const m = getStudentMastery(s);
              return m !== null && m < 50;
            }).length;
            const aiLead = classMasteryPct === null
              ? "No assessments recorded yet — start grading concept scores to see intelligence here."
              : classMasteryPct >= 80
              ? `Class is performing exceptionally at ${classMasteryPct}% average mastery. ${masteredCnt} of ${totalCnt} concepts are mastered.`
              : classMasteryPct >= 50
              ? `Class mastery is developing at ${classMasteryPct}%. ${weakCnt > 0 ? `${weakCnt} weak concept${weakCnt!==1?'s':''} need targeted practice.` : 'Keep reinforcing.'}`
              : `Class has significant gaps at ${classMasteryPct}% average. Prioritise remediation on the weakest concepts immediately.`;
            return (
              <div
                onMouseEnter={handle3DEnter}
                onMouseMove={handle3DMove}
                onMouseLeave={handle3DLeave}
                style={{
                  background: 'linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)',
                  borderRadius: 22, padding: '24px 28px', color: '#fff',
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)',
                  transformStyle: 'preserve-3d',
                  willChange: 'transform',
                }}
              >
                <div style={{ position: 'absolute', bottom: -50, left: -40, width: 280, height: 280, background: 'radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                <div style={{ position: 'absolute', top: -30, right: -20, width: 200, height: 200, background: 'radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative', zIndex: 1, marginBottom: 18 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: 'rgba(255,255,255,.18)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                      AI Teacher Intelligence
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', marginBottom: 6 }}>
                      Concept Mastery Summary
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.82)', lineHeight: 1.55 }}>
                      {aiLead}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, position: 'relative', zIndex: 1 }}>
                  {[
                    { label: 'Class Pulse', value: classMasteryPct === null ? '—' : `${classMasteryPct}%`, sub: classMasteryPct !== null && classMasteryPct >= 70 ? 'Healthy' : classMasteryPct !== null ? 'Needs focus' : 'Awaiting data', valueColor: '#66EE88' },
                    { label: 'Weak Focus', value: weakCnt > 0 ? `${weakCnt} weak` : 'None', sub: weakCnt > 0 ? 'Plan re-teach' : 'All strong', valueColor: weakCnt > 0 ? '#FF99AA' : '#66EE88' },
                    { label: 'At-Risk Students', value: studentsAtRisk.toString(), sub: studentsAtRisk > 0 ? 'Below 50% mastery' : 'All tracking well', valueColor: studentsAtRisk > 0 ? '#FF99AA' : '#C8A4FF' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(255,255,255,.14)' }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.valueColor, letterSpacing: '-0.4px', lineHeight: 1 }}>{s.value}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)', margin: '6px 0 0 0' }}>{s.sub}</div>
                    </div>
                  ))}
                </div>
                {devCnt + masteredCnt + weakCnt > 0 && (
                  <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 1 }}>
                    <div style={{ flex: 1, height: 10, borderRadius: 999, background: 'rgba(255,255,255,.12)', overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${(masteredCnt/totalCnt)*100}%`, background: 'linear-gradient(90deg,#00C853,#33DD77)', transition: 'width 1s cubic-bezier(.2,.9,.3,1)' }}/>
                      <div style={{ width: `${(devCnt/totalCnt)*100}%`, background: 'linear-gradient(90deg,#FFAA00,#FFCC33)', transition: 'width 1s cubic-bezier(.2,.9,.3,1)' }}/>
                      <div style={{ width: `${(weakCnt/totalCnt)*100}%`, background: 'linear-gradient(90deg,#FF3355,#FF6677)', transition: 'width 1s cubic-bezier(.2,.9,.3,1)' }}/>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.7)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {totalCnt} concepts
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default ConceptMastery;