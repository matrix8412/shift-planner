import "server-only";

import { z } from "zod";

import { HTTPS_SETTINGS_KEY } from "@/server/config/managed-settings";
import { db } from "@/server/db/client";

const httpsSettingsSchema = z.object({
  acmeEmail: z.string().trim().email("Enter a valid email address.").or(z.literal("")).default(""),
  httpPort: z.number().int().min(1, "Port must be at least 1.").max(65535, "Port cannot exceed 65535.").default(80),
  httpsPort: z.number().int().min(1, "Port must be at least 1.").max(65535, "Port cannot exceed 65535.").default(443),
  renewIntervalHours: z.number().int().min(1, "Renewal interval must be at least 1 hour.").max(168, "Renewal interval cannot exceed 168 hours (7 days).").default(12),
});

export type HttpsSettings = z.infer<typeof httpsSettingsSchema>;

export const defaultHttpsSettings: HttpsSettings = httpsSettingsSchema.parse({});

export async function getHttpsSettings(): Promise<HttpsSettings> {
  let setting = null;

  try {
    setting = await db.appSetting.findUnique({
      where: { key: HTTPS_SETTINGS_KEY },
    });
  } catch {
    return defaultHttpsSettings;
  }

  if (!setting) {
    return defaultHttpsSettings;
  }

  const parsed = httpsSettingsSchema.safeParse(setting.value);
  if (!parsed.success) {
    return defaultHttpsSettings;
  }

  return parsed.data;
}

export { httpsSettingsSchema };
