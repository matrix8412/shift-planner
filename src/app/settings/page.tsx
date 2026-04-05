import { AiAuditLogCard } from "@/components/ai-audit-log-card";
import { AiSettingsCard } from "@/components/ai-settings-card";
import { HttpsSettingsCard } from "@/components/https-settings-card";
import { AccessDenied } from "@/components/access-denied";
import { NotificationSettingsCard } from "@/components/notification-settings-card";
import { SettingsTabs } from "@/components/settings-tabs";
import {
  sendNotificationTestAction,
  upsertAiSettingsAction,
  upsertAiAuditRetentionAction,
  upsertNotificationSettingsAction,
  upsertHttpsSettingsAction,
} from "@/server/actions/records";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { getAiSettings } from "@/server/config/ai-settings";
import { AI_AUDIT_RETENTION_DAYS_KEY, DEFAULT_AI_AUDIT_RETENTION_DAYS } from "@/server/config/ai-audit-retention";
import { getNotificationSettings } from "@/server/config/notification-settings";
import { getHttpsSettings } from "@/server/config/https-settings";
import { getShellProfile } from "@/server/config/app-shell";
import { getAiAuditRuns } from "@/server/read-models/modules";
import { env } from "@/server/config/env";
import { db } from "@/server/db/client";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const currentUser = await getCurrentUser();
  const [notificationSettings, aiSettings, httpsSettings, shellProfile, aiAuditRuns] = await Promise.all([
    getNotificationSettings(),
    getAiSettings(),
    getHttpsSettings(),
    getShellProfile(currentUser!.id),
    getAiAuditRuns(),
  ]);
  const access = getModuleAccess(currentUser, "settings");

  if (!access.canView) {
    return <AccessDenied />;
  }

  let retentionDays = DEFAULT_AI_AUDIT_RETENTION_DAYS;
  try {
    const setting = await db.appSetting.findUnique({ where: { key: AI_AUDIT_RETENTION_DAYS_KEY } });
    if (setting && typeof setting.value === "number" && setting.value >= 1) {
      retentionDays = Math.round(setting.value as number);
    }
  } catch { /* use default */ }

  const appUrl = new URL(env.APP_URL);
  const requestHeaders = await headers();
  const hostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? appUrl.hostname;
  const appDomain = hostHeader.split(":")[0];

  return (
    <SettingsTabs
      appearanceContent={null}
      notificationsContent={
        <NotificationSettingsCard
          settings={notificationSettings}
          profile={shellProfile}
          saveAction={upsertNotificationSettingsAction}
          testAction={sendNotificationTestAction}
          readOnly={!access.canEdit}
        />
      }
      aiContent={
        <>
          <AiSettingsCard
            key={`${aiSettings.provider}-${aiSettings.openAiApiKey.length > 0 ? "openai" : "no-openai"}-${aiSettings.anthropicApiKey.length > 0 ? "anthropic" : "no-anthropic"}-${aiSettings.googleApiKey.length > 0 ? "gemini" : "no-gemini"}`}
            settings={aiSettings}
            action={upsertAiSettingsAction}
            readOnly={!access.canEdit}
          />
          <AiAuditLogCard
            runs={aiAuditRuns}
            retentionDays={retentionDays}
            retentionAction={upsertAiAuditRetentionAction}
            readOnly={!access.canEdit}
          />
        </>
      }
      httpsContent={
        <HttpsSettingsCard
          settings={httpsSettings}
          appDomain={appDomain}
          action={upsertHttpsSettingsAction}
          readOnly={!access.canEdit}
        />
      }
    />
  );
}
