import { describe, expect, it, vi } from "vitest"
import { CacheService } from "../cacheService"
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

describe("cache service adapter-result guards", () => {
  it("treats a null get() as a miss", async () => {
    const onError = vi.fn()
    const service = new CacheService({
      adapter: makeAdapter({ get: vi.fn(async () => null as never) }),
      telemetry: { onError },
    })
    await expect(service.get("k")).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalled()
  })

  it("treats non-boolean delete()/has() as failure", async () => {
    const service = new CacheService({
      adapter: makeAdapter({
        delete: vi.fn(async () => 1 as never),
        has: vi.fn(async () => "yes" as never),
      }),
    })
    await expect(service.delete("k")).resolves.toBe(false)
    await expect(service.has("k")).resolves.toBe(false)
  })

  it("falls back to local generations when the adapter returns garbage", async () => {
    const service = new CacheService({
      adapter: makeAdapter({
        getTagGeneration: vi.fn(async () => "" as never),
        advanceTagGeneration: vi.fn(async () => undefined as never),
      }),
    })
    await expect(
      service.getOrSet("k", async () => "v", ["tag"])
    ).resolves.toBe("v")
    await expect(service.invalidateTag("tag")).resolves.toBeUndefined()
  })

  it("fails closed on garbage generations when correctness-critical", async () => {
    const service = new CacheService({
      adapter: {
        ...makeAdapter({
          getTagGeneration: vi.fn(async () => "" as never),
        }),
        capabilities: {
          tagGenerationConsistency: "linearizable",
          coherenceScope: "shared",
        },
        advanceTagGeneration: vi.fn(async () => "gen-1"),
      },
      correctnessCritical: true,
    })
    await expect(
      service.getOrSet("k", async () => "v", ["tag"])
    ).rejects.toThrow()
  })

  it("allows linearizable process generations only in explicit inMemory mode", () => {
    const adapter = makeAdapter({
      capabilities: {
        tagGenerationConsistency: "linearizable",
        coherenceScope: "process",
      },
      getTagGeneration: vi.fn(async () => "0"),
      advanceTagGeneration: vi.fn(async () => "1"),
    })
    expect(
      () => new CacheService({ adapter, correctnessCritical: true })
    ).toThrow()
    expect(
      () =>
        new CacheService({
          adapter,
          correctnessCritical: true,
          mode: "inMemory",
        })
    ).not.toThrow()
    expect(
      () =>
        new CacheService({
          adapter,
          correctnessCritical: true,
          mode: "shared",
        })
    ).toThrow()
  })

  it("rejects eventual generations and shared adapters in inMemory mode", () => {
    for (const capabilities of [
      {
        tagGenerationConsistency: "eventual" as const,
        coherenceScope: "process" as const,
      },
      {
        tagGenerationConsistency: "linearizable" as const,
        coherenceScope: "shared" as const,
      },
    ]) {
      expect(
        () =>
          new CacheService({
            adapter: makeAdapter({
              capabilities,
              getTagGeneration: vi.fn(async () => "0"),
              advanceTagGeneration: vi.fn(async () => "1"),
            }),
            correctnessCritical: true,
            mode: "inMemory",
          })
      ).toThrow()
    }
  })

  it("names the configured mode when generation fencing is unavailable", () => {
    const adapter = makeAdapter({
      capabilities: {
        tagGenerationConsistency: "linearizable",
        coherenceScope: "process",
      },
    })
    expect(
      () =>
        new CacheService({
          adapter,
          correctnessCritical: true,
          mode: "inMemory",
        })
    ).toThrow("inMemory tag generation unavailable")
    expect(
      () => new CacheService({ adapter, correctnessCritical: true })
    ).toThrow("shared tag generation unavailable")
  })
})
