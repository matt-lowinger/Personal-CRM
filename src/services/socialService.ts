import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export interface SocialMatch {
  linkedinUrl?: string;
  instagramHandle?: string;
}

export async function findSocialProfiles(name: string, email?: string): Promise<SocialMatch> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Find the most likely LinkedIn profile URL and Instagram handle for a person named "${name}"${email ? ` with email "${email}"` : ''}. Return the result in JSON format.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            linkedinUrl: {
              type: Type.STRING,
              description: "The full LinkedIn profile URL",
            },
            instagramHandle: {
              type: Type.STRING,
              description: "The Instagram handle (without @)",
            },
          },
        },
      },
    });

    const text = response.text;
    if (!text) return {};
    return JSON.parse(text) as SocialMatch;
  } catch (error) {
    console.error('Error finding social profiles:', error);
    return {};
  }
}
