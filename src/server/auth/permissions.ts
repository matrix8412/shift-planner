import { db } from "@/server/db/client";

export const permissionModules = [
  {
    key: "schedule",
    label: "Schedule",
    permissions: [
      { action: "view", label: "View" },
      { action: "edit", label: "Edit records" },
      { action: "create", label: "Add a manual record" },
      { action: "delete", label: "Delete a record" },
      { action: "lock", label: "Lock / Unlock records" },
      { action: "generate", label: "Generate a schedule" },
      { action: "importExport", label: "Import / Export" },
    ],
  },
  {
    key: "vacations",
    label: "Vacations",
    permissions: [
      { action: "view", label: "View" },
      { action: "edit", label: "Edit records" },
      { action: "create", label: "Add a manual record" },
      { action: "delete", label: "Delete a record" },
      { action: "lock", label: "Lock / Unlock records" },
      { action: "importExport", label: "Import / Export" },
    ],
  },
  {
    key: "services",
    label: "Service types",
    permissions: [
      { action: "view", label: "View" },
      { action: "edit", label: "Edit records" },
      { action: "create", label: "Add a manual record" },
      { action: "delete", label: "Delete a record" },
      { action: "importExport", label: "Import / Export" },
    ],
  },
  {
    key: "shifts",
    label: "Change types",
    permissions: [
      { action: "view", label: "View" },
      { action: "edit", label: "Edit records" },
      { action: "create", label: "Add a manual record" },
      { action: "delete", label: "Delete a record" },
      { action: "importExport", label: "Import / Export" },
    ],
  },
  {
    key: "conditions",
    label: "Conditions",
    permissions: [
      { action: "view", label: "View" },
      { action: "edit", label: "Edit records" },
      { action: "create", label: "Add a manual record" },
      { action: "delete", label: "Delete a record" },
      { action: "importExport", label: "Import / Export" },
    ],
  },
  {
    key: "holidays",
    label: "Holidays",
    permissions: [
      { action: "view", label: "View" },
      { action: "edit", label: "Edit records" },
      { action: "create", label: "Add a manual record" },
      { action: "delete", label: "Delete a record" },
      { action: "importExport", label: "Import / Export" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    permissions: [
      { action: "view", label: "View" },
      { action: "edit", label: "Edit records" },
      { action: "create", label: "Add a record" },
      { action: "importExport", label: "Import / Export" },
    ],
  },
  {
    key: "users",
    label: "Users",
    permissions: [
      { action: "view", label: "View" },
      { action: "edit", label: "Edit records" },
      { action: "create", label: "Add a manual record" },
      { action: "delete", label: "Delete a record" },
      { action: "importExport", label: "Import / Export" },
    ],
  },
  {
    key: "roles",
    label: "Roles",
    permissions: [
      { action: "view", label: "View" },
      { action: "edit", label: "Edit records" },
      { action: "create", label: "Add a manual record" },
      { action: "delete", label: "Delete a record" },
      { action: "importExport", label: "Import / Export" },
    ],
  },
] as const;

export type PermissionModuleKey = (typeof permissionModules)[number]["key"];
export type PermissionActionKey = (typeof permissionModules)[number]["permissions"][number]["action"];

export type PermissionDefinition = {
  code: PermissionCode;
  module: PermissionModuleKey;
  moduleLabel: string;
  action: PermissionActionKey;
  label: string;
  description?: string;
};

export const permissionDefinitions = permissionModules.flatMap((moduleDefinition) =>
  moduleDefinition.permissions.map(
    (permissionDefinition) =>
      ({
        code: `${moduleDefinition.key}:${permissionDefinition.action}`,
        module: moduleDefinition.key,
        moduleLabel: moduleDefinition.label,
        action: permissionDefinition.action,
        label: permissionDefinition.label,
        description: "description" in permissionDefinition ? (permissionDefinition.description as string) : undefined,
      }) as const,
  ),
);

export const permissionCatalog = permissionDefinitions.map((definition) => definition.code);

export type PermissionCode = (typeof permissionDefinitions)[number]["code"];

export type PermissionMatrixSection = {
  key: PermissionModuleKey;
  label: string;
  permissions: Array<{
    code: PermissionCode;
    label: string;
    description?: string;
  }>;
};

let ensurePermissionCatalogPromise: Promise<void> | null = null;

export function getPermissionDefinitionMap() {
  return new Map(permissionDefinitions.map((definition) => [definition.code, definition] as const));
}

export function getPermissionMatrixSections(): PermissionMatrixSection[] {
  return permissionModules.map((moduleDefinition) => ({
    key: moduleDefinition.key,
    label: moduleDefinition.label,
    permissions: moduleDefinition.permissions.map((permissionDefinition) => ({
      code: `${moduleDefinition.key}:${permissionDefinition.action}` as PermissionCode,
      label: permissionDefinition.label,
      description: "description" in permissionDefinition ? (permissionDefinition.description as string) : undefined,
    })),
  }));
}

export async function ensurePermissionCatalog() {
  if (!ensurePermissionCatalogPromise) {
    ensurePermissionCatalogPromise = (async () => {
      const existingPermissions = await db.permission.findMany({
        select: {
          code: true,
        },
      });
      const existingPermissionCodes = new Set(existingPermissions.map((permission) => permission.code));

      await Promise.all(
        permissionDefinitions.map((definition) =>
          existingPermissionCodes.has(definition.code)
            ? db.permission.update({
                where: {
                  code: definition.code,
                },
                data: {
                  module: definition.module,
                  action: definition.action,
                  description: definition.description ?? `${definition.moduleLabel}: ${definition.label}`,
                },
              })
            : db.permission.create({
                data: {
                  code: definition.code,
                  module: definition.module,
                  action: definition.action,
                  description: definition.description ?? `${definition.moduleLabel}: ${definition.label}`,
                },
              }),
        ),
      );
    })().catch((error) => {
      ensurePermissionCatalogPromise = null;
      throw error;
    });
  }

  await ensurePermissionCatalogPromise;
}
