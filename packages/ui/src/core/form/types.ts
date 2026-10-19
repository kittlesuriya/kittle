import type { ReactNode, RefObject } from "react"
import type { z } from "zod"

// =============================================================================
// Field Types
// =============================================================================

/**
 * Generic field types owned by the global form spec.
 * Module-specific types flow through the extensible field metadata.
 * are registered at runtime via fieldRegistry — see
 * feature modules. `(string & {})` keeps literal autocomplete
 * for built-ins while allowing registered custom type strings.
 */
export type GenericFieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "date"
  | "time"
  | "datetime"
  | "textarea"
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "switch"
  | "file"
  | "array"
  | "autocomplete"
  | "map-picker"
  | "color"
  | "emailTemplate"
  | "markdown"

export type FieldType = GenericFieldType | (string & {})

/**
 * Option for select/radio/multiselect fields
 */
export interface FieldOption {
  label: string
  value: string | number
  [key: string]: unknown
}

/**
 * Grouped options for select fields
 */
export interface GroupedFieldOptions {
  heading: string
  options: FieldOption[]
}

/**
 * Visibility condition for conditional fields
 */
export interface VisibilityCondition {
  field: string
  operator:
    | "equals"
    | "notEquals"
    | "contains"
    | "notContains"
    | "greaterThan"
    | "lessThan"
  value: unknown
}

/**
 * Filter configuration for dependent dropdowns
 */
export interface FilterByConfig {
  field: string
  optionKey: string
}

// =============================================================================
// Form Layout
// =============================================================================
//
// Sections and groups are opt-in: a form that declares none of this renders
// the default flat 12-column grid. See `utils/layout.ts` for how a
// `FormLayoutConfig` is turned into the renderer-ready `ResolvedFormLayout`.

/**
 * A named group of fields inside a form section. `fields` holds field names.
 */
export interface FormGroupConfig {
  id: string
  title?: string
  description?: string
  /** How many of the group's fields flow into a row, 1-4. Defaults to 1. */
  columns?: 1 | 2 | 3 | 4
  fields: string[]
}

/**
 * A titled block of fields and/or groups.
 */
export interface FormSectionConfig {
  id: string
  title: string
  description?: string
  /** Sorts sections; ties keep declaration order. */
  order?: number
  collapsible?: boolean
  /** Only meaningful with `collapsible`; sections start open when unset. */
  defaultOpen?: boolean
  groups?: FormGroupConfig[]
  /** Fields placed straight on the section, outside any group. */
  fields?: string[]
}

/**
 * Declarative section/group placement for a whole form, passed to SchemaForm
 * as its `layout` prop or attached to a schema with `withFormLayout`.
 */
export interface FormLayoutConfig {
  sections: FormSectionConfig[]
  /** Top-level groups, placed in the synthetic `general` section. */
  groups?: FormGroupConfig[]
}

/** A group after field placement is resolved — `fields` are configs, not names. */
export interface ResolvedFormGroup {
  id: string
  title?: string
  description?: string
  columns: 1 | 2 | 3 | 4
  fields: FieldConfig[]
}

/** A section after field placement is resolved. */
export interface ResolvedFormSection {
  id: string
  title: string
  description?: string
  order?: number
  collapsible?: boolean
  defaultOpen?: boolean
  groups: ResolvedFormGroup[]
  fields: FieldConfig[]
}

export interface ResolvedFormLayout {
  sections: ResolvedFormSection[]
}

// =============================================================================
// Field Configuration
// =============================================================================

/**
 * Base field configuration
 */
export interface BaseFieldConfig {
  name: string
  label: string
  help?: {
    title?: string
    description: string
    bullets?: string[]
    example?: string
  }
  type: FieldType
  placeholder?: string
  required?: boolean
  disabled?: boolean
  colSpan?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
  order?: number
  visibleWhen?: VisibilityCondition | VisibilityCondition[]
  dataType?: "string" | "number" | "boolean" | "date" | "object" | "array"
  hidden?: boolean
  excludeFrom?: string
  filterBy?: FilterByConfig
  /** Declarative section placement when the layout does not name this field. */
  section?: string
  /** Declarative group placement inside `section` (or the general section). */
  group?: string
}

