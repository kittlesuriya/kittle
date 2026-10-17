"use no memo"

import { useMemo, useCallback, useRef, useState } from "react"
import { useTable, type ColumnDef, type Row } from "@tanstack/react-table"
import {
  dataTableFeatures,
  type DataTableFeatures,
} from "../../core/table/features"
import { keepPreviousData } from "@tanstack/react-query"
import { Badge } from "../ui/badge"
import {
  ALLOW_ALL_ABILITY,
  extractEntityId,
  useUiRuntime,
  type AbilityLike,
} from "../../core/runtime"

import { TableHeader } from "./parts/TableHeader"
import { TableBody } from "./parts/TableBody"
import { TableFooter } from "./parts/TableFooter"
import { TablePagination } from "./parts/TablePagination"
import { TableToolbar } from "./parts/TableToolbar"
import { TableErrorState } from "./parts/TableErrorState"
import { TableEmptyState } from "./parts/TableEmptyState"
import { TableLoadingState } from "./parts/TableLoadingState"
import { RowActions } from "./parts/RowActions"
import { OperationModal } from "./parts/OperationModal"
import { QueryBuilder } from "../query-builder/QueryBuilder"
import { toListFilterPayload } from "../../core/query/listOperators"
import { clearQueryBuilderStorageForPath } from "../../core/query/queryBuilderStorage"
import { normaliseHotkey, useGlobalHotkeys } from "../../core/menu/hotKeys"

import { buildStorageKey } from "../../core/table/buildStorageKey"
import { toSentenceCase } from "../../core/table/toSentenceCase"
import { useTableUrlState } from "./hooks/useTableUrlState"
import { useTableQueryState } from "../../core/table/useTableQueryState"
import { useColumnReorder } from "../../core/table/useColumnReorder"
import { useOperationHandler } from "./hooks/useOperationHandler"
import { useValidatedOperations } from "../../core/table/useValidatedOperations"
import { useOperationPermissions } from "./hooks/useOperationPermissions"
import { useEffect } from "react"
import { BookOpen } from "lucide-react"
import { toDisplayString } from "../../core/format/toDisplayString"
import { useTranslation } from "react-i18next"
import type { ValidationResult } from "../../core/table/validateOperation"

import type {
  DataTableProps,
  ColumnGroup,
  ColumnConfig,
  DisplayMode,
  PaginatedResponse,
  ExportsConfig,
} from "../../core/table/types"

/**
 * Row type with id field
 */
interface RowWithId {
  id: string | number
  [key: string]: unknown
}

function filterExportsByAbility<TData extends RowWithId>(
  exportsConfig: ExportsConfig<TData> | undefined,
  ability: AbilityLike,
  subject: string | undefined
): ExportsConfig<TData> | undefined {
  if (!exportsConfig) return undefined
  if (!subject) return exportsConfig
  if (!ability.can("export", subject)) return undefined
  return exportsConfig
}

/**
 * DataTable component - fully typed reusable table with Unified CRUD operations
 */
