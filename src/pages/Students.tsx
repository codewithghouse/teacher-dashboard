import { useState, useEffect } from "react";
import StudentProfile from "@/components/StudentProfile";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { auditedAdd } from "../lib/auditedWrites";
import { Loader2, X, UserPlus, Mail } from "lucide-react";
import { toast } from "sonner";
import { sendStudentInviteEmail } from "../lib/resend";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

// ── Design tokens (desktop) ──────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF',
  green: '#087F5B', greenL: '#EBFBEE', green2: '#2F9E44',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── Mobile tokens (EduIntellect v2) ──────────────────────────────────────────
const MA = {
  FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  CARD: "#FFFFFF",
  SURFACE: "#F4F7FE",
  SURFACE2: "#EAF0FB",
  P: "#0055FF", PD: "#0044CC",
  T1: "#001040", T2: "#002080", T3: "#5070B0", T4: "#99AACC",
  GREEN: "#00C853",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  GOLD: "#FFAA00",
  VIOLET: "#7B3FF4",
  TEAL: "#16B8B0",
  SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
  SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
  BDR: "0.5px solid rgba(0,85,255,0.07)",
  HERO_GRAD: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
};

// Tone by status tag
const mobileStatusTone = (tag: string) =>
  tag === 'Good'      ? { accent: MA.GREEN,  pillBg: 'rgba(0,200,83,0.12)',  pillFg: MA.GREEN,  label: 'Good',      pulse: false } :
  tag === 'Attention' ? { accent: MA.ORANGE, pillBg: 'rgba(255,136,0,0.12)', pillFg: MA.ORANGE, label: 'Attention', pulse: true } :
                        { accent: MA.RED,    pillBg: 'rgba(255,51,85,0.12)', pillFg: MA.RED,    label: 'Critical',  pulse: true };

// Avatar mobile palette — deterministic per name
const MA_AVATARS = [MA.ORANGE, MA.RED, MA.TEAL, MA.VIOLET, MA.GREEN, MA.P, MA.GOLD];
const mobileAvatarColor = (name = '') => {
  const i = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % MA_AVATARS.length;
  return MA_AVATARS[i];
};

// ── Avatar palette ───────────────────────────────────────────────────────────
const AV_BG  = [T.tealL, T.greenL, T.amberL, T.blueL, '#F3F0FF', T.redL, '#FFF4E6'];
const AV_FG  = [T.teal,  T.green,  T.amber,  T.blue,  '#6741D9', T.red,  '#D9480F'];
const avStyle = (name = '') => {
  const i = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_BG.length;
  return { bg: AV_BG[i], fg: AV_FG[i] };
};

