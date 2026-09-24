import type { z } from "zod"
import type {
  FieldConfig,
  FieldOption,
  FieldType,
  FormLayoutConfig,
} from "./types"

export interface SchemaMetadata {
  label?: string
  helpTitle?: string
  helpBullets?: string[]
  helpExample?: string
  placeholder?: string
  inputType?: string
  options?: FieldOption[]
  optional?: boolean
  hidden?: boolean
  disabled?: boolean
  colSpan?: number
  rowSpan?: number
  order?: number
  section?: string
  group?: string
  visibleWhen?: FieldConfig["visibleWhen"]
  helpDescription?: string
  singularLabel?: string
  allowAdd?: boolean
  allowRemove?: boolean
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

const metadata = new WeakMap<z.ZodTypeAny, SchemaMetadata>()
const layouts = new WeakMap<z.ZodTypeAny, FormLayoutConfig>()

export function withMeta<T extends z.ZodTypeAny>(
  schema: T,
  value: SchemaMetadata
): T {
  metadata.set(schema, value)
  return schema
}
export function getMeta(schema: z.ZodTypeAny): SchemaMetadata | undefined {
  return metadata.get(schema)
}
export function hasMeta(schema: z.ZodTypeAny): boolean {
  return metadata.has(schema)
}
export function withFormLayout<T extends z.ZodTypeAny>(
  schema: T,
  layout: FormLayoutConfig
): T {
  layouts.set(schema, layout)
  return schema
}
export function getFormLayout(
  schema: z.ZodTypeAny
): FormLayoutConfig | undefined {
  return layouts.get(schema)
}
export function hasFormLayout(schema: z.ZodTypeAny): boolean {
  return layouts.has(schema)
}

function definition(schema: z.ZodTypeAny): Record<string, unknown> {
  return (
    (schema as z.ZodTypeAny & { _zod?: { def?: Record<string, unknown> } })._zod
      ?.def ?? {}
  )
}

function unwrap(schema: z.ZodTypeAny): {
  schema: z.ZodTypeAny
  optional: boolean
} {
  let current = schema
  let optional = false
  while (
    ["optional", "nullable", "default"].includes(
      String(definition(current).type)
    )
  ) {
    optional = true
    current = definition(current).innerType as z.ZodTypeAny
  }
  return { schema: current, optional }
}

function labelFor(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.-]/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase())
}

function enumOptions(schema: z.ZodTypeAny): FieldOption[] | undefined {
  const def = definition(schema)
  if (def.type === "enum")
    return Object.entries(
      (def.entries ?? {}) as Record<string, string | number>
    ).map(([label, value]) => ({ label, value }))
  if (def.type === "literal") {
    const value = (def.values as unknown[] | undefined)?.[0] ?? def.value
    return typeof value === "string" || typeof value === "number"
      ? [{ label: String(value), value }]
      : undefined
  }
  return undefined
}

export function schemaToFieldConfigs(
  schema: z.ZodObject,
  options: {
    field?: (
      name: string,
      schema: z.ZodTypeAny,
      metadata: SchemaMetadata
    ) => FieldConfig | undefined
  } = {}
): FieldConfig[] {
  return Object.entries(schema.shape as Record<string, z.ZodTypeAny>).map(
    ([name, original]) => {
      const meta = getMeta(original) ?? {}
      const unwrapped = unwrap(original)
      const def = definition(unwrapped.schema)
      const type = String(def.type)
      const custom = options.field?.(name, original, meta)
      if (custom) return custom
      let fieldType: FieldType = "text"
      if (type === "number") fieldType = "number"
      else if (type === "boolean")
        fieldType = meta.inputType === "switch" ? "switch" : "checkbox"
      else if (type === "date")
        fieldType = meta.inputType === "datetime" ? "datetime" : "date"
      else if (type === "enum" || type === "literal")
        fieldType = (meta.inputType as FieldType | undefined) ?? "select"
      else if (type === "array") {
        const elementSchema = def.element as z.ZodTypeAny
        const element = definition(elementSchema)
        const itemSchema =
          element.type === "object"
            ? schemaToFieldConfigs(
                elementSchema as unknown as z.ZodObject,
                options
              )
            : []
        const field: FieldConfig = {
          name,
          label: meta.label ?? labelFor(name),
          type: "array",
          arrayItemSchema: itemSchema,
          allowAdd: meta.allowAdd ?? true,
          allowRemove: meta.allowRemove ?? true,
        }
        Object.assign(field, meta)
        return field
      } else if (meta.inputType) fieldType = meta.inputType
      const field: FieldConfig = {
        name,
        label: meta.label ?? labelFor(name),
        type: fieldType,
        required: meta.optional === true ? false : !unwrapped.optional,
        dataType:
          type === "number"
            ? "number"
            : type === "boolean"
              ? "boolean"
              : type === "date"
                ? "date"
                : type === "array"
                  ? "array"
                  : "string",
      }
      if (meta.helpDescription) {
        field.help = {
          description: meta.helpDescription,
          ...(meta.helpTitle ? { title: meta.helpTitle } : {}),
          ...(meta.helpBullets ? { bullets: meta.helpBullets } : {}),
          ...(meta.helpExample ? { example: meta.helpExample } : {}),
        }
      }
      if (meta.placeholder !== undefined) field.placeholder = meta.placeholder
      const fieldOptions = enumOptions(unwrapped.schema)
      if (fieldOptions) field.options = fieldOptions
      Object.assign(field, meta)
      return field
    }
  )
}
