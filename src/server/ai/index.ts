import "server-only";

import type { AiProvider } from "@/server/ai/contracts";
import { AnthropicProvider } from "@/server/ai/providers/anthropic";
import { GeminiProvider } from "@/server/ai/providers/gemini";
import { OpenAiProvider } from "@/server/ai/providers/openai";
import { getAiSettings } from "@/server/config/ai-settings";

export async function createAiProvider(): Promise<AiProvider> {
  const settings = await getAiSettings();

  if (settings.provider === "anthropic") {
    if (!settings.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is missing.");
    }

    return new AnthropicProvider(settings.anthropicApiKey);
  }

  if (settings.provider === "gemini") {
    if (!settings.googleApiKey) {
      throw new Error("GOOGLE_API_KEY is missing.");
    }

    return new GeminiProvider(settings.googleApiKey);
  }

  if (!settings.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  return new OpenAiProvider(settings.openAiApiKey);
}
