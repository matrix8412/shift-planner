import "server-only";

import type { PermissionCode, PermissionModuleKey } from "@/server/auth/permissions";

export type SessionUser = {
  id: string;
  email: string;
  roleCode: string | null;
  permissions: PermissionCode[];
  isBootstrap?: boolean;
};

export type ModuleAccess = {
  module: PermissionModuleKey;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canImportExport: boolean;
  canGenerate: boolean;
};

export function hasPermission(user: SessionUser | null, permission: PermissionCode) {
  if (!user) {
    return false;
  }

  return user.permissions.includes(permission);
}

export function requirePermission(user: SessionUser | null, permission: PermissionCode) {
  if (!hasPermission(user, permission)) {
    throw new Error(`Missing permission: ${permission}`);
  }
}

export function getModuleAccess(user: SessionUser | null, module: PermissionModuleKey): ModuleAccess {
  return {
    module,
    canView: hasPermission(user, `${module}:view` as PermissionCode),
    canCreate: hasPermission(user, `${module}:create` as PermissionCode),
    canEdit: hasPermission(user, `${module}:edit` as PermissionCode),
    canDelete: hasPermission(user, `${module}:delete` as PermissionCode),
    canImportExport: hasPermission(user, `${module}:importExport` as PermissionCode),
    canGenerate: hasPermission(user, `${module}:generate` as PermissionCode),
  };
}
