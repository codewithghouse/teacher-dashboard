import { getRosterSummariesPrompt, getStudentAnalyticsPrompt } from "../prompts/students-prompt";

export async function generateRosterSummariesInsights(data: any): Promise<any> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API Key not configured.");
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an educational AI insights engine. Return JSON only." },
        { role: "user", content: getRosterSummariesPrompt(data) }
      ],
      response_format: { type: "json_object" }
    })
  });
  
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const result = await response.json();
  let outputData = result.choices?.[0]?.message?.content || result.choices?.[0]?.text;
  
  if (typeof outputData === 'string') {
     try { return JSON.parse(outputData.replace(/```json/gi, "").replace(/```/g, "").trim()); } catch (e) { return null; }
  }
  return outputData;
}

export async function generateStudentAnalyticsInsights(data: any): Promise<any> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API Key not configured.");
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an AI Education Prediction Engine. Analyze the student data provided and return specific, actionable insights including detected architecture and expected trajectory. Return STRICT JSON only." },
        { role: "user", content: getStudentAnalyticsPrompt(data) }
      ],
      response_format: { type: "json_object" }
    })
  });
  
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const result = await response.json();
  let outputData = result.choices?.[0]?.message?.content || result.choices?.[0]?.text;
  
  if (typeof outputData === 'string') {
     try { return JSON.parse(outputData.replace(/```json/gi, "").replace(/```/g, "").trim()); } catch (e) { return null; }
  }
  return outputData;
}
