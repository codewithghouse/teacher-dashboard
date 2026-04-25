// Edullent Teacher Dashboard — Leaderboard module
// Wired to real Firestore data via hooks in src/hooks/useLeaderboardData.ts
//
// Sections that need backend infrastructure not yet built (weekly snapshots,
// AI insights, school-wide rank, forecasts) render as empty/locked states
// rather than fake numbers. Visual structure of the locked Edullent design
// is preserved verbatim everywhere else.

import { useEffect, useState, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronDown, AlertTriangle, Loader2, Lock, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import {
  useTeacherClasses,
  useClassLeaderboard,
  useStudentDetail,
  useTeacherSelfMetrics,
  useClassAIPlan,
  useStudentAIPlan,
  useTeacherSelfAIPlan,
  type LeaderboardStudent,
  type AIPlan,
  type AIAction,
  type AIDiagnosis,
} from "@/hooks/useLeaderboardData";

// ============================================================
// EDULLENT DESIGN TOKENS — locked, do not change
// ============================================================
const FONT = "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif";

const T = {
  pageBg: "#EEF4FF",
  cardBg: "#FFFFFF",

  B1: "#0055FF",
  B2: "#1166FF",
  IND3: "#4499FF",

  T1: "#001040",
  T3: "#5070B0",
  T4: "#99AACC",

  GREEN: "#34C759",
  GREEN_DEEP: "#00C853",
  RED: "#FF453A",
  RED_DEEP: "#C71F2D",
  ORANGE: "#FF8800",
  ORANGE_DEEP: "#C26A00",
  AMBER: "#B47A00",
  VIOLET: "#7B3FF4",
  VIOLET_LIGHT: "#B79FFF",
  GOLD: "#FFD700",
  GOLD_DEEP: "#FFAA00",
  SILVER: "#A8A8B5",
  BRONZE: "#8B5A2B",

  SH: "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.10)",
  SH_LG: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 20px 48px rgba(0,85,255,0.14)",
  SH_HERO: "0 0 0 0.5px rgba(0,85,255,0.10), 0 8px 24px rgba(0,85,255,0.18), 0 24px 60px rgba(0,85,255,0.22)",
  SH_HERO_RED: "0 0 0 0.5px rgba(255,69,58,0.10), 0 6px 20px rgba(255,69,58,0.18), 0 20px 48px rgba(255,69,58,0.20)",
  SH_BTN: "0 8px 24px rgba(0,0,0,0.20), 0 2px 6px rgba(0,0,0,0.10)",

  BORDER: "0.5px solid rgba(0,85,255,0.10)",
  BORDER_SOFT: "0.5px solid rgba(0,85,255,0.06)",
  BORDER_AMBER: "0.5px solid rgba(255,136,0,0.20)",
  BORDER_RED: "1px solid rgba(255,69,58,0.30)",
  BORDER_USER: "2px solid #0055FF",

  HERO_GRADIENT: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
  HERO_RED_GRADIENT: "linear-gradient(135deg, #001040 0%, #001A66 32%, #5C0F1F 100%)",
  HERO_FORECAST: "linear-gradient(135deg, #001040 0%, #001A66 50%, #0055FF 100%)",
};

// ============================================================
// PRIMITIVES
// ============================================================
const Eyebrow = ({ children, color = T.T4 }: { children: React.ReactNode; color?: string }) => (
  <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1.6px", color, margin: 0, textTransform: "uppercase" }}>{children}</p>
);

const SectionHead = ({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) => (
  <div style={{ marginBottom: 14 }}>
    <Eyebrow>{eyebrow}</Eyebrow>
    <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.9px", color: T.T1, margin: "4px 0 4px", lineHeight: 1.1 }}>{title}</h2>
    {subtitle && <p style={{ fontSize: 13, fontWeight: 500, color: T.T3, margin: 0 }}>{subtitle}</p>}
  </div>
);

const BackButton = ({ label = "Back", onClick }: { label?: string; onClick: () => void }) => (
  <button onClick={onClick} style={{
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px 8px 10px",
    borderRadius: 999, background: T.cardBg, border: T.BORDER, cursor: "pointer",
    fontFamily: FONT, boxShadow: T.SH,
  }}>
    <ArrowLeft size={14} color={T.B1} strokeWidth={2.2} />
    <span style={{ fontSize: 12, fontWeight: 700, color: T.B1, letterSpacing: "-0.1px" }}>{label}</span>
  </button>
);

const Avatar = ({ initials, bg, color, size = 38 }: { initials: string; bg: string; color: string; size?: number }) => (
  <div style={{
    width: size, height: size, borderRadius: "50%", background: bg, color,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 800, fontSize: size > 36 ? 13 : 12, flexShrink: 0, letterSpacing: "-0.2px",
    fontFamily: FONT,
  }}>{initials}</div>
);

type RankVariant = 1 | 2 | 3 | "user" | "amber" | "red" | "default";

const RankBadge = ({ rank, variant = "default", size = 38 }: { rank: number | string; variant?: RankVariant; size?: number }) => {
  const variants: Record<string, { bg: string; color: string; shadow: string }> = {
    1: { bg: `linear-gradient(135deg, ${T.GOLD} 0%, ${T.GOLD_DEEP} 100%)`, color: "#FFF", shadow: "0 6px 16px rgba(255,170,0,0.35)" },
    2: { bg: "linear-gradient(135deg, #E8E8F0 0%, #A8A8B5 100%)", color: "#FFF", shadow: "0 6px 16px rgba(168,168,181,0.35)" },
    3: { bg: "linear-gradient(135deg, #D89060 0%, #8B5A2B 100%)", color: "#FFF", shadow: "0 6px 16px rgba(139,90,43,0.35)" },
    user: { bg: `linear-gradient(135deg, ${T.B1} 0%, ${T.B2} 100%)`, color: "#FFF", shadow: "0 4px 12px rgba(0,85,255,0.35)" },
    amber: { bg: `linear-gradient(135deg, ${T.ORANGE} 0%, ${T.GOLD_DEEP} 100%)`, color: "#FFF", shadow: "0 4px 12px rgba(255,136,0,0.35)" },
    red: { bg: "linear-gradient(135deg, #FF453A 0%, #E5304A 100%)", color: "#FFF", shadow: "0 4px 12px rgba(255,69,58,0.35)" },
    default: { bg: "rgba(0,85,255,0.06)", color: T.T3, shadow: "none" },
  };
  const s = variants[String(variant)] || variants.default;
  const fontSize = size >= 38 ? 15 : 13;
  return (
    <div style={{
      width: size, height: size, borderRadius: 14, background: s.bg, color: s.color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize, letterSpacing: "-0.4px", boxShadow: s.shadow, flexShrink: 0,
      fontFamily: FONT,
    }}>{rank}</div>
  );
};

const StatItem = ({ label, value, suffix, color = "#FFF", valueColor }: { label: string; value: React.ReactNode; suffix?: string; color?: string; valueColor?: string }) => (
  <div style={{ flex: 1, textAlign: "center" }}>
    <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.4px", color: "rgba(255,255,255,0.5)", margin: "0 0 4px", textTransform: "uppercase" }}>{label}</p>
    <p style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.6px", color: valueColor || color, margin: 0 }}>
      {value}{suffix && <span style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{suffix}</span>}
    </p>
  </div>
);

const StatDivider = () => <div style={{ width: 0.5, background: "rgba(255,255,255,0.12)" }} />;

type Severity = "okay" | "warning" | "weak" | "critical";

const MetricCard = ({ label, value, suffix, vs, severity = "okay" }: { label: string; value: number; suffix?: string; vs?: string; severity?: Severity }) => {
  const colors: Record<Severity, { bar: string; text: string; value: string }> = {
    okay: { bar: T.B1, text: T.T3, value: T.T1 },
    warning: { bar: T.ORANGE, text: T.RED, value: T.ORANGE },
    weak: { bar: T.ORANGE, text: T.RED, value: T.T1 },
    critical: { bar: `linear-gradient(90deg, ${T.ORANGE} 0%, ${T.RED} 100%)`, text: T.RED, value: T.RED },
  };
  const c = colors[severity];
  const borderColor = severity === "critical" ? "rgba(255,69,58,0.18)" : severity === "warning" ? "rgba(255,136,0,0.18)" : "rgba(0,85,255,0.10)";
  const shadow = severity === "critical"
    ? "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.10), 0 10px 28px rgba(255,69,58,0.10)"
    : severity === "warning"
    ? "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.10), 0 10px 28px rgba(255,136,0,0.10)"
    : "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.10), 0 10px 28px rgba(0,85,255,0.12)";

  return (
    <div style={{
      background: T.cardBg, border: `0.5px solid ${borderColor}`, borderRadius: 18, padding: 16,
      boxShadow: shadow,
    }}>
      <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.4px", color: T.T4, margin: "0 0 8px", textTransform: "uppercase" }}>{label}</p>
      <p style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-1px", color: c.value, margin: 0, lineHeight: 1 }}>
        {value.toFixed(value % 1 === 0 ? 0 : 1)}{suffix && <span style={{ fontSize: 18, color: T.T3 }}>{suffix}</span>}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
        <div style={{ flex: 1, height: 4, background: "rgba(0,85,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(value, 100)}%`, background: c.bar, borderRadius: 999 }} />
        </div>
        {vs && <span style={{ fontSize: 10, fontWeight: 700, color: c.text }}>{vs}</span>}
      </div>
    </div>
  );
};

// ============================================================
// AI RENDER PRIMITIVES — used to render Cloud Function output
// ============================================================
const DiagnosisCard = ({ items }: { items: AIDiagnosis[] }) => {
  if (items.length === 0) return null;
  const renderText = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/);
    return parts.map((p, i) => p.startsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>);
  };
  const colorMap: Record<AIDiagnosis["type"], string> = { good: T.GREEN, concern: T.RED, note: T.T1 };

  return (
    <div style={{
      background: T.cardBg, border: T.BORDER, borderRadius: 22, padding: 22,
      boxShadow: T.SH_LG, marginBottom: 32,
    }}>
      {items.map((item, i) => (
        <p key={i} style={{
          fontSize: 15, fontWeight: 500, color: T.T1,
          margin: i < items.length - 1 ? "0 0 14px" : 0,
          lineHeight: 1.65, letterSpacing: "-0.1px",
        }}>
          {item.type !== "note" && (
            <strong style={{ color: colorMap[item.type] }}>
              {item.type === "good" ? "Achhi khabar:" : "Issue:"}{" "}
            </strong>
          )}
          {renderText(item.text)}
        </p>
      ))}
    </div>
  );
};

const ActionCard = ({ action }: { action: AIAction }) => {
  const isManual = action.tracking === "manual";
  return (
    <div style={{ background: T.cardBg, border: T.BORDER, borderRadius: 20, padding: 18, boxShadow: T.SH_LG }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14 }}>
        <span style={{ flexShrink: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-1.2px", color: T.B1, lineHeight: 1, minWidth: 36 }}>{action.num}</span>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: T.T1, margin: "0 0 4px", letterSpacing: "-0.2px", lineHeight: 1.3 }}>{action.title}</p>
          <p style={{ fontSize: 12, fontWeight: 500, color: T.T3, margin: 0, lineHeight: 1.5 }}>{action.reason}</p>
        </div>
      </div>
      <div style={{
        padding: 12, borderRadius: 12,
        background: isManual ? "rgba(123,63,244,0.04)" : "rgba(0,85,255,0.04)",
        border: isManual ? "0.5px solid rgba(123,63,244,0.10)" : "0.5px solid rgba(0,85,255,0.08)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: isManual ? T.VIOLET : T.B1 }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1.2px", color: isManual ? T.VIOLET : T.B1, textTransform: "uppercase" }}>
            {isManual ? "Self-tracked" : "Auto-tracked"}
          </span>
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color: isManual ? T.VIOLET : T.B1 }}>
          {action.subStatus || (isManual ? "Manual log" : "Pending")}
        </span>
      </div>
    </div>
  );
};

const AIBadge = () => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "3px 9px", borderRadius: 999,
    background: "rgba(123,63,244,0.10)", border: "0.5px solid rgba(123,63,244,0.25)",
  }}>
    <Sparkles size={10} color={T.VIOLET} strokeWidth={2.4} />
    <span style={{ fontSize: 9, fontWeight: 800, color: T.VIOLET, letterSpacing: "1.2px", textTransform: "uppercase" }}>Edullent AI</span>
  </span>
);

