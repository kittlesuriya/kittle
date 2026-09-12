import { describe, expect, it, vi, type Mock } from "vitest"
import { createFrameworkWriteHandler } from "../createFrameworkWriteHandler"
import {
  deserializeResponse,
  fingerprintJson,
  serializeResponse,
  type SerializedResponse,
  type SerializedResponseIdempotencyPort,
} from "../idempotency"
import type { FrameworkAdapterDeps } from "../../server"
import type { IdempotencyPort, PersistenceProvider } from "kittle-core/ports"
import { bindAbacSecurityDigest } from "kittle-core/domain"

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
): import("kittle-core/ports").TransactionalIdempotencyPort<SerializedResponse> {
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
  execute: ReturnType<typeof vi.fn>,
  idempotency?: { required?: boolean },
  toResponse?: (result: unknown) => Response
) {
  return createFrameworkWriteHandler({
    adapterDeps: deps,
    scope: { scope: "platform", ...(idempotency ? { idempotency } : {}) },
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
    ...(toResponse ? { toResponse } : {}),
    validation: {
      body: {
        parse: (value: unknown) => value,
        parseAsync: async (value: unknown) => value,
      },
    },
  })
}

describe("framework write handler idempotency", () => {
  it("leaves requests without a key unchanged when idempotency is optional", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const acquire = vi.fn<SerializedResponseIdempotencyPort["acquire"]>()
    const port = createPort(acquire)
    const response = await createHandler(
      createDeps(port),
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: "created" })
    expect(acquire).not.toHaveBeenCalled()
  })

  it("requires a key and maps conflicts and in-progress reservations to 409", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const conflictAcquire: SerializedResponseIdempotencyPort["acquire"] =
      async () => ({ outcome: "conflict" })
    const port = createPort(conflictAcquire)
    const required = await createHandler(createDeps(port), execute, {
      required: true,
    })(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
    )
    expect(required.status).toBe(400)

    const conflict = await createHandler(
      createDeps(port),
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "key-1",
        },
      })
    )
    expect(conflict.status).toBe(409)
    expect(execute).not.toHaveBeenCalled()

    const inProgressAcquire: SerializedResponseIdempotencyPort["acquire"] =
      async () => ({ outcome: "in-progress" })
    const inProgress = await createHandler(
      createDeps(createPort(inProgressAcquire)),
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "key-1",
        },
      })
    )
    expect(inProgress.status).toBe(409)
  })

  it("replays the serialized response without executing again", async () => {
    const execute = vi.fn(async () => ({ id: "new" }))
    const replayAcquire: SerializedResponseIdempotencyPort["acquire"] =
      async () => ({
        outcome: "replay",
        result: {
          version: "v1",
          body: JSON.stringify({ id: "old" }),
          status: 201,
          headers: [["content-type", "application/json"]],
        },
      })
    const port = createPort(replayAcquire)
    const response = await createHandler(
      createDeps(port),
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "key-1",
        },
      })
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: "old" })
    expect(execute).not.toHaveBeenCalled()
  })

  it("fingerprints validated client mutation input instead of existing state", async () => {
    const acquire = vi.fn<SerializedResponseIdempotencyPort["acquire"]>(
      async () => ({ outcome: "acquired", token: "token" })
    )
    const port = createPort(acquire)
    const handler = createFrameworkWriteHandler({
      adapterDeps: createDeps(port),
      scope: { scope: "platform" },
      moduleKey: "test.module",
      action: "update",
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
        execute: async () => ({ id: "created" }),
      } as never,
      validation: {
        params: {
          parse: (value: unknown) => value,
          parseAsync: async (value: unknown) => value,
        },
        body: {
          parse: (value: unknown) => value,
          parseAsync: async (value: unknown) => value,
        },
      },
      resolveExistingRecord: vi.fn(async () => ({ id: "row-1", version: 1 })),
      resolveInput: vi.fn(
        async ({
          existing,
        }: {
          existing?: { id: string; version: number }
        }) => ({ existing, patch: { name: "same" } })
      ),
    })

    await handler(
      new Request("https://example.test/items/row-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "same" }),
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "key-1",
        },
      }),
      { params: Promise.resolve({ id: "row-1" }) }
    )

    const first = acquire.mock.calls[0]?.[0]
    expect(first?.fingerprint).toBe(
      await fingerprintJson({
        moduleKey: "test.module",
        action: "update",
        securityContext: {
          scope: "authenticated",
          actorId: "actor-1",
          actorType: "platform",
          tenantId: null,
          roleId: null,
          roleSlug: null,
          branchId: null,
          departmentId: null,
          impersonatedById: null,
        },
        clientMutation: { params: { id: "row-1" }, body: { name: "same" } },
        preconditions: {},
        abacSecurityDigest: null,
      })
    )
  })

  it("canonicalizes object key order before hashing", async () => {
    await expect(fingerprintJson({ b: 2, a: { d: true, c: 1 } })).resolves.toBe(
      await fingerprintJson({ a: { c: 1, d: true }, b: 2 })
    )
  })

  it("distinguishes distinct transformed dates in the fingerprint", async () => {
    await expect(
      fingerprintJson({ when: new Date("2026-01-01T00:00:00.000Z") })
    ).resolves.not.toBe(
      await fingerprintJson({ when: new Date("2026-12-31T00:00:00.000Z") })
    )
  })

  it("rejects Map and Set values (fail closed)", async () => {
    await expect(fingerprintJson(new Map([["a", 1]]))).rejects.toThrow()
    await expect(fingerprintJson({ rows: new Set([1, 2]) })).rejects.toThrow()
  })

  it("omits undefined top-level client mutation fields from the identity", async () => {
    const acquire = vi.fn<SerializedResponseIdempotencyPort["acquire"]>(
      async () => ({ outcome: "acquired", token: "token" })
    )
    const port = createPort(acquire)
    await createHandler(
      createDeps(port),
      vi.fn(async () => ({ id: "created" }))
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "key-1",
        },
      })
    )
    const first = acquire.mock.calls[0]?.[0]
    expect(first?.fingerprint).toBe(
      await fingerprintJson({
        moduleKey: "test.module",
        action: "create",
        securityContext: {
          scope: "authenticated",
          actorId: "actor-1",
          actorType: "platform",
          tenantId: null,
          roleId: null,
          roleSlug: null,
          branchId: null,
          departmentId: null,
          impersonatedById: null,
        },
        clientMutation: { body: {} },
        preconditions: {},
        abacSecurityDigest: null,
      })
    )
  })

  it("binds replay eligibility to the current ABAC security digest", async () => {
    const acquire = vi.fn<SerializedResponseIdempotencyPort["acquire"]>(
      async () => ({ outcome: "acquired", token: "token" })
    )
    const port = createPort(acquire)
    const firstBundle = await bindAbacSecurityDigest({
      mode: "platform",
      moduleKey: "test.module",
      policies: [],
      context: {},
      defaultEffect: "deny",
      fieldCatalog: {},
    })
    const secondBundle = await bindAbacSecurityDigest({
      ...firstBundle,
      policies: [
        {
          source: { policyId: "changed", scopeType: "platform_default" },
          moduleKey: "test.module",
          effect: "allow",
          priority: 1,
          payload: {
            actions: ["create"],
            capabilities: [],
            conditions: {
              version: 2,
              systemScope: { logic: "AND", conditions: [] },
              userFilters: { logic: "AND", conditions: [] },
            },
          },
          compiledConditions: { kind: "literal", value: true },
        },
      ],
    })
    let bundle = firstBundle
    const deps = {
      ...createDeps(port),
      isOwnerBypass: vi.fn(() => false),
      resolveAbacBundle: vi.fn(async () => bundle),
    }
    const request = () =>
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "policy-key",
        },
      })
    await createHandler(
      deps,
      vi.fn(async () => ({ id: "created" }))
    )(request())
    bundle = secondBundle
    await createHandler(
      deps,
      vi.fn(async () => ({ id: "created" }))
    )(request())

    expect(acquire.mock.calls[0]?.[0].fingerprint).not.toBe(
      acquire.mock.calls[1]?.[0].fingerprint
    )
  })

  it("versions fingerprints, bounds keys, and strips replay-unsafe headers", async () => {
    expect(await fingerprintJson({ value: 1 })).toHaveLength(64)
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(async () => ({
      outcome: "acquired",
      token: "token",
    }))
    const response = await createHandler(
      createDeps(port),
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "x".repeat(256),
        },
      })
    )
    expect(response.status).toBe(400)

    const stored = await serializeResponse(
      new Response("created", {
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": "7",
          Connection: "close",
        },
      })
    )
    expect(stored.body).toBe("created")
    expect(
      stored.headers.some(
        ([name]: [string, string]) => name === "content-length"
      )
    ).toBe(false)
  })

  it("rejects malformed replay responses", () => {
    expect(() =>
      deserializeResponse({
        version: "v1",
        body: "ok",
        status: 200,
        headers: [["content-type", 42] as never],
      })
    ).toThrow("headers")
    expect(() =>
      deserializeResponse({
        version: "v1",
        body: "ok",
        status: 200,
        headers: [["connection", "close"]],
      })
    ).toThrow("headers")
  })

  it("keeps a request running when the advisory heartbeat lease renew fails", async () => {
    vi.useFakeTimers()
    try {
      let resolveExecute!: () => void
      let markExecuteInitialized!: () => void
      const executeInitialized = new Promise<void>((resolve) => {
        markExecuteInitialized = resolve
      })
      const execute = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          resolveExecute = resolve
          markExecuteInitialized()
        })
        return { id: "created" }
      })
      const port = createPort(async () => ({
        outcome: "acquired",
        token: "token",
      }))
      ;(port.renew as Mock).mockRejectedValue(new Error("lease lost"))
      const pending = createHandler(
        createDeps(port),
        execute
      )(
        new Request("https://example.test", {
          method: "POST",
          body: "{}",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "heartbeat-key",
          },
        })
      )
      await executeInitialized
      await vi.advanceTimersByTimeAsync(10_001)
      resolveExecute()
      const response = await pending
      expect(response.status).toBe(200)
      expect(execute).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("commits and completes an acquired key exactly once", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(async () => ({
      outcome: "acquired",
      token: "token",
    }))

    const response = await createHandler(
      createDeps(port),
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "key-1",
        },
      })
    )

    expect(response.status).toBe(200)
    const markCommittedInTransaction = Reflect.get(
      port,
      "markCommittedInTransaction"
    ) as Mock
    const complete = Reflect.get(port, "complete") as Mock
    expect(markCommittedInTransaction.mock.calls).toHaveLength(1)
    expect(complete.mock.calls).toHaveLength(1)
  })

  it("does not return a business response when the durable idempotency marker fails", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const port = createPort(async () => ({
      outcome: "acquired",
      token: "token",
    }))
    const markCommittedInTransaction = Reflect.get(
      port,
      "markCommittedInTransaction"
    ) as Mock
    markCommittedInTransaction.mockRejectedValueOnce(
      new Error("idempotency unavailable")
    )

    const response = await createHandler(
      createDeps(port),
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "key-1",
        },
      })
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: "Internal Server Error",
    })
  })

  it("recovers a finalization failure so a retry cannot re-execute the mutation", async () => {
    let committed = false
    let failComplete = true
    const port = createPort(async () =>
      committed
        ? { outcome: "business-committed", token: "token" }
        : { outcome: "acquired", token: "token" }
    )
    ;(port.complete as Mock).mockImplementation(async () => {
      if (failComplete) {
        failComplete = false
        throw new Error("finalize unavailable")
      }
      committed = true
    })
    ;(port.recover as Mock).mockImplementation(async () => {
      committed = true
    })
    const execute = vi.fn(async () => ({ id: "created" }))
    const request = () =>
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "retry-key",
        },
      })

    // First request: in-transaction receipt succeeds, finalization fails, recover
    // leaves the row business-committed so a retry can never re-execute.
    expect(
      (await createHandler(createDeps(port), execute)(request())).status
    ).toBe(500)
    // Retry sees business-committed without a replayable response.
    expect(
      (await createHandler(createDeps(port), execute)(request())).status
    ).toBe(409)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("recovers serialization and completion failures after the business commit", async () => {
    const port = createPort(async () => ({
      outcome: "acquired",
      token: "token",
    }))
    ;(port.complete as Mock).mockRejectedValueOnce(
      new Error("completion unavailable")
    )
    const execute = vi.fn(async () => ({ id: "created" }))
    const failingResponse = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("serialize failed"))
          },
        }),
        { status: 200 }
      )

    const serializationResponse = await createHandler(
      createDeps(port),
      execute,
      undefined,
      failingResponse
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "serialize-key",
        },
      })
    )
    expect(serializationResponse.status).toBe(500)
    expect((port.recover as Mock).mock.calls).toHaveLength(1)

    const completionResponse = await createHandler(
      createDeps(port),
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "complete-key",
        },
      })
    )
    expect(completionResponse.status).toBe(500)
    expect((port.recover as Mock).mock.calls).toHaveLength(2)
  })

  it("same actor + same key + role change produces conflict (not second execution)", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const conflictAcquire: SerializedResponseIdempotencyPort["acquire"] =
      async () => ({ outcome: "conflict" })
    const port = createPort(conflictAcquire)

    // First request with roleId "role-a"
    const depsA = {
      ...createDeps(port),
      resolveSession: vi.fn(async () => ({
        scope: "platform" as const,
        actor: {
          id: "actor-1",
          type: "platform" as const,
          roleId: "role-a",
          roleSlug: "admin",
          bypassAuthority: true,
        },
        raw: null,
      })),
    }
    await createHandler(
      depsA,
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "role-change-key",
        },
      })
    )

    // Second request with roleId "role-b" — same principal, different role
    const depsB = {
      ...createDeps(port),
      resolveSession: vi.fn(async () => ({
        scope: "platform" as const,
        actor: {
          id: "actor-1",
          type: "platform" as const,
          roleId: "role-b",
          roleSlug: "viewer",
          bypassAuthority: true,
        },
        raw: null,
      })),
    }
    const response = await createHandler(
      depsB,
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "role-change-key",
        },
      })
    )

    expect(response.status).toBe(409)
    expect(execute).not.toHaveBeenCalled()
  })

  it("same actor + same key + branch change produces conflict (not second execution)", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const conflictAcquire: SerializedResponseIdempotencyPort["acquire"] =
      async () => ({ outcome: "conflict" })
    const port = createPort(conflictAcquire)

    // First request with branch "branch-1"
    const depsA = {
      ...createDeps(port),
      resolveSession: vi.fn(async () => ({
        scope: "platform" as const,
        actor: {
          id: "actor-1",
          type: "platform" as const,
          branchId: "branch-1",
          bypassAuthority: true,
        },
        raw: null,
      })),
    }
    await createHandler(
      depsA,
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "branch-change-key",
        },
      })
    )

    // Second request with branch "branch-2" — same principal, different branch
    const depsB = {
      ...createDeps(port),
      resolveSession: vi.fn(async () => ({
        scope: "platform" as const,
        actor: {
          id: "actor-1",
          type: "platform" as const,
          branchId: "branch-2",
          bypassAuthority: true,
        },
        raw: null,
      })),
    }
    const response = await createHandler(
      depsB,
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "branch-change-key",
        },
      })
    )

    expect(response.status).toBe(409)
    expect(execute).not.toHaveBeenCalled()
  })

  it("same actor + same key + department change produces conflict (not second execution)", async () => {
    const execute = vi.fn(async () => ({ id: "created" }))
    const conflictAcquire: SerializedResponseIdempotencyPort["acquire"] =
      async () => ({ outcome: "conflict" })
    const port = createPort(conflictAcquire)

    // First request with dept "engineering"
    const depsA = {
      ...createDeps(port),
      resolveSession: vi.fn(async () => ({
        scope: "platform" as const,
        actor: {
          id: "actor-1",
          type: "platform" as const,
          departmentId: "engineering",
          bypassAuthority: true,
        },
        raw: null,
      })),
    }
    await createHandler(
      depsA,
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "dept-change-key",
        },
      })
    )

    // Second request with dept "sales" — same principal, different department
    const depsB = {
      ...createDeps(port),
      resolveSession: vi.fn(async () => ({
        scope: "platform" as const,
        actor: {
          id: "actor-1",
          type: "platform" as const,
          departmentId: "sales",
          bypassAuthority: true,
        },
        raw: null,
      })),
    }
    const response = await createHandler(
      depsB,
      execute
    )(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "dept-change-key",
        },
      })
    )

    expect(response.status).toBe(409)
    expect(execute).not.toHaveBeenCalled()
  })
})
