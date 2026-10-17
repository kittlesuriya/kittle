// Convert Zod schema to field configurations
import { z } from "zod"
import { getMeta, type SchemaMetadata } from "./schemaMetadata"
import { getCustomFieldParser } from "./fieldRegistry"
import type {
  FieldConfig,
  FieldType,
  FieldOption,
  BaseFieldConfig,
  ArrayFieldConfig,
} from "./types"

function unwrapZodType(type: z.ZodTypeAny): z.ZodTypeAny {
  if (type instanceof z.ZodOptional || type instanceof z.ZodNullable) {
    return unwrapZodType(type.unwrap() as z.ZodTypeAny)
  }
  if (type instanceof z.ZodDefault) {
    return unwrapZodType(type.removeDefault() as z.ZodTypeAny)
  }
  // Safe check for ZodEffects using typeName to avoid runtime errors
  // if ZodEffects class is not available on the z object
  const def = (type as { _def?: { typeName?: string; schema?: z.ZodTypeAny } })
    ._def
  if (def?.typeName === "ZodEffects" && def.schema) {
    return unwrapZodType(def.schema)
  }
  const pipe = type as { type?: string; out?: z.ZodTypeAny }
  if (pipe?.type === "pipe" && pipe.out) {
    return unwrapZodType(pipe.out)
  }
  return type
}

/**
 * Check if field is required
 */
function isOptionalUnion(type: z.ZodTypeAny): boolean {
  const def = (
    type as z.ZodTypeAny & {
      _def?: { typeName?: string; options?: z.ZodTypeAny[] }
    }
  )._def
  if (!def) return false
  if (def.typeName !== "ZodUnion" && def.typeName !== "ZodDiscriminatedUnion")
    return false
  const options = def.options ?? []
  return options.some((option) => {
    if (!option) return true
    if (option instanceof z.ZodLiteral && option.value === "") {
      return true
    }
    return !isRequired(option)
  })
}

function isRequired(type: z.ZodTypeAny): boolean {
  if (type instanceof z.ZodOptional) return false
  if (type instanceof z.ZodNullable) return false
  if (type instanceof z.ZodDefault) return false

  // Safe check for ZodEffects
  const def = (type as { _def?: { typeName?: string; schema?: z.ZodTypeAny } })
    ._def
  if (def?.typeName === "ZodEffects" && def.schema) {
    return isRequired(def.schema)
  }

  const pipe = type as { type?: string; out?: z.ZodTypeAny }
  if (pipe?.type === "pipe" && pipe.out) {
    return isRequired(pipe.out)
  }

  if (isOptionalUnion(type)) return false
  return true
}

/**
 * Check if ZodString has email validation
 */
function hasEmailCheck(type: z.ZodTypeAny): boolean {
  if (type instanceof z.ZodString) {
    const checks = (type._def as { checks?: Array<{ kind: string }> })?.checks
    if (Array.isArray(checks)) {
      return checks.some((c) => c.kind === "email")
    }
  }
  return false
}

function humanizeLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (s) => s.toUpperCase())
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024

/**
 * Convert Zod schema to field configurations
 */
function unwrapToObjectSchema(
  schema: z.ZodTypeAny
): z.ZodObject<z.ZodRawShape> {
  if (schema instanceof z.ZodObject) {
    return schema
  }

  const def = (
    schema as { _def?: { typeName?: string; schema?: z.ZodTypeAny } }
  )._def
  if (def?.typeName === "ZodEffects" && def.schema) {
    return unwrapToObjectSchema(def.schema)
  }

  throw new Error(
    "SchemaForm expects a ZodObject (or ZodEffects wrapping a ZodObject)"
  )
}

