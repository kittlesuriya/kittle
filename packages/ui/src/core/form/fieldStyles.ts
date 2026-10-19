import type { SchemaFormFieldStyles } from "./types"
import { cn } from "../cn"

/** Match '*' against one numeric path segment, then apply exact paths last. */
export function resolveFieldStyles(
  styles: Record<string, SchemaFormFieldStyles> | undefined,
  path: string
): SchemaFormFieldStyles[] {
  if (!styles) return []
  const exact = styles[path]
  const segments = path.split(".")
  const matches = Object.entries(styles)
    .filter(([key]) => key !== path)
    .map(([key, value]) => ({ key, value, parts: key.split(".") }))
    .filter(
      ({ parts }) =>
        parts.length === segments.length &&
        parts.every(
          (part, i) =>
            part === segments[i] ||
            (part === "*" && /^\d+$/.test(segments[i] ?? ""))
        )
    )
    .sort((a, b) => {
      const specificity = (parts: string[]) =>
        parts.filter((p) => p !== "*").length
      return (
        specificity(a.parts) - specificity(b.parts) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      )
    })
  return [...matches.map(({ value }) => value), ...(exact ? [exact] : [])]
}

/** Merge slot class strings in caller-defined precedence order. */
export function mergeFieldStyles(
  ...styles: SchemaFormFieldStyles[]
): SchemaFormFieldStyles {
  const result: SchemaFormFieldStyles = {}
  const parts: NonNullable<SchemaFormFieldStyles["partClassNames"]> = {}
  for (const style of styles) {
    const classNames: Record<string, string> = {
      ...(result.classNames ?? {}),
    }
    for (const [key, value] of Object.entries(style.classNames ?? {})) {
      classNames[key] = cn(classNames[key], value)
    }
    if (Object.keys(classNames).length) result.classNames = classNames
    // A field-level generic control override follows shared primitive defaults,
    // but its own primitive-specific slots (merged below) remain more specific.
    if (style.classNames?.control) {
      const targets = {
        select: "trigger",
        multiSelect: "trigger",
        autocomplete: "input",
        password: "root",
        datePicker: "trigger",
        dateTimePicker: "trigger",
        colorPicker: "root",
      } as const
      for (const [name, slot] of Object.entries(targets)) {
        const previous = parts[name as keyof typeof targets] as
          Record<string, string> | undefined
        if (previous)
          previous[slot] = cn(previous[slot], style.classNames.control)
      }
    }
    for (const [name, value] of Object.entries(style.partClassNames ?? {})) {
      const prior = parts[name as keyof typeof parts] as
        Record<string, string> | undefined
      const next = value as Record<string, string> | undefined
      if (next) {
        const merged: Record<string, string> = { ...(prior ?? {}) }
        for (const [slot, cls] of Object.entries(next))
          merged[slot] = cn(merged[slot], cls)
        ;(parts as Record<string, unknown>)[name] = merged
      }
    }
  }
  if (Object.keys(parts).length) result.partClassNames = parts
  return result
}
