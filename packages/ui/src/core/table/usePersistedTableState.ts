import {
  useState,
  useCallback,
  type SetStateAction,
  type Dispatch,
} from "react"
import type { TableState, FilterState } from "./types"

/**
 * Default table state with filters support
 */
interface PersistedState extends TableState {
  filters: FilterState
}

/**
 * Hook for persisting table state to localStorage
 */
export function usePersistedTableState(
  storageKey: string,
  defaultState: PersistedState
): [PersistedState, Dispatch<SetStateAction<PersistedState>>] {
  const [state, setStateInternal] = useState<PersistedState>(() => {
    if (typeof window === "undefined") return defaultState

    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>
        const merged: PersistedState = { ...defaultState, ...parsed }

        // Deep merge filters to ensure active defaults are preserved
        if (defaultState.filters) {
          let storedFilters = parsed.filters ?? {}

          // Check if stored filters is an "Empty QueryBuilder State"
          // If so, ignore it to allow defaults to take over
          const conditions = storedFilters.conditions
          const search = storedFilters.search

          if (
            Array.isArray(conditions) &&
            conditions.length === 0 &&
            (!search || (typeof search === "string" && !search.trim()))
          ) {
            storedFilters = {}
          }

          merged.filters = { ...defaultState.filters, ...storedFilters }
        }

        return merged
      }
      return defaultState
    } catch {
      return defaultState
    }
  })

  const setState = useCallback(
    (action: SetStateAction<PersistedState>) => {
      setStateInternal((prevState) => {
        const newState =
          typeof action === "function" ? action(prevState) : action

        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(newState))
          } catch {
            // Ignore storage errors (quota exceeded, etc.)
          }
        }

        return newState
      })
    },
    [storageKey]
  )

  return [state, setState]
}
