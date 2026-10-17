import { useState, useCallback } from "react"
import { useUiRuntime } from "../../../core/runtime"

/**
 * Delete configuration
 */
interface DeleteConfig {
  endpoint: string
  method?: "DELETE" | "POST"
}

/**
 * Row with id field
 */
interface RowWithId {
  id: string | number
  [key: string]: unknown
}

/**
 * Delete response
 */
interface DeleteResponse {
  message?: string
}

/**
 * Delete request body
 */
interface DeleteBody {
  id: string | number
}

/**
 * Custom delete check function type
 */
type CustomDeleteCheck<TData> = (row: TData) => boolean | string

/**
 * Return type for useTableActions
 */
interface UseTableActionsReturn {
  showDelete: boolean
  setShowDelete: (show: boolean) => void
  idToDelete: string | number | null
  askDelete: (row: RowWithId) => void
  confirmDelete: () => void
  isDeleting: boolean
}

/**
 * Hook for managing table delete actions
 */
export function useTableActions<TData extends RowWithId>(
  onDelete: DeleteConfig | undefined,
  fetchKey: string | readonly unknown[],
  organizationId?: string,
  customDeleteCheck?: CustomDeleteCheck<TData>
): UseTableActionsReturn {
  const [showDelete, setShowDelete] = useState(false)
  const [idToDelete, setIdToDelete] = useState<string | number | null>(null)
  const runtime = useUiRuntime()
  const notify = runtime.notify
  const formatError = runtime.formatError

  const askDelete = useCallback(
    (row: TData | RowWithId) => {
      if (customDeleteCheck) {
        const result = customDeleteCheck(row as TData)
        if (typeof result === "string") {
          notify.error(result)
          return
        }
        if (result === false) {
          notify.error("This item cannot be deleted")
          return
        }
      }

      const id = row.id
      setIdToDelete(id)
      setShowDelete(true)
    },
    [customDeleteCheck, notify]
  )

  const deleteMutation = runtime.request.useMutation<DeleteBody>({
    endpoint: onDelete?.endpoint ?? "",
    method: onDelete?.method ?? "DELETE",
    organizationId,
    onSuccess: (data) => {
      const message = (data as DeleteResponse | undefined)?.message
      notify.success(message ?? "Deleted successfully")
      const queryKey = Array.isArray(fetchKey) ? fetchKey : [fetchKey]
      runtime.queryClient.invalidateQueries({ queryKey })
      setShowDelete(false)
      setIdToDelete(null)
    },
    onError: (err) => {
      const message = formatError(err, "Delete failed")
      notify.error(message)
    },
  })

  const confirmDelete = useCallback(() => {
    if (!idToDelete || !onDelete) return
    deleteMutation.mutate({ id: idToDelete })
  }, [idToDelete, deleteMutation, onDelete])

  return {
    showDelete,
    setShowDelete,
    idToDelete,
    askDelete,
    confirmDelete,
    isDeleting: deleteMutation.isPending,
  }
}
