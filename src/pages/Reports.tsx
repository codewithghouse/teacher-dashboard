import { useState, useEffect } from "react";
import GenerateReport from "@/components/GenerateReport";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  type QueryConstraint, type DocumentData,
} from "firebase/firestore";
import { buildReport, openReportWindow } from "../lib/reportTemplate";
import { toast } from "sonner";

type ReportHistoryDoc = DocumentData & {
  id: string;
  status?: string;
  createdAt?: { toMillis?: () => number };
  publishedToTeacher?: boolean;
  format?: string;
};

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  hero:  "#08090C",
  bg:    "#F5F6F9",
  white: "#ffffff",
  ink1:  "#08090C",
  ink2:  "#42475A",
  ink3:  "#8C92A4",
  s1:    "#F5F6F9",
  s2:    "#ECEEF4",
  bdr:   "#E2E5EE",
  blue:  "#3B5BDB",
  blBg:  "#EDF2FF",
  grn:   "#087F5B",
  grn2:  "#2F9E44",
  glBg:  "#EBFBEE",
  red:   "#C92A2A",
  rlBg:  "#FFF5F5",
  amb:   "#C87014",
  alBg:  "#FFF9DB",
  tea:   "#0C8599",
  tlBg:  "#E3FAFC",
};

// ── Report card configs ───────────────────────────────────────────────────────
const REPORTS = [
  {
    id: "class_perf",
    title: "Class performance report",
    desc: "Comprehensive analysis of class performance including grades, attendance, and progress trends.",
    badge: "Popular", badgeBg: T.glBg, badgeCol: T.grn,
    band: T.blue, iconBg: T.blBg, iconCol: T.blue,
    formats: ["PDF", "Excel"],
    icon: (c: string) => (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round">
        <rect x="2" y="8" width="2.5" height="6" rx=".4" /><rect x="6.5" y="5" width="2.5" height="9" rx=".4" />
        <rect x="11" y="2" width="2.5" height="12" rx=".4" /><polyline points="2,7 6,4 10,5.5 14,1.5" />
      </svg>
    ),
  },
  {
    id: "individual_progress",
    title: "Individual progress report",
    desc: "Detailed report for individual students covering all academic metrics and personalised recommendations.",
    badge: "Detailed", badgeBg: T.tlBg, badgeCol: T.tea,
    band: T.tea, iconBg: T.tlBg, iconCol: T.tea,
    formats: ["PDF"],
    icon: (c: string) => (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="5.5" r="3" /><path d="M2 14s1.5-3.5 6-3.5 6 3.5 6 3.5" />
        <polyline points="11,3 12.5,4.5 15,2" />
      </svg>
    ),
  },
  {
    id: "attendance_summary",
    title: "Attendance summary",
    desc: "Monthly or term-wise attendance report with statistics and absentee analysis.",
    badge: "Monthly", badgeBg: T.alBg, badgeCol: T.amb,
    band: T.amb, iconBg: T.alBg, iconCol: T.amb,
    formats: ["PDF", "Excel"],
    icon: (c: string) => (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round">
        <circle cx="8" cy="8" r="6" /><polyline points="8,4.5 8,8 10.5,8" />
      </svg>
    ),
  },
  {
    id: "at_risk",
    title: "At-risk students report",
    desc: "List of students with academic or attendance concerns requiring urgent intervention.",
    badge: "Alert", badgeBg: T.rlBg, badgeCol: T.red,
    band: T.red, iconBg: T.rlBg, iconCol: T.red,
    formats: ["PDF", "Excel"],
    icon: (c: string) => (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2L15 14H1L8 2z" /><line x1="8" y1="6.5" x2="8" y2="10" />
        <circle cx="8" cy="12" r=".7" fill={c} stroke="none" />
      </svg>
    ),
  },
];

// Map report config ids to the lucide-based objects expected by GenerateReport
import { BarChart3, Users, Clock, AlertTriangle } from "lucide-react";
const REPORT_ICONS: Record<string, any> = {
  class_perf: BarChart3,
  individual_progress: Users,
  attendance_summary: Clock,
  at_risk: AlertTriangle,
};

const FILTERS = ["All", "PDF only", "Excel only"];

// ── Component ─────────────────────────────────────────────────────────────────
// Map report status → dot color (real, not always-green)
const statusDotColor = (status: string, T_: typeof T): string => {
  const s = (status || "").toLowerCase();
  if (s.includes("error") || s.includes("fail"))                              return T_.red;
  if (s.includes("sync") || s.includes("broadcast") || s.includes("report"))  return T_.grn2;
  if (s.includes("draft"))                                                    return T_.amb;
  return T_.ink3;
};

