import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Loader2 } from 'lucide-react';
import { db } from '../lib/firebase';
import {
  collection, query, where, getDocs, doc, getDoc, onSnapshot,
  addDoc, serverTimestamp, updateDoc
} from 'firebase/firestore';
import { useAuth } from '../lib/AuthContext';

interface StudentProfileProps {
  student: any;
  onBack: () => void;
}

// ── Design tokens (matches Students.tsx) ──────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF',
  green2: '#2F9E44', greenL: '#EBFBEE',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  purple: '#6741D9', purpleL: '#F3F0FF',
};

// ── Avatar color palette (same as Students.tsx) ───────────────────────────────
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

// ── Inline SVG icons ──────────────────────────────────────────────────────────
const IcoChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="10,3 5,8 10,13" />
  </svg>
);
const IcoStar = ({ filled }: { filled?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
    <polygon points="7.5,1.5 9.5,5.5 14,6.2 10.8,9.3 11.6,13.8 7.5,11.7 3.4,13.8 4.2,9.3 1,6.2 5.5,5.5" />
  </svg>
);
const IcoCheck = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1.5,7 5,10.5 11.5,3" />
  </svg>
);
const IcoAlert = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5,1.5 L11.5,10.5 L1.5,10.5 Z" /><line x1="6.5" y1="5.5" x2="6.5" y2="7.5" /><circle cx="6.5" cy="9" r="0.5" fill="currentColor" />
  </svg>
);
const IcoTrend = ({ up }: { up: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={up ? T.green2 : T.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {up
      ? <><polyline points="1,9 5,5 8,7 12,3" /><polyline points="9,3 12,3 12,6" /></>
      : <><polyline points="1,3 5,7 8,5 12,9" /><polyline points="9,9 12,9 12,6" /></>
    }
  </svg>
);
const IcoMsg = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1,1 h12 a1,1 0 0 1 1,1 v7 a1,1 0 0 1,-1,1 H4 L1,13 V2 a1,1 0 0 1,1,-1z" />
  </svg>
);
const IcoPhone = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1,1 h3 l1.5,3.5 -1.5,1.5 a9,9 0 0 0 3.5,3.5 l1.5,-1.5 L12.5,9.5 v2.5 a1,1 0 0 1,-1,1 C5.5,13 1,8 1,2 a1,1 0 0 1,1,-1z" />
  </svg>
);
const IcoBook = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4,5 h8 a3,3 0 0 1 3,3 v13 a3,3 0 0 0,-3,-3 H4 Z" /><path d="M24,5 h-8 a3,3 0 0 0,-3,3 v13 a3,3 0 0 1,3,-3 H24 Z" />
  </svg>
);