const AISectionLoading = ({ label }: { label: string }) => (
  <div style={{
    background: T.cardBg, border: T.BORDER, borderRadius: 22, padding: 22,
    boxShadow: T.SH, display: "flex", alignItems: "center", gap: 14, marginBottom: 32,
  }}>
    <Loader2 size={18} color={T.VIOLET} style={{ animation: "spin 1s linear infinite" }} />
    <div>
      <p style={{ fontSize: 13, fontWeight: 800, color: T.T1, margin: 0, letterSpacing: "-0.2px" }}>{label}</p>
      <p style={{ fontSize: 11, fontWeight: 500, color: T.T3, margin: "1px 0 0" }}>~5–10 seconds</p>
    </div>
  </div>
);

const AISectionError = ({ message }: { message: string }) => (
  <div style={{
    background: "rgba(255,69,58,0.04)", border: "0.5px solid rgba(255,69,58,0.20)", borderRadius: 22,
    padding: 18, marginBottom: 32,
  }}>
    <p style={{ fontSize: 12, fontWeight: 800, color: T.RED, margin: "0 0 4px", letterSpacing: "-0.1px" }}>AI service unavailable</p>
    <p style={{ fontSize: 11, fontWeight: 500, color: T.T3, margin: 0 }}>{message}</p>
  </div>
);

