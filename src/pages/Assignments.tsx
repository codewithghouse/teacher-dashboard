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
  FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
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
// Returns "—" when the assignment has no due date — preferred over the old
// `new Date()` fallback that would render "Due Today" / "0d ago" for any
// dateless assignment, misleading teachers about a deadline that doesn't exist.
const timeRemaining = (date: Date | null) => {
  if (!date) return "—";
  const diff = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (diff === 0) return "Due Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0)  return `${Math.abs(diff)}d ago`;
  return `${diff}d left`;
};

const isDuePast = (date: Date | null) => !!date && date.getTime() < Date.now();

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

type FilterKey = "All" | "To grade" | "Submitted";

// Firestore `in` operator caps at 30 values per query; chunk inputs to stay
// under the limit. Returns [] when input is empty so we don't fire empty
// queries.
const chunked = <T,>(arr: T[], size = 30): T[][] => {
  if (arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// One-time read of the user's reduced-motion preference. The tilt3D helper
// returns mouse-tilt handlers + a transform; for users who set OS-level
// "reduce motion" we skip both. Checked once at component mount — most users
// don't toggle this mid-session.
const prefersReducedMotion = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

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
  // Styled delete-confirmation state — replaces native window.confirm() which
  // was unstyled and jarring on mobile.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Memoised once on mount. Tilt + tilt-style become no-ops when the user
  // prefers reduced motion.
  const reducedMotion = prefersReducedMotion();
  const tiltProps  = reducedMotion ? {} : tilt3D;
  const tiltStyles = reducedMotion ? {} : tilt3DStyle;

  // Global Escape handler for the delete-confirm modal — window-level so it
  // works regardless of which element inside the dialog is focused.
  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !deleting) setPendingDelete(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete, deleting]);

  useEffect(() => {
    if (!teacherData?.id) return;
    const schoolId = teacherData.schoolId;
    const branchId = teacherData.branchId as string | undefined;
    if (!schoolId) return;
    setLoading(true);

    // cancelled flag — guards against state updates after unmount or after a
    // subsequent snapshot fires while the previous batch is still in flight.
    let cancelled = false;

    // branchScope intentionally DROPPED from resolution-entity queries
    // (teaching_assignments / classes). Writers across principal + owner
    // dashboards stamp branchId inconsistently — a class doc without
    // branchId silently fails a `where branchId == X` filter and the teacher
    // sees ZERO classes (even though the class roster + their teaching
    // assignment exist). School-scoped is sufficient: each teacher belongs
    // to exactly one school, so cross-school leak isn't possible.
    // `status == "active"` filter also dropped — moved to client-side so
    // legacy teaching_assignments docs without a status field still resolve.
    void branchId;

    const unsub = onSnapshot(
      query(
        collection(db, "teaching_assignments"),
        where("schoolId", "==", schoolId),
        where("teacherId", "==", teacherData.id),
      ),
      async (assignSnap) => {
        try {
          const activeDocs = assignSnap.docs.filter(d => {
            const s = (d.data() as { status?: unknown }).status;
            return !s || (typeof s === "string" && s.toLowerCase() === "active");
          });
          const teachingAssignments = activeDocs.map(d => ({ id: d.id, ...d.data() } as any));
          const assignedClassIds    = teachingAssignments.map((t: any) => t.classId).filter(Boolean);
          const legacySnap          = await getDocs(query(
            collection(db, "classes"),
            where("schoolId", "==", schoolId),
            where("teacherId", "==", teacherData.id),
          ));
          if (cancelled) return;
          const legacyIds           = legacySnap.docs.map(d => d.id);
          const allClassIds         = Array.from(new Set([...assignedClassIds, ...legacyIds]));

          if (!allClassIds.length) {
            setAssignments([]);
            setStats({ totalActive: 0, dueThisWeek: 0, pendingGrading: 0, avgSubmission: 0 });
            setLoading(false);
            return;
          }

          // Bulk-fetch assignments by classId — the canonical join. The prior
          // query also required `teacherId == teacherData.id` and a branchScope
          // filter, but BOTH suppressed legitimate matches: a freshly-onboarded
          // teacher's own newly-created assignment carries teacherId == new
          // teacher's id (matches), yet branchId on `assignments` was sometimes
          // empty when the principal's class doc had no branchId, so the
          // assignment's branchId-stamp inherited the empty value and the
          // branchScope filter dropped it. Schools we ship to are single-
          // tenant (one school per teacher), so school-scoped + classId is
          // sufficient. Firestore `in` caps at 10 — chunk by 10, not 30.
          const classChunks = chunked(allClassIds, 10);
          const aSnaps = await Promise.all(classChunks.map(ch => getDocs(query(
            collection(db, "assignments"),
            where("schoolId", "==", schoolId),
            where("classId", "in", ch),
          ))));
          if (cancelled) return;
          const map = new Map<string, any>();
          aSnaps.forEach(s => s.docs.forEach(d => {
            if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
          }));
          const raw = Array.from(map.values());

          if (raw.length === 0) {
            setAssignments([]);
            setStats({ totalActive: 0, dueThisWeek: 0, pendingGrading: 0, avgSubmission: 0 });
            setLoading(false);
            return;
          }

          // Bulk-fetch all dependent collections in 4 chunked groups instead
          // of per-assignment fetches. Was 4N round trips for N assignments
          // (e.g., 80 for 20 assignments); now ~4 × ceil(N/30) — usually 4.
          const aIds = raw.map(a => a.id);
          // Firestore `in` caps at 10 — chunk by 10 across all lookups, not
          // 30. The prior code's 30-cap would silently truncate when more
          // than 10 ids landed in a chunk (the API would return only the
          // first 10's worth of hits — the rest of the chunk became invisible).
          const aChunks = chunked(aIds, 10);
          const cChunks = chunked(allClassIds, 10);
          // School-scoped only for ALL these lookups. branchScope dropped on
          // enrollments to match the rest of this file — see resolution-entity
          // rationale above.
          // DUAL-KEY READ on `results` — GradeAssignment writer stamps
          // `homeworkId: assignment.id` (canonical) and `assignmentId: <teaching_assignment_id || "legacy">`.
          // If the assignment doc has no `assignmentId` field, every result
          // lands with assignmentId="legacy" → a single-key query by
          // assignmentId silently misses every graded record, leaving the
          // status pill stuck on "N To Grade" forever. Mirror the dual
          // pattern already used for submissions above. See bug_pattern_dual_id_writer_or_short_circuit.
          const [
            subsByAid, subsByHid,
            resultsByAid, resultsByHid,
            enrollByCid,
          ] = await Promise.all([
            Promise.all(aChunks.map(ch => getDocs(query(collection(db, "submissions"), where("schoolId", "==", schoolId), where("assignmentId", "in", ch))))),
            Promise.all(aChunks.map(ch => getDocs(query(collection(db, "submissions"), where("schoolId", "==", schoolId), where("homeworkId",   "in", ch))))),
            Promise.all(aChunks.map(ch => getDocs(query(collection(db, "results"),     where("schoolId", "==", schoolId), where("assignmentId", "in", ch))))),
            Promise.all(aChunks.map(ch => getDocs(query(collection(db, "results"),     where("schoolId", "==", schoolId), where("homeworkId",   "in", ch))))),
            Promise.all(cChunks.map(ch => getDocs(query(collection(db, "enrollments"), where("schoolId", "==", schoolId), where("classId", "in", ch))))),
          ]);
          if (cancelled) return;

          // Bucket per assignment / class.
          const subsMap = new Map<string, Map<string, true>>(); // assignmentId → Set<student-key>
          const ingestSubs = (snap: any, idField: string) => snap.docs.forEach((d: any) => {
            const data = d.data();
            const aid = data[idField];
            if (!aid) return;
            const sid = data.studentId || data.studentEmail || d.id;
            if (!subsMap.has(aid)) subsMap.set(aid, new Map());
            subsMap.get(aid)!.set(sid, true);
          });
          subsByAid.forEach(snap => ingestSubs(snap, "assignmentId"));
          subsByHid.forEach(snap => ingestSubs(snap, "homeworkId"));

          // Dedupe results across both query paths by docId before counting.
          // Per-doc canonical key = homeworkId (matches assignment.id);
          // assignmentId="legacy" never matches a real assignment id so we
          // skip those entries explicitly.
          const resultDocsByAssign = new Map<string, Set<string>>();
          const ingestResults = (snap: any) => snap.docs.forEach((d: any) => {
            const data = d.data();
            const aid = data.homeworkId || data.assignmentId;
            if (!aid || aid === "legacy") return;
            if (!resultDocsByAssign.has(aid)) resultDocsByAssign.set(aid, new Set());
            resultDocsByAssign.get(aid)!.add(d.id);
          });
          resultsByAid.forEach(ingestResults);
          resultsByHid.forEach(ingestResults);

          const resultsCount = new Map<string, number>();
          for (const [aid, set] of resultDocsByAssign) {
            resultsCount.set(aid, set.size);
          }

          const enrollCount = new Map<string, number>();
          enrollByCid.forEach(snap => snap.docs.forEach(d => {
            const cid = d.data().classId;
            if (!cid) return;
            enrollCount.set(cid, (enrollCount.get(cid) || 0) + 1);
          }));

          const now      = new Date();
          const nextWeek = new Date(now.getTime() + 7 * 86400000);

          const enriched = raw.map((a: any) => {
            // dueDate parsing — explicit null when no field exists, so the UI
            // can render "No due date" instead of fabricating "due now". Was:
            // fallback to `new Date()` which made every dateless assignment
            // look as if it was due RIGHT NOW.
            let deadline: Date | null = null;
            if      (a.dueDate?.toDate)   deadline = a.dueDate.toDate();
            else if (a.dueDate)           { const d = new Date(a.dueDate); if (!isNaN(d.getTime())) deadline = d; }
            else if (a.deadline)          { const d = new Date(a.deadline); if (!isNaN(d.getTime())) deadline = d; }
            else if (a.createdAt?.toDate) deadline = new Date(a.createdAt.toDate().getTime() + 7 * 86400000);
            const subCount = subsMap.get(a.id)?.size || 0;
            // expected = real enrollment count; null when class has no roster
            // yet (was: silently defaulted to 1, which made empty classes show
            // "Fully Submitted" the moment any stray submission landed).
            const expected = enrollCount.has(a.classId) ? enrollCount.get(a.classId)! : null;
            const pendingGrading = Math.max(0, subCount - (resultsCount.get(a.id) || 0));

            let status = "Active";
            if (pendingGrading > 0) {
              status = `${pendingGrading} To Grade`;
            } else if (expected !== null && expected > 0 && subCount >= expected) {
              status = "Fully Submitted";
            } else if (deadline && deadline < now) {
              status = "Completed";
            } else if (expected === 0) {
              status = "No Roster";
            }

            return { ...a, deadline, subCount, expected, pendingGrading, status };
          });

          // Sort: missing-deadline assignments at the bottom; otherwise nearest first.
          enriched.sort((a, b) => {
            const aT = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
            const bT = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
            return aT - bT;
          });
          setAssignments(enriched);

          const active        = enriched.filter(a => a.deadline && a.deadline > now).length;
          const dueSoon       = enriched.filter(a => a.deadline && a.deadline > now && a.deadline <= nextWeek).length;
          const pending       = enriched.reduce((acc, a) => acc + a.pendingGrading, 0);
          // Avg submission: only include classes with a real roster (expected > 0).
          // Empty-roster classes used to bias the average toward 100% via
          // expected||1, now they're excluded entirely.
          const rosterAssignments = enriched.filter(a => a.expected !== null && a.expected > 0);
          const totalStudents = rosterAssignments.reduce((acc, a) => acc + (a.expected as number), 0);
          const totalSubs     = rosterAssignments.reduce((acc, a) => acc + a.subCount, 0);
          setStats({
            totalActive:    active,
            dueThisWeek:    dueSoon,
            pendingGrading: pending,
            avgSubmission:  totalStudents > 0 ? Math.round((totalSubs / totalStudents) * 100) : 0,
          });
          setLoading(false);
        } catch (err) {
          if (cancelled) return;
          console.error("[Assignments] load failed", err);
          setLoading(false);
        }
      }
    );
    return () => { cancelled = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Delete flow: clicking the trash icon opens a styled confirm modal
  // (replaces native window.confirm which was unstyled and jarring on mobile).
  // The actual write happens on modal-confirm.
  const requestDelete = (id: string, title: string) => setPendingDelete({ id, title });
  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await auditedDelete(doc(db, "assignments", pendingDelete.id));
      toast.success("Assignment deleted.");
      setPendingDelete(null);
    } catch (e) {
      console.error("[Assignments] delete failed", e);
      toast.error("Failed to delete assignment.");
    } finally {
      setDeleting(false);
    }
  };

  // Sub-views
  if (view === "create") return <CreateAssignment onCancel={() => setView("list")} onCreate={() => setView("list")} />;
  if (view === "grade")  return <GradeAssignment  assignment={selectedAssignment}  onBack={() => setView("list")} />;

  // Filter — "Submitted" now requires expected to be > 0 (not just truthy)
  // since expected is now `number | null`, never the old `|| 1` default.
  const filtered = assignments.filter(a => {
    const matchSearch = a.title?.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filter === "To grade")  return a.pendingGrading > 0;
    if (filter === "Submitted") return a.expected !== null && a.expected > 0 && a.subCount >= a.expected;
    return true;
  });

  // "Draft" chip removed — no writer ever sets a draft status field, so the
  // tab was permanently empty (dead UI promising a feature that doesn't exist).
  const filterChips: FilterKey[] = ["All", "To grade", "Submitted"];

  // Class-wise grouping — teacher requested seeing assignments sectioned by
  // class instead of a flat chronological list. Sections sorted alphabetically
  // by class name; assignments within each section keep the existing
  // deadline-asc ordering from the loader.
  const groupedByClass = filtered.reduce<Array<{ classId: string; className: string; items: any[] }>>((acc, a) => {
    const cid = a.classId || "__unassigned__";
    const cn  = a.className || "Unassigned";
    let g = acc.find(x => x.classId === cid);
    if (!g) { g = { classId: cid, className: cn, items: [] }; acc.push(g); }
    g.items.push(a);
    return acc;
  }, []).sort((a, b) => a.className.localeCompare(b.className));

  // Per-class submission stats for the AI Insights panel. Drives the
  // "lowest-engagement class" suggestion below.
  const classStats = groupedByClass.map(g => {
    const totalSub = g.items.reduce((acc, a) => acc + a.subCount, 0);
    const totalExp = g.items.reduce((acc, a) => acc + (a.expected || 0), 0);
    const pending  = g.items.reduce((acc, a) => acc + a.pendingGrading, 0);
    const subRate  = totalExp > 0 ? Math.round((totalSub / totalExp) * 100) : null;
    return { classId: g.classId, className: g.className, count: g.items.length, subRate, pending };
  });
  const weakestClass = [...classStats]
    .filter(c => c.subRate !== null && c.count > 0)
    .sort((a, b) => (a.subRate as number) - (b.subRate as number))[0];
  const heaviestPendingClass = [...classStats]
    .filter(c => c.pending > 0)
    .sort((a, b) => b.pending - a.pending)[0];

  return (
    <div style={{ fontFamily: 'inherit' }} className="min-h-screen pb-28 md:pb-0 text-left">

      {/* ═══════════════════ MOBILE VIEW (EduIntellect v2) ═══════════════════ */}
      <div className="md:hidden" style={{ fontFamily: MA.FONT, background: "#EEF4FF", minHeight: "100vh", margin: "0 -16px", paddingBottom: 8 }}>

        {/* Page header */}
        <div className="px-4 pt-3 pb-[14px]">
          <div className="flex items-center gap-[7px] text-[9px] font-bold uppercase mb-[6px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
            <span className="w-[5px] h-[5px] rounded-[2px]" style={{ background: MA.P }} />
            Teacher Dashboard · Assignments
          </div>
          <h1 className="text-[28px] font-bold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.1px" }}>
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
                <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Total Active</div>
                <div className="text-[11px] font-medium mt-[2px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Across all classes</div>
              </div>
              <div className="ml-auto px-3 py-[5px] rounded-full text-[10px] font-bold"
                style={{
                  background: "rgba(9,87,247,0.3)",
                  border: "0.5px solid rgba(74,133,255,0.55)",
                  color: "#B5CEFF",
                  letterSpacing: "0.3px",
                }}>
                This Week
              </div>
            </div>
            <div className="text-[54px] font-bold text-white leading-none mb-[6px] flex items-baseline" style={{ letterSpacing: "-2.4px" }}>
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
                <div className="text-[18px] font-bold" style={{ color: stats.dueThisWeek > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.5px" }}>{stats.dueThisWeek}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Due</div>
              </div>
              <div className="py-[12px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-bold" style={{ color: stats.pendingGrading > 0 ? "#FF9AA9" : "#fff", letterSpacing: "-0.5px" }}>{stats.pendingGrading}</div>
                <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Pending</div>
              </div>
              <div className="py-[12px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                <div className="text-[18px] font-bold" style={{ color: stats.avgSubmission >= 80 ? "#6FFFAA" : "#fff", letterSpacing: "-0.5px" }}>{stats.avgSubmission}%</div>
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
              fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
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
              tintBg: "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)", tintBorder: "rgba(0,85,255,0.10)",
              sub: stats.totalActive > 0
                ? <span className="font-bold" style={{ color: MA.P }}>● Currently running</span>
                : <span className="font-semibold" style={{ color: MA.T3 }}>No active work</span>,
              onClick: () => setFilter("All"),
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
              decor: <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h6"/></svg>,
            },
            {
              key: "due", label: "Due This Week", val: stats.dueThisWeek, color: MA.ORANGE,
              tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)", tintBorder: "rgba(255,136,0,0.14)",
              sub: stats.dueThisWeek > 0
                ? <span className="font-bold" style={{ color: MA.ORANGE }}>● Due in 7 days</span>
                : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All clear</span>,
              onClick: () => setFilter("All"),
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
              decor: <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
            },
            {
              key: "pending", label: "Pending Grading", val: stats.pendingGrading, color: stats.pendingGrading > 0 ? MA.RED : MA.GREEN,
              tintBg: stats.pendingGrading > 0
                ? "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)"
                : "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)",
              tintBorder: stats.pendingGrading > 0 ? "rgba(255,51,85,0.14)" : "rgba(0,200,83,0.16)",
              sub: stats.pendingGrading > 0
                ? <span className="font-bold" style={{ color: MA.RED }}>● Needs review</span>
                : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All caught up</span>,
              onClick: () => setFilter("To grade"),
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>,
              decor: <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.6" fill="currentColor"/></svg>,
            },
            {
              key: "avg", label: "Avg Submission", val: `${stats.avgSubmission}%`, color: stats.avgSubmission >= 80 ? MA.GREEN : MA.VIOLET,
              tintBg: stats.avgSubmission >= 80
                ? "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)"
                : "linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)",
              tintBorder: stats.avgSubmission >= 80 ? "rgba(0,200,83,0.16)" : "rgba(123,63,244,0.12)",
              sub: stats.avgSubmission >= 80
                ? <span className="font-bold" style={{ color: MA.GREEN }}>✓ Strong</span>
                : stats.avgSubmission > 0
                  ? <span className="font-bold" style={{ color: MA.P }}>● In progress</span>
                  : <span className="font-semibold" style={{ color: MA.T3 }}>Awaiting subs</span>,
              onClick: () => setFilter("Submitted"),
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
              decor: <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
            },
          ] as const).map(s => (
            <button key={s.key} type="button" onClick={s.onClick}
              {...tiltProps}
              className="rounded-[20px] p-4 relative flex flex-col text-left overflow-hidden active:scale-[0.96] transition-transform"
              style={{ background: s.tintBg, boxShadow: "0 6px 18px rgba(20,40,90,0.06), 0 1px 3px rgba(20,40,90,0.04)", border: `0.5px solid ${s.tintBorder}`, fontFamily: MA.FONT, ...tiltStyles }}>
              <div className="absolute pointer-events-none" style={{ right: 10, bottom: 8, color: s.color, opacity: 0.22 }}>
                {s.decor}
              </div>
              <div className="flex-shrink-0 w-[34px] h-[34px] rounded-[10px] flex items-center justify-center mb-[10px]" style={{ background: `${s.color}1F`, color: s.color }}>
                {s.icon}
              </div>
              <div className="text-[10px] font-bold uppercase leading-[1.3] mb-[6px]" style={{ color: s.color, letterSpacing: "1px" }}>
                {s.label}
              </div>
              <div className="text-[28px] font-bold leading-none" style={{ color: MA.T1, letterSpacing: "-1.2px" }}>{s.val}</div>
              <div className="text-[11px] font-semibold mt-[6px] flex items-center gap-[5px] relative" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
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
              /* Submitted */     assignments.filter(a => a.expected !== null && a.expected > 0 && a.subCount >= a.expected).length;
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
                <span className="text-[10px] font-bold px-[6px] py-[1px] rounded-full min-w-[16px] text-center"
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
                <div className="absolute -top-[6px] -right-[6px] w-[24px] h-[24px] rounded-full flex items-center justify-center text-white text-[14px] font-bold"
                  style={{ background: MA.P, border: "3px solid #fff", boxShadow: "0 2px 6px rgba(9,87,247,0.35)" }}>
                  +
                </div>
              </div>
              <div className="text-[17px] font-bold mb-[6px]" style={{ color: MA.T1, letterSpacing: "-0.5px" }}>
                {search ? "No matches" : filter === "All" ? "No assignments yet" : `No "${filter}" items`}
              </div>
              <div className="text-[13px] font-medium leading-[1.5] mb-[18px] px-[10px]" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
                {search ? (
                  <>Try a different search term or clear the filter.</>
                ) : filter === "All" ? (
                  <><b className="font-bold" style={{ color: MA.T1 }}>Create your first</b> assignment to track student progress.</>
                ) : filter === "To grade" ? (
                  <><b className="font-bold" style={{ color: MA.T1 }}>All caught up!</b><br />Submissions will appear here once students upload their work.</>
                ) : (
                  <>No fully-submitted assignments yet — check back as students turn in work.</>
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
            /* Class-wise grouped layout — section header per class, then the
               cards. Past-due cards render dimmed so the teacher can scan
               which assignments still need follow-up at a glance. */
            <div className="flex flex-col gap-[14px]">
              {groupedByClass.map(g => (
                <div key={g.classId} className="flex flex-col gap-[8px]">
                  <div className="flex items-center gap-[8px] px-[2px]">
                    <span className="text-[10px] font-bold uppercase" style={{ color: MA.P, letterSpacing: "1.4px" }}>{g.className}</span>
                    <span className="flex-1 h-[0.5px]" style={{ background: "rgba(0,85,255,0.10)" }} />
                    <span className="text-[10px] font-bold" style={{ color: MA.T4 }}>{g.items.length}</span>
                  </div>
                  {g.items.map(a => {
              const accent = accentColor(a.status);
              const pastDue = isDuePast(a.deadline);
              const isActive = !pastDue && a.pendingGrading === 0;
              return (
                  <div key={a.id}
                    onClick={() => { setSelectedAssignment(a); setView("grade"); }}
                    role="button" tabIndex={0}
                    {...tiltProps}
                    className="bg-white rounded-[18px] p-[14px] relative overflow-hidden active:scale-[0.985] transition-transform cursor-pointer"
                    style={{ boxShadow: MA.SH, border: MA.BDR, opacity: pastDue ? 0.62 : 1, filter: pastDue ? "grayscale(0.45)" : "none", ...tiltStyles }}>
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px]" style={{ background: accent }} />
                    {/* Head */}
                    <div className="flex items-start gap-[11px] mb-[12px]">
                      <div className="w-10 h-10 rounded-[12px] flex items-center justify-center text-white flex-shrink-0" style={{ background: accent }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-[8px]">
                          <div className="text-[15px] font-bold leading-[1.2] truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                            {a.title}
                          </div>
                          {isActive ? (
                            <span className="px-[10px] py-[4px] rounded-full text-[10px] font-bold flex items-center gap-[5px] flex-shrink-0"
                              style={{ background: "rgba(9,87,247,0.1)", color: MA.P, letterSpacing: "0.3px" }}>
                              <span className="w-[5px] h-[5px] rounded-full" style={{ background: MA.P }} />
                              Active
                            </span>
                          ) : (
                            <span className="px-[10px] py-[4px] rounded-full text-[10px] font-bold flex-shrink-0"
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
                        <div className="inline-block px-[8px] py-[2px] rounded-[6px] text-[11px] font-bold"
                          style={{ background: "rgba(9,87,247,0.08)", color: MA.P, letterSpacing: "-0.2px" }}>
                          {a.className || "—"}
                        </div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Class</div>
                      </div>
                      <div className="py-[9px] px-[6px] text-center bg-white">
                        <div className="text-[13px] font-bold" style={{ color: pastDue ? MA.RED : MA.ORANGE, letterSpacing: "-0.3px" }}>
                          {timeRemaining(a.deadline)}
                        </div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Due Date</div>
                      </div>
                      <div className="py-[9px] px-[6px] text-center bg-white">
                        <div className="text-[13px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                          {a.subCount}/{a.expected ?? "—"}
                        </div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Submitted</div>
                      </div>
                    </div>

                    {/* Actions — "View" button removed; it had identical
                        navigation to "Grade", just deceiving users with two
                        buttons that did the same thing. */}
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
                        Grade {a.pendingGrading > 0 ? `· ${a.pendingGrading}` : ""}
                      </button>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); requestDelete(a.id, a.title); }}
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
              ))}
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
                <div className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.8px" }}>
                  AI Assignment Intelligence
                </div>
                <div className="ml-auto px-[10px] py-[4px] rounded-full text-[9px] font-bold"
                  style={{ background: "rgba(123,63,244,0.3)", border: "0.5px solid rgba(155,95,255,0.5)", color: "#DCC8FF", letterSpacing: "0.5px" }}>
                  Tip
                </div>
              </div>
              {(() => {
                // Multi-signal analysis — picks the most actionable insight
                // by priority order: pending grading → weak class → next due → all clear.
                const now = new Date();
                const nextDue = assignments.filter(a => a.deadline && a.deadline > now).sort((a, b) => (a.deadline as Date).getTime() - (b.deadline as Date).getTime())[0];
                const nextDueLabel = nextDue ? timeRemaining(nextDue.deadline) : "—";
                const overdueCount = assignments.filter(a => a.deadline && a.deadline < now && a.expected !== null && a.subCount < a.expected).length;
                return (
                  <>
                    <div className="text-[13px] leading-[1.6] mb-[14px]" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.15px" }}>
                      {stats.totalActive === 0 && assignments.length === 0 ? (
                        <>No active assignments yet. <strong className="text-white font-bold">Create your first</strong> to start tracking submissions and grades.</>
                      ) : heaviestPendingClass && heaviestPendingClass.pending > 0 ? (
                        <><strong className="text-white font-bold">{heaviestPendingClass.pending}</strong> submission{heaviestPendingClass.pending === 1 ? "" : "s"} from <strong className="text-white font-bold">{heaviestPendingClass.className}</strong> waiting for your review. Grade these first to keep students unblocked.</>
                      ) : weakestClass && weakestClass.subRate !== null && weakestClass.subRate < 60 ? (
                        <><strong className="text-white font-bold">{weakestClass.className}</strong> has the lowest submission rate at <strong className="text-white font-bold">{weakestClass.subRate}%</strong>. {nextDue ? <>Next deadline is <strong className="text-white font-bold">{nextDue.title}</strong> in {nextDueLabel.toLowerCase()} — </> : null}consider sending a class reminder.</>
                      ) : overdueCount > 0 ? (
                        <><strong className="text-white font-bold">{overdueCount} overdue</strong> assignment{overdueCount === 1 ? "" : "s"} with incomplete submissions. Follow up with parents or extend the deadline.</>
                      ) : nextDue ? (
                        <><strong className="text-white font-bold">{stats.totalActive} active</strong> — <strong className="text-white font-bold">{nextDue.title}</strong> ({nextDue.className || "—"}) due in {nextDueLabel.toLowerCase()}. {(nextDue.expected !== null && nextDue.subCount < nextDue.expected * 0.5) ? "Submissions still slow — a reminder may help." : "Submissions tracking on schedule."}</>
                      ) : (
                        <>All caught up — <strong className="text-white font-bold">no pending grading</strong> and no upcoming deadlines. Use this gap to plan the next assignment.</>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-[1px] rounded-[12px] overflow-hidden p-[1px]" style={{ background: "rgba(255,255,255,0.1)" }}>
                      <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                        <div className="text-[17px] font-bold text-white" style={{ letterSpacing: "-0.4px" }}>{stats.pendingGrading}</div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Pending</div>
                      </div>
                      <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                        <div className="text-[17px] font-bold text-white" style={{ letterSpacing: "-0.4px" }}>{stats.totalActive}</div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Active</div>
                      </div>
                      <div className="py-[11px] px-[4px] text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                        <div className="text-[17px] font-bold" style={{ color: "#FFD060", letterSpacing: "-0.4px" }}>{nextDueLabel}</div>
                        <div className="text-[8px] font-bold uppercase mt-[3px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1px" }}>Next Due</div>
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
            <div className="flex items-center gap-[7px] text-[10px] font-bold uppercase mb-[8px]" style={{ color: MA.T3, letterSpacing: "1.8px" }}>
              <span className="w-[6px] h-[6px] rounded-[2px]" style={{ background: MA.P }} />
              Teacher Dashboard · Assignments
            </div>
            <h1 className="text-[40px] font-bold leading-[1.05]" style={{ color: MA.T1, letterSpacing: "-1.4px" }}>Assignments</h1>
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
                  <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px" }}>Total Active</div>
                  <div className="text-[12px] font-medium mt-[3px]" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "-0.1px" }}>Across all classes</div>
                </div>
                <div className="ml-auto px-4 py-[7px] rounded-full text-[11px] font-bold"
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
                  <div className="text-[84px] font-bold text-white leading-none mb-[6px] flex items-baseline" style={{ letterSpacing: "-3.8px" }}>
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
                    <div className="text-[26px] font-bold" style={{ color: stats.dueThisWeek > 0 ? "#FFD060" : "#fff", letterSpacing: "-0.8px" }}>{stats.dueThisWeek}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Due</div>
                  </div>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-bold" style={{ color: stats.pendingGrading > 0 ? "#FF9AA9" : "#fff", letterSpacing: "-0.8px" }}>{stats.pendingGrading}</div>
                    <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.58)", letterSpacing: "1.1px" }}>Pending</div>
                  </div>
                  <div className="py-4 px-5 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                    <div className="text-[26px] font-bold" style={{ color: stats.avgSubmission >= 80 ? "#6FFFAA" : "#fff", letterSpacing: "-0.8px" }}>{stats.avgSubmission}%</div>
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
                fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px",
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
                tintBg: "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)", tintBorder: "rgba(0,85,255,0.10)",
                sub: stats.totalActive > 0
                  ? <span className="font-bold" style={{ color: MA.P }}>● Currently running</span>
                  : <span className="font-semibold" style={{ color: MA.T3 }}>No active work</span>,
                onClick: () => setFilter("All"),
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
                decor: <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h6"/></svg>,
              },
              {
                key: "due", label: "Due This Week", val: stats.dueThisWeek, color: MA.ORANGE,
                tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)", tintBorder: "rgba(255,136,0,0.14)",
                sub: stats.dueThisWeek > 0
                  ? <span className="font-bold" style={{ color: MA.ORANGE }}>● Due in 7 days</span>
                  : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All clear</span>,
                onClick: () => setFilter("All"),
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
                decor: <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
              },
              {
                key: "pending", label: "Pending Grading", val: stats.pendingGrading, color: stats.pendingGrading > 0 ? MA.RED : MA.GREEN,
                tintBg: stats.pendingGrading > 0
                  ? "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)"
                  : "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)",
                tintBorder: stats.pendingGrading > 0 ? "rgba(255,51,85,0.14)" : "rgba(0,200,83,0.16)",
                sub: stats.pendingGrading > 0
                  ? <span className="font-bold" style={{ color: MA.RED }}>● Needs review</span>
                  : <span className="font-bold" style={{ color: MA.GREEN }}>✓ All caught up</span>,
                onClick: () => setFilter("To grade"),
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>,
                decor: <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.6" fill="currentColor"/></svg>,
              },
              {
                key: "avg", label: "Avg Submission", val: `${stats.avgSubmission}%`, color: stats.avgSubmission >= 80 ? MA.GREEN : MA.VIOLET,
                tintBg: stats.avgSubmission >= 80
                  ? "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)"
                  : "linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)",
                tintBorder: stats.avgSubmission >= 80 ? "rgba(0,200,83,0.16)" : "rgba(123,63,244,0.12)",
                sub: stats.avgSubmission >= 80
                  ? <span className="font-bold" style={{ color: MA.GREEN }}>✓ Strong</span>
                  : stats.avgSubmission > 0
                    ? <span className="font-bold" style={{ color: MA.P }}>● In progress</span>
                    : <span className="font-semibold" style={{ color: MA.T3 }}>Awaiting subs</span>,
                onClick: () => setFilter("Submitted"),
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
                decor: <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
              },
            ] as const).map(s => (
              <button key={s.key} type="button" onClick={s.onClick}
                {...tiltProps}
                className="rounded-[22px] p-5 relative flex flex-col text-left overflow-hidden active:scale-[0.98] transition-all"
                style={{ background: s.tintBg, boxShadow: "0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04)", border: `0.5px solid ${s.tintBorder}`, fontFamily: MA.FONT, ...tiltStyles }}>
                <div className="absolute pointer-events-none" style={{ right: 14, bottom: 12, color: s.color, opacity: 0.22 }}>
                  {s.decor}
                </div>
                <div className="flex-shrink-0 w-[40px] h-[40px] rounded-[12px] flex items-center justify-center mb-[14px]" style={{ background: `${s.color}1F`, color: s.color }}>
                  {s.icon}
                </div>
                <div className="text-[11px] font-bold uppercase leading-[1.3] mb-[8px]" style={{ color: s.color, letterSpacing: "1px" }}>
                  {s.label}
                </div>
                <div className="text-[36px] font-bold leading-none" style={{ color: MA.T1, letterSpacing: "-1.6px" }}>{s.val}</div>
                <div className="text-[12px] font-semibold mt-2 flex items-center gap-[5px] relative" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
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
                  /* Submitted */     assignments.filter(a => a.expected !== null && a.expected > 0 && a.subCount >= a.expected).length;
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
                    <span className="text-[10px] font-bold px-[7px] py-[2px] rounded-full min-w-[18px] text-center"
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
                  <div className="absolute -top-[7px] -right-[7px] w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-[16px] font-bold"
                    style={{ background: MA.P, border: "3px solid #fff", boxShadow: "0 2px 6px rgba(9,87,247,0.35)" }}>
                    +
                  </div>
                </div>
                <div className="text-[20px] font-bold mb-[8px]" style={{ color: MA.T1, letterSpacing: "-0.5px" }}>
                  {search ? "No matches" : filter === "All" ? "No assignments yet" : `No "${filter}" items`}
                </div>
                <div className="text-[14px] font-medium leading-[1.5] mb-[22px] max-w-[460px] mx-auto" style={{ color: MA.T3, letterSpacing: "-0.15px" }}>
                  {search ? (
                    <>Try a different search term or clear the filter.</>
                  ) : filter === "All" ? (
                    <><b className="font-bold" style={{ color: MA.T1 }}>Create your first</b> assignment to track student progress.</>
                  ) : filter === "To grade" ? (
                    <><b className="font-bold" style={{ color: MA.T1 }}>All caught up!</b> Submissions will appear here once students upload their work.</>
                  ) : (
                    <>No fully-submitted assignments yet — check back as students turn in work.</>
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
              /* Class-wise grouped layout — each class is its own section
                 spanning full width, with the cards rendered inside a sub-grid.
                 Past-due cards dim via opacity + slight grayscale. */
              <div className="flex flex-col gap-6">
                {groupedByClass.map(g => (
                  <div key={g.classId}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-[11px] font-bold uppercase" style={{ color: MA.P, letterSpacing: "1.5px" }}>{g.className}</span>
                      <span className="flex-1 h-[0.5px]" style={{ background: "rgba(0,85,255,0.10)" }} />
                      <span className="text-[11px] font-bold" style={{ color: MA.T4 }}>{g.items.length} {g.items.length === 1 ? "item" : "items"}</span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {g.items.map(a => {
                  const accent = accentColor(a.status);
                  const pastDue = isDuePast(a.deadline);
                  const isActive = !pastDue && a.pendingGrading === 0;
                  return (
                    <div key={a.id}
                      onClick={() => { setSelectedAssignment(a); setView("grade"); }}
                      role="button" tabIndex={0}
                      {...tiltProps}
                      className="bg-white rounded-[20px] p-5 relative overflow-hidden active:scale-[0.99] transition-all cursor-pointer"
                      style={{ boxShadow: MA.SH, border: MA.BDR, opacity: pastDue ? 0.62 : 1, filter: pastDue ? "grayscale(0.45)" : "none", ...tiltStyles }}>
                      <div className="absolute left-0 top-0 bottom-0 w-[4px] rounded-r-[3px]" style={{ background: accent }} />
                      {/* Head */}
                      <div className="flex items-start gap-3 mb-[14px]">
                        <div className="w-[46px] h-[46px] rounded-[13px] flex items-center justify-center text-white flex-shrink-0" style={{ background: accent }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-[8px]">
                            <div className="text-[16px] font-bold leading-[1.2] truncate" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                              {a.title}
                            </div>
                            {isActive ? (
                              <span className="px-[11px] py-[5px] rounded-full text-[10px] font-bold flex items-center gap-[5px] flex-shrink-0"
                                style={{ background: "rgba(9,87,247,0.1)", color: MA.P, letterSpacing: "0.3px" }}>
                                <span className="w-[5px] h-[5px] rounded-full" style={{ background: MA.P }} />
                                Active
                              </span>
                            ) : (
                              <span className="px-[11px] py-[5px] rounded-full text-[10px] font-bold flex-shrink-0"
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
                          <div className="inline-block px-[9px] py-[3px] rounded-[6px] text-[12px] font-bold"
                            style={{ background: "rgba(9,87,247,0.08)", color: MA.P, letterSpacing: "-0.2px" }}>
                            {a.className || "—"}
                          </div>
                          <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Class</div>
                        </div>
                        <div className="py-[11px] px-[6px] text-center bg-white">
                          <div className="text-[14px] font-bold" style={{ color: pastDue ? MA.RED : MA.ORANGE, letterSpacing: "-0.3px" }}>
                            {timeRemaining(a.deadline)}
                          </div>
                          <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Due Date</div>
                        </div>
                        <div className="py-[11px] px-[6px] text-center bg-white">
                          <div className="text-[14px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>
                            {a.subCount}/{a.expected ?? "—"}
                          </div>
                          <div className="text-[9px] font-bold uppercase mt-[4px]" style={{ color: MA.T3, letterSpacing: "1px" }}>Submitted</div>
                        </div>
                      </div>

                      {/* Actions — "View" removed (was identical to Grade). */}
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
                          Grade {a.pendingGrading > 0 ? `· ${a.pendingGrading}` : ""}
                        </button>
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); requestDelete(a.id, a.title); }}
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
                  </div>
                ))}
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
                  <div className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "1.9px" }}>
                    AI Assignment Intelligence
                  </div>
                  <div className="ml-auto px-[11px] py-[5px] rounded-full text-[10px] font-bold"
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
                          <div className="text-[22px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{stats.pendingGrading}</div>
                          <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Pending</div>
                        </div>
                        <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                          <div className="text-[22px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{stats.totalActive}</div>
                          <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Active</div>
                        </div>
                        <div className="py-4 px-3 text-center" style={{ background: "rgba(0,20,80,0.55)" }}>
                          <div className="text-[22px] font-bold" style={{ color: "#FFD060", letterSpacing: "-0.6px" }}>{nextDueLabel}</div>
                          <div className="text-[10px] font-bold uppercase mt-[4px]" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "1.1px" }}>Next Due</div>
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

      {/* ═══════════════════ DELETE CONFIRM MODAL ═══════════════════ */}
      {pendingDelete && (
        <div
          role="dialog" aria-modal="true" aria-label={`Delete ${pendingDelete.title}`}
          onClick={() => !deleting && setPendingDelete(null)}
          onKeyDown={e => { if (e.key === "Escape" && !deleting) setPendingDelete(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,16,64,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16, fontFamily: MA.FONT }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: MA.CARD, borderRadius: 22, width: 420, maxWidth: "100%", padding: 24, boxShadow: "0 20px 60px rgba(0,8,40,0.3)" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(255,51,85,0.10)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={MA.RED} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/></svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-bold" style={{ color: MA.T1, letterSpacing: "-0.3px" }}>Delete this assignment?</div>
                <div className="text-[12px] mt-[2px] truncate" style={{ color: MA.T3 }}>"{pendingDelete.title}"</div>
              </div>
            </div>
            <p className="text-[13px] mb-5" style={{ color: MA.T3, lineHeight: 1.5 }}>
              All linked submissions and grading data will remain in the database, but this assignment will no longer appear in your list. <b style={{ color: MA.T1 }}>This cannot be undone.</b>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPendingDelete(null)} disabled={deleting}
                style={{ flex: "0 0 110px", height: 44, borderRadius: 12, background: MA.SURFACE, color: MA.T1, fontSize: 13, fontWeight: 700, border: "none", cursor: deleting ? "not-allowed" : "pointer", fontFamily: MA.FONT, opacity: deleting ? 0.55 : 1 }}>
                Cancel
              </button>
              <button type="button" onClick={confirmDelete} disabled={deleting} autoFocus
                style={{ flex: 1, height: 44, borderRadius: 12, background: MA.RED, color: "#fff", fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px", border: "none", cursor: deleting ? "not-allowed" : "pointer", fontFamily: MA.FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: "0 1px 2px rgba(255,51,85,0.25), 0 6px 16px rgba(255,51,85,0.30)", opacity: deleting ? 0.7 : 1 }}>
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/></svg>}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Assignments;
