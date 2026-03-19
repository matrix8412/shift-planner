"use server";

import { getCurrentUser } from "@/server/auth";
import { db } from "@/server/db/client";

/** 
 * Column preferences are stored as JSON on the User model:
 * { [moduleKey: string]: string[] }   – array of HIDDEN column keys per module
 */
export type ColumnPreferencesMap = Record<string, string[]>;

/**
 * Page-size preferences stored as JSON on the User model:
 * { [moduleKey: string]: number }   – rows-per-page per module
 */
export type PageSizePreferencesMap = Record<string, number>;

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

const allowedPageSizes = [5, 10, 15, 20, 25, 50];

export async function getPageSizePreferences(): Promise<PageSizePreferencesMap> {
  const user = await getCurrentUser();

  if (!user || user.isBootstrap) {
    return {};
  }

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { pageSizePreferences: true },
  });

  if (!dbUser?.pageSizePreferences || typeof dbUser.pageSizePreferences !== "object") {
    return {};
  }

  return dbUser.pageSizePreferences as PageSizePreferencesMap;
}

export async function savePageSizePreference(moduleKey: string, pageSize: number): Promise<void> {
  const user = await getCurrentUser();

  if (!user || user.isBootstrap) {
    return;
  }

  const safeSize = allowedPageSizes.includes(pageSize) ? pageSize : 10;

  const existing = await db.user.findUnique({
    where: { id: user.id },
    select: { pageSizePreferences: true },
  });

  const currentPrefs: PageSizePreferencesMap =
    existing?.pageSizePreferences && typeof existing.pageSizePreferences === "object"
      ? (existing.pageSizePreferences as PageSizePreferencesMap)
      : {};

  const updatedPrefs = { ...currentPrefs, [moduleKey]: safeSize };

  await db.user.update({
    where: { id: user.id },
    data: { pageSizePreferences: updatedPrefs },
  });
}
