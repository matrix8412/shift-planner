import { AccessDenied } from "@/components/access-denied";
import { EntityModule } from "@/components/entity-module";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";
import { createUserAction, deleteUserAction, importUsersCsvAction, updateUserAction } from "@/server/actions/records";
import { getUsersModule } from "@/server/read-models/modules";
import { getColumnPreferences, getPageSizePreferences } from "@/server/actions/column-preferences";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const [moduleConfig, currentUser, columnPrefs, pageSizePrefs] = await Promise.all([getUsersModule(), getCurrentUser(), getColumnPreferences(), getPageSizePreferences()]);
  const access = getModuleAccess(currentUser, "users");

  if (!access.canView) {
    return <AccessDenied />;
  }

  return (
    <EntityModule
      {...moduleConfig}
      moduleKey="users"
      initialHiddenColumns={columnPrefs.users ?? []}
      initialPageSize={pageSizePrefs.users}
      action={createUserAction}
      editAction={updateUserAction}
      deleteAction={deleteUserAction}
      importAction={importUsersCsvAction}
      canCreate={access.canCreate}
      canEdit={access.canEdit}
      canDelete={access.canDelete}
      canImport={access.canImportExport}
      canExport={access.canImportExport}
    />
  );
}
