import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { UserFormData, PollingInfo } from "../types";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey || apiKey === "undefined" || apiKey === "") {
  console.error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
}

const ai = new GoogleGenAI({ apiKey: apiKey || "" });

export async function getVoterInformation(userData: UserFormData, googleCivicData?: any): Promise<PollingInfo> {
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    throw new Error("Gemini API key is not configured. If you are running standalone, please set the GEMINI_API_KEY environment variable.");
  }
  const civicContext = googleCivicData ? `
    Additional context from Google Civic Information API:
    ${JSON.stringify(googleCivicData, null, 2)}
  ` : '';

  const prompt = `
    Find polling places and election ballot items for a voter with the following details:
    Name: ${userData.firstName} ${userData.lastName}
    Address: ${userData.streetAddress}, ${userData.city}, ${userData.state} ${userData.zipCode}
    County: ${userData.county}
    Precinct: ${userData.precinct}

    ${civicContext}

    Please provide:
    1. The exact polling place assigned to this specific voter. If the Google Civic data provides a polling location, prioritize it but verify if it's current.
    2. A detailed section for "Contests and Candidates" listing who is running for office (e.g., President, Senate, House, Local offices) and key candidate information.
    3. A summary of other ballot items like propositions or measures.
    
    Format the response clearly with separate sections for "Polling Locations" and "Contests & Candidates".
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "No information found.";
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    
    const sources = chunks
      .filter(chunk => chunk.web)
      .map(chunk => ({
        uri: chunk.web!.uri,
        title: chunk.web!.title || chunk.web!.uri
      }));

    // Simple splitting logic based on common headings
    const sections = text.split(/#+\s*(?:Contests|Candidates)/i);
    const pollingPlaces = sections[0] || text;
    const contests = sections.length > 1 ? sections[1] : "";

    return {
      pollingPlaces: pollingPlaces,
      ballotItems: "", 
      contests: contests,
      sources: sources
    };
  } catch (error) {
    console.error("Error fetching voter information:", error);
    throw new Error("Failed to fetch voter information. Please try again.");
  }
}
