// State management hook for QueryBuilder

import { useState, useCallback, useMemo } from "react"
import type {
  QueryCondition,
  QueryGroup,
  FilterOutput,
  FilterField,
  UseQueryBuilderOptions,
  UseQueryBuilderReturn,
  FilterValue,
} from "./types"
import { getDefaultValueForType } from "./utils"
import {
  normalizeDisplayOperator,
  translateListOperator,
} from "./listOperators"

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a new condition
 */
function createCondition(defaultField: FilterField | null): QueryCondition {
  return {
    id: generateId(),
    type: "condition",
    field: defaultField?.id ?? "",
    operator: defaultField?.operators?.[0]?.value ?? "equals",
    value: getDefaultValueForType(defaultField?.type ?? "text"),
  }
}

/**
 * Create a new group
 */
function createGroup(
  logic: "AND" | "OR" = "AND",
  defaultField: FilterField | null = null
): QueryGroup {
  return {
    id: generateId(),
    type: "group",
    logic,
    conditions: defaultField ? [createCondition(defaultField)] : [],
  }
}

/**
 * Hydrate external query into internal state. Accepts both the ABAC display
 * vocabulary and stale/already-translated CRUD operators (`eq`, `in`, …)
 * from persisted table state, normalizing back to ABAC for the dropdowns.
 */
function hydrateQuery(
  node: QueryGroup | QueryCondition | Record<string, unknown> | null,
  fields: FilterField[] = []
): QueryGroup | QueryCondition | null {
  if (!node) return null

  const typedNode = node as Record<string, unknown>

  // Check if it's a group
  if (typedNode.logic && Array.isArray(typedNode.conditions)) {
    return {
      id: (typedNode.id as string) ?? generateId(),
      type: "group",
      logic: typedNode.logic as "AND" | "OR",
      conditions: (typedNode.conditions as unknown[])
        .map((c) => hydrateQuery(c as QueryGroup | QueryCondition, fields))
        .filter((c): c is QueryGroup | QueryCondition => c !== null),
    }
  }

  // It's a condition
  const fieldId = (typedNode.field as string) ?? ""
  const field = fields.find((candidate) => candidate.id === fieldId)
  return {
    id: (typedNode.id as string) ?? generateId(),
    type: "condition",
    field: fieldId,
    operator: normalizeDisplayOperator(
      (typedNode.operator as string) ?? "equals",
      field
    ),
    value: typedNode.value as FilterValue,
  }
}

// Canonical ABAC → CRUD operator map lives in `../utils/listOperators` so
// simple and advanced submit paths share one translation.

/**
 * Hook for managing QueryBuilder state
 */
