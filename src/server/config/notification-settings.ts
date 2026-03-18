import "server-only";

import { z } from "zod";

import { env } from "@/server/config/env";
import { NOTIFICATION_SETTINGS_KEY } from "@/server/config/managed-settings";
import { db } from "@/server/db/client";

const hexColorSchema = z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a valid hex color.");
const toastPositionSchema = z.enum(["top-right", "top-left", "bottom-right", "bottom-left"]);

const notificationSettingsSchema = z.object({
  toast: z.object({
    position: toastPositionSchema.default("top-right"),
    opacity: z.number().min(0.35).max(1).default(0.94),
    durationMs: z.number().int().min(2000).max(15000).default(4200),
    backgroundLight: hexColorSchema.default("#ffffff"),
    textLight: hexColorSchema.default("#17353c"),
    borderLight: hexColorSchema.default("#cae0e4"),
    backgroundDark: hexColorSchema.default("#0c141c"),
    textDark: hexColorSchema.default("#f4fbfb"),
    borderDark: hexColorSchema.default("#294652"),
  }).default({}),
  push: z.object({
    enabled: z.boolean().default(false),
    vapidPublicKey: z.string().trim().default(""),
    vapidPrivateKey: z.string().trim().default(""),
    subject: z.string().trim().default(env.APP_URL),
    iconUrl: z.string().trim().default("/icons/192"),
    badgeUrl: z.string().trim().default("/icons/192"),
  }).default({}),
  email: z.object({
    enabled: z.boolean().default(false),
    fromName: z.string().trim().min(1).max(120).default("Pohotovosti"),
    fromEmail: z.string().trim().email().default("noreply@pohotovosti.sk"),
    replyTo: z.string().trim().email().or(z.literal("")).default(""),
    accentColor: hexColorSchema.default("#0d6b73"),
    subjectTemplate: z.string().trim().min(1).max(240).default("{{notification_title}} | {{app_name}}"),
    htmlTemplate: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .default(
        [
          "<h1>{{notification_title}}</h1>",
          "<p>Ahoj {{recipient_name}},</p>",
          "<p>{{notification_message}}</p>",
          '<p><a href="{{action_url}}" style="color: {{accent_color}};">Otvorit v {{app_name}}</a></p>',
          "<p>{{app_name}} · {{current_year}}</p>",
        ].join(""),
      ),
    textTemplate: z
      .string()
      .trim()
      .min(1)
      .max(10000)
      .default(
        ["{{notification_title}}", "", "Ahoj {{recipient_name}},", "{{notification_message}}", "", "Otvorit: {{action_url}}", "", "{{app_name}} · {{current_year}}"].join(
          "\n",
        ),
      ),
  }).default({}),
});

const legacyBrowserNotificationSettingsSchema = z.object({
  position: toastPositionSchema.default("top-right"),
  opacity: z.number().min(0.35).max(1).default(0.94),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type NotificationToastSettings = NotificationSettings["toast"];
export type NotificationPushSettings = NotificationSettings["push"];
export type NotificationEmailSettings = NotificationSettings["email"];

export const defaultNotificationSettings: NotificationSettings = notificationSettingsSchema.parse({});

export async function getNotificationSettings(): Promise<NotificationSettings> {
  let setting = null;

  try {
    setting = await db.appSetting.findUnique({
      where: {
        key: NOTIFICATION_SETTINGS_KEY,
      },
    });
  } catch {
    return defaultNotificationSettings;
  }

  if (!setting) {
    return defaultNotificationSettings;
  }

  const parsed = notificationSettingsSchema.safeParse(setting.value);
  if (parsed.success) {
    return parsed.data;
  }

  const legacyParsed = legacyBrowserNotificationSettingsSchema.safeParse(setting.value);
  if (legacyParsed.success) {
    return {
      ...defaultNotificationSettings,
      toast: {
        ...defaultNotificationSettings.toast,
        position: legacyParsed.data.position,
        opacity: legacyParsed.data.opacity,
      },
    };
  }

  return defaultNotificationSettings;
}

export { notificationSettingsSchema, toastPositionSchema };
