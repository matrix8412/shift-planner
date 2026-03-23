"use server";

import { AiProviderKind, AiRunStatus, Prisma, ScheduleSource, VacationStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/components/entity-module.types";
import { createAiProvider } from "@/server/ai";
import { requirePermission } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth/index";
import { ensurePermissionCatalog, permissionCatalog, type PermissionCode } from "@/server/auth/permissions";
import { aiSettingsSchema, defaultAiSettings, getAiSettings } from "@/server/config/ai-settings";
import { defaultNotificationSettings, getNotificationSettings, notificationSettingsSchema } from "@/server/config/notification-settings";
import { AI_SETTINGS_KEY, BROWSER_NOTIFICATION_SETTINGS_KEY, NOTIFICATION_SETTINGS_KEY, isManagedSettingKey } from "@/server/config/managed-settings";
import { AI_AUDIT_RETENTION_DAYS_KEY, DEFAULT_AI_AUDIT_RETENTION_DAYS } from "@/server/config/ai-audit-retention";
import { db } from "@/server/db/client";
import { dispatchNotification } from "@/server/notifications";
import { buildShiftValidityFromFieldValues, getScheduleDayType, isShiftValidForDayType, parseShiftValidity, shiftValidityDefinitions } from "@/server/scheduling/shift-validity";
import { getDictionary, t as tr, getServerLocale } from "@/i18n";
import type { TranslationDictionary } from "@/i18n/types";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function successState(message: string, path: string): ActionState {
  revalidatePath(path, "layout");

  return {
    status: "success",
    message,
  };
}

function errorState(message: string, fieldErrors?: Record<string, string[]>): ActionState {
  return {
    status: "error",
    message,
    fieldErrors,
  };
}

function parseOptionalString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function parseStringArray(formData: FormData, name: string) {
  return Array.from(
    new Set(
      formData
        .getAll(name)
        .flatMap((value) => (typeof value === "string" ? [value.trim()] : []))
        .filter((value) => value.length > 0),
    ),
  );
}

type ParsedPermissionSelection =
  | {
      present: false;
      codes: [];
      deniedCodes: [];
    }
  | {
      present: true;
      codes: PermissionCode[];
      deniedCodes: PermissionCode[];
    };

function parsePermissionSelection(formData: FormData, name = "permissionCodes"): ParsedPermissionSelection {
  const fieldPresence = formData.get(`__field_present__${name}`) === "1";

  if (!fieldPresence) {
    return {
      present: false,
      codes: [],
      deniedCodes: [],
    };
  }

  const codes = parseStringArray(formData, name);
  const invalidCodes = codes.filter((code) => !permissionCatalog.includes(code as PermissionCode));

  if (invalidCodes.length > 0) {
    throw new Error(`Unknown permission codes: ${invalidCodes.join(", ")}.`);
  }

  const deniedCodes = parseStringArray(formData, `${name}__denied`);
  const invalidDeniedCodes = deniedCodes.filter((code) => !permissionCatalog.includes(code as PermissionCode));

  if (invalidDeniedCodes.length > 0) {
    throw new Error(`Unknown denied permission codes: ${invalidDeniedCodes.join(", ")}.`);
  }

  return {
    present: true,
    codes: codes as PermissionCode[],
    deniedCodes: deniedCodes as PermissionCode[],
  };
}

function parseShiftValidityFormData(formData: FormData) {
  return buildShiftValidityFromFieldValues(
    shiftValidityDefinitions.reduce<Partial<Record<(typeof shiftValidityDefinitions)[number]["fieldName"], boolean>>>((accumulator, definition) => {
      accumulator[definition.fieldName] = parseBoolean(formData, definition.fieldName);
      return accumulator;
    }, {}),
  );
}

async function getDict() {
  const locale = await getServerLocale();
  return getDictionary(locale);
}

function parseUtcDate(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function parseActionError(error: unknown, d?: TranslationDictionary) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return d ? tr(d, "action.duplicateRecord") : "A record with the same unique value already exists.";
    }

    if (error.code === "P2003") {
      return d ? tr(d, "action.relatedNotFound") : "The selected related record does not exist.";
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return d ? tr(d, "action.unexpectedError") : "Unexpected server error.";
}

async function dispatchNotificationSafely(parameters: Parameters<typeof dispatchNotification>[0]) {
  try {
    await dispatchNotification(parameters);
  } catch (error) {
    console.error("[notifications]", error);
  }
}

function parseZodError(result: z.SafeParseError<unknown>) {
  return result.error.flatten().fieldErrors;
}

async function getAiAuditRetentionDays(): Promise<number> {
  try {
    const setting = await db.appSetting.findUnique({ where: { key: AI_AUDIT_RETENTION_DAYS_KEY } });
    if (setting && typeof setting.value === "number" && setting.value >= 1) {
      return Math.round(setting.value);
    }
  } catch { /* fallback */ }
  return DEFAULT_AI_AUDIT_RETENTION_DAYS;
}

async function cleanupAiAuditLogs() {
  try {
    const retentionDays = await getAiAuditRetentionDays();
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

    const oldRuns = await db.aiRun.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
    });

    if (oldRuns.length === 0) return;

    const oldRunIds = oldRuns.map((r) => r.id);
    await db.aiAuditEntry.deleteMany({ where: { aiRunId: { in: oldRunIds } } });
    await db.aiRun.deleteMany({ where: { id: { in: oldRunIds } } });
  } catch (error) {
    console.error("[ai-audit-cleanup]", error);
  }
}

async function requireCurrentPermission(permission: PermissionCode) {
  await ensurePermissionCatalog();
  const user = await getCurrentUser();
  requirePermission(user, permission);
  return user!.id;
}

function parseRequiredId(formData: FormData) {
  return parseOptionalString(formData.get("id")) ?? "";
}

function managedSettingKeyError(key: string, d: TranslationDictionary) {
  return errorState(tr(d, "action.managedKeyError", { key }), {
    key: [tr(d, "action.managedKeyHint")],
  });
}

function lockedRecordError(d: TranslationDictionary, key: string) {
  return errorState(tr(d, key));
}

function missingIdState(d: TranslationDictionary) {
  return errorState(tr(d, "action.missingId"));
}

async function resolvePermissionIds(tx: Prisma.TransactionClient, codes: PermissionCode[]) {
  if (codes.length === 0) {
    return [];
  }

  const permissions = await tx.permission.findMany({
    where: {
      code: {
        in: codes,
      },
    },
    select: {
      id: true,
      code: true,
    },
  });

  if (permissions.length !== codes.length) {
    const foundCodes = new Set(permissions.map((permission) => permission.code));
    const missingCodes = codes.filter((code) => !foundCodes.has(code));
    throw new Error(`Missing permission records: ${missingCodes.join(", ")}.`);
  }

  return permissions;
}

async function replaceRolePermissions(tx: Prisma.TransactionClient, roleId: string, permissionCodes: PermissionCode[]) {
  await tx.rolePermission.deleteMany({
    where: {
      roleId,
    },
  });

  if (permissionCodes.length === 0) {
    return;
  }

  const permissions = await resolvePermissionIds(tx, permissionCodes);

  await tx.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId,
      permissionId: permission.id,
    })),
  });
}

async function replaceUserPermissionOverrides(
  tx: Prisma.TransactionClient,
  parameters: {
    userId: string;
    rolePermissionCodes: PermissionCode[];
    selectedPermissionCodes: PermissionCode[];
    deniedPermissionCodes?: PermissionCode[];
  },
) {
  await tx.userPermissionOverride.deleteMany({
    where: {
      userId: parameters.userId,
    },
  });

  const rolePermissionSet = new Set(parameters.rolePermissionCodes);
  const grantedSet = new Set(parameters.selectedPermissionCodes);
  const deniedSet = new Set(parameters.deniedPermissionCodes ?? []);

  // Tri-state mode is active when deniedPermissionCodes is explicitly provided (even if empty).
  // In tri-state: only explicit grant/deny become overrides, everything else inherits from role.
  const isTriState = parameters.deniedPermissionCodes !== undefined;
  let overrideCodes: PermissionCode[];

  if (isTriState) {
    overrideCodes = permissionCatalog.filter((code) => {
      const inRole = rolePermissionSet.has(code);
      if (grantedSet.has(code) && !inRole) return true; // grant override
      if (deniedSet.has(code) && inRole) return true; // deny override
      return false;
    });
  } else {
    // Binary mode (roles page): override when role state differs from selected state
    overrideCodes = permissionCatalog.filter((code) => rolePermissionSet.has(code) !== grantedSet.has(code));
  }

  if (overrideCodes.length === 0) {
    return;
  }

  const permissions = await resolvePermissionIds(tx, overrideCodes);

  await tx.userPermissionOverride.createMany({
    data: permissions.map((permission) => ({
      userId: parameters.userId,
      permissionId: permission.id,
      enabled: grantedSet.has(permission.code as PermissionCode),
    })),
  });
}

async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entityType: string,
  entityId: string,
  payload: Prisma.InputJsonValue,
  action: "CREATE" | "UPDATE" | "DELETE" = "CREATE",
  actorId?: string,
) {
  await tx.auditLog.create({
    data: {
      entityType,
      entityId,
      action,
      payload,
      actorId: actorId ?? null,
    },
  });
}

const userSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  roleId: z.string().trim().optional(),
  isActive: z.boolean(),
  preferredTheme: z.string().trim().max(40, "Theme is too long.").optional(),
  notificationsEnabled: z.boolean(),
  notificationDays: z.number().int().min(0, "Must be zero or higher.").max(365, "Must be 365 or lower."),
});

const roleSchema = z.object({
  code: z.string().trim().min(1, "Code is required.").max(60, "Code is too long."),
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  description: z.string().trim().max(500, "Description is too long.").optional(),
});

const serviceSchema = z.object({
  code: z.string().trim().min(1, "Code is required.").max(60, "Code is too long."),
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  colorLight: z.string().trim().max(32, "Color is too long.").optional(),
  textColorLight: z.string().trim().max(32, "Color is too long.").optional(),
  opacityLight: z.number().int().min(0, "Opacity must be between 0 and 100.").max(100, "Opacity must be between 0 and 100."),
  colorDark: z.string().trim().max(32, "Color is too long.").optional(),
  textColorDark: z.string().trim().max(32, "Color is too long.").optional(),
  opacityDark: z.number().int().min(0, "Opacity must be between 0 and 100.").max(100, "Opacity must be between 0 and 100."),
  isActive: z.boolean(),
});

const shiftSchema = z.object({
  code: z.string().trim().min(1, "Code is required.").max(60, "Code is too long."),
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  serviceId: z.string().trim().min(1, "Service is required."),
  startsAt: z.string().regex(timePattern, "Use HH:MM format."),
  endsAt: z.string().regex(timePattern, "Use HH:MM format."),
  crossesMidnight: z.boolean(),
  validityDays: z.record(z.string(), z.boolean()),
  isActive: z.boolean(),
});

const vacationSchema = z
  .object({
    userId: z.string().trim().min(1, "User is required."),
    startDate: z.string().trim().min(1, "Start date is required."),
    endDate: z.string().trim().min(1, "End date is required."),
    locked: z.boolean(),
    status: z.nativeEnum(VacationStatus),
    notes: z.string().trim().max(1000, "Notes are too long.").optional(),
  })
  .refine((value) => parseUtcDate(value.endDate) >= parseUtcDate(value.startDate), {
    message: "End date must be on or after start date.",
    path: ["endDate"],
  });

const conditionSchema = z.object({
  type: z.string().trim().min(1, "Type is required.").max(80, "Type is too long."),
  title: z.string().trim().min(1, "Title is required.").max(160, "Title is too long."),
  description: z.string().trim().min(1, "Description is required.").max(2000, "Description is too long."),
  priority: z.number().int().min(0, "Priority must be zero or higher.").max(10000, "Priority is too high."),
  isActive: z.boolean(),
});

const holidaySchema = z.object({
  date: z.string().trim().min(1, "Date is required."),
  country: z.string().trim().min(1, "Country is required.").max(12, "Country code is too long."),
  name: z.string().trim().min(1, "Name is required.").max(160, "Name is too long."),
  localName: z.string().trim().max(160, "Local name is too long.").optional(),
});

const settingSchema = z.object({
  key: z.string().trim().min(1, "Key is required.").max(120, "Key is too long."),
  value: z.string().trim().min(1, "JSON value is required."),
});

const browserNotificationSettingsFormSchema = z.object({
  position: z.enum(["top-right", "top-left", "bottom-right", "bottom-left"]),
  opacityPercent: z.number().int().min(35, "Transparency must be between 35 and 100.").max(100, "Transparency must be between 35 and 100."),
});

const notificationSettingsFormSchema = z.object({
  toastPosition: z.enum(["top-right", "top-left", "bottom-right", "bottom-left"]),
  toastOpacityPercent: z.number().int().min(35, "Opacity must be between 35 and 100.").max(100, "Opacity must be between 35 and 100."),
  toastDurationMs: z.number().int().min(2000, "Duration must be between 2000 and 15000 ms.").max(15000, "Duration must be between 2000 and 15000 ms."),
  toastBackgroundLight: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a valid hex color."),
  toastTextLight: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a valid hex color."),
  toastBorderLight: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a valid hex color."),
  toastBackgroundDark: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a valid hex color."),
  toastTextDark: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a valid hex color."),
  toastBorderDark: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a valid hex color."),
  pushEnabled: z.boolean(),
  pushVapidPublicKey: z.string().trim().optional(),
  pushVapidPrivateKey: z.string().trim().optional(),
  pushSubject: z.string().trim().min(1, "Push subject is required.").max(240, "Push subject is too long."),
  pushIconUrl: z.string().trim().min(1, "Push icon URL is required.").max(240, "Push icon URL is too long."),
  pushBadgeUrl: z.string().trim().min(1, "Push badge URL is required.").max(240, "Push badge URL is too long."),
  emailEnabled: z.boolean(),
  emailFromName: z.string().trim().min(1, "Sender name is required.").max(120, "Sender name is too long."),
  emailFromEmail: z.string().trim().email("Enter a valid sender email."),
  emailReplyTo: z.string().trim().email("Enter a valid reply-to email.").or(z.literal("")),
  emailAccentColor: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a valid hex color."),
  emailSubjectTemplate: z.string().trim().min(1, "Email subject template is required.").max(240, "Email subject template is too long."),
  emailHtmlTemplate: z.string().trim().min(1, "Email HTML template is required.").max(20000, "Email HTML template is too long."),
  emailTextTemplate: z.string().trim().min(1, "Email text template is required.").max(10000, "Email text template is too long."),
});

