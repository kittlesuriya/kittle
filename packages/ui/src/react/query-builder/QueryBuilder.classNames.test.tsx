import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { QueryBuilder } from "./QueryBuilder"

const schema = z.object({
  name: z.string(),
  status: z.enum(["open", "closed"]),
})
const initialValue = {
  id: "root",
  type: "group" as const,
  logic: "AND" as const,
  conditions: [
    {
      id: "nested",
      type: "group" as const,
      logic: "OR" as const,
      conditions: [
        {
          id: "condition",
          type: "condition" as const,
          field: "name",
          operator: "contains",
          value: "x",
        },
      ],
    },
  ],
}

const roots: Array<{ unmount: () => void; host: HTMLDivElement }> = []
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
function render(builder: React.ReactNode) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  roots.push({ unmount: () => root.unmount(), host })
  act(() => root.render(builder))
  return host
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
    root.host.remove()
  }
  window.localStorage.clear()
})

describe("QueryBuilder classNames", () => {
  it("preserves root className and applies root/container overrides", () => {
    const host = render(
      <QueryBuilder
        schema={schema}
        className="caller-root"
        defaultOpen
        classNames={{
          container: "custom-container p-10",
          filterTrigger: "filter-trigger-part",
          activeFilterIndicator: "active-indicator-part",
        }}
        initialValue={{
          ...initialValue,
          conditions: [
            {
              id: "active",
              type: "condition",
              field: "name",
              operator: "contains",
              value: "x",
            },
          ],
        }}
      />
    )
    expect(host.querySelector(".caller-root")).not.toBeNull()
    const container = host.querySelector(".custom-container")
    expect(container).not.toBeNull()
    expect(container?.className).toContain("rounded-xl")
    expect(container?.className).toContain("p-10")
    expect(container?.className).not.toContain("p-3")
    expect(host.querySelector(".filter-trigger-part")).not.toBeNull()
    expect(host.querySelector(".active-indicator-part")).not.toBeNull()
  })

  it("applies slots to simple controls", () => {
    const host = render(
      <QueryBuilder
        schema={schema}
        embedded
        ui={{ defaultMode: "simple", allowedModes: ["simple"] }}
        classNames={{
          container: "slot-container",
          toolbar: "slot-toolbar",
          searchInput: "slot-search",
          simplePanel: "slot-simple-panel",
          simpleGrid: "slot-simple-grid",
          simpleField: "slot-field",
          simpleFieldLabel: "slot-label",
          valueInput: "slot-value-input",
        }}
      />
    )
    for (const slot of [
      "slot-container",
      "slot-toolbar",
      "slot-simple-panel",
      "slot-simple-grid",
      "slot-field",
      "slot-label",
      "slot-value-input",
    ])
      expect(host.querySelector(`.${slot}`), slot).not.toBeNull()
    expect(host.querySelector('input[placeholder="Search..."]')).toBeNull()
  })

  it("propagates group, condition and value slots recursively", () => {
    const host = render(
      <QueryBuilder
        schema={schema}
        embedded
        ui={{ defaultMode: "advanced", allowedModes: ["advanced"] }}
        initialValue={initialValue}
        classNames={{
          group: "slot-group",
          groupHeader: "slot-group-header",
          groupContent: "slot-group-content",
          groupActions: "slot-group-actions",
          condition: "slot-condition",
          fieldSelectTrigger: "slot-field-select",
          operatorSelectTrigger: "slot-operator-select",
          valueWrapper: "slot-value-wrapper",
          valueInput: "slot-value-input",
        }}
      />
    )
    for (const slot of [
      "slot-group",
      "slot-group-header",
      "slot-group-content",
      "slot-group-actions",
      "slot-condition",
      "slot-field-select",
      "slot-operator-select",
      "slot-value-wrapper",
      "slot-value-input",
    ])
      expect(host.querySelector(`.${slot}`), slot).not.toBeNull()
    expect(host.querySelectorAll(".slot-group")).toHaveLength(2)
  })

  it("wires the new simple and recursive advanced part slots", () => {
    const simple = render(
      <QueryBuilder
        schema={schema}
        embedded
        ui={{
          defaultMode: "simple",
          allowedModes: ["simple", "advanced"],
          persistMode: false,
        }}
        classNames={{
          simpleModeButton: "simple-mode-part",
          advancedModeButton: "advanced-mode-part",
        }}
      />
    )
    expect(simple.querySelector(".simple-mode-part")).not.toBeNull()
    expect(simple.querySelector(".advanced-mode-part")).not.toBeNull()

    const advanced = render(
      <QueryBuilder
        schema={schema}
        embedded
        ui={{ defaultMode: "advanced", allowedModes: ["advanced"] }}
        initialValue={initialValue}
        classNames={{
          groupLogicToggle: "logic-part",
          groupLogicDescription: "logic-description-part",
          addConditionButton: "add-condition-part",
          addGroupButton: "add-group-part",
          removeGroupButton: "remove-group-part",
          removeConditionButton: "remove-condition-part",
          groupEmpty: "empty-group-part",
        }}
        partClassNames={{
          fieldSelect: {
            trigger: "field-trigger-part",
            content: "field-content-part",
            item: "field-item-part",
          },
          operatorSelect: {
            trigger: "operator-trigger-part",
            content: "operator-content-part",
            item: "operator-item-part",
          },
        }}
      />
    )
    for (const slot of [
      "logic-part",
      "logic-description-part",
      "add-condition-part",
      "add-group-part",
      "remove-group-part",
      "remove-condition-part",
      "field-trigger-part",
      "operator-trigger-part",
    ])
      expect(advanced.querySelector(`.${slot}`), slot).not.toBeNull()
    expect(advanced.querySelectorAll(".logic-part")).toHaveLength(2)
  })

  it("applies per-field styles to the selected field controls", () => {
    const host = render(
      <QueryBuilder
        schema={schema}
        embedded
        ui={{ defaultMode: "advanced", allowedModes: ["advanced"] }}
        initialValue={{
          ...initialValue,
          conditions: [
            {
              id: "c",
              type: "condition",
              field: "name",
              operator: "contains",
              value: "x",
            },
          ],
        }}
        classNames={{ valueInput: "shared-value-style text-red-500" }}
        fieldStyles={{
          name: {
            classNames: { valueInput: "field-value-style text-blue-500" },
            partClassNames: { fieldSelect: { trigger: "field-trigger-style" } },
          },
          status: {
            classNames: { fieldSelectTrigger: "status-field-trigger" },
          },
        }}
      />
    )
    expect(host.querySelector(".field-value-style")).not.toBeNull()
    expect(host.querySelector(".shared-value-style")).not.toBeNull()
    expect(host.querySelector(".text-blue-500")).not.toBeNull()
    expect(host.querySelector(".text-red-500")).toBeNull()
    expect(host.querySelector(".field-trigger-style")).not.toBeNull()
    const trigger = host.querySelector(
      "[data-slot='select-trigger']"
    ) as HTMLButtonElement
    act(() => trigger.click())
    const statusOption = Array.from(
      document.body.querySelectorAll('[role="option"]')
    ).find((option) => option.textContent?.includes("Status"))
    expect(statusOption).toBeDefined()
    act(() => (statusOption as HTMLElement).click())
    expect(host.querySelector(".field-value-style")).toBeNull()
    expect(host.querySelector(".status-field-trigger")).not.toBeNull()
  })

  it("wires empty state classes for schemas with no filter fields", () => {
    const host = render(
      <QueryBuilder
        schema={z.object({})}
        classNames={{ emptyState: "query-empty-structural" }}
        partClassNames={{
          emptyState: { root: "query-empty-root", title: "query-empty-title" },
        }}
      />
    )
    expect(host.querySelector(".query-empty-root")).not.toBeNull()
    expect(host.querySelector(".query-empty-title")).not.toBeNull()
    expect(host.querySelector(".query-empty-structural")).not.toBeNull()
  })

  it("forwards field select content classes into its portal and styles ranges", () => {
    const host = render(
      <QueryBuilder
        schema={z.object({ createdAt: z.date() })}
        embedded
        ui={{ defaultMode: "advanced", allowedModes: ["advanced"] }}
        initialValue={{
          id: "root",
          type: "group",
          logic: "AND",
          conditions: [
            {
              id: "date",
              type: "condition",
              field: "createdAt",
              operator: "between",
              value: { from: "2025-01-01", to: "2025-01-31" },
            },
          ],
        }}
        classNames={{ rangeSeparator: "date-range-separator" }}
        partClassNames={{ fieldSelect: { content: "portal-field-content" } }}
      />
    )
    expect(host.querySelector(".date-range-separator")).not.toBeNull()
    const trigger = host.querySelector("[data-slot='select-trigger']")
    expect(trigger).not.toBeNull()
    act(() => (trigger as HTMLButtonElement).click())
    expect(document.body.querySelector(".portal-field-content")).not.toBeNull()
  })
})
