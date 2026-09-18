import { describe, expect, it, vi } from "vitest"
import { createOperationContext } from "../operationContext"
import { runOperation } from "../operationPipeline"
import type {
  AtomicBatchProvider,
  InteractiveTransactionProvider,
  RuntimeCapabilities,
} from "../../ports"
import type { OperationAuditConfig } from "../operationDefinition"
import { ConfigurationError } from "../../foundation/errors"

const defaultRuntimeCaps: RuntimeCapabilities = {
  deferredExecution: true,
  objectStorage: false,
  cache: true,
}

function createTxProvider(): InteractiveTransactionProvider {
  const provider: InteractiveTransactionProvider = {
    dialect: "memory",
    capabilities: {
      interactiveTransactions: true,
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
    async runInTransaction(fn) {
      return fn(provider)
    },
  }
  return provider
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

function txEnvironment(
  overrides: Record<string, unknown> = {},
  audit: Partial<OperationAuditConfig<unknown, { id: string }>> = {},
  execute: (args: {
    operation: import("../operationContext").OperationContext
  }) => Promise<{ id: string }> = async () => ({ id: "row-1" })
) {
  return {
    operation: createOperationContext({
      persistence: createTxProvider(),
      runtimeCapabilities: defaultRuntimeCaps,
      request: {
        requestId: "request-1",
        correlationId: "correlation-1",
        actor: { id: "user-1", type: "user" },
      },
      auditSinkFactory: {
        create: () => ({ write: vi.fn() }),
      },
      ...overrides,
    }),
    definition: {
      key: "guarded-mutation",
      kind: "mutation" as const,
      atomicity: { kind: "standard", mode: "required" } as const,
      authorization: { authorize: async () => ({ allowed: true }) },
      execute,
      audit: {
        action: "row.updated",
        resourceType: "row",
        auditGuarantee: "atomic" as const,
        resolveResourceId: () => "row-1",
        ...audit,
      },
    },
    input: {},
  }
}

describe("standard pipeline audit fail-fast", () => {
  it("rejects an empty resolved resource id", async () => {
    await expect(
      runOperation(txEnvironment({}, { resolveResourceId: () => "" }))
    ).rejects.toBeInstanceOf(ConfigurationError)
  })

  it("rejects a non-object extractor value", async () => {
    await expect(
      runOperation(
        txEnvironment({}, { extractNewValue: () => ["not", "an", "object"] as never })
      )
    ).rejects.toBeInstanceOf(ConfigurationError)
  })

  it("rejects a sanitizer that drops the value shape", async () => {
    await expect(
      runOperation(
        txEnvironment(
          { auditSanitizer: () => undefined },
          { extractNewValue: () => ({ status: "active" }) }
        )
      )
    ).rejects.toBeInstanceOf(ConfigurationError)
  })

  it("rejects a malformed transactional audit sink product", async () => {
    await expect(
      runOperation(txEnvironment({ auditSinkFactory: { create: () => ({}) } }))
    ).rejects.toBeInstanceOf(ConfigurationError)
  })

  it("rejects a malformed outbox sink product", async () => {
    const environment = txEnvironment(
      { outboxSinkFactory: { create: () => null } },
      {},
      async ({ operation }) => {
        operation.addOutboxRecord({
          type: "row.created",
          version: 1,
          aggregateType: "row",
          aggregateId: "row-1",
          payload: {},
          idempotencyKey: "row-1",
        })
        return { id: "row-1" }
      }
    )
    await expect(runOperation(environment)).rejects.toBeInstanceOf(
      ConfigurationError
    )
  })

  it("rejects an outbox record with a missing identity field", async () => {
    const environment = txEnvironment(
      { outboxSinkFactory: { create: () => ({ append: vi.fn() }) } },
      {},
      async ({ operation }) => {
        operation.addOutboxRecord({
          type: "",
          version: 1,
          aggregateType: "row",
          aggregateId: "row-1",
          payload: {},
          idempotencyKey: "row-1",
        })
        return { id: "row-1" }
      }
    )
    await expect(runOperation(environment)).rejects.toBeInstanceOf(
      ConfigurationError
    )
  })

  it("rejects a malformed best-effort audit sink", async () => {
    const bestEffort = txEnvironment(
      { auditSink: {} },
      { auditGuarantee: "best-effort" }
    )
    delete (bestEffort.operation as unknown as Record<string, unknown>)
      .auditSinkFactory
    await expect(runOperation(bestEffort)).rejects.toBeInstanceOf(
      ConfigurationError
    )
  })
})

describe("atomic-batch pipeline audit fail-fast", () => {
  function atomicEnvironment(audit: Record<string, unknown>) {
    const executeAtomicBatch = vi.fn(async (plan: { items: unknown[] }) =>
      plan.items.map((item) => ({
        kind: (item as { kind: string }).kind,
        result: undefined,
      }))
    )
    const provider = Object.assign(createAtomicProvider(), {
      executeAtomicBatch,
    })
    return {
      executeAtomicBatch,
      args: {
        operation: createOperationContext({
          persistence: provider,
          runtimeCapabilities: defaultRuntimeCaps,
          request: {
            requestId: "request-1",
            correlationId: "correlation-1",
            actor: { id: "user-1", type: "user" },
          },
        }),
        definition: {
          key: "guarded-atomic-audit",
          kind: "mutation" as const,
          atomicity: { kind: "atomic-batch" } as const,
          authorization: { authorize: async () => ({ allowed: true }) },
          prepare: () => ({ commands: [], result: { id: "row-1" } }),
          audit: {
            action: "row.created",
            resourceType: "row",
            resolveResourceId: () => "row-1",
            ...audit,
          },
        },
        input: {},
      },
    }
  }

  it("rejects an empty resolved resource id before committing", async () => {
    const { executeAtomicBatch, args } = atomicEnvironment({
      resolveResourceId: () => "  ",
    })
    await expect(runOperation(args)).rejects.toBeInstanceOf(ConfigurationError)
    expect(executeAtomicBatch).not.toHaveBeenCalled()
  })

  it("rejects an oversized audit value before committing", async () => {
    const { executeAtomicBatch, args } = atomicEnvironment({
      extractNewValue: () => ({ blob: "x".repeat(70_000) }),
    })
    await expect(runOperation(args)).rejects.toThrow(/bytes/)
    expect(executeAtomicBatch).not.toHaveBeenCalled()
  })
})
