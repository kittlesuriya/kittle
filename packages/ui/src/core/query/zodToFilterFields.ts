// Parse Zod schema into filterable field configs for QueryBuilder

import { z } from "zod"
import { getMeta, type SchemaMetadata } from "../form/schemaMetadata"
import { getOperatorsForType } from "./operatorConfig"
import type { FilterField, FilterFieldType, FilterValue } from "./types"

function unwrapZodType(type: z.ZodTypeAny): z.ZodTypeAny {
  if (type instanceof z.ZodOptional || type instanceof z.ZodNullable) {
    return unwrapZodType(type.unwrap() as z.ZodTypeAny)
  }
  if (type instanceof z.ZodDefault) {
    return unwrapZodType(type.removeDefault() as z.ZodTypeAny)
  }
  return type
}

function humanizeLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (s) => s.toUpperCase())
}

function hasEmailCheck(type: z.ZodTypeAny): boolean {
  if (type instanceof z.ZodString) {
    const checks = (type._def as { checks?: Array<{ kind: string }> })?.checks
    if (Array.isArray(checks)) {
      return checks.some((c) => c.kind === "email")
    }
  }
  return false
}

interface ZodToFilterOptions {
  excludeFields?: string[]
}

/**
 * Parse Zod schema into filterable field configurations
 */
export function zodToFilterFields<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  options: ZodToFilterOptions = {}
): FilterField[] {
  const { excludeFields = [] } = options
  const shape = schema.shape
  const entries = Object.entries(shape)
  const fields: FilterField[] = []

  for (const [name, zodType] of entries) {
    if (excludeFields.includes(name)) continue

    const typeAny = zodType as z.ZodTypeAny
    const inner = unwrapZodType(typeAny)
    let metadata = (getMeta(typeAny) ?? {}) as SchemaMetadata & {
      excludeFromFilter?: boolean
    }

    const description = typeAny.description
    if (Object.keys(metadata).length === 0 && description) {
      try {
        metadata = {
          ...(JSON.parse(description) as SchemaMetadata & {
            excludeFromFilter?: boolean
          }),
        }
      } catch {
        // ignore malformed descriptions
      }
    }

    if (metadata.excludeFromFilter === true) continue

    const skipTypes = ["file", "array", "textarea", "map-picker"]
    if (metadata.inputType && skipTypes.includes(metadata.inputType)) continue

    let label = metadata.label
    if (!label || label === name) {
      label = humanizeLabel(name)
    }
    if (/\b(?:id|ID)\b/i.test(label)) {
      const cleaned = label.replace(/\s*\b(?:id|ID)\b/g, "").trim()
      if (cleaned.length > 0) {
        label = cleaned
      }
    }

    let type: FilterFieldType = "text"
    let options: FilterField["options"]

    // Determine type
    if (inner instanceof z.ZodNumber || inner instanceof z.ZodBigInt) {
      type = "number"
    } else if (inner instanceof z.ZodBoolean) {
      type = "boolean"
    } else if (inner instanceof z.ZodEnum) {
      type = "select"
      options = (inner.options as string[]).map((value) => ({
        value,
        label: humanizeLabel(value),
      }))
    } else if (inner instanceof z.ZodDate) {
      type = "date"
    } else if (inner instanceof z.ZodArray) {
      if (metadata.inputType === "multiselect") {
        type = "multiselect"
        options = metadata.options
      } else {
        continue
      }
    }

    // Email detection
    if (inner instanceof z.ZodString) {
      if (hasEmailCheck(inner) || /email/i.test(name)) {
        type = "email"
      }
    }

    // Override from metadata
    if (metadata.inputType === "select") {
      type = "select"
      options = metadata.options
    } else if (metadata.inputType === "multiselect") {
      type = "multiselect"
      options = metadata.options
    } else if (metadata.inputType === "switch") {
      type = "switch"
    } else if (metadata.inputType === "date") {
      type = "date"
    } else if (metadata.inputType === "time") {
      type = "time"
    }

    // Normalize option labels to have first letter capitalized (e.g., active -> Active)
    const normalizedOptions = options?.map((opt) => {
      const lbl = String(opt.label ?? "")
      if (lbl.length === 0) return opt
      const capitalized = lbl.charAt(0).toUpperCase() + lbl.slice(1)
      return { ...opt, label: capitalized }
    })

    fields.push({
      id: name,
      label,
      type,
      order: metadata.order,
      options: normalizedOptions ?? [],
      operators: getOperatorsForType(type),
    })
  }

  return fields.sort((a, b) => {
    const oa = a.order ?? Number.MAX_SAFE_INTEGER
    const ob = b.order ?? Number.MAX_SAFE_INTEGER
    if (oa !== ob) return oa - ob
    return a.label.localeCompare(b.label)
  })
}

/**
 * Get default value for field type
 */
export function getDefaultValueForType(type: FilterFieldType): FilterValue {
  switch (type) {
    case "number":
      return ""
    case "boolean":
    case "switch":
      return null
    case "multiselect":
      return [] as Array<string | number>
    case "date":
    case "time":
      return ""
    default:
      return ""
  }
}
