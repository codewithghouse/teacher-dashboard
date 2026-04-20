import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { AIController } from "../ai/controller/ai-controller";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:    "#f8fafc",
  white: "#ffffff",
  hero:  "#08090C",
  blue:  "#1e3272",
  blue2: "#2563EB",
  s1:    "#f1f5f9",
  s2:    "#e2e8f0",
  ink1:  "#0f172a",
  ink2:  "#64748b",
  ink3:  "#94a3b8",
  green: "#10b981",
  amber: "#f59e0b",
  rose:  "#f43f5e",
};

// ── Avatar palette (same hash as rest of app) ─────────────────────────────────
const AV_PALETTES = [
  { bg: "#1e3272", text: "#fff" },
  { bg: "#0ea5e9", text: "#fff" },
  { bg: "#10b981", text: "#fff" },
  { bg: "#f59e0b", text: "#fff" },
  { bg: "#8b5cf6", text: "#fff" },
  { bg: "#f43f5e", text: "#fff" },
  { bg: "#06b6d4", text: "#fff" },
];
const avStyle = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_PALETTES[h % AV_PALETTES.length];
};
const getInitials = (name: string) => {
  const p = (name || "").trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
};

// ── Concept card colors ───────────────────────────────────────────────────────
const STATUS = {
  mastered:   { label: "Mastered",   dot: T.green, bg: "#f0fdf4", tagBg: "#dcfce7", tagColor: "#166534", barColor: T.green },
  developing: { label: "Developing", dot: T.amber, bg: "#fffbeb", tagBg: "#fef3c7", tagColor: "#92400e", barColor: T.amber },
  weak:       { label: "Weak",       dot: T.rose,  bg: "#fff1f2", tagBg: "#ffe4e6", tagColor: "#9f1239", barColor: T.rose  },
};

const formatTitle = (h: string) =>
  h.charAt(0).toUpperCase() + h.slice(1).toLowerCase().replace(/_/g, " ");

// ── Props ─────────────────────────────────────────────────────────────────────
interface ConceptMasteryDetailProps {
  student: any;
  concepts: string[];
  scores: number[];
  className?: string;
  onBack: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
const ConceptMasteryDetail = ({ student, concepts, scores, className, onBack }: ConceptMasteryDetailProps) => {
  const [selectedRemedial, setSelectedRemedial] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiData, setAiData] = useState<any>(null);

  // Build concept objects
  const mappedConcepts = concepts.map((c, i) => {
    const score = scores[i] ?? 0;
    return { title: c, score };
  }).filter(c => c.score > 0);

  const mastered   = mappedConcepts.filter(c => c.score >= 80);
  const developing = mappedConcepts.filter(c => c.score >= 50 && c.score < 80);
  const weak       = mappedConcepts.filter(c => c.score < 50);

  const av = avStyle(student.name || "S");

