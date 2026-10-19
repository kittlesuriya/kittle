import { cn } from "../cn"
import type {
  QueryBuilderClassNames,
  QueryBuilderFieldStyles,
  QueryBuilderPartClassNames,
} from "./types"

/** Merge shared builder styles with one field's overrides, slot by slot. */
export function resolveQueryBuilderFieldStyles(
  classNames: QueryBuilderClassNames | undefined,
  partClassNames: QueryBuilderPartClassNames | undefined,
  fieldStyles: QueryBuilderFieldStyles | undefined
): {
  classNames: QueryBuilderClassNames
  partClassNames: QueryBuilderPartClassNames
} {
  const resolvedClassNames = { ...classNames, ...fieldStyles?.classNames }
  for (const key of Object.keys(fieldStyles?.classNames ?? {}) as Array<
    keyof NonNullable<QueryBuilderFieldStyles["classNames"]>
  >) {
    const shared = classNames?.[key]
    const field = fieldStyles?.classNames?.[key]
    resolvedClassNames[key] = cn(shared, field) || undefined
  }

  const parts: QueryBuilderPartClassNames = { ...partClassNames }
  const overrides = fieldStyles?.partClassNames
  for (const key of ["fieldSelect", "operatorSelect", "valueSelect"] as const) {
    const shared = partClassNames?.[key]
    const field = overrides?.[key]
    if (shared || field) {
      const target: { trigger?: string; content?: string; item?: string } = {
        ...shared,
        ...field,
      }
      for (const slot of ["trigger", "content", "item"] as const) {
        target[slot] = cn(shared?.[slot], field?.[slot]) || undefined
      }
      const genericSlot =
        key === "valueSelect"
          ? "selectTrigger"
          : key === "fieldSelect"
            ? "fieldSelectTrigger"
            : "operatorSelectTrigger"
      target.trigger =
        cn(
          shared?.trigger,
          fieldStyles?.classNames?.[genericSlot],
          field?.trigger
        ) || undefined
      parts[key] = target
    }
  }
  if (partClassNames?.multiSelect || overrides?.multiSelect) {
    const shared = partClassNames?.multiSelect
    const field = overrides?.multiSelect
    const merged = { ...shared, ...field }
    for (const slot of Object.keys(merged) as Array<keyof typeof merged>) {
      merged[slot] = cn(shared?.[slot], field?.[slot]) || undefined
    }
    merged.trigger =
      cn(
        shared?.trigger,
        fieldStyles?.classNames?.multiSelect,
        field?.trigger
      ) || undefined
    parts.multiSelect = merged
  }
  return { classNames: resolvedClassNames, partClassNames: parts }
}
