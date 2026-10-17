import { describe, expect, it } from "vitest"
import { rankRowOperation, sortRowOperations } from "./rowOperationOrder"

describe("row operation ordering", () => {
  it("ranks View first, Edit second and Delete last", () => {
    expect(rankRowOperation("view")).toBeLessThan(rankRowOperation("edit"))
    expect(rankRowOperation("edit")).toBeLessThan(rankRowOperation("domains"))
    expect(rankRowOperation("domains")).toBeLessThan(rankRowOperation("delete"))
  })

  it("puts a custom operation declared before View behind View and Edit", () => {
    // The exact declaration the Learning Design pages shipped with.
    const entries = sortRowOperations([
      ["domains", 0],
      ["view", 1],
      ["edit", 2],
      ["delete", 3],
    ])
    expect(entries.map(([key]) => key)).toEqual([
      "view",
      "edit",
      "domains",
      "delete",
    ])
  })

  it("keeps Delete last no matter where the page declared it", () => {
    // The exact declaration `ManageSmsTemplatesPage` shipped with.
    const entries = sortRowOperations([
      ["view", 0],
      ["edit", 1],
      ["delete", 2],
      ["add", 3],
      ["preview", 4],
      ["testSend", 5],
    ])
    const keys = entries.map(([key]) => key)
    expect(keys[keys.length - 1]).toBe("delete")
    // `add` is filtered out by `RowActions` before sorting; the sort itself
    // keeps it in declaration order among the middle rank.
    expect(keys).toEqual([
      "view",
      "edit",
      "add",
      "preview",
      "testSend",
      "delete",
    ])
  })

  it("preserves declaration order within the same rank", () => {
    const entries = sortRowOperations([
      ["outcomes", 0],
      ["domains", 1],
      ["items", 2],
    ])
    expect(entries.map(([key]) => key)).toEqual([
      "outcomes",
      "domains",
      "items",
    ])
  })

  it("does not mutate the input", () => {
    const input: Array<readonly [string, number]> = [
      ["delete", 0],
      ["view", 1],
    ]
    sortRowOperations(input)
    expect(input.map(([key]) => key)).toEqual(["delete", "view"])
  })
})