/**
 * Text field configuration
 */
export interface TextFieldConfig extends BaseFieldConfig {
  type: "text" | "email" | "password" | "textarea"
}

/**
 * Number field configuration
 */
export interface NumberFieldConfig extends BaseFieldConfig {
  type: "number"
  min?: number
  max?: number
  step?: number
}

/**
 * Date/Time field configuration
 */
export interface DateFieldConfig extends BaseFieldConfig {
  type: "date" | "time" | "datetime"
}

/**
 * Select field configuration
 */
export interface SelectFieldConfig extends BaseFieldConfig {
  type: "select" | "radio" | "autocomplete"
  options?: FieldOption[] | GroupedFieldOptions[]
  emptyIndicator?: string
}

/**
 * MultiSelect field configuration
 */
export interface MultiSelectFieldConfig extends BaseFieldConfig {
  type: "multiselect"
  options?: FieldOption[]
  maxCount?: number
  /**
   * Tree cascade for hierarchical options (see MultiSelect
   * `getDescendantValues`): toggling a parent selects/deselects its whole
   * subtree. Opt-in per field; absent = flat toggle.
   */
  getDescendantValues?: (value: string | number) => Array<string | number>
}

/**
 * Checkbox/Switch field configuration
 */
export interface BooleanFieldConfig extends BaseFieldConfig {
  type: "checkbox" | "switch"
}

/**
 * File field configuration
 */
export interface FileFieldConfig extends BaseFieldConfig {
  type: "file"
  accept?: string
  maxSizeBytes?: number
  maxFiles?: number
  maxTotalSizeBytes?: number
  minFiles?: number
  uploadMode?: "auth" | "public"
  uploadEndpoint?: string
  metaEndpoint?: string
}

/**
 * Array field configuration
 */
export interface ArrayFieldConfig extends BaseFieldConfig {
  type: "array"
  singularLabel?: string
  allowAdd?: boolean
  allowRemove?: boolean
  arrayItemSchema: FieldConfig[]
  /**
   * Heading rendered above each item card. Falls back to
   * `` `${singularLabel} #${index + 1}` `` when omitted — supply it whenever the
   * item has an identity of its own (an entity code, a name), because `#1`
   * tells a user nothing about which record they are editing.
   */
  itemHeader?: (item: ArrayItemWithLocalId, index: number) => ReactNode
  /** Copy shown when the list is empty; falls back to `common.no_items`. */
  emptyMessage?: string
  /** Extra classes for the item list — used to contain a long list, e.g.
   * `max-h-[55vh] overflow-y-auto`, so the actions stay on screen. */
  listClassName?: string
  /**
   * Slim one-line items: the header and the inputs share a row and field
   * labels go screen-reader-only. Opt-in per array, default off — the card
   * layout stays the default so existing forms never restyle. Reach for it
   * when each item carries a single input (a type select, a weight) and the
   * itemHeader already says what the row is; keep cards when items need
   * visible labels or several inputs.
   */
  compactItems?: boolean
}

/**
 * Map picker field configuration
 */
export interface MapPickerFieldConfig extends BaseFieldConfig {
  type: "map-picker"
}

export interface ColorFieldConfig extends BaseFieldConfig {
  type: "color"
}

/**
 * Module-specific (custom) field configuration. Domain types are registered
 * at runtime via fieldRegistry for the
 * feature-specific types. Extra props flow through the index signature.
 */
export interface CustomFieldConfig extends BaseFieldConfig {
  type: string
  [key: string]: unknown
}

export interface EmailTemplateFieldConfig extends BaseFieldConfig {
  type: "emailTemplate"
  variables?: Array<{
    name: string
    label: string
    type: string
    description?: string
  }>
}

export interface MarkdownFieldConfig extends BaseFieldConfig {
  type: "markdown"
  height?: number
  preview?: "live" | "edit" | "preview"
}

