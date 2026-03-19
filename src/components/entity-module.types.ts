export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export type ModuleView = "calendar" | "table" | "stats";

export type EntityStat = {
  label: string;
  value: string;
  detail?: string;
};

export type StatGroupRow = {
  label: string;
  values: Record<string, string>;
};

export type StatGroup = {
  title: string;
  columns: string[];
  rows: StatGroupRow[];
  /** Optional field name on EntityRow.formValues used to group rows client-side for month scope recalc */
  groupByField?: string;
  /** Field name on EntityRow.cells used for the column breakdown */
  breakdownField?: string;
};

export type EntityColumn = {
  key: string;
  label: string;
};

export type EntityCellTone = "neutral" | "success" | "warning" | "danger";

export type EntityCellColorToken = {
  label: string;
  color?: string;
  mono?: boolean;
  variant?: "dot" | "pill";
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  darkBackgroundColor?: string;
  darkTextColor?: string;
  darkBorderColor?: string;
};

export type EntityCell =
  | string
  | {
      text: string;
      tone?: EntityCellTone;
      mono?: boolean;
      colorTokens?: EntityCellColorToken[];
    };

export type EntityRow = {
  id: string;
  label?: string;
  avatarUrl?: string;
  subtitle?: string;
  cells: Record<string, EntityCell>;
  auditEntries?: AuditEntry[];
  formValues?: Record<string, string | number | boolean | string[] | undefined>;
};

export type AuditEntry = {
  id: string;
  action: string;
  timestamp: string;
  actor: string;
  changes?: AuditFieldChange[];
  summary?: string;
};

export type AuditFieldChange = {
  field: string;
  label: string;
  previousValue: string;
  nextValue: string;
};

export type CalendarItem = {
  id: string;
  recordId?: string;
  date: string;
  title: string;
  subtitle?: string;
  timeLabel?: string;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  locked?: boolean;
};

export type HolidayEntry = {
  date: string;
  name: string;
  localName?: string;
};

export type CalendarConfig = {
  initialMonth: string;
  items: CalendarItem[];
  holidays?: HolidayEntry[];
};

export type FieldOption = {
  value: string;
  label: string;
  description?: string;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  validDays?: number[];
};

type BaseField = {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
};

export type TextField = BaseField & {
  type: "text" | "email" | "number" | "date" | "time";
  placeholder?: string;
  defaultValue?: string | number;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  autoComplete?: string;
};

export type RangeField = BaseField & {
  type: "range";
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
};

export type ColorField = BaseField & {
  type: "color";
  defaultValue?: string;
};

export type TextAreaField = BaseField & {
  type: "textarea";
  placeholder?: string;
  defaultValue?: string;
  rows?: number;
};

export type SelectField = BaseField & {
  type: "select";
  options: FieldOption[];
  defaultValue?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  filterByDate?: string;
};

export type MultiSelectField = BaseField & {
  type: "multiselect";
  options: FieldOption[];
  defaultValue?: string[];
  size?: number;
  variant?: "listbox" | "checkbox-list";
};

export type CheckboxField = BaseField & {
  type: "checkbox";
  defaultChecked?: boolean;
  group?: string;
  groupLabel?: string;
};

export type PermissionMatrixSection = {
  key: string;
  label: string;
  permissions: Array<{
    code: string;
    label: string;
    description?: string;
  }>;
};

export type PermissionMatrixField = BaseField & {
  type: "permission-matrix";
  sections: PermissionMatrixSection[];
  defaultValue?: string[];
  readOnly?: boolean;
  triState?: boolean;
};

export type AvatarField = BaseField & {
  type: "avatar";
  uploadUrl: string;
};

export type FormField = TextField | RangeField | ColorField | TextAreaField | SelectField | MultiSelectField | CheckboxField | PermissionMatrixField | AvatarField;

export type SheetTab = {
  id: string;
  label: string;
  description?: string;
  fields: FormField[];
  visibleIn?: "create" | "edit" | "both";
};

export type EntityModuleConfig = {
  title: string;
  summary?: string;
  moduleKey?: string;
  initialHiddenColumns?: string[];
  csvFileName: string;
  csvFieldNames?: string[];
  stats: EntityStat[];
  statGroups?: StatGroup[];
  columns: EntityColumn[];
  rows: EntityRow[];
  emptyMessage: string;
  addLabel: string;
  sheetTitle: string;
  sheetDescription: string;
  submitLabel: string;
  editSheetTitle?: string;
  editSheetDescription?: string;
  editSubmitLabel?: string;
  fields: FormField[];
  sheetTabs?: SheetTab[];
  createDisabledReason?: string;
  importDisabledReason?: string;
  searchPlaceholder?: string;
  views?: ModuleView[];
  defaultView?: ModuleView;
  calendar?: CalendarConfig;
  monthScopeEnabled?: boolean;
  initialPageSize?: number;
};
