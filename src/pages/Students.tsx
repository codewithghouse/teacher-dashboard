import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StudentProfile from "@/components/StudentProfile";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, getDocs,
  doc as firestoreDoc, serverTimestamp,
} from "firebase/firestore";
import { auditedAdd, auditedDelete } from "../lib/auditedWrites";
import { Loader2, X, UserPlus, Mail } from "lucide-react";
import { toast } from "sonner";
import { sendStudentInviteEmail } from "../lib/resend";

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF',
  green: '#087F5B', greenL: '#EBFBEE', green2: '#2F9E44',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  teal: '#0C8599', tealL: '#E3FAFC',
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

// ── Status helpers ───────────────────────────────────────────────────────────
const statusBand = (tag: string) =>
  tag === 'Good' ? T.green2 : tag === 'Attention' ? T.amber : T.red;
const statusBadge = (tag: string) =>
  tag === 'Good'      ? { bg: T.greenL, color: T.green }
  : tag === 'Attention' ? { bg: T.amberL, color: T.amber }
  : { bg: T.redL, color: T.red };
const scoreBarColor = (pct: number) =>
  pct >= 75 ? T.green2 : pct >= 50 ? T.amber : T.red;

// ── SVG Icons ────────────────────────────────────────────────────────────────
const IcoUser   = ({ color = T.blue  }: { color?: string }) => (
  <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 10.5c0 0 1.5-2 5-2s5 2 5 2"/><circle cx="6.5" cy="5" r="2.5"/>
  </svg>
);
const IcoCheck  = ({ color = T.green }: { color?: string }) => (
  <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,7 5,10.5 11.5,3"/>
  </svg>
);
const IcoTrend  = ({ color = T.amber }: { color?: string }) => (
  <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,9.5 4.5,6 7,8 10.5,3.5"/><polyline points="8.5,3.5 10.5,3.5 10.5,5.5"/>
  </svg>
);
const IcoAlert  = ({ color = T.red   }: { color?: string }) => (
  <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 1.5L12 11.5H1L6.5 1.5z"/>
    <line x1="6.5" y1="5" x2="6.5" y2="8"/><circle cx="6.5" cy="9.5" r=".6" fill={color} stroke="none"/>
  </svg>
);
const IcoEye = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="2.5"/>
    <path d="M1,6 C1,6 3,2 6,2 C9,2 11,6 11,6 C11,6 9,10 6,10 C3,10 1,6 1,6Z"/>
  </svg>
);
const IcoTrash = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,3 10.5,3"/>
    <path d="M4,3v-1a1,1 0 0,1 1-1h2a1,1 0 0,1 1,1v1"/>
    <rect x="2" y="3" width="8" height="8" rx="1"/>
  </svg>
);
// Tab bar
const IcoGrid  = ({ a }: { a: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={a ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round">
    <rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="11" y="2" width="5" height="5" rx="1.2"/>
    <rect x="2" y="11" width="5" height="5" rx="1.2"/><rect x="11" y="11" width="5" height="5" rx="1.2"/>
  </svg>
);
const IcoStudents = ({ a }: { a: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={a ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round">
    <path d="M2 15V9L9 5l7 4v6"/><rect x="6.5" y="11" width="5" height="4" rx=".5"/>
  </svg>
);
const IcoTests2 = ({ a }: { a: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={a ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round">
    <rect x="2" y="2" width="14" height="14" rx="2"/>
    <line x1="5.5" y1="7" x2="12.5" y2="7"/><line x1="5.5" y1="10" x2="9.5" y2="10"/>
  </svg>
);
const IcoProfile2 = ({ a }: { a: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={a ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round">
    <circle cx="9" cy="7" r="3"/><path d="M3 17c0 0 1.5-4 6-4s6 4 6 4"/>
  </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────
export default function Students() {
  const { teacherData } = useAuth();
  const navigate        = useNavigate();
  const location        = useLocation();

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

  const handleDelete = async (stu: any) => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    if (!confirm(`Remove ${stu.name} from your class?`)) return;
    try {
      const q = query(
        collection(db, 'enrollments'),
        where('schoolId', '==', teacherData.schoolId),
        where('teacherId', '==', teacherData.id),
        where('studentEmail', '==', stu.email),
        where('classId', '==', stu.classId)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        await auditedDelete(firestoreDoc(db, 'enrollments', snap.docs[0].id));
        toast.success(`${stu.name} removed successfully.`);
      }
    } catch (e) {
      console.error('[Students] remove failed', e);
      toast.error('Failed to remove student.');
    }
  };

  if (selectedStudent) return <StudentProfile student={selectedStudent} onBack={() => setSelectedStudent(null)} />;

  const uniqueClasses = [...new Set(students.map(s => s.className).filter(Boolean))];
  const goodCount      = students.filter(s => s.statusTag === 'Good').length;
  const attentionCount = students.filter(s => s.statusTag === 'Attention').length;
  const atRiskCount    = students.filter(s => s.statusTag === 'At Risk').length;

  const filtered = students.filter(s => {
    const mSearch = s.name?.toLowerCase().includes(search.toLowerCase()) || s.rollNo?.includes(search);
    const mStatus = filterStatus === 'All' || s.statusTag === filterStatus;
    const mClass  = filterClass  === 'All' || s.className === filterClass;
    return mSearch && mStatus && mClass;
  });

  // Metrics
  const metrics = [
    { ico: <IcoUser color={T.blue}  />, icoBg: T.blueL,  val: students.length, valColor: T.blue,  lbl: 'Total students',   badgeTxt: 'All',      badgeBg: T.blueL,  badgeColor: T.blue,  barFill: T.blue,  barW: 100 },
    { ico: <IcoCheck color={T.green}/>, icoBg: T.greenL, val: goodCount,        valColor: T.green, lbl: 'Performing well',  badgeTxt: 'Good',     badgeBg: T.greenL, badgeColor: T.green, barFill: T.green2, barW: students.length > 0 ? (goodCount / students.length) * 100 : 0 },
    { ico: <IcoTrend color={T.amber}/>, icoBg: T.amberL, val: attentionCount,   valColor: T.amber, lbl: 'Need attention',   badgeTxt: 'Watch',    badgeBg: T.amberL, badgeColor: T.amber, barFill: T.amber, barW: students.length > 0 ? (attentionCount / students.length) * 100 : 0 },
    { ico: <IcoAlert color={T.red}  />, icoBg: T.redL,   val: atRiskCount,      valColor: T.ink1,  lbl: 'At risk',         badgeTxt: atRiskCount === 0 ? 'Secure' : 'Alert', badgeBg: atRiskCount === 0 ? T.greenL : T.redL, badgeColor: atRiskCount === 0 ? T.green : T.red, barFill: T.red, barW: students.length > 0 ? (atRiskCount / students.length) * 100 : 0 },
  ];

  // Tab bar
  const tabs = [
    { label: 'Dashboard', path: '/',         icon: (a: boolean) => <IcoGrid      a={a} /> },
    { label: 'Students',  path: '/students', icon: (a: boolean) => <IcoStudents  a={a} /> },
    { label: 'Tests',     path: '/tests',    icon: (a: boolean) => <IcoTests2    a={a} /> },
    { label: 'Profile',   path: '/settings', icon: (a: boolean) => <IcoProfile2 a={a} /> },
  ];
  const activePath = location.pathname;

  return (
    <div style={{ fontFamily: 'inherit' }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <div className="md:hidden" style={{ background: T.s1 }}>

      {/* ── Dark Hero ──────────────────────────────────────────────────────── */}
      <div className="-mx-4 sm:-mx-6 px-[22px] pb-5 bg-[#162E93] md:bg-[#08090C]">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>
              All students
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', lineHeight: 1.15 }}>
              Your students
            </h1>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginTop: 3 }}>
              View and manage students across classes.
            </p>
          </div>
          <button
            onClick={openInvite}
            style={{ padding: '7px 11px', borderRadius: 9, background: '#fff', border: 'none', color: '#162E93', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            <UserPlus size={13} /> Invite
          </button>
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 13, flexWrap: 'wrap' }}>
          {[
            { icon: <IcoUser color="rgba(255,255,255,0.4)" />, val: students.length,  lbl: 'Total' },
            { icon: <IcoCheck color="rgba(255,255,255,0.4)" />, val: goodCount,       lbl: 'Performing well' },
            { icon: <IcoTrend color="rgba(255,255,255,0.4)" />, val: attentionCount,  lbl: 'Need attention' },
          ].map((c, i) => (
            <div key={i} style={{ padding: '5px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', fontSize: 10, color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {c.icon}
              <strong style={{ color: '#fff', fontWeight: 500 }}>{c.val}</strong> {c.lbl}
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 md:px-0 pt-4 flex flex-col gap-3">

        {/* Metric grid */}
        <div className="grid grid-cols-2 gap-2">
          {metrics.map((m, i) => (
            <div key={i} style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 7 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: m.icoBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {m.ico}
                </div>
                <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: m.badgeBg, color: m.badgeColor, whiteSpace: 'nowrap' }}>
                  {m.badgeTxt}
                </span>
              </div>
              <div style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.4px', lineHeight: 1, color: m.valColor }}>{m.val}</div>
              <div style={{ fontSize: 10, color: T.ink2, marginTop: 2 }}>{m.lbl}</div>
              <div style={{ height: 3, borderRadius: 2, background: T.s2, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, background: m.barFill, width: `${m.barW}%`, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', width: 13, height: 13 }}
            viewBox="0 0 14 14" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6" cy="6" r="4"/><line x1="9" y1="9" x2="12.5" y2="12.5"/>
          </svg>
          <input
            type="text"
            placeholder="Search by name or roll number..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 12px 10px 30px', borderRadius: 11, border: `1px solid ${T.bdr}`, background: T.s0, fontSize: 12, color: T.ink1, fontFamily: 'inherit', outline: 'none' }}
          />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { val: filterStatus, set: setFilterStatus, options: ['All status', 'Good', 'Attention', 'At Risk'], keys: ['All', 'Good', 'Attention', 'At Risk'] },
            { val: filterClass,  set: setFilterClass,  options: ['All classes', ...uniqueClasses],              keys: ['All', ...uniqueClasses] },
          ].map((sel, i) => (
            <select
              key={i}
              value={sel.val}
              onChange={e => sel.set(e.target.value)}
              style={{ flex: 1, padding: '9px 10px', borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.s0, fontSize: 11, color: T.ink2, fontFamily: 'inherit', outline: 'none', appearance: 'none' }}
            >
              {sel.options.map((opt, j) => (
                <option key={j} value={sel.keys[j]}>{opt}</option>
              ))}
            </select>
          ))}
        </div>

        {/* Student list */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: T.blue }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: '24px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: T.ink2 }}>
              {search || filterStatus !== 'All' || filterClass !== 'All'
                ? 'No students match your filters.'
                : 'No students enrolled yet.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(stu => {
              const av      = avStyle(stu.name || '');
              const badge   = statusBadge(stu.statusTag);
              const band    = statusBand(stu.statusTag);
              const attColor = stu.attendancePct >= 85 ? T.blue : T.amber;
              const scoreColor = scoreBarColor(stu.avgScorePct);
              const initials = getInitials(stu.name || '');
              return (
                <div
                  key={stu.id}
                  onClick={() => setSelectedStudent(stu)}
                  role="button"
                  tabIndex={0}
                  className="clickable-card"
                  style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: 'hidden' }}
                >
                  {/* Colored band */}
                  <div style={{ height: 3, background: band }} />
                  <div style={{ padding: 13 }}>
                    {/* Top row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 11, background: av.bg, color: av.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
                          {initials}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500, color: T.ink1, letterSpacing: '-0.1px' }}>{stu.name}</div>
                          <div style={{ fontSize: 10, color: T.ink2, marginTop: 2 }}>
                            Class {stu.className} · Roll {stu.rollNo}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: badge.bg, color: badge.color }}>
                          {stu.statusTag}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(stu); }}
                          style={{ width: 26, height: 26, borderRadius: 7, background: T.s1, border: `1px solid ${T.bdr}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >
                          <IcoTrash />
                        </button>
                      </div>
                    </div>

                    {/* Progress bars */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 }}>
                      {[
                        { lbl: 'Attendance', pct: stu.attendancePct, color: attColor },
                        { lbl: 'Avg. score', pct: stu.avgScorePct,   color: scoreColor },
                      ].map(bar => (
                        <div key={bar.lbl} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 11, color: T.ink2, width: 60, flexShrink: 0 }}>{bar.lbl}</div>
                          <div style={{ flex: 1, height: 4, borderRadius: 2, background: T.s2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 2, background: bar.color, width: `${Math.min(100, bar.pct)}%` }} />
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 500, width: 36, textAlign: 'right', color: bar.color, flexShrink: 0 }}>
                            {bar.pct > 0 ? `${bar.pct.toFixed(0)}%` : '—'}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* View profile button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedStudent(stu); }}
                      style={{ width: '100%', padding: 9, borderRadius: 10, background: T.ink0, border: 'none', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                    >
                      <IcoEye /> View profile
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
      <div className="hidden md:block">

        {/* ── Header row ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-slate-900 leading-tight tracking-tight">Students</h1>
            <p className="text-sm text-slate-500 mt-1">View and manage all your students across classes.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="6" cy="6" r="4"/><line x1="9" y1="9" x2="12.5" y2="12.5"/>
              </svg>
              <input
                type="text"
                placeholder="Search by name or roll..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-64 h-10 pl-9 pr-3 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 outline-none cursor-pointer"
            >
              <option value="All">All status</option>
              <option value="Good">Good</option>
              <option value="Attention">Attention</option>
              <option value="At Risk">At Risk</option>
            </select>
            <select
              value={filterClass}
              onChange={e => setFilterClass(e.target.value)}
              className="h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 outline-none cursor-pointer"
            >
              <option value="All">All classes</option>
              {uniqueClasses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              onClick={openInvite}
              className="h-10 px-4 rounded-lg bg-[#1e3272] hover:bg-[#162552] text-white text-sm font-semibold flex items-center gap-2 whitespace-nowrap"
            >
              <UserPlus size={15} /> Invite Student
            </button>
          </div>
        </div>

        {/* ── Student card grid (4-col) ──────────────────────────── */}
        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 bg-white border border-slate-200 rounded-2xl text-center">
            <p className="text-sm text-slate-500">
              {search || filterStatus !== 'All' || filterClass !== 'All' ? 'No students match your filters.' : 'No students enrolled yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {filtered.map(stu => {
              const av = avStyle(stu.name || '');
              const badge = statusBadge(stu.statusTag);
              const initials = getInitials(stu.name || '');
              return (
                <div
                  key={stu.id}
                  onClick={() => setSelectedStudent(stu)}
                  role="button"
                  tabIndex={0}
                  className="clickable-card bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
                >

                  {/* Top: avatar + badge */}
                  <div className="flex items-start justify-between mb-3">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-base font-bold"
                      style={{ background: av.fg, color: '#fff' }}
                    >
                      {initials}
                    </div>
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: badge.bg, color: badge.color }}>
                      {stu.statusTag}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 leading-tight">{stu.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Class {stu.className} • Roll: {stu.rollNo}</p>

                  {/* Stats */}
                  <div className="space-y-1.5 mt-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Attendance</span>
                      <span className={`font-bold ${stu.attendancePct >= 85 ? 'text-emerald-600' : 'text-amber-600'}`}>{stu.attendancePct.toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Avg. Score</span>
                      <span className="font-bold" style={{ color: scoreBarColor(stu.avgScorePct) }}>{stu.avgScorePct > 0 ? `${stu.avgScorePct.toFixed(1)}%` : '—'}</span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedStudent(stu); }}
                    className="mt-4 w-full py-2.5 rounded-lg bg-[#1e3272] text-white text-xs font-semibold hover:bg-[#162552]"
                  >
                    View Profile
                  </button>
                </div>
              );
            })}
          </div>
        )}

      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

      {/* ═══════════════════ INVITE STUDENT MODAL ═══════════════════ */}
      {inviteOpen && (
        <div
          onClick={() => !inviting && setInviteOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
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
              <button
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
              <button
                onClick={() => setInviteOpen(false)}
                disabled={inviting}
                style={{ padding: '9px 16px', borderRadius: 9, background: T.s0, border: `1px solid ${T.bdr}`, color: T.ink1, fontSize: 12, fontWeight: 500, cursor: inviting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
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
      )}

      {/* ── Mobile bottom tab bar ─────────────────────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40" style={{ background: T.s0, borderTop: `1px solid ${T.bdr}`, padding: '8px 16px 16px', display: 'flex', justifyContent: 'space-between' }}>
        {tabs.map(tab => {
          const isActive = tab.path === activePath;
          return (
            <button key={tab.path} onClick={() => navigate(tab.path)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}>
              {tab.icon(isActive)}
              <span style={{ fontSize: 9, color: isActive ? T.blue : T.ink2, fontWeight: isActive ? 500 : 400 }}>{tab.label}</span>
              {isActive && <div style={{ width: 12, height: 2.5, borderRadius: 2, background: T.blue, marginTop: -2 }} />}
            </button>
          );
        })}
      </div>

    </div>
  );
}