import { getClassReportCardsPrompt, getDetailedSubjectReportPrompt } from "../prompts/reports-prompt";

export async function generateClassReportCardsInsights(data: any): Promise<any> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API Key not configured.");
  
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
        model: "gpt-4o-mini", input: getClassReportCardsPrompt(data),
      text: { format: { type: "json_object" } }
    })
  });
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const result = await response.json();
  let outputData = result.output || result.text || result;
  if (typeof outputData === 'object') return outputData;
  if (typeof outputData === 'string') {
     try { return JSON.parse(outputData.replace(/```json/gi, "").replace(/```/g, "").trim()); } catch (e) { return null; }
  }
  return null;
}

export async function generateDetailedSubjectReportInsights(data: any): Promise<any> {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API Key not configured.");
    
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini", input: getDetailedSubjectReportPrompt(data),
        text: { format: { type: "json_object" } }
      })
    });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const result = await response.json();
    let outputData = result.output || result.text || result;
    if (typeof outputData === 'object') return outputData;
    if (typeof outputData === 'string') {
       try { return JSON.parse(outputData.replace(/```json/gi, "").replace(/```/g, "").trim()); } catch (e) { return null; }
    }
    return null;
  }
