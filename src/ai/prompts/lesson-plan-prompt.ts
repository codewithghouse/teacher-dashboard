export function getLessonPlanPrompt(data: {
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
}): string {
  return `You are an expert curriculum designer and master teacher with 20+ years of experience in the ${data.board} education system.

Generate a comprehensive, classroom-ready lesson plan for the following:

SUBJECT: ${data.subject}
GRADE / CLASS: ${data.grade}
TOPIC: ${data.topic}
CURRICULUM BOARD: ${data.board}
DURATION PER LESSON: ${data.duration_per_lesson}
NUMBER OF LESSONS: ${data.num_lessons}
${data.learning_goals ? `TEACHER'S LEARNING GOALS: ${data.learning_goals}` : ""}
${data.special_considerations ? `SPECIAL CONSIDERATIONS: ${data.special_considerations}` : ""}
${data.teacher_name ? `TEACHER: ${data.teacher_name}` : ""}
${data.school_name ? `SCHOOL: ${data.school_name}` : ""}

Return a JSON object in EXACTLY this structure:
{
  "plan_title": "Descriptive title for the overall lesson plan",
  "subject": "${data.subject}",
  "grade": "${data.grade}",
  "board": "${data.board}",
  "total_duration": "total time e.g. 3 x 45 min",
  "overview": "2-3 sentence engaging summary of the lesson plan",
  "learning_objectives": ["By the end of this lesson, students will be able to...", "..."],
  "materials_needed": ["Whiteboard", "Textbook", "..."],
  "prior_knowledge": "What students should already know before this lesson",
  "lessons": [
    {
      "lesson_number": 1,
      "title": "Descriptive lesson title",
      "duration": "${data.duration_per_lesson}",
      "learning_focus": "Main skill or concept for this lesson",
      "sections": [
        {
          "name": "Introduction / Hook",
          "duration": "5 min",
          "teacher_activity": "What the teacher does",
          "student_activity": "What students do",
          "key_questions": ["Question to engage students?"]
        },
        {
          "name": "Direct Instruction",
          "duration": "10 min",
          "teacher_activity": "Explain concept with examples",
          "student_activity": "Listen, take notes, answer quick questions",
          "key_questions": ["Check for understanding question?"]
        },
        {
          "name": "Guided Practice",
          "duration": "15 min",
          "teacher_activity": "Guide students through practice problems",
          "student_activity": "Work through problems with teacher support",
          "key_questions": ["Can you explain your reasoning?"]
        },
        {
          "name": "Independent Practice",
          "duration": "10 min",
          "teacher_activity": "Circulate, observe, provide feedback",
          "student_activity": "Complete practice independently",
          "key_questions": []
        },
        {
          "name": "Closure / Summary",
          "duration": "5 min",
          "teacher_activity": "Summarize key points, preview next lesson",
          "student_activity": "Share takeaways, ask remaining questions",
          "key_questions": ["What was the most important thing you learned today?"]
        }
      ]
    }
  ],
  "assessment_strategies": ["Formative: Exit ticket with 2 questions at end of each lesson", "Summative: ..."],
  "differentiation": {
    "for_struggling_students": "Specific scaffolding strategies and modifications",
    "for_advanced_students": "Extension activities and enrichment opportunities",
    "for_ell_students": "Language support strategies if applicable"
  },
  "cross_curricular_connections": ["Connection to another subject"],
  "homework": "Specific homework assignment or No homework if not applicable",
  "teacher_reflection_prompts": ["Did all students achieve the learning objectives?", "Which part of the lesson was most engaging?"]
}

IMPORTANT:
- Generate exactly ${data.num_lessons} lesson(s) in the lessons array
- Make content specific to ${data.topic}, not generic
- Keep language actionable for a ${data.board} classroom
- Section timings must add up to ${data.duration_per_lesson}
- Return ONLY the JSON object, no markdown, no explanation`;
}
