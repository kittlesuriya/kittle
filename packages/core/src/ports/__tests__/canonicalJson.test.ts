import { describe, expect, it } from "vitest"
import {
  canonicalizeJson,
  canonicalJsonString,
  CanonicalJsonError,
} from "../canonicalJson"

describe("canonical JSON", () => {
  it("encodes dates deterministically as a typed marker", () => {
    expect(canonicalizeJson(new Date("2026-01-01"))).toEqual(
      canonicalizeJson(new Date("2026-01-01"))
    )
    expect(canonicalizeJson(new Date("2026-01-01T00:00:00.000Z"))).toEqual({
      $type: "Date",
      value: "2026-01-01T00:00:00.000Z",
    })
  })

  it("rejects plain objects with a reserved $type key so the Date marker cannot be forged", () => {
    expect(() =>
      canonicalizeJson({ $type: "Date", value: "2026-01-01T00:00:00.000Z" })
    ).toThrow(CanonicalJsonError)
    expect(() =>
      canonicalizeJson({ nested: { $type: "Date", value: "x" } })
    ).toThrow(CanonicalJsonError)
    expect(() => canonicalJsonString({ $type: "Date", value: "x" })).toThrow(
      CanonicalJsonError
    )
  })

  it("produces different outcomes for a Date and the plain-object forgery", () => {
    expect(() =>
      canonicalJsonString({ $type: "Date", value: "2026-01-01T00:00:00.000Z" })
    ).toThrow(CanonicalJsonError)
    expect(canonicalJsonString(new Date("2026-01-01T00:00:00.000Z"))).toBe(
      '{"$type":"Date","value":"2026-01-01T00:00:00.000Z"}'
    )
  })

  it("rejects undefined", () => {
    expect(() => canonicalizeJson(undefined)).toThrow(CanonicalJsonError)
    expect(() => canonicalJsonString({ a: undefined })).toThrow(
      CanonicalJsonError
    )
  })

  it("rejects Map and Set instances", () => {
    expect(() => canonicalizeJson(new Map([["a", 1]]))).toThrow(
      CanonicalJsonError
    )
    expect(() => canonicalizeJson(new Set([1]))).toThrow(CanonicalJsonError)
  })

  it("rejects invalid Date values", () => {
    expect(() => canonicalizeJson(new Date("not-a-date"))).toThrow(
      CanonicalJsonError
    )
    expect(() => canonicalJsonString(new Date("not-a-date"))).toThrow(
      CanonicalJsonError
    )
    expect(() => canonicalizeJson(NaN)).toThrow(CanonicalJsonError)
  })

  it("rejects __proto__ as an own key", () => {
    const input = Object.create(null) as Record<string, unknown>
    Object.defineProperty(input, "__proto__", {
      value: 1,
      writable: true,
      enumerable: true,
      configurable: true,
    })
    expect(() => canonicalizeJson(input)).toThrow(CanonicalJsonError)
  })

  it("rejects constructor as an own key", () => {
    const input = Object.create(null, {
      constructor: {
        value: "evil",
        writable: true,
        enumerable: true,
        configurable: true,
      },
    }) as Record<string, unknown>
    expect(() => canonicalizeJson(input)).toThrow(CanonicalJsonError)
  })

  it("rejects prototype as an own key", () => {
    const input = Object.create(null, {
      prototype: {
        value: "evil",
        writable: true,
        enumerable: true,
        configurable: true,
      },
    }) as Record<string, unknown>
    expect(() => canonicalizeJson(input)).toThrow(CanonicalJsonError)
  })

  it("produces deterministic output regardless of key insertion order", () => {
    const a: Record<string, unknown> = {}
    a.z = 1
    a.a = 2
    a.m = 3

    const b: Record<string, unknown> = {}
    b.a = 2
    b.m = 3
    b.z = 1

    expect(canonicalJsonString(a)).toBe(canonicalJsonString(b))
  })

  it("handles null-prototype inputs correctly", () => {
    const obj = Object.create(null) as Record<string, unknown>
    obj.x = 42
    obj.a = "hello"

    const result = canonicalizeJson(obj)
    expect(result).toEqual({ a: "hello", x: 42 })
  })
})
