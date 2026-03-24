"use client";

import { startTransition, type CSSProperties, type ChangeEvent, type FormEvent, type ReactNode, useActionState, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Eye,
  EyeOff,
  List,
  Lock,
  LockOpen,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { useBrowserNotifications } from "@/components/browser-notification-provider";
import SearchableSelect from "@/components/searchable-select";
import { FormSubmitButton } from "@/components/form-submit-button";
import { useI18n } from "@/i18n/context";
import { saveColumnPreferences, savePageSizePreference } from "@/server/actions/column-preferences";
import type {
  ActionState,
  AuditEntry,
  AuditFieldChange,
  CalendarConfig,
  CalendarItem,
  EntityCell,
  EntityCellColorToken,
  EntityModuleConfig,
  EntityRow,
  FormField,
  ModuleView,
  SheetTab,
  StatGroup,
} from "@/components/entity-module.types";

const initialActionState: ActionState = {
  status: "idle",
};

const defaultRowsPerPage = 10;
const pageSizeOptions = [5, 10, 15, 20, 25, 50];
const defaultAuditRowsPerPage = 8;

type EntityModuleProps = EntityModuleConfig & {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  editAction?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  deleteAction?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  importAction?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  toggleLockAction?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  bulkLockAction?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  bulkDeleteAction?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  moveAction?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canImport?: boolean;
  canExport?: boolean;
  canToggleLock?: boolean;
  headerActions?: ReactNode;
  primaryAction?: ReactNode;
  preSurfaceContent?: ReactNode;
  hideHeader?: boolean;
};

type RowMenuPosition = {
  left: number;
  top: number;
};

type ContextMenuState = {
  recordId: string;
  position: RowMenuPosition;
};

type DeletePromptState = {
  recordId: string;
  label: string;
};

type FormValue = string | number | boolean | string[] | undefined;
type SortDirection = "asc" | "desc";
type TableSortState = {
  columnKey: string;
  direction: SortDirection;
};

const weekdayFormatter = new Intl.DateTimeFormat("sk-SK", {
  weekday: "short",
  timeZone: "UTC",
});

const monthFormatter = new Intl.DateTimeFormat("sk-SK", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase("sk-SK").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatMonthLabel(value: string) {
  return monthFormatter.format(parseMonthValue(value));
}

function formatWeekdayLabel(date: Date) {
  const label = weekdayFormatter.format(date).replace(".", "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function parseMonthValue(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function toMonthValue(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toDateValue(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addMonths(value: string, amount: number) {
  const next = parseMonthValue(value);
  next.setUTCMonth(next.getUTCMonth() + amount);
  return toMonthValue(next);
}

function buildCalendarDays(monthValue: string) {
  const monthStart = parseMonthValue(monthValue);
  const gridStart = new Date(monthStart);
  const mondayOffset = (gridStart.getUTCDay() + 6) % 7;
  gridStart.setUTCDate(gridStart.getUTCDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);

    return {
      date,
      key: toDateValue(date),
      inMonth: date.getUTCMonth() === monthStart.getUTCMonth(),
      isToday: toDateValue(date) === toDateValue(new Date()),
    };
  });
}

function getCellToneClass(cell: EntityCell) {
  if (typeof cell === "string") {
    return "";
  }

  if (!cell.tone) {
    return "";
  }

  switch (cell.tone) {
    case "success":
      return "pill success";
    case "warning":
      return "pill warning";
    case "danger":
      return "pill danger";
    default:
      return "";
  }
}

function getCellText(cell: EntityCell) {
  return typeof cell === "string" ? cell : cell.text;
}

function formatDisplayDate(value: string, locale: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const formatterLocale = locale === "sk" ? "sk-SK" : "en-US";

  return new Intl.DateTimeFormat(formatterLocale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function findScheduleDuplicateRow(rows: EntityRow[], date: string, userId: string) {
  return rows.find((row) => row.formValues?.date === date && row.formValues?.userId === userId);
}

function initialsFromName(name: string) {
  return name
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function isSortableNumericString(value: string) {
  return /^-?\d+(?:[.,]\d+)?$/.test(value.trim());
}

function isSortableIsoDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value.trim());
}

function getSortablePrimitiveValue(value: FormValue | EntityCell | null | undefined) {
  if (Array.isArray(value)) {
    return normalizeSearchValue(value.join(" "));
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return "";
    }

    if (isSortableNumericString(trimmed)) {
      return Number(trimmed.replace(",", "."));
    }

    if (isSortableIsoDateString(trimmed)) {
      const timestamp = Date.parse(trimmed);

      if (!Number.isNaN(timestamp)) {
        return timestamp;
      }
    }

    return normalizeSearchValue(trimmed);
  }

  if (value) {
    return normalizeSearchValue(getCellText(value));
  }

  return "";
}

function getRowSortValue(row: EntityRow, columnKey: string) {
  const formValue = row.formValues?.[columnKey];

  if (formValue !== undefined) {
    return getSortablePrimitiveValue(formValue);
  }

  return getSortablePrimitiveValue(row.cells[columnKey]);
}

function getCellClassName(cell: EntityCell) {
  return typeof cell === "string" ? "" : cell.mono ? "mono-text" : "";
}

function getCellColorTokens(cell: EntityCell): EntityCellColorToken[] {
  if (typeof cell === "string" || !cell.colorTokens) {
    return [];
  }

  return cell.colorTokens;
}

function getColorTokenStyle(token: EntityCellColorToken): CSSProperties | undefined {
  if (!token.backgroundColor && !token.textColor && !token.borderColor) {
    return undefined;
  }

  return {
    backgroundColor: token.backgroundColor,
    color: token.textColor,
    borderColor: token.borderColor,
    "--dark-bg": token.darkBackgroundColor ?? token.backgroundColor,
    "--dark-text": token.darkTextColor ?? token.textColor,
    "--dark-border": token.darkBorderColor ?? token.borderColor,
  } as CSSProperties;
}

function getFieldOptionStyle(option: { backgroundColor?: string; textColor?: string; borderColor?: string }): CSSProperties | undefined {
  if (!option.backgroundColor && !option.textColor && !option.borderColor) {
    return undefined;
  }

  return {
    backgroundColor: option.backgroundColor,
    color: option.textColor,
    borderColor: option.borderColor,
  };
}

function getAuditBadgeClass(action: string) {
  switch (action.toLowerCase()) {
    case "create":
      return "pill success";
    case "delete":
      return "pill danger";
    case "update":
      return "pill warning";
    default:
      return "pill";
  }
}

function getAuditTitle(action: string, t: (key: string, params?: Record<string, string | number>) => string) {
  switch (action.toLowerCase()) {
    case "create":
      return t("audit.create");
    case "delete":
      return t("audit.delete");
    case "update":
      return t("audit.update");
    default:
      return t("audit.generic");
  }
}

function getViewLabel(view: ModuleView, t: (key: string, params?: Record<string, string | number>) => string) {
  switch (view) {
    case "calendar":
      return t("entity.viewCalendar");
    case "stats":
      return t("entity.viewStats");
    default:
      return t("entity.viewList");
  }
}

function getViewIcon(view: ModuleView) {
  switch (view) {
    case "calendar":
      return CalendarDays;
    case "stats":
      return BarChart3;
    default:
      return List;
  }
}

function rowMatchesSearch(row: EntityRow, searchTerm: string) {
  if (!searchTerm) {
    return true;
  }

  const haystack = [row.label ?? "", ...Object.values(row.cells).map((cell) => getCellText(cell))].join(" ");
  return normalizeSearchValue(haystack).includes(searchTerm);
}

function rowMatchesMonth(row: EntityRow, monthValue: string) {
  if (!monthValue) {
    return true;
  }

  const dateValue = row.formValues?.date;
  if (typeof dateValue === "string") {
    return dateValue.startsWith(monthValue);
  }

  const startDateValue = row.formValues?.startDate;
  const endDateValue = row.formValues?.endDate;

  if (typeof startDateValue === "string" && typeof endDateValue === "string") {
    const monthStart = `${monthValue}-01`;
    const monthEndDate = parseMonthValue(monthValue);
    monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);
    monthEndDate.setUTCDate(0);
    const monthEnd = toDateValue(monthEndDate);

    return startDateValue <= monthEnd && endDateValue >= monthStart;
  }

  if (typeof startDateValue === "string") {
    return startDateValue.startsWith(monthValue);
  }

  if (typeof endDateValue === "string") {
    return endDateValue.startsWith(monthValue);
  }

  return true;
}

function calendarItemMatchesSearch(item: CalendarItem, searchTerm: string) {
  if (!searchTerm) {
    return true;
  }

  return normalizeSearchValue([item.title, item.subtitle ?? "", item.timeLabel ?? ""].join(" ")).includes(searchTerm);
}

function renderAuditChanges(changes: AuditFieldChange[], t: (key: string, params?: Record<string, string | number>) => string) {
  return (
    <div className="audit-change-list">
      <div className="audit-change-row audit-change-row-head">
        <span className="audit-change-label">{t("audit.field")}</span>
        <span className="audit-change-label">{t("audit.oldValue")}</span>
        <span className="audit-change-label">{t("audit.newValue")}</span>
      </div>
      {changes.map((change, index) => (
        <div key={`${change.field}-${index}`} className="audit-change-row">
          <span className="audit-change-field">{change.label}</span>
          <span className="audit-change-value audit-change-value-old">{change.previousValue}</span>
          <span className="audit-change-value audit-change-value-new">{change.nextValue}</span>
        </div>
      ))}
    </div>
  );
}

