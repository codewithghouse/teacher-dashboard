import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { db } from "../lib/firebase";
import {
  collection, query, getDocs, where,
  serverTimestamp, doc, onSnapshot, limit,
  type QueryConstraint,
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { auditedSet } from "../lib/auditedWrites";
import { toast } from "sonner";

// ── Design tokens (desktop) ───────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF',
  green: '#087F5B', green2: '#2F9E44', greenL: '#EBFBEE',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── Mobile tokens (EduIntellect v2) ───────────────────────────────────────────
const MA = {
  FONT: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  CARD: "#FFFFFF",
  SURFACE: "#F4F7FE",
  P: "#0957F7",
  T1: "#001040", T3: "#5070B0", T4: "#99AACC",
  GREEN: "#00C853",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  VIOLET: "#7B3FF4",
  GOLD: "#FFAA00",
  SH: "0 0.5px 1px rgba(9,87,247,0.04), 0 4px 14px rgba(9,87,247,0.08)",
  SH_SM: "0 0.5px 1px rgba(9,87,247,0.04), 0 2px 10px rgba(9,87,247,0.06)",
  HEADER_GRAD: "linear-gradient(160deg, #000820 0%, #001466 55%, #0033CC 100%)",
};

const getSemesterLabel = () => {
  const month = new Date().getMonth();
  const year  = new Date().getFullYear();
  return `${month < 6 ? "Spring" : "Fall"} ${year}`;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toLocaleDateString("en-CA");
const ITEMS_PER_PAGE = 8;

const getInitials = (name = "") => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
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
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const SC: QueryConstraint[] = [where("schoolId", "==", teacherData.schoolId)];
    if (teacherData.branchId) SC.push(where("branchId", "==", teacherData.branchId));
    return onSnapshot(
      query(collection(db, "classes"), ...SC, where("teacherId", "==", teacherData.id)),
      (snap) => {
        const cls = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        setClasses(cls);
        // Functional setter reads latest state; avoids stale-closure bug.
        setSelectedClassId(prev => prev || cls[0]?.id || "");
      }
    );
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Fetch roster + today's attendance
  useEffect(() => {
    if (!selectedClassId || !teacherData?.id || !teacherData?.schoolId) return;
    setLoading(true); setCurrentPage(1);
    const SC: QueryConstraint[] = [where("schoolId", "==", teacherData.schoolId)];
    if (teacherData.branchId) SC.push(where("branchId", "==", teacherData.branchId));

    let ignore = false;
    const unsub = onSnapshot(
      query(collection(db, "enrollments"), ...SC, where("classId", "==", selectedClassId)),
      async (snap) => {
        try {
          const logsSnap = await getDocs(
            query(collection(db, "attendance"), ...SC, where("classId", "==", selectedClassId), where("date", "==", todayStr()))
          );
          if (ignore) return;
          const logs = logsSnap.docs.map(d => d.data());
          const roster: Student[] = snap.docs.map(d => {
            const data = d.data() as Record<string, unknown>;
            const sId = (data.studentId as string) || d.id;
            const log = logs.find(l => l.studentId === sId);
            const name = (data.studentName as string) || "Student";
            return {
              id: sId, enrollId: d.id,
              name,
              email: (data.studentEmail as string) || "",
              rollNo: (data.rollNo as string | number) || "—",
              status: (log?.status as Student["status"]) || "none",
              note: (log?.note as string) || "",
              initials: getInitials(name),
              av: avStyle(name),
            };
          });
          roster.sort((a, b) => a.name.localeCompare(b.name));
          setStudents(roster);
        } catch (e) { console.error("[MarkAttendance] roster fetch failed", e); }
        finally { if (!ignore) setLoading(false); }
      }
    );
    return () => { ignore = true; unsub(); };
  }, [selectedClassId, teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

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
    if (!teacherData.schoolId) return;
    setLoading(true);
    try {
      const SC: QueryConstraint[] = [where("schoolId", "==", teacherData.schoolId)];
      if (teacherData.branchId) SC.push(where("branchId", "==", teacherData.branchId));
      const snap = await getDocs(
        query(collection(db, "attendance"), ...SC, where("classId", "==", selectedClassId), where("teacherId", "==", teacherData.id), limit(200))
      );
      const today = todayStr();
      type AttLog = { studentId?: string; date?: string; status?: Student["status"]; note?: string };
      const prevLogs = (snap.docs.map(d => d.data()) as AttLog[])
        .filter(l => l.date && l.date !== today)
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      if (!prevLogs.length) { toast.error("No previous attendance found."); setLoading(false); return; }
      const latestDate = prevLogs[0].date!;
      const latestLogs = prevLogs.filter(l => l.date === latestDate);
      setStudents(prev => prev.map(s => {
        const m = latestLogs.find(l => l.studentId === s.id);
        return m && m.status ? { ...s, status: m.status, note: m.note || "" } : s;
      }));
      toast.success(`Copied from ${latestDate}`);
    } catch (e) { console.error("[MarkAttendance] copy failed", e); toast.error("Failed to copy previous attendance."); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!students.length) return toast.error("No students in this class.");
    if (counts.unmarked > 0 && !window.confirm(`${counts.unmarked} students are unmarked. Save anyway?`)) return;
    setSaving(true);
    const today = todayStr();
    const selClass = classes.find(c => c.id === selectedClassId);
    try {
      if (!teacherData.schoolId) return;
      const SC: QueryConstraint[] = [where("schoolId", "==", teacherData.schoolId)];
      if (teacherData.branchId) SC.push(where("branchId", "==", teacherData.branchId));
      let assignmentId = "legacy";
      const aSnap = await getDocs(query(collection(db, "teaching_assignments"), ...SC, where("teacherId", "==", teacherData.id), where("classId", "==", selectedClassId)));
      if (!aSnap.empty) {
        const activeDoc = aSnap.docs.find(d => {
          const s = (d.data() as { status?: unknown }).status;
          return !s || (typeof s === "string" && s.toLowerCase() === "active");
        });
        if (activeDoc) assignmentId = activeDoc.id;
      }
      const marked = students.filter(s => s.status !== "none");
      const results = await Promise.allSettled(
        marked.map(s =>
          auditedSet(doc(db, "attendance", `${s.id}_${selectedClassId}_${today}`), {
            studentId: s.id, studentName: s.name, studentEmail: s.email,
            status: s.status, note: s.note || "", date: today,
            teacherId: teacherData.id, teacherName: teacherData.name || "",
            schoolId: teacherData.schoolId || "", branchId: teacherData.branchId || "",
            classId: selectedClassId, className: (selClass as { name?: string } | undefined)?.name || "",
            assignmentId, timestamp: serverTimestamp(),
          })
        )
      );
      const failed = results
        .map((r, i) => ({ r, name: marked[i].name }))
        .filter(x => x.r.status === "rejected");
      if (failed.length > 0) {
        console.error("[MarkAttendance] partial save failure", failed);
        toast.error(`Saved ${marked.length - failed.length}/${marked.length}. Failed: ${failed.map(f => f.name).join(", ")}`);
        return;
      }
      toast.success(`Attendance saved! ${marked.length} students recorded.`);
      onBack();
    } catch (e) { console.error("[MarkAttendance] save failed", e); toast.error("Failed to save attendance. Please try again."); }
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

    {/* ═══════════════════ MOBILE VIEW (EduIntellect v2) ═══════════════════ */}
    <div className="md:hidden" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "-16px -16px 0" }}>

      {/* Dark gradient sticky header */}
      <div className="sticky top-0 z-20 px-[14px] pt-[10px] pb-[16px] relative"
        style={{ background: MA.HEADER_GRAD, borderRadius: "0 0 24px 24px", boxShadow: "0 8px 24px rgba(0,8,60,0.25)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 45%)", borderRadius: "0 0 24px 24px" }} />
        <div className="relative z-[2]">
          {/* Nav row */}
          <div className="flex items-center justify-between mb-[14px]">
            <button type="button" onClick={onBack} aria-label="Back"
              className="flex items-center gap-[3px] py-[6px] pr-[4px] active:opacity-70"
              style={{ color: "#6FB0FF", fontSize: 14, fontWeight: 600, letterSpacing: "-0.2px", fontFamily: MA.FONT }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back
            </button>
            <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "1.5px" }}>
              Mark Attendance
            </div>
            <button type="button" onClick={handleSave} disabled={saving || loading}
              aria-label={saving ? "Saving attendance" : "Save attendance"}
              className="h-[34px] px-[14px] rounded-[11px] flex items-center gap-[5px] active:scale-[0.95] transition-transform"
              style={{
                background: MA.GREEN, color: "#fff", fontSize: 12, fontWeight: 800, letterSpacing: "-0.1px",
                boxShadow: "0 1px 2px rgba(0,200,83,0.3), 0 4px 12px rgba(0,200,83,0.4)",
                opacity: saving || loading ? 0.65 : 1,
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: MA.FONT,
                border: "none",
              }}>
              {saving
                ? <Loader2 className="w-[13px] h-[13px] animate-spin" aria-hidden="true" />
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              Save
            </button>
          </div>

          {/* Date block */}
          <div className="pt-[4px] px-[2px] pb-[2px]">
            <div className="text-[9px] font-extrabold uppercase mb-[6px]" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "1.8px" }}>
              {selClass?.name || "Class"}{selClass?.subject ? ` · ${selClass.subject}` : ""}
            </div>
            <div className="text-[26px] font-extrabold leading-[1.1]" style={{ color: "#fff", letterSpacing: "-1px" }}>
              {dateLabel}
            </div>
            <div className="text-[11px] font-semibold mt-[5px] uppercase" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "0.4px" }}>
              {getSemesterLabel()} · {students.length} student{students.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-[14px]">

        {/* Class switcher (when multiple classes) */}
        {classes.length > 1 && (
          <div className="mb-[12px] p-[5px] rounded-[14px] flex gap-[7px] overflow-x-auto"
            style={{ background: MA.CARD, boxShadow: MA.SH_SM, scrollbarWidth: "none" as const }}>
            {classes.map(cls => {
              const isActive = selectedClassId === cls.id;
              return (
                <button key={cls.id} type="button" onClick={() => setSelectedClassId(cls.id)}
                  className="flex-1 py-[9px] px-[10px] rounded-[10px] text-[12px] font-bold text-center transition-all active:scale-[0.96]"
                  style={{
                    background: isActive ? MA.P : "transparent",
                    color: isActive ? "#fff" : MA.T3,
                    letterSpacing: "-0.2px",
                    fontFamily: MA.FONT,
                    whiteSpace: "nowrap",
                    minWidth: 72,
                    boxShadow: isActive ? "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" : "none",
                  }}>
                  {cls.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Quick Actions (2-col) */}
        <div className="grid grid-cols-2 gap-[10px] mb-[10px]">
          <button type="button" onClick={markAllPresent} disabled={loading || !students.length}
            className="bg-white rounded-[16px] py-[14px] px-[12px] flex flex-col items-center gap-[8px] active:scale-[0.97] transition-transform"
            style={{ boxShadow: MA.SH, fontFamily: MA.FONT, opacity: loading || !students.length ? 0.6 : 1 }}>
            <div className="w-9 h-9 rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.GREEN }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div className="text-[12px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Mark all present</div>
            <div className="text-[10px] font-medium" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>One tap</div>
          </button>
          <button type="button" onClick={copyFromYesterday} disabled={loading || !students.length}
            className="bg-white rounded-[16px] py-[14px] px-[12px] flex flex-col items-center gap-[8px] active:scale-[0.97] transition-transform"
            style={{ boxShadow: MA.SH, fontFamily: MA.FONT, opacity: loading || !students.length ? 0.6 : 1 }}>
            <div className="w-9 h-9 rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.P }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </div>
            <div className="text-[12px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Copy yesterday</div>
            <div className="text-[10px] font-medium" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>Previous session</div>
          </button>
        </div>

        {/* Live tally */}
        <div className="flex gap-[6px] py-[10px] px-[14px] rounded-[14px] mb-[14px]"
          style={{ background: MA.CARD, boxShadow: MA.SH_SM }}>
          {([
            { key: "present", label: "Present", val: counts.present, color: MA.GREEN, bg: "rgba(0,200,83,0.08)" },
            { key: "absent",  label: "Absent",  val: counts.absent,  color: MA.RED,   bg: "rgba(255,51,85,0.06)" },
            { key: "late",    label: "Late",    val: counts.late,    color: MA.ORANGE,bg: "rgba(255,136,0,0.07)" },
          ] as const).map(p => (
            <div key={p.key} className="flex-1 flex items-center gap-[6px] px-[10px] py-[6px] rounded-[10px]" style={{ background: p.bg }}>
              <span className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: p.color }} />
              <span className="text-[11px] font-semibold" style={{ color: MA.T3 }}>{p.label}</span>
              <span className="ml-auto text-[14px] font-extrabold" style={{ color: p.color, letterSpacing: "-0.3px" }}>{p.val}</span>
            </div>
          ))}
        </div>

        {/* Students header */}
        <div className="flex items-end justify-between px-[2px] pb-[8px] mb-[2px]">
          <div>
            <div className="text-[15px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Students</div>
            <div className="text-[11px] font-semibold mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
              {students.length} student{students.length === 1 ? "" : "s"} · Tap to change status
            </div>
          </div>
          {students.length > 0 && (
            <button type="button"
              onClick={() => setStudents(prev => [...prev].sort((a, b) => a.name.localeCompare(b.name)))}
              className="text-[12px] font-bold py-[6px] flex items-center gap-[2px] active:opacity-70"
              style={{ color: MA.P, fontFamily: MA.FONT }}>
              Sort <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
            </button>
          )}
        </div>

        {/* Student cards */}
        {loading ? (
          <div className="bg-white rounded-[18px] py-10 flex justify-center" style={{ boxShadow: MA.SH }}>
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: MA.P }} />
          </div>
        ) : paginated.length === 0 ? (
          <div className="bg-white rounded-[18px] py-[36px] px-4 text-center text-[12px] font-medium" style={{ boxShadow: MA.SH, color: MA.T3 }}>
            No students enrolled in this class
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {paginated.map((student) => {
              const currentPill =
                student.status === "present" ? { label: "Present", color: MA.GREEN, bg: "rgba(0,200,83,0.1)" } :
                student.status === "absent"  ? { label: "Absent",  color: MA.RED,   bg: "rgba(255,51,85,0.1)" } :
                student.status === "late"    ? { label: "Late",    color: MA.ORANGE,bg: "rgba(255,136,0,0.1)" } :
                                               { label: "Unmarked",color: MA.T4,   bg: MA.SURFACE };
              return (
                <div key={student.id} className="bg-white rounded-[18px] p-[14px]" style={{ boxShadow: MA.SH }}>
                  {/* Student head */}
                  <div className="flex items-center gap-[11px] mb-[12px]">
                    <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center flex-shrink-0 text-white text-[11px] font-extrabold"
                      style={{ background: student.av.color, letterSpacing: "0.3px" }}>
                      {student.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-extrabold truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>{student.name}</div>
                      <div className="text-[11px] font-semibold mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                        Roll: {student.rollNo}
                      </div>
                    </div>
                    <span className="px-[11px] py-[5px] rounded-full text-[10px] font-extrabold flex items-center gap-[5px] flex-shrink-0"
                      style={{ background: currentPill.bg, color: currentPill.color, letterSpacing: "0.2px" }}>
                      <span className="w-[5px] h-[5px] rounded-full" style={{ background: currentPill.color }} />
                      {currentPill.label}
                    </span>
                  </div>

                  {/* Segmented: Present / Absent / Late */}
                  <div className="grid grid-cols-3 gap-[3px] p-[3px] rounded-[12px] mb-[10px]" style={{ background: MA.SURFACE }}>
                    {([
                      { key: "present" as const, label: "Present", color: MA.GREEN, shadow: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,200,83,0.15)",
                        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
                      { key: "absent" as const, label: "Absent", color: MA.RED, shadow: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(255,51,85,0.15)",
                        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> },
                      { key: "late" as const, label: "Late", color: MA.ORANGE, shadow: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(255,136,0,0.15)",
                        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
                    ]).map(({ key, label, color, shadow, icon }) => {
                      const isOn = student.status === key;
                      return (
                        <button key={key} type="button" onClick={() => setStatus(student.id, key)}
                          aria-pressed={isOn}
                          className="py-[9px] px-[4px] rounded-[9px] flex items-center justify-center gap-[5px] transition-all active:scale-[0.96]"
                          style={{
                            background: isOn ? "#fff" : "transparent",
                            color: isOn ? color : MA.T3,
                            fontSize: 11,
                            fontWeight: isOn ? 800 : 700,
                            letterSpacing: "-0.1px",
                            boxShadow: isOn ? shadow : "none",
                            fontFamily: MA.FONT,
                            border: "none",
                            cursor: "pointer",
                          }}>
                          {icon}
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Note input */}
                  <div className="flex items-center gap-[8px] px-[11px] py-[9px] rounded-[10px]"
                    style={{ background: student.note ? "rgba(9,87,247,0.05)" : MA.SURFACE }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={student.note ? MA.P : MA.T4} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    <input
                      type="text"
                      placeholder="Add note (optional)…"
                      value={student.note}
                      onChange={e => setNote(student.id, e.target.value)}
                      className="flex-1 bg-transparent outline-none text-[11px]"
                      style={{
                        color: student.note ? MA.T1 : MA.T3,
                        fontWeight: student.note ? 600 : 500,
                        letterSpacing: "-0.1px",
                        fontFamily: MA.FONT,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && students.length > ITEMS_PER_PAGE && (
          <div className="flex items-center justify-between mt-[12px] py-[11px] px-[14px] bg-white rounded-[14px]" style={{ boxShadow: MA.SH_SM }}>
            <div className="text-[11px] font-semibold" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
              {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, students.length)}–{Math.min(currentPage * ITEMS_PER_PAGE, students.length)} of {students.length}
            </div>
            <div className="flex items-center gap-[8px]">
              <button type="button" onClick={() => goPage(currentPage - 1)} disabled={currentPage === 1}
                aria-label="Previous page"
                className="w-8 h-8 rounded-[10px] flex items-center justify-center active:scale-[0.92] transition-transform"
                style={{ background: MA.SURFACE, opacity: currentPage === 1 ? 0.4 : 1 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={MA.T1} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div className="min-w-[32px] h-8 px-[10px] rounded-[10px] flex items-center justify-center text-white text-[12px] font-extrabold"
                style={{ background: MA.P, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" }}>
                {currentPage} / {totalPages}
              </div>
              <button type="button" onClick={() => goPage(currentPage + 1)} disabled={currentPage === totalPages}
                aria-label="Next page"
                className="w-8 h-8 rounded-[10px] flex items-center justify-center active:scale-[0.92] transition-transform"
                style={{ background: MA.SURFACE, opacity: currentPage === totalPages ? 0.4 : 1 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={MA.T1} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>

    {/* ═══════════════════ DESKTOP VIEW (unchanged) ═══════════════════ */}
    <div className="hidden md:block">

      {/* ── Dark Hero (back + save + class info) ─────────────────────────────── */}
      <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6 md:-mx-8 md:-mt-8 px-[22px] pb-7 bg-[#162E93] md:bg-[#08090C]">

        {/* Nav row: Back | title | Save */}
        <div className="flex items-center justify-between pt-3 mb-5">
          <button type="button" onClick={onBack}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <IcoBack />
            <span style={{ fontSize: 13, color: T.blue }}>Back</span>
          </button>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.8)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            Mark attendance
          </p>
          <button onClick={handleSave} disabled={saving || loading}
            type="button"
            aria-label={saving ? "Saving attendance" : "Save attendance"}
            style={{
              padding: '8px 14px', borderRadius: 11, background: T.green2,
              border: 'none', color: '#fff', fontSize: 12, fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving || loading ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
            }}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <IcoCheck color="#fff" size={12} />}
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
            <button type="button" onClick={markAllPresent}
              style={{
                padding: '10px 8px', borderRadius: 10, border: `1px solid ${T.bdr}`,
                background: T.s1, fontSize: 11, fontWeight: 500, color: T.ink1,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
              <IcoMarkAll /> Mark all present
            </button>
            <button type="button" onClick={copyFromYesterday}
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
                        <button type="button" key={key}
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
                <button type="button" onClick={() => goPage(currentPage - 1)} disabled={currentPage === 1}
                  style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.bdr}`, background: T.s0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: currentPage === 1 ? 0.4 : 1 }}>
                  <IcoChevLeft />
                </button>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: T.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: '#fff' }}>
                  {currentPage}
                </div>
                <button type="button" onClick={() => goPage(currentPage + 1)} disabled={currentPage === totalPages}
                  style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.bdr}`, background: T.s0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: currentPage === totalPages ? 0.4 : 1 }}>
                  <IcoChevRight />
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
    {/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default MarkAttendance;