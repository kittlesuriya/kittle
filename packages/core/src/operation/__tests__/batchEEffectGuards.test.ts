import { describe, expect, it } from "vitest"
import { createOperationContext } from "../operationContext"
import { runOperation as frameworkRunOperation } from "../operationPipeline"
import { OperationCommittedEffectError } from "../atomicBatchOperationPipeline"
import { OperationEffectCollector } from "../operationEffectCollector"
import { ConfigurationError } from "../../foundation/errors"
import type {
  AtomicBatchProvider,
  InteractiveTransactionProvider,
  RuntimeCapabilities,
} from "../../ports"

const defaultRuntimeCaps: RuntimeCapabilities = {
  deferredExecution: true,
  objectStorage: false,
  cache: true,
}

function createTxProvider(): InteractiveTransactionProvider {
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
    async runInTransaction(fn) {
      return fn(this)
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
      maxPageSize: 100,
      maxBindParams: 100,
      maxStatementBytes: 100_000,
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

describe("batch E: throwing effectFailureReporter never masks post-commit failures", () => {
  it("standard pipeline still throws the committed failure and records metadata", async () => {
    const metadata: Record<string, unknown> = {}
    const ctx = createOperationContext({
      persistence: createTxProvider(),
      runtimeCapabilities: defaultRuntimeCaps,
      request: {
        requestId: "request-1",
        correlationId: "correlation-1",
        metadata,
      },
      effectFailureReporter: () => {
        throw new Error("reporter exploded")
      },
    })

    await expect(
      frameworkRunOperation({
        operation: ctx,
        definition: {
          key: "standard-reporter-throws",
          kind: "mutation",
          atomicity: { kind: "standard", mode: "required" },
          authorization: { authorize: async () => ({ allowed: true }) },
          execute: async () => ({ ok: true }),
          afterCommit: () => {
            throw new Error("after-commit failed")
          },
        },
        input: {},
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof OperationCommittedEffectError &&
        error.committed === true &&
        String((error.cause as Error)?.message ?? error).includes(
          "after-commit failed"
        )
    )

    expect(metadata._effectFailures).toHaveLength(1)
    expect(metadata._effectFailures).toEqual([
      expect.objectContaining({ phase: "afterCommit", effectName: "hooks" }),
    ])
  })

  it("atomic pipeline still throws the committed failure and records metadata", async () => {
    const metadata: Record<string, unknown> = {}
    const ctx = createOperationContext({
      persistence: createAtomicProvider(),
      runtimeCapabilities: defaultRuntimeCaps,
      request: {
        requestId: "request-1",
        correlationId: "correlation-1",
        metadata,
      },
      effectFailureReporter: () => {
        throw new Error("reporter exploded")
      },
    })

    await expect(
      frameworkRunOperation({
        operation: ctx,
        definition: {
          key: "atomic-reporter-throws",
          kind: "mutation",
          atomicity: { kind: "atomic-batch" },
          authorization: { authorize: async () => ({ allowed: true }) },
          prepare: () => ({ commands: ["insert"], result: {} }),
          afterCommit: () => {
            throw new Error("atomic after-commit failed")
          },
        } as unknown as Parameters<typeof frameworkRunOperation>[0]["definition"],
        input: {},
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof OperationCommittedEffectError &&
        String((error.cause as Error)?.message ?? error).includes(
          "atomic after-commit failed"
        )
    )

    expect(metadata._effectFailures).toHaveLength(1)
    expect(metadata._effectFailures).toEqual([
      expect.objectContaining({ phase: "afterCommit", effectName: "hooks" }),
    ])
  })

  it("standard best-effort effects still resolve when the reporter throws", async () => {
    const metadata: Record<string, unknown> = {}
    const ctx = createOperationContext({
      persistence: createTxProvider(),
      runtimeCapabilities: defaultRuntimeCaps,
      request: {
        requestId: "request-1",
        correlationId: "correlation-1",
        metadata,
      },
      effectFailureReporter: () => {
        throw new Error("reporter exploded")
      },
    })

    await expect(
      frameworkRunOperation({
        operation: ctx,
        definition: {
          key: "standard-reporter-throws-besteffort",
          kind: "mutation",
          atomicity: { kind: "standard", mode: "required" },
          authorization: { authorize: async () => ({ allowed: true }) },
          execute: async ({ operation }) => {
            operation.addBestEffortEffect("best-effort", async () => {
              throw new Error("best-effort failed")
            })
            return { ok: true }
          },
        },
        input: {},
      })
    ).resolves.toEqual({ ok: true })

    expect(metadata._effectFailures).toEqual([
      expect.objectContaining({
        phase: "bestEffort",
        effectName: "best-effort",
      }),
    ])
  })
})

describe("batch E: OperationEffectCollector validates initial commit markers", () => {
  it("rejects a malformed initial commit marker at construction", () => {
    expect(
      () =>
        new OperationEffectCollector({
          commitMarkers: [{ name: "" }],
        })
    ).toThrow(ConfigurationError)
    expect(
      () =>
        new OperationEffectCollector({
          commitMarkers: [null as never],
        })
    ).toThrow(ConfigurationError)
    expect(
      () =>
        new OperationEffectCollector({
          commitMarkers: [{ name: "m", fence: "nope" } as never],
        })
    ).toThrow(ConfigurationError)
  })

  it("accepts valid initial commit markers", () => {
    const marker = { name: "m", fence: async () => {} }
    const collector = new OperationEffectCollector({
      commitMarkers: [marker],
    })
    expect(collector.commitMarkers).toEqual([marker])
  })

  it("accepts an empty constructor", () => {
    expect(() => new OperationEffectCollector()).not.toThrow()
    expect(
      () => new OperationEffectCollector(undefined, {})
    ).not.toThrow()
  })
})
