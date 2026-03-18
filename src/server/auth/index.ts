import "server-only";

import type { SessionUser } from "@/server/auth/access";
import { ensurePermissionCatalog, permissionCatalog, type PermissionCode } from "@/server/auth/permissions";
import { getSessionUserId } from "@/server/auth/session";
import { db } from "@/server/db/client";

function resolveEffectivePermissions(parameters: {
  rolePermissionCodes: string[];
  userOverrides: Array<{
    permissionCode: string;
    enabled: boolean;
  }>;
}) {
  const effectivePermissions = new Set<PermissionCode>(
    parameters.rolePermissionCodes.filter((code): code is PermissionCode => permissionCatalog.includes(code as PermissionCode)),
  );

  for (const override of parameters.userOverrides) {
    if (!permissionCatalog.includes(override.permissionCode as PermissionCode)) {
      continue;
    }

    const code = override.permissionCode as PermissionCode;

    if (override.enabled) {
      effectivePermissions.add(code);
    } else {
      effectivePermissions.delete(code);
    }
  }

  return Array.from(effectivePermissions);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  await ensurePermissionCatalog();

  const sessionUserId = await getSessionUserId();

  if (!sessionUserId) {
    return null;
  }

  const user = await db.user.findUnique({
    where: { id: sessionUserId, isActive: true },
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
      permissionOverrides: {
        include: {
          permission: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const effectivePermissions = resolveEffectivePermissions({
    rolePermissionCodes: user.role?.permissions.map((assignment) => assignment.permission.code) ?? [],
    userOverrides: user.permissionOverrides.map((override) => ({
      permissionCode: override.permission.code,
      enabled: override.enabled,
    })),
  });

  if (effectivePermissions.length === 0) {
    return {
      id: user.id,
      email: user.email,
      roleCode: user.role?.code ?? null,
      permissions: [...permissionCatalog],
      isBootstrap: true,
    };
  }

  return {
    id: user.id,
    email: user.email,
    roleCode: user.role?.code ?? null,
    permissions: effectivePermissions,
  };
}
