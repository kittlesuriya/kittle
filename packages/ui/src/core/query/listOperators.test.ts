import { describe, expect, it } from "vitest"
import {
  toListFilterPayload,
  translateListOperator,
  normalizeDisplayOperator,
} from "./listOperators"

describe("listOperators", () => {
  it("translates ABAC operators to the CRUD list vocabulary", () => {
    expect(translateListOperator("equals")).toBe("eq")
    expect(translateListOperator("notEquals")).toBe("neq")
    expect(translateListOperator("includesAny")).toBe("in")
    expect(translateListOperator("includesAll")).toBe("in")
    expect(translateListOperator("greaterThan")).toBe("gt")
    expect(translateListOperator("lessThan")).toBe("lt")
    expect(translateListOperator("greaterOrEqual")).toBe("gte")
    expect(translateListOperator("lessOrEqual")).toBe("lte")
    expect(translateListOperator("before")).toBe("lt")
    expect(translateListOperator("after")).toBe("gt")
    // Shared vocabulary passes through untouched.
    expect(translateListOperator("contains")).toBe("contains")
    expect(translateListOperator("between")).toBe("between")
    expect(translateListOperator("isTrue")).toBe("isTrue")
    // Idempotent for already-translated operators.
    expect(translateListOperator("eq")).toBe("eq")
    expect(translateListOperator("in")).toBe("in")
  })

  it("deep-translates a simple-mode multiselect payload (the reported 400)", () => {
    const payload = {
      logic: "AND",
      conditions: [
        {
          field: "scopeRefId",
          operator: "includesAny",
          value: ["01a10f76-78d3-74d3-a167-229b9106c42b"],
        },
      ],
      search: "",
    }
    expect(toListFilterPayload(payload)).toEqual({
      logic: "AND",
      conditions: [
        {
          field: "scopeRefId",
          operator: "in",
          value: ["01a10f76-78d3-74d3-a167-229b9106c42b"],
        },
      ],
      search: "",
    })
  })

  it("normalizes persisted CRUD operators back for the operator dropdowns", () => {
    const multiselect = {
      id: "scopeRefId",
      label: "Scope Ref",
      type: "multiselect",
      options: [],
      operators: [{ value: "includesAny", label: "Includes Any" }],
    } as never
    expect(normalizeDisplayOperator("in", multiselect)).toBe("includesAny")
    // Already-valid ABAC operators pass through.
    expect(normalizeDisplayOperator("includesAny", multiselect)).toBe(
      "includesAny"
    )
  })
})
