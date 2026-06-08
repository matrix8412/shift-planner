import { GoogleGenerativeAI } from "@google/generative-ai";

import type { AiProvider, ScheduleDraftInput, ScheduleDraftOutput } from "@/server/ai/contracts";
import { buildScheduleGenerationPrompt, getScheduleGenerationSystemPrompt, parseScheduleGenerationResponse } from "@/server/ai/schedule-generation";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;
  private readonly client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generateScheduleDraft(input: ScheduleDraftInput): Promise<ScheduleDraftOutput> {
    const model = this.client.getGenerativeModel({
      model: DEFAULT_GEMINI_MODEL,
      systemInstruction: getScheduleGenerationSystemPrompt(),
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(buildScheduleGenerationPrompt(input));
    const content = result.response.text().trim();

    if (!content) {
      throw new Error("Gemini returned an empty schedule response.");
    }

    return parseScheduleGenerationResponse(content);
  }
}
