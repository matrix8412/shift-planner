"use server";

import { getCurrentUser } from "@/server/auth";
import { db } from "@/server/db/client";

/** 
 * Column preferences are stored as JSON on the User model:
 * { [moduleKey: string]: string[] }   – array of HIDDEN column keys per module
 */
export type ColumnPreferencesMap = Record<string, string[]>;

export async function getColumnPreferences(): Promise<ColumnPreferencesMap> {
  const user = await getCurrentUser();

  if (!user || user.isBootstrap) {
    return {};
  }

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { columnPreferences: true },
  });

  if (!dbUser?.columnPreferences || typeof dbUser.columnPreferences !== "object") {
    return {};
  }

  return dbUser.columnPreferences as ColumnPreferencesMap;
}

export async function saveColumnPreferences(moduleKey: string, hiddenColumns: string[]): Promise<void> {
  const user = await getCurrentUser();

  if (!user || user.isBootstrap) {
    return;
  }

  const existing = await db.user.findUnique({
    where: { id: user.id },
    select: { columnPreferences: true },
  });

  const currentPrefs: ColumnPreferencesMap =
    existing?.columnPreferences && typeof existing.columnPreferences === "object"
      ? (existing.columnPreferences as ColumnPreferencesMap)
      : {};

  const updatedPrefs = { ...currentPrefs, [moduleKey]: hiddenColumns };

  await db.user.update({
    where: { id: user.id },
    data: { columnPreferences: updatedPrefs },
  });
}
