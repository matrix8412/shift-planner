import { AiSettingsCard } from "@/components/ai-settings-card";
import { AccessDenied } from "@/components/access-denied";
import { EntityModule } from "@/components/entity-module";
import { NotificationSettingsCard } from "@/components/notification-settings-card";
import { SettingsTabs } from "@/components/settings-tabs";
import { SettingsJsonHelp } from "@/components/settings-json-help";
import {
  createSettingAction,
  deleteSettingAction,
  importSettingsCsvAction,
  sendNotificationTestAction,
  updateSettingAction,
  upsertAiSettingsAction,
  upsertNotificationSettingsAction,
} from "@/server/actions/records";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { getAiSettings } from "@/server/config/ai-settings";
import { getNotificationSettings } from "@/server/config/notification-settings";
import { getShellProfile } from "@/server/config/app-shell";
import { getSettingsModule } from "@/server/read-models/modules";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const currentUser = await getCurrentUser();
  const [moduleConfig, notificationSettings, aiSettings, shellProfile] = await Promise.all([
    getSettingsModule(),
    getNotificationSettings(),
    getAiSettings(),
    getShellProfile(currentUser!.id),
  ]);
  const access = getModuleAccess(currentUser, "settings");

  if (!access.canView) {
    return <AccessDenied />;
  }

  return (
    <SettingsTabs
      systemContent={
        <EntityModule
          {...moduleConfig}
          action={createSettingAction}
          editAction={updateSettingAction}
          deleteAction={deleteSettingAction}
          importAction={importSettingsCsvAction}
          headerActions={<SettingsJsonHelp />}
          hideHeader
          canCreate={access.canCreate}
          canEdit={access.canEdit}
          canDelete={access.canEdit}
          canImport={access.canImportExport}
          canExport={access.canImportExport}
        />
      }
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
        <AiSettingsCard
          key={`${aiSettings.provider}-${aiSettings.openAiApiKey.length > 0 ? "openai" : "no-openai"}-${aiSettings.anthropicApiKey.length > 0 ? "anthropic" : "no-anthropic"}-${aiSettings.googleApiKey.length > 0 ? "gemini" : "no-gemini"}`}
          settings={aiSettings}
          action={upsertAiSettingsAction}
          readOnly={!access.canEdit}
        />
      }
    />
  );
}
