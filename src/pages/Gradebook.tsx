import { useState, useEffect, useRef, useMemo } from "react";
import { db } from "../lib/firebase";
import {
  collection, query, onSnapshot, where,
  setDoc, doc, writeBatch, deleteDoc, getDocs
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ClassData { id: string; name: string; classId: string; [key: string]: any; }
interface CustomColumn { id: string; name: string; maxMarks: number; createdAt?: number; }

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF',
  green2: '#2F9E44', greenL: '#EBFBEE',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  purple: '#6741D9', purpleL: '#F3F0FF',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── Avatar color palette ───────────────────────────────────────────────────────
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

// ── Grade helpers ─────────────────────────────────────────────────────────────
const simpleGrade = (pct: number) => {
  if (pct >= 90) return { label: 'A', bg: T.greenL, color: T.green2 };
  if (pct >= 70) return { label: 'B', bg: T.blueL, color: T.blue };
  if (pct >= 50) return { label: 'C', bg: T.amberL, color: T.amber };
  return { label: 'F', bg: T.redL, color: T.red };
};

const getGrade = (pct: number) => {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
};

// ── Inline SVG icons ──────────────────────────────────────────────────────────
const IcoCheck = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,6.5 4.5,10 10.5,2.5"/>
  </svg>
);
const IcoChevron = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="10,3 5,8 10,13"/>
  </svg>
);
const IcoPlus = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="5.5" y1="2" x2="5.5" y2="9"/><line x1="2" y1="5.5" x2="9" y2="5.5"/>
  </svg>
);
const IcoDownload = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 2v7M4 7l3 3 3-3M2 12h10"/>
  </svg>
);
const IcoSearch = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="6" cy="6" r="4"/><line x1="9" y1="9" x2="12.5" y2="12.5"/>
  </svg>
);

