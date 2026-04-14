import { useState, useEffect } from "react";
import ConceptMasteryDetail from "@/components/ConceptMasteryDetail";
import { Loader2 } from "lucide-react";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, getDocs, where } from "firebase/firestore";
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

// ── Tab bar ───────────────────────────────────────────────────────────────────
const TabBar = () => (
  <div style={{
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
    background: T.s0, borderTop: `1px solid ${T.bdr}`,
    padding: '9px 18px 17px', display: 'flex', justifyContent: 'space-between',
  }} className="md:hidden">
    {[
      { label: 'Dashboard', active: false, icon: <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="11" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="11" width="5" height="5" rx="1.2"/><rect x="11" y="11" width="5" height="5" rx="1.2"/></svg> },
      { label: 'Students',  active: false, icon: <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 15V9L9 5l7 4v6"/><rect x="6.5" y="11" width="5" height="4" rx=".5"/></svg> },
      { label: 'Concepts',  active: true,  icon: <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,13 6,8 9,10.5 13,5 16,7"/><circle cx="6" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="5" r="1.5" fill="currentColor" stroke="none"/></svg> },
      { label: 'Profile',   active: false, icon: <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="3"/><path d="M3 17c0 0 1.5-4 6-4s6 4 6 4"/></svg> },
    ].map(tab => (
      <div key={tab.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
        <div style={{ color: tab.active ? T.blue : T.ink2 }}>{tab.icon}</div>
        <span style={{ fontSize: 9, color: tab.active ? T.blue : T.ink2, fontWeight: tab.active ? 500 : 400 }}>{tab.label}</span>
        {tab.active && <div style={{ width: 13, height: 2.5, borderRadius: 2, background: T.blue }} />}
      </div>
    ))}
  </div>
);

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

  // ── 1. Fetch Teacher's Active Assignments ─────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id) return;
    const schoolId = teacherData.schoolId as string | undefined;
    const branchId = teacherData.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
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
    };

    init();
    return () => { cancelled = true; unsub?.(); };
  }, [teacherData?.id]);

  // ── 2. Live Sync Engine ───────────────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !selectedClassId) return;
    setLoading(true);

    const selAssignment = classes.find(c => c.id === selectedClassId);
    const targetClassId = selAssignment?.classId || selectedClassId;

    const schoolId = teacherData.schoolId as string | undefined;
    const branchId = teacherData.branchId as string | undefined;
    const SC: any[] = [];
    if (schoolId) SC.push(where("schoolId", "==", schoolId));
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
      query(collection(db, "gradebook_columns"), where("classId", "==", targetClassId), ...SC),
      (snap) => { gbCols = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)); scheduleCompute(); }
    );
    const unsub2 = onSnapshot(
      query(collection(db, "tests_registry"), where("classId", "==", targetClassId), ...SC),
      (snap) => { classTests = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)); scheduleCompute(); }
    );
    const unsub3 = onSnapshot(
      query(collection(db, "enrollments"), where("classId", "==", targetClassId), ...SC),
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
      query(collection(db, "test_scores"), where("classId", "==", targetClassId), ...SC),
      (snap) => { s1 = snap.docs.map(d => d.data()); scheduleCompute(); }
    );
    const unsub5 = onSnapshot(
      query(collection(db, "gradebook_scores"), where("classId", "==", targetClassId), ...SC),
      (snap) => { s2 = snap.docs.map(d => d.data()); scheduleCompute(); }
    );
    const unsub6 = onSnapshot(
      query(collection(db, "results"), where("classId", "==", targetClassId), ...SC),
      (snap) => { s3 = snap.docs.map(d => d.data()); scheduleCompute(); }
    );

    return () => {
      if (computeTimer) clearTimeout(computeTimer);
      unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6();
    };
  }, [teacherData?.id, selectedClassId, classes]);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [["Student", ...dynamicHeaders].join(",")];
    masteryData.forEach(s => rows.push([`"${s.name}"`, ...s.concepts.map((c: number) => c > 0 ? `${c}%` : "")].join(",")));
    rows.push(["Class Avg", ...classAverages.map(a => a > 0 ? `${a}%` : "")].join(","));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "concept_mastery.csv"; a.click();
    URL.revokeObjectURL(url);
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
    <div style={{ fontFamily: 'inherit', minHeight: '100vh', background: T.s1 }} className="text-left pb-24">

      {/* ── Dark hero ─────────────────────────────────────────────────────── */}
      <div style={{ background: T.ink0 }} className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-6">
        <div style={{ fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5, paddingTop: 16 }}>
          Concept mastery
        </div>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.1, marginBottom: 4 }}>
          Student<br />understanding
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', lineHeight: 1.4 }}>
          Track concept mastery across all assessed topics.
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 14, flexWrap: 'wrap' }}>
          {[
            { ico: <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 8.5c0 0 1.5-2 4-2s4 2 4 2"/><circle cx="5" cy="4" r="2"/></svg>, strong: String(filtered.length), label: ' Students' },
            { ico: <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="8" height="8" rx="1.5"/><line x1="3" y1="5" x2="7" y2="5"/></svg>, strong: String(dynamicHeaders.length), label: ' Concepts' },
            { ico: <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="5" r="4"/><line x1="5" y1="3" x2="5" y2="5.5"/><circle cx="5" cy="7" r=".6" fill="rgba(255,255,255,.4)" stroke="none"/></svg>, label: heroStatus },
          ].map((chip, i) => (
            <div key={i} style={{ padding: '5px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', fontSize: 10, color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {chip.ico}
              {chip.strong && <strong style={{ color: '#fff', fontWeight: 500 }}>{chip.strong}</strong>}
              {chip.label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="pt-4 flex flex-col gap-3">

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, stroke: T.ink2, fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', pointerEvents: 'none' }} viewBox="0 0 14 14">
              <circle cx="6" cy="6" r="4"/><line x1="9" y1="9" x2="12.5" y2="12.5"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search student..."
              style={{ width: '100%', padding: '10px 10px 10px 28px', borderRadius: 11, border: `1px solid ${T.bdr}`, background: T.s0, fontSize: 12, color: T.ink0, fontFamily: 'inherit', outline: 'none' }}
            />
          </div>
          <button
            onClick={exportCSV}
            disabled={masteryData.length === 0}
            style={{ padding: '9px 13px', borderRadius: 11, background: T.ink0, border: 'none', color: '#fff', fontSize: 11, fontWeight: 500, cursor: masteryData.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', opacity: masteryData.length === 0 ? 0.5 : 1 }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6,2 6,9"/><polyline points="3,7 6,10 9,7"/><line x1="2" y1="10" x2="10" y2="10"/>
            </svg>
            Export
          </button>
        </div>

        {/* Class selector */}
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, stroke: T.blue, fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', pointerEvents: 'none' }} viewBox="0 0 14 14">
            <path d="M2 11V7L7 4l5 3v4"/><rect x="5" y="8" width="4" height="3" rx=".5"/>
          </svg>
          <select
            value={selectedClassId}
            onChange={e => setSelectedClassId(e.target.value)}
            style={{ width: '100%', padding: '10px 34px 10px 34px', borderRadius: 12, border: `1px solid ${T.bdr}`, background: T.s0, fontSize: 13, color: T.ink0, fontFamily: 'inherit', outline: 'none', appearance: 'none', WebkitAppearance: 'none', fontWeight: 500, cursor: 'pointer' }}
          >
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <svg style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, stroke: T.ink2, fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', pointerEvents: 'none' }} viewBox="0 0 14 14">
            <polyline points="3,5 7,9 11,5"/>
          </svg>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', padding: '10px 13px', background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 13 }}>
          {[
            { dot: T.green2, lbl: 'Mastered (80%+)' },
            { dot: T.amber,  lbl: 'Developing (50–79%)' },
            { dot: T.red,    lbl: 'Weak (<50%)' },
            { dot: T.s2,     lbl: 'Not assessed', border: T.bdr },
          ].map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: l.dot, flexShrink: 0, border: l.border ? `1px solid ${l.border}` : 'none' }} />
              <div style={{ fontSize: 10, color: T.ink2 }}>{l.lbl}</div>
            </div>
          ))}
        </div>

        {/* Overall mastery ring card */}
        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 17, padding: '16px 14px', display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* SVG Ring */}
          <div style={{ position: 'relative', width: 70, height: 70, flexShrink: 0 }}>
            <svg width="70" height="70" viewBox="0 0 70 70">
              {/* Track */}
              <circle cx="35" cy="35" r="28" fill="none" stroke={T.s2} strokeWidth="6" />
              {/* Progress */}
              <circle
                cx="35" cy="35" r="28" fill="none"
                stroke={ringColor} strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 35 35)"
                style={{ transition: 'stroke-dashoffset 0.7s ease, stroke 0.3s' }}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: classMasteryPct === null ? T.ink2 : T.ink0, letterSpacing: '-0.3px' }}>
                {classMasteryPct === null ? 'N/A' : `${classMasteryPct}%`}
              </div>
              <div style={{ fontSize: 8, color: T.ink2, marginTop: 1 }}>mastery</div>
            </div>
          </div>
          {/* Ring info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: T.ink0, marginBottom: 3 }}>Class mastery</div>
            <div style={{ fontSize: 11, color: T.ink2, lineHeight: 1.4 }}>{ringDesc}</div>
            <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ padding: '3px 8px', borderRadius: 20, background: masteredConceptCount > 0 ? T.greenL : T.s2, color: masteredConceptCount > 0 ? T.green : T.ink2, fontSize: 10, fontWeight: 500 }}>
                {masteredConceptCount} mastered
              </span>
              <span style={{ padding: '3px 8px', borderRadius: 20, background: developingConceptCount > 0 ? T.amberL : T.s2, color: developingConceptCount > 0 ? T.amber : T.ink2, fontSize: 10, fontWeight: 500 }}>
                {developingConceptCount} developing
              </span>
            </div>
          </div>
        </div>

        {/* Student table */}
        {loading ? (
          <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 17, padding: '40px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: T.ink2 }} />
            <span style={{ fontSize: 12, color: T.ink2 }}>Loading concept data…</span>
          </div>
        ) : (
          <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 17, overflow: 'hidden' }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '9px 13px', background: T.s1, borderBottom: `1px solid ${T.bdr}` }}>
              <div style={{ flex: 1, fontSize: 9, fontWeight: 500, color: T.ink2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Student</div>
              <div style={{ width: 90, textAlign: 'center', fontSize: 9, fontWeight: 500, color: T.ink2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Status</div>
              <div style={{ width: 52, textAlign: 'right', fontSize: 9, fontWeight: 500, color: T.ink2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Mastery</div>
            </div>

            {/* Student rows */}
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 14px', color: T.ink2, fontSize: 12 }}>
                {masteryData.length === 0 ? 'No students enrolled' : 'No students match your search'}
              </div>
            ) : filtered.map((s, idx) => {
              const av = avStyle(s.name || '');
              const initials = getInitials(s.name || '');
              const masteryPct = getStudentMastery(s);
              const st = getMasteryStatus(masteryPct);
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedStudent(s)}
                  style={{
                    display: 'flex', alignItems: 'center', padding: '11px 13px',
                    borderBottom: idx < filtered.length - 1 ? `1px solid ${T.s2}` : 'none',
                    cursor: 'pointer', transition: 'background 80ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = T.s1)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Name cell */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: av.bg, color: av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
                      {initials}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: T.ink0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                      <div style={{ fontSize: 10, color: T.ink2, marginTop: 1 }}>
                        {s.rollNo ? `Roll ${s.rollNo} · ` : ''}{selectedClass?.name}
                      </div>
                    </div>
                  </div>
                  {/* Status cell */}
                  <div style={{ width: 90, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ padding: '4px 9px', borderRadius: 20, background: st.bg, color: st.color, fontSize: 10, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
                      {st.label}
                    </div>
                  </div>
                  {/* Score cell */}
                  <div style={{ width: 52, textAlign: 'right', fontSize: 12, fontWeight: 500, color: masteryPct === null ? T.ink2 : masteryPct >= 80 ? T.green : masteryPct >= 50 ? T.amber : T.red }}>
                    {masteryPct === null ? '—' : `${masteryPct}%`}
                  </div>
                </div>
              );
            })}

            {/* Class avg row */}
            {filtered.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', padding: '10px 13px', background: T.s2, borderTop: `1px solid ${T.bdr}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: T.ink2, fontWeight: 400, marginBottom: 1 }}>Class average</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: T.ink1 }}>{selectedClass?.name}</div>
                </div>
                <div style={{ width: 90, display: 'flex', justifyContent: 'center' }}>
                  {classAvgMastery !== null ? (
                    <div style={{ padding: '4px 9px', borderRadius: 20, background: getMasteryStatus(classAvgMastery).bg, color: getMasteryStatus(classAvgMastery).color, fontSize: 10, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                      {getMasteryStatus(classAvgMastery).label}
                    </div>
                  ) : (
                    <div style={{ padding: '4px 9px', borderRadius: 20, background: T.s2, color: T.ink2, fontSize: 10, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                      No data
                    </div>
                  )}
                </div>
                <div style={{ width: 52, textAlign: 'right', fontSize: 12, fontWeight: 500, color: T.ink2 }}>
                  {classAvgMastery !== null ? `${classAvgMastery}%` : '—'}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Info / empty state banner */}
        {!loading && dynamicHeaders.length === 0 && (
          <div style={{ background: T.blueL, border: `1px solid ${T.blueB}`, borderRadius: 14, padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(59,91,219,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="7" r="5.5"/><line x1="7" y1="4.5" x2="7" y2="7.5"/><circle cx="7" cy="9.5" r=".7" fill={T.blue} stroke="none"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: T.blue }}>No concepts tracked yet</div>
              <div style={{ fontSize: 10, color: T.blue, opacity: 0.7, marginTop: 2, lineHeight: 1.4 }}>
                Add concept scores from the Tests &amp; Exams section to see mastery data here.
              </div>
            </div>
          </div>
        )}

      </div>

      <TabBar />
    </div>
  );
};

export default ConceptMastery;