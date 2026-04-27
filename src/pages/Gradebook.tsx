import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import {
  collection, query, onSnapshot, where,
  doc, writeBatch, getDocs,
  type QueryConstraint,
} from "firebase/firestore";
import { auditedSet, auditedDelete } from "../lib/auditedWrites";
import { useAuth } from "../lib/AuthContext";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
// xlsx loaded dynamically to reduce bundle size (~500KB)
const loadXLSX = () => import("xlsx");

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


// ─────────────────────────────────────────────────────────────────────────────
export default function Gradebook() {
  const { teacherData } = useAuth();
  const navigate = useNavigate();

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

    if (!teacherData.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));

    const u1 = onSnapshot(
      query(collection(db, "enrollments"), ...SC, where("classId", "==", targetClassId)),
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
      query(collection(db, "gradebook_columns"), ...SC, where("assignmentId", "==", selectedClassId)),
      (snap) => {
        setColumns(
          snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomColumn))
            .sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0))
        );
      }
    );

    const u3 = onSnapshot(
      query(collection(db, "gradebook_scores"), ...SC, where("assignmentId", "==", selectedClassId)),
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
    await auditedSet(doc(db, "gradebook_columns", colId), {
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
      await auditedDelete(doc(db, "gradebook_columns", id));
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

  const handleExport = async () => {
    const headers = ["Student", ...columns.map(c => `${c.name} (${c.maxMarks})`), "Total", "Grade"];
    const rows = filtered.map(stu => {
      const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0);
      const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
      return [stu.name, ...columns.map(c => localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`] || ""), earned, getGrade(pct)];
    });
    try {
      const XLSX = await loadXLSX();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Gradebook");
      const rawName = selectedClass?.name || "Export";
      const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_").trim() || "Export";
      XLSX.writeFile(wb, `Gradebook_${safeName}.xlsx`);
    } catch (e) {
      console.error("[Gradebook] export failed", e);
      toast.error("Export failed.");
    }
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
      <div style={{ fontFamily: 'inherit', minHeight: '100vh', background: '#EEF4FF' }} className="text-left pb-24">

        {/* Dark hero */}
        <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-6 bg-[#001A66] md:bg-[#08090C]">
          <button
            type="button"
            aria-label="Back to gradebook"
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
              type="button"
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
              type="button"
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

      </div>
    );
  }

  // ── Render: Main View ──────────────────────────────────────────────────────
  // Helpers for the mobile mockup design
  const letterGrade = (pct: number) => {
    if (pct >= 90) return { label: 'A', tone: 'a' as const, color: '#00C853' };
    if (pct >= 80) return { label: 'A', tone: 'a' as const, color: '#00C853' };
    if (pct >= 70) return { label: 'B', tone: 'b' as const, color: '#0055FF' };
    if (pct >= 60) return { label: 'C', tone: 'c' as const, color: '#FFAA00' };
    if (pct >= 50) return { label: 'D', tone: 'd' as const, color: '#FF8800' };
    return { label: 'F', tone: 'f' as const, color: '#FF3355' };
  };
  const band = (pct: number) => {
    if (pct >= 90) return { cls: 'excellent', label: 'Excellent' };
    if (pct >= 70) return { cls: 'good', label: 'Good' };
    if (pct >= 50) return { cls: 'average', label: 'Average' };
    return { cls: 'atrisk', label: 'At Risk' };
  };
  const avatarBg = (name: string) => {
    const palette = ['#7B3FF4', '#00C853', '#0055FF', '#FF8800', '#00B8D4', '#C2255C', '#6741D9'];
    const sum = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return palette[sum % palette.length];
  };
  const lowest = filtered.length && columns.length ? Math.min(...filtered.map(stu => columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0))) : 0;
  const highest = filtered.length && columns.length ? Math.max(...filtered.map(stu => columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0))) : 0;
  const avgBand = band(classAvgPct);
  const avgLetter = letterGrade(classAvgPct);
  const passingCount = filtered.filter(stu => {
    const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${(stu.email || stu.id).toLowerCase()}_${c.id}`]) || 0), 0);
    const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
    return pct >= 50;
  }).length;
  const atRiskCount = filtered.length - passingCount;

  return (
    <div style={{ fontFamily: 'inherit', minHeight: '100vh' }} className="text-left pb-24">

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <div
        className="md:hidden gradebook-mobile-root -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px] pb-7"
        style={{
          background: '#EEF4FF',
          minHeight: '100vh',
          fontVariantNumeric: 'tabular-nums',
        }}
      >

        {/* Scoped styles for this mobile view only */}
        <style>{`
          .gb-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
          @media (hover:hover) {
            .gb-card3d:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); }
          }
          .gb-card3d:active { transform: translateY(-1px) scale(.99); }
          .gb-press { transition: all 0.3s ease; }
          .gb-press:hover { transform: translateY(-1px); filter: brightness(1.05); }
          .gb-press:active { transform: scale(.94); }
          .gb-score-input { transition: all 0.3s ease; }
          .gb-score-input:focus { background: #fff !important; border-color: #0055FF !important; box-shadow: 0 0 0 3px rgba(9,87,247,.14) !important; }
          @keyframes gbFadeInUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
          .gb-enter > * { animation: gbFadeInUp .5s cubic-bezier(.34,1.56,.64,1) both; }
          .gb-enter > *:nth-child(1) { animation-delay: .04s; }
          .gb-enter > *:nth-child(2) { animation-delay: .10s; }
          .gb-enter > *:nth-child(3) { animation-delay: .16s; }
          .gb-enter > *:nth-child(4) { animation-delay: .22s; }
          .gb-enter > *:nth-child(5) { animation-delay: .28s; }
          .gb-enter > *:nth-child(6) { animation-delay: .34s; }
          .gb-enter > *:nth-child(7) { animation-delay: .40s; }
          .gb-enter > *:nth-child(8) { animation-delay: .46s; }
          .gb-legend-scroll::-webkit-scrollbar { display: none; }
          .gb-legend-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

        <div className="gb-enter" style={{ display: 'flex', flexDirection: 'column' }}>

          {/* Page header */}
          <div style={{ padding: '8px 2px 14px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 5, height: 5, borderRadius: 2, background: '#0055FF', display: 'inline-block' }} />
              Teacher Dashboard · Gradebook
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#001040', letterSpacing: '-1.1px', lineHeight: 1.05, margin: 0 }}>Gradebook</h1>
            <div style={{ fontSize: 12, color: '#5070B0', fontWeight: 500, marginTop: 6, letterSpacing: '-0.15px' }}>
              {selectedClass ? `Complete academic record for ${selectedClass.name}.` : 'Select a class to view gradebook.'}
            </div>
          </div>

          {/* Class picker */}
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <div
              className="gb-card3d"
              style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '12px 14px', background: '#fff',
                borderRadius: 14,
                boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
                cursor: 'pointer',
              }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 12, background: '#7B3FF4', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#5070B0', letterSpacing: '1.3px', textTransform: 'uppercase', marginBottom: 2 }}>Viewing</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selectedClass ? selectedClass.name : (classes.length === 0 ? 'No classes' : 'Select class')}
                </div>
              </div>
              <div style={{ color: '#99AACC', fontSize: 22, fontWeight: 400, lineHeight: 1, marginTop: -3 }}>›</div>
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
              {classes.length === 0 && <option value="">No classes available</option>}
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* HERO — Class Average */}
          <div
            className="gb-card3d"
            role="button"
            tabIndex={0}
            aria-label="Open class report"
            onClick={() => navigate('/reports')}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
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
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.72)', letterSpacing: '1.8px', textTransform: 'uppercase' }}>Class Average</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2, fontWeight: 500, letterSpacing: '-0.1px' }}>
                    {columns.length > 0 ? `${columns.length} ${columns.length === 1 ? 'unit' : 'units'} · ${selectedClass?.name || ''}` : 'No units yet'}
                  </div>
                </div>
                <div style={{
                  marginLeft: 'auto', width: 44, height: 44,
                  background: `linear-gradient(145deg, ${avgLetter.color}, ${avgLetter.color}DD)`,
                  color: '#fff', borderRadius: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px',
                  boxShadow: `0 1px 2px ${avgLetter.color}55, 0 6px 14px ${avgLetter.color}55, inset 0 1px 0 rgba(255,255,255,.25)`,
                }}>
                  {avgLetter.label}
                </div>
              </div>
              <div style={{ fontSize: 56, fontWeight: 700, color: '#fff', letterSpacing: '-2.6px', lineHeight: 1, marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                {classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'}
                <span style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '-0.4px' }}>/ 100</span>
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.72)', marginBottom: 20, fontWeight: 500, letterSpacing: '-0.15px' }}>
                <b style={{ color: '#fff', fontWeight: 700 }}>{avgBand.label} performance</b>
                {atRiskCount > 0 ? ` — ${atRiskCount} student${atRiskCount === 1 ? '' : 's'} need${atRiskCount === 1 ? 's' : ''} remediation.` : ' — all students on track.'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'rgba(255,255,255,.1)', borderRadius: 14, padding: 1, overflow: 'hidden' }}>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '12px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px' }}>{filtered.length}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 3 }}>Students</div>
                </div>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '12px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#6FFFAA', letterSpacing: '-0.5px' }}>{passingCount}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 3 }}>Passing</div>
                </div>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '12px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#FF9AA9', letterSpacing: '-0.5px' }}>{atRiskCount}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 3 }}>At Risk</div>
                </div>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="gb-legend-scroll" style={{ display: 'flex', gap: 6, padding: '10px 12px', background: '#fff', borderRadius: 14, marginBottom: 14, overflowX: 'auto', boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)' }}>
            {[
              { c: '#00C853', l: 'Excellent 90+' },
              { c: '#0055FF', l: 'Good 70–89' },
              { c: '#FF8800', l: 'Average 50–69' },
              { c: '#FF3355', l: 'At Risk <50' },
            ].map(item => (
              <div key={item.l} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: '#F4F7FE', borderRadius: 100, fontSize: 10, fontWeight: 700, color: '#002080', letterSpacing: '-0.1px', flexShrink: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.c }} />
                {item.l}
              </div>
            ))}
          </div>

          {/* Section head: Student Grades + Add Unit + search + export */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.35px' }}>Student Grades</span>
              <span style={{ fontSize: 11, color: '#5070B0', fontWeight: 600, letterSpacing: '-0.1px' }}>
                {filtered.length} student{filtered.length === 1 ? '' : 's'} · {columns.length} unit{columns.length === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                aria-label="Export gradebook to Excel"
                onClick={handleExport}
                className="gb-press"
                style={{ width: 30, height: 30, borderRadius: 10, background: '#fff', color: '#0055FF', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0.5px 1px rgba(9,87,247,.06), 0 2px 8px rgba(9,87,247,.08)' }}
              >
                <IcoDownload />
              </button>
              <button
                type="button"
                onClick={() => setShowAddCol(v => !v)}
                aria-expanded={showAddCol}
                className="gb-press"
                style={{
                  height: 30, padding: '0 12px', borderRadius: 10, background: '#0055FF',
                  color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '-0.1px',
                  display: 'flex', alignItems: 'center', gap: 5, border: 'none',
                  boxShadow: '0 1px 2px rgba(9,87,247,.2), 0 3px 8px rgba(9,87,247,.25)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Unit
              </button>
            </div>
          </div>

          {/* Search + Save row */}
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 10 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#5070B0', pointerEvents: 'none' }}>
                <IcoSearch />
              </div>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search student..."
                style={{
                  width: '100%', padding: '9px 10px 9px 28px', borderRadius: 11,
                  border: 'none', background: '#fff',
                  fontSize: 12, color: '#001040', fontFamily: 'inherit', outline: 'none',
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
                }}
              />
            </div>
            <button
              type="button"
              aria-label={saving ? 'Saving grades' : 'Save grades'}
              onClick={handleSave}
              disabled={saving || !hasUnsaved}
              className="gb-press"
              style={{
                padding: '9px 13px', borderRadius: 11,
                background: hasUnsaved ? '#00C853' : '#EAF0FB',
                border: 'none',
                color: hasUnsaved ? '#fff' : '#5070B0',
                fontSize: 11, fontWeight: 700, letterSpacing: '-0.1px',
                cursor: hasUnsaved && !saving ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                opacity: saving ? 0.7 : 1,
                boxShadow: hasUnsaved ? '0 1px 2px rgba(0,200,83,.2), 0 3px 8px rgba(0,200,83,.25)' : 'none',
              }}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <IcoCheck />}
              Save
            </button>
          </div>

          {/* Add column panel */}
          {showAddCol && (
            <div style={{
              background: '#fff',
              borderRadius: 16, padding: '14px 13px',
              display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
              border: '0.5px solid rgba(9,87,247,.1)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.3px', textTransform: 'uppercase' }}>
                Add unit
              </div>
              <input
                type="text"
                value={newColName}
                onChange={e => setNewColName(e.target.value)}
                placeholder="Unit name (e.g. Unit 1, Quiz 1)"
                onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
                style={{
                  padding: '10px 12px', borderRadius: 10,
                  border: '0.5px solid rgba(9,87,247,.15)', background: '#F4F7FE',
                  fontSize: 13, color: '#001040', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  value={newColMax}
                  onChange={e => setNewColMax(e.target.value)}
                  style={{
                    width: 90, padding: '10px 12px', borderRadius: 10,
                    border: '0.5px solid rgba(9,87,247,.15)', background: '#F4F7FE',
                    fontSize: 13, color: '#001040', fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <span style={{ fontSize: 11, color: '#5070B0', fontWeight: 600 }}>max marks</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleAddColumn}
                  className="gb-press"
                  style={{
                    flex: 1, padding: 10, borderRadius: 10, background: '#0055FF', border: 'none',
                    color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: '0 1px 2px rgba(9,87,247,.2), 0 3px 8px rgba(9,87,247,.25)',
                  }}
                >
                  Add unit
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddCol(false); setNewColName(''); setNewColMax('100'); }}
                  className="gb-press"
                  style={{
                    padding: '10px 14px', borderRadius: 10, background: '#F4F7FE',
                    border: 'none', color: '#5070B0',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Loading / empty states */}
          {loading ? (
            <div className="gb-card3d" style={{
              background: '#fff', borderRadius: 20, padding: '40px 14px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
            }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#5070B0' }} />
              <span style={{ fontSize: 12, color: '#5070B0' }}>Loading gradebook...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="gb-card3d" style={{
              background: '#fff', borderRadius: 20, padding: '40px 14px', textAlign: 'center',
              color: '#5070B0', fontSize: 12,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
            }}>
              {search ? 'No students match your search.' : 'No students enrolled yet.'}
            </div>
          ) : columns.length === 0 ? (
            <div className="gb-card3d" style={{
              background: '#fff', borderRadius: 20, padding: '40px 14px', textAlign: 'center',
              color: '#5070B0', fontSize: 12,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
            }}>
              No units yet — tap <strong style={{ color: '#0055FF' }}>+ Unit</strong> above to add one.
            </div>
          ) : filtered.map(stu => {
            const key = (stu.email || stu.id).toLowerCase();
            const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${key}_${c.id}`]) || 0), 0);
            const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
            const grd = letterGrade(pct);
            const bnd = band(pct);
            const avBg = avatarBg(stu.name || '');

            const totalToneColor = grd.tone === 'a' ? '#00C853' : grd.tone === 'b' ? '#0055FF' : grd.tone === 'c' ? '#FFAA00' : grd.tone === 'd' ? '#FF8800' : '#FF3355';

            return (
              <div
                key={stu.email || stu.id}
                className="gb-card3d"
                style={{
                  background: '#fff', borderRadius: 20, padding: 16, marginBottom: 12,
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
                }}
              >
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: totalToneColor }} />

                {/* Head — clickable: opens Students page */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`View ${stu.name}`}
                  onClick={() => navigate('/students')}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/students'); } }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, cursor: 'pointer' }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 13,
                    background: avBg, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, letterSpacing: '0.3px', flexShrink: 0,
                  }}>
                    {getInitials(stu.name || '')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.35px', lineHeight: 1.2 }}>{stu.name}</div>
                    <div style={{ fontSize: 11, color: '#5070B0', marginTop: 3, fontWeight: 500, letterSpacing: '-0.1px', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {stu.rollNo && (
                        <span style={{ background: '#F4F7FE', color: '#002080', padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>Roll {stu.rollNo}</span>
                      )}
                      {stu.rollNo && <span style={{ color: '#99AACC' }}>·</span>}
                      <span>{bnd.label}</span>
                    </div>
                  </div>
                  <div style={{
                    width: 48, height: 48, borderRadius: 15,
                    background: grd.color, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24, fontWeight: 700, letterSpacing: '-0.8px', flexShrink: 0,
                    boxShadow: `0 1px 2px ${grd.color}40, 0 6px 14px ${grd.color}55`,
                    position: 'relative',
                  }}>
                    <span style={{ position: 'absolute', inset: 0, borderRadius: 15, background: 'linear-gradient(145deg, rgba(255,255,255,.25), transparent 50%)', pointerEvents: 'none' }} />
                    {grd.label}
                  </div>
                </div>

                {/* Unit rows */}
                <div style={{ background: '#F4F7FE', borderRadius: 14, padding: 1, marginBottom: 12 }}>
                  {columns.map((col, idx) => {
                    const scoreKey = `${key}_${col.id}`;
                    const val = localScores[scoreKey];
                    return (
                      <div
                        key={col.id}
                        style={{
                          display: 'flex', alignItems: 'center', padding: '11px 12px', gap: 11,
                          background: '#fff', borderRadius: 13,
                          marginTop: idx > 0 ? 1 : 0,
                          borderTop: idx > 0 ? '0.5px solid rgba(9,87,247,.07)' : 'none',
                          position: 'relative',
                        }}
                      >
                        <div
                          onClick={() => { setSelectedColForEdit(col); setView('enter-scores'); }}
                          role="button"
                          tabIndex={0}
                          className="gb-press"
                          style={{
                            width: 28, height: 28, borderRadius: 9,
                            background: 'rgba(9,87,247,.1)', color: '#0055FF',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, fontSize: 11, fontWeight: 700, letterSpacing: '-0.2px',
                            cursor: 'pointer',
                          }}
                          aria-label={`Edit ${col.name} scores`}
                        >
                          {col.name.startsWith('Unit ') ? `U${col.name.replace(/\D/g, '') || idx + 1}` : col.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div
                          onClick={() => { setSelectedColForEdit(col); setView('enter-scores'); }}
                          style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#002080', letterSpacing: '-0.15px', cursor: 'pointer' }}
                        >
                          {col.name}
                        </div>
                        <input
                          type="number"
                          value={val ?? ''}
                          min={0}
                          max={col.maxMarks}
                          onChange={e => setLocalScores(p => ({ ...p, [scoreKey]: e.target.value }))}
                          placeholder="—"
                          className="gb-score-input"
                          style={{
                            background: '#F4F7FE',
                            border: '0.5px solid rgba(9,87,247,.1)',
                            borderRadius: 10,
                            padding: '7px 12px', width: 68,
                            textAlign: 'center',
                            fontSize: 13, fontWeight: 700, color: '#001040',
                            fontFamily: 'inherit', letterSpacing: '-0.2px', outline: 'none',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Total */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: 'linear-gradient(90deg, rgba(9,87,247,.06), rgba(9,87,247,.03))',
                  borderRadius: 12,
                  border: '0.5px solid rgba(9,87,247,.12)',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#0055FF' }} />
                    Total Score
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.8px', lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 3, color: totalToneColor }}>
                    {earned}
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#99AACC', letterSpacing: '-0.2px' }}>/ {totalMax}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Class Avg Card */}
          {!loading && filtered.length > 0 && columns.length > 0 && (
            <div
              className="gb-card3d"
              role="button"
              tabIndex={0}
              aria-label="Open detailed class report"
              onClick={() => navigate('/reports')}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
              style={{
                background: '#fff', borderRadius: 20, padding: 16, marginBottom: 14,
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
                border: '0.5px solid rgba(9,87,247,.1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 13, background: '#0055FF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.35px' }}>Class Average</div>
                  <div style={{ fontSize: 11, color: '#5070B0', fontWeight: 600, marginTop: 2, letterSpacing: '-0.1px' }}>Based on {filtered.length} students</div>
                </div>
                <div style={{
                  width: 44, height: 44, borderRadius: 14,
                  background: avgLetter.color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, fontWeight: 700,
                  boxShadow: `0 1px 2px ${avgLetter.color}40, 0 6px 14px ${avgLetter.color}55`,
                  position: 'relative',
                }}>
                  <span style={{ position: 'absolute', inset: 0, borderRadius: 14, background: 'linear-gradient(145deg, rgba(255,255,255,.25), transparent 50%)' }} />
                  {avgLetter.label}
                </div>
              </div>

              <div style={{ background: '#F4F7FE', borderRadius: 14, padding: 1, marginBottom: 12 }}>
                {columns.map((col, idx) => (
                  <div key={col.id} style={{
                    display: 'flex', alignItems: 'center', padding: '11px 12px', gap: 11,
                    background: '#fff', borderRadius: 13,
                    marginTop: idx > 0 ? 1 : 0,
                    borderTop: idx > 0 ? '0.5px solid rgba(9,87,247,.07)' : 'none',
                  }}>
                    <div style={{ width: 28, height: 28, borderRadius: 9, background: 'rgba(9,87,247,.1)', color: '#0055FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                      {col.name.startsWith('Unit ') ? `U${col.name.replace(/\D/g, '') || idx + 1}` : col.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#002080', letterSpacing: '-0.15px' }}>{col.name} avg</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#FF8800', letterSpacing: '-0.2px', padding: '7px 12px' }}>
                      {colAvgs[idx] > 0 ? colAvgs[idx].toFixed(1) : '—'}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px',
                background: 'linear-gradient(90deg, rgba(9,87,247,.06), rgba(9,87,247,.03))',
                borderRadius: 12,
                border: '0.5px solid rgba(9,87,247,.12)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#0055FF' }} />
                  Overall Avg
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.8px', lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 3, color: classAvgPct >= 70 ? '#00C853' : classAvgPct >= 50 ? '#FF8800' : '#FF3355' }}>
                  {classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'}
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#99AACC', letterSpacing: '-0.2px' }}>/ 100</span>
                </div>
              </div>
            </div>
          )}

          {/* AI Intelligence */}
          {!loading && filtered.length > 0 && columns.length > 0 && (
            <div
              className="gb-card3d"
              role="button"
              tabIndex={0}
              aria-label="Open detailed insights"
              onClick={() => navigate('/reports')}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
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
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.95)', letterSpacing: '1.8px', textTransform: 'uppercase' }}>AI Gradebook Intelligence</div>
                <div style={{ marginLeft: 'auto', background: 'rgba(123,63,244,.3)', border: '0.5px solid rgba(155,95,255,.5)', color: '#DCC8FF', padding: '4px 10px', borderRadius: 100, fontSize: 9, fontWeight: 700, letterSpacing: '0.5px' }}>Insight</div>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,.85)', letterSpacing: '-0.15px', marginBottom: 14, position: 'relative', zIndex: 2 }}>
                Class average is <strong style={{ color: '#fff', fontWeight: 700 }}>{classAvgPct.toFixed(1)}%</strong> — in the <strong style={{ color: '#fff', fontWeight: 700 }}>{avgBand.label}</strong> band.
                {atRiskCount > 0
                  ? ` ${atRiskCount} student${atRiskCount === 1 ? '' : 's'} scored below 50 — schedule a `
                  : ' All students are on track — consider '}
                <strong style={{ color: '#fff', fontWeight: 700 }}>{atRiskCount > 0 ? 'remediation session' : 'enrichment activities'}</strong> before the next unit.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', background: 'rgba(255,255,255,.1)', borderRadius: 12, padding: 1, gap: 1, overflow: 'hidden', position: 'relative', zIndex: 2 }}>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '11px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#FF9AA9', letterSpacing: '-0.4px' }}>{lowest}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>Lowest</div>
                </div>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '11px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.4px' }}>{classAvgPct.toFixed(1)}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>Avg</div>
                </div>
                <div style={{ background: 'rgba(0,20,80,.55)', padding: '11px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#6FFFAA', letterSpacing: '-0.4px' }}>{highest}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>Highest</div>
                </div>
              </div>
            </div>
          )}

          <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" />

        </div>
      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div
        className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8"
        style={{ background: '#EEF4FF', minHeight: '100vh', fontVariantNumeric: 'tabular-nums' }}
      >
        <style>{`
          .gbd-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
          @media (hover:hover) { .gbd-card3d:hover { transform: translateY(-4px) scale(1.008); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); } }
          .gbd-card3d:active { transform: translateY(-1px) scale(.99); }
          .gbd-press { transition: all 0.3s ease; }
          .gbd-press:hover { transform: translateY(-1px); filter: brightness(1.05); }
          .gbd-press:active { transform: scale(.96); }
          .gbd-score-input { transition: all 0.3s ease; }
          .gbd-score-input:focus { background: #fff !important; border-color: #0055FF !important; box-shadow: 0 0 0 3px rgba(9,87,247,.14) !important; }
          .gbd-scroll::-webkit-scrollbar { display: none; }
          .gbd-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '32px 32px 48px' }}>

          {/* Header row: title + class picker */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: 2, background: '#0055FF', display: 'inline-block' }} />
                Teacher Dashboard · Gradebook
              </div>
              <h1 style={{ fontSize: 40, fontWeight: 700, color: '#001040', letterSpacing: '-1.4px', lineHeight: 1.05, margin: 0 }}>Gradebook</h1>
              <div style={{ fontSize: 14, color: '#5070B0', fontWeight: 500, marginTop: 8, letterSpacing: '-0.15px' }}>
                {selectedClass ? `Complete academic record for ${selectedClass.name}.` : 'Select a class to view gradebook.'}
              </div>
            </div>

            {/* Class picker */}
            <div style={{ position: 'relative', minWidth: 280 }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 18px', background: '#fff',
                  borderRadius: 14,
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 13, background: '#7B3FF4', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.3px', textTransform: 'uppercase', marginBottom: 2 }}>Viewing</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedClass ? selectedClass.name : (classes.length === 0 ? 'No classes' : 'Select class')}
                  </div>
                </div>
                <div style={{ color: '#99AACC', fontSize: 24, fontWeight: 400, lineHeight: 1, marginTop: -3 }}>›</div>
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
                {classes.length === 0 && <option value="">No classes available</option>}
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* HERO — Class Average */}
          <div
            className="gbd-card3d"
            role="button"
            tabIndex={0}
            aria-label="Open class report"
            onClick={() => navigate('/reports')}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
            style={{
              background: 'linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)',
              borderRadius: 28, padding: 32, marginBottom: 18,
              position: 'relative', overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(0,8,60,.15), 0 12px 32px rgba(0,8,60,.28)',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', zIndex: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <div style={{ width: 52, height: 52, borderRadius: 15, background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '0.5px solid rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.72)', letterSpacing: '1.8px', textTransform: 'uppercase' }}>Class Average</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 3, fontWeight: 500, letterSpacing: '-0.1px' }}>
                    {columns.length > 0 ? `${columns.length} ${columns.length === 1 ? 'unit' : 'units'} · ${selectedClass?.name || ''}` : 'No units yet'}
                  </div>
                </div>
                <div style={{
                  marginLeft: 'auto', width: 56, height: 56,
                  background: `linear-gradient(145deg, ${avgLetter.color}, ${avgLetter.color}DD)`,
                  color: '#fff', borderRadius: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, fontWeight: 700, letterSpacing: '-0.6px',
                  boxShadow: `0 1px 2px ${avgLetter.color}55, 0 8px 18px ${avgLetter.color}55, inset 0 1px 0 rgba(255,255,255,.25)`,
                }}>
                  {avgLetter.label}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 84, fontWeight: 700, color: '#fff', letterSpacing: '-3.8px', lineHeight: 1, marginBottom: 10, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    {classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'}
                    <span style={{ fontSize: 32, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '-0.6px' }}>/ 100</span>
                  </div>
                  <div style={{ fontSize: 14, color: 'rgba(255,255,255,.72)', fontWeight: 500, letterSpacing: '-0.15px' }}>
                    <b style={{ color: '#fff', fontWeight: 700 }}>{avgBand.label} performance</b>
                    {atRiskCount > 0 ? ` — ${atRiskCount} student${atRiskCount === 1 ? '' : 's'} need${atRiskCount === 1 ? 's' : ''} remediation.` : ' — all students on track.'}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'rgba(255,255,255,.1)', borderRadius: 14, padding: 1, overflow: 'hidden', minWidth: 380 }}>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: '-0.8px' }}>{filtered.length}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Students</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: '#6FFFAA', letterSpacing: '-0.8px' }}>{passingCount}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Passing</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: '#FF9AA9', letterSpacing: '-0.8px' }}>{atRiskCount}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.58)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>At Risk</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Legend + toolbar row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="gbd-scroll" style={{ flex: 1, minWidth: 280, display: 'flex', gap: 8, padding: '12px 14px', background: '#fff', borderRadius: 14, overflowX: 'auto', boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)' }}>
              {[
                { c: '#00C853', l: 'Excellent 90+' },
                { c: '#0055FF', l: 'Good 70–89' },
                { c: '#FF8800', l: 'Average 50–69' },
                { c: '#FF3355', l: 'At Risk <50' },
              ].map(item => (
                <div key={item.l} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#F4F7FE', borderRadius: 100, fontSize: 11, fontWeight: 700, color: '#002080', letterSpacing: '-0.1px', flexShrink: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.c }} />
                  {item.l}
                </div>
              ))}
            </div>
            <button
              type="button"
              aria-label="Export gradebook to Excel"
              onClick={handleExport}
              className="gbd-press"
              style={{ width: 44, height: 44, borderRadius: 12, background: '#fff', color: '#0055FF', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0.5px 1px rgba(9,87,247,.06), 0 2px 8px rgba(9,87,247,.08)' }}
            >
              <IcoDownload />
            </button>
            <button
              type="button"
              onClick={() => setShowAddCol(v => !v)}
              aria-expanded={showAddCol}
              className="gbd-press"
              style={{
                height: 44, padding: '0 18px', borderRadius: 12, background: '#0055FF',
                color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px',
                display: 'flex', alignItems: 'center', gap: 7, border: 'none',
                boxShadow: '0 1px 2px rgba(9,87,247,.2), 0 3px 8px rgba(9,87,247,.25)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Unit
            </button>
          </div>

          {/* Section head: title + search + save */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#001040', letterSpacing: '-0.4px' }}>Student Grades</span>
              <span style={{ fontSize: 13, color: '#5070B0', fontWeight: 600, letterSpacing: '-0.1px' }}>
                {filtered.length} student{filtered.length === 1 ? '' : 's'} · {columns.length} unit{columns.length === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ position: 'relative', width: 300 }}>
                <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#5070B0', pointerEvents: 'none' }}>
                  <IcoSearch />
                </div>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search student..."
                  style={{
                    width: '100%', padding: '11px 14px 11px 36px', borderRadius: 12,
                    border: 'none', background: '#fff',
                    fontSize: 13, color: '#001040', fontFamily: 'inherit', outline: 'none',
                    boxShadow: '0 0 0 0.5px rgba(0,85,255,.09), 0 2px 10px rgba(0,85,255,.10), 0 10px 26px rgba(0,85,255,.12)',
                  }}
                />
              </div>
              <button
                type="button"
                aria-label={saving ? 'Saving grades' : 'Save grades'}
                onClick={handleSave}
                disabled={saving || !hasUnsaved}
                className="gbd-press"
                style={{
                  padding: '11px 18px', borderRadius: 12,
                  background: hasUnsaved ? '#00C853' : '#EAF0FB',
                  border: 'none',
                  color: hasUnsaved ? '#fff' : '#5070B0',
                  fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px',
                  cursor: hasUnsaved && !saving ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                  opacity: saving ? 0.7 : 1,
                  boxShadow: hasUnsaved ? '0 1px 2px rgba(0,200,83,.2), 0 3px 8px rgba(0,200,83,.25)' : 'none',
                }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <IcoCheck />}
                Save
              </button>
            </div>
          </div>

          {/* Add column panel */}
          {showAddCol && (
            <div style={{
              background: '#fff',
              borderRadius: 18, padding: 20,
              display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
              border: '0.5px solid rgba(9,87,247,.1)',
              flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5070B0', letterSpacing: '1.3px', textTransform: 'uppercase', flexShrink: 0 }}>
                Add unit
              </div>
              <input
                type="text"
                value={newColName}
                onChange={e => setNewColName(e.target.value)}
                placeholder="Unit name (e.g. Unit 1, Quiz 1)"
                onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
                style={{
                  flex: 1, minWidth: 240, padding: '11px 14px', borderRadius: 11,
                  border: '0.5px solid rgba(9,87,247,.15)', background: '#F4F7FE',
                  fontSize: 14, color: '#001040', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <input
                type="number"
                value={newColMax}
                onChange={e => setNewColMax(e.target.value)}
                style={{
                  width: 110, padding: '11px 14px', borderRadius: 11,
                  border: '0.5px solid rgba(9,87,247,.15)', background: '#F4F7FE',
                  fontSize: 14, color: '#001040', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <span style={{ fontSize: 12, color: '#5070B0', fontWeight: 600 }}>max marks</span>
              <button
                type="button"
                onClick={handleAddColumn}
                className="gbd-press"
                style={{
                  padding: '11px 20px', borderRadius: 11, background: '#0055FF', border: 'none',
                  color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 1px 2px rgba(9,87,247,.2), 0 3px 8px rgba(9,87,247,.25)',
                }}
              >
                Add unit
              </button>
              <button
                type="button"
                onClick={() => { setShowAddCol(false); setNewColName(''); setNewColMax('100'); }}
                className="gbd-press"
                style={{
                  padding: '11px 18px', borderRadius: 11, background: '#F4F7FE',
                  border: 'none', color: '#5070B0',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Loading / empty / student cards */}
          {loading ? (
            <div className="gbd-card3d" style={{
              background: '#fff', borderRadius: 22, padding: '60px 24px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
            }}>
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#5070B0' }} />
              <span style={{ fontSize: 13, color: '#5070B0' }}>Loading gradebook...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="gbd-card3d" style={{
              background: '#fff', borderRadius: 22, padding: '60px 24px', textAlign: 'center',
              color: '#5070B0', fontSize: 14,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
            }}>
              {search ? 'No students match your search.' : 'No students enrolled yet.'}
            </div>
          ) : columns.length === 0 ? (
            <div className="gbd-card3d" style={{
              background: '#fff', borderRadius: 22, padding: '60px 24px', textAlign: 'center',
              color: '#5070B0', fontSize: 14,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
            }}>
              No units yet — click <strong style={{ color: '#0055FF' }}>+ Add Unit</strong> above to add one.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 18 }}>
              {filtered.map(stu => {
                const key = (stu.email || stu.id).toLowerCase();
                const earned = columns.reduce((acc, c) => acc + (Number(localScores[`${key}_${c.id}`]) || 0), 0);
                const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
                const grd = letterGrade(pct);
                const bnd = band(pct);
                const avBg = avatarBg(stu.name || '');

                const totalToneColor = grd.tone === 'a' ? '#00C853' : grd.tone === 'b' ? '#0055FF' : grd.tone === 'c' ? '#FFAA00' : grd.tone === 'd' ? '#FF8800' : '#FF3355';

                return (
                  <div
                    key={stu.email || stu.id}
                    className="gbd-card3d"
                    style={{
                      background: '#fff', borderRadius: 22, padding: 22,
                      position: 'relative', overflow: 'hidden',
                      boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
                    }}
                  >
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: totalToneColor }} />

                    {/* Head — clickable: opens Students page */}
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`View ${stu.name}`}
                      onClick={() => navigate('/students')}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/students'); } }}
                      style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, cursor: 'pointer' }}>
                      <div style={{
                        width: 50, height: 50, borderRadius: 15,
                        background: avBg, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700, letterSpacing: '0.3px', flexShrink: 0,
                      }}>
                        {getInitials(stu.name || '')}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: '#001040', letterSpacing: '-0.4px', lineHeight: 1.2 }}>{stu.name}</div>
                        <div style={{ fontSize: 12, color: '#5070B0', marginTop: 4, fontWeight: 500, letterSpacing: '-0.1px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {stu.rollNo && (
                            <span style={{ background: '#F4F7FE', color: '#002080', padding: '3px 9px', borderRadius: 7, fontSize: 11, fontWeight: 700 }}>Roll {stu.rollNo}</span>
                          )}
                          {stu.rollNo && <span style={{ color: '#99AACC' }}>·</span>}
                          <span>{bnd.label}</span>
                        </div>
                      </div>
                      <div style={{
                        width: 56, height: 56, borderRadius: 17,
                        background: grd.color, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 28, fontWeight: 700, letterSpacing: '-0.9px', flexShrink: 0,
                        boxShadow: `0 1px 2px ${grd.color}40, 0 8px 18px ${grd.color}55`,
                        position: 'relative',
                      }}>
                        <span style={{ position: 'absolute', inset: 0, borderRadius: 17, background: 'linear-gradient(145deg, rgba(255,255,255,.25), transparent 50%)', pointerEvents: 'none' }} />
                        {grd.label}
                      </div>
                    </div>

                    {/* Unit rows */}
                    <div style={{ background: '#F4F7FE', borderRadius: 15, padding: 1, marginBottom: 14 }}>
                      {columns.map((col, idx) => {
                        const scoreKey = `${key}_${col.id}`;
                        const val = localScores[scoreKey];
                        return (
                          <div
                            key={col.id}
                            style={{
                              display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 12,
                              background: '#fff', borderRadius: 14,
                              marginTop: idx > 0 ? 1 : 0,
                              borderTop: idx > 0 ? '0.5px solid rgba(9,87,247,.07)' : 'none',
                              position: 'relative',
                            }}
                          >
                            <div
                              onClick={() => { setSelectedColForEdit(col); setView('enter-scores'); }}
                              role="button"
                              tabIndex={0}
                              className="gbd-press"
                              style={{
                                width: 32, height: 32, borderRadius: 10,
                                background: 'rgba(9,87,247,.1)', color: '#0055FF',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0, fontSize: 12, fontWeight: 700, letterSpacing: '-0.2px',
                                cursor: 'pointer',
                              }}
                              aria-label={`Edit ${col.name} scores`}
                            >
                              {col.name.startsWith('Unit ') ? `U${col.name.replace(/\D/g, '') || idx + 1}` : col.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div
                              onClick={() => { setSelectedColForEdit(col); setView('enter-scores'); }}
                              style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#002080', letterSpacing: '-0.15px', cursor: 'pointer' }}
                            >
                              {col.name}
                            </div>
                            <input
                              type="number"
                              value={val ?? ''}
                              min={0}
                              max={col.maxMarks}
                              onChange={e => setLocalScores(p => ({ ...p, [scoreKey]: e.target.value }))}
                              placeholder="—"
                              className="gbd-score-input"
                              style={{
                                background: '#F4F7FE',
                                border: '0.5px solid rgba(9,87,247,.1)',
                                borderRadius: 11,
                                padding: '8px 14px', width: 80,
                                textAlign: 'center',
                                fontSize: 14, fontWeight: 700, color: '#001040',
                                fontFamily: 'inherit', letterSpacing: '-0.2px', outline: 'none',
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* Total */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 14px',
                      background: 'linear-gradient(90deg, rgba(9,87,247,.06), rgba(9,87,247,.03))',
                      borderRadius: 13,
                      border: '0.5px solid rgba(9,87,247,.12)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#5070B0', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0055FF' }} />
                        Total Score
                      </div>
                      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.9px', lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 4, color: totalToneColor }}>
                        {earned}
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#99AACC', letterSpacing: '-0.2px' }}>/ {totalMax}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 2-column: Class Avg + AI Intelligence */}
          {!loading && filtered.length > 0 && columns.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>

              {/* Class Avg Card */}
              <div
                className="gbd-card3d"
                role="button"
                tabIndex={0}
                aria-label="Open detailed class report"
                onClick={() => navigate('/reports')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
                style={{
                  background: '#fff', borderRadius: 22, padding: 22,
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
                  border: '0.5px solid rgba(9,87,247,.1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: '#0055FF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#001040', letterSpacing: '-0.4px' }}>Class Average</div>
                    <div style={{ fontSize: 12, color: '#5070B0', fontWeight: 600, marginTop: 3, letterSpacing: '-0.1px' }}>Based on {filtered.length} students</div>
                  </div>
                  <div style={{
                    width: 52, height: 52, borderRadius: 16,
                    background: avgLetter.color, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26, fontWeight: 700,
                    boxShadow: `0 1px 2px ${avgLetter.color}40, 0 8px 18px ${avgLetter.color}55`,
                    position: 'relative',
                  }}>
                    <span style={{ position: 'absolute', inset: 0, borderRadius: 16, background: 'linear-gradient(145deg, rgba(255,255,255,.25), transparent 50%)' }} />
                    {avgLetter.label}
                  </div>
                </div>

                <div style={{ background: '#F4F7FE', borderRadius: 15, padding: 1, marginBottom: 14 }}>
                  {columns.map((col, idx) => (
                    <div key={col.id} style={{
                      display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 12,
                      background: '#fff', borderRadius: 14,
                      marginTop: idx > 0 ? 1 : 0,
                      borderTop: idx > 0 ? '0.5px solid rgba(9,87,247,.07)' : 'none',
                    }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(9,87,247,.1)', color: '#0055FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                        {col.name.startsWith('Unit ') ? `U${col.name.replace(/\D/g, '') || idx + 1}` : col.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#002080', letterSpacing: '-0.15px' }}>{col.name} avg</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#FF8800', letterSpacing: '-0.2px', padding: '8px 14px' }}>
                        {colAvgs[idx] > 0 ? colAvgs[idx].toFixed(1) : '—'}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px',
                  background: 'linear-gradient(90deg, rgba(9,87,247,.06), rgba(9,87,247,.03))',
                  borderRadius: 13,
                  border: '0.5px solid rgba(9,87,247,.12)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#5070B0', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0055FF' }} />
                    Overall Avg
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.9px', lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 4, color: classAvgPct >= 70 ? '#00C853' : classAvgPct >= 50 ? '#FF8800' : '#FF3355' }}>
                    {classAvgPct > 0 ? classAvgPct.toFixed(1) : '0.0'}
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#99AACC', letterSpacing: '-0.2px' }}>/ 100</span>
                  </div>
                </div>
              </div>

              {/* AI Intelligence */}
              <div
                className="gbd-card3d"
                role="button"
                tabIndex={0}
                aria-label="Open detailed insights"
                onClick={() => navigate('/reports')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/reports'); } }}
                style={{
                  background: 'linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)',
                  borderRadius: 26, padding: 28,
                  position: 'relative', overflow: 'hidden',
                  boxShadow: '0 1px 2px rgba(0,8,60,.18), 0 12px 32px rgba(0,8,60,.3)',
                }}
              >
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)', pointerEvents: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, position: 'relative', zIndex: 2 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '0.5px solid rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFDD55', fontSize: 22 }}>⚡</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.95)', letterSpacing: '1.9px', textTransform: 'uppercase' }}>AI Gradebook Intelligence</div>
                  <div style={{ marginLeft: 'auto', background: 'rgba(123,63,244,.3)', border: '0.5px solid rgba(155,95,255,.5)', color: '#DCC8FF', padding: '5px 11px', borderRadius: 100, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px' }}>Insight</div>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,.85)', letterSpacing: '-0.15px', marginBottom: 20, position: 'relative', zIndex: 2 }}>
                  Class average is <strong style={{ color: '#fff', fontWeight: 700 }}>{classAvgPct.toFixed(1)}%</strong> — in the <strong style={{ color: '#fff', fontWeight: 700 }}>{avgBand.label}</strong> band.
                  {atRiskCount > 0
                    ? ` ${atRiskCount} student${atRiskCount === 1 ? '' : 's'} scored below 50 — schedule a `
                    : ' All students are on track — consider '}
                  <strong style={{ color: '#fff', fontWeight: 700 }}>{atRiskCount > 0 ? 'remediation session' : 'enrichment activities'}</strong> before the next unit.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', background: 'rgba(255,255,255,.1)', borderRadius: 14, padding: 1, gap: 1, overflow: 'hidden', position: 'relative', zIndex: 2 }}>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#FF9AA9', letterSpacing: '-0.6px' }}>{lowest}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Lowest</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.6px' }}>{classAvgPct.toFixed(1)}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Avg</div>
                  </div>
                  <div style={{ background: 'rgba(0,20,80,.55)', padding: '16px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#6FFFAA', letterSpacing: '-0.6px' }}>{highest}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>Highest</div>
                  </div>
                </div>
              </div>

            </div>
          )}

          <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" />

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
}