// ── Tab bar ───────────────────────────────────────────────────────────────────
const TabBar = () => (
  <div style={{
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
    background: T.s0, borderTop: `1px solid ${T.bdr}`,
    padding: '9px 18px 17px', display: 'flex', justifyContent: 'space-between',
  }} className="md:hidden">
    {[
      {
        label: 'Dashboard', active: false,
        icon: <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="11" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="11" width="5" height="5" rx="1.2"/><rect x="11" y="11" width="5" height="5" rx="1.2"/></svg>,
      },
      {
        label: 'Students', active: false,
        icon: <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 15V9L9 5l7 4v6"/><rect x="6.5" y="11" width="5" height="4" rx=".5"/></svg>,
      },
      {
        label: 'Gradebook', active: true,
        icon: <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="14" height="14" rx="2"/><line x1="5.5" y1="6" x2="12.5" y2="6"/><line x1="5.5" y1="9" x2="12.5" y2="9"/><line x1="5.5" y1="12" x2="9" y2="12"/></svg>,
      },
      {
        label: 'Profile', active: false,
        icon: <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="3"/><path d="M3 17c0 0 1.5-4 6-4s6 4 6 4"/></svg>,
      },
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
export default function Gradebook() {
  const { teacherData } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [students, setStudents] = useState<any[]>([]);
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [scores, setScores] = useState<Record<string, any>>({});
  const [localScores, setLocalScores] = useState<Record<string, any>>({});

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColMax, setNewColMax] = useState("100");

  // View state
  const [view, setView] = useState<'main' | 'enter-scores'>('main');
  const [selectedColForEdit, setSelectedColForEdit] = useState<CustomColumn | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Effects ────────────────────────────────────────────────────────────────

  // 1. Fetch Classes (scoped by school — no full collection scan)
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
      const legacyOptions: ClassData[] = classSnap.docs
        .filter(d => d.data().teacherId === teacherData.id)
        .map(d => ({ id: d.id, classId: d.id, name: d.data().name }));

      const q = query(collection(db, "teaching_assignments"), where("teacherId", "==", teacherData.id), ...SC);
      unsub = onSnapshot(q, (snap) => {
        const assignments = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(a => !a.status || a.status.toLowerCase() === "active");

        let options: ClassData[] = assignments.map(a => ({
          id: a.id,
          classId: a.classId,
          name: `${classMap.get(a.classId)?.name || "Class"} — ${a.subjectName || a.subject || "Subject"}`
        }));

        if (options.length === 0) options = legacyOptions;

        setClasses(options);
        if (options.length > 0 && !selectedClassId) setSelectedClassId(options[0].id);
        else if (options.length === 0) setLoading(false);
      });
    };

    init();
    return () => { cancelled = true; unsub?.(); };
  }, [teacherData?.id]);

  // 2. Fetch Roster & Scores
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

    const u1 = onSnapshot(
      query(collection(db, "enrollments"), where("classId", "==", targetClassId), ...SC),
      (snap) => {
        const studs = snap.docs.map(d => {
          const e = d.data();
          return {
            id: e.studentId || e.studentEmail,
            realId: e.studentId,
            email: e.studentEmail,
            name: e.studentName,
            rollNo: e.rollNo || "",
            initials: e.studentName?.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) || "ST"
          };
        });
        setStudents(
          Array.from(new Map(studs.map(i => [i.email || i.id, i])).values())
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      }
    );

    const u2 = onSnapshot(
      query(collection(db, "gradebook_columns"), where("assignmentId", "==", selectedClassId), ...SC),
      (snap) => {
        setColumns(
          snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomColumn))
            .sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0))
        );
      }
    );

    const u3 = onSnapshot(
      query(collection(db, "gradebook_scores"), where("assignmentId", "==", selectedClassId), ...SC),
      (snap) => {
        const fetched: any = {};
        snap.docs.forEach(d => {
          const data = d.data();
          const key = (data.studentEmail?.toLowerCase() || data.studentId);
          fetched[`${key}_${data.columnId}`] = data.mark;
        });
        setScores(fetched);
        setLocalScores(fetched);
        setLoading(false);
      }
    );

    return () => { u1(); u2(); u3(); };
  }, [teacherData?.id, selectedClassId, classes]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddColumn = async () => {
    if (!newColName.trim()) return toast.error("Column name required");
    const colId = `col_${Date.now()}`;
    await setDoc(doc(db, "gradebook_columns", colId), {
      id: colId,
      assignmentId: selectedClassId,
      classId: classes.find(c => c.id === selectedClassId)?.classId || selectedClassId,
      teacherId: teacherData.id,
      schoolId: teacherData.schoolId || "",
      branchId: teacherData.branchId || "",
      name: newColName.trim(),
      maxMarks: Number(newColMax) || 100,
      createdAt: Date.now()
    });
    setShowAddCol(false);
    setNewColName("");
    setNewColMax("100");
    toast.success("Column added.");
  };

  const handleDeleteColumn = async (id: string) => {
    if (confirm("Delete this column?")) {
      await deleteDoc(doc(db, "gradebook_columns", id));
      toast.success("Column deleted.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const batch = writeBatch(db);
    let count = 0;
    students.forEach(stu => {
      columns.forEach(col => {
        const key = `${(stu.email || stu.id).toLowerCase()}_${col.id}`;
        if (localScores[key] !== scores[key]) {
          batch.set(doc(db, "gradebook_scores", `${stu.id}_${col.id}`), {
            id: `${stu.id}_${col.id}`,
            studentId: stu.realId || stu.id,
            studentEmail: stu.email?.toLowerCase() || "",
            studentName: stu.name,
            teacherId: teacherData.id,
            schoolId: teacherData.schoolId || "",
            branchId: teacherData.branchId || "",
            columnId: col.id,
            columnName: col.name,
            assignmentId: selectedClassId,
            classId: classes.find(c => c.id === selectedClassId)?.classId || selectedClassId,
            mark: Number(localScores[key]),
            maxMarks: Number(col.maxMarks) || 100,
            updatedAt: Date.now()
          }, { merge: true });
          count++;
        }
      });
    });
    if (count > 0) await batch.commit();
    setSaving(false);
    toast.success(count > 0 ? `Saved ${count} entries` : "No changes to save");
  };

  const handleSaveColumn = async () => {
    await handleSave();
    setView('main');
  };

  const handleDiscard = () => {
    if (!selectedColForEdit) { setView('main'); return; }
    const revert = { ...localScores };
    students.forEach(stu => {
      const key = `${(stu.email || stu.id).toLowerCase()}_${selectedColForEdit.id}`;
      const orig = scores[key];
      if (orig !== undefined) revert[key] = orig;
      else delete revert[key];
    });
    setLocalScores(revert);
    setView('main');
  };

  const handleExport = () => {
    const headers = ["Student", ...columns.map(c => `${c.name} (${c.maxMarks})`), "Total", "Grade"];
    const rows = filtered.map(stu => {
      const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0);
      const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
      return [stu.name, ...columns.map(c => localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`] || ""), earned, getGrade(pct)];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gradebook");
    XLSX.writeFile(wb, `Gradebook_${selectedClass?.name || "Export"}.xlsx`);
  };

  // ── Computed ───────────────────────────────────────────────────────────────

  const filtered = students.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.email?.toLowerCase().includes(search.toLowerCase())
  );

  const selectedClass = classes.find(c => c.id === selectedClassId);

  const colAvgs = columns.map(col => {
    const vals = filtered
      .map(stu => Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${col.id}`]))
      .filter(v => !isNaN(v) && v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });

  const totalAvgEarned = colAvgs.reduce((a, b) => a + b, 0);
  const totalMax = columns.reduce((a, c) => a + c.maxMarks, 0);
  const classAvgPct = totalMax > 0 ? (totalAvgEarned / totalMax) * 100 : 0;
  const avgGradeLabel = simpleGrade(classAvgPct);
  const hasUnsaved = JSON.stringify(localScores) !== JSON.stringify(scores);

  const gradeDist = useMemo(() => {
    const dist = { A: 0, B: 0, C: 0, F: 0 };
    filtered.forEach(stu => {
      const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0);
      const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
      if (pct >= 90) dist.A++;
      else if (pct >= 70) dist.B++;
      else if (pct >= 50) dist.C++;
      else dist.F++;
    });
    return dist;
  }, [filtered, columns, localScores, totalMax]);

  // ── Render: Enter Scores View ──────────────────────────────────────────────
  if (view === 'enter-scores' && selectedColForEdit) {
    const col = selectedColForEdit;

    return (
      <div style={{ fontFamily: 'inherit', minHeight: '100vh', background: T.s1 }} className="text-left pb-24">

        {/* Dark hero */}
        <div style={{ background: T.ink0 }} className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-6">
          <button
            onClick={() => setView('main')}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 500,
              fontFamily: 'inherit', padding: '14px 0 10px 0',
            }}
          >
            <IcoChevron />
            Gradebook
          </button>
          <div style={{ fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>
            Enter scores
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.1, marginBottom: 4 }}>
            {col.name}<br />Scores
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginBottom: 14 }}>
            {selectedClass?.name} · Max {col.maxMarks} marks
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {[
              { label: 'Editing' },
              { strong: String(filtered.length), label: ' Students' },
            ].map((chip, i) => (
              <div key={i} style={{
                padding: '5px 10px', borderRadius: 20,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.06)',
                fontSize: 10, color: 'rgba(255,255,255,0.6)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {chip.strong && <strong style={{ color: '#fff', fontWeight: 500 }}>{chip.strong}</strong>}
                {chip.label}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="pt-4 flex flex-col gap-3">

          {/* Unit info card */}
          <div style={{
            background: T.s0, border: `1px solid ${T.bdr}`,
            borderRadius: 14, padding: '12px 13px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: T.purpleL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke={T.purple} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="1.5" width="10" height="11" rx="1.5"/>
                  <line x1="4.5" y1="5" x2="9.5" y2="5"/>
                  <line x1="4.5" y1="7.5" x2="7.5" y2="7.5"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.ink0 }}>{col.name} assessment</div>
                <div style={{ fontSize: 10, color: T.ink2, marginTop: 1 }}>Max {col.maxMarks} marks · {selectedClass?.name}</div>
              </div>
            </div>
            <span style={{ padding: '3px 8px', borderRadius: 20, background: T.purpleL, color: T.purple, fontSize: 10, fontWeight: 500 }}>Active</span>
          </div>

          {/* Section label */}
          <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '0 2px' }}>
            Student scores
          </div>

          {/* Per-student score cards */}
          {filtered.map(stu => {
            const av = avStyle(stu.name || '');
            const initials = getInitials(stu.name || '');
            const key = `${(stu.email || stu.id).toLowerCase()}_${col.id}`;
            const rawVal = localScores[key];
            const numVal = rawVal !== undefined && rawVal !== '' ? Number(rawVal) : null;
            const pct = numVal !== null ? Math.min(100, (numVal / col.maxMarks) * 100) : 0;
            const grd = simpleGrade(numVal !== null ? pct : 0);

            return (
              <div key={stu.email || stu.id} style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ height: 3, background: av.color }} />
                <div style={{ padding: 13 }}>
                  {/* Student info row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 11,
                      background: av.bg, color: av.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 500, flexShrink: 0,
                    }}>
                      {initials}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: T.ink0 }}>{stu.name}</div>
                      <div style={{ fontSize: 10, color: T.ink2, marginTop: 1 }}>
                        {stu.rollNo ? `Roll ${stu.rollNo} · ` : ''}{selectedClass?.name}
                      </div>
                    </div>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 22, borderRadius: 7,
                      fontSize: 11, fontWeight: 500,
                      background: grd.bg, color: grd.color,
                    }}>
                      {grd.label}
                    </div>
                  </div>

                  {/* Score input */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 11 }}>
                    <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      Score — {col.name}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="number"
                        value={rawVal ?? ''}
                        onChange={e => setLocalScores(prev => ({
                          ...prev,
                          [key]: e.target.value === '' ? undefined : e.target.value,
                        }))}
                        placeholder="Enter score"
                        min={0}
                        max={col.maxMarks}
                        style={{
                          flex: 1, padding: '10px 12px', borderRadius: 10,
                          border: `1px solid ${T.bdr}`, background: T.s1,
                          fontSize: 14, fontWeight: 500, color: T.ink0,
                          fontFamily: 'inherit', outline: 'none',
                        }}
                      />
                      <div style={{ fontSize: 12, color: T.ink2, whiteSpace: 'nowrap' }}>/ {col.maxMarks}</div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ height: 5, borderRadius: 3, background: T.s2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      background: av.color,
                      width: `${pct}%`,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Grade scale reference */}
          <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: '12px 13px' }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
              Grade scale
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
              {[
                { label: 'A — 90%+', bg: T.greenL, color: T.green2 },
                { label: 'B — 70–89%', bg: T.blueL, color: T.blue },
                { label: 'C — 50–69%', bg: T.amberL, color: T.amber },
                { label: 'F — <50%', bg: T.redL, color: T.red },
              ].map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 9, background: g.bg }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                  <div style={{ fontSize: 11, color: g.color, fontWeight: 500 }}>{g.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Save / Discard footer */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSaveColumn}
              disabled={saving}
              style={{
                flex: 1, padding: 12, borderRadius: 12, background: T.green2, border: 'none',
                color: '#fff', fontSize: 13, fontWeight: 500,
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', opacity: saving ? 0.7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <IcoCheck />}
              Save scores
            </button>
            <button
              onClick={handleDiscard}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: T.s0, border: `1px solid ${T.bdr}`,
                color: T.ink2, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Discard
            </button>
          </div>

        </div>

        <TabBar />
      </div>
    );
  }

  // ── Render: Main View ──────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'inherit', minHeight: '100vh', background: T.s1 }} className="text-left pb-24">

      {/* Dark hero */}
      <div style={{ background: T.ink0 }} className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-6">
        <div style={{ fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5, paddingTop: 16 }}>
          Academic records
        </div>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.1, marginBottom: 4 }}>
          Gradebook
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)' }}>
          {selectedClass ? `Complete academic record for ${selectedClass.name}` : 'Select a class to view gradebook'}
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 14, flexWrap: 'wrap' }}>
          {[
            { strong: String(filtered.length), label: ' Students', ico: <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 8.5c0 0 1.5-2 4-2s4 2 4 2"/><circle cx="5" cy="4" r="2"/></svg> },
            { strong: String(columns.length), label: columns.length === 1 ? ' Unit' : ' Units', ico: <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="8" height="8" rx="1.5"/><line x1="3" y1="4" x2="7" y2="4"/><line x1="3" y1="6" x2="5.5" y2="6"/></svg> },
            { label: `${classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'} Avg`, ico: <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,6 4,4 5.5,5.5 8.5,2.5"/></svg> },
          ].map((chip, i) => (
            <div key={i} style={{
              padding: '5px 10px', borderRadius: 20,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.06)',
              fontSize: 10, color: 'rgba(255,255,255,0.6)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {chip.ico}
              {chip.strong && <strong style={{ color: '#fff', fontWeight: 500 }}>{chip.strong}</strong>}
              {chip.label}
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="pt-4 flex flex-col gap-3">

        {/* Toolbar row 1: search + column btn + export */}
        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.ink2, pointerEvents: 'none' }}>
              <IcoSearch />
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search student..."
              style={{
                width: '100%', padding: '9px 10px 9px 28px', borderRadius: 11,
                border: `1px solid ${T.bdr}`, background: T.s0,
                fontSize: 12, color: T.ink0, fontFamily: 'inherit', outline: 'none',
              }}
            />
          </div>
          <button
            onClick={() => setShowAddCol(v => !v)}
            style={{
              padding: '9px 11px', borderRadius: 11, border: `1px solid ${T.bdr}`, background: T.s0,
              fontSize: 11, fontWeight: 500, color: showAddCol ? T.blue : T.ink1,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
            }}
          >
            <IcoPlus />
            Column
          </button>
          <button
            onClick={handleExport}
            style={{
              width: 34, height: 34, borderRadius: 11,
              border: `1px solid ${T.bdr}`, background: T.s0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: T.ink2,
            }}
          >
            <IcoDownload />
          </button>
        </div>

        {/* Add column panel */}
        {showAddCol && (
          <div style={{
            background: T.s0, border: `1px solid ${T.bdr}`,
            borderRadius: 16, padding: '14px 13px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              Add column
            </div>
            <input
              type="text"
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              placeholder="Column name (e.g. Unit 1, Quiz 1)"
              onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
              style={{
                padding: '10px 12px', borderRadius: 10,
                border: `1px solid ${T.bdr}`, background: T.s1,
                fontSize: 13, color: T.ink0, fontFamily: 'inherit', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                value={newColMax}
                onChange={e => setNewColMax(e.target.value)}
                style={{
                  width: 90, padding: '10px 12px', borderRadius: 10,
                  border: `1px solid ${T.bdr}`, background: T.s1,
                  fontSize: 13, color: T.ink0, fontFamily: 'inherit', outline: 'none',
                }}
              />
              <span style={{ fontSize: 11, color: T.ink2 }}>max marks</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAddColumn}
                style={{
                  flex: 1, padding: 10, borderRadius: 10, background: T.ink0, border: 'none',
                  color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Add column
              </button>
              <button
                onClick={() => { setShowAddCol(false); setNewColName(''); setNewColMax('100'); }}
                style={{
                  padding: '10px 14px', borderRadius: 10, background: T.s1,
                  border: `1px solid ${T.bdr}`, color: T.ink2,
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Toolbar row 2: class selector + save */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <svg style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, stroke: T.blue, fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', pointerEvents: 'none' }} viewBox="0 0 14 14">
              <path d="M2 11V7L7 4l5 3v4"/><rect x="5" y="8" width="4" height="3" rx=".5"/>
            </svg>
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              style={{
                width: '100%', padding: '10px 34px 10px 30px', borderRadius: 12,
                border: `1px solid ${T.bdr}`, background: T.s0,
                fontSize: 13, color: T.ink0, fontFamily: 'inherit', outline: 'none',
                appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer', fontWeight: 500,
              }}
            >
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <svg style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, stroke: T.ink2, fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', pointerEvents: 'none' }} viewBox="0 0 14 14">
              <polyline points="3,5 7,9 11,5"/>
            </svg>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !hasUnsaved}
            style={{
              padding: '9px 13px', borderRadius: 11,
              background: hasUnsaved ? T.green2 : T.s2,
              border: 'none',
              color: hasUnsaved ? '#fff' : T.ink2,
              fontSize: 11, fontWeight: 500,
              cursor: hasUnsaved && !saving ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={hasUnsaved ? '#fff' : T.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,6.5 4.5,10 10.5,2.5"/></svg>
            }
            Save
          </button>
        </div>

        {/* Grade table */}
        {loading ? (
          <div style={{
            background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18,
            padding: '40px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}>
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: T.ink2 }} />
            <span style={{ fontSize: 12, color: T.ink2 }}>Loading gradebook...</span>
          </div>
        ) : (
          <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: columns.length > 2 ? `${220 + columns.length * 60}px` : '100%' }}>
                <thead>
                  <tr style={{ background: T.s1, borderBottom: `1px solid ${T.bdr}` }}>
                    <th style={{
                      padding: '10px 0 10px 14px', fontSize: 9, fontWeight: 500, color: T.ink2,
                      letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'left',
                      position: 'sticky', left: 0, background: T.s1,
                    }}>Student</th>
                    {columns.map(col => (
                      <th key={col.id} style={{ width: 52, padding: '10px 0', fontSize: 9, fontWeight: 500, color: T.ink2, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center', cursor: 'pointer' }}
                        onClick={() => { setSelectedColForEdit(col); setView('enter-scores'); }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                          {col.name}
                          <div style={{ width: 20, height: 1.5, background: T.blue, opacity: 0.5, borderRadius: 1 }} />
                        </div>
                      </th>
                    ))}
                    <th style={{ width: 48, padding: '10px 0', fontSize: 9, fontWeight: 500, color: T.ink2, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center' }}>Total</th>
                    <th style={{ width: 44, padding: '10px 0 10px 0', fontSize: 9, fontWeight: 500, color: T.ink2, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center', paddingRight: 10 }}>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '40px 14px', color: T.ink2, fontSize: 12 }}>
                        No columns yet — tap "+ Column" above to add one
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 3} style={{ textAlign: 'center', padding: '40px 14px', color: T.ink2, fontSize: 12 }}>
                        No students found
                      </td>
                    </tr>
                  ) : filtered.map((stu, idx) => {
                    const av = avStyle(stu.name || '');
                    const initials = getInitials(stu.name || '');
                    const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0);
                    const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
                    const grd = simpleGrade(pct);

                    return (
                      <tr key={stu.email || stu.id} style={{ borderBottom: idx < filtered.length - 1 ? `1px solid ${T.s2}` : 'none' }}>
                        {/* Student cell */}
                        <td style={{ padding: '12px 10px 12px 14px', position: 'sticky', left: 0, background: T.s0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: 10,
                              background: av.bg, color: av.color,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, fontWeight: 500, flexShrink: 0,
                            }}>
                              {initials}
                            </div>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 500, color: T.ink0 }}>{stu.name}</div>
                              {stu.rollNo && <div style={{ fontSize: 10, color: T.ink2, marginTop: 1 }}>Roll {stu.rollNo}</div>}
                            </div>
                          </div>
                        </td>

                        {/* Score cells */}
                        {columns.map(col => {
                          const key = `${(stu.email || stu.id).toLowerCase()}_${col.id}`;
                          const val = localScores[key];
                          const hasVal = val !== undefined && val !== '' && val !== null;
                          return (
                            <td key={col.id} style={{ width: 52, textAlign: 'center' }}>
                              <div
                                onClick={() => { setSelectedColForEdit(col); setView('enter-scores'); }}
                                style={{
                                  display: 'inline-block', padding: '4px 7px', borderRadius: 7,
                                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                  minWidth: 30, textAlign: 'center',
                                  background: hasVal ? T.blueL : T.s2,
                                  color: hasVal ? T.blue : T.ink2,
                                }}
                              >
                                {hasVal ? val : '—'}
                              </div>
                            </td>
                          );
                        })}

                        {/* Total */}
                        <td style={{ width: 48, textAlign: 'center', fontSize: 13, fontWeight: 500, color: T.ink0 }}>
                          {earned}
                        </td>

                        {/* Grade pill */}
                        <td style={{ width: 44, textAlign: 'center', paddingRight: 10 }}>
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 26, height: 22, borderRadius: 7,
                            fontSize: 11, fontWeight: 500,
                            background: grd.bg, color: grd.color,
                          }}>
                            {grd.label}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Class avg row */}
                  {filtered.length > 0 && columns.length > 0 && (
                    <tr style={{ background: T.s2, borderTop: `1px solid ${T.bdr}` }}>
                      <td style={{ padding: '11px 14px', position: 'sticky', left: 0, background: T.s2 }}>
                        <div style={{ fontSize: 10, color: T.ink2, marginBottom: 1 }}>Class average</div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: T.ink1 }}>{selectedClass?.name}</div>
                      </td>
                      {colAvgs.map((avg, i) => (
                        <td key={columns[i]?.id} style={{ width: 52, textAlign: 'center', fontSize: 12, color: T.ink2 }}>
                          {avg > 0 ? avg.toFixed(1) : '—'}
                        </td>
                      ))}
                      <td style={{ width: 48, textAlign: 'center', fontSize: 13, fontWeight: 500, color: T.ink0 }}>
                        {totalAvgEarned > 0 ? totalAvgEarned.toFixed(1) : '0.0'}
                      </td>
                      <td style={{ width: 44, textAlign: 'center', paddingRight: 10 }}>
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 26, height: 22, borderRadius: 7,
                          fontSize: 11, fontWeight: 500,
                          background: avgGradeLabel.bg, color: avgGradeLabel.color,
                        }}>
                          {avgGradeLabel.label}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Quick stats 3-grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            {
              val: classAvgPct > 0 ? `${classAvgPct.toFixed(0)}%` : '0%',
              label: 'Class avg',
              color: classAvgPct >= 75 ? T.green2 : classAvgPct >= 50 ? T.amber : T.red,
              pct: classAvgPct,
            },
            {
              val: String(gradeDist.A),
              label: 'Excellent',
              color: T.green2,
              pct: filtered.length > 0 ? (gradeDist.A / filtered.length) * 100 : 0,
            },
            {
              val: String(gradeDist.F),
              label: 'At risk',
              color: T.red,
              pct: filtered.length > 0 ? (gradeDist.F / filtered.length) * 100 : 0,
            },
          ].map((s, i) => (
            <div key={i} style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 13, padding: 11 }}>
              <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.4px', lineHeight: 1, color: s.color }}>
                {s.val}
              </div>
              <div style={{ fontSize: 10, color: T.ink2, marginTop: 3 }}>{s.label}</div>
              <div style={{ height: 3, borderRadius: 2, background: T.s2, marginTop: 7, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, background: s.color, width: `${Math.min(100, s.pct)}%` }} />
              </div>
            </div>
          ))}
        </div>

        {/* Grade distribution */}
        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: 'hidden' }}>
          <div style={{
            padding: '12px 13px', borderBottom: `1px solid ${T.s2}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.ink0 }}>Grade distribution</div>
            <span style={{ padding: '3px 8px', borderRadius: 20, background: T.s2, color: T.ink2, fontSize: 10, fontWeight: 500 }}>
              {columns.length > 0 ? columns.map(c => c.name).join(', ') : 'All units'}
            </span>
          </div>
          <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'A (90+)', color: T.green2, count: gradeDist.A },
              { label: 'B (70–89)', color: T.blue, count: gradeDist.B },
              { label: 'C (50–69)', color: T.amber, count: gradeDist.C },
              { label: 'F (<50)', color: T.red, count: gradeDist.F },
            ].map((g, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 11, color: g.color, width: 52, flexShrink: 0 }}>{g.label}</div>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.s2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3, background: g.color,
                    width: filtered.length > 0 ? `${(g.count / filtered.length) * 100}%` : '0%',
                    transition: 'width 0.5s',
                  }} />
                </div>
                <div style={{ fontSize: 11, fontWeight: 500, width: 20, textAlign: 'right', color: g.color }}>{g.count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{
          background: T.s0, border: `1px solid ${T.bdr}`,
          borderRadius: 14, padding: '12px 14px',
          display: 'flex', flexWrap: 'wrap', gap: 8,
        }}>
          {[
            { dot: T.green2, lbl: 'Excellent (90%+)' },
            { dot: T.blue, lbl: 'Good (70–89%)' },
            { dot: T.amber, lbl: 'Average (50–69%)' },
            { dot: T.red, lbl: 'At risk (<50%)' },
            ...columns.map(c => ({ dot: T.ink2, lbl: `Max: ${c.name} (${c.maxMarks})` })),
          ].map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: l.dot, flexShrink: 0 }} />
              <div style={{ fontSize: 10, color: T.ink2 }}>{l.lbl}</div>
            </div>
          ))}
        </div>

        <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" />

      </div>

      <TabBar />
    </div>
  );
}