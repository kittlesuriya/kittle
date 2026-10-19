import { Skeleton } from "../../ui/skeleton"
import { cn } from "../../../core/cn"
import type { DataTableClassNames } from "../../../core/table/types"

interface TableLoadingStateProps {
  title: string
  columnCount: number
  rowCount?: number
  showFilters?: boolean
  className?: string
  classNames?: Pick<
    DataTableClassNames,
    | "loadingCard"
    | "loadingHeader"
    | "loadingContent"
    | "loadingToolbar"
    | "loadingTable"
    | "loadingTableHeader"
    | "loadingTableBody"
    | "loadingRow"
    | "loadingCell"
    | "loadingFooter"
  >
}

export function TableLoadingState({
  columnCount,
  rowCount = 7,
  className,
  classNames,
}: TableLoadingStateProps) {
  const safeColumnCount = Math.max(columnCount, 6)

  return (
    <div className={cn("flex flex-col w-full h-full space-y-4", className)}>
      {/* Main Table Card */}
      <div
        className={cn(
          "rounded-2xl border bg-card shadow-sm overflow-hidden border-border/40",
          classNames?.loadingCard
        )}
      >
        {/* Header Section */}
        <div
          className={cn(
            "flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between",
            classNames?.loadingHeader
          )}
        >
          <div className="flex items-center gap-3">
            {/* Title Skeleton with a hint of the orange color in opacity */}
            <Skeleton className="h-7 w-48 rounded-lg bg-primary/10" />
            <Skeleton className="h-5 w-14 rounded-full bg-muted/60" />
          </div>

          <div
            className={cn(
              "flex items-center gap-3",
              classNames?.loadingToolbar
            )}
          >
            <Skeleton className="h-9 w-24 rounded-lg border" />
            <Skeleton className="h-9 w-20 rounded-lg border" />
            <Skeleton className="h-9 w-28 rounded-lg bg-primary/20" />
          </div>
        </div>

        {/* Table structure */}
        <div className={cn("overflow-x-auto", classNames?.loadingContent)}>
          <table
            className={cn("w-full border-collapse", classNames?.loadingTable)}
          >
            <thead className={classNames?.loadingTableHeader}>
              <tr className="bg-muted/5">
                {Array.from({ length: safeColumnCount }).map((_, i) => (
                  <th
                    key={i}
                    className="px-6 py-3 text-left border-b border-border/30"
                  >
                    <Skeleton
                      className={cn("h-3", i === 0 ? "w-16" : "w-20")}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              className={cn(
                "divide-y divide-border/30",
                classNames?.loadingTableBody
              )}
            >
              {Array.from({ length: rowCount }).map((_, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={cn(
                    "hover:bg-muted/5 transition-colors",
                    classNames?.loadingRow
                  )}
                >
                  {Array.from({ length: safeColumnCount }).map(
                    (__, colIndex) => (
                      <td
                        key={colIndex}
                        className={cn(
                          "px-6 py-3 align-middle",
                          classNames?.loadingCell
                        )}
                      >
                        <div className="flex items-center gap-3">
                          {colIndex === safeColumnCount - 2 ? (
                            /* Status Pill */
                            <Skeleton className="h-5 w-14 rounded-full bg-primary/10" />
                          ) : colIndex === safeColumnCount - 1 ? (
                            /* Action Dots */
                            <Skeleton className="h-4 w-1 rounded-full ml-auto opacity-30" />
                          ) : (
                            /* Normal Text */
                            <Skeleton
                              className={cn(
                                "h-3.5 rounded-sm",
                                colIndex === 0
                                  ? "w-24"
                                  : colIndex === 1
                                    ? "w-40"
                                    : "w-20"
                              )}
                            />
                          )}
                        </div>
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Section */}
        <div
          className={cn(
            "flex items-center justify-between px-6 py-4 border-t bg-card",
            classNames?.loadingFooter
          )}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-16 rounded-lg border" />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex gap-1">
              <Skeleton className="h-8 w-8 rounded-md border" />
              <Skeleton className="h-8 w-8 rounded-md border" />
            </div>
            <Skeleton className="h-9 w-24 rounded-md border" />
            <div className="flex gap-1">
              <Skeleton className="h-8 w-8 rounded-md border" />
              <Skeleton className="h-8 w-8 rounded-md border" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
