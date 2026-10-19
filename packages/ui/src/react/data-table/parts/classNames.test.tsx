// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { TableEmptyState } from "./TableEmptyState"
import { TableErrorState } from "./TableErrorState"
import { TableLoadingState } from "./TableLoadingState"
import { OperationModal } from "./OperationModal"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

function render(element: ReactElement) {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(element))
  return host
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

describe("DataTable part class overrides", () => {
  it("retains empty-state defaults and lets caller utilities win conflicts", () => {
    const el = render(
      <table>
        <TableEmptyState colSpan={2} className="p-4 bg-red-500" />
      </table>
    )
    const cell = el.querySelector("td")
    expect(cell?.className).toContain("p-4")
    expect(cell?.className).not.toContain("p-0")
    expect(cell?.className).toContain("bg-red-500")
  })

  it("applies the error slot to the existing root element", () => {
    let retries = 0
    const el = render(
      <TableErrorState
        className="error-custom"
        iconClassName="error-icon-slot"
        contentClassName="error-content-slot"
        retryClassName="error-retry-slot"
        classNames={{ root: "inline-error-slot" }}
        onRetry={() => retries++}
      />
    )
    expect(el.firstElementChild?.className).toContain("error-custom")
    expect(el.firstElementChild?.className).toContain("rounded-lg")
    for (const slot of [
      "error-icon-slot",
      "error-content-slot",
      "error-retry-slot",
      "inline-error-slot",
    ]) {
      expect(el.querySelector(`.${slot}`), slot).not.toBeNull()
    }
    act(() => (el.querySelector("button") as HTMLButtonElement).click())
    expect(retries).toBe(1)
  })

  it("applies loading slots to the actual skeleton structure", () => {
    const el = render(
      <TableLoadingState
        title="Items"
        columnCount={2}
        classNames={{
          loadingCard: "loading-card-slot",
          loadingHeader: "loading-header-slot",
          loadingContent: "loading-content-slot",
          loadingToolbar: "loading-toolbar-slot",
          loadingTable: "loading-table-slot",
          loadingTableHeader: "loading-thead-slot",
          loadingTableBody: "loading-tbody-slot",
          loadingRow: "loading-row-slot",
          loadingCell: "loading-cell-slot",
          loadingFooter: "loading-footer-slot",
        }}
      />
    )
    for (const slot of [
      "loading-card-slot",
      "loading-header-slot",
      "loading-content-slot",
      "loading-toolbar-slot",
      "loading-table-slot",
      "loading-thead-slot",
      "loading-tbody-slot",
      "loading-row-slot",
      "loading-cell-slot",
      "loading-footer-slot",
    ]) {
      expect(el.querySelector(`.${slot}`), slot).not.toBeNull()
    }
  })

  it("forwards dialog and operation section slots", () => {
    const el = render(
      <OperationModal
        open
        onOpenChange={() => {}}
        modalType="delete"
        title="Item"
        operation={{
          confirmation: { message: "Confirm removal" },
          handler: () => {},
        }}
        rowData={{ id: "1" }}
        onExecute={() => {}}
        displayMode="dialog"
        dialogClassNames={{
          overlay: "dialog-overlay-slot",
          content: "dialog-content-slot",
          close: "dialog-close-slot",
        }}
        classNames={{
          operationModalHeader: "operation-header-slot",
          operationModalTitle: "operation-title-slot",
          operationModalBody: "operation-body-slot",
          operationModalFooter: "operation-footer-slot",
          operationConfirm: "operation-confirm-slot",
          operationCancel: "operation-cancel-slot",
        }}
      />
    )
    for (const slot of [
      "dialog-overlay-slot",
      "dialog-content-slot",
      "dialog-close-slot",
      "operation-header-slot",
      "operation-title-slot",
      "operation-body-slot",
      "operation-footer-slot",
      "operation-confirm-slot",
      "operation-cancel-slot",
    ]) {
      expect(
        document.body.querySelector(`.${slot}`) ?? el.querySelector(`.${slot}`),
        slot
      ).not.toBeNull()
    }
  })

  it("forwards sheet overlay and close slots", () => {
    const el = render(
      <OperationModal
        open
        onOpenChange={() => {}}
        modalType="delete"
        title="Item"
        operation={{
          confirmation: { message: "Confirm removal" },
          handler: () => {},
        }}
        rowData={{ id: "1" }}
        onExecute={() => {}}
        displayMode="sheet"
        sheetClassNames={{
          overlay: "sheet-overlay-slot",
          content: "sheet-content-slot",
          close: "sheet-close-slot",
        }}
      />
    )
    for (const slot of [
      "sheet-overlay-slot",
      "sheet-content-slot",
      "sheet-close-slot",
    ]) {
      expect(
        document.body.querySelector(`.${slot}`) ?? el.querySelector(`.${slot}`),
        slot
      ).not.toBeNull()
    }
  })
})
