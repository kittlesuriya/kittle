import { describe, expect, it, vi } from "vitest"
import { CacheService } from "kittle-core/cache"
import type { IdempotencyPort, PersistenceProvider } from "kittle-core/ports"
import type { SerializedResponseIdempotencyPort } from "../idempotency"
import { InMemoryCacheAdapter } from "../../cache/inMemoryCacheAdapter"
import { createFrameworkWriteHandler } from "../createFrameworkWriteHandler"
import type { FrameworkAdapterDeps } from "../../server"

const persistence = {
  dialect: "test",
  capabilities: {
    interactiveTransactions: true,
    atomicBatch: false,
    returningInsert: false,
    readSessions: false,
    jsonQueries: false,
    exactDecimal: false,
    persistentConnection: false,
    maxPageSize: 100,
  },
  repository: vi.fn(),
  runInTransaction: async (
    work: (scoped: PersistenceProvider) => Promise<unknown>
  ) => work(persistence),
} as unknown as PersistenceProvider

function createPort(): SerializedResponseIdempotencyPort {
  return {
    acquire: vi.fn(async () => ({ outcome: "acquired", token: "token-1" })),
    renew: vi.fn(async () => undefined),
    markCommittedInTransaction: vi.fn(async () => undefined),
    recover: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
  } as unknown as SerializedResponseIdempotencyPort
}

function createDeps(
  port: SerializedResponseIdempotencyPort
): FrameworkAdapterDeps {
  return {
    assertValidCsrf: vi.fn(),
    resolveSession: vi.fn(async () => ({
      scope: "platform" as const,
      actor: {
        id: "actor-1",
        type: "platform" as const,
        bypassAuthority: true,
      },
      raw: null,
    })),
    hasCapability: vi.fn(),
    resolveAbacBundle: vi.fn(async () => null),
    assertModuleEnabled: vi.fn(),
    assertModuleActionEnabled: vi.fn(),
    assertModuleCapabilityEnabled: vi.fn(),
    isOwnerBypass: vi.fn(() => true),
    createIdempotencyPort: <TResult>() =>
      port as unknown as IdempotencyPort<TResult>,
  }
}

const tags = ["test:platform", "scope:platform", "test"]

function createHandler(
  port: SerializedResponseIdempotencyPort,
  cache: InMemoryCacheAdapter,
  cacheMode?: "inMemory" | "shared"
) {
  return createFrameworkWriteHandler({
    adapterDeps: createDeps(port),
    scope: { scope: "platform", idempotency: { required: true } },
    moduleKey: "test.module",
    action: "create",
    skipCapabilityCheck: true,
    runtimeCapabilities: {
      deferredExecution: true,
      objectStorage: false,
      cache: true,
    },
    createPersistence: () => persistence,
    definition: {
      key: "test.write",
      kind: "mutation",
      atomicity: { kind: "standard", mode: "required" },
      authorization: { authorize: async () => ({ allowed: true }) },
      execute: vi.fn(async () => ({ id: "created" })),
    } as never,
    resolveResourceIdentity: () => ({
      entity: "test.module",
      id: "resource-1",
    }),
    invalidateTags: async () => tags,
    getCacheAdapter: async () => cache,
    ...(cacheMode ? { cacheMode } : {}),
    resolveInput: vi.fn(async () => ({})),
    validation: {
      body: {
        parse: (value: unknown) => value,
        parseAsync: async (value: unknown) => value,
      },
    },
  })
}

function createRequest(key: string) {
  return new Request("https://example.test", {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
  })
}

describe("cache mode write invalidation", () => {
  it("advances process-local generations and re-resolves reads after a write in inMemory mode", async () => {
    const cache = new InMemoryCacheAdapter()
    const reader = new CacheService({
      adapter: cache,
      correctnessCritical: true,
      mode: "inMemory",
    })
    await expect(
      reader.getOrSet("key", async () => "before", tags)
    ).resolves.toBe("before")
    expect(await cache.getTagGeneration("test:platform")).toBe("0")

    const handler = createHandler(createPort(), cache, "inMemory")
    const response = await handler(createRequest("inMemory-mode-write"))

    expect(response.status).toBeLessThan(400)
    expect(await cache.getTagGeneration("test:platform")).toBe("1")
    await expect(
      reader.getOrSet("key", async () => "after", tags)
    ).resolves.toBe("after")
  })

  it("rejects a process-local adapter for write invalidation in the default shared mode", async () => {
    const cache = new InMemoryCacheAdapter()

    const handler = createHandler(createPort(), cache)
    const response = await handler(createRequest("shared-mode-write"))

    expect(response.status).toBe(500)
    expect(await cache.getTagGeneration("test:platform")).toBe("0")
  })

  it("surfaces a failed process-local generation advance in inMemory mode", async () => {
    const cache = new InMemoryCacheAdapter()
    const advance = cache.advanceTagGeneration.bind(cache)
    let fail = true
    cache.advanceTagGeneration = async (tag: string) => {
      if (fail) {
        fail = false
        throw new Error("generation unavailable")
      }
      return advance(tag)
    }

    const handler = createHandler(createPort(), cache, "inMemory")
    const response = await handler(createRequest("inMemory-mode-failure"))

    expect(response.status).toBe(500)
    expect(await cache.getTagGeneration("test:platform")).toBe("0")
  })
})
