import { useCallback, useEffect, useMemo, useState } from "react"
import { useUiRuntime } from "../../../core/runtime"
import type { ModalType } from "../../../core/table/types"

/**
 * Row data with required id field
 */
interface RowWithId {
  id: string | number
  [key: string]: unknown
}

/**
 * Modal state
 */
interface ModalState<TData> {
  open: boolean
  type: ModalType
  data: TData | null
}

/**
 * Return type for useTableUrlState
 */
interface UseTableUrlStateReturn<TData> {
  modalOpen: boolean
  setModalOpen: (open: boolean) => void
  modalType: ModalType
  rowData: TData | null
  openAdd: () => void
  openOperation: (type: string, data: TData | null) => void
  setModalType: (type: ModalType) => void
  setRowData: (data: TData | null) => void
}

/**
 * Hook for URL-synced modal state for DataTable
 * URL format: ?action=<operation>&id=<rowId>
 */
export function useTableUrlState<TData extends RowWithId>(
  rows: TData[],
  isLoading = false
): UseTableUrlStateReturn<TData> {
  const runtime = useUiRuntime()
  const navigation = runtime.navigation
  const navigate = navigation?.navigate

  const searchParams = useMemo(
    () => new URLSearchParams(navigation?.search ?? ""),
    [navigation?.search]
  )
  const pathname = navigation?.pathname ?? ""

  const action = searchParams.get("action")
  const id = searchParams.get("id")

  const [isClosing, setIsClosing] = useState(false)
  const [closingAction, setClosingAction] = useState<{
    type: string | null
    id: string | null
  } | null>(null)

  const [modalState, setModalState] = useState<ModalState<TData>>({
    // Seed state from the URL. This matters for a full reload: the table can
    // render its loading state before URL synchronization gets a chance to
    // run, especially under an ssr:false platform route.
    open: Boolean(action),
    type: action,
    data: null,
  })

  const resolveRowData = useCallback(
    (
      actionType: string | null,
      rowId: string | null,
      currentRows: TData[]
    ): TData | null => {
      if (!rowId || actionType === "add") return null
      return currentRows.find((row) => String(row.id) === String(rowId)) ?? null
    },
    []
  )

  // Sync state from URL inside useEffect to avoid updating router/state during render
  useEffect(() => {
    let effectivelyClosing = isClosing
    if (isClosing && closingAction) {
      const isSameAction =
        closingAction.type === action &&
        String(closingAction.id ?? "") === String(id ?? "")
      if (!action || !isSameAction) {
        effectivelyClosing = false
        setIsClosing(false)
        setClosingAction(null)
      }
    }

    if (!effectivelyClosing) {
      if (!action) {
        if (modalState.open || modalState.type || modalState.data) {
          setModalState({ open: false, type: null, data: null })
        }
      } else if (action === "add") {
        // `add` is a table-level operation with no row to resolve. It must
        // still be restored from the URL on a full reload.
        if (
          modalState.open !== true ||
          modalState.type !== "add" ||
          modalState.data !== null
        ) {
          setModalState({ open: true, type: "add", data: null })
        }
      } else {
        const data = resolveRowData(action, id, rows)
        const currentDataId = modalState.data?.id ?? null
        const newDataId = data?.id ?? null

        const isSameState =
          modalState.open === true &&
          modalState.type === action &&
          String(currentDataId) === String(newDataId)

        if (!isSameState) {
          if (data) {
            // Row found in current page → open modal
            setModalState({
              open: true,
              type: action,
              data,
            })
          } else if (id && !isLoading) {
            // Once the request has settled, the row is not available (deep-link
            // to a page 2+ row, or a stale link). Do not clear during the
            // reload/loading transition: doing so loses a valid deep link
            // before the server can return the requested row.
            setModalState({ open: false, type: null, data: null })
            const cleanParams = new URLSearchParams(searchParams.toString())
            cleanParams.delete("action")
            cleanParams.delete("id")
            const qs = cleanParams.toString()
            navigate?.(qs ? `${pathname}?${qs}` : pathname, { replace: true })
          }
          // else: rows still loading (initial empty state) → wait for fetch
        }
      }
    }
  }, [
    action,
    id,
    rows,
    isLoading,
    isClosing,
    closingAction,
    modalState.open,
    modalState.type,
    modalState.data?.id,
    modalState.data,
    resolveRowData,
    pathname,
    searchParams,
    navigate,
  ])

  const buildUrl = useCallback(
    (newAction: string | null, newId?: string | number): string => {
      const params = new URLSearchParams(searchParams.toString())

      if (newAction) {
        params.set("action", newAction)
        if (newId !== undefined) {
          params.set("id", String(newId))
        } else {
          params.delete("id")
        }
      } else {
        params.delete("action")
        params.delete("id")
      }

      const queryString = params.toString()
      return queryString ? `${pathname}?${queryString}` : pathname
    },
    [searchParams, pathname]
  )

  const setModalOpen = useCallback(
    (open: boolean) => {
      if (!open) {
        if (isClosing) return
        setIsClosing(true)
        setClosingAction({
          type: modalState.type,
          id: modalState.data?.id?.toString() ?? searchParams.get("id"),
        })
        setModalState({ open: false, type: null, data: null })
        navigate?.(buildUrl(null), { replace: true })
      }
    },
    [navigate, buildUrl, modalState, searchParams, isClosing]
  )

  // Special case for add (no row data)
  const openAdd = useCallback(() => {
    setModalState({ open: true, type: "add", data: null })
    navigate?.(buildUrl("add"))
  }, [navigate, buildUrl])

  // Generic operation opener - handles all row-level operations
  const openOperation = useCallback(
    (type: string, data: TData | null) => {
      setModalState({ open: true, type: type, data })
      const url =
        data?.id !== undefined ? buildUrl(type, data.id) : buildUrl(type)
      navigate?.(url)
    },
    [navigate, buildUrl]
  )

  const setModalType = useCallback((type: ModalType) => {
    setModalState((prev) => ({ ...prev, type }))
  }, [])

  const setRowData = useCallback((data: TData | null) => {
    setModalState((prev) => ({ ...prev, data }))
  }, [])

  return {
    modalOpen: modalState.open,
    setModalOpen,
    modalType: modalState.type,
    rowData: modalState.data,
    openAdd,
    openOperation,
    setModalType,
    setRowData,
  }
}
