import { useState, useEffect } from "react";
import CreateAssignment from "@/components/CreateAssignment";
import GradeAssignment from "@/components/GradeAssignment";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  doc, getDocs
} from "firebase/firestore";
import { auditedDelete } from "../lib/auditedWrites";
import { useAuth } from "../lib/AuthContext";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

// ── Design tokens (desktop) ──────────────────────────────────────────────────
const T = {
  ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
  s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
  blue: '#3B5BDB', blueL: '#EDF2FF', blueB: '#BAC8FF',
  green: '#087F5B', greenL: '#EBFBEE', green2: '#2F9E44',
  red: '#C92A2A', redL: '#FFF5F5',
  amber: '#C87014', amberL: '#FFF9DB',
  teal: '#0C8599', tealL: '#E3FAFC',
};

// ── Mobile tokens (EduIntellect v2) ──────────────────────────────────────────
const MA = {
  FONT: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  CARD: "#FFFFFF",
  SURFACE: "#F4F7FE",
  P: "#0055FF", PD: "#0044CC",
  T1: "#001040", T3: "#5070B0", T4: "#99AACC",
  GREEN: "#00C853",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  GOLD: "#FFAA00",
  VIOLET: "#7B3FF4",
  SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
  SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
  BDR: "0.5px solid rgba(0,85,255,0.07)",
  HERO_GRAD: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
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
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      await auditedDelete(doc(db, "assignments", id));
      toast.success("Assignment deleted.");
    } catch (e) {
      console.error("[Assignments] delete failed", e);
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

  const filterChips: FilterKey[] = ["All", "To grade", "Submitted", "Draft"];

  return (
    <div style={{ fontFamily: 'inherit' }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ═══════════════════ MOBILE VIEW (EduIntellect v2) ═══════════════════ */}
      <div className="md:hidden" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "0 -16px", paddingBottom: 8 }}>

        {/* Page header */}
        <div className="px-4 pt-3 pb-[14px]">
          <div className="flex items-center gap-[7px] text-[9px] font-extrabold uppercase mb-[6px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
            <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: MA.P }} />
            Teacher Dashboard · Assignments
          </div>
          <h1 className="text-[28px] font-extrabold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.1px" }}>
            Assignments
          </h1>
          <div className="text-[12px] font-medium mt-[6px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
            Create, manage, and grade student assignments.
          </div>
        </div>

        {/* Hero — gradient with Total Active */}
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </div>
              <div>
                <div className="text-[10px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Total Active</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Across all classes</div>
              </div>
              <div className="ml-auto px-3 py-[5px] rounded-full text-[10px] font-extrabold"
                style={{
                  background: "rgba(9,87,247,0.3)",
                  border: "0.5px solid rgba(74,133,255,0.55)",
                  color: "#B5CEFF",
                  letterSpacing: "0.3px",
                }}>
                This Week
              </div>
            </div>
            <div className="text-[54px] font-extrabold text-white leading-none mb-[6px] flex items-baseline" style={{ letterSpacing: "-2.4px" }}>
              {stats.totalActive}
              <span className="text-[22px] font-bold ml-[6px]" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "-0.4px" }}>
                {stats.totalActive === 1 ? "assignment" : "assignments"}
              </span>
            </div>
            <div className="text-[13px] font-medium mb-[18px]" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
              <b className="text-white font-bold">{stats.dueThisWeek} due this week</b> — {stats.pendingGrading} pending your grading.
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
              <div className="py-[12px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-extrabold" style={{ color: stats.dueThisWeek > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.5px" }}>{stats.dueThisWeek}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Due</div>
              </div>
              <div className="py-[12px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-extrabold" style={{ color: stats.pendingGrading > 0 ? "#FF9AA9" : "#fff", letterSpacing: "-0.5px" }}>{stats.pendingGrading}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Pending</div>
              </div>
              <div className="py-[12px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-extrabold" style={{ color: stats.avgSubmission >= 80 ? "#6FFFAA" : "#fff", letterSpacing: "-0.5px" }}>{stats.avgSubmission}%</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Avg Sub.</div>
              </div>
            </div>
          </div>
        </div>

        {/* Create CTA */}
        <div className="px-4 mb-[14px]">
          <button type="button" onClick={() => setView("create")}
            className="w-full h-[48px] rounded-[14px] flex items-center justify-center gap-[6px] active:scale-[0.98] transition-transform"
            style={{
              background: MA.P, color: "#fff",
              fontSize: 13, fontWeight: 800, letterSpacing: "-0.2px",
              boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.3)",
              fontFamily: MA.FONT, border: "none",
            }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create assignment
          </button>
        </div>

        {/* 2x2 Stats Grid */}
        <div className="grid grid-cols-2 gap-[10px] px-4 mb-[14px]">
          {([
            {
              key: "total", label: "Total Active", val: stats.totalActive, color: MA.P,
              sub: stats.totalActive > 0
                ? <span className="font-bold" style={{ color: MA.P }}>● Currently running</span>
                : <span className="font-semibold" style={{ color: MA.T3 }}>No active work</span>,
              onClick: () => setFilter("All"),
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
            },
            {
              key: "due", label: "Due This Week", val: stats.dueThisWeek, color: MA.ORANGE,
              sub: stats.dueThisWeek > 0
                ? <span className="font-bold" style={{ color: MA.ORANGE }}>● Due in 7 days</span>
                : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All clear</span>,
              onClick: () => setFilter("All"),
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
            },
            {
              key: "pending", label: "Pending Grading", val: stats.pendingGrading, color: stats.pendingGrading > 0 ? MA.RED : MA.GREEN,
              sub: stats.pendingGrading > 0
                ? <span className="font-bold" style={{ color: MA.RED }}>● Needs review</span>
                : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All caught up</span>,
              onClick: () => setFilter("To grade"),
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>,
            },
            {
              key: "avg", label: "Avg Submission", val: `${stats.avgSubmission}%`, color: stats.avgSubmission >= 80 ? MA.GREEN : MA.VIOLET,
              sub: stats.avgSubmission >= 80
                ? <span className="font-bold" style={{ color: MA.GREEN }}>✓ Strong</span>
                : stats.avgSubmission > 0
                  ? <span className="font-bold" style={{ color: MA.P }}>● In progress</span>
                  : <span className="font-semibold" style={{ color: MA.T3 }}>Awaiting subs</span>,
              onClick: () => setFilter("Submitted"),
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
            },
          ] as const).map(s => (
            <button key={s.key} type="button" onClick={s.onClick}
              {...tilt3D}
              className="bg-white rounded-[20px] p-4 relative flex flex-col text-left active:scale-[0.96] transition-transform"
              style={{ boxShadow: MA.SH, border: MA.BDR, fontFamily: MA.FONT, ...tilt3DStyle }}>
              <div className="flex items-start gap-[10px] mb-[18px]" style={{ minHeight: 40 }}>
                <div className="flex-1 min-w-0 text-[10px] font-bold uppercase leading-[1.4] pt-[3px]" style={{ color: MA.T3, letterSpacing: "1px" }}>
                  {s.label}
                </div>
                <div className="flex-shrink-0 w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-white" style={{ background: s.color }}>
                  {s.icon}
                </div>
              </div>
              <div className="text-[30px] font-extrabold leading-none" style={{ color: s.color, letterSpacing: "-1.3px" }}>{s.val}</div>
              <div className="text-[11px] font-semibold mt-[7px] flex items-center gap-[5px]" style={{ color: MA.T4, letterSpacing: "-0.15px" }}>
                {s.sub}
              </div>
            </button>
          ))}
        </div>

        {/* Filter Tabs */}
        <div className="mx-4 mb-[12px] p-[5px] rounded-[14px] flex gap-[7px]"
          style={{ background: MA.CARD, boxShadow: MA.SH_SM, border: MA.BDR }}>
          {filterChips.map(key => {
            const count =
              key === "All"       ? assignments.length :
              key === "To grade"  ? assignments.filter(a => a.pendingGrading > 0).length :
              key === "Submitted" ? assignments.filter(a => a.subCount >= a.expected && a.expected > 0).length :
              /* Draft */         assignments.filter(a => a.status === "Draft").length;
            const isActive = filter === key;
            return (
              <button key={key} type="button" onClick={() => setFilter(key)}
                aria-pressed={isActive}
                className="flex-1 py-[9px] px-[8px] rounded-[10px] flex items-center justify-center gap-[5px] transition-all active:scale-[0.96]"
                style={{
                  background: isActive ? MA.P : "transparent",
                  color: isActive ? "#fff" : MA.T3,
                  fontSize: 12, fontWeight: isActive ? 800 : 700, letterSpacing: "-0.2px",
                  boxShadow: isActive ? "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" : "none",
                  fontFamily: MA.FONT, border: "none", cursor: "pointer",
                }}>
                {key}
                <span className="text-[10px] font-extrabold px-[6px] py-[1px] rounded-full min-w-[16px] text-center"
                  style={{ background: isActive ? "rgba(255,255,255,0.22)" : MA.SURFACE, color: isActive ? "#fff" : MA.T3 }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="mx-4 mb-[12px] flex items-center gap-[8px] py-[9px] px-[13px] rounded-[12px]"
          style={{ background: MA.CARD, boxShadow: MA.SH_SM, border: MA.BDR }}>
          <Search className="w-[14px] h-[14px] flex-shrink-0" style={{ color: MA.T4 }} strokeWidth={2.4} />
          <input type="text" placeholder="Search assignments…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-[12px] font-medium"
            style={{ color: search ? MA.T1 : MA.T4, letterSpacing: "-0.1px", fontFamily: MA.FONT }} />
        </div>

        {/* Assignment cards */}
        <div className="mx-4">
          {loading ? (
            <div className="bg-white rounded-[18px] py-10 flex justify-center" style={{ boxShadow: MA.SH, border: MA.BDR }}>
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: MA.P }} />
            </div>
          ) : filtered.length === 0 ? (
            /* Empty state */
            <div className="bg-white rounded-[22px] pt-9 pb-7 px-5 text-center" style={{ boxShadow: MA.SH, border: MA.BDR }}>
              <div className="relative w-[80px] h-[80px] rounded-[24px] flex items-center justify-center mx-auto mb-[18px]"
                style={{
                  background: "linear-gradient(145deg, rgba(9,87,247,0.1) 0%, rgba(123,63,244,0.08) 100%)",
                  color: MA.P,
                  boxShadow: "0 0 0 8px rgba(9,87,247,0.04), inset 0 1px 0 rgba(255,255,255,0.6)",
                }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <div className="absolute -top-[6px] -right-[6px] w-[24px] h-[24px] rounded-full flex items-center justify-center text-white text-[14px] font-extrabold"
                  style={{ background: MA.P, border: "3px solid #fff", boxShadow: "0 2px 6px rgba(9,87,247,0.35)" }}>
                  +
                </div>
              </div>
              <div className="text-[17px] font-extrabold mb-[6px]" style={{ color: MA.T1, letterSpacing: "-0.5px" }}>
                {search ? "No matches" : filter === "All" ? "No assignments yet" : `No "${filter}" items`}
              </div>
              <div className="text-[13px] font-medium leading-[1.5] mb-[18px] px-[10px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
                {search ? (
                  <>Try a different search term or clear the filter.</>
                ) : filter === "All" ? (
                  <><b className="font-bold" style={{ color: MA.T1 }}>Create your first</b> assignment to track student progress.</>
                ) : filter === "To grade" ? (
                  <><b className="font-bold" style={{ color: MA.T1 }}>All caught up!</b><br />Submissions will appear here once students upload their work.</>
                ) : filter === "Submitted" ? (
                  <>No fully-submitted assignments yet — check back as students turn in work.</>
                ) : (
                  <>No drafts right now. Every assignment you create is published live.</>
                )}
              </div>
              <button type="button" onClick={() => setView("create")}
                className="inline-flex items-center gap-[6px] px-5 py-[11px] rounded-[13px] active:scale-[0.96] transition-transform"
                style={{
                  background: MA.P, color: "#fff",
                  fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                  boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 5px 14px rgba(9,87,247,0.3)",
                  border: "none", fontFamily: MA.FONT,
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create Assignment
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {filtered.map(a => {
                const accent = accentColor(a.status);
                const pastDue = isDuePast(a.deadline);
                const isActive = !pastDue && a.pendingGrading === 0;
                return (
                  <div key={a.id}
                    onClick={() => { setSelectedAssignment(a); setView("grade"); }}
                    role="button" tabIndex={0}
                    {...tilt3D}
                    className="bg-white rounded-[18px] p-[14px] relative overflow-hidden active:scale-[0.985] transition-transform cursor-pointer"
                    style={{ boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px]" style={{ background: accent }} />
                    {/* Head */}
                    <div className="flex items-start gap-[11px] mb-[12px]">
                      <div className="w-10 h-10 rounded-[12px] flex items-center justify-center text-white flex-shrink-0" style={{ background: accent }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-[8px]">
                          <div className="text-[15px] font-extrabold leading-[1.2] truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                            {a.title}
                          </div>
                          {isActive ? (
                            <span className="px-[10px] py-[4px] rounded-full text-[10px] font-extrabold flex items-center gap-[5px] flex-shrink-0"
                              style={{ background: "rgba(9,87,247,0.1)", color: MA.P, letterSpacing: "0.3px" }}>
                              <span className="w-[5px] h-[5px] rounded-full" style={{ background: MA.P }} />
                              Active
                            </span>
                          ) : (
                            <span className="px-[10px] py-[4px] rounded-full text-[10px] font-extrabold flex-shrink-0"
                              style={{ background: statusBadge(a.status).bg, color: statusBadge(a.status).color, letterSpacing: "0.3px" }}>
                              {statusBadge(a.status).text}
                            </span>
                          )}
                        </div>
                        {a.description && (
                          <div className="text-[11px] font-medium mt-[3px] truncate" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                            {a.description}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 3-col metrics */}
                    <div className="grid grid-cols-3 gap-[1px] rounded-[12px] overflow-hidden p-[1px] mb-[11px]" style={{ background: MA.SURFACE }}>
                      <div className="py-[9px] px-[6px] text-center bg-white">
                        <div className="inline-block px-[8px] py-[2px] rounded-[6px] text-[11px] font-extrabold"
                          style={{ background: "rgba(9,87,247,0.08)", color: MA.P, letterSpacing: "-0.2px" }}>
                          {a.className || "—"}
                        </div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Class</div>
                      </div>
                      <div className="py-[9px] px-[6px] text-center bg-white">
                        <div className="text-[13px] font-extrabold" style={{ color: pastDue ? MA.RED : MA.ORANGE, letterSpacing: "-0.3px" }}>
                          {timeRemaining(a.deadline)}
                        </div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Due Date</div>
                      </div>
                      <div className="py-[9px] px-[6px] text-center bg-white">
                        <div className="text-[13px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                          {a.subCount}/{a.expected}
                        </div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Submitted</div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-[7px]">
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedAssignment(a); setView("grade"); }}
                        className="flex-1 h-[38px] rounded-[11px] flex items-center justify-center gap-[5px] active:scale-[0.96] transition-transform"
                        style={{
                          background: MA.P, color: "#fff",
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                          boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 3px 10px rgba(9,87,247,0.25)",
                          fontFamily: MA.FONT, border: "none",
                        }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                        Grade
                      </button>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedAssignment(a); setView("grade"); }}
                        className="flex-1 h-[38px] rounded-[11px] flex items-center justify-center active:scale-[0.96] transition-transform"
                        style={{
                          background: MA.SURFACE, color: MA.T1,
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                          fontFamily: MA.FONT, border: "none",
                        }}>
                        View
                      </button>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(a.id, a.title); }}
                        aria-label={`Delete ${a.title}`}
                        className="w-[38px] h-[38px] rounded-[11px] flex items-center justify-center active:scale-[0.92] transition-transform"
                        style={{
                          background: "rgba(255,51,85,0.08)", color: MA.RED,
                          fontFamily: MA.FONT, border: "none",
                        }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* AI Intelligence */}
        {!loading && (
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
                <div className="text-[10px] font-black uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.8px" }}>
                  AI Assignment Intelligence
                </div>
                <div className="ml-auto px-[10px] py-[4px] rounded-full text-[9px] font-extrabold"
                  style={{ background: "rgba(123,63,244,0.3)", border: "0.5px solid rgba(155,95,255,0.5)", color: "#DCC8FF", letterSpacing: "0.5px" }}>
                  Tip
                </div>
              </div>
              {(() => {
                const nextDue = assignments.filter(a => a.deadline > new Date()).sort((a, b) => a.deadline.getTime() - b.deadline.getTime())[0];
                const nextDueLabel = nextDue ? timeRemaining(nextDue.deadline) : "—";
                return (
                  <>
                    <div className="text-[13px] leading-[1.6] mb-[14px]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                      {stats.pendingGrading > 0 ? (
                        <><strong className="text-white font-bold">{stats.pendingGrading}</strong> submission{stats.pendingGrading === 1 ? "" : "s"} waiting for your review. Grading today keeps students in the loop.</>
                      ) : stats.totalActive === 0 ? (
                        <>No active assignments yet. <strong className="text-white font-bold">Create your first</strong> to start tracking submissions and grades.</>
                      ) : nextDue ? (
                        <><strong className="text-white font-bold">{stats.totalActive} active</strong> — <strong className="text-white font-bold">{nextDue.title}</strong> is due in {nextDueLabel.toLowerCase()}. Send a reminder to <strong className="text-white font-bold">{nextDue.className || "the class"}</strong> if submissions stall.</>
                      ) : (
                        <>Nothing to grade right now — <strong className="text-white font-bold">great job</strong> staying on top of submissions.</>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-[1px] rounded-[12px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                      <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                        <div className="text-[17px] font-extrabold text-white" style={{ letterSpacing: "-0.4px" }}>{stats.pendingGrading}</div>
                        <div className="text-[8px] font-extrabold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Pending</div>
                      </div>
                      <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                        <div className="text-[17px] font-extrabold text-white" style={{ letterSpacing: "-0.4px" }}>{stats.totalActive}</div>
                        <div className="text-[8px] font-extrabold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Active</div>
                      </div>
                      <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                        <div className="text-[17px] font-extrabold" style={{ color: "#FFD060", letterSpacing: "-0.4px" }}>{nextDueLabel}</div>
                        <div className="text-[8px] font-extrabold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Next Due</div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

      </div>{/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
      <div className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh" }}>
        <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-12">

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-[7px] text-[10px] font-extrabold uppercase mb-[8px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
              <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: MA.P }} />
              Teacher Dashboard · Assignments
            </div>
            <h1 className="text-[40px] font-extrabold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.4px" }}>Assignments</h1>
            <div className="text-[14px] font-medium mt-[8px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
              Create, manage, and grade student assignments.
            </div>
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
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Total Active</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Across all classes</div>
                </div>
                <div className="ml-auto px-4 py-[7px] rounded-full text-[11px] font-extrabold"
                  style={{
                    background: "rgba(9,87,247,0.3)",
                    border: "0.5px solid rgba(74,133,255,0.55)",
                    color: "#B5CEFF",
                    letterSpacing: "0.3px",
                  }}>
                  This Week
                </div>
              </div>
              <div className="flex items-end justify-between gap-8 flex-wrap">
                <div>
                  <div className="text-[84px] font-extrabold text-white leading-none mb-[6px] flex items-baseline" style={{ letterSpacing: "-3.8px" }}>
                    {stats.totalActive}
                    <span className="text-[32px] font-bold ml-[10px]" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "-0.6px" }}>
                      {stats.totalActive === 1 ? "assignment" : "assignments"}
                    </span>
                  </div>
                  <div className="text-[14px] font-medium" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "-0.15px" }}>
                    <b className="text-white font-bold">{stats.dueThisWeek} due this week</b> — {stats.pendingGrading} pending your grading.
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px] min-w-[380px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-extrabold" style={{ color: stats.dueThisWeek > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.8px" }}>{stats.dueThisWeek}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Due</div>
                  </div>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-extrabold" style={{ color: stats.pendingGrading > 0 ? "#FF9AA9" : "#fff", letterSpacing: "-0.8px" }}>{stats.pendingGrading}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Pending</div>
                  </div>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-extrabold" style={{ color: stats.avgSubmission >= 80 ? "#6FFFAA" : "#fff", letterSpacing: "-0.8px" }}>{stats.avgSubmission}%</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Avg Sub.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Create CTA + 4 stat cards row */}
          <div className="grid grid-cols-5 gap-4 mb-5">
            <button type="button" onClick={() => setView("create")}
              className="rounded-[22px] flex flex-col items-center justify-center gap-2 p-5 hover:scale-[1.02] active:scale-[0.98] transition-transform"
              style={{
                background: MA.P, color: "#fff",
                fontSize: 14, fontWeight: 800, letterSpacing: "-0.2px",
                boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.3)",
                fontFamily: MA.FONT, border: "none",
              }}>
              <div className="w-11 h-11 rounded-[12px] flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </div>
              <div>Create assignment</div>
            </button>
            {([
              {
                key: "total", label: "Total Active", val: stats.totalActive, color: MA.P,
                sub: stats.totalActive > 0
                  ? <span className="font-bold" style={{ color: MA.P }}>● Currently running</span>
                  : <span className="font-semibold" style={{ color: MA.T3 }}>No active work</span>,
                onClick: () => setFilter("All"),
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
              },
              {
                key: "due", label: "Due This Week", val: stats.dueThisWeek, color: MA.ORANGE,
                sub: stats.dueThisWeek > 0
                  ? <span className="font-bold" style={{ color: MA.ORANGE }}>● Due in 7 days</span>
                  : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All clear</span>,
                onClick: () => setFilter("All"),
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
              },
              {
                key: "pending", label: "Pending Grading", val: stats.pendingGrading, color: stats.pendingGrading > 0 ? MA.RED : MA.GREEN,
                sub: stats.pendingGrading > 0
                  ? <span className="font-bold" style={{ color: MA.RED }}>● Needs review</span>
                  : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All caught up</span>,
                onClick: () => setFilter("To grade"),
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>,
              },
              {
                key: "avg", label: "Avg Submission", val: `${stats.avgSubmission}%`, color: stats.avgSubmission >= 80 ? MA.GREEN : MA.VIOLET,
                sub: stats.avgSubmission >= 80
                  ? <span className="font-bold" style={{ color: MA.GREEN }}>✓ Strong</span>
                  : stats.avgSubmission > 0
                    ? <span className="font-bold" style={{ color: MA.P }}>● In progress</span>
                    : <span className="font-semibold" style={{ color: MA.T3 }}>Awaiting subs</span>,
                onClick: () => setFilter("Submitted"),
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
              },
            ] as const).map(s => (
              <button key={s.key} type="button" onClick={s.onClick}
                {...tilt3D}
                className="bg-white rounded-[22px] p-5 relative flex flex-col text-left active:scale-[0.98] transition-all"
                style={{ boxShadow: MA.SH, border: MA.BDR, fontFamily: MA.FONT, ...tilt3DStyle }}>
                <div className="flex items-start gap-[10px] mb-5" style={{ minHeight: 44 }}>
                  <div className="flex-1 min-w-0 text-[11px] font-bold uppercase leading-[1.4] pt-[4px]" style={{ color: MA.T3, letterSpacing: "1px" }}>
                    {s.label}
                  </div>
                  <div className="flex-shrink-0 w-[44px] h-[44px] rounded-[13px] flex items-center justify-center text-white" style={{ background: s.color }}>
                    {s.icon}
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none" style={{ color: s.color, letterSpacing: "-1.6px" }}>{s.val}</div>
                <div className="text-[12px] font-semibold mt-2 flex items-center gap-[5px]" style={{ color: MA.T4, letterSpacing: "-0.15px" }}>
                  {s.sub}
                </div>
              </button>
            ))}
          </div>

          {/* Filter Tabs + Search row */}
          <div className="flex items-center gap-4 mb-5 flex-wrap">
            <div className="flex-1 min-w-[280px] p-[5px] rounded-[14px] flex gap-[7px]"
              style={{ background: MA.CARD, boxShadow: MA.SH_SM, border: MA.BDR }}>
              {filterChips.map(key => {
                const count =
                  key === "All"       ? assignments.length :
                  key === "To grade"  ? assignments.filter(a => a.pendingGrading > 0).length :
                  key === "Submitted" ? assignments.filter(a => a.subCount >= a.expected && a.expected > 0).length :
                  /* Draft */         assignments.filter(a => a.status === "Draft").length;
                const isActive = filter === key;
                return (
                  <button key={key} type="button" onClick={() => setFilter(key)}
                    aria-pressed={isActive}
                    className="flex-1 py-[11px] px-4 rounded-[10px] flex items-center justify-center gap-[6px] transition-all active:scale-[0.96]"
                    style={{
                      background: isActive ? MA.P : "transparent",
                      color: isActive ? "#fff" : MA.T3,
                      fontSize: 13, fontWeight: isActive ? 800 : 700, letterSpacing: "-0.2px",
                      boxShadow: isActive ? "0 1px 2px rgba(9,87,247,0.2), 0 3px 8px rgba(9,87,247,0.25)" : "none",
                      fontFamily: MA.FONT, border: "none", cursor: "pointer",
                    }}>
                    {key}
                    <span className="text-[10px] font-extrabold px-[7px] py-[2px] rounded-full min-w-[18px] text-center"
                      style={{ background: isActive ? "rgba(255,255,255,0.22)" : MA.SURFACE, color: isActive ? "#fff" : MA.T3 }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 py-[11px] px-4 rounded-[12px] w-[320px]"
              style={{ background: MA.CARD, boxShadow: MA.SH_SM, border: MA.BDR }}>
              <Search className="w-[16px] h-[16px] flex-shrink-0" style={{ color: MA.T4 }} strokeWidth={2.4} />
              <input type="text" placeholder="Search assignments…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 bg-transparent outline-none text-[13px] font-medium"
                style={{ color: search ? MA.T1 : MA.T4, letterSpacing: "-0.1px", fontFamily: MA.FONT }} />
            </div>
          </div>

          {/* Assignment cards grid */}
          <div className="mb-5">
            {loading ? (
              <div className="bg-white rounded-[20px] py-14 flex justify-center" style={{ boxShadow: MA.SH, border: MA.BDR }}>
                <Loader2 className="w-9 h-9 animate-spin" style={{ color: MA.P }} />
              </div>
            ) : filtered.length === 0 ? (
              /* Empty state */
              <div className="bg-white rounded-[22px] pt-12 pb-10 px-6 text-center" style={{ boxShadow: MA.SH, border: MA.BDR }}>
                <div className="relative w-[96px] h-[96px] rounded-[28px] flex items-center justify-center mx-auto mb-[20px]"
                  style={{
                    background: "linear-gradient(145deg, rgba(9,87,247,0.1) 0%, rgba(123,63,244,0.08) 100%)",
                    color: MA.P,
                    boxShadow: "0 0 0 10px rgba(9,87,247,0.04), inset 0 1px 0 rgba(255,255,255,0.6)",
                  }}>
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  <div className="absolute -top-[7px] -right-[7px] w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-[16px] font-extrabold"
                    style={{ background: MA.P, border: "3px solid #fff", boxShadow: "0 2px 6px rgba(9,87,247,0.35)" }}>
                    +
                  </div>
                </div>
                <div className="text-[20px] font-extrabold mb-[8px]" style={{ color: MA.T1, letterSpacing: "-0.5px" }}>
                  {search ? "No matches" : filter === "All" ? "No assignments yet" : `No "${filter}" items`}
                </div>
                <div className="text-[14px] font-medium leading-[1.5] mb-[22px] max-w-[460px] mx-auto" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
                  {search ? (
                    <>Try a different search term or clear the filter.</>
                  ) : filter === "All" ? (
                    <><b className="font-bold" style={{ color: MA.T1 }}>Create your first</b> assignment to track student progress.</>
                  ) : filter === "To grade" ? (
                    <><b className="font-bold" style={{ color: MA.T1 }}>All caught up!</b> Submissions will appear here once students upload their work.</>
                  ) : filter === "Submitted" ? (
                    <>No fully-submitted assignments yet — check back as students turn in work.</>
                  ) : (
                    <>No drafts right now. Every assignment you create is published live.</>
                  )}
                </div>
                <button type="button" onClick={() => setView("create")}
                  className="inline-flex items-center gap-[7px] px-6 py-3 rounded-[13px] active:scale-[0.96] hover:scale-[1.02] transition-transform"
                  style={{
                    background: MA.P, color: "#fff",
                    fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
                    boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 5px 14px rgba(9,87,247,0.3)",
                    border: "none", fontFamily: MA.FONT,
                  }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Create Assignment
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(a => {
                  const accent = accentColor(a.status);
                  const pastDue = isDuePast(a.deadline);
                  const isActive = !pastDue && a.pendingGrading === 0;
                  return (
                    <div key={a.id}
                      onClick={() => { setSelectedAssignment(a); setView("grade"); }}
                      role="button" tabIndex={0}
                      {...tilt3D}
                      className="bg-white rounded-[20px] p-5 relative overflow-hidden active:scale-[0.99] transition-all cursor-pointer"
                      style={{ boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle }}>
                      <div className="absolute left-0 top-0 bottom-0 w-[4px] rounded-r-[3px]" style={{ background: accent }} />
                      {/* Head */}
                      <div className="flex items-start gap-3 mb-[14px]">
                        <div className="w-[46px] h-[46px] rounded-[13px] flex items-center justify-center text-white flex-shrink-0" style={{ background: accent }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-[8px]">
                            <div className="text-[16px] font-extrabold leading-[1.2] truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                              {a.title}
                            </div>
                            {isActive ? (
                              <span className="px-[11px] py-[5px] rounded-full text-[10px] font-extrabold flex items-center gap-[5px] flex-shrink-0"
                                style={{ background: "rgba(9,87,247,0.1)", color: MA.P, letterSpacing: "0.3px" }}>
                                <span className="w-[5px] h-[5px] rounded-full" style={{ background: MA.P }} />
                                Active
                              </span>
                            ) : (
                              <span className="px-[11px] py-[5px] rounded-full text-[10px] font-extrabold flex-shrink-0"
                                style={{ background: statusBadge(a.status).bg, color: statusBadge(a.status).color, letterSpacing: "0.3px" }}>
                                {statusBadge(a.status).text}
                              </span>
                            )}
                          </div>
                          {a.description && (
                            <div className="text-[12px] font-medium mt-[4px] truncate" style={{ color: MA.T3, letterSpacing: "-0.1px" }}>
                              {a.description}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 3-col metrics */}
                      <div className="grid grid-cols-3 gap-[1px] rounded-[12px] overflow-hidden p-[1px] mb-[13px]" style={{ background: MA.SURFACE }}>
                        <div className="py-[11px] px-[6px] text-center bg-white">
                          <div className="inline-block px-[9px] py-[3px] rounded-[6px] text-[12px] font-extrabold"
                            style={{ background: "rgba(9,87,247,0.08)", color: MA.P, letterSpacing: "-0.2px" }}>
                            {a.className || "—"}
                          </div>
                          <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Class</div>
                        </div>
                        <div className="py-[11px] px-[6px] text-center bg-white">
                          <div className="text-[14px] font-extrabold" style={{ color: pastDue ? MA.RED : MA.ORANGE, letterSpacing: "-0.3px" }}>
                            {timeRemaining(a.deadline)}
                          </div>
                          <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Due Date</div>
                        </div>
                        <div className="py-[11px] px-[6px] text-center bg-white">
                          <div className="text-[14px] font-extrabold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                            {a.subCount}/{a.expected}
                          </div>
                          <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Submitted</div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedAssignment(a); setView("grade"); }}
                          className="flex-1 h-11 rounded-[12px] flex items-center justify-center gap-[6px] hover:scale-[1.02] active:scale-[0.96] transition-transform"
                          style={{
                            background: MA.P, color: "#fff",
                            fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                            boxShadow: "0 1px 2px rgba(9,87,247,0.2), 0 3px 10px rgba(9,87,247,0.25)",
                            fontFamily: MA.FONT, border: "none",
                          }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                          Grade
                        </button>
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedAssignment(a); setView("grade"); }}
                          className="flex-1 h-11 rounded-[12px] flex items-center justify-center hover:scale-[1.02] active:scale-[0.96] transition-transform"
                          style={{
                            background: MA.SURFACE, color: MA.T1,
                            fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                            fontFamily: MA.FONT, border: "none",
                          }}>
                          View
                        </button>
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); handleDelete(a.id, a.title); }}
                          aria-label={`Delete ${a.title}`}
                          className="w-11 h-11 rounded-[12px] flex items-center justify-center hover:scale-[1.04] active:scale-[0.92] transition-transform"
                          style={{
                            background: "rgba(255,51,85,0.08)", color: MA.RED,
                            fontFamily: MA.FONT, border: "none",
                          }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/></svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* AI Intelligence */}
          {!loading && (
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
                  <div className="text-[11px] font-black uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>
                    AI Assignment Intelligence
                  </div>
                  <div className="ml-auto px-[11px] py-[5px] rounded-full text-[10px] font-extrabold"
                    style={{ background: "rgba(123,63,244,0.3)", border: "0.5px solid rgba(155,95,255,0.5)", color: "#DCC8FF", letterSpacing: "0.5px" }}>
                    Tip
                  </div>
                </div>
                {(() => {
                  const nextDue = assignments.filter(a => a.deadline > new Date()).sort((a, b) => a.deadline.getTime() - b.deadline.getTime())[0];
                  const nextDueLabel = nextDue ? timeRemaining(nextDue.deadline) : "—";
                  return (
                    <>
                      <div className="text-[14px] leading-[1.6] mb-5" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                        {stats.pendingGrading > 0 ? (
                          <><strong className="text-white font-bold">{stats.pendingGrading}</strong> submission{stats.pendingGrading === 1 ? "" : "s"} waiting for your review. Grading today keeps students in the loop.</>
                        ) : stats.totalActive === 0 ? (
                          <>No active assignments yet. <strong className="text-white font-bold">Create your first</strong> to start tracking submissions and grades.</>
                        ) : nextDue ? (
                          <><strong className="text-white font-bold">{stats.totalActive} active</strong> — <strong className="text-white font-bold">{nextDue.title}</strong> is due in {nextDueLabel.toLowerCase()}. Send a reminder to <strong className="text-white font-bold">{nextDue.className || "the class"}</strong> if submissions stall.</>
                        ) : (
                          <>Nothing to grade right now — <strong className="text-white font-bold">great job</strong> staying on top of submissions.</>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-[1px] rounded-[14px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                        <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                          <div className="text-[22px] font-extrabold text-white" style={{ letterSpacing: "-0.6px" }}>{stats.pendingGrading}</div>
                          <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Pending</div>
                        </div>
                        <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                          <div className="text-[22px] font-extrabold text-white" style={{ letterSpacing: "-0.6px" }}>{stats.totalActive}</div>
                          <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Active</div>
                        </div>
                        <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                          <div className="text-[22px] font-extrabold" style={{ color: "#FFD060", letterSpacing: "-0.6px" }}>{nextDueLabel}</div>
                          <div className="text-[10px] font-extrabold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Next Due</div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

        </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

    </div>
  );
};

export default Assignments;
