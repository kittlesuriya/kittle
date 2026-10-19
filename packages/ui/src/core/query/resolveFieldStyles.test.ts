import { describe, expect, it } from "vitest"
import { resolveQueryBuilderFieldStyles } from "./resolveFieldStyles"

describe("query field style resolution", () => {
  it("merges compatible classes and lets field-specific parts win conflicts", () => {
    const shared = {
      valueSelect: { trigger: "shared h-8", content: "rounded-none" },
    }
    const result = resolveQueryBuilderFieldStyles(
      { selectTrigger: "generic" },
      shared,
      {
        classNames: { selectTrigger: "field h-12" },
        partClassNames: { valueSelect: { trigger: "specific h-16" } },
      }
    )
    expect(result.classNames.selectTrigger).toBe("generic field h-12")
    expect(result.partClassNames.valueSelect?.trigger).toBe(
      "shared field specific h-16"
    )
    expect(result.partClassNames.valueSelect?.content).toBe("rounded-none")
    expect(shared.valueSelect.trigger).toBe("shared h-8")
  })

  it("lets field generic controls override shared nested defaults", () => {
    const result = resolveQueryBuilderFieldStyles(
      undefined,
      {
        multiSelect: { trigger: "shared h-8", popover: "popup" },
      },
      { classNames: { multiSelect: "h-12" } }
    )
    expect(result.partClassNames.multiSelect?.trigger).toBe("shared h-12")
    expect(result.partClassNames.multiSelect?.popover).toBe("popup")
  })

  it("does not erase shared styles with an undefined field override", () => {
    const result = resolveQueryBuilderFieldStyles(
      { valueInput: "shared" },
      undefined,
      { classNames: { valueInput: undefined } }
    )
    expect(result.classNames.valueInput).toBe("shared")
  })
})