const Reports = () => {
  const { teacherData } = useAuth();
  const [filter, setFilter]               = useState("All");
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<(typeof REPORTS[number] & { format?: string }) | null>(null);
  const [history, setHistory]             = useState<ReportHistoryDoc[]>([]);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // ── Firebase: report history ────────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    let snap1: ReportHistoryDoc[] = [];
    let snap2: ReportHistoryDoc[] = [];
    const merge = () => {
      const seen = new Set<string>();
      const combined = [...snap1, ...snap2].filter(d => {
        if (seen.has(d.id)) return false;
        seen.add(d.id); return true;
      });
      combined.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setHistory(combined);
    };
    const schoolId = teacherData.schoolId;
    // schoolId-only at server; branchId in-memory. Memory:
    // bug_pattern_branch_filter_on_event_streams — server-side branchId
    // filter on event docs (reports) silently drops principal-broadcast
    // docs whose branchId field was missing OR hadn't been backfilled yet.
    const branchId = teacherData.branchId as string | undefined;
    const inBranch = (raw: any) => !branchId || !raw?.branchId || raw.branchId === branchId;

    const tenant: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    const unsub1 = onSnapshot(
      query(
        collection(db, "reports"),
        ...tenant,
        where("teacherId", "==", teacherData.id),
      ),
      snap => {
        snap1 = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as ReportHistoryDoc))
          .filter(inBranch);
        merge();
      },
      e => console.error("[Reports] own-reports subscription failed", e),
    );
    const unsub2 = onSnapshot(
      query(
        collection(db, "reports"),
        ...tenant,
        where("publishedToTeacher", "==", true),
      ),
      snap => {
        snap2 = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as ReportHistoryDoc))
          .filter(inBranch);
        merge();
      },
      e => console.error("[Reports] broadcast subscription failed", e),
    );
    return () => { unsub1(); unsub2(); };
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleOpenGenerate = (r: typeof REPORTS[0]) => {
    // Build a legacy-compatible report object for GenerateReport component
    setSelectedReport({
      id: r.id,
      title: r.title,
      desc: r.desc,
      formats: r.formats,
      icon: REPORT_ICONS[r.id] || BarChart3,
      color: "",
      popular: r.badge === "Popular",
      type: "",
    });
    setIsGenerateOpen(true);
  };

  // Open a history report in a new tab as a fully styled HTML view
  // (matches the principal-dashboard render). The school's logo, name,
  // and theme are embedded on the doc at publish time so we don't need
  // to fetch the principal's record here. Falls back to brand defaults
  // if the doc is older / missing those fields.
  const handleDownloadHistory = (h: any) => {
    try {
      const d = h.data || {};
      // Prefer template-specific heroStats + sections saved by principal
      // at generate-time. Falls back to legacy hardcoded shape so old
      // reports still render correctly.
      const heroStats = Array.isArray(d.heroStats) && d.heroStats.length > 0
        ? d.heroStats
        : [
            { label: "Total Students", value: d.totalStudents ?? "—" },
            { label: "Avg Attendance", value: `${d.avgAttendance ?? 0}%`, color: (d.avgAttendance ?? 0) >= 85 ? "#4ade80" : "#fbbf24" },
            { label: "Avg Marks",      value: `${d.avgMarks ?? 0}%`,      color: (d.avgMarks ?? 0)      >= 75 ? "#4ade80" : "#fbbf24" },
            { label: "At-Risk",        value: d.atRisk ?? "—",            color: (d.atRisk ?? 0)         > 0  ? "#f87171" : "#4ade80" },
          ];
      const sections = Array.isArray(d.sections) && d.sections.length > 0
        ? d.sections
        : [
            {
              title: "Performance Overview",
              type: "bars" as const,
              bars: [
                { label: "Average Attendance", value: d.avgAttendance ?? 0 },
                { label: "Average Marks",      value: d.avgMarks ?? 0 },
                { label: "Pass Rate",          value: d.passRate ?? 0 },
              ],
            },
            {
              title: "Key Metrics",
              type: "stats" as const,
              stats: [
                { label: "Total Students",       value: d.totalStudents ?? "—" },
                { label: "At-Risk Students",     value: d.atRisk ?? "0", color: "#dc2626" },
                { label: "Discipline Incidents", value: d.incidents ?? "0" },
                { label: "Report Type",          value: h.type || h.reportType || "General" },
                { label: "Status",               value: h.status || "Draft" },
              ],
            },
          ];

      const html = buildReport({
        title: h.title || "Report",
        subtitle: `Generated by ${h.generatedBy || "Principal"} · ${h.format || "PDF"} Format`,
        badge: h.className || h.grade || "",
        schoolName:
          h.branchName
          || (teacherData as any)?.branchName
          || h.schoolName
          || (teacherData as any)?.schoolName
          || "Edullent",
        generatedBy: h.generatedBy || "Principal",
        logoUrl: h.logoUrl || "",
        themeColor: h.themeColor || "#0055FF",
        heroStats,
        sections,
      });
      openReportWindow(html);
    } catch (e: any) {
      console.error("[Reports] open report failed:", e);
      toast.error("Could not open report. Try again.");
    }
  };

  // ── Filtered reports ────────────────────────────────────────────────────
  const filtered = REPORTS.filter(r => {
    if (filter === "PDF only") return r.formats.includes("PDF");
    if (filter === "Excel only") return r.formats.includes("Excel");
    return true;
  });

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>

    {/* ═══════════════════ MOBILE VIEW (new mockup) ═══════════════════ */}
    <MobileReports
      reports={REPORTS}
      filtered={filtered}
      filter={filter}
      setFilter={setFilter}
      history={history}
      showAllHistory={showAllHistory}
      setShowAllHistory={setShowAllHistory}
      schoolName={teacherData?.schoolName}
      onGenerate={handleOpenGenerate}
      onDownloadHistory={handleDownloadHistory}
    />

    {/* ═══════════════════ DESKTOP VIEW — Mobile design, widescreen grid ═══════════════════ */}
    <DesktopReports
      reports={REPORTS}
      filtered={filtered}
      filter={filter}
      setFilter={setFilter}
      history={history}
      showAllHistory={showAllHistory}
      setShowAllHistory={setShowAllHistory}
      schoolName={teacherData?.schoolName}
      onGenerate={handleOpenGenerate}
      onDownloadHistory={handleDownloadHistory}
    />
    {/* ═══════════════════ END DESKTOP VIEW ═══════════════════ */}

    {/* ═══ GENERATE REPORT MODAL (shared between mobile + desktop) ═══════════ */}
    <GenerateReport
      isOpen={isGenerateOpen}
      onOpenChange={setIsGenerateOpen}
      report={selectedReport}
    />
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Mobile-only Reports view (new mockup design)
// ─────────────────────────────────────────────────────────────────────────────
interface MobileReportsProps {
  reports: typeof REPORTS;
  filtered: typeof REPORTS;
  filter: string;
  setFilter: (f: string) => void;
  history: ReportHistoryDoc[];
  showAllHistory: boolean;
  setShowAllHistory: (v: boolean | ((p: boolean) => boolean)) => void;
  schoolName?: string;
  onGenerate: (r: typeof REPORTS[0]) => void;
  onDownloadHistory: (h: any) => void;
}

