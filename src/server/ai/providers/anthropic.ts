import Anthropic from "@anthropic-ai/sdk";

import type { AiProvider, ScheduleDraftInput, ScheduleDraftOutput } from "@/server/ai/contracts";
import { buildScheduleGenerationPrompt, getScheduleGenerationSystemPrompt, parseScheduleGenerationResponse } from "@/server/ai/schedule-generation";

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateScheduleDraft(input: ScheduleDraftInput): Promise<ScheduleDraftOutput> {
    const response = await this.client.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 8192,
      system: getScheduleGenerationSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildScheduleGenerationPrompt(input),
        },
      ],
    });
    const content = response.content
      .map((item) => (item.type === "text" ? item.text : ""))
      .filter((item) => item.length > 0)
      .join("\n")
      .trim();

    if (!content) {
      throw new Error("Anthropic returned an empty schedule response.");
    }

    return parseScheduleGenerationResponse(content);
  }
}
