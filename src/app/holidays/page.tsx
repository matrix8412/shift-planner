import { AccessDenied } from "@/components/access-denied";
import { EntityModule } from "@/components/entity-module";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { createHolidayAction, deleteHolidayAction, importHolidaysCsvAction, updateHolidayAction } from "@/server/actions/records";
import { getHolidaysModule } from "@/server/read-models/modules";
import { getColumnPreferences, getPageSizePreferences } from "@/server/actions/column-preferences";

export const dynamic = "force-dynamic";

export default async function HolidaysPage() {
  const [moduleConfig, currentUser, columnPrefs, pageSizePrefs] = await Promise.all([getHolidaysModule(), getCurrentUser(), getColumnPreferences(), getPageSizePreferences()]);
  const access = getModuleAccess(currentUser, "holidays");

  if (!access.canView) {
    return <AccessDenied />;
  }

  return (
    <EntityModule
      {...moduleConfig}
      moduleKey="holidays"
      initialHiddenColumns={columnPrefs.holidays ?? []}
      initialPageSize={pageSizePrefs.holidays}
      action={createHolidayAction}
      editAction={updateHolidayAction}
      deleteAction={deleteHolidayAction}
      importAction={importHolidaysCsvAction}
      canCreate={access.canCreate}
      canEdit={access.canEdit}
      canDelete={access.canDelete}
      canImport={access.canImportExport}
      canExport={access.canImportExport}
    />
  );
}