export default function StudentProfile({ student, onBack }: StudentProfileProps) {
  const { teacherData } = useAuth();
  const [activeTab, setActiveTab] = useState('Overview');
  const [recentTests, setRecentTests]   = useState<any[]>([]);
  const [allTests, setAllTests]         = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [conceptMastery, setConceptMastery] = useState<any[]>([]);
  const [masterProfile, setMasterProfile]   = useState<any>(null);
  const [submissionPct, setSubmissionPct]   = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Feedback states
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isSubmitting, setIsSubmitting]         = useState(false);
  const [pastFeedbacks, setPastFeedbacks]       = useState<any[]>([]);

  // Behaviour states
  const [positiveNote, setPositiveNote]             = useState('');
  const [improvementNote, setImprovementNote]       = useState('');
  const [manualRating, setManualRating]             = useState(5);
  const [isSubmittingBehaviour, setIsSubmittingBehaviour] = useState(false);
  const [pastBehaviours, setPastBehaviours]         = useState<any[]>([]);

  const attPct = student.attendancePct || 100;
  const avgPct = student.avgScorePct   || 0;

  // ─── Data Fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!student.id) return;
    setLoading(true);

    const unsubMaster = onSnapshot(doc(db, 'students', student.id), (d) => {
      if (d.exists()) setMasterProfile(d.data());
    });

    const fetchData = async () => {
      try {
        const q1 = query(collection(db, 'test_scores'), where('studentId', '==', student.id));
        const q2 = student.email
          ? query(collection(db, 'test_scores'), where('studentEmail', '==', student.email.toLowerCase()))
          : null;

        const [s1, s2] = await Promise.all([getDocs(q1), q2 ? getDocs(q2) : Promise.resolve({ docs: [] as any[] })]);
        const map = new Map<string, any>();
        [...s1.docs, ...s2.docs].forEach(d => { if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() }); });

        const sorted = Array.from(map.values()).sort(
          (a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)
        );

        setAllTests(sorted);
        setRecentTests(sorted.slice(0, 6));

        // Recent Activity from test scores
        const acts = sorted.slice(0, 3).map((s: any, i: number) => ({
          type: 'test',
          title: `Scored ${s.percentage?.toFixed(0) || 0}% in ${s.testName || 'Assessment'}`,
          subtitle: `${s.subject || s.testName || 'Test'} · ${
            s.timestamp
              ? formatTimeAgo(new Date(s.timestamp.seconds * 1000))
              : 'Recently'
          }`,
          dotColor: i === 0 ? T.green2 : i === 1 ? T.blue : T.amber,
        }));
        if (acts.length === 0)
          acts.push({ type: 'info', title: 'Academic log started', subtitle: 'No recent activity', dotColor: T.ink2 });
        setRecentActivity(acts);

        // Concept mastery
        const uniqueTestIds = [...new Set(sorted.map((s: any) => s.testId).filter(Boolean))];
        if (uniqueTestIds.length > 0) {
          const snaps = await Promise.all(uniqueTestIds.map(id => getDoc(doc(db, 'tests_registry', id as string))));
          const testsData = snaps.map(t => ({ id: t.id, ...(t.data() as any) }));
          const topicsMap = new Map<string, { totalPts: number; count: number }>();

          sorted.forEach((s: any) => {
            const mt = testsData.find(t => t.id === s.testId);
            if (mt?.topics?.length > 0) {
              mt.topics.forEach((topic: string) => {
                const curr = topicsMap.get(topic) || { totalPts: 0, count: 0 };
                curr.totalPts += s.percentage || 0;
                curr.count += 1;
                topicsMap.set(topic, curr);
              });
            }
          });

          setConceptMastery(
            Array.from(topicsMap.entries())
              .map(([name, v]) => ({ name, score: Number((v.totalPts / v.count).toFixed(0)) }))
              .sort((a, b) => b.score - a.score)
              .slice(0, 4)
          );
        }

        // Submission rate
        try {
          const aq = query(collection(db, 'assignments'), where('classId', '==', student.classId || ''));
          const aSnap = await getDocs(aq);
          if (!aSnap.empty) {
            const total = aSnap.size;
            const subQ = query(collection(db, 'assignment_submissions'), where('studentId', '==', student.id));
            const subSnap = await getDocs(subQ);
            setSubmissionPct(Math.min(100, Math.round((subSnap.size / total) * 100)));
          }
        } catch { /* graceful fail */ }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    return () => unsubMaster();
  }, [student.id]);

  // Feedback listener
  useEffect(() => {
    if (activeTab !== 'Feedback' || !student.id) return;
    const q1 = query(collection(db, 'performance_feedback'), where('studentId', '==', student.id));
    const q2 = student.email
      ? query(collection(db, 'performance_feedback'), where('studentEmail', '==', student.email.toLowerCase()))
      : null;

    const process = (docs: any[]) => {
      const unique = Array.from(new Map(docs.map(d => [d.id, { id: d.id, ...d.data() }])).values());
      unique.sort((a: any, b: any) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setPastFeedbacks(unique);
    };
    const u1 = onSnapshot(q1, s => process(s.docs));
    const u2 = q2 ? onSnapshot(q2, s => process(s.docs)) : () => {};
    return () => { u1(); u2(); };
  }, [activeTab, student.id]);

  // Behaviour listener
  useEffect(() => {
    if (activeTab !== 'Behaviour' || !student.id) return;
    const q1 = query(collection(db, 'parent_notes'), where('studentId', '==', student.id));
    const q2 = student.email
      ? query(collection(db, 'parent_notes'), where('studentEmail', '==', student.email.toLowerCase()))
      : null;

    const process = (docs: any[]) => {
      const unique = Array.from(new Map(docs.map(d => [d.id, { id: d.id, ...d.data() }])).values());
      unique.sort((a: any, b: any) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setPastBehaviours(unique);
    };
    const u1 = onSnapshot(q1, s => process(s.docs));
    const u2 = q2 ? onSnapshot(q2, s => process(s.docs)) : () => {};
    return () => { u1(); u2(); };
  }, [activeTab, student.id]);

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleSaveFeedback = async () => {
    if (!feedbackContent.trim()) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'performance_feedback'), {
        studentId: student.id,
        studentEmail: student.email || '',
        studentName: student.name,
        teacherId: teacherData?.id || 'unknown',
        teacherName: teacherData?.name || 'Faculty',
        subject: student.className || 'General',
        content: feedbackContent.trim(),
        timestamp: serverTimestamp(),
      });
      setFeedbackContent('');
    } catch (e) { console.error(e); }
    finally { setIsSubmitting(false); }
  };

  const handleSaveBehaviour = async () => {
    if (!positiveNote.trim() && !improvementNote.trim()) return;
    setIsSubmittingBehaviour(true);
    try {
      if (positiveNote.trim())
        await addDoc(collection(db, 'parent_notes'), {
          teacherId: teacherData?.id || 'unknown',
          teacherName: teacherData?.name || 'Faculty',
          studentId: student.id, studentEmail: student.email || '',
          studentName: student.name,
          parentName: `Parent of ${student.name}`,
          subject: student.className || 'General',
          content: positiveNote.trim(),
          category: 'positive', status: 'Sent', from: 'teacher',
          createdAt: serverTimestamp(),
        });

      if (improvementNote.trim())
        await addDoc(collection(db, 'parent_notes'), {
          teacherId: teacherData?.id || 'unknown',
          teacherName: teacherData?.name || 'Faculty',
          studentId: student.id, studentEmail: student.email || '',
          studentName: student.name,
          parentName: `Parent of ${student.name}`,
          subject: student.className || 'General',
          content: improvementNote.trim(),
          category: 'improvement', status: 'Sent', from: 'teacher',
          createdAt: serverTimestamp(),
        });

      const qEnroll = query(
        collection(db, 'enrollments'),
        where('studentId', '==', student.id),
        where('teacherId', '==', teacherData?.id)
      );
      const enrollSnap = await getDocs(qEnroll);
      if (!enrollSnap.empty)
        await updateDoc(doc(db, 'enrollments', enrollSnap.docs[0].id), {
          manualBehaviourRating: manualRating,
          lastBehaviourUpdate: serverTimestamp(),
        });

      setPositiveNote('');
      setImprovementNote('');
    } catch (e) { console.error(e); }
    finally { setIsSubmittingBehaviour(false); }
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const overallTrend = (() => {
    if (allTests.length < 2) return null;
    const recent   = allTests.slice(0, Math.ceil(allTests.length / 2));
    const previous = allTests.slice(Math.ceil(allTests.length / 2));
    const recentAvg   = recent.reduce((s, t) => s + (t.percentage || 0), 0) / recent.length;
    const previousAvg = previous.reduce((s, t) => s + (t.percentage || 0), 0) / previous.length;
    return Number((recentAvg - previousAvg).toFixed(1));
  })();

  const scoreBarColor = (score: number) =>
    score >= 75 ? T.green2 : score >= 50 ? T.amber : T.red;

  const isAtRisk = avgPct < 50 || attPct < 75;

  const tabs = ['Overview', 'Academic', 'Attendance', 'Assignments', 'Concepts', 'Feedback', 'Behaviour'];

  // ─── Behaviour chart data ─────────────────────────────────────────────────
  const behaviourChartData = (() => {
    const months: Record<string, any> = {};
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth() - 4, 1);

    const rawJoin = masterProfile?.enrolledAt || masterProfile?.createdAt || student?.enrolledAt;
    if (rawJoin) {
      const jd = rawJoin.toDate ? rawJoin.toDate() : new Date(rawJoin);
      start = new Date(jd.getFullYear(), jd.getMonth(), 1);
    }

    let tmp = new Date(start);
    while (tmp <= now) {
      const key = tmp.toLocaleString('default', { month: 'short' }) + ' ' + tmp.getFullYear().toString().slice(-2);
      months[key] = { m: tmp.toLocaleString('default', { month: 'short' }), key, pos: 0, improv: 0, count: 0 };
      tmp.setMonth(tmp.getMonth() + 1);
    }

    pastBehaviours.forEach(n => {
      const d = n.createdAt?.toDate ? n.createdAt.toDate() : new Date();
      const key = d.toLocaleString('default', { month: 'short' }) + ' ' + d.getFullYear().toString().slice(-2);
      if (months[key]) {
        if (n.category === 'positive') months[key].pos++;
        else months[key].improv++;
        months[key].count++;
      }
    });

    const curKey = now.toLocaleString('default', { month: 'short' }) + ' ' + now.getFullYear().toString().slice(-2);
    return Object.values(months).map((d: any) => ({
      m: d.m,
      score: d.count === 0
        ? 5.0
        : d.key === curKey && manualRating
          ? manualRating
          : Math.min(5, Math.max(1, 5 - d.improv * 0.3 + d.pos * 0.1)),
    }));
  })();

  const av = avStyle(student.name || '');
  const initials = getInitials(student.name || '');
  const conceptColor = (score: number) =>
    score >= 90 ? T.green2 : score >= 75 ? T.amber : T.red;

  // ─── Input style ──────────────────────────────────────────────────────────
  const inp = {
    width: '100%', padding: '11px 12px', borderRadius: 12,
    border: `1px solid ${T.bdr}`, background: T.s1,
    fontSize: 13, color: T.ink1, fontFamily: 'inherit', outline: 'none',
    resize: 'none' as const, lineHeight: 1.5,
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'inherit', minHeight: '100vh', background: T.s1 }} className="text-left pb-24">

      {/* ── Dark Hero Header ──────────────────────────────────────────────── */}
      <div
        style={{ background: T.ink0 }}
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-6"
      >
        {/* Back link */}
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 500,
            fontFamily: 'inherit', padding: '14px 0 10px 0',
          }}
        >
          <IcoChevronLeft />
          All students
        </button>

        {/* Avatar + name row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: av.bg, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontWeight: 700, fontSize: 18,
            color: av.color, flexShrink: 0, letterSpacing: '-0.5px',
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 3 }}>
              Student profile
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: '#fff', letterSpacing: '-0.3px', lineHeight: 1.2, marginBottom: 4 }}>
              {student.name}
            </h1>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
              {[
                student.className && `Class ${student.className}`,
                student.rollNo && `Roll ${student.rollNo}`,
                student.email,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        {/* Hero action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{
            flex: 1, padding: '9px 14px', borderRadius: 11,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.07)',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <IcoMsg />
            Message
          </button>
          <button style={{
            flex: 1, padding: '9px 14px', borderRadius: 11,
            background: T.blue, border: 'none',
            color: '#fff', fontSize: 12, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <IcoPhone />
            Contact parent
          </button>
        </div>
      </div>

      {/* ── Scrollable tab bar ────────────────────────────────────────────── */}
      <div style={{
        background: T.s0, borderBottom: `1px solid ${T.bdr}`,
        overflowX: 'auto', display: 'flex', gap: 0,
        scrollbarWidth: 'none',
      }}
        className="-mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8"
      >
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '13px 14px 11px',
              fontSize: 12, fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? T.ink0 : T.ink2,
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
              borderBottom: activeTab === tab ? `2px solid ${T.ink0}` : '2px solid transparent',
              transition: 'color 0.15s',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      <div className="px-0 sm:px-0 md:px-0 pt-4 flex flex-col gap-3">

        {/* ══ OVERVIEW TAB ══════════════════════════════════════════════════ */}
        {activeTab === 'Overview' && (
          <>
            {/* Quick stats 2×2 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Attendance', value: `${attPct.toFixed(0)}%`, color: attPct >= 85 ? T.green2 : attPct >= 75 ? T.amber : T.red, pct: attPct },
                { label: 'Avg. Score', value: avgPct > 0 ? `${avgPct.toFixed(1)}%` : 'N/A', color: avgPct >= 75 ? T.green2 : avgPct >= 50 ? T.amber : T.red, pct: avgPct },
                { label: 'Submission', value: submissionPct != null ? `${submissionPct}%` : 'N/A', color: T.blue, pct: submissionPct ?? 0 },
                { label: 'Tests Taken', value: String(allTests.length), color: T.purple, pct: null },
              ].map((m, i) => (
                <div key={i} style={{
                  background: T.s0, border: `1px solid ${T.bdr}`,
                  borderRadius: 16, padding: '14px 13px',
                }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: m.color, letterSpacing: '-0.5px', lineHeight: 1, marginBottom: 4 }}>
                    {m.value}
                  </div>
                  <div style={{ fontSize: 10, color: T.ink2, fontWeight: 500, marginBottom: m.pct !== null ? 8 : 0 }}>
                    {m.label}
                  </div>
                  {m.pct !== null && (
                    <div style={{ height: 3, background: T.s2, borderRadius: 99 }}>
                      <div style={{ height: 3, width: `${Math.min(100, m.pct)}%`, background: m.color, borderRadius: 99, transition: 'width 0.7s' }} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Personal info card */}
            <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden' }}>
              <div style={{ padding: '13px 14px 10px', borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  Personal info
                </div>
              </div>
              {[
                { label: 'Full name', value: student.name },
                { label: 'Roll number', value: student.rollNo || '—' },
                { label: 'Class', value: student.className || '—' },
                { label: 'Date of birth', value: masterProfile?.dob ? formatDOB(masterProfile.dob) : '—' },
                { label: 'Parent contact', value: masterProfile?.parentPhone || masterProfile?.contact || '—' },
                { label: 'Email', value: student.email || '—' },
              ].map((row, i, arr) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '11px 14px',
                  borderBottom: i < arr.length - 1 ? `1px solid ${T.s2}` : 'none',
                }}>
                  <span style={{ fontSize: 12, color: T.ink2 }}>{row.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: T.ink1, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Academic performance card */}
            <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  Academic performance
                </div>
                <span style={{ fontSize: 10, color: T.ink2 }}>Last {recentTests.length} tests</span>
              </div>
              {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80 }}>
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: T.ink2 }} />
                </div>
              ) : recentTests.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {recentTests.map((t, i) => (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 12, color: T.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                          {t.testName || `Test ${i + 1}`}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: scoreBarColor(t.percentage || 0) }}>
                          {t.percentage?.toFixed(0) || 0}%
                        </span>
                      </div>
                      <div style={{ height: 4, background: T.s2, borderRadius: 99 }}>
                        <div style={{
                          height: 4, width: `${t.percentage || 0}%`,
                          background: scoreBarColor(t.percentage || 0),
                          borderRadius: 99, transition: 'width 0.7s',
                        }} />
                      </div>
                    </div>
                  ))}
                  {overallTrend !== null && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      paddingTop: 10, borderTop: `1px solid ${T.s2}`,
                    }}>
                      <span style={{ fontSize: 11, color: T.ink2 }}>Overall trend</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: overallTrend >= 0 ? T.green2 : T.red, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <IcoTrend up={overallTrend >= 0} />
                        {overallTrend >= 0 ? '+' : ''}{overallTrend}%
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 80, color: T.ink2 }}>
                  <IcoBook />
                  <p style={{ fontSize: 11, marginTop: 6 }}>No test records yet</p>
                </div>
              )}
            </div>

            {/* Recent activity */}
            <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: '14px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
                Recent activity
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {recentActivity.map((act, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: act.dotColor, marginTop: 4, flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, lineHeight: 1.4 }}>{act.title}</p>
                      <p style={{ fontSize: 10, color: T.ink2, marginTop: 2 }}>{act.subtitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk / no-risk alert */}
            <div style={{
              background: isAtRisk ? '#FFF5F5' : '#EBFBEE',
              border: `1px solid ${isAtRisk ? '#FFD8D8' : '#C3FAD4'}`,
              borderRadius: 16, padding: '12px 13px',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <div style={{ color: isAtRisk ? T.red : T.green2, marginTop: 1 }}>
                {isAtRisk ? <IcoAlert /> : <IcoCheck />}
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: isAtRisk ? T.red : T.green2, marginBottom: 2 }}>
                  {isAtRisk ? 'Risk alert' : 'No risk alerts'}
                </p>
                <p style={{ fontSize: 11, color: isAtRisk ? '#C92A2A' : '#2F9E44' }}>
                  {isAtRisk
                    ? [avgPct < 50 && 'Low academic performance.', attPct < 75 && 'Attendance below threshold.'].filter(Boolean).join(' ')
                    : 'Student is performing well across all metrics.'
                  }
                </p>
              </div>
            </div>
          </>
        )}

        {/* ══ ACADEMIC TAB ══════════════════════════════════════════════════ */}
        {activeTab === 'Academic' && (
          <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden' }}>
            <div style={{ padding: '13px 14px', borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                All test scores
              </div>
            </div>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100 }}>
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: T.ink2 }} />
              </div>
            ) : allTests.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {allTests.map((t, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 14px',
                    borderBottom: i < allTests.length - 1 ? `1px solid ${T.s2}` : 'none',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.testName || 'Assessment'}
                      </p>
                      <p style={{ fontSize: 10, color: T.ink2, marginTop: 2 }}>
                        {t.subject || '—'} · {t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                      </p>
                    </div>
                    <div style={{
                      fontSize: 13, fontWeight: 700,
                      color: scoreBarColor(t.percentage || 0),
                      marginLeft: 12, flexShrink: 0,
                    }}>
                      {t.percentage?.toFixed(0) || 0}%
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 100, color: T.ink2 }}>
                <IcoBook />
                <p style={{ fontSize: 11, marginTop: 6 }}>No test records found</p>
              </div>
            )}
          </div>
        )}

        {/* ══ ATTENDANCE TAB ════════════════════════════════════════════════ */}
        {activeTab === 'Attendance' && (
          <>
            <div style={{
              background: T.s0, border: `1px solid ${T.bdr}`,
              borderRadius: 18, padding: '20px 14px', textAlign: 'center',
            }}>
              <div style={{
                fontSize: 48, fontWeight: 700, letterSpacing: '-1px', lineHeight: 1,
                color: attPct >= 85 ? T.green2 : attPct >= 75 ? T.amber : T.red, marginBottom: 4,
              }}>
                {attPct.toFixed(0)}%
              </div>
              <div style={{ fontSize: 12, color: T.ink2 }}>Overall attendance</div>
              <div style={{ height: 6, background: T.s2, borderRadius: 99, margin: '14px 0 0' }}>
                <div style={{ height: 6, width: `${attPct}%`, borderRadius: 99, transition: 'width 0.7s', background: attPct >= 85 ? T.green2 : attPct >= 75 ? T.amber : T.red }} />
              </div>
            </div>
            <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: '20px 14px', textAlign: 'center', color: T.ink2, fontSize: 12 }}>
              Detailed attendance records will appear here as data is recorded.
            </div>
          </>
        )}

        {/* ══ ASSIGNMENTS TAB ═══════════════════════════════════════════════ */}
        {activeTab === 'Assignments' && (
          <>
            <div style={{
              background: T.s0, border: `1px solid ${T.bdr}`,
              borderRadius: 18, padding: '20px 14px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-1px', lineHeight: 1, color: T.blue, marginBottom: 4 }}>
                {submissionPct != null ? `${submissionPct}%` : 'N/A'}
              </div>
              <div style={{ fontSize: 12, color: T.ink2 }}>Submission rate</div>
              {submissionPct != null && (
                <div style={{ height: 6, background: T.s2, borderRadius: 99, margin: '14px 0 0' }}>
                  <div style={{ height: 6, width: `${submissionPct}%`, borderRadius: 99, background: T.blue, transition: 'width 0.7s' }} />
                </div>
              )}
            </div>
            <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: '20px 14px', textAlign: 'center', color: T.ink2, fontSize: 12 }}>
              Assignment submission history will appear here.
            </div>
          </>
        )}

        {/* ══ CONCEPTS TAB ══════════════════════════════════════════════════ */}
        {activeTab === 'Concepts' && (
          <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: '14px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>
              Concept mastery
            </div>
            {conceptMastery.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {conceptMastery.map((c, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: T.ink1, fontWeight: 500 }}>{c.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: conceptColor(c.score) }}>{c.score}%</span>
                    </div>
                    <div style={{ height: 5, background: T.s2, borderRadius: 99 }}>
                      <div style={{ height: 5, width: `${c.score}%`, borderRadius: 99, background: conceptColor(c.score), transition: 'width 0.7s' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 80, color: T.ink2 }}>
                <IcoBook />
                <p style={{ fontSize: 11, marginTop: 6 }}>No concept data available yet</p>
              </div>
            )}
          </div>
        )}

        {/* ══ FEEDBACK TAB ══════════════════════════════════════════════════ */}
        {activeTab === 'Feedback' && (
          <>
            {/* Write feedback */}
            <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                Write feedback
              </div>
              <textarea
                value={feedbackContent}
                onChange={e => setFeedbackContent(e.target.value)}
                placeholder="Enter growth feedback for this student..."
                rows={4}
                style={inp}
              />
              <button
                onClick={handleSaveFeedback}
                disabled={isSubmitting || !feedbackContent.trim()}
                style={{
                  padding: '11px 14px', borderRadius: 12, background: T.green2, border: 'none',
                  color: '#fff', fontSize: 12, fontWeight: 600, cursor: isSubmitting || !feedbackContent.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: isSubmitting || !feedbackContent.trim() ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <IcoCheck />}
                Send feedback
              </button>
            </div>

            {/* Past feedbacks */}
            <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden' }}>
              <div style={{ padding: '13px 14px', borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  Past feedback
                </div>
              </div>
              {pastFeedbacks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px 14px', color: T.ink2, fontSize: 12 }}>No past feedback yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {pastFeedbacks.map((fb, i) => (
                    <div key={i} style={{
                      padding: '12px 14px',
                      borderBottom: i < pastFeedbacks.length - 1 ? `1px solid ${T.s2}` : 'none',
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: T.green2, marginTop: 4, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 12, color: T.ink1, lineHeight: 1.55, marginBottom: 4 }}>"{fb.content}"</p>
                          <p style={{ fontSize: 10, color: T.ink2 }}>
                            {fb.subject} · {fb.teacherName} · {fb.timestamp?.toDate ? fb.timestamp.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : 'Syncing...'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ BEHAVIOUR TAB ═════════════════════════════════════════════════ */}
        {activeTab === 'Behaviour' && (() => {
          const pNotes = pastBehaviours.filter(b => b.category === 'positive');
          const iNotes = pastBehaviours.filter(b => b.category === 'improvement');
          const calcRating = pastBehaviours.length === 0
            ? 5.0
            : Math.min(5, Math.max(1, 5 - iNotes.length * 0.3 + pNotes.length * 0.1));
          const finalRating = manualRating || calcRating;

          return (
            <>
              {/* Behaviour rating */}
              <div style={{
                background: T.s0, border: `1px solid ${T.bdr}`,
                borderRadius: 18, padding: '14px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
              }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>
                    Behaviour rating
                  </div>
                  <div style={{ fontSize: 11, color: T.ink2 }}>{manualRating ? 'Manual override active' : 'Auto-calculated'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onClick={() => setManualRating(star)}
                      style={{
                        width: 34, height: 34, borderRadius: 10, border: 'none', cursor: 'pointer',
                        background: finalRating >= star ? T.amber : T.s2,
                        color: finalRating >= star ? '#fff' : T.ink2,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.15s',
                      }}
                    >
                      <IcoStar filled={finalRating >= star} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Positive highlights */}
                <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.green2 }} />
                    <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                      Positive highlights
                    </div>
                  </div>
                  <textarea
                    value={positiveNote}
                    onChange={e => setPositiveNote(e.target.value)}
                    placeholder="e.g. Highly engaged in group project..."
                    rows={3}
                    style={inp}
                  />
                </div>

                {/* Areas for improvement */}
                <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.amber }} />
                    <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                      Areas for improvement
                    </div>
                  </div>
                  <textarea
                    value={improvementNote}
                    onChange={e => setImprovementNote(e.target.value)}
                    placeholder="e.g. Needs more focus during labs..."
                    rows={3}
                    style={inp}
                  />
                </div>
              </div>

              {/* Send to parent button */}
              <button
                onClick={handleSaveBehaviour}
                disabled={isSubmittingBehaviour || (!positiveNote.trim() && !improvementNote.trim())}
                style={{
                  width: '100%', padding: '13px 14px', borderRadius: 13, background: T.ink0, border: 'none',
                  color: '#fff', fontSize: 12, fontWeight: 600, cursor: isSubmittingBehaviour || (!positiveNote.trim() && !improvementNote.trim()) ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: isSubmittingBehaviour || (!positiveNote.trim() && !improvementNote.trim()) ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {isSubmittingBehaviour ? <Loader2 className="w-3 h-3 animate-spin" /> : <IcoCheck />}
                Send to parent dashboard
              </button>

              {/* Behaviour trend chart */}
              <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, padding: '14px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
                  Behaviour trend
                </div>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={behaviourChartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="bGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={T.purple} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={T.purple} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={T.s2} />
                      <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: T.ink2 }} />
                      <YAxis domain={[1, 5]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: T.ink2 }} />
                      <Tooltip
                        contentStyle={{ borderRadius: 10, border: `1px solid ${T.bdr}`, fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                      />
                      <Area type="monotone" dataKey="score" stroke={T.purple} strokeWidth={2.5} fill="url(#bGrad)" dot={{ r: 3.5, fill: T.purple, strokeWidth: 2, stroke: '#fff' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Behaviour history */}
              <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden' }}>
                <div style={{ padding: '13px 14px', borderBottom: `1px solid ${T.s2}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                    Behaviour history
                  </div>
                </div>
                {pastBehaviours.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 14px', color: T.ink2, fontSize: 12 }}>No notes yet</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {pastBehaviours.map((b, i) => {
                      const isNeg = b.category === 'improvement';
                      return (
                        <div key={i} style={{
                          padding: '12px 14px',
                          borderBottom: i < pastBehaviours.length - 1 ? `1px solid ${T.s2}` : 'none',
                          background: isNeg ? T.amberL : T.greenL,
                        }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: isNeg ? T.amber : T.green2, marginTop: 4, flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                              <p style={{ fontSize: 12, color: T.ink1, lineHeight: 1.5, marginBottom: 3 }}>"{b.content}"</p>
                              <p style={{ fontSize: 10, color: T.ink2 }}>
                                {b.createdAt?.toDate ? b.createdAt.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : 'Syncing...'}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          );
        })()}

      </div>
    </div>
  );
}

// ─── Utility Functions ────────────────────────────────────────────────────────

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function formatDOB(dob: any): string {
  if (!dob) return '—';
  try {
    if (dob.toDate) return dob.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const d = new Date(dob);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { /* ignore */ }
  return String(dob);
}