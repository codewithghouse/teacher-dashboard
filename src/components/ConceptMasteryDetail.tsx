import { useState, useEffect } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { generateConceptRemedial } from "../ai/system/concept-remedial";

// Build the cross-page handoff payload once. Both target pages
// (Students.tsx, ParentNotes.tsx) read these via useLocation().state.
// We pass id AND email so the target can match either way (the
// enrollment.studentId field isn't always the canonical students/{doc_id}).
const buildStudentHandoff = (student: any) => ({
  autoOpenStudentId:    student?.realId || student?.id || "",
  autoOpenStudentEmail: (student?.email || "").toLowerCase(),
  autoOpenStudentName:  student?.name || "",
});

// ── Blue Apple design tokens (matches all other teacher pages) ───────────────
// Was slate-based. Now harmonized with the app-wide Blue Apple palette so the
// detail view matches Dashboard/MyClasses/Gradebook/etc visual language.
const T = {
  bg:    "#EEF4FF",   // page background — Blue Apple soft
  white: "#FFFFFF",
  hero:  "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
  blue:  "#001040",   // dark ink
  blue2: "#0055FF",   // primary action
  s1:    "#F4F7FE",   // surface
  s2:    "rgba(0,85,255,0.10)", // separator
  ink1:  "#001040",   // primary text
  ink2:  "#5070B0",   // secondary text
  ink3:  "#99AACC",   // muted text
  green: "#00C853",   // mastered
  amber: "#FF8800",   // developing
  rose:  "#FF3355",   // weak
  // Card shadow stack — same Blue Apple halo used elsewhere.
  SH:    "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
};

