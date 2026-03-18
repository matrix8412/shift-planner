import "server-only";

import type { NotificationEmailSettings } from "@/server/config/notification-settings";

export type NotificationTemplateVariables = Record<string, string>;

const templateVariablePattern = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderNotificationTemplate(template: string, variables: NotificationTemplateVariables) {
  return template.replace(templateVariablePattern, (_match, variableName: string) => variables[variableName] ?? "");
}

export function buildNotificationTemplateVariables(input: {
  recipientName: string;
  recipientEmail: string;
  title: string;
  message: string;
  actionUrl?: string;
  appName?: string;
  channel: "email" | "push" | "toast";
  entityType?: string;
  entityLabel?: string;
  emailSettings?: NotificationEmailSettings;
}) {
  return {
    recipient_name: input.recipientName,
    recipient_email: input.recipientEmail,
    notification_title: input.title,
    notification_message: input.message,
    action_url: input.actionUrl ?? "",
    app_name: input.appName ?? "Pohotovosti",
    channel: input.channel,
    entity_type: input.entityType ?? "",
    entity_label: input.entityLabel ?? "",
    current_year: String(new Date().getUTCFullYear()),
    accent_color: input.emailSettings?.accentColor ?? "#0d6b73",
  } satisfies NotificationTemplateVariables;
}
