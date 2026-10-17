import { Skeleton } from "../../ui/skeleton"
import { cn } from "../../../core/cn"

interface TableLoadingStateProps {
  title: string
  columnCount: number
  rowCount?: number
  showFilters?: boolean
}

export function TableLoadingState({
  columnCount,
  rowCount = 7,
}: TableLoadingStateProps) {
  const safeColumnCount = Math.max(columnCount, 6)

  return (
    <div className="flex flex-col w-full h-full space-y-4">
      {/* Main Table Card */}
      <div className="rounded-2xl border bg-card shadow-sm overflow-hidden border-border/40">
        {/* Header Section */}
        <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            {/* Title Skeleton with a hint of the orange color in opacity */}
            <Skeleton className="h-7 w-48 rounded-lg bg-primary/10" />
            <Skeleton className="h-5 w-14 rounded-full bg-muted/60" />
          </div>

          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-24 rounded-lg border" />
            <Skeleton className="h-9 w-20 rounded-lg border" />
            <Skeleton className="h-9 w-28 rounded-lg bg-primary/20" />
          </div>
        </div>

        {/* Table structure */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
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
            <tbody className="divide-y divide-border/30">
              {Array.from({ length: rowCount }).map((_, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="hover:bg-muted/5 transition-colors"
                >
                  {Array.from({ length: safeColumnCount }).map(
                    (__, colIndex) => (
                      <td key={colIndex} className="px-6 py-3 align-middle">
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
        <div className="flex items-center justify-between px-6 py-4 border-t bg-card">
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
