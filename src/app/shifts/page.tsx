import { AccessDenied } from "@/components/access-denied";
import { EntityModule } from "@/components/entity-module";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { createShiftAction, deleteShiftAction, importShiftsCsvAction, updateShiftAction } from "@/server/actions/records";
import { getShiftsModule } from "@/server/read-models/modules";
import { getColumnPreferences } from "@/server/actions/column-preferences";

export const dynamic = "force-dynamic";

export default async function ShiftsPage() {
  const [moduleConfig, currentUser, columnPrefs] = await Promise.all([getShiftsModule(), getCurrentUser(), getColumnPreferences()]);
  const access = getModuleAccess(currentUser, "shifts");

  if (!access.canView) {
    return <AccessDenied />;
  }

  return (
    <EntityModule
      {...moduleConfig}
      moduleKey="shifts"
      initialHiddenColumns={columnPrefs.shifts ?? []}
      action={createShiftAction}
      editAction={updateShiftAction}
      deleteAction={deleteShiftAction}
      importAction={importShiftsCsvAction}
      canCreate={access.canCreate}
      canEdit={access.canEdit}
      canDelete={access.canDelete}
      canImport={access.canImportExport}
      canExport={access.canImportExport}
    />
  );
}
