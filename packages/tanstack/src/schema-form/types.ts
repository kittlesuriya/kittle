import type { ComponentType, ReactNode, RefObject } from "react"
import type { z } from "zod"
import type { UiConfig } from "../ui"

export type FieldType =
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
  | (string & {})

export interface FieldOption {
  label: string
  value: string | number
  [key: string]: unknown
}
export interface GroupedFieldOptions {
  heading: string
  options: FieldOption[]
}

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

export interface FormGroupConfig {
  id: string
  title?: string
  description?: string
  icon?: string
  fields: string[]
  columns?: 1 | 2 | 3 | 4
  colSpan?: 1 | 2 | 3 | 4
  rowSpan?: 1 | 2 | 3 | 4
}

export interface FormSectionConfig {
  id: string
  title: string
  description?: string
  icon?: string
  order?: number
  collapsible?: boolean
  defaultOpen?: boolean
  groups?: FormGroupConfig[]
  fields?: string[]
}

export interface FormLayoutConfig {
  sections: FormSectionConfig[]
  groups?: FormGroupConfig[]
}
export interface ResolvedFormGroup extends Omit<FormGroupConfig, "fields"> {
  fields: FieldConfig[]
}
export interface ResolvedFormSection extends Omit<
  FormSectionConfig,
  "groups" | "fields"
> {
  groups: ResolvedFormGroup[]
  fields: FieldConfig[]
}
export interface ResolvedFormLayout {
  sections: ResolvedFormSection[]
}

export interface FieldConfig {
  name: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  options?: FieldOption[] | GroupedFieldOptions[]
  description?: ReactNode
  hidden?: boolean
  disabled?: boolean
  colSpan?: number
  rowSpan?: number
  order?: number
  visibleWhen?: VisibilityCondition | VisibilityCondition[]
  dataType?: "string" | "number" | "boolean" | "date" | "object" | "array"
  section?: string
  group?: string
  help?: {
    title?: string
    description: string
    bullets?: string[]
    example?: string
  }
  arrayItemSchema?: FieldConfig[]
  allowAdd?: boolean
  allowRemove?: boolean
  singularLabel?: string
  excludeFrom?: string
  filterBy?: { field: string; optionKey: string }
  accept?: string
  maxSizeBytes?: number
  maxFiles?: number
  maxTotalSizeBytes?: number
  minFiles?: number
  uploadMode?: "auth" | "public"
  emptyIndicator?: string
  maxCount?: number
  height?: number
  preview?: "live" | "edit" | "preview"
  [key: string]: unknown
}

export interface CustomFieldProps {
  field: FieldConfig
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  error?: string
}

export type FieldRegistry = Record<string, ComponentType<CustomFieldProps>>
export type FieldErrors = Record<string, string[]>
export type ValidationMode = "submit" | "blur" | "change"
export type SubmissionGuard = () => string | null

export interface FormInstance {
  reset: (options?: { values?: Record<string, unknown> }) => void
  handleSubmit: () => Promise<void>
  setFieldValue: (field: string, value: unknown) => void
  registerGuard: (key: string, guard: SubmissionGuard) => () => void
  state: {
    isDirty: boolean
    isSubmitted: boolean
    isSubmitting: boolean
    canSubmit: boolean
    values: Record<string, unknown>
  }
}

export interface FieldSlotContext {
  form: FormInstance
  values: Record<string, unknown>
  field: { value: unknown; handleChange: (value: unknown) => void }
}

export interface FieldRendererProps {
  cfg: FieldConfig
  id?: string
  value: unknown
  onChange: (value: unknown) => void
  onBlur?: () => void
  disabled?: boolean
  errors?: string[]
  isSubmitted?: boolean
  formValues?: Record<string, unknown>
}

export interface RenderActionsProps {
  form: FormInstance
  canSubmit: boolean
  isSubmitting: boolean
  onCancel?: () => void
  onReset?: () => void
}

export interface SchemaFormProps<T extends z.ZodTypeAny> {
  children?: ReactNode
  schema: T
  fields?: FieldConfig[]
  defaultValues?: Partial<z.infer<T>>
  onSubmit?: (values: z.infer<T>) => void | Promise<void>
  submitLabel?: string
  disabled?: boolean
  disabledFields?: string[]
  fieldRegistry?: FieldRegistry
  components?: UiConfig | undefined
  className?: string
  validationMode?: ValidationMode
  formKey?: string | number
  formRef?: RefObject<FormInstance | null>
  serverErrors?: FieldErrors
  onFieldChange?: (name: string, value: unknown) => void
  onCancel?: () => void
  onReset?: () => void
  hideActions?: boolean
  renderActions?: (props: {
    form: FormInstance
    canSubmit: boolean
    isSubmitting: boolean
    onCancel?: () => void
    onReset?: () => void
  }) => ReactNode
  isLoading?: boolean
  loadingMessage?: string
  layout?: FormLayoutConfig
  iconResolver?: (key: string) => ReactNode
  enableNavigationGuard?: boolean
  navigationGuardMessage?: string
  fieldSlots?: Record<string, (context: FieldSlotContext) => ReactNode>
  customFieldRenderer?: ComponentType<FieldRendererProps>
}