export function DataTable<TData extends RowWithId>({
  tag,
  title,
  subject,
  moduleKey,
  docModuleKey,
  fetchData,
  columnsConfig,
  onRowsLoaded,
  organizationId,
  organizationRequired = true,
  scope = "tenant",
  operations,
  exports, // Separate exports config
  showPagination = true,
  /* When true (default) the server is responsible for page/row slicing and TanStack
      only renders the rows it is given. When false, TanStack performs client-side
      pagination over the full dataset it receives (used by client-side data views, which
      loads every filtered same-day row and must paginate them in the browser). */
  manualPagination = true,
  dontShowColumnSelect = false,
  actionHeader,
  filterConfig,
  validationMode = "strict",
  initialSorting,
  granularPermissions,
  translationNamespace,
  topContent,
}: DataTableProps<TData>): React.ReactElement {
  const { t } = useTranslation()
  const runtime = useUiRuntime()
  const navigation = runtime.navigation
  const ability = runtime.ability ?? ALLOW_ALL_ABILITY
  const pathname = navigation?.pathname ?? ""
  const analytics = runtime.analytics
  const notify = runtime.notify
  const docs = runtime.documentation
  const storageKey = useMemo(() => buildStorageKey(title, tag), [title, tag])
  const { initialValues: initialFilters } = filterConfig ?? {}

  const resolvedSubject = useMemo<string | undefined>(() => {
    if (subject) return subject

    const appResolved = runtime.resolveSubject?.({
      moduleKey,
      endpoint: fetchData.endpoint,
    })
    if (appResolved) return appResolved

    if (moduleKey && !import.meta.env?.PROD) {
      throw new Error(
        `Missing module subject for DataTable moduleKey: ${moduleKey}`
      )
    }

    return undefined
  }, [moduleKey, subject, fetchData.endpoint, runtime])

  // Use granular permissions if available, fallback to CASL ability checks
  const { resolvedOperations } = useOperationPermissions({
    operations,
    moduleKey,
    subject: resolvedSubject,
    ability,
    granularPermissions,
  })

  const resolvedExports = useMemo(
    () => filterExportsByAbility(exports, ability, resolvedSubject),
    [exports, ability, resolvedSubject]
  )

  // Normalize column groups
  const normalizedColumnGroups = useMemo(() => {
    const groups: ColumnGroup<TData>[] = columnsConfig.map((group, index) => {
      const isAutoGenerated = !group.header && !group.id
      const hasExplicitGroupHeader =
        group.header !== undefined &&
        group.header !== null &&
        (typeof group.header !== "string" || group.header.trim().length > 0)
      return {
        ...group,
        id:
          group.id ??
          (typeof group.header === "string" ? group.header : `group-${index}`),
        meta: {
          ...group.meta,
          isAutoGeneratedGroup: isAutoGenerated,
          hasExplicitGroupHeader,
        },
        columns: group.columns.map((col: ColumnConfig<TData>) => {
          const rawHeader =
            typeof col.header === "string"
              ? col.header
              : (col.accessorKey ?? col.id)
          return {
            ...col,
            header:
              typeof col.header === "function"
                ? col.header
                : toSentenceCase(rawHeader),
            meta: {
              ...(col.meta ?? {}),
              aggregate: col.aggregate,
              thClass: col.headerClassName ?? col.meta?.thClass ?? "",
              tdClass:
                col.cellClassName ?? col.className ?? col.meta?.tdClass ?? "",
            },
          }
        }),
      }
    })

    // Add actions column if any action component is provided
    const hasAnyOperation =
      resolvedOperations?.add ||
      resolvedOperations?.edit ||
      resolvedOperations?.view ||
      resolvedOperations?.delete ||
      resolvedOperations?.complete ||
      resolvedOperations?.dismiss ||
      resolvedOperations?.cancel ||
      Object.keys(resolvedOperations || {}).length > 0

    if (hasAnyOperation) {
      groups.push({
        id: "actions",
        header: actionHeader ?? null,
        meta: {},
        columns: [
          {
            id: "actions",
            header: actionHeader ?? undefined,
            enableSorting: false,
            meta: {
              thClass: "w-[50px]",
              tdClass: "w-[50px]",
            },
          },
        ],
      })
    }

    return groups
  }, [columnsConfig, resolvedOperations, actionHeader])

  // Extract leaf column IDs
  const leafColumnIds = useMemo(() => {
    const ids: string[] = []
    normalizedColumnGroups.forEach((group) => {
      group.columns.forEach((col) => {
        const id = col.id ?? col.accessorKey
        if (id) ids.push(id)
      })
    })
    return ids
  }, [normalizedColumnGroups])

  const defaultHiddenColumnIds = useMemo(() => {
    const ids = new Set<string>()
    columnsConfig.forEach((group) => {
      group.columns.forEach((col) => {
        if (!col.defaultHidden) return
        const id = col.id ?? col.accessorKey
        if (id) ids.add(id)
      })
    })
    return ids
  }, [columnsConfig])

  const nonHideableColumnIds = useMemo(() => {
    const ids = new Set<string>()
    columnsConfig.forEach((group) => {
      group.columns.forEach((col) => {
        if (col.enableHiding !== false) return
        const id = col.id ?? col.accessorKey
        if (id) ids.add(id)
      })
    })
    return ids
  }, [columnsConfig])

  // Table state management
  const {
    tableState,
    setPagination,
    setSorting,
    setColumnVisibility,
    setColumnOrder,
    setTableState,
  } = useTableQueryState(
    storageKey,
    leafColumnIds,
    initialFilters,
    initialSorting,
    defaultHiddenColumnIds
  )

  const { pagination, sorting, columnVisibility, columnOrder, filters } =
    tableState

  // Deep-link support: when URL has ?action=view&id=X, inject the ID into
  // fetch params so the server may include the specific row in results.
  const rawSearch = navigation?.search ?? ""
  // The old guard compared the same location against itself; the URL search
  // string alone decides whether a deep link is present.
  const deepLinkId = useMemo(() => {
    const sp = new URLSearchParams(rawSearch)
    const a = sp.get("action")
    const deepId = sp.get("id")
    return a && deepId ? deepId : null
  }, [rawSearch])

  // Build query parameters. Filters are deep-translated to the CRUD operator
  // vocabulary at this send boundary so stale persisted ABAC operators
  // (equals/includesAny/…) from before the QueryBuilder fix cannot 400.
  const queryParams = useMemo(() => {
    const sortingParam =
      sorting && sorting.length > 0 ? { sorting: JSON.stringify(sorting) } : {}
    const filtersParam =
      filters && Object.keys(filters).length > 0
        ? { filters: JSON.stringify(toListFilterPayload(filters)) }
        : {}

    const deepLinkParam = deepLinkId ? { id: deepLinkId } : {}

    // When the table paginates client-side (manualPagination === false), the server
    // already returns every filtered row, so page/pageSize must NOT be sent. Sending
    // them would force a needless refetch on every page change whose new data array
    // makes TanStack auto-reset pageIndex to 0, breaking navigation.
    if (!manualPagination) {
      return {
        ...sortingParam,
        ...filtersParam,
        ...fetchData.params,
        ...deepLinkParam,
      }
    }

    return {
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      ...sortingParam,
      ...filtersParam,
      ...fetchData.params,
      ...deepLinkParam,
    }
  }, [
    manualPagination,
    pagination,
    sorting,
    filters,
    fetchData.params,
    deepLinkId,
  ])

  // Fetch data
  const { data, error, isLoading, isFetching } = runtime.request.useQuery<
    PaginatedResponse<TData>
  >({
    key: fetchData.key,
    endpoint: fetchData.endpoint,
    method: fetchData.method,
    queryParams,
    organizationId,
    requireOrganization: organizationRequired,
    scope,
    options: {
      placeholderData: keepPreviousData,
    },
  })

  const rows = useMemo(() => data?.rows ?? [], [data?.rows])
  // Hand the loaded rows to the page (batched badge counts and the like).
  // Through a ref because callers commonly pass an inline arrow — an identity
  // that changes every render must not re-run this effect.
  const onRowsLoadedRef = useRef(onRowsLoaded)
  onRowsLoadedRef.current = onRowsLoaded
  useEffect(() => {
    onRowsLoadedRef.current?.(rows)
  }, [rows])
  const rowCount = useMemo(() => {
    if (typeof data?.rowCount === "number") return data.rowCount
    if (typeof data?.total === "number") return data.total
    if (typeof data?.totalRows === "number") return data.totalRows
    if (typeof data?.totalCount === "number") return data.totalCount
    return 0
  }, [data])

  // Validate all operations
  const { hasErrors, validationResults } = useValidatedOperations<TData>({
    operations,
    mode: validationMode,
    onError: (errors: Map<string, ValidationResult>) => {
      // Errors are logged in development via the hook
      void errors
    },
  })

  // Show warning in UI if there are validation errors
  useEffect(() => {
    if (hasErrors && import.meta.env?.DEV) {
      // Logged via hook
    }
  }, [hasErrors])

  // Modal state
  const {
    modalOpen,
    setModalOpen,
    modalType,
    rowData,
    openAdd,
    openOperation,
  } = useTableUrlState<TData>(rows, isLoading || isFetching)

  const handleOperationClick = useCallback(
    (type: string, data: TData) => {
      const operation = resolvedOperations?.[type]
      if (!operation) {
        return
      }

      // Track "open" for the view action (the analytics port gates scopes)
      if (moduleKey && analytics && type === "view") {
        analytics.trackEvent("UI_ACTION", {
          scope,
          moduleKey,
          action: type,
          phase: "open",
          entityId: extractEntityId(data),
          path: runtime.buildWorkspaceUrl?.(pathname) ?? pathname,
        })
      }

      // Check validation
      const validation = validationResults.get(type)
      if (validation && !validation.isValid) {
        console.error(
          `[DataTable] Cannot execute "${type}":`,
          validation.errors
        )
        notify.error(`Cannot execute ${type}: configuration error`)
        return
      }

      // Determine if modal is needed
      const needsModal = operation.requiresModal ?? Boolean(operation.component)
      const needsConfirmation = Boolean(operation.confirmation)

      if (needsModal || needsConfirmation) {
        // Open modal for component-based or confirmed operations
        // Add operation has no data, all others need row data
        const operationData = type === "add" ? null : data
        if (type === "add") {
          openAdd()
        } else {
          openOperation(type, operationData)
        }
      } else if (operation.handler) {
        // Execute handler directly (no modal) - for operations like print, download
        Promise.resolve(operation.handler(data)).catch((error) => {
          const message = runtime.formatError(error, "Operation failed")
          notify.error(message)
          console.error(`[DataTable] Handler error (${type}):`, error)
        })
      }
    },
    [
      resolvedOperations,
      validationResults,
      openAdd,
      openOperation,
      analytics,
      scope,
      moduleKey,
      pathname,
      runtime,
      notify,
    ]
  )

  // Derive current operation
  const currentOperation = useMemo(() => {
    if (!modalType || !resolvedOperations) return undefined
    if (!modalType || !resolvedOperations) return undefined
    return resolvedOperations[modalType]
  }, [modalType, resolvedOperations])

  const modalDisplayMode: DisplayMode = currentOperation?.displayMode ?? "sheet"

  const operationAnalyticsMeta = useMemo(() => {
    if (!moduleKey) return null
    if (!modalType) return null
    return {
      scope,
      moduleKey,
      action: modalType,
      entityId: extractEntityId(rowData),
      path: runtime.buildWorkspaceUrl?.(pathname) ?? pathname,
    }
  }, [scope, moduleKey, modalType, rowData, pathname, runtime])

  // Operation handler with validation
  const { execute, isLoading: isOperationLoading } = useOperationHandler({
    operationKey: modalType ?? "",
    operation: currentOperation,
    organizationId,
    onSuccess: () => setModalOpen(false),
    validationMode,
    analyticsMeta: operationAnalyticsMeta,
  })

  // Build table columns with action handlers
  const tableColumns = useMemo(() => {
    return normalizedColumnGroups.map((group) => ({
      ...group,
      columns: group.columns.map((col) => {
        if (col.id === "actions") {
          return {
            ...col,
            cell: ({ row }: { row: Row<DataTableFeatures, TData> }) => (
              <RowActions<TData>
                row={row}
                operations={resolvedOperations}
                onOperationClick={handleOperationClick}
              />
            ),
          }
        }
        return col
      }),
    })) as ColumnDef<DataTableFeatures, TData>[]
  }, [normalizedColumnGroups, resolvedOperations, handleOperationClick])

  // React Table instance
  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns: tableColumns,
    manualPagination,
    manualSorting: true,
    rowCount: manualPagination ? rowCount : undefined,
    autoResetPageIndex: false,
    defaultColumn: {
      cell: (info) => <span>{toDisplayString(info.getValue())}</span>,
      enableSorting: false,
    },
    enableSorting: true,
    state: {
      pagination,
      sorting,
      columnVisibility,
      columnOrder,
    },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
  })

  const handleColumnReorder = useColumnReorder(
    setTableState,
    leafColumnIds,
    table
  )

  // Export state
  const [isExporting, setIsExporting] = useState<string | null>(null)

  // Documentation drawer: the button renders only when a doc actually
  // exists for this module. The fetch itself is backend-authorized
  // (module enabled + read-docs grant), so data presence is the gate —
  // this stays correct even when login-time permission snapshots predate
  // the module. Same query key as the drawer: opening it is a cache hit.
  const activeDocModuleKey = docModuleKey ?? moduleKey
  docs.useModuleDocumentation(activeDocModuleKey, scope)

  // Handle export
  const handleExport = useCallback(
    async (exportType: string) => {
      const exportConfig = resolvedExports?.[exportType]
      if (!exportConfig) {
        console.error(`[DataTable] Export type "${exportType}" not configured`)
        return
      }

      // Get visible columns
      const visibleColumns = table
        .getAllLeafColumns()
        .filter((col) => col.getIsVisible())
        .map((col) => col.columnDef)

      try {
        setIsExporting(exportType)

        // Execute export handler
        await Promise.resolve(
          exportConfig.handler(
            tag,
            rows,
            visibleColumns as ColumnDef<DataTableFeatures, TData>[]
          )
        )
      } catch (error) {
        console.error(`[DataTable] Export error (${exportType}):`, error)
        notify.error(`Failed to export ${exportType.toUpperCase()}`)
      } finally {
        setIsExporting(null)
      }
    },
    [resolvedExports, table, tag, rows, notify]
  )

  // Alt+N opens the Add sheet on tables that offer it. Gated on the
  // permission-filtered add operation with no modal, error or loading state;
  // the shared engine already ignores keypresses typed into inputs.
  // One DataTable per route by convention, so one registration per page.
  const addHotkeyMap = useMemo(() => {
    if (!resolvedOperations?.add || modalOpen || error || isLoading) {
      return new Map<string, () => void>()
    }
    return new Map<string, () => void>([
      [normaliseHotkey("alt+n"), () => openAdd()],
    ])
  }, [resolvedOperations, modalOpen, error, isLoading, openAdd])
  useGlobalHotkeys(addHotkeyMap)

  // Refresh handler
  const refresh = useCallback(() => {
    const queryKey = Array.isArray(fetchData.key)
      ? fetchData.key
      : [fetchData.key]
    runtime.queryClient.invalidateQueries({
      queryKey,
      exact: false,
      refetchType: "active", // Only refetch the currently active query, not all cached entries
    })
  }, [fetchData.key, runtime.queryClient])

  // Error state. Retry resets this table AND deletes this page's persisted
  // filter state (table-state key + QueryBuilder keys for this pathname) so
  // a corrupt/stale stored filter cannot 400 again on reload. Other pages'
  // localStorage entries are never touched.
  if (error) {
    return (
      <TableErrorState
        onRetry={() => {
          try {
            window.localStorage.removeItem(storageKey)
          } catch {
            // Ignore storage errors (private mode, quota, etc.)
          }
          clearQueryBuilderStorageForPath(pathname)
          setTableState({
            pagination: { pageIndex: 0, pageSize: 10 },
            sorting: [],
            columnVisibility: {},
            columnOrder: [],
            filters: initialFilters ?? {},
          })
          queueMicrotask(() => refresh())
        }}
      />
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <TableLoadingState
        title={title}
        columnCount={leafColumnIds.length + (resolvedOperations ? 1 : 0)}
        showFilters={Boolean(filterConfig?.schema)}
      />
    )
  }

  return (
    <>
      <div className="bg-background rounded-lg flex flex-col flex-1 min-h-0">
        {/* QueryBuilder filters & Top Content */}
        {filterConfig?.schema ? (
          <div className="py-1">
            <QueryBuilder
              schema={filterConfig.schema}
              ui={filterConfig.queryBuilderUi}
              headerLeft={
                topContent ? topContent({ rows, rowCount, table }) : undefined
              }
              onSubmit={(newFilters) => {
                setTableState((prev) => ({
                  ...prev,
                  filters: newFilters ?? {},
                  pagination: { ...prev.pagination, pageIndex: 0 },
                }))
              }}
              initialValue={filters}
            />
          </div>
        ) : topContent ? (
          <div className="py-2">{topContent({ rows, rowCount, table })}</div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm dark:overflow-visible dark:border-0 dark:bg-transparent dark:shadow-lg">
          <div className="px-3.5 sm:px-6 py-3 sm:py-4 bg-secondary/5 border-b border-border flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 flex-none dark:rounded-t-lg dark:border-0 dark:bg-muted">
            <h2 className="text-lg sm:text-2xl font-semibold text-table-heading flex items-center flex-wrap gap-2">
              <span>
                {translationNamespace
                  ? t(`${translationNamespace}.manage`, {
                      defaultValue: `Manage ${title}`,
                    })
                  : t("common.manage", {
                      defaultValue: `Manage ${title}`,
                      title,
                    })}
              </span>
              {rowCount > 0 && (
                <Badge className="bg-secondary text-secondary-foreground font-normal text-xs">
                  {rowCount} {t("common.items", { defaultValue: "items" })}
                </Badge>
              )}
              <button
                type="button"
                title="Documentation"
                aria-label="Documentation"
                onClick={() => docs.open(activeDocModuleKey, scope)}
                className="cursor-pointer p-1.5 rounded-md bg-primary/20 text-primary-ink hover:bg-primary/30 transition-colors dark:rounded-2xl dark:bg-accent dark:text-primary dark:hover:bg-accent"
              >
                <BookOpen size={18} />
              </button>
            </h2>

            <TableToolbar
              table={table}
              nonHideableColumns={nonHideableColumnIds}
              onRefresh={refresh}
              onAdd={resolvedOperations?.add ? openAdd : undefined}
              addButtonText={
                resolvedOperations?.add?.label ??
                (translationNamespace
                  ? t(`${translationNamespace}.add_item`, {
                      defaultValue: "Add Item",
                    })
                  : t("common.add_item", { defaultValue: "Add Item" }))
              }
              showColumnMenu={!dontShowColumnSelect}
              visibilityState={columnVisibility}
              exports={resolvedExports}
              onExport={handleExport}
              isExporting={isExporting}
              translationNamespace={translationNamespace}
            />
          </div>

          <div className="overflow-auto flex-1">
            <table aria-label={title} className="w-full border-collapse">
              <TableHeader
                table={table}
                onColumnReorder={handleColumnReorder}
              />
              {rows.length === 0 ? (
                <TableEmptyState
                  colSpan={table.getAllLeafColumns().length}
                  hasFilters={Object.keys(filters).length > 0}
                  onAddClick={
                    resolvedOperations?.add ? () => openAdd() : undefined
                  }
                  addButtonLabel={resolvedOperations?.add?.label}
                  translationNamespace={translationNamespace}
                />
              ) : (
                <>
                  <TableBody
                    key={`${rows[0]?.id ?? "empty"}-${rows.length}-${pagination.pageSize}-${JSON.stringify(columnVisibility)}-${JSON.stringify(columnOrder)}`}
                    table={table}
                  />
                  <TableFooter table={table} />
                </>
              )}
            </table>
          </div>

          {showPagination && (
            <div className="px-6 border-t border-border flex-none bg-card py-2 dark:rounded-b-lg">
              <TablePagination
                table={table}
                showPagination={showPagination}
                translationNamespace={translationNamespace}
              />
            </div>
          )}
        </div>
      </div>

      <OperationModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        modalType={modalType}
        title={title}
        operation={currentOperation}
        rowData={rowData}
        onExecute={execute}
        isLoading={isOperationLoading}
        displayMode={modalDisplayMode}
        width={currentOperation?.width}
        analyticsMeta={operationAnalyticsMeta}
      />
    </>
  )
}
