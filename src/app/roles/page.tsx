import { AccessDenied } from "@/components/access-denied";
import { EntityModule } from "@/components/entity-module";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { createRoleAction, deleteRoleAction, importRolesCsvAction, updateRoleAction } from "@/server/actions/records";
import { getRolesModule } from "@/server/read-models/modules";
import { getColumnPreferences, getPageSizePreferences } from "@/server/actions/column-preferences";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const [moduleConfig, currentUser, columnPrefs, pageSizePrefs] = await Promise.all([getRolesModule(), getCurrentUser(), getColumnPreferences(), getPageSizePreferences()]);
  const access = getModuleAccess(currentUser, "roles");

  if (!access.canView) {
    return <AccessDenied />;
  }

  return (
    <EntityModule
      {...moduleConfig}
      moduleKey="roles"
      initialHiddenColumns={columnPrefs.roles ?? []}
      initialPageSize={pageSizePrefs.roles}
      action={createRoleAction}
      editAction={updateRoleAction}
      deleteAction={deleteRoleAction}
      importAction={importRolesCsvAction}
      canCreate={access.canCreate}
      canEdit={access.canEdit}
      canDelete={access.canDelete}
      canImport={access.canImportExport}
      canExport={access.canImportExport}
    />
  );
}
