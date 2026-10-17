// Schema metadata storage using WeakMap
import type { ReactNode } from "react"
import type { z } from "zod"
import type { FieldConfig, FormLayoutConfig } from "./types"

/**
 * Metadata that can be attached to a Zod schema
 */
export interface SchemaMetadata {
  label?: string
  helpTitle?: string
  helpDescription?: string
  helpBullets?: string[]
  helpExample?: string
  placeholder?: string
  colSpan?: number
  order?: number
  inputType?: string
  options?: Array<{ label: string; value: string | number }>
  singularLabel?: string
  allowAdd?: boolean
  allowRemove?: boolean
  /** Array fields: per-item heading — see `ArrayFieldConfig.itemHeader`. */
  itemHeader?: (item: unknown, index: number) => ReactNode
  /** Array fields: copy for an empty list — see `ArrayFieldConfig.emptyMessage`. */
  emptyMessage?: string
  /** Array fields: extra classes for the item list — see `ArrayFieldConfig.listClassName`. */
  listClassName?: string
  excludeFrom?: string
  filterBy?: { field: string; optionKey: string }
  visibleWhen?: FieldConfig["visibleWhen"]
  hidden?: boolean
  /** Declarative section placement — see `utils/layout.ts`. */
  section?: string
  /** Declarative group placement — see `utils/layout.ts`. */
  group?: string
  asyncValidator?: unknown
  accept?: string
  maxSizeBytes?: number
  maxTotalSizeBytes?: number
  minFiles?: number
  maxFiles?: number
  disabled?: boolean
  emptyIndicator?: string
  optional?: boolean
  uploadMode?: "auth" | "public"
  uploadEndpoint?: string
  metaEndpoint?: string
  // Module-specific props (roundOff,
  // branchId/linkage, ...) flow through here and are picked up by the
  // registered custom-field parsers.
  [key: string]: unknown
}

// Store metadata in WeakMap
const metaMap = new WeakMap<z.ZodTypeAny, SchemaMetadata>()

// Store form layouts in WeakMap. Note that a schema rebuilt on every render
// (for example one whose `withMeta` labels come from `t()`) will not be found
// here — pass `layout` to SchemaForm instead so translated titles re-resolve.
const formLayoutMap = new WeakMap<z.ZodTypeAny, FormLayoutConfig>()

/**
 * Attach a declarative section/group layout to a schema
 */
export function withFormLayout<T extends z.ZodTypeAny>(
  schema: T,
  layout: FormLayoutConfig
): T {
  formLayoutMap.set(schema, layout)
  return schema
}

/**
 * Retrieve the layout attached to a schema
 */
export function getFormLayout(
  schema: z.ZodTypeAny
): FormLayoutConfig | undefined {
  return formLayoutMap.get(schema)
}

/**
 * Check whether a schema has an attached form layout
 */
export function hasFormLayout(schema: z.ZodTypeAny): boolean {
  return formLayoutMap.has(schema)
}

/**
 * Attach metadata to a Zod schema
 */
export function withMeta<T extends z.ZodTypeAny>(
  schema: T,
  metadata: SchemaMetadata
): T {
  metaMap.set(schema, metadata)
  return schema
}

/**
 * Retrieve metadata from a Zod schema
 */
export function getMeta(schema: z.ZodTypeAny): SchemaMetadata | undefined {
  return metaMap.get(schema)
}

/**
 * Check if a schema has metadata
 */
export function hasMeta(schema: z.ZodTypeAny): boolean {
  return metaMap.has(schema)
}
