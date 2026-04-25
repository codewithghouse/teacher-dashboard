import { functions } from "../../lib/firebase";
import { httpsCallable } from "firebase/functions";

const NO_DATA_MSG = "AI insights will activate automatically once relevant academic and schedule data is available.";
const ERROR_MSG = "AI service is temporarily unavailable. Displaying standard data.";

type AIPayload = Record<string, unknown>;
type AIResult =
  | { status: "success"; data: unknown }
  | { status: "no_data"; message: string }
  | { status: "error"; message: string }
  | { status: "not_implemented"; message: string };

const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Shared caller for all AI insight types — consolidates error handling and
// response shape checks so each public method is a one-liner.
async function callAIInsights(
  type: string,
  payload: AIPayload,
  options?: { timeoutMs?: number; logPrefix?: string },
): Promise<AIResult> {
  const { timeoutMs, logPrefix = type } = options ?? {};
  try {
    const call = httpsCallable(
      functions,
      "getTeacherAIInsights",
      timeoutMs ? { timeout: timeoutMs } : undefined,
    );
    const result = await call({ type, payload }) as { data?: { status?: string; data?: unknown; message?: string } };
    if (!result?.data) return { status: "error", message: "No response from AI service." };
    if (result.data.status === "error") {
      return { status: "error", message: result.data.message || ERROR_MSG };
    }
    if (!result.data.data) {
      return { status: "error", message: "AI returned an empty response. Please try again." };
    }
    return { status: "success", data: result.data.data };
  } catch (error: unknown) {
    console.error(`[AIController:${logPrefix}]`, error);
    return { status: "error", message: `AI Error: ${errMessage(error)}` };
  }
}

const hasData = (data: unknown): data is AIPayload =>
  !!data && typeof data === "object" && Object.keys(data as object).length > 0;

const notImplemented = (name: string): AIResult => ({
  status: "not_implemented",
  message: `${name} is not yet wired to the AI backend.`,
});

export const AIController = {

  // 1. DASHBOARD INSIGHTS
  async getDashboardInsights(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    return callAIInsights("dashboard_insights", data, { logPrefix: "Dashboard" });
  },

  // 2. CLASS INSIGHTS
  async getClassInsights(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    return callAIInsights("class_insights", data, { logPrefix: "Class" });
  },

  // 3. ASSIGNMENT CREATION INSIGHTS
  async getAssignmentCreation(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    return callAIInsights("assignment_creation", data, { logPrefix: "AssignmentCreation" });
  },

  // 4. ASSIGNMENT GRADING INSIGHTS
  async getAssignmentGrading(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    return callAIInsights("assignment_grading", data, { logPrefix: "Grading" });
  },

  // Stubs — these previously returned { status: "success", data: {} } which
  // silently looked like success. Return `not_implemented` so callers can
  // render an honest "coming soon" state instead of an empty success view.
  async getTestCreation(_data: unknown): Promise<AIResult> { return notImplemented("getTestCreation"); },
  async getResultAnalysis(_data: unknown): Promise<AIResult> { return notImplemented("getResultAnalysis"); },
  async getConceptRemedial(_data: unknown): Promise<AIResult> { return notImplemented("getConceptRemedial"); },
  async getClassGaps(_data: unknown): Promise<AIResult> { return notImplemented("getClassGaps"); },
  async getRosterSummaries(_data: unknown): Promise<AIResult> { return notImplemented("getRosterSummaries"); },
  async getStudentAnalytics(_data: unknown): Promise<AIResult> { return notImplemented("getStudentAnalytics"); },
  async getParentNoteGeneration(_data: unknown): Promise<AIResult> { return notImplemented("getParentNoteGeneration"); },
  async getClassReportCards(_data: unknown): Promise<AIResult> { return notImplemented("getClassReportCards"); },

  // LEADERBOARD: Class action plan (Hinglish diagnosis + 4-5 actions)
  async getClassActionPlan(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    return callAIInsights("class_action_plan", data, { logPrefix: "ClassActionPlan", timeoutMs: 60_000 });
  },

  // LEADERBOARD: Per-student intervention plan
  async getStudentActionPlan(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    return callAIInsights("student_action_plan", data, { logPrefix: "StudentActionPlan", timeoutMs: 60_000 });
  },

  // LEADERBOARD: Teacher self-improvement plan
  async getTeacherSelfActionPlan(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    return callAIInsights("teacher_self_action_plan", data, { logPrefix: "TeacherSelfActionPlan", timeoutMs: 60_000 });
  },

  async getDetailedSubjectReport(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    return callAIInsights("class_performance_report", data, { logPrefix: "ClassReport" });
  },

  async getIndividualProgressReport(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    return callAIInsights("individual_progress_report", data, { logPrefix: "IndividualReport" });
  },

  // LESSON SUMMARIZER
  async getSummary(data: { text: string; fileName: string }): Promise<AIResult> {
    if (!data?.text?.trim()) return { status: "no_data", message: NO_DATA_MSG };
    if (import.meta.env.DEV) console.debug("[Summary] request dispatched");
    return callAIInsights("lesson_summary", data as unknown as AIPayload, {
      timeoutMs: 120_000,
      logPrefix: "Summary",
    });
  },

  // LESSON PLAN GENERATOR
  async getLessonPlan(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    if (import.meta.env.DEV) console.debug("[LessonPlan] request dispatched");
    return callAIInsights("lesson_plan_generation", data, {
      timeoutMs: 120_000,
      logPrefix: "LessonPlan",
    });
  },

  // EXAM PAPER GENERATOR — server-side only, never browser→OpenAI direct.
  // The earlier bypass that read VITE_OPENAI_API_KEY was removed because the
  // value gets baked into the production bundle by Vite, exposing the key to
  // anyone who opens devtools.
  async getExamPaper(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    if (import.meta.env.DEV) console.debug("[ExamPaper] dispatching to Cloud Function");
    return callAIInsights("exam_paper_generation", data, {
      timeoutMs: 180_000,
      logPrefix: "ExamPaper",
    });
  },
};

