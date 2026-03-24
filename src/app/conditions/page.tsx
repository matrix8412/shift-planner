import { AccessDenied } from "@/components/access-denied";
import { ConditionsAiHelp } from "@/components/conditions-ai-help";
import { EntityModule } from "@/components/entity-module";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { createConditionAction, deleteConditionAction, importConditionsCsvAction, updateConditionAction } from "@/server/actions/records";
import { getConditionsModule } from "@/server/read-models/modules";
import { getColumnPreferences, getPageSizePreferences } from "@/server/actions/column-preferences";

export const dynamic = "force-dynamic";

export default async function ConditionsPage() {
  const [moduleConfig, currentUser, columnPrefs, pageSizePrefs] = await Promise.all([getConditionsModule(), getCurrentUser(), getColumnPreferences(), getPageSizePreferences()]);
  const access = getModuleAccess(currentUser, "conditions");

  if (!access.canView) {
    return <AccessDenied />;
  }

  return (
    <EntityModule
      {...moduleConfig}
      moduleKey="conditions"
      initialHiddenColumns={columnPrefs.conditions ?? []}
      initialPageSize={pageSizePrefs.conditions}
      action={createConditionAction}
      editAction={updateConditionAction}
      deleteAction={deleteConditionAction}
      importAction={importConditionsCsvAction}
      canCreate={access.canCreate}
      canEdit={access.canEdit}
      canDelete={access.canDelete}
      canImport={access.canImportExport}
      canExport={access.canImportExport}
      headerActions={<ConditionsAiHelp />}
    />
  );
}
