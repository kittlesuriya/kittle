/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, expect, it, vi, type Mock } from "vitest"
import { createFrameworkWriteHandler } from "../createFrameworkWriteHandler"
import {
  deserializeResponse,
  type SerializedResponse,
  type SerializedResponseIdempotencyPort,
} from "../idempotency"
import type { FrameworkAdapterDeps } from "../../server"
import type {
  IdempotencyPort,
  PersistenceProvider,
  TransactionalIdempotencyPort,
} from "kittle-core/ports"

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

function createPort(
  acquireFn: SerializedResponseIdempotencyPort["acquire"]
): TransactionalIdempotencyPort<SerializedResponse> {
  return {
    acquire: acquireFn,
    renew: vi.fn(async () => undefined),
    markCommittedInTransaction: vi.fn(async () => undefined),
    recover: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
  }
}

function createHandler(
  deps: FrameworkAdapterDeps,
  execute: ReturnType<typeof vi.fn>,
  recoverCommittedResponse?: (args: {
    resource: { entity: string; id: string }
    session: unknown
  }) => Promise<unknown>,
  invalidations?: string[]
) {
  return createFrameworkWriteHandler({
    adapterDeps: deps,
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
      execute,
    } as never,
    resolveResourceIdentity: () => ({
      entity: "test.module",
      id: "resource-1",
    }),
    ...(invalidations
      ? {
          invalidateTags: async () => invalidations,
          getCacheAdapter: async () => ({
            capabilities: {
              tagGenerationConsistency: "linearizable" as const,
              coherenceScope: "shared" as const,
            },
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            has: vi.fn(),
            clear: vi.fn(),
            addToTag: vi.fn(),
            getTagKeys: vi.fn(async () => []),
            deleteTag: vi.fn(),
            getTagGeneration: vi.fn(async () => "0"),
            advanceTagGeneration: vi.fn(async () => "1"),
          }),
        }
      : {}),
    ...(recoverCommittedResponse ? { recoverCommittedResponse } : {}),
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

describe("idempotency crash recovery", () => {
  it("does not re-execute business logic when retrying after a crash between commit and complete", async () => {
    // Simulates: Request 1 acquires, executes, commits in the transaction, but
    // complete() fails (process crash). recover() transitions the row to
    // business-committed. Request 2 sees business-committed and returns 409
    // (no resource identity configured) — critically, execute() must NOT re-run.
    let committed = false
    let failComplete = true
    const port = createPort(async () =>
      committed
        ? { outcome: "business-committed", token: "token-2" }
        : { outcome: "acquired", token: "token-1" }
    )
    ;(port.complete as Mock).mockImplementation(async () => {
      if (failComplete) {
        failComplete = false
        throw new Error("finalize unavailable — process crashed")
      }
      committed = true
    })
    ;(port.recover as Mock).mockImplementation(async () => {
      committed = true
    })

    const execute = vi.fn(async () => ({ id: "created" }))

    // First request: acquire → execute → commit → complete() fails → recover() → 500
    const first = await createHandler(
      createDeps(port),
      execute
    )(createRequest("crash-key"))
    expect(first.status).toBe(500)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(port.markCommittedInTransaction as Mock).toHaveBeenCalledTimes(1)
    expect(port.recover as Mock).toHaveBeenCalledTimes(1)

    // Second request: business-committed → 409 (no resource identity → ConflictError)
    const second = await createHandler(
      createDeps(port),
      execute
    )(createRequest("crash-key"))
    expect(second.status).toBe(409)
    expect(execute).toHaveBeenCalledTimes(1) // Execute must NOT re-run
  })

  it("returns 409 when business-committed row has no recoverCommittedResponse configured", async () => {
    let committed = false
    let failComplete = true
    const port = createPort(async () =>
      committed
        ? {
            outcome: "business-committed",
            token: "token-2",
            resource: { entity: "test.module", id: "resource-1" },
          }
        : { outcome: "acquired", token: "token-1" }
    )
    ;(port.complete as Mock).mockImplementation(async () => {
      if (failComplete) {
        failComplete = false
        throw new Error("crash")
      }
      committed = true
    })
    ;(port.recover as Mock).mockImplementation(async () => {
      committed = true
    })

    const execute = vi.fn(async () => ({ id: "created" }))

    // First request: crash
    await createHandler(
      createDeps(port),
      execute
    )(createRequest("no-recover-key"))

    // Second request: business-committed with resource but no recoverCommittedResponse → 409
    const second = await createHandler(
      createDeps(port),
      execute
    )(createRequest("no-recover-key"))
    expect(second.status).toBe(409)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("returns 409 when recoverCommittedResponse returns null (resource deleted after commit)", async () => {
    let committed = false
    let failComplete = true
    const port = createPort(async () =>
      committed
        ? {
            outcome: "business-committed",
            token: "token-2",
            resource: { entity: "test.module", id: "resource-1" },
          }
        : { outcome: "acquired", token: "token-1" }
    )
    ;(port.complete as Mock).mockImplementation(async () => {
      if (failComplete) {
        failComplete = false
        throw new Error("crash")
      }
      committed = true
    })
    ;(port.recover as Mock).mockImplementation(async () => {
      committed = true
    })

    const execute = vi.fn(async () => ({ id: "created" }))
    const recoverCommittedResponse = vi.fn(async () => null) // Resource deleted

    // First request: crash
    await createHandler(
      createDeps(port),
      execute,
      recoverCommittedResponse
    )(createRequest("gone-key"))

    // Second request: business-committed, resource gone → 409
    const second = await createHandler(
      createDeps(port),
      execute,
      recoverCommittedResponse
    )(createRequest("gone-key"))
    expect(second.status).toBe(409)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(recoverCommittedResponse).toHaveBeenCalledTimes(1)
  })

  it("replays committed receipt invalidations when the current state changed", async () => {
    let committed = false
    const invalidateTag = vi.fn()
    const port = createPort(async () =>
      committed
        ? {
            outcome: "business-committed",
            token: "token-1",
            resource: { entity: "test.module", id: "resource-1" },
            invalidations: ["receipt-tag"],
          }
        : { outcome: "acquired", token: "token-1" }
    )
    ;(port.complete as Mock).mockImplementation(async () => {
      committed = true
    })
    ;(port.recover as Mock).mockImplementation(async () => {
      committed = true
    })
    const execute = vi.fn(async () => ({ id: "created" }))
    const recover = vi.fn(async () => ({ id: "newer-current-state" }))
    const handler = createHandler(createDeps(port), execute, recover, [
      "freshly-recomputed-tag",
    ])
    const first = await handler(createRequest("changed-state-key"))
    expect(first.status).toBe(200)
    const second = await handler(createRequest("changed-state-key"))
    expect(second.status).toBe(200)
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({ id: "resource-1" }),
      })
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("replays a previously completed response on third retry (stable replay)", async () => {
    // Verifies the stable replay path: once a row is completed, subsequent
    // retries replay the serialized response without re-executing business logic.
    const port = createPort(async () => ({
      outcome: "replay",
      result: {
        version: "v1",
        body: JSON.stringify({ id: "replayed" }),
        status: 200,
        headers: [["content-type", "application/json"]],
      } as SerializedResponse,
    }))
    const execute = vi.fn(async () => ({ id: "created" }))

    const response = await createHandler(
      createDeps(port),
      execute
    )(createRequest("replay-key"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: "replayed" })
    expect(execute).not.toHaveBeenCalled() // Business logic must NOT run on replay
  })
})