const getInitials = (name = '') => {
  const p = name.trim().split(' ');
  return (p.length >= 2 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
};

// ── Status helpers (desktop view only) ───────────────────────────────────────
const statusBadge = (tag: string) =>
  tag === 'Good'      ? { bg: T.greenL, color: T.green }
  : tag === 'Attention' ? { bg: T.amberL, color: T.amber }
  : { bg: T.redL, color: T.red };
const scoreBarColor = (pct: number) =>
  pct >= 75 ? T.green2 : pct >= 50 ? T.amber : T.red;

// ── Component ─────────────────────────────────────────────────────────────────
export default function Students() {
  const { teacherData } = useAuth();

  const [students, setStudents]             = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [search, setSearch]                 = useState('');
  const [filterStatus, setFilterStatus]     = useState('All');
  const [filterClass, setFilterClass]       = useState('All');

  // Invite modal state
  const [inviteOpen, setInviteOpen]         = useState(false);
  const [inviting, setInviting]             = useState(false);
  const [teacherClasses, setTeacherClasses] = useState<any[]>([]);
  const [inv, setInv] = useState({ name: '', email: '', classId: '', rollNo: '' });

  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    setLoading(true);
    try {
      const qEnroll = query(
        collection(db, 'enrollments'),
        where('schoolId', '==', schoolId),
        where('teacherId', '==', teacherData.id),
      );
      let ignore = false;
      const unsubEnroll = onSnapshot(qEnroll, async (snap) => {
        const enrolledDocs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Record<string, unknown> & { id: string; studentId?: string; studentEmail?: string; studentName?: string; rollNo?: string; className?: string; classId?: string }));
        const uniqueMap = new Map<string, Record<string, unknown>>();
        enrolledDocs.forEach(e => {
          const sid = e.studentId || e.studentEmail;
          if (!sid) return;
          if (!uniqueMap.has(sid)) {
            uniqueMap.set(sid, {
              id: sid, name: e.studentName, email: e.studentEmail,
              // Show a clear placeholder instead of a random roll number.
              // Random values here caused the same student to show different
              // rolls across reloads — a data-integrity footgun.
              rollNo: e.rollNo || "—",
              className: e.className, classId: e.classId,
              initials: e.studentName?.substring(0, 2).toUpperCase() || 'ST',
              attendancePct: 0, avgScorePct: 0, statusTag: 'Good',
            });
          }
        });
        const studentsArray = Array.from(uniqueMap.values());
        const [scoresSnap, attSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'test_scores'),
            where('schoolId', '==', schoolId),
            where('teacherId', '==', teacherData.id),
          )),
          getDocs(query(
            collection(db, 'attendance'),
            where('schoolId', '==', schoolId),
            where('teacherId', '==', teacherData.id),
          )),
        ]);
        const scoresData = scoresSnap.docs.map(d => d.data());
        const attData    = attSnap.docs.map(d => d.data());
        const final = studentsArray.map(stu => {
          const stuScores = scoresData.filter(s =>
            (s.studentId && s.studentId === stu.id) ||
            (s.studentEmail && stu.email && s.studentEmail.toLowerCase() === stu.email.toLowerCase())
          );
          let totalPct = 0, count = 0;
          stuScores.forEach(s => { if (!s.isAbsent && s.percentage) { totalPct += s.percentage; count++; } });
          const avg = count > 0 ? totalPct / count : 0;
          const stuAtt = attData.filter(a =>
            (a.studentId && a.studentId === stu.id) ||
            (a.studentEmail && stu.email && a.studentEmail.toLowerCase() === stu.email.toLowerCase())
          );
          const present = stuAtt.filter(a => ['present','late'].includes(a.status?.toLowerCase())).length;
          const attPct  = stuAtt.length > 0 ? (present / stuAtt.length) * 100 : 100;
          let tag = 'Good';
          if (avg < 60 || attPct < 85) tag = 'Attention';
          if (avg > 0 && avg < 45) tag = 'At Risk';
          return { ...stu, avgScorePct: avg, attendancePct: attPct, statusTag: tag };
        });
        if (ignore) return;
        final.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setStudents(final);
        setLoading(false);
      });
      return () => { ignore = true; unsubEnroll(); };
    } catch (e) {
      console.error('[Students] fetch error', e);
      setLoading(false);
    }
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Load teacher's classes for invite dropdown
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;

    const qAssign = query(
      collection(db, 'teaching_assignments'),
      where('schoolId', '==', schoolId),
      where('teacherId', '==', teacherData.id),
      where('status', '==', 'active'),
    );
    let ignore = false;
    const unsub = onSnapshot(qAssign, async (snap) => {
      const assignedIds = snap.docs.map(d => d.data().classId).filter(Boolean);
      const legacySnap = await getDocs(query(
        collection(db, 'classes'),
        where('schoolId', '==', schoolId),
        where('teacherId', '==', teacherData.id),
      ));
      if (ignore) return;
      const legacyIds = legacySnap.docs.map(d => d.id);
      const allIds = Array.from(new Set([...assignedIds, ...legacyIds]));
      if (allIds.length === 0) { setTeacherClasses([]); return; }
      const classSnap = await getDocs(query(
        collection(db, 'classes'),
        where('schoolId', '==', schoolId),
      ));
      if (ignore) return;
      setTeacherClasses(
        classSnap.docs.filter(d => allIds.includes(d.id)).map(d => ({ ...d.data(), id: d.id } as Record<string, unknown> & { id: string }))
      );
    });
    return () => { ignore = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  const openInvite = () => {
    setInv({ name: '', email: '', classId: teacherClasses[0]?.id || '', rollNo: '' });
    setInviteOpen(true);
  };

  const handleInvite = async () => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const name  = inv.name.trim();
    const email = inv.email.trim().toLowerCase();
    if (!name)  return toast.error('Student ka naam daalo.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error('Valid email daalo.');
    if (!inv.classId) return toast.error('Class select karo.');

    const cls = teacherClasses.find(c => c.id === inv.classId);
    const schoolId = teacherData.schoolId;
    const branchId = teacherData.branchId || teacherData.branch || '';

    setInviting(true);
    try {
      const dup = await getDocs(query(
        collection(db, 'enrollments'),
        where('schoolId', '==', schoolId),
        where('classId', '==', inv.classId),
        where('studentEmail', '==', email),
      ));
      if (!dup.empty) {
        toast.error('Ye student is class me pehle se enrolled hai.');
        setInviting(false);
        return;
      }

      // Create the student doc first so we can use its real Firestore ID
      // as the canonical studentId in the enrollment. Previously we stored
      // `studentId: email` here, but parent-dashboard queries enrollments by
      // `studentData.id` (the student doc ID). That mismatch made every
      // newly invited student's "My Classes" page show "No Classes Found"
      // even though the enrollment was created.
      const studentDocRef = await auditedAdd(collection(db, 'students'), {
        name,
        email,
        studentId:   email, // legacy/secondary identifier — kept for back-compat with old reads
        classId:     inv.classId,
        className:   cls?.name || '',
        teacherId:   teacherData.id,
        teacherName: teacherData.name || '',
        rollNo:      inv.rollNo.trim(),
        schoolId,
        branchId,
        status:      'Invited',
        createdAt:   serverTimestamp(),
      });

      await auditedAdd(collection(db, 'enrollments'), {
        studentId:    studentDocRef.id, // matches studentData.id used by parent-dashboard reads
        studentEmail: email,            // secondary key for legacy clients
        studentName:  name,
        classId:      inv.classId,
        className:    cls?.name || '',
        teacherId:    teacherData.id,
        teacherName:  teacherData.name || '',
        rollNo:       inv.rollNo.trim(),
        schoolId,
        branchId,
        createdAt:    serverTimestamp(),
      });

      sendStudentInviteEmail({
        to: email,
        studentName: name,
        className: cls?.name || '',
        teacherName: teacherData.name || '',
      }).catch(err => {
        console.error('Invite email failed:', err);
        toast.warning('Student enroll ho gaya, par email nahi gayi.');
      });

      toast.success(`${name} ko invite bhej diya!`);
      setInviteOpen(false);
    } catch (e) {
      console.error('Invite failed:', e);
      toast.error('Invite fail ho gaya. Dubara try karo.');
    } finally {
      setInviting(false);
    }
  };

  if (selectedStudent) return <StudentProfile student={selectedStudent} onBack={() => setSelectedStudent(null)} />;

  const uniqueClasses = [...new Set(students.map(s => s.className).filter(Boolean))];
  const goodCount      = students.filter(s => s.statusTag === 'Good').length;
  const attentionCount = students.filter(s => s.statusTag === 'Attention').length;
  const atRiskCount    = students.filter(s => s.statusTag === 'At Risk').length;

  const scrollToEl = (id: string) => {
    if (typeof window === "undefined") return;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const scrollToList = () =>
    scrollToEl(typeof window !== "undefined" && window.innerWidth < 768 ? "students-list-mobile" : "students-list-desktop");
  const scrollToChips = () =>
    scrollToEl(typeof window !== "undefined" && window.innerWidth < 768 ? "students-filter-chips-mobile" : "students-filter-chips-desktop");

  const setStatusAndScroll = (status: string) => {
    setFilterStatus(status);
    setFilterClass('All');
    scrollToList();
  };
  const resetAndScroll = () => {
    setFilterStatus('All');
    setFilterClass('All');
    setSearch('');
    scrollToList();
  };

  const filtered = students.filter(s => {
    const mSearch = s.name?.toLowerCase().includes(search.toLowerCase()) || s.rollNo?.includes(search);
    const mStatus = filterStatus === 'All' || s.statusTag === filterStatus;
    const mClass  = filterClass  === 'All' || s.className === filterClass;
    return mSearch && mStatus && mClass;
  });

  return (
    <div style={{ fontFamily: 'inherit' }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ═══════════════════ MOBILE VIEW (EduIntellect v2) ═══════════════════ */}
      <div className="md:hidden" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "0 -16px", paddingBottom: 8 }}>

        {/* Page header */}
        <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-[14px]">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-[7px] text-[9px] font-bold uppercase mb-[6px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
              <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: MA.P }} />
              Teacher Dashboard · Students
            </div>
            <h1 className="text-[28px] font-bold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.1px" }}>
              Students
            </h1>
            <div className="text-[12px] font-medium mt-[6px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
              View and manage all your students across classes.
            </div>
          </div>
          <button type="button" onClick={openInvite}
            aria-label="Invite student"
            className="h-[34px] px-[13px] rounded-[11px] flex items-center gap-[5px] active:scale-[0.95] transition-transform flex-shrink-0 mt-[22px]"
            style={{
              background: MA.P, color: "#fff",
              fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
              boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 10px rgba(9,87,247,0.3)",
              fontFamily: MA.FONT, border: "none",
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            Invite
          </button>
        </div>

        {/* Gradient hero */}
        <div className="mx-4 mb-[14px] rounded-[26px] p-[22px] relative overflow-hidden"
          style={{ background: MA.HERO_GRAD, boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
          <div className="relative z-[2]">
            <div className="flex items-center gap-3 mb-[18px]">
              <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center text-white"
                style={{
                  background: "rgba(255,255,255,0.14)",
                  backdropFilter: "blur(22px)",
                  WebkitBackdropFilter: "blur(22px)",
                  border: "0.5px solid rgba(255,255,255,0.22)",
                  boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Total Students</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Across all classes</div>
              </div>
              {(() => {
                const needAttn = attentionCount + atRiskCount;
                const band = atRiskCount > 0 ? "crit" : needAttn > 0 ? "warn" : students.length > 0 ? "good" : "none";
                const bg  = band === "crit" ? "rgba(255,51,85,0.22)" : band === "warn" ? "rgba(255,170,0,0.22)" : band === "good" ? "rgba(0,232,102,0.18)" : "rgba(255,255,255,0.14)";
                const bd  = band === "crit" ? "rgba(255,51,85,0.55)" : band === "warn" ? "rgba(255,170,0,0.55)" : band === "good" ? "rgba(0,232,102,0.5)"  : "rgba(255,255,255,0.22)";
                const fg  = band === "crit" ? "#FF99AA"              : band === "warn" ? "#FFD060"              : band === "good" ? "#6FFFAA"              : "rgba(255,255,255,0.72)";
                const dot = band === "crit" ? "#FF5577"              : band === "warn" ? "#FFCC22"              : band === "good" ? "#00FF88"              : "#fff";
                const label = band === "crit" ? `${atRiskCount} At risk` : band === "warn" ? `${needAttn} Attention` : band === "good" ? "All healthy" : "Empty";
                return (
                  <div className="ml-auto flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[10px] font-bold"
                    style={{ background: bg, border: `0.5px solid ${bd}`, color: fg, letterSpacing: "0.3px" }}>
                    <span className="w-[6px] h-[6px] rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
                    {label}
                  </div>
                );
              })()}
            </div>
            <div className="text-[56px] font-bold text-white leading-none mb-[8px] flex items-baseline gap-[6px]" style={{ letterSpacing: "-2.6px" }}>
              {students.length}
              <span className="text-[22px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-0.4px" }}>
                {students.length === 1 ? "student" : "students"}
              </span>
            </div>
            <div className="text-[13px] font-medium mb-[20px]" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
              {students.length === 0 ? (
                <><b className="text-white font-bold">No students enrolled yet</b> — tap Invite to add your first.</>
              ) : (attentionCount + atRiskCount) > 0 ? (
                <><b className="text-white font-bold">{attentionCount + atRiskCount} need your attention</b> — {goodCount} on track with good scores.</>
              ) : (
                <><b className="text-white font-bold">All students on track</b> — keep the momentum going.</>
              )}
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              <button type="button" onClick={() => setStatusAndScroll("Good")}
                aria-label={`Filter to ${goodCount} good students`}
                className="py-[12px] px-[4px] text-center active:scale-[0.96] transition-transform"
                style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                <div className="text-[18px] font-bold" style={{ color: goodCount > 0 ? "#6FFFAA" : "#fff", letterSpacing: "-0.5px" }}>{goodCount}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Good</div>
              </button>
              <button type="button" onClick={() => setStatusAndScroll("Attention")}
                aria-label={`Filter to ${attentionCount + atRiskCount} students needing attention`}
                className="py-[12px] px-[4px] text-center active:scale-[0.96] transition-transform"
                style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                <div className="text-[18px] font-bold" style={{ color: (attentionCount + atRiskCount) > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.5px" }}>{attentionCount + atRiskCount}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Attention</div>
              </button>
              <button type="button" onClick={scrollToChips}
                aria-label={`Browse ${uniqueClasses.length} classes`}
                className="py-[12px] px-[4px] text-center active:scale-[0.96] transition-transform"
                style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                <div className="text-[18px] font-bold text-white" style={{ letterSpacing: "-0.5px" }}>{uniqueClasses.length}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Classes</div>
              </button>
            </div>
          </div>
        </div>

        {/* Search + filter-reset button */}
        <div className="flex gap-[8px] px-4 mb-[12px]">
          <div className="flex-1 flex items-center gap-[8px] py-[10px] px-[13px] rounded-[12px]"
            style={{ background: MA.CARD, boxShadow: MA.SH_SM }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MA.T4} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
            <input type="text" placeholder="Search by name or roll…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[12px] font-medium"
              style={{ color: search ? MA.T1 : MA.T4, letterSpacing: "-0.1px", fontFamily: MA.FONT }} />
          </div>
          <button type="button"
            onClick={() => { setFilterStatus('All'); setFilterClass('All'); setSearch(''); }}
            aria-label="Reset filters"
            disabled={filterStatus === 'All' && filterClass === 'All' && !search}
            className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center flex-shrink-0 relative active:scale-[0.92] transition-transform"
            style={{
              background: MA.CARD, color: MA.P,
              boxShadow: MA.SH_SM,
              cursor: (filterStatus !== 'All' || filterClass !== 'All' || search) ? "pointer" : "not-allowed",
              opacity: (filterStatus !== 'All' || filterClass !== 'All' || search) ? 1 : 0.6,
              border: "none", fontFamily: MA.FONT,
            }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
            {(filterStatus !== 'All' || filterClass !== 'All') && (
              <span className="absolute top-[6px] right-[6px] w-[8px] h-[8px] rounded-full" style={{ background: MA.RED, border: "2px solid #fff" }} />
            )}
          </button>
        </div>

        {/* Filter chips */}
        <div id="students-filter-chips-mobile" className="flex gap-[7px] overflow-x-auto px-4 pb-[10px] mb-[14px] scroll-mt-4"
          style={{ scrollbarWidth: "none" as const }}>
          {([
            { key: "All",       kind: "status" as const, label: "All",       count: students.length },
            { key: "Attention", kind: "status" as const, label: "Attention", count: attentionCount,  tone: MA.ORANGE },
            ...(atRiskCount > 0 ? [{ key: "At Risk", kind: "status" as const, label: "Critical", count: atRiskCount, tone: MA.RED }] : []),
            { key: "Good",      kind: "status" as const, label: "Good",      count: goodCount },
            ...uniqueClasses.map(c => ({ key: c, kind: "class" as const, label: c, count: students.filter(s => s.className === c).length })),
          ] as const).map(chip => {
            const isActive =
              chip.kind === "status"
                ? (chip.key === "All" ? (filterStatus === "All" && filterClass === "All") : filterStatus === chip.key)
                : filterClass === chip.key;
            const activeTone = "tone" in chip ? (chip as { tone: string }).tone : MA.P;
            const onClickChip = () => {
              if (chip.kind === "status") {
                if (chip.key === "All") { setFilterStatus("All"); setFilterClass("All"); }
                else { setFilterStatus(chip.key as string); }
              } else {
                setFilterClass(chip.key as string);
              }
            };
            return (
              <button key={chip.key} type="button" onClick={onClickChip}
                aria-pressed={isActive}
                className="flex-shrink-0 px-[14px] py-[8px] rounded-full flex items-center gap-[5px] active:scale-[0.96] transition-transform"
                style={{
                  background: isActive ? activeTone : MA.CARD,
                  color: isActive ? "#fff" : MA.T3,
                  fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                  boxShadow: isActive
                    ? `0 1px 2px ${activeTone}33, 0 3px 10px ${activeTone}4d`
                    : "0 0.5px 1px rgba(9,87,247,0.04), 0 2px 6px rgba(9,87,247,0.06)",
                  fontFamily: MA.FONT, border: "none", cursor: "pointer",
                }}>
                {isActive && "tone" in chip && (chip.key === "Attention" || chip.key === "At Risk") && (
                  <span className="w-[5px] h-[5px] rounded-full" style={{ background: "#fff" }} />
                )}
                {chip.label}
                <span className="text-[10px] font-bold px-[7px] py-[1px] rounded-full"
                  style={{
                    background: isActive ? "rgba(255,255,255,0.22)" : MA.SURFACE,
                    color: isActive ? "#fff" : MA.T3,
                    letterSpacing: 0,
                  }}>
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Section header */}
        <div className="flex items-end justify-between px-4 pb-[10px]">
          <div className="flex items-baseline gap-2">
            <div className="text-[15px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.35px" }}>
              {filterStatus === "All" && filterClass === "All"
                ? "All Students"
                : filterClass !== "All"
                  ? filterClass
                  : filterStatus === "At Risk" ? "Critical" : filterStatus}
            </div>
            <div className="text-[11px] font-semibold" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
              {filtered.length} {filtered.length === 1 ? "student" : "total"}
            </div>
          </div>
          <button type="button"
            onClick={() => setStudents(prev => [...prev].sort((a, b) => (a.name || '').localeCompare(b.name || '')))}
            className="text-[12px] font-bold flex items-center gap-[2px] active:opacity-70 py-[4px]"
            style={{ color: MA.P, fontFamily: MA.FONT, background: "none", border: "none", cursor: "pointer" }}>
            Sort <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
          </button>
        </div>

        {/* Student list */}
        <div id="students-list-mobile" className="px-4 scroll-mt-4">
          {loading ? (
            <div className="bg-white rounded-[18px] py-10 flex justify-center" style={{ boxShadow: MA.SH, border: MA.BDR }}>
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: MA.P }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-[22px] pt-9 pb-7 px-5 text-center" style={{ boxShadow: MA.SH, border: MA.BDR }}>
              <div className="relative w-[80px] h-[80px] rounded-[24px] flex items-center justify-center mx-auto mb-[18px]"
                style={{
                  background: "linear-gradient(145deg, rgba(9,87,247,0.1) 0%, rgba(123,63,244,0.12) 100%)",
                  color: MA.P,
                  boxShadow: "0 0 0 8px rgba(9,87,247,0.04), inset 0 1px 0 rgba(255,255,255,0.6)",
                }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                <div className="absolute -top-[6px] -right-[6px] w-[26px] h-[26px] rounded-full flex items-center justify-center text-white text-[14px] font-bold"
                  style={{ background: MA.P, border: "3px solid #fff", boxShadow: "0 2px 6px rgba(9,87,247,0.35)" }}>
                  +
                </div>
              </div>
              <div className="text-[17px] font-bold mb-[6px]" style={{ color: MA.T1, letterSpacing: "-0.5px" }}>
                {search || filterStatus !== "All" || filterClass !== "All" ? "No matches" : "No students yet"}
              </div>
              <div className="text-[13px] font-medium leading-[1.5] mb-[18px] px-[10px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
                {search || filterStatus !== "All" || filterClass !== "All" ? (
                  <>Try a different search or clear the active filters.</>
                ) : (
                  <><b className="font-bold" style={{ color: MA.T1 }}>Invite your first student</b> to start tracking attendance and scores.</>
                )}
              </div>
              <button type="button" onClick={openInvite}
                className="inline-flex items-center gap-[6px] px-[22px] py-[12px] rounded-[14px] active:scale-[0.96] transition-transform"
                style={{
                  background: MA.P, color: "#fff",
                  fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                  boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.32)",
                  fontFamily: MA.FONT, border: "none",
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                Invite Student
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {filtered.map(stu => {
                const tone = mobileStatusTone(stu.statusTag);
                const initials = getInitials(stu.name || '');
                const avBg = mobileAvatarColor(stu.name || '');
                const attPct = Math.round(stu.attendancePct);
                const attTone = attPct >= 85 ? MA.GREEN : attPct >= 60 ? MA.ORANGE : MA.RED;
                const scorePct = stu.avgScorePct;
                const hasScore = scorePct > 0;
                const scoreTone = scorePct >= 75 ? MA.GREEN : scorePct >= 50 ? MA.ORANGE : MA.RED;
                const cardTint = stu.statusTag === 'Good'
                  ? { bg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)", border: "rgba(0,200,83,0.16)" }
                  : stu.statusTag === 'Attention'
                    ? { bg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)", border: "rgba(255,136,0,0.14)" }
                    : { bg: "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)", border: "rgba(255,51,85,0.14)" };
                return (
                  <div key={stu.id}
                    onClick={() => setSelectedStudent(stu)}
                    role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedStudent(stu); } }}
                    {...tilt3D}
                    className="rounded-[18px] p-[14px] relative overflow-hidden active:scale-[0.985] transition-transform cursor-pointer"
                    style={{ background: cardTint.bg, boxShadow: "0 6px 18px rgba(20,40,90,0.05), 0 1px 3px rgba(20,40,90,0.04)", border: `0.5px solid ${cardTint.border}`, ...tilt3DStyle }}>
                    <div className="flex items-center gap-[12px] mb-[12px]">
                      <div className="w-12 h-12 rounded-[15px] flex items-center justify-center text-[14px] font-bold flex-shrink-0"
                        style={{ background: `${avBg}22`, color: avBg, letterSpacing: "0.3px" }}>
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-bold leading-[1.2] truncate" style={{ color: MA.T1, letterSpacing: "-0.35px" }}>
                          {stu.name || "Student"}
                        </div>
                        <div className="flex items-center gap-[5px] text-[11px] font-medium mt-[3px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                          <span className="px-[8px] py-[2px] rounded-[6px] text-[10px] font-bold"
                            style={{ background: "rgba(9,87,247,0.08)", color: MA.P, letterSpacing: "-0.1px" }}>
                            {stu.className || "—"}
                          </span>
                          <span style={{ color: MA.T4 }}>·</span>
                          <span>Roll {stu.rollNo || "—"}</span>
                        </div>
                      </div>
                      <span className="px-[10px] py-[4px] rounded-full text-[10px] font-bold flex items-center gap-[5px] flex-shrink-0"
                        style={{ background: tone.pillBg, color: tone.pillFg, letterSpacing: "0.3px" }}>
                        <span className="w-[5px] h-[5px] rounded-full" style={{ background: tone.pillFg, animation: tone.pulse ? "pulse 2s ease-in-out infinite" : undefined }} />
                        {tone.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-[1px] rounded-[12px] overflow-hidden p-[1px]" style={{ background: MA.SURFACE }}>
                      <div className="bg-white py-[10px] px-[8px] flex items-center justify-center gap-[8px]">
                        <div className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center flex-shrink-0"
                          style={{ background: "rgba(9,87,247,0.12)", color: MA.P }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1"/></svg>
                        </div>
                        <div className="text-left">
                          <div className="text-[8px] font-bold uppercase leading-none" style={{ color: MA.T3, letterSpacing: "1px" }}>Attend</div>
                          <div className="text-[14px] font-bold mt-[3px] leading-none" style={{ color: attTone, letterSpacing: "-0.3px" }}>
                            {attPct}%
                          </div>
                        </div>
                      </div>
                      <div className="bg-white py-[10px] px-[8px] flex items-center justify-center gap-[8px]">
                        <div className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center flex-shrink-0"
                          style={{ background: "rgba(123,63,244,0.14)", color: MA.VIOLET }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                        </div>
                        <div className="text-left">
                          <div className="text-[8px] font-bold uppercase leading-none" style={{ color: MA.T3, letterSpacing: "1px" }}>Score</div>
                          <div className="text-[14px] font-bold mt-[3px] leading-none" style={{ color: hasScore ? scoreTone : MA.T4, letterSpacing: "-0.3px" }}>
                            {hasScore ? `${scorePct.toFixed(1)}%` : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* AI Intelligence */}
        {!loading && students.length > 0 && (
          <div className="mx-4 mt-[14px] rounded-[24px] p-[20px] relative overflow-hidden"
            style={{
              background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
              boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
            }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
            <div className="relative z-[2]">
              <div className="flex items-center gap-[11px] mb-[12px]">
                <div className="w-10 h-10 rounded-[13px] flex items-center justify-center text-[19px]"
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    backdropFilter: "blur(22px)",
                    WebkitBackdropFilter: "blur(22px)",
                    border: "0.5px solid rgba(255,255,255,0.22)",
                    color: "#FFDD55",
                  }}>⚡</div>
                <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.8px" }}>
                  AI Student Intelligence
                </div>
                <div className="ml-auto px-[10px] py-[4px] rounded-full text-[9px] font-bold"
                  style={{ background: "rgba(123,63,244,0.3)", border: "0.5px solid rgba(155,95,255,0.5)", color: "#DCC8FF", letterSpacing: "0.5px" }}>
                  Live
                </div>
              </div>
              {(() => {
                const critical = students.filter(s => s.statusTag === "At Risk");
                const topPerformer = [...students].filter(s => s.avgScorePct > 0).sort((a, b) => b.avgScorePct - a.avgScorePct)[0];
                const needAttn = attentionCount + atRiskCount;
                return (
                  <>
                    <div className="text-[13px] leading-[1.6] mb-[14px]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                      {needAttn === 0 ? (
                        <>All <strong className="text-white font-bold">{students.length} students</strong> are on track — great work keeping the cohort engaged.</>
                      ) : (
                        <>
                          <strong className="text-white font-bold">{needAttn} student{needAttn === 1 ? "" : "s"}</strong> need attention
                          {critical.length > 0 && <> — <strong className="text-white font-bold">{critical[0].name}</strong> is critical.</>}
                          {topPerformer && <> Prioritise <strong className="text-white font-bold">{topPerformer.name}</strong>'s momentum — top performer at {topPerformer.avgScorePct.toFixed(1)}%.</>}
                          {!topPerformer && critical.length === 0 && <> — mostly due to missing scores.</>}
                        </>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-[1px] rounded-[12px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                      <button type="button" onClick={() => setStatusAndScroll("Good")}
                        className="py-[11px] px-[4px] text-center active:scale-[0.96] transition-transform"
                        style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                        <div className="text-[17px] font-bold" style={{ color: goodCount > 0 ? "#6FFFAA" : "#fff", letterSpacing: "-0.4px" }}>{goodCount}</div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Good</div>
                      </button>
                      <button type="button" onClick={() => setStatusAndScroll("Attention")}
                        className="py-[11px] px-[4px] text-center active:scale-[0.96] transition-transform"
                        style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                        <div className="text-[17px] font-bold" style={{ color: needAttn > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.4px" }}>{needAttn}</div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Attention</div>
                      </button>
                      <button type="button" onClick={resetAndScroll}
                        className="py-[11px] px-[4px] text-center active:scale-[0.96] transition-transform"
                        style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                        <div className="text-[17px] font-bold text-white" style={{ letterSpacing: "-0.4px" }}>{students.length}</div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Total</div>
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* Keyframes for status-pill pulse animation */}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh" }}>
        <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-12">

          {/* Header row */}
          <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
            <div>
              <div className="flex items-center gap-[7px] text-[10px] font-bold uppercase mb-[8px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
                <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: MA.P }} />
                Teacher Dashboard · Students
              </div>
              <h1 className="text-[40px] font-bold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.4px" }}>Students</h1>
              <div className="text-[14px] font-medium mt-[8px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
                View and manage all your students across classes.
              </div>
            </div>
            <button type="button" onClick={openInvite}
              aria-label="Invite student"
              className="h-12 px-5 rounded-[13px] flex items-center gap-2 hover:scale-[1.02] active:scale-[0.96] transition-transform"
              style={{
                background: MA.P, color: "#fff",
                fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
                boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 4px 10px rgba(9,87,247,0.3)",
                fontFamily: MA.FONT, border: "none",
              }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
              Invite Student
            </button>
          </div>

          {/* Hero banner */}
          <div className="rounded-[28px] px-8 py-8 relative overflow-hidden mb-5"
            style={{ background: MA.HERO_GRAD, boxShadow: "0 1px 2px rgba(0,8,60,0.15), 0 12px 32px rgba(0,8,60,0.28)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
            <div className="relative z-[2]">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-[52px] h-[52px] rounded-[15px] flex items-center justify-center text-white"
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    backdropFilter: "blur(22px)",
                    WebkitBackdropFilter: "blur(22px)",
                    border: "0.5px solid rgba(255,255,255,0.22)",
                    boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.15)",
                  }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Total Students</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Across all classes</div>
                </div>
                {(() => {
                  const needAttn = attentionCount + atRiskCount;
                  const band = atRiskCount > 0 ? "crit" : needAttn > 0 ? "warn" : students.length > 0 ? "good" : "none";
                  const bg  = band === "crit" ? "rgba(255,51,85,0.22)" : band === "warn" ? "rgba(255,170,0,0.22)" : band === "good" ? "rgba(0,232,102,0.18)" : "rgba(255,255,255,0.14)";
                  const bd  = band === "crit" ? "rgba(255,51,85,0.55)" : band === "warn" ? "rgba(255,170,0,0.55)" : band === "good" ? "rgba(0,232,102,0.5)"  : "rgba(255,255,255,0.22)";
                  const fg  = band === "crit" ? "#FF99AA"              : band === "warn" ? "#FFD060"              : band === "good" ? "#6FFFAA"              : "rgba(255,255,255,0.72)";
                  const dot = band === "crit" ? "#FF5577"              : band === "warn" ? "#FFCC22"              : band === "good" ? "#00FF88"              : "#fff";
                  const label = band === "crit" ? `${atRiskCount} At risk` : band === "warn" ? `${needAttn} Attention` : band === "good" ? "All healthy" : "Empty";
                  return (
                    <div className="ml-auto flex items-center gap-[6px] px-4 py-[7px] rounded-full text-[11px] font-bold"
                      style={{ background: bg, border: `0.5px solid ${bd}`, color: fg, letterSpacing: "0.3px" }}>
                      <span className="w-[6px] h-[6px] rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
                      {label}
                    </div>
                  );
                })()}
              </div>
              <div className="flex items-end justify-between gap-8 flex-wrap">
                <div>
                  <div className="text-[84px] font-bold text-white leading-none mb-[6px] flex items-baseline gap-[10px]" style={{ letterSpacing: "-3.8px" }}>
                    {students.length}
                    <span className="text-[32px] font-bold" style={{ color: "rgba(255,255,255,0.68)", letterSpacing: "-0.6px" }}>
                      {students.length === 1 ? "student" : "students"}
                    </span>
                  </div>
                  <div className="text-[14px] font-medium" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
                    {students.length === 0 ? (
                      <><b className="text-white font-bold">No students enrolled yet</b> — click Invite to add your first.</>
                    ) : (attentionCount + atRiskCount) > 0 ? (
                      <><b className="text-white font-bold">{attentionCount + atRiskCount} need your attention</b> — {goodCount} on track with good scores.</>
                    ) : (
                      <><b className="text-white font-bold">All students on track</b> — keep the momentum going.</>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[380px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <button type="button" onClick={() => setStatusAndScroll("Good")}
                    aria-label={`Filter to ${goodCount} good students`}
                    className="py-4 px-5 text-center hover:brightness-110 active:scale-[0.97] transition-all"
                    style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                    <div className="text-[26px] font-bold" style={{ color: goodCount > 0 ? "#6FFFAA" : "#fff", letterSpacing: "-0.8px" }}>{goodCount}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Good</div>
                  </button>
                  <button type="button" onClick={() => setStatusAndScroll("Attention")}
                    aria-label={`Filter to ${attentionCount + atRiskCount} students needing attention`}
                    className="py-4 px-5 text-center hover:brightness-110 active:scale-[0.97] transition-all"
                    style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                    <div className="text-[26px] font-bold" style={{ color: (attentionCount + atRiskCount) > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.8px" }}>{attentionCount + atRiskCount}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Attention</div>
                  </button>
                  <button type="button" onClick={scrollToChips}
                    aria-label={`Browse ${uniqueClasses.length} classes`}
                    className="py-4 px-5 text-center hover:brightness-110 active:scale-[0.97] transition-all"
                    style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                    <div className="text-[26px] font-bold text-white" style={{ letterSpacing: "-0.8px" }}>{uniqueClasses.length}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Classes</div>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Search + filter reset */}
          <div className="flex gap-3 mb-4">
            <div className="flex-1 flex items-center gap-2 py-[12px] px-4 rounded-[13px]"
              style={{ background: MA.CARD, boxShadow: MA.SH_SM }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MA.T4} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
              <input type="text" placeholder="Search by name or roll…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 bg-transparent outline-none text-[13px] font-medium"
                style={{ color: search ? MA.T1 : MA.T4, letterSpacing: "-0.1px", fontFamily: MA.FONT }} />
            </div>
            <button type="button"
              onClick={() => { setFilterStatus('All'); setFilterClass('All'); setSearch(''); }}
              aria-label="Reset filters"
              disabled={filterStatus === 'All' && filterClass === 'All' && !search}
              className="w-12 h-12 rounded-[13px] flex items-center justify-center flex-shrink-0 relative hover:scale-[1.04] active:scale-[0.92] transition-transform"
              style={{
                background: MA.CARD, color: MA.P,
                boxShadow: MA.SH_SM,
                cursor: (filterStatus !== 'All' || filterClass !== 'All' || search) ? "pointer" : "not-allowed",
                opacity: (filterStatus !== 'All' || filterClass !== 'All' || search) ? 1 : 0.6,
                border: "none", fontFamily: MA.FONT,
              }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
              {(filterStatus !== 'All' || filterClass !== 'All') && (
                <span className="absolute top-[8px] right-[8px] w-[9px] h-[9px] rounded-full" style={{ background: MA.RED, border: "2px solid #fff" }} />
              )}
            </button>
          </div>

          {/* Filter chips */}
          <div id="students-filter-chips-desktop" className="flex gap-2 overflow-x-auto pb-2 mb-5 scroll-mt-4"
            style={{ scrollbarWidth: "none" as const }}>
            {([
              { key: "All",       kind: "status" as const, label: "All",       count: students.length },
              { key: "Attention", kind: "status" as const, label: "Attention", count: attentionCount,  tone: MA.ORANGE },
              ...(atRiskCount > 0 ? [{ key: "At Risk", kind: "status" as const, label: "Critical", count: atRiskCount, tone: MA.RED }] : []),
              { key: "Good",      kind: "status" as const, label: "Good",      count: goodCount },
              ...uniqueClasses.map(c => ({ key: c, kind: "class" as const, label: c, count: students.filter(s => s.className === c).length })),
            ] as const).map(chip => {
              const isActive =
                chip.kind === "status"
                  ? (chip.key === "All" ? (filterStatus === "All" && filterClass === "All") : filterStatus === chip.key)
                  : filterClass === chip.key;
              const activeTone = "tone" in chip ? (chip as { tone: string }).tone : MA.P;
              const onClickChip = () => {
                if (chip.kind === "status") {
                  if (chip.key === "All") { setFilterStatus("All"); setFilterClass("All"); }
                  else { setFilterStatus(chip.key as string); }
                } else {
                  setFilterClass(chip.key as string);
                }
              };
              return (
                <button key={chip.key} type="button" onClick={onClickChip}
                  aria-pressed={isActive}
                  className="flex-shrink-0 px-4 py-[10px] rounded-full flex items-center gap-[6px] hover:scale-[1.03] active:scale-[0.96] transition-transform"
                  style={{
                    background: isActive ? activeTone : MA.CARD,
                    color: isActive ? "#fff" : MA.T3,
                    fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                    boxShadow: isActive
                      ? `0 1px 2px ${activeTone}33, 0 3px 10px ${activeTone}4d`
                      : "0 0.5px 1px rgba(9,87,247,0.04), 0 2px 6px rgba(9,87,247,0.06)",
                    fontFamily: MA.FONT, border: "none", cursor: "pointer",
                  }}>
                  {isActive && "tone" in chip && (chip.key === "Attention" || chip.key === "At Risk") && (
                    <span className="w-[5px] h-[5px] rounded-full" style={{ background: "#fff" }} />
                  )}
                  {chip.label}
                  <span className="text-[11px] font-bold px-[8px] py-[2px] rounded-full"
                    style={{
                      background: isActive ? "rgba(255,255,255,0.22)" : MA.SURFACE,
                      color: isActive ? "#fff" : MA.T3,
                      letterSpacing: 0,
                    }}>
                    {chip.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Section header */}
          <div className="flex items-end justify-between pb-3">
            <div className="flex items-baseline gap-3">
              <div className="text-[18px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.4px" }}>
                {filterStatus === "All" && filterClass === "All"
                  ? "All Students"
                  : filterClass !== "All"
                    ? filterClass
                    : filterStatus === "At Risk" ? "Critical" : filterStatus}
              </div>
              <div className="text-[13px] font-semibold" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                {filtered.length} {filtered.length === 1 ? "student" : "total"}
              </div>
            </div>
            <button type="button"
              onClick={() => setStudents(prev => [...prev].sort((a, b) => (a.name || '').localeCompare(b.name || '')))}
              className="text-[13px] font-bold flex items-center gap-[3px] active:opacity-70 hover:bg-[#EEF4FF] py-[6px] px-3 rounded-[9px] transition-colors"
              style={{ color: MA.P, fontFamily: MA.FONT, background: "none", border: "none", cursor: "pointer" }}>
              Sort <span className="text-[18px] opacity-80 -mt-[3px]">›</span>
            </button>
          </div>

          {/* Student cards grid */}
          <div id="students-list-desktop" className="mb-5 scroll-mt-4">
            {loading ? (
              <div className="bg-white rounded-[22px] py-14 flex justify-center" style={{ boxShadow: MA.SH, border: MA.BDR }}>
                <Loader2 className="w-9 h-9 animate-spin" style={{ color: MA.P }} />
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white rounded-[22px] pt-12 pb-10 px-6 text-center" style={{ boxShadow: MA.SH, border: MA.BDR }}>
                <div className="relative w-[96px] h-[96px] rounded-[28px] flex items-center justify-center mx-auto mb-[20px]"
                  style={{
                    background: "linear-gradient(145deg, rgba(9,87,247,0.1) 0%, rgba(123,63,244,0.12) 100%)",
                    color: MA.P,
                    boxShadow: "0 0 0 10px rgba(9,87,247,0.04), inset 0 1px 0 rgba(255,255,255,0.6)",
                  }}>
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                  <div className="absolute -top-[7px] -right-[7px] w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-[16px] font-bold"
                    style={{ background: MA.P, border: "3px solid #fff", boxShadow: "0 2px 6px rgba(9,87,247,0.35)" }}>
                    +
                  </div>
                </div>
                <div className="text-[20px] font-bold mb-[8px]" style={{ color: MA.T1, letterSpacing: "-0.5px" }}>
                  {search || filterStatus !== "All" || filterClass !== "All" ? "No matches" : "No students yet"}
                </div>
                <div className="text-[14px] font-medium leading-[1.5] mb-[22px] max-w-[460px] mx-auto" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
                  {search || filterStatus !== "All" || filterClass !== "All" ? (
                    <>Try a different search or clear the active filters.</>
                  ) : (
                    <><b className="font-bold" style={{ color: MA.T1 }}>Invite your first student</b> to start tracking attendance and scores.</>
                  )}
                </div>
                <button type="button" onClick={openInvite}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-[14px] hover:scale-[1.02] active:scale-[0.96] transition-transform"
                  style={{
                    background: MA.P, color: "#fff",
                    fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
                    boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.32)",
                    fontFamily: MA.FONT, border: "none",
                  }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                  Invite Student
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(stu => {
                  const tone = mobileStatusTone(stu.statusTag);
                  const initials = getInitials(stu.name || '');
                  const avBg = mobileAvatarColor(stu.name || '');
                  const attPct = Math.round(stu.attendancePct);
                  const attTone = attPct >= 85 ? MA.GREEN : attPct >= 60 ? MA.ORANGE : MA.RED;
                  const scorePct = stu.avgScorePct;
                  const hasScore = scorePct > 0;
                  const scoreTone = scorePct >= 75 ? MA.GREEN : scorePct >= 50 ? MA.ORANGE : MA.RED;
                  const cardTint = stu.statusTag === 'Good'
                    ? { bg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)", border: "rgba(0,200,83,0.16)" }
                    : stu.statusTag === 'Attention'
                      ? { bg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)", border: "rgba(255,136,0,0.14)" }
                      : { bg: "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)", border: "rgba(255,51,85,0.14)" };
                  return (
                    <div key={stu.id}
                      onClick={() => setSelectedStudent(stu)}
                      role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedStudent(stu); } }}
                      {...tilt3D}
                      className="rounded-[20px] p-5 relative overflow-hidden active:scale-[0.99] transition-all cursor-pointer"
                      style={{ background: cardTint.bg, boxShadow: "0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04)", border: `0.5px solid ${cardTint.border}`, ...tilt3DStyle }}>
                      <div className="flex items-center gap-3 mb-[14px]">
                        <div className="w-14 h-14 rounded-[17px] flex items-center justify-center text-[16px] font-bold flex-shrink-0"
                          style={{ background: `${avBg}22`, color: avBg, letterSpacing: "0.3px" }}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[16px] font-bold leading-[1.2] truncate" style={{ color: MA.T1, letterSpacing: "-0.35px" }}>
                            {stu.name || "Student"}
                          </div>
                          <div className="flex items-center gap-[5px] text-[12px] font-medium mt-[4px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                            <span className="px-[9px] py-[2px] rounded-[7px] text-[11px] font-bold"
                              style={{ background: "rgba(9,87,247,0.08)", color: MA.P, letterSpacing: "-0.1px" }}>
                              {stu.className || "—"}
                            </span>
                            <span style={{ color: MA.T4 }}>·</span>
                            <span>Roll {stu.rollNo || "—"}</span>
                          </div>
                        </div>
                        <span className="px-[11px] py-[5px] rounded-full text-[10px] font-bold flex items-center gap-[5px] flex-shrink-0"
                          style={{ background: tone.pillBg, color: tone.pillFg, letterSpacing: "0.3px" }}>
                          <span className="w-[5px] h-[5px] rounded-full" style={{ background: tone.pillFg, animation: tone.pulse ? "pulse 2s ease-in-out infinite" : undefined }} />
                          {tone.label}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-[1px] rounded-[13px] overflow-hidden p-[1px]" style={{ background: MA.SURFACE }}>
                        <div className="bg-white py-[12px] px-[10px] flex items-center justify-center gap-2">
                          <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0"
                            style={{ background: "rgba(9,87,247,0.12)", color: MA.P }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1"/></svg>
                          </div>
                          <div className="text-left">
                            <div className="text-[9px] font-bold uppercase leading-none" style={{ color: MA.T3, letterSpacing: "1px" }}>Attend</div>
                            <div className="text-[16px] font-bold mt-[3px] leading-none" style={{ color: attTone, letterSpacing: "-0.3px" }}>
                              {attPct}%
                            </div>
                          </div>
                        </div>
                        <div className="bg-white py-[12px] px-[10px] flex items-center justify-center gap-2">
                          <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0"
                            style={{ background: "rgba(123,63,244,0.14)", color: MA.VIOLET }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                          </div>
                          <div className="text-left">
                            <div className="text-[9px] font-bold uppercase leading-none" style={{ color: MA.T3, letterSpacing: "1px" }}>Score</div>
                            <div className="text-[16px] font-bold mt-[3px] leading-none" style={{ color: hasScore ? scoreTone : MA.T4, letterSpacing: "-0.3px" }}>
                              {hasScore ? `${scorePct.toFixed(1)}%` : "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* AI Intelligence */}
          {!loading && students.length > 0 && (
            <div className="rounded-[26px] p-7 relative overflow-hidden"
              style={{
                background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
                boxShadow: "0 1px 2px rgba(0,8,60,0.18), 0 12px 32px rgba(0,8,60,0.3)",
              }}>
              <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, transparent 45%)" }} />
              <div className="relative z-[2]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-[48px] h-[48px] rounded-[14px] flex items-center justify-center text-[22px]"
                    style={{
                      background: "rgba(255,255,255,0.14)",
                      backdropFilter: "blur(22px)",
                      WebkitBackdropFilter: "blur(22px)",
                      border: "0.5px solid rgba(255,255,255,0.22)",
                      color: "#FFDD55",
                    }}>⚡</div>
                  <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>
                    AI Student Intelligence
                  </div>
                  <div className="ml-auto px-[11px] py-[5px] rounded-full text-[10px] font-bold"
                    style={{ background: "rgba(123,63,244,0.3)", border: "0.5px solid rgba(155,95,255,0.5)", color: "#DCC8FF", letterSpacing: "0.5px" }}>
                    Live
                  </div>
                </div>
                {(() => {
                  const critical = students.filter(s => s.statusTag === "At Risk");
                  const topPerformer = [...students].filter(s => s.avgScorePct > 0).sort((a, b) => b.avgScorePct - a.avgScorePct)[0];
                  const needAttn = attentionCount + atRiskCount;
                  return (
                    <>
                      <div className="text-[14px] leading-[1.6] mb-5" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                        {needAttn === 0 ? (
                          <>All <strong className="text-white font-bold">{students.length} students</strong> are on track — great work keeping the cohort engaged.</>
                        ) : (
                          <>
                            <strong className="text-white font-bold">{needAttn} student{needAttn === 1 ? "" : "s"}</strong> need attention
                            {critical.length > 0 && <> — <strong className="text-white font-bold">{critical[0].name}</strong> is critical.</>}
                            {topPerformer && <> Prioritise <strong className="text-white font-bold">{topPerformer.name}</strong>'s momentum — top performer at {topPerformer.avgScorePct.toFixed(1)}%.</>}
                            {!topPerformer && critical.length === 0 && <> — mostly due to missing scores.</>}
                          </>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                        <button type="button" onClick={() => setStatusAndScroll("Good")}
                          className="py-4 px-3 text-center hover:brightness-110 active:scale-[0.97] transition-all"
                          style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                          <div className="text-[22px] font-bold" style={{ color: goodCount > 0 ? "#6FFFAA" : "#fff", letterSpacing: "-0.6px" }}>{goodCount}</div>
                          <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Good</div>
                        </button>
                        <button type="button" onClick={() => setStatusAndScroll("Attention")}
                          className="py-4 px-3 text-center hover:brightness-110 active:scale-[0.97] transition-all"
                          style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                          <div className="text-[22px] font-bold" style={{ color: needAttn > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.6px" }}>{needAttn}</div>
                          <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Attention</div>
                        </button>
                        <button type="button" onClick={resetAndScroll}
                          className="py-4 px-3 text-center hover:brightness-110 active:scale-[0.97] transition-all"
                          style={{ background: "rgba(0,20,80,0.55)", border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
                          <div className="text-[22px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{students.length}</div>
                          <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Total</div>
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

      {/* ═══════════════════ INVITE — MOBILE BOTTOM SHEET ═══════════════════ */}
      {inviteOpen && (
        <>
          {/* Backdrop (mobile) */}
          <div
            className="md:hidden fixed inset-0 z-[60]"
            style={{ background: "rgba(0,10,40,0.5)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", animation: "sheetFade .35s cubic-bezier(.2,.9,.3,1) both" }}
            onClick={() => !inviting && setInviteOpen(false)}
          />

          {/* Bottom sheet (mobile) */}
          <div
            className="md:hidden fixed left-0 right-0 bottom-0 z-[61]"
            role="dialog" aria-modal="true" aria-label="Invite Student"
            style={{
              background: MA.CARD,
              borderRadius: "26px 26px 0 0",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 -20px 60px rgba(0,8,60,0.3)",
              animation: "sheetUp .45s cubic-bezier(.34,1.56,.64,1) both",
              fontFamily: MA.FONT,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-[40px] h-[5px] mx-auto mt-[10px] mb-[6px] rounded-full flex-shrink-0" style={{ background: "rgba(9,87,247,0.2)" }} />

            {/* Head */}
            <div className="flex items-center gap-[12px] pt-[10px] pb-[14px] px-[18px] flex-shrink-0" style={{ borderBottom: "0.5px solid rgba(9,87,247,0.08)" }}>
              <div className="w-10 h-10 rounded-[13px] flex items-center justify-center text-white flex-shrink-0" style={{ background: MA.P }}>
                <Mail size={18} strokeWidth={2.2} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[17px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.4px" }}>Invite Student</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>Send an email invite to join your class</div>
              </div>
              <button type="button" aria-label="Close"
                onClick={() => !inviting && setInviteOpen(false)}
                className="w-[30px] h-[30px] rounded-[10px] flex items-center justify-center flex-shrink-0 active:scale-[0.92]"
                style={{ background: MA.SURFACE, color: MA.T2, border: "none", cursor: inviting ? "not-allowed" : "pointer", fontFamily: MA.FONT }}>
                <X size={16} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-[18px]" style={{ scrollbarWidth: "none" as const }}>
              {/* Full Name */}
              <div className="mb-[14px]">
                <label htmlFor="invite-name-mobile" className="block text-[9px] font-bold uppercase mb-[8px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                  Full Name <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
                </label>
                <input id="invite-name-mobile"
                  type="text"
                  value={inv.name}
                  onChange={e => setInv({ ...inv, name: e.target.value })}
                  placeholder="e.g. Aarav Sharma"
                  disabled={inviting}
                  className="w-full outline-none"
                  style={{
                    padding: "13px 14px",
                    borderRadius: 12,
                    background: inv.name ? "#fff" : MA.SURFACE,
                    border: `0.5px solid ${inv.name ? "rgba(9,87,247,0.2)" : "rgba(9,87,247,0.08)"}`,
                    fontSize: 14, fontWeight: inv.name ? 600 : 500, color: MA.T1, letterSpacing: "-0.2px",
                    fontFamily: MA.FONT,
                  }} />
              </div>

              {/* Email */}
              <div className="mb-[14px]">
                <label htmlFor="invite-email-mobile" className="block text-[9px] font-bold uppercase mb-[8px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                  Email <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
                </label>
                <input id="invite-email-mobile"
                  type="email" inputMode="email" autoComplete="email"
                  value={inv.email}
                  onChange={e => setInv({ ...inv, email: e.target.value })}
                  placeholder="student@example.com"
                  disabled={inviting}
                  className="w-full outline-none"
                  style={{
                    padding: "13px 14px",
                    borderRadius: 12,
                    background: inv.email ? "#fff" : MA.SURFACE,
                    border: `0.5px solid ${inv.email ? "rgba(9,87,247,0.2)" : "rgba(9,87,247,0.08)"}`,
                    fontSize: 14, fontWeight: inv.email ? 600 : 500, color: MA.T1, letterSpacing: "-0.2px",
                    fontFamily: MA.FONT,
                  }} />
              </div>

              {/* Class segmented + Roll No */}
              <div className="grid gap-[10px] mb-[14px]" style={{ gridTemplateColumns: "2fr 1fr" }}>
                <div>
                  <div className="block text-[9px] font-bold uppercase mb-[8px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                    Class <span className="text-[11px] font-bold" style={{ color: MA.RED }}>*</span>
                  </div>
                  {teacherClasses.length === 0 ? (
                    <div className="rounded-[11px] px-[12px] py-[11px] text-[12px] font-medium" style={{ background: MA.SURFACE, color: MA.T3, letterSpacing: "-0.1px" }}>
                      No classes assigned.
                    </div>
                  ) : (
                    <div className="flex gap-[4px] p-[3px] rounded-[11px] overflow-x-auto" style={{ background: MA.SURFACE, scrollbarWidth: "none" as const }}>
                      {teacherClasses.map(c => {
                        const isActive = inv.classId === c.id;
                        return (
                          <button key={c.id} type="button"
                            onClick={() => setInv({ ...inv, classId: c.id })}
                            disabled={inviting}
                            aria-pressed={isActive}
                            className="flex-1 py-[9px] px-[10px] rounded-[8px] text-center active:scale-[0.96] transition-all"
                            style={{
                              background: isActive ? "#fff" : "transparent",
                              color: isActive ? MA.P : MA.T3,
                              fontSize: 13, fontWeight: isActive ? 800 : 700, letterSpacing: "-0.2px",
                              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(9,87,247,0.12)" : "none",
                              fontFamily: MA.FONT, border: "none",
                              cursor: inviting ? "not-allowed" : "pointer", whiteSpace: "nowrap", minWidth: 64,
                            }}>
                            {c.name || c.id}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label htmlFor="invite-roll-mobile" className="block text-[9px] font-bold uppercase mb-[8px] flex items-center gap-[6px]" style={{ color: MA.T3, letterSpacing: "1.5px" }}>
                    Roll No <span className="font-semibold" style={{ color: MA.T4, letterSpacing: 0, textTransform: "none", fontSize: 10 }}>(opt.)</span>
                  </label>
                  <input id="invite-roll-mobile"
                    type="text"
                    value={inv.rollNo}
                    onChange={e => setInv({ ...inv, rollNo: e.target.value })}
                    placeholder="214"
                    disabled={inviting}
                    className="w-full outline-none"
                    style={{
                      padding: "13px 14px",
                      borderRadius: 12,
                      background: inv.rollNo ? "#fff" : MA.SURFACE,
                      border: `0.5px solid ${inv.rollNo ? "rgba(9,87,247,0.2)" : "rgba(9,87,247,0.08)"}`,
                      fontSize: 14, fontWeight: inv.rollNo ? 600 : 500, color: MA.T1, letterSpacing: "-0.2px",
                      fontFamily: MA.FONT,
                    }} />
                </div>
              </div>

              {/* Info callout */}
              <div className="flex gap-[10px] items-start px-[14px] py-[12px] rounded-[14px]"
                style={{ background: "rgba(9,87,247,0.06)", border: "0.5px solid rgba(9,87,247,0.18)" }}>
                <div className="w-7 h-7 rounded-[9px] flex items-center justify-center text-white flex-shrink-0" style={{ background: MA.P }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="8"/></svg>
                </div>
                <div className="flex-1 text-[11px] leading-[1.5] font-medium" style={{ color: MA.T2, letterSpacing: "-0.1px" }}>
                  <b className="font-bold" style={{ color: MA.T1 }}>Invite email student ko bhej di jayegi</b> with a login link. Student can sign in with the same email and access the portal.
                </div>
              </div>
            </div>

            {/* Sticky actions */}
            <div className="flex gap-[10px] px-[18px] pt-[14px] pb-[18px] flex-shrink-0" style={{ background: MA.CARD, borderTop: "0.5px solid rgba(9,87,247,0.08)" }}>
              <button type="button" onClick={() => setInviteOpen(false)} disabled={inviting}
                className="h-[46px] rounded-[14px] active:scale-[0.96] transition-transform"
                style={{
                  flex: "0 0 100px",
                  background: MA.SURFACE, color: MA.T2,
                  fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                  fontFamily: MA.FONT, border: "none",
                  cursor: inviting ? "not-allowed" : "pointer",
                  opacity: inviting ? 0.55 : 1,
                }}>
                Cancel
              </button>
              <button type="button" onClick={handleInvite} disabled={inviting}
                className="flex-1 h-[46px] rounded-[14px] flex items-center justify-center gap-[6px] active:scale-[0.97] transition-transform"
                style={{
                  background: MA.P, color: "#fff",
                  fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
                  boxShadow: "0 1px 2px rgba(9,87,247,0.25), 0 6px 16px rgba(9,87,247,0.35)",
                  fontFamily: MA.FONT, border: "none",
                  cursor: inviting ? "not-allowed" : "pointer",
                  opacity: inviting ? 0.65 : 1,
                }}>
                {inviting ? (
                  <Loader2 className="w-[14px] h-[14px] animate-spin" />
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Send invite
                  </>
                )}
              </button>
            </div>

            <style>{`
              @keyframes sheetFade { from { opacity: 0; } to { opacity: 1; } }
              @keyframes sheetUp   { from { transform: translateY(100%); } to { transform: translateY(0); } }
            `}</style>
          </div>

          {/* ═══════════ INVITE — DESKTOP CENTERED DIALOG (unchanged) ═══════════ */}
          <div
            className="hidden md:flex"
            onClick={() => !inviting && setInviteOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.55)', zIndex: 60, alignItems: 'center', justifyContent: 'center', padding: 16 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 440, background: T.s0, borderRadius: 16, overflow: 'hidden', border: `1px solid ${T.bdr}` }}
            >
              {/* Header */}
              <div style={{ padding: '18px 20px', borderBottom: `1px solid ${T.bdr}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: T.blueL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Mail size={15} color={T.blue} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.ink0 }}>Invite Student</div>
                    <div style={{ fontSize: 11, color: T.ink2, marginTop: 1 }}>Email ke through invite bhejo</div>
                  </div>
                </div>
                <button type="button"
                  onClick={() => !inviting && setInviteOpen(false)}
                  style={{ width: 28, height: 28, borderRadius: 7, background: T.s1, border: `1px solid ${T.bdr}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  <X size={14} color={T.ink2} />
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: T.ink1, display: 'block', marginBottom: 5 }}>Full name *</label>
                  <input
                    type="text"
                    value={inv.name}
                    onChange={e => setInv({ ...inv, name: e.target.value })}
                    placeholder="e.g. Aarav Sharma"
                    disabled={inviting}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${T.bdr}`, background: T.s0, fontSize: 13, color: T.ink0, fontFamily: 'inherit', outline: 'none' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: T.ink1, display: 'block', marginBottom: 5 }}>Email *</label>
                  <input
                    type="email"
                    value={inv.email}
                    onChange={e => setInv({ ...inv, email: e.target.value })}
                    placeholder="student@example.com"
                    disabled={inviting}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${T.bdr}`, background: T.s0, fontSize: 13, color: T.ink0, fontFamily: 'inherit', outline: 'none' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: T.ink1, display: 'block', marginBottom: 5 }}>Class *</label>
                    <select
                      value={inv.classId}
                      onChange={e => setInv({ ...inv, classId: e.target.value })}
                      disabled={inviting || teacherClasses.length === 0}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${T.bdr}`, background: T.s0, fontSize: 13, color: T.ink0, fontFamily: 'inherit', outline: 'none', appearance: 'none' }}
                    >
                      <option value="">
                        {teacherClasses.length === 0 ? 'No classes assigned' : 'Select class…'}
                      </option>
                      {teacherClasses.map(c => (
                        <option key={c.id} value={c.id}>{c.name || c.id}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ width: 110 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: T.ink1, display: 'block', marginBottom: 5 }}>Roll No.</label>
                    <input
                      type="text"
                      value={inv.rollNo}
                      onChange={e => setInv({ ...inv, rollNo: e.target.value })}
                      placeholder="Optional"
                      disabled={inviting}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${T.bdr}`, background: T.s0, fontSize: 13, color: T.ink0, fontFamily: 'inherit', outline: 'none' }}
                    />
                  </div>
                </div>

                <div style={{ background: T.blueL, border: `1px solid ${T.blueL}`, borderRadius: 9, padding: '9px 12px', fontSize: 11, color: T.blue, lineHeight: 1.5 }}>
                  Invite email student ko bhej di jayegi with login link. Same email se login karke apna portal access kar sakte hain.
                </div>
              </div>

              {/* Footer */}
              <div style={{ padding: '14px 20px', borderTop: `1px solid ${T.bdr}`, display: 'flex', gap: 8, justifyContent: 'flex-end', background: T.s1 }}>
                <button type="button"
                  onClick={() => setInviteOpen(false)}
                  disabled={inviting}
                  style={{ padding: '9px 16px', borderRadius: 9, background: T.s0, border: `1px solid ${T.bdr}`, color: T.ink1, fontSize: 12, fontWeight: 500, cursor: inviting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
                <button type="button"
                  onClick={handleInvite}
                  disabled={inviting}
                  style={{ padding: '9px 18px', borderRadius: 9, background: T.ink0, border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: inviting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, opacity: inviting ? 0.7 : 1 }}
                >
                  {inviting ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                  {inviting ? 'Sending…' : 'Send invite'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