export function useQueryBuilder(
  fields: FilterField[],
  options: UseQueryBuilderOptions = {}
): UseQueryBuilderReturn {
  const { initialQuery } = options
  const defaultField = fields[0] ?? null

  const [query, setQuery] = useState<QueryGroup>(() => {
    if (initialQuery) {
      const typedQuery = initialQuery as Record<string, unknown>

      // Check if already valid structure
      if (typedQuery.logic && Array.isArray(typedQuery.conditions)) {
        const hydrated = hydrateQuery(initialQuery, fields)
        if (hydrated && (hydrated as QueryGroup).type === "group") {
          return hydrated as QueryGroup
        }
      }

      // Handle flat filter
      const flatKeys = Object.keys(typedQuery).filter(
        (k) => k !== "search" && k !== "pagination" && k !== "sorting"
      )

      if (flatKeys.length > 0) {
        const conditions: QueryCondition[] = flatKeys.map((key) => ({
          id: generateId(),
          type: "condition",
          field: key,
          operator: "equals",
          value: typedQuery[key] as FilterValue,
        }))

        return {
          id: generateId(),
          type: "group",
          logic: "AND",
          conditions,
        }
      }
    }

    return createGroup("AND", null)
  })

  const updateCondition = useCallback(
    (conditionId: string, updates: Partial<QueryCondition>) => {
      setQuery((prev) => {
        const updateInGroup = (group: QueryGroup): QueryGroup => ({
          ...group,
          conditions: group.conditions.map((item) => {
            if (item.type === "group") {
              return updateInGroup(item)
            }
            if (item.id === conditionId) {
              return { ...item, ...updates }
            }
            return item
          }),
        })
        return updateInGroup(prev)
      })
    },
    []
  )

  const addCondition = useCallback(
    (groupId: string) => {
      setQuery((prev) => {
        const addToGroup = (group: QueryGroup): QueryGroup => {
          if (group.id === groupId) {
            return {
              ...group,
              conditions: [...group.conditions, createCondition(defaultField)],
            }
          }
          return {
            ...group,
            conditions: group.conditions.map((item) =>
              item.type === "group" ? addToGroup(item) : item
            ),
          }
        }
        return addToGroup(prev)
      })
    },
    [defaultField]
  )

  const removeCondition = useCallback((conditionId: string) => {
    setQuery((prev) => {
      const removeFromGroup = (group: QueryGroup): QueryGroup => ({
        ...group,
        conditions: group.conditions
          .filter((item) => item.id !== conditionId)
          .map((item) =>
            item.type === "group" ? removeFromGroup(item) : item
          ),
      })
      return removeFromGroup(prev)
    })
  }, [])

  const addGroup = useCallback(
    (parentGroupId: string, logic: "AND" | "OR" = "OR") => {
      setQuery((prev) => {
        const addToParent = (group: QueryGroup): QueryGroup => {
          if (group.id === parentGroupId) {
            return {
              ...group,
              conditions: [
                ...group.conditions,
                createGroup(logic, defaultField),
              ],
            }
          }
          return {
            ...group,
            conditions: group.conditions.map((item) =>
              item.type === "group" ? addToParent(item) : item
            ),
          }
        }
        return addToParent(prev)
      })
    },
    [defaultField]
  )

  const removeGroup = useCallback((groupId: string) => {
    setQuery((prev) => {
      const removeFromParent = (group: QueryGroup): QueryGroup => ({
        ...group,
        conditions: group.conditions
          .filter((item) => item.id !== groupId)
          .map((item) =>
            item.type === "group" ? removeFromParent(item) : item
          ),
      })
      return removeFromParent(prev)
    })
  }, [])

  const toggleGroupLogic = useCallback((groupId: string) => {
    setQuery((prev) => {
      const toggleInGroup = (group: QueryGroup): QueryGroup => {
        if (group.id === groupId) {
          return {
            ...group,
            logic: group.logic === "AND" ? "OR" : "AND",
          }
        }
        return {
          ...group,
          conditions: group.conditions.map((item) =>
            item.type === "group" ? toggleInGroup(item) : item
          ),
        }
      }
      return toggleInGroup(prev)
    })
  }, [])

  const clearQuery = useCallback(() => {
    setQuery(createGroup("AND", null))
  }, [])

  const buildFilterOutput = useCallback((): FilterOutput => {
    const buildGroup = (group: QueryGroup): FilterOutput => {
      const validConditions = group.conditions
        .map((item) => {
          if (item.type === "group") {
            const nested = buildGroup(item)
            return nested.conditions.length > 0 ? nested : null
          }
          if (!item.field) return null
          return {
            field: item.field,
            // The filter UI speaks the ABAC policy vocabulary (conditionFields),
            // but Kittle list endpoints only accept the CRUD vocabulary
            // (filterInterop.js OPERATOR_MAP). Translate at this single choke
            // point so every DataTable filter works; unknown operators pass
            // through untouched (contains/startsWith are valid in both).
            operator: translateListOperator(item.operator),
            value: item.value,
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)

      return {
        logic: group.logic,
        conditions: validConditions,
      }
    }

    return buildGroup(query)
  }, [query])

  const hasConditions = useMemo(() => {
    const checkGroup = (group: QueryGroup): boolean =>
      group.conditions.some((item) => {
        if (item.type === "group") return checkGroup(item)
        return item.field !== ""
      })
    return checkGroup(query)
  }, [query])

  return {
    query,
    setQuery,
    updateCondition,
    addCondition,
    removeCondition,
    addGroup,
    removeGroup,
    toggleGroupLogic,
    clearQuery,
    buildFilterOutput,
    hasConditions,
  }
}
