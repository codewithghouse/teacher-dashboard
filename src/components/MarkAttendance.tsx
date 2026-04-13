import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { db } from "../lib/firebase";
import {
  collection, query, getDocs, where,
  serverTimestamp, setDoc, doc, onSnapshot, limit
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF',
  green: '#087F5B', green2: '#2F9E44', greenL: '#EBFBEE',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toLocaleDateString("en-CA");
const ITEMS_PER_PAGE = 8;

const getInitials = (name = "") => {
  const p = name.trim().split(" ");
  return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
};

const AV_BG = ['#E3FAFC','#EBFBEE','#FFF9DB','#EDF2FF','#F3F0FF','#FFF5F5'];
const AV_FG = ['#0C8599','#087F5B','#C87014','#3B5BDB','#6741D9','#C92A2A'];
const avStyle = (name = "") => {
  const i = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_BG.length;
  return { bg: AV_BG[i], color: AV_FG[i] };
};

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const IcoCheck = ({ color = '#fff', size = 12 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,6.5 4.5,10 10.5,2.5"/>
  </svg>
);
const IcoX = ({ color = '#fff', size = 12 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="3" x2="9" y2="9"/><line x1="9" y1="3" x2="3" y2="9"/>
  </svg>
);
const IcoClock = ({ color = '#fff', size = 12 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="4.5"/><polyline points="6,3.5 6,6 8.5,6"/>
  </svg>
);
const IcoBack = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={T.blue} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9,2 4,7 9,12"/>
  </svg>
);
const IcoMarkAll = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,6.5 4.5,10 10.5,2.5"/>
  </svg>
);
const IcoCopy = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="1.5" width="7" height="9" rx="1.2"/>
    <rect x="3.5" y="3.5" width="7" height="9" rx="1.2"/>
  </svg>
);
const IcoChevLeft = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink1} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="8,2 4,6 8,10"/>
  </svg>
);
const IcoChevRight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink1} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4,2 8,6 4,10"/>
  </svg>
);

