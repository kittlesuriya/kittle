import {
  useEffect,
  useCallback,
  type SetStateAction,
  type Dispatch,
} from "react"
import type {
  ColumnVisibilityState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table"
import { usePersistedTableState } from "./usePersistedTableState"
import type { TableState, FilterState, TableStateSetters } from "./types"

const DEFAULT_STATE: Omit<TableState, "filters"> = {
  pagination: { pageIndex: 0, pageSize: 10 },
  sorting: [],
  columnVisibility: {},
  columnOrder: [],
}

interface UseTableQueryStateReturn extends TableStateSetters {
  tableState: TableState
}

/**
 * Hook for managing complete table query state with persistence
 */
export function useTableQueryState(
  storageKey: string,
  leafIds: string[],
  initialFilters: FilterState = {},
  initialSorting?: SortingState,
  defaultHiddenColumnIds?: Set<string>
): UseTableQueryStateReturn {
  const defaultState: TableState = {
    ...DEFAULT_STATE,
    sorting: initialSorting ?? DEFAULT_STATE.sorting,
    filters: initialFilters,
  }
  const [state, setState] = usePersistedTableState(storageKey, defaultState)

  // Sync column order when leaf columns change
  useEffect(() => {
    if (!leafIds.length) return

    setState((prev) => {
      let changed = false
      const next = { ...prev }

      const currentOrder = next.columnOrder ?? []
      const validOrder = currentOrder.filter((id) => leafIds.includes(id))
      const newIds = leafIds.filter((id) => !validOrder.includes(id))

      if (newIds.length > 0 || validOrder.length !== currentOrder.length) {
        let newOrder = [...validOrder]
        const actionsIndex = newOrder.indexOf("actions")

        let hasActions = false
        if (actionsIndex !== -1) {
          newOrder.splice(actionsIndex, 1)
          hasActions = true
        }

        newOrder = [...newOrder, ...newIds]

        if (hasActions) {
          newOrder.push("actions")
        }

        next.columnOrder = newOrder
        changed = true
      } else if (!next.columnOrder || next.columnOrder.length === 0) {
        next.columnOrder = [...leafIds]
        changed = true
      }

      // Sync visibility state
      const currentVisibility = next.columnVisibility ?? {}
      const missingVisibility = leafIds.some(
        (id) => currentVisibility[id] === undefined
      )

      if (
        !next.columnVisibility ||
        Object.keys(next.columnVisibility).length === 0 ||
        missingVisibility
      ) {
        const newVisibility: ColumnVisibilityState = { ...currentVisibility }
        for (const id of leafIds) {
          if (newVisibility[id] === undefined) {
            newVisibility[id] = !(defaultHiddenColumnIds?.has(id) ?? false)
          }
        }
        next.columnVisibility = newVisibility
        changed = true
      }

      return changed ? next : prev
    })
  }, [leafIds, setState, defaultHiddenColumnIds])

  const setPagination: Dispatch<SetStateAction<PaginationState>> = useCallback(
    (updater) => {
      setState((prev) => {
        const newPagination =
          typeof updater === "function" ? updater(prev.pagination) : updater
        return {
          ...prev,
          pagination: newPagination,
        }
      })
    },
    [setState]
  )

  const setSorting: Dispatch<SetStateAction<SortingState>> = useCallback(
    (updater) => {
      setState((prev) => ({
        ...prev,
        sorting:
          typeof updater === "function" ? updater(prev.sorting) : updater,
      }))
    },
    [setState]
  )

  const setColumnVisibility: Dispatch<SetStateAction<ColumnVisibilityState>> =
    useCallback(
      (updater) => {
        setState((prev) => ({
          ...prev,
          columnVisibility:
            typeof updater === "function"
              ? updater(prev.columnVisibility)
              : updater,
        }))
      },
      [setState]
    )

  const setColumnOrder: Dispatch<SetStateAction<string[]>> = useCallback(
    (updater) => {
      setState((prev) => ({
        ...prev,
        columnOrder:
          typeof updater === "function" ? updater(prev.columnOrder) : updater,
      }))
    },
    [setState]
  )

  const setFilters: Dispatch<SetStateAction<FilterState>> = useCallback(
    (updater) => {
      setState((prev) => ({
        ...prev,
        filters:
          typeof updater === "function" ? updater(prev.filters) : updater,
        // Reset pagination when filters change
        pagination: { ...prev.pagination, pageIndex: 0 },
      }))
    },
    [setState]
  )

  const setTableState: Dispatch<SetStateAction<TableState>> = setState

  return {
    tableState: state,
    setPagination,
    setSorting,
    setColumnVisibility,
    setColumnOrder,
    setFilters,
    setTableState,
  }
}
