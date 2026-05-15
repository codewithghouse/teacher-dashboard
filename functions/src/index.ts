/* TEACHER DASHBOARD BACKEND — Master Insights Engine (hardened) */
import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import OpenAI from "openai";
// pdf-parse is server-side PDF text extractor used by the Pre-Result
// Predictor to read the school's syllabus PDF (downloaded via admin SDK from
// Firebase Storage, no client-side fetch / no CORS issue).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse");

admin.initializeApp();

// Cap extracted syllabus text to keep total payload under MAX_PAYLOAD_CHARS.
// 30 KB of syllabus text is plenty (≈ 6000 words / 30 pages of dense PDF).
const MAX_SYLLABUS_CHARS = 30_000;

// Key stored in Firebase Secret Manager. Set via:
//   firebase secrets:set OPENAI_API_KEY
const openaiApiKey = defineSecret("OPENAI_API_KEY");

const TEACHER_ROLES = new Set(["teacher", "principal", "owner"]);
const MAX_PAYLOAD_CHARS = 40_000;
const MAX_LESSON_TEXT_CHARS = 12_000;
// Vision payloads (paper_correction) carry base64 page images and need a much
// larger cap. Firebase Functions hard limit is 10 MB; we cap below that to
// leave headroom for envelope + headers.
const MAX_VISION_PAYLOAD_CHARS = 9_000_000;
const MAX_PAPER_PAGES = 10;
// Types that are allowed to use the vision payload size cap.
const VISION_TYPES = new Set(["paper_correction"]);

function requireRole(
  context: functions.https.CallableContext,
  allowed: Set<string>,
): void {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }
  const role = (context.auth.token as any).role;
  if (!role || !allowed.has(role)) {
    throw new functions.https.HttpsError("permission-denied", "Teachers only.");
  }
}

function safeJsonParse<T = any>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(`[${label}] JSON parse failed. Raw (first 500):`, raw.slice(0, 500));
    throw new functions.https.HttpsError(
      "internal",
      "AI returned invalid JSON. Please retry.",
    );
  }
}

