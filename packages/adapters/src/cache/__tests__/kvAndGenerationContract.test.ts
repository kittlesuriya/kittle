import { describe, expect, it } from "vitest"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { KvCacheAdapter } from "../kvCacheAdapter"
import { InMemoryCacheAdapter } from "../inMemoryCacheAdapter"
import { DbTagGenerationStore } from "../dbTagGenerationStore"

/** Minimal in-memory stand-in for the Cloudflare KVNamespace binding. */
class FakeKVNamespace {
  private readonly store = new Map<string, string>()

  async get(key: string): Promise<string | null>
  async get<T>(key: string, options: { type: "json" }): Promise<T | null>
  async get<T>(key: string, options?: { type: "json" }): Promise<unknown> {
    const value = this.store.get(key)
    if (value === undefined) return null
    return options?.type === "json"
      ? (JSON.parse(value) as T)
      : value
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(options?: { prefix?: string }): Promise<{
    keys: { name: string }[]
    list_complete: boolean
  }> {
    const prefix = options?.prefix ?? ""
    return {
      keys: [...this.store.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
    }
  }
}

const generationTable = sqliteTable("cache_generations", {
  tag: text("tag"),
  generation: integer("generation"),
})

/** Single-tag fake of the atomic counter table backing DbTagGenerationStore. */
function createGenerationDb() {
  let generation: number | undefined
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            generation === undefined ? [] : [{ generation }],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            generation = (generation ?? 0) + 1
            return [{ generation }]
          },
        }),
      }),
    }),
  } as never
}

describe("KV cache adapter port contract", () => {
  it("returns undefined (not null) for misses", async () => {
    const cache = new KvCacheAdapter(new FakeKVNamespace())
    expect(await cache.get("missing")).toBeUndefined()
    expect(await cache.has("missing")).toBe(false)
  })

  it("stores, replaces, and deletes with boolean delete semantics", async () => {
    const cache = new KvCacheAdapter(new FakeKVNamespace())
    await cache.set("k", { value: 1 })
    expect(await cache.has("k")).toBe(true)
    expect(await cache.get<{ value: number }>("k")).toEqual({ value: 1 })
    await cache.set("k", { value: 2 })
    expect(await cache.get<{ value: number }>("k")).toEqual({ value: 2 })
    expect(await cache.delete("k")).toBe(true)
    expect(await cache.get("k")).toBeUndefined()
    expect(await cache.delete("k")).toBe(false)
  })

  it("tracks tag membership and invalidates tagged keys", async () => {
    const cache = new KvCacheAdapter(new FakeKVNamespace())
    await cache.set("a", "a")
    await cache.set("b", "b")
    await cache.addToTag("rows", "a")
    await cache.addToTag("rows", "b")
    expect((await cache.getTagKeys("rows")).sort()).toEqual(["a", "b"])
    await cache.deleteTag("rows")
    expect(await cache.get("a")).toBeUndefined()
    expect(await cache.get("b")).toBeUndefined()
    expect(await cache.getTagKeys("rows")).toEqual([])
  })

  it("returns non-empty generation strings", async () => {
    const cache = new KvCacheAdapter(new FakeKVNamespace())
    const initial = await cache.getTagGeneration("tag")
    expect(typeof initial).toBe("string")
    expect(initial.length).toBeGreaterThan(0)
    const advanced = await cache.advanceTagGeneration("tag")
    expect(typeof advanced).toBe("string")
    expect(advanced.length).toBeGreaterThan(0)
    expect(advanced).not.toBe(initial)
  })
})

describe("tag generation stores honor non-empty generation strings", () => {
  it("DbTagGenerationStore defaults to '0' and advances monotonically", async () => {
    const store = new DbTagGenerationStore(
      createGenerationDb(),
      generationTable
    )
    const initial = await store.getTagGeneration("t")
    expect(initial).toBe("0")
    const first = await store.advanceTagGeneration("t")
    const second = await store.advanceTagGeneration("t")
    for (const generation of [first, second]) {
      expect(typeof generation).toBe("string")
      expect(generation.length).toBeGreaterThan(0)
    }
    expect(Number(second)).toBeGreaterThan(Number(first))
    expect(await store.getTagGeneration("t")).toBe(second)
  })

  it("InMemoryCacheAdapter generations are non-empty strings", async () => {
    const cache = new InMemoryCacheAdapter()
    expect(await cache.getTagGeneration("t")).toBe("0")
    const advanced = await cache.advanceTagGeneration("t")
    expect(typeof advanced).toBe("string")
    expect(advanced.length).toBeGreaterThan(0)
    expect(await cache.getTagGeneration("t")).toBe(advanced)
  })
})
