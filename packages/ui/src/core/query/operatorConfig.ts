// Operator configuration for query builder

import type { FilterFieldType, OperatorOption } from "./types"

export const OPERATORS: Record<FilterFieldType, OperatorOption[]> = {
  text: [
    { value: "equals", label: "Equals" },
    { value: "notEquals", label: "Not Equals" },
    { value: "contains", label: "Contains" },
    { value: "startsWith", label: "Starts With" },
    { value: "endsWith", label: "Ends With" },
    { value: "isEmpty", label: "Is Empty" },
    { value: "isNotEmpty", label: "Is Not Empty" },
  ],
  email: [
    { value: "equals", label: "Equals" },
    { value: "contains", label: "Contains" },
    { value: "isEmpty", label: "Is Empty" },
    { value: "isNotEmpty", label: "Is Not Empty" },
  ],
  number: [
    { value: "equals", label: "=" },
    { value: "notEquals", label: "≠" },
    { value: "greaterThan", label: ">" },
    { value: "lessThan", label: "<" },
    { value: "greaterOrEqual", label: "≥" },
    { value: "lessOrEqual", label: "≤" },
  ],
  boolean: [
    { value: "isTrue", label: "Is True" },
    { value: "isFalse", label: "Is False" },
  ],
  switch: [
    { value: "isTrue", label: "Is True" },
    { value: "isFalse", label: "Is False" },
  ],
  select: [
    { value: "equals", label: "Equals" },
    { value: "notEquals", label: "Not Equals" },
  ],
  multiselect: [
    { value: "includesAny", label: "Includes Any" },
    { value: "includesAll", label: "Includes All" },
    { value: "isEmpty", label: "Is Empty" },
    { value: "isNotEmpty", label: "Is Not Empty" },
  ],
  date: [
    { value: "equals", label: "Equals" },
    { value: "notEquals", label: "Not Equals" },
    { value: "before", label: "Before" },
    { value: "after", label: "After" },
    { value: "between", label: "Between" },
  ],
  time: [
    { value: "equals", label: "Equals" },
    { value: "before", label: "Before" },
    { value: "after", label: "After" },
  ],
}

export const NO_VALUE_OPERATORS = [
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isFalse",
] as const

export const RANGE_OPERATORS = ["between"] as const

/**
 * Get operators for a field type
 */
export function getOperatorsForType(type: FilterFieldType): OperatorOption[] {
  return OPERATORS[type] ?? OPERATORS.text
}

/**
 * Check if an operator requires a value
 */
export function operatorNeedsValue(operator: string): boolean {
  return !NO_VALUE_OPERATORS.includes(
    operator as (typeof NO_VALUE_OPERATORS)[number]
  )
}

/**
 * Check if an operator requires a range
 */
export function operatorNeedsRange(operator: string): boolean {
  return RANGE_OPERATORS.includes(operator as (typeof RANGE_OPERATORS)[number])
}
