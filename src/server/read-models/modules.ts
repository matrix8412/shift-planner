import { ScheduleSource, VacationStatus } from "@prisma/client";

import type { AuditEntry, AuditFieldChange, CalendarItem, EntityCell, EntityModuleConfig, EntityRow, FieldOption } from "@/components/entity-module.types";
import { getDictionary, t as tr, getServerLocale } from "@/i18n";
import { getPermissionMatrixSections, permissionCatalog } from "@/server/auth/permissions";
import { isManagedSettingKey } from "@/server/config/managed-settings";
import { db } from "@/server/db/client";
import { getShiftValidityFormValues, getShiftValidityLabels, parseShiftValidity, shiftValidityDefinitions } from "@/server/scheduling/shift-validity";

const dateFormatter = new Intl.DateTimeFormat("sk-SK", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("sk-SK", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const todayUtc = new Date();

todayUtc.setUTCHours(0, 0, 0, 0);

function formatDate(date: Date) {
  return dateFormatter.format(date);
}

function formatDateTime(date: Date) {
  return dateTimeFormatter.format(date);
}

function formatDateRange(startDate: Date, endDate: Date) {
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function expandUtcDateRange(startDate: Date, endDate: Date) {
  const days: string[] = [];
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    days.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

async function getHolidays() {
  const holidays = await db.holiday.findMany({
    select: {
      date: true,
      name: true,
      localName: true,
    },
  });

  const seen = new Set<string>();
  const result: { date: string; name: string; localName?: string }[] = [];
  for (const h of holidays) {
    const iso = toIsoDate(h.date);
    if (!seen.has(iso)) {
      seen.add(iso);
      result.push({ date: iso, name: h.name, localName: h.localName ?? undefined });
    }
  }
  return result;
}

function formatJson(value: unknown) {
  const json = JSON.stringify(value);
  return json.length > 96 ? `${json.slice(0, 93)}...` : json;
}

function resolveEffectivePermissionCodes(parameters: {
  rolePermissionCodes: string[];
  userOverrideValues: Record<string, boolean>;
}) {
  const effectivePermissions = new Set(
    parameters.rolePermissionCodes.filter((code): code is (typeof permissionCatalog)[number] => permissionCatalog.includes(code as (typeof permissionCatalog)[number])),
  );

  for (const [code, enabled] of Object.entries(parameters.userOverrideValues)) {
    if (!permissionCatalog.includes(code as (typeof permissionCatalog)[number])) {
      continue;
    }

    if (enabled) {
      effectivePermissions.add(code as (typeof permissionCatalog)[number]);
    } else {
      effectivePermissions.delete(code as (typeof permissionCatalog)[number]);
    }
  }

  return Array.from(effectivePermissions).sort((left, right) => left.localeCompare(right, "en"));
}

const auditFieldLabels: Record<string, Record<string, string>> = {
  USER: {
    email: "Email",
    firstName: "Meno",
    lastName: "Priezvisko",
    roleId: "Rola",
    isActive: "Aktivny",
    shiftTypeIds: "Typy zmien",
    notificationsEnabled: "Notifikacie",
    notificationDays: "Pocet dni notifikacii",
    preferredTheme: "Tema",
  },
  ROLE: {
    code: "Kod",
    name: "Nazov",
    description: "Popis",
  },
  SERVICE: {
    code: "Kod",
    name: "Nazov",
    isActive: "Aktivna",
    colorLight: "Svetle pozadie",
    textColorLight: "Svetla farba textu",
    opacityLight: "Svetla priehladnost",
    colorDark: "Tmave pozadie",
    textColorDark: "Tmava farba textu",
    opacityDark: "Tmava priehladnost",
  },
  SHIFT_TYPE: {
    code: "Kod",
    name: "Nazov",
    serviceId: "Typ sluzby",
    startsAt: "Zaciatok",
    endsAt: "Koniec",
    crossesMidnight: "Cez polnoc",
    validityDays: "Platnost",
    isActive: "Aktivna",
  },
  VACATION: {
    userId: "Pouzivatel",
    startDate: "Od",
    endDate: "Do",
    locked: "Zamknute",
    status: "Stav",
    notes: "Poznamka",
  },
  CONDITION: {
    type: "Typ",
    title: "Nazov",
    description: "Popis",
    priority: "Priorita",
    isActive: "Aktivna",
  },
  HOLIDAY: {
    date: "Datum",
    country: "Krajina",
    name: "Nazov",
    localName: "Lokalny nazov",
  },
  APP_SETTING: {
    key: "Kluc",
    value: "Hodnota",
  },
  SCHEDULE_ENTRY: {
    date: "Datum",
    userId: "Pouzivatel",
    serviceId: "Typ sluzby",
    shiftTypeId: "Typ zmeny",
    locked: "Zamknute",
    source: "Zdroj",
    note: "Poznamka",
  },
};

type AuditSnapshot = Record<string, unknown>;

type AuditReferenceMaps = {
  users: Map<string, string>;
  roles: Map<string, string>;
  services: Map<string, string>;
  shiftTypes: Map<string, string>;
};

function isAuditRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAuditValue(value: unknown): unknown {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeAuditValue(item))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "sk-SK"));
  }

  if (!isAuditRecord(value)) {
    return value;
  }

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right, "sk-SK"))
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = normalizeAuditValue(value[key]);
      return accumulator;
    }, {});
}

function getSnapshotPayload(payload: unknown): AuditSnapshot | undefined {
  if (!isAuditRecord(payload)) {
    return undefined;
  }

  if (Array.isArray(payload.changes)) {
    return undefined;
  }

  return payload;
}

function getAuditFieldLabel(entityType: string, field: string) {
  return auditFieldLabels[entityType]?.[field] ?? field;
}

function parseAuditDateValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
  }

  return undefined;
}

function formatVacationStatusValue(value: string) {
  switch (value) {
    case VacationStatus.APPROVED:
      return "Schvalena";
    case VacationStatus.REJECTED:
      return "Zamietnuta";
    case VacationStatus.PENDING:
      return "Caka na schvalenie";
    default:
      return value;
  }
}

function formatScheduleSourceValue(value: string) {
  switch (value) {
    case ScheduleSource.AI:
      return "AI";
    case ScheduleSource.IMPORT:
      return "Import";
    case ScheduleSource.MANUAL:
      return "Manualne";
    default:
      return value;
  }
}

function formatAuditScalarValue(field: string, value: unknown, references: AuditReferenceMaps): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "Ano" : "Nie";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "-";
    }

    return value.map((item) => formatAuditScalarValue(field, item, references)).join(", ");
  }

  if (typeof value === "string") {
    if (field === "roleId") {
      return references.roles.get(value) ?? value;
    }

    if (field === "serviceId" || field === "serviceIds") {
      return references.services.get(value) ?? value;
    }

    if (field === "shiftTypeId" || field === "shiftTypeIds") {
      return references.shiftTypes.get(value) ?? value;
    }

    if (field === "userId") {
      return references.users.get(value) ?? value;
    }

    if (field === "status") {
      return formatVacationStatusValue(value);
    }

    if (field === "source") {
      return formatScheduleSourceValue(value);
    }

    const parsedDate = field === "date" || field === "startDate" || field === "endDate" ? parseAuditDateValue(value) : undefined;
    if (parsedDate) {
      return formatDate(parsedDate);
    }

    return value;
  }

  if (field === "validityDays") {
    const labels = getShiftValidityLabels(value);
    return labels.length > 0 ? labels.join(", ") : "-";
  }

  return formatJson(value);
}

function buildAuditFieldChange(entityType: string, field: string, previousValue: unknown, nextValue: unknown, references: AuditReferenceMaps): AuditFieldChange {
  return {
    field,
    label: getAuditFieldLabel(entityType, field),
    previousValue: formatAuditScalarValue(field, previousValue, references),
    nextValue: formatAuditScalarValue(field, nextValue, references),
  };
}