const MOB_TONES: Record<string, {
  name: "blue" | "teal" | "orange" | "red";
  tag: string;
  accent: string;
  iconGrad: string;
  iconShadow: string;
  btnGrad: string;
  tagBg: string;
  tagColor: string;
  tagBorder: string;
}> = {
  class_perf: {
    name: "blue", tag: "Popular",
    accent: "linear-gradient(90deg, #0055FF, #1166FF)",
    iconGrad: "linear-gradient(135deg, #0055FF, #1166FF)",
    iconShadow: "0 1px 2px rgba(0,85,255,.22), 0 4px 10px rgba(0,85,255,.25)",
    btnGrad: "linear-gradient(135deg, #0055FF, #1166FF)",
    tagBg: "rgba(0,200,83,.1)", tagColor: "#00C853", tagBorder: "rgba(0,200,83,.22)",
  },
  individual_progress: {
    name: "teal", tag: "Detailed",
    accent: "linear-gradient(90deg, #16B8B0, #2FD4CC)",
    iconGrad: "linear-gradient(135deg, #16B8B0, #2FD4CC)",
    iconShadow: "0 1px 2px rgba(22,184,176,.22), 0 4px 10px rgba(22,184,176,.25)",
    btnGrad: "linear-gradient(135deg, #16B8B0, #2FD4CC)",
    tagBg: "rgba(22,184,176,.12)", tagColor: "#16B8B0", tagBorder: "rgba(22,184,176,.25)",
  },
  attendance_summary: {
    name: "orange", tag: "Monthly",
    accent: "linear-gradient(90deg, #FF8800, #FFAB33)",
    iconGrad: "linear-gradient(135deg, #FF8800, #FFAB33)",
    iconShadow: "0 1px 2px rgba(255,136,0,.22), 0 4px 10px rgba(255,136,0,.25)",
    btnGrad: "linear-gradient(135deg, #FF8800, #FFAB33)",
    tagBg: "rgba(255,170,0,.12)", tagColor: "#FFAA00", tagBorder: "rgba(255,170,0,.25)",
  },
  at_risk: {
    name: "red", tag: "Alert",
    accent: "linear-gradient(90deg, #FF3355, #FF6680)",
    iconGrad: "linear-gradient(135deg, #FF3355, #FF6680)",
    iconShadow: "0 1px 2px rgba(255,51,85,.22), 0 4px 10px rgba(255,51,85,.25)",
    btnGrad: "linear-gradient(135deg, #FF3355, #E6244A)",
    tagBg: "rgba(255,51,85,.1)", tagColor: "#FF3355", tagBorder: "rgba(255,51,85,.22)",
  },
};