// ============================================================
// EMPTY / LOCKED STATES
// Used wherever a section needs backend infra not yet deployed.
// Honest UI > fake numbers.
// ============================================================
const LockedSection = ({ eyebrow, title, message }: { eyebrow: string; title: string; message: string }) => (
  <div style={{ marginBottom: 32 }}>
    <SectionHead eyebrow={eyebrow} title={title} />
    <div style={{
      background: T.cardBg, border: T.BORDER, borderRadius: 22, padding: 22,
      boxShadow: T.SH, display: "flex", alignItems: "flex-start", gap: 14,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 12, background: "rgba(0,85,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Lock size={16} color={T.B1} strokeWidth={2.2} />
      </div>
      <div>
        <p style={{ fontSize: 13, fontWeight: 800, color: T.T1, margin: "0 0 4px", letterSpacing: "-0.2px" }}>Activates with weekly snapshots</p>
        <p style={{ fontSize: 12, fontWeight: 500, color: T.T3, margin: 0, lineHeight: 1.5 }}>{message}</p>
      </div>
    </div>
  </div>
);

const ScreenLoader = ({ label }: { label?: string }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 20px", gap: 12 }}>
    <Loader2 size={28} color={T.B1} style={{ animation: "spin 1s linear infinite" }} />
    {label && <p style={{ fontSize: 12, fontWeight: 700, color: T.T3, margin: 0 }}>{label}</p>}
    <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
  </div>
);

const ScreenEmpty = ({ title, message }: { title: string; message: string }) => (
  <div style={{ background: T.cardBg, border: T.BORDER, borderRadius: 22, padding: 32, boxShadow: T.SH_LG, textAlign: "center" }}>
    <p style={{ fontSize: 16, fontWeight: 800, color: T.T1, margin: "0 0 6px", letterSpacing: "-0.3px" }}>{title}</p>
    <p style={{ fontSize: 12, fontWeight: 500, color: T.T3, margin: 0 }}>{message}</p>
  </div>
);

// ============================================================
// SCREEN 1: STUDENT LEADERBOARD (TEACHER VIEW)
// ============================================================
const StudentLeaderboardScreen = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: classes, isLoading: classesLoading } = useTeacherClasses();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Active class persists across navigations via ?c= query param.
  const activeClassId = searchParams.get("c") || classes?.[0]?.classId || null;

  useEffect(() => {
    if (!searchParams.get("c") && classes && classes.length > 0) {
      setSearchParams({ c: classes[0].classId }, { replace: true });
    }
  }, [classes, searchParams, setSearchParams]);

  const { data: cls, isLoading: classLoading } = useClassLeaderboard(activeClassId);
  const activeClass = classes?.find(c => c.classId === activeClassId);

  if (classesLoading) return <ScreenLoader label="Loading your classes" />;
  if (!classes || classes.length === 0) {
    return (
      <div style={{ padding: "28px 18px" }}>
        <ScreenEmpty title="No assigned classes yet" message="Aapko abhi koi class assign nahi hui hai. Apne school admin se contact karein." />
      </div>
    );
  }

  return (
    <div style={{ background: T.pageBg, padding: "28px 18px 32px", borderRadius: 28, fontFamily: FONT }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <Eyebrow>Live · Teacher view</Eyebrow>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1.2px", color: T.T1, margin: "6px 0 0", lineHeight: 1 }}>Class Leaderboard</h1>
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setDropdownOpen(!dropdownOpen)} style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px",
            borderRadius: 14, background: T.cardBg, border: T.BORDER, cursor: "pointer",
            fontFamily: FONT, boxShadow: T.SH,
          }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.4px", color: T.T4, textTransform: "uppercase" }}>Class</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.B1, letterSpacing: "-0.2px" }}>{activeClass?.name || "—"}</span>
            <ChevronDown size={12} color={T.B1} strokeWidth={2.2} />
          </button>
          {dropdownOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 10,
              background: T.cardBg, border: T.BORDER, borderRadius: 14,
              boxShadow: T.SH_LG, padding: 6, minWidth: 200,
            }}>
              {classes.map(c => (
                <button key={c.classId} onClick={() => { setSearchParams({ c: c.classId }); setDropdownOpen(false); }} style={{
                  display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
                  borderRadius: 10, background: c.classId === activeClassId ? "rgba(0,85,255,0.06)" : "transparent",
                  border: "none", cursor: "pointer", fontFamily: FONT,
                }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: T.T1, margin: 0, letterSpacing: "-0.2px" }}>Class {c.name}</p>
                  <p style={{ fontSize: 11, fontWeight: 500, color: T.T3, margin: "2px 0 0" }}>{c.subject} · {c.studentCount} students</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 18, padding: 4, borderRadius: 12, background: "rgba(0,85,255,0.06)", border: T.BORDER }}>
        <div style={{ flex: 1, padding: 10, textAlign: "center", borderRadius: 8, background: T.cardBg, boxShadow: "0 1px 3px rgba(0,85,255,0.10)" }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: T.B1, margin: 0, letterSpacing: "-0.1px" }}>Students</p>
        </div>
        <button onClick={() => navigate("/leaderboard/teachers")} style={{
          flex: 1, padding: 10, textAlign: "center", borderRadius: 8,
          background: "transparent", border: "none", cursor: "pointer", fontFamily: FONT,
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: T.T3, margin: 0 }}>Teachers</p>
        </button>
      </div>

      {classLoading || !cls ? (
        <ScreenLoader label="Calculating rankings" />
      ) : cls.totalStudents === 0 ? (
        <ScreenEmpty title="No students in this class yet" message="Enrollments add hone ke baad rankings yahaan dikhenge." />
      ) : (
        <>
          <div style={{
            background: T.HERO_GRADIENT, borderRadius: 26, padding: 22,
            boxShadow: T.SH_HERO, marginBottom: 18, position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: "-40%", right: "-20%", width: "80%", height: "140%", background: "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 60%)", pointerEvents: "none" }} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, position: "relative" }}>
              <div>
                <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.6px", color: "rgba(255,255,255,0.55)", margin: "0 0 4px", textTransform: "uppercase" }}>Class summary</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#FFF", margin: 0, letterSpacing: "-0.5px" }}>Class {cls.className} · {cls.subject}</p>
                <p style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", margin: "2px 0 0" }}>{cls.totalStudents} students · You're their teacher</p>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "16px 0", borderTop: "0.5px solid rgba(255,255,255,0.12)", borderBottom: "0.5px solid rgba(255,255,255,0.12)", marginBottom: 18, position: "relative" }}>
              <StatItem label="Class avg" value={cls.classAverage.toFixed(1)} />
              <StatDivider />
              <StatItem label="Avg score" value={cls.classAvgScore.toFixed(1)} suffix="%" />
              <StatDivider />
              <StatItem label="Need help" value={cls.needAttentionCount} valueColor={cls.needAttentionCount > 0 ? T.ORANGE : "#FFF"} />
            </div>

            <button onClick={() => navigate(`/leaderboard/class-plan/${cls.classId}`)} style={{
              width: "100%", padding: 14, background: "#FFF", border: "none", borderRadius: 14,
              fontSize: 13, color: T.B1, cursor: "pointer", fontFamily: FONT,
              fontWeight: 800, letterSpacing: "-0.1px", boxShadow: T.SH_BTN,
            }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                View class breakdown
                <ArrowRight size={13} color={T.B1} strokeWidth={2.2} />
              </span>
            </button>
          </div>

          <div style={{
            background: T.cardBg, border: T.BORDER, borderRadius: 24,
            padding: "14px 12px 8px", boxShadow: T.SH_LG, marginBottom: 14,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px 14px", borderBottom: T.BORDER_SOFT }}>
              <Eyebrow>All students</Eyebrow>
              <p style={{ fontSize: 11, fontWeight: 500, color: T.T3, margin: 0 }}>Tap any student for insights</p>
            </div>

            {cls.topStudents.map((s, i) => (
              <StudentRow key={s.studentId} s={s} idx={i} onClick={() => navigate(`/leaderboard/student/${encodeURIComponent(s.studentId)}?c=${cls.classId}`)} />
            ))}

            {cls.needAttentionStudents.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", margin: "6px 0" }}>
                  <div style={{ flex: 1, height: 0.5, background: "rgba(255,136,0,0.30)" }} />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "rgba(255,136,0,0.10)", border: "0.5px solid rgba(255,136,0,0.25)" }}>
                    <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: T.ORANGE }} />
                    <span style={{ fontSize: 9, fontWeight: 800, color: T.ORANGE_DEEP, letterSpacing: "1.2px", textTransform: "uppercase" }}>Need attention</span>
                  </span>
                  <div style={{ flex: 1, height: 0.5, background: "rgba(255,136,0,0.30)" }} />
                </div>

                {cls.needAttentionStudents.map((s, i) => {
                  const isRed = s.status === "at_risk";
                  return (
                    <div key={s.studentId} onClick={() => navigate(`/leaderboard/student/${encodeURIComponent(s.studentId)}?c=${cls.classId}`)} style={{
                      display: "flex", alignItems: "center", gap: 14, padding: "14px 12px",
                      borderRadius: 16, marginTop: i > 0 ? 6 : 0, cursor: "pointer",
                      background: isRed
                        ? "linear-gradient(90deg, rgba(255,69,58,0.08) 0%, rgba(255,69,58,0.04) 100%)"
                        : "linear-gradient(90deg, rgba(255,136,0,0.06) 0%, rgba(255,136,0,0.03) 100%)",
                      border: isRed ? T.BORDER_RED : T.BORDER_AMBER,
                    }}>
                      <RankBadge rank={s.rank} variant={isRed ? "red" : "amber"} size={36} />
                      <Avatar initials={s.initials} bg={isRed ? "rgba(255,69,58,0.12)" : "rgba(255,136,0,0.12)"} color={isRed ? T.RED_DEEP : T.ORANGE_DEEP} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 800, margin: 0, color: T.T1, letterSpacing: "-0.2px" }}>{s.name}</p>
                        <p style={{ fontSize: 11, fontWeight: 700, color: isRed ? T.RED : T.ORANGE, margin: "1px 0 0" }}>
                          Marks {s.avgScorePct.toFixed(0)} · Att {s.attendancePct.toFixed(0)}%
                        </p>
                      </div>
                      <span style={{ fontSize: 17, fontWeight: 800, color: isRed ? T.RED : T.ORANGE, letterSpacing: "-0.4px" }}>{s.composite.toFixed(1)}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <div style={{ textAlign: "center", marginTop: 18 }}>
            <p style={{ fontSize: 10, fontWeight: 500, color: T.T4, margin: 0, letterSpacing: "0.2px" }}>
              {cls.totalStudents} students · Live · Composite = 60% marks + 40% attendance
            </p>
          </div>
        </>
      )}
    </div>
  );
};

