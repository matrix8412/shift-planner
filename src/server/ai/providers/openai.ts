import OpenAI from "openai";

import type { AiProvider, ScheduleDraftInput, ScheduleDraftOutput } from "@/server/ai/contracts";
import { buildScheduleGenerationPrompt, getScheduleGenerationSystemPrompt, parseScheduleGenerationResponse } from "@/server/ai/schedule-generation";

export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generateScheduleDraft(input: ScheduleDraftInput): Promise<ScheduleDraftOutput> {
    const response = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: getScheduleGenerationSystemPrompt(),
        },
        {
          role: "user",
          content: buildScheduleGenerationPrompt(input),
        },
      ],
    });
    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI returned an empty schedule response.");
    }

    return parseScheduleGenerationResponse(content);
  }
}
