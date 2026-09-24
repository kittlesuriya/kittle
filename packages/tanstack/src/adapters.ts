import type {
  DataTableDataSource,
  DataTableQuery,
  DataTableResult,
} from "./data-table"

export interface TanStackFetchOptions {
  endpoint: string
  fetcher?: typeof fetch
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  encodeQuery?: (query: DataTableQuery) => URLSearchParams
}

export function encodeDataTableQuery(query: DataTableQuery): URLSearchParams {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
  if (query.search) params.set("search", query.search)
  if (query.sorting.length > 0)
    params.set("sort", JSON.stringify(query.sorting))
  if (query.filters && query.filters.conditions.length > 0)
    params.set("filters", JSON.stringify(query.filters))
  return params
}

function readTotal(payload: Record<string, unknown>): number {
  for (const key of ["total", "totalRows", "totalCount", "rowCount"]) {
    if (typeof payload[key] === "number") return payload[key]
  }
  return Array.isArray(payload.rows) ? payload.rows.length : 0
}

/** Create a DataTable source for Fetch-compatible CRUD/list endpoints. */
export function createFetchDataSource<TRow>({
  endpoint,
  fetcher = fetch,
  headers,
  encodeQuery = encodeDataTableQuery,
}: TanStackFetchOptions): DataTableDataSource<TRow> {
  return {
    async fetch(query) {
      const resolvedHeaders = headers
        ? await (typeof headers === "function" ? headers() : headers)
        : undefined
      const response = await fetcher(
        `${endpoint}?${encodeQuery(query).toString()}`,
        resolvedHeaders ? { headers: resolvedHeaders } : undefined
      )
      const payload = (await response.json()) as Record<string, unknown>
      if (!response.ok) {
        const message =
          typeof payload.message === "string"
            ? payload.message
            : "Unable to load results."
        throw new Error(message)
      }
      return {
        rows: Array.isArray(payload.rows) ? (payload.rows as TRow[]) : [],
        total: readTotal(payload),
      } satisfies DataTableResult<TRow>
    },
  }
}