const StudentRow = ({ s, idx, onClick }: { s: LeaderboardStudent; idx: number; onClick: () => void }) => (
  <div onClick={onClick} style={{
    display: "flex", alignItems: "center", gap: 14,
    padding: s.rank <= 3 ? "14px 10px" : "12px 10px", borderRadius: s.rank <= 3 ? 16 : 14,
    cursor: "pointer", borderTop: idx > 0 ? T.BORDER_SOFT : "none",
  }}>
    {s.rank <= 3 ? (
      <RankBadge rank={s.rank} variant={s.rank as 1 | 2 | 3} size={38} />
    ) : (
      <RankBadge rank={s.rank} variant="default" size={34} />
    )}
    <Avatar initials={s.initials} bg="rgba(0,85,255,0.10)" color={T.B1} size={s.rank <= 3 ? 38 : 34} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ fontSize: s.rank <= 3 ? 15 : 14, fontWeight: 700, margin: 0, color: T.T1, letterSpacing: s.rank <= 3 ? "-0.3px" : "-0.2px" }}>{s.name}</p>
      <p style={{ fontSize: 11, fontWeight: 500, color: T.T3, margin: "1px 0 0" }}>
        Marks {s.avgScorePct.toFixed(0)} · Att {s.attendancePct.toFixed(0)}%
      </p>
    </div>
    <span style={{ fontSize: s.rank <= 3 ? 19 : 17, fontWeight: 800, color: T.T1, letterSpacing: "-0.5px" }}>{s.composite.toFixed(1)}</span>
  </div>
);

