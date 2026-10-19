import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { DEFAULT_UI_RUNTIME, UiRuntimeProvider } from "../../core/runtime"
import type {
  ColumnGroup,
  DataTableClassNames,
  OperationsConfig,
} from "../../core/table/types"
import { DataTable } from "./DataTable"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
})

const response = { rows: [{ id: "1", name: "Example" }], rowCount: 1 }
const columns = [{ columns: [{ accessorKey: "name" as const }] }]
const fetchData = { endpoint: "/items", key: "styling-test" }
let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  localStorage.clear()
  vi.unstubAllGlobals()
})

function renderTable(
  classNames?: DataTableClassNames,
  exports?: { csv: { label: string; handler: () => void } },
  operations?: OperationsConfig<{ id: string; name: string }>,
  customColumns?: ColumnGroup<{ id: string; name: string }>[]
) {
  host ??= document.createElement("div")
  document.body.append(host)
  root ??= createRoot(host)
  act(() => {
    root?.render(
      <UiRuntimeProvider
        runtime={{
          request: {
            ...DEFAULT_UI_RUNTIME.request,
            useQuery: <TData,>() => ({
              data: response as TData,
              error: undefined,
              isLoading: false,
              isFetching: false,
              refetch: () => {},
            }),
          },
        }}
      >
        <DataTable
          title="Items"
          subject="Item"
          tag="styling-test"
          columnsConfig={customColumns ?? columns}
          fetchData={fetchData}
          organizationRequired={false}
          className="outer-table"
          classNames={classNames}
          exports={exports}
          operations={operations}
          filterConfig={{
            schema: z.object({
              name: z.string(),
              status: z.enum(["open", "closed"]),
            }),
            queryBuilderUi: { defaultMode: "simple", allowedModes: ["simple"] },
            queryBuilderClassNames: {
              container: "nested-filter-card",
              filterTrigger: "nested-filter-trigger",
            },
            queryBuilderPartClassNames: {
              valueSelect: {
                trigger: "nested-select-trigger",
                content: "nested-select-popup",
              },
            },
            queryBuilderFieldStyles: {
              name: { classNames: { valueInput: "nested-field-input" } },
            },
          }}
        />
      </UiRuntimeProvider>
    )
  })
  return host
}

