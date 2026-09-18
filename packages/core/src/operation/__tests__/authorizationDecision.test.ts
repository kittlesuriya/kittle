import { describe, expect, it } from "vitest"
import { assertAuthorizationDecision } from "../authorization"
import { createOperationContext } from "../operationContext"
import { runOperation } from "../operationPipeline"
import type {
  AtomicBatchProvider,
  PersistenceProvider,
  RuntimeCapabilities,
} from "../../ports"
import {
  ConfigurationError,
  ForbiddenError,
} from "../../foundation/errors"

function createNoTxProvider(): PersistenceProvider {
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

function createAtomicProvider(): AtomicBatchProvider<string> {
  return {
    dialect: "memory",
    capabilities: {
      interactiveTransactions: false,
      atomicBatch: true,
      returningInsert: false,
      readSessions: false,
      jsonQueries: false,
      exactDecimal: false,
      persistentConnection: false,
    },
    repository: () => {
      throw new Error("not used")
    },
    async executeAtomicBatch(plan) {
      return plan.items.map((item) => ({
        kind: item.kind,
        result: item.kind === "command" ? item.command : item,
      }))
    },
  }
}

const defaultRuntimeCaps: RuntimeCapabilities = {
  deferredExecution: true,
  objectStorage: false,
  cache: true,
}

function readEnvironment(decision: unknown) {
  return {
    operation: createOperationContext({
      persistence: createNoTxProvider(),
      runtimeCapabilities: defaultRuntimeCaps,
    }),
    definition: {
      key: "guarded-read",
      kind: "read" as const,
      authorization: {
        authorize: async () => decision as never,
      },
      execute: async () => ({ ok: true }),
    },
    input: {},
  }
}

describe("assertAuthorizationDecision", () => {
  it("accepts an explicit boolean decision", () => {
    expect(() =>
      assertAuthorizationDecision({ allowed: true }, "op")
    ).not.toThrow()
    expect(() =>
      assertAuthorizationDecision({ allowed: false, reason: "no" }, "op")
    ).not.toThrow()
  })

  it.each([undefined, null, true, "allowed", 1, []])(
    "rejects a missing or non-object decision (%p)",
    (decision) => {
      expect(() => assertAuthorizationDecision(decision, "op")).toThrow(
        ConfigurationError
      )
    }
  )

  it.each([
    { allowed: "yes" },
    { allowed: 1 },
    {},
    { allowed: true, reason: 42 },
  ])("rejects a malformed decision object (%p)", (decision) => {
    expect(() => assertAuthorizationDecision(decision, "op")).toThrow(
      ConfigurationError
    )
  })
})

describe("standard pipeline authorization fail-closed", () => {
  it.each([undefined, null])(
    "rejects a missing decision instead of allowing (%p)",
    async (decision) => {
      await expect(
        runOperation(readEnvironment(decision))
      ).rejects.toBeInstanceOf(ConfigurationError)
    }
  )

  it("rejects a non-boolean allowed flag", async () => {
    await expect(
      runOperation(readEnvironment({ allowed: "yes" }))
    ).rejects.toBeInstanceOf(ConfigurationError)
  })

  it("still allows explicit allow and forbids explicit deny", async () => {
    await expect(
      runOperation(readEnvironment({ allowed: true }))
    ).resolves.toEqual({ ok: true })
    await expect(
      runOperation(readEnvironment({ allowed: false, reason: "no" }))
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("reads without authorization still skip the check", async () => {
    await expect(
      runOperation({
        operation: createOperationContext({
          persistence: createNoTxProvider(),
          runtimeCapabilities: defaultRuntimeCaps,
        }),
        definition: {
          key: "open-read",
          kind: "read",
          execute: async () => ({ ok: true }),
        },
        input: {},
      })
    ).resolves.toEqual({ ok: true })
  })
})

describe("atomic-batch pipeline authorization fail-closed", () => {
  function atomicEnvironment(decision: unknown) {
    return {
      operation: createOperationContext({
        persistence: createAtomicProvider(),
        runtimeCapabilities: defaultRuntimeCaps,
      }),
      definition: {
        key: "guarded-atomic",
        kind: "mutation" as const,
        atomicity: { kind: "atomic-batch" } as const,
        authorization: {
          authorize: async () => decision as never,
        },
        prepare: () => ({ commands: [], result: { ok: true } }),
      },
      input: {},
    }
  }

  it.each([undefined, null, { allowed: "yes" }])(
    "rejects a missing or malformed decision (%p)",
    async (decision) => {
      await expect(
        runOperation(atomicEnvironment(decision))
      ).rejects.toBeInstanceOf(ConfigurationError)
    }
  )
})