export interface MapValue {
  lat: number
  lng: number
  addressLine?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
}

/**
 * Union of all field configurations
 */
export type FieldConfig =
  | TextFieldConfig
  | NumberFieldConfig
  | DateFieldConfig
  | SelectFieldConfig
  | MultiSelectFieldConfig
  | BooleanFieldConfig
  | FileFieldConfig
  | ArrayFieldConfig
  | MapPickerFieldConfig
  | ColorFieldConfig
  | MarkdownFieldConfig
  | CustomFieldConfig
  | EmailTemplateFieldConfig

// =============================================================================
// Form Values
// =============================================================================

/**
 * Form values type
 */
export type FormValues = Record<string, unknown>

/**
 * Array item with local ID for tracking
 */
export interface ArrayItemWithLocalId {
  __localId: string
  [key: string]: unknown
}

/**
 * Typed map of values for each field config
 */
export type FieldValueByConfig<C extends FieldConfig> =
  C extends TextFieldConfig
    ? string
    : C extends NumberFieldConfig
      ? string
      : C extends DateFieldConfig
        ? string
        : C extends SelectFieldConfig
          ? string | number
          : C extends MultiSelectFieldConfig
            ? Array<string | number>
            : C extends BooleanFieldConfig
              ? boolean
              : C extends FileFieldConfig
                ? string | string[] | null
                : C extends ArrayFieldConfig
                  ? ArrayItemWithLocalId[]
                  : C extends MapPickerFieldConfig
                    ? MapValue | null
                    : C extends ColorFieldConfig
                      ? string
                      : C extends MarkdownFieldConfig
                        ? string
                        : C extends EmailTemplateFieldConfig
                          ? string
                          : string

// =============================================================================
// Validation
// =============================================================================

/**
 * Field errors map
 */
export type FieldErrors = Record<string, string[]>

/**
 * Validation result
 */
export interface ValidationResult<T = unknown> {
  success: boolean
  data?: T
  errors?: FieldErrors
}

// =============================================================================
// Schema Form Props
// =============================================================================

/**
 * Submission guard function. Returns null if valid, or an error message string if invalid.
 */
export type SubmissionGuard = () => string | null

/**
 * Context passed to field slot render functions.
 */
export interface FieldSlotContext {
  /** Full form instance for reading values, setting fields, and registering guards */
  form: FormInstance
  /** Current form values */
  values: FormValues
  /** The field's current value and change handler */
  field: { value: unknown; handleChange: (value: unknown) => void }
}

/**
 * Form instance reference
 */
export interface FormInstance {
  reset: (options?: { values?: FormValues }) => void
  handleSubmit: () => Promise<void>
  setFieldValue: (field: string, value: unknown) => void
  /**
   * Register a named submission guard. The guard function is called before
   * form submission — if it returns a string, submission is blocked and the
   * string is shown as an error. Returns an unregister function.
   */
  registerGuard: (key: string, guard: SubmissionGuard) => () => void
  state: {
    isDirty: boolean
    isSubmitting: boolean
    canSubmit: boolean
    values: FormValues
  }
}

/**
 * Custom render actions props
 */
export interface RenderActionsProps {
  form: FormInstance
  canSubmit: boolean
  isSubmitting: boolean
  onCancel?: () => void
  onReset?: () => void
}

/** Class overrides for the stable structural parts generated by SchemaForm. */
export interface SchemaFormClassNames {
  form?: string
  sections?: string
  section?: string
  sectionHeading?: string
  sectionBody?: string
  group?: string
  groupHeading?: string
  grid?: string
  field?: string
  label?: string
  errors?: string
  errorRow?: string
  actionsSeparator?: string
  actions?: string
  cancelButton?: string
  resetButton?: string
  submitButton?: string
  /** Root/trigger styling for built-in controls; custom renderers remain caller-owned. */
  control?: string
  array?: string
  arrayLabel?: string
  arrayList?: string
  arrayItem?: string
  arrayItemHeader?: string
  arrayGrid?: string
  arrayCompactItem?: string
  arrayHeader?: string
  arrayCompactContent?: string
  arrayAddButton?: string
  arrayRemoveButton?: string
  arrayEmpty?: string
  arrayHelp?: string
  arrayErrors?: string
}

