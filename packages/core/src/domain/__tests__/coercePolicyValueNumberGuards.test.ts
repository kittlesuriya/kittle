import { describe, expect, it } from "vitest"
import {
  coercePolicyValue,
  PolicyValidationError,
} from "../coercePolicyValue"

describe("coercePolicyValue number hardening", () => {
  it.each([["42", 42], ["12.5", 12.5], ["  7  ", 7], ["-3", -3], ["1e3", 1000]])(
    "still accepts strictly numeric strings (%s)",
    (input, expected) => {
      expect(coercePolicyValue({ type: "number", value: input })).toBe(expected)
    }
  )

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["boolean true", true],
    ["boolean false", false],
    ["empty string", ""],
    ["blank string", "  "],
    ["hex string", "0x11"],
    ["Infinity string", "Infinity"],
    ["NaN string", "NaN"],
    ["non-numeric string", "not-a-number"],
    ["empty array", []],
    ["single-element array", [5]],
    ["object", { value: 5 }],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects %s", (_label, value) => {
    expect(() => coercePolicyValue({ type: "number", value })).toThrow(
      PolicyValidationError
    )
  })
})
