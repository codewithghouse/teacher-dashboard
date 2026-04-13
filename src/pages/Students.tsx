import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StudentProfile from "@/components/StudentProfile";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs, deleteDoc, doc as firestoreDoc } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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

  useEffect(() => {
    if (!teacherData?.id) return;
    setLoading(true);
    try {
      const qEnroll = query(collection(db, 'enrollments'), where('teacherId', '==', teacherData.id));
      const unsubEnroll = onSnapshot(qEnroll, async (snap) => {
        const enrolledDocs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        const uniqueMap = new Map();
        enrolledDocs.forEach(e => {
          const sid = e.studentId || e.studentEmail;
          if (!uniqueMap.has(sid)) {
            uniqueMap.set(sid, {
              id: sid, name: e.studentName, email: e.studentEmail,
              rollNo: e.rollNo || (800 + Math.floor(Math.random() * 100)).toString(),
              className: e.className, classId: e.classId,
              initials: e.studentName?.substring(0, 2).toUpperCase() || 'ST',
              attendancePct: 0, avgScorePct: 0, statusTag: 'Good',
            });
          }
        });
        const studentsArray = Array.from(uniqueMap.values());
        const [scoresSnap, attSnap] = await Promise.all([
          getDocs(query(collection(db, 'test_scores'),  where('teacherId', '==', teacherData.id))),
          getDocs(query(collection(db, 'attendance'),   where('teacherId', '==', teacherData.id))),
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
        final.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setStudents(final);
        setLoading(false);
      });
      return () => unsubEnroll();
    } catch (e) {
      console.error('Students fetch error', e);
      setLoading(false);
    }
  }, [teacherData?.id]);

  const handleDelete = async (stu: any) => {
    if (!teacherData?.id) return;
    if (!confirm(`Remove ${stu.name} from your class?`)) return;
    try {
      const q = query(
        collection(db, 'enrollments'),
        where('teacherId', '==', teacherData.id),
        where('studentEmail', '==', stu.email),
        where('classId', '==', stu.classId)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        await deleteDoc(firestoreDoc(db, 'enrollments', snap.docs[0].id));
        toast.success(`${stu.name} removed successfully.`);
      }
    } catch { toast.error('Failed to remove student.'); }
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
    <div style={{ background: T.s1, fontFamily: 'inherit' }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ── Dark Hero ──────────────────────────────────────────────────────── */}
      <div style={{ background: T.ink0 }} className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-5">
        <p style={{ fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>
          All students
        </p>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', lineHeight: 1.15 }}>
          Your students
        </h1>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginTop: 3 }}>
          View and manage students across classes.
        </p>
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
                <div key={stu.id} style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, overflow: 'hidden' }}>
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
                          onClick={() => handleDelete(stu)}
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
                      onClick={() => setSelectedStudent(stu)}
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