/** Class slots for the owned parts of composite field controls. */
export interface SchemaFormPartClassNames {
  select?: { trigger?: string; content?: string; item?: string }
  multiSelect?: import("../../react/ui/multi-select").MultiSelectClassNames
  autocomplete?: import("../../react/ui/autocomplete").AutocompleteClassNames
  password?: import("../../react/ui/password-input").PasswordInputClassNames
  help?: import("../../react/form/components/FieldHelp").FieldHelpClassNames
  datePicker?: import("../../react/form/DatePicker").DatePickerClassNames
  dateTimePicker?: import("../../react/form/DateTimePicker").DateTimePickerClassNames
  colorPicker?: import("../../react/form/ColorPicker").ColorPickerClassNames
}

/** Field-only slots; these cannot alter form or overall layout containers. */
export type SchemaFormFieldClassNames = Pick<
  SchemaFormClassNames,
  | "field"
  | "label"
  | "errors"
  | "errorRow"
  | "control"
  | "array"
  | "arrayLabel"
  | "arrayList"
  | "arrayItem"
  | "arrayItemHeader"
  | "arrayGrid"
  | "arrayCompactItem"
  | "arrayHeader"
  | "arrayCompactContent"
  | "arrayAddButton"
  | "arrayRemoveButton"
  | "arrayEmpty"
  | "arrayHelp"
  | "arrayErrors"
>

/** Per-schema-path field style configuration. */
export interface SchemaFormFieldStyles {
  classNames?: SchemaFormFieldClassNames
  partClassNames?: SchemaFormPartClassNames
}

/**
 * SchemaForm component props
 */
export interface SchemaFormProps<T extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Extra content rendered between fields and actions */
  children?: React.ReactNode
  /** Zod schema for validation */
  schema: T
  /** Submit handler */
  onSubmit?: (data: z.infer<T>) => void | Promise<void>
  /** Submit button label */
  submitLabel?: string
  /** Custom className for form */
  className?: string
  /** Overrides classes on generated form structure; custom slots/actions remain caller-owned. */
  classNames?: SchemaFormClassNames
  partClassNames?: SchemaFormPartClassNames
  fieldStyles?: Record<string, SchemaFormFieldStyles>
  /** Default values */
  defaultValues?: Partial<z.infer<T>>
  /** Key to trigger form reset */
  formKey?: string | number
  /** Cancel handler */
  onCancel?: () => void
  /** Reset handler */
  onReset?: () => void
  /** Custom actions renderer */
  renderActions?: (props: RenderActionsProps) => ReactNode
  /** Fields that should be disabled */
  hideActions?: boolean
  /** Fields that should be disabled */
  disabledFields?: string[]
  /** Field change callback */
  onFieldChange?: (name: string, value: unknown) => void
  /** Loading state */
  isLoading?: boolean
  /** Loading message */
  loadingMessage?: string
  /** Disable entire form */
  disabled?: boolean
  /** Enable navigation guard */
  enableNavigationGuard?: boolean
  /** Navigation guard message */
  navigationGuardMessage?: string
  /** Form instance ref */
  formRef?: RefObject<FormInstance | null>
  /** Optional i18n translation namespace */
  translationNamespace?: string
  /**
   * Inject custom React content after specific fields. Keys are field names;
   * values are render functions that receive the field slot context. The
   * injected content renders inside the field's grid cell, after errors.
   * Use `form.registerGuard()` inside slots to block submission conditionally.
   */
  fieldSlots?: Record<string, (ctx: FieldSlotContext) => React.ReactNode>
  /**
   * Declarative section/group layout.
   *
   * Opt-in: when this is omitted and no field declares `section`/`group`, the
   * form renders the default flat 12-column grid, so existing consumers are
   * unaffected by the feature.
   */
  layout?: FormLayoutConfig
}

