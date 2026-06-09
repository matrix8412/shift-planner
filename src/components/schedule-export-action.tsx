"use client";

import { Download, GripVertical, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useBrowserNotifications } from "@/components/browser-notification-provider";
import type { CalendarItem, EntityCell, EntityRow } from "@/components/entity-module.types";
import { useI18n } from "@/i18n/context";

type ScheduleExportActionProps = {
  rows: EntityRow[];
  calendarItems: CalendarItem[];
  selectedMonth: string;
};

type ExportColumn = {
  id: string;
  label: string;
  enabled: boolean;
  backgroundColor?: string;
  textColor?: string;
};

type ExportDayRow = {
  dateKey: string;
  dateLabel: string;
  assignments: Record<string, string[]>;
};

type XlsxFile = {
  path: string;
  content: Uint8Array;
};

const encoder = new TextEncoder();
const crcTable = createCrcTable();

export function ScheduleExportAction({ rows, calendarItems, selectedMonth }: ScheduleExportActionProps) {
  const { t } = useI18n();
  const { notify } = useBrowserNotifications();
  const exportData = useMemo(() => buildScheduleExportData(rows, calendarItems, selectedMonth), [calendarItems, rows, selectedMonth]);
  const defaultExportFileName = buildMonthFileName(t("schedule.exportDefaultFileName"), selectedMonth);
  const defaultSheetName = t("schedule.exportDefaultSheetName");
  const [isOpen, setIsOpen] = useState(false);
  const [fileName, setFileName] = useState(defaultExportFileName);
  const [sheetName, setSheetName] = useState(defaultSheetName);
  const [columns, setColumns] = useState<ExportColumn[]>(exportData.columns);
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  useEffect(() => {
    setColumns(exportData.columns);
  }, [exportData.columns]);

  useEffect(() => {
    setFileName(defaultExportFileName);
    setSheetName(defaultSheetName);
  }, [defaultExportFileName, defaultSheetName]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function openDialog() {
    if (exportData.dayRows.length === 0) {
      notify({ tone: "error", message: t("schedule.exportEmpty") });
      return;
    }

    setColumns(exportData.columns);
    setFileName(defaultExportFileName);
    setSheetName(defaultSheetName);
    setIsOpen(true);
  }

  function handleColumnToggle(columnId: string) {
    setColumns((current) => current.map((column) => (column.id === columnId ? { ...column, enabled: !column.enabled } : column)));
  }

  function moveColumn(fromId: string, toId: string) {
    if (fromId === toId) {
      return;
    }

    setColumns((current) => {
      const fromIndex = current.findIndex((column) => column.id === fromId);
      const toIndex = current.findIndex((column) => column.id === toId);

      if (fromIndex < 0 || toIndex < 0) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  function handleExport() {
    const enabledColumns = columns.filter((column) => column.enabled);

    if (enabledColumns.length === 0) {
      notify({ tone: "error", message: t("schedule.exportSelectColumn") });
      return;
    }

    try {
      const workbookRows = [
        [t("schedule.exportDateColumn"), ...enabledColumns.map((column) => column.label)],
        ...exportData.dayRows.map((dayRow) => [
          dayRow.dateLabel,
          ...enabledColumns.map((column) => (dayRow.assignments[column.id] ?? []).join(", ")),
        ]),
      ];
      const workbook = buildWorkbookFile({
        fileName,
        defaultFileName: defaultExportFileName,
        sheetName,
        defaultSheetName,
        rows: workbookRows,
        columnStyles: enabledColumns.map((column) => ({
          backgroundColor: column.backgroundColor,
          textColor: column.textColor,
        })),
      });
      const blob = new Blob([workbook], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = normalizeFileName(fileName, defaultExportFileName);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setIsOpen(false);
      notify({ tone: "success", message: t("schedule.exportSuccess") });
    } catch {
      notify({ tone: "error", message: t("schedule.exportFailed") });
    }
  }

  return (
    <>
      <button type="button" className="button secondary" onClick={openDialog}>
        <Download size={18} />
        {t("schedule.exportXlsx")}
      </button>

      {isOpen ? (
        <div className="confirm-layer" role="presentation">
          <button type="button" className="confirm-backdrop" aria-label={t("schedule.exportClose")} onClick={() => setIsOpen(false)} />
          <section className="confirm-dialog schedule-export-dialog" aria-modal="true" role="dialog" aria-labelledby="schedule-export-title">
            <div className="sheet-header schedule-export-header">
              <div className="stack-tight">
                <p className="eyebrow">{t("schedule.exportXlsx")}</p>
                <h2 id="schedule-export-title">{t("schedule.exportDialogTitle")}</h2>
                <p className="muted">{t("schedule.exportDialogDescription")}</p>
              </div>
              <button type="button" className="sheet-close" onClick={() => setIsOpen(false)} aria-label={t("schedule.exportClose")}>
                <X size={18} />
              </button>
            </div>

            <div className="stack-tight">
              <label className="field">
                <span className="field-label">{t("schedule.exportFileName")}</span>
                <input
                  type="text"
                  className="field-control"
                  value={fileName}
                  onChange={(event) => setFileName(event.currentTarget.value)}
                  placeholder={defaultExportFileName}
                />
              </label>

              <label className="field">
                <span className="field-label">{t("schedule.exportSheetName")}</span>
                <input type="text" className="field-control" value={sheetName} onChange={(event) => setSheetName(event.currentTarget.value)} />
              </label>
            </div>

            <div className="field">
              <div className="stack-tight">
                <span className="field-label">{t("schedule.exportColumns")}</span>
                <span className="field-description">{t("schedule.exportColumnsHint")}</span>
              </div>

              <div className="schedule-export-list" role="list">
                {columns.map((column) => (
                  <div
                    key={column.id}
                    className={`schedule-export-item${dragOverColumnId === column.id ? " drag-over" : ""}${column.enabled ? "" : " is-disabled"}`}
                    role="listitem"
                    draggable
                    onDragStart={() => {
                      setDraggedColumnId(column.id);
                      setDragOverColumnId(column.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverColumnId(column.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedColumnId) {
                        moveColumn(draggedColumnId, column.id);
                      }
                      setDraggedColumnId(null);
                      setDragOverColumnId(null);
                    }}
                    onDragEnd={() => {
                      setDraggedColumnId(null);
                      setDragOverColumnId(null);
                    }}
                  >
                    <label className="schedule-export-item-main">
                      <input type="checkbox" checked={column.enabled} onChange={() => handleColumnToggle(column.id)} />
                      <span>{column.label}</span>
                    </label>
                    <span className="schedule-export-item-handle" aria-hidden="true">
                      <GripVertical size={18} />
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="schedule-export-summary muted">
              {t("schedule.exportSummary", {
                days: exportData.dayRows.length,
                columns: columns.filter((column) => column.enabled).length,
              })}
            </div>

            <div className="confirm-actions">
              <button type="button" className="button secondary" onClick={() => setIsOpen(false)}>
                {t("entity.cancel")}
              </button>
              <button type="button" className="button" onClick={handleExport}>
                <Download size={18} />
                {t("schedule.exportDownload")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function buildScheduleExportData(rows: EntityRow[], calendarItems: CalendarItem[], selectedMonth: string) {
  const colorByRecordId = new Map(
    calendarItems.map((item) => [
      item.recordId ?? item.id,
      {
        backgroundColor: item.stripColor ?? item.backgroundColor,
        textColor: item.textColor,
      },
    ]),
  );
  const sortedRows = [...rows].sort((a, b) => {
    const left = typeof a.formValues?.date === "string" ? a.formValues.date : "";
    const right = typeof b.formValues?.date === "string" ? b.formValues.date : "";
    return left.localeCompare(right);
  });
  const columnMap = new Map<string, ExportColumn>();
  const dayMap = new Map<string, ExportDayRow>();

  for (const row of sortedRows) {
    const dateKey = typeof row.formValues?.date === "string" ? row.formValues.date : "";
    const shiftTypeId = typeof row.formValues?.shiftTypeId === "string" ? row.formValues.shiftTypeId : row.id;

    if (!dateKey || !dateKey.startsWith(`${selectedMonth}-`)) {
      continue;
    }

    const dateLabel = getCellText(row.cells.date) || dateKey;
    const serviceLabel = getCellText(row.cells.service);
    const shiftLabel = getCellText(row.cells.shift);
    const userLabel = getCellText(row.cells.user);
    const note = typeof row.formValues?.note === "string" ? row.formValues.note.trim() : "";
    const columnLabel = serviceLabel && shiftLabel ? `${serviceLabel} / ${shiftLabel}` : shiftLabel || serviceLabel || shiftTypeId;
    const assignmentLabel = note ? `${userLabel} (${note})` : userLabel;
    const calendarColors = colorByRecordId.get(row.id);

    if (!columnMap.has(shiftTypeId)) {
      columnMap.set(shiftTypeId, {
        id: shiftTypeId,
        label: columnLabel,
        enabled: true,
        backgroundColor: calendarColors?.backgroundColor,
        textColor: calendarColors?.textColor,
      });
    }

    const existingDay = dayMap.get(dateKey) ?? {
      dateKey,
      dateLabel,
      assignments: {},
    };
    const existingAssignments = existingDay.assignments[shiftTypeId] ?? [];

    if (assignmentLabel) {
      existingDay.assignments[shiftTypeId] = [...existingAssignments, assignmentLabel];
    }

    dayMap.set(dateKey, existingDay);
  }

  return {
    columns: Array.from(columnMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
    dayRows: Array.from(dayMap.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
  };
}

function getCellText(cell: EntityCell | undefined) {
  if (!cell) {
    return "";
  }

  return typeof cell === "string" ? cell : cell.text;
}

function normalizeFileName(fileName: string, fallbackFileName = "export.xlsx") {
  const trimmed = fileName.trim() || fallbackFileName;
  return trimmed.toLowerCase().endsWith(".xlsx") ? trimmed : `${trimmed}.xlsx`;
}

function buildMonthFileName(template: string, monthValue: string) {
  return template.replace("{month}", monthValue);
}

function sanitizeSheetName(sheetName: string, fallbackSheetName = "Sheet1") {
  const sanitized = sheetName.replace(/[\\/*?:[\]]/g, "").trim();
  return (sanitized || fallbackSheetName).slice(0, 31);
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildWorkbookFile(input: {
  fileName: string;
  defaultFileName: string;
  sheetName: string;
  defaultSheetName: string;
  rows: string[][];
  columnStyles: Array<{ backgroundColor?: string; textColor?: string }>;
}) {
  const sheetName = sanitizeSheetName(input.sheetName, input.defaultSheetName);
  const createdAt = new Date().toISOString();
  const columnWidths = getColumnWidths(input.rows);
  const styleCatalog = buildStyleCatalog(input.columnStyles);
  const files: XlsxFile[] = [
    {
      path: "[Content_Types].xml",
      content: encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    },
    {
      path: "_rels/.rels",
      content: encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    },
    {
      path: "docProps/app.xml",
      content: encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Shift Planner</Application>
</Properties>`),
    },
    {
      path: "docProps/core.xml",
      content: encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(normalizeFileName(input.fileName, input.defaultFileName))}</dc:title>
  <dc:creator>Shift Planner</dc:creator>
  <cp:lastModifiedBy>Shift Planner</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
</cp:coreProperties>`),
    },
    {
      path: "xl/workbook.xml",
      content: encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    },
    {
      path: "xl/styles.xml",
      content: encodeXml(buildStylesXml(styleCatalog)),
    },
    {
      path: "xl/worksheets/sheet1.xml",
      content: encodeXml(buildWorksheetXml(input.rows, columnWidths, styleCatalog.headerStyleIndexes)),
    },
  ];

  return createZipArchive(files);
}

function buildWorksheetXml(rows: string[][], columnWidths: number[], headerStyleIndexes: number[]) {
  const lastColumnIndex = Math.max(rows[0]?.length ?? 1, 1);
  const lastCellRef = `${toColumnName(lastColumnIndex)}${Math.max(rows.length, 1)}`;
  const colsXml = columnWidths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const rowsXml = rows
    .map((row, rowIndex) => {
      const cellsXml = row
        .map((value, columnIndex) => {
          const cellRef = `${toColumnName(columnIndex + 1)}${rowIndex + 1}`;
          const styleId = rowIndex === 0 ? (headerStyleIndexes[columnIndex] ?? 1) : 0;
          return `<c r="${cellRef}" t="inlineStr" s="${styleId}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");

      return `<row r="${rowIndex + 1}">${cellsXml}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCellRef}"/>
  <sheetViews>
    <sheetView workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;
}

function getColumnWidths(rows: string[][]) {
  const widthMap = new Map<number, number>();

  for (const row of rows) {
    row.forEach((value, index) => {
      const currentWidth = widthMap.get(index) ?? 10;
      const nextWidth = Math.min(Math.max(value.length + 2, currentWidth), 48);
      widthMap.set(index, nextWidth);
    });
  }

  return Array.from({ length: rows[0]?.length ?? 1 }, (_, index) => widthMap.get(index) ?? 10);
}

function toColumnName(columnIndex: number) {
  let current = columnIndex;
  let result = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result || "A";
}

function encodeXml(value: string) {
  return encoder.encode(value);
}

function createZipArchive(files: XlsxFile[]) {
  let offset = 0;
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];

  for (const file of files) {
    const fileName = encoder.encode(file.path);
    const crc32 = calculateCrc32(file.content);
    const dosDateTime = toDosDateTime(new Date());
    const localHeader = new Uint8Array(30 + fileName.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosDateTime.time, true);
    localView.setUint16(12, dosDateTime.date, true);
    localView.setUint32(14, crc32, true);
    localView.setUint32(18, file.content.length, true);
    localView.setUint32(22, file.content.length, true);
    localView.setUint16(26, fileName.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(fileName, 30);
    localParts.push(localHeader, file.content);

    const centralHeader = new Uint8Array(46 + fileName.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosDateTime.time, true);
    centralView.setUint16(14, dosDateTime.date, true);
    centralView.setUint32(16, crc32, true);
    centralView.setUint32(20, file.content.length, true);
    centralView.setUint32(24, file.content.length, true);
    centralView.setUint16(28, fileName.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(fileName, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + file.content.length;
  }

  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return concatUint8Arrays([...localParts, ...centralParts, endHeader]);
}

function concatUint8Arrays(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function toDosDateTime(date: Date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);

  return {
    date: dosDate,
    time: dosTime,
  };
}

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let current = i;

    for (let bit = 0; bit < 8; bit += 1) {
      current = (current & 1) === 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    }

    table[i] = current >>> 0;
  }

  return table;
}

function calculateCrc32(input: Uint8Array) {
  let crc = 0xffffffff;

  for (const value of input) {
    crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function buildStyleCatalog(columnStyles: Array<{ backgroundColor?: string; textColor?: string }>) {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  const fontMap = new Map<string, number>();
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const fillMap = new Map<string, number>();
  const cellXfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const headerStyleIndexes: number[] = [1];

  const defaultHeaderFontKey = "bold|FF000000";
  fonts.push('<font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>');
  fontMap.set(defaultHeaderFontKey, 1);
  cellXfs.push('<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>');

  for (const style of columnStyles) {
    const background = normalizeExcelColor(style.backgroundColor);
    const text = normalizeExcelColor(style.textColor) ?? "FF111111";

    if (!background) {
      headerStyleIndexes.push(1);
      continue;
    }

    const fontKey = `bold|${text}`;
    let fontId = fontMap.get(fontKey);
    if (fontId === undefined) {
      fontId = fonts.length;
      fonts.push(`<font><b/><sz val="11"/><color rgb="${text}"/><name val="Calibri"/><family val="2"/></font>`);
      fontMap.set(fontKey, fontId);
    }

    let fillId = fillMap.get(background);
    if (fillId === undefined) {
      fillId = fills.length;
      fills.push(
        `<fill><patternFill patternType="solid"><fgColor rgb="${background}"/><bgColor indexed="64"/></patternFill></fill>`,
      );
      fillMap.set(background, fillId);
    }

    const xfId = cellXfs.length;
    cellXfs.push(`<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`);
    headerStyleIndexes.push(xfId);
  }

  return {
    fonts,
    fills,
    cellXfs,
    headerStyleIndexes,
  };
}

function buildStylesXml(styleCatalog: { fonts: string[]; fills: string[]; cellXfs: string[] }) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="${styleCatalog.fonts.length}">
    ${styleCatalog.fonts.join("")}
  </fonts>
  <fills count="${styleCatalog.fills.length}">
    ${styleCatalog.fills.join("")}
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="${styleCatalog.cellXfs.length}">
    ${styleCatalog.cellXfs.join("")}
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

function normalizeExcelColor(color: string | undefined) {
  if (!color) {
    return undefined;
  }

  const value = color.trim();
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      const expanded = hex
        .split("")
        .map((char) => char + char)
        .join("");
      return `FF${expanded.toUpperCase()}`;
    }

    if (hex.length === 6) {
      return `FF${hex.toUpperCase()}`;
    }

    return hex.toUpperCase();
  }

  const rgbMatch = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `FF${toHexChannel(Number(r))}${toHexChannel(Number(g))}${toHexChannel(Number(b))}`;
  }

  return undefined;
}

function toHexChannel(value: number) {
  return Math.max(0, Math.min(255, value)).toString(16).toUpperCase().padStart(2, "0");
}
