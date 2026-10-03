import { describe, expect, it } from "vitest"
import type { CacheAdapter } from "kittle-core/cache"
import { InMemoryCacheAdapter } from "../../cache/inMemoryCacheAdapter"
import { createSimpleRuntime } from "../simpleRuntime"

const resolveSession = async () =>
  ({ scope: "public", actor: null, raw: null }) as never

describe("simple runtime cache mode", () => {
  it("creates and reuses one process-local adapter for inMemory mode", async () => {
    const runtime = await createSimpleRuntime({
      resolveSession,
      scope: "public",
      cacheMode: "inMemory",
    })

    const first = await runtime.getCacheAdapter()
    const second = await runtime.getCacheAdapter()

    expect(first).toBeInstanceOf(InMemoryCacheAdapter)
    expect(second).toBe(first)
    expect(runtime.cacheMode).toBe("inMemory")
  })

  it("keeps a caller-provided adapter as the shared instance", async () => {
    const provided = new InMemoryCacheAdapter()
    const runtime = await createSimpleRuntime({
      resolveSession,
      scope: "public",
      cacheMode: "inMemory",
      cacheAdapter: provided,
    })

    expect(await runtime.getCacheAdapter()).toBe(provided)
  })

  it("keeps the no-op cache and no mode by default", async () => {
    const runtime = await createSimpleRuntime({
      resolveSession,
      scope: "public",
    })
    const cache: CacheAdapter = await runtime.getCacheAdapter()

    await cache.set("key", 1)

    expect(await cache.get("key")).toBeUndefined()
    expect(runtime.cacheMode).toBeUndefined()
  })
})