function buildSnapshotAuditChanges(
  entityType: string,
  action: string,
  payload: unknown,
  previousPayload: unknown,
  references: AuditReferenceMaps,
) {
  const currentSnapshot = getSnapshotPayload(payload);
  const previousSnapshot = getSnapshotPayload(previousPayload);

  if (!currentSnapshot) {
    return [];
  }

  const fieldNames = Array.from(new Set([...Object.keys(currentSnapshot), ...Object.keys(previousSnapshot ?? {})]));

  return fieldNames.flatMap((field) => {
    const previousValue = action === "CREATE" ? undefined : previousSnapshot?.[field];
    const nextValue = action === "DELETE" ? undefined : currentSnapshot[field];

    if (action === "UPDATE") {
      const previousSerialized = JSON.stringify(normalizeAuditValue(previousValue));
      const nextSerialized = JSON.stringify(normalizeAuditValue(nextValue));

      if (previousSerialized === nextSerialized) {
        return [];
      }
    }

    return [buildAuditFieldChange(entityType, field, previousValue, nextValue, references)];
  });
}

function buildStructuredAuditChanges(entityType: string, payload: unknown, references: AuditReferenceMaps) {
  if (!isAuditRecord(payload) || !Array.isArray(payload.changes)) {
    return [];
  }

  return payload.changes.flatMap((change) => {
    if (!isAuditRecord(change) || typeof change.field !== "string") {
      return [];
    }

    return [
      buildAuditFieldChange(entityType, change.field, change.before, change.after, references),
    ];
  });
}

