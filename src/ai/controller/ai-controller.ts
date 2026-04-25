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

  // EXAM PAPER GENERATOR — OpenAI direct (frontend) with Firebase fallback
  async getExamPaper(data: unknown): Promise<AIResult> {
    if (!hasData(data)) return { status: "no_data", message: NO_DATA_MSG };
    const openaiKey = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined)?.trim();
    if (openaiKey && openaiKey.startsWith("sk-")) {
      try {
        if (import.meta.env.DEV) console.debug("[ExamPaper] OpenAI call dispatched");
        const paper = await callOpenAIExamPaper(data as AIPayload, openaiKey);
        return { status: "success", data: paper };
      } catch (e: unknown) {
        console.error("[AIController:ExamPaper:OpenAI]", e);
        return { status: "error", message: `OpenAI error: ${errMessage(e)}` };
      }
    }
    if (import.meta.env.DEV) console.debug("[ExamPaper] falling back to Firebase callable");
    return callAIInsights("exam_paper_generation", data, {
      timeoutMs: 180_000,
      logPrefix: "ExamPaper",
    });
  },
};

// ══════════════════════════ OpenAI direct client ══════════════════════════════
// NOTE: calling OpenAI from the browser exposes your API key to anyone who
// opens the page. This is acceptable for local dev / demo only — move to a
// server endpoint before deploying publicly.
async function callOpenAIExamPaper(payload: AIPayload, apiKey: string): Promise<unknown> {
  const model = (import.meta.env.VITE_OPENAI_MODEL as string | undefined) || "gpt-4o-mini";

  const systemPrompt = [
    "You are an expert school examination paper setter.",
    "Generate a well-structured, grade-appropriate exam paper.",
    "Return STRICT JSON only — no markdown, no code fences, no commentary.",
    "",
    "Shape the JSON exactly as:",
    "{",
    '  "title": string,',
    '  "subject": string,',
    '  "grade": string,',
    '  "board": string,',
    '  "duration": string,',
    '  "totalMarks": number,',
    '  "generalInstructions": string[],',
    '  "sections": [',
    "    {",
    '      "title": string,            // e.g. "Section A — MCQ"',
    '      "instructions": string,',
    '      "marks": number,',
    '      "questions": [',
    "        {",
    '          "number": number,',
    '          "type": "mcq"|"short"|"long"|"numerical"|"truefalse"|"fillblanks",',
    '          "marks": number,',
    '          "question": string,',
    '          "options": string[] | null,   // REQUIRED for mcq',
    '          "answer": string,             // short correct answer',
    '          "solution": string            // step-by-step explanation',
    "        }",
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Total of all question marks MUST equal totalMarks.",
    "- Number of questions MUST match numQuestions requested.",
    "- Group questions into sections by type (e.g. MCQ in Section A, Short in B, Long in C).",
    "- For MCQ, provide exactly 4 options and put the correct letter + text in `answer`.",
    "- Match difficulty honestly (Easy/Medium/Hard/Mixed).",
    "- Respect board conventions (CBSE/ICSE/IB/etc).",
  ].join("\n");

  const userPrompt = [
    `Subject: ${payload.subject}`,
    `Grade: ${payload.grade}`,
    `Board: ${payload.board}`,
    `Topics: ${payload.topics}`,
    `Difficulty: ${payload.difficulty}`,
    `Duration: ${payload.duration}`,
    `Total Marks: ${payload.totalMarks}`,
    `Number of Questions: ${payload.numQuestions}`,
    `Question Types to include: ${Array.isArray(payload.questionTypes) ? (payload.questionTypes as string[]).join(", ") : "mcq, short, long"}`,
    payload.instructions ? `Special Instructions: ${payload.instructions}` : "",
    payload.teacherName ? `Teacher: ${payload.teacherName}` : "",
    payload.schoolName ? `School: ${payload.schoolName}` : "",
    "",
    "Generate the exam paper now as JSON.",
  ].filter(Boolean).join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} — ${errText.slice(0, 200)}`);
    }

    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenAI");

    try {
      return JSON.parse(content);
    } catch {
      // Strip stray ```json fences if the model slips
      const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
      return JSON.parse(cleaned);
    }
  } finally {
    clearTimeout(timeout);
  }
}
