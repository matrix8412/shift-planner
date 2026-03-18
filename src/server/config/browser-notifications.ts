import { z } from "zod";

import { defaultNotificationSettings, getNotificationSettings } from "@/server/config/notification-settings";

const browserNotificationSettingsSchema = z.object({
  position: z.enum(["top-right", "top-left", "bottom-right", "bottom-left"]).default(defaultNotificationSettings.toast.position),
  opacity: z.number().min(0.35).max(1).default(defaultNotificationSettings.toast.opacity),
  durationMs: z.number().int().min(2000).max(15000).default(defaultNotificationSettings.toast.durationMs),
  backgroundLight: z.string().default(defaultNotificationSettings.toast.backgroundLight),
  textLight: z.string().default(defaultNotificationSettings.toast.textLight),
  borderLight: z.string().default(defaultNotificationSettings.toast.borderLight),
  backgroundDark: z.string().default(defaultNotificationSettings.toast.backgroundDark),
  textDark: z.string().default(defaultNotificationSettings.toast.textDark),
  borderDark: z.string().default(defaultNotificationSettings.toast.borderDark),
});

export type BrowserNotificationSettings = z.infer<typeof browserNotificationSettingsSchema>;

const defaultBrowserNotificationSettings: BrowserNotificationSettings = browserNotificationSettingsSchema.parse(defaultNotificationSettings.toast);

export async function getBrowserNotificationSettings(): Promise<BrowserNotificationSettings> {
  const settings = await getNotificationSettings();
  return browserNotificationSettingsSchema.parse(settings.toast);
}

export { browserNotificationSettingsSchema, defaultBrowserNotificationSettings };