const MobileReports = ({
  reports, filtered, filter, setFilter, history,
  showAllHistory, setShowAllHistory, schoolName,
  onGenerate, onDownloadHistory,
}: MobileReportsProps) => {
  const generatedThisWeek = (() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return history.filter(h => {
      const ms = h.createdAt?.toMillis?.() || 0;
      return ms >= weekAgo;
    }).length;
  })();

  const counts = {
    all: reports.length,
    pdf: reports.filter(r => r.formats.includes("PDF")).length,
    excel: reports.filter(r => r.formats.includes("Excel")).length,
  };

  const fmtHistoryDate = (ts: any): string => {
    const d: Date | null = ts?.toDate?.() || (ts instanceof Date ? ts : null);
    if (!d) return "";
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      className="md:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px] pb-7 text-left"
      style={{
        background: "#EEF4FF",
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <style>{`
        .rp-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .rp-card3d:hover { transform: translateY(-4px) rotateX(4deg) rotateY(-3deg) scale(1.012); box-shadow: 0 1px 2px rgba(0,85,255,.08), 0 24px 44px rgba(0,85,255,.18), 0 8px 16px rgba(0,85,255,.1); } }
        .rp-card3d:active { transform: translateY(-1px) scale(.985); box-shadow: 0 1px 2px rgba(0,85,255,.1), 0 6px 16px rgba(0,85,255,.14); }
        .rp-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .rp-press:active { transform: scale(.94); }
        @keyframes rpFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes rpPulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
        .rp-pulse { animation: rpPulse 1.5s ease-in-out infinite; }
        .rp-enter > * { animation: rpFadeUp .45s cubic-bezier(.34,1.56,.64,1) both; }
        .rp-enter > *:nth-child(1) { animation-delay: .04s; }
        .rp-enter > *:nth-child(2) { animation-delay: .10s; }
        .rp-enter > *:nth-child(3) { animation-delay: .16s; }
        .rp-enter > *:nth-child(4) { animation-delay: .22s; }
        .rp-enter > *:nth-child(5) { animation-delay: .28s; }
        .rp-enter > *:nth-child(6) { animation-delay: .34s; }
        .rp-enter > *:nth-child(7) { animation-delay: .40s; }
        .rp-enter > *:nth-child(8) { animation-delay: .46s; }
        .rp-enter > *:nth-child(9) { animation-delay: .52s; }
      `}</style>

      <div className="rp-enter" style={{ display: "flex", flexDirection: "column" }}>

        {/* Page header */}
        <div style={{ padding: "8px 2px 14px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 5, height: 5, borderRadius: 2, background: "#0055FF", display: "inline-block" }} />
            Academic Documents
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>Reports</h1>
          <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, marginTop: 6, letterSpacing: "-0.15px" }}>
            Generate and download academic reports.
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <div style={{
              padding: "5px 11px", background: "rgba(0,85,255,.08)", color: "#0055FF",
              fontSize: 10, fontWeight: 700, borderRadius: 100, letterSpacing: "0.2px",
              display: "flex", alignItems: "center", gap: 5,
              border: "0.5px solid rgba(0,85,255,.15)",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
              </svg>
              {schoolName || "Edullent Main"}
            </div>
            <div style={{
              padding: "5px 11px", background: "rgba(0,85,255,.08)", color: "#0055FF",
              fontSize: 10, fontWeight: 700, borderRadius: 100, letterSpacing: "0.2px",
              display: "flex", alignItems: "center", gap: 5,
              border: "0.5px solid rgba(0,85,255,.15)",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
              </svg>
              {reports.length} report types
            </div>
          </div>
        </div>

        {/* HERO */}
        <div
          className="rp-card3d"
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            borderRadius: 26, padding: 22, marginBottom: 14,
            position: "relative", overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,26,102,.2), 0 12px 32px rgba(0,26,102,.32)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.1) 0%, transparent 45%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: "rgba(255,255,255,.16)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.24)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.8)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Report Center</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 2, fontWeight: 500, letterSpacing: "-0.1px" }}>Academic year {new Date().getFullYear()}-{String((new Date().getFullYear() + 1) % 100).padStart(2, "0")}</div>
              </div>
              <div style={{
                marginLeft: "auto",
                background: "rgba(255,255,255,.18)",
                border: "0.5px solid rgba(255,255,255,.3)",
                color: "#fff",
                padding: "5px 12px", borderRadius: 100,
                fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.3px",
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00E866", boxShadow: "0 0 8px #00E866" }} />
                Ready
              </div>
            </div>
            <div style={{ fontSize: 56, fontWeight: 700, color: "#fff", letterSpacing: "-2.6px", lineHeight: 1, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
              {reports.length}
              <span style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,.7)", letterSpacing: "-0.4px" }}>types</span>
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.78)", marginBottom: 20, fontWeight: 500, letterSpacing: "-0.15px" }}>
              <b style={{ color: "#fff", fontWeight: 700 }}>{generatedThisWeek} generated</b> this week · all formats supported.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden" }}>
              <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>{reports.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Types</div>
              </div>
              <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#6FFFAA", letterSpacing: "-0.5px" }}>{history.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Generated</div>
              </div>
              <div style={{ background: "rgba(0,10,51,.7)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#FFDD55", letterSpacing: "-0.5px" }}>{generatedThisWeek}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>This Week</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div
          style={{
            display: "flex", gap: 6, background: "#fff", padding: 5,
            borderRadius: 14, marginBottom: 14,
            boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 2px 10px rgba(0,85,255,.08)",
            border: "0.5px solid rgba(0,85,255,.07)",
          }}
        >
          {[
            { key: "All", label: "All", count: counts.all },
            { key: "PDF only", label: "PDF only", count: counts.pdf },
            { key: "Excel only", label: "Excel only", count: counts.excel },
          ].map(f => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className="rp-press"
                style={{
                  flex: 1, padding: "9px 8px", borderRadius: 10,
                  fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                  color: active ? "#fff" : "#5070B0",
                  background: active ? "linear-gradient(135deg, #0055FF, #1166FF)" : "transparent",
                  boxShadow: active ? "0 1px 2px rgba(0,85,255,.22), 0 3px 10px rgba(0,85,255,.28)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                }}
              >
                {f.label}
                <span style={{
                  background: active ? "rgba(255,255,255,.22)" : "#F4F7FE",
                  color: active ? "#fff" : "#5070B0",
                  fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 100,
                }}>{f.count}</span>
              </button>
            );
          })}
        </div>

        {/* Section head */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 4px 10px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px" }}>Available Reports</span>
            <span style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>Tap to generate</span>
          </div>
        </div>

        {/* Report cards */}
        {filtered.length === 0 ? (
          <div className="rp-card3d" style={{
            background: "#fff", borderRadius: 20, padding: "32px 20px", textAlign: "center",
            boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
            border: "0.5px solid rgba(0,85,255,.07)", marginBottom: 14,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", marginBottom: 5, letterSpacing: "-0.3px" }}>No reports match this filter</div>
            <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px" }}>
              Try switching to <b style={{ color: "#0055FF", fontWeight: 700 }}>All</b> to see every report type.
            </div>
          </div>
        ) : filtered.map(r => {
          const tone = MOB_TONES[r.id] || MOB_TONES.class_perf;
          return (
            <div
              key={r.id}
              className="rp-card3d"
              onClick={() => onGenerate(r)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGenerate(r); } }}
              style={{
                background: "#fff", borderRadius: 20, padding: 0, marginBottom: 11,
                position: "relative", overflow: "hidden", cursor: "pointer",
                boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                border: "0.5px solid rgba(0,85,255,.07)",
              }}
            >
              <div style={{ height: 4, width: "100%", background: tone.accent }} />
              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: 14,
                    background: tone.iconGrad, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    boxShadow: tone.iconShadow,
                  }}>
                    {r.icon("#fff")}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px", lineHeight: 1.2 }}>{r.title}</div>
                      <div style={{
                        flexShrink: 0, padding: "3px 9px", borderRadius: 100,
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase",
                        display: "flex", alignItems: "center", gap: 4,
                        background: tone.tagBg, color: tone.tagColor,
                        border: `0.5px solid ${tone.tagBorder}`,
                      }}>
                        {tone.name === "blue" && <span style={{ color: "#00C853", fontSize: 10, marginTop: -1 }}>★</span>}
                        {tone.name === "red" && <span className="rp-pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF3355" }} />}
                        {tone.tag}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "#5070B0", lineHeight: 1.5, fontWeight: 500, letterSpacing: "-0.1px", marginBottom: 10 }}>{r.desc}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {r.formats.map(fmt => (
                        <span key={fmt} style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "4px 9px", background: "#F4F7FE", color: "#002080",
                          fontSize: 10, fontWeight: 700, borderRadius: 6,
                          letterSpacing: "0.2px",
                          border: "0.5px solid rgba(0,85,255,.07)",
                        }}>
                          <span style={{
                            width: 5, height: 5, borderRadius: 2,
                            background: fmt === "PDF" ? "#FF3355" : "#00C853",
                          }} />
                          {fmt}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onGenerate(r); }}
                className="rp-press"
                style={{
                  width: "100%", height: 44, borderRadius: 0, border: "none",
                  cursor: "pointer", fontSize: 13, fontWeight: 700,
                  letterSpacing: "-0.2px", color: "#fff",
                  background: tone.btnGrad,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  fontFamily: "inherit", position: "relative", overflow: "hidden",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Generate Report
              </button>
            </div>
          );
        })}

        {/* History section */}
        <div style={{ padding: "12px 4px 10px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px" }}>Recent reports</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 4 }}>
                {history.length === 0 ? "History" : `${history.length} report${history.length === 1 ? "" : "s"} generated`}
              </div>
            </div>
            {history.length > 10 && (
              <button
                type="button"
                onClick={() => setShowAllHistory(v => !v)}
                className="rp-press"
                style={{
                  fontSize: 11, color: "#0055FF", fontWeight: 700,
                  background: "none", border: "none", cursor: "pointer",
                  marginTop: 4, fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 4,
                  letterSpacing: "-0.15px",
                }}
              >
                {showAllHistory ? "Show less" : "View all"}
              </button>
            )}
          </div>
        </div>

        {history.length === 0 ? (
          <div className="rp-card3d" style={{
            background: "#fff", borderRadius: 20, padding: "32px 20px", textAlign: "center",
            boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
            border: "0.5px solid rgba(0,85,255,.07)",
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 20, background: "linear-gradient(145deg, rgba(0,85,255,.08), rgba(17,102,255,.04))",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 12px", color: "#0055FF",
              boxShadow: "0 0 0 6px rgba(0,85,255,.05)",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", marginBottom: 5, letterSpacing: "-0.3px" }}>No reports generated yet</div>
            <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px" }}>
              Tap any report above to generate your first one.
            </div>
          </div>
        ) : (
          <div
            className="rp-card3d"
            style={{
              background: "#fff", borderRadius: 20, padding: 4,
              boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
              border: "0.5px solid rgba(0,85,255,.07)",
              overflow: "hidden",
            }}
          >
            {(showAllHistory ? history : history.slice(0, 10)).map((h, idx) => {
              const tone = MOB_TONES[h.type as string] || MOB_TONES.class_perf;
              const iconBg = tone.name === "blue"
                ? { bg: "rgba(0,85,255,.08)", color: "#0055FF" }
                : tone.name === "teal"
                ? { bg: "rgba(22,184,176,.1)", color: "#16B8B0" }
                : tone.name === "orange"
                ? { bg: "rgba(255,136,0,.1)", color: "#FF8800" }
                : { bg: "rgba(255,51,85,.1)", color: "#FF3355" };
              const status = (h.status || "Draft") as string;
              const isReady = /report|ready|sync|broadcast/i.test(status);
              const statusColor = isReady ? "#00C853" : /error|fail/i.test(status) ? "#FF3355" : "#FF8800";
              const statusLabel = isReady ? "Ready" : /error|fail/i.test(status) ? "Error" : "Draft";
              const fmt = (h.format || "PDF").toString().toUpperCase();

              return (
                <div
                  key={h.id}
                  onClick={() => onDownloadHistory(h)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDownloadHistory(h); } }}
                  style={{
                    display: "flex", alignItems: "center", gap: 11,
                    padding: "12px 10px", borderRadius: 16,
                    cursor: "pointer", position: "relative",
                    borderTop: idx > 0 ? "0.5px solid rgba(0,85,255,.07)" : "none",
                    transition: "background .15s cubic-bezier(.2,.9,.3,1)",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#F4F7FE"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: iconBg.bg, color: iconBg.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, position: "relative",
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <span style={{
                      position: "absolute", bottom: -3, right: -3,
                      background: fmt === "PDF" ? "#FF3355" : "#00C853",
                      color: "#fff", fontSize: 7, fontWeight: 700,
                      padding: "2px 4px", borderRadius: 4,
                      letterSpacing: "0.2px",
                      border: "2px solid #fff", lineHeight: 1,
                    }}>{fmt}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.25px", lineHeight: 1.2, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(h.title as string) || "Report"}
                      {(h.grade || h.className) ? ` — ${h.grade || h.className}` : ""}
                    </div>
                    <div style={{ fontSize: 10, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor, boxShadow: `0 0 4px ${statusColor}55` }} />
                      <span style={{ fontWeight: 700, color: statusColor }}>{statusLabel}</span>
                      <span style={{ color: "#99AACC" }}>·</span>
                      <span>{fmt} Format</span>
                      <span style={{ color: "#99AACC" }}>·</span>
                      <span style={{ color: "#99AACC" }}>{fmtHistoryDate(h.createdAt)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onDownloadHistory(h); }}
                    aria-label="Download report"
                    className="rp-press"
                    style={{
                      width: 32, height: 32, borderRadius: 10,
                      background: "rgba(0,85,255,.08)", color: "#0055FF",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, cursor: "pointer",
                      border: "0.5px solid rgba(0,85,255,.1)",
                      fontFamily: "inherit",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Desktop-only Reports view — mirrors mobile design in a widescreen grid
// ─────────────────────────────────────────────────────────────────────────────
const DesktopReports = ({
  reports, filtered, filter, setFilter, history,
  showAllHistory, setShowAllHistory, schoolName,
  onGenerate, onDownloadHistory,
}: MobileReportsProps) => {
  const generatedThisWeek = (() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return history.filter(h => {
      const ms = h.createdAt?.toMillis?.() || 0;
      return ms >= weekAgo;
    }).length;
  })();

  const counts = {
    all: reports.length,
    pdf: reports.filter(r => r.formats.includes("PDF")).length,
    excel: reports.filter(r => r.formats.includes("Excel")).length,
  };

  const fmtHistoryDate = (ts: any): string => {
    const d: Date | null = ts?.toDate?.() || (ts instanceof Date ? ts : null);
    if (!d) return "";
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-8 pt-8 pb-12 text-left"
      style={{
        background: "#EEF4FF",
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <style>{`
        .rpd-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .rpd-card3d:hover { transform: translateY(-3px) scale(1.004); box-shadow: 0 1px 2px rgba(0,85,255,.08), 0 24px 44px rgba(0,85,255,.18), 0 8px 16px rgba(0,85,255,.1); } }
        .rpd-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .rpd-press:active { transform: scale(.96); }
        @keyframes rpdPulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
        .rpd-pulse { animation: rpdPulse 1.5s ease-in-out infinite; }
      `}</style>

      <div style={{ maxWidth: 1600, margin: "0 auto" }}>

        {/* Page header row */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: "#0055FF", display: "inline-block" }} />
              Academic Documents
            </div>
            <h1 style={{ fontSize: 40, fontWeight: 700, color: "#001040", letterSpacing: "-1.4px", lineHeight: 1.05, margin: 0 }}>Reports</h1>
            <div style={{ fontSize: 14, color: "#5070B0", fontWeight: 500, marginTop: 8, letterSpacing: "-0.15px" }}>
              Generate and download academic reports.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{
              padding: "7px 14px", background: "rgba(0,85,255,.08)", color: "#0055FF",
              fontSize: 11, fontWeight: 700, borderRadius: 100, letterSpacing: "0.2px",
              display: "flex", alignItems: "center", gap: 6,
              border: "0.5px solid rgba(0,85,255,.15)",
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
              </svg>
              {schoolName || "Edullent Main"}
            </div>
            <div style={{
              padding: "7px 14px", background: "rgba(0,85,255,.08)", color: "#0055FF",
              fontSize: 11, fontWeight: 700, borderRadius: 100, letterSpacing: "0.2px",
              display: "flex", alignItems: "center", gap: 6,
              border: "0.5px solid rgba(0,85,255,.15)",
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
              </svg>
              {reports.length} report types
            </div>
          </div>
        </div>

        {/* HERO — full width */}
        <div
          className="rpd-card3d"
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            borderRadius: 28, padding: 32, marginBottom: 18,
            position: "relative", overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,26,102,.2), 0 12px 32px rgba(0,26,102,.32)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.1) 0%, transparent 45%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: 15, background: "rgba(255,255,255,.16)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.24)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.8)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Report Center</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,.55)", marginTop: 3, fontWeight: 500, letterSpacing: "-0.1px" }}>Academic year {new Date().getFullYear()}-{String((new Date().getFullYear() + 1) % 100).padStart(2, "0")}</div>
              </div>
              <div style={{
                marginLeft: "auto",
                background: "rgba(255,255,255,.18)",
                border: "0.5px solid rgba(255,255,255,.3)",
                color: "#fff",
                padding: "7px 14px", borderRadius: 100,
                fontSize: 11, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 7, letterSpacing: "0.3px",
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00E866", boxShadow: "0 0 8px #00E866" }} />
                Ready
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 84, fontWeight: 700, color: "#fff", letterSpacing: "-3.8px", lineHeight: 1, marginBottom: 10, display: "flex", alignItems: "baseline", gap: 10 }}>
                  {reports.length}
                  <span style={{ fontSize: 32, fontWeight: 700, color: "rgba(255,255,255,.7)", letterSpacing: "-0.6px" }}>types</span>
                </div>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,.78)", fontWeight: 500, letterSpacing: "-0.15px" }}>
                  <b style={{ color: "#fff", fontWeight: 700 }}>{generatedThisWeek} generated</b> this week · all formats supported.
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.12)", borderRadius: 14, padding: 1, overflow: "hidden", minWidth: 380 }}>
                <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", letterSpacing: "-0.7px" }}>{reports.length}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Types</div>
                </div>
                <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#6FFFAA", letterSpacing: "-0.7px" }}>{history.length}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>Generated</div>
                </div>
                <div style={{ background: "rgba(0,10,51,.7)", padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#FFDD55", letterSpacing: "-0.7px" }}>{generatedThisWeek}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4 }}>This Week</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filter tabs + section head row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#001040", letterSpacing: "-0.4px" }}>Available Reports</span>
            <span style={{ fontSize: 12, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>Click to generate</span>
          </div>
          <div
            style={{
              display: "flex", gap: 6, background: "#fff", padding: 5,
              borderRadius: 14,
              boxShadow: "0 0.5px 1px rgba(0,85,255,.04), 0 2px 10px rgba(0,85,255,.08)",
              border: "0.5px solid rgba(0,85,255,.07)",
            }}
          >
            {[
              { key: "All", label: "All", count: counts.all },
              { key: "PDF only", label: "PDF only", count: counts.pdf },
              { key: "Excel only", label: "Excel only", count: counts.excel },
            ].map(f => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className="rpd-press"
                  style={{
                    padding: "9px 16px", borderRadius: 10,
                    fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                    color: active ? "#fff" : "#5070B0",
                    background: active ? "linear-gradient(135deg, #0055FF, #1166FF)" : "transparent",
                    boxShadow: active ? "0 1px 2px rgba(0,85,255,.22), 0 3px 10px rgba(0,85,255,.28)" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    border: "none", cursor: "pointer", fontFamily: "inherit",
                    transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                  }}
                >
                  {f.label}
                  <span style={{
                    background: active ? "rgba(255,255,255,.22)" : "#F4F7FE",
                    color: active ? "#fff" : "#5070B0",
                    fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 100,
                  }}>{f.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Report cards — 2×2 grid */}
        {filtered.length === 0 ? (
          <div className="rpd-card3d" style={{
            background: "#fff", borderRadius: 20, padding: "48px 24px", textAlign: "center",
            boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
            border: "0.5px solid rgba(0,85,255,.07)", marginBottom: 18,
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#001040", marginBottom: 6, letterSpacing: "-0.3px" }}>No reports match this filter</div>
            <div style={{ fontSize: 13, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px" }}>
              Try switching to <b style={{ color: "#0055FF", fontWeight: 700 }}>All</b> to see every report type.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 18 }}>
            {filtered.map(r => {
              const tone = MOB_TONES[r.id] || MOB_TONES.class_perf;
              return (
                <div
                  key={r.id}
                  className="rpd-card3d"
                  onClick={() => onGenerate(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGenerate(r); } }}
                  style={{
                    background: "#fff", borderRadius: 22, padding: 0,
                    position: "relative", overflow: "hidden", cursor: "pointer",
                    boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                    border: "0.5px solid rgba(0,85,255,.07)",
                  }}
                >
                  <div style={{ height: 5, width: "100%", background: tone.accent }} />
                  <div style={{ padding: 22 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
                      <div style={{
                        width: 54, height: 54, borderRadius: 15,
                        background: tone.iconGrad, color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        boxShadow: tone.iconShadow,
                      }}>
                        {r.icon("#fff")}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                          <div style={{ fontSize: 17, fontWeight: 700, color: "#001040", letterSpacing: "-0.4px", lineHeight: 1.2 }}>{r.title}</div>
                          <div style={{
                            flexShrink: 0, padding: "4px 11px", borderRadius: 100,
                            fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase",
                            display: "flex", alignItems: "center", gap: 5,
                            background: tone.tagBg, color: tone.tagColor,
                            border: `0.5px solid ${tone.tagBorder}`,
                          }}>
                            {tone.name === "blue" && <span style={{ color: "#00C853", fontSize: 11, marginTop: -1 }}>★</span>}
                            {tone.name === "red" && <span className="rpd-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF3355" }} />}
                            {tone.tag}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: "#5070B0", lineHeight: 1.55, fontWeight: 500, letterSpacing: "-0.1px", marginBottom: 12 }}>{r.desc}</div>
                        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                          {r.formats.map(fmt => (
                            <span key={fmt} style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              padding: "5px 11px", background: "#F4F7FE", color: "#002080",
                              fontSize: 11, fontWeight: 700, borderRadius: 7,
                              letterSpacing: "0.2px",
                              border: "0.5px solid rgba(0,85,255,.07)",
                            }}>
                              <span style={{
                                width: 6, height: 6, borderRadius: 2,
                                background: fmt === "PDF" ? "#FF3355" : "#00C853",
                              }} />
                              {fmt}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onGenerate(r); }}
                    className="rpd-press"
                    style={{
                      width: "100%", height: 50, borderRadius: 0, border: "none",
                      cursor: "pointer", fontSize: 14, fontWeight: 700,
                      letterSpacing: "-0.2px", color: "#fff",
                      background: tone.btnGrad,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      fontFamily: "inherit", position: "relative", overflow: "hidden",
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Generate Report
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* History section header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "8px 4px 12px" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#001040", letterSpacing: "-0.4px" }}>Recent reports</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 5 }}>
              {history.length === 0 ? "History" : `${history.length} report${history.length === 1 ? "" : "s"} generated`}
            </div>
          </div>
          {history.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAllHistory(v => !v)}
              className="rpd-press"
              style={{
                fontSize: 12, color: "#0055FF", fontWeight: 700,
                background: "none", border: "none", cursor: "pointer",
                marginTop: 6, fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 5,
                letterSpacing: "-0.15px",
              }}
            >
              {showAllHistory ? "Show less" : "View all"}
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="rpd-card3d" style={{
            background: "#fff", borderRadius: 22, padding: "56px 24px", textAlign: "center",
            boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
            border: "0.5px solid rgba(0,85,255,.07)",
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: 22, background: "linear-gradient(145deg, rgba(0,85,255,.08), rgba(17,102,255,.04))",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 14px", color: "#0055FF",
              boxShadow: "0 0 0 6px rgba(0,85,255,.05)",
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#001040", marginBottom: 6, letterSpacing: "-0.3px" }}>No reports generated yet</div>
            <div style={{ fontSize: 13, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px" }}>
              Click any report above to generate your first one.
            </div>
          </div>
        ) : (
          <div
            className="rpd-card3d"
            style={{
              background: "#fff", borderRadius: 22, padding: 6,
              boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
              border: "0.5px solid rgba(0,85,255,.07)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 0 }}>
              {(showAllHistory ? history : history.slice(0, 10)).map((h, idx, arr) => {
                const tone = MOB_TONES[h.type as string] || MOB_TONES.class_perf;
                const iconBg = tone.name === "blue"
                  ? { bg: "rgba(0,85,255,.08)", color: "#0055FF" }
                  : tone.name === "teal"
                  ? { bg: "rgba(22,184,176,.1)", color: "#16B8B0" }
                  : tone.name === "orange"
                  ? { bg: "rgba(255,136,0,.1)", color: "#FF8800" }
                  : { bg: "rgba(255,51,85,.1)", color: "#FF3355" };
                const status = (h.status || "Draft") as string;
                const isReady = /report|ready|sync|broadcast/i.test(status);
                const statusColor = isReady ? "#00C853" : /error|fail/i.test(status) ? "#FF3355" : "#FF8800";
                const statusLabel = isReady ? "Ready" : /error|fail/i.test(status) ? "Error" : "Draft";
                const fmt = (h.format || "PDF").toString().toUpperCase();
                // First column has odd indices (0, 2, 4...); both cols need their own last-row detection
                const isLastRow = idx >= arr.length - 2;

                return (
                  <div
                    key={h.id}
                    onClick={() => onDownloadHistory(h)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDownloadHistory(h); } }}
                    style={{
                      display: "flex", alignItems: "center", gap: 13,
                      padding: "14px 12px", borderRadius: 16,
                      cursor: "pointer", position: "relative",
                      borderTop: !isLastRow ? "none" : "none",
                      borderBottom: !isLastRow ? "0.5px solid rgba(0,85,255,.07)" : "none",
                      borderRight: idx % 2 === 0 ? "0.5px solid rgba(0,85,255,.07)" : "none",
                      transition: "background .15s cubic-bezier(.2,.9,.3,1)",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#F4F7FE"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{
                      width: 44, height: 44, borderRadius: 13,
                      background: iconBg.bg, color: iconBg.color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, position: "relative",
                    }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                      <span style={{
                        position: "absolute", bottom: -3, right: -3,
                        background: fmt === "PDF" ? "#FF3355" : "#00C853",
                        color: "#fff", fontSize: 8, fontWeight: 700,
                        padding: "2px 5px", borderRadius: 4,
                        letterSpacing: "0.2px",
                        border: "2px solid #fff", lineHeight: 1,
                      }}>{fmt}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", letterSpacing: "-0.25px", lineHeight: 1.2, marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {(h.title as string) || "Report"}
                        {(h.grade || h.className) ? ` — ${h.grade || h.className}` : ""}
                      </div>
                      <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, boxShadow: `0 0 4px ${statusColor}55` }} />
                        <span style={{ fontWeight: 700, color: statusColor }}>{statusLabel}</span>
                        <span style={{ color: "#99AACC" }}>·</span>
                        <span>{fmt} Format</span>
                        <span style={{ color: "#99AACC" }}>·</span>
                        <span style={{ color: "#99AACC" }}>{fmtHistoryDate(h.createdAt)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onDownloadHistory(h); }}
                      aria-label="Download report"
                      className="rpd-press"
                      style={{
                        width: 36, height: 36, borderRadius: 11,
                        background: "rgba(0,85,255,.08)", color: "#0055FF",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, cursor: "pointer",
                        border: "0.5px solid rgba(0,85,255,.1)",
                        fontFamily: "inherit",
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default Reports;
