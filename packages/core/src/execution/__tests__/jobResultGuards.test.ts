import { describe, expect, it, vi } from "vitest"
import { dispatchDueJobs } from "../dispatcher"
import { createJobRegistry } from "../jobRegistry"
import { assertJobResult } from "../types"
import type { JobDefinition, JobStore, StoredJob } from "../types"
import { ValidationError } from "../../foundation/errors"

function makeJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: "job-1",
    jobType: "test",
    jobVersion: 1,
    tenantId: null,
    scope: "system",
    payload: "{}",
    status: "pending",
    priority: 0,
    attemptsCompleted: 0,
    currentAttempt: 1,
    maxAttempts: 3,
    runAt: new Date(),
    nextAttemptAt: null,
    partitionKey: null,
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date(Date.now() + 1_000),
    claimToken: "claim-1",
    idempotencyKey: null,
    fingerprint: null,
    correlationId: null,
    lastError: null,
    resultPayload: null,
    metadata: null,
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    ...overrides,
  }
}

function makeStore(overrides: Partial<JobStore> = {}): JobStore {
  return {
    enqueue: vi.fn(),
    getById: vi.fn(),
    getByCorrelationId: vi.fn(),
    getLatestPriorScheduleExecution: vi.fn(),
    getByIdempotencyKey: vi.fn(),
    claimDue: vi.fn(async () => [makeJob()]),
    renewLease: vi.fn(async () => true),
    markSucceeded: vi.fn(async () => ({ applied: true as const })),
    markRetrying: vi.fn(async () => ({ applied: true as const })),
    markFailed: vi.fn(async () => ({ applied: true as const })),
    cancel: vi.fn(),
    findPending: vi.fn(),
    ...overrides,
  }
}

function baseConfig(store: JobStore, registry: ReturnType<typeof createJobRegistry>) {
  return {
    store,
    registry,
    workerId: "worker-1",
    leaseDurationMs: 100,
    claimLimit: 1,
    requester: { scope: "system" as const },
  }
}

function registryWith(
  execute: JobDefinition["execute"],
  extra: Partial<JobDefinition> = {}
) {
  const registry = createJobRegistry()
  registry.register({
    type: "test",
    version: 1,
    scope: "system",
    maxAttempts: 3,
    retryDelayMs: 0,
    retryBackoffMultiplier: 1,
    timeoutMs: 50,
    decodePayload: (input) => input as Record<string, unknown>,
    execute,
    ...extra,
  })
  return registry
}

function validDefinition(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    type: "test",
    version: 1,
    scope: "system",
    maxAttempts: 3,
    retryDelayMs: 0,
    retryBackoffMultiplier: 1,
    decodePayload: (input) => input as Record<string, unknown>,
    execute: async () => ({ success: true }),
    ...overrides,
  }
}

describe("assertJobResult", () => {
  it("accepts success true/false shapes", () => {
    expect(() =>
      assertJobResult({ success: true, data: { ok: true } })
    ).not.toThrow()
    expect(() => assertJobResult({ success: false })).not.toThrow()
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array", []],
    ["empty object", {}],
    ["string success", { success: "yes" }],
    ["numeric success", { success: 1 }],
    ["missing success", { data: {} }],
  ])("rejects malformed result %s", (_label, value) => {
    expect(() => assertJobResult(value)).toThrow(ValidationError)
  })
})

describe("dispatcher malformed execute results", () => {
  it.each([
    ["null", null],
    ["array", []],
    ["empty object", {}],
    ["string success", { success: "yes" }],
  ])("dead-letters malformed result %s without running hooks", async (_label, malformed) => {
    const onRetry = vi.fn(async () => {})
    const onMaxRetriesExceeded = vi.fn(async () => {})
    const execute = vi.fn(async () => malformed as never)
    const markFailed = vi.fn(async () => ({ applied: true as const }))
    const markSucceeded = vi.fn(async () => ({ applied: true as const }))
    const store = makeStore({ markFailed, markSucceeded })
    const registry = registryWith(execute, { onRetry, onMaxRetriesExceeded })

    const result = await dispatchDueJobs(baseConfig(store, registry))

    expect(result.deadLettered).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dead_letter" })
    )
    expect(markSucceeded).not.toHaveBeenCalled()
    expect(onRetry).not.toHaveBeenCalled()
    expect(onMaxRetriesExceeded).not.toHaveBeenCalled()
  })

  it("reports lease loss when the malformed-result dead-letter is not applied", async () => {
    const execute = vi.fn(async () => null as never)
    const markFailed = vi.fn(async () => ({ applied: false as const }))
    const store = makeStore({ markFailed })
    const result = await dispatchDueJobs(
      baseConfig(store, registryWith(execute))
    )
    expect(result.leaseLost).toBe(1)
    expect(result.deadLettered).toBe(0)
  })
})

describe("job registry scope guard", () => {
  it.each([["tenant"], ["platform"], ["system"]])(
    "accepts scope %s",
    (scope) => {
      expect(() =>
        createJobRegistry().register(
          validDefinition({ scope: scope as JobDefinition["scope"] })
        )
      ).not.toThrow()
    }
  )

  it.each([[undefined], [null], [""], ["bogus"], ["TENANT"], [42]])(
    "rejects scope %s",
    (scope) => {
      expect(() =>
        createJobRegistry().register(
          validDefinition({ scope: scope as never })
        )
      ).toThrow(ValidationError)
    }
  )
})

describe("dispatcher timeoutPolicy mode guard", () => {
  it("rejects a non-cooperative timeoutPolicy mode", async () => {
    const store = makeStore({ claimDue: vi.fn(async () => []) })
    const registry = registryWith(async () => ({ success: true }))
    await expect(
      dispatchDueJobs({
        ...baseConfig(store, registry),
        timeoutPolicy: {
          mode: "preemptive" as never,
          cancellationGraceMs: 10,
        },
      })
    ).rejects.toThrow(ValidationError)
    await expect(
      dispatchDueJobs({
        ...baseConfig(store, registry),
        timeoutPolicy: { cancellationGraceMs: 10 } as never,
      })
    ).rejects.toThrow(ValidationError)
  })

  it("accepts cooperative timeoutPolicy", async () => {
    const store = makeStore({ claimDue: vi.fn(async () => []) })
    const registry = registryWith(async () => ({ success: true }))
    await expect(
      dispatchDueJobs({
        ...baseConfig(store, registry),
        timeoutPolicy: { mode: "cooperative", cancellationGraceMs: 10 },
      })
    ).resolves.toMatchObject({ claimed: 0 })
  })
})
