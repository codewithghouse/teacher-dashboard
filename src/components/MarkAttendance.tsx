import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Loader2, X as XIcon, PartyPopper, AlertTriangle, CalendarDays } from "lucide-react";
import { db } from "../lib/firebase";
import {
  collection, query, getDocs, where,
  serverTimestamp, doc, onSnapshot,
  type QueryConstraint,
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { auditedSet } from "../lib/auditedWrites";
import { subscribeSchoolHolidays, type SchoolHoliday } from "../lib/schoolHolidays";
import { toast } from "sonner";

// ── Edullent v2 design tokens (shared mobile + desktop) ──────────────────────
const MA = {
  FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  CARD: "#FFFFFF",
  SURFACE: "#F4F7FE",
  P: "#0055FF",
  T1: "#001040", T3: "#5070B0", T4: "#99AACC",
  GREEN: "#00C853",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  VIOLET: "#7B3FF4",
  GOLD: "#FFAA00",
  SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
  SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
  BDR: "0.5px solid rgba(0,85,255,0.07)",
  HEADER_GRAD: "linear-gradient(160deg, #000A33 0%, #001A66 55%, #0044CC 100%)",
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

// ── Types ─────────────────────────────────────────────────────────────────────
// "holiday" status (added 2026-05-19) — declares the whole day off for the
// class. Excluded from attendance % across all 4 dashboards. Writer is the
// "Mark Day as Holiday" button below; readers consult `lib/attendanceDedup`
// + per-page % calcs which short-circuit on this status.
interface Student {
  id: string; enrollId: string; name: string; email: string;
  rollNo: string | number;
  status: "present" | "absent" | "late" | "none" | "holiday";
  note: string; initials: string; av: { bg: string; color: string };
}
// onBack receives the classId that was last saved so the parent page can
// sync its own selectedClassId — important because users CAN switch class
// inside this screen, and without sync the Attendance page would still
// show the original class as "not marked" after they actually marked a
// different one.
interface Props { onBack: (savedClassId?: string) => void; initialClassId?: string; }

// ── Component ─────────────────────────────────────────────────────────────────
const MarkAttendance = ({ onBack, initialClassId }: Props) => {
  const { teacherData } = useAuth();

  const [classes, setClasses]               = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(initialClassId || "");
  const [students, setStudents]             = useState<Student[]>([]);
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [currentPage, setCurrentPage]       = useState(1);
  // Holiday flow: confirm modal + optional reason.
  const [holidayOpen, setHolidayOpen]       = useState(false);
  const [holidayReason, setHolidayReason]   = useState("");
  // School-wide holidays (principal-declared). When today is one of these,
  // the teacher sees a banner and the Save button is disabled — no need to
  // mark attendance on a declared school holiday.
  const [schoolHolidays, setSchoolHolidays] = useState<SchoolHoliday[]>([]);

  useEffect(() => {
    if (!teacherData?.schoolId) return;
    const unsub = subscribeSchoolHolidays(
      teacherData.schoolId,
      (rows) => setSchoolHolidays(rows),
      (err) => console.error("[MarkAttendance] school_holidays:", err),
    );
    return () => unsub();
  }, [teacherData?.schoolId]);

  // Today's school holiday (if any) — looked up directly so we don't rebuild
  // a Map for a single date check.
  const todaySchoolHoliday = useMemo(() => {
    const today = todayStr();
    return schoolHolidays.find(h => h.date === today) || null;
  }, [schoolHolidays]);

  // Fetch classes — union of teaching_assignments + legacy classes.teacherId
  // (same pattern as MyClasses / CreateTest fix). Single classes.teacherId
  // query previously missed any class the teacher was assigned to ONLY via
  // teaching_assignments — common for freshly-onboarded teachers.
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const tId = teacherData.id as string;
    const schoolId = teacherData.schoolId as string;

    let assignedIds = new Set<string>();
    let legacyOwnedIds = new Set<string>();
    let allClassDocs: any[] = [];

    const recompute = () => {
      const allowed = new Set<string>([...assignedIds, ...legacyOwnedIds]);
      const cls = allowed.size === 0 ? [] : allClassDocs.filter(c => allowed.has(c.id));
      setClasses(cls);
      setSelectedClassId(prev => prev || cls[0]?.id || "");
    };

    const u1 = onSnapshot(
      query(collection(db, "teaching_assignments"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => {
        const active = snap.docs.filter(d => {
          const s = (d.data() as any).status;
          return !s || (typeof s === "string" && s.toLowerCase() === "active");
        });
        assignedIds = new Set(active.map(d => (d.data() as any).classId).filter((x: any): x is string => !!x));
        recompute();
      },
    );

    const u2 = onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      (snap) => {
        legacyOwnedIds = new Set(snap.docs.map(d => d.id));
        recompute();
      },
    );

    const u3 = onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId)),
      (snap) => {
        allClassDocs = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        recompute();
      },
    );

    return () => { u1(); u2(); u3(); };
  }, [teacherData?.id, teacherData?.schoolId]);

  // Fetch roster + today's attendance — schoolId only (NO branchId on
  // event streams, see Attendance.tsx note).
  useEffect(() => {
    if (!selectedClassId || !teacherData?.id || !teacherData?.schoolId) return;
    setLoading(true); setCurrentPage(1);
    const schoolWhere = where("schoolId", "==", teacherData.schoolId);

    let ignore = false;
    const unsub = onSnapshot(
      query(collection(db, "enrollments"), schoolWhere, where("classId", "==", selectedClassId)),
      async (snap) => {
        try {
          const logsSnap = await getDocs(
            query(collection(db, "attendance"), schoolWhere, where("classId", "==", selectedClassId), where("date", "==", todayStr()))
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
    holiday:  students.filter(s => s.status === "holiday").length,
    unmarked: students.filter(s => s.status === "none").length,
  };
  const existingMarksForToday = counts.present + counts.absent + counts.late;
  const isHolidayAlready = students.length > 0 && counts.holiday === students.length;

  // Actions
  const setStatus = (id: string, status: Student["status"]) =>
    setStudents(prev => prev.map(s => s.id === id ? { ...s, status } : s));
  const setNote = (id: string, note: string) =>
    setStudents(prev => prev.map(s => s.id === id ? { ...s, note } : s));

  const markAllPresent = () => {
    setStudents(prev => prev.map(s => ({ ...s, status: "present" })));
    toast.success("All students marked present!");
  };

  // Resolve the teacher's assignmentId for the selected class — same fallback
  // pattern as handleSave (used to stamp the doc so cross-dashboard readers
  // can attribute the write to the correct teaching_assignments row).
  const resolveAssignmentId = async (): Promise<string> => {
    if (!teacherData?.schoolId) return "legacy";
    const SC: QueryConstraint[] = [where("schoolId", "==", teacherData.schoolId)];
    if (teacherData.branchId) SC.push(where("branchId", "==", teacherData.branchId));
    const aSnap = await getDocs(query(
      collection(db, "teaching_assignments"),
      ...SC,
      where("teacherId", "==", teacherData.id),
      where("classId", "==", selectedClassId),
    ));
    if (aSnap.empty) return "legacy";
    const activeDoc = aSnap.docs.find(d => {
      const s = (d.data() as { status?: unknown }).status;
      return !s || (typeof s === "string" && s.toLowerCase() === "active");
    });
    return activeDoc?.id || "legacy";
  };

  // Holiday flow — declares the whole day off for the class.
  // Writes one attendance doc per student with status:"holiday". All
  // attendance % readers across the 4 dashboards short-circuit on this
  // status so the day doesn't count for or against the student.
  const saveHoliday = async () => {
    if (!students.length) { toast.error("No students in this class."); return; }
    if (!teacherData?.schoolId) return;
    setSaving(true);
    const today = todayStr();
    const selClass = classes.find(c => c.id === selectedClassId);
    const reason = holidayReason.trim() || "School holiday";
    try {
      const assignmentId = await resolveAssignmentId();
      const results = await Promise.allSettled(
        students.map(s =>
          auditedSet(doc(db, "attendance", `${s.id}_${selectedClassId}_${today}`), {
            studentId: s.id, studentName: s.name, studentEmail: s.email,
            status: "holiday" as const,
            note: reason,
            date: today,
            teacherId: teacherData.id, teacherName: teacherData.name || "",
            schoolId: teacherData.schoolId || "", branchId: teacherData.branchId || "",
            classId: selectedClassId, className: (selClass as { name?: string } | undefined)?.name || "",
            assignmentId, timestamp: serverTimestamp(),
          })
        )
      );
      const failed = results.filter(r => r.status === "rejected");
      if (failed.length > 0) {
        console.error("[MarkAttendance] partial holiday save failure", failed);
        toast.error(`Holiday saved for ${students.length - failed.length}/${students.length} students.`);
        return;
      }
      toast.success(`Day marked as holiday — ${students.length} students excluded from attendance %.`);
      setHolidayOpen(false);
      setHolidayReason("");
      onBack(selectedClassId);
    } catch (e) {
      console.error("[MarkAttendance] holiday save failed", e);
      toast.error("Failed to mark holiday. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const copyFromYesterday = async () => {
    if (!teacherData.schoolId) return;
    setLoading(true);
    try {
      // No branchId filter (event-stream rule). No limit either — the
      // previous limit(200) silently failed for high-volume teachers
      // because Firestore default order is doc-id, not date, so older
      // dates could fall outside the window. Filter+sort client-side from
      // the full class history scoped to this teacher.
      const snap = await getDocs(
        query(
          collection(db, "attendance"),
          where("schoolId", "==", teacherData.schoolId),
          where("classId", "==", selectedClassId),
          where("teacherId", "==", teacherData.id),
        )
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
      // teaching_assignments IS a resolution entity — branchId filter is
      // safe here. Keep it for tighter scope.
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
      onBack(selectedClassId);
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
            <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "1.5px" }}>
              Mark Attendance
            </div>
            <button type="button" onClick={handleSave} disabled={saving || loading}
              aria-label={saving ? "Saving attendance" : "Save attendance"}
              className="h-[34px] px-[14px] rounded-[11px] flex items-center gap-[5px] active:scale-[0.95] transition-transform"
              style={{
                background: MA.GREEN, color: "#fff", fontSize: 12, fontWeight: 700, letterSpacing: "-0.1px",
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
            <div className="text-[9px] font-bold uppercase mb-[6px]" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "1.8px" }}>
              {selClass?.name || "Class"}{selClass?.subject ? ` · ${selClass.subject}` : ""}
            </div>
            <div className="text-[26px] font-bold leading-[1.1]" style={{ color: "#fff", letterSpacing: "-1px" }}>
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

        {/* School-wide holiday banner (principal-declared, mobile) */}
        {todaySchoolHoliday && (
          <div
            role="alert"
            className="rounded-[16px] px-[14px] py-[12px] mb-[10px] flex items-start gap-[10px]"
            style={{
              background: `linear-gradient(135deg, ${MA.VIOLET} 0%, #9B6FFF 100%)`,
              boxShadow: "0 6px 18px rgba(123,63,244,0.32), 0 2px 6px rgba(123,63,244,0.18)",
            }}
          >
            <CalendarDays className="w-[18px] h-[18px] text-white shrink-0 mt-[1px]" strokeWidth={2.3} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.16em" }}>
                Declared School Holiday
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginTop: 2, letterSpacing: "-0.2px" }}>
                Today is a holiday — {todaySchoolHoliday.reason || "off-day"}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.82)", marginTop: 3, lineHeight: 1.45 }}>
                No need to mark attendance. {todaySchoolHoliday.declaredByName ? `Declared by ${todaySchoolHoliday.declaredByName}.` : ""}
              </div>
            </div>
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
            <div className="text-[12px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Mark all present</div>
            <div className="text-[10px] font-medium" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>One tap</div>
          </button>
          <button type="button" onClick={copyFromYesterday} disabled={loading || !students.length}
            className="bg-white rounded-[16px] py-[14px] px-[12px] flex flex-col items-center gap-[8px] active:scale-[0.97] transition-transform"
            style={{ boxShadow: MA.SH, fontFamily: MA.FONT, opacity: loading || !students.length ? 0.6 : 1 }}>
            <div className="w-9 h-9 rounded-[12px] flex items-center justify-center text-white" style={{ background: MA.P }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </div>
            <div className="text-[12px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.2px" }}>Copy yesterday</div>
            <div className="text-[10px] font-medium" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>Previous session</div>
          </button>
        </div>

        {/* Mark Day as Holiday — full-width CTA below quick actions */}
        <button type="button" onClick={() => setHolidayOpen(true)} disabled={loading || !students.length}
          className="w-full rounded-[16px] py-[12px] px-[14px] flex items-center justify-center gap-[10px] active:scale-[0.98] transition-transform mb-[10px]"
          style={{
            background: `linear-gradient(135deg, ${MA.VIOLET} 0%, #9B6FFF 100%)`,
            boxShadow: "0 4px 14px rgba(123,63,244,0.32), 0 1px 3px rgba(123,63,244,0.20)",
            fontFamily: MA.FONT,
            opacity: loading || !students.length ? 0.6 : 1,
            border: "none",
            cursor: loading || !students.length ? "not-allowed" : "pointer",
          }}
          aria-label="Mark day as holiday">
          <PartyPopper className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
          <span className="text-[13px] font-bold text-white" style={{ letterSpacing: "-0.2px" }}>
            {isHolidayAlready ? "Holiday declared for today" : "Mark day as Holiday"}
          </span>
        </button>

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
              <span className="ml-auto text-[14px] font-bold" style={{ color: p.color, letterSpacing: "-0.3px" }}>{p.val}</span>
            </div>
          ))}
        </div>

        {/* Students header */}
        <div className="flex items-end justify-between px-[2px] pb-[8px] mb-[2px]">
          <div>
            <div className="text-[15px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Students</div>
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
                    <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center flex-shrink-0 text-white text-[11px] font-bold"
                      style={{ background: student.av.color, letterSpacing: "0.3px" }}>
                      {student.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>{student.name}</div>
                      <div className="text-[11px] font-semibold mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                        Roll: {student.rollNo}
                      </div>
                    </div>
                    <span className="px-[11px] py-[5px] rounded-full text-[10px] font-bold flex items-center gap-[5px] flex-shrink-0"
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
              <div className="min-w-[32px] h-8 px-[10px] rounded-[10px] flex items-center justify-center text-white text-[12px] font-bold"
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

    {/* ═══════════════════ DESKTOP VIEW (Edullent v2 — matches Dashboard theme) ═══════════════════ */}
    <div className="hidden md:block animate-in fade-in duration-500" style={{ fontFamily: MA.FONT, background: "#EEF4FF" }}>

      {/* ── Hero (full-bleed dark gradient — Dashboard pattern) ─────────────────── */}
      <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6 md:-mx-8 md:-mt-8 mb-6 px-8 lg:px-10 py-7 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #001040 0%, #001A66 35%, #0044CC 70%, #0055FF 100%)",
          boxShadow: "0 10px 36px rgba(0,51,204,0.30), 0 0 0 0.5px rgba(255,255,255,0.10)",
        }}>
        {/* Gloss + radial glow + subtle grid overlays */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, transparent 45%)" }} />
        <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)" }} />
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }} />

        <div className="relative z-[2] max-w-[1280px] mx-auto">
          {/* Top nav: Back | eyebrow | Save */}
          <div className="flex items-center justify-between mb-7">
            <button type="button" onClick={onBack}
              className="flex items-center gap-1.5 py-2 pr-2 active:opacity-70 transition-opacity"
              style={{ color: "#6FB0FF", fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px", background: 'none', border: 'none', cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back
            </button>
            <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "1.8px" }}>
              Mark Attendance
            </div>
            <button type="button" onClick={handleSave} disabled={saving || loading}
              aria-label={saving ? "Saving attendance" : "Save attendance"}
              className="h-10 px-5 rounded-[12px] flex items-center gap-2 active:scale-[0.97] transition-transform"
              style={{
                background: MA.GREEN, color: "#fff", fontSize: 13, fontWeight: 700, letterSpacing: "-0.15px",
                boxShadow: "0 1px 2px rgba(0,200,83,0.3), 0 6px 16px rgba(0,200,83,0.42)",
                opacity: saving || loading ? 0.65 : 1, cursor: saving ? "not-allowed" : "pointer", border: "none",
              }}>
              {saving
                ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              Save Attendance
            </button>
          </div>

          {/* Date block */}
          <div className="text-[11px] font-bold uppercase mb-2" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "1.8px" }}>
            {selClass?.name || "Class"}{selClass?.subject ? ` · ${selClass.subject}` : ""}
          </div>
          <h1 className="text-[40px] font-bold leading-[1.05]" style={{ color: "#fff", letterSpacing: "-1.6px" }}>
            {dateLabel}
          </h1>
          <p className="text-[13px] font-semibold mt-2 uppercase" style={{ color: "rgba(255,255,255,0.62)", letterSpacing: "0.4px" }}>
            {yearLabel} · {students.length} student{students.length === 1 ? "" : "s"}{selClass?.subject ? ` · ${selClass.subject}` : ""}
          </p>
        </div>
      </div>

      {/* ── Content (constrained) ──────────────────────────────────────────────── */}
      <div className="max-w-[1180px] mx-auto">

        {/* Class switcher (when multiple classes) */}
        {classes.length > 1 && (
          <div className="mb-4 p-1.5 rounded-[16px] flex gap-2 overflow-x-auto"
            style={{ background: MA.CARD, boxShadow: MA.SH_SM, scrollbarWidth: "none" as const }}>
            {classes.map(cls => {
              const isActive = selectedClassId === cls.id;
              return (
                <button key={cls.id} type="button" onClick={() => setSelectedClassId(cls.id)}
                  className="py-2.5 px-5 rounded-[12px] text-[13px] font-bold transition-all active:scale-[0.97]"
                  style={{
                    background: isActive ? MA.P : "transparent",
                    color: isActive ? "#fff" : MA.T3,
                    letterSpacing: "-0.2px", whiteSpace: "nowrap" as const, border: "none", cursor: "pointer",
                    boxShadow: isActive ? "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.32)" : "none",
                  }}>
                  {cls.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Quick Actions + Live Tally row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <button type="button" onClick={markAllPresent} disabled={loading || !students.length}
            className="bg-white rounded-[18px] py-5 px-5 flex items-center gap-4 active:scale-[0.98] hover:-translate-y-0.5 transition-all text-left"
            style={{ boxShadow: MA.SH, opacity: loading || !students.length ? 0.6 : 1, fontFamily: MA.FONT, border: "none", cursor: loading || !students.length ? "not-allowed" : "pointer" }}>
            <div className="w-12 h-12 rounded-[14px] flex items-center justify-center text-white shrink-0"
              style={{ background: `linear-gradient(135deg, ${MA.GREEN}, #22EE66)`, boxShadow: "0 4px 14px rgba(0,200,83,0.32)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Mark all present</div>
              <div className="text-[11px] font-semibold mt-0.5" style={{ color: MA.T3 }}>One-tap shortcut</div>
            </div>
          </button>

          <button type="button" onClick={copyFromYesterday} disabled={loading || !students.length}
            className="bg-white rounded-[18px] py-5 px-5 flex items-center gap-4 active:scale-[0.98] hover:-translate-y-0.5 transition-all text-left"
            style={{ boxShadow: MA.SH, opacity: loading || !students.length ? 0.6 : 1, fontFamily: MA.FONT, border: "none", cursor: loading || !students.length ? "not-allowed" : "pointer" }}>
            <div className="w-12 h-12 rounded-[14px] flex items-center justify-center text-white shrink-0"
              style={{ background: `linear-gradient(135deg, ${MA.P}, ${MA.P}DD)`, boxShadow: "0 4px 14px rgba(0,85,255,0.32)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Copy yesterday</div>
              <div className="text-[11px] font-semibold mt-0.5" style={{ color: MA.T3 }}>Reuse last session</div>
            </div>
          </button>

          <button type="button" onClick={() => setHolidayOpen(true)} disabled={loading || !students.length}
            className="rounded-[18px] py-5 px-5 flex items-center gap-4 active:scale-[0.98] hover:-translate-y-0.5 transition-all text-left"
            style={{
              background: `linear-gradient(135deg, ${MA.VIOLET} 0%, #9B6FFF 100%)`,
              boxShadow: "0 6px 20px rgba(123,63,244,0.32), 0 2px 6px rgba(123,63,244,0.20)",
              opacity: loading || !students.length ? 0.6 : 1,
              fontFamily: MA.FONT,
              border: "none",
              cursor: loading || !students.length ? "not-allowed" : "pointer",
              gridColumn: "span 1",
            }}
            aria-label="Mark day as holiday">
            <div className="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0"
              style={{ background: "rgba(255,255,255,0.18)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)" }}>
              <PartyPopper className="w-[22px] h-[22px] text-white" strokeWidth={2.3} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-white" style={{ letterSpacing: "-0.3px" }}>
                {isHolidayAlready ? "Holiday today" : "Mark as Holiday"}
              </div>
              <div className="text-[11px] font-semibold mt-0.5" style={{ color: "rgba(255,255,255,0.82)" }}>
                Excludes day from attendance %
              </div>
            </div>
          </button>

          {/* Live tally */}
          <div className="bg-white rounded-[18px] py-3.5 px-4 flex items-center gap-2.5"
            style={{ boxShadow: MA.SH }}>
            {([
              { key: "present", label: "Present", val: counts.present, color: MA.GREEN, bg: "rgba(0,200,83,0.08)" },
              { key: "absent",  label: "Absent",  val: counts.absent,  color: MA.RED,   bg: "rgba(255,51,85,0.06)" },
              { key: "late",    label: "Late",    val: counts.late,    color: MA.ORANGE,bg: "rgba(255,136,0,0.07)" },
            ] as const).map(p => (
              <div key={p.key} className="flex-1 flex items-center gap-2 px-3 py-2 rounded-[10px]" style={{ background: p.bg }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[11px] font-semibold" style={{ color: MA.T3 }}>{p.label}</span>
                <span className="ml-auto text-[16px] font-bold" style={{ color: p.color, letterSpacing: "-0.3px" }}>{p.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Students header */}
        <div className="flex items-end justify-between px-1 mb-3">
          <div>
            <h2 className="text-[18px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.4px" }}>Students</h2>
            <p className="text-[12px] font-semibold mt-1" style={{ color: MA.T3 }}>
              {students.length} student{students.length === 1 ? "" : "s"} · Click to change status
            </p>
          </div>
          {students.length > 0 && (
            <button type="button"
              onClick={() => setStudents(prev => [...prev].sort((a, b) => a.name.localeCompare(b.name)))}
              className="text-[13px] font-bold py-2 px-3.5 rounded-[10px] flex items-center gap-1 active:opacity-70 hover:bg-white/60 transition-all"
              style={{ color: MA.P, background: "rgba(255,255,255,0.6)", border: "none", cursor: "pointer" }}>
              Sort A–Z
            </button>
          )}
        </div>

        {/* Student cards (2-col on lg) */}
        {loading ? (
          <div className="bg-white rounded-[18px] py-16 flex justify-center" style={{ boxShadow: MA.SH }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: MA.P }} />
          </div>
        ) : paginated.length === 0 ? (
          <div className="bg-white rounded-[18px] py-12 px-6 text-center text-[13px] font-medium" style={{ boxShadow: MA.SH, color: MA.T3 }}>
            No students enrolled in this class
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {paginated.map((student) => {
              const currentPill =
                student.status === "present" ? { label: "Present", color: MA.GREEN, bg: "rgba(0,200,83,0.1)" } :
                student.status === "absent"  ? { label: "Absent",  color: MA.RED,   bg: "rgba(255,51,85,0.1)" } :
                student.status === "late"    ? { label: "Late",    color: MA.ORANGE,bg: "rgba(255,136,0,0.1)" } :
                                               { label: "Unmarked",color: MA.T4,   bg: MA.SURFACE };
              return (
                <div key={student.id} className="bg-white rounded-[18px] p-5" style={{ boxShadow: MA.SH }}>
                  {/* Student head */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-[13px] flex items-center justify-center shrink-0 text-white text-[13px] font-bold"
                      style={{ background: student.av.color, letterSpacing: "0.3px" }}>
                      {student.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-bold truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>{student.name}</div>
                      <div className="text-[12px] font-semibold mt-0.5" style={{ color: MA.T3 }}>Roll: {student.rollNo}</div>
                    </div>
                    <span className="px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 shrink-0"
                      style={{ background: currentPill.bg, color: currentPill.color, letterSpacing: "0.2px" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: currentPill.color }} />
                      {currentPill.label}
                    </span>
                  </div>

                  {/* Segmented Present/Absent/Late buttons */}
                  <div className="grid grid-cols-3 gap-1 p-1 rounded-[12px] mb-3" style={{ background: MA.SURFACE }}>
                    {([
                      { key: "present" as const, label: "Present", color: MA.GREEN, shadow: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,200,83,0.18)",
                        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
                      { key: "absent" as const, label: "Absent", color: MA.RED, shadow: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(255,51,85,0.18)",
                        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> },
                      { key: "late" as const, label: "Late", color: MA.ORANGE, shadow: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(255,136,0,0.18)",
                        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
                    ]).map(({ key, label, color, shadow, icon }) => {
                      const isOn = student.status === key;
                      return (
                        <button key={key} type="button" onClick={() => setStatus(student.id, key)}
                          aria-pressed={isOn}
                          className="py-2.5 px-2 rounded-[10px] flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] hover:opacity-90"
                          style={{
                            background: isOn ? "#fff" : "transparent",
                            color: isOn ? color : MA.T3,
                            fontSize: 12, fontWeight: isOn ? 800 : 700, letterSpacing: "-0.1px",
                            boxShadow: isOn ? shadow : "none", fontFamily: MA.FONT, border: "none", cursor: "pointer",
                          }}>
                          {icon}
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Note input */}
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-[10px]"
                    style={{ background: student.note ? "rgba(9,87,247,0.05)" : MA.SURFACE }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={student.note ? MA.P : MA.T4} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    <input
                      type="text"
                      placeholder="Add note (optional)…"
                      value={student.note}
                      onChange={e => setNote(student.id, e.target.value)}
                      className="flex-1 bg-transparent outline-none text-[12px]"
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
          <div className="flex items-center justify-between mt-5 py-3 px-5 bg-white rounded-[14px]" style={{ boxShadow: MA.SH_SM }}>
            <div className="text-[12px] font-semibold" style={{ color: MA.T3 }}>
              Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, students.length)}–{Math.min(currentPage * ITEMS_PER_PAGE, students.length)} of {students.length} students
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => goPage(currentPage - 1)} disabled={currentPage === 1}
                aria-label="Previous page"
                className="w-9 h-9 rounded-[11px] flex items-center justify-center active:scale-[0.95] transition-transform"
                style={{ background: MA.SURFACE, opacity: currentPage === 1 ? 0.4 : 1, border: "none", cursor: currentPage === 1 ? "not-allowed" : "pointer" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MA.T1} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div className="min-w-[44px] h-9 px-3 rounded-[11px] flex items-center justify-center text-white text-[13px] font-bold"
                style={{ background: MA.P, letterSpacing: "-0.2px", boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 12px rgba(9,87,247,0.3)" }}>
                {currentPage} / {totalPages}
              </div>
              <button type="button" onClick={() => goPage(currentPage + 1)} disabled={currentPage === totalPages}
                aria-label="Next page"
                className="w-9 h-9 rounded-[11px] flex items-center justify-center active:scale-[0.95] transition-transform"
                style={{ background: MA.SURFACE, opacity: currentPage === totalPages ? 0.4 : 1, border: "none", cursor: currentPage === totalPages ? "not-allowed" : "pointer" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MA.T1} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
    {/* ═══════════ END DESKTOP VIEW ═══════════ */}

    {/* ═══════════ HOLIDAY CONFIRM MODAL (portaled to body to escape any
       transform-using parent that would otherwise trap position:fixed —
       per bug_pattern_fixed_modal_inside_transform_parent.md) ═══════════ */}
    {holidayOpen && createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mark day as holiday"
        onClick={() => !saving && setHolidayOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,8,40,0.45)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
          padding: 16,
          fontFamily: MA.FONT,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "#fff",
            borderRadius: 22,
            width: 420,
            maxWidth: "100%",
            overflow: "hidden",
            boxShadow: "0 32px 80px rgba(0,8,40,0.32), 0 8px 24px rgba(0,8,40,0.18)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "18px 22px",
              background: `linear-gradient(135deg, ${MA.VIOLET} 0%, #9B6FFF 100%)`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, transparent 55%)",
                pointerEvents: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, position: "relative", zIndex: 1 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.18)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <PartyPopper className="w-6 h-6 text-white" strokeWidth={2.3} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: "0.16em" }}>
                  Declare Day
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginTop: 2, letterSpacing: "-0.3px" }}>
                  Mark as Holiday?
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.82)", marginTop: 4 }}>
                  {dateLabel} · {(selClass as { name?: string } | undefined)?.name || "—"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => !saving && setHolidayOpen(false)}
                disabled={saving}
                aria-label="Close"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.18)",
                  border: "none",
                  cursor: saving ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  opacity: saving ? 0.5 : 1,
                }}
              >
                <XIcon className="w-[14px] h-[14px] text-white" strokeWidth={2.4} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "18px 22px 22px" }}>
            {existingMarksForToday > 0 && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(255,170,0,0.10)",
                  border: "0.5px solid rgba(255,170,0,0.30)",
                  marginBottom: 14,
                }}
              >
                <AlertTriangle className="w-[18px] h-[18px] shrink-0 mt-[1px]" style={{ color: "#B26A00" }} strokeWidth={2.2} />
                <div style={{ fontSize: 12, lineHeight: 1.5, color: "#7A4400", fontWeight: 600 }}>
                  {existingMarksForToday} {existingMarksForToday === 1 ? "student is" : "students are"} already marked
                  for today. Confirming will <span style={{ fontWeight: 800 }}>overwrite</span> all marks
                  with "Holiday".
                </div>
              </div>
            )}

            <label style={{ fontSize: 11, fontWeight: 700, color: MA.T3, textTransform: "uppercase", letterSpacing: "0.10em", display: "block", marginBottom: 6 }}>
              Reason (optional)
            </label>
            <input
              type="text"
              value={holidayReason}
              onChange={(e) => setHolidayReason(e.target.value.slice(0, 80))}
              placeholder="e.g. Diwali, Local festival, Strike day"
              disabled={saving}
              maxLength={80}
              style={{
                width: "100%",
                height: 42,
                padding: "0 14px",
                borderRadius: 12,
                background: MA.SURFACE,
                border: "0.5px solid rgba(0,85,255,0.14)",
                fontSize: 13,
                fontWeight: 500,
                color: MA.T1,
                fontFamily: MA.FONT,
                outline: "none",
                letterSpacing: "-0.1px",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = MA.VIOLET; e.currentTarget.style.boxShadow = `0 0 0 3px rgba(123,63,244,0.18)`; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(0,85,255,0.14)"; e.currentTarget.style.boxShadow = "none"; }}
            />

            <div style={{ fontSize: 11, lineHeight: 1.5, color: MA.T3, marginTop: 12, fontWeight: 500 }}>
              All {students.length} {students.length === 1 ? "student" : "students"} in this class will be
              recorded as "Holiday" for today. This day is excluded from attendance % across all
              dashboards (parent, teacher, principal, owner).
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => !saving && setHolidayOpen(false)}
                disabled={saving}
                className="active:scale-[0.98] transition-transform"
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 13,
                  background: MA.SURFACE,
                  border: "0.5px solid rgba(0,85,255,0.12)",
                  color: MA.T1,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "-0.2px",
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.55 : 1,
                  fontFamily: MA.FONT,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveHoliday}
                disabled={saving || !students.length}
                className="active:scale-[0.98] transition-transform"
                style={{
                  flex: 1.4,
                  height: 46,
                  borderRadius: 13,
                  background: `linear-gradient(135deg, ${MA.VIOLET} 0%, #9B6FFF 100%)`,
                  boxShadow: "0 6px 18px rgba(123,63,244,0.36), 0 2px 6px rgba(123,63,244,0.20)",
                  border: "none",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "-0.2px",
                  cursor: saving || !students.length ? "not-allowed" : "pointer",
                  opacity: saving || !students.length ? 0.7 : 1,
                  fontFamily: MA.FONT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-[16px] h-[16px] animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <PartyPopper className="w-[16px] h-[16px]" strokeWidth={2.3} />
                    Confirm Holiday
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}

    </div>
  );
};

export default MarkAttendance;