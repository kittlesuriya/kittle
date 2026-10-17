import {
  columnOrderingFeature,
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table"

/**
 * Shared TanStack Table v9 feature set for every DataTable.
 * Sorting/pagination state is server-driven (manual* flags stay on), but the
 * features must be registered for their state slices, and both row models
 * cover the client-paginated mode (manualPagination === false).
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
})

export type DataTableFeatures = typeof dataTableFeatures
