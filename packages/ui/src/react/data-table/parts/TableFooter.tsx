"use no memo"

import type { ReactTable, Row, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "../../../core/table/features"
import type { ColumnMeta } from "../../../core/table/types"
import type { DataTableClassNames } from "../../../core/table/types"
import { cn } from "../../../core/cn"

interface TableFooterProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData>
  classNames?: Pick<DataTableClassNames, "footer" | "footerCell">
}

export function sumValues(values: unknown[]): string {
  let total = 0n
  for (const v of values) {
    if (typeof v === "bigint") total += v
    else if (typeof v === "number") total += BigInt(v)
    else if (typeof v === "string" && /^-?\d+$/.test(v)) total += BigInt(v)
    else if (v != null && typeof v !== "boolean" && !Number.isNaN(Number(v)))
      total += BigInt(Math.round(Number(v)))
  }
  return total.toString()
}

export function TableFooter<TData extends RowData>({
  table,
  classNames,
}: TableFooterProps<TData>): React.ReactElement | null {
  /* Sum over the currently visible page rows only (table.getRowModel().rows).
     When client-side paginated (manualPagination === false, for example local data views),
     this produces the sum of the current page rows only (e.g. Page 1 = 10 rows,
     Page 2 = 7 rows). When server-paginated (manualPagination === true), this
     sums the current server page rows. */
  const rows = table.getRowModel().rows
  if (!rows.length) return null

  const visibleCols = table.getAllLeafColumns().filter((c) => c.getIsVisible())

  const hasAggregate = visibleCols.some((col) => {
    const meta = col.columnDef.meta as ColumnMeta | undefined
    return meta?.aggregate != null
  })
  if (!hasAggregate) return null

  return (
    <tfoot className={cn("bg-muted/50 font-medium", classNames?.footer)}>
      <tr className="border-t-2 border-border">
        {visibleCols.map((col) => {
          const meta = col.columnDef.meta as ColumnMeta | undefined
          const align =
            meta?.align === "right"
              ? "text-right"
              : meta?.align === "center"
                ? "text-center"
                : "text-left"
          const tdClass = meta?.tdClass ?? align
          const widthStyle = meta?.width ? { width: meta.width } : undefined
          const aggregate = meta?.aggregate

          let content: React.ReactNode = null

          const cellIndex = visibleCols.indexOf(col)
          if (cellIndex === 0) {
            content = "Total"
          } else if (aggregate != null) {
            const values = rows.map(
              (r: Row<DataTableFeatures, TData>) =>
                r.original[col.id as keyof TData]
            )
            if (aggregate === "sum") {
              content = sumValues(values)
            } else {
              const aggFn = aggregate
              content = aggFn.fn(
                values,
                rows.map((r) => r.original)
              )
            }
          }

          return (
            <td
              key={col.id}
              style={widthStyle}
              className={cn(
                `px-3 py-3 whitespace-nowrap text-sm font-semibold ${tdClass}`,
                classNames?.footerCell
              )}
            >
              {content ?? ""}
            </td>
          )
        })}
      </tr>
    </tfoot>
  )
}
