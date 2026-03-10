import { GoogleGenAI, Type } from "@google/genai";
import { Contact, Interaction } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface AISuggestion {
  optimalTime: string;
  suggestedContent: string;
  approach: string;
  reasoning: string;
}

export async function getOutreachInsights(contact: Contact, history: Interaction[]): Promise<AISuggestion> {
  const historyText = history
    .map(h => `[${h.timestamp}] ${h.type}: ${h.content}`)
    .join('\n');

  const prompt = `
    Analyze the following contact and their interaction history to suggest the best way and time to reach out next.
    
    Contact: ${contact.firstName} ${contact.lastName}
    Level: ${contact.level} (A=Weekly, B=Monthly, C=Quarterly, D=Yearly)
    Tags: ${contact.tags.join(', ')}
    
    Interaction History:
    ${historyText || 'No history yet.'}
    
    Current Date: ${new Date().toISOString()}
    
    Provide insights on:
    1. Optimal time to reach out (day of week/time of day).
    2. Suggested content or conversation starter based on history.
    3. Recommended tone/approach.
    4. Brief reasoning for these suggestions.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            optimalTime: { type: Type.STRING },
            suggestedContent: { type: Type.STRING },
            approach: { type: Type.STRING },
            reasoning: { type: Type.STRING },
          },
          required: ["optimalTime", "suggestedContent", "approach", "reasoning"],
        },
      },
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    throw new Error("No response from AI");
  } catch (error) {
    console.error("AI Insights Error:", error);
    return {
      optimalTime: "Mid-week morning",
      suggestedContent: "A simple check-in to see how they are doing.",
      approach: "Professional yet warm",
      reasoning: "Based on standard networking best practices as history is limited."
    };
  }
}
