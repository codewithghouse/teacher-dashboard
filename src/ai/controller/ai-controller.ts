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

const errCode = (error: unknown): string => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : "";
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Firebase Functions returns these when the container failed to start, was
// OOM-killed mid-request, or the underlying Cloud Run instance is briefly
// unreachable. They're transient — one retry with a small backoff resolves
// the vast majority of cases without billing a second OpenAI call (the call
// never reached OpenAI on the first attempt).
const TRANSIENT_CODES = new Set([
  "functions/unavailable",
  "functions/internal",
  "functions/deadline-exceeded",
  "unavailable",
  "internal",
  "deadline-exceeded",
]);

// Shared caller for all AI insight types — consolidates error handling and
// response shape checks so each public method is a one-liner.
async function callAIInsights(
  type: string,
  payload: AIPayload,
  options?: { timeoutMs?: number; logPrefix?: string },
): Promise<AIResult> {
  const { timeoutMs, logPrefix = type } = options ?? {};
  const call = httpsCallable(
    functions,
    "getTeacherAIInsights",
    timeoutMs ? { timeout: timeoutMs } : undefined,
  );

  let lastError: unknown = null;
  // Try once, then retry once on transient infra errors (503 unavailable etc.)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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
      lastError = error;
      const code = errCode(error);
      console.error(`[AIController:${logPrefix}] attempt ${attempt + 1} failed`, code, error);
      if (attempt === 0 && TRANSIENT_CODES.has(code)) {
        await sleep(1500);
        continue;
      }
      break;
    }
  }

  const code = errCode(lastError);
  // Friendlier message for the 503 / cold-start family — user-actionable.
  if (TRANSIENT_CODES.has(code)) {
    return {
      status: "error",
      message: "The AI service is warming up. Please try again in a few seconds.",
    };
  }
  if (code === "functions/unauthenticated" || code === "unauthenticated") {
    return { status: "error", message: "You are signed out. Please log in again." };
  }
  if (code === "functions/permission-denied" || code === "permission-denied") {
    return { status: "error", message: "Your account does not have permission to use this feature." };
  }
  return {
    status: "error",
    message: `AI Error${code ? ` (${code})` : ""}: ${errMessage(lastError)}`,
  };
}

const hasData = (data: unknown): data is AIPayload =>
  !!data && typeof data === "object" && Object.keys(data as object).length > 0;

export const AIController = {

  // ─────────────────────────────────────────────────────────────────────────
  // CLEANUP NOTE (2026-05-01):
  //   12 dead methods removed in this pass — verified zero callers across the
  //   entire repo (parent / teacher / principal / owner / functions / scripts):
  //     • getDashboardInsights, getClassInsights, getAssignmentCreation,
  //       getAssignmentGrading        — backend cloud function handlers exist
  //                                     but no UI ever called them. Backend
  //                                     handlers left in functions/src/index.ts
  //                                     for future use; client-side dispatch
  //                                     is gone.
  //     • getConceptRemedial          — moved to system module. See
  //                                     ai/system/concept-remedial.ts. The UI
  //                                     (ConceptMasteryDetail.tsx) now imports
  //                                     it directly.
  //     • getTestCreation, getResultAnalysis, getClassGaps, getRosterSummaries,
  //       getStudentAnalytics, getParentNoteGeneration, getClassReportCards
  //                                   — both client AND backend dead. Pure
  //                                     dead weight, removed cleanly.
  //   `notImplemented` helper kept for any future stub need.
  // ─────────────────────────────────────────────────────────────────────────

  // LEADERBOARD: Class action plan (English diagnosis + 4-5 actions)
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

  // PRE-RESULT PREDICTOR — heavy reasoning, gpt-4o backed, daily-cached.
  //   data.paperText      — extracted question paper text (PDF or pasted)
  //   data.syllabusText   — extracted syllabus PDF text (optional)
  //   data.subject, data.className, data.totalMarks, data.passPct
  //   data.students[]     — per-student history bundle (id, name, recentTests,
  //                         avgScore, attendancePct, behaviourRating, weakTopics)
  // Long timeout (3 min) — gpt-4o per-student reasoning over a full class.
  async getResultPrediction(data: {
    paperText: string;
    syllabusText?: string;
    /** Firebase Storage path to the syllabus PDF. The cloud function will
     *  download + extract text server-side (admin SDK = no CORS, no client
     *  bucket config needed). Use this OR `syllabusText`, not both. */
    syllabusPath?: string;
    subject?: string;
    className?: string;
    totalMarks?: number;
    passPct?: number;
    students: unknown[];
    /** Past tests of this class — topic coverage history + attached question
     *  papers (blueprintUrl). The cloud function reads recent blueprints
     *  server-side to topic-match the new paper against past assessments. */
    pastTests?: unknown[];
  }): Promise<AIResult> {
    if (!data?.paperText?.trim()) {
      return { status: "no_data", message: "Add the question paper text first." };
    }
    if (!data?.students?.length) {
      return { status: "no_data", message: "No students enrolled in this class." };
    }
    if (import.meta.env.DEV) console.debug("[ResultPredictor] dispatching", {
      students: data.students.length,
      paperChars: data.paperText.length,
      syllabusChars: data.syllabusText?.length || 0,
    });
    return callAIInsights("predict_exam_results", data as unknown as AIPayload, {
      timeoutMs: 180_000,
      logPrefix: "ResultPredictor",
    });
  },

  // PAPER CORRECTION — vision call over scanned student exam pages.
  //   data.images: data:image/jpeg;base64,... array (one per page)
  //   data.subject, data.grade, data.totalMarks, data.studentName, data.answerKey, data.notes
  // Long timeout (4 min) because vision passes over multi-page papers can be slow.
  async getPaperCorrection(data: {
    images: string[];
    subject?: string;
    grade?: string;
    totalMarks?: number;
    studentName?: string;
    answerKey?: string;
    notes?: string;
  }): Promise<AIResult> {
    if (!data?.images?.length) return { status: "no_data", message: "Upload a scanned PDF first." };
    if (import.meta.env.DEV) console.debug("[PaperCorrection] pages:", data.images.length);
    return callAIInsights("paper_correction", data as unknown as AIPayload, {
      timeoutMs: 240_000,
      logPrefix: "PaperCorrection",
    });
  },
};

