import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { useEffect, useMemo, useState } from "react"
import { QueryBuilder } from "../query-builder"
import { useUiComponents } from "../ui"
import type { ColumnConfig, DataTableProps } from "./types"

function readPersisted<T>(key: string | undefined, fallback: T): T {
  if (!key || typeof window === "undefined") return fallback
  try {
    const value = window.localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function valueForRow<TRow>(row: TRow, column: ColumnConfig<TRow>): unknown {
  if (!column.accessorKey) return undefined
  return (row as Record<string, unknown>)[column.accessorKey]
}

function searchableValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value)
  return ""
}

/** A reusable server-side or client-side TanStack data table. */
export function DataTable<TRow>({
  columns,
  data: localData,
  dataSource,
  getRowId,
  pageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  manualPagination = Boolean(dataSource),
  showPagination = true,
  emptyMessage = "No results found.",
  loadingMessage = "Loading…",
  errorMessage,
  retryLabel = "Retry",
  onRetry,
  onRowClick,
  className,
  columnsConfig,
  filterFields,
  initialFilters,
  operations,
  canOperation,
  searchable = false,
  searchPlaceholder = "Search…",
  initialSearch = "",
  selectable = false,
  onSelectionChange,
  initialSorting = [],
  initialColumnVisibility = {},
  persistStateKey,
  onRefresh,
  topContent,
  exports,
  components,
}: DataTableProps<TRow>) {
  const { Button, Input, Select } = useUiComponents(components)
  const [pageSizeState, setPageSizeState] = useState(pageSize)
  const [pageIndex, setPageIndex] = useState(0)
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [filters, setFilters] = useState(initialFilters)
  const [search, setSearch] = useState(initialSearch)
  const defaultVisibility = useMemo(
    () => ({
      ...(Object.fromEntries(
        (columnsConfig ?? []).flatMap((group) =>
          group.columns
            .filter(
              (column) =>
                column.defaultHidden && (column.id ?? column.accessorKey)
            )
            .map((column) => [column.id ?? column.accessorKey, false])
        )
      ) as Record<string, boolean>),
      ...initialColumnVisibility,
    }),
    [columnsConfig, initialColumnVisibility]
  )
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () =>
      readPersisted<VisibilityState>(
        persistStateKey ? `${persistStateKey}:visibility` : undefined,
        defaultVisibility
      )
  )
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [data, setData] = useState<TRow[]>(localData ?? [])
  const [total, setTotal] = useState(localData?.length ?? 0)
  const [loading, setLoading] = useState(Boolean(dataSource))
  const [error, setError] = useState<unknown>(null)

  const columnDefs = useMemo<ColumnDef<TRow, unknown>[]>(() => {
    const convert = (column: ColumnConfig<TRow>): ColumnDef<TRow, unknown> => {
      const id = column.id ?? column.accessorKey
      return {
        ...(id ? { id } : {}),
        ...(column.accessorKey ? { accessorKey: column.accessorKey } : {}),
        ...(column.header !== undefined ? { header: column.header } : {}),
        ...(column.enableSorting !== undefined
          ? { enableSorting: column.enableSorting }
          : {}),
        ...(column.enableHiding !== undefined
          ? { enableHiding: column.enableHiding }
          : {}),
        ...(column.cell
          ? { cell: (context) => column.cell?.(context.row.original) }
          : {}),
        ...(column.meta ? { meta: column.meta } : {}),
      } as ColumnDef<TRow, unknown>
    }
    if (columns) return columns
    return (columnsConfig ?? []).map((group, index) => ({
      id: group.id ?? `group-${index}`,
      header: group.header,
      columns: group.columns.map(convert),
      meta: group.meta,
    })) as ColumnDef<TRow, unknown>[]
  }, [columns, columnsConfig])

  const flatColumns = useMemo(() => {
    if (columnsConfig) return columnsConfig.flatMap((group) => group.columns)
    return (columns ?? []).flatMap((column) => {
      const accessorKey =
        "accessorKey" in column ? column.accessorKey : undefined
      return typeof accessorKey === "string"
        ? [{ accessorKey } as ColumnConfig<TRow>]
        : []
    })
  }, [columns, columnsConfig])
  const clientRows = useMemo(() => {
    if (!search.trim() || dataSource) return data
    const needle = search.trim().toLowerCase()
    return data.filter((row) =>
      (flatColumns.length ? flatColumns : []).some((column) =>
        searchableValue(valueForRow(row, column)).toLowerCase().includes(needle)
      )
    )
  }, [data, dataSource, flatColumns, search])

  useEffect(() => {
    if (!dataSource) {
      setData(localData ?? [])
      setTotal(clientRows.length)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void dataSource
      .fetch({
        page: pageIndex + 1,
        pageSize: pageSizeState,
        sorting,
        ...(filters ? { filters } : {}),
        ...(search ? { search } : {}),
      })
      .then((result) => {
        if (cancelled) return
        setData(result.rows)
        setTotal(result.total)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    clientRows.length,
    dataSource,
    filters,
    localData,
    pageIndex,
    pageSizeState,
    search,
    sorting,
  ])

  useEffect(() => {
    if (!persistStateKey || typeof window === "undefined") return
    window.localStorage.setItem(
      `${persistStateKey}:visibility`,
      JSON.stringify(columnVisibility)
    )
  }, [columnVisibility, persistStateKey])

  const selectionColumn = useMemo<ColumnDef<TRow, unknown> | undefined>(() => {
    if (!selectable) return undefined
    return {
      id: "__selection",
      header: ({ table }) => (
        <Input
          aria-label="Select all rows"
          type="checkbox"
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <Input
          aria-label="Select row"
          type="checkbox"
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(event) => event.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }
  }, [Input, selectable])
  const resolvedColumns = useMemo(
    () => (selectionColumn ? [selectionColumn, ...columnDefs] : columnDefs),
    [columnDefs, selectionColumn]
  )
  const table = useReactTable({
    data: manualPagination || dataSource ? data : clientRows,
    columns: resolvedColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination: { pageIndex, pageSize: pageSizeState },
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater({ pageIndex, pageSize: pageSizeState })
          : updater
      setPageIndex(next.pageIndex)
      setPageSizeState(next.pageSize)
    },
    enableRowSelection: selectable,
    manualPagination,
    manualSorting: Boolean(dataSource),
    ...(manualPagination
      ? { pageCount: Math.max(1, Math.ceil(total / pageSizeState)) }
      : {}),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    ...(getRowId ? { getRowId } : {}),
  })
  const visibleRows = table.getRowModel().rows
  const pageCount = Math.max(
    1,
    Math.ceil((manualPagination ? total : clientRows.length) / pageSizeState)
  )

  useEffect(() => {
    onSelectionChange?.(
      table.getSelectedRowModel().rows.map((row) => row.original)
    )
  }, [onSelectionChange, rowSelection, table])

  const resetFilters = () => {
    setFilters(undefined)
    setSearch("")
    setPageIndex(0)
  }
  const executeOperation = (name: string, row?: TRow) => {
    const operation = operations?.[name]
    if (
      !operation ||
      canOperation?.(name, row) === false ||
      operation.isVisible?.(row) === false
    )
      return
    if (
      operation.confirmation &&
      typeof window !== "undefined" &&
      !window.confirm(
        operation.confirmation.message ?? `Confirm ${operation.label}?`
      )
    )
      return
    if (operation.handler) void operation.handler(row)
  }
  const exportData = (name: string) => {
    const exporter = exports?.[name]
    if (exporter)
      void exporter.handler({
        rows: data,
        columns: resolvedColumns,
        tag: persistStateKey ?? "data-table",
      })
  }

  if (loading)
    return (
      <div className="ui" role="status">
        {loadingMessage}
      </div>
    )
  if (error)
    return (
      <div className="ui ui__error" role="alert">
        {errorMessage ?? "Unable to load results."}
        <Button
          type="button"
          onClick={onRetry ?? (() => setPageIndex((value) => value))}
        >
          {retryLabel}
        </Button>
      </div>
    )

  return (
    <div className={`ui ${className ?? ""}`.trim()}>
      {topContent?.({ rows: data, total })}
      <div className="ui__toolbar">
        {searchable && (
          <Input
            aria-label="Search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPageIndex(0)
            }}
          />
        )}
        {filterFields && filterFields.length > 0 && (
          <QueryBuilder
            fields={filterFields}
            {...(filters ? { value: filters } : {})}
            onChange={(value) => {
              setFilters(value)
              setPageIndex(0)
            }}
            components={components}
          />
        )}
        {(filters || search) && (
          <Button type="button" onClick={resetFilters}>
            Clear filters
          </Button>
        )}
        {onRefresh && (
          <Button type="button" onClick={onRefresh}>
            Refresh
          </Button>
        )}
        {exports &&
          Object.entries(exports).map(([name, config]) => (
            <Button key={name} type="button" onClick={() => exportData(name)}>
              {config.label ?? name.toUpperCase()}
            </Button>
          ))}
        {operations &&
          Object.entries(operations)
            .filter(
              ([name, operation]) =>
                canOperation?.(name) !== false &&
                operation.isVisible?.() !== false
            )
            .map(([name, operation]) => (
              <Button
                key={name}
                type="button"
                onClick={() => executeOperation(name)}
              >
                {operation.label}
              </Button>
            ))}
        <details>
          <summary>Columns</summary>
          {table
            .getAllLeafColumns()
            .filter((column) => column.getCanHide())
            .map((column) => (
              <label key={column.id}>
                <Input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler()}
                />{" "}
                {column.id}
              </label>
            ))}
        </details>
      </div>
      <table className="ui__table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder ? null : (
                    <Button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                      {({ asc: " ↑", desc: " ↓" } as Record<string, string>)[
                        header.column.getIsSorted() as string
                      ] ?? ""}
                    </Button>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={resolvedColumns.length}>{emptyMessage}</td>
            </tr>
          ) : (
            visibleRows.map((row) => (
              <tr key={row.id} onClick={() => onRowClick?.(row.original)}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                {operations && (
                  <td>
                    {Object.entries(operations)
                      .filter(
                        ([name, operation]) =>
                          canOperation?.(name, row.original) !== false &&
                          operation.isVisible?.(row.original) !== false
                      )
                      .map(([name, operation]) => (
                        <Button
                          key={name}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            executeOperation(name, row.original)
                          }}
                        >
                          {operation.label}
                        </Button>
                      ))}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {showPagination && (
        <div className="ui__pagination">
          <span className="ui__muted">
            {manualPagination ? total : clientRows.length} results
          </span>
          <Select
            aria-label="Rows per page"
            value={String(pageSizeState)}
            options={pageSizeOptions.map((size) => ({
              value: String(size),
              label: String(size),
            }))}
            onChange={(value) => {
              setPageSizeState(Number(value))
              setPageIndex(0)
            }}
          />
          <Button
            type="button"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((value) => value - 1)}
          >
            Previous
          </Button>
          <span>
            Page {pageIndex + 1} of {pageCount}
          </span>
          <Button
            type="button"
            disabled={pageIndex + 1 >= pageCount}
            onClick={() => setPageIndex((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
