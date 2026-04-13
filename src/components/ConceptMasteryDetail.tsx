import { useState } from "react";
import { ChevronLeft, Loader2, Sparkles } from "lucide-react";
import { AIController } from "../ai/controller/ai-controller";

interface ConceptMasteryDetailProps {
  student: any;
  concepts: string[];
  scores: number[];
  className?: string;
  onBack: () => void;
}

const ConceptMasteryDetail = ({ student, concepts, scores, className, onBack }: ConceptMasteryDetailProps) => {
  const [selectedRemedial, setSelectedRemedial] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiData, setAiData] = useState<any>(null);

  const mappedConcepts = concepts.map((c, i) => {
    const score = scores[i] ?? 0;
    const desc =
      score >= 80 ? "Strong understanding of this topic." :
      score >= 50 ? "Needs more practice to solidify." :
      score > 0   ? "Major gap — needs intensive support." :
                    "Not yet assessed.";
    return { title: c, score, desc };
  }).filter(c => c.score > 0);

  const mastered   = mappedConcepts.filter(c => c.score >= 80);
  const developing = mappedConcepts.filter(c => c.score >= 50 && c.score < 80);
  const weak       = mappedConcepts.filter(c => c.score < 50);

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

  const formatTitle = (h: string) =>
    h.charAt(0).toUpperCase() + h.slice(1).toLowerCase().replace(/_/g, " ");

  const recommendedActions = [
    weak[0]
      ? `Schedule 1-on-1 tutoring sessions for ${formatTitle(weak[0].title)}`
      : "Review all completed topics with student",
    weak[1]
      ? `Assign additional practice worksheets for ${formatTitle(weak[1].title)} basics`
      : "Encourage consistent daily practice",
    "Contact parents to discuss home support strategies",
  ];

  return (
    <div className="animate-in fade-in duration-500 pb-10">

      {/* Header */}
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-4">
        Result of click: "Student Concept Detail"
      </p>

      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-slate-500" />
          </button>
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-bold flex-shrink-0 ${student.color || "bg-[#1e3272]"}`}
          >
            {student.initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{student.name}</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {className ? `${className} • ` : ""}Concept Mastery Analysis
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="px-4 py-2 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
            View Profile
          </button>
          <button className="px-4 py-2 text-sm font-semibold bg-[#1e3272] text-white rounded-xl hover:bg-[#1e3272]/90 transition-colors">
            Contact Parent
          </button>
        </div>
      </div>

      {/* Three Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">

        {/* Mastered */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <span className="w-5 h-5 rounded bg-emerald-500 flex-shrink-0 inline-block" />
            <h2 className="text-base font-bold text-slate-800">Mastered</h2>
          </div>
          <div className="space-y-3">
            {mastered.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-6">No mastered concepts yet.</p>
            )}
            {mastered.map((c, i) => (
              <div key={i} className="bg-emerald-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-slate-800">{formatTitle(c.title)}</span>
                  <span className="text-sm font-bold text-emerald-600">{c.score}%</span>
                </div>
                <div className="h-2 bg-emerald-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${c.score}%` }} />
                </div>
                <p className="text-xs text-slate-400">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Developing */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <span className="w-5 h-5 rounded bg-amber-400 flex-shrink-0 inline-block" />
            <h2 className="text-base font-bold text-slate-800">Developing</h2>
          </div>
          <div className="space-y-3">
            {developing.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-6">No developing concepts.</p>
            )}
            {developing.map((c, i) => (
              <div key={i} className="bg-amber-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-slate-800">{formatTitle(c.title)}</span>
                  <span className="text-sm font-bold text-amber-500">{c.score}%</span>
                </div>
                <div className="h-2 bg-amber-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-amber-400 rounded-full" style={{ width: `${c.score}%` }} />
                </div>
                <p className="text-xs text-slate-400">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Weak Areas */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <span className="w-5 h-5 rounded bg-rose-500 flex-shrink-0 inline-block" />
            <h2 className="text-base font-bold text-slate-800">Weak Areas</h2>
          </div>
          <div className="space-y-3">
            {weak.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-6">No weak areas detected. Great job!</p>
            )}
            {weak.map((c, i) => (
              <div key={i} className="bg-rose-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-slate-800">{formatTitle(c.title)}</span>
                  <span className="text-sm font-bold text-rose-600">{c.score}%</span>
                </div>
                <div className="h-2 bg-rose-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-rose-500 rounded-full" style={{ width: `${c.score}%` }} />
                </div>
                <p className="text-xs text-slate-400 mb-3">{c.desc}</p>
                <button
                  onClick={() => handleRemedial(c.title)}
                  disabled={isGenerating && selectedRemedial === c.title}
                  className="w-full py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {isGenerating && selectedRemedial === c.title
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
                    : <><Sparkles className="w-3 h-3" /> Assign Remedial</>
                  }
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Remedial Output */}
      {aiData && selectedRemedial && (
        <div className="bg-white border border-indigo-100 rounded-2xl shadow-sm p-6 mb-6 animate-in slide-in-from-bottom-4 duration-500">
          <h3 className="text-sm font-bold text-slate-800 mb-1">
            Remedial Plan: {formatTitle(selectedRemedial)}
          </h3>
          <p className="text-xs text-slate-400 mb-4">AI-generated support plan</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {aiData.learning_gap && (
              <div className="bg-indigo-50 rounded-xl p-4">
                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Learning Gap</p>
                <p className="text-sm text-indigo-900">{aiData.learning_gap}</p>
              </div>
            )}
            {aiData.prerequisite_chain && (
              <div className="bg-rose-50 rounded-xl p-4">
                <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1">Root Cause</p>
                <p className="text-sm text-rose-900">{aiData.prerequisite_chain}</p>
              </div>
            )}
            {aiData.remedial_plan && (
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-2">Remedial Steps</p>
                <ol className="space-y-1">
                  {aiData.remedial_plan.map((step: string, i: number) => (
                    <li key={i} className="text-xs text-slate-700 flex gap-2">
                      <span className="font-bold text-emerald-500 flex-shrink-0">{i + 1}.</span>
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
      <div className="border border-blue-100 bg-blue-50/40 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-slate-800 mb-4">Recommended Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {recommendedActions.map((action, i) => (
            <p key={i} className="text-sm text-slate-600">{action}</p>
          ))}
        </div>
      </div>

    </div>
  );
};

export default ConceptMasteryDetail;