// ============================================================
// SCREEN 2: TEACHER LEADERBOARD
// ============================================================
const TeacherLeaderboardScreen = () => {
  const navigate = useNavigate();
  const { teacherData } = useAuth();
  const { data: self, isLoading } = useTeacherSelfMetrics();

  return (
    <div style={{ background: T.pageBg, padding: "28px 18px 32px", borderRadius: 28, fontFamily: FONT }}>

      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <Eyebrow>Live · {teacherData?.branch || teacherData?.schoolName || "Your branch"}</Eyebrow>
        <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-1.4px", color: T.T1, margin: "8px 0", lineHeight: 1 }}>Teacher Leaderboard</h1>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 22, padding: 4, borderRadius: 12, background: "rgba(0,85,255,0.06)", border: T.BORDER }}>
        <button onClick={() => navigate("/leaderboard")} style={{
          flex: 1, padding: 10, textAlign: "center", borderRadius: 8,
          background: "transparent", border: "none", cursor: "pointer", fontFamily: FONT,
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: T.T3, margin: 0 }}>Students</p>
        </button>
        <div style={{ flex: 1, padding: 10, textAlign: "center", borderRadius: 8, background: T.cardBg, boxShadow: "0 1px 3px rgba(0,85,255,0.10)" }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: T.B1, margin: 0, letterSpacing: "-0.1px" }}>Teachers</p>
        </div>
      </div>

      {isLoading ? <ScreenLoader label="Loading your metrics" /> : !self ? (
        <ScreenEmpty title="No data yet" message="Apne classes mein attendance ya scores enter karne ke baad metrics yahaan dikhenge." />
      ) : (
        <>
          <div style={{
            background: T.HERO_GRADIENT, borderRadius: 26, padding: "24px 22px",
            boxShadow: T.SH_HERO, marginBottom: 22, position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: "-40%", right: "-20%", width: "80%", height: "140%", background: "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 60%)", pointerEvents: "none" }} />

            <div style={{ textAlign: "center", marginBottom: 22, position: "relative" }}>
              <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "2px", color: "rgba(255,255,255,0.55)", margin: "0 0 2px", textTransform: "uppercase" }}>Your composite</p>
              <div style={{
                fontSize: 88, fontWeight: 800, letterSpacing: "-5px", color: "#FFF", lineHeight: 0.9,
                background: "linear-gradient(180deg, #FFF 0%, rgba(255,255,255,0.7) 100%)",
                WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0,
              }}>{self.composite.toFixed(1)}</div>
              <p style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", margin: "4px 0 0" }}>{self.name} · {self.subject}</p>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "16px 0", borderTop: "0.5px solid rgba(255,255,255,0.12)", borderBottom: "0.5px solid rgba(255,255,255,0.12)", marginBottom: 18, position: "relative" }}>
              <StatItem label="Avg score" value={self.classAvgScore.toFixed(1)} suffix="%" />
              <StatDivider />
              <StatItem label="Attendance" value={self.classAvgAttendance.toFixed(1)} suffix="%" />
              <StatDivider />
              <StatItem label="Students" value={self.totalStudents} />
            </div>

            <button onClick={() => navigate("/leaderboard/teachers/insights")} style={{
              width: "100%", padding: 15, background: "#FFF", border: "none", borderRadius: 14,
              fontSize: 13, color: T.B1, cursor: "pointer", fontFamily: FONT,
              fontWeight: 800, letterSpacing: "-0.1px", boxShadow: T.SH_BTN,
            }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                View detailed insights
                <ArrowRight size={13} color={T.B1} strokeWidth={2.2} />
              </span>
            </button>
          </div>

          <LockedSection
            eyebrow="Branch rankings"
            title="Comparing teachers across the branch"
            message="Branch-wide teacher rankings need a weekly aggregation cron job (Cloud Function). Aapka apna composite live calculate ho raha hai — others ke liye backend setup pending hai."
          />
        </>
      )}
    </div>
  );
};

// ============================================================
// SCREEN 3: CLASS ACTION PLAN (DETAIL)
// ============================================================
const ClassActionPlanScreen = ({ classId }: { classId: string }) => {
  const navigate = useNavigate();
  const { teacherData } = useAuth();
  const { data: cls, isLoading } = useClassLeaderboard(classId);
  const { data: aiPlan, isLoading: aiLoading, error: aiError } = useClassAIPlan(cls, teacherData?.name);

  // Build student tiers from real data
  const tiers = useMemo(() => {
    if (!cls || cls.totalStudents === 0) return null;
    const all = cls.allStudents;
    const top = all.slice(0, Math.min(5, Math.ceil(all.length * 0.2)));
    const risk = all.slice(-Math.min(5, Math.ceil(all.length * 0.2)));
    const middleStart = top.length;
    const middleEnd = all.length - risk.length;
    const middle = all.slice(middleStart, middleEnd);
    return { top, middle, risk };
  }, [cls]);

  if (isLoading) return <ScreenLoader label="Loading class data" />;
  if (!cls) return <ScreenEmpty title="Class not found" message="Ye class aapko assigned nahi hai ya data load nahi hua." />;

  return (
    <div style={{ background: T.pageBg, padding: "20px 16px 32px", borderRadius: 28, fontFamily: FONT }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "0 4px" }}>
        <BackButton label="Back" onClick={() => navigate(`/leaderboard?c=${classId}`)} />
        <Eyebrow>Class breakdown</Eyebrow>
      </div>

      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-1.4px", color: T.T1, margin: "0 0 6px", lineHeight: 1 }}>Class {cls.className}</h1>
        <p style={{ fontSize: 13, fontWeight: 500, color: T.T3, margin: 0 }}>{cls.subject} · {cls.totalStudents} students</p>
      </div>

      <div style={{
        background: T.HERO_GRADIENT, borderRadius: 22, padding: "18px 20px",
        boxShadow: T.SH_HERO, marginBottom: 32, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: "-40%", right: "-20%", width: "80%", height: "140%", background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 60%)", pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, position: "relative" }}>
          <div>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.6px", color: "rgba(255,255,255,0.55)", margin: "0 0 2px", textTransform: "uppercase" }}>Class composite</p>
            <p style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1.6px", color: "#FFF", margin: 0, lineHeight: 1 }}>{cls.classAverage.toFixed(1)}</p>
          </div>
          <div style={{ width: 0.5, alignSelf: "stretch", background: "rgba(255,255,255,0.15)" }} />
          <div>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.6px", color: "rgba(255,255,255,0.55)", margin: "0 0 2px", textTransform: "uppercase" }}>Need help</p>
            <p style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1.4px", color: cls.needAttentionCount > 0 ? T.GOLD : "#FFF", margin: 0, lineHeight: 1 }}>
              {cls.needAttentionCount}<span style={{ fontSize: 18, color: "rgba(255,255,255,0.6)" }}>/{cls.totalStudents}</span>
            </p>
          </div>
        </div>
      </div>

      <SectionHead eyebrow="01 · Class breakdown" title={`Where ${cls.className} stands`} subtitle="Real metrics from your class data" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 32 }}>
        <MetricCard
          label="Avg Marks"
          value={cls.classAvgScore}
          suffix="%"
          severity={cls.classAvgScore < 50 ? "critical" : cls.classAvgScore < 65 ? "warning" : "okay"}
        />
        <MetricCard
          label="Avg Attendance"
          value={cls.classAvgAttendance}
          suffix="%"
          severity={cls.classAvgAttendance < 70 ? "critical" : cls.classAvgAttendance < 85 ? "warning" : "okay"}
        />
        <MetricCard
          label="Composite"
          value={cls.classAverage}
          severity={cls.classAverage < 50 ? "critical" : cls.classAverage < 65 ? "warning" : "okay"}
        />
        <MetricCard
          label="At-Risk"
          value={cls.needAttentionCount}
          severity={cls.needAttentionCount > cls.totalStudents * 0.2 ? "critical" : cls.needAttentionCount > 0 ? "warning" : "okay"}
        />
      </div>

      {tiers && cls.totalStudents >= 3 && (
        <>
          <SectionHead eyebrow="02 · Student tiers" title="Three groups in your class" subtitle="Each tier needs different attention" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
            <TierCard
              color="green"
              label="Top performers"
              subtitle="Maintain & challenge"
              count={tiers.top.length}
              range={`Rank 1-${tiers.top.length}`}
              avgScore={tiers.top.reduce((a, s) => a + s.composite, 0) / Math.max(tiers.top.length, 1)}
              students={tiers.top.slice(0, 5).map(s => s.name.split(" ")[0]).join(", ")}
              insight="Advanced problems do — engagement bana rahega."
            />
            {tiers.middle.length > 0 && (
              <TierCard
                color="blue"
                label="Middle pack"
                subtitle="Biggest growth opportunity"
                count={tiers.middle.length}
                range={`Rank ${tiers.top.length + 1}-${tiers.top.length + tiers.middle.length}`}
                avgScore={tiers.middle.reduce((a, s) => a + s.composite, 0) / Math.max(tiers.middle.length, 1)}
                insight={`${tiers.middle.length} students. In mein se half ko bhi 5 points improve karayein, class avg jump karega.`}
              />
            )}
            <TierCard
              color="orange"
              label="At-risk"
              subtitle="Critical intervention needed"
              count={tiers.risk.length}
              range={`Bottom ${tiers.risk.length}`}
              avgScore={tiers.risk.reduce((a, s) => a + s.composite, 0) / Math.max(tiers.risk.length, 1)}
              students={tiers.risk.map(s => s.name.split(" ")[0]).join(", ")}
              insight="Har student alag intervention chahiye — individual insights mein details dekhein."
            />
          </div>
        </>
      )}

      {/* AI Diagnosis */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ flex: 1 }}><SectionHead eyebrow="03 · Diagnosis" title="AI-powered analysis" subtitle="Hinglish read of your class data" /></div>
        <AIBadge />
      </div>
      {aiLoading ? (
        <AISectionLoading label="Analysing class metrics" />
      ) : aiError ? (
        <AISectionError message={(aiError as Error).message || "Cloud Function call failed"} />
      ) : aiPlan && aiPlan.diagnosis.length > 0 ? (
        <DiagnosisCard items={aiPlan.diagnosis} />
      ) : (
        <LockedSection eyebrow="" title="No diagnosis yet" message="AI ne is class ke liye diagnosis generate nahi kiya. Thode aur scores/attendance data ke baad retry karein." />
      )}

      {/* AI Action Plan */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ flex: 1 }}><SectionHead eyebrow="04 · Action plan" title="Your moves this week" subtitle="Personalised by Edullent AI" /></div>
        <AIBadge />
      </div>
      {aiLoading ? (
        <AISectionLoading label="Generating action plan" />
      ) : aiError ? (
        <AISectionError message={(aiError as Error).message || "Cloud Function call failed"} />
      ) : aiPlan && aiPlan.actions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
          {aiPlan.actions.map(a => <ActionCard key={a.id} action={a} />)}
        </div>
      ) : (
        <LockedSection eyebrow="" title="No actions generated" message="AI ne actions generate nahi kiye. Retry karein ya backend logs check karein." />
      )}

      <LockedSection
        eyebrow="05 · Trajectory"
        title="8-week trend chart"
        message="Trajectory chart ke liye weekly snapshots store karne padenge (cron job). Pehla snapshot is hafte se start hoga."
      />

      <LockedSection
        eyebrow="06 · Forecast"
        title="Next-week prediction"
        message="Forecast model ke liye historical data chahiye. 4+ weeks of snapshots accumulate hone ke baad activate hoga."
      />
    </div>
  );
};

