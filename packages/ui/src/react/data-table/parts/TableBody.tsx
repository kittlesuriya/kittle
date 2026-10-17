"use no memo"

import { flexRender, type RowData } from "@tanstack/react-table"
import type { TableBodyProps, ColumnMeta } from "../../../core/table/types"

/**
 * TableBody component for rendering table rows
 */
export function TableBody<TData extends RowData>({
  table,
}: TableBodyProps<TData>): React.ReactElement {
  const rows = table.getRowModel().rows

  if (!rows.length) {
    return (
      <tbody>
        <tr>
          <td
            colSpan={table.getAllLeafColumns().length || 1}
            className="py-10 text-center text-muted-foreground"
          >
            No data available
          </td>
        </tr>
      </tbody>
    )
  }

  return (
    <tbody className="divide-y divide-border">
      {rows.map((row) => (
        <tr
          key={row.id}
          className="table-row-virtualized hover:bg-accent/50 transition-colors duration-150"
        >
          {row.getVisibleCells().map((cell) => {
            const meta = cell.column.columnDef.meta as ColumnMeta | undefined
            const align =
              meta?.align === "right"
                ? "text-right"
                : meta?.align === "center"
                  ? "text-center"
                  : "text-left"
            const tdClass = meta?.tdClass ?? align
            const widthStyle: React.CSSProperties | undefined =
              meta?.width || meta?.maxWidth || meta?.minWidth
                ? {
                    ...(meta.width && { width: meta.width }),
                    ...(meta.maxWidth && { maxWidth: meta.maxWidth }),
                    ...(meta.minWidth && { minWidth: meta.minWidth }),
                  }
                : undefined
            const isWrap = Boolean(
              meta?.wrap || meta?.tdClass?.includes("whitespace-")
            )
            return (
              <td
                key={cell.id}
                style={widthStyle}
                className={`px-3 py-1 ${isWrap ? "whitespace-normal" : "whitespace-nowrap"} text-sm text-foreground ${tdClass}`}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            )
          })}
        </tr>
      ))}
    </tbody>
  )
}
