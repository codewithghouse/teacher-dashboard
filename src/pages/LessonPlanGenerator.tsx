import { useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { AIController } from "../ai/controller/ai-controller";
import { db } from "../lib/firebase";
import { collection, addDoc, serverTimestamp, query, where, onSnapshot } from "firebase/firestore";
import { useEffect } from "react";
import {
  Sparkles, BookOpen, Clock, Layers, Target, ChevronDown, ChevronRight,
  ClipboardList, Users, Brain, Lightbulb, Home, RotateCcw, Save,
  CheckCircle2, AlertCircle, Loader2, History, Layout, ListChecks,
  BookMarked, Pencil
} from "lucide-react";

const BOARDS = ["CBSE", "ICSE", "State Board", "IB", "Cambridge (IGCSE)", "Other"];
const GRADES = [
  "Class 1", "Class 2", "Class 3", "Class 4", "Class 5",
  "Class 6", "Class 7", "Class 8", "Class 9", "Class 10",
  "Class 11", "Class 12"
];
const DURATIONS = ["30 minutes", "40 minutes", "45 minutes", "60 minutes", "75 minutes", "90 minutes"];
const LESSON_COUNTS = [1, 2, 3, 4, 5];

const SECTION_COLORS: Record<string, string> = {
  "Introduction / Hook": "bg-amber-50 border-amber-200 text-amber-700",
  "Direct Instruction": "bg-blue-50 border-blue-200 text-blue-700",
  "Guided Practice": "bg-violet-50 border-violet-200 text-violet-700",
  "Independent Practice": "bg-emerald-50 border-emerald-200 text-emerald-700",
  "Closure / Summary": "bg-rose-50 border-rose-200 text-rose-700",
};

const getSectionColor = (name: string) => {
  for (const key of Object.keys(SECTION_COLORS)) {
    if (name.toLowerCase().includes(key.toLowerCase().split(" / ")[0].toLowerCase())) {
      return SECTION_COLORS[key];
    }
  }
  return "bg-slate-50 border-slate-200 text-slate-700";
};

interface FormData {
  subject: string;
  grade: string;
  topic: string;
  duration_per_lesson: string;
  num_lessons: number;
  board: string;
  learning_goals: string;
  special_considerations: string;
}

const defaultForm: FormData = {
  subject: "",
  grade: "Class 8",
  topic: "",
  duration_per_lesson: "45 minutes",
  num_lessons: 1,
  board: "CBSE",
  learning_goals: "",
  special_considerations: "",
};

const LessonPlanGenerator = () => {
  const { teacherData } = useAuth();
  const [form, setForm] = useState<FormData>({
    ...defaultForm,
    subject: teacherData?.subject || "",
  });
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [expandedLesson, setExpandedLesson] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<"generate" | "history">("generate");

  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(
      collection(db, "lessonPlans"),
      where("teacherId", "==", teacherData.id)
    );
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() as any }));
      docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setHistory(docs);
    });
    return () => unsub();
  }, [teacherData?.id]);

  const handleGenerate = async () => {
    if (!form.subject.trim() || !form.topic.trim()) {
      setError("Subject aur Topic required hain.");
      return;
    }
    setLoading(true);
    setError(null);
    setPlan(null);
    setSaved(false);

    try {
      const result = await AIController.getLessonPlan({
        ...form,
        teacher_name: teacherData?.name || "",
        school_name: teacherData?.schoolName || "",
      });

      console.log("[LessonPlan] Controller result:", result);

      if (result.status === "success" && result.data) {
        setPlan(result.data);
        setExpandedLesson(0);
      } else {
        setError(result.message || "AI could not generate the plan. Please try again.");
      }
    } catch (err: any) {
      console.error("[LessonPlan] Unexpected error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!plan || !teacherData?.id) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "lessonPlans"), {
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        schoolName: teacherData.schoolName || "",
        teacherName: teacherData.name || "",
        subject: form.subject,
        grade: form.grade,
        topic: form.topic,
        board: form.board,
        plan,
        createdAt: serverTimestamp(),
      });
      setSaved(true);
    } catch (e) {
      console.error("Save error:", e);
    }
    setSaving(false);
  };

  const handleReset = () => {
    setPlan(null);
    setError(null);
    setSaved(false);
    setForm({ ...defaultForm, subject: teacherData?.subject || "" });
  };

  const loadFromHistory = (h: any) => {
    setPlan(h.plan);
    setForm({
      subject: h.subject || "",
      grade: h.grade || "Class 8",
      topic: h.topic || "",
      duration_per_lesson: h.plan?.lessons?.[0]?.duration || "45 minutes",
      num_lessons: h.plan?.lessons?.length || 1,
      board: h.board || "CBSE",
      learning_goals: "",
      special_considerations: "",
    });
    setSaved(true);
    setExpandedLesson(0);
    setActiveTab("generate");
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 pb-16 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-4 mb-8">
        <div>          <h1 className="ds-page-title flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-[#1e3272] flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </span>
            AI Lesson Planner
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest leading-none">
            Generate classroom-ready lesson plans in seconds.
          </p>
        </div>
        <div className="flex items-center gap-2 ds-card px-4 sm:px-6 py-3 sm:py-4 self-start">
          <Layout className="w-4 h-4 sm:w-5 sm:h-5 text-[#1e3272]" />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-600 italic truncate max-w-[160px]">
            {teacherData?.schoolName || "EduIntellect"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8">
        {[
          { key: "generate", label: "Generate Plan", icon: Sparkles },
          { key: "history", label: `History (${history.length})`, icon: History },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
              activeTab === tab.key
                ? "bg-[#1e3272] text-white shadow-lg shadow-blue-900/20"
                : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {history.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-[2.5rem] p-16 flex flex-col items-center justify-center text-center shadow-sm">
              <BookMarked className="w-12 h-12 text-slate-200 mb-4" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No saved lesson plans yet</p>
              <p className="text-xs text-slate-300 mt-1">Generate and save your first plan to see it here.</p>
            </div>
          ) : (
            history.map((h) => (
              <div
                key={h.id}
                className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all group cursor-pointer flex items-center justify-between gap-4"
                onClick={() => loadFromHistory(h)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#1e3272]/10 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-6 h-6 text-[#1e3272]" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{h.plan?.plan_title || h.topic}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                      {h.subject} • {h.grade} • {h.board} • {h.plan?.lessons?.length || 1} lesson(s)
                    </p>
                    <p className="text-[10px] text-slate-300 mt-0.5">
                      {h.createdAt?.toDate?.().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-[#1e3272] transition-colors flex-shrink-0" />
              </div>
            ))
          )}
        </div>
      )}

      {/* GENERATE TAB */}
      {activeTab === "generate" && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
          {/* LEFT: Form */}
          <div className="xl:col-span-2">
            <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm sticky top-6">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <Pencil className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Plan Details</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fill in to generate</p>
                </div>
              </div>

              <div className="space-y-5">
                {/* Subject */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                    Subject *
                  </label>
                  <input
                    type="text"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    placeholder="e.g. Mathematics, Science, English"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1e3272]/30 focus:border-[#1e3272] transition-all"
                  />
                </div>

                {/* Topic */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                    Topic / Chapter *
                  </label>
                  <input
                    type="text"
                    value={form.topic}
                    onChange={(e) => setForm({ ...form, topic: e.target.value })}
                    placeholder="e.g. Fractions, Photosynthesis, The Mughal Empire"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1e3272]/30 focus:border-[#1e3272] transition-all"
                  />
                </div>

                {/* Grade + Board row */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                      Grade
                    </label>
                    <select
                      value={form.grade}
                      onChange={(e) => setForm({ ...form, grade: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3272]/30 focus:border-[#1e3272] transition-all bg-white"
                    >
                      {GRADES.map((g) => <option key={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                      Board
                    </label>
                    <select
                      value={form.board}
                      onChange={(e) => setForm({ ...form, board: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3272]/30 focus:border-[#1e3272] transition-all bg-white"
                    >
                      {BOARDS.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                </div>

                {/* Duration + Lessons row */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                      Duration / Lesson
                    </label>
                    <select
                      value={form.duration_per_lesson}
                      onChange={(e) => setForm({ ...form, duration_per_lesson: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3272]/30 focus:border-[#1e3272] transition-all bg-white"
                    >
                      {DURATIONS.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                      No. of Lessons
                    </label>
                    <select
                      value={form.num_lessons}
                      onChange={(e) => setForm({ ...form, num_lessons: Number(e.target.value) })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3272]/30 focus:border-[#1e3272] transition-all bg-white"
                    >
                      {LESSON_COUNTS.map((n) => <option key={n}>{n}</option>)}
                    </select>
                  </div>
                </div>

                {/* Learning Goals */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                    Learning Goals <span className="normal-case font-medium text-slate-300">(optional)</span>
                  </label>
                  <textarea
                    value={form.learning_goals}
                    onChange={(e) => setForm({ ...form, learning_goals: e.target.value })}
                    placeholder="What should students know or be able to do after this lesson?"
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1e3272]/30 focus:border-[#1e3272] transition-all resize-none"
                  />
                </div>

                {/* Special Considerations */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                    Special Considerations <span className="normal-case font-medium text-slate-300">(optional)</span>
                  </label>
                  <textarea
                    value={form.special_considerations}
                    onChange={(e) => setForm({ ...form, special_considerations: e.target.value })}
                    placeholder="e.g. Mixed ability class, students struggled with algebra, no projector available..."
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1e3272]/30 focus:border-[#1e3272] transition-all resize-none"
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-100 rounded-2xl">
                    <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs font-semibold text-rose-600">{error}</p>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleGenerate}
                    disabled={loading}
                    className="ds-btn-primary ds-btn-lg flex-1 justify-center"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Generate Plan
                      </>
                    )}
                  </button>
                  {plan && (
                    <button
                      onClick={handleReset}
                      className="w-12 h-12 flex items-center justify-center rounded-2xl border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all flex-shrink-0"
                      title="Reset"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Generated Plan */}
          <div className="xl:col-span-3">
            {/* Empty state */}
            {!plan && !loading && (
              <div className="bg-white border-2 border-dashed border-slate-100 rounded-[2.5rem] p-16 flex flex-col items-center justify-center text-center h-full min-h-[400px]">
                <div className="w-20 h-20 rounded-3xl bg-slate-50 flex items-center justify-center mb-6">
                  <Sparkles className="w-10 h-10 text-slate-200" />
                </div>
                <p className="text-lg font-bold text-slate-300 tracking-tight">Your lesson plan will appear here</p>
                <p className="text-[11px] font-bold text-slate-200 uppercase tracking-widest mt-2">Fill the form and click Generate Plan</p>
              </div>
            )}

            {/* Loading skeleton */}
            {loading && (
              <div className="bg-white border border-slate-100 rounded-[2.5rem] p-10 shadow-sm space-y-6 min-h-[400px] flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-[#1e3272]/10 flex items-center justify-center animate-pulse">
                  <Brain className="w-8 h-8 text-[#1e3272]" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-sm font-bold text-slate-700">AI is crafting your lesson plan...</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">This may take 10-20 seconds</p>
                </div>
                <div className="w-full max-w-sm space-y-3">
                  {[80, 60, 90, 50].map((w, i) => (
                    <div key={i} className={`h-3 bg-slate-100 rounded-full animate-pulse`} style={{ width: `${w}%` }} />
                  ))}
                </div>
              </div>
            )}

            {/* Generated Plan */}
            {plan && !loading && (
              <div className="space-y-6">
                {/* Plan Header Card */}
                <div className="bg-[#1e3272] rounded-[2.5rem] p-8 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
                  <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="px-3 py-1 bg-white/10 rounded-full text-[9px] font-bold uppercase tracking-widest">{plan.board}</span>
                      <span className="px-3 py-1 bg-white/10 rounded-full text-[9px] font-bold uppercase tracking-widest">{plan.grade}</span>
                      <span className="px-3 py-1 bg-white/10 rounded-full text-[9px] font-bold uppercase tracking-widest">{plan.total_duration}</span>
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight leading-tight mb-3">{plan.plan_title}</h2>
                    <p className="text-sm font-medium text-blue-200 leading-relaxed">{plan.overview}</p>

                    <div className="flex items-center gap-4 mt-6 pt-6 border-t border-white/10">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-blue-300" />
                        <span className="text-xs font-bold text-blue-200 uppercase tracking-widest">{plan.subject}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-blue-300" />
                        <span className="text-xs font-bold text-blue-200 uppercase tracking-widest">{plan.lessons?.length} Lesson(s)</span>
                      </div>
                      {/* Save Button */}
                      <div className="ml-auto">
                        {saved ? (
                          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500 rounded-xl text-white text-[10px] font-bold uppercase tracking-widest">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Saved
                          </div>
                        ) : (
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-white text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-60"
                          >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {saving ? "Saving..." : "Save Plan"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Learning Objectives + Materials row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                        <Target className="w-4 h-4 text-blue-600" />
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Learning Objectives</p>
                    </div>
                    <ul className="space-y-2">
                      {plan.learning_objectives?.map((obj: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700 font-medium leading-snug">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                          {obj}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
                        <ClipboardList className="w-4 h-4 text-amber-600" />
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Materials Needed</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {plan.materials_needed?.map((m: string, i: number) => (
                        <span key={i} className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                          {m}
                        </span>
                      ))}
                    </div>
                    {plan.prior_knowledge && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Prior Knowledge Required</p>
                        <p className="text-xs font-semibold text-slate-600">{plan.prior_knowledge}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Lessons */}
                <div className="space-y-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Lesson Breakdown</p>
                  {plan.lessons?.map((lesson: any, li: number) => (
                    <div key={li} className="bg-white border border-slate-100 rounded-[2rem] shadow-sm overflow-hidden">
                      {/* Lesson Header */}
                      <button
                        className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50/50 transition-colors"
                        onClick={() => setExpandedLesson(expandedLesson === li ? -1 : li)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-[#1e3272] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                            {lesson.lesson_number}
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-bold text-slate-900">{lesson.title}</p>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                <Clock className="w-3 h-3" />{lesson.duration}
                              </span>
                              {lesson.learning_focus && (
                                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">{lesson.learning_focus}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {expandedLesson === li
                          ? <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />
                          : <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
                        }
                      </button>

                      {/* Lesson Sections */}
                      {expandedLesson === li && (
                        <div className="px-6 pb-6 space-y-3">
                          {lesson.sections?.map((section: any, si: number) => (
                            <div
                              key={si}
                              className={`p-4 rounded-2xl border ${getSectionColor(section.name)}`}
                            >
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-[10px] font-bold uppercase tracking-widest">{section.name}</p>
                                <span className="text-[10px] font-bold opacity-70 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />{section.duration}
                                </span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-1">Teacher Activity</p>
                                  <p className="text-xs font-semibold leading-relaxed opacity-90">{section.teacher_activity}</p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-1">Student Activity</p>
                                  <p className="text-xs font-semibold leading-relaxed opacity-90">{section.student_activity}</p>
                                </div>
                              </div>
                              {section.key_questions?.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-current/10">
                                  <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-1.5">Key Questions</p>
                                  <div className="space-y-1">
                                    {section.key_questions.map((q: string, qi: number) => (
                                      <p key={qi} className="text-[11px] font-semibold opacity-80 flex items-start gap-1.5">
                                        <span className="flex-shrink-0">›</span>{q}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Bottom cards: Assessment, Differentiation, Homework */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Assessment */}
                  <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <ListChecks className="w-4 h-4 text-emerald-600" />
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Assessment Strategies</p>
                    </div>
                    <ul className="space-y-2">
                      {plan.assessment_strategies?.map((a: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-xs font-semibold text-slate-700 leading-snug">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 mt-1.5" />
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Homework */}
                  <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center">
                        <Home className="w-4 h-4 text-violet-600" />
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Homework / Follow-up</p>
                    </div>
                    <p className="text-xs font-semibold text-slate-700 leading-relaxed">{plan.homework}</p>

                    {plan.cross_curricular_connections?.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Cross-Curricular Links</p>
                        <div className="flex flex-wrap gap-2">
                          {plan.cross_curricular_connections.map((c: string, i: number) => (
                            <span key={i} className="px-2.5 py-1 bg-violet-50 text-violet-700 border border-violet-100 rounded-lg text-[10px] font-bold">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Differentiation */}
                {plan.differentiation && (
                  <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-5">
                      <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center">
                        <Users className="w-4 h-4 text-rose-600" />
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Differentiation Strategies</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {[
                        { key: "for_struggling_students", label: "Struggling Students", color: "bg-rose-50 border-rose-100 text-rose-700" },
                        { key: "for_advanced_students", label: "Advanced Students", color: "bg-blue-50 border-blue-100 text-blue-700" },
                        { key: "for_ell_students", label: "ELL Students", color: "bg-amber-50 border-amber-100 text-amber-700" },
                      ].map(({ key, label, color }) => plan.differentiation[key] && (
                        <div key={key} className={`p-4 rounded-2xl border ${color}`}>
                          <p className="text-[9px] font-bold uppercase tracking-widest opacity-70 mb-2">{label}</p>
                          <p className="text-xs font-semibold leading-relaxed">{plan.differentiation[key]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Teacher Reflection */}
                {plan.teacher_reflection_prompts?.length > 0 && (
                  <div className="bg-gradient-to-br from-slate-900 to-[#1e3272] rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
                        <Lightbulb className="w-4 h-4 text-yellow-300" />
                      </div>
                      <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Teacher Reflection Prompts</p>
                    </div>
                    <div className="space-y-2">
                      {plan.teacher_reflection_prompts.map((p: string, i: number) => (
                        <p key={i} className="text-sm font-semibold text-white/80 flex items-start gap-2">
                          <span className="text-yellow-300 flex-shrink-0">{i + 1}.</span>{p}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LessonPlanGenerator;