describe("DataTable styling integration", () => {
  it("forwards table part overrides and embedded QueryBuilder styles", () => {
    const container = renderTable({
      card: "custom-card shadow-none",
      toolbar: "custom-toolbar",
      header: "custom-header",
      headerCell: "custom-header-cell",
      body: "custom-body",
      row: "custom-row",
      cell: "custom-cell py-4",
      pagination: "custom-pagination",
    })
    const filterToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Filters")
    )
    expect(filterToggle).toBeDefined()
    act(() => filterToggle?.click())
    for (const slot of [
      "outer-table",
      "custom-card",
      "custom-toolbar",
      "custom-header",
      "custom-header-cell",
      "custom-body",
      "custom-row",
      "custom-cell",
      "custom-pagination",
      "nested-filter-card",
      "nested-filter-trigger",
      "nested-select-trigger",
      "nested-field-input",
    ]) {
      expect(container.querySelector(`.${slot}`), slot).not.toBeNull()
    }
    const cell = container.querySelector("td")
    expect(cell?.classList.contains("py-4")).toBe(true)
    expect(cell?.classList.contains("py-1")).toBe(false)
  })

  it("updates overrides when the caller rerenders", () => {
    const container = renderTable({ cell: "before" })
    expect(container.querySelector("td.before")).not.toBeNull()
    renderTable({ cell: "after" })
    expect(container.querySelector("td.before")).toBeNull()
    expect(container.querySelector("td.after")).not.toBeNull()
  })

  it("applies menu, export, pagination, and row-operation slots to real controls", () => {
    const onExport = vi.fn()
    const container = renderTable(
      {
        columnMenuButton: "columns-trigger-slot",
        columnMenuContent: "columns-popup-slot",
        columnMenuItem: "columns-item-slot",
        columnMenuLabel: "columns-label-slot",
        exportButton: "export-trigger-slot",
        exportMenuContent: "export-popup-slot",
        exportMenuItem: "export-item-slot",
        paginationPageSize: "page-size-slot",
        paginationLabel: "pagination-label-slot",
        paginationSelect: "pagination-select-slot",
        paginationNavigation: "pagination-nav-slot",
        paginationButton: "pagination-button-slot",
        paginationPageIndicator: "pagination-indicator-slot",
        operationTrigger: "operation-trigger-slot",
        operationMenu: "operation-menu-slot",
      },
      { csv: { label: "CSV", handler: onExport } }
    )
    for (const slot of [
      "columns-trigger-slot",
      "export-trigger-slot",
      "page-size-slot",
      "pagination-label-slot",
      "pagination-select-slot",
      "pagination-nav-slot",
      "pagination-button-slot",
      "pagination-indicator-slot",
    ]) {
      expect(container.querySelector(`.${slot}`), slot).not.toBeNull()
    }
    const columnButton = container.querySelector(
      ".columns-trigger-slot"
    ) as HTMLButtonElement
    act(() => columnButton.click())
    expect(document.body.querySelector(".columns-popup-slot")).not.toBeNull()
    expect(document.body.querySelector(".columns-item-slot")).not.toBeNull()
    expect(document.body.querySelector(".columns-label-slot")).not.toBeNull()
    act(() =>
      (
        container.querySelector(".export-trigger-slot") as HTMLButtonElement
      ).click()
    )
    expect(document.body.querySelector(".export-popup-slot")).not.toBeNull()
    expect(document.body.querySelector(".export-item-slot")).not.toBeNull()
    act(() => {
      document.querySelector<HTMLElement>(".export-item-slot")?.click()
    })
    expect(onExport).toHaveBeenCalledOnce()
    expect(
      container.querySelector<HTMLButtonElement>(".pagination-button-slot")
        ?.disabled
    ).toBe(true)
  })

  it("forwards row-action slots, updates them and preserves operation callbacks", async () => {
    const handler = vi.fn()
    const operations = { view: { handler } }
    const container = renderTable(
      { operationTrigger: "before-trigger" },
      undefined,
      operations
    )
    expect(container.querySelector(".before-trigger")).not.toBeNull()
    renderTable(
      {
        operationTrigger: "after-trigger",
        operationMenu: "actions-menu",
        operationAction: "action-item",
      },
      undefined,
      operations
    )
    expect(container.querySelector(".before-trigger")).toBeNull()
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".after-trigger")?.click()
    })
    expect(document.querySelector(".actions-menu")).not.toBeNull()
    await act(async () => {
      document.querySelector<HTMLElement>(".action-item")?.click()
    })
    expect(handler).toHaveBeenCalledWith(response.rows[0])
  })

  it("preserves column metadata selection while applying explicit slot overrides last", () => {
    const container = renderTable(
      { cell: "bg-green-500", headerCell: "bg-green-500" },
      undefined,
      undefined,
      [
        {
          columns: [
            {
              accessorKey: "name",
              headerClassName: "chosen-header bg-red-500",
              cellClassName: "chosen-cell bg-red-500",
              className: "discarded-column bg-blue-500",
              meta: { thClass: "discarded-header", tdClass: "discarded-cell" },
            },
          ],
        },
      ]
    )
    const header = container.querySelector("th")
    const cell = container.querySelector("td")
    expect(header?.classList.contains("chosen-header")).toBe(true)
    expect(cell?.classList.contains("chosen-cell")).toBe(true)
    for (const element of [header, cell]) {
      expect(element?.classList.contains("bg-green-500")).toBe(true)
      expect(element?.classList.contains("bg-red-500")).toBe(false)
    }
    expect(
      container.querySelector(
        ".discarded-column, .discarded-header, .discarded-cell"
      )
    ).toBeNull()
  })
})
