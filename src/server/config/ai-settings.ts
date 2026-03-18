import "server-only";

import { z } from "zod";

import { env } from "@/server/config/env";
import { AI_SETTINGS_KEY } from "@/server/config/managed-settings";
import { db } from "@/server/db/client";

const aiSettingsSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]).default("openai"),
  openAiApiKey: z.string().default(""),
  anthropicApiKey: z.string().default(""),
  googleApiKey: z.string().default(""),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

const defaultAiSettings: AiSettings = {
  provider: env.AI_PROVIDER,
  openAiApiKey: env.OPENAI_API_KEY ?? "",
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
  googleApiKey: env.GOOGLE_API_KEY ?? "",
};

export async function getAiSettings(): Promise<AiSettings> {
  let setting = null;

  try {
    setting = await db.appSetting.findUnique({
      where: {
        key: AI_SETTINGS_KEY,
      },
    });
  } catch {
    return defaultAiSettings;
  }

  if (!setting) {
    return defaultAiSettings;
  }

  const parsed = aiSettingsSchema.safeParse(setting.value);
  if (!parsed.success) {
    return defaultAiSettings;
  }

  return {
    provider: parsed.data.provider,
    openAiApiKey: parsed.data.openAiApiKey.trim(),
    anthropicApiKey: parsed.data.anthropicApiKey.trim(),
    googleApiKey: parsed.data.googleApiKey.trim(),
  };
}

export { aiSettingsSchema, defaultAiSettings };
