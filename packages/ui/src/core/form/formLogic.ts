// Pure business logic for form operations (no React dependencies)

import type {
  ArrayFieldConfig,
  FieldConfig,
  FormValues,
  ArrayItemWithLocalId,
} from "./types"
import { getCustomFieldDefaultValue, isCustomFieldType } from "./fieldRegistry"
import { ensureLocalIds } from "./formHelpers"

/**
 * Build default values based on field configurations
 */
export function buildDefaultValues(fields: FieldConfig[]): FormValues {
  const values: FormValues = {}

  for (const field of fields) {
    const fieldName = field.name
    switch (field.type) {
      case "number":
        values[fieldName] = undefined
        break
      case "checkbox":
      case "switch":
        values[fieldName] = false
        break
      case "array":
      case "multiselect":
        values[fieldName] = []
        break
      case "file":
        values[fieldName] = null
        break
      case "select":
      case "radio":
        // Option pickers start ABSENT, not empty. `""` fails even an
        // optional `z.enum()` ("Invalid option") and reads as "Invalid uuid"
        // on uuid selects — while users only ever pick human labels. A
        // missing required picker then fails with the schema's required /
        // format message instead of uuid jargon. (Interaction clears are
        // normalised the same way in FieldRenderer.)
        values[fieldName] = undefined
        break
      case "text":
      case "email":
      case "password":
      case "textarea":
      case "markdown":
      case "date":
      case "time":
      case "datetime":
      case "autocomplete":
        values[fieldName] = ""
        break
      case "map-picker":
        values[fieldName] = null
        break
      default:
        // Module-specific types provide their default via fieldRegistry —
        // see the relevant field registration module.
        if (isCustomFieldType(field.type)) {
          values[fieldName] = getCustomFieldDefaultValue(field.type)
          break
        }
        values[fieldName] = ""
        break
    }
  }

  return values
}

/**
 * Add local IDs to array items for tracking
 */
export function addLocalIdsToArrayItems(
  obj: FormValues | null | undefined,
  fields: FieldConfig[]
): FormValues {
  const copy: FormValues = { ...(obj ?? {}) }

  for (const field of fields) {
    if (field.type === "array" && Array.isArray(copy[field.name])) {
      copy[field.name] = ensureLocalIds(
        copy[field.name] as Record<string, unknown>[]
      )
    }
  }

  return copy
}

/**
 * Normalize form values for submission
 */
export function normalizeValues(
  raw: FormValues | null | undefined,
  fields: FieldConfig[]
): FormValues {
  const result: FormValues = {}

  for (const field of fields) {
    const value = raw?.[field.name]

    if (field.dataType === "number") {
      const n = Number(value)
      result[field.name] =
        value === "" || value === null || value === undefined || isNaN(n)
          ? undefined
          : n
      continue
    }

    if (field.dataType === "boolean") {
      result[field.name] = Boolean(value)
      continue
    }

    if (field.type === "array") {
      const arrayField = field as ArrayFieldConfig
      if (Array.isArray(value) && arrayField.arrayItemSchema) {
        result[field.name] = (value as ArrayItemWithLocalId[]).map((item) => {
          const normalized: Record<string, unknown> = {}

          for (const itemField of arrayField.arrayItemSchema) {
            const itemValue = item?.[itemField.name]

            if (itemField.dataType === "number") {
              const nItem = Number(itemValue)
              normalized[itemField.name] =
                itemValue === "" ||
                itemValue === null ||
                itemValue === undefined ||
                isNaN(nItem)
                  ? undefined
                  : nItem
            } else if (itemField.dataType === "boolean") {
              normalized[itemField.name] = Boolean(itemValue)
            } else {
              normalized[itemField.name] = itemValue
            }
          }

          return normalized
        })
      } else {
        result[field.name] = value
      }
      continue
    }

    if (field.type === "multiselect") {
      result[field.name] = Array.isArray(value) ? value : []
      continue
    }

    result[field.name] = value
  }

  return result
}
