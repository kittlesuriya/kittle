import { describe, expect, it, vi } from "vitest"
import { createFrameworkWriteHandler } from "../createFrameworkWriteHandler"
import type { FrameworkAdapterDeps, FrameworkSession } from "../../server"
import type { PersistenceProvider } from "kittle-core/ports"

const rateLimit = {
  config: { max: 1, timeWindow: "1 minute" },
  consistency: "best-effort" as const,
}

function createRequest(): Request {
  return new Request("https://example.test/api/write", { method: "POST" })
}

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

function createFrameworkSession(): FrameworkSession {
  return {
    scope: "platform",
    actor: { id: "actor-1", type: "platform", bypassAuthority: true },
    raw: null,
  }
}

describe("HTTP write handler rate-limit configuration", () => {
  it("reports post-commit effect failures through adapter dependencies", async () => {
    const reporter = vi.fn()
    const handler = createFrameworkWriteHandler({
      adapterDeps: {
        effectFailureReporter: reporter,
        assertValidCsrf: vi.fn(),
        resolveSession: vi.fn(async () => createFrameworkSession()),
        hasCapability: vi.fn(),
        resolveAbacBundle: vi.fn(
          async () =>
            ({
              mode: "tenant" as const,
              moduleKey: "test.module",
              policies: [],
              context: {},
              defaultEffect: "deny" as const,
              fieldCatalog: {},
            }) as unknown as import("../../server").AbacBundle
        ),
        assertModuleEnabled: vi.fn(),
        assertModuleActionEnabled: vi.fn(),
        assertModuleCapabilityEnabled: vi.fn(),
        isOwnerBypass: vi.fn(() => true),
      } satisfies FrameworkAdapterDeps,
      scope: { scope: "platform" },
      moduleKey: "test.module",
      action: "create",
      skipCapabilityCheck: true,
      runtimeCapabilities: {
        deferredExecution: true,
        objectStorage: false,
        cache: true,
      },
      auditSinkFactory: () => ({
        write: vi.fn(async () => {
          throw new Error("secret-value")
        }),
      }),
      createPersistence: vi.fn(() => createPersistence()),
      definition: {
        key: "test.write",
        kind: "mutation",
        atomicity: { kind: "standard", mode: "required" },
        authorization: { authorize: async () => ({ allowed: true }) },
        audit: {
          action: "test.created",
          resourceType: "test",
          resolveResourceId: () => "record-1",
        },
        execute: async () => ({}),
      },
      resolveInput: vi.fn(async () => ({})),
    })

    const response = await handler(createRequest())

    expect(response.status).toBe(200)
    expect(reporter).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: expect.any(String) as unknown as string,
        phase: "bestEffort",
        effectName: "audit-write",
        error: expect.any(Error) as unknown as Error,
      })
    )
  })

  it("fails closed when the framework cache adapter is absent", async () => {
    const execute = vi.fn()
    const handler = createFrameworkWriteHandler({
      adapterDeps: {
        assertValidCsrf: vi.fn(),
        resolveSession: vi.fn(async () => createFrameworkSession()),
        hasCapability: vi.fn(),
        resolveAbacBundle: vi.fn(
          async () =>
            ({
              mode: "tenant" as const,
              moduleKey: "test.module",
              policies: [],
              context: {},
              defaultEffect: "deny" as const,
              fieldCatalog: {},
            }) as unknown as import("../../server").AbacBundle
        ),
        assertModuleEnabled: vi.fn(),
        assertModuleActionEnabled: vi.fn(),
        assertModuleCapabilityEnabled: vi.fn(),
        isOwnerBypass: vi.fn(() => true),
      } satisfies FrameworkAdapterDeps,
      scope: { scope: "platform" },
      moduleKey: "test.module",
      action: "create",
      rateLimit,
      skipCapabilityCheck: true,
      createPersistence: vi.fn(() => createPersistence()),
      definition: {
        key: "test.write",
        kind: "mutation",
        atomicity: { kind: "standard", mode: "required" },
        authorization: { authorize: async () => ({ allowed: true }) },
        execute,
      } as never,
      resolveInput: vi.fn(async () => ({})),
    })

    const response = await handler(createRequest())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "Internal Server Error",
      code: "INTERNAL_SERVER_ERROR",
    })
    expect(execute).not.toHaveBeenCalled()
  })
})
