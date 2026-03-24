import { AccessDenied } from "@/components/access-denied";
import { EntityModule } from "@/components/entity-module";
import { ScheduleGenerateAction } from "@/components/schedule-generate-action";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { createScheduleAction, deleteScheduleAction, generateScheduleAction, importScheduleCsvAction, moveScheduleEntryAction, toggleScheduleLockAction, bulkToggleScheduleLockAction, bulkDeleteScheduleAction, updateScheduleAction } from "@/server/actions/records";
import { getAiSettings } from "@/server/config/ai-settings";
import { getScheduleModule } from "@/server/read-models/modules";
import { getColumnPreferences, getPageSizePreferences } from "@/server/actions/column-preferences";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const [moduleConfig, aiSettings, currentUser, columnPrefs, pageSizePrefs] = await Promise.all([getScheduleModule(), getAiSettings(), getCurrentUser(), getColumnPreferences(), getPageSizePreferences()]);
  const access = getModuleAccess(currentUser, "schedule");

  if (!access.canView) {
    return <AccessDenied />;
  }

  return (
    <EntityModule
      {...moduleConfig}
      moduleKey="schedule"
      initialHiddenColumns={columnPrefs.schedule ?? []}
      initialPageSize={pageSizePrefs.schedule}
      action={createScheduleAction}
      editAction={updateScheduleAction}
      deleteAction={deleteScheduleAction}
      importAction={importScheduleCsvAction}
      toggleLockAction={toggleScheduleLockAction}
      bulkLockAction={bulkToggleScheduleLockAction}
      bulkDeleteAction={bulkDeleteScheduleAction}
      moveAction={moveScheduleEntryAction}
      canEdit={access.canEdit}
      canDelete={access.canDelete}
      canImport={access.canImportExport}
      canExport={access.canImportExport}
      canToggleLock={access.canToggleLock}
      primaryAction={
        access.canGenerate ? (
          <ScheduleGenerateAction
            action={generateScheduleAction}
            disabledReason={moduleConfig.createDisabledReason}
            provider={aiSettings.provider}
            initialMonth={moduleConfig.calendar?.initialMonth}
          />
        ) : null
      }
    />
  );
}
