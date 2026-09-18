import { describe, expect, it, vi } from "vitest"
import {
  assertOperationServices,
  createOperationServices,
} from "../../foundation/operationServices"
import { assertRequestContext } from "../../foundation/requestContext"
import { createOperationContext } from "../operationContext"
import { runOperation } from "../operationPipeline"
import { OperationEffectCollector } from "../operationEffectCollector"
import { validateOperationDefinition } from "../validateOperationDefinition"
import type {
  PersistenceProvider,
  RuntimeCapabilities,
} from "../../ports"
import {
  ConfigurationError,
  ValidationError,
} from "../../foundation/errors"

function baseProvider(): PersistenceProvider {
  return {
    dialect: "memory",
    capabilities: {
      interactiveTransactions: false,
      atomicBatch: false,
      returningInsert: false,
      readSessions: false,
      jsonQueries: false,
      exactDecimal: false,
      persistentConnection: false,
    },
    repository: () => {
      throw new Error("not used")
    },
  }
}

const runtimeCaps: RuntimeCapabilities = {
  deferredExecution: true,
  objectStorage: false,
  cache: true,
}

describe("operation services guards", () => {
  it("rejects non-function service inputs at creation", () => {
    expect(() =>
      createOperationServices({ clock: "now" as never })
    ).toThrow(ConfigurationError)
    expect(() =>
      createOperationServices({ idGenerator: 42 as never })
    ).toThrow(ConfigurationError)
    expect(() =>
      createOperationServices({ logger: { info: () => {} } as never })
    ).toThrow(ConfigurationError)
  })

  it("rejects malformed service outputs on every call", () => {
    const badClock = createOperationServices({ clock: () => "now" as never })
    expect(() => badClock.clock()).toThrow(ConfigurationError)
    const badIds = createOperationServices({ idGenerator: () => "  " })
    expect(() => badIds.idGenerator()).toThrow(ConfigurationError)
  })

  it("rejects malformed services objects", () => {
    expect(() => assertOperationServices(null)).toThrow(ConfigurationError)
    expect(() =>
      assertOperationServices({ clock: () => new Date() })
    ).toThrow(ConfigurationError)
  })
})

describe("request context guards", () => {
  it("accepts a well-formed request", () => {
    expect(() =>
      assertRequestContext({
        requestId: "r1",
        correlationId: "c1",
        tenantId: null,
        actor: { id: "u1", type: "user" },
        metadata: {},
      })
    ).not.toThrow()
  })

  it.each([
    ["missing ids", { tenantId: null }],
    ["numeric tenant", { requestId: "r", correlationId: "c", tenantId: 42 }],
    ["actor without id", { requestId: "r", correlationId: "c", actor: { type: "user" } }],
    ["actor without type", { requestId: "r", correlationId: "c", actor: { id: "u" } }],
    ["array metadata", { requestId: "r", correlationId: "c", metadata: [] }],
    ["null request", null],
  ])("rejects %s", (_label, request) => {
    expect(() => assertRequestContext(request)).toThrow(ConfigurationError)
  })
})

describe("operation context entry guards", () => {
  function validArgs(overrides: Record<string, unknown> = {}) {
    return {
      persistence: baseProvider(),
      runtimeCapabilities: runtimeCaps,
      ...overrides,
    }
  }

  it("rejects a missing provider, bad capabilities, bad request, or bad services", () => {
    expect(() =>
      createOperationContext(validArgs({ persistence: null }))
    ).toThrow(ConfigurationError)
    expect(() =>
      createOperationContext(
        validArgs({
          persistence: {
            ...baseProvider(),
            capabilities: {
              ...baseProvider().capabilities,
              atomicBatch: "yes",
            },
          },
        })
      )
    ).toThrow(ConfigurationError)
    expect(() =>
      createOperationContext(
        validArgs({ runtimeCapabilities: { deferredExecution: true } })
      )
    ).toThrow(ConfigurationError)
    expect(() =>
      createOperationContext(
        validArgs({
          request: { requestId: "r", correlationId: "c", tenantId: 42 },
        })
      )
    ).toThrow(ConfigurationError)
    expect(() =>
      createOperationContext(
        validArgs({ services: { clock: () => new Date() } })
      )
    ).toThrow(ConfigurationError)
  })
})

describe("operation hook definition guards", () => {
  function mutation(hooks: Record<string, unknown>) {
    return {
      key: "hooked",
      kind: "mutation" as const,
      atomicity: { kind: "standard", mode: "required" } as const,
      authorization: { authorize: async () => ({ allowed: true }) },
      execute: async () => ({}),
      ...hooks,
    }
  }

  it("rejects non-function hooks at definition time", () => {
    expect(() => validateOperationDefinition(mutation({ before: "x" }))).toThrow(
      ValidationError
    )
    expect(() =>
      validateOperationDefinition(mutation({ after: [async () => {}, 42] }))
    ).toThrow(ValidationError)
    expect(() =>
      validateOperationDefinition(mutation({ afterCommit: [null] }))
    ).toThrow(ValidationError)
  })

  it("accepts function and function-array hooks", () => {
    expect(() =>
      validateOperationDefinition(
        mutation({ before: async ({ input }: { input: unknown }) => input })
      )
    ).not.toThrow()
  })
})

describe("effect collector registration guards", () => {
  it("rejects empty names and non-function executors", () => {
    const collector = new OperationEffectCollector()
    expect(() =>
      collector.addTransactionalEffect("", async () => {})
    ).toThrow(ConfigurationError)
    expect(() =>
      collector.addTransactionalEffect("x", "now" as never)
    ).toThrow(ConfigurationError)
    expect(() =>
      collector.addBestEffortEffect("  ", async () => {})
    ).toThrow(ConfigurationError)
    expect(() => collector.registerCommitMarker({} as never)).toThrow(
      ConfigurationError
    )
    expect(() =>
      collector.registerCommitMarker({ name: "x", commit: 1 } as never)
    ).toThrow(ConfigurationError)
  })
})

describe("transaction provider result guards", () => {
  it("fails fast without retry when the provider resolves garbage", async () => {
    let executions = 0
    const provider = {
      ...baseProvider(),
      capabilities: { ...baseProvider().capabilities, interactiveTransactions: true },
      runInTransaction: vi.fn(async () => undefined as never),
    }
    await expect(
      runOperation({
        operation: createOperationContext({
          persistence: provider,
          runtimeCapabilities: runtimeCaps,
        }),
        definition: {
          key: "garbage-tx",
          kind: "mutation",
          atomicity: {
            kind: "standard",
            mode: "required",
            transactionRetry: {
              retrySafe: true,
              maxAttempts: 2,
              delayMs: 0,
              backoffMultiplier: 1,
              maxDelayMs: 0,
            },
          },
          authorization: { authorize: async () => ({ allowed: true }) },
          execute: async () => {
            executions += 1
            return { ok: true }
          },
        },
        input: {},
      })
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(executions).toBe(0)
  })
})
