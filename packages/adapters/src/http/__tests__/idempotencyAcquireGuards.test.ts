import { describe, expect, it, vi } from "vitest"
import { createFrameworkWriteHandler } from "../createFrameworkWriteHandler"
import type {
  SerializedResponse,
  SerializedResponseIdempotencyPort,
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
  acquire: SerializedResponseIdempotencyPort["acquire"]
): TransactionalIdempotencyPort<SerializedResponse> {
  return {
    acquire,
    renew: vi.fn(async () => undefined),
    markCommittedInTransaction: vi.fn(async () => undefined),
    recover: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
  }
}

function createHandler(
  deps: FrameworkAdapterDeps,
  execute: ReturnType<typeof vi.fn>
) {
  return createFrameworkWriteHandler({
    adapterDeps: deps,
    scope: { scope: "platform" },
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

describe("framework write handler acquire guards (fail closed)", () => {
  it("fails closed (500) on an unknown acquire outcome", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(
      (async () => ({ outcome: "bogus" }) as never)
    )
    const response = await createHandler(createDeps(port), execute)(
      createRequest("unknown-outcome-key")
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: "Internal Server Error",
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it("fails closed (500) on a tokenless acquired result", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(
      (async () => ({ outcome: "acquired" }) as never)
    )
    const response = await createHandler(createDeps(port), execute)(
      createRequest("tokenless-acquired-key")
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: "Internal Server Error",
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it("fails closed (500) on an empty-token acquired result", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(
      (async () => ({
        outcome: "acquired",
        token: "",
      }) as never)
    )
    const response = await createHandler(createDeps(port), execute)(
      createRequest("empty-token-key")
    )
    expect(response.status).toBe(500)
    expect(execute).not.toHaveBeenCalled()
  })

  it("fails closed (500) on a tokenless business-committed result", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(
      (async () => ({
        outcome: "business-committed",
      }) as never)
    )
    const response = await createHandler(createDeps(port), execute)(
      createRequest("tokenless-committed-key")
    )
    expect(response.status).toBe(500)
    expect(execute).not.toHaveBeenCalled()
  })

  it("fails closed (500) on a replay without a result instead of replaying undefined", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(
      (async () => ({ outcome: "replay" }) as never)
    )
    const response = await createHandler(createDeps(port), execute)(
      createRequest("resultless-replay-key")
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: "Internal Server Error",
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it("fails closed (500) on a replay with an explicit undefined result", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(
      (async () => ({
        outcome: "replay",
        result: undefined,
      }) as never)
    )
    const response = await createHandler(createDeps(port), execute)(
      createRequest("undefined-replay-key")
    )
    // Core's assert permits an explicitly present (but undefined) result key;
    // the response deserializer must still refuse to serve it as committed.
    expect(response.status).toBe(500)
    expect(execute).not.toHaveBeenCalled()
  })

  it("fails closed (500) on a shapeless acquire result", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(
      (async () => null as never)
    )
    const response = await createHandler(createDeps(port), execute)(
      createRequest("shapeless-key")
    )
    expect(response.status).toBe(500)
    expect(execute).not.toHaveBeenCalled()
  })

  it("leaves well-formed acquire/replay flows unchanged", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const replayPort = createPort(async () => ({
      outcome: "replay",
      result: {
        version: "v1",
        body: JSON.stringify({ id: "old" }),
        status: 201,
        headers: [["content-type", "application/json"]],
      },
    }))
    const replayed = await createHandler(createDeps(replayPort), execute)(
      createRequest("valid-replay-key")
    )
    expect(replayed.status).toBe(201)
    expect(await replayed.json()).toEqual({ id: "old" })
    expect(execute).not.toHaveBeenCalled()

    const acquiredPort = createPort(async () => ({
      outcome: "acquired",
      token: "token",
    }))
    const created = await createHandler(createDeps(acquiredPort), execute)(
      createRequest("valid-acquired-key")
    )
    expect(created.status).toBe(200)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