const notificationTestFormSchema = z.object({
  targetEmail: z.string().trim().email("Enter a valid target email."),
  targetName: z.string().trim().min(1, "Target name is required.").max(120, "Target name is too long."),
  title: z.string().trim().min(1, "Notification title is required.").max(160, "Notification title is too long."),
  message: z.string().trim().min(1, "Notification message is required.").max(1000, "Notification message is too long."),
  sendEmail: z.boolean(),
  sendPush: z.boolean(),
});

const aiSettingsFormSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
  openAiApiKey: z.string().trim().optional(),
  anthropicApiKey: z.string().trim().optional(),
  googleApiKey: z.string().trim().optional(),
  clearOpenAiApiKey: z.boolean(),
  clearAnthropicApiKey: z.boolean(),
  clearGoogleApiKey: z.boolean(),
});

const scheduleSchema = z.object({
  date: z.string().trim().min(1, "Date is required."),
  userId: z.string().trim().min(1, "User is required."),
  shiftTypeId: z.string().trim().min(1, "Shift type is required."),
  locked: z.boolean(),
  source: z.nativeEnum(ScheduleSource),
  note: z.string().trim().max(1000, "Note is too long.").optional(),
});

const scheduleGenerationSchema = z
  .object({
    startDate: z.string().trim().min(1, "Start date is required."),
    endDate: z.string().trim().min(1, "End date is required."),
    fairnessLookbackDays: z.number().int().min(0, "Lookback days must be zero or higher.").max(90, "Lookback days must be 90 or lower."),
  })
  .refine((value) => parseUtcDate(value.endDate) >= parseUtcDate(value.startDate), {
    message: "End date must be on or after start date.",
    path: ["endDate"],
  });

