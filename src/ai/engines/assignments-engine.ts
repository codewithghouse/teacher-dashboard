import { getAssignmentCreatorPrompt, getAssignmentGraderPrompt } from "../prompts/assignments-prompt";

export async function generateAssignmentCreationInsights(data: any): Promise<any> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API Key not configured.");
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o", 
      messages: [{ role: "user", content: getAssignmentCreatorPrompt(data) }],
      response_format: { type: "json_object" }
    })
  });
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const result = await response.json();
  const outputData = result.choices[0].message.content;
  
  if (typeof outputData === 'string') {
      try { return JSON.parse(outputData); } catch (e) { return null; }
  }
  return outputData;
}

export async function generateAssignmentGradingInsights(data: any): Promise<any> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API Key not configured.");
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o", 
      messages: [{ role: "user", content: getAssignmentGraderPrompt(data) }],
      response_format: { type: "json_object" }
    })
  });
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const result = await response.json();
  const outputData = result.choices[0].message.content;

  if (typeof outputData === 'string') {
      try { return JSON.parse(outputData); } catch (e) { return null; }
  }
  return outputData;
}
