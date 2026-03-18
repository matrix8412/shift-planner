export const shiftValidityDefinitions = [
  { key: "mon", label: "Po", fieldName: "validOnMon" },
  { key: "tue", label: "Ut", fieldName: "validOnTue" },
  { key: "wed", label: "St", fieldName: "validOnWed" },
  { key: "thu", label: "Stv", fieldName: "validOnThu" },
  { key: "fri", label: "Pi", fieldName: "validOnFri" },
  { key: "sat", label: "So", fieldName: "validOnSat" },
  { key: "sun", label: "Ne", fieldName: "validOnSun" },
  { key: "holiday", label: "Sviatok", fieldName: "validOnHoliday" },
] as const;

export type ShiftValidityKey = (typeof shiftValidityDefinitions)[number]["key"];
export type ShiftValidityFieldName = (typeof shiftValidityDefinitions)[number]["fieldName"];
export type ShiftValidity = Record<ShiftValidityKey, boolean>;

export const defaultShiftValidity: ShiftValidity = {
  mon: true,
  tue: true,
  wed: true,
  thu: true,
  fri: true,
  sat: true,
  sun: true,
  holiday: true,
};

const weekdayKeyMap: ShiftValidityKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function parseShiftValidity(value: unknown): ShiftValidity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultShiftValidity };
  }

  const parsed = { ...defaultShiftValidity };

  for (const definition of shiftValidityDefinitions) {
    if (typeof (value as Record<string, unknown>)[definition.key] === "boolean") {
      parsed[definition.key] = (value as Record<string, boolean>)[definition.key];
    }
  }

  return parsed;
}

export function buildShiftValidityFromFieldValues(fieldValues: Partial<Record<ShiftValidityFieldName, boolean>>): ShiftValidity {
  return shiftValidityDefinitions.reduce<ShiftValidity>((accumulator, definition) => {
    accumulator[definition.key] = Boolean(fieldValues[definition.fieldName]);
    return accumulator;
  }, { ...defaultShiftValidity });
}

export function getShiftValidityFormValues(validity: unknown): Record<ShiftValidityFieldName, boolean> {
  const parsed = parseShiftValidity(validity);

  return shiftValidityDefinitions.reduce<Record<ShiftValidityFieldName, boolean>>((accumulator, definition) => {
    accumulator[definition.fieldName] = parsed[definition.key];
    return accumulator;
  }, {} as Record<ShiftValidityFieldName, boolean>);
}

export function getShiftValidityLabels(validity: unknown) {
  const parsed = parseShiftValidity(validity);
  return shiftValidityDefinitions.filter((definition) => parsed[definition.key]).map((definition) => definition.label);
}

export function getScheduleDayType(date: Date, isHoliday: boolean): { key: ShiftValidityKey; label: string } {
  if (isHoliday) {
    return { key: "holiday", label: "sviatok" };
  }

  const key = weekdayKeyMap[date.getUTCDay()];
  const definition = shiftValidityDefinitions.find((item) => item.key === key);

  return {
    key,
    label: definition?.label ?? key,
  };
}

export function isShiftValidForDayType(validity: unknown, dayType: ShiftValidityKey) {
  const parsed = parseShiftValidity(validity);
  return parsed[dayType];
}