async function getAuditReferenceMaps(entityType: string): Promise<AuditReferenceMaps> {
  const references: AuditReferenceMaps = {
    users: new Map<string, string>(),
    roles: new Map<string, string>(),
    services: new Map<string, string>(),
    shiftTypes: new Map<string, string>(),
  };

  if (entityType === "USER" || entityType === "VACATION" || entityType === "SCHEDULE_ENTRY") {
    const users = await db.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    references.users = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`]));
  }

  if (entityType === "USER") {
    const [roles, shiftTypes] = await Promise.all([
      db.role.findMany({
        select: {
          id: true,
          name: true,
        },
      }),
      db.shiftType.findMany({
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    references.roles = new Map(roles.map((role) => [role.id, role.name]));
    references.shiftTypes = new Map(shiftTypes.map((shiftType) => [shiftType.id, shiftType.name]));
  }

  if (entityType === "SHIFT_TYPE" || entityType === "SCHEDULE_ENTRY") {
    const [services, shiftTypes] = await Promise.all([
      db.service.findMany({
        select: {
          id: true,
          name: true,
        },
      }),
      entityType === "SCHEDULE_ENTRY"
        ? db.shiftType.findMany({
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve([]),
    ]);

    references.services = new Map(services.map((service) => [service.id, service.name]));

    if (entityType === "SCHEDULE_ENTRY") {
      references.shiftTypes = new Map(shiftTypes.map((shiftType) => [shiftType.id, shiftType.name]));
    }
  }

  if (entityType === "VACATION") {
    return references;
  }

  if (entityType === "SCHEDULE_ENTRY" && references.shiftTypes.size === 0) {
    const shiftTypes = await db.shiftType.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    references.shiftTypes = new Map(shiftTypes.map((shiftType) => [shiftType.id, shiftType.name]));
  }

  return references;
}

function boolCell(enabled: boolean, yesLabel = "Active", noLabel = "Inactive"): EntityCell {
  return {
    text: enabled ? yesLabel : noLabel,
    tone: enabled ? "success" : "neutral",
  };
}

function clampOpacity(value: number | null | undefined, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function buildServiceColorsCell(backgroundColor: string | null, textColor: string | null, opacity: number | null | undefined): EntityCell {
  const effectiveOpacity = clampOpacity(opacity, 100);

  return {
    text: `${backgroundColor ?? "-"} ${textColor ?? "-"} ${effectiveOpacity}%`,
    colorTokens: [
      { color: backgroundColor ?? undefined, label: backgroundColor ?? "-", mono: true },
      { color: textColor ?? undefined, label: textColor ?? "-", mono: true },
      { label: `${effectiveOpacity}%`, mono: true },
    ],
  };
}

function buildShiftValidityCell(validity: unknown): EntityCell {
  const labels = getShiftValidityLabels(validity);

  return {
    text: labels.join(", "),
    colorTokens: labels.map((label) => ({ label })),
  };
}

function mapServiceCalendarColors(serviceName: string) {
  if (serviceName.toLocaleLowerCase("sk-SK").includes("catv")) {
    return {
      backgroundColor: "#9db8e7",
      accentColor: "#5687d5",
      textColor: "#17304f",
    };
  }

  if (serviceName.toLocaleLowerCase("sk-SK").includes("techn")) {
    return {
      backgroundColor: "#e9bf95",
      accentColor: "#d28944",
      textColor: "#402a17",
    };
  }

  return {
    backgroundColor: "#aeda96",
    accentColor: "#68b956",
    textColor: "#16381f",
  };
}

type ServiceBadgeInput = {
  id: string;
  name: string;
  colorLight: string | null;
  textColorLight: string | null;
  opacityLight: number | null | undefined;
  colorDark: string | null;
  textColorDark: string | null;
  opacityDark: number | null | undefined;
};

type ShiftTypeBadgeInput = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  service: ServiceBadgeInput;
};

function hexToRgba(color: string, opacity: number) {
  const normalized = color.trim();
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;

  if (!/^[\da-f]{6}$/i.test(hex)) {
    return undefined;
  }

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function getServiceBadgeColors(service: ServiceBadgeInput) {
  const fallbackColors = mapServiceCalendarColors(service.name);
  const baseBackground = service.colorLight ?? fallbackColors.backgroundColor;
  const opacity = clampOpacity(service.opacityLight, 78);

  return {
    backgroundColor: hexToRgba(baseBackground, Math.max(opacity, 28) / 100) ?? baseBackground,
    borderColor: service.colorLight ?? fallbackColors.accentColor,
    textColor: service.textColorLight ?? fallbackColors.textColor,
  };
}

function getServiceBadgeDarkColors(service: ServiceBadgeInput) {
  const fallbackColors = mapServiceCalendarColors(service.name);
  const baseBackground = service.colorDark ?? fallbackColors.backgroundColor;
  const opacity = clampOpacity(service.opacityDark, 100);

  return {
    backgroundColor: hexToRgba(baseBackground, Math.max(opacity, 28) / 100) ?? baseBackground,
    borderColor: service.colorDark ?? fallbackColors.accentColor,
    textColor: service.textColorDark ?? "#F8FBFB",
  };
}

function buildServiceBadgeToken(service: ServiceBadgeInput) {
  const colors = getServiceBadgeColors(service);
  const darkColors = getServiceBadgeDarkColors(service);

  return {
    label: service.name,
    variant: "pill" as const,
    backgroundColor: colors.backgroundColor,
    borderColor: colors.borderColor,
    textColor: colors.textColor,
    darkBackgroundColor: darkColors.backgroundColor,
    darkBorderColor: darkColors.borderColor,
    darkTextColor: darkColors.textColor,
  };
}

function buildShiftTypeBadgeToken(shiftType: ShiftTypeBadgeInput) {
  const colors = getServiceBadgeColors(shiftType.service);
  const darkColors = getServiceBadgeDarkColors(shiftType.service);

  return {
    label: shiftType.name,
    variant: "pill" as const,
    backgroundColor: colors.backgroundColor,
    borderColor: colors.borderColor,
    textColor: colors.textColor,
    darkBackgroundColor: darkColors.backgroundColor,
    darkBorderColor: darkColors.borderColor,
    darkTextColor: darkColors.textColor,
  };
}

function vacationStatusLabel(status: VacationStatus) {
  switch (status) {
    case VacationStatus.APPROVED:
      return "Schválená";
    case VacationStatus.REJECTED:
      return "Zamietnutá";
    default:
      return "Čaká na schválenie";
  }
}

function vacationStatusCalendarColors(status: VacationStatus) {
  switch (status) {
    case VacationStatus.APPROVED:
      return {
        backgroundColor: "#d9efd7",
        accentColor: "#72b16b",
        textColor: "#17381b",
      };
    case VacationStatus.REJECTED:
      return {
        backgroundColor: "#f7d4d1",
        accentColor: "#dc655b",
        textColor: "#5b211c",
      };
    default:
      return {
        backgroundColor: "#e7eff0",
        accentColor: "#7b9ca3",
        textColor: "#21434b",
      };
  }
}

function vacationStatusCell(status: VacationStatus): EntityCell {
  switch (status) {
    case VacationStatus.APPROVED:
      return { text: "Schválená", tone: "success" };
    case VacationStatus.REJECTED:
      return { text: "Zamietnutá", tone: "danger" };
    default:
      return { text: "Čaká", tone: "warning" };
  }
}

function scheduleSourceCell(source: ScheduleSource): EntityCell {
  switch (source) {
    case ScheduleSource.AI:
      return { text: "AI", tone: "warning" };
    case ScheduleSource.IMPORT:
      return { text: "Import", tone: "neutral" };
    default:
      return { text: "Manuálne", tone: "success" };
  }
}

function mapOptions(records: { id: string; name: string }[]): FieldOption[] {
  return records.map((record) => ({
    value: record.id,
    label: record.name,
  }));
}

async function getAuditEntryMap(entityType: string, entityIds: string[]): Promise<Record<string, AuditEntry[]>> {
  if (entityIds.length === 0) {
    return {};
  }

  const logs = await db.auditLog.findMany({
    where: {
      entityType,
      entityId: {
        in: entityIds,
      },
    },
    include: {
      actor: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const references = await getAuditReferenceMaps(entityType);
  const logsByEntity = logs.reduce<Record<string, typeof logs>>((accumulator, log) => {
    if (!accumulator[log.entityId]) {
      accumulator[log.entityId] = [];
    }

    accumulator[log.entityId].push(log);
    return accumulator;
  }, {});

  return Object.entries(logsByEntity).reduce<Record<string, AuditEntry[]>>((accumulator, [entityId, entityLogs]) => {
    accumulator[entityId] = entityLogs.map((log, index) => {
      const structuredChanges = buildStructuredAuditChanges(entityType, log.payload, references);
      const snapshotChanges =
        structuredChanges.length > 0 ? [] : buildSnapshotAuditChanges(entityType, log.action, log.payload, entityLogs[index + 1]?.payload, references);
      const changes = structuredChanges.length > 0 ? structuredChanges : snapshotChanges;

      return {
        id: log.id,
        action: log.action,
        timestamp: formatDateTime(log.createdAt),
        actor: log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : "System",
        changes,
        summary: changes.length === 0 ? "Bez zistenych zmien." : undefined,
      };
    });

    return accumulator;
  }, {});
}

function attachAuditRows(rows: EntityRow[], auditMap: Record<string, AuditEntry[]>) {
  return rows.map((row) => ({
    ...row,
    auditEntries: auditMap[row.id] ?? [],
  }));
}

export async function getUsersModule(): Promise<EntityModuleConfig> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);
  const permissionSections = getPermissionMatrixSections();
  const [users, roles, shiftTypes] = await Promise.all([
    db.user.findMany({
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
    db.role.findMany({
      orderBy: {
        name: "asc",
      },
    }),
    db.shiftType.findMany({
      include: {
        service: true,
      },
      orderBy: [{ service: { name: "asc" } }, { name: "asc" }, { startsAt: "asc" }],
    }),
  ]);

  const auditMap = await getAuditEntryMap("USER", users.map((user) => user.id));
  const rows = attachAuditRows(
    users.map((user) => {
      const assignedShiftTypes = user.shiftTypes.map((assignment) => assignment.shiftType);
      const assignedServices = Array.from(new Map(assignedShiftTypes.map((shiftType) => [shiftType.service.id, shiftType.service] as const)).values());
      const userOverrideValues = user.permissionOverrides.reduce<Record<string, boolean>>((accumulator, override) => {
        accumulator[override.permission.code] = override.enabled;
        return accumulator;
      }, {});
      const effectivePermissionCodes = resolveEffectivePermissionCodes({
        rolePermissionCodes: user.role?.permissions.map((assignment) => assignment.permission.code) ?? [],
        userOverrideValues,
      });
      // Encode tri-state: granted overrides as "code", denied overrides as "!code"
      const triStatePermissionCodes = Object.entries(userOverrideValues).map(([code, enabled]) =>
        enabled ? code : `!${code}`,
      );

      return {
        id: user.id,
        label: `${user.firstName} ${user.lastName}`,
        avatarUrl: user.avatarUrl ?? undefined,
        subtitle: user.email,
        cells: {
          name: `${user.lastName}, ${user.firstName}`,
          email: user.email,
          role: user.role?.name ?? tr(d, "users.noRole"),
          permissions: String(effectivePermissionCodes.length),
          services:
            assignedServices.length > 0
              ? {
                  text: assignedServices.map((service) => service.name).join(", "),
                  colorTokens: assignedServices.map((service) => buildServiceBadgeToken(service)),
                }
              : tr(d, "users.noAssignment"),
          shiftTypes:
            assignedShiftTypes.length > 0
              ? {
                  text: assignedShiftTypes.map((shiftType) => shiftType.name).join(", "),
                  colorTokens: assignedShiftTypes.map((shiftType) => buildShiftTypeBadgeToken(shiftType)),
                }
              : tr(d, "users.noAssignment"),
          status: boolCell(user.isActive, tr(d, "users.statusActive"), tr(d, "users.statusInactive")),
        },
        formValues: {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl ?? undefined,
          roleId: user.roleId ?? undefined,
          isActive: user.isActive,
          shiftTypeIds: user.shiftTypes.map((assignment) => assignment.shiftTypeId),
          preferredTheme: user.preferredTheme ?? undefined,
          notificationsEnabled: user.notificationsEnabled,
          notificationDays: user.notificationDays,
          permissionCodes: triStatePermissionCodes,
          effectivePermissionCodes,
        },
      };
    }),
    auditMap,
  );

  return {
    title: tr(d, "users.title"),
    summary: tr(d, "users.summary"),
    csvFileName: "users.csv",
    csvFieldNames: ["userId", "email", "firstName", "lastName", "roleId", "isActive", "shiftTypeIds", "preferredTheme", "notificationsEnabled", "notificationDays", "permissionCodes"],
    stats: [
      { label: tr(d, "users.statTotal"), value: String(users.length) },
      { label: tr(d, "users.statActive"), value: String(users.filter((user) => user.isActive).length) },
      { label: tr(d, "users.statWithRole"), value: String(users.filter((user) => user.roleId).length) },
    ],
    columns: [
      { key: "name", label: tr(d, "users.colName") },
      { key: "email", label: tr(d, "users.colEmail") },
      { key: "role", label: tr(d, "users.colRole") },
      { key: "permissions", label: tr(d, "users.colPermissions") },
      { key: "services", label: tr(d, "users.colServiceTypes") },
      { key: "shiftTypes", label: tr(d, "users.colShiftTypes") },
      { key: "status", label: tr(d, "users.colStatus") },
    ],
    rows,
    emptyMessage: tr(d, "users.empty"),
    addLabel: tr(d, "users.addLabel"),
    sheetTitle: tr(d, "users.sheetTitle"),
    sheetDescription: tr(d, "users.sheetDescription"),
    submitLabel: tr(d, "users.submitLabel"),
    searchPlaceholder: tr(d, "users.search"),
    fields: [
      { type: "email", name: "email", label: tr(d, "users.fieldEmail"), required: true, autoComplete: "email", placeholder: tr(d, "users.fieldEmailPlaceholder") },
      { type: "text", name: "firstName", label: tr(d, "users.fieldFirstName"), required: true, autoComplete: "given-name" },
      { type: "text", name: "lastName", label: tr(d, "users.fieldLastName"), required: true, autoComplete: "family-name" },
      {
        type: "select",
        name: "roleId",
        label: tr(d, "users.fieldRole"),
        allowEmpty: true,
        emptyLabel: tr(d, "users.fieldRoleEmpty"),
        options: roles.map((role) => ({ value: role.id, label: role.name })),
      },
      {
        type: "multiselect",
        name: "shiftTypeIds",
        label: tr(d, "users.fieldShiftTypes"),
        options: shiftTypes.map((shiftType) => ({
          value: shiftType.id,
          label: shiftType.name,
          description: `${shiftType.service.name} | ${shiftType.startsAt}-${shiftType.endsAt}`,
        })),
        description: tr(d, "users.fieldShiftTypesHint"),
        variant: "checkbox-list",
      },
      {
        type: "select",
        name: "preferredTheme",
        label: tr(d, "users.fieldTheme"),
        allowEmpty: true,
        emptyLabel: tr(d, "users.fieldThemeAuto"),
        options: [
          { value: "light", label: tr(d, "users.fieldThemeLight") },
          { value: "dark", label: tr(d, "users.fieldThemeDark") },
        ],
      },
      { type: "checkbox", name: "isActive", label: tr(d, "users.fieldIsActive"), defaultChecked: true },
      {
        type: "checkbox",
        name: "notificationsEnabled",
        label: tr(d, "users.fieldNotifications"),
        description: tr(d, "users.fieldNotificationsHint"),
      },
      {
        type: "number",
        name: "notificationDays",
        label: tr(d, "users.fieldNotificationDays"),
        defaultValue: 1,
        min: 0,
        max: 365,
        required: true,
      },
    ],
    sheetTabs: [
      {
        id: "general",
        label: tr(d, "users.tabGeneral"),
        fields: [
          { type: "avatar", name: "avatarUrl", label: tr(d, "users.fieldAvatar"), uploadUrl: "/api/avatars/upload" },
          { type: "email", name: "email", label: tr(d, "users.fieldEmail"), required: true, autoComplete: "email", placeholder: tr(d, "users.fieldEmailPlaceholder") },
          { type: "text", name: "firstName", label: tr(d, "users.fieldFirstName"), required: true, autoComplete: "given-name" },
          { type: "text", name: "lastName", label: tr(d, "users.fieldLastName"), required: true, autoComplete: "family-name" },
          {
            type: "select",
            name: "roleId",
            label: tr(d, "users.fieldRole"),
            allowEmpty: true,
            emptyLabel: tr(d, "users.fieldRoleEmpty"),
            options: roles.map((role) => ({ value: role.id, label: role.name })),
          },
          {
            type: "multiselect",
            name: "shiftTypeIds",
            label: tr(d, "users.fieldShiftTypes"),
            options: shiftTypes.map((shiftType) => ({
              value: shiftType.id,
              label: shiftType.name,
              description: `${shiftType.service.name} | ${shiftType.startsAt}-${shiftType.endsAt}`,
            })),
            description: tr(d, "users.fieldShiftTypesHint"),
            variant: "checkbox-list",
          },
          {
            type: "select",
            name: "preferredTheme",
            label: tr(d, "users.fieldTheme"),
            allowEmpty: true,
            emptyLabel: tr(d, "users.fieldThemeAuto"),
            options: [
              { value: "light", label: tr(d, "users.fieldThemeLight") },
              { value: "dark", label: tr(d, "users.fieldThemeDark") },
            ],
          },
          { type: "checkbox", name: "isActive", label: tr(d, "users.fieldIsActive"), defaultChecked: true },
          {
            type: "checkbox",
            name: "notificationsEnabled",
            label: tr(d, "users.fieldNotifications"),
            description: tr(d, "users.fieldNotificationsHint"),
          },
          {
            type: "number",
            name: "notificationDays",
            label: tr(d, "users.fieldNotificationDays"),
            defaultValue: 1,
            min: 0,
            max: 365,
            required: true,
          },
        ],
      },
      {
        id: "permission-preview",
        label: tr(d, "users.permPreviewTab"),
        visibleIn: "edit",
        fields: [
          {
            type: "permission-matrix",
            name: "effectivePermissionCodes",
            label: tr(d, "users.permPreviewLabel"),
            sections: permissionSections,
            readOnly: true,
          },
        ],
      },
      {
        id: "permission-edit",
        label: tr(d, "users.permEditTab"),
        visibleIn: "edit",
        fields: [
          {
            type: "permission-matrix",
            name: "permissionCodes",
            label: tr(d, "users.permEditLabel"),
            sections: permissionSections,
            triState: true,
          },
        ],
      },
    ],
  };
}

export async function getRolesModule(): Promise<EntityModuleConfig> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);
  const permissionSections = getPermissionMatrixSections();
  const roles = await db.role.findMany({
    include: {
      permissions: {
        include: {
          permission: true,
        },
      },
      _count: {
        select: {
          users: true,
          permissions: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  const auditMap = await getAuditEntryMap("ROLE", roles.map((role) => role.id));
  const rows = attachAuditRows(
    roles.map((role) => ({
      id: role.id,
      label: role.name,
      cells: {
        code: { text: role.code, mono: true },
        name: role.name,
        users: String(role._count.users),
        permissions: String(role._count.permissions),
        description: role.description ?? tr(d, "roles.noDescription"),
      },
      formValues: {
        roleId: role.id,
        code: role.code,
        name: role.name,
        description: role.description ?? undefined,
        permissionCodes: role.permissions.map((assignment) => assignment.permission.code).sort((left, right) => left.localeCompare(right, "en")),
      },
    })),
    auditMap,
  );

  return {
    title: tr(d, "roles.title"),
    summary: tr(d, "roles.summary"),
    csvFileName: "roles.csv",
    csvFieldNames: ["roleId", "code", "name", "description", "permissionCodes"],
    stats: [
      { label: tr(d, "roles.statTotal"), value: String(roles.length) },
      { label: tr(d, "roles.statAssigned"), value: String(roles.filter((role) => role._count.users > 0).length) },
      { label: tr(d, "roles.statPermissions"), value: String(roles.reduce((total, role) => total + role._count.permissions, 0)) },
    ],
    columns: [
      { key: "code", label: tr(d, "roles.colCode") },
      { key: "name", label: tr(d, "roles.colName") },
      { key: "users", label: tr(d, "roles.colUsers") },
      { key: "permissions", label: tr(d, "roles.colPermissions") },
      { key: "description", label: tr(d, "roles.colDescription") },
    ],
    rows,
    emptyMessage: tr(d, "roles.empty"),
    addLabel: tr(d, "roles.addLabel"),
    sheetTitle: tr(d, "roles.sheetTitle"),
    sheetDescription: tr(d, "roles.sheetDescription"),
    submitLabel: tr(d, "roles.submitLabel"),
    searchPlaceholder: tr(d, "roles.search"),
    fields: [
      { type: "text", name: "code", label: tr(d, "roles.fieldCode"), required: true, placeholder: tr(d, "roles.fieldCodePlaceholder") },
      { type: "text", name: "name", label: tr(d, "roles.fieldName"), required: true, placeholder: tr(d, "roles.fieldNamePlaceholder") },
      { type: "textarea", name: "description", label: tr(d, "roles.fieldDescription"), rows: 4, placeholder: tr(d, "roles.fieldDescriptionPlaceholder") },
    ],
    sheetTabs: [
      {
        id: "general",
        label: tr(d, "roles.tabGeneral"),
        fields: [
          { type: "text", name: "code", label: tr(d, "roles.fieldCode"), required: true, placeholder: tr(d, "roles.fieldCodePlaceholder") },
          { type: "text", name: "name", label: tr(d, "roles.fieldName"), required: true, placeholder: tr(d, "roles.fieldNamePlaceholder") },
          { type: "textarea", name: "description", label: tr(d, "roles.fieldDescription"), rows: 4, placeholder: tr(d, "roles.fieldDescriptionPlaceholder") },
        ],
      },
      {
        id: "permissions",
        label: tr(d, "roles.tabPermissions"),
        fields: [
          {
            type: "permission-matrix",
            name: "permissionCodes",
            label: tr(d, "roles.permLabel"),
            sections: permissionSections,
          },
        ],
      },
    ],
  };
}

export async function getServicesModule(): Promise<EntityModuleConfig> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);
  const services = await db.service.findMany({
    include: {
      _count: {
        select: {
          shiftTypes: true,
          schedule: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  const auditMap = await getAuditEntryMap("SERVICE", services.map((service) => service.id));
  const rows = attachAuditRows(
    services.map((service) => ({
      id: service.id,
      label: service.name,
      cells: {
        code: { text: service.code, mono: true },
        name: service.name,
        status: boolCell(service.isActive, "Aktívna", "Neaktívna"),
        light: buildServiceColorsCell(service.colorLight, service.textColorLight, service.opacityLight),
        dark: buildServiceColorsCell(service.colorDark, service.textColorDark, service.opacityDark),
      },
      formValues: {
        code: service.code,
        name: service.name,
        colorLight: service.colorLight ?? undefined,
        textColorLight: service.textColorLight ?? undefined,
        opacityLight: service.opacityLight,
        colorDark: service.colorDark ?? undefined,
        textColorDark: service.textColorDark ?? undefined,
        opacityDark: service.opacityDark,
        isActive: service.isActive,
      },
    })),
    auditMap,
  );

  return {
    title: tr(d, "services.title"),
    summary: tr(d, "services.summary"),
    csvFileName: "services.csv",
    stats: [
      { label: tr(d, "services.statTotal"), value: String(services.length) },
      { label: tr(d, "services.statActive"), value: String(services.filter((service) => service.isActive).length) },
      { label: tr(d, "services.statShiftTypes"), value: String(services.reduce((total, service) => total + service._count.shiftTypes, 0)) },
    ],
    columns: [
      { key: "code", label: tr(d, "services.colCode") },
      { key: "name", label: tr(d, "services.colName") },
      { key: "status", label: tr(d, "services.colStatus") },
      { key: "light", label: tr(d, "services.colColorsLight") },
      { key: "dark", label: tr(d, "services.colColorsDark") },
    ],
    rows,
    emptyMessage: tr(d, "services.empty"),
    addLabel: tr(d, "services.addLabel"),
    sheetTitle: tr(d, "services.sheetTitle"),
    sheetDescription: tr(d, "services.sheetDescription"),
    submitLabel: tr(d, "services.submitLabel"),
    searchPlaceholder: tr(d, "services.search"),
    fields: [
      { type: "text", name: "code", label: tr(d, "services.fieldCode"), required: true, placeholder: tr(d, "services.fieldCodePlaceholder") },
      { type: "text", name: "name", label: tr(d, "services.fieldName"), required: true, placeholder: tr(d, "services.fieldNamePlaceholder") },
      { type: "color", name: "colorLight", label: tr(d, "services.fieldLightBg"), defaultValue: "#E6F4F5" },
      { type: "color", name: "textColorLight", label: tr(d, "services.fieldLightText"), defaultValue: "#0D6B73" },
      { type: "range", name: "opacityLight", label: tr(d, "services.fieldLightOpacity"), defaultValue: 50, min: 0, max: 100, step: 1, required: true },
      { type: "color", name: "colorDark", label: tr(d, "services.fieldDarkBg"), defaultValue: "#0D6B73" },
      { type: "color", name: "textColorDark", label: tr(d, "services.fieldDarkText"), defaultValue: "#F8FBFB" },
      { type: "range", name: "opacityDark", label: tr(d, "services.fieldDarkOpacity"), defaultValue: 100, min: 0, max: 100, step: 1, required: true },
      { type: "checkbox", name: "isActive", label: tr(d, "services.fieldIsActive"), defaultChecked: true },
    ],
  };
}

export async function getShiftsModule(): Promise<EntityModuleConfig> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);
  const [shiftTypes, services] = await Promise.all([
    db.shiftType.findMany({
      include: {
        service: true,
      },
      orderBy: [{ service: { name: "asc" } }, { startsAt: "asc" }],
    }),
    db.service.findMany({
      orderBy: {
        name: "asc",
      },
    }),
  ]);

  const auditMap = await getAuditEntryMap("SHIFT_TYPE", shiftTypes.map((shiftType) => shiftType.id));
  const rows = attachAuditRows(
    shiftTypes.map((shiftType) => ({
      id: shiftType.id,
      label: shiftType.name,
      formValues: {
        code: shiftType.code,
        name: shiftType.name,
        serviceId: shiftType.serviceId,
        startsAt: shiftType.startsAt,
        endsAt: shiftType.endsAt,
        crossesMidnight: shiftType.crossesMidnight,
        isActive: shiftType.isActive,
        ...getShiftValidityFormValues(shiftType.validityDays),
      },
      cells: {
        code: { text: shiftType.code, mono: true },
        name: shiftType.name,
        service: {
          text: shiftType.service.name,
          colorTokens: [buildServiceBadgeToken(shiftType.service)],
        },
        window: `${shiftType.startsAt} - ${shiftType.endsAt}${shiftType.crossesMidnight ? " (+1)" : ""}`,
        validity: buildShiftValidityCell(shiftType.validityDays),
        status: boolCell(shiftType.isActive, "Aktívna", "Neaktívna"),
      },
    })),
    auditMap,
  );

  return {
    title: tr(d, "shifts.title"),
    summary: tr(d, "shifts.summary"),
    csvFileName: "shifts.csv",
    stats: [
      { label: tr(d, "shifts.statTotal"), value: String(shiftTypes.length) },
      { label: tr(d, "shifts.statMidnight"), value: String(shiftTypes.filter((shiftType) => shiftType.crossesMidnight).length) },
      { label: tr(d, "shifts.statActive"), value: String(shiftTypes.filter((shiftType) => shiftType.isActive).length) },
    ],
    columns: [
      { key: "code", label: tr(d, "shifts.colCode") },
      { key: "name", label: tr(d, "shifts.colName") },
      { key: "service", label: tr(d, "shifts.colService") },
      { key: "window", label: tr(d, "shifts.colTime") },
      { key: "validity", label: tr(d, "shifts.colDays") },
      { key: "status", label: tr(d, "shifts.colValidity") },
    ],
    rows,
    emptyMessage: tr(d, "shifts.empty"),
    addLabel: tr(d, "shifts.addLabel"),
    sheetTitle: tr(d, "shifts.sheetTitle"),
    sheetDescription: tr(d, "shifts.sheetDescription"),
    submitLabel: tr(d, "shifts.submitLabel"),
    searchPlaceholder: tr(d, "shifts.search"),
    ...{
      fields: [
      { type: "text", name: "code", label: tr(d, "shifts.fieldCode"), required: true, placeholder: tr(d, "shifts.fieldCodePlaceholder") },
      { type: "text", name: "name", label: tr(d, "shifts.fieldName"), required: true, placeholder: tr(d, "shifts.fieldNamePlaceholder") },
      {
        type: "select",
        name: "serviceId",
        label: tr(d, "shifts.fieldService"),
        required: true,
        options: services.map((service) => ({ value: service.id, label: service.name })),
      },
      { type: "time", name: "startsAt", label: tr(d, "shifts.fieldStartsAt"), required: true, defaultValue: "08:00" },
      { type: "time", name: "endsAt", label: tr(d, "shifts.fieldEndsAt"), required: true, defaultValue: "20:00" },
      { type: "checkbox", name: "crossesMidnight", label: tr(d, "shifts.fieldCrossesMidnight") },
      ...shiftValidityDefinitions.map((definition, index) => ({
        type: "checkbox" as const,
        name: definition.fieldName,
        label: definition.label,
        defaultChecked: true,
        group: "validity",
        ...(index === 0 ? { groupLabel: tr(d, "shifts.fieldValidForGroup") } : {}),
      })),
      { type: "checkbox", name: "isActive", label: tr(d, "shifts.fieldIsActive"), defaultChecked: true },
      ],
    },
    createDisabledReason: services.length === 0 ? tr(d, "shifts.createDisabled") : undefined,
    importDisabledReason: services.length === 0 ? tr(d, "shifts.importDisabled") : undefined,
  };
}

export async function getVacationsModule(): Promise<EntityModuleConfig> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);
  const [vacations, users, holidays] = await Promise.all([
    db.vacation.findMany({
      include: {
        user: true,
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    }),
    db.user.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    getHolidays(),
  ]);

  const userOptions = users.map((user) => ({
    value: user.id,
    label: `${user.firstName} ${user.lastName}`,
  }));
  const auditMap = await getAuditEntryMap("VACATION", vacations.map((vacation) => vacation.id));
  const calendarItems: CalendarItem[] = vacations.flatMap((vacation) => {
    const colors = vacationStatusCalendarColors(vacation.status);

    return expandUtcDateRange(vacation.startDate, vacation.endDate).map((date) => ({
      id: `${vacation.id}-${date}`,
      recordId: vacation.id,
      date,
      title: `${vacation.user.lastName}, ${vacation.user.firstName}`,
      subtitle: vacationStatusLabel(vacation.status),
      timeLabel: vacation.notes ?? undefined,
      backgroundColor: colors.backgroundColor,
      accentColor: colors.accentColor,
      textColor: colors.textColor,
      locked: vacation.locked,
    }));
  });
  const rows = attachAuditRows(
    vacations.map((vacation) => ({
      id: vacation.id,
      label: `${vacation.user.firstName} ${vacation.user.lastName}`,
      formValues: {
        userId: vacation.userId,
        startDate: toIsoDate(vacation.startDate),
        endDate: toIsoDate(vacation.endDate),
        locked: vacation.locked,
        status: vacation.status,
        notes: vacation.notes ?? undefined,
      },
      cells: {
        user: `${vacation.user.firstName} ${vacation.user.lastName}`,
        range: formatDateRange(vacation.startDate, vacation.endDate),
        locked: boolCell(vacation.locked, "Zamknute", "Otvorene"),
        status: vacationStatusCell(vacation.status),
        notes: vacation.notes ?? "-",
      },
    })),
    auditMap,
  );

  return {
    title: tr(d, "vacations.title"),
    summary: tr(d, "vacations.summary"),
    csvFileName: "vacations.csv",
    stats: [
      { label: tr(d, "vacations.statTotal"), value: String(vacations.length) },
      { label: tr(d, "vacations.statPending"), value: String(vacations.filter((vacation) => vacation.status === VacationStatus.PENDING).length) },
      { label: tr(d, "vacations.statApproved"), value: String(vacations.filter((vacation) => vacation.status === VacationStatus.APPROVED).length) },
    ],
    columns: [
      { key: "user", label: tr(d, "vacations.colUser") },
      { key: "range", label: tr(d, "vacations.colPeriod") },
      { key: "locked", label: tr(d, "vacations.colLock") },
      { key: "status", label: tr(d, "vacations.colStatus") },
      { key: "notes", label: tr(d, "vacations.colNotes") },
    ],
    rows,
    emptyMessage: tr(d, "vacations.empty"),
    addLabel: tr(d, "vacations.addLabel"),
    sheetTitle: tr(d, "vacations.sheetTitle"),
    sheetDescription: tr(d, "vacations.sheetDescription"),
    submitLabel: tr(d, "vacations.submitLabel"),
    searchPlaceholder: tr(d, "vacations.search"),
    views: ["calendar", "table"],
    defaultView: "calendar",
    monthScopeEnabled: true,
    calendar: {
      initialMonth: toIsoDate(vacations[0]?.startDate ?? todayUtc).slice(0, 7),
      items: calendarItems,
      holidays,
    },
    fields: [
      { type: "select", name: "userId", label: tr(d, "vacations.fieldUser"), required: true, options: userOptions },
      { type: "date", name: "startDate", label: tr(d, "vacations.fieldStartDate"), required: true },
      { type: "date", name: "endDate", label: tr(d, "vacations.fieldEndDate"), required: true },
      {
        type: "select",
        name: "status",
        label: tr(d, "vacations.fieldStatus"),
        required: true,
        defaultValue: VacationStatus.PENDING,
        options: [
          { value: VacationStatus.PENDING, label: tr(d, "vacations.optPending") },
          { value: VacationStatus.APPROVED, label: tr(d, "vacations.optApproved") },
          { value: VacationStatus.REJECTED, label: tr(d, "vacations.optRejected") },
        ],
      },
      { type: "textarea", name: "notes", label: tr(d, "vacations.fieldNotes"), rows: 4, placeholder: tr(d, "vacations.fieldNotesPlaceholder") },
    ],
    createDisabledReason: users.length === 0 ? tr(d, "vacations.createDisabled") : undefined,
    importDisabledReason: users.length === 0 ? tr(d, "vacations.importDisabled") : undefined,
  };
}

export async function getConditionsModule(): Promise<EntityModuleConfig> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);
  const conditions = await db.condition.findMany({
    orderBy: [{ priority: "asc" }, { title: "asc" }],
  });

  const auditMap = await getAuditEntryMap("CONDITION", conditions.map((condition) => condition.id));
  const rows = attachAuditRows(
    conditions.map((condition) => ({
      id: condition.id,
      label: condition.title,
      formValues: {
        type: condition.type,
        title: condition.title,
        priority: condition.priority,
        isActive: condition.isActive,
        description: condition.description,
      },
      cells: {
        type: condition.type,
        title: condition.title,
        priority: String(condition.priority),
        status: boolCell(condition.isActive),
        description: condition.description,
      },
    })),
    auditMap,
  );

  return {
    title: tr(d, "conditions.title"),
    summary: tr(d, "conditions.summary"),
    csvFileName: "conditions.csv",
    stats: [
      { label: tr(d, "conditions.statTotal"), value: String(conditions.length) },
      { label: tr(d, "conditions.statActive"), value: String(conditions.filter((condition) => condition.isActive).length) },
      { label: tr(d, "conditions.statHighestPriority"), value: conditions.length > 0 ? String(Math.min(...conditions.map((condition) => condition.priority))) : "-" },
    ],
    columns: [
      { key: "type", label: tr(d, "conditions.colType") },
      { key: "title", label: tr(d, "conditions.colDescription") },
      { key: "priority", label: tr(d, "conditions.colPriority") },
      { key: "status", label: tr(d, "conditions.colStatus") },
      { key: "description", label: tr(d, "conditions.colDetail") },
    ],
    rows,
    emptyMessage: tr(d, "conditions.empty"),
    addLabel: tr(d, "conditions.addLabel"),
    sheetTitle: tr(d, "conditions.sheetTitle"),
    sheetDescription: tr(d, "conditions.sheetDescription"),
    submitLabel: tr(d, "conditions.submitLabel"),
    searchPlaceholder: tr(d, "conditions.search"),
    fields: [
      { type: "text", name: "type", label: tr(d, "conditions.fieldType"), required: true, placeholder: tr(d, "conditions.fieldTypePlaceholder"), description: tr(d, "conditions.fieldTypeHint") },
      { type: "text", name: "title", label: tr(d, "conditions.fieldTitle"), required: true, placeholder: tr(d, "conditions.fieldTitlePlaceholder") },
      { type: "number", name: "priority", label: tr(d, "conditions.fieldPriority"), required: true, defaultValue: 100, min: 0, max: 10000, description: tr(d, "conditions.fieldPriorityHint") },
      { type: "checkbox", name: "isActive", label: tr(d, "conditions.fieldIsActive"), defaultChecked: true },
      { type: "textarea", name: "description", label: tr(d, "conditions.fieldDescription"), required: true, rows: 5, placeholder: tr(d, "conditions.fieldDescriptionPlaceholder") },
    ],
  };
}

export async function getHolidaysModule(): Promise<EntityModuleConfig> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);

  const holidays = await db.holiday.findMany({
    orderBy: [{ date: "desc" }, { country: "asc" }],
  });

  const auditMap = await getAuditEntryMap("HOLIDAY", holidays.map((holiday) => holiday.id));
  const rows = attachAuditRows(
    holidays.map((holiday) => ({
      id: holiday.id,
      label: holiday.name,
      formValues: {
        date: toIsoDate(holiday.date),
        country: holiday.country,
        name: holiday.name,
        localName: holiday.localName ?? undefined,
      },
      cells: {
        date: formatDate(holiday.date),
        country: holiday.country,
        name: holiday.name,
        localName: holiday.localName ?? "-",
      },
    })),
    auditMap,
  );

  return {
    title: tr(d, "holidays.title"),
    summary: tr(d, "holidays.summary"),
    csvFileName: "holidays.csv",
    stats: [
      { label: tr(d, "holidays.statTotal"), value: String(holidays.length) },
      { label: tr(d, "holidays.statUpcoming"), value: String(holidays.filter((holiday) => holiday.date >= todayUtc).length) },
      { label: tr(d, "holidays.statCountries"), value: String(new Set(holidays.map((holiday) => holiday.country)).size) },
    ],
    columns: [
      { key: "date", label: tr(d, "holidays.colDate") },
      { key: "country", label: tr(d, "holidays.colCountry") },
      { key: "name", label: tr(d, "holidays.colNameEn") },
      { key: "localName", label: tr(d, "holidays.colNameLocal") },
    ],
    rows,
    emptyMessage: tr(d, "holidays.empty"),
    addLabel: tr(d, "holidays.addLabel"),
    sheetTitle: tr(d, "holidays.sheetTitle"),
    sheetDescription: tr(d, "holidays.sheetDescription"),
    submitLabel: tr(d, "holidays.submitLabel"),
    searchPlaceholder: tr(d, "holidays.search"),
    fields: [
      { type: "date", name: "date", label: tr(d, "holidays.fieldDate"), required: true },
      { type: "text", name: "country", label: tr(d, "holidays.fieldCountry"), required: true, placeholder: tr(d, "holidays.fieldCountryPlaceholder") },
      { type: "text", name: "name", label: tr(d, "holidays.fieldName"), required: true, placeholder: tr(d, "holidays.fieldNamePlaceholder") },
      { type: "text", name: "localName", label: tr(d, "holidays.fieldLocalName"), placeholder: tr(d, "holidays.fieldLocalNamePlaceholder") },
    ],
  };
}

export async function getSettingsModule(): Promise<EntityModuleConfig> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);

  const allSettings = await db.appSetting.findMany({
    orderBy: {
      key: "asc",
    },
  });
  const settings = allSettings.filter((setting) => !isManagedSettingKey(setting.key));

  return {
    title: tr(d, "settings.title"),
    summary: tr(d, "settings.summary"),
    csvFileName: "settings.csv",
    stats: [
      { label: tr(d, "settings.statTotal"), value: String(settings.length) },
      { label: tr(d, "settings.statJson"), value: String(settings.filter((setting) => typeof setting.value === "object" && setting.value !== null).length) },
      { label: tr(d, "settings.statUpdatedToday"), value: String(settings.filter((setting) => Date.now() - setting.updatedAt.getTime() < 86_400_000).length) },
    ],
    columns: [
      { key: "key", label: tr(d, "settings.colKey") },
      { key: "value", label: tr(d, "settings.colValue") },
      { key: "updated", label: tr(d, "settings.colUpdated") },
    ],
    rows: settings.map((setting) => ({
      id: setting.id,
      label: setting.key,
      formValues: {
        key: setting.key,
        value: JSON.stringify(setting.value, null, 2) ?? "null",
      },
      cells: {
        key: { text: setting.key, mono: true },
        value: { text: formatJson(setting.value), mono: true },
        updated: formatDate(setting.updatedAt),
      },
    })),
    emptyMessage: tr(d, "settings.empty"),
    addLabel: tr(d, "settings.addLabel"),
    sheetTitle: tr(d, "settings.sheetTitle"),
    sheetDescription: tr(d, "settings.sheetDescription"),
    submitLabel: tr(d, "settings.submitLabel"),
    searchPlaceholder: tr(d, "settings.search"),
    fields: [
      { type: "text", name: "key", label: tr(d, "settings.fieldKey"), required: true, placeholder: tr(d, "settings.fieldKeyPlaceholder") },
      {
        type: "textarea",
        name: "value",
        label: tr(d, "settings.fieldJsonValue"),
        required: true,
        rows: 7,
        defaultValue: "{\n  \"enabled\": true\n}",
        placeholder: "{\n  \"enabled\": true\n}",
      },
    ],
  };
}

export async function getScheduleModule(): Promise<EntityModuleConfig> {
  const locale = await getServerLocale();
  const d = getDictionary(locale);

  const [entries, users, services, shiftTypes, userShiftTypes, holidays] = await Promise.all([
    db.scheduleEntry.findMany({
      include: {
        user: true,
        service: true,
        shiftType: true,
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    db.user.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    db.service.findMany({
      orderBy: {
        name: "asc",
      },
    }),
    db.shiftType.findMany({
      include: {
        service: true,
      },
      orderBy: [{ service: { name: "asc" } }, { startsAt: "asc" }],
    }),
    db.userShiftType.findMany({
      select: {
        userId: true,
        shiftTypeId: true,
      },
    }),
    getHolidays(),
  ]);

  const userOptions = users.map((user) => ({
    value: user.id,
    label: `${user.firstName} ${user.lastName}`,
  }));
  const shiftOptions = shiftTypes.map((shiftType) => {
    const validity = parseShiftValidity(shiftType.validityDays);
    // Map validity keys to JS Date day numbers (0=Sun, 1=Mon, ..., 6=Sat)
    const validDays: number[] = [];
    if (validity.mon) validDays.push(1);
    if (validity.tue) validDays.push(2);
    if (validity.wed) validDays.push(3);
    if (validity.thu) validDays.push(4);
    if (validity.fri) validDays.push(5);
    if (validity.sat) validDays.push(6);
    if (validity.sun) validDays.push(0);

    return {
      value: shiftType.id,
      label: `${shiftType.service.name} / ${shiftType.name} (${shiftType.startsAt}-${shiftType.endsAt})`,
      validDays,
      validHoliday: validity.holiday,
      allowedValues: userShiftTypes.filter((assignment) => assignment.shiftTypeId === shiftType.id).map((assignment) => assignment.userId),
    };
  });
  const missingDependencies = [
    users.length === 0 ? tr(d, "schedule.depUser") : null,
    services.length === 0 ? tr(d, "schedule.depService") : null,
    shiftTypes.length === 0 ? tr(d, "schedule.depShift") : null,
  ].filter((value): value is string => Boolean(value));
  const auditMap = await getAuditEntryMap("SCHEDULE_ENTRY", entries.map((entry) => entry.id));
  const calendarItems: CalendarItem[] = entries.map((entry) => {
    const fallbackColors = mapServiceCalendarColors(entry.service.name);
    const baseBackground = entry.service.colorLight ?? fallbackColors.backgroundColor;
    const opacity = clampOpacity(entry.service.opacityLight, 78);
    const colors = {
      backgroundColor: hexToRgba(baseBackground, opacity / 100) ?? baseBackground,
      accentColor: entry.service.colorDark ?? fallbackColors.accentColor,
      textColor: entry.service.textColorLight ?? fallbackColors.textColor,
    };

    return {
      id: entry.id,
      recordId: entry.id,
      date: toIsoDate(entry.date),
      title: entry.service.name,
      subtitle: `${entry.user.lastName}, ${entry.user.firstName}`,
      timeLabel: `${entry.shiftType.startsAt} - ${entry.shiftType.endsAt}`,
      backgroundColor: colors.backgroundColor ?? undefined,
      stripColor: baseBackground,
      accentColor: colors.accentColor ?? undefined,
      textColor: colors.textColor ?? undefined,
      locked: entry.locked,
    };
  });
  const rows = attachAuditRows(
    entries.map((entry) => ({
      id: entry.id,
      label: `${entry.user.firstName} ${entry.user.lastName} / ${formatDate(entry.date)}`,
      formValues: {
        date: toIsoDate(entry.date),
        userId: entry.userId,
        shiftTypeId: entry.shiftTypeId,
        source: entry.source,
        locked: entry.locked,
        note: entry.note ?? undefined,
      },
      cells: {
        date: formatDate(entry.date),
        user: `${entry.user.firstName} ${entry.user.lastName}`,
        service: entry.service.name,
        shift: `${entry.shiftType.name} (${entry.shiftType.startsAt}-${entry.shiftType.endsAt})`,
        _shiftStat: `${entry.service.name} / ${entry.shiftType.name}`,
        source: scheduleSourceCell(entry.source),
        locked: boolCell(entry.locked, tr(d, "entity.locked"), tr(d, "entity.unlocked")),
        note: entry.note ?? "-",
      },
    })),
    auditMap,
  );

  // Build per-user x shift-type breakdown
  const shiftTypeNames = shiftTypes.map((st) => `${st.service.name} / ${st.name}`);
  const userShiftCounts = new Map<string, Map<string, number>>();

  for (const entry of entries) {
    const userName = `${entry.user.firstName} ${entry.user.lastName}`;
    const shiftName = `${entry.service.name} / ${entry.shiftType.name}`;

    if (!userShiftCounts.has(userName)) {
      userShiftCounts.set(userName, new Map());
    }

    const userMap = userShiftCounts.get(userName)!;
    userMap.set(shiftName, (userMap.get(shiftName) ?? 0) + 1);
  }

  const userStatRows = Array.from(userShiftCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b, "sk"))
    .map(([userName, shiftMap]) => {
      const values: Record<string, string> = {};
      let total = 0;

      for (const stName of shiftTypeNames) {
        const count = shiftMap.get(stName) ?? 0;
        values[stName] = String(count);
        total += count;
      }

      values[tr(d, "schedule.statColTotal")] = String(total);
      return { label: userName, values };
    });

  // Build per-shift-type totals
  const shiftTotals = new Map<string, number>();
  for (const entry of entries) {
    const shiftName = `${entry.service.name} / ${entry.shiftType.name}`;
    shiftTotals.set(shiftName, (shiftTotals.get(shiftName) ?? 0) + 1);
  }

  const shiftStatRows = shiftTypeNames
    .filter((name) => (shiftTotals.get(name) ?? 0) > 0)
    .map((name) => ({
      label: name,
      values: { [tr(d, "schedule.statCount")]: String(shiftTotals.get(name) ?? 0) },
    }));

  return {
    moduleKey: "schedule",
    title: tr(d, "schedule.title"),
    summary: tr(d, "schedule.summary"),
    csvFileName: "schedule.csv",
    stats: [
      { label: tr(d, "schedule.statTotal"), value: String(entries.length) },
      { label: tr(d, "schedule.statLocked"), value: String(entries.filter((entry) => entry.locked).length) },
      { label: tr(d, "schedule.statManual"), value: String(entries.filter((entry) => entry.source === ScheduleSource.MANUAL).length) },
    ],
    statGroups: [
      {
        title: tr(d, "schedule.statByUser"),
        columns: [...shiftTypeNames, tr(d, "schedule.statColTotal")],
        rows: userStatRows,
        groupByField: "userId",
        breakdownField: "_shiftStat",
      },
      {
        title: tr(d, "schedule.statByShift"),
        columns: [tr(d, "schedule.statCount")],
        rows: shiftStatRows,
        breakdownField: "_shiftStat",
      },
    ],
    columns: [
      { key: "date", label: tr(d, "schedule.colDate") },
      { key: "user", label: tr(d, "schedule.colUser") },
      { key: "service", label: tr(d, "schedule.colService") },
      { key: "shift", label: tr(d, "schedule.colShift") },
      { key: "source", label: tr(d, "schedule.colSource") },
      { key: "locked", label: tr(d, "schedule.colStatus") },
      { key: "note", label: tr(d, "schedule.colNote") },
    ],
    rows,
    emptyMessage: tr(d, "schedule.empty"),
    addLabel: tr(d, "schedule.addLabel"),
    sheetTitle: tr(d, "schedule.sheetTitle"),
    sheetDescription: tr(d, "schedule.sheetDescription"),
    submitLabel: tr(d, "schedule.submitLabel"),
    searchPlaceholder: tr(d, "schedule.search"),
    views: ["calendar", "table", "stats"],
    defaultView: "calendar",
    monthScopeEnabled: true,
    calendar: {
      initialMonth: toIsoDate(entries[0]?.date ?? todayUtc).slice(0, 7),
      items: calendarItems,
      holidays,
    },
    fields: [
      { type: "date", name: "date", label: tr(d, "schedule.fieldDate"), required: true },
      { type: "select", name: "userId", label: tr(d, "schedule.fieldUser"), required: true, options: userOptions },
      {
        type: "select",
        name: "shiftTypeId",
        label: tr(d, "schedule.fieldShiftType"),
        required: true,
        options: shiftOptions,
        description: tr(d, "schedule.fieldShiftTypeHint"),
        filterByField: "userId",
      },
      {
        type: "select",
        name: "source",
        label: tr(d, "schedule.fieldSource"),
        required: true,
        defaultValue: ScheduleSource.MANUAL,
        options: [
          { value: ScheduleSource.MANUAL, label: tr(d, "schedule.optManual") },
          { value: ScheduleSource.IMPORT, label: tr(d, "schedule.optImport") },
          { value: ScheduleSource.AI, label: tr(d, "schedule.optAi") },
        ],
      },
      { type: "textarea", name: "note", label: tr(d, "schedule.fieldNote"), rows: 4, placeholder: tr(d, "schedule.fieldNotePlaceholder") },
    ],
    createDisabledReason:
      missingDependencies.length > 0
        ? tr(d, "schedule.createDisabled", { dependencies: missingDependencies.join(", ") })
        : undefined,
    importDisabledReason:
      missingDependencies.length > 0
        ? tr(d, "schedule.importDisabled", { dependencies: missingDependencies.join(", ") })
        : undefined,
  };
}

export type AiAuditRunSummary = {
  id: string;
  provider: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  totalEvents: number;
  acceptedEvents: number;
  rejectedEvents: number;
  error: string | null;
  entries: AiAuditEntryRow[];
};

export type AiAuditEntryRow = {
  id: string;
  date: string;
  userName: string | null;
  shiftTypeName: string | null;
  accepted: boolean;
  reason: string | null;
};

export async function getAiAuditRuns(): Promise<AiAuditRunSummary[]> {
  const runs = await db.aiRun.findMany({
    where: { useCase: "schedule-generation" },
    include: {
      auditEntries: {
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return runs.map((run) => ({
    id: run.id,
    provider: run.provider,
    status: run.status,
    startedAt: run.startedAt ? formatDateTime(run.startedAt) : null,
    finishedAt: run.finishedAt ? formatDateTime(run.finishedAt) : null,
    createdAt: formatDateTime(run.createdAt),
    totalEvents: run.auditEntries.length,
    acceptedEvents: run.auditEntries.filter((e) => e.accepted).length,
    rejectedEvents: run.auditEntries.filter((e) => !e.accepted).length,
    error: run.error,
    entries: run.auditEntries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      userName: entry.userName,
      shiftTypeName: entry.shiftTypeName,
      accepted: entry.accepted,
      reason: entry.reason,
    })),
  }));
}