// ── Badge ─────────────────────────────────────────────────────────────────────
const Badge = ({ text, bg, color }: { text: string; bg: string; color: string }) => (
  <span style={{ background: bg, color, borderRadius: 20, padding: '3px 8px', fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap' as const }}>
    {text}
  </span>
);

// ── Types ─────────────────────────────────────────────────────────────────────
interface Student {
  id: string; enrollId: string; name: string; email: string;
  rollNo: string | number;
  status: "present" | "absent" | "late" | "none";
  note: string; initials: string; av: { bg: string; color: string };
}
interface Props { onBack: () => void; initialClassId?: string; }

// ── Component ─────────────────────────────────────────────────────────────────
const MarkAttendance = ({ onBack, initialClassId }: Props) => {
  const { teacherData } = useAuth();

  const [classes, setClasses]               = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(initialClassId || "");
  const [students, setStudents]             = useState<Student[]>([]);
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [currentPage, setCurrentPage]       = useState(1);

  // Fetch classes
  useEffect(() => {
    if (!teacherData?.id) return;
    const SC: any[] = [];
    if (teacherData.schoolId) SC.push(where("schoolId", "==", teacherData.schoolId));
    if (teacherData.branchId) SC.push(where("branchId", "==", teacherData.branchId));
    return onSnapshot(
      query(collection(db, "classes"), where("teacherId", "==", teacherData.id), ...SC),
      (snap) => {
        const cls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setClasses(cls);
        if (!selectedClassId && cls.length > 0) setSelectedClassId(cls[0].id);
      }
    );
  }, [teacherData?.id]);

  // Fetch roster + today's attendance
  useEffect(() => {
    if (!selectedClassId || !teacherData?.id) return;
    setLoading(true); setCurrentPage(1);
    const SC: any[] = [];
    if (teacherData.schoolId) SC.push(where("schoolId", "==", teacherData.schoolId));
    if (teacherData.branchId) SC.push(where("branchId", "==", teacherData.branchId));

    return onSnapshot(
      query(collection(db, "enrollments"), where("classId", "==", selectedClassId), ...SC),
      async (snap) => {
        try {
          const logsSnap = await getDocs(
            query(collection(db, "attendance"), where("classId", "==", selectedClassId), where("date", "==", todayStr()), ...SC)
          );
          const logs = logsSnap.docs.map(d => d.data());
          const roster: Student[] = snap.docs.map(d => {
            const data = d.data() as any;
            const sId = data.studentId || d.id;
            const log = logs.find(l => l.studentId === sId);
            return {
              id: sId, enrollId: d.id,
              name: data.studentName || "Student",
              email: data.studentEmail || "",
              rollNo: data.rollNo || "—",
              status: (log?.status as any) || "none",
              note: log?.note || "",
              initials: getInitials(data.studentName),
              av: avStyle(data.studentName),
            };
          });
          roster.sort((a, b) => a.name.localeCompare(b.name));
          setStudents(roster);
        } catch (e) { console.error("Roster fetch error:", e); }
        finally { setLoading(false); }
      }
    );
  }, [selectedClassId, teacherData?.id]);

  // Live counts
  const counts = {
    present:  students.filter(s => s.status === "present").length,
    absent:   students.filter(s => s.status === "absent").length,
    late:     students.filter(s => s.status === "late").length,
    unmarked: students.filter(s => s.status === "none").length,
  };

  // Actions
  const setStatus = (id: string, status: Student["status"]) =>
    setStudents(prev => prev.map(s => s.id === id ? { ...s, status } : s));
  const setNote = (id: string, note: string) =>
    setStudents(prev => prev.map(s => s.id === id ? { ...s, note } : s));

  const markAllPresent = () => {
    setStudents(prev => prev.map(s => ({ ...s, status: "present" })));
    toast.success("All students marked present!");
  };

  const copyFromYesterday = async () => {
    setLoading(true);
    try {
      const SC: any[] = [];
      if (teacherData.schoolId) SC.push(where("schoolId", "==", teacherData.schoolId));
      if (teacherData.branchId) SC.push(where("branchId", "==", teacherData.branchId));
      const snap = await getDocs(
        query(collection(db, "attendance"), where("classId", "==", selectedClassId), where("teacherId", "==", teacherData.id), limit(200), ...SC)
      );
      const today = todayStr();
      const prevLogs = snap.docs.map(d => d.data()).filter((l: any) => l.date !== today).sort((a: any, b: any) => b.date.localeCompare(a.date));
      if (!prevLogs.length) { toast.error("No previous attendance found."); setLoading(false); return; }
      const latestDate = prevLogs[0].date;
      const latestLogs = prevLogs.filter((l: any) => l.date === latestDate);
      setStudents(prev => prev.map(s => {
        const m = latestLogs.find((l: any) => l.studentId === s.id);
        return m ? { ...s, status: m.status as any, note: m.note || "" } : s;
      }));
      toast.success(`Copied from ${latestDate}`);
    } catch { toast.error("Failed to copy previous attendance."); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!students.length) return toast.error("No students in this class.");
    if (counts.unmarked > 0 && !window.confirm(`${counts.unmarked} students are unmarked. Save anyway?`)) return;
    setSaving(true);
    const today = todayStr();
    const selClass = classes.find(c => c.id === selectedClassId);
    try {
      const SC: any[] = [];
      if (teacherData.schoolId) SC.push(where("schoolId", "==", teacherData.schoolId));
      if (teacherData.branchId) SC.push(where("branchId", "==", teacherData.branchId));
      let assignmentId = "legacy";
      const aSnap = await getDocs(query(collection(db, "teaching_assignments"), where("teacherId", "==", teacherData.id), where("classId", "==", selectedClassId), ...SC));
      if (!aSnap.empty) {
        const activeDoc = aSnap.docs.find(d => { const s = d.data().status; return !s || s.toLowerCase() === "active"; });
        if (activeDoc) assignmentId = activeDoc.id;
      }
      const marked = students.filter(s => s.status !== "none");
      await Promise.all(
        marked.map(s =>
          setDoc(doc(db, "attendance", `${s.id}_${selectedClassId}_${today}`), {
            studentId: s.id, studentName: s.name, studentEmail: s.email,
            status: s.status, note: s.note || "", date: today,
            teacherId: teacherData.id, teacherName: teacherData.name || "",
            schoolId: teacherData.schoolId || "", branchId: teacherData.branchId || "",
            classId: selectedClassId, className: selClass?.name || "",
            assignmentId, timestamp: serverTimestamp(),
          })
        )
      );
      toast.success(`Attendance saved! ${marked.length} students recorded.`);
      onBack();
    } catch (e) { console.error(e); toast.error("Failed to save attendance. Please try again."); }
    finally { setSaving(false); }
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(students.length / ITEMS_PER_PAGE));
  const paginated  = students.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const goPage     = (p: number) => setCurrentPage(Math.max(1, Math.min(p, totalPages)));

  const selClass   = classes.find(c => c.id === selectedClassId);
  const dateLabel  = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const yearLabel  = new Date().getFullYear();

  return (
    <div style={{ fontFamily: 'inherit' }} className="text-left pb-8">

      {/* ── Dark Hero (back + save + class info) ─────────────────────────────── */}
      <div style={{ background: T.ink0 }} className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6 md:-mx-8 md:-mt-8 px-[22px] pb-7">

        {/* Nav row: Back | title | Save */}
        <div className="flex items-center justify-between pt-3 mb-5">
          <button onClick={onBack}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <IcoBack />
            <span style={{ fontSize: 13, color: T.blue }}>Back</span>
          </button>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.8)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            Mark attendance
          </p>
          <button onClick={handleSave} disabled={saving || loading}
            style={{
              padding: '8px 14px', borderRadius: 11, background: T.green2,
              border: 'none', color: '#fff', fontSize: 12, fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving || loading ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
            }}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <IcoCheck color="#fff" size={12} />}
            Save
          </button>
        </div>

        {/* Hero content */}
        <p style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
          {selClass?.name || "Class"} · Mark attendance
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', lineHeight: 1.15, marginBottom: 6 }}>
          {dateLabel.split(",")[0]},<br />{dateLabel.split(",").slice(1).join(",").trim()}
        </h1>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', fontWeight: 400 }}>
          {yearLabel} · {selClass?.subject || selClass?.name || "Class"}
        </p>
      </div>

      <div className="pt-4 space-y-3">

        {/* ── Quick Actions ──────────────────────────────────────────────────── */}
        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, padding: '13px 14px' }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: T.ink2, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 9 }}>
            Quick actions
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button onClick={markAllPresent}
              style={{
                padding: '10px 8px', borderRadius: 10, border: `1px solid ${T.bdr}`,
                background: T.s1, fontSize: 11, fontWeight: 500, color: T.ink1,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
              <IcoMarkAll /> Mark all present
            </button>
            <button onClick={copyFromYesterday}
              style={{
                padding: '10px 8px', borderRadius: 10, border: `1px solid ${T.bdr}`,
                background: T.s1, fontSize: 11, fontWeight: 500, color: T.ink1,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
              <IcoCopy /> Copy yesterday
            </button>
          </div>

          {/* Live summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 11, paddingTop: 11, borderTop: `1px solid ${T.s2}` }}>
            {[
              { dot: T.green2, label: 'Present', val: counts.present },
              { dot: T.red,    label: 'Absent',  val: counts.absent  },
              { dot: T.amber,  label: 'Late',     val: counts.late    },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: T.ink1 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: r.dot }} />
                {r.label}: <strong style={{ fontWeight: 500 }}>{r.val}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* ── Student Attendance Cards ───────────────────────────────────────── */}
        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.s2}` }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: T.ink0 }}>Student attendance</p>
            <p style={{ fontSize: 10, color: T.ink2, marginTop: 2 }}>
              {students.length} students · Tap to change status
            </p>
          </div>

          {loading ? (
            <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: T.blue }} />
            </div>
          ) : paginated.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: T.ink2 }}>
              No students enrolled in this class
            </div>
          ) : (
            paginated.map((student, idx) => {
              const statusBadge =
                student.status === "present" ? { text: "Present", bg: T.greenL, color: T.green } :
                student.status === "absent"  ? { text: "Absent",  bg: T.redL,   color: T.red   } :
                student.status === "late"    ? { text: "Late",    bg: T.amberL, color: T.amber } :
                                               { text: "—",       bg: T.s2,     color: T.ink2  };
              return (
                <div key={student.id} style={{ padding: 14, borderBottom: idx < paginated.length - 1 ? `1px solid ${T.s2}` : 'none' }}>
                  {/* Student header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: student.av.bg, color: student.av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
                      {student.initials}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 500, color: T.ink0 }}>{student.name}</p>
                      <p style={{ fontSize: 11, color: T.ink2, marginTop: 1 }}>Roll: {student.rollNo}</p>
                    </div>
                    <Badge text={statusBadge.text} bg={statusBadge.bg} color={statusBadge.color} />
                  </div>

                  {/* Toggle buttons */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 9 }}>
                    {([
                      { key: "present", label: "Present", Icon: IcoCheck, activeColor: T.green2 },
                      { key: "absent",  label: "Absent",  Icon: IcoX,     activeColor: T.red    },
                      { key: "late",    label: "Late",    Icon: IcoClock, activeColor: T.amber  },
                    ] as const).map(({ key, label, Icon, activeColor }) => {
                      const isOn = student.status === key;
                      return (
                        <button key={key}
                          onClick={() => setStatus(student.id, key)}
                          style={{
                            flex: 1, padding: '9px 6px', borderRadius: 10, fontSize: 12, fontWeight: 500,
                            border: `1px solid ${isOn ? activeColor : T.bdr}`,
                            background: isOn ? activeColor : T.s1,
                            color: isOn ? '#fff' : T.ink1,
                            cursor: 'pointer', fontFamily: 'inherit',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            transition: 'all 0.12s ease',
                          }}>
                          <Icon color={isOn ? '#fff' : T.ink2} size={11} />
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Note input */}
                  <input
                    type="text"
                    placeholder="Add note (optional)..."
                    value={student.note}
                    onChange={e => setNote(student.id, e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 9,
                      border: `1px solid ${T.bdr}`, background: T.s1,
                      fontSize: 11, color: T.ink2, fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                </div>
              );
            })
          )}

          {/* Pagination */}
          {!loading && students.length > ITEMS_PER_PAGE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderTop: `1px solid ${T.s2}`, background: T.s0 }}>
              <p style={{ fontSize: 11, color: T.ink2 }}>
                Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, students.length)}–{Math.min(currentPage * ITEMS_PER_PAGE, students.length)} of {students.length} students
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => goPage(currentPage - 1)} disabled={currentPage === 1}
                  style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.bdr}`, background: T.s0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: currentPage === 1 ? 0.4 : 1 }}>
                  <IcoChevLeft />
                </button>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: T.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: '#fff' }}>
                  {currentPage}
                </div>
                <button onClick={() => goPage(currentPage + 1)} disabled={currentPage === totalPages}
                  style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.bdr}`, background: T.s0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: currentPage === totalPages ? 0.4 : 1 }}>
                  <IcoChevRight />
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default MarkAttendance;