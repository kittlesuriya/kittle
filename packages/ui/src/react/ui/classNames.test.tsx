import { afterEach, describe, expect, it, vi } from "vitest"
import { act, type ReactElement } from "react"
import { CheckIcon } from "lucide-react"
import { createRoot, type Root } from "react-dom/client"
import { PasswordInput } from "./password-input"
import { CircularProgress } from "./circular-progress"
import { MultiSelect } from "./multi-select"
import { EmptyState } from "../feedback/EmptyState"
import { InlineError } from "../feedback/InlineError"
import { ScrollArea } from "./scroll-area"
import { Dialog, DialogContent } from "./dialog"
import { Sheet, SheetContent } from "./sheet"
import {
  Autocomplete,
  AutocompleteTrigger,
  AutocompleteContent,
  AutocompleteList,
  AutocompleteEmpty,
  AutocompleteGroup,
} from "./autocomplete"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(window, "matchMedia", {
  value: () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }),
  configurable: true,
})

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

describe("composite classNames slots", () => {
  it("applies Autocomplete slots to composed DOM and preserves local classes", () => {
    render(
      <Autocomplete
        open
        items={[{ label: "Alpha", value: "a" }]}
        classNames={{
          input: "auto-input h-8",
          trigger: "auto-trigger",
          content: "auto-content",
          list: "auto-list",
          item: "auto-item",
          group: "auto-group",
          groupLabel: "auto-heading",
          empty: "auto-empty",
          control: "auto-control",
          itemLabel: "auto-item-label",
          itemIndicator: "auto-item-indicator",
        }}
      >
        <AutocompleteTrigger className="local-input h-12" />
        <AutocompleteContent>
          <AutocompleteEmpty>None</AutocompleteEmpty>
          <AutocompleteList />
          <AutocompleteGroup heading="Group">
            <div />
          </AutocompleteGroup>
        </AutocompleteContent>
      </Autocomplete>
    )
    expect(host?.querySelector("input")?.className).toContain("auto-input")
    expect(host?.querySelector("input")?.className).toContain("local-input")
    expect(host?.querySelector("input")?.classList.contains("h-12")).toBe(true)
    expect(host?.querySelector("input")?.classList.contains("h-8")).toBe(false)
    expect(
      document.querySelector('[data-slot="autocomplete-content"]')?.className
    ).toContain("auto-content")
    expect(
      document.querySelector('[data-slot="autocomplete-list"]')?.className
    ).toContain("auto-list")
    expect(
      document.querySelector('[data-slot="autocomplete-item"]')?.className
    ).toContain("auto-item")
    for (const slot of [
      "auto-control",
      "auto-trigger",
      "auto-group",
      "auto-heading",
      "auto-item-label",
      "auto-item-indicator",
    ]) {
      expect(document.querySelector(`.${slot}`), slot).not.toBeNull()
    }
  })
  it("styles PasswordInput internals and retains component defaults", () => {
    const el = render(
      <PasswordInput
        classNames={{
          root: "root-test",
          input: "input-test",
          toggle: "toggle-test",
          icon: "icon-test",
        }}
      />
    )
    expect(el.querySelector('[data-slot="input-group"]')?.className).toContain(
      "root-test"
    )
    expect(el.querySelector("input")?.className).toContain("input-test")
    expect(el.querySelector("button")?.className).toContain("toggle-test")
    expect(el.querySelector("button svg")?.getAttribute("class")).toContain(
      "icon-test"
    )
    expect(el.querySelector("input")?.className).toContain("w-full")
  })

  it("styles CircularProgress SVG slots and keeps progress semantics", () => {
    const el = render(
      <CircularProgress
        percent={42}
        className="legacy-svg"
        classNames={{
          root: "root-test",
          svg: "svg-test",
          track: "track-test",
          indicator: "indicator-test",
          content: "content-test",
        }}
      >
        42%
      </CircularProgress>
    )
    expect(
      el.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")
    ).toBe("42")
    expect(el.firstElementChild?.className).toContain("root-test")
    expect(el.querySelector("svg")?.getAttribute("class")).toContain(
      "legacy-svg"
    )
    expect(el.querySelector("svg")?.getAttribute("class")).toContain("svg-test")
    expect(el.querySelectorAll("circle")[0]?.getAttribute("class")).toContain(
      "track-test"
    )
    expect(el.querySelectorAll("circle")[1]?.getAttribute("class")).toContain(
      "indicator-test"
    )
    expect(
      el.querySelector("svg")?.nextElementSibling?.getAttribute("class")
    ).toContain("content-test")
  })

  it("styles feedback roots and content", () => {
    const empty = render(
      <EmptyState
        title="Nothing"
        description="Try later"
        action={{ label: "Create", onClick: () => {} }}
        className="legacy"
        classNames={{
          root: "root-test",
          title: "title-test",
          description: "description-test",
          iconBackground: "icon-background-test",
          actionIcon: "action-icon-test",
        }}
      />
    )
    expect(empty.firstElementChild?.className).toContain("legacy")
    expect(empty.firstElementChild?.className).toContain("root-test")
    expect(empty.querySelector("h3")?.className).toContain("title-test")
    expect(empty.querySelector("p")?.className).toContain("description-test")
    expect(empty.querySelector(".icon-background-test")).not.toBeNull()
    expect(empty.querySelector(".action-icon-test")).not.toBeNull()
    act(() =>
      root?.render(
        <InlineError message="Oops" classNames={{ root: "error-test" }} />
      )
    )
    expect(host?.firstElementChild?.className).toContain("error-test")
  })

  it("keeps MultiSelect legacy popover classes alongside slot overrides", () => {
    const el = render(
      <MultiSelect
        options={[{ label: "One", value: "one" }]}
        onValueChange={() => {}}
        popoverClassName="bg-red-500 legacy-popover"
        classNames={{
          trigger: "trigger-test",
          list: "list-test",
          option: "option-test",
          popover: "bg-blue-500 popover-test",
        }}
      />
    )
    expect(el.querySelector("button")?.className).toContain("trigger-test")
    act(() => {
      el.querySelector("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      )
    })
    expect(document.body.textContent).toContain("One")
    const popup = document.querySelector('[data-slot="combobox-popup"]')
    expect(popup?.className).toContain("popover-test")
    expect(popup?.className).toContain("bg-blue-500")
    expect(popup?.className).not.toContain("bg-red-500")
    expect(document.querySelector('[role="listbox"]')?.className).toContain(
      "list-test"
    )
    expect(document.querySelector('[role="option"]')?.className).toContain(
      "option-test"
    )
  })

  it("styles MultiSelect chips, grouped options and selection actions", () => {
    const onChange = vi.fn()
    const el = render(
      <MultiSelect
        options={[
          {
            heading: "Team",
            options: [
              { label: "Ada", value: "ada", icon: CheckIcon },
              { label: "Grace", value: "grace" },
            ],
          },
        ]}
        defaultValue={["ada", "grace"]}
        maxCount={1}
        onValueChange={onChange}
        classNames={{
          chip: "chip-slot",
          chipRemove: "remove-slot",
          overflow: "overflow-slot",
          clearButton: "clear-slot",
          searchWrapper: "search-wrap-slot",
          searchIcon: "search-icon-slot",
          selectionActions: "actions-slot",
          selectAllButton: "select-all-slot",
          clearSelectionButton: "clear-selection-slot",
          group: "group-slot",
          groupLabel: "group-label-slot",
          optionIcon: "option-icon-slot",
          optionLabel: "option-label-slot",
          indicator: "indicator-slot",
          chevron: "chevron-slot",
        }}
      />
    )
    for (const slot of [
      "chip-slot",
      "remove-slot",
      "overflow-slot",
      "clear-slot",
    ])
      expect(el.querySelector(`.${slot}`)).not.toBeNull()
    act(() => {
      el.querySelector("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      )
    })
    for (const slot of [
      "search-wrap-slot",
      "search-icon-slot",
      "actions-slot",
      "select-all-slot",
      "clear-selection-slot",
      "group-slot",
      "group-label-slot",
      "option-icon-slot",
      "option-label-slot",
      "indicator-slot",
    ])
      expect(document.querySelector(`.${slot}`), slot).not.toBeNull()
    act(() => {
      el.querySelector<HTMLElement>(".remove-slot")?.click()
    })
    expect(onChange).toHaveBeenLastCalledWith(["grace"])
    act(() => {
      document.querySelector<HTMLButtonElement>(".select-all-slot")?.click()
    })
    expect(onChange).toHaveBeenLastCalledWith(["ada", "grace"])
    act(() => {
      document
        .querySelector<HTMLButtonElement>(".clear-selection-slot")
        ?.click()
    })
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it("styles MultiSelect placeholder, search clear, and empty state", async () => {
    const el = render(
      <MultiSelect
        options={[{ label: "Alpha", value: "a" }]}
        onValueChange={() => {}}
        classNames={{
          placeholder: "placeholder-slot",
          empty: "empty-slot",
          searchClearButton: "search-clear-slot",
        }}
      />
    )
    expect(el.querySelector(".placeholder-slot")).not.toBeNull()
    await act(async () => {
      el.querySelector("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      )
    })
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search options..."]'
    )
    expect(input).not.toBeNull()
    await act(async () => {
      if (input) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set?.call(input, "missing")
        input.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })
    expect(document.querySelector(".search-clear-slot")).not.toBeNull()
    expect(document.querySelector(".empty-slot")).not.toBeNull()
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".search-clear-slot")?.click()
    })
    expect(input?.value).toBe("")
    expect(document.querySelector(".empty-slot")).toBeNull()
  })

  it("styles ScrollArea viewport", async () => {
    await act(async () => {
      render(
        <ScrollArea
          classNames={{ viewport: "viewport-test", corner: "corner-test" }}
        >
          content
        </ScrollArea>
      )
    })
    expect(
      host?.querySelector('[data-slot="scroll-area-viewport"]')?.className
    ).toContain("viewport-test")
  })

  it("styles partial tree selection indicators without changing selection", () => {
    const changed = vi.fn()
    const container = render(
      <MultiSelect
        options={[
          { label: "Parent", value: "parent" },
          { label: "One", value: "one" },
          { label: "Two", value: "two" },
        ]}
        defaultValue={["one"]}
        getDescendantValues={(value) =>
          value === "parent" ? ["one", "two"] : []
        }
        onValueChange={changed}
        classNames={{
          partialIndicator: "partial-slot",
          indicator: "selected-slot",
        }}
      />
    )
    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click()
    })
    expect(document.querySelector(".partial-slot")).not.toBeNull()
    expect(document.querySelector(".selected-slot")).not.toBeNull()
    expect(changed).not.toHaveBeenCalled()
  })

  it("styles generated Dialog and Sheet overlay and close controls", () => {
    render(
      <>
        <Dialog open>
          <DialogContent
            classNames={{
              overlay: "dialog-overlay-test",
              close: "dialog-close-test",
              closeIcon: "dialog-close-icon-test",
            }}
          >
            Dialog
          </DialogContent>
        </Dialog>
        <Sheet open>
          <SheetContent
            classNames={{
              overlay: "sheet-overlay-test",
              close: "sheet-close-test",
              closeIcon: "sheet-close-icon-test",
            }}
          >
            Sheet
          </SheetContent>
        </Sheet>
      </>
    )
    expect(
      document.querySelector('[data-slot="dialog-overlay"]')?.className
    ).toContain("dialog-overlay-test")
    expect(
      document.querySelector('[data-slot="sheet-overlay"]')?.className
    ).toContain("sheet-overlay-test")
    expect(
      [
        ...document.querySelectorAll('[data-slot="dialog-content"] button'),
      ].some((button) => button.className.includes("dialog-close-test"))
    ).toBe(true)
    expect(document.querySelector(".dialog-close-icon-test")).not.toBeNull()
    expect(document.querySelector(".sheet-close-icon-test")).not.toBeNull()
    expect(
      [...document.querySelectorAll('[data-slot="sheet-content"] button')].some(
        (button) => button.className.includes("sheet-close-test")
      )
    ).toBe(true)
  })
})