function getScheduleValidityError(validityDays: unknown, date: Date, isHoliday: boolean, d?: TranslationDictionary) {
  const dayType = getScheduleDayType(date, isHoliday);

  if (isShiftValidForDayType(validityDays, dayType.key)) {
    return null;
  }

  return d ? tr(d, "action.invalidShiftForDay", { dayType: dayType.label }) : `Selected shift type is not valid for ${dayType.label}.`;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getDateRange(startDate: Date, endDate: Date) {
  const dates: Date[] = [];
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function getWeekdayLabel(date: Date) {
  return new Intl.DateTimeFormat("sk-SK", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

function getWeekdayNumber(date: Date) {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function formatDisplayDateValue(value: string, locale: string) {
  const date = parseUtcDate(value);
  const formatterLocale = locale === "sk" ? "sk-SK" : "en-US";

  return new Intl.DateTimeFormat(formatterLocale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function toAiProviderKind(provider: "openai" | "anthropic" | "gemini") {
  if (provider === "anthropic") return AiProviderKind.ANTHROPIC;
  if (provider === "gemini") return AiProviderKind.GEMINI;
  return AiProviderKind.OPENAI;
}

type CsvRecord = Record<string, string>;

function parseCsvBoolean(value: string | undefined, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value "${value}".`);
}

function parseCsvInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value "${value}".`);
  }

  return parsed;
}

function parseCsvStringArray(value: string | undefined) {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function getOptionalCsvValue(record: CsvRecord, key: string) {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getRequiredCsvValue(record: CsvRecord, key: string) {
  const value = getOptionalCsvValue(record, key);

  if (!value) {
    throw new Error(`Missing "${key}" value in CSV.`);
  }

  return value;
}

function parseCsvContent(content: string) {
  const normalized = content.replace(/^\uFEFF/, "");

  // Auto-detect delimiter from the first line: if semicolons appear more than commas, use semicolon.
  const firstLineEnd = normalized.search(/[\r\n]/);
  const firstLine = firstLineEnd === -1 ? normalized : normalized.slice(0, firstLineEnd);
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const delimiter = semicolonCount > commaCount ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (inQuotes) {
      if (character === "\"") {
        if (normalized[index + 1] === "\"") {
          value += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += character;
      }

      continue;
    }

    if (character === "\"") {
      inQuotes = true;
      continue;
    }

    if (character === delimiter) {
      row.push(value);
      value = "";
      continue;
    }

    if (character === "\r" || character === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";

      if (character === "\r" && normalized[index + 1] === "\n") {
        index += 1;
      }

      continue;
    }

    value += character;
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field.");
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((currentRow) => currentRow.some((cell) => cell.trim().length > 0));

  if (nonEmptyRows.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const headers = nonEmptyRows[0].map((header) => header.trim());
  const duplicateHeader = headers.find((header, index) => headers.indexOf(header) !== index);

  if (headers.some((header) => header.length === 0)) {
    throw new Error("CSV header contains an empty column name.");
  }

  if (duplicateHeader) {
    throw new Error(`CSV contains duplicate "${duplicateHeader}" column.`);
  }

  const records = nonEmptyRows.slice(1).map((currentRow, rowIndex) => {
    if (currentRow.length > headers.length) {
      throw new Error(`CSV row ${rowIndex + 2} has more columns than the header.`);
    }

    return headers.reduce<CsvRecord>((accumulator, header, columnIndex) => {
      accumulator[header] = currentRow[columnIndex] ?? "";
      return accumulator;
    }, {});
  });

  return { headers, records };
}

async function readCsvUpload(formData: FormData) {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Select a CSV file to import.");
  }

  if (file.size === 0) {
    throw new Error("Selected CSV file is empty.");
  }

  return file.text();
}

async function getCsvImportRecords(formData: FormData, expectedHeaders: string[]) {
  const content = await readCsvUpload(formData);
  const { headers, records } = parseCsvContent(content);
  const missingHeaders = expectedHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    throw new Error(`CSV is missing required columns: ${missingHeaders.join(", ")}.`);
  }

  if (records.length === 0) {
    throw new Error("CSV file does not contain any data rows.");
  }

  return records;
}

async function resolveUserReference(tx: Prisma.TransactionClient, value: string) {
  const user = await tx.user.findFirst({
    where: {
      OR: [{ id: value }, { email: value }],
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error(`User reference "${value}" does not exist.`);
  }

  return user.id;
}

async function resolveRoleReference(tx: Prisma.TransactionClient, value: string) {
  const role = await tx.role.findFirst({
    where: {
      OR: [{ id: value }, { code: value }, { name: value }],
    },
    select: {
      id: true,
    },
  });

  if (!role) {
    throw new Error(`Role reference "${value}" does not exist.`);
  }

  return role.id;
}

async function resolveServiceReference(tx: Prisma.TransactionClient, value: string) {
  const service = await tx.service.findFirst({
    where: {
      OR: [{ id: value }, { code: value }, { name: value }],
    },
    select: {
      id: true,
    },
  });

  if (!service) {
    throw new Error(`Service reference "${value}" does not exist.`);
  }

  return service.id;
}

async function resolveShiftReference(tx: Prisma.TransactionClient, value: string) {
  const shiftType = await tx.shiftType.findFirst({
    where: {
      OR: [{ id: value }, { code: value }, { name: value }],
    },
    select: {
      id: true,
      serviceId: true,
      validityDays: true,
    },
  });

  if (!shiftType) {
    throw new Error(`Shift type reference "${value}" does not exist.`);
  }

  return shiftType;
}

export async function createUserAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const d = await getDict();
  const actorId = await requireCurrentPermission("users:create");
  const shiftTypeIds = parseStringArray(formData, "shiftTypeIds");
  let permissionSelection: ParsedPermissionSelection;
  try {
    permissionSelection = parsePermissionSelection(formData);
  } catch (error) {
    return errorState(parseActionError(error, d), {
      permissionCodes: [parseActionError(error, d)],
    });
  }
  const parsed = userSchema.safeParse({
    email: parseOptionalString(formData.get("email")) ?? "",
    firstName: parseOptionalString(formData.get("firstName")) ?? "",
    lastName: parseOptionalString(formData.get("lastName")) ?? "",
    roleId: parseOptionalString(formData.get("roleId")),
    isActive: parseBoolean(formData, "isActive"),
    preferredTheme: parseOptionalString(formData.get("preferredTheme")),
    notificationsEnabled: parseBoolean(formData, "notificationsEnabled"),
    notificationDays: Number.parseInt(parseOptionalString(formData.get("notificationDays")) ?? "1", 10),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  if (shiftTypeIds.length > 0) {
    const existingShiftTypes = await db.shiftType.findMany({
      where: {
        id: {
          in: shiftTypeIds,
        },
      },
      select: {
        id: true,
      },
    });

    if (existingShiftTypes.length !== shiftTypeIds.length) {
      return errorState(tr(d, "action.shiftNotExist"), {
        shiftTypeIds: [tr(d, "action.shiftNotExistHint")],
      });
    }
  }

  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          ...parsed.data,
          roleId: parsed.data.roleId ?? null,
        },
      });
      const rolePermissionCodes =
        parsed.data.roleId
          ? (
              await tx.role.findUnique({
                where: { id: parsed.data.roleId },
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              })
            )?.permissions.map((assignment) => assignment.permission.code as PermissionCode) ?? []
          : [];

      if (shiftTypeIds.length > 0) {
        await tx.userShiftType.createMany({
          data: shiftTypeIds.map((shiftTypeId) => ({
            userId: user.id,
            shiftTypeId,
          })),
        });
      }

      if (permissionSelection.present) {
        await replaceUserPermissionOverrides(tx, {
          userId: user.id,
          rolePermissionCodes,
          selectedPermissionCodes: permissionSelection.codes,
          deniedPermissionCodes: permissionSelection.deniedCodes,
        });
      }

      await writeAuditLog(tx, "USER", user.id, {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roleId: user.roleId,
        isActive: user.isActive,
        shiftTypeIds,
        notificationsEnabled: user.notificationsEnabled,
        notificationDays: user.notificationDays,
        preferredTheme: user.preferredTheme,
        permissionCodes: permissionSelection.present ? permissionSelection.codes : rolePermissionCodes,
      }, "CREATE", actorId);
    });

    return successState(tr(d, "action.userCreated"), "/users");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function createRoleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const d = await getDict();
  const actorId = await requireCurrentPermission("roles:create");
  let permissionSelection: ParsedPermissionSelection;
  try {
    permissionSelection = parsePermissionSelection(formData);
  } catch (error) {
    return errorState(parseActionError(error, d), {
      permissionCodes: [parseActionError(error, d)],
    });
  }
  const parsed = roleSchema.safeParse({
    code: parseOptionalString(formData.get("code")) ?? "",
    name: parseOptionalString(formData.get("name")) ?? "",
    description: parseOptionalString(formData.get("description")),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    await db.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: parsed.data,
      });

      if (permissionSelection.present) {
        await replaceRolePermissions(tx, role.id, permissionSelection.codes);
      }

      await writeAuditLog(tx, "ROLE", role.id, {
        code: role.code,
        name: role.name,
        description: role.description,
        permissionCodes: permissionSelection.codes,
      }, "CREATE", actorId);
    });

    return successState(tr(d, "action.roleCreated"), "/roles");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function createServiceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const d = await getDict();
  const actorId = await requireCurrentPermission("services:create");
  const parsed = serviceSchema.safeParse({
    code: parseOptionalString(formData.get("code")) ?? "",
    name: parseOptionalString(formData.get("name")) ?? "",
    colorLight: parseOptionalString(formData.get("colorLight")),
    textColorLight: parseOptionalString(formData.get("textColorLight")),
    opacityLight: Number.parseInt(parseOptionalString(formData.get("opacityLight")) ?? "50", 10),
    colorDark: parseOptionalString(formData.get("colorDark")),
    textColorDark: parseOptionalString(formData.get("textColorDark")),
    opacityDark: Number.parseInt(parseOptionalString(formData.get("opacityDark")) ?? "100", 10),
    isActive: parseBoolean(formData, "isActive"),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    const existingByCode = await db.service.findFirst({ where: { code: parsed.data.code } });
    if (existingByCode) {
      return errorState(tr(d, "action.duplicateCode"), { code: [tr(d, "action.duplicateCodeHint")] });
    }
    const existingByName = await db.service.findFirst({ where: { name: parsed.data.name } });
    if (existingByName) {
      return errorState(tr(d, "action.duplicateName"), { name: [tr(d, "action.duplicateNameHint")] });
    }

    await db.$transaction(async (tx) => {
      const service = await tx.service.create({
        data: parsed.data,
      });

      await writeAuditLog(tx, "SERVICE", service.id, {
        code: service.code,
        name: service.name,
        isActive: service.isActive,
        colorLight: service.colorLight,
        textColorLight: service.textColorLight,
        opacityLight: service.opacityLight,
        colorDark: service.colorDark,
        textColorDark: service.textColorDark,
        opacityDark: service.opacityDark,
      }, "CREATE", actorId);
    });

    return successState(tr(d, "action.serviceCreated"), "/services");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function createShiftAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const d = await getDict();
  const actorId = await requireCurrentPermission("shifts:create");
  const parsed = shiftSchema.safeParse({
    code: parseOptionalString(formData.get("code")) ?? "",
    name: parseOptionalString(formData.get("name")) ?? "",
    serviceId: parseOptionalString(formData.get("serviceId")) ?? "",
    startsAt: parseOptionalString(formData.get("startsAt")) ?? "",
    endsAt: parseOptionalString(formData.get("endsAt")) ?? "",
    crossesMidnight: parseBoolean(formData, "crossesMidnight"),
    validityDays: parseShiftValidityFormData(formData),
    isActive: parseBoolean(formData, "isActive"),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    const existingByCode = await db.shiftType.findFirst({ where: { code: parsed.data.code } });
    if (existingByCode) {
      return errorState(tr(d, "action.duplicateCode"), { code: [tr(d, "action.duplicateCodeHint")] });
    }
    const existingByName = await db.shiftType.findFirst({ where: { name: parsed.data.name } });
    if (existingByName) {
      return errorState(tr(d, "action.duplicateName"), { name: [tr(d, "action.duplicateNameHint")] });
    }

    await db.$transaction(async (tx) => {
      const shiftType = await tx.shiftType.create({
        data: parsed.data,
      });

      await writeAuditLog(tx, "SHIFT_TYPE", shiftType.id, {
        code: shiftType.code,
        name: shiftType.name,
        serviceId: shiftType.serviceId,
        startsAt: shiftType.startsAt,
        endsAt: shiftType.endsAt,
        crossesMidnight: shiftType.crossesMidnight,
        validityDays: shiftType.validityDays as Prisma.InputJsonValue | null,
        isActive: shiftType.isActive,
      }, "CREATE", actorId);
    });

    return successState(tr(d, "action.shiftCreated"), "/shifts");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function createVacationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const d = await getDict();
  const actorId = await requireCurrentPermission("vacations:create");
  const parsed = vacationSchema.safeParse({
    userId: parseOptionalString(formData.get("userId")) ?? "",
    startDate: parseOptionalString(formData.get("startDate")) ?? "",
    endDate: parseOptionalString(formData.get("endDate")) ?? "",
    locked: parseBoolean(formData, "locked"),
    status: parseOptionalString(formData.get("status")) ?? VacationStatus.PENDING,
    notes: parseOptionalString(formData.get("notes")),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    await db.$transaction(async (tx) => {
      const vacation = await tx.vacation.create({
        data: {
          userId: parsed.data.userId,
          startDate: parseUtcDate(parsed.data.startDate),
          endDate: parseUtcDate(parsed.data.endDate),
          locked: parsed.data.locked,
          status: parsed.data.status,
          notes: parsed.data.notes ?? null,
        },
      });

      await writeAuditLog(tx, "VACATION", vacation.id, {
        userId: vacation.userId,
        startDate: vacation.startDate.toISOString(),
        endDate: vacation.endDate.toISOString(),
        locked: vacation.locked,
        status: vacation.status,
        notes: vacation.notes,
      }, "CREATE", actorId);
    });

    return successState(tr(d, "action.vacationCreated"), "/vacations");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function createConditionAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const d = await getDict();
  const actorId = await requireCurrentPermission("conditions:create");
  const parsed = conditionSchema.safeParse({
    type: parseOptionalString(formData.get("type")) ?? "",
    title: parseOptionalString(formData.get("title")) ?? "",
    description: parseOptionalString(formData.get("description")) ?? "",
    priority: Number.parseInt(parseOptionalString(formData.get("priority")) ?? "100", 10),
    isActive: parseBoolean(formData, "isActive"),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    await db.$transaction(async (tx) => {
      const condition = await tx.condition.create({
        data: parsed.data,
      });

      await writeAuditLog(tx, "CONDITION", condition.id, {
        type: condition.type,
        title: condition.title,
        description: condition.description,
        priority: condition.priority,
        isActive: condition.isActive,
      }, "CREATE", actorId);
    });

    return successState(tr(d, "action.conditionCreated"), "/conditions");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function createHolidayAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const d = await getDict();
  const actorId = await requireCurrentPermission("holidays:create");
  const parsed = holidaySchema.safeParse({
    date: parseOptionalString(formData.get("date")) ?? "",
    country: parseOptionalString(formData.get("country")) ?? "",
    name: parseOptionalString(formData.get("name")) ?? "",
    localName: parseOptionalString(formData.get("localName")),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    await db.$transaction(async (tx) => {
      const holiday = await tx.holiday.create({
        data: {
          date: parseUtcDate(parsed.data.date),
          country: parsed.data.country,
          name: parsed.data.name,
          localName: parsed.data.localName ?? null,
        },
      });

      await writeAuditLog(tx, "HOLIDAY", holiday.id, {
        date: holiday.date.toISOString(),
        country: holiday.country,
        name: holiday.name,
        localName: holiday.localName,
      }, "CREATE", actorId);
    });

    return successState(tr(d, "action.holidayCreated"), "/holidays");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function createSettingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const d = await getDict();
  const actorId = await requireCurrentPermission("settings:create");
  const parsed = settingSchema.safeParse({
    key: parseOptionalString(formData.get("key")) ?? "",
    value: parseOptionalString(formData.get("value")) ?? "",
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  if (isManagedSettingKey(parsed.data.key)) {
    return managedSettingKeyError(parsed.data.key, d);
  }

  let parsedValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  let rawJson: unknown;

  try {
    rawJson = JSON.parse(parsed.data.value);
  } catch {
    return errorState(tr(d, "action.jsonInvalid"), {
      value: [tr(d, "action.jsonInvalidHint")],
    });
  }

  parsedValue = rawJson === null ? Prisma.JsonNull : (rawJson as Prisma.InputJsonValue);

  try {
    await db.appSetting.create({
      data: {
        key: parsed.data.key,
        value: parsedValue,
      },
    });

    return successState(tr(d, "action.settingCreated"), "/settings");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function updateUserAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("users:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);
  const shiftTypeIds = parseStringArray(formData, "shiftTypeIds");
  let permissionSelection: ParsedPermissionSelection;
  try {
    permissionSelection = parsePermissionSelection(formData);
  } catch (error) {
    return errorState(parseActionError(error, d), {
      permissionCodes: [parseActionError(error, d)],
    });
  }
  const parsed = userSchema.safeParse({
    email: parseOptionalString(formData.get("email")) ?? "",
    firstName: parseOptionalString(formData.get("firstName")) ?? "",
    lastName: parseOptionalString(formData.get("lastName")) ?? "",
    roleId: parseOptionalString(formData.get("roleId")),
    isActive: parseBoolean(formData, "isActive"),
    preferredTheme: parseOptionalString(formData.get("preferredTheme")),
    notificationsEnabled: parseBoolean(formData, "notificationsEnabled"),
    notificationDays: Number.parseInt(parseOptionalString(formData.get("notificationDays")) ?? "1", 10),
  });

  if (!id) {
    return errorState(tr(d, "action.missingId"));
  }

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  if (shiftTypeIds.length > 0) {
    const existingShiftTypes = await db.shiftType.findMany({
      where: {
        id: {
          in: shiftTypeIds,
        },
      },
      select: {
        id: true,
      },
    });

    if (existingShiftTypes.length !== shiftTypeIds.length) {
      return errorState(tr(d, "action.shiftNotExist"), {
        shiftTypeIds: [tr(d, "action.shiftNotExistHint")],
      });
    }
  }

  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          ...parsed.data,
          roleId: parsed.data.roleId ?? null,
        },
      });
      const rolePermissionCodes =
        parsed.data.roleId
          ? (
              await tx.role.findUnique({
                where: { id: parsed.data.roleId },
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              })
            )?.permissions.map((assignment) => assignment.permission.code as PermissionCode) ?? []
          : [];

      await tx.userShiftType.deleteMany({
        where: {
          userId: user.id,
        },
      });

      if (shiftTypeIds.length > 0) {
        await tx.userShiftType.createMany({
          data: shiftTypeIds.map((shiftTypeId) => ({
            userId: user.id,
            shiftTypeId,
          })),
        });
      }

      if (permissionSelection.present) {
        await replaceUserPermissionOverrides(tx, {
          userId: user.id,
          rolePermissionCodes,
          selectedPermissionCodes: permissionSelection.codes,
          deniedPermissionCodes: permissionSelection.deniedCodes,
        });
      }

      await writeAuditLog(
        tx,
        "USER",
        user.id,
        {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roleId: user.roleId,
          isActive: user.isActive,
          shiftTypeIds,
          notificationsEnabled: user.notificationsEnabled,
          notificationDays: user.notificationDays,
          preferredTheme: user.preferredTheme,
          permissionCodes: permissionSelection.present ? permissionSelection.codes : rolePermissionCodes,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.userUpdated"), "/users");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function updateRoleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("roles:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);
  let permissionSelection: ParsedPermissionSelection;
  try {
    permissionSelection = parsePermissionSelection(formData);
  } catch (error) {
    return errorState(parseActionError(error, d), {
      permissionCodes: [parseActionError(error, d)],
    });
  }
  const parsed = roleSchema.safeParse({
    code: parseOptionalString(formData.get("code")) ?? "",
    name: parseOptionalString(formData.get("name")) ?? "",
    description: parseOptionalString(formData.get("description")),
  });

  if (!id) {
    return errorState(tr(d, "action.missingId"));
  }

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    await db.$transaction(async (tx) => {
      const role = await tx.role.update({
        where: { id },
        data: parsed.data,
      });

      if (permissionSelection.present) {
        await replaceRolePermissions(tx, role.id, permissionSelection.codes);
      }

      await writeAuditLog(
        tx,
        "ROLE",
        role.id,
        {
          code: role.code,
          name: role.name,
          description: role.description,
          permissionCodes: permissionSelection.codes,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.roleUpdated"), "/roles");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function updateServiceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("services:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);
  const parsed = serviceSchema.safeParse({
    code: parseOptionalString(formData.get("code")) ?? "",
    name: parseOptionalString(formData.get("name")) ?? "",
    colorLight: parseOptionalString(formData.get("colorLight")),
    textColorLight: parseOptionalString(formData.get("textColorLight")),
    opacityLight: Number.parseInt(parseOptionalString(formData.get("opacityLight")) ?? "50", 10),
    colorDark: parseOptionalString(formData.get("colorDark")),
    textColorDark: parseOptionalString(formData.get("textColorDark")),
    opacityDark: Number.parseInt(parseOptionalString(formData.get("opacityDark")) ?? "100", 10),
    isActive: parseBoolean(formData, "isActive"),
  });

  if (!id) {
    return errorState(tr(d, "action.missingId"));
  }

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    const existingByCode = await db.service.findFirst({ where: { code: parsed.data.code, id: { not: id } } });
    if (existingByCode) {
      return errorState(tr(d, "action.duplicateCode"), { code: [tr(d, "action.duplicateCodeHint")] });
    }
    const existingByName = await db.service.findFirst({ where: { name: parsed.data.name, id: { not: id } } });
    if (existingByName) {
      return errorState(tr(d, "action.duplicateName"), { name: [tr(d, "action.duplicateNameHint")] });
    }

    await db.$transaction(async (tx) => {
      const service = await tx.service.update({
        where: { id },
        data: parsed.data,
      });

      await writeAuditLog(
        tx,
        "SERVICE",
        service.id,
        {
          code: service.code,
          name: service.name,
          isActive: service.isActive,
          colorLight: service.colorLight,
          textColorLight: service.textColorLight,
          opacityLight: service.opacityLight,
          colorDark: service.colorDark,
          textColorDark: service.textColorDark,
          opacityDark: service.opacityDark,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.serviceUpdated"), "/services");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function updateShiftAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("shifts:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);
  const parsed = shiftSchema.safeParse({
    code: parseOptionalString(formData.get("code")) ?? "",
    name: parseOptionalString(formData.get("name")) ?? "",
    serviceId: parseOptionalString(formData.get("serviceId")) ?? "",
    startsAt: parseOptionalString(formData.get("startsAt")) ?? "",
    endsAt: parseOptionalString(formData.get("endsAt")) ?? "",
    crossesMidnight: parseBoolean(formData, "crossesMidnight"),
    validityDays: parseShiftValidityFormData(formData),
    isActive: parseBoolean(formData, "isActive"),
  });

  if (!id) {
    return errorState(tr(d, "action.missingId"));
  }

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    const existingByCode = await db.shiftType.findFirst({ where: { code: parsed.data.code, id: { not: id } } });
    if (existingByCode) {
      return errorState(tr(d, "action.duplicateCode"), { code: [tr(d, "action.duplicateCodeHint")] });
    }
    const existingByName = await db.shiftType.findFirst({ where: { name: parsed.data.name, id: { not: id } } });
    if (existingByName) {
      return errorState(tr(d, "action.duplicateName"), { name: [tr(d, "action.duplicateNameHint")] });
    }

    await db.$transaction(async (tx) => {
      const shiftType = await tx.shiftType.update({
        where: { id },
        data: parsed.data,
      });

      await writeAuditLog(
        tx,
        "SHIFT_TYPE",
        shiftType.id,
        {
          code: shiftType.code,
          name: shiftType.name,
          serviceId: shiftType.serviceId,
          startsAt: shiftType.startsAt,
          endsAt: shiftType.endsAt,
          crossesMidnight: shiftType.crossesMidnight,
          validityDays: shiftType.validityDays as Prisma.InputJsonValue | null,
          isActive: shiftType.isActive,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.shiftUpdated"), "/shifts");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function updateVacationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("vacations:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);
  const parsed = vacationSchema.safeParse({
    userId: parseOptionalString(formData.get("userId")) ?? "",
    startDate: parseOptionalString(formData.get("startDate")) ?? "",
    endDate: parseOptionalString(formData.get("endDate")) ?? "",
    locked: parseBoolean(formData, "locked"),
    status: parseOptionalString(formData.get("status")) ?? VacationStatus.PENDING,
    notes: parseOptionalString(formData.get("notes")),
  });

  if (!id) {
    return errorState(tr(d, "action.missingId"));
  }

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  const existingVacation = await db.vacation.findUnique({
    where: { id },
    select: {
      locked: true,
    },
  });

  if (!existingVacation) {
    return missingIdState(d);
  }

  if (existingVacation.locked) {
    return lockedRecordError(d, "action.vacationLockedError");
  }

  try {
    await db.$transaction(async (tx) => {
      const vacation = await tx.vacation.update({
        where: { id },
        data: {
          userId: parsed.data.userId,
          startDate: parseUtcDate(parsed.data.startDate),
          endDate: parseUtcDate(parsed.data.endDate),
          locked: parsed.data.locked,
          status: parsed.data.status,
          notes: parsed.data.notes ?? null,
        },
      });

      await writeAuditLog(
        tx,
        "VACATION",
        vacation.id,
        {
          userId: vacation.userId,
          startDate: vacation.startDate.toISOString(),
          endDate: vacation.endDate.toISOString(),
          locked: vacation.locked,
          status: vacation.status,
          notes: vacation.notes,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.vacationUpdated"), "/vacations");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function updateConditionAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("conditions:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);
  const parsed = conditionSchema.safeParse({
    type: parseOptionalString(formData.get("type")) ?? "",
    title: parseOptionalString(formData.get("title")) ?? "",
    description: parseOptionalString(formData.get("description")) ?? "",
    priority: Number.parseInt(parseOptionalString(formData.get("priority")) ?? "100", 10),
    isActive: parseBoolean(formData, "isActive"),
  });

  if (!id) {
    return errorState(tr(d, "action.missingId"));
  }

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    await db.$transaction(async (tx) => {
      const condition = await tx.condition.update({
        where: { id },
        data: parsed.data,
      });

      await writeAuditLog(
        tx,
        "CONDITION",
        condition.id,
        {
          type: condition.type,
          title: condition.title,
          description: condition.description,
          priority: condition.priority,
          isActive: condition.isActive,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.conditionUpdated"), "/conditions");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function updateHolidayAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("holidays:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);
  const parsed = holidaySchema.safeParse({
    date: parseOptionalString(formData.get("date")) ?? "",
    country: parseOptionalString(formData.get("country")) ?? "",
    name: parseOptionalString(formData.get("name")) ?? "",
    localName: parseOptionalString(formData.get("localName")),
  });

  if (!id) {
    return errorState(tr(d, "action.missingId"));
  }

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  try {
    await db.$transaction(async (tx) => {
      const holiday = await tx.holiday.update({
        where: { id },
        data: {
          date: parseUtcDate(parsed.data.date),
          country: parsed.data.country,
          name: parsed.data.name,
          localName: parsed.data.localName ?? null,
        },
      });

      await writeAuditLog(
        tx,
        "HOLIDAY",
        holiday.id,
        {
          date: holiday.date.toISOString(),
          country: holiday.country,
          name: holiday.name,
          localName: holiday.localName,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.holidayUpdated"), "/holidays");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function updateSettingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("settings:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);
  const parsed = settingSchema.safeParse({
    key: parseOptionalString(formData.get("key")) ?? "",
    value: parseOptionalString(formData.get("value")) ?? "",
  });

  if (!id) {
    return errorState(tr(d, "action.missingId"));
  }

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  const existingSetting = await db.appSetting.findUnique({
    where: { id },
    select: {
      key: true,
    },
  });

  if (!existingSetting) {
    return missingIdState(d);
  }

  if (isManagedSettingKey(existingSetting.key) || isManagedSettingKey(parsed.data.key)) {
    return managedSettingKeyError(isManagedSettingKey(parsed.data.key) ? parsed.data.key : existingSetting.key, d);
  }

  let parsedValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  let rawJson: unknown;

  try {
    rawJson = JSON.parse(parsed.data.value);
  } catch {
    return errorState(tr(d, "action.jsonInvalid"), {
      value: [tr(d, "action.jsonInvalidHint")],
    });
  }

  parsedValue = rawJson === null ? Prisma.JsonNull : (rawJson as Prisma.InputJsonValue);

  try {
    await db.$transaction(async (tx) => {
      const setting = await tx.appSetting.update({
        where: { id },
        data: {
          key: parsed.data.key,
          value: parsedValue,
        },
      });

      await writeAuditLog(
        tx,
        "APP_SETTING",
        setting.id,
        {
          key: setting.key,
          value: setting.value as Prisma.InputJsonValue,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.settingUpdated"), "/settings");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function upsertBrowserNotificationSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("settings:edit");
  const d = await getDict();
  try {
    const currentSettings = await getNotificationSettings().catch(() => defaultNotificationSettings);
    const parsed = browserNotificationSettingsFormSchema.safeParse({
      position: parseOptionalString(formData.get("position")) ?? currentSettings.toast.position,
      opacityPercent: Number.parseInt(parseOptionalString(formData.get("opacityPercent")) ?? String(Math.round(currentSettings.toast.opacity * 100)), 10),
    });

    if (!parsed.success) {
      return errorState(tr(d, "action.reviewNotifFields"), parseZodError(parsed));
    }

    const nextSettings = notificationSettingsSchema.parse({
      ...currentSettings,
      toast: {
        ...currentSettings.toast,
        position: parsed.data.position,
        opacity: parsed.data.opacityPercent / 100,
      },
    });

    if (nextSettings.push.enabled && (!nextSettings.push.vapidPublicKey || !nextSettings.push.vapidPrivateKey)) {
      return errorState(tr(d, "action.vapidRequired"), {
        pushVapidPublicKey: [tr(d, "action.vapidPublicMissing")],
        pushVapidPrivateKey: [tr(d, "action.vapidPrivateMissing")],
      });
    }

    await db.appSetting.upsert({
      where: {
        key: BROWSER_NOTIFICATION_SETTINGS_KEY,
      },
      update: {
        value: nextSettings,
      },
      create: {
        key: BROWSER_NOTIFICATION_SETTINGS_KEY,
        value: nextSettings,
      },
    });

    revalidatePath("/", "layout");
    revalidatePath("/settings");

    return {
      status: "success",
      message: tr(d, "action.browserNotifSaved"),
    };
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function upsertNotificationSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("settings:edit");
  const d = await getDict();
  try {
    const currentSettings = await getNotificationSettings().catch(() => defaultNotificationSettings);
    const parsed = notificationSettingsFormSchema.safeParse({
      toastPosition: parseOptionalString(formData.get("toastPosition")) ?? currentSettings.toast.position,
      toastOpacityPercent: Number.parseInt(parseOptionalString(formData.get("toastOpacityPercent")) ?? String(Math.round(currentSettings.toast.opacity * 100)), 10),
      toastDurationMs: Number.parseInt(parseOptionalString(formData.get("toastDurationMs")) ?? String(currentSettings.toast.durationMs), 10),
      toastBackgroundLight: parseOptionalString(formData.get("toastBackgroundLight")) ?? currentSettings.toast.backgroundLight,
      toastTextLight: parseOptionalString(formData.get("toastTextLight")) ?? currentSettings.toast.textLight,
      toastBorderLight: parseOptionalString(formData.get("toastBorderLight")) ?? currentSettings.toast.borderLight,
      toastBackgroundDark: parseOptionalString(formData.get("toastBackgroundDark")) ?? currentSettings.toast.backgroundDark,
      toastTextDark: parseOptionalString(formData.get("toastTextDark")) ?? currentSettings.toast.textDark,
      toastBorderDark: parseOptionalString(formData.get("toastBorderDark")) ?? currentSettings.toast.borderDark,
      pushEnabled: parseBoolean(formData, "pushEnabled"),
      pushVapidPublicKey: parseOptionalString(formData.get("pushVapidPublicKey")),
      pushVapidPrivateKey: parseOptionalString(formData.get("pushVapidPrivateKey")),
      pushSubject: parseOptionalString(formData.get("pushSubject")) ?? currentSettings.push.subject,
      pushIconUrl: parseOptionalString(formData.get("pushIconUrl")) ?? currentSettings.push.iconUrl,
      pushBadgeUrl: parseOptionalString(formData.get("pushBadgeUrl")) ?? currentSettings.push.badgeUrl,
      emailEnabled: parseBoolean(formData, "emailEnabled"),
      emailFromName: parseOptionalString(formData.get("emailFromName")) ?? currentSettings.email.fromName,
      emailFromEmail: parseOptionalString(formData.get("emailFromEmail")) ?? currentSettings.email.fromEmail,
      emailReplyTo: parseOptionalString(formData.get("emailReplyTo")) ?? currentSettings.email.replyTo,
      emailAccentColor: parseOptionalString(formData.get("emailAccentColor")) ?? currentSettings.email.accentColor,
      emailSubjectTemplate: parseOptionalString(formData.get("emailSubjectTemplate")) ?? currentSettings.email.subjectTemplate,
      emailHtmlTemplate: parseOptionalString(formData.get("emailHtmlTemplate")) ?? currentSettings.email.htmlTemplate,
      emailTextTemplate: parseOptionalString(formData.get("emailTextTemplate")) ?? currentSettings.email.textTemplate,
    });

    if (!parsed.success) {
      return errorState(tr(d, "action.reviewNotifFields"), parseZodError(parsed));
    }

    const nextSettings = notificationSettingsSchema.parse({
      toast: {
        position: parsed.data.toastPosition,
        opacity: parsed.data.toastOpacityPercent / 100,
        durationMs: parsed.data.toastDurationMs,
        backgroundLight: parsed.data.toastBackgroundLight,
        textLight: parsed.data.toastTextLight,
        borderLight: parsed.data.toastBorderLight,
        backgroundDark: parsed.data.toastBackgroundDark,
        textDark: parsed.data.toastTextDark,
        borderDark: parsed.data.toastBorderDark,
      },
      push: {
        enabled: parsed.data.pushEnabled,
        vapidPublicKey: parsed.data.pushVapidPublicKey ?? currentSettings.push.vapidPublicKey,
        vapidPrivateKey: parsed.data.pushVapidPrivateKey ?? currentSettings.push.vapidPrivateKey,
        subject: parsed.data.pushSubject,
        iconUrl: parsed.data.pushIconUrl,
        badgeUrl: parsed.data.pushBadgeUrl,
      },
      email: {
        enabled: parsed.data.emailEnabled,
        fromName: parsed.data.emailFromName,
        fromEmail: parsed.data.emailFromEmail,
        replyTo: parsed.data.emailReplyTo,
        accentColor: parsed.data.emailAccentColor,
        subjectTemplate: parsed.data.emailSubjectTemplate,
        htmlTemplate: parsed.data.emailHtmlTemplate,
        textTemplate: parsed.data.emailTextTemplate,
      },
    });

    await db.appSetting.upsert({
      where: {
        key: NOTIFICATION_SETTINGS_KEY,
      },
      update: {
        value: nextSettings,
      },
      create: {
        key: NOTIFICATION_SETTINGS_KEY,
        value: nextSettings,
      },
    });

    revalidatePath("/", "layout");
    revalidatePath("/settings");

    return {
      status: "success",
      message: tr(d, "action.notifSettingsSaved"),
    };
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function sendNotificationTestAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("settings:edit");
  const d = await getDict();
  const notificationSettings = await getNotificationSettings().catch(() => defaultNotificationSettings);
  const parsed = notificationTestFormSchema.safeParse({
    targetEmail: parseOptionalString(formData.get("targetEmail")) ?? "",
    targetName: parseOptionalString(formData.get("targetName")) ?? "",
    title: parseOptionalString(formData.get("title")) ?? "",
    message: parseOptionalString(formData.get("message")) ?? "",
    sendEmail: parseBoolean(formData, "sendEmail"),
    sendPush: parseBoolean(formData, "sendPush"),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewTestFields"), parseZodError(parsed));
  }

  if (!parsed.data.sendEmail && !parsed.data.sendPush) {
    return errorState(tr(d, "action.selectTestChannel"));
  }

  if (parsed.data.sendEmail && !notificationSettings.email.enabled) {
    return errorState(tr(d, "action.emailDisabledForTest"));
  }

  if (parsed.data.sendPush && !notificationSettings.push.enabled) {
    return errorState(tr(d, "action.pushDisabledForTest"));
  }

  try {
    await dispatchNotification({
      recipients: [
        {
          email: parsed.data.targetEmail,
          name: parsed.data.targetName,
        },
      ],
      title: parsed.data.title,
      message: parsed.data.message,
      actionUrl: "/settings",
      entityType: "NOTIFICATION",
      entityLabel: "Test notification",
      tag: "notification-test",
      channels: {
        email: parsed.data.sendEmail,
        push: parsed.data.sendPush,
      },
      force: true,
    });

    return {
      status: "success",
      message: tr(d, "action.testNotifSent"),
    };
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function upsertAiSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("settings:edit");
  const d = await getDict();
  const parsed = aiSettingsFormSchema.safeParse({
    provider: parseOptionalString(formData.get("provider")) ?? "openai",
    openAiApiKey: parseOptionalString(formData.get("openAiApiKey")),
    anthropicApiKey: parseOptionalString(formData.get("anthropicApiKey")),
    googleApiKey: parseOptionalString(formData.get("googleApiKey")),
    clearOpenAiApiKey: parseBoolean(formData, "clearOpenAiApiKey"),
    clearAnthropicApiKey: parseBoolean(formData, "clearAnthropicApiKey"),
    clearGoogleApiKey: parseBoolean(formData, "clearGoogleApiKey"),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewAiFields"), parseZodError(parsed));
  }

  try {
    const currentSettings = await getAiSettings().catch(() => defaultAiSettings);
    const openAiApiKey = parsed.data.clearOpenAiApiKey ? "" : (parsed.data.openAiApiKey ?? currentSettings.openAiApiKey);
    const anthropicApiKey = parsed.data.clearAnthropicApiKey ? "" : (parsed.data.anthropicApiKey ?? currentSettings.anthropicApiKey);
    const googleApiKey = parsed.data.clearGoogleApiKey ? "" : (parsed.data.googleApiKey ?? currentSettings.googleApiKey);

    const nextSettings = aiSettingsSchema.parse({
      provider: parsed.data.provider,
      openAiApiKey,
      anthropicApiKey,
      googleApiKey,
    });

    if (nextSettings.provider === "openai" && !nextSettings.openAiApiKey) {
      return errorState(tr(d, "action.openaiKeyRequired"), {
        openAiApiKey: [tr(d, "action.openaiKeyHint")],
      });
    }

    if (nextSettings.provider === "anthropic" && !nextSettings.anthropicApiKey) {
      return errorState(tr(d, "action.anthropicKeyRequired"), {
        anthropicApiKey: [tr(d, "action.anthropicKeyHint")],
      });
    }

    if (nextSettings.provider === "gemini" && !nextSettings.googleApiKey) {
      return errorState(tr(d, "action.geminiKeyRequired"), {
        googleApiKey: [tr(d, "action.geminiKeyHint")],
      });
    }

    await db.appSetting.upsert({
      where: {
        key: AI_SETTINGS_KEY,
      },
      update: {
        value: nextSettings,
      },
      create: {
        key: AI_SETTINGS_KEY,
        value: nextSettings,
      },
    });

    revalidatePath("/settings");

    return {
      status: "success",
      message: tr(d, "action.aiSettingsSaved"),
    };
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function upsertAiAuditRetentionAction(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireCurrentPermission("settings:edit");
  const d = await getDict();
  const raw = Number.parseInt(parseOptionalString(formData.get("retentionDays")) ?? "", 10);

  if (Number.isNaN(raw) || raw < 1 || raw > 3650) {
    return errorState(tr(d, "action.aiAuditRetentionInvalid"), {
      retentionDays: [tr(d, "action.aiAuditRetentionHint")],
    });
  }

  try {
    await db.appSetting.upsert({
      where: { key: AI_AUDIT_RETENTION_DAYS_KEY },
      update: { value: raw },
      create: { key: AI_AUDIT_RETENTION_DAYS_KEY, value: raw },
    });

    revalidatePath("/settings");

    return {
      status: "success",
      message: tr(d, "action.aiAuditRetentionSaved"),
    };
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function generateScheduleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("schedule:generate");
  const d = await getDict();
  const parsed = scheduleGenerationSchema.safeParse({
    startDate: parseOptionalString(formData.get("startDate")) ?? "",
    endDate: parseOptionalString(formData.get("endDate")) ?? "",
    fairnessLookbackDays: Number.parseInt(parseOptionalString(formData.get("fairnessLookbackDays")) ?? "14", 10),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  const startDate = parseUtcDate(parsed.data.startDate);
  const endDate = parseUtcDate(parsed.data.endDate);
  const historicalStartDate = new Date(startDate);
  historicalStartDate.setUTCDate(historicalStartDate.getUTCDate() - parsed.data.fairnessLookbackDays);
  const historicalEndDate = new Date(startDate);
  historicalEndDate.setUTCDate(historicalEndDate.getUTCDate() - 1);
  let aiRunId: string | null = null;

  try {
    const [users, shiftTypes, conditions, holidays, vacations, lockedEntries, historicalAssignments] = await Promise.all([
      db.user.findMany({
        where: {
          isActive: true,
        },
        include: {
          shiftTypes: {
            include: {
              shiftType: {
                include: {
                  service: true,
                },
              },
            },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      db.shiftType.findMany({
        where: {
          isActive: true,
          service: {
            isActive: true,
          },
        },
        include: {
          service: true,
        },
        orderBy: [{ service: { name: "asc" } }, { startsAt: "asc" }],
      }),
      db.condition.findMany({
        where: {
          isActive: true,
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      }),
      db.holiday.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: {
          date: "asc",
        },
      }),
      db.vacation.findMany({
        where: {
          status: VacationStatus.APPROVED,
          startDate: {
            lte: endDate,
          },
          endDate: {
            gte: startDate,
          },
        },
        include: {
          user: true,
        },
        orderBy: [{ startDate: "asc" }, { user: { lastName: "asc" } }],
      }),
      db.scheduleEntry.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
          locked: true,
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      }),
      parsed.data.fairnessLookbackDays > 0
        ? db.scheduleEntry.findMany({
            where: {
              date: {
                gte: historicalStartDate,
                lte: historicalEndDate,
              },
            },
            orderBy: [{ date: "asc" }, { createdAt: "asc" }],
          })
        : Promise.resolve([]),
    ]);

    if (shiftTypes.length === 0) {
      return errorState(tr(d, "action.noActiveShifts"));
    }

    const shiftTypeMap = new Map(
      shiftTypes.map((shiftType) => [
        shiftType.id,
        {
          ...shiftType,
          validDayTypes: shiftValidityDefinitions
            .filter((definition) => parseShiftValidity(shiftType.validityDays)[definition.key])
            .map((definition) => definition.key),
        },
      ]),
    );
    const availableUsers = users
      .map((user) => {
        const assignedShiftTypeIds = user.shiftTypes
          .map((assignment) => assignment.shiftType)
          .filter((shiftType) => shiftType.isActive && shiftType.service.isActive)
          .map((shiftType) => shiftType.id);

        return {
          id: user.id,
          name: `${user.firstName} ${user.lastName}`,
          assignedShiftTypeIds: Array.from(new Set(assignedShiftTypeIds)),
        };
      })
      .filter((user) => user.assignedShiftTypeIds.length > 0);

    if (availableUsers.length === 0) {
      return errorState(tr(d, "action.noActiveUsers"));
    }

    const availableUserIdSet = new Set(availableUsers.map((user) => user.id));

    // Build short aliases (u1, u2... and sh1, sh2...) to prevent the AI from
    // hallucinating opaque CUID strings — the model needs to echo ids back in
    // the output, so short predictable aliases are far more reliable.
    const userAliasById = new Map<string, string>();
    const aliasToUserId = new Map<string, string>();
    availableUsers.forEach((user, index) => {
      const alias = `u${index + 1}`;
      userAliasById.set(user.id, alias);
      aliasToUserId.set(alias, user.id);
    });
    const shiftTypeAliasById = new Map<string, string>();
    const aliasToShiftTypeId = new Map<string, string>();
    shiftTypes.forEach((st, index) => {
      const alias = `sh${index + 1}`;
      shiftTypeAliasById.set(st.id, alias);
      aliasToShiftTypeId.set(alias, st.id);
    });

    const holidayMap = new Map(holidays.map((holiday) => [toIsoDate(holiday.date), holiday]));
    const calendarDays = getDateRange(startDate, endDate).map((date) => {
      const isoDate = toIsoDate(date);
      const holiday = holidayMap.get(isoDate);
      const dayType = getScheduleDayType(date, Boolean(holiday));

      return {
        date: isoDate,
        weekday: getWeekdayLabel(date),
        dayType: dayType.key,
        isHoliday: Boolean(holiday),
        holidayName: holiday?.name,
      };
    });

    const input = {
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      fairnessLookbackDays: parsed.data.fairnessLookbackDays,
      calendarDays,
      users: availableUsers.map((user) => ({
        id: userAliasById.get(user.id)!,
        name: user.name,
        assignedShiftTypeIds: user.assignedShiftTypeIds
          .map((id) => shiftTypeAliasById.get(id))
          .filter((alias): alias is string => alias !== undefined),
      })),
      shiftTypes: shiftTypes.map((shiftType) => ({
        id: shiftTypeAliasById.get(shiftType.id)!,
        serviceName: shiftType.service.name,
        name: shiftType.name,
        startsAt: shiftType.startsAt,
        endsAt: shiftType.endsAt,
        crossesMidnight: shiftType.crossesMidnight,
        validDayTypes: shiftValidityDefinitions
          .filter((definition) => parseShiftValidity(shiftType.validityDays)[definition.key])
          .map((definition) => definition.key),
      })),
      conditions: conditions.map((condition) => ({
        id: condition.id,
        type: condition.type,
        title: condition.title,
        description: condition.description,
        priority: condition.priority,
      })),
      holidays: holidays.map((holiday) => ({
        date: toIsoDate(holiday.date),
        name: holiday.name,
        country: holiday.country,
      })),
      vacations: vacations.map((vacation) => ({
        userId: userAliasById.get(vacation.userId) ?? vacation.userId,
        userName: `${vacation.user.firstName} ${vacation.user.lastName}`,
        startDate: toIsoDate(vacation.startDate),
        endDate: toIsoDate(vacation.endDate),
        notes: vacation.notes ?? undefined,
      })),
      lockedEntries: lockedEntries.map((entry) => ({
        date: toIsoDate(entry.date),
        userId: userAliasById.get(entry.userId) ?? entry.userId,
        shiftTypeId: shiftTypeAliasById.get(entry.shiftTypeId) ?? entry.shiftTypeId,
        note: entry.note ?? undefined,
      })),
      historicalAssignments: historicalAssignments
        .filter((entry) => availableUserIdSet.has(entry.userId) && shiftTypeMap.has(entry.shiftTypeId))
        .map((entry) => ({
          date: toIsoDate(entry.date),
          weekdayNumber: getWeekdayNumber(entry.date),
          userId: userAliasById.get(entry.userId)!,
          shiftTypeId: shiftTypeAliasById.get(entry.shiftTypeId)!,
        })),
    };
    const aiRunInput = JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;

    const provider = await createAiProvider();
    const aiRun = await db.aiRun.create({
      data: {
        provider: toAiProviderKind(provider.name),
        useCase: "schedule-generation",
        status: AiRunStatus.RUNNING,
        input: aiRunInput,
        startedAt: new Date(),
      },
    });
    aiRunId = aiRun.id;
    const failAiRun = async (message: string) => {
      await db.aiRun.update({
        where: {
          id: aiRun.id,
        },
        data: {
          status: AiRunStatus.FAILED,
          error: message,
          finishedAt: new Date(),
        },
      });

      return errorState(message);
    };

    let draft: Awaited<ReturnType<typeof provider.generateScheduleDraft>>;

    try {
      draft = await provider.generateScheduleDraft(input);
    } catch (error) {
      await db.aiRun.update({
        where: {
          id: aiRun.id,
        },
        data: {
          status: AiRunStatus.FAILED,
          error: parseActionError(error, d),
          finishedAt: new Date(),
        },
      });

      return errorState(parseActionError(error, d));
    }

    // Remap short aliases back to real database IDs before validation
    draft = {
      ...draft,
      events: draft.events.map((event) => ({
        ...event,
        userId: aliasToUserId.get(event.userId) ?? event.userId,
        shiftTypeId: aliasToShiftTypeId.get(event.shiftTypeId) ?? event.shiftTypeId,
      })),
    };

    if (draft.events.length === 0) {
      return failAiRun(tr(d, "action.aiNoResults"));
    }

    const userMap = new Map(availableUsers.map((user) => [user.id, user]));
    const holidayDates = new Set(holidays.map((holiday) => toIsoDate(holiday.date)));
    const lockedSignatureSet = new Set(lockedEntries.map((entry) => `${toIsoDate(entry.date)}::${entry.userId}::${entry.shiftTypeId}`));
    // Tracks date::shiftTypeId to enforce one shift type per day globally
    const lockedShiftTypeOnDaySet = new Set(lockedEntries.map((entry) => `${toIsoDate(entry.date)}::${entry.shiftTypeId}`));
    const generatedSignatureSet = new Set<string>();
    const generatedShiftTypeOnDaySet = new Set<string>();
    const validEvents: typeof draft.events = [];
    const skippedReasons: string[] = [];
    const auditEntries: Array<{ date: string; userId: string | null; userName: string | null; shiftTypeId: string | null; shiftTypeName: string | null; accepted: boolean; reason: string | null }> = [];

    for (const event of draft.events) {
      const eventDate = parseUtcDate(event.date);

      if (eventDate < startDate || eventDate > endDate) {
        const reason = tr(d, "action.aiOutOfRange", { date: event.date });
        skippedReasons.push(reason);
        auditEntries.push({ date: event.date, userId: event.userId, userName: userMap.get(event.userId)?.name ?? null, shiftTypeId: event.shiftTypeId, shiftTypeName: shiftTypeMap.get(event.shiftTypeId)?.name ?? null, accepted: false, reason });
        continue;
      }

      const user = userMap.get(event.userId);
      if (!user) {
        const reason = tr(d, "action.aiUnknownUser", { userId: event.userId });
        skippedReasons.push(reason);
        auditEntries.push({ date: event.date, userId: event.userId, userName: null, shiftTypeId: event.shiftTypeId, shiftTypeName: shiftTypeMap.get(event.shiftTypeId)?.name ?? null, accepted: false, reason });
        continue;
      }

      if (!user.assignedShiftTypeIds.includes(event.shiftTypeId)) {
        const reason = tr(d, "action.aiShiftNotAssigned", { shiftTypeId: event.shiftTypeId, userId: event.userId });
        skippedReasons.push(reason);
        auditEntries.push({ date: event.date, userId: event.userId, userName: user.name, shiftTypeId: event.shiftTypeId, shiftTypeName: shiftTypeMap.get(event.shiftTypeId)?.name ?? null, accepted: false, reason });
        continue;
      }

      const shiftType = shiftTypeMap.get(event.shiftTypeId);
      if (!shiftType) {
        const reason = tr(d, "action.aiUnknownShift", { shiftTypeId: event.shiftTypeId });
        skippedReasons.push(reason);
        auditEntries.push({ date: event.date, userId: event.userId, userName: user.name, shiftTypeId: event.shiftTypeId, shiftTypeName: null, accepted: false, reason });
        continue;
      }

      const validityError = getScheduleValidityError(shiftType.validityDays, eventDate, holidayDates.has(event.date), d);
      if (validityError) {
        const reason = tr(d, "action.aiInvalidShift", { date: event.date, error: validityError });
        skippedReasons.push(reason);
        auditEntries.push({ date: event.date, userId: event.userId, userName: user.name, shiftTypeId: event.shiftTypeId, shiftTypeName: shiftType.name, accepted: false, reason });
        continue;
      }

      const overlapsVacation = vacations.some((vacation) => vacation.userId === event.userId && eventDate >= vacation.startDate && eventDate <= vacation.endDate);
      if (overlapsVacation) {
        const reason = tr(d, "action.aiVacationConflict", { userName: user.name, date: event.date });
        skippedReasons.push(reason);
        auditEntries.push({ date: event.date, userId: event.userId, userName: user.name, shiftTypeId: event.shiftTypeId, shiftTypeName: shiftType.name, accepted: false, reason });
        continue;
      }

      const signature = `${event.date}::${event.userId}::${event.shiftTypeId}`;
      if (generatedSignatureSet.has(signature)) {
        const reason = tr(d, "action.aiDuplicate", { date: event.date, userId: event.userId, shiftTypeId: event.shiftTypeId });
        skippedReasons.push(reason);
        auditEntries.push({ date: event.date, userId: event.userId, userName: user.name, shiftTypeId: event.shiftTypeId, shiftTypeName: shiftType.name, accepted: false, reason });
        continue;
      }

      if (lockedSignatureSet.has(signature)) {
        const reason = tr(d, "action.aiLockedDuplicate", { date: event.date, userId: event.userId, shiftTypeId: event.shiftTypeId });
        skippedReasons.push(reason);
        auditEntries.push({ date: event.date, userId: event.userId, userName: user.name, shiftTypeId: event.shiftTypeId, shiftTypeName: shiftType.name, accepted: false, reason });
        continue;
      }

      const shiftTypeOnDayKey = `${event.date}::${event.shiftTypeId}`;
      if (lockedShiftTypeOnDaySet.has(shiftTypeOnDayKey) || generatedShiftTypeOnDaySet.has(shiftTypeOnDayKey)) {
        const reason = tr(d, "action.aiShiftTypeDuplicate", { shiftTypeId: event.shiftTypeId, date: event.date });
        skippedReasons.push(reason);
        auditEntries.push({ date: event.date, userId: event.userId, userName: user.name, shiftTypeId: event.shiftTypeId, shiftTypeName: shiftType.name, accepted: false, reason });
        continue;
      }

      generatedSignatureSet.add(signature);
      generatedShiftTypeOnDaySet.add(shiftTypeOnDayKey);
      validEvents.push(event);
      auditEntries.push({ date: event.date, userId: event.userId, userName: user.name, shiftTypeId: event.shiftTypeId, shiftTypeName: shiftType.name, accepted: true, reason: null });
    }

    if (validEvents.length === 0) {
      const reason = skippedReasons.length > 0 ? skippedReasons[0] : tr(d, "action.aiNoResults");
      // Write audit entries even for failed runs
      if (auditEntries.length > 0) {
        await db.aiAuditEntry.createMany({
          data: auditEntries.map((entry) => ({ aiRunId: aiRun.id, ...entry })),
        });
      }
      return failAiRun(reason);
    }

    await db.$transaction(async (tx) => {
      await tx.scheduleEntry.deleteMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
          locked: false,
        },
      });

      for (const event of validEvents) {
        const shiftType = shiftTypeMap.get(event.shiftTypeId);

        if (!shiftType) {
          throw new Error(`Missing shift type ${event.shiftTypeId} during schedule save.`);
        }

        const entry = await tx.scheduleEntry.create({
          data: {
            date: parseUtcDate(event.date),
            userId: event.userId,
            serviceId: shiftType.serviceId,
            shiftTypeId: event.shiftTypeId,
            locked: false,
            source: ScheduleSource.AI,
            note: event.note ?? null,
          },
        });

        await writeAuditLog(tx, "SCHEDULE_ENTRY", entry.id, {
          date: entry.date.toISOString(),
          userId: entry.userId,
          serviceId: entry.serviceId,
          shiftTypeId: entry.shiftTypeId,
          locked: entry.locked,
          source: entry.source,
          note: entry.note,
        }, "CREATE", actorId);
      }

      // Write AI audit entries within the same transaction
      if (auditEntries.length > 0) {
        await tx.aiAuditEntry.createMany({
          data: auditEntries.map((entry) => ({ aiRunId: aiRun.id, ...entry })),
        });
      }
    });

    await db.aiRun.update({
      where: {
        id: aiRun.id,
      },
      data: {
        status: AiRunStatus.SUCCEEDED,
        output: JSON.parse(JSON.stringify(draft)) as Prisma.InputJsonValue,
        error: skippedReasons.length > 0 ? skippedReasons.join("\n") : null,
        finishedAt: new Date(),
      },
    });

    // Run audit retention cleanup after successful generation
    await cleanupAiAuditLogs();

    const generatedCountsByUser = validEvents.reduce<Record<string, number>>((accumulator, event) => {
      accumulator[event.userId] = (accumulator[event.userId] ?? 0) + 1;
      return accumulator;
    }, {});

    await Promise.all(
      Object.entries(generatedCountsByUser).map(([userId, count]) =>
        dispatchNotificationSafely({
          recipients: [{ userId }],
          title: tr(d, "action.aiGenTitle"),
          message: tr(d, "action.aiGenUserMsg", { count: String(count) }),
          actionUrl: "/schedule",
          entityType: "SCHEDULE_ENTRY",
          entityLabel: `${parsed.data.startDate} až ${parsed.data.endDate}`,
          tag: "schedule-generated",
        }),
      ),
    );

    let message = tr(d, "action.aiGenSuccess", { count: String(validEvents.length) });
    if (skippedReasons.length > 0) {
      message += " " + tr(d, "action.aiGenSkipped", { count: String(skippedReasons.length) });
    }

    return successState(message, "/schedule");
  } catch (error) {
    if (aiRunId) {
      try {
        await db.aiRun.update({
          where: {
            id: aiRunId,
          },
          data: {
            status: AiRunStatus.FAILED,
            error: parseActionError(error, d),
            finishedAt: new Date(),
          },
        });
      } catch {
        // Ignore secondary AI run update failure.
      }
    }

    return errorState(parseActionError(error, d));
  }
}

export async function createScheduleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("schedule:create");
  const locale = await getServerLocale();
  const d = getDictionary(locale);
  const parsed = scheduleSchema.safeParse({
    date: parseOptionalString(formData.get("date")) ?? "",
    userId: parseOptionalString(formData.get("userId")) ?? "",
    shiftTypeId: parseOptionalString(formData.get("shiftTypeId")) ?? "",
    locked: parseBoolean(formData, "locked"),
    source: parseOptionalString(formData.get("source")) ?? ScheduleSource.MANUAL,
    note: parseOptionalString(formData.get("note")),
  });

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  const shiftType = await db.shiftType.findUnique({
    where: {
      id: parsed.data.shiftTypeId,
    },
    select: {
      name: true,
      serviceId: true,
      service: {
        select: {
          name: true,
        },
      },
      validityDays: true,
    },
  });

  if (!shiftType) {
    return errorState(tr(d, "action.shiftNotExistSingle"), {
      shiftTypeId: [tr(d, "action.shiftNotExistSingleHint")],
    });
  }

  const scheduleDate = parseUtcDate(parsed.data.date);
  const holiday = await db.holiday.findUnique({
    where: {
      date: scheduleDate,
    },
    select: {
      id: true,
    },
  });
  const validityError = getScheduleValidityError(shiftType.validityDays, scheduleDate, Boolean(holiday), d);

  if (validityError) {
    return errorState(validityError, {
      shiftTypeId: [validityError],
    });
  }

  const duplicateEntry = await db.scheduleEntry.findFirst({
    where: {
      date: scheduleDate,
      userId: parsed.data.userId,
    },
    select: {
      id: true,
    },
  });

  if (duplicateEntry) {
    const duplicateMessage = tr(d, "action.scheduleDuplicateEntry", {
      date: formatDisplayDateValue(parsed.data.date, locale),
    });

    return errorState(duplicateMessage, {
      date: [duplicateMessage],
      userId: [duplicateMessage],
    });
  }

  const shiftTypeDuplicateEntry = await db.scheduleEntry.findFirst({
    where: {
      date: scheduleDate,
      shiftTypeId: parsed.data.shiftTypeId,
    },
    select: { id: true },
  });

  if (shiftTypeDuplicateEntry) {
    const msg = tr(d, "action.scheduleShiftTypeDuplicate", {
      shiftTypeName: shiftType.name,
      date: formatDisplayDateValue(parsed.data.date, locale),
    });
    return errorState(msg, { shiftTypeId: [msg] });
  }

  try {
    const notificationPayload = await db.$transaction(async (tx) => {
      const entry = await tx.scheduleEntry.create({
        data: {
          date: scheduleDate,
          userId: parsed.data.userId,
          serviceId: shiftType.serviceId,
          shiftTypeId: parsed.data.shiftTypeId,
          locked: parsed.data.locked,
          source: parsed.data.source,
          note: parsed.data.note ?? null,
        },
        include: {
          user: true,
          service: true,
          shiftType: true,
        },
      });

      await writeAuditLog(tx, "SCHEDULE_ENTRY", entry.id, {
        date: entry.date.toISOString(),
        userId: entry.userId,
        serviceId: entry.serviceId,
        shiftTypeId: entry.shiftTypeId,
        locked: entry.locked,
        source: entry.source,
        note: entry.note,
      }, "CREATE", actorId);

      return {
        userId: entry.userId,
        title: tr(d, "action.newScheduleEntry"),
        message: tr(d, "action.newScheduleEntryMsg", { service: entry.service.name, shift: entry.shiftType.name, date: parsed.data.date }),
      };
    });

    await dispatchNotificationSafely({
      recipients: [{ userId: notificationPayload.userId }],
      title: notificationPayload.title,
      message: notificationPayload.message,
      actionUrl: "/schedule",
      entityType: "SCHEDULE_ENTRY",
      entityLabel: parsed.data.date,
      tag: "schedule-created",
    });

    return successState(tr(d, "action.scheduleCreated"), "/schedule");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function updateScheduleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("schedule:edit");
  const locale = await getServerLocale();
  const d = getDictionary(locale);
  const id = parseRequiredId(formData);
  const parsed = scheduleSchema.safeParse({
    date: parseOptionalString(formData.get("date")) ?? "",
    userId: parseOptionalString(formData.get("userId")) ?? "",
    shiftTypeId: parseOptionalString(formData.get("shiftTypeId")) ?? "",
    locked: parseBoolean(formData, "locked"),
    source: parseOptionalString(formData.get("source")) ?? ScheduleSource.MANUAL,
    note: parseOptionalString(formData.get("note")),
  });

  if (!id) {
    return errorState(tr(d, "action.missingId"));
  }

  if (!parsed.success) {
    return errorState(tr(d, "action.reviewFields"), parseZodError(parsed));
  }

  const existingEntry = await db.scheduleEntry.findUnique({
    where: { id },
    select: {
      locked: true,
    },
  });

  if (!existingEntry) {
    return missingIdState(d);
  }

  if (existingEntry.locked) {
    return lockedRecordError(d, "action.scheduleLockedError");
  }

  const shiftType = await db.shiftType.findUnique({
    where: {
      id: parsed.data.shiftTypeId,
    },
    select: {
      name: true,
      serviceId: true,
      service: {
        select: {
          name: true,
        },
      },
      validityDays: true,
    },
  });

  if (!shiftType) {
    return errorState(tr(d, "action.shiftNotExistSingle"), {
      shiftTypeId: [tr(d, "action.shiftNotExistSingleHint")],
    });
  }

  const scheduleDate = parseUtcDate(parsed.data.date);
  const holiday = await db.holiday.findUnique({
    where: {
      date: scheduleDate,
    },
    select: {
      id: true,
    },
  });
  const validityError = getScheduleValidityError(shiftType.validityDays, scheduleDate, Boolean(holiday), d);

  if (validityError) {
    return errorState(validityError, {
      shiftTypeId: [validityError],
    });
  }

  const duplicateEntry = await db.scheduleEntry.findFirst({
    where: {
      date: scheduleDate,
      userId: parsed.data.userId,
      id: { not: id },
    },
    select: { id: true },
  });

  if (duplicateEntry) {
    const duplicateMessage = tr(d, "action.scheduleDuplicateEntry", {
      date: formatDisplayDateValue(parsed.data.date, locale),
    });

    return errorState(duplicateMessage, {
      date: [duplicateMessage],
      userId: [duplicateMessage],
    });
  }

  const shiftTypeDuplicateEntry = await db.scheduleEntry.findFirst({
    where: {
      date: scheduleDate,
      shiftTypeId: parsed.data.shiftTypeId,
      id: { not: id },
    },
    select: { id: true },
  });

  if (shiftTypeDuplicateEntry) {
    const msg = tr(d, "action.scheduleShiftTypeDuplicate", {
      shiftTypeName: shiftType.name,
      date: formatDisplayDateValue(parsed.data.date, locale),
    });
    return errorState(msg, { shiftTypeId: [msg] });
  }

  try {
    const notificationPayload = await db.$transaction(async (tx) => {
      const entry = await tx.scheduleEntry.update({
        where: { id },
        data: {
          date: scheduleDate,
          userId: parsed.data.userId,
          serviceId: shiftType.serviceId,
          shiftTypeId: parsed.data.shiftTypeId,
          locked: parsed.data.locked,
          source: parsed.data.source,
          note: parsed.data.note ?? null,
        },
        include: {
          user: true,
          service: true,
          shiftType: true,
        },
      });

      await writeAuditLog(
        tx,
        "SCHEDULE_ENTRY",
        entry.id,
        {
          date: entry.date.toISOString(),
          userId: entry.userId,
          serviceId: entry.serviceId,
          shiftTypeId: entry.shiftTypeId,
          locked: entry.locked,
          source: entry.source,
          note: entry.note,
        },
        "UPDATE",
        actorId,
      );

      return {
        userId: entry.userId,
        title: tr(d, "action.scheduleEntryUpdated"),
        message: tr(d, "action.scheduleEntryUpdatedMsg", { service: entry.service.name, shift: entry.shiftType.name, date: parsed.data.date }),
      };
    });

    await dispatchNotificationSafely({
      recipients: [{ userId: notificationPayload.userId }],
      title: notificationPayload.title,
      message: notificationPayload.message,
      actionUrl: "/schedule",
      entityType: "SCHEDULE_ENTRY",
      entityLabel: parsed.data.date,
      tag: "schedule-updated",
    });

    return successState(tr(d, "action.scheduleUpdated"), "/schedule");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function moveScheduleEntryAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("schedule:edit");
  const locale = await getServerLocale();
  const d = getDictionary(locale);

  const id = parseOptionalString(formData.get("id"))?.trim();
  const targetDate = parseOptionalString(formData.get("targetDate"))?.trim();

  if (!id || !targetDate) {
    return errorState(tr(d, "action.missingId"));
  }

  const entry = await db.scheduleEntry.findUnique({
    where: { id },
    include: { user: true, service: true, shiftType: true },
  });

  if (!entry) {
    return missingIdState(d);
  }

  if (entry.locked) {
    return errorState(tr(d, "action.scheduleMoveSourceLocked"));
  }

  const parsedTargetDate = parseUtcDate(targetDate);
  const sourceDate = entry.date;

  // Check if the shift type is valid for the target day
  const holiday = await db.holiday.findUnique({
    where: { date: parsedTargetDate },
    select: { id: true },
  });
  const validityError = getScheduleValidityError(entry.shiftType.validityDays, parsedTargetDate, Boolean(holiday), d);

  if (validityError) {
    return errorState(validityError);
  }

  // Check for same-user duplicate on target date (but not the same entry)
  const userDuplicate = await db.scheduleEntry.findFirst({
    where: {
      date: parsedTargetDate,
      userId: entry.userId,
      id: { not: id },
    },
    select: { id: true },
  });

  if (userDuplicate) {
    return errorState(tr(d, "action.scheduleDuplicateEntry", {
      date: formatDisplayDateValue(targetDate, locale),
    }));
  }

  // Check for shift-type conflict on target date
  const conflictEntry = await db.scheduleEntry.findFirst({
    where: {
      date: parsedTargetDate,
      shiftTypeId: entry.shiftTypeId,
      id: { not: id },
    },
    include: { user: true, service: true, shiftType: true },
  });

  if (conflictEntry) {
    // If the conflicting entry is locked, block the move
    if (conflictEntry.locked) {
      return errorState(tr(d, "action.scheduleMoveLockedConflict", {
        date: formatDisplayDateValue(targetDate, locale),
      }));
    }

    // If the conflicting entry is unlocked, swap dates between the two entries
    // Also check that the conflict entry's shift type is valid for the source date
    const sourceHoliday = await db.holiday.findUnique({
      where: { date: sourceDate },
      select: { id: true },
    });
    const reverseValidityError = getScheduleValidityError(conflictEntry.shiftType.validityDays, sourceDate, Boolean(sourceHoliday), d);

    if (reverseValidityError) {
      return errorState(reverseValidityError);
    }

    // Check that the conflict entry's user doesn't already have an entry on the source date
    const reverseUserDuplicate = await db.scheduleEntry.findFirst({
      where: {
        date: sourceDate,
        userId: conflictEntry.userId,
        id: { not: conflictEntry.id },
      },
      select: { id: true },
    });

    if (reverseUserDuplicate) {
      return errorState(tr(d, "action.scheduleDuplicateEntry", {
        date: formatDisplayDateValue(sourceDate.toISOString().slice(0, 10), locale),
      }));
    }

    try {
      await db.$transaction(async (tx) => {
        // Move source entry to target date
        await tx.scheduleEntry.update({
          where: { id: entry.id },
          data: { date: parsedTargetDate },
        });

        // Move conflict entry to source date
        await tx.scheduleEntry.update({
          where: { id: conflictEntry.id },
          data: { date: sourceDate },
        });

        await writeAuditLog(tx, "SCHEDULE_ENTRY", entry.id, { date: parsedTargetDate.toISOString() }, "UPDATE", actorId);
        await writeAuditLog(tx, "SCHEDULE_ENTRY", conflictEntry.id, { date: sourceDate.toISOString() }, "UPDATE", actorId);
      });

      return successState(tr(d, "action.scheduleSwapped"), "/schedule");
    } catch (error) {
      return errorState(parseActionError(error, d));
    }
  }

  // No conflict — simple move
  try {
    await db.$transaction(async (tx) => {
      await tx.scheduleEntry.update({
        where: { id: entry.id },
        data: { date: parsedTargetDate },
      });

      await writeAuditLog(tx, "SCHEDULE_ENTRY", entry.id, { date: parsedTargetDate.toISOString() }, "UPDATE", actorId);
    });

    return successState(tr(d, "action.scheduleMoved", { date: formatDisplayDateValue(targetDate, locale) }), "/schedule");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function importUsersCsvAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("users:importExport");
  const d = await getDict();
  try {
    const records = await getCsvImportRecords(formData, [
      "email",
      "firstName",
      "lastName",
    ]);
    let created = 0;
    let updated = 0;

    await db.$transaction(async (tx) => {
      for (const record of records) {
        const parsed = userSchema.safeParse({
          email: getRequiredCsvValue(record, "email"),
          firstName: getRequiredCsvValue(record, "firstName"),
          lastName: getRequiredCsvValue(record, "lastName"),
          roleId: undefined,
          isActive: parseCsvBoolean(record.isActive, true),
          preferredTheme: getOptionalCsvValue(record, "preferredTheme"),
          notificationsEnabled: parseCsvBoolean(record.notificationsEnabled),
          notificationDays: parseCsvInteger(record.notificationDays, 1),
        });

        if (!parsed.success) {
          throw new Error(`Invalid user row for "${record.email ?? "unknown"}".`);
        }

        const roleReference = getOptionalCsvValue(record, "roleId");
        const roleId = roleReference ? await resolveRoleReference(tx, roleReference) : null;
        const shiftTypeReferences = parseCsvStringArray(record.shiftTypeIds);
        const shiftTypeIds = await Promise.all(shiftTypeReferences.map(async (reference) => (await resolveShiftReference(tx, reference)).id));
        const permissionCodesRaw = parseCsvStringArray(record.permissionCodes);
        const invalidPermissionCodes = permissionCodesRaw.filter((code) => !permissionCatalog.includes(code as PermissionCode));

        if (invalidPermissionCodes.length > 0) {
          throw new Error(`Invalid user permissions for "${record.email ?? "unknown"}": ${invalidPermissionCodes.join(", ")}.`);
        }

        const existing = await tx.user.findUnique({
          where: { email: parsed.data.email },
          select: { id: true },
        });
        const user = existing
          ? await tx.user.update({
              where: { id: existing.id },
              data: {
                ...parsed.data,
                roleId,
              },
            })
          : await tx.user.create({
              data: {
                ...parsed.data,
                roleId,
              },
            });
        const rolePermissionCodes =
          roleId
            ? (
                await tx.role.findUnique({
                  where: { id: roleId },
                  include: {
                    permissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                })
              )?.permissions.map((assignment) => assignment.permission.code as PermissionCode) ?? []
            : [];

        await tx.userShiftType.deleteMany({
          where: {
            userId: user.id,
          },
        });

        if (shiftTypeIds.length > 0) {
          await tx.userShiftType.createMany({
            data: shiftTypeIds.map((shiftTypeId) => ({
              userId: user.id,
              shiftTypeId,
            })),
          });
        }

        await replaceUserPermissionOverrides(tx, {
          userId: user.id,
          rolePermissionCodes,
          selectedPermissionCodes: permissionCodesRaw as PermissionCode[],
        });

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        await writeAuditLog(
          tx,
          "USER",
          user.id,
          {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            roleId: user.roleId,
            shiftTypeIds,
            notificationsEnabled: user.notificationsEnabled,
            notificationDays: user.notificationDays,
            preferredTheme: user.preferredTheme,
            permissionCodes: permissionCodesRaw,
          },
          existing ? "UPDATE" : "CREATE",
          actorId,
        );
      }
    });

    return successState(tr(d, "import.usersSuccess", { total: String(records.length), created: String(created), updated: String(updated) }), "/users");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function importRolesCsvAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("roles:importExport");
  const d = await getDict();
  try {
    const records = await getCsvImportRecords(formData, ["code", "name", "description", "permissionCodes"]);
    let created = 0;
    let updated = 0;

    await db.$transaction(async (tx) => {
      for (const record of records) {
        const parsed = roleSchema.safeParse({
          code: getRequiredCsvValue(record, "code"),
          name: getRequiredCsvValue(record, "name"),
          description: getOptionalCsvValue(record, "description"),
        });

        if (!parsed.success) {
          throw new Error(`Invalid role row for "${record.code ?? "unknown"}".`);
        }

        const permissionCodesRaw = parseCsvStringArray(record.permissionCodes);
        const invalidPermissionCodes = permissionCodesRaw.filter((code) => !permissionCatalog.includes(code as PermissionCode));

        if (invalidPermissionCodes.length > 0) {
          throw new Error(`Invalid role permissions for "${record.code ?? "unknown"}": ${invalidPermissionCodes.join(", ")}.`);
        }

        const existing = await tx.role.findUnique({
          where: { code: parsed.data.code },
          select: { id: true },
        });
        const role = existing
          ? await tx.role.update({
              where: { id: existing.id },
              data: parsed.data,
            })
          : await tx.role.create({
              data: parsed.data,
            });

        await replaceRolePermissions(tx, role.id, permissionCodesRaw as PermissionCode[]);

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        await writeAuditLog(
          tx,
          "ROLE",
          role.id,
          {
            code: role.code,
            name: role.name,
            description: role.description,
            permissionCodes: permissionCodesRaw,
          },
          existing ? "UPDATE" : "CREATE",
          actorId,
        );
      }
    });

    return successState(tr(d, "import.rolesSuccess", { total: String(records.length), created: String(created), updated: String(updated) }), "/roles");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function importServicesCsvAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("services:importExport");
  const d = await getDict();
  try {
    const records = await getCsvImportRecords(formData, [
      "code",
      "name",
      "colorLight",
      "textColorLight",
      "colorDark",
      "textColorDark",
      "isActive",
    ]);
    let created = 0;
    let updated = 0;

    await db.$transaction(async (tx) => {
      for (const record of records) {
        const parsed = serviceSchema.safeParse({
          code: getRequiredCsvValue(record, "code"),
          name: getRequiredCsvValue(record, "name"),
          colorLight: getOptionalCsvValue(record, "colorLight"),
          textColorLight: getOptionalCsvValue(record, "textColorLight"),
          opacityLight: parseCsvInteger(record.opacityLight, 50),
          colorDark: getOptionalCsvValue(record, "colorDark"),
          textColorDark: getOptionalCsvValue(record, "textColorDark"),
          opacityDark: parseCsvInteger(record.opacityDark, 100),
          isActive: parseCsvBoolean(record.isActive, true),
        });

        if (!parsed.success) {
          throw new Error(`Invalid service row for "${record.code ?? "unknown"}".`);
        }

        const existing = await tx.service.findUnique({
          where: { code: parsed.data.code },
          select: { id: true },
        });
        const service = existing
          ? await tx.service.update({
              where: { id: existing.id },
              data: parsed.data,
            })
          : await tx.service.create({
              data: parsed.data,
            });

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        await writeAuditLog(
          tx,
          "SERVICE",
          service.id,
          {
            code: service.code,
            name: service.name,
            isActive: service.isActive,
            colorLight: service.colorLight,
            textColorLight: service.textColorLight,
            opacityLight: service.opacityLight,
            colorDark: service.colorDark,
            textColorDark: service.textColorDark,
            opacityDark: service.opacityDark,
          },
          existing ? "UPDATE" : "CREATE",
          actorId,
        );
      }
    });

    return successState(tr(d, "import.servicesSuccess", { total: String(records.length), created: String(created), updated: String(updated) }), "/services");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function importShiftsCsvAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("shifts:importExport");
  const d = await getDict();
  try {
    const records = await getCsvImportRecords(formData, [
      "code",
      "name",
      "serviceId",
      "startsAt",
      "endsAt",
      "crossesMidnight",
      "validOnMon",
      "validOnTue",
      "validOnWed",
      "validOnThu",
      "validOnFri",
      "validOnSat",
      "validOnSun",
      "validOnHoliday",
      "isActive",
    ]);
    let created = 0;
    let updated = 0;

    await db.$transaction(async (tx) => {
      for (const record of records) {
        const serviceId = await resolveServiceReference(tx, getRequiredCsvValue(record, "serviceId"));
        const parsed = shiftSchema.safeParse({
          code: getRequiredCsvValue(record, "code"),
          name: getRequiredCsvValue(record, "name"),
          serviceId,
          startsAt: getRequiredCsvValue(record, "startsAt"),
          endsAt: getRequiredCsvValue(record, "endsAt"),
          crossesMidnight: parseCsvBoolean(record.crossesMidnight),
          validityDays: buildShiftValidityFromFieldValues({
            validOnMon: parseCsvBoolean(record.validOnMon, true),
            validOnTue: parseCsvBoolean(record.validOnTue, true),
            validOnWed: parseCsvBoolean(record.validOnWed, true),
            validOnThu: parseCsvBoolean(record.validOnThu, true),
            validOnFri: parseCsvBoolean(record.validOnFri, true),
            validOnSat: parseCsvBoolean(record.validOnSat, true),
            validOnSun: parseCsvBoolean(record.validOnSun, true),
            validOnHoliday: parseCsvBoolean(record.validOnHoliday, true),
          }),
          isActive: parseCsvBoolean(record.isActive, true),
        });

        if (!parsed.success) {
          throw new Error(`Invalid shift row for "${record.code ?? "unknown"}".`);
        }

        const existing = await tx.shiftType.findUnique({
          where: { code: parsed.data.code },
          select: { id: true },
        });
        const shiftType = existing
          ? await tx.shiftType.update({
              where: { id: existing.id },
              data: parsed.data,
            })
          : await tx.shiftType.create({
              data: parsed.data,
            });

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        await writeAuditLog(
          tx,
          "SHIFT_TYPE",
          shiftType.id,
          {
            code: shiftType.code,
            name: shiftType.name,
            serviceId: shiftType.serviceId,
            startsAt: shiftType.startsAt,
            endsAt: shiftType.endsAt,
            crossesMidnight: shiftType.crossesMidnight,
            validityDays: shiftType.validityDays as Prisma.InputJsonValue | null,
            isActive: shiftType.isActive,
          },
          existing ? "UPDATE" : "CREATE",
          actorId,
        );
      }
    });

    return successState(tr(d, "import.shiftsSuccess", { total: String(records.length), created: String(created), updated: String(updated) }), "/shifts");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function importVacationsCsvAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("vacations:importExport");
  const d = await getDict();
  try {
    const records = await getCsvImportRecords(formData, ["userId", "startDate", "endDate", "status", "notes"]);
    let created = 0;
    let updated = 0;

    await db.$transaction(async (tx) => {
      for (const record of records) {
        const userId = await resolveUserReference(tx, getRequiredCsvValue(record, "userId"));
        const parsed = vacationSchema.safeParse({
          userId,
          startDate: getRequiredCsvValue(record, "startDate"),
          endDate: getRequiredCsvValue(record, "endDate"),
          locked: parseCsvBoolean(record.locked),
          status: getRequiredCsvValue(record, "status"),
          notes: getOptionalCsvValue(record, "notes"),
        });

        if (!parsed.success) {
          throw new Error(`Invalid vacation row for "${record.userId ?? "unknown"}".`);
        }

        const existing = await tx.vacation.findFirst({
          where: {
            userId,
            startDate: parseUtcDate(parsed.data.startDate),
            endDate: parseUtcDate(parsed.data.endDate),
          },
          select: { id: true, locked: true },
        });

        if (existing?.locked) {
          throw new Error(`Vacation "${record.userId ?? "unknown"}" for ${parsed.data.startDate} - ${parsed.data.endDate} is locked.`);
        }
        const vacation = existing
          ? await tx.vacation.update({
              where: { id: existing.id },
              data: {
                userId,
                startDate: parseUtcDate(parsed.data.startDate),
                endDate: parseUtcDate(parsed.data.endDate),
                locked: parsed.data.locked,
                status: parsed.data.status,
                notes: parsed.data.notes ?? null,
              },
            })
          : await tx.vacation.create({
              data: {
                userId,
                startDate: parseUtcDate(parsed.data.startDate),
                endDate: parseUtcDate(parsed.data.endDate),
                locked: parsed.data.locked,
                status: parsed.data.status,
                notes: parsed.data.notes ?? null,
              },
            });

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        await writeAuditLog(
          tx,
          "VACATION",
          vacation.id,
          {
            userId: vacation.userId,
            startDate: vacation.startDate.toISOString(),
            endDate: vacation.endDate.toISOString(),
            locked: vacation.locked,
            status: vacation.status,
            notes: vacation.notes,
          },
          existing ? "UPDATE" : "CREATE",
          actorId,
        );
      }
    });

    return successState(tr(d, "import.vacationsSuccess", { total: String(records.length), created: String(created), updated: String(updated) }), "/vacations");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function importConditionsCsvAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("conditions:importExport");
  const d = await getDict();
  try {
    const records = await getCsvImportRecords(formData, ["type", "title", "priority", "isActive", "description"]);
    let created = 0;
    let updated = 0;

    await db.$transaction(async (tx) => {
      for (const record of records) {
        const parsed = conditionSchema.safeParse({
          type: getRequiredCsvValue(record, "type"),
          title: getRequiredCsvValue(record, "title"),
          priority: parseCsvInteger(record.priority, 100),
          isActive: parseCsvBoolean(record.isActive, true),
          description: getRequiredCsvValue(record, "description"),
        });

        if (!parsed.success) {
          throw new Error(`Invalid condition row for "${record.title ?? "unknown"}".`);
        }

        const existing = await tx.condition.findFirst({
          where: {
            type: parsed.data.type,
            title: parsed.data.title,
          },
          select: { id: true },
        });
        const condition = existing
          ? await tx.condition.update({
              where: { id: existing.id },
              data: parsed.data,
            })
          : await tx.condition.create({
              data: parsed.data,
            });

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        await writeAuditLog(
          tx,
          "CONDITION",
          condition.id,
          {
            type: condition.type,
            title: condition.title,
            description: condition.description,
            priority: condition.priority,
            isActive: condition.isActive,
          },
          existing ? "UPDATE" : "CREATE",
          actorId,
        );
      }
    });

    return successState(tr(d, "import.conditionsSuccess", { total: String(records.length), created: String(created), updated: String(updated) }), "/conditions");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function importHolidaysCsvAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("holidays:importExport");
  const d = await getDict();
  try {
    const records = await getCsvImportRecords(formData, ["date", "country", "name", "localName"]);
    let created = 0;
    let updated = 0;

    await db.$transaction(async (tx) => {
      for (const record of records) {
        const parsed = holidaySchema.safeParse({
          date: getRequiredCsvValue(record, "date"),
          country: getRequiredCsvValue(record, "country"),
          name: getRequiredCsvValue(record, "name"),
          localName: getOptionalCsvValue(record, "localName"),
        });

        if (!parsed.success) {
          throw new Error(`Invalid holiday row for "${record.date ?? "unknown"}".`);
        }

        const date = parseUtcDate(parsed.data.date);
        const existing = await tx.holiday.findFirst({
          where: { date },
          select: { id: true },
        });
        const holiday = existing
          ? await tx.holiday.update({
              where: { id: existing.id },
              data: {
                date,
                country: parsed.data.country,
                name: parsed.data.name,
                localName: parsed.data.localName ?? null,
              },
            })
          : await tx.holiday.create({
              data: {
                date,
                country: parsed.data.country,
                name: parsed.data.name,
                localName: parsed.data.localName ?? null,
              },
            });

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        await writeAuditLog(
          tx,
          "HOLIDAY",
          holiday.id,
          {
            date: holiday.date.toISOString(),
            country: holiday.country,
            name: holiday.name,
            localName: holiday.localName,
          },
          existing ? "UPDATE" : "CREATE",
          actorId,
        );
      }
    });

    return successState(tr(d, "import.holidaysSuccess", { total: String(records.length), created: String(created), updated: String(updated) }), "/holidays");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function importSettingsCsvAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("settings:importExport");
  const d = await getDict();
  try {
    const records = await getCsvImportRecords(formData, ["key", "value"]);
    let created = 0;
    let updated = 0;

    await db.$transaction(async (tx) => {
      for (const record of records) {
        const parsed = settingSchema.safeParse({
          key: getRequiredCsvValue(record, "key"),
          value: getRequiredCsvValue(record, "value"),
        });

        if (!parsed.success) {
          throw new Error(`Invalid settings row for "${record.key ?? "unknown"}".`);
        }

        if (isManagedSettingKey(parsed.data.key)) {
          throw new Error(`Setting "${parsed.data.key}" is managed by a dedicated UI and cannot be imported here.`);
        }

        let rawJson: unknown;

        try {
          rawJson = JSON.parse(parsed.data.value);
        } catch {
          throw new Error(`Setting "${parsed.data.key}" does not contain valid JSON.`);
        }

        const existing = await tx.appSetting.findUnique({
          where: { key: parsed.data.key },
          select: { id: true },
        });
        const setting = existing
          ? await tx.appSetting.update({
              where: { id: existing.id },
              data: {
                key: parsed.data.key,
                value: rawJson === null ? Prisma.JsonNull : (rawJson as Prisma.InputJsonValue),
              },
            })
          : await tx.appSetting.create({
              data: {
                key: parsed.data.key,
                value: rawJson === null ? Prisma.JsonNull : (rawJson as Prisma.InputJsonValue),
              },
            });

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        await writeAuditLog(
          tx,
          "APP_SETTING",
          setting.id,
          {
            key: setting.key,
            value: setting.value as Prisma.InputJsonValue,
          },
          existing ? "UPDATE" : "CREATE",
          actorId,
        );
      }
    });

    revalidatePath("/", "layout");
    return successState(tr(d, "import.settingsSuccess", { total: String(records.length), created: String(created), updated: String(updated) }), "/settings");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function importScheduleCsvAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("schedule:importExport");
  const d = await getDict();
  try {
    const records = await getCsvImportRecords(formData, ["date", "userId", "shiftTypeId", "source", "locked", "note"]);
    let created = 0;
    let updated = 0;

    await db.$transaction(async (tx) => {
      for (const record of records) {
        const userId = await resolveUserReference(tx, getRequiredCsvValue(record, "userId"));
        const shiftType = await resolveShiftReference(tx, getRequiredCsvValue(record, "shiftTypeId"));
        const parsed = scheduleSchema.safeParse({
          date: getRequiredCsvValue(record, "date"),
          userId,
          shiftTypeId: shiftType.id,
          source: getRequiredCsvValue(record, "source"),
          locked: parseCsvBoolean(record.locked),
          note: getOptionalCsvValue(record, "note"),
        });

        if (!parsed.success) {
          throw new Error(`Invalid schedule row for "${record.date ?? "unknown"}".`);
        }

        const serviceId = shiftType.serviceId;
        const date = parseUtcDate(parsed.data.date);
        const holiday = await tx.holiday.findUnique({
          where: {
            date,
          },
          select: {
            id: true,
          },
        });
        const validityError = getScheduleValidityError(shiftType.validityDays, date, Boolean(holiday));

        if (validityError) {
          throw new Error(`Invalid schedule row for "${record.date ?? "unknown"}": ${validityError}`);
        }

        const existing = await tx.scheduleEntry.findFirst({
          where: {
            date,
            userId,
            serviceId,
            shiftTypeId: shiftType.id,
          },
          select: { id: true, locked: true },
        });

        if (existing?.locked) {
          throw new Error(`Schedule entry "${record.date ?? "unknown"}" is locked.`);
        }

        // Enforce one shift type per day globally (skip if this is an update of the same row)
        const shiftTypeOnDayConflict = await tx.scheduleEntry.findFirst({
          where: {
            date,
            shiftTypeId: shiftType.id,
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          select: { id: true },
        });

        if (shiftTypeOnDayConflict) {
          throw new Error(`Shift type "${shiftType.id}" is already scheduled on ${parsed.data.date}. Each shift type can only be used once per day.`);
        }

        const entry = existing
          ? await tx.scheduleEntry.update({
              where: { id: existing.id },
              data: {
                date,
                userId,
                serviceId,
                shiftTypeId: shiftType.id,
                source: parsed.data.source,
                locked: parsed.data.locked,
                note: parsed.data.note ?? null,
              },
            })
          : await tx.scheduleEntry.create({
              data: {
                date,
                userId,
                serviceId,
                shiftTypeId: shiftType.id,
                source: parsed.data.source,
                locked: parsed.data.locked,
                note: parsed.data.note ?? null,
              },
            });

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }

        await writeAuditLog(
          tx,
          "SCHEDULE_ENTRY",
          entry.id,
          {
            date: entry.date.toISOString(),
            userId: entry.userId,
            serviceId: entry.serviceId,
            shiftTypeId: entry.shiftTypeId,
            locked: entry.locked,
            source: entry.source,
            note: entry.note,
          },
          existing ? "UPDATE" : "CREATE",
          actorId,
        );
      }
    });

    return successState(tr(d, "import.scheduleSuccess", { total: String(records.length), created: String(created), updated: String(updated) }), "/schedule");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function toggleVacationLockAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("vacations:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const existingVacation = await tx.vacation.findUnique({
        where: { id },
      });

      if (!existingVacation) {
        throw new Error("Missing record id.");
      }

      const vacation = await tx.vacation.update({
        where: { id },
        data: {
          locked: !existingVacation.locked,
        },
      });

      await writeAuditLog(
        tx,
        "VACATION",
        vacation.id,
        {
          userId: vacation.userId,
          startDate: vacation.startDate.toISOString(),
          endDate: vacation.endDate.toISOString(),
          locked: vacation.locked,
          status: vacation.status,
          notes: vacation.notes,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.vacationLockUpdated"), "/vacations");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function toggleScheduleLockAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("schedule:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const existingEntry = await tx.scheduleEntry.findUnique({
        where: { id },
      });

      if (!existingEntry) {
        throw new Error("Missing record id.");
      }

      const entry = await tx.scheduleEntry.update({
        where: { id },
        data: {
          locked: !existingEntry.locked,
        },
      });

      await writeAuditLog(
        tx,
        "SCHEDULE_ENTRY",
        entry.id,
        {
          date: entry.date.toISOString(),
          userId: entry.userId,
          serviceId: entry.serviceId,
          shiftTypeId: entry.shiftTypeId,
          locked: entry.locked,
          source: entry.source,
          note: entry.note,
        },
        "UPDATE",
        actorId,
      );
    });

    return successState(tr(d, "action.scheduleLockUpdated"), "/schedule");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function bulkToggleScheduleLockAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("schedule:edit");
  const d = await getDict();
  const month = parseOptionalString(formData.get("month"));
  const locked = formData.get("locked") === "true";

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return errorState(tr(d, "action.missingId"));
  }

  const startDate = parseUtcDate(`${month}-01`);
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0));

  try {
    const result = await db.scheduleEntry.updateMany({
      where: {
        date: { gte: startDate, lte: endDate },
        locked: !locked,
      },
      data: { locked },
    });

    return successState(tr(d, "action.scheduleBulkLockUpdated", { count: String(result.count) }), "/schedule");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function bulkDeleteScheduleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("schedule:delete");
  const d = await getDict();
  const idsRaw = parseOptionalString(formData.get("ids"));

  if (!idsRaw) {
    return errorState(tr(d, "action.missingId"));
  }

  const ids = idsRaw.split(",").map((id) => id.trim()).filter((id) => id.length > 0);

  if (ids.length === 0) {
    return errorState(tr(d, "action.missingId"));
  }

  try {
    const lockedCount = await db.scheduleEntry.count({
      where: { id: { in: ids }, locked: true },
    });

    if (lockedCount > 0) {
      return errorState(tr(d, "action.scheduleBulkDeleteLocked", { count: String(lockedCount) }));
    }

    const result = await db.scheduleEntry.deleteMany({
      where: { id: { in: ids }, locked: false },
    });

    return successState(tr(d, "action.scheduleBulkDeleted", { count: String(result.count) }), "/schedule");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function deleteUserAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("users:delete");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.delete({
        where: { id },
      });

      await writeAuditLog(
        tx,
        "USER",
        user.id,
        {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roleId: user.roleId,
        },
        "DELETE",
        actorId,
      );
    });

    return successState(tr(d, "action.userDeleted"), "/users");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function deleteRoleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("roles:delete");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const role = await tx.role.delete({
        where: { id },
      });

      await writeAuditLog(
        tx,
        "ROLE",
        role.id,
        {
          code: role.code,
          name: role.name,
          description: role.description,
        },
        "DELETE",
        actorId,
      );
    });

    return successState(tr(d, "action.roleDeleted"), "/roles");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function deleteServiceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("services:delete");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const service = await tx.service.delete({
        where: { id },
      });

      await writeAuditLog(
        tx,
        "SERVICE",
        service.id,
        {
          code: service.code,
          name: service.name,
          isActive: service.isActive,
        },
        "DELETE",
        actorId,
      );
    });

    return successState(tr(d, "action.serviceDeleted"), "/services");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function deleteShiftAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("shifts:delete");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const shiftType = await tx.shiftType.delete({
        where: { id },
      });

      await writeAuditLog(
        tx,
        "SHIFT_TYPE",
        shiftType.id,
        {
          code: shiftType.code,
          name: shiftType.name,
          serviceId: shiftType.serviceId,
          startsAt: shiftType.startsAt,
          endsAt: shiftType.endsAt,
          validityDays: shiftType.validityDays as Prisma.InputJsonValue | null,
        },
        "DELETE",
        actorId,
      );
    });

    return successState(tr(d, "action.shiftDeleted"), "/shifts");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function deleteVacationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("vacations:delete");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const existingVacation = await tx.vacation.findUnique({
        where: { id },
        select: {
          locked: true,
        },
      });

      if (!existingVacation) {
        throw new Error("Missing record id.");
      }

      if (existingVacation.locked) {
        throw new Error("Zaznam dovolenky je zamknuty. Pre odomknutie pouzite ikonku zamku na zazname.");
      }

      const vacation = await tx.vacation.delete({
        where: { id },
      });

      await writeAuditLog(
        tx,
        "VACATION",
        vacation.id,
        {
          userId: vacation.userId,
          startDate: vacation.startDate.toISOString(),
          endDate: vacation.endDate.toISOString(),
          locked: vacation.locked,
          status: vacation.status,
          notes: vacation.notes,
        },
        "DELETE",
        actorId,
      );
    });

    return successState(tr(d, "action.vacationDeleted"), "/vacations");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function deleteConditionAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("conditions:delete");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const condition = await tx.condition.delete({
        where: { id },
      });

      await writeAuditLog(
        tx,
        "CONDITION",
        condition.id,
        {
          type: condition.type,
          title: condition.title,
          description: condition.description,
          priority: condition.priority,
          isActive: condition.isActive,
        },
        "DELETE",
        actorId,
      );
    });

    return successState(tr(d, "action.conditionDeleted"), "/conditions");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function deleteHolidayAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("holidays:delete");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const holiday = await tx.holiday.delete({
        where: { id },
      });

      await writeAuditLog(
        tx,
        "HOLIDAY",
        holiday.id,
        {
          date: holiday.date.toISOString(),
          country: holiday.country,
          name: holiday.name,
          localName: holiday.localName,
        },
        "DELETE",
        actorId,
      );
    });

    return successState(tr(d, "action.holidayDeleted"), "/holidays");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function deleteSettingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("settings:edit");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const existingSetting = await tx.appSetting.findUnique({
        where: { id },
      });

      if (!existingSetting) {
        throw new Error("Missing record id.");
      }

      if (isManagedSettingKey(existingSetting.key)) {
        throw new Error(`Setting key "${existingSetting.key}" is managed in a dedicated UI and cannot be changed here.`);
      }

      const setting = await tx.appSetting.delete({
        where: { id },
      });

      await writeAuditLog(
        tx,
        "APP_SETTING",
        setting.id,
        {
          key: setting.key,
          value: setting.value as Prisma.InputJsonValue,
        },
        "DELETE",
        actorId,
      );
    });

    revalidatePath("/", "layout");
    return successState(tr(d, "action.settingDeleted"), "/settings");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

export async function deleteScheduleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const actorId = await requireCurrentPermission("schedule:delete");
  const d = await getDict();
  const id = parseRequiredId(formData);

  if (!id) {
    return missingIdState(d);
  }

  try {
    await db.$transaction(async (tx) => {
      const existingEntry = await tx.scheduleEntry.findUnique({
        where: { id },
        select: {
          locked: true,
        },
      });

      if (!existingEntry) {
        throw new Error("Missing record id.");
      }

      if (existingEntry.locked) {
        throw new Error("Zaznam rozvrhu je zamknuty. Pre odomknutie pouzite ikonku zamku na zazname.");
      }

      const entry = await tx.scheduleEntry.delete({
        where: { id },
      });

      await writeAuditLog(
        tx,
        "SCHEDULE_ENTRY",
        entry.id,
        {
          date: entry.date.toISOString(),
          userId: entry.userId,
          serviceId: entry.serviceId,
          shiftTypeId: entry.shiftTypeId,
          locked: entry.locked,
          source: entry.source,
          note: entry.note,
        },
        "DELETE",
        actorId,
      );
    });

    return successState(tr(d, "action.scheduleDeleted"), "/schedule");
  } catch (error) {
    return errorState(parseActionError(error, d));
  }
}

