import type { ReactNode } from "react"
import type { UiConfig } from "../ui"

export type FilterValue =
  | string
  | number
  | boolean
  | Array<string | number>
  | { from?: string; to?: string }
  | null

export interface FilterField {
  id: string
  label: string
  type?:
    | "text"
    | "email"
    | "number"
    | "boolean"
    | "switch"
    | "select"
    | "multiselect"
    | "date"
    | "time"
  order?: number
  operators?: Array<string | { value: string; label: string }>
  options?: Array<{ value: string | number; label: string }>
}

export interface FilterCondition {
  field: string
  operator: string
  value: FilterValue
}

export interface FilterGroup {
  logic: "AND" | "OR"
  conditions: Array<FilterCondition | FilterGroup>
}

export type FilterOutput = FilterGroup

export interface QueryBuilderProps {
  fields: FilterField[]
  value?: FilterOutput
  onChange?: (value: FilterOutput) => void
  onSubmit?: (value: FilterOutput & { search: string }) => void
  allowNestedGroups?: boolean
  disabled?: boolean
  defaultOpen?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  showModeToggle?: boolean
  initialMode?: "simple" | "advanced"
  persistKey?: string
  embedded?: boolean
  headerLeft?: ReactNode
  renderFieldValue?: QueryBuilderUiComponents["renderFieldValue"]
  components?: UiConfig | undefined
  className?: string
}

export interface QueryBuilderUiComponents {
  renderFieldValue?: (context: {
    field: FilterField
    value: FilterValue
    onChange: (value: FilterValue) => void
    disabled: boolean
  }) => ReactNode
}