const TierCard = ({ color, label, subtitle, count, range, avgScore, students, insight }: {
  color: "green" | "blue" | "orange";
  label: string;
  subtitle: string;
  count: number;
  range: string;
  avgScore: number;
  students?: string;
  insight: string;
}) => {
  const tc = {
    green:  { bg: "linear-gradient(135deg, rgba(52,199,89,0.06) 0%, rgba(0,200,83,0.03) 100%)", border: "0.5px solid rgba(52,199,89,0.20)", badge: `linear-gradient(135deg, ${T.GREEN} 0%, ${T.GREEN_DEEP} 100%)`, score: T.GREEN },
    blue:   { bg: T.cardBg, border: T.BORDER, badge: `linear-gradient(135deg, ${T.B1} 0%, ${T.B2} 100%)`, score: T.B1 },
    orange: { bg: "linear-gradient(135deg, rgba(255,136,0,0.06) 0%, rgba(255,170,0,0.03) 100%)", border: "0.5px solid rgba(255,136,0,0.25)", badge: `linear-gradient(135deg, ${T.ORANGE} 0%, ${T.GOLD_DEEP} 100%)`, score: T.ORANGE },
  }[color];

  return (
    <div style={{ background: tc.bg, border: tc.border, borderRadius: 18, padding: 16, boxShadow: color === "blue" ? T.SH : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 10, background: tc.badge, color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{count}</div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: T.T1, margin: 0, letterSpacing: "-0.2px" }}>{label} · {range}</p>
          <p style={{ fontSize: 11, fontWeight: 500, color: color === "orange" ? T.ORANGE : T.T3, margin: "1px 0 0" }}>{subtitle}</p>
        </div>
        <span style={{ fontSize: 18, fontWeight: 800, color: tc.score, letterSpacing: "-0.4px" }}>avg {avgScore.toFixed(1)}</span>
      </div>
      <p style={{ fontSize: 12, fontWeight: 500, color: T.T3, margin: 0, lineHeight: 1.5 }}>
        {students && <>{students} — </>}{insight}
      </p>
    </div>
  );
};

