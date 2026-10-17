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

const PAGE_SIZES = [10, 20, 30, 50, 100] as const

/**
 * TablePagination component with page size selection and navigation
 */
export function TablePagination<TData extends RowData>({
  table,
  showPagination = true,
}: TablePaginationProps<TData>): React.ReactElement | null {
  const { t } = useTranslation()
  if (!showPagination) return null

  const pageCount = table.getPageCount() || 1
  const currentPage = table.state.pagination.pageIndex + 1

  return (
    <nav
      aria-label={t("common.pagination", { defaultValue: "Pagination" })}
      className="flex flex-col sm:flex-row justify-between items-center py-4 px-2"
    >
      <div className="flex items-center space-x-3 mb-3 sm:mb-0">
        <span className="text-sm text-muted-foreground">
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
            className="h-8 w-[70px]"
          >
            <SelectValue placeholder={table.state.pagination.pageSize} />
          </SelectTrigger>
          <SelectContent side="top">
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center space-x-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
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
        >
          <span className="sr-only">
            {t("common.go_to_previous_page", {
              defaultValue: "Go to previous page",
            })}
          </span>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span className="text-sm px-3 py-1 bg-background border border-input rounded-md min-w-[90px] text-center font-medium h-8 flex items-center justify-center">
          {currentPage} {t("common.of", { defaultValue: "of" })} {pageCount}
        </span>

        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
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
