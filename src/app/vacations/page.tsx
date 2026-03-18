import { AccessDenied } from "@/components/access-denied";
import { EntityModule } from "@/components/entity-module";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { createVacationAction, deleteVacationAction, importVacationsCsvAction, toggleVacationLockAction, updateVacationAction } from "@/server/actions/records";
import { getVacationsModule } from "@/server/read-models/modules";
import { getColumnPreferences } from "@/server/actions/column-preferences";

export const dynamic = "force-dynamic";

export default async function VacationsPage() {
  const [moduleConfig, currentUser, columnPrefs] = await Promise.all([getVacationsModule(), getCurrentUser(), getColumnPreferences()]);
  const access = getModuleAccess(currentUser, "vacations");

  if (!access.canView) {
    return <AccessDenied />;
  }

  return (
    <EntityModule
      {...moduleConfig}
      moduleKey="vacations"
      initialHiddenColumns={columnPrefs.vacations ?? []}
      action={createVacationAction}
      editAction={updateVacationAction}
      deleteAction={deleteVacationAction}
      importAction={importVacationsCsvAction}
      toggleLockAction={toggleVacationLockAction}
      canCreate={access.canCreate}
      canEdit={access.canEdit}
      canDelete={access.canDelete}
      canImport={access.canImportExport}
      canExport={access.canImportExport}
      canToggleLock={access.canEdit}
    />
  );
}