function AuditSheet({ entryRows }: { entryRows: AuditEntry[] }) {
  const { t } = useI18n();
  const [searchValue, setSearchValue] = useState("");
  const [page, setPage] = useState(1);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const deferredSearchValue = useDeferredValue(searchValue);
  const normalizedSearch = normalizeSearchValue(deferredSearchValue);
  const filteredEntries = useMemo(
    () =>
      entryRows.filter((entry) => {
        if (!normalizedSearch) {
          return true;
        }

        const actorMatches = normalizeSearchValue(entry.actor).includes(normalizedSearch);
        const fieldMatches =
          entry.changes?.some((change) => normalizeSearchValue(`${change.label} ${change.field}`).includes(normalizedSearch)) ?? false;

        return actorMatches || fieldMatches;
      }),
    [entryRows, normalizedSearch],
  );
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / defaultAuditRowsPerPage));
  const visiblePage = Math.min(page, totalPages);
  const paginationItems = useMemo(() => buildPaginationItems(visiblePage, totalPages), [totalPages, visiblePage]);
  const paginatedEntries = useMemo(() => {
    const startIndex = (visiblePage - 1) * defaultAuditRowsPerPage;
    return filteredEntries.slice(startIndex, startIndex + defaultAuditRowsPerPage);
  }, [filteredEntries, visiblePage]);

  useEffect(() => {
    setPage(1);
  }, [normalizedSearch]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (expandedEntryId && !paginatedEntries.some((entry) => entry.id === expandedEntryId)) {
      setExpandedEntryId(null);
    }
  }, [expandedEntryId, paginatedEntries]);

  return (
    <div className="audit-log-stack">
      <div className="audit-log-toolbar">
        <label className="module-search audit-log-search">
          <Search size={18} />
          <input type="search" value={searchValue} onChange={(event) => setSearchValue(event.currentTarget.value)} placeholder={t("audit.search")} />
        </label>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="empty-state">
          <h3>{t("audit.noResults")}</h3>
          <p className="muted">{t("audit.noResultsDescription")}</p>
        </div>
      ) : (
        <>
          <div className="audit-log-list">
            {paginatedEntries.map((entry) => (
              <article key={entry.id} className={`audit-log-card${expandedEntryId === entry.id ? " expanded" : ""}`}>
                <div className="audit-log-head">
                  <button
                    type="button"
                    className="audit-log-toggle"
                    onClick={() => setExpandedEntryId((currentId) => (currentId === entry.id ? null : entry.id))}
                    aria-expanded={expandedEntryId === entry.id}
                  >
                    <span className="audit-log-title-wrap">
                      <span className="audit-log-title">
                        {getAuditTitle(entry.action, t)}
                        <span className="audit-log-actor"> · {entry.actor}</span>
                      </span>
                      <ChevronDown className={`audit-log-chevron${expandedEntryId === entry.id ? " open" : ""}`} size={16} strokeWidth={2.2} />
                    </span>
                  </button>
                  <div className="audit-log-meta">
                    <span className={getAuditBadgeClass(entry.action)}>{entry.action}</span>
                    <span className="audit-log-time">{entry.timestamp}</span>
                  </div>
                </div>
                {expandedEntryId === entry.id ? (
                  <div className="stack-tight audit-log-detail">
                    <p className="muted small-text">{t("audit.author")}{entry.actor}</p>
                    {entry.changes && entry.changes.length > 0 ? (
                      renderAuditChanges(entry.changes, t)
                    ) : (
                      <p className="muted small-text">{entry.summary ?? t("audit.noChanges")}</p>
                    )}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          {filteredEntries.length > defaultAuditRowsPerPage ? (
            <div className="table-pagination audit-log-pagination">
              <p className="table-pagination-summary">
                {t("audit.showing", { shown: `${(visiblePage - 1) * defaultAuditRowsPerPage + 1}-${Math.min(visiblePage * defaultAuditRowsPerPage, filteredEntries.length)}`, total: String(filteredEntries.length) })}
              </p>
              <div className="table-pagination-controls">
                <button type="button" className="table-pagination-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={visiblePage === 1}>
                  <ChevronLeft size={16} />
                </button>
                {paginationItems.map((pageItem, index) => {
                  const previousPage = paginationItems[index - 1];
                  const showGap = previousPage !== undefined && pageItem - previousPage > 1;

                  return (
                    <div key={pageItem} className="table-pagination-group">
                      {showGap ? <span className="table-pagination-gap">...</span> : null}
                      <button
                        type="button"
                        className={`table-pagination-button${pageItem === visiblePage ? " active" : ""}`}
                        onClick={() => setPage(pageItem)}
                      >
                        {pageItem}
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="table-pagination-button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={visiblePage === totalPages}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function getFieldRenderKey(fieldName: string, sheetMode: "create" | "edit", editingRowId?: string) {
  return `${fieldName}-${sheetMode}-${editingRowId ?? "create"}`;
}

function getFieldDefaultValue(row: EntityRow | null, fieldName: string) {
  return row?.formValues?.[fieldName];
}

function fieldLabelClass(required?: boolean) {
  return required ? "field-label field-required" : "field-label";
}

function RangeFieldControl({
  field,
  value,
  fieldError,
}: {
  field: Extract<EntityModuleConfig["fields"][number], { type: "range" }>;
  value?: string | number;
  fieldError?: string;
}) {
  const initialValue = Number(value ?? field.defaultValue ?? field.min ?? 0);
  const [rangeValue, setRangeValue] = useState(Number.isNaN(initialValue) ? 0 : initialValue);

  useEffect(() => {
    const nextValue = Number(value ?? field.defaultValue ?? field.min ?? 0);
    setRangeValue(Number.isNaN(nextValue) ? 0 : nextValue);
  }, [field.defaultValue, field.min, value]);

  return (
    <label className="field">
      <span className={fieldLabelClass(field.required)}>{field.label}</span>
      <input
        type="range"
        name={field.name}
        value={rangeValue}
        onChange={(event) => setRangeValue(Number(event.currentTarget.value))}
        required={field.required}
        min={field.min}
        max={field.max}
        step={field.step}
        className="range-control"
      />
      <span className="range-value">{rangeValue}%</span>
      {field.description ? <span className="field-description">{field.description}</span> : null}
      {fieldError ? <span className="field-error">{fieldError}</span> : null}
    </label>
  );
}

function resizeImage(file: File, maxDim = 512, quality = 0.8): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim) {
        resolve(file);
        return;
      }
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          resolve(new File([blob!], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality,
      );
    };
    img.src = url;
  });
}

function AvatarFieldControl({
  field,
  value,
  recordId,
  fieldError,
}: {
  field: Extract<FormField, { type: "avatar" }>;
  value?: string;
  recordId?: string;
  fieldError?: string;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<string | null>(value ?? null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPreview(value ?? null);
  }, [value]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !recordId) return;

    setUploading(true);
    try {
      const resized = await resizeImage(file);
      const formData = new FormData();
      formData.set("file", resized);
      formData.set("userId", recordId);

      const response = await fetch(field.uploadUrl, { method: "POST", body: formData });
      const result = await response.json();

      if (response.ok && result.avatarUrl) {
        setPreview(result.avatarUrl);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleDelete() {
    if (!recordId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("userId", recordId);
      const response = await fetch("/api/avatars/delete", { method: "POST", body: formData });
      if (response.ok) {
        setPreview(null);
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="field avatar-field">
      <span className={fieldLabelClass(false)}>{field.label}</span>
      <div className="avatar-upload-row">
        <div className="avatar-preview-large">
          {preview ? (
            <img src={preview} alt="" className="avatar-preview-img" />
          ) : (
            <span className="avatar-preview-placeholder">{t("profile.noPhoto")}</span>
          )}
        </div>
        <div className="avatar-upload-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            hidden
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="button secondary"
            disabled={uploading || !recordId}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? t("profile.uploading") : t("profile.uploadPhoto")}
          </button>
          {preview ? (
            <button
              type="button"
              className="button danger"
              disabled={uploading || !recordId}
              onClick={handleDelete}
            >
              <Trash2 size={16} />
              {t("profile.removePhoto")}
            </button>
          ) : null}
        </div>
      </div>
      {!recordId ? <span className="field-description">{t("profile.avatarSaveFirst")}</span> : null}
      {field.description ? <span className="field-description">{field.description}</span> : null}
      {fieldError ? <span className="field-error">{fieldError}</span> : null}
    </div>
  );
}

function ColorFieldControl({
  field,
  value,
  fieldError,
}: {
  field: Extract<EntityModuleConfig["fields"][number], { type: "color" }>;
  value?: string;
  fieldError?: string;
}) {
  const { t } = useI18n();
  const fallbackColor = field.defaultValue ?? "#3e8f97";
  const [hasColor, setHasColor] = useState(Boolean(value) || Boolean(field.defaultValue) || Boolean(field.required));
  const [colorValue, setColorValue] = useState(value ?? field.defaultValue ?? fallbackColor);

  useEffect(() => {
    setHasColor(Boolean(value) || Boolean(field.defaultValue) || Boolean(field.required));
    setColorValue(value ?? field.defaultValue ?? fallbackColor);
  }, [fallbackColor, field.defaultValue, field.required, value]);

  return (
    <label className="field">
      <span className={fieldLabelClass(field.required)}>{field.label}</span>
      <input type="hidden" name={field.name} value={hasColor ? colorValue : ""} />
      <div className="color-picker-row">
        <input
          type="color"
          value={colorValue}
          onChange={(event) => {
            setColorValue(event.currentTarget.value);
            setHasColor(true);
          }}
          className="field-control color-control"
          aria-label={field.label}
        />
        <span className="color-picker-value mono-text">{hasColor ? colorValue : t("entity.useDefaultColor")}</span>
        {!field.required ? (
          <button
            type="button"
            className="button secondary color-picker-toggle"
            onClick={() => {
              if (hasColor) {
                setHasColor(false);
                return;
              }

              setHasColor(true);
              setColorValue(field.defaultValue ?? fallbackColor);
            }}
          >
            {hasColor ? t("entity.clearColor") : t("entity.pickColor")}
          </button>
        ) : null}
      </div>
      {field.description ? <span className="field-description">{field.description}</span> : null}
      {fieldError ? <span className="field-error">{fieldError}</span> : null}
    </label>
  );
}

function getDateFieldInfo(
  formRef: React.RefObject<HTMLFormElement | null>,
  dateFieldName: string,
  holidayDates?: Set<string>,
): { day: number; isHoliday: boolean } | null {
  const input = formRef.current?.elements.namedItem(dateFieldName);
  if (!(input instanceof HTMLInputElement) || !input.value) return null;
  const date = new Date(input.value + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return null;
  return {
    day: date.getUTCDay(),
    isHoliday: holidayDates?.has(input.value) ?? false,
  };
}

function getFormFieldValue(formRef: React.RefObject<HTMLFormElement | null>, fieldName: string): string {
  const field = formRef.current?.elements.namedItem(fieldName);

  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
    return field.value;
  }

  return "";
}

function SelectFieldControl({
  field,
  value,
  fieldError,
  formRef,
  holidayDates,
}: {
  field: Extract<EntityModuleConfig["fields"][number], { type: "select" }>;
  value?: string;
  fieldError?: string;
  formRef?: React.RefObject<HTMLFormElement | null>;
  holidayDates?: Set<string>;
}) {
  const { t } = useI18n();
  const hasDateFilter = Boolean(field.filterByDate) && field.options.some((option) => option.validDays || option.validHoliday);
  const hasFieldFilter = Boolean(field.filterByField) && field.options.some((option) => option.allowedValues);
  const [filteredOptions, setFilteredOptions] = useState(field.options);
  const [noOptionsLabel, setNoOptionsLabel] = useState<string | undefined>();
  const [selectedValue, setSelectedValue] = useState(value ?? field.defaultValue ?? "");

  useEffect(() => {
    if ((!hasDateFilter && !hasFieldFilter) || !formRef?.current) return;

    function handleChange() {
      let nextOptions = field.options;

      if (hasFieldFilter && field.filterByField) {
        const sourceValue = getFormFieldValue(formRef!, field.filterByField);
        if (!sourceValue) {
          setFilteredOptions([]);
          setNoOptionsLabel(t("select.noOptionsSelectUser"));
          return;
        }

        nextOptions = nextOptions.filter((option) => !option.allowedValues || option.allowedValues.length === 0 || option.allowedValues.includes(sourceValue));

        if (nextOptions.length === 0) {
          setFilteredOptions([]);
          setNoOptionsLabel(t("select.noOptionsSelectUser"));
          return;
        }
      }

      if (hasDateFilter && field.filterByDate) {
        const dateInfo = getDateFieldInfo(formRef!, field.filterByDate, holidayDates);
        if (!dateInfo) {
          setFilteredOptions([]);
          setNoOptionsLabel(t("select.noOptionsSelectDate"));
          return;
        }

        nextOptions = nextOptions.filter((option) => {
          if (option.validDays && !option.validDays.includes(dateInfo.day)) {
            return false;
          }

          if (typeof option.validHoliday === "boolean" && option.validHoliday !== dateInfo.isHoliday) {
            return false;
          }

          return true;
        });

        if (nextOptions.length === 0) {
          setFilteredOptions([]);
          setNoOptionsLabel(t("select.noOptionsSelectDay"));
          return;
        }

        setFilteredOptions(nextOptions);
        setNoOptionsLabel(undefined);
        return;
      }

      setFilteredOptions(nextOptions);
      setNoOptionsLabel(undefined);
    }

    const sourceFields = [
      field.filterByDate ? formRef.current.elements.namedItem(field.filterByDate) : null,
      field.filterByField ? formRef.current.elements.namedItem(field.filterByField) : null,
    ].filter((sourceField): sourceField is HTMLInputElement | HTMLSelectElement =>
      sourceField instanceof HTMLInputElement || sourceField instanceof HTMLSelectElement,
    );

    sourceFields.forEach((sourceField) => sourceField.addEventListener("change", handleChange));
    handleChange();

    return () => sourceFields.forEach((sourceField) => sourceField.removeEventListener("change", handleChange));
  }, [field.filterByDate, field.filterByField, field.options, formRef, hasDateFilter, hasFieldFilter, holidayDates, t]);

  useEffect(() => {
    if ((hasDateFilter || hasFieldFilter) && filteredOptions.length > 0 && !filteredOptions.some((option) => option.value === selectedValue)) {
      setSelectedValue(hasFieldFilter ? "" : filteredOptions[0].value);
      return;
    }

    if ((hasFieldFilter || hasDateFilter) && filteredOptions.length === 0 && selectedValue !== "") {
      setSelectedValue("");
    }
  }, [filteredOptions, hasDateFilter, hasFieldFilter, selectedValue]);

  return (
    <label className="field">
      <span className={fieldLabelClass(field.required)}>{field.label}</span>
      <SearchableSelect
        name={field.name}
        options={filteredOptions.map((o) => ({ value: o.value, label: o.label, description: o.description }))}
        value={selectedValue}
        onChange={(nextValue) => setSelectedValue(String(nextValue))}
        required={field.required}
        className="field-control"
        allowEmpty={field.allowEmpty}
        emptyLabel={field.emptyLabel ?? "Vyberte možnosť"}
        noOptionsLabel={noOptionsLabel}
      />
      {field.description ? <span className="field-description">{field.description}</span> : null}
      {fieldError ? <span className="field-error">{fieldError}</span> : null}
    </label>
  );
}

function MultiSelectFieldControl({
  field,
  value,
  fieldError,
}: {
  field: Extract<EntityModuleConfig["fields"][number], { type: "multiselect" }>;
  value?: string[];
  fieldError?: string;
}) {
  const initialSelectedValues = Array.isArray(value) ? value : Array.isArray(field.defaultValue) ? field.defaultValue : [];
  const selectedKey = initialSelectedValues.join("\u0000");
  const [selectedValues, setSelectedValues] = useState<string[]>(initialSelectedValues);

  useEffect(() => {
    setSelectedValues(initialSelectedValues);
  }, [selectedKey]);

  if (field.variant !== "checkbox-list") {
    return (
      <label className="field">
        <span className={fieldLabelClass(field.required)}>{field.label}</span>
        <SearchableSelect
          name={field.name}
          options={field.options.map((o) => ({ value: o.value, label: o.label, description: o.description }))}
          defaultValue={initialSelectedValues}
          multiple
          required={field.required}
          className="field-control multiselect-control"
        />
        {field.description ? <span className="field-description">{field.description}</span> : null}
        {fieldError ? <span className="field-error">{fieldError}</span> : null}
      </label>
    );
  }

  return (
    <div className="field">
      <span className={fieldLabelClass(field.required)}>{field.label}</span>
      <div className="checkbox-list" role="group" aria-label={field.label}>
        {field.options.map((option) => {
          const isSelected = selectedValues.includes(option.value);

          return (
            <label
              key={option.value}
              className={`checkbox-list-item${isSelected ? " selected" : ""}`}
              style={getFieldOptionStyle(option)}
            >
              <input
                type="checkbox"
                name={field.name}
                value={option.value}
                checked={isSelected}
                onChange={(event) => {
                  const nextChecked = event.currentTarget.checked;

                  setSelectedValues((current) => {
                    if (nextChecked) {
                      return current.includes(option.value) ? current : [...current, option.value];
                    }

                    return current.filter((currentValue) => currentValue !== option.value);
                  });
                }}
                className="checkbox-control checkbox-list-control"
              />
              <span className="checkbox-list-copy">
                <span className="checkbox-list-title">{option.label}</span>
                {option.description ? <span className="checkbox-list-description">{option.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {field.description ? <span className="field-description">{field.description}</span> : null}
      {fieldError ? <span className="field-error">{fieldError}</span> : null}
    </div>
  );
}

type TriStateValue = "grant" | "deny" | "unset";

function parseTriStateInitialValues(values: string[]): Map<string, TriStateValue> {
  const map = new Map<string, TriStateValue>();
  for (const value of values) {
    if (value.startsWith("!")) {
      map.set(value.slice(1), "deny");
    } else {
      map.set(value, "grant");
    }
  }
  return map;
}

function cycleTriState(current: TriStateValue): TriStateValue {
  if (current === "unset") return "grant";
  if (current === "grant") return "deny";
  return "unset";
}

function PermissionMatrixFieldControl({
  field,
  value,
  fieldError,
}: {
  field: Extract<EntityModuleConfig["fields"][number], { type: "permission-matrix" }>;
  value?: string[];
  fieldError?: string;
}) {
  const { t } = useI18n();
  const initialSelectedValues = Array.isArray(value) ? value : Array.isArray(field.defaultValue) ? field.defaultValue : [];
  const selectedKey = initialSelectedValues.join("\u0000");

  // Binary mode state
  const [selectedValues, setSelectedValues] = useState<string[]>(initialSelectedValues);

  // Tri-state mode state
  const [triStateValues, setTriStateValues] = useState<Map<string, TriStateValue>>(() =>
    field.triState ? parseTriStateInitialValues(initialSelectedValues) : new Map(),
  );

  const permissionColumns = useMemo(
    () => [
      { id: "view", action: "view", label: t("perm.view") },
      { id: "create", action: "create", label: t("perm.add") },
      { id: "edit", action: "edit", label: t("perm.edit") },
      { id: "delete", action: "delete", label: t("perm.delete") },
      { id: "lock", action: "lock", label: t("perm.lock") },
      { id: "import", action: "importExport", label: t("perm.import") },
      { id: "export", action: "importExport", label: t("perm.export") },
      { id: "generate", action: "generate", label: t("perm.generate") },
    ],
    [t],
  );

  useEffect(() => {
    if (field.triState) {
      setTriStateValues(parseTriStateInitialValues(initialSelectedValues));
    } else {
      setSelectedValues(initialSelectedValues);
    }
  }, [selectedKey, field.triState]);

  return (
    <div className="field permission-matrix-field">
      <span className={fieldLabelClass(field.required)}>{field.label}</span>
      {field.description ? <span className="field-description">{field.description}</span> : null}
      {!field.readOnly ? <input type="hidden" name={`__field_present__${field.name}`} value="1" /> : null}
      {field.triState && !field.readOnly
        ? Array.from(triStateValues.entries()).map(([code, state]) =>
            state === "grant" ? (
              <input key={code} type="hidden" name={field.name} value={code} />
            ) : state === "deny" ? (
              <input key={code} type="hidden" name={`${field.name}__denied`} value={code} />
            ) : null,
          )
        : null}
      <div className="permission-matrix-table-shell">
        <table className="permission-matrix-table">
          <thead>
            <tr>
              <th scope="col" className="permission-matrix-section-heading">
                {t("perm.section")}
              </th>
              {permissionColumns.map((column) => (
                <th key={column.id} scope="col" className="permission-matrix-column-heading">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {field.sections.map((section) => (
              <tr key={section.key}>
                <th scope="row" className="permission-matrix-section-cell">
                  {section.label}
                </th>
                {permissionColumns.map((column) => {
                  const permission = section.permissions.find((item) => (item.code.split(":").at(-1) ?? item.code) === column.action);

                  if (!permission) {
                    return (
                      <td key={`${section.key}-${column.id}`} className="permission-matrix-cell empty">
                        <span className="permission-matrix-empty">-</span>
                      </td>
                    );
                  }

                  if (field.triState) {
                    const state = triStateValues.get(permission.code) ?? "unset";
                    const cellClass = state === "grant" ? "checked" : state === "deny" ? "unchecked" : "unset";

                    return (
                      <td
                        key={`${permission.code}-${column.id}`}
                        className={`permission-matrix-cell ${cellClass}${field.readOnly ? " readonly" : ""}`}
                        title={permission.description ?? `${section.label}: ${permission.label}`}
                      >
                        <button
                          type="button"
                          disabled={field.readOnly}
                          onClick={() => {
                            if (field.readOnly) return;
                            setTriStateValues((current) => {
                              const next = new Map(current);
                              const currentState = next.get(permission.code) ?? "unset";
                              const nextState = cycleTriState(currentState);
                              if (nextState === "unset") {
                                next.delete(permission.code);
                              } else {
                                next.set(permission.code, nextState);
                              }
                              return next;
                            });
                          }}
                          className="permission-matrix-tristate-btn"
                          aria-label={`${section.label}: ${permission.label} (${state})`}
                        >
                          {state === "grant" ? "✓" : state === "deny" ? "✕" : "–"}
                        </button>
                      </td>
                    );
                  }

                  const isSelected = selectedValues.includes(permission.code);

                  return (
                    <td
                      key={`${permission.code}-${column.id}`}
                      className={`permission-matrix-cell${isSelected ? " checked" : " unchecked"}${field.readOnly ? " readonly" : ""}`}
                      title={permission.description ?? `${section.label}: ${permission.label}`}
                    >
                      <input
                        type="checkbox"
                        name={field.readOnly ? undefined : field.name}
                        value={permission.code}
                        checked={isSelected}
                        disabled={field.readOnly}
                        onChange={(event) => {
                          if (field.readOnly) {
                            return;
                          }

                          const nextChecked = event.currentTarget.checked;

                          setSelectedValues((current) => {
                            if (nextChecked) {
                              return current.includes(permission.code) ? current : [...current, permission.code];
                            }

                            return current.filter((currentValue) => currentValue !== permission.code);
                          });
                        }}
                        className="checkbox-control permission-matrix-checkbox"
                        aria-label={`${section.label}: ${permission.label}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fieldError ? <span className="field-error">{fieldError}</span> : null}
    </div>
  );
}

function escapeCsvValue(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function serializeFormSnapshot(form: HTMLFormElement) {
  const entries = Array.from(new FormData(form).entries())
    .map(([key, value]) => [key, typeof value === "string" ? value : value.name] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }

      return leftKey.localeCompare(rightKey);
    });

  return JSON.stringify(entries);
}

function serializeCsvValue(value: string | number | boolean | string[] | undefined) {
  if (value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.join(";");
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function buildPaginationItems(currentPage: number, totalPages: number) {
  const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);

  return Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
}

function MonthSwitcher({
  month,
  onMonthChange,
}: {
  month: string;
  onMonthChange: (value: string) => void;
}) {
  const { t } = useI18n();
  if (!month) {
    return null;
  }

  return (
    <div className="calendar-month-switcher">
      <button
        type="button"
        className="icon-button"
        onClick={() => onMonthChange(addMonths(month, -1))}
        aria-label={t("entity.prevMonth")}
      >
        <ChevronLeft size={18} />
      </button>
      <div className="calendar-month-label">
        <span>{formatMonthLabel(month)}</span>
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={() => onMonthChange(addMonths(month, 1))}
        aria-label={t("entity.nextMonth")}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function CalendarPanel({
  calendar,
  items,
  month,
  onMonthChange,
  searchControl,
  actionsControl,
  onDaySelect,
  onItemLockToggle,
  onItemContextMenu,
  onItemDrop,
}: {
  calendar: CalendarConfig;
  items: CalendarItem[];
  month: string;
  onMonthChange: (value: string) => void;
  searchControl?: ReactNode;
  actionsControl?: ReactNode;
  onDaySelect?: (date: string) => void;
  onItemLockToggle?: (recordId: string) => void;
  onItemContextMenu?: (recordId: string, clientX: number, clientY: number) => void;
  onItemDrop?: (recordId: string, targetDate: string) => void;
}) {
  const { t, locale } = useI18n();
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const activeMonth = month || calendar.initialMonth;
  const holidays = useMemo(
    () => new Map((calendar.holidays ?? []).map((h) => [h.date, h])),
    [calendar.holidays],
  );
  const monthItems = useMemo(() => {
    const grouped = new Map<string, CalendarItem[]>();

    items
      .filter((item) => item.date.startsWith(activeMonth))
      .sort((left, right) => {
        const dateComp = left.date.localeCompare(right.date);
        if (dateComp !== 0) return dateComp;
        const orderComp = (left.sortOrder ?? 5) - (right.sortOrder ?? 5);
        if (orderComp !== 0) return orderComp;
        return (left.timeLabel ?? "").localeCompare(right.timeLabel ?? "");
      })      .forEach((item) => {
        const existing = grouped.get(item.date) ?? [];
        existing.push(item);
        grouped.set(item.date, existing);
      });

    return grouped;
  }, [activeMonth, items]);

  const days = useMemo(() => buildCalendarDays(activeMonth), [activeMonth]);
  const weekdays = days.slice(0, 7).map((day) => formatWeekdayLabel(day.date));

  return (
    <div className="calendar-panel stack-tight">
      <div className="calendar-toolbar">
        <MonthSwitcher month={activeMonth} onMonthChange={onMonthChange} />

        {searchControl ? <div className="calendar-toolbar-search">{searchControl}</div> : null}
        {actionsControl ? <div className="calendar-toolbar-actions">{actionsControl}</div> : null}
      </div>

      <div className="calendar-grid-shell">
        <div className="calendar-grid">
          {weekdays.map((weekday) => (
            <div key={weekday} className="calendar-weekday">
              {weekday}
            </div>
          ))}

          {days.map((day) => {
            const dayItems = monthItems.get(day.key) ?? [];
            const holidayEntry = holidays.get(day.key);
            const isHoliday = holidayEntry !== undefined;
            const holidayName = isHoliday
              ? ((locale === "sk" ? holidayEntry.localName : undefined) ?? holidayEntry.name)
              : undefined;
            const isDragOver = dragOverDate === day.key;

            return (
              <article
                key={day.key}
                className={`calendar-day${day.inMonth ? "" : " calendar-day-outside"}${isHoliday ? " calendar-day-holiday" : ""}${onDaySelect ? " calendar-day-actionable" : ""}${isDragOver ? " calendar-day-drag-over" : ""}`}
                onClick={() => onDaySelect?.(day.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onDaySelect?.(day.key);
                  }
                }}
                onDragOver={onItemDrop ? (event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverDate(day.key);
                } : undefined}
                onDragLeave={onItemDrop ? () => {
                  setDragOverDate((current) => current === day.key ? null : current);
                } : undefined}
                onDrop={onItemDrop ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const recordId = event.dataTransfer.getData("text/x-record-id");
                  const sourceDate = event.dataTransfer.getData("text/x-source-date");
                  setDragOverDate(null);
                  setDraggingItemId(null);

                  if (recordId && sourceDate !== day.key) {
                    onItemDrop(recordId, day.key);
                  }
                } : undefined}
                role={onDaySelect ? "button" : undefined}
                tabIndex={onDaySelect ? 0 : undefined}
              >
                <div
                  className={`calendar-day-head${isHoliday ? " calendar-day-head-holiday" : ""}`}
                  title={holidayName}
                >
                  <span className={`calendar-day-number${day.isToday ? " calendar-day-number-today" : ""}`}>{day.date.getUTCDate()}</span>
                  <span className="calendar-day-weekday">{formatWeekdayLabel(day.date)}</span>
                </div>

                <div className="calendar-day-items">
                  {dayItems.map((item) => (
                    <article
                      key={item.id}
                      className={`calendar-entry-card${draggingItemId === (item.recordId ?? item.id) ? " calendar-entry-card-dragging" : ""}`}
                      draggable={onItemDrop && !item.locked ? true : undefined}
                      onDragStart={onItemDrop ? (event) => {
                        const recordId = item.recordId ?? item.id;
                        event.dataTransfer.setData("text/x-record-id", recordId);
                        event.dataTransfer.setData("text/x-source-date", item.date);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingItemId(recordId);
                      } : undefined}
                      onDragEnd={onItemDrop ? () => {
                        setDraggingItemId(null);
                        setDragOverDate(null);
                      } : undefined}
                      onContextMenu={(event) => {
                        if (!onItemContextMenu) {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        onItemContextMenu(item.recordId ?? item.id, event.clientX, event.clientY);
                      }}
                      style={{
                        "--strip-color": item.stripColor ?? item.accentColor ?? item.backgroundColor ?? "#a9c8bf",
                        background: item.backgroundColor ?? "#d6ecd7",
                        color: item.textColor ?? "#17353c",
                        borderColor: item.accentColor ?? item.backgroundColor ?? "#a9c8bf",
                      } as React.CSSProperties}
                    >
                      {onItemContextMenu ? (
                        <button
                          type="button"
                          className="calendar-entry-menu"
                          aria-label={t("entity.options")}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            onItemContextMenu(item.recordId ?? item.id, rect.left, rect.bottom + 4);
                          }}
                        >
                          <MoreVertical size={14} />
                        </button>
                      ) : null}
                      <strong>{item.title}</strong>
                      {item.subtitle ? <span>{item.subtitle}</span> : null}
                      {item.timeLabel ? <small>{item.timeLabel}</small> : null}
                      {onItemLockToggle ? (
                        <button
                          type="button"
                          className={`calendar-entry-lock ${item.locked ? "locked" : "unlocked"}`}
                          aria-label={item.locked ? t("entity.unlockRecord") : t("entity.lockRecord")}
                          title={item.locked ? t("entity.unlockRecord") : t("entity.lockRecord")}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onItemLockToggle(item.recordId ?? item.id);
                          }}
                        >
                          {item.locked ? <Lock size={18} /> : <LockOpen size={18} />}
                        </button>
                      ) : item.locked ? (
                        <span className="calendar-entry-lock-static">
                          <Lock size={18} />
                        </span>
                      ) : null}
                    </article>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EntityModule({
  title,
  summary,
  moduleKey,
  initialHiddenColumns,
  csvFileName,
  csvFieldNames,
  stats,
  statGroups,
  columns,
  rows,
  emptyMessage,
  addLabel,
  sheetTitle,
  sheetDescription,
  submitLabel,
  editSheetTitle,
  editSheetDescription,
  editSubmitLabel,
  fields,
  sheetTabs,
  action,
  editAction,
  deleteAction,
  importAction,
  toggleLockAction,
  bulkLockAction,
  bulkDeleteAction,
  moveAction,
  canCreate = true,
  canEdit: canEditProp,
  canDelete: canDeleteProp,
  canImport: canImportProp,
  canExport = true,
  canToggleLock: canToggleLockProp,
  createDisabledReason,
  importDisabledReason,
  searchPlaceholder,
  views,
  defaultView,
  calendar,
  monthScopeEnabled,
  initialPageSize,
  headerActions,
  primaryAction,
  preSurfaceContent,
  hideHeader = false,
}: EntityModuleProps) {
  const router = useRouter();
  const { notify } = useBrowserNotifications();
  const { t, locale } = useI18n();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<EntityRow | null>(null);
  const [menuRowId, setMenuRowId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<RowMenuPosition | null>(null);
  const [calendarMenuState, setCalendarMenuState] = useState<ContextMenuState | null>(null);
  const [deletePromptState, setDeletePromptState] = useState<DeletePromptState | null>(null);
  const [auditRow, setAuditRow] = useState<EntityRow | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [createPrefillValues, setCreatePrefillValues] = useState<Record<string, FormValue>>({});
  const [activeSheetTabId, setActiveSheetTabId] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(initialPageSize && pageSizeOptions.includes(initialPageSize) ? initialPageSize : defaultRowsPerPage);
  const [tableSort, setTableSort] = useState<TableSortState | null>(null);
  const [statsSort, setStatsSort] = useState<Map<string, TableSortState>>(new Map());
  const [isSheetDirty, setIsSheetDirty] = useState(false);
  const [isUnsavedChangesDialogOpen, setIsUnsavedChangesDialogOpen] = useState(false);
  const [lockOverrides, setLockOverrides] = useState<Record<string, boolean>>({});
  const [deletedRowIds, setDeletedRowIds] = useState<Set<string>>(new Set());
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(initialHiddenColumns ?? []));
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const visibleColumns = useMemo(() => columns.filter((col) => !hiddenColumns.has(col.key)), [columns, hiddenColumns]);
  const [createState, createFormAction] = useActionState(action, initialActionState);
  const [editState, editFormAction] = useActionState(editAction ?? action, initialActionState);
  const [deleteState, deleteFormAction] = useActionState(deleteAction ?? action, initialActionState);
  const [importState, importFormAction] = useActionState(importAction ?? action, initialActionState);
  const [toggleLockState, toggleLockFormAction] = useActionState(toggleLockAction ?? action, initialActionState);
  const [bulkLockState, bulkLockFormAction] = useActionState(bulkLockAction ?? action, initialActionState);
  const [bulkDeleteState, bulkDeleteFormAction] = useActionState(bulkDeleteAction ?? action, initialActionState);
  const menuHostRef = useRef<HTMLDivElement | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  const calendarMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sheetFormRef = useRef<HTMLFormElement | null>(null);
  const pendingDeleteIdRef = useRef<string | null>(null);
  const initialSheetSnapshotRef = useRef("");
  const lockTogglePendingRef = useRef(false);
  const handledActionStatesRef = useRef({
    create: createState,
    createError: createState,
    edit: editState,
    delete: deleteState,
    deleteError: deleteState,
    import: importState,
    importError: importState,
    toggleLock: toggleLockState,
    toggleLockError: toggleLockState,
    bulkLock: bulkLockState,
    bulkLockError: bulkLockState,
    bulkDelete: bulkDeleteState,
    bulkDeleteError: bulkDeleteState,
  });
  const hasAuditMenu = rows.some((row) => row.auditEntries !== undefined);
  const canEdit = (canEditProp ?? Boolean(editAction)) && Boolean(editAction);
  const canDelete = (canDeleteProp ?? Boolean(deleteAction)) && Boolean(deleteAction);
  const isOverlayOpen = isSheetOpen || auditRow !== null || isUnsavedChangesDialogOpen || deletePromptState !== null;
  const deferredSearchValue = useDeferredValue(searchValue);
  const normalizedSearch = normalizeSearchValue(deferredSearchValue);
  const availableViews = useMemo<ModuleView[]>(() => {
    if (views && views.length > 0) {
      return views;
    }

    return calendar ? ["calendar", "table"] : ["table"];
  }, [calendar, views]);
  const [activeView, setActiveView] = useState<ModuleView>(defaultView ?? availableViews[0] ?? "table");
  const [selectedMonth, setSelectedMonth] = useState(calendar?.initialMonth ?? "");
  const allSheetFields = useMemo(
    () =>
      sheetTabs && sheetTabs.length > 0
        ? sheetTabs.flatMap((tab) => tab.fields)
        : fields,
    [fields, sheetTabs],
  );
  const fieldNameSet = useMemo(() => new Set(allSheetFields.map((field) => field.name)), [allSheetFields]);
  const holidayDates = useMemo(() => new Set((calendar?.holidays ?? []).map((holiday) => holiday.date)), [calendar?.holidays]);
  const hasLockedValues = useMemo(
    () => rows.some((row) => Object.prototype.hasOwnProperty.call(row.formValues, "locked")),
    [rows],
  );
  const hasSourceValues = useMemo(
    () => rows.some((row) => Object.prototype.hasOwnProperty.call(row.formValues, "source")),
    [rows],
  );
  const canToggleLock = (canToggleLockProp ?? Boolean(toggleLockAction)) && Boolean(toggleLockAction) && hasLockedValues;
  const canImport = (canImportProp ?? Boolean(importAction)) && Boolean(importAction);
  const hasActionDropdown = canImport || canExport || Boolean(bulkDeleteAction);
  const canBulkLock = Boolean(bulkLockAction) && canToggleLock;
  const canBulkDelete = Boolean(bulkDeleteAction) && canDelete;
  const hasContextMenu = canDelete || hasAuditMenu;
  const hasRowActions = canEdit || hasContextMenu;
  const activeSheetTabs = useMemo<SheetTab[]>(() => {
    const configuredTabs =
      sheetTabs && sheetTabs.length > 0
        ? sheetTabs
        : [
            {
              id: "main",
              label: t("entity.details"),
              fields,
              visibleIn: "both" as const,
            },
          ];

    return configuredTabs.filter((tab) => (tab.visibleIn ?? "both") === "both" || (tab.visibleIn ?? "both") === sheetMode);
  }, [fields, sheetMode, sheetTabs]);

  useEffect(() => {
    setActiveView(defaultView ?? availableViews[0] ?? "table");
  }, [availableViews, defaultView]);

  useEffect(() => {
    setSelectedMonth(calendar?.initialMonth ?? "");
  }, [calendar?.initialMonth]);

  useEffect(() => {
    if (!isOverlayOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOverlayOpen]);

  useEffect(() => {
    if (!isSheetOpen || !sheetFormRef.current) {
      initialSheetSnapshotRef.current = "";
      setIsSheetDirty(false);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (!sheetFormRef.current) {
        return;
      }

      initialSheetSnapshotRef.current = serializeFormSnapshot(sheetFormRef.current);
      setIsSheetDirty(false);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [createPrefillValues, editingRow, isSheetOpen, sheetMode]);

  useEffect(() => {
    const firstTabId = activeSheetTabs[0]?.id ?? null;

    setActiveSheetTabId((currentTabId) => {
      if (!firstTabId) {
        return null;
      }

      return currentTabId && activeSheetTabs.some((tab) => tab.id === currentTabId) ? currentTabId : firstTabId;
    });
  }, [activeSheetTabs, editingRow?.id, isSheetOpen, sheetMode]);

  useEffect(() => {
    const hasNewCreateSuccess = createState.status === "success" && handledActionStatesRef.current.create !== createState;
    const hasNewEditSuccess = editState.status === "success" && handledActionStatesRef.current.edit !== editState;
    const hasNewDeleteSuccess = deleteState.status === "success" && handledActionStatesRef.current.delete !== deleteState;
    const hasNewImportSuccess = importState.status === "success" && handledActionStatesRef.current.import !== importState;
    const hasNewToggleSuccess = toggleLockState.status === "success" && handledActionStatesRef.current.toggleLock !== toggleLockState;
    const hasNewBulkLockSuccess = bulkLockState.status === "success" && handledActionStatesRef.current.bulkLock !== bulkLockState;
    const hasNewBulkDeleteSuccess = bulkDeleteState.status === "success" && handledActionStatesRef.current.bulkDelete !== bulkDeleteState;
    const nextSuccessMessage =
      (hasNewCreateSuccess ? createState.message : undefined) ??
      (hasNewEditSuccess ? editState.message : undefined) ??
      (hasNewDeleteSuccess ? deleteState.message : undefined) ??
      (hasNewImportSuccess ? importState.message : undefined) ??
      (hasNewToggleSuccess ? toggleLockState.message : undefined) ??
      (hasNewBulkLockSuccess ? bulkLockState.message : undefined) ??
      (hasNewBulkDeleteSuccess ? bulkDeleteState.message : undefined);
    const hasNewSuccess = hasNewCreateSuccess || hasNewEditSuccess || hasNewDeleteSuccess || hasNewImportSuccess || hasNewToggleSuccess || hasNewBulkLockSuccess || hasNewBulkDeleteSuccess;

    if (hasNewSuccess) {
      if (nextSuccessMessage) {
        notify({
          tone: "success",
          message: nextSuccessMessage,
        });
      }

      if (hasNewDeleteSuccess && pendingDeleteIdRef.current) {
        setDeletedRowIds((prev) => {
          const next = new Set(prev);
          next.add(pendingDeleteIdRef.current!);
          return next;
        });
        pendingDeleteIdRef.current = null;
      }

      setIsSheetOpen(false);
      setSheetMode("create");
      setEditingRow(null);
      setCreatePrefillValues({});
      setIsSheetDirty(false);
      setIsUnsavedChangesDialogOpen(false);
      if (!hasNewToggleSuccess && !hasNewBulkLockSuccess) {
        setLockOverrides({});
      }
      if (hasNewBulkDeleteSuccess) {
        setSelectedRowIds(new Set());
      }
      initialSheetSnapshotRef.current = "";
      setMenuRowId(null);
      setActionMenuOpen(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
      startTransition(() => {
        router.refresh();
      });
    }

    handledActionStatesRef.current.create = createState;
    handledActionStatesRef.current.edit = editState;
    handledActionStatesRef.current.delete = deleteState;
    handledActionStatesRef.current.import = importState;
    handledActionStatesRef.current.toggleLock = toggleLockState;
    handledActionStatesRef.current.bulkLock = bulkLockState;
    handledActionStatesRef.current.bulkDelete = bulkDeleteState;
  }, [
    bulkDeleteState,
    bulkLockState,
    createState,
    deleteState,
    editState,
    importState,
    notify,
    router,
    toggleLockState,
  ]);

  useEffect(() => {
    const hasNewCreateError = createState.status === "error" && handledActionStatesRef.current.createError !== createState;

    if (hasNewCreateError && createState.message) {
      notify({
        tone: "error",
        message: createState.message,
      });
    }

    handledActionStatesRef.current.createError = createState;
  }, [createState, notify]);

  useEffect(() => {
    const hasNewDeleteError = deleteState.status === "error" && handledActionStatesRef.current.deleteError !== deleteState;

    if (hasNewDeleteError && deleteState.message) {
      notify({
        tone: "error",
        message: deleteState.message,
      });
    }

    handledActionStatesRef.current.deleteError = deleteState;
  }, [deleteState, notify]);

  useEffect(() => {
    const hasNewImportError = importState.status === "error" && handledActionStatesRef.current.importError !== importState;

    if (hasNewImportError && importState.message) {
      notify({
        tone: "error",
        message: importState.message,
      });
    }

    handledActionStatesRef.current.importError = importState;
  }, [importState, notify]);

  useEffect(() => {
    const hasNewToggleLockError = toggleLockState.status === "error" && handledActionStatesRef.current.toggleLockError !== toggleLockState;

    if (hasNewToggleLockError && toggleLockState.message) {
      setLockOverrides({});
      notify({
        tone: "error",
        message: toggleLockState.message,
      });
    }

    handledActionStatesRef.current.toggleLockError = toggleLockState;
  }, [notify, toggleLockState]);

  useEffect(() => {
    const hasNewBulkLockError = bulkLockState.status === "error" && handledActionStatesRef.current.bulkLockError !== bulkLockState;

    if (hasNewBulkLockError && bulkLockState.message) {
      notify({
        tone: "error",
        message: bulkLockState.message,
      });
    }

    handledActionStatesRef.current.bulkLockError = bulkLockState;
  }, [bulkLockState, notify]);

  useEffect(() => {
    const hasNewBulkDeleteError = bulkDeleteState.status === "error" && handledActionStatesRef.current.bulkDeleteError !== bulkDeleteState;

    if (hasNewBulkDeleteError && bulkDeleteState.message) {
      notify({
        tone: "error",
        message: bulkDeleteState.message,
      });
    }

    handledActionStatesRef.current.bulkDeleteError = bulkDeleteState;
  }, [bulkDeleteState, notify]);

  useEffect(() => {
    if (lockTogglePendingRef.current) {
      lockTogglePendingRef.current = false;
      return;
    }

    setLockOverrides((current) => {
      const overrideEntries = Object.entries(current);

      if (overrideEntries.length === 0) {
        return current;
      }

      const nextOverrides: Record<string, boolean> = {};

      for (const [recordId, overriddenLocked] of overrideEntries) {
        const row = rows.find((item) => item.id === recordId);
        const calendarItem = (calendar?.items ?? []).find((item) => (item.recordId ?? item.id) === recordId);
        const resolvedLocked =
          typeof row?.formValues?.locked === "boolean"
            ? row.formValues.locked
            : typeof calendarItem?.locked === "boolean"
              ? calendarItem.locked
              : undefined;

        if (resolvedLocked !== overriddenLocked) {
          nextOverrides[recordId] = overriddenLocked;
        }
      }

      const nextKeys = Object.keys(nextOverrides);
      const currentKeys = Object.keys(current);

      if (nextKeys.length === currentKeys.length && nextKeys.every((key) => current[key] === nextOverrides[key])) {
        return current;
      }

      return nextOverrides;
    });
  }, [calendar?.items, rows]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isUnsavedChangesDialogOpen) {
          event.preventDefault();
          setIsUnsavedChangesDialogOpen(false);
          return;
        }

        if (deletePromptState) {
          event.preventDefault();
          setDeletePromptState(null);
          return;
        }

        if (isSheetOpen) {
          event.preventDefault();
          requestSheetClose();
          return;
        }
        setAuditRow(null);
        closeAllMenus();
        setActionMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [deletePromptState, isSheetDirty, isSheetOpen, isUnsavedChangesDialogOpen]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (menuRowId && !menuHostRef.current?.contains(target) && !rowMenuRef.current?.contains(target)) {
        setMenuRowId(null);
        setMenuPosition(null);
      }

      if (calendarMenuState && !calendarMenuRef.current?.contains(target)) {
        setCalendarMenuState(null);
      }

      if (actionMenuOpen && !actionMenuRef.current?.contains(target)) {
        setActionMenuOpen(false);
      }

      if (columnMenuOpen && !columnMenuRef.current?.contains(target)) {
        setColumnMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [actionMenuOpen, calendarMenuState, columnMenuOpen, menuRowId]);

  useEffect(() => {
    if (deletedRowIds.size > 0) {
      setDeletedRowIds(new Set());
    }
  }, [rows]);

  useEffect(() => {
    if (!menuRowId) {
      return;
    }

    const closeRowMenu = () => {
      setMenuRowId(null);
      setMenuPosition(null);
    };

    window.addEventListener("resize", closeRowMenu);
    window.addEventListener("scroll", closeRowMenu, true);

    return () => {
      window.removeEventListener("resize", closeRowMenu);
      window.removeEventListener("scroll", closeRowMenu, true);
    };
  }, [menuRowId]);

  const displayRows = useMemo(
    () =>
      rows
        .filter((row) => !deletedRowIds.has(row.id))
        .map((row) => {
        const overriddenLocked = lockOverrides[row.id];

        if (overriddenLocked === undefined) {
          return row;
        }

        const nextCells = { ...row.cells };
        if (Object.prototype.hasOwnProperty.call(nextCells, "locked")) {
          nextCells.locked = {
            text: overriddenLocked ? t("entity.locked") : t("entity.unlocked"),
            tone: overriddenLocked ? "success" : "neutral",
          };
        }

        return {
          ...row,
          cells: nextCells,
          formValues: {
            ...row.formValues,
            locked: overriddenLocked,
          },
        };
      }),
    [deletedRowIds, lockOverrides, rows],
  );
  const displayCalendarItems = useMemo(
    () =>
      (calendar?.items ?? []).map((item) => {
        const itemKey = item.recordId ?? item.id;
        const overriddenLocked = lockOverrides[itemKey];

        return overriddenLocked === undefined ? item : { ...item, locked: overriddenLocked };
      }),
    [calendar?.items, lockOverrides],
  );
  const hasMonthScope = Boolean(calendar && monthScopeEnabled && selectedMonth);
  const monthScopedRows = useMemo(() => {
    if (!hasMonthScope) {
      return displayRows;
    }

    return displayRows.filter((row) => rowMatchesMonth(row, selectedMonth));
  }, [displayRows, hasMonthScope, selectedMonth]);
  const filteredRows = useMemo(() => monthScopedRows.filter((row) => rowMatchesSearch(row, normalizedSearch)), [monthScopedRows, normalizedSearch]);
  const sortedRows = useMemo(() => {
    if (!tableSort) {
      return filteredRows;
    }

    const directionFactor = tableSort.direction === "asc" ? 1 : -1;

    return filteredRows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftValue = getRowSortValue(left.row, tableSort.columnKey);
        const rightValue = getRowSortValue(right.row, tableSort.columnKey);

        if (typeof leftValue === "number" && typeof rightValue === "number") {
          if (leftValue < rightValue) {
            return -1 * directionFactor;
          }

          if (leftValue > rightValue) {
            return 1 * directionFactor;
          }

          return left.index - right.index;
        }

        const compared = String(leftValue).localeCompare(String(rightValue), locale, {
          numeric: true,
          sensitivity: "base",
        });

        if (compared !== 0) {
          return compared * directionFactor;
        }

        return left.index - right.index;
      })
      .map(({ row }) => row);
  }, [filteredRows, tableSort]);
  const filteredCalendarItems = useMemo(
    () => displayCalendarItems.filter((item) => calendarItemMatchesSearch(item, normalizedSearch)),
    [displayCalendarItems, normalizedSearch],
  );
  const rowsById = useMemo(() => new Map(displayRows.map((row) => [row.id, row] as const)), [displayRows]);
  const displayStats = useMemo(() => {
    if (!hasMonthScope) {
      return stats;
    }

    if (!hasLockedValues || !hasSourceValues || stats.length < 3) {
      return stats;
    }

    const lockedCount = monthScopedRows.filter((row) => getFieldDefaultValue(row, "locked") === true).length;
    const manualCount = monthScopedRows.filter((row) => String(getFieldDefaultValue(row, "source") ?? "").toUpperCase() === "MANUAL").length;

    return stats.map((stat, index) => {
      if (index === 0) {
        return { ...stat, value: String(monthScopedRows.length) };
      }

      if (index === 1) {
        return { ...stat, value: String(lockedCount) };
      }

      if (index === 2) {
        return { ...stat, value: String(manualCount) };
      }

      return stat;
    });
  }, [hasLockedValues, hasMonthScope, hasSourceValues, monthScopedRows, stats]);
  const displayStatGroups = useMemo(() => {
    if (!statGroups || statGroups.length === 0) {
      return statGroups ?? [];
    }

    if (!hasMonthScope) {
      return statGroups;
    }

    // Recalculate stat groups based on month-scoped rows
    return statGroups.map((group) => {
      if (!group.groupByField && !group.breakdownField) {
        return group;
      }

      // Build counts from monthScopedRows
      if (group.groupByField) {
        // Per-user x shift-type breakdown (e.g. groupByField="userId", breakdownField="shift")
        const labelByGroupValue = new Map<string, string>();
        const countsByGroup = new Map<string, Map<string, number>>();

        for (const row of monthScopedRows) {
          const groupValue = String(getFieldDefaultValue(row, group.groupByField) ?? "");
          const breakdownValue = group.breakdownField ? getCellText(row.cells[group.breakdownField] ?? "") : "";

          if (!labelByGroupValue.has(groupValue)) {
            const userCell = row.cells["user"];
            labelByGroupValue.set(groupValue, userCell ? getCellText(userCell) : groupValue);
          }

          if (!countsByGroup.has(groupValue)) {
            countsByGroup.set(groupValue, new Map());
          }
          const shiftMap = countsByGroup.get(groupValue)!;
          shiftMap.set(breakdownValue, (shiftMap.get(breakdownValue) ?? 0) + 1);
        }

        const totalColLabel = group.columns[group.columns.length - 1];
        const breakdownCols = group.columns.slice(0, -1);

        const rows = Array.from(countsByGroup.entries())
          .map(([groupValue, shiftMap]) => {
            const values: Record<string, string> = {};
            let total = 0;
            for (const col of breakdownCols) {
              const count = shiftMap.get(col) ?? 0;
              values[col] = String(count);
              total += count;
            }
            values[totalColLabel] = String(total);
            return { label: labelByGroupValue.get(groupValue) ?? groupValue, values };
          })
          .sort((a, b) => a.label.localeCompare(b.label, "sk"));

        return { ...group, rows };
      }

      // Per-shift-type breakdown
      const shiftCounts = new Map<string, number>();
      const breakdownField = group.breakdownField!;

      for (const row of monthScopedRows) {
        const cellValue = row.cells[breakdownField] ? getCellText(row.cells[breakdownField]) : "";
        shiftCounts.set(cellValue, (shiftCounts.get(cellValue) ?? 0) + 1);
      }

      const countColLabel = group.columns[0];
      const rows = Array.from(shiftCounts.entries())
        .filter(([, count]) => count > 0)
        .map(([name, count]) => ({
          label: name,
          values: { [countColLabel]: String(count) },
        }));

      return { ...group, rows };
    });
  }, [hasMonthScope, monthScopedRows, statGroups]);
  const totalTablePages = Math.max(1, Math.ceil(sortedRows.length / rowsPerPage));
  const visibleTablePage = Math.min(tablePage, totalTablePages);
  const paginatedRows = useMemo(() => {
    const startIndex = (visibleTablePage - 1) * rowsPerPage;
    return sortedRows.slice(startIndex, startIndex + rowsPerPage);
  }, [sortedRows, visibleTablePage, rowsPerPage]);
  const paginationItems = useMemo(() => buildPaginationItems(visibleTablePage, totalTablePages), [totalTablePages, visibleTablePage]);
  const activeState = sheetMode === "edit" ? editState : createState;
  const activeFormAction = sheetMode === "edit" ? editFormAction : createFormAction;
  const activeSheetTitle = sheetMode === "edit" ? (editSheetTitle ?? t("entity.editRecord")) : sheetTitle;
  const activeSheetDescription =
    sheetMode === "edit" ? (editSheetDescription ?? t("entity.editRecordDescription")) : sheetDescription;
  const activeSubmitLabel = sheetMode === "edit" ? (editSubmitLabel ?? t("entity.saveChanges")) : submitLabel;
  const activeSheetTab = activeSheetTabs.find((tab) => tab.id === activeSheetTabId) ?? activeSheetTabs[0] ?? null;
  const activeMenuRow = menuRowId ? displayRows.find((row) => row.id === menuRowId) ?? null : null;
  const isCalendarSearchInline = activeView === "calendar" && Boolean(calendar);
  const showToolbarMonthSwitcher = !isCalendarSearchInline && hasMonthScope;

  useEffect(() => {
    setTablePage(1);
  }, [activeView, normalizedSearch, selectedMonth, tableSort]);

  useEffect(() => {
    if (tablePage > totalTablePages) {
      setTablePage(totalTablePages);
    }
  }, [tablePage, totalTablePages]);

  useEffect(() => {
    if (tableSort && !columns.some((column) => column.key === tableSort.columnKey)) {
      setTableSort(null);
    }
  }, [columns, tableSort]);

  function syncSheetDirtyState() {
    if (!sheetFormRef.current) {
      return;
    }

    setIsSheetDirty(serializeFormSnapshot(sheetFormRef.current) !== initialSheetSnapshotRef.current);
  }

  function forceCloseSheet() {
    setIsSheetOpen(false);
    setSheetMode("create");
    setEditingRow(null);
    setCreatePrefillValues({});
    setIsSheetDirty(false);
    setIsUnsavedChangesDialogOpen(false);
    initialSheetSnapshotRef.current = "";
  }

  function requestSheetClose() {
    if (isSheetDirty) {
      setIsUnsavedChangesDialogOpen(true);
      return;
    }

    forceCloseSheet();
  }

  function closeAllMenus() {
    setMenuRowId(null);
    setMenuPosition(null);
    setCalendarMenuState(null);
  }

  function openAuditRow(row: EntityRow) {
    setAuditRow(row);
    closeAllMenus();
  }

  function requestDeleteRecord(recordId: string, label: string) {
    closeAllMenus();
    setDeletePromptState({ recordId, label });
  }

  function confirmDeleteRecord() {
    if (!deletePromptState) {
      return;
    }

    const formData = new FormData();
    formData.set("id", deletePromptState.recordId);
    pendingDeleteIdRef.current = deletePromptState.recordId;
    setDeletePromptState(null);

    startTransition(() => {
      deleteFormAction(formData);
    });
  }

  function openCreateSheet(prefillValues?: Record<string, FormValue>) {
    if (!canCreate || createDisabledReason) {
      return;
    }

    setSheetMode("create");
    setEditingRow(null);
    setCreatePrefillValues(prefillValues ?? {});
    setIsSheetOpen(true);
    setIsUnsavedChangesDialogOpen(false);
    setActionMenuOpen(false);
  }

  function openEditSheet(row: EntityRow) {
    if (!canEdit) {
      return;
    }

    setSheetMode("edit");
    setEditingRow(row);
    setCreatePrefillValues({});
    setIsSheetOpen(true);
    setIsUnsavedChangesDialogOpen(false);
    closeAllMenus();
    setActionMenuOpen(false);
  }

  function computeMenuPosition(left: number, top: number, menuWidth: number, menuHeight: number) {
    const viewportPadding = 12;
    const nextLeft = Math.max(viewportPadding, Math.min(left, window.innerWidth - menuWidth - viewportPadding));
    const nextTop = Math.max(viewportPadding, Math.min(top, window.innerHeight - menuHeight - viewportPadding));

    return { left: nextLeft, top: nextTop };
  }

  function handleSheetSubmit(event: FormEvent<HTMLFormElement>) {
    if (moduleKey !== "schedule" || sheetMode !== "create") {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const date = String(formData.get("date") ?? "").trim();
    const userId = String(formData.get("userId") ?? "").trim();

    if (!date || !userId) {
      return;
    }

    const duplicateRow = findScheduleDuplicateRow(rows, date, userId);

    if (!duplicateRow) {
      return;
    }

    event.preventDefault();
    notify({
      tone: "error",
      message: t("action.scheduleDuplicateEntry", {
        date: formatDisplayDate(date, locale),
      }),
    });
  }

  function handleCalendarDaySelect(dateValue: string) {
    const prefillValues: Record<string, FormValue> = {};

    if (fieldNameSet.has("date")) {
      prefillValues.date = dateValue;
    }

    if (fieldNameSet.has("startDate")) {
      prefillValues.startDate = dateValue;
    }

    if (fieldNameSet.has("endDate")) {
      prefillValues.endDate = dateValue;
    }

    openCreateSheet(prefillValues);
  }

  function openCalendarRecordMenu(recordId: string, clientX: number, clientY: number) {
    if (!canEdit && !canDelete) {
      return;
    }

    setMenuRowId(null);
    setMenuPosition(null);

    const menuItemCount = (canEdit ? 1 : 0) + (canDelete ? 1 : 0);
    const menuWidth = 190;
    const menuHeight = menuItemCount * 40 + 16;
    setCalendarMenuState({
      recordId,
      position: computeMenuPosition(clientX, clientY, menuWidth, menuHeight),
    });
  }

  function handleCalendarItemSelect(itemId: string) {
    const row = rowsById.get(itemId);

    if (!row) {
      return;
    }

    openEditSheet(row);
  }

  function handleCalendarItemLockToggle(recordId: string) {
    if (!canToggleLock) {
      return;
    }

    const currentRow = rowsById.get(recordId);
    const currentLocked = lockOverrides[recordId] ?? (currentRow?.formValues?.locked === true);

    setLockOverrides((current) => ({
      ...current,
      [recordId]: !currentLocked,
    }));

    lockTogglePendingRef.current = true;

    const formData = new FormData();
    formData.set("id", recordId);

    startTransition(() => {
      toggleLockFormAction(formData);
    });
  }

  const handleCalendarItemDrop = useCallback((recordId: string, targetDate: string) => {
    if (!moveAction) {
      return;
    }

    const formData = new FormData();
    formData.set("id", recordId);
    formData.set("targetDate", targetDate);

    startTransition(async () => {
      const result = await moveAction(initialActionState, formData);

      if (result.status === "success") {
        if (result.message) {
          notify({ tone: "success", message: result.message });
        }

        startTransition(() => {
          router.refresh();
        });
      } else if (result.status === "error" && result.message) {
        notify({ tone: "error", message: result.message });
      }
    });
  }, [moveAction, notify, router]);

  function handleBulkLock(locked: boolean) {
    if (!canBulkLock || !selectedMonth) {
      return;
    }

    setLockOverrides({});

    const formData = new FormData();
    formData.set("month", selectedMonth);
    formData.set("locked", String(locked));

    startTransition(() => {
      bulkLockFormAction(formData);
    });
  }

  function handleBulkDelete() {
    if (!canBulkDelete || selectedRowIds.size === 0) {
      return;
    }

    const formData = new FormData();
    formData.set("ids", Array.from(selectedRowIds).join(","));

    startTransition(() => {
      bulkDeleteFormAction(formData);
    });
  }

  function toggleRowSelection(rowId: string) {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    const pageRowIds = paginatedRows.map((row) => row.id);
    const allSelected = pageRowIds.length > 0 && pageRowIds.every((id) => selectedRowIds.has(id));

    if (allSelected) {
      setSelectedRowIds((prev) => {
        const next = new Set(prev);
        for (const id of pageRowIds) {
          next.delete(id);
        }
        return next;
      });
    } else {
      setSelectedRowIds((prev) => {
        const next = new Set(prev);
        for (const id of pageRowIds) {
          next.add(id);
        }
        return next;
      });
    }
  }

  function toggleRowMenu(row: EntityRow, trigger: HTMLButtonElement) {
    if (menuRowId === row.id) {
      setMenuRowId(null);
      setMenuPosition(null);
      return;
    }

    setCalendarMenuState(null);

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 190;
    const menuHeight = (row.auditEntries !== undefined ? 48 : 0) + (canDelete ? 48 : 0) + 16;
    const offset = 8;
    const viewportPadding = 12;
    const left = Math.max(viewportPadding, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding));
    const shouldOpenUpward = rect.bottom + offset + menuHeight > window.innerHeight - viewportPadding;
    const top = shouldOpenUpward
      ? Math.max(viewportPadding, rect.top - menuHeight - offset)
      : Math.min(window.innerHeight - menuHeight - viewportPadding, rect.bottom + offset);

    setMenuRowId(row.id);
    setMenuPosition({ left, top });
  }

  function openImportPicker() {
    if (!canImport || importDisabledReason) {
      return;
    }

    setActionMenuOpen(false);
    if (importInputRef.current) {
      importInputRef.current.value = "";
    }
    importInputRef.current?.click();
  }

  function handleImportSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  function exportRowsToCsv() {
    if (!canExport) {
      return;
    }

    const headerNames = csvFieldNames ?? allSheetFields.filter((field) => field.type !== "permission-matrix").map((field) => field.name);
    const csvLines = [
      headerNames.map(escapeCsvValue).join(";"),
      ...rows.map((row) =>
        headerNames
          .map((fieldName) => escapeCsvValue(serializeCsvValue(getFieldDefaultValue(row, fieldName))))
          .join(";"),
      ),
    ];
    const csvContent = csvLines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = csvFileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setActionMenuOpen(false);
  }

  function toggleTableSort(columnKey: string) {
    setTableSort((currentSort) => {
      if (!currentSort || currentSort.columnKey !== columnKey) {
        return {
          columnKey,
          direction: "asc",
        };
      }

      return {
        columnKey,
        direction: currentSort.direction === "asc" ? "desc" : "asc",
      };
    });
  }

  function toggleStatsSort(groupTitle: string, columnKey: string) {
    setStatsSort((current) => {
      const next = new Map(current);
      const existing = next.get(groupTitle);
      if (!existing || existing.columnKey !== columnKey) {
        next.set(groupTitle, { columnKey, direction: "asc" });
      } else {
        next.set(groupTitle, { columnKey, direction: existing.direction === "asc" ? "desc" : "asc" });
      }
      return next;
    });
  }

  function toggleColumnVisibility(columnKey: string) {
    setHiddenColumns((current) => {
      const next = new Set(current);

      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        // Prevent hiding ALL columns
        if (columns.length - next.size <= 1) {
          return current;
        }
        next.add(columnKey);
      }

      if (moduleKey) {
        saveColumnPreferences(moduleKey, Array.from(next));
      }

      return next;
    });
  }

  function renderFormField(field: FormField) {
    const fieldError = activeState.fieldErrors?.[field.name]?.[0];
    const currentValue = sheetMode === "edit" ? getFieldDefaultValue(editingRow, field.name) : createPrefillValues[field.name];
    const fieldRenderKey = getFieldRenderKey(field.name, sheetMode, editingRow?.id);

    if (field.type === "color") {
      return <ColorFieldControl key={field.name} field={field} value={currentValue as string | undefined} fieldError={fieldError} />;
    }

    if (field.type === "avatar") {
      return (
        <AvatarFieldControl
          key={fieldRenderKey}
          field={field}
          value={currentValue as string | undefined}
          recordId={editingRow?.id}
          fieldError={fieldError}
        />
      );
    }

    if (field.type === "range") {
      return <RangeFieldControl key={field.name} field={field} value={currentValue as string | number | undefined} fieldError={fieldError} />;
    }

    if (field.type === "textarea") {
      return (
        <label key={fieldRenderKey} className="field">
          <span className={fieldLabelClass(field.required)}>{field.label}</span>
          <textarea
            name={field.name}
            placeholder={field.placeholder}
            defaultValue={(sheetMode === "edit" ? currentValue : (currentValue ?? field.defaultValue)) as string | undefined}
            required={field.required}
            rows={field.rows ?? 5}
            className="field-control textarea-control"
          />
          {field.description ? <span className="field-description">{field.description}</span> : null}
          {fieldError ? <span className="field-error">{fieldError}</span> : null}
        </label>
      );
    }

    if (field.type === "select") {
      return (
        <SelectFieldControl
          key={`${field.name}-${sheetMode}-${editingRow?.id ?? "create"}`}
          field={field}
          value={String((sheetMode === "edit" ? currentValue : (currentValue ?? field.defaultValue)) ?? "")}
          fieldError={fieldError}
          formRef={field.filterByDate || field.filterByField ? sheetFormRef : undefined}
          holidayDates={holidayDates}
        />
      );
    }

    if (field.type === "multiselect") {
      return (
        <MultiSelectFieldControl
          key={`${field.name}-${sheetMode}-${editingRow?.id ?? "create"}`}
          field={field}
          value={Array.isArray(currentValue) ? currentValue : undefined}
          fieldError={fieldError}
        />
      );
    }

    if (field.type === "permission-matrix") {
      return (
        <PermissionMatrixFieldControl
          key={`${field.name}-${sheetMode}-${editingRow?.id ?? "create"}`}
          field={field}
          value={Array.isArray(currentValue) ? currentValue : undefined}
          fieldError={fieldError}
        />
      );
    }

    if (field.type === "checkbox") {
      if (field.group) {
        return (
          <label key={fieldRenderKey} className="checkbox-group-item" title={field.label}>
            <input
              type="checkbox"
              name={field.name}
              defaultChecked={sheetMode === "edit" ? Boolean(currentValue) : typeof currentValue === "boolean" ? currentValue : field.defaultChecked}
              className="checkbox-control"
            />
            <span className="checkbox-group-label">{field.label}</span>
          </label>
        );
      }

      return (
        <label key={fieldRenderKey} className="checkbox-field">
          <input
            type="checkbox"
            name={field.name}
            defaultChecked={sheetMode === "edit" ? Boolean(currentValue) : typeof currentValue === "boolean" ? currentValue : field.defaultChecked}
            className="checkbox-control"
          />
          <span className="stack-tight">
            <span className={fieldLabelClass(field.required)}>{field.label}</span>
            {field.description ? <span className="field-description">{field.description}</span> : null}
            {fieldError ? <span className="field-error">{fieldError}</span> : null}
          </span>
        </label>
      );
    }

    return (
      <label key={fieldRenderKey} className="field">
        <span className={fieldLabelClass(field.required)}>{field.label}</span>
        <input
          type={field.type}
          name={field.name}
          placeholder={field.placeholder}
          defaultValue={(sheetMode === "edit" ? currentValue : (currentValue ?? field.defaultValue)) as string | number | undefined}
          required={field.required}
          min={field.min}
          max={field.max}
          step={field.step}
          autoComplete={field.autoComplete}
          className="field-control"
        />
        {field.description ? <span className="field-description">{field.description}</span> : null}
        {fieldError ? <span className="field-error">{fieldError}</span> : null}
      </label>
    );
  }

  function renderFormFields(formFields: FormField[]): ReactNode[] {
    const avatarFieldIndex = formFields.findIndex((field) => field.type === "avatar" && field.name === "avatarUrl");
    const firstNameIndex = formFields.findIndex((field) => field.name === "firstName");
    const lastNameIndex = formFields.findIndex((field) => field.name === "lastName");

    if (avatarFieldIndex >= 0 && firstNameIndex >= 0 && lastNameIndex >= 0) {
      const avatarField = formFields[avatarFieldIndex];
      const firstNameField = formFields[firstNameIndex];
      const lastNameField = formFields[lastNameIndex];
      const identityIndices = new Set([avatarFieldIndex, firstNameIndex, lastNameIndex]);

      const remainingFields = formFields.filter((_, index) => !identityIndices.has(index));

      return [
        <div key="user-identity" className="user-sheet-identity-grid">
          <div className="user-sheet-avatar-col">{renderFormField(avatarField)}</div>
          <div className="user-sheet-name-col">
            {renderFormField(firstNameField)}
            {renderFormField(lastNameField)}
          </div>
        </div>,
        ...renderFormFields(remainingFields),
      ];
    }

    const result: ReactNode[] = [];
    let i = 0;

    while (i < formFields.length) {
      const field = formFields[i];

      if (field.type === "checkbox" && field.group) {
        const groupName = field.group;
        const groupLabel = field.groupLabel;
        const groupFields: typeof formFields = [];

        while (i < formFields.length && formFields[i].type === "checkbox" && (formFields[i] as typeof field).group === groupName) {
          groupFields.push(formFields[i]);
          i++;
        }

        result.push(
          <div key={`group-${groupName}`} className="field">
            {groupLabel ? <span className="field-label">{groupLabel}</span> : null}
            <div className="checkbox-group">
              {groupFields.map((groupField) => renderFormField(groupField))}
            </div>
          </div>,
        );
      } else {
        result.push(renderFormField(field));
        i++;
      }
    }

    return result;
  }

  const searchControl = (
    <label className="module-search">
      <Search size={18} />
      <input
        type="search"
        value={searchValue}
        onChange={(event) => setSearchValue(event.currentTarget.value)}
        placeholder={searchPlaceholder ?? t("entity.searchFallback", { title: title.toLocaleLowerCase(locale) })}
      />
    </label>
  );
  const viewSwitcherControl =
    availableViews.length > 1 ? (
      <div className="view-switcher" role="tablist" aria-label={t("entity.toggleView")}>
        {availableViews.map((view) => {
          const ViewIcon = getViewIcon(view);

          return (
            <button
              key={view}
              type="button"
              className={`view-switcher-button${activeView === view ? " active" : ""}`}
              onClick={() => setActiveView(view)}
              role="tab"
              aria-selected={activeView === view}
            >
              <ViewIcon size={16} />
              {getViewLabel(view, t)}
            </button>
          );
        })}
      </div>
    ) : null;

  const bulkLockControl =
    canBulkLock && selectedMonth ? (
      <div className="calendar-toolbar-bulk">
        <button type="button" className="calendar-bulk-btn calendar-bulk-btn-lock" onClick={() => handleBulkLock(true)} title={t("entity.lockAll")}>
          <Lock size={16} />
        </button>
        <button type="button" className="calendar-bulk-btn calendar-bulk-btn-unlock" onClick={() => handleBulkLock(false)} title={t("entity.unlockAll")}>
          <LockOpen size={16} />
        </button>
      </div>
    ) : null;

  const calendarActionsControl =
    bulkLockControl || viewSwitcherControl ? (
      <>
        {bulkLockControl}
        {viewSwitcherControl}
      </>
    ) : null;

  return (
    <>
      <section className="module-page stack">
        <header className="module-page-header">
          {!hideHeader ? (
            <div className="stack-tight">
              <h1>{title}</h1>
              {summary ? <p className="module-page-summary">{summary}</p> : null}
            </div>
          ) : null}

          <div className="module-header-actions">
            {headerActions}

            {primaryAction || canCreate || hasActionDropdown ? (
              <div className="split-action" ref={actionMenuRef}>
                {primaryAction ??
                  (canCreate ? (
                    <button type="button" className="button action-main" onClick={() => openCreateSheet()} disabled={Boolean(createDisabledReason)}>
                      <Plus size={18} />
                      {addLabel}
                    </button>
                  ) : null)}
                {hasActionDropdown ? (
                  <button
                    type="button"
                    className="button action-toggle"
                    aria-haspopup="menu"
                    aria-expanded={actionMenuOpen}
                    onClick={() => setActionMenuOpen((current) => !current)}
                  >
                    <ChevronDown size={18} />
                  </button>
                ) : null}

                {actionMenuOpen && hasActionDropdown ? (
                  <div className="action-dropdown" role="menu">
                    {canImport ? (
                      <button
                        type="button"
                        className="action-dropdown-item"
                        role="menuitem"
                        onClick={openImportPicker}
                        disabled={Boolean(importDisabledReason)}
                        title={importDisabledReason}
                      >
                        <Upload size={16} />
                        {t("entity.importCsv")}
                      </button>
                    ) : null}
                    {canExport ? (
                      <button type="button" className="action-dropdown-item" role="menuitem" onClick={exportRowsToCsv}>
                        <Download size={16} />
                        {t("entity.exportCsv")}
                      </button>
                    ) : null}

                  </div>
                ) : null}

                {canImport ? (
                  <form action={importFormAction} className="csv-import-form">
                    <input ref={importInputRef} type="file" name="file" accept=".csv,text/csv" hidden onChange={handleImportSelection} />
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        {canCreate && createDisabledReason ? <p className="inline-note">{createDisabledReason}</p> : null}

        {displayStats.length > 0 ? (
          <section className="module-stat-strip">
            {displayStats.map((stat) => (
              <article key={stat.label} className="module-stat-pill">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
                {stat.detail ? <small>{stat.detail}</small> : null}
              </article>
            ))}
          </section>
        ) : null}

        {preSurfaceContent}

        <section className="module-surface stack-tight">
          {!isCalendarSearchInline ? (
            <div className="module-toolbar">
              <div className="module-toolbar-primary">
                {showToolbarMonthSwitcher ? <MonthSwitcher month={selectedMonth} onMonthChange={setSelectedMonth} /> : null}
                {searchControl}
              </div>

              <div className="module-toolbar-actions">
                {bulkLockControl}
                {activeView === "table" && columns.length > 1 ? (
                  <div className="column-toggle-wrapper" ref={columnMenuRef}>
                    <button
                      type="button"
                      className={`column-toggle-trigger${columnMenuOpen ? " active" : ""}`}
                      onClick={() => setColumnMenuOpen((v) => !v)}
                      aria-label={t("entity.toggleColumns")}
                      title={t("entity.toggleColumns")}
                    >
                      <Columns3 size={16} />
                    </button>
                    {columnMenuOpen ? (
                      <div className="column-toggle-menu">
                        <div className="column-toggle-header">{t("entity.columns")}</div>
                        {columns.map((col) => {
                          const isVisible = !hiddenColumns.has(col.key);
                          return (
                            <button
                              key={col.key}
                              type="button"
                              className={`column-toggle-item${isVisible ? " visible" : " hidden"}`}
                              onClick={() => toggleColumnVisibility(col.key)}
                            >
                              {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                              <span>{col.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {viewSwitcherControl}
              </div>
            </div>
          ) : null}

          {activeView === "calendar" && calendar ? (
            <CalendarPanel
              calendar={calendar}
              items={filteredCalendarItems}
              month={selectedMonth}
              onMonthChange={setSelectedMonth}
              searchControl={searchControl}
              actionsControl={calendarActionsControl}
              onDaySelect={canCreate && !createDisabledReason ? handleCalendarDaySelect : undefined}
              onItemLockToggle={canToggleLock ? handleCalendarItemLockToggle : undefined}
              onItemContextMenu={canEdit || canDelete ? openCalendarRecordMenu : undefined}
              onItemDrop={moveAction && canEdit ? handleCalendarItemDrop : undefined}
            />
          ) : null}

          {activeView === "stats" ? (
            <div className="stats-view-stack">
              {displayStatGroups.map((group) => {
                if (group.rows.length === 0) return null;
                const groupSortState = statsSort.get(group.title);
                const sortedStatRows = groupSortState
                  ? [...group.rows].sort((a, b) => {
                      const dir = groupSortState.direction === "asc" ? 1 : -1;
                      const aVal = groupSortState.columnKey === "__label" ? a.label : (a.values[groupSortState.columnKey] ?? "0");
                      const bVal = groupSortState.columnKey === "__label" ? b.label : (b.values[groupSortState.columnKey] ?? "0");
                      const aNum = Number(aVal);
                      const bNum = Number(bVal);
                      if (!isNaN(aNum) && !isNaN(bNum)) return (aNum - bNum) * dir;
                      return String(aVal).localeCompare(String(bVal), locale, { numeric: true, sensitivity: "base" }) * dir;
                    })
                  : group.rows;
                return (
                  <div key={group.title} className="stat-group">
                    <h3 className="stat-group-title">{group.title}</h3>
                    <div className="table-shell">
                      <table className="records-table">
                        <thead>
                          <tr>
                            <th aria-sort={groupSortState?.columnKey === "__label" ? (groupSortState.direction === "asc" ? "ascending" : "descending") : "none"}>
                              <button type="button" className={`table-heading-button${groupSortState?.columnKey === "__label" ? " active" : ""}`} onClick={() => toggleStatsSort(group.title, "__label")}>
                                <span className="table-heading">
                                  <span className="table-sort-indicator" aria-hidden="true">
                                    {groupSortState?.columnKey === "__label" ? (groupSortState.direction === "asc" ? "↑" : "↓") : <ArrowUpDown size={14} />}
                                  </span>
                                </span>
                              </button>
                            </th>
                            {group.columns.map((col) => {
                              const isActive = groupSortState?.columnKey === col;
                              return (
                                <th key={col} aria-sort={isActive ? (groupSortState.direction === "asc" ? "ascending" : "descending") : "none"}>
                                  <button type="button" className={`table-heading-button${isActive ? " active" : ""}`} onClick={() => toggleStatsSort(group.title, col)}>
                                    <span className="table-heading">
                                      {col}
                                      <span className="table-sort-indicator" aria-hidden="true">
                                        {isActive ? (groupSortState.direction === "asc" ? "↑" : "↓") : <ArrowUpDown size={14} />}
                                      </span>
                                    </span>
                                  </button>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedStatRows.map((row) => (
                            <tr key={row.label}>
                              <td><strong>{row.label}</strong></td>
                              {group.columns.map((col) => (
                                <td key={col}>{row.values[col] ?? "0"}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {activeView === "table" ? (
            sortedRows.length === 0 ? (
              <div className="empty-state">
                <h3>{t("entity.noRecords")}</h3>
                <p className="muted">{emptyMessage}</p>
              </div>
            ) : (
              <div className="table-stack">
                {canBulkDelete && selectedRowIds.size > 0 ? (
                  <div className="selection-bar">
                    <span>{t("entity.selectedCount", { count: selectedRowIds.size })}</span>
                    <button type="button" className="selection-bar-action danger" onClick={handleBulkDelete}>
                      <Trash2 size={14} />
                      <span>{t("entity.deleteSelected")}</span>
                    </button>
                  </div>
                ) : null}
                <div className="table-shell">
                  <table className="records-table">
                  <thead>
                    <tr>
                      {canBulkDelete ? (
                        <th className="select-column">
                          <input
                            type="checkbox"
                            className="row-select-checkbox"
                            checked={paginatedRows.length > 0 && paginatedRows.every((row) => selectedRowIds.has(row.id))}
                            onChange={toggleSelectAll}
                            aria-label={t("entity.selectAll")}
                          />
                        </th>
                      ) : null}
                      {visibleColumns.map((column) => {
                        const isSortedColumn = tableSort?.columnKey === column.key;
                        const ariaSort = isSortedColumn ? (tableSort.direction === "asc" ? "ascending" : "descending") : "none";

                        return (
                          <th key={column.key} aria-sort={ariaSort}>
                            <button type="button" className={`table-heading-button${isSortedColumn ? " active" : ""}`} onClick={() => toggleTableSort(column.key)}>
                              <span className="table-heading">
                                {column.label}
                                <span className="table-sort-indicator" aria-hidden="true">
                                  {isSortedColumn ? (tableSort.direction === "asc" ? "↑" : "↓") : <ArrowUpDown size={14} />}
                                </span>
                              </span>
                            </button>
                          </th>
                        );
                      })}
                      {hasRowActions ? <th className="actions-column" aria-label={t("entity.actions")} /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((row) => (
                      <tr key={row.id} className={selectedRowIds.has(row.id) ? "row-selected" : undefined}>
                        {canBulkDelete ? (
                          <td className="select-cell">
                            <input
                              type="checkbox"
                              className="row-select-checkbox"
                              checked={selectedRowIds.has(row.id)}
                              onChange={() => toggleRowSelection(row.id)}
                              aria-label={t("entity.selectRow", { label: row.label ?? row.id })}
                            />
                          </td>
                        ) : null}
                        {visibleColumns.map((column, columnIndex) => {
                          const cell = row.cells[column.key];
                          const toneClass = getCellToneClass(cell);
                          const cellClassName = getCellClassName(cell);
                          const colorTokens = getCellColorTokens(cell);
                          const isFirstColumn = columnIndex === 0;
                          const showRowAvatar = isFirstColumn && (row.avatarUrl !== undefined || row.subtitle !== undefined);

                          return (
                            <td key={column.key} data-label={column.label}>
                              {showRowAvatar ? (
                                <div className="row-identity">
                                  <div className="row-avatar">
                                    {row.avatarUrl ? (
                                      <img src={row.avatarUrl} alt="" className="row-avatar-img" />
                                    ) : (
                                      <span className="row-avatar-initials">{initialsFromName(getCellText(cell))}</span>
                                    )}
                                  </div>
                                  <div className="row-identity-text">
                                    <span>{getCellText(cell)}</span>
                                    {row.subtitle ? <span className="row-identity-subtitle">{row.subtitle}</span> : null}
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {toneClass ? <span className={toneClass}>{getCellText(cell)}</span> : null}
                                  {!toneClass && colorTokens.length > 0 ? (
                                    <span className="color-token-list">
                                      {colorTokens.map((token) => (
                                        <span
                                          key={`${token.color ?? token.backgroundColor ?? "text"}-${token.label}`}
                                          className={`color-token-item${token.variant === "pill" ? " color-token-pill" : ""}`}
                                          style={getColorTokenStyle(token)}
                                        >
                                          {token.variant !== "pill" && token.color ? (
                                            <span className="color-token-dot" style={{ backgroundColor: token.color }} aria-hidden="true" />
                                          ) : null}
                                          <span className={token.mono ? "mono-text" : undefined}>{token.label}</span>
                                        </span>
                                      ))}
                                    </span>
                                  ) : null}
                                  {!toneClass && colorTokens.length === 0 ? <span className={cellClassName}>{getCellText(cell)}</span> : null}
                                </>
                              )}
                            </td>
                          );
                        })}
                        {hasRowActions ? (
                          <td data-label={t("entity.actions")} className="actions-cell">
                            <div className="row-actions">
                              {canEdit ? (
                                <button
                                  type="button"
                                  className="row-menu-trigger"
                                  aria-label={t("entity.editRow", { label: row.label ?? row.id })}
                                  onClick={() => openEditSheet(row)}
                                >
                                  <Pencil size={16} />
                                </button>
                              ) : null}

                              {hasContextMenu ? (
                                <div className="row-menu-host" ref={menuRowId === row.id ? menuHostRef : null}>
                                  <button
                                    type="button"
                                    className="row-menu-trigger"
                                    aria-haspopup="menu"
                                    aria-expanded={menuRowId === row.id}
                                    aria-label={t("entity.openMenu", { label: row.label ?? row.id })}
                                    onClick={(event) => toggleRowMenu(row, event.currentTarget)}
                                  >
                                    <MoreVertical size={16} />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>

                {sortedRows.length > 0 ? (
                  <div className="table-pagination">
                    <div className="table-pagination-left">
                      <label className="table-page-size-label">
                        {t("entity.rowsPerPage")}
                        <SearchableSelect
                            name="rowsPerPage"
                            value={String(rowsPerPage)}
                            onChange={(v) => {
                              const next = Number(v);
                              setRowsPerPage(next);
                              setTablePage(1);
                              if (moduleKey) {
                                savePageSizePreference(moduleKey, next);
                              }
                            }}
                            className="table-page-size-select"
                            options={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
                          />
                      </label>
                      {totalTablePages > 1 ? (
                        <p className="table-pagination-summary">
                          {t("entity.pageOf", { current: String(visibleTablePage), total: String(totalTablePages) })}
                        </p>
                      ) : null}
                    </div>
                    {totalTablePages > 1 ? (
                      <div className="table-pagination-controls">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => setTablePage((current) => Math.max(1, current - 1))}
                          disabled={visibleTablePage <= 1}
                          aria-label={t("entity.prevPage")}
                        >
                          <ChevronLeft size={18} />
                        </button>
                        {paginationItems.map((page, index) => {
                          const previousPage = paginationItems[index - 1];
                          const showGap = previousPage !== undefined && page - previousPage > 1;

                          return (
                            <div key={page} className="table-pagination-group">
                              {showGap ? <span className="table-pagination-gap">…</span> : null}
                              <button
                                type="button"
                                className={`table-pagination-button${page === visibleTablePage ? " active" : ""}`}
                                onClick={() => setTablePage(page)}
                                aria-current={page === visibleTablePage ? "page" : undefined}
                              >
                                {page}
                              </button>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => setTablePage((current) => Math.min(totalTablePages, current + 1))}
                          disabled={visibleTablePage >= totalTablePages}
                          aria-label={t("entity.nextPage")}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          ) : null}
        </section>
      </section>

      {isSheetOpen ? (
        <div className="sheet-layer" role="presentation">
          <button type="button" className="sheet-backdrop" aria-label={t("entity.closeFormSheet")} onClick={requestSheetClose} />
          <aside className="sheet-panel" aria-modal="true" role="dialog" aria-labelledby="sheet-title">
            <div className="sheet-header">
              <div className="stack-tight">
                <p className="eyebrow">{sheetMode === "edit" ? t("entity.editRecord") : t("entity.newRecord")}</p>
                <h2 id="sheet-title">{activeSheetTitle}</h2>
                <p className="muted">{activeSheetDescription}</p>
              </div>
              <button type="button" className="sheet-close" onClick={requestSheetClose}>
                {t("entity.close")}
              </button>
            </div>

            <form action={activeFormAction} className="sheet-form" ref={sheetFormRef} onChange={syncSheetDirtyState} onInput={syncSheetDirtyState} onSubmit={handleSheetSubmit}>
              {sheetMode === "edit" && editingRow ? <input type="hidden" name="id" value={editingRow.id} /> : null}
              {activeSheetTabs.length > 1 ? (
                <div className="sheet-tab-strip" role="tablist" aria-label="Form sections">
                  {activeSheetTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`sheet-tab-button${activeSheetTab?.id === tab.id ? " active" : ""}`}
                      role="tab"
                      id={`sheet-tab-${tab.id}`}
                      aria-controls={`sheet-panel-${tab.id}`}
                      aria-selected={activeSheetTab?.id === tab.id}
                      onClick={() => setActiveSheetTabId(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {activeSheetTabs.map((tab) => {
                const isActiveTab = activeSheetTab?.id === tab.id;

                return (
                  <div
                    key={tab.id}
                    id={`sheet-panel-${tab.id}`}
                    className="sheet-tab-panel"
                    role="tabpanel"
                    aria-labelledby={`sheet-tab-${tab.id}`}
                    hidden={!isActiveTab}
                  >
                    {tab.description ? <p className="muted small-text sheet-tab-description">{tab.description}</p> : null}
                    {renderFormFields(tab.fields)}
                  </div>
                );
              })}

              {activeState.status === "error" && activeState.message ? <p className="form-error">{activeState.message}</p> : null}

              <div className="sheet-actions">
                <button type="button" className="button secondary" onClick={requestSheetClose}>
                  {t("entity.cancel")}
                </button>
                <FormSubmitButton label={activeSubmitLabel} />
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {isUnsavedChangesDialogOpen ? (
        <div className="confirm-layer" role="presentation">
          <button
            type="button"
            className="confirm-backdrop"
            aria-label={t("entity.closeConfirm")}
            onClick={() => setIsUnsavedChangesDialogOpen(false)}
          />
          <section className="confirm-dialog" aria-modal="true" role="dialog" aria-labelledby="confirm-title">
            <div className="stack-tight">
              <p className="eyebrow">{t("entity.unsavedChanges")}</p>
              <h2 id="confirm-title">{t("entity.closeForm")}</h2>
              <p className="muted">{t("entity.unsavedChangesMessage")}</p>
            </div>
            <div className="confirm-actions">
              <button type="button" className="button secondary" onClick={() => setIsUnsavedChangesDialogOpen(false)}>
                {t("entity.continueEditing")}
              </button>
              <button type="button" className="button" onClick={forceCloseSheet}>
                {t("entity.discardChanges")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deletePromptState ? (
        <div className="confirm-layer" role="presentation">
          <button type="button" className="confirm-backdrop" aria-label={t("entity.closeConfirm")} onClick={() => setDeletePromptState(null)} />
          <section className="confirm-dialog" aria-modal="true" role="dialog" aria-labelledby="delete-confirm-title">
            <div className="stack-tight">
              <p className="eyebrow">{t("entity.delete")}</p>
              <h2 id="delete-confirm-title">{deletePromptState.label}</h2>
              <p className="muted">{t("entity.confirmDelete")}</p>
            </div>
            <div className="confirm-actions">
              <button type="button" className="button secondary" onClick={() => setDeletePromptState(null)}>
                {t("entity.cancel")}
              </button>
              <button type="button" className="button danger" onClick={confirmDeleteRecord}>
                {t("entity.delete")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {activeMenuRow && menuPosition ? (
        <div ref={rowMenuRef} className="row-menu" role="menu" style={{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }}>
          {activeMenuRow.auditEntries !== undefined ? (
            <button type="button" className="row-menu-item" role="menuitem" onClick={() => openAuditRow(activeMenuRow)}>
              {t("audit.contextMenu")}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="row-menu-item danger"
              role="menuitem"
              onClick={() => requestDeleteRecord(activeMenuRow.id, activeMenuRow.label ?? activeMenuRow.id)}
            >
              {t("entity.delete")}
            </button>
          ) : null}
        </div>
      ) : null}

      {calendarMenuState ? (
        <div
          ref={calendarMenuRef}
          className="row-menu calendar-record-menu"
          role="menu"
          style={{ left: `${calendarMenuState.position.left}px`, top: `${calendarMenuState.position.top}px` }}
        >
          {canEdit ? (
            <button
              type="button"
              className="row-menu-item"
              role="menuitem"
              onClick={() => {
                const row = rowsById.get(calendarMenuState.recordId);
                if (row) openEditSheet(row);
              }}
            >
              {t("entity.edit")}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="row-menu-item danger"
              role="menuitem"
              onClick={() => requestDeleteRecord(calendarMenuState.recordId, rows.find((row) => row.id === calendarMenuState.recordId)?.label ?? calendarMenuState.recordId)}
            >
              {t("entity.delete")}
            </button>
          ) : null}
        </div>
      ) : null}

      {auditRow ? (
        <div className="sheet-layer" role="presentation">
          <button type="button" className="sheet-backdrop" aria-label={t("entity.closeAuditLog")} onClick={() => setAuditRow(null)} />
          <aside className="sheet-panel" aria-modal="true" role="dialog" aria-labelledby="audit-sheet-title">
            <div className="sheet-header">
              <div className="stack-tight">
                <p className="eyebrow">{t("audit.title")}</p>
                <h2 id="audit-sheet-title">{auditRow.label ?? t("audit.recordAudit")}</h2>
                <p className="muted">{t("audit.timelineDescription")}</p>
              </div>
              <button type="button" className="sheet-close" onClick={() => setAuditRow(null)}>
                {t("entity.close")}
              </button>
            </div>

            {auditRow.auditEntries && auditRow.auditEntries.length > 0 ? (
              <AuditSheet entryRows={auditRow.auditEntries} />
            ) : (
              <div className="empty-state">
                <h3>{t("audit.noRecords")}</h3>
                <p className="muted">{t("audit.noRecordsDescription")}</p>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
