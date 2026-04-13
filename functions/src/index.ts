/* TEACHER DASHBOARD BACKEND - Master Insights Engine */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import OpenAI from "openai";

admin.initializeApp();

const openai = new OpenAI({ 
    apiKey: "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" 
});

export const getTeacherAIInsights = functions.https.onCall(async (data: any, context) => {
    try {
        const { type, payload } = data;

        console.log("Teacher AI Request:", type);

        let systemPrompt = "You are an expert Educational AI assistant for EduIntellect.";
        let userPrompt = `Context: ${JSON.stringify(payload)}`;

        if (type === "assignment_creation") {
            systemPrompt = "You are an AI Assignment Generator.";
            userPrompt = `Generate a calibrated assignment. Return JSON: { difficulty_calibration, personalized_groups, generated_assignment { title, description } }. Context: ${JSON.stringify(payload)}`;
        } else if (type === "assignment_grading") {
            systemPrompt = "You are an AI Auto-Grader.";
            userPrompt = `Analyze student submissions. Return JSON: { auto_graded_results [], plagiarism_alerts [] }. Context: ${JSON.stringify(payload)}`;
        } else if (type === "dashboard_insights") {
            systemPrompt = "You are an AI School Principal Advisor.";
            userPrompt = `Provide strategic dashboard insights. Return JSON: { current_performance, critical_alerts [], growth_projections }. Context: ${JSON.stringify(payload)}`;
        } else if (type === "class_insights") {
            systemPrompt = "You are a Class Performance Analyst.";
            userPrompt = `Analyze class metrics. Return JSON: { average_mastery, concept_gaps [], student_rankings [] }. Context: ${JSON.stringify(payload)}`;
        } else if (type === "lesson_plan_generation") {
            systemPrompt = "You are an expert curriculum designer and master teacher. Generate structured, classroom-ready lesson plans.";
            userPrompt = `Generate a comprehensive lesson plan for:
SUBJECT: ${payload.subject}
GRADE: ${payload.grade}
TOPIC: ${payload.topic}
BOARD: ${payload.board}
DURATION PER LESSON: ${payload.duration_per_lesson}
NUMBER OF LESSONS: ${payload.num_lessons}
${payload.learning_goals ? `LEARNING GOALS: ${payload.learning_goals}` : ""}
${payload.special_considerations ? `SPECIAL CONSIDERATIONS: ${payload.special_considerations}` : ""}

Return JSON: {
  "plan_title": "string",
  "subject": "string",
  "grade": "string",
  "board": "string",
  "total_duration": "string",
  "overview": "string",
  "learning_objectives": ["string"],
  "materials_needed": ["string"],
  "prior_knowledge": "string",
  "lessons": [{
    "lesson_number": 1,
    "title": "string",
    "duration": "string",
    "learning_focus": "string",
    "sections": [{
      "name": "Introduction / Hook",
      "duration": "5 min",
      "teacher_activity": "string",
      "student_activity": "string",
      "key_questions": ["string"]
    }, {
      "name": "Direct Instruction",
      "duration": "10 min",
      "teacher_activity": "string",
      "student_activity": "string",
      "key_questions": ["string"]
    }, {
      "name": "Guided Practice",
      "duration": "15 min",
      "teacher_activity": "string",
      "student_activity": "string",
      "key_questions": ["string"]
    }, {
      "name": "Independent Practice",
      "duration": "10 min",
      "teacher_activity": "string",
      "student_activity": "string",
      "key_questions": []
    }, {
      "name": "Closure / Summary",
      "duration": "5 min",
      "teacher_activity": "string",
      "student_activity": "string",
      "key_questions": ["string"]
    }]
  }],
  "assessment_strategies": ["string"],
  "differentiation": {
    "for_struggling_students": "string",
    "for_advanced_students": "string",
    "for_ell_students": "string"
  },
  "cross_curricular_connections": ["string"],
  "homework": "string",
  "teacher_reflection_prompts": ["string"]
}
Generate exactly ${payload.num_lessons} lesson(s). Make content specific to ${payload.topic}. Return ONLY the JSON.`;
        }

        if (type === "lesson_summary") {
            const text = payload.text || "";
            const truncated = text.length > 12000 ? text.substring(0, 12000) + "\n...[truncated]" : text;
            systemPrompt = "You are an expert academic summarizer and study assistant. You extract key insights from educational documents and produce structured, exam-focused summaries.";
            userPrompt = `Analyze the following lesson/chapter content and produce a comprehensive structured summary.

CONTENT:
${truncated}

Return ONLY a JSON object in this exact structure:
{
  "title": "inferred document or chapter title",
  "subject": "inferred subject (e.g. Mathematics, Biology, History)",
  "brief_summary": "2-3 sentences capturing the essence of the entire document",
  "key_concepts": [
    { "concept": "Concept Name", "explanation": "Clear concise explanation in 1-2 sentences" }
  ],
  "section_breakdown": [
    { "section": "Section/Topic Name", "points": ["key point 1", "key point 2", "key point 3"] }
  ],
  "important_definitions": [
    { "term": "Term", "definition": "Definition" }
  ],
  "key_formulas_or_rules": ["Formula or rule 1", "Formula or rule 2"],
  "exam_important_points": ["Critical point students must remember for exams", "..."],
  "quick_revision": ["Ultra-short crisp revision point 1", "Ultra-short crisp revision point 2"],
  "difficulty_level": "Beginner or Intermediate or Advanced",
  "estimated_study_time": "e.g. 20 minutes"
}

Rules:
- key_concepts: 4-8 most important concepts
- section_breakdown: Break into logical sections found in the content (3-6 sections)
- important_definitions: 4-10 key terms
- key_formulas_or_rules: Include only if applicable (can be empty array)
- exam_important_points: 5-8 high-priority points
- quick_revision: 8-12 ultra-short bullet points (max 10 words each)
- Return ONLY the JSON, no markdown`;
        }

        const maxTokens = type === "lesson_plan_generation" ? 4096 : type === "lesson_summary" ? 3000 : 1024;

        const completion = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" },
            max_tokens: maxTokens
        });

        const rawContent = completion.choices[0].message.content!;
        console.log(`[${type}] finish_reason:`, completion.choices[0].finish_reason);

        const output = JSON.parse(rawContent);
        return { status: "success", data: output };

    } catch (error: any) {
        console.error("Teacher AI Error:", error);
        return { status: "error", message: error.message };
    }
});
