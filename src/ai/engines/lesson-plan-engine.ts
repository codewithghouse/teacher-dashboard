import { getLessonPlanPrompt } from "../prompts/lesson-plan-prompt";

export async function generateLessonPlan(data: {
  subject: string;
  grade: string;
  topic: string;
  duration_per_lesson: string;
  num_lessons: number;
  board: string;
  learning_goals?: string;
  special_considerations?: string;
  teacher_name?: string;
  school_name?: string;
}): Promise<any> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API Key not configured.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: getLessonPlanPrompt(data) }],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`OpenAI API Error: ${response.status}`);

  const result = await response.json();
  const outputData = result.choices[0].message.content;

  if (typeof outputData === "string") {
    try { return JSON.parse(outputData); } catch { return null; }
  }
  return outputData;
}