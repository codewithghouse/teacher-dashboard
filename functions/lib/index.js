"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTeacherAIInsights = void 0;
/* TEACHER DASHBOARD BACKEND — Master Insights Engine (hardened) */
const functions = require("firebase-functions");
const params_1 = require("firebase-functions/params");
const admin = require("firebase-admin");
const openai_1 = require("openai");
admin.initializeApp();
// Key stored in Firebase Secret Manager. Set via:
//   firebase secrets:set OPENAI_API_KEY
const openaiApiKey = (0, params_1.defineSecret)("OPENAI_API_KEY");
const TEACHER_ROLES = new Set(["teacher", "principal", "owner"]);
const MAX_PAYLOAD_CHARS = 40000;
const MAX_LESSON_TEXT_CHARS = 12000;
function requireRole(context, allowed) {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }
    const role = context.auth.token.role;
    if (!role || !allowed.has(role)) {
        throw new functions.https.HttpsError("permission-denied", "Teachers only.");
    }
}
function safeJsonParse(raw, label) {
    try {
        return JSON.parse(raw);
    }
    catch {
        console.error(`[${label}] JSON parse failed. Raw (first 500):`, raw.slice(0, 500));
        throw new functions.https.HttpsError("internal", "AI returned invalid JSON. Please retry.");
    }
}
exports.getTeacherAIInsights = functions
    .runWith({ secrets: [openaiApiKey], timeoutSeconds: 60, memory: "512MB" })
    .https.onCall(async (data, context) => {
    // Auth + role gate (was auth-only, missing role check).
    requireRole(context, TEACHER_ROLES);
    // Trim defensively — Secret Manager retains trailing whitespace/newline
    // from CLI input, which makes the Bearer header invalid.
    const openai = new openai_1.default({ apiKey: openaiApiKey.value().trim() });
    const { type, payload } = data || {};
    // Input bounds on payload — prevent prompt-cost amplification.
    const payloadJson = JSON.stringify(payload ?? {});
    if (payloadJson.length > MAX_PAYLOAD_CHARS) {
        throw new functions.https.HttpsError("invalid-argument", "payload too large.");
    }
    console.log("Teacher AI Request:", type);
    let systemPrompt = "You are an expert Educational AI assistant for Edullent.";
    let userPrompt = `Context: ${payloadJson}`;
    if (type === "assignment_creation") {
        systemPrompt = "You are an AI Assignment Generator.";
        userPrompt = `Generate a calibrated assignment. Return JSON: { difficulty_calibration, personalized_groups, generated_assignment { title, description } }. Context: ${payloadJson}`;
    }
    else if (type === "assignment_grading") {
        systemPrompt = "You are an AI Auto-Grader.";
        userPrompt = `Analyze student submissions. Return JSON: { auto_graded_results [], plagiarism_alerts [] }. Context: ${payloadJson}`;
    }
    else if (type === "dashboard_insights") {
        systemPrompt = "You are an AI School Principal Advisor.";
        userPrompt = `Provide strategic dashboard insights. Return JSON: { current_performance, critical_alerts [], growth_projections }. Context: ${payloadJson}`;
    }
    else if (type === "class_insights") {
        systemPrompt = "You are a Class Performance Analyst.";
        userPrompt = `Analyze class metrics. Return JSON: { average_mastery, concept_gaps [], student_rankings [] }. Context: ${payloadJson}`;
    }
    else if (type === "lesson_plan_generation") {
        systemPrompt = "You are an expert curriculum designer and master teacher. Generate structured, classroom-ready lesson plans.";
        userPrompt = `Generate a comprehensive lesson plan for:
SUBJECT: ${payload?.subject}
GRADE: ${payload?.grade}
TOPIC: ${payload?.topic}
BOARD: ${payload?.board}
DURATION PER LESSON: ${payload?.duration_per_lesson}
NUMBER OF LESSONS: ${payload?.num_lessons}
${payload?.learning_goals ? `LEARNING GOALS: ${payload.learning_goals}` : ""}
${payload?.special_considerations ? `SPECIAL CONSIDERATIONS: ${payload.special_considerations}` : ""}

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
Generate exactly ${payload?.num_lessons} lesson(s). Make content specific to ${payload?.topic}. Return ONLY the JSON.`;
    }
    else if (type === "lesson_summary") {
        const text = typeof payload?.text === "string" ? payload.text : "";
        const truncated = text.length > MAX_LESSON_TEXT_CHARS
            ? text.substring(0, MAX_LESSON_TEXT_CHARS) + "\n...[truncated]"
            : text;
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
    else if (type === "class_action_plan") {
        systemPrompt = "You are a senior school data analyst and teacher coach for Indian K-12 schools. Give honest, specific, data-driven recommendations to a class teacher. Use Hinglish (Hindi + English mixed naturally) in diagnosis and action reasons — keep action titles in English. Never shame or demoralize. Respond ONLY in valid JSON.";
        userPrompt = `Generate an action plan for a class teacher based on the live metrics below.

CONTEXT:
${payloadJson}

Generate 4-5 specific actions. Each action must:
- Target the biggest measurable gap (low marks, low attendance, at-risk count, or a specific weak student)
- Be completable in 1-2 weeks
- Be concrete and trackable

Return ONLY this JSON:
{
  "diagnosis": [
    { "type": "good", "text": "Hinglish text — what is working with specific numbers" },
    { "type": "concern", "text": "Hinglish text — biggest issue with data" },
    { "type": "note", "text": "Hinglish text — pattern, context, or callout (optional)" }
  ],
  "actions": [
    {
      "id": "a1",
      "num": "01",
      "title": "Short English action title with target",
      "reason": "Hinglish 1-2 sentence reason with data",
      "tracking": "auto" | "auto_pct" | "manual",
      "status": "pending",
      "subStatus": "Short English label like '0 / 5 sessions' or '72% → 85%'"
    }
  ]
}`;
    }
    else if (type === "student_action_plan") {
        systemPrompt = "You are a teacher coach helping a teacher plan interventions for a specific student. Generate empathetic, concrete interventions. Use Hinglish in reasons, English in titles. Never shame. Respond ONLY in valid JSON.";
        userPrompt = `Generate a personalised intervention plan for one student.

CONTEXT:
${payloadJson}

Generate 4-5 SPECIFIC interventions targeting this student's worst metrics and weakest subjects.

Return ONLY this JSON:
{
  "diagnosis": [
    { "type": "concern", "text": "Hinglish — biggest issue with student-specific data" },
    { "type": "concern", "text": "Hinglish — secondary issue (optional)" },
    { "type": "note", "text": "Hinglish — pattern or recommendation context (optional)" }
  ],
  "actions": [
    {
      "id": "s1",
      "num": "01",
      "title": "Short English action title",
      "reason": "Hinglish 1-2 sentence reason citing student metrics",
      "tracking": "auto" | "manual",
      "status": "pending",
      "subStatus": "Short English label"
    }
  ]
}`;
    }
    else if (type === "exam_paper_generation") {
        systemPrompt = [
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
            '      "title": string,',
            '      "instructions": string,',
            '      "marks": number,',
            '      "questions": [',
            "        {",
            '          "number": number,',
            '          "type": "mcq"|"short"|"long"|"numerical"|"truefalse"|"fillblanks",',
            '          "marks": number,',
            '          "question": string,',
            '          "options": string[] | null,',
            '          "answer": string,',
            '          "solution": string',
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
        const p = payload || {};
        userPrompt = [
            `Subject: ${p.subject}`,
            `Grade: ${p.grade}`,
            `Board: ${p.board}`,
            `Topics: ${p.topics}`,
            `Difficulty: ${p.difficulty}`,
            `Duration: ${p.duration}`,
            `Total Marks: ${p.totalMarks}`,
            `Number of Questions: ${p.numQuestions}`,
            `Question Types to include: ${Array.isArray(p.questionTypes) ? p.questionTypes.join(", ") : "mcq, short, long"}`,
            p.instructions ? `Special Instructions: ${p.instructions}` : "",
            p.teacherName ? `Teacher: ${p.teacherName}` : "",
            p.schoolName ? `School: ${p.schoolName}` : "",
            "",
            "Generate the exam paper now as JSON.",
        ].filter(Boolean).join("\n");
    }
    else if (type === "teacher_self_action_plan") {
        systemPrompt = "You are a senior educator performance coach. Give honest, constructive feedback to a teacher to help them improve their professional metrics. Use Hinglish naturally in diagnosis and action reasons. Keep action titles in English. Never demoralize. Respond ONLY in valid JSON.";
        userPrompt = `Generate self-improvement actions for a teacher based on their composite metrics across classes.

CONTEXT:
${payloadJson}

Generate 4-5 self-improvement actions targeting their weakest classes or biggest gaps.

Return ONLY this JSON:
{
  "diagnosis": [
    { "type": "good", "text": "Hinglish — what is working with specifics" },
    { "type": "concern", "text": "Hinglish — biggest weakness with numbers" },
    { "type": "note", "text": "Hinglish — class-specific concern or callout (optional)" }
  ],
  "actions": [
    {
      "id": "t1",
      "num": "01",
      "title": "Short English action title",
      "reason": "Hinglish 1-2 sentence reason with data",
      "tracking": "auto" | "auto_pct" | "manual",
      "status": "pending",
      "subStatus": "Short English label"
    }
  ]
}`;
    }
    const maxTokens = type === "lesson_plan_generation" ? 4096 :
        type === "lesson_summary" ? 3000 :
            type === "exam_paper_generation" ? 4096 :
                type === "class_action_plan" ? 1500 :
                    type === "student_action_plan" ? 1500 :
                        type === "teacher_self_action_plan" ? 1500 :
                            1024;
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: maxTokens,
        });
        const rawContent = completion.choices[0].message.content ?? "";
        console.log(`[${type}] finish_reason:`, completion.choices[0].finish_reason);
        // Safe parse — throws HttpsError on malformed JSON instead of leaking
        // SyntaxError details to the client.
        const output = safeJsonParse(rawContent, `getTeacherAIInsights:${type}`);
        return { status: "success", data: output };
    }
    catch (error) {
        if (error instanceof functions.https.HttpsError)
            throw error;
        console.error("Teacher AI Error:", error);
        throw new functions.https.HttpsError("internal", "AI call failed.");
    }
});
//# sourceMappingURL=index.js.map