import type { ReactNode } from "react"
import type {
  ColumnDef,
  HeaderContext,
  SortingState,
} from "@tanstack/react-table"
import type { FilterField, FilterOutput } from "../query-builder"
import type { UiConfig } from "../ui"

export interface DataTableQuery {
  page: number
  pageSize: number
  sorting: SortingState
  filters?: FilterOutput
  search?: string
}

export interface DataTableResult<TRow> {
  rows: TRow[]
  total: number
}
export interface DataTableDataSource<TRow> {
  fetch: (query: DataTableQuery) => Promise<DataTableResult<TRow>>
}

export type AggregateFn<TRow> = (values: unknown[], rows: TRow[]) => ReactNode
export interface ColumnMeta<TRow = unknown> {
  thClass?: string
  tdClass?: string
  align?: "left" | "center" | "right"
  width?: string
  aggregate?: "sum" | { fn: AggregateFn<TRow> }
  [key: string]: unknown
}

export interface ColumnConfig<TRow> {
  id?: string
  accessorKey?: keyof TRow & string
  header?: ReactNode | ((context: HeaderContext<TRow, unknown>) => ReactNode)
  cell?: (row: TRow) => ReactNode
  enableSorting?: boolean
  enableHiding?: boolean
  defaultHidden?: boolean
  headerClassName?: string
  cellClassName?: string
  className?: string
  aggregate?: "sum" | { fn: AggregateFn<TRow> }
  meta?: ColumnMeta<TRow>
}

export interface ColumnGroup<TRow> {
  id?: string
  header?: ReactNode
  columns: ColumnConfig<TRow>[]
  meta?: ColumnMeta<TRow>
}

export interface ExportContext<TRow> {
  rows: TRow[]
  columns: ColumnDef<TRow, unknown>[]
  tag: string
}
export interface ExportConfig<TRow> {
  label?: string
  handler: (context: ExportContext<TRow>) => void | Promise<void>
}

export interface DataTableOperation<TRow> {
  label: string
  handler?: (row?: TRow) => void | Promise<void>
  render?: (context: { row?: TRow; close: () => void }) => ReactNode
  isVisible?: (row?: TRow) => boolean
  confirmation?: { title?: string; message?: string; confirmLabel?: string }
}

export interface DataTableProps<TRow> {
  columns?: ColumnDef<TRow, unknown>[]
  columnsConfig?: ColumnGroup<TRow>[]
  data?: TRow[]
  dataSource?: DataTableDataSource<TRow>
  getRowId?: (row: TRow, index: number) => string
  pageSize?: number
  pageSizeOptions?: number[]
  manualPagination?: boolean
  showPagination?: boolean
  emptyMessage?: ReactNode
  loadingMessage?: ReactNode
  errorMessage?: ReactNode
  retryLabel?: ReactNode
  onRetry?: () => void
  onRowClick?: (row: TRow) => void
  className?: string
  filterFields?: FilterField[]
  initialFilters?: FilterOutput
  operations?: Record<string, DataTableOperation<TRow>>
  canOperation?: (operation: string, row?: TRow) => boolean
  searchable?: boolean
  searchPlaceholder?: string
  initialSearch?: string
  selectable?: boolean
  onSelectionChange?: (rows: TRow[]) => void
  initialSorting?: SortingState
  initialColumnVisibility?: Record<string, boolean>
  persistStateKey?: string
  onRefresh?: () => void
  topContent?: (context: { rows: TRow[]; total: number }) => ReactNode
  exports?: Record<string, ExportConfig<TRow>>
  components?: UiConfig | undefined
}
