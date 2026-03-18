import { AccessDenied } from "@/components/access-denied";
import { EntityModule } from "@/components/entity-module";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { createServiceAction, deleteServiceAction, importServicesCsvAction, updateServiceAction } from "@/server/actions/records";
import { getServicesModule } from "@/server/read-models/modules";
import { getColumnPreferences } from "@/server/actions/column-preferences";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const [moduleConfig, currentUser, columnPrefs] = await Promise.all([getServicesModule(), getCurrentUser(), getColumnPreferences()]);
  const access = getModuleAccess(currentUser, "services");

  if (!access.canView) {
    return <AccessDenied />;
  }

  return (
    <EntityModule
      {...moduleConfig}
      moduleKey="services"
      initialHiddenColumns={columnPrefs.services ?? []}
      action={createServiceAction}
      editAction={updateServiceAction}
      deleteAction={deleteServiceAction}
      importAction={importServicesCsvAction}
      canCreate={access.canCreate}
      canEdit={access.canEdit}
      canDelete={access.canDelete}
      canImport={access.canImportExport}
      canExport={access.canImportExport}
    />
  );
}