  // ── AI Remedial ─────────────────────────────────────────────────────────────
  const handleRemedial = async (concept: string) => {
    setSelectedRemedial(concept);
    setIsGenerating(true);
    setAiData(null);
    try {
      const result = await AIController.getConceptRemedial({
        student_name: student.name,
        failed_concept: concept,
        past_scores: mappedConcepts,
      });
      if (result.status === "success" && result.data) {
        setAiData(result.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  // Recommended actions (dynamic)
  const recommendedActions = [
    weak[0]
      ? `Schedule 1-on-1 tutoring for "${formatTitle(weak[0].title)}"`
      : "Review all completed topics with student",
    weak[1]
      ? `Assign extra worksheets for "${formatTitle(weak[1].title)}"`
      : "Encourage consistent daily practice",
    "Contact parents to discuss home support strategies",
  ];

  const hasRisk = weak.length > 0;

  // ── Shared concept tag component (inline) ───────────────────────────────────
  const ConceptCard = ({
    type, items,
  }: { type: keyof typeof STATUS; items: typeof mappedConcepts }) => {
    const s = STATUS[type];
    return (
      <div style={{
        background: T.white,
        border: `1.5px solid ${T.s2}`,
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}>
        {/* Card header */}
        <div style={{ background: s.bg, padding: "16px 20px", borderBottom: `1px solid ${T.s2}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%",
              background: s.dot, flexShrink: 0,
            }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: T.ink1 }}>{s.label}</span>
            <span style={{
              marginLeft: "auto",
              background: s.tagBg, color: s.tagColor,
              fontSize: 12, fontWeight: 700, borderRadius: 20,
              padding: "2px 10px",
            }}>
              {items.length}
            </span>
          </div>
        </div>

        {/* Concept tags list */}
        <div style={{ padding: 16 }}>
          {items.length === 0 ? (
            <p style={{ fontSize: 13, color: T.ink3, textAlign: "center", padding: "16px 0" }}>
              {type === "mastered"   ? "No mastered concepts yet."        :
               type === "developing" ? "No developing concepts."           :
                                       "No weak areas. Great work!"}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((c, i) => (
                <div key={i} style={{
                  background: s.tagBg,
                  borderRadius: 12,
                  padding: "10px 14px",
                }}>
                  {/* Name + score */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.ink1 }}>
                      {formatTitle(c.title)}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: s.tagColor }}>
                      {c.score}%
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 5, background: `${s.dot}33`, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${c.score}%`,
                      background: s.dot, borderRadius: 99,
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                  {/* AI remedial button for weak concepts */}
                  {type === "weak" && (
                    <button
                      onClick={() => handleRemedial(c.title)}
                      disabled={isGenerating && selectedRemedial === c.title}
                      style={{
                        marginTop: 10,
                        width: "100%", padding: "7px 0",
                        background: isGenerating && selectedRemedial === c.title ? T.rose + "99" : T.rose,
                        color: "#fff", border: "none", borderRadius: 10,
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        transition: "opacity 0.2s",
                      }}
                    >
                      {isGenerating && selectedRemedial === c.title ? (
                        <>
                          <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles style={{ width: 13, height: 13 }} />
                          Assign Remedial
                        </>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: T.bg }}>

      {/* ── Dark hero ────────────────────────────────────────────────────────── */}
      <div
        className="bg-[#162E93] md:bg-[#08090C] md:rounded-2xl"
        style={{ margin: "0 -22px", position: "relative" }}
      >
        <div className="max-w-[1200px] md:mx-auto" style={{ padding: "0 22px 28px" }}>
          {/* Back button row */}
          <div style={{ paddingTop: 20, marginBottom: 22 }}>
            <button
              onClick={onBack}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "rgba(255,255,255,0.08)",
                border: "1.5px solid rgba(255,255,255,0.12)",
                borderRadius: 10, padding: "7px 14px",
                color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {/* left arrow */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              All students
            </button>
          </div>

          {/* Eyebrow */}
          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>
            Concept Mastery Analysis
          </p>

          {/* Desktop: avatar+name left, action buttons right | Mobile: stacked */}
          <div className="md:flex md:items-center md:justify-between md:gap-6">
            {/* Avatar + name row */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22 }} className="md:!mb-0">
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                background: av.bg, color: av.text,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, fontWeight: 800, flexShrink: 0,
                boxShadow: `0 0 0 3px ${av.bg}55`,
              }}>
                {student.initials || getInitials(student.name || "S")}
              </div>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, lineHeight: 1.2 }}>
                  {student.name}
                </h1>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: "4px 0 0" }}>
                  {className ? `${className}` : ""}
                  {student.roll ? ` · Roll ${student.roll}` : ""}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2.5 md:shrink-0">
              <button className="md:px-6" style={{
                flex: 1, padding: "10px 16px",
                background: "rgba(255,255,255,0.08)",
                border: "1.5px solid rgba(255,255,255,0.15)",
                borderRadius: 12, color: "rgba(255,255,255,0.85)",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                whiteSpace: "nowrap",
              }}>
                View Profile
              </button>
              <button className="md:px-6" style={{
                flex: 1, padding: "10px 16px",
                background: T.blue2,
                border: "none", borderRadius: 12,
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                whiteSpace: "nowrap",
              }}>
                Contact Parent
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="max-w-[1200px] md:mx-auto" style={{ paddingTop: 24 }}>

        {/* 3-stat row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 22 }} className="md:!gap-4">
          {[
            { label: "Mastered",   count: mastered.length,   color: T.green, bg: "#f0fdf4" },
            { label: "Developing", count: developing.length, color: T.amber, bg: "#fffbeb" },
            { label: "Weak Areas", count: weak.length,       color: T.rose,  bg: "#fff1f2" },
          ].map(stat => (
            <div key={stat.label} className="md:!py-6" style={{
              background: stat.bg,
              border: `1.5px solid ${stat.color}22`,
              borderRadius: 16, padding: "14px 0",
              textAlign: "center",
            }}>
              <p className="md:!text-4xl" style={{ fontSize: 26, fontWeight: 800, color: stat.color, margin: 0, lineHeight: 1 }}>
                {stat.count}
              </p>
              <p className="md:!text-sm" style={{ fontSize: 11, fontWeight: 600, color: T.ink2, margin: "4px 0 0" }}>
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        {/* 3 concept status cards — stacked on mobile, 3-col grid on desktop */}
        <div className="flex flex-col gap-3.5 md:grid md:grid-cols-3 md:gap-4 mb-6">
          <ConceptCard type="mastered"   items={mastered} />
          <ConceptCard type="developing" items={developing} />
          <ConceptCard type="weak"       items={weak} />
        </div>

        {/* AI Remedial Output */}
        {aiData && selectedRemedial && (
          <div style={{
            background: T.white,
            border: "1.5px solid #e0e7ff",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 22,
            boxShadow: "0 2px 12px rgba(99,102,241,0.08)",
          }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 4px" }}>
              AI Remedial Plan
            </p>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.ink1, margin: "0 0 16px" }}>
              {formatTitle(selectedRemedial)}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {aiData.learning_gap && (
                <div style={{ background: "#eef2ff", borderRadius: 14, padding: "12px 16px" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 4px" }}>Learning Gap</p>
                  <p style={{ fontSize: 13, color: "#312e81", margin: 0 }}>{aiData.learning_gap}</p>
                </div>
              )}
              {aiData.prerequisite_chain && (
                <div style={{ background: "#fff1f2", borderRadius: 14, padding: "12px 16px" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: T.rose, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 4px" }}>Root Cause</p>
                  <p style={{ fontSize: 13, color: "#9f1239", margin: 0 }}>{aiData.prerequisite_chain}</p>
                </div>
              )}
              {aiData.remedial_plan && (
                <div style={{ background: "#f0fdf4", borderRadius: 14, padding: "12px 16px" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" }}>Remedial Steps</p>
                  <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                    {(aiData.remedial_plan as string[]).map((step, i) => (
                      <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#14532d" }}>
                        <span style={{ fontWeight: 700, color: T.green, flexShrink: 0 }}>{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recommended actions + Risk banner — stacked on mobile, side-by-side on desktop */}
        <div className="md:grid md:grid-cols-[1.4fr_1fr] md:gap-5 md:items-start">

        {/* Recommended actions */}
        <div className="mb-[22px] md:!mb-0" style={{
          background: T.white,
          border: `1.5px solid ${T.s2}`,
          borderRadius: 20,
          padding: "20px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: T.ink1, margin: "0 0 14px" }}>
            Recommended Actions
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recommendedActions.map((action, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <span style={{
                  width: 26, height: 26, borderRadius: 8,
                  background: "#eff6ff", color: T.blue2,
                  fontSize: 12, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                <p style={{ fontSize: 13, color: T.ink2, margin: 0, paddingTop: 4 }}>{action}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Risk / no-risk banner */}
        {hasRisk ? (
          <div style={{
            background: "#fff1f2",
            border: "1.5px solid #fecdd3",
            borderRadius: 16,
            padding: "14px 18px",
            display: "flex", alignItems: "flex-start", gap: 12,
          }}>
            <span style={{
              width: 34, height: 34, borderRadius: 10,
              background: T.rose, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {/* warning icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#9f1239", margin: "0 0 3px" }}>
                Intervention Required
              </p>
              <p style={{ fontSize: 12, color: "#be123c", margin: 0 }}>
                {student.name} has {weak.length} weak area{weak.length > 1 ? "s" : ""} that need{weak.length === 1 ? "s" : ""} immediate support. Consider scheduling a parent meeting.
              </p>
            </div>
          </div>
        ) : (
          <div style={{
            background: "#f0fdf4",
            border: "1.5px solid #bbf7d0",
            borderRadius: 16,
            padding: "14px 18px",
            display: "flex", alignItems: "flex-start", gap: 12,
          }}>
            <span style={{
              width: 34, height: 34, borderRadius: 10,
              background: T.green, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {/* check icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#166534", margin: "0 0 3px" }}>
                On Track
              </p>
              <p style={{ fontSize: 12, color: "#15803d", margin: 0 }}>
                {student.name} is performing well across all assessed concepts. Keep up the great work!
              </p>
            </div>
          </div>
        )}

        </div>{/* ═══ end Recommended/Risk grid ═══ */}

        {/* Bottom spacing */}
        <div style={{ height: 32 }} />
      </div>
    </div>
  );
};

export default ConceptMasteryDetail;