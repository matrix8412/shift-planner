import "server-only";

import { getModuleAccess, hasPermission, type SessionUser } from "@/server/auth/access";
import type { PermissionModuleKey } from "@/server/auth/permissions";

export const moduleRouteMap: Record<PermissionModuleKey, string> = {
  schedule: "/schedule",
  vacations: "/vacations",
  services: "/services",
  shifts: "/shifts",
  conditions: "/conditions",
  holidays: "/holidays",
  settings: "/settings",
  users: "/users",
  roles: "/roles",
};

export function getVisibleRoutes(user: SessionUser | null) {
  return Object.entries(moduleRouteMap)
    .filter(([module]) => getModuleAccess(user, module as PermissionModuleKey).canView)
    .map(([, href]) => href);
}

export function canAccessHomeShortcut(user: SessionUser | null, permission: `${PermissionModuleKey}:view`) {
  return hasPermission(user, permission);
}
