import { describe, expect, it } from "vitest"
import { assertIdempotencyAcquireResult } from "../idempotency"
import { ConfigurationError } from "../../foundation/errors"

describe("assertIdempotencyAcquireResult", () => {
  it("accepts every well-formed outcome", () => {
    expect(() =>
      assertIdempotencyAcquireResult({ outcome: "acquired", token: "t" })
    ).not.toThrow()
    expect(() =>
      assertIdempotencyAcquireResult({ outcome: "replay", result: { ok: 1 } })
    ).not.toThrow()
    expect(() =>
      assertIdempotencyAcquireResult({ outcome: "replay", result: undefined })
    ).not.toThrow()
    expect(() =>
      assertIdempotencyAcquireResult({ outcome: "in-progress" })
    ).not.toThrow()
    expect(() =>
      assertIdempotencyAcquireResult({
        outcome: "business-committed",
        token: "t",
      })
    ).not.toThrow()
    expect(() =>
      assertIdempotencyAcquireResult({ outcome: "conflict" })
    ).not.toThrow()
  })

  it.each([[null], [undefined], ["acquired"], [[]], [{}]])(
    "rejects a missing or shapeless result %p",
    (result) => {
      expect(() => assertIdempotencyAcquireResult(result)).toThrow(
        ConfigurationError
      )
    }
  )

  it.each([
    [{ outcome: "maybe" }],
    [{ outcome: "acquired" }],
    [{ outcome: "acquired", token: "" }],
    [{ outcome: "business-committed", token: 42 }],
    [{ outcome: "replay" }],
  ])("rejects a malformed outcome %p", (result) => {
    expect(() => assertIdempotencyAcquireResult(result)).toThrow(
      ConfigurationError
    )
  })
})
