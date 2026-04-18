import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import CreateAssignment from "@/components/CreateAssignment";
import GradeAssignment from "@/components/GradeAssignment";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  doc, deleteDoc, getDocs
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF', blueB: '#BAC8FF',
  green: '#087F5B', greenL: '#EBFBEE', green2: '#2F9E44',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── SVG icons ────────────────────────────────────────────────────────────────
const IcoDoc = ({ color = T.blue }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="1.5" width="10" height="11" rx="1.5"/>
    <line x1="4.5" y1="5" x2="9.5" y2="5"/>
    <line x1="4.5" y1="7.5" x2="8" y2="7.5"/>
    <line x1="4.5" y1="10" x2="7" y2="10"/>
  </svg>
);
const IcoCal = ({ color = T.amber }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="10" height="10.5" rx="1.5"/>
    <line x1="5" y1="1" x2="5" y2="3.5"/>
    <line x1="9" y1="1" x2="9" y2="3.5"/>
    <line x1="2" y1="5.5" x2="12" y2="5.5"/>
  </svg>
);
const IcoAlert = ({ color = T.red }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="5.5"/>
    <line x1="7" y1="4.5" x2="7" y2="7.5"/>
    <circle cx="7" cy="9.5" r="0.7" fill={color} stroke="none"/>
  </svg>
);
const IcoCheck2 = ({ color = T.green }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2,7.5 5.5,11 12,3.5"/>
  </svg>
);
const IcoPlus = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
    <line x1="7" y1="2" x2="7" y2="12"/>
    <line x1="2" y1="7" x2="12" y2="7"/>
  </svg>
);
const IcoTrash = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={T.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2,3.5 11,3.5"/>
    <path d="M4.5,3.5v-1.5a1,1 0 0,1 1-1h2a1,1 0 0,1 1,1v1.5"/>
    <path d="M5,5.5v4"/><path d="M8,5.5v4"/>
    <rect x="2.5" y="3.5" width="8" height="8" rx="1.5"/>
  </svg>
);
const IcoHome2 = ({ color = T.ink2 }: { color?: string }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 10V6L6 3l4 3v4"/>
    <rect x="4.5" y="7.5" width="3" height="2.5" rx=".5"/>
  </svg>
);
const IcoClock = ({ color = T.red }: { color?: string }) => (
  <svg width="10" height="10" viewBox="0 0 11 11" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
    <circle cx="5.5" cy="5.5" r="4"/>
    <polyline points="5.5,3 5.5,5.5 7.5,5.5"/>
  </svg>
);
const IcoGradeCheck = () => (
  <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2,7 5.5,11 11.5,2.5"/>
  </svg>
);
// Tab bar icons
const IcoGrid = ({ active }: { active: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke={active ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="11" y="2" width="5" height="5" rx="1.2"/>
    <rect x="2" y="11" width="5" height="5" rx="1.2"/><rect x="11" y="11" width="5" height="5" rx="1.2"/>
  </svg>
);
const IcoAtnd = ({ active }: { active: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke={active ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2.5,8.5 6,12 13.5,4"/>
  </svg>
);
const IcoAssign = ({ active }: { active: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke={active ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="14" height="14" rx="2"/>
    <line x1="5.5" y1="7" x2="12.5" y2="7"/>
    <line x1="5.5" y1="10" x2="10" y2="10"/>
  </svg>
);
const IcoUser2 = ({ active }: { active: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke={active ? T.blue : T.ink2} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="7" r="3"/>
    <path d="M3 17c0 0 1.5-4 6-4s6 4 6 4"/>
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
const timeRemaining = (date: Date) => {
  const diff = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (diff === 0) return "Due Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0)  return `${Math.abs(diff)}d ago`;
  return `${diff}d left`;
};

const isDuePast = (date: Date) => date.getTime() < Date.now();

const accentColor = (status: string) => {
  if (status.includes("To Grade")) return T.amber;
  if (status === "Fully Submitted") return T.green2;
  if (status === "Active") return T.blue;
  return T.ink2;
};

const statusBadge = (status: string) => {
  if (status.includes("To Grade"))  return { bg: T.amberL, color: T.amber, text: status };
  if (status === "Fully Submitted") return { bg: T.greenL, color: T.green, text: "All submitted" };
  if (status === "Active")          return { bg: T.blueL,  color: T.blue,  text: "Active" };
  return { bg: T.s2, color: T.ink2, text: status };
};

type FilterKey = "All" | "To grade" | "Submitted" | "Draft";

// ── Component ─────────────────────────────────────────────────────────────────
const Assignments = () => {
  const { teacherData } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [view, setView]                         = useState<"list" | "create" | "grade">("list");
  const [selectedAssignment, setSelectedAssignment] = useState<any>(null);
  const [assignments, setAssignments]           = useState<any[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [search, setSearch]                     = useState("");
  const [filter, setFilter]                     = useState<FilterKey>("All");
  const [stats, setStats] = useState({
    totalActive: 0, dueThisWeek: 0, pendingGrading: 0, avgSubmission: 0,
  });

  useEffect(() => {
    if (!teacherData?.id) return;
    const schoolId = teacherData.schoolId;
    if (!schoolId) return;
    setLoading(true);

    const unsub = onSnapshot(
      query(
        collection(db, "teaching_assignments"),
        where("schoolId", "==", schoolId),
        where("teacherId", "==", teacherData.id),
        where("status", "==", "active")
      ),
      async (assignSnap) => {
        const teachingAssignments = assignSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        const assignedClassIds    = teachingAssignments.map((t: any) => t.classId).filter(Boolean);
        const legacySnap          = await getDocs(query(
          collection(db, "classes"),
          where("schoolId", "==", schoolId),
          where("teacherId", "==", teacherData.id),
        ));
        const legacyIds           = legacySnap.docs.map(d => d.id);
        const allClassIds         = Array.from(new Set([...assignedClassIds, ...legacyIds]));

        if (!allClassIds.length) {
          setAssignments([]);
          setStats({ totalActive: 0, dueThisWeek: 0, pendingGrading: 0, avgSubmission: 0 });
          setLoading(false);
          return;
        }

        const snaps = await Promise.all(
          allClassIds.map(cid =>
            getDocs(query(
              collection(db, "assignments"),
              where("schoolId", "==", schoolId),
              where("classId", "==", cid),
              where("teacherId", "==", teacherData.id),
            ))
          )
        );
        const map = new Map<string, any>();
        snaps.forEach(s => s.docs.forEach(d => {
          if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
        }));
        const raw = Array.from(map.values());

        const now      = new Date();
        const nextWeek = new Date(now.getTime() + 7 * 86400000);

        const enriched = await Promise.all(raw.map(async (a: any) => {
          let deadline: Date;
          if      (a.dueDate?.toDate)   deadline = a.dueDate.toDate();
          else if (a.dueDate)           deadline = new Date(a.dueDate);
          else if (a.deadline)          deadline = new Date(a.deadline);
          else if (a.createdAt?.toDate) deadline = new Date(a.createdAt.toDate().getTime() + 7 * 86400000);
          else                          deadline = new Date();
          if (isNaN(deadline.getTime())) deadline = new Date();

          const [s1, s2] = await Promise.all([
            getDocs(query(collection(db, "submissions"), where("schoolId", "==", schoolId), where("homeworkId",   "==", a.id))),
            getDocs(query(collection(db, "submissions"), where("schoolId", "==", schoolId), where("assignmentId", "==", a.id))),
          ]);
          const subMap = new Map<string, any>();
          s1.docs.forEach(d => subMap.set(d.data().studentId || d.data().studentEmail || d.id, d));
          s2.docs.forEach(d => { const k = d.data().studentId || d.data().studentEmail || d.id; if (!subMap.has(k)) subMap.set(k, d); });
          const subCount = subMap.size;

          const [resSnap, enrollSnap] = await Promise.all([
            getDocs(query(collection(db, "results"),     where("schoolId", "==", schoolId), where("assignmentId", "==", a.id))),
            getDocs(query(collection(db, "enrollments"), where("schoolId", "==", schoolId), where("classId",      "==", a.classId))),
          ]);
          const expected       = enrollSnap.size || 1;
          const pendingGrading = Math.max(0, subCount - resSnap.size);

          let status = "Active";
          if (pendingGrading > 0)                       status = `${pendingGrading} To Grade`;
          else if (subCount >= expected && expected > 0) status = "Fully Submitted";
          else if (deadline < now)                       status = "Completed";

          return { ...a, deadline, subCount, expected, pendingGrading, status };
        }));

        enriched.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
        setAssignments(enriched);

        const active        = enriched.filter(a => a.deadline > now).length;
        const dueSoon       = enriched.filter(a => a.deadline > now && a.deadline <= nextWeek).length;
        const pending       = enriched.reduce((acc, a) => acc + a.pendingGrading, 0);
        const totalStudents = enriched.reduce((acc, a) => acc + a.expected, 0);
        const totalSubs     = enriched.reduce((acc, a) => acc + a.subCount, 0);
        setStats({
          totalActive:    active,
          dueThisWeek:    dueSoon,
          pendingGrading: pending,
          avgSubmission:  totalStudents > 0 ? Math.round((totalSubs / totalStudents) * 100) : 0,
        });
        setLoading(false);
      }
    );
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId]);

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, "assignments", id));
      toast.success("Assignment deleted.");
    } catch {
      toast.error("Failed to delete assignment.");
    }
  };

  // Sub-views
  if (view === "create") return <CreateAssignment onCancel={() => setView("list")} onCreate={() => setView("list")} />;
  if (view === "grade")  return <GradeAssignment  assignment={selectedAssignment}  onBack={() => setView("list")} />;

  // Filter
  const filtered = assignments.filter(a => {
    const matchSearch = a.title?.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filter === "To grade")  return a.pendingGrading > 0;
    if (filter === "Submitted") return a.subCount >= a.expected && a.expected > 0;
    if (filter === "Draft")     return a.status === "Draft";
    return true;
  });

  // Tab bar nav
  const tabs = [
    { label: "Dashboard",   path: "/",            icon: (a: boolean) => <IcoGrid   active={a} /> },
    { label: "Attendance",  path: "/attendance",  icon: (a: boolean) => <IcoAtnd   active={a} /> },
    { label: "Assignments", path: "/assignments", icon: (a: boolean) => <IcoAssign active={a} /> },
    { label: "Profile",     path: "/settings",    icon: (a: boolean) => <IcoUser2  active={a} /> },
  ];
  const activePath = location.pathname;

  // Metric cards config
  const metrics = [
    {
      ico: <IcoDoc color={T.blue} />,
      icoBg: T.blueL,
      val: stats.totalActive,
      valColor: T.ink1,
      lbl: "Total active",
      badgeTxt: "Active",
      badgeBg: T.s2, badgeColor: T.ink2,
      barFill: T.blue,
      barW: stats.totalActive > 0 ? Math.min(100, stats.totalActive * 20) : 0,
    },
    {
      ico: <IcoCal color={T.amber} />,
      icoBg: T.amberL,
      val: stats.dueThisWeek,
      valColor: T.ink1,
      lbl: "Due this week",
      badgeTxt: stats.dueThisWeek === 0 ? "All clear" : "Due soon",
      badgeBg: stats.dueThisWeek === 0 ? T.greenL : T.amberL,
      badgeColor: stats.dueThisWeek === 0 ? T.green : T.amber,
      barFill: T.amber,
      barW: stats.dueThisWeek > 0 ? Math.min(100, stats.dueThisWeek * 20) : 0,
    },
    {
      ico: <IcoAlert color={T.red} />,
      icoBg: T.redL,
      val: stats.pendingGrading,
      valColor: stats.pendingGrading > 0 ? T.red : T.ink1,
      lbl: "Pending grading",
      badgeTxt: stats.pendingGrading > 0 ? "Needs review" : "All graded",
      badgeBg: stats.pendingGrading > 0 ? T.amberL : T.greenL,
      badgeColor: stats.pendingGrading > 0 ? T.amber : T.green,
      barFill: T.red,
      barW: stats.pendingGrading > 0 ? Math.min(100, stats.pendingGrading * 20) : 0,
    },
    {
      ico: <IcoCheck2 color={T.green} />,
      icoBg: T.greenL,
      val: `${stats.avgSubmission}%`,
      valColor: stats.avgSubmission >= 80 ? T.green : T.ink1,
      lbl: "Avg. submission",
      badgeTxt: stats.avgSubmission >= 80 ? "Great" : "In progress",
      badgeBg: stats.avgSubmission >= 80 ? T.greenL : T.amberL,
      badgeColor: stats.avgSubmission >= 80 ? T.green : T.amber,
      barFill: T.green2,
      barW: stats.avgSubmission,
    },
  ];

  const filterChips: FilterKey[] = ["All", "To grade", "Submitted", "Draft"];

  return (
    <div style={{ fontFamily: 'inherit' }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <div className="md:hidden" style={{ background: T.s1 }}>

      {/* ── Dark Hero ───────────────────────────────────────────────────────── */}
      <div
        style={{ background: T.ink0 }}
        className="-mx-4 sm:-mx-6 px-[22px] pb-6"
      >
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', marginBottom: 3 }}>
          Assignments
        </h1>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          Create, manage and grade student work.
        </p>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 md:px-0 pt-4 flex flex-col gap-3">

        {/* Create CTA */}
        <button
          onClick={() => setView("create")}
          style={{
            width: '100%', padding: '13px', borderRadius: 13,
            background: T.blue, border: 'none', color: '#fff',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'inherit', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 7,
          }}
        >
          <IcoPlus /> Create assignment
        </button>

        {/* Metric grid */}
        <div className="grid grid-cols-2 gap-[9px]">
          {metrics.map((m, i) => (
            <div key={i} style={{
              background: T.s0, border: `1px solid ${T.bdr}`,
              borderRadius: 16, padding: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 9,
                  background: m.icoBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {m.ico}
                </div>
                <span style={{
                  padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 500,
                  background: m.badgeBg, color: m.badgeColor, whiteSpace: 'nowrap',
                }}>
                  {m.badgeTxt}
                </span>
              </div>
              <div style={{ fontSize: 21, fontWeight: 500, letterSpacing: '-0.5px', lineHeight: 1, color: m.valColor }}>
                {m.val}
              </div>
              <div style={{ fontSize: 11, color: T.ink2, marginTop: 3, lineHeight: 1.3 }}>{m.lbl}</div>
              <div style={{ height: 3, borderRadius: 2, background: T.s2, marginTop: 9, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, background: m.barFill, width: `${m.barW}%`, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search style={{
            position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
            width: 14, height: 14, color: T.ink2, pointerEvents: 'none',
          }} />
          <input
            type="text"
            placeholder="Search assignments..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px 10px 33px',
              borderRadius: 12, border: `1px solid ${T.bdr}`,
              background: T.s0, fontSize: 13, color: T.ink1,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}
             className="scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
          {filterChips.map(key => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                padding: '6px 13px', borderRadius: 20, fontSize: 11, whiteSpace: 'nowrap',
                fontWeight: filter === key ? 500 : 400,
                background: filter === key ? T.ink0 : T.s0,
                color: filter === key ? '#fff' : T.ink2,
                border: `1px solid ${filter === key ? T.ink0 : T.bdr}`,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {key}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: T.blue }} />
          </div>
        ) : filtered.length === 0 ? (

          /* Empty state */
          <div style={{
            background: T.s0, border: `1.5px dashed ${T.bdr}`, borderRadius: 16,
            padding: '20px 14px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 11, background: T.blueL,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <IcoPlus />
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.ink1 }}>
              {filter === "All" ? "No assignments yet" : `No "${filter}" assignments`}
            </div>
            <div style={{ fontSize: 10, color: T.ink2, textAlign: 'center', lineHeight: 1.4 }}>
              {filter === "All"
                ? "Create your first assignment to track student progress."
                : "Try a different filter or create a new assignment."}
            </div>
          </div>

        ) : (

          /* Assignment cards */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(a => {
              const badge   = statusBadge(a.status);
              const accent  = accentColor(a.status);
              const subPct  = Math.min(100, (a.subCount / (a.expected || 1)) * 100);
              const pastDue = isDuePast(a.deadline);

              return (
                <div
                  key={a.id}
                  onClick={() => { setSelectedAssignment(a); setView("grade"); }}
                  role="button"
                  tabIndex={0}
                  className="clickable-card"
                  style={{
                    background: T.s0, border: `1px solid ${T.bdr}`,
                    borderRadius: 18, overflow: 'hidden',
                  }}
                >
                  {/* Colored accent strip */}
                  <div style={{ height: 4, background: accent }} />

                  <div style={{ padding: 14 }}>
                    {/* Title + badge */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: T.ink1, letterSpacing: '-0.1px', lineHeight: 1.3 }}>
                          {a.title}
                        </div>
                        {a.description && (
                          <div style={{ fontSize: 11, color: T.ink2, marginTop: 2, lineHeight: 1.4,
                            overflow: 'hidden', display: '-webkit-box',
                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                            {a.description}
                          </div>
                        )}
                      </div>
                      <span style={{
                        padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 500,
                        background: badge.bg, color: badge.color, whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        {badge.text}
                      </span>
                    </div>

                    {/* Class + due date */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.ink1 }}>
                        <IcoHome2 />
                        {a.className || "—"}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                        color: pastDue ? T.red : T.ink2, fontWeight: pastDue ? 500 : 400 }}>
                        <IcoClock color={pastDue ? T.red : T.ink2} />
                        {timeRemaining(a.deadline)}
                      </div>
                    </div>

                    {/* Submission bar */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.ink2, marginBottom: 5 }}>
                        <span>Submissions</span>
                        <span style={{ fontWeight: 500, color: T.ink1 }}>{a.subCount} / {a.expected}</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: T.s2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, background: T.green2, width: `${subPct}%`, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: `1px solid ${T.s2}`, paddingTop: 12 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedAssignment(a); setView("grade"); }}
                        style={{
                          flex: 1, padding: 10, borderRadius: 11, background: T.blue,
                          border: 'none', color: '#fff', fontSize: 12, fontWeight: 500,
                          cursor: 'pointer', fontFamily: 'inherit',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}
                      >
                        <IcoGradeCheck /> Grade submissions
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(a.id, a.title); }}
                        style={{
                          width: 36, height: 36, borderRadius: 10,
                          border: `1px solid ${T.bdr}`, background: T.s1,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        <IcoTrash />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add more hint */}
            <div style={{
              background: T.s0, border: `1.5px dashed ${T.bdr}`, borderRadius: 16,
              padding: '20px 14px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 8, cursor: 'pointer',
            }} onClick={() => setView("create")}>
              <div style={{
                width: 36, height: 36, borderRadius: 11, background: T.blueL,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round">
                  <line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/>
                </svg>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: T.ink1 }}>Add another assignment</div>
              <div style={{ fontSize: 10, color: T.ink2, textAlign: 'center', lineHeight: 1.4 }}>
                Create more assignments to track student progress across classes.
              </div>
            </div>
          </div>
        )}
      </div>

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
      <div className="hidden md:block">

        {/* ── Header row ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-slate-900 leading-tight tracking-tight">Assignments</h1>
            <p className="text-sm text-slate-500 mt-1">Create, manage, and grade student assignments.</p>
          </div>
          <button
            onClick={() => setView("create")}
            className="h-11 px-5 rounded-lg bg-[#1e3272] text-white text-sm font-semibold hover:bg-[#162552] flex items-center gap-2 shadow-sm"
          >
            <IcoPlus /> Create Assignment
          </button>
        </div>

        {/* ── 4-col Stat cards ───────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.blueL }}>
                <IcoDoc color={T.blue} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.totalActive}</p>
                <p className="text-xs text-slate-500 mt-1.5">Total Active</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.amberL }}>
                <IcoCal color={T.amber} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.dueThisWeek}</p>
                <p className="text-xs text-slate-500 mt-1.5">Due This Week</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.redL }}>
                <IcoAlert color={T.red} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.pendingGrading}</p>
                <p className="text-xs text-slate-500 mt-1.5">Pending Grading</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: T.greenL }}>
                <IcoCheck2 color={T.green} />
              </div>
              <div>
                <p className="text-[28px] font-bold text-slate-900 leading-none">{stats.avgSubmission}%</p>
                <p className="text-xs text-slate-500 mt-1.5">Avg. Submission</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Search + filter chips row ──────────────────────────── */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {filterChips.map(key => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === key
                    ? 'bg-[#1e3272] text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search assignments..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-64 h-10 pl-9 pr-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
            />
          </div>
        </div>

        {/* ── Assignments table ──────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-sm text-slate-500 font-semibold mb-1">
                {filter === 'All' ? 'No assignments yet' : `No "${filter}" assignments`}
              </p>
              <p className="text-xs text-slate-400">Create your first assignment to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Assignment</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Class</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Due Date</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Submissions</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Status</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(a => {
                    const badge = statusBadge(a.status);
                    const dueLabel = timeRemaining(a.deadline);
                    return (
                      <tr
                        key={a.id}
                        onClick={() => { setSelectedAssignment(a); setView("grade"); }}
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold text-slate-900">{a.title}</p>
                          {a.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{a.description}</p>}
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-700">{a.className || '—'}</td>
                        <td className={`px-5 py-4 text-sm ${isDuePast(a.deadline) ? 'text-rose-600 font-semibold' : 'text-slate-700'}`}>
                          {dueLabel}
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-700 font-medium">{a.subCount}/{a.expected}</td>
                        <td className="px-5 py-4">
                          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: badge.bg, color: badge.color }}>
                            {badge.text}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedAssignment(a); setView("grade"); }}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              Grade
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(a.id, a.title); }}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

      {/* ── Mobile bottom tab bar ────────────────────────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40" style={{
        background: T.s0, borderTop: `1px solid ${T.bdr}`,
        padding: '9px 18px 17px',
        display: 'flex', justifyContent: 'space-between',
      }}>
        {tabs.map(tab => {
          const isActive = tab.path === activePath;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                fontFamily: 'inherit',
              }}
            >
              {tab.icon(isActive)}
              <span style={{ fontSize: 9, color: isActive ? T.blue : T.ink2, fontWeight: isActive ? 500 : 400 }}>
                {tab.label}
              </span>
              {isActive && (
                <div style={{ width: 13, height: 2.5, borderRadius: 2, background: T.blue, marginTop: -2 }} />
              )}
            </button>
          );
        })}
      </div>

    </div>
  );
};

export default Assignments;