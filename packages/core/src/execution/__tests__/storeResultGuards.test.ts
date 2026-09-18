import { describe, expect, it, vi } from "vitest"
import { dispatchDueJobs } from "../dispatcher"
import { createJobRegistry } from "../jobRegistry"
import { RetryableJobError } from "../types"
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

function makeRegistry(execute: JobDefinition["execute"]) {
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
  })
  return registry
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

function baseConfig(store: JobStore, execute: JobDefinition["execute"]) {
  return {
    store,
    registry: makeRegistry(execute),
    workerId: "worker-1",
    leaseDurationMs: 100,
    claimLimit: 1,
    requester: { scope: "system" as const },
  }
}

const succeed = vi.fn(async () => ({ success: true as const }))

describe("dispatcher store-result guards", () => {
  it("rejects a store missing transition methods at config time", async () => {
    const store = makeStore()
    delete (store as unknown as Record<string, unknown>).markFailed
    await expect(
      dispatchDueJobs(baseConfig(store, succeed))
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects a non-array claimDue result", async () => {
    const store = makeStore({ claimDue: vi.fn(async () => null as never) })
    await expect(
      dispatchDueJobs(baseConfig(store, succeed))
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("dead-letters a malformed claim without executing it", async () => {
    const execute = vi.fn(succeed)
    const markFailed = vi.fn(async () => ({ applied: true as const }))
    const store = makeStore({
      claimDue: vi.fn(async () => [makeJob({ payload: 42 as never })]),
      markFailed,
    })
    const result = await dispatchDueJobs(baseConfig(store, execute))
    expect(execute).not.toHaveBeenCalled()
    expect(result.deadLettered).toBe(1)
    expect(markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dead_letter" })
    )
  })

  it("treats a non-true lease renewal as lease loss", async () => {
    const execute = vi.fn(succeed)
    const store = makeStore({ renewLease: vi.fn(async () => "yes" as never) })
    const result = await dispatchDueJobs(baseConfig(store, execute))
    expect(execute).not.toHaveBeenCalled()
    expect(result.leaseLost).toBe(1)
  })

  it("treats a malformed markSucceeded result as lease loss", async () => {
    const store = makeStore({
      markSucceeded: vi.fn(async () => ({ applied: "yes" }) as never),
    })
    const result = await dispatchDueJobs(baseConfig(store, succeed))
    expect(result.leaseLost).toBe(1)
    expect(result.succeeded).toBe(0)
  })

  it("treats a malformed markRetrying result as lease loss", async () => {
    const store = makeStore({
      markRetrying: vi.fn(async () => null as never),
    })
    const result = await dispatchDueJobs(
      baseConfig(store, async () => {
        throw new RetryableJobError("boom")
      })
    )
    expect(result.leaseLost).toBe(1)
    expect(result.retried).toBe(0)
  })
})