// ── Avatar palette — Blue Apple harmonized ────────────────────────────────────
const AV_PALETTES = [
  { bg: "#7B3FF4", text: "#fff" },
  { bg: "#00C853", text: "#fff" },
  { bg: "#0055FF", text: "#fff" },
  { bg: "#FF8800", text: "#fff" },
  { bg: "#00B8D4", text: "#fff" },
  { bg: "#C2255C", text: "#fff" },
  { bg: "#6741D9", text: "#fff" },
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
type DetailSource = 'test' | 'exam' | 'assignment' | 'custom';
interface ConceptMasteryDetailProps {
  student: any;
  concepts: string[];
  scores: number[];
  /** Optional source tag per concept (parallel to `concepts` array). When
   *  provided, each concept item carries a small color-coded chip showing
   *  whether it came from a Test / Exam / Assignment / Custom Unit. */
  conceptSources?: DetailSource[];
  className?: string;
  onBack: () => void;
}

const DETAIL_SOURCE_LABEL: Record<DetailSource, string> = {
  test: 'Test', exam: 'Exam', assignment: 'Assignment', custom: 'Unit',
};
const DETAIL_SOURCE_COLOR: Record<DetailSource, { fg: string; bg: string }> = {
  test:       { fg: '#0055FF', bg: 'rgba(0,85,255,.10)'   },
  exam:       { fg: '#7B3FF4', bg: 'rgba(123,63,244,.10)' },
  assignment: { fg: '#FF8800', bg: 'rgba(255,136,0,.10)'  },
  custom:     { fg: '#00C853', bg: 'rgba(0,200,83,.10)'   },
};

// ── Hoisted ConceptCard (P2-6) ────────────────────────────────────────────────
// Was defined inside the parent — recreated on every render which broke React's
// reconciliation identity (children re-mounted instead of updating). Hoisted to
// module scope so it stays stable across renders. All bucket-specific behavior
// flows through props.
type ConceptItem = { title: string; score: number; source?: DetailSource };
interface ConceptCardProps {
  type: keyof typeof STATUS;
  items: ConceptItem[];
  selectedRemedial: string | null;
  isGenerating: boolean;
  onRemedial: (concept: string) => void;
}

const ConceptCard: React.FC<ConceptCardProps> = ({ type, items, selectedRemedial, isGenerating, onRemedial }) => {
  const s = STATUS[type];
  return (
    <div className="cmd-card3d" style={{
      background: T.white,
      border: `0.5px solid rgba(0,85,255,0.07)`,
      borderRadius: 20,
      overflow: "hidden",
      boxShadow: T.SH,
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
            {items.map((c, i) => {
              const sourceMeta = c.source ? DETAIL_SOURCE_COLOR[c.source] : null;
              return (
                <div key={`${c.title}_${c.source ?? "x"}_${i}`} style={{
                  background: s.tagBg,
                  borderRadius: 12,
                  padding: "10px 14px",
                }}>
                  {/* Name + score */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
                      {sourceMeta && c.source && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5,
                          background: sourceMeta.bg, color: sourceMeta.fg,
                          letterSpacing: "0.5px", textTransform: "uppercase",
                          flexShrink: 0,
                        }}>
                          {DETAIL_SOURCE_LABEL[c.source]}
                        </span>
                      )}
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.ink1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {formatTitle(c.title)}
                      </span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: s.tagColor, flexShrink: 0 }}>
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
                    <button type="button"
                      onClick={() => onRemedial(c.title)}
                      disabled={isGenerating && selectedRemedial === c.title}
                      style={{
                        marginTop: 10,
                        width: "100%", padding: "7px 0",
                        background: isGenerating && selectedRemedial === c.title ? T.rose + "99" : T.rose,
                        color: "#fff", border: "none", borderRadius: 10,
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        transition: "opacity 0.2s",
                        boxShadow: "0 1px 2px rgba(255,51,85,.2), 0 3px 8px rgba(255,51,85,.25)",
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────
const ConceptMasteryDetail = ({ student, concepts, scores, conceptSources, className, onBack }: ConceptMasteryDetailProps) => {
  const navigate = useNavigate();
  const [selectedRemedial, setSelectedRemedial] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiData, setAiData] = useState<any>(null);

  // Cross-page handoff for the two header buttons.
  const handleViewProfile = () =>
    navigate("/students", { state: buildStudentHandoff(student) });
  const handleContactParent = () =>
    navigate("/parent-notes", { state: buildStudentHandoff(student) });

  // Build concept objects, carrying the source tag through to render so
  // each item can show a color chip indicating its origin (Test/Exam/etc).
  const mappedConcepts = concepts.map((c, i) => {
    const score = scores[i] ?? 0;
    const source = conceptSources?.[i];
    return { title: c, score, source };
  }).filter(c => c.score > 0);

  const mastered   = mappedConcepts.filter(c => c.score >= 80);
  const developing = mappedConcepts.filter(c => c.score >= 50 && c.score < 80);
  const weak       = mappedConcepts.filter(c => c.score < 50);

  const av = avStyle(student.name || "S");

  // ── Remedial plan (system-driven, no API call) ───────────────────────────
  // Replaces the previous AIController.getConceptRemedial which was a broken
  // stub returning `not_implemented`. See ai/system/concept-remedial.ts for
  // the deterministic logic. Brief loading flicker preserved so the existing
  // button-disabled UX still reads naturally.
  const handleRemedial = (concept: string) => {
    setSelectedRemedial(concept);
    setIsGenerating(true);
    setAiData(null);
    const c = mappedConcepts.find((m) => m.title === concept);
    const score = c?.score ?? 0;
    // Defer to a microtask so the spinner state visibly transitions; users
    // expect a tiny "thinking" beat after clicking even though the compute
    // itself is < 1ms.
    queueMicrotask(() => {
      try {
        const data = generateConceptRemedial(student?.name || "", concept, score);
        setAiData(data);
      } catch (e) {
        console.error("[ConceptRemedial] generation failed:", e);
      } finally {
        setIsGenerating(false);
      }
    });
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

  // P3-3: Esc closes the detail view. Skipped while AI is generating (so the
  // teacher doesn't accidentally drop a remedial run mid-compute).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isGenerating) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, isGenerating]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#EEF4FF" }}>

      {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
      <MobileConceptMasteryDetail
        student={student}
        mappedConcepts={mappedConcepts}
        mastered={mastered}
        developing={developing}
        weak={weak}
        className={className}
        onBack={onBack}
        onViewProfile={handleViewProfile}
        onContactParent={handleContactParent}
        aiData={aiData}
        selectedRemedial={selectedRemedial}
        isGenerating={isGenerating}
        onRemedial={handleRemedial}
        recommendedActions={recommendedActions}
        hasRisk={hasRisk}
      />
      {/* ═══════════ END MOBILE VIEW ═══════════ */}

      {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
      <div className="hidden md:block">

      {/* ── Blue Apple hero (matches Dashboard / MyClasses / Gradebook) ────── */}
      <div
        style={{
          background: T.hero,
          borderRadius: 26,
          margin: "0 -22px",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(0,8,60,.15), 0 12px 32px rgba(0,8,60,.28)",
        }}
      >
        {/* Glass highlight overlay */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)", pointerEvents: "none" }} />
        <div className="max-w-[1200px] md:mx-auto" style={{ padding: "0 22px 28px", position: "relative", zIndex: 2 }}>
          {/* Back button row */}
          <div style={{ paddingTop: 20, marginBottom: 22 }}>
            <button type="button"
              onClick={onBack}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "rgba(255,255,255,0.10)",
                backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                border: "0.5px solid rgba(255,255,255,0.18)",
                borderRadius: 10, padding: "7px 14px",
                color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 600,
                cursor: "pointer", letterSpacing: "-0.1px",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              All students
            </button>
          </div>

          {/* Eyebrow */}
          <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.72)", letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 14 }}>
            Concept Mastery Analysis
          </p>

          {/* Desktop: avatar+name left, action buttons right | Mobile: stacked */}
          <div className="md:flex md:items-center md:justify-between md:gap-6">
            {/* Avatar + name row */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22 }} className="md:!mb-0">
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: av.bg, color: av.text,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, fontWeight: 700, flexShrink: 0, letterSpacing: "0.5px",
                boxShadow: `0 1px 2px ${av.bg}4D, 0 8px 16px ${av.bg}55, inset 0 1px 0 rgba(255,255,255,.25)`,
              }}>
                {student.initials || getInitials(student.name || "S")}
              </div>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 700, color: "#fff", margin: 0, lineHeight: 1.15, letterSpacing: "-0.6px" }}>
                  {student.name}
                </h1>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", margin: "4px 0 0", fontWeight: 500, letterSpacing: "-0.1px" }}>
                  {className ? `${className}` : ""}
                  {student.rollNo ? ` · Roll ${student.rollNo}` : ""}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2.5 md:shrink-0">
              <button type="button" onClick={handleViewProfile} className="md:px-6" style={{
                flex: 1, padding: "10px 16px",
                background: "rgba(255,255,255,0.12)",
                backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                border: "0.5px solid rgba(255,255,255,0.20)",
                borderRadius: 12, color: "#fff",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                whiteSpace: "nowrap", letterSpacing: "-0.2px",
              }}>
                View Profile
              </button>
              <button type="button" onClick={handleContactParent} className="md:px-6" style={{
                flex: 1, padding: "10px 16px",
                background: T.blue2,
                border: "none", borderRadius: 12,
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                whiteSpace: "nowrap", letterSpacing: "-0.2px",
                boxShadow: "0 1px 2px rgba(9,87,247,.25), 0 6px 14px rgba(9,87,247,.35)",
              }}>
                Contact Parent
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="max-w-[1200px] md:mx-auto" style={{ paddingTop: 24 }}>

        {/* 3-stat row — Blue Apple cards with status pastel backgrounds */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 22 }} className="md:!gap-4">
          {[
            { label: "Mastered",   count: mastered.length,   color: T.green, bg: "linear-gradient(160deg, rgba(0,232,102,.12), rgba(0,200,83,.04))",  border: "rgba(0,200,83,.22)" },
            { label: "Developing", count: developing.length, color: T.amber, bg: "linear-gradient(160deg, rgba(255,170,0,.14), rgba(255,136,0,.04))", border: "rgba(255,136,0,.25)" },
            { label: "Weak Areas", count: weak.length,       color: T.rose,  bg: "linear-gradient(160deg, rgba(255,51,85,.10), rgba(255,51,85,.02))", border: "rgba(255,51,85,.22)" },
          ].map(stat => (
            <div key={stat.label} className="md:!py-7" style={{
              background: stat.bg,
              border: `0.5px solid ${stat.border}`,
              borderRadius: 18, padding: "16px 0",
              textAlign: "center",
              boxShadow: "0 1px 2px rgba(0,8,60,.04), 0 4px 14px rgba(0,8,60,.06)",
            }}>
              <p className="md:!text-4xl" style={{ fontSize: 30, fontWeight: 700, color: stat.color, margin: 0, lineHeight: 1, letterSpacing: "-1px" }}>
                {stat.count}
              </p>
              <p className="md:!text-sm" style={{ fontSize: 11, fontWeight: 700, color: T.ink2, margin: "6px 0 0", letterSpacing: "1.1px", textTransform: "uppercase" }}>
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        {/* 3 concept status cards — stacked on mobile, 3-col grid on desktop */}
        <div className="flex flex-col gap-3.5 md:grid md:grid-cols-3 md:gap-4 mb-6">
          <ConceptCard type="mastered"   items={mastered}   selectedRemedial={selectedRemedial} isGenerating={isGenerating} onRemedial={handleRemedial} />
          <ConceptCard type="developing" items={developing} selectedRemedial={selectedRemedial} isGenerating={isGenerating} onRemedial={handleRemedial} />
          <ConceptCard type="weak"       items={weak}       selectedRemedial={selectedRemedial} isGenerating={isGenerating} onRemedial={handleRemedial} />
        </div>

        {/* AI Remedial Output */}
        {aiData && selectedRemedial && (
          <div className="cmd-card3d" style={{
            background: T.white,
            border: "0.5px solid rgba(0,85,255,0.07)",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 22,
            boxShadow: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
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
        <div className="cmd-card3d mb-[22px] md:!mb-0" style={{
          background: T.white,
          border: `0.5px solid rgba(0,85,255,0.07)`,
          borderRadius: 20,
          padding: "20px",
          boxShadow: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
        }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: T.ink1, margin: "0 0 14px", letterSpacing: "-0.3px" }}>
            Recommended Actions
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recommendedActions.map((action, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 9,
                  background: "rgba(0,85,255,0.10)", color: T.blue2,
                  fontSize: 12, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, letterSpacing: "-0.2px",
                }}>
                  {i + 1}
                </span>
                <p style={{ fontSize: 13, color: T.ink2, margin: 0, paddingTop: 5, fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5 }}>{action}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Risk / no-risk banner — Blue Apple harmonized */}
        {hasRisk ? (
          <div style={{
            background: "linear-gradient(140deg, #FF3355 0%, #C92A2A 100%)",
            borderRadius: 20, padding: "16px 20px",
            display: "flex", alignItems: "flex-start", gap: 12,
            position: "relative", overflow: "hidden",
            boxShadow: "0 1px 2px rgba(255,51,85,.20), 0 10px 26px rgba(255,51,85,.28)",
          }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.18) 0%, transparent 45%)", pointerEvents: "none" }} />
            <span style={{
              width: 38, height: 38, borderRadius: 12,
              background: "rgba(255,255,255,0.22)",
              backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
              border: "0.5px solid rgba(255,255,255,0.28)",
              flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", zIndex: 2,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </span>
            <div style={{ position: "relative", zIndex: 2 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.85)", margin: "0 0 3px", letterSpacing: "1.4px", textTransform: "uppercase" }}>
                Status
              </p>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: "0 0 6px", letterSpacing: "-0.4px" }}>
                Intervention Required
              </p>
              <p style={{ fontSize: 12.5, color: "rgba(255,255,255,.92)", margin: 0, fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5 }}>
                <strong style={{ color: "#fff", fontWeight: 700 }}>{student.name}</strong> has {weak.length} weak area{weak.length > 1 ? "s" : ""} that need{weak.length === 1 ? "s" : ""} immediate support. Consider scheduling a parent meeting.
              </p>
            </div>
          </div>
        ) : (
          <div style={{
            background: "linear-gradient(140deg, #00C853 0%, #00E866 100%)",
            borderRadius: 20, padding: "16px 20px",
            display: "flex", alignItems: "flex-start", gap: 12,
            position: "relative", overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,200,83,.20), 0 10px 26px rgba(0,200,83,.28)",
          }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.18) 0%, transparent 45%)", pointerEvents: "none" }} />
            <span style={{
              width: 38, height: 38, borderRadius: 12,
              background: "rgba(255,255,255,0.22)",
              backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
              border: "0.5px solid rgba(255,255,255,0.28)",
              flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", zIndex: 2,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
            <div style={{ position: "relative", zIndex: 2 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.85)", margin: "0 0 3px", letterSpacing: "1.4px", textTransform: "uppercase" }}>
                Status
              </p>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: "0 0 6px", letterSpacing: "-0.4px" }}>
                On Track
              </p>
              <p style={{ fontSize: 12.5, color: "rgba(255,255,255,.92)", margin: 0, fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5 }}>
                <strong style={{ color: "#fff", fontWeight: 700 }}>{student.name}</strong> is performing well across all assessed concepts. Keep up the great work!
              </p>
            </div>
          </div>
        )}

        </div>{/* ═══ end Recommended/Risk grid ═══ */}

        {/* Bottom spacing */}
        <div style={{ height: 32 }} />
      </div>
      </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Mobile-only redesign (does not affect desktop)
// ─────────────────────────────────────────────────────────────────────────────
const MOB_AV_PALETTE = ['#7B3FF4', '#00C853', '#0055FF', '#FF8800', '#00B8D4', '#C2255C', '#6741D9'];
const mobAvatarColor = (name: string) => {
  const sum = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return MOB_AV_PALETTE[sum % MOB_AV_PALETTE.length];
};

interface MobileDetailProps {
  student: any;
  mappedConcepts: { title: string; score: number }[];
  mastered: { title: string; score: number }[];
  developing: { title: string; score: number }[];
  weak: { title: string; score: number }[];
  className?: string;
  onBack: () => void;
  onViewProfile: () => void;
  onContactParent: () => void;
  aiData: any;
  selectedRemedial: string | null;
  isGenerating: boolean;
  onRemedial: (c: string) => void;
  recommendedActions: string[];
  hasRisk: boolean;
}

const MobileConceptMasteryDetail = ({
  student, mappedConcepts, mastered, developing, weak, className, onBack,
  onViewProfile, onContactParent,
  aiData, selectedRemedial, isGenerating, onRemedial, recommendedActions, hasRisk,
}: MobileDetailProps) => {
  const avColor = mobAvatarColor(student.name || 'S');
  const initials = getInitials(student.name || 'S');
  void mappedConcepts; // kept for API stability
  return (
    <div
      className="md:hidden -mx-4 sm:-mx-6 pb-7"
      style={{
        background: '#EEF4FF',
        minHeight: '100vh',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <style>{`
        .cmd-card3d { transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease; backface-visibility: hidden; -webkit-backface-visibility: hidden; will-change: transform; }
        @media (hover:hover) { .cmd-card3d:hover { transform: translate3d(0,-5px,0) scale(1.02); box-shadow: 0 0 0 .5px rgba(0,85,255,.14), 0 8px 24px rgba(0,85,255,.16), 0 20px 46px rgba(0,85,255,.18) !important; } }
        .cmd-card3d:active { transform: translate3d(0,-1px,0) scale(.985); box-shadow: 0 0 0 .5px rgba(0,85,255,.12), 0 6px 16px rgba(0,85,255,.14) !important; }
        .cmd-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .cmd-press:active { transform: scale(.94); }
        @keyframes cmdFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .cmd-enter > * { animation: cmdFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
        .cmd-enter > *:nth-child(1) { animation-delay: .04s; }
        .cmd-enter > *:nth-child(2) { animation-delay: .10s; }
        .cmd-enter > *:nth-child(3) { animation-delay: .16s; }
        .cmd-enter > *:nth-child(4) { animation-delay: .22s; }
        .cmd-enter > *:nth-child(5) { animation-delay: .28s; }
        .cmd-enter > *:nth-child(6) { animation-delay: .34s; }
        .cmd-fill { transition: width 1s cubic-bezier(.2,.9,.3,1); }
      `}</style>

      {/* Dark header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'linear-gradient(160deg, #000A33 0%, #001A66 55%, #0044CC 100%)',
        padding: '10px 16px 22px 16px',
        borderRadius: '0 0 26px 26px',
        boxShadow: '0 8px 24px rgba(0,8,60,.25)',
        marginBottom: 16,
      }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '0 0 26px 26px', background: 'linear-gradient(135deg, rgba(255,255,255,.08) 0%, transparent 45%)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, position: 'relative', zIndex: 2 }}>
          <button
            type="button"
            onClick={onBack}
            className="cmd-press"
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              color: '#6FB0FF', fontSize: 14, fontWeight: 600,
              letterSpacing: '-0.2px', padding: '6px 4px 6px 0',
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            All students
          </button>
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' }}>Mastery</div>
          <div style={{ width: 70 }} />
        </div>
        <div style={{ position: 'relative', zIndex: 2, padding: '4px 2px 0' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 10 }}>
            Concept Mastery Analysis
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{
              width: 54, height: 54, borderRadius: 16,
              background: avColor, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700, letterSpacing: '0.5px', flexShrink: 0,
              boxShadow: `0 1px 2px ${avColor}4D, 0 8px 16px ${avColor}55, inset 0 1px 0 rgba(255,255,255,.25)`,
            }}>{student.initials || initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.8px', lineHeight: 1.1 }}>{student.name}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.6)', letterSpacing: '-0.1px', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                {className && <span style={{ background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.2)', padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '-0.1px' }}>{className}</span>}
                {student.rollNo && <><span>·</span><span>Roll {student.rollNo}</span></>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onViewProfile}
              className="cmd-press"
              style={{
                flex: 1, height: 38, borderRadius: 11,
                background: 'rgba(255,255,255,.12)', color: '#fff',
                border: '0.5px solid rgba(255,255,255,.2)',
                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '-0.2px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: 'inherit',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              View Profile
            </button>
            <button
              type="button"
              onClick={onContactParent}
              className="cmd-press"
              style={{
                flex: 1, height: 38, borderRadius: 11,
                background: '#0055FF', color: '#fff',
                border: 'none',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '-0.2px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: 'inherit',
                boxShadow: '0 1px 2px rgba(9,87,247,.25), 0 6px 14px rgba(9,87,247,.35)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/>
              </svg>
              Contact Parent
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="cmd-enter" style={{ padding: '0 16px', display: 'flex', flexDirection: 'column' }}>

        {/* 3 Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[
            { key: 'm', count: mastered.length, label: 'Mastered', color: '#00C853', bg: 'linear-gradient(160deg, rgba(0,232,102,.14), rgba(0,200,83,.06))', border: 'rgba(0,200,83,.25)',
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
            { key: 'd', count: developing.length, label: 'Developing', color: '#FF8800', bg: 'linear-gradient(160deg, rgba(255,170,0,.14), rgba(255,136,0,.06))', border: 'rgba(255,136,0,.25)',
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
            { key: 'w', count: weak.length, label: 'Weak', color: '#FF3355', bg: 'linear-gradient(160deg, rgba(255,51,85,.12), rgba(255,51,85,.04))', border: 'rgba(255,51,85,.22)',
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 21h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg> },
          ].map(s => (
            <div key={s.key} className="cmd-press" style={{
              borderRadius: 18, padding: '16px 10px', textAlign: 'center', position: 'relative', overflow: 'hidden',
              background: s.bg, border: `0.5px solid ${s.border}`,
            }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', color: '#fff', background: s.color }}>
                {s.icon}
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-1.2px', lineHeight: 1, color: s.color }}>{s.count}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Buckets */}
        {(['mastered', 'developing', 'weak'] as const).map(tone => {
          const items = tone === 'mastered' ? mastered : tone === 'developing' ? developing : weak;
          const color = tone === 'mastered' ? '#00C853' : tone === 'developing' ? '#FF8800' : '#FF3355';
          const headBg = tone === 'mastered'
            ? 'linear-gradient(90deg, rgba(0,232,102,.12), rgba(0,200,83,.04))'
            : tone === 'developing'
            ? 'linear-gradient(90deg, rgba(255,170,0,.12), rgba(255,136,0,.04))'
            : 'linear-gradient(90deg, rgba(255,51,85,.1), rgba(255,51,85,.02))';
          const fillGrad = tone === 'mastered'
            ? 'linear-gradient(90deg, #00E866, #00C853)'
            : tone === 'developing'
            ? 'linear-gradient(90deg, #FFAA00, #FF8800)'
            : 'linear-gradient(90deg, #FF5577, #FF3355)';
          const title = tone === 'mastered' ? 'Mastered' : tone === 'developing' ? 'Developing' : 'Weak';
          const emptyEmoji = tone === 'mastered' ? '📚' : tone === 'developing' ? '🌱' : '✨';
          const emptyText = tone === 'mastered' ? 'No mastered concepts yet.' : tone === 'developing' ? 'No developing concepts.' : 'No weak areas. Great work!';

          return (
            <div key={tone} className="cmd-card3d" style={{
              background: '#fff', borderRadius: 20, overflow: 'hidden', marginBottom: 12,
              boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
            }}>
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 9, background: headBg }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px' }}>{title}</div>
                <div style={{ background: '#fff', padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700, letterSpacing: '-0.1px', boxShadow: '0 1px 2px rgba(0,0,0,.04)', color }}>
                  {items.length}
                </div>
              </div>
              <div style={{ padding: '12px 14px 14px' }}>
                {items.length === 0 ? (
                  <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#99AACC', letterSpacing: '-0.1px' }}>
                    <span style={{ display: 'block', fontSize: 22, marginBottom: 6 }}>{emptyEmoji}</span>
                    {emptyText}
                  </div>
                ) : items.map((c, i) => (
                  <div key={c.title} style={{ background: '#F4F7FE', borderRadius: 12, padding: '11px 12px', display: 'flex', alignItems: 'center', gap: 11, marginTop: i > 0 ? 8 : 0 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#001040', letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{formatTitle(c.title)}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.3px', color, flexShrink: 0 }}>{c.score}%</div>
                      </div>
                      <div style={{ height: 6, background: '#EAF0FB', borderRadius: 100, overflow: 'hidden' }}>
                        <div className="cmd-fill" style={{ height: '100%', borderRadius: 100, background: fillGrad, width: `${Math.max(0, Math.min(100, c.score))}%` }} />
                      </div>
                      {tone === 'weak' && (
                        <button
                          type="button"
                          onClick={() => onRemedial(c.title)}
                          disabled={isGenerating && selectedRemedial === c.title}
                          className="cmd-press"
                          style={{
                            marginTop: 10, width: '100%', padding: '7px 0',
                            background: isGenerating && selectedRemedial === c.title ? 'rgba(255,51,85,.6)' : '#FF3355',
                            color: '#fff', border: 'none', borderRadius: 10,
                            fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'inherit',
                            boxShadow: '0 1px 2px rgba(255,51,85,.2), 0 3px 8px rgba(255,51,85,.25)',
                          }}
                        >
                          {isGenerating && selectedRemedial === c.title ? (
                            <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> Generating...</>
                          ) : (
                            <><Sparkles style={{ width: 13, height: 13 }} /> Assign Remedial</>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* AI Remedial output (mobile) */}
        {aiData && selectedRemedial && (
          <div className="cmd-card3d" style={{
            background: '#fff',
            border: '0.5px solid rgba(0,85,255,0.07)',
            borderRadius: 20, padding: 18, marginBottom: 12,
            boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 4 }}>AI Remedial Plan</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#001040', marginBottom: 14, letterSpacing: '-0.3px' }}>{formatTitle(selectedRemedial)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {aiData.learning_gap && (
                <div style={{ background: '#eef2ff', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '1.4px', marginBottom: 4 }}>Learning Gap</div>
                  <div style={{ fontSize: 13, color: '#312e81', lineHeight: 1.5 }}>{aiData.learning_gap}</div>
                </div>
              )}
              {aiData.prerequisite_chain && (
                <div style={{ background: '#fff1f2', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#FF3355', textTransform: 'uppercase', letterSpacing: '1.4px', marginBottom: 4 }}>Root Cause</div>
                  <div style={{ fontSize: 13, color: '#9f1239', lineHeight: 1.5 }}>{aiData.prerequisite_chain}</div>
                </div>
              )}
              {aiData.remedial_plan && (
                <div style={{ background: '#f0fdf4', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#00C853', textTransform: 'uppercase', letterSpacing: '1.4px', marginBottom: 8 }}>Remedial Steps</div>
                  <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(aiData.remedial_plan as string[]).map((step, i) => (
                      <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#14532d', lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 700, color: '#00C853', flexShrink: 0 }}>{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recommended Actions */}
        <div className="cmd-card3d" style={{
          background: '#fff', borderRadius: 20, padding: 16, marginBottom: 12,
          boxShadow: '0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 34, height: 34, borderRadius: 11, background: '#0055FF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px' }}>Recommended Actions</div>
              <div style={{ fontSize: 11, color: '#5070B0', fontWeight: 600, marginTop: 1, letterSpacing: '-0.1px' }}>Suggested next steps</div>
            </div>
          </div>
          {recommendedActions.map((action, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 0', position: 'relative', borderTop: i > 0 ? '0.5px solid rgba(9,87,247,.07)' : 'none' }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(9,87,247,.1)', color: '#0055FF', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {i + 1}
              </div>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#001040', letterSpacing: '-0.15px', lineHeight: 1.5, paddingTop: 3 }}>{action}</div>
            </div>
          ))}
        </div>

        {/* Risk / On Track banner */}
        {hasRisk ? (
          <div className="cmd-card3d" style={{
            background: 'linear-gradient(140deg, #FF3355 0%, #C92A2A 100%)',
            borderRadius: 22, padding: 18, position: 'relative', overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(255,51,85,.2), 0 10px 26px rgba(255,51,85,.35)',
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.2) 0%, transparent 45%)', pointerEvents: 'none' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10, position: 'relative', zIndex: 2 }}>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,.24)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '0.5px solid rgba(255,255,255,.3)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.9)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>Status</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', marginTop: 2 }}>Intervention Required</div>
              </div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'rgba(255,255,255,.9)', fontWeight: 500, letterSpacing: '-0.1px', position: 'relative', zIndex: 2 }}>
              <strong style={{ color: '#fff', fontWeight: 700 }}>{student.name}</strong> has {weak.length} weak area{weak.length > 1 ? 's' : ''} that need{weak.length === 1 ? 's' : ''} immediate support. Consider scheduling a parent meeting.
            </div>
          </div>
        ) : (
          <div className="cmd-card3d" style={{
            background: 'linear-gradient(140deg, #00C853 0%, #00E866 100%)',
            borderRadius: 22, padding: 18, position: 'relative', overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(0,200,83,.2), 0 10px 26px rgba(0,200,83,.35)',
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,.2) 0%, transparent 45%)', pointerEvents: 'none' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10, position: 'relative', zIndex: 2 }}>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,.24)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '0.5px solid rgba(255,255,255,.3)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.9)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>Status</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', marginTop: 2 }}>On Track ✨</div>
              </div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'rgba(255,255,255,.9)', fontWeight: 500, letterSpacing: '-0.1px', position: 'relative', zIndex: 2 }}>
              <strong style={{ color: '#fff', fontWeight: 700 }}>{student.name}</strong> is performing well across all assessed concepts. Keep up the great work!
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default ConceptMasteryDetail;