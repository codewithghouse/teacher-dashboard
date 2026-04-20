import { useState, useEffect } from "react";
import GenerateReport from "@/components/GenerateReport";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  type QueryConstraint, type DocumentData,
} from "firebase/firestore";

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
    const branchId = teacherData.branchId as string | undefined;
    const tenant: QueryConstraint[] = branchId
      ? [where("schoolId", "==", schoolId), where("branchId", "==", branchId)]
      : [where("schoolId", "==", schoolId)];
    const unsub1 = onSnapshot(
      query(
        collection(db, "reports"),
        ...tenant,
        where("teacherId", "==", teacherData.id),
      ),
      snap => { snap1 = snap.docs.map(d => ({ ...d.data(), id: d.id } as ReportHistoryDoc)); merge(); },
      e => console.error("[Reports] own-reports subscription failed", e),
    );
    const unsub2 = onSnapshot(
      query(
        collection(db, "reports"),
        ...tenant,
        where("publishedToTeacher", "==", true),
      ),
      snap => { snap2 = snap.docs.map(d => ({ ...d.data(), id: d.id } as ReportHistoryDoc)); merge(); },
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

  // Download a single history item as JSON (the report's stored snapshot)
  const handleDownloadHistory = (h: any) => {
    const payload = {
      id: h.id,
      title: h.title,
      type: h.type,
      className: h.className,
      grade: h.grade,
      format: h.format,
      status: h.status,
      createdAt: h.createdAt?.toDate?.().toISOString() || null,
      data: h.data || null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `${(h.title || "report").replace(/\s+/g, "_")}_${h.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Filtered reports ────────────────────────────────────────────────────
  const filtered = REPORTS.filter(r => {
    if (filter === "PDF only") return r.formats.includes("PDF");
    if (filter === "Excel only") return r.formats.includes("Excel");
    return true;
  });

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: T.bg }}>

      {/* ═══ DARK HERO ═══════════════════════════════════════════════════ */}
      <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 bg-[#162E93] md:bg-[#08090C]" style={{ padding: "18px 22px 22px" }}>
        <p style={{ fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.28)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5 }}>
          Academic documents
        </p>
        <h1 style={{ fontSize: 21, fontWeight: 500, color: "#fff", letterSpacing: "-0.4px", lineHeight: 1.1 }}>
          Reports
        </h1>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
          Generate and download academic reports.
        </p>
        <div style={{ display: "flex", gap: 7, marginTop: 13, flexWrap: "wrap" }}>
          <span style={{ padding: "5px 10px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.07)", fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>
            {teacherData?.schoolName || "Edullent Main"}
          </span>
          <span style={{ padding: "5px 10px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.07)", fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>
            {REPORTS.length} report types
          </span>
        </div>
      </div>

      {/* ═══ BODY ════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11, paddingTop: 14 }}>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 6 }}>
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "7px 13px", borderRadius: 20,
                fontSize: 11, fontFamily: "inherit", cursor: "pointer",
                border: filter === f ? "1px solid #08090C" : `1px solid ${T.bdr}`,
                background: filter === f ? "#08090C" : T.white,
                color: filter === f ? "#fff" : T.ink2,
                fontWeight: filter === f ? 500 : 400,
                transition: "all 80ms",
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Report cards */}
        {filtered.map(r => (
          <div key={r.id} style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: "hidden" }}>
            {/* Color band */}
            <div style={{ height: 3, background: r.band }} />

            <div style={{ padding: 14 }}>
              {/* Top: icon + badge */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 13, background: r.iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {r.icon(r.iconCol)}
                </div>
                <span style={{ padding: "4px 9px", borderRadius: 20, background: r.badgeBg, color: r.badgeCol, fontSize: 10, fontWeight: 500 }}>
                  {r.badge}
                </span>
              </div>

              {/* Title + desc */}
              <p style={{ fontSize: 15, fontWeight: 500, color: T.ink1, letterSpacing: "-0.2px", marginBottom: 5 }}>{r.title}</p>
              <p style={{ fontSize: 11, color: T.ink3, lineHeight: 1.55, marginBottom: 12 }}>{r.desc}</p>

              {/* Format pills */}
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {r.formats.map(f => (
                  <span key={f} style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${T.bdr}`, background: T.s1, fontSize: 10, fontWeight: 500, color: T.ink3 }}>
                    {f}
                  </span>
                ))}
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8, borderTop: `1px solid ${T.s2}`, paddingTop: 13 }}>
                <button
                  onClick={() => handleOpenGenerate(r)}
                  style={{
                    flex: 1, padding: 10, borderRadius: 11,
                    background: r.band, border: "none", color: "#fff",
                    fontSize: 12, fontWeight: 500, cursor: "pointer",
                    fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round">
                    <polyline points="6,2 6,8" /><polyline points="3.5,5.5 6,8.5 8.5,5.5" /><line x1="1.5" y1="10.5" x2="10.5" y2="10.5" />
                  </svg>
                  Generate Report
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* ── HISTORY ────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginTop: 6 }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 500, color: T.ink1, letterSpacing: "-0.3px" }}>Intelligence output history</p>
            <p style={{ fontSize: 9, fontWeight: 500, color: T.ink3, letterSpacing: "0.07em", textTransform: "uppercase", marginTop: 2 }}>
              {history.length === 0 ? "Audit trail of generated documents" : `${history.length} report${history.length !== 1 ? "s" : ""} on record`}
            </p>
          </div>
          {history.length > 10 && (
            <button
              onClick={() => setShowAllHistory(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 11, color: T.blue, fontWeight: 500,
                background: "none", border: "none", cursor: "pointer",
                marginTop: 4, fontFamily: "inherit",
              }}
            >
              {showAllHistory ? "Show less" : "View full audit"}
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round">
                <polyline points="2,9 9,2" /><polyline points="5,2 9,2 9,6" />
              </svg>
            </button>
          )}
        </div>

        {/* History list */}
        <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 17, overflow: "hidden" }}>
          {history.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "36px 14px", textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 15, background: T.s2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke={T.ink3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="1" width="10" height="12" rx="1.5" /><line x1="4.5" y1="5" x2="9.5" y2="5" /><line x1="4.5" y1="7.5" x2="7.5" y2="7.5" />
                </svg>
              </div>
              <p style={{ fontSize: 13, fontWeight: 500, color: T.ink2 }}>No reports generated yet</p>
              <p style={{ fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
                Generated reports will appear here
              </p>
            </div>
          ) : (
            (showAllHistory ? history : history.slice(0, 10)).map((h, idx, arr) => {
              const col = h.type === "at_risk" ? T.red : h.type === "attendance_summary" ? T.amb : h.type === "individual_progress" ? T.tea : T.blue;
              const dotCol = statusDotColor(h.status, T);
              return (
                <div key={h.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "12px 13px",
                  borderBottom: idx < arr.length - 1 ? `1px solid ${T.s2}` : "none",
                }}>
                  {/* Icon */}
                  <div style={{
                    width: 34, height: 34, borderRadius: 10,
                    background: `${col}18`, border: `1px solid ${col}35`,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={col} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="1" width="10" height="12" rx="1.5" /><line x1="4.5" y1="5" x2="9.5" y2="5" /><line x1="4.5" y1="7.5" x2="7.5" y2="7.5" />
                    </svg>
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, lineHeight: 1.3, margin: 0 }}>
                      {h.title || "Report"} — {h.grade || h.className || "N/A"}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: dotCol }} />
                      <span style={{ fontSize: 10, color: T.ink3 }}>
                        {h.status || "Draft"} · {(h.format || "PDF").toUpperCase()} Format
                      </span>
                    </div>
                    <p style={{ fontSize: 10, color: T.ink3, marginTop: 2 }}>
                      {h.createdAt?.toDate?.().toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) || ""}
                    </p>
                  </div>

                  {/* Download btn — exports stored report JSON */}
                  <button
                    onClick={() => handleDownloadHistory(h)}
                    title="Download report snapshot"
                    style={{
                      width: 26, height: 26, borderRadius: 8,
                      background: T.s1, border: `1px solid ${T.bdr}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, cursor: "pointer", padding: 0,
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round">
                      <polyline points="5.5,2 5.5,8" /><polyline points="3,5.5 5.5,8.5 8,5.5" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ═══ GENERATE REPORT MODAL (preserved) ═══════════════════════════ */}
      <GenerateReport
        isOpen={isGenerateOpen}
        onOpenChange={setIsGenerateOpen}
        report={selectedReport}
      />
    </div>
  );
};

export default Reports;