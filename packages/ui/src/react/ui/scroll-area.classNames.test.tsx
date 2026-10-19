import { act, type ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { ScrollArea, ScrollBar } from "./scroll-area"

// jsdom has no overflow layout. Isolate forwarding for conditionally mounted
// scrollbar/thumb/corner parts; classNames.test.tsx covers the real viewport.
vi.mock("@base-ui/react/scroll-area", () => {
  function Part({ children, className, ...props }: ComponentProps<"div">) {
    return (
      <div {...props} className={className}>
        {children}
      </div>
    )
  }
  return {
    ScrollArea: {
      Root: Part,
      Viewport: Part,
      Scrollbar: Part,
      Thumb: Part,
      Corner: Part,
    },
  }
})

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

it("forwards each ScrollArea slot and both scrollbar orientations", () => {
  const host = document.createElement("div")
  const root = createRoot(host)
  try {
    act(() => {
      root.render(
        <ScrollArea
          className="legacy-root"
          classNames={{
            root: "root-slot",
            viewport: "viewport-slot",
            scrollbar: "bar-slot",
            thumb: "thumb-slot",
            corner: "corner-slot",
          }}
        >
          Content
          <ScrollBar
            orientation="horizontal"
            className="legacy-bar"
            classNames={{
              scrollbar: "horizontal-slot",
              thumb: "horizontal-thumb",
            }}
          />
        </ScrollArea>
      )
    })
    for (const slot of [
      "legacy-root",
      "root-slot",
      "viewport-slot",
      "bar-slot",
      "thumb-slot",
      "corner-slot",
      "legacy-bar",
      "horizontal-slot",
      "horizontal-thumb",
    ]) {
      expect(host.querySelector(`.${slot}`), slot).not.toBeNull()
    }
    expect(
      host.querySelector(".bar-slot")?.getAttribute("data-orientation")
    ).toBe("vertical")
    expect(
      host.querySelector(".horizontal-slot")?.getAttribute("data-orientation")
    ).toBe("horizontal")
  } finally {
    act(() => root.unmount())
  }
})