// =============================================================================
// Field Renderer Props
// =============================================================================

/**
 * FieldRenderer component props
 */
export type FieldValue = FieldValueByConfig<FieldConfig>

/**
 * An error as a renderer receives it: a plain message, or an entry carrying a
 * `path` so nested values can be located. `FieldArray` needs the path-bearing
 * form to place `rows.0.weight` on its item; a bare string can only reach its
 * array-level bucket.
 */
export type FieldErrorEntry = string | { path?: string; message: string }

export interface FieldRendererProps {
  cfg: FieldConfig
  id?: string
  /**
   * Label id for rich editors (markdown, emailTemplate) that render no
   * labelable input. The owning form renders its label with this id and the
   * editor references it via aria-labelledby instead of htmlFor.
   */
  labelledBy?: string
  value: FieldValue
  onChange: (value: FieldValue) => void
  onBlur?: () => void
  disabled?: boolean
  overrideOptions?: FieldOption[] | GroupedFieldOptions[]
  errors?: FieldErrorEntry[]
  isSubmitted?: boolean
  formValues?: Record<string, unknown>
  classNames?: SchemaFormClassNames
  partClassNames?: SchemaFormPartClassNames
  fieldPath?: string
  fieldStyles?: Record<string, SchemaFormFieldStyles>
  baseClassNames?: SchemaFormClassNames
  basePartClassNames?: SchemaFormPartClassNames
}

/**
 * FieldArray component props
 */
export interface FieldArrayProps {
  name: string
  label: string
  singularLabel?: string
  allowAdd?: boolean
  allowRemove?: boolean
  itemFields: FieldConfig[]
  value: ArrayItemWithLocalId[]
  onChange: (value: ArrayItemWithLocalId[]) => void
  onBlur?: () => void
  errors?: FieldErrorEntry[]
  disabled?: boolean
  isSubmitted?: boolean
  translationNamespace?: string
  /** Parent form values for row-scoped filterBy resolution */
  formValues?: Record<string, unknown>
  /** Per-item heading — see `ArrayFieldConfig.itemHeader`. */
  itemHeader?: (item: ArrayItemWithLocalId, index: number) => ReactNode
  /** Copy for an empty list — see `ArrayFieldConfig.emptyMessage`. */
  emptyMessage?: string
  /** Extra classes for the item list — see `ArrayFieldConfig.listClassName`. */
  listClassName?: string
  /** Slim one-line items — see `ArrayFieldConfig.compactItems`. */
  compactItems?: boolean
  /** Help text shown beside the list label, as every other field does. */
  help?: BaseFieldConfig["help"]
  /**
   * Namespace prefix for item input ids (`${idPrefix}.${index}.${field}`).
   * SchemaForm passes its instance prefix so two mounted forms sharing an
   * array name cannot emit duplicate ids. Omit to keep legacy bare ids.
   */
  idPrefix?: string
  classNames?: SchemaFormClassNames
  partClassNames?: SchemaFormPartClassNames
  fieldPath?: string
  fieldStyles?: Record<string, SchemaFormFieldStyles>
  baseClassNames?: SchemaFormClassNames
  basePartClassNames?: SchemaFormPartClassNames
}

/**
 * FieldErrors component props
 */
export interface FieldErrorsProps {
  errors: string[]
  testId?: string
  className?: string
  rowClassName?: string
}

/**
 * FileUploadField props
 */
export interface FileUploadFieldProps {
  value: string | string[] | null
  onChange: (value: string | string[] | null) => void
  disabled?: boolean
  accept?: string
  maxSizeBytes?: number
  maxFiles?: number
  maxTotalSizeBytes?: number
  uploadMode?: "auth" | "public"
}

/**
 * MapPicker props
 */
export interface MapPickerProps {
  value: MapValue | null
  onChange: (value: MapValue | null) => void
  disabled?: boolean
  radiusKm?: number
  /** Label target: the location search input is the focusable element. */
  id?: string
}

/**
 * LoadingOverlay props
 */
export interface LoadingOverlayProps {
  visible: boolean
  message?: string
}
