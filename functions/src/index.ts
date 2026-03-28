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
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" }
        });

        const output = JSON.parse(completion.choices[0].message.content!);
        return { status: "success", data: output };

    } catch (error: any) {
        console.error("Teacher AI Error:", error);
        return { status: "error", message: error.message };
    }
});
