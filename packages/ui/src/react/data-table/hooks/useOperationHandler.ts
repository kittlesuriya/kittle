import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { extractEntityId, useUiRuntime } from "../../../core/runtime"
import { validateOperation } from "../../../core/table/validateOperation"
import type { BaseOperationConfig, OperationContext } from "../../../core/table/types"
import { WIDTH_CLASSES } from "../../../core/table/types"
import type { OperationAnalyticsMeta } from "../../../core/table/operationAnalytics"

interface UseOperationHandlerOptions<TData> {
  operationKey: string
  operation?: BaseOperationConfig<TData>
  organizationId?: string
  onSuccess?: () => void
  validationMode?: "strict" | "priority"
  analyticsMeta?: OperationAnalyticsMeta | null
}

export function useOperationHandler<TData>({
  operationKey,
  operation,
  organizationId,
  onSuccess,
  validationMode = "strict",
  analyticsMeta,
}: UseOperationHandlerOptions<TData>) {
  const [isExecuting, setIsExecuting] = useState(false)
  const runtime = useUiRuntime()
  const analytics = runtime.analytics
  const notify = runtime.notify
  const formatError = runtime.formatError
  const queryClient = runtime.queryClient

  // Keep last resolved endpoint for onSuccess/onError callbacks
  const rowDataForMetaRef = useRef<string>("")

  const resolveApiUrl = useCallback(
    (variables: TData) => {
      let url = operation?.api?.endpoint

      if (typeof url === "function") {
        return url(variables)
      }

      url = url ?? ""
      const id = extractEntityId(variables)
      if (id) {
        if (url.includes(":id")) {
          url = url.replace(":id", id)
        } else if (!url.endsWith(id)) {
          url = url.replace(/\/$/, "") + "/" + id
        }
      }
      return url
    },
    [operation?.api?.endpoint]
  )

  // Validate operation config
  const validation = useMemo(() => {
    return validateOperation(operationKey, operation, validationMode)
  }, [operationKey, operation, validationMode])

  // Log validation errors in development
  useEffect(() => {
    if (!import.meta.env?.DEV) return

    if (validation.errors.length > 0) {
      console.error("[useOperationHandler]", validation.errors)
    }
    if (validation.warnings.length > 0) {
      console.warn("[useOperationHandler]", validation.warnings)
    }
  }, [validation])

  // Determine execution type based on validation
  const executionType = validation.isValid ? validation.executionType : "none"

  const hasComponent = executionType === "component"
  const hasApi = executionType === "api"
  const hasHandler = executionType === "handler"
  const needsConfirmation = Boolean(operation?.confirmation)

  // API mutation setup
  const mutation = runtime.request.useMutation<TData>({
    endpoint: (variables) => {
      let url = operation?.api?.endpoint

      // Handle function endpoints
      if (typeof url === "function") {
        return url(variables)
      }

      url = url ?? ""
      if (variables && typeof variables === "object" && "id" in variables) {
        const id = (variables as { id: string | number }).id
        // Replace :id placeholder or append /{id} if not present
        if (url.includes(":id")) {
          url = url.replace(":id", String(id))
        } else if (id && !url.endsWith(String(id))) {
          // If endpoint doesn't have ID placeholder and ID exists, append it
          url = url.replace(/\/$/, "") + "/" + String(id)
        }
      }
      return url
    },
    method: operation?.api?.method ?? "POST",
    headers: (variables) => {
      const configured = operation?.api?.headers
      if (typeof configured === "function") {
        return configured(variables)
      }
      return configured ?? {}
    },
    mapBody: (variables) => {
      const configured = operation?.api?.body
      if (configured !== undefined) {
        return typeof configured === "function"
          ? (configured as (data: TData) => unknown)(variables)
          : configured
      }
      // Kittle delete handlers take no body schema and reject bodyful
      // DELETEs; the legacy factory ignored bodies. Headers/endpoint still
      // resolve from the row variables above.
      if ((operation?.api?.method ?? "POST") === "DELETE") return undefined
      return variables
    },
    organizationId,
    onSuccess: (data: unknown) => {
      const message =
        typeof data === "object" && data && "message" in data
          ? (data as { message: string }).message
          : "Operation completed successfully"

      notify.success(message)

      // 1. Invalidate cache based on key (existing behavior)
      if (operation?.api?.key) {
        const keys = Array.isArray(operation.api.key)
          ? operation.api.key
          : [operation.api.key]

        // Invalidate each key separately to match queries with different params
        for (const key of keys) {
          queryClient.invalidateQueries({
            queryKey: [key],
            exact: false,
            // Match useApiMutation and the active-query policy: stale inactive
            // parameter variants refresh when next mounted, not immediately.
            refetchType: "active",
          })
        }
      }

      // 2. Also invalidate custom revalidateTags if provided (legacy support)
      if (operation?.api?.revalidateTags) {
        for (const tag of operation.api.revalidateTags) {
          queryClient.invalidateQueries({
            queryKey: [tag],
            exact: false,
            refetchType: "active",
          })
        }
      }

      onSuccess?.()

      if (analytics && analyticsMeta) {
        const method = operation?.api?.method ?? "POST"
        const endpoint = rowDataForMetaRef.current
        analytics.trackEvent("UI_ACTION", {
          ...analyticsMeta,
          phase: "success",
          method,
          endpoint,
        })
      }
    },
    onError: (err) => {
      const message = formatError(err, "Operation failed")
      notify.error(message)

      if (analytics && analyticsMeta) {
        const method = operation?.api?.method ?? "POST"
        const endpoint = rowDataForMetaRef.current
        analytics.trackEvent("UI_ACTION", {
          ...analyticsMeta,
          phase: "error",
          method,
          endpoint,
          errorMessage: message,
        })
      }
    },
    // Options removed as 'enabled' is not supported in mutation options
  })

  // Execute API operation
  const executeApiOperation = useCallback(
    (data?: TData) => {
      if (!hasApi || !operation?.api) return

      if (analytics && analyticsMeta) {
        const method = operation?.api?.method ?? "POST"
        const endpoint = data ? resolveApiUrl(data) : ""
        rowDataForMetaRef.current = endpoint
        analytics.trackEvent("UI_ACTION", {
          ...analyticsMeta,
          phase: "submit",
          method,
          endpoint,
        })
      }

      mutation.mutate(data as TData)
    },
    [hasApi, operation, mutation, analytics, analyticsMeta, resolveApiUrl]
  )

  // Execute handler function
  const executeHandler = useCallback(
    async (data?: TData) => {
      if (!hasHandler || !operation?.handler) return

      const context: OperationContext<TData> = {
        operationType: operationKey,
        width: operation.width,
        widthClass: WIDTH_CLASSES[operation.width ?? "md"],
        displayMode: operation.displayMode ?? "sheet",
        rowData: data,
      }

      try {
        setIsExecuting(true)
        await Promise.resolve(operation.handler(data, context))
        onSuccess?.()
      } catch (error) {
        const message = formatError(error, "Operation failed")
        notify.error(message)
        console.error("[useOperationHandler] Handler error:", error)
      } finally {
        setIsExecuting(false)
      }
    },
    [hasHandler, operation, operationKey, onSuccess, formatError, notify]
  )

  // Unified execute function
  const execute = useCallback(
    (data?: TData) => {
      // Block execution if validation failed (strict mode)
      if (!validation.isValid) {
        console.error(
          `[useOperationHandler] Cannot execute "${operationKey}": validation failed`,
          validation.errors
        )
        notify.error(`Cannot execute ${operationKey}: configuration error`)
        return
      }

      if (hasApi) {
        executeApiOperation(data)
      } else if (hasHandler) {
        void executeHandler(data)
      }
    },
    [
      validation,
      operationKey,
      hasApi,
      hasHandler,
      executeApiOperation,
      executeHandler,
      notify,
    ]
  )

  return {
    validation,
    hasComponent,
    hasApi,
    hasHandler,
    executionType,
    needsConfirmation,
    component: operation?.component,
    confirmation: operation?.confirmation,
    requiresModal: operation?.requiresModal ?? hasComponent,
    execute,
    isLoading: mutation.isPending || isExecuting,
  }
}