// ============================================================
// SCREEN 4: INDIVIDUAL STUDENT INSIGHTS
// ============================================================
const IndividualStudentScreen = ({ studentId }: { studentId: string }) => {
  const navigate = useNavigate();
  const { teacherData } = useAuth();
  const [searchParams] = useSearchParams();
  const classId = searchParams.get("c") || null;
  const { data: student, isLoading } = useStudentDetail(studentId, classId);
  const { data: aiPlan, isLoading: aiLoading, error: aiError } = useStudentAIPlan(student, teacherData?.name, teacherData?.subject as string | undefined);

  if (isLoading) return <ScreenLoader label="Loading student details" />;
  if (!student) return <ScreenEmpty title="Student not found" message="Ye student aapki class mein nahi hai ya data load nahi hua." />;

  const isAtRisk = student.status === "at_risk";

  return (
    <div style={{ background: T.pageBg, padding: "20px 16px 32px", borderRadius: 28, fontFamily: FONT }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "0 4px" }}>
        <BackButton label={`Class ${student.classLabel}`} onClick={() => navigate(`/leaderboard?c=${student.classId}`)} />
        {isAtRisk && (
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1.6px", color: T.RED, margin: 0, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <AlertTriangle size={11} color={T.RED} strokeWidth={2.4} /> At-risk
          </p>
        )}
      </div>

      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ display: "inline-flex", marginBottom: 8 }}>
          <Avatar
            initials={student.initials}
            bg={isAtRisk ? "rgba(255,69,58,0.10)" : "rgba(0,85,255,0.10)"}
            color={isAtRisk ? T.RED_DEEP : T.B1}
            size={56}
          />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-1.2px", color: T.T1, margin: "0 0 4px", lineHeight: 1 }}>{student.name}</h1>
        <p style={{ fontSize: 13, fontWeight: 500, color: T.T3, margin: 0 }}>Class {student.classLabel} · Roll #{student.rollNo}</p>
      </div>

      <div style={{
        background: isAtRisk ? T.HERO_RED_GRADIENT : T.HERO_GRADIENT,
        borderRadius: 22, padding: "18px 20px",
        boxShadow: isAtRisk ? T.SH_HERO_RED : T.SH_HERO,
        marginBottom: 32, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: "-40%", right: "-20%", width: "80%", height: "140%", background: `radial-gradient(circle, rgba(${isAtRisk ? "255,69,58" : "255,255,255"},0.10) 0%, transparent 60%)`, pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, position: "relative" }}>
          <div>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.6px", color: "rgba(255,255,255,0.55)", margin: "0 0 2px", textTransform: "uppercase" }}>Class rank</p>
            <p style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1.6px", color: "#FFF", margin: 0, lineHeight: 1 }}>#{student.rank}<span style={{ fontSize: 18, color: "rgba(255,255,255,0.6)" }}>/{student.totalInClass}</span></p>
          </div>
          <div style={{ width: 0.5, alignSelf: "stretch", background: "rgba(255,255,255,0.15)" }} />
          <div>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.6px", color: "rgba(255,255,255,0.55)", margin: "0 0 2px", textTransform: "uppercase" }}>Composite</p>
            <p style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1px", color: "#FFF", margin: 0, lineHeight: 1 }}>{student.composite.toFixed(1)}</p>
          </div>
        </div>
      </div>

      <SectionHead
        eyebrow="01 · Where they stand"
        title={isAtRisk ? "Multiple metrics critical" : `${student.name.split(" ")[0]}'s metrics`}
        subtitle="Compared to class average"
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 32 }}>
        <MetricCard
          label="Marks"
          value={student.metrics.marks.value}
          suffix="%"
          vs={`${student.metrics.marks.gap >= 0 ? "+" : ""}${student.metrics.marks.gap.toFixed(1)} vs class`}
          severity={student.metrics.marks.severity}
        />
        <MetricCard
          label="Attendance"
          value={student.metrics.attendance.value}
          suffix="%"
          vs={`${student.metrics.attendance.gap >= 0 ? "+" : ""}${student.metrics.attendance.gap.toFixed(1)} vs class`}
          severity={student.metrics.attendance.severity}
        />
        <MetricCard
          label="Tests taken"
          value={student.metrics.assignments.value}
          suffix="%"
          vs={`${student.metrics.assignments.gap >= 0 ? "+" : ""}${student.metrics.assignments.gap.toFixed(1)} vs class`}
          severity={student.metrics.assignments.severity}
        />
        <MetricCard label="Composite" value={student.composite} severity={isAtRisk ? "critical" : student.status === "attention" ? "warning" : "okay"} />
      </div>

      {student.subjects.length > 0 && (
        <>
          <SectionHead eyebrow="02 · Subjects" title={`${student.name.split(" ")[0]}'s subject scores`} subtitle="Black line = class average" />
          <div style={{ background: T.cardBg, border: T.BORDER, borderRadius: 22, padding: 20, boxShadow: T.SH_LG, marginBottom: 32 }}>
            {student.subjects.map((subj, i) => (
              <div key={subj.subject} style={{
                marginBottom: i < student.subjects.length - 1 ? 16 : 0,
                padding: subj.isYourSubject ? 12 : 0,
                borderRadius: subj.isYourSubject ? 12 : 0,
                background: subj.isYourSubject ? "rgba(255,69,58,0.06)" : "transparent",
                border: subj.isYourSubject ? "0.5px solid rgba(255,69,58,0.15)" : "none",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.T1, letterSpacing: "-0.2px" }}>{subj.subject}{subj.isYourSubject && " ⚠"}</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: subj.status === "critical" ? T.RED : subj.status === "weak" ? T.ORANGE : T.T1, letterSpacing: "-0.4px" }}>{subj.score.toFixed(1)}</span>
                </div>
                <div style={{ position: "relative", height: 6, background: "rgba(0,85,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${subj.score}%`, background: subj.status === "critical" ? `linear-gradient(90deg, ${T.ORANGE} 0%, ${T.RED} 100%)` : subj.status === "weak" ? T.ORANGE : T.B1, borderRadius: 999 }} />
                  <div style={{ position: "absolute", left: `${subj.classAvg}%`, top: -3, bottom: -3, width: 1.5, background: T.T1 }} />
                </div>
                {(subj.isYourSubject || subj.status !== "okay") && (
                  <p style={{ fontSize: 11, fontWeight: 700, color: subj.isYourSubject ? T.RED : subj.status === "critical" ? T.RED : T.ORANGE, margin: "4px 0 0" }}>
                    {subj.gap >= 0 ? "+" : ""}{subj.gap.toFixed(1)} vs class avg {subj.classAvg.toFixed(1)}{subj.isYourSubject ? " · YOUR subject" : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* AI Diagnosis */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ flex: 1 }}><SectionHead eyebrow="03 · Diagnosis" title={`Why ${student.name.split(" ")[0]} is at #${student.rank}`} subtitle="AI read of this student's pattern" /></div>
        <AIBadge />
      </div>
      {aiLoading ? (
        <AISectionLoading label={`Analysing ${student.name.split(" ")[0]}'s data`} />
      ) : aiError ? (
        <AISectionError message={(aiError as Error).message || "Cloud Function call failed"} />
      ) : aiPlan && aiPlan.diagnosis.length > 0 ? (
        <DiagnosisCard items={aiPlan.diagnosis} />
      ) : (
        <LockedSection eyebrow="" title="No diagnosis yet" message="AI ne diagnosis generate nahi kiya. More data add karke retry karein." />
      )}

      {/* AI Action Plan */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ flex: 1 }}><SectionHead eyebrow="04 · Action plan" title={`Interventions for ${student.name.split(" ")[0]}`} subtitle="Specific to this student" /></div>
        <AIBadge />
      </div>
      {aiLoading ? (
        <AISectionLoading label="Generating interventions" />
      ) : aiError ? (
        <AISectionError message={(aiError as Error).message || "Cloud Function call failed"} />
      ) : aiPlan && aiPlan.actions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
          {aiPlan.actions.map(a => <ActionCard key={a.id} action={a} />)}
        </div>
      ) : (
        <LockedSection eyebrow="" title="No actions generated" message="AI ne interventions generate nahi kiye. Retry karein." />
      )}

      <LockedSection
        eyebrow="05 · Trajectory"
        title="8-week rank history"
        message="Rank history ke liye weekly snapshots store karne padenge. Pehla snapshot is week se start hoga."
      />
    </div>
  );
};

// ============================================================
// SCREEN 5: TEACHER SELF INSIGHTS
// ============================================================
const TeacherSelfInsightsScreen = () => {
  const navigate = useNavigate();
  const { data: self, isLoading } = useTeacherSelfMetrics();
  const { data: aiPlan, isLoading: aiLoading, error: aiError } = useTeacherSelfAIPlan(self);

  if (isLoading) return <ScreenLoader label="Loading your metrics" />;
  if (!self) {
    return (
      <div style={{ padding: "28px 18px" }}>
        <BackButton onClick={() => navigate("/leaderboard/teachers")} />
        <div style={{ marginTop: 20 }}>
          <ScreenEmpty title="No data yet" message="Apne classes mein attendance/scores enter karne ke baad metrics yahaan dikhenge." />
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: T.pageBg, padding: "20px 16px 32px", borderRadius: 28, fontFamily: FONT }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "0 4px" }}>
        <BackButton onClick={() => navigate("/leaderboard/teachers")} />
        <Eyebrow>Self insights</Eyebrow>
      </div>

      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-1.4px", color: T.T1, margin: "0 0 6px", lineHeight: 1 }}>Your deep dive</h1>
        <p style={{ fontSize: 13, fontWeight: 500, color: T.T3, margin: 0 }}>{self.name} · {self.subject} · {self.totalStudents} students</p>
      </div>

      <div style={{
        background: T.HERO_GRADIENT, borderRadius: 22, padding: "18px 20px",
        boxShadow: T.SH_HERO, marginBottom: 32, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: "-40%", right: "-20%", width: "80%", height: "140%", background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 60%)", pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, position: "relative" }}>
          <div>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.6px", color: "rgba(255,255,255,0.55)", margin: "0 0 2px", textTransform: "uppercase" }}>Composite</p>
            <p style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1.6px", color: "#FFF", margin: 0, lineHeight: 1 }}>{self.composite.toFixed(1)}</p>
          </div>
          <div style={{ width: 0.5, alignSelf: "stretch", background: "rgba(255,255,255,0.15)" }} />
          <div>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.6px", color: "rgba(255,255,255,0.55)", margin: "0 0 2px", textTransform: "uppercase" }}>Classes</p>
            <p style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1px", color: "#FFF", margin: 0, lineHeight: 1 }}>{self.classes.length}</p>
          </div>
        </div>
      </div>

      <SectionHead eyebrow="01 · Composite breakdown" title={`How ${self.composite.toFixed(1)} builds up`} subtitle="Live calculation across your classes" />
      <div style={{ background: T.cardBg, border: T.BORDER, borderRadius: 22, padding: 22, boxShadow: T.SH_LG, marginBottom: 32 }}>
        {[
          { label: "Students avg score", value: self.classAvgScore, sub: "Mean of all student marks across your classes" },
          { label: "Average attendance", value: self.classAvgAttendance, sub: "Mean attendance across all your students" },
          { label: "Composite", value: self.composite, sub: "60% marks + 40% attendance, weighted" },
        ].map((row, i, arr) => (
          <div key={row.label} style={{ marginBottom: i < arr.length - 1 ? 18 : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 800, color: T.T1, margin: 0, letterSpacing: "-0.2px" }}>{row.label}</p>
                <p style={{ fontSize: 11, fontWeight: 500, color: T.T3, margin: "1px 0 0" }}>{row.sub}</p>
              </div>
              <p style={{ fontSize: 22, fontWeight: 800, color: T.T1, margin: 0, letterSpacing: "-0.5px", lineHeight: 1 }}>{row.value.toFixed(1)}</p>
            </div>
            <div style={{ height: 6, background: "rgba(0,85,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(row.value, 100)}%`, background: T.B1, borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>

      <SectionHead eyebrow="02 · Class-wise breakdown" title="Your classes" subtitle="Performance per class you teach" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
        {self.classes.map((c) => {
          const isWeak = c.classAverage < 60;
          return (
            <div key={c.classId} style={{
              background: isWeak ? "linear-gradient(135deg, rgba(255,136,0,0.06) 0%, rgba(255,170,0,0.03) 100%)" : T.cardBg,
              border: isWeak ? "0.5px solid rgba(255,136,0,0.25)" : T.BORDER,
              borderRadius: 18, padding: 16, boxShadow: isWeak ? "none" : T.SH,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 800, color: T.T1, margin: 0, letterSpacing: "-0.2px" }}>Class {c.label}{isWeak && " ⚠"}</p>
                  <p style={{ fontSize: 11, fontWeight: 500, color: T.T3, margin: "1px 0 0" }}>
                    {c.studentCount} students · marks {c.classAvgScore.toFixed(1)}% · att {c.classAvgAttendance.toFixed(1)}%
                  </p>
                </div>
                <p style={{ fontSize: 22, fontWeight: 800, color: isWeak ? T.ORANGE : T.T1, margin: 0, letterSpacing: "-0.5px" }}>{c.classAverage.toFixed(1)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Diagnosis */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ flex: 1 }}><SectionHead eyebrow="03 · Diagnosis" title="Honest read of your data" subtitle="What's working, what to fix" /></div>
        <AIBadge />
      </div>
      {aiLoading ? (
        <AISectionLoading label="Analysing your performance" />
      ) : aiError ? (
        <AISectionError message={(aiError as Error).message || "Cloud Function call failed"} />
      ) : aiPlan && aiPlan.diagnosis.length > 0 ? (
        <DiagnosisCard items={aiPlan.diagnosis} />
      ) : (
        <LockedSection eyebrow="" title="No diagnosis yet" message="More class data ke baad AI diagnosis generate hogi." />
      )}

      {/* AI Action Plan */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ flex: 1 }}><SectionHead eyebrow="04 · Self-improvement plan" title="Your moves this week" subtitle="Targeted at your weakest gaps" /></div>
        <AIBadge />
      </div>
      {aiLoading ? (
        <AISectionLoading label="Generating self-improvement plan" />
      ) : aiError ? (
        <AISectionError message={(aiError as Error).message || "Cloud Function call failed"} />
      ) : aiPlan && aiPlan.actions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
          {aiPlan.actions.map(a => <ActionCard key={a.id} action={a} />)}
        </div>
      ) : (
        <LockedSection eyebrow="" title="No actions generated" message="AI ne actions generate nahi kiye. Retry karein." />
      )}

      <LockedSection
        eyebrow="05 · Branch comparison"
        title="You vs top teacher"
        message="Branch-wide comparison ke liye sabhi teachers ke metrics ka weekly aggregation chahiye."
      />

      <LockedSection
        eyebrow="06 · Forecast"
        title="Next-week projection"
        message="Forecast model ke liye 4+ weeks of historical data chahiye. Snapshots is week se start honge."
      />
    </div>
  );
};

// ============================================================
// ROUTER — single component picks screen based on URL
// ============================================================
const Leaderboard = () => {
  const location = useLocation();
  const path = location.pathname;

  let screen: React.ReactNode;
  if (path.startsWith("/leaderboard/teachers/insights")) {
    screen = <TeacherSelfInsightsScreen />;
  } else if (path.startsWith("/leaderboard/teachers")) {
    screen = <TeacherLeaderboardScreen />;
  } else if (path.startsWith("/leaderboard/class-plan/")) {
    const classId = decodeURIComponent(path.replace("/leaderboard/class-plan/", "").split("/")[0]);
    screen = <ClassActionPlanScreen classId={classId} />;
  } else if (path.startsWith("/leaderboard/student/")) {
    const studentId = decodeURIComponent(path.replace("/leaderboard/student/", "").split("/")[0]);
    screen = <IndividualStudentScreen studentId={studentId} />;
  } else {
    screen = <StudentLeaderboardScreen />;
  }

  return (
    <div style={{ minHeight: "100vh", background: T.pageBg, padding: "20px 0", fontFamily: FONT }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {screen}
      </div>
    </div>
  );
};

export default Leaderboard;
