import { describe, expect, it } from "vitest"
import { createJobRegistry } from "../jobRegistry"
import type { JobDefinition } from "../types"

function definition(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    type: "test",
    version: 1,
    scope: "system",
    maxAttempts: 3,
    retryDelayMs: 0,
    retryBackoffMultiplier: 1,
    decodePayload: (input) => input as Record<string, unknown>,
    execute: async () => ({ success: true }),
    ...overrides,
  }
}

describe("job registry validation", () => {
  it.each([
    [{ type: "" }, "type"],
    [{ version: 0 }, "version"],
    [{ maxAttempts: 0 }, "maxAttempts"],
    [{ retryDelayMs: -1 }, "retryDelayMs"],
    [{ retryBackoffMultiplier: 0 }, "retryBackoffMultiplier"],
    [{ timeoutMs: 0 }, "timeoutMs"],
  ])("rejects invalid %s", (overrides, message) => {
    expect(() => createJobRegistry().register(definition(overrides))).toThrow(
      message
    )
  })

  it("freezes registered definitions and uses the injected clock", () => {
    const registeredAt = new Date("2026-01-01T00:00:00.000Z")
    const registry = createJobRegistry({ now: () => registeredAt })
    const def = definition()
    registry.register(def)
    expect(Object.isFrozen(registry.get("test", 1))).toBe(true)
    expect(registry.list()[0]?.registeredAt).toBe(registeredAt)
  })

  it("rejects missing handlers and duplicate versions", () => {
    const registry = createJobRegistry()
    expect(() =>
      registry.register(definition({ decodePayload: undefined as never }))
    ).toThrow("decodePayload")
    registry.register(definition())
    expect(registry.has("test", 1)).toBe(true)
    expect(registry.has("test", 2)).toBe(false)
    expect(registry.get("missing", 1)).toBeUndefined()
    expect(() => registry.register(definition())).toThrow("already registered")
  })
})
