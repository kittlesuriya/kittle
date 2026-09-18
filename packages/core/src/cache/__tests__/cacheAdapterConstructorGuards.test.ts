import { describe, expect, it, vi } from "vitest"
import { CacheService } from "../cacheService"
import { CacheAdapterError } from "../cache"
import type { CacheAdapter } from "../cache"

function makeAdapter(overrides: Partial<CacheAdapter> = {}): CacheAdapter {
  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => true),
    has: vi.fn(async () => true),
    clear: vi.fn(async () => undefined),
    addToTag: vi.fn(async () => undefined),
    getTagKeys: vi.fn(async () => []),
    deleteTag: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe("CacheService constructor adapter guards", () => {
  it("accepts a complete adapter", () => {
    expect(() => new CacheService({ adapter: makeAdapter() })).not.toThrow()
  })

  it("accepts function-valued optional methods", () => {
    expect(
      () =>
        new CacheService({
          adapter: makeAdapter({
            getTagGeneration: vi.fn(async () => "gen-1"),
            advanceTagGeneration: vi.fn(async () => "gen-2"),
            incrementRateLimitAtomically: vi.fn(async () => ({
              count: 1,
              resetAt: Date.now(),
            })),
          }),
        })
    ).not.toThrow()
  })

  it.each([[undefined], [null], ["adapter"], [[]]])(
    "rejects non-object adapter %s",
    (adapter) => {
      expect(
        () => new CacheService({ adapter: adapter as never })
      ).toThrow(CacheAdapterError)
    }
  )

  it.each([
    ["get"],
    ["set"],
    ["delete"],
    ["has"],
    ["clear"],
    ["addToTag"],
    ["getTagKeys"],
    ["deleteTag"],
  ])("rejects an adapter missing %s", (method) => {
    const adapter = makeAdapter()
    delete (adapter as unknown as Record<string, unknown>)[method]
    expect(() => new CacheService({ adapter })).toThrow(CacheAdapterError)
  })

  it.each([
    ["getTagGeneration"],
    ["advanceTagGeneration"],
    ["incrementRateLimitAtomically"],
  ])("rejects a non-function optional method %s", (method) => {
    const adapter = makeAdapter()
    ;(adapter as unknown as Record<string, unknown>)[method] = "not-a-function"
    expect(() => new CacheService({ adapter })).toThrow(CacheAdapterError)
  })
})
