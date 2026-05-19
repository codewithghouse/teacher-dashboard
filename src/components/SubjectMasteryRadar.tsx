import { useId, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface RadarPoint {
  subject: string;
  score: number;
  fullMark: number;
}

interface Props {
  data: RadarPoint[];
  color: string;
  height?: number;
  showCenterAverage?: boolean;
  /** kept for back-compat with old radar callers — no longer used */
  labelFontSize?: number;
}

const tier = (n: number) =>
  n >= 75
    ? { c: "#16a34a", grad: ["#22c55e", "#16a34a"], label: "Strong", bg: "rgba(22,163,74,0.10)" }
    : n >= 50
    ? { c: "#d97706", grad: ["#f59e0b", "#d97706"], label: "Steady", bg: "rgba(217,119,6,0.10)" }
    : { c: "#dc2626", grad: ["#ef4444", "#dc2626"], label: "Focus", bg: "rgba(220,38,38,0.10)" };

interface TipPayload {
  payload?: { subject: string; score: number };
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: TipPayload[] }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (!p) return null;
  const t = tier(p.score);
  return (
    <div
      style={{
        background: "#ffffff",
        border: "0.5px solid rgba(15,23,42,0.10)",
        borderRadius: 10,
        padding: "8px 12px",
        boxShadow: "0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.05)",
        minWidth: 140,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: t.c,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.01em" }}>
          {p.subject}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: t.c, letterSpacing: "-0.03em", lineHeight: 1 }}>
          {Math.round(p.score)}
          <span style={{ fontSize: "0.55em", fontWeight: 600, marginLeft: 1 }}>%</span>
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 6,
            color: t.c,
            background: t.bg,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {t.label}
        </span>
      </div>
    </div>
  );
};

/**
 * Subject Mastery — interactive horizontal bar chart. Each subject is a
 * tier-colored bar (green ≥75 / amber 50-74 / red <50) with a hover tooltip
 * showing the score + tier label. Top 8 subjects, sorted by score desc.
 *
 * Component name preserved (SubjectMasteryRadar) so callers don't re-wire.
 */
export const SubjectMasteryRadar = ({
  data,
  color,
  height = 220,
  showCenterAverage = true,
}: Props) => {
  const uid = useId().replace(/:/g, "");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const sorted = [...data].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 8);

  const avg =
    data.length > 0
      ? data.reduce((s, d) => s + (d.score || 0), 0) / data.length
      : 0;

  if (top.length === 0) return null;

  const chartData = top.map((d, i) => ({
    subject: d.subject.length > 12 ? `${d.subject.slice(0, 11)}…` : d.subject,
    fullSubject: d.subject,
    score: Math.max(0, Math.min(100, d.score)),
    idx: i,
  }));

  const headerH = showCenterAverage ? 28 : 0;
  const chartH = Math.max(120, height - headerH - 4);

  const avgT = tier(avg);

  return (
    <div style={{ width: "100%" }}>
      {showCenterAverage && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.18em",
            }}
          >
            Top {top.length} Subjects
          </span>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              background: avgT.bg,
              borderRadius: 999,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: avgT.c,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
              }}
            >
              Avg
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: avgT.c, letterSpacing: "-0.02em" }}>
              {Math.round(avg)}%
            </span>
          </div>
        </div>
      )}

      <div style={{ width: "100%", height: chartH }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 36, bottom: 4, left: 0 }}
            onMouseLeave={() => setActiveIdx(null)}
            onMouseMove={(state) => {
              const i = state?.activeTooltipIndex;
              if (typeof i === "number") setActiveIdx(i);
              else setActiveIdx(null);
            }}
          >
            <defs>
              {chartData.map((d) => {
                const t = tier(d.score);
                return (
                  <linearGradient
                    key={`g-${uid}-${d.idx}`}
                    id={`smr-grad-${uid}-${d.idx}`}
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    <stop offset="0%" stopColor={t.grad[0]} />
                    <stop offset="100%" stopColor={t.grad[1]} />
                  </linearGradient>
                );
              })}
            </defs>

            <CartesianGrid
              horizontal={false}
              stroke="rgba(15,23,42,0.05)"
              strokeDasharray="2 4"
            />

            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis
              type="category"
              dataKey="subject"
              tickLine={false}
              axisLine={false}
              width={86}
              tick={{ fill: "#475569", fontSize: 10.5, fontWeight: 600 }}
              interval={0}
            />

            <Tooltip
              cursor={{ fill: "rgba(15,23,42,0.04)", radius: 6 }}
              content={<CustomTooltip />}
              wrapperStyle={{ outline: "none" }}
              animationDuration={120}
            />

            <Bar
              dataKey="score"
              radius={[0, 8, 8, 0]}
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-out"
              barSize={Math.min(22, Math.max(10, Math.floor((chartH - 16) / Math.max(1, chartData.length)) - 6))}
              label={{
                position: "right",
                fill: "#0f172a",
                fontSize: 11,
                fontWeight: 700,
                formatter: (v: number) => `${Math.round(v)}`,
              }}
            >
              {chartData.map((d, i) => (
                <Cell
                  key={`cell-${uid}-${d.idx}`}
                  fill={`url(#smr-grad-${uid}-${d.idx})`}
                  fillOpacity={activeIdx === null || activeIdx === i ? 1 : 0.42}
                  style={{ transition: "fill-opacity 180ms ease-out", cursor: "pointer" }}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div
        aria-hidden
        style={{
          height: 2,
          marginTop: 8,
          borderRadius: 2,
          background: `linear-gradient(90deg, ${color} 0%, transparent 70%)`,
          opacity: 0.18,
        }}
      />
    </div>
  );
};

export default SubjectMasteryRadar;