export function zodToFields(schema: z.ZodTypeAny): FieldConfig[] {
  const objectSchema = unwrapToObjectSchema(schema)
  const shape = objectSchema.shape
  const entries = Object.entries(shape)

  return entries.map(([name, zodType], index) => {
    const typeAny = zodType as z.ZodTypeAny
    const inner = unwrapZodType(typeAny)

    // Get metadata
    let metadata: SchemaMetadata = getMeta(typeAny) ?? {}
    const description = typeAny.description
    let label = humanizeLabel(name)

    // Parse metadata from description if no WeakMap metadata
    if (Object.keys(metadata).length === 0 && description) {
      try {
        const parsed = JSON.parse(description) as SchemaMetadata
        metadata = parsed
        if (metadata.label) {
          label = metadata.label
        }
      } catch {
        label = description
      }
    } else if (metadata.label) {
      label = metadata.label
    }

    let type: FieldType = "text"
    let dataType: BaseFieldConfig["dataType"] = "string"
    let options: FieldOption[] | undefined
    let arrayItemSchema: FieldConfig[] | undefined

    // Type deduction
    if (inner instanceof z.ZodNumber || inner instanceof z.ZodBigInt) {
      type = "number"
      dataType = "number"
    } else if (inner instanceof z.ZodBoolean) {
      type = "switch"
      dataType = "boolean"
    } else if (inner instanceof z.ZodEnum) {
      type = "select"
      dataType = "string"
      options = (inner.options as string[]).map((value) => ({
        value,
        label: humanizeLabel(value),
      }))
    } else if (inner instanceof z.ZodDate) {
      type = "date"
      dataType = "date"
    } else if (inner instanceof z.ZodArray) {
      type = "array"
      dataType = "array"
      const itemType = inner.element
      if (itemType instanceof z.ZodObject) {
        arrayItemSchema = zodToFields(itemType)
      }
    } else if (inner instanceof z.ZodObject) {
      dataType = "object"
    }

    // Email detection
    if (inner instanceof z.ZodString) {
      if (hasEmailCheck(inner) || /email/i.test(name)) {
        type = "email"
      }
    }

    let required = isRequired(typeAny)
    if (metadata.optional) {
      required = false
    }

    // Override from metadata
    if (metadata.inputType) {
      type = metadata.inputType
    }

    if (metadata.options) {
      options = metadata.options
    }

    const minFiles =
      typeof metadata.minFiles === "number"
        ? metadata.minFiles
        : type === "file"
          ? 1
          : undefined
    const maxFiles =
      typeof metadata.maxFiles === "number"
        ? metadata.maxFiles
        : type === "file"
          ? 1
          : undefined
    const maxSizeBytes =
      typeof metadata.maxSizeBytes === "number"
        ? metadata.maxSizeBytes
        : type === "file"
          ? DEFAULT_MAX_FILE_SIZE_BYTES
          : undefined
    const maxTotalSizeBytes =
      typeof metadata.maxTotalSizeBytes === "number"
        ? metadata.maxTotalSizeBytes
        : undefined

    // Build field config based on type
    const baseConfig = {
      name,
      label,
      help: metadata.helpDescription
        ? {
            title: metadata.helpTitle,
            description: metadata.helpDescription,
            bullets: metadata.helpBullets,
            example: metadata.helpExample,
          }
        : undefined,
      type,
      dataType,
      required,
      order: metadata.order ?? index + 1,
      colSpan: (metadata.colSpan ?? 12) as FieldConfig["colSpan"],
      placeholder: metadata.placeholder,
      disabled: metadata.disabled,
      visibleWhen: metadata.visibleWhen,
      hidden: metadata.hidden,
      excludeFrom: metadata.excludeFrom,
      filterBy: metadata.filterBy,
      section: metadata.section,
      group: metadata.group,
    }

    if (type === "array" && arrayItemSchema) {
      return {
        ...baseConfig,
        type: "array" as const,
        singularLabel: metadata.singularLabel,
        allowAdd: metadata.allowAdd,
        allowRemove: metadata.allowRemove,
        arrayItemSchema,
        itemHeader: metadata.itemHeader as ArrayFieldConfig["itemHeader"],
        emptyMessage: metadata.emptyMessage,
        listClassName: metadata.listClassName,
        compactItems: metadata.compactItems,
      }
    }

    if (type === "file") {
      return {
        ...baseConfig,
        type: "file" as const,
        accept: metadata.accept,
        maxSizeBytes,
        maxTotalSizeBytes,
        minFiles,
        maxFiles,
        uploadMode: metadata.uploadMode,
        uploadEndpoint: metadata.uploadEndpoint,
        metaEndpoint: metadata.metaEndpoint,
      }
    }

    if (type === "select" || type === "radio" || type === "autocomplete") {
      return {
        ...baseConfig,
        type: type as "select" | "radio" | "autocomplete",
        options,
        emptyIndicator: metadata.emptyIndicator,
      }
    }

    if (type === "multiselect") {
      return {
        ...baseConfig,
        type: "multiselect" as const,
        options,
        getDescendantValues:
          typeof metadata.getDescendantValues === "function"
            ? metadata.getDescendantValues
            : undefined,
      }
    }

    if (type === "markdown") {
      return {
        ...baseConfig,
        type: "markdown" as const,
        height:
          typeof metadata.height === "number" ? metadata.height : undefined,
        preview:
          typeof metadata.preview === "string" ? metadata.preview : undefined,
      }
    }

    // Module-specific (custom) types are parsed by their registered handler —
    // The global spec stays domain-free; feature modules may register renderers.
    const customParser = getCustomFieldParser(type)
    if (customParser) {
      return {
        ...baseConfig,
        type,
        ...customParser(metadata),
      }
    }

    return baseConfig
  })
}

// Re-export as parseZodSchema for compatibility
export const parseZodSchema = zodToFields
