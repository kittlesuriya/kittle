import { describe, expect, it } from "vitest"
import { InMemoryCacheAdapter } from "../inMemoryCacheAdapter"

function internalsOf(cache: InMemoryCacheAdapter): {
  values: Map<string, unknown>
  revisions: Map<string, number>
  tags: Map<string, Map<string, number>>
  rateLimitBuckets: Map<string, { count: number; resetAt: number }>
} {
  return cache as unknown as {
    values: Map<string, unknown>
    revisions: Map<string, number>
    tags: Map<string, Map<string, number>>
    rateLimitBuckets: Map<string, { count: number; resetAt: number }>
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("in-memory adapter memory bounds", () => {
  it("retains nothing for deleted keys", async () => {
    const cache = new InMemoryCacheAdapter()
    for (let i = 0; i < 300; i += 1) {
      await cache.set(`key-${i}`, { i })
      await cache.addToTag("all", `key-${i}`)
    }
    for (let i = 0; i < 300; i += 1) {
      await cache.delete(`key-${i}`)
    }
    const internals = internalsOf(cache)
    expect(internals.values.size).toBe(0)
    expect(internals.revisions.size).toBe(0)
    // Tag membership of deleted keys is scrubbed by the amortized prune:
    // drive past one prune interval, then nothing may remain.
    for (let i = 0; i < 140; i += 1) {
      await cache.set(`scratch-${i}`, i)
      await cache.delete(`scratch-${i}`)
    }
    expect(internals.tags.size).toBe(0)
    expect(internals.values.size).toBe(0)
    expect(internals.revisions.size).toBe(0)
  })

  it("sweeps expired values and their revisions", async () => {
    const cache = new InMemoryCacheAdapter()
    for (let i = 0; i < 150; i += 1) {
      await cache.set(`old-${i}`, i, 10)
    }
    await sleep(40)
    for (let i = 0; i < 130; i += 1) {
      await cache.set(`new-${i}`, i, 10_000)
    }
    const internals = internalsOf(cache)
    // The first batch must be gone; only the fresh second batch may remain.
    expect(internals.values.size).toBeLessThan(150)
    expect(internals.revisions.size).toBeLessThan(150)
    expect(await cache.get("old-0")).toBeUndefined()
  })

  it("scrubs tag memberships of deleted keys", async () => {
    const cache = new InMemoryCacheAdapter()
    for (let i = 0; i < 50; i += 1) {
      await cache.set(`tagged-${i}`, i)
      await cache.addToTag("group", `tagged-${i}`)
    }
    for (let i = 0; i < 50; i += 1) {
      await cache.delete(`tagged-${i}`)
    }
    // Drive the amortized prune, then scratch keys must not linger either.
    for (let i = 0; i < 140; i += 1) {
      await cache.set(`scratch-${i}`, i)
      await cache.delete(`scratch-${i}`)
    }
    const internals = internalsOf(cache)
    expect(internals.tags.size).toBe(0)
    expect(internals.values.size).toBe(0)
    expect(internals.revisions.size).toBe(0)
  })

  it("evicts expired rate-limit buckets", async () => {
    const cache = new InMemoryCacheAdapter()
    for (let i = 0; i < 150; i += 1) {
      await cache.incrementRateLimitAtomically(`ip-${i}`, 10)
    }
    await sleep(40)
    for (let i = 0; i < 130; i += 1) {
      await cache.incrementRateLimitAtomically(`fresh-${i}`, 10_000)
    }
    // All 150 stale buckets must be gone; at most the fresh batch remains.
    expect(internalsOf(cache).rateLimitBuckets.size).toBeLessThan(150)
  })

  it("drops revisions for keys removed by deleteTag", async () => {
    const cache = new InMemoryCacheAdapter()
    for (let i = 0; i < 10; i += 1) {
      await cache.set(`t-${i}`, i)
      await cache.addToTag("doomed", `t-${i}`)
    }
    await cache.deleteTag("doomed")
    const internals = internalsOf(cache)
    expect(internals.values.size).toBe(0)
    expect(internals.revisions.size).toBe(0)
    expect(internals.tags.size).toBe(0)
  })
})