export const getTeacherAIInsights = functions
  .runWith({ secrets: [openaiApiKey], timeoutSeconds: 240, memory: "2GB" })
  .https.onCall(async (data: any, context) => {
    // Auth + role gate (was auth-only, missing role check).
    requireRole(context, TEACHER_ROLES);

    // Trim defensively — Secret Manager retains trailing whitespace/newline
    // from CLI input, which makes the Bearer header invalid.
    const openai = new OpenAI({ apiKey: openaiApiKey.value().trim() });
    const { type, payload } = data || {};

    // Input bounds on payload — prevent prompt-cost amplification. Vision
    // calls (paper_correction) carry image arrays so they get a much higher
    // cap; everything else stays on the strict 40 KB limit.
    const payloadJson = JSON.stringify(payload ?? {});
    const cap = VISION_TYPES.has(type) ? MAX_VISION_PAYLOAD_CHARS : MAX_PAYLOAD_CHARS;
    if (payloadJson.length > cap) {
      throw new functions.https.HttpsError("invalid-argument", "payload too large.");
    }

    console.log("Teacher AI Request:", type);

    let systemPrompt = "You are an expert Educational AI assistant for Edullent.";
    let userPrompt = `Context: ${payloadJson}`;

    if (type === "assignment_creation") {
      systemPrompt = "You are an AI Assignment Generator.";
      userPrompt = `Generate a calibrated assignment. Return JSON: { difficulty_calibration, personalized_groups, generated_assignment { title, description } }. Context: ${payloadJson}`;
    } else if (type === "assignment_grading") {
      systemPrompt = "You are an AI Auto-Grader.";
      userPrompt = `Analyze student submissions. Return JSON: { auto_graded_results [], plagiarism_alerts [] }. Context: ${payloadJson}`;
    } else if (type === "dashboard_insights") {
      systemPrompt = "You are an AI School Principal Advisor.";
      userPrompt = `Provide strategic dashboard insights. Return JSON: { current_performance, critical_alerts [], growth_projections }. Context: ${payloadJson}`;
    } else if (type === "class_insights") {
      systemPrompt = "You are a Class Performance Analyst.";
      userPrompt = `Analyze class metrics. Return JSON: { average_mastery, concept_gaps [], student_rankings [] }. Context: ${payloadJson}`;
    } else if (type === "lesson_plan_generation") {
      systemPrompt = "You are an expert curriculum designer and master teacher. Generate structured, classroom-ready lesson plans.";
      // Topic is now optional. When the teacher leaves it blank, instruct the
      // model to pick an appropriate topic for the given subject + grade +
      // board (and any learning goals provided), and write the chosen topic
      // into `plan_title` so the teacher sees what was selected.
      const topicLine = (payload?.topic && String(payload.topic).trim())
        ? `TOPIC: ${payload.topic}`
        : "TOPIC: (not specified — choose a grade-appropriate, board-aligned topic for the subject yourself and surface it in `plan_title`)";
      userPrompt = `Generate a comprehensive lesson plan for:
SUBJECT: ${payload?.subject}
GRADE: ${payload?.grade}
${topicLine}
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
    } else if (type === "lesson_summary") {
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
    } else if (type === "class_action_plan") {
      systemPrompt = [
        "You are a senior school data analyst and teacher coach for Indian K-12 schools.",
        "Give honest, specific, data-driven recommendations to a class teacher.",
        "Never shame or demoralize. Respond ONLY in valid JSON.",
        "",
        "CRITICAL LANGUAGE RULE — MUST FOLLOW:",
        "Write EVERY text field in clear professional English ONLY.",
        "DO NOT use Hindi, Urdu, Hinglish, transliteration, or any Devanagari script.",
        "DO NOT use words like: hai, nahi, kar, karein, ke liye, achha, thoda, bhi, jo, ki, ka, ke, mein, par, se, ko, ya.",
        "If you catch yourself writing Hinglish, restart the sentence in pure English.",
        "",
        "Example of CORRECT output: 'Attendance is below class average, focus on regularity to improve consistency.'",
        "Example of INCORRECT output: 'Attendance class average se neeche hai, regularity pe focus karein.'",
      ].join("\n");
      userPrompt = `Generate an action plan for a class teacher based on the live metrics below.

CONTEXT:
${payloadJson}

Generate 4-5 specific actions. Each action must:
- Target the biggest measurable gap (low marks, low attendance, at-risk count, or a specific weak student)
- Be completable in 1-2 weeks
- Be concrete and trackable

Return ONLY this JSON. ALL text fields must be in clear professional English (no Hindi or Hinglish):
{
  "diagnosis": [
    { "type": "good", "text": "English — what is working, with specific numbers" },
    { "type": "concern", "text": "English — biggest issue, with the data" },
    { "type": "note", "text": "English — pattern, context, or callout (optional)" }
  ],
  "actions": [
    {
      "id": "a1",
      "num": "01",
      "title": "Short English action title with target",
      "reason": "English 1-2 sentence reason citing the data",
      "tracking": "auto" | "auto_pct" | "manual",
      "status": "pending",
      "subStatus": "Short English label like '0 / 5 sessions' or '72% → 85%'"
    }
  ]
}`;
    } else if (type === "student_action_plan") {
      systemPrompt = [
        "You are a teacher coach helping a teacher plan interventions for a specific student.",
        "Generate empathetic, concrete interventions. Never shame. Respond ONLY in valid JSON.",
        "",
        "CRITICAL LANGUAGE RULE — MUST FOLLOW:",
        "Write EVERY text field in clear professional English ONLY.",
        "DO NOT use Hindi, Urdu, Hinglish, transliteration, or any Devanagari script.",
        "DO NOT use words like: hai, nahi, kar, karein, ke liye, achha, thoda, bhi, jo, ki, ka, ke, mein, par, se, ko, ya.",
        "If you catch yourself writing Hinglish, restart the sentence in pure English.",
        "",
        "Example of CORRECT: 'Schedule weekly check-ins to address the attendance gap and discuss her well-being.'",
        "Example of INCORRECT: 'Attendance gap ko tackle karne ke liye weekly check-ins schedule karo.'",
      ].join("\n");
      userPrompt = `Generate a personalised intervention plan for one student.

CONTEXT:
${payloadJson}

Generate 4-5 SPECIFIC interventions targeting this student's worst metrics and weakest subjects.

Return ONLY this JSON. ALL text fields must be in clear professional English (no Hindi or Hinglish):
{
  "diagnosis": [
    { "type": "concern", "text": "English — biggest issue with student-specific data" },
    { "type": "concern", "text": "English — secondary issue (optional)" },
    { "type": "note", "text": "English — pattern or recommendation context (optional)" }
  ],
  "actions": [
    {
      "id": "s1",
      "num": "01",
      "title": "Short English action title",
      "reason": "English 1-2 sentence reason citing student metrics",
      "tracking": "auto" | "manual",
      "status": "pending",
      "subStatus": "Short English label"
    }
  ]
}`;
    } else if (type === "exam_paper_generation") {
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
        `Question Types to include: ${Array.isArray(p.questionTypes) ? (p.questionTypes as string[]).join(", ") : "mcq, short, long"}`,
        p.instructions ? `Special Instructions: ${p.instructions}` : "",
        p.teacherName ? `Teacher: ${p.teacherName}` : "",
        p.schoolName ? `School: ${p.schoolName}` : "",
        "",
        "Generate the exam paper now as JSON.",
      ].filter(Boolean).join("\n");
    } else if (type === "paper_correction") {
      // Validate vision payload up-front so we don't bill an OpenAI call on
      // garbage. `images` must be an array of data-URL JPEGs (data:image/...).
      const images: unknown = (payload as any)?.images;
      if (!Array.isArray(images) || images.length === 0) {
        throw new functions.https.HttpsError("invalid-argument", "No page images provided.");
      }
      if (images.length > MAX_PAPER_PAGES) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `Too many pages — max ${MAX_PAPER_PAGES} per submission.`,
        );
      }
      for (const img of images) {
        if (typeof img !== "string" || !img.startsWith("data:image/")) {
          throw new functions.https.HttpsError("invalid-argument", "Bad image payload.");
        }
      }

      const p = (payload as any) || {};
      const studentName = (p.studentName || "").toString().trim();
      const studentRef = studentName || "the student";
      const subjectHint = (p.subject || "").toString().trim();

      systemPrompt = [
        "You are an experienced Indian school teacher correcting a student's handwritten exam paper.",
        "You have 15+ years of classroom experience. You correct the way a real teacher does — not like an AI, not like a robot grader.",
        "",
        "HOW A REAL TEACHER GRADES:",
        "1. You read the WHOLE paper first to get a feel of the student's effort and approach, then go question-by-question.",
        "2. You give partial / step marks. If method is right but final calculation is wrong, you don't give zero — you cut 1 mark and write 'method sahi, calculation me galti, dekho yahan'.",
        "3. You comment on WHAT the student actually wrote — never generic. You quote their wrong step or their good attempt by name.",
        "4. You notice handwriting, neatness, margins, units, diagrams, presentation, sequence of questions, blanks at the end, overwriting, scratched answers — all of it.",
        "5. You separate EFFORT from ACCURACY. A student who attempted everything but got things wrong gets a different note than one who left half blank.",
        "6. You connect mistakes to CONCEPTS — e.g. 'BODMAS confused ho gaya' or 'transitive verb ka concept clear nahi hai'.",
        "7. You compare quietly to grade-level expectations — what is acceptable for this class.",
        "8. You write a final note that a real teacher would write at the end of the paper — encouraging if low marks, challenging if high marks. Never the same robotic phrase.",
        "9. You give the parent a SHORT honest summary they can read in 30 seconds.",
        "10. You write a small personal note TO the student — like a teacher would scribble at the bottom of the paper.",
        "",
        "TONE:",
        `- Address the student by name (${studentName ? `"${studentName}"` : '"beta" / first-person Hinglish'}). Use "tum"/"tumne"/"tumhara" naturally — not "the student".`,
        "- Hinglish (Hindi + English mixed naturally) for ALL feedback text. Marks/numbers/grade band stay in English/digits.",
        "- Specific praise. NEVER say 'good work' or 'well done'. Say 'tumne Q3 me steps clearly likhe, formula bhi sahi tha — yeh achha hai'.",
        "- Honest weakness. NEVER say 'try to improve'. Say 'integration me limits apply karte time aksar galti hoti hai tumhari, 3 baar yahan dikha — practice ki zaroorat hai'.",
        "- If the student attempted bravely but got it wrong → recognize the attempt before pointing out the mistake.",
        "- If the student is clearly weak → kind firm tone, never sarcasm, never disappointed.",
        "- If the student is strong → push them harder, suggest enrichment, don't be patronising.",
        "- Real teacher metaphor: imagine you are writing in red pen on the actual paper while the student is sitting next to you the next day.",
        "",
        "RULES:",
        "- Read every page in order (page 1 first).",
        "- Quote SPECIFIC numbers / words / steps from the student's answer in your comments — this is non-negotiable.",
        "- If handwriting is unclear, say so HONESTLY in the per-question comment AND in handwriting_note. Don't guess wildly.",
        "- mistake_type taxonomy is fixed — pick the MAIN one even if multiple apply.",
        "- improvement_plan items must each reference a SPECIFIC mistake/topic from THIS paper, never generic.",
        "- student_letter is a 3-5 sentence first-person note FROM you (the teacher) TO the student — warm, real, specific to this paper. Sign as 'Teacher' (not your name).",
        "- parent_note is a 2-3 sentence neutral honest summary in Hinglish that the parent will read.",
        "",
        "Return STRICT JSON only — no markdown fences, no commentary outside the JSON.",
        "",
        "JSON shape:",
        "{",
        '  "subject": string,',
        '  "grade": string | null,',
        '  "totalMarks": number,',
        '  "marksScored": number,',
        '  "percentage": number,',
        '  "grade_band": "A+" | "A" | "B" | "C" | "D" | "E" | "F",',
        '  "overall_summary": string,',
        '  "handwriting_note": string,',
        '  "presentation_note": string,',
        '  "effort_note": string,',
        '  "questions": [',
        "    {",
        '      "number": string,',
        '      "question_text": string,',
        '      "max_marks": number,',
        '      "marks_awarded": number,',
        '      "verdict": "correct" | "partial" | "wrong" | "blank" | "unreadable",',
        '      "mistake_type": "none" | "conceptual" | "calculation" | "missing_step" | "silly_mistake" | "incomplete" | "wrong_method" | "presentation" | "no_attempt" | "unreadable",',
        '      "student_answer_summary": string,',
        '      "correct_answer": string,',
        '      "comment": string,',
        '      "step_marks_breakdown": string | null',
        "    }",
        "  ],",
        '  "concept_understanding": [',
        "    {",
        '      "concept": string,',
        '      "level": "strong" | "developing" | "weak",',
        '      "evidence": string',
        "    }",
        "  ],",
        '  "strengths": [string],',
        '  "weaknesses": [string],',
        '  "improvement_plan": [',
        "    {",
        '      "area": string,',
        '      "action": string,',
        '      "priority": "high" | "medium" | "low"',
        "    }",
        "  ],",
        '  "encouragement": string,',
        '  "parent_note": string,',
        '  "student_letter": string',
        "}",
        "",
        "Field guidance:",
        "- overall_summary: 2-3 Hinglish sentences. What the paper looks like AS A WHOLE. Quote 1 specific thing.",
        "- handwriting_note: 1-2 Hinglish sentences. Honest — neat / messy / mixed / hard-to-read.",
        "- presentation_note: 1-2 Hinglish sentences. Margins, question numbering, diagrams, units, sequence, scratched answers.",
        "- effort_note: 1-2 Hinglish sentences. Did the student attempt all? Last questions blank? Rushed at the end? Even hard questions tried?",
        "- questions[].step_marks_breakdown: For multi-mark questions, show how marks were split, e.g. \"Method 2/2, calculation 0/1, units 1/1\". Null for 1-mark questions or where not applicable.",
        "- concept_understanding: 4-7 entries. The actual concepts tested in this paper, with evidence from THIS student's answers.",
        "- strengths: 3-5 Hinglish bullets — quote specific question numbers / things student did right.",
        "- weaknesses: 3-5 Hinglish bullets — quote specific question numbers / specific errors.",
        "- improvement_plan: 4-6 actions. Each action MUST cite the specific mistake/topic from this paper.",
        "- encouragement: 1-2 Hinglish sentences. Genuine, specific to THIS student's performance band — never copy-paste.",
        "- parent_note: 2-3 sentences. Honest summary for parent. Mention marks, one strength, one area to work on.",
        '- student_letter: 3-5 sentences. First-person FROM teacher TO student. Hinglish. Warm, specific to this paper. End with sign-off line like "— Teacher".',
        "",
        "Hard constraints:",
        "- marksScored MUST equal the sum of marks_awarded across all questions.",
        "- percentage MUST equal round(marksScored / totalMarks * 100, 1).",
        "- grade_band: A+ ≥90, A 80-89, B 70-79, C 60-69, D 50-59, E 40-49, F <40.",
        "- For unreadable questions: verdict=\"unreadable\", mistake_type=\"unreadable\", marks=0, comment must say what is unclear.",
        "- For blank questions: verdict=\"blank\", mistake_type=\"no_attempt\", marks=0.",
      ].join("\n");

      const meta = [
        `Subject: ${subjectHint || "(not specified — infer from paper)"}`,
        p.grade ? `Grade / class: ${p.grade}` : null,
        p.totalMarks ? `Total Marks (declared by teacher): ${p.totalMarks}` : "Total Marks: infer from the paper",
        studentName ? `Student name: ${studentName}` : "Student name: not provided (use 'tum' / 'beta')",
        p.answerKey ? `\nTeacher's answer key / marking scheme (use this as the source of truth where given):\n${String(p.answerKey).slice(0, 6000)}` : null,
        p.notes ? `\nExtra grading notes from teacher: ${String(p.notes).slice(0, 1000)}` : null,
      ].filter(Boolean).join("\n");

      userPrompt = [
        `Correct ${studentRef}'s scanned exam paper end-to-end, the way a real classroom teacher would.`,
        "",
        meta,
        "",
        `Pages attached: ${images.length} (in order — page 1 is the first image).`,
        "Read every page. Read every question. Look at handwriting, attempts, scratched-out work, blanks.",
        "Then produce the JSON exactly as specified, with all fields filled honestly and specifically.",
      ].join("\n");
    } else if (type === "predict_exam_results") {
      // PRE-RESULT PREDICTOR — read the question paper, syllabus context, and
      // each student's full history (test scores + gradebook + attendance +
      // behaviour ratings + concept strengths/weaknesses). Predict per-student
      // pass/borderline/fail with score range, per-question topic mapping, and
      // a recommended pre-exam intervention. This is the headline USP feature
      // — heavy reasoning, gpt-4o, daily Firestore-cached so cost amortises.

      // ── Server-side syllabus PDF extraction ───────────────────────────────
      // The client previously tried to fetch the syllabus PDF from Firebase
      // Storage directly and extract text in the browser — but that hits
      // CORS unless the bucket has an explicit cross-origin config. Doing
      // the extraction server-side via the Firebase Admin SDK download path
      // bypasses CORS entirely AND keeps the syllabus content out of the
      // client bundle. Result: the "AI reads your syllabus PDF" USP works
      // for every school out of the box, no per-bucket setup.
      const syllabusPath = (payload as any)?.syllabusPath;
      if (syllabusPath && typeof syllabusPath === "string" && !(payload as any)?.syllabusText) {
        try {
          const file = admin.storage().bucket().file(syllabusPath);
          const [buf] = await file.download();
          const data = await pdfParse(buf);
          let text = String(data?.text || "").trim();
          if (text.length > MAX_SYLLABUS_CHARS) {
            // Take the first MAX_SYLLABUS_CHARS — syllabus headers + early
            // chapters carry the topic list we need; later pages are rote
            // exercises that don't influence the prediction much.
            text = text.slice(0, MAX_SYLLABUS_CHARS);
          }
          (payload as any).syllabusText = text;
          console.log(`[predict_exam_results] syllabus extracted ${text.length} chars from ${syllabusPath}`);
        } catch (err: any) {
          console.warn(`[predict_exam_results] syllabus extraction failed for ${syllabusPath}:`, err?.message || err);
          // Non-fatal — predictor still works without syllabus context.
        }
      }

      systemPrompt = [
        "You are a senior exam-results forecasting analyst with 20+ years of",
        "Indian school examination experience.",
        "",
        "Your job: BEFORE the exam, predict how each student is likely to",
        "perform on a specific question paper, citing concrete evidence from",
        "their academic history. The teacher will use your predictions to run",
        "targeted interventions while there is still time to engineer a better",
        "outcome.",
        "",
        "Do NOT be vague. Cite specific past scores, attendance percentages,",
        "and topic gaps by name. The teacher must trust every prediction.",
        "Respond ONLY in valid JSON.",
        "",
        "CRITICAL LANGUAGE RULE — MUST FOLLOW:",
        "Write EVERY text field in clear professional English ONLY.",
        "DO NOT use Hindi, Urdu, Hinglish, transliteration, or any Devanagari script.",
        "DO NOT use words like: hai, nahi, kar, karein, ke liye, achha, thoda, bhi, jo, ki, ka, ke, mein, par, se, ko, ya.",
        "If you catch yourself writing Hinglish, restart the sentence in pure English.",
        "",
        "Example of CORRECT: 'Tanveer scored 88% on algebra in the last unit test, but Q2/Q5/Q8 of this paper test geometry where her average across the last three attempts is 38%. Recommended: a focused 1-hour geometry review before the exam.'",
        "Example of INCORRECT: 'Tanveer ka algebra strong hai par geometry mein thoda gap hai, isliye revision karna chahiye.'",
        "",
        "PREDICTION DISCIPLINE:",
        "- predicted_band must be one of exactly: 'pass' | 'borderline' | 'fail'.",
        "- 'pass' = predicted score >= 60% with high or medium confidence.",
        "- 'borderline' = predicted score 40-59% OR low confidence on a higher score.",
        "- 'fail' = predicted score < 40% based on at least 2 historical signals.",
        "- Never invent data. If a student has too few past records, set",
        "  predicted_band to 'borderline', confidence to 'low', and say so honestly.",
      ].join("\n");

      userPrompt = `Forecast results for an upcoming exam. Use the question paper, syllabus context (if any), and each student's history.

QUESTION PAPER (text extracted from PDF or pasted by teacher):
${(payload as any)?.paperText || "(empty — only history available)"}

SYLLABUS CONTEXT (text extracted from the school syllabus PDF; may be partial):
${(payload as any)?.syllabusText || "(no syllabus PDF available)"}

EXAM META:
- Subject: ${(payload as any)?.subject || "Unknown"}
- Class: ${(payload as any)?.className || "Unknown"}
- Total marks: ${(payload as any)?.totalMarks || "Unknown"}
- Pass mark percentage: ${(payload as any)?.passPct ?? 40}

STUDENT HISTORY (one object per student in the class):
${JSON.stringify((payload as any)?.students || [], null, 2)}

Identify the topics this paper tests (parse the question paper). For each student, map their history (subject avg, last 3 test scores, attendance %, behaviour rating, weak topics) to those question topics. Then produce a prediction.

Return ONLY this JSON. ALL text fields must be in clear professional English (no Hindi or Hinglish):
{
  "paper_summary": {
    "topics_detected": ["string array of distinct topics the paper tests"],
    "difficulty_estimate": "easy" | "medium" | "hard",
    "questions_overview": "1-2 sentence English summary of what the paper covers and weights"
  },
  "class_forecast": {
    "expected_pass_pct": 0-100 integer,
    "predicted_class_average": 0-100 integer,
    "expected_top_struggle_questions": ["e.g. Q3 (geometry construction), Q7 (trigonometric identities)"],
    "headline": "1 sentence English headline summarising the class outlook",
    "pre_exam_class_actions": [
      "Concrete English action 1 the teacher should run before the exam",
      "Concrete English action 2"
    ]
  },
  "students": [
    {
      "studentId": "must match the studentId provided in the input",
      "name": "student name",
      "predicted_band": "pass" | "borderline" | "fail",
      "predicted_score_min": 0-100 integer,
      "predicted_score_max": 0-100 integer,
      "confidence": "high" | "medium" | "low",
      "top_strengths_for_paper": ["English bullet citing the specific topic and the past score that supports it"],
      "gaps_for_paper": ["English bullet citing the specific topic and the past score / missed concept that supports it"],
      "reasoning": "2-4 sentence English explanation tying the predicted band to the historical evidence. Cite numbers (past scores, attendance %, weak-concept names). NO Hinglish.",
      "recommended_pre_exam_action": "1 concrete English action the teacher should take with this student before the exam (eg 'Run a 1-hour geometry construction practice with worked examples on Friday')."
    }
  ]
}`;
    } else if (type === "teacher_self_action_plan") {
      systemPrompt = [
        "You are a senior educator performance coach.",
        "Give honest, constructive feedback to a teacher to help them improve their professional metrics.",
        "Never demoralize. Respond ONLY in valid JSON.",
        "",
        "CRITICAL LANGUAGE RULE — MUST FOLLOW:",
        "Write EVERY text field in clear professional English ONLY.",
        "DO NOT use Hindi, Urdu, Hinglish, transliteration, or any Devanagari script.",
        "DO NOT use words like: hai, nahi, kar, karein, ke liye, achha, thoda, bhi, jo, ki, ka, ke, mein, par, se, ko, ya.",
        "If you catch yourself writing Hinglish, restart the sentence in pure English.",
        "",
        "Example of CORRECT: 'Your strongest class is 10A; consider applying its routine to your weaker sections.'",
        "Example of INCORRECT: 'Aapki strongest class 10A hai; iska routine weaker sections pe apply karein.'",
      ].join("\n");
      userPrompt = `Generate self-improvement actions for a teacher based on their composite metrics across classes.

CONTEXT:
${payloadJson}

Generate 4-5 self-improvement actions targeting their weakest classes or biggest gaps.

Return ONLY this JSON. ALL text fields must be in clear professional English (no Hindi or Hinglish):
{
  "diagnosis": [
    { "type": "good", "text": "English — what is working, with specifics" },
    { "type": "concern", "text": "English — biggest weakness with numbers" },
    { "type": "note", "text": "English — class-specific concern or callout (optional)" }
  ],
  "actions": [
    {
      "id": "t1",
      "num": "01",
      "title": "Short English action title",
      "reason": "English 1-2 sentence reason citing the data",
      "tracking": "auto" | "auto_pct" | "manual",
      "status": "pending",
      "subStatus": "Short English label"
    }
  ]
}`;
    }

    const maxTokens =
      type === "lesson_plan_generation" ? 4096 :
      type === "lesson_summary" ? 3000 :
      // Exam paper bumped from 4096 → 12000 because a typical 20-question
      // paper (defaults: 20 Q × 50 marks) with full content + answers +
      // solutions for each question regularly exceeds 4096 output tokens,
      // and the model truncates → invalid JSON → safeJsonParse throws → the
      // user sees a generic "AI returned invalid JSON" error. We're now on
      // gpt-4.1-mini which supports up to 16k output, so 12k leaves headroom
      // for the largest realistic paper (50 Q with long solutions).
      type === "exam_paper_generation" ? 12000 :
      type === "paper_correction" ? 4096 :
      type === "class_action_plan" ? 1500 :
      type === "student_action_plan" ? 1500 :
      type === "teacher_self_action_plan" ? 1500 :
      // Pre-Result Predictor: per-student JSON for up to 50 students plus the
      // class-forecast block — the largest text-only output we ship. 4096 keeps
      // it under the gpt-4o response cap; the cloud function's safeJsonParse
      // surfaces a clean error if the model truncates.
      type === "predict_exam_results" ? 4096 :
      1024;

    // Per-type model selection. Leaderboard action plans are reasoning-heavy
    // (analysing class metrics, ranking gaps, recommending interventions) and
    // are Firestore-cached weekly per (teacher + context + ISO week), so the
    // higher per-call cost of gpt-4o is amortised across 7 days. The Pre-Result
    // Predictor is the same shape — heavy reasoning, daily-cached per paper.
    //
    // ⚠️ predict_exam_results uses gpt-4.1-mini because the project's OpenAI
    // key currently lacks gpt-4o access (caught in production logs:
    // "Project ... does not have access to model 'gpt-4o'"). The other
    // _action_plan types kept gpt-4o because they were already deployed
    // under it — flip them too if model_not_found surfaces for them.
    const model =
      type === "class_action_plan" ? "gpt-4o" :
      type === "student_action_plan" ? "gpt-4o" :
      type === "teacher_self_action_plan" ? "gpt-4o" :
      type === "predict_exam_results" ? "gpt-4.1-mini" :
      "gpt-4.1-mini";

    // Vision types attach base64 page images to the user message so the
    // model can actually look at the scanned paper. Everything else stays
    // on the simple text-only path.
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] | string =
      type === "paper_correction"
        ? [
            { type: "text", text: userPrompt },
            ...((payload as any).images as string[]).map((dataUrl: string) => ({
              type: "image_url" as const,
              image_url: { url: dataUrl, detail: "high" as const },
            })),
          ]
        : userPrompt;

    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
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

    } catch (error: any) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error("Teacher AI Error:", error);
      throw new functions.https.HttpsError("internal", "AI call failed.");
    }
  });