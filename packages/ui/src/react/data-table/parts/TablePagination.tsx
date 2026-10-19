"use no memo"

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { Button } from "../../ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select"
import { useTranslation } from "react-i18next"
import type { RowData } from "@tanstack/react-table"
import type { TablePaginationProps } from "../../../core/table/types"
import { cn } from "../../../core/cn"

const PAGE_SIZES = [10, 20, 30, 50, 100] as const

/**
 * TablePagination component with page size selection and navigation
 */
export function TablePagination<TData extends RowData>({
  table,
  showPagination = true,
  classNames,
}: TablePaginationProps<TData>): React.ReactElement | null {
  const { t } = useTranslation()
  if (!showPagination) return null

  const pageCount = table.getPageCount() || 1
  const currentPage = table.state.pagination.pageIndex + 1

  return (
    <nav
      aria-label={t("common.pagination", { defaultValue: "Pagination" })}
      className={cn(
        "flex flex-col sm:flex-row justify-between items-center py-4 px-2",
        classNames?.pagination
      )}
    >
      <div
        className={cn(
          "flex items-center space-x-3 mb-3 sm:mb-0",
          classNames?.paginationPageSize
        )}
      >
        <span
          className={cn(
            "text-sm text-muted-foreground",
            classNames?.paginationLabel
          )}
        >
          {t("common.rows_per_page", { defaultValue: "Rows per page:" })}
        </span>
        <Select
          value={`${table.state.pagination.pageSize}`}
          onValueChange={(value) => {
            table.setPageSize(Number(value))
          }}
        >
          <SelectTrigger
            aria-label={t("common.rows_per_page", {
              defaultValue: "Rows per page",
            })}
            className={cn("h-8 w-[70px]", classNames?.paginationSelect)}
          >
            <SelectValue placeholder={table.state.pagination.pageSize} />
          </SelectTrigger>
          <SelectContent
            side="top"
            className={classNames?.paginationSelectorContent}
          >
            {PAGE_SIZES.map((size) => (
              <SelectItem
                key={size}
                value={String(size)}
                className={classNames?.paginationSelectorItem}
              >
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className={cn(
          "flex items-center space-x-2",
          classNames?.paginationNavigation
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
          className={classNames?.paginationButton}
        >
          <span className="sr-only">
            {t("common.go_to_first_page", { defaultValue: "Go to first page" })}
          </span>
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className={classNames?.paginationButton}
        >
          <span className="sr-only">
            {t("common.go_to_previous_page", {
              defaultValue: "Go to previous page",
            })}
          </span>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span
          className={cn(
            "text-sm px-3 py-1 bg-background border border-input rounded-md min-w-[90px] text-center font-medium h-8 flex items-center justify-center",
            classNames?.paginationPageIndicator
          )}
        >
          {currentPage} {t("common.of", { defaultValue: "of" })} {pageCount}
        </span>

        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className={classNames?.paginationButton}
        >
          <span className="sr-only">
            {t("common.go_to_next_page", { defaultValue: "Go to next page" })}
          </span>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => table.setPageIndex(pageCount - 1)}
          disabled={!table.getCanNextPage()}
          className={classNames?.paginationButton}
        >
          <span className="sr-only">
            {t("common.go_to_last_page", { defaultValue: "Go to last page" })}
          </span>
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  )
}
