"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";

import { hashPassword } from "@/server/auth/password";
import { ensurePermissionCatalog } from "@/server/auth/permissions";
import { createSession } from "@/server/auth/session";
import { db } from "@/server/db/client";

/* ── Validation ──────────────────────────────────────────────── */

const userFieldsSchema = z.object({
  email: z.string().trim().email("Enter a valid email.").transform((v: string) => v.toLowerCase()),
  firstName: z.string().trim().min(1, "First name is required.").max(120),
  lastName: z.string().trim().min(1, "Last name is required.").max(120),
  password: z.string().min(8, "Password must be at least 8 characters."),
  passwordConfirm: z.string().min(1, "Confirm your password."),
});

/* ── Types ───────────────────────────────────────────────────── */

export type SetupActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export type SetupRole = {
  id: string;
  code: string;
  name: string;
};

/* ── Helpers ─────────────────────────────────────────────────── */

/** Return roles that already exist in the DB (for the wizard picker). */
export async function getExistingRoles(): Promise<SetupRole[]> {
  return db.role.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function isSetupRequired(): Promise<boolean> {
  const count = await db.user.count();
  return count === 0;
}

/* ── Main action ─────────────────────────────────────────────── */

export async function setupWizardAction(
  _prev: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  // Guard: only works when no users exist
  const userCount = await db.user.count();

  if (userCount > 0) {
    return {
      status: "error",
      message: "Setup has already been completed. A user already exists.",
    };
  }

  // ── Determine role mode (existing vs. new) ────────────────
  const roleMode = formData.get("roleMode") as string; // "existing" | "new"
  const existingRoleId = formData.get("existingRoleId") as string | null;
  const newRoleCode = (formData.get("roleCode") as string ?? "").trim();
  const newRoleName = (formData.get("roleName") as string ?? "").trim();

  if (roleMode === "existing") {
    if (!existingRoleId) {
      return {
        status: "error",
        fieldErrors: { existingRoleId: ["Select a role."] },
      };
    }
  } else {
    // "new" role — validate code + name
    if (!newRoleCode) {
      return {
        status: "error",
        fieldErrors: { roleCode: ["Role code is required."] },
      };
    }

    if (!newRoleName) {
      return {
        status: "error",
        fieldErrors: { roleName: ["Role name is required."] },
      };
    }

    // Check uniqueness of code
    const duplicate = await db.role.findUnique({ where: { code: newRoleCode } });

    if (duplicate) {
      return {
        status: "error",
        fieldErrors: { roleCode: ["A role with this code already exists."] },
      };
    }
  }

  // ── Validate user fields ──────────────────────────────────
  const parsed = userFieldsSchema.safeParse({
    email: formData.get("email"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);

      if (!fieldErrors[key]) {
        fieldErrors[key] = [];
      }

      fieldErrors[key].push(issue.message);
    }

    return { status: "error", fieldErrors };
  }

  if (parsed.data.password !== parsed.data.passwordConfirm) {
    return {
      status: "error",
      fieldErrors: { passwordConfirm: ["Passwords do not match."] },
    };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await ensurePermissionCatalog();

  const allPermissions = await db.permission.findMany({ select: { id: true } });

  const userId = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    let roleId: string;

    if (roleMode === "existing" && existingRoleId) {
      // Use the selected existing role — grant all permissions
      roleId = existingRoleId;
    } else {
      // Create a new role
      const role = await tx.role.create({
        data: {
          code: newRoleCode,
          name: newRoleName,
          description: "Super administrator created during initial setup.",
        },
      });

      roleId = role.id;
    }

    // Ensure the role has all permissions
    await tx.rolePermission.deleteMany({ where: { roleId } });

    await tx.rolePermission.createMany({
      data: allPermissions.map((permission: { id: string }) => ({
        roleId,
        permissionId: permission.id,
      })),
    });

    // Create the admin user
    const user = await tx.user.create({
      data: {
        email: parsed.data.email,
        passwordHash,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        isActive: true,
        roleId,
      },
    });

    return user.id;
  });

  await createSession(userId);
  redirect("/");

  // redirect() throws — unreachable but satisfies TypeScript
  return { status: "success" as const };
}
