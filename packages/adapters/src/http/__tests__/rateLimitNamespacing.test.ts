import { describe, expect, it, vi } from "vitest"
import { RateLimitError } from "kittle-core/domain"
import type { AtomicRateLimitStore } from "kittle-core/rate-limit"
import type { PersistenceProvider } from "kittle-core/ports"
import { createFrameworkWriteHandler } from "../createFrameworkWriteHandler"
import { createShared } from "../crudHandlers/shared"
import type { FrameworkAdapterDeps, FrameworkSession } from "../../server"

function createPersistence(): PersistenceProvider {
  return {
    dialect: "memory",
    capabilities: {
      interactiveTransactions: true,
      atomicBatch: false,
      returningInsert: false,
      readSessions: false,
      jsonQueries: false,
      exactDecimal: false,
      persistentConnection: false,
      maxPageSize: 100,
      maxBindParams: 100,
      maxStatementBytes: 100_000,
    },
    repository: () => {
      throw new Error("not used")
    },
    runInTransaction: async (
      work: (scoped: PersistenceProvider) => Promise<unknown>
    ) => work(createPersistence()),
  } as unknown as PersistenceProvider
}

function tenantSession(tenantId: string, actorId: string): FrameworkSession {
  return {
    scope: "tenant",
    actor: { id: actorId, type: "tenant", tenantId, bypassAuthority: true },
    tenant: { id: tenantId, enabledModuleKeys: [], enabledModuleActions: {} },
    raw: null,
  }
}

/** Map-backed atomic store that records every key it is asked to enforce. */
function createCapturingStore() {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  const keys: string[] = []
  const increment = async (key: string, windowMs: number) => {
    keys.push(key)
    const now = Date.now()
    const current = buckets.get(key)
    const bucket =
      current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + windowMs }
    bucket.count += 1
    buckets.set(key, bucket)
    return { ...bucket }
  }
  const store: AtomicRateLimitStore = {
    increment,
    incrementAtomically: increment,
  }
  return { keys, store }
}

function baseAdapterDeps(
  resolveSession: (args: unknown) => Promise<FrameworkSession>
): FrameworkAdapterDeps {
  return {
    assertValidCsrf: vi.fn(),
    resolveSession: vi.fn(resolveSession) as never,
    hasCapability: vi.fn(),
    resolveAbacBundle: vi.fn(async () => null),
    assertModuleEnabled: vi.fn(),
    assertModuleActionEnabled: vi.fn(),
    assertModuleCapabilityEnabled: vi.fn(),
    isOwnerBypass: vi.fn(() => true),
  } satisfies FrameworkAdapterDeps
}

describe("rate-limit tenant namespacing", () => {
  it("isolates mutation buckets per tenant so one tenant cannot exhaust another", async () => {
    const { keys, store } = createCapturingStore()
    const sessions = [
      tenantSession("tenant-a", "user-1"),
      tenantSession("tenant-b", "user-1"),
      tenantSession("tenant-a", "user-1"),
    ]
    let call = 0
    const handler = createFrameworkWriteHandler({
      adapterDeps: baseAdapterDeps(async () => sessions[call++]!),
      scope: { scope: "tenant" },
      moduleKey: "orders",
      action: "create",
      skipCapabilityCheck: true,
      rateLimit: {
        config: { max: 1, timeWindow: "1 minute" },
        consistency: "atomic",
      },
      getRateLimitStore: async () => store,
      runtimeCapabilities: {
        deferredExecution: true,
        objectStorage: false,
        cache: true,
      },
      createPersistence: vi.fn(() => createPersistence()),
      definition: {
        key: "orders.create",
        kind: "mutation",
        atomicity: { kind: "standard", mode: "required" },
        authorization: { authorize: async () => ({ allowed: true }) },
        execute: async () => ({}),
      },
      resolveInput: vi.fn(async () => ({})),
    })

    const first = await handler(
      new Request("https://example.test/orders", { method: "POST" })
    )
    expect(first.status).toBe(200)
    // Same actor id under a different tenant: independent bucket, still allowed.
    const second = await handler(
      new Request("https://example.test/orders", { method: "POST" })
    )
    expect(second.status).toBe(200)
    // Same tenant again: its own bucket is exhausted.
    const third = await handler(
      new Request("https://example.test/orders", { method: "POST" })
    )
    expect(third.status).toBe(429)

    expect(keys).toHaveLength(3)
    expect(keys[0]).toContain("tenant-a")
    expect(keys[1]).toContain("tenant-b")
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[2]).toBe(keys[0])
  })

  it("isolates read buckets per tenant and actor", async () => {
    const { keys, store } = createCapturingStore()
    const shared = createShared(
      {
        adapterDeps: baseAdapterDeps(async () => tenantSession("t", "u")),
        scope: { scope: "tenant" },
        moduleKey: "orders",
        cache: { tag: "orders", keyPrefix: "orders" },
        getRateLimitStore: async () => store,
      } as never,
      { list: true } as never,
      { enabled: false, key: undefined }
    )
    const config = {
      max: 1,
      timeWindow: "1 minute",
      consistency: "atomic" as const,
    }
    const request = new Request("https://example.test/orders")

    await shared.enforceReadRateLimit(
      "list",
      config,
      request,
      tenantSession("tenant-a", "user-1")
    )
    // Different tenant, same actor: a distinct bucket that is still allowed.
    await shared.enforceReadRateLimit(
      "list",
      config,
      request,
      tenantSession("tenant-b", "user-1")
    )
    // Same tenant and actor again: exhausted.
    await expect(
      shared.enforceReadRateLimit(
        "list",
        config,
        request,
        tenantSession("tenant-a", "user-1")
      )
    ).rejects.toBeInstanceOf(RateLimitError)

    expect(keys).toHaveLength(3)
    expect(keys[0]).toContain("tenant-a")
    expect(keys[1]).toContain("tenant-b")
    expect(keys[0]).not.toBe(keys[1])
  })
})
