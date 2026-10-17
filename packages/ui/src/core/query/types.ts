import type { z } from "zod"

// =============================================================================
// Operator Types
// =============================================================================

/**
 * Operator option
 */
export interface OperatorOption {
  value: string
  label: string
}

/**
 * Field types for query builder
 */
export type FilterFieldType =
  | "text"
  | "email"
  | "number"
  | "boolean"
  | "switch"
  | "select"
  | "multiselect"
  | "date"
  | "time"

export type RangeValue = [string, string] | string[]

export type FilterValue =
  | string
  | number
  | boolean
  | Array<string | number>
  | { from?: string; to?: string }
  | RangeValue
  | null

// =============================================================================
// Query Types
// =============================================================================

/**
 * Single query condition
 */
export interface QueryCondition {
  id: string
  type: "condition"
  field: string
  operator: string
  value: FilterValue
}

/**
 * Query group containing conditions or nested groups
 */
export interface QueryGroup {
  id: string
  type: "group"
  logic: "AND" | "OR"
  conditions: (QueryCondition | QueryGroup)[]
}

/**
 * Filter output (external format without IDs)
 */
export interface FilterOutput {
  logic: "AND" | "OR"
  conditions: (FilterCondition | FilterGroup)[]
}

export interface FilterCondition {
  field: string
  operator: string
  value: FilterValue
}

export interface FilterGroup {
  logic: "AND" | "OR"
  conditions: (FilterCondition | FilterGroup)[]
}

// =============================================================================
// Field Config Types
// =============================================================================

/**
 * Field configuration for query builder
 */
export interface FilterField {
  id: string
  label: string
  type: FilterFieldType
  order?: number
  operators: OperatorOption[]
  options?: Array<{ value: string | number; label: string }>
}

// =============================================================================
// Component Props
// =============================================================================

/**
 * QueryBuilder component props
 */
export interface QueryBuilderProps {
  schema: z.ZodObject<z.ZodRawShape>
  onSubmit?: (filters: (FilterOutput & { search: string }) | null) => void
  ui?: {
    defaultMode?: "advanced" | "simple"
    showModeToggle?: boolean
    allowedModes?: Array<"advanced" | "simple">
    persistMode?: boolean
  }
  className?: string
  disabled?: boolean
  defaultOpen?: boolean
  initialValue?: QueryGroup | Record<string, unknown>
  translationNamespace?: string
  embedded?: boolean
  headerLeft?: React.ReactNode
}

/**
 * QueryGroup component props
 */
export interface QueryGroupProps {
  group: QueryGroup
  fields: FilterField[]
  onUpdateCondition: (id: string, updates: Partial<QueryCondition>) => void
  onAddCondition: (groupId: string) => void
  onRemoveCondition: (id: string) => void
  onAddGroup: (parentId: string, logic?: "AND" | "OR") => void
  onRemoveGroup: (id: string) => void
  onToggleLogic: (groupId: string) => void
  isRoot?: boolean
  disabled?: boolean
  translationNamespace?: string
  depth?: number
}

/**
 * QueryCondition component props
 */
export interface QueryConditionProps {
  condition: QueryCondition
  fields: FilterField[]
  onUpdate: (id: string, updates: Partial<QueryCondition>) => void
  onRemove: (id: string) => void
  disabled?: boolean
  showDragHandle?: boolean
  translationNamespace?: string
}

/**
 * ValueInput component props
 */
export interface ValueInputProps {
  field: FilterField
  operator: string
  value: FilterValue
  onChange: (value: FilterValue) => void
  disabled?: boolean
}

// =============================================================================
// Hook Types
// =============================================================================

/**
 * useQueryBuilder hook options
 */
export interface UseQueryBuilderOptions {
  onChange?: (query: QueryGroup) => void
  initialQuery?: QueryGroup | Record<string, unknown>
}

/**
 * useQueryBuilder hook return type
 */
export interface UseQueryBuilderReturn {
  query: QueryGroup
  setQuery: React.Dispatch<React.SetStateAction<QueryGroup>>
  updateCondition: (id: string, updates: Partial<QueryCondition>) => void
  addCondition: (groupId: string) => void
  removeCondition: (id: string) => void
  addGroup: (parentId: string, logic?: "AND" | "OR") => void
  removeGroup: (id: string) => void
  toggleGroupLogic: (groupId: string) => void
  clearQuery: () => void
  buildFilterOutput: () => FilterOutput
  hasConditions: boolean
}
