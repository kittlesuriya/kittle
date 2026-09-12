import { describe, expect, it, vi } from "vitest"
import { dispatchDueJobs } from "../dispatcher"
import { createJobRegistry } from "../jobRegistry"
import { createExecutionContext } from "../executionContext"
import { materializeDueSchedules } from "../scheduleDispatcher"
import type { JobStore, StoredJob } from "../types"
import type { FencedScheduleClaim, ScheduleStore } from "../scheduleStore"
import { assertFencedScheduleClaim } from "../scheduleStore"

function makeStoredJob(overrides: Partial<StoredJob> = {}): StoredJob {
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
    leaseExpiresAt: new Date(Date.now() + 10_000),
    claimToken: "claim-1",
    idempotencyKey: null,
    fingerprint: "fp",
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

describe("P1-08 fencing + P2-04 observability", () => {
  it("assertFencedScheduleClaim validates token presence", () => {
    expect(() => assertFencedScheduleClaim("tok", "sched-1")).not.toThrow()
    expect(() => assertFencedScheduleClaim(null, "sched-1")).toThrow(
      "no claim token"
    )
    expect(() => assertFencedScheduleClaim("", "sched-1")).toThrow(
      "no claim token"
    )
    expect(() => assertFencedScheduleClaim("   ", "sched-1")).toThrow(
      "no claim token"
    )
  })

  it("dispatcher logs claimed count and batch completion", async () => {
    const job = makeStoredJob()
    const store: JobStore = {
      enqueue: vi.fn(),
      getById: vi.fn(),
      getByCorrelationId: vi.fn(),
      getLatestPriorScheduleExecution: vi.fn(),
      getByIdempotencyKey: vi.fn(),
      claimDue: vi.fn(async () => [job]),
      renewLease: vi.fn(async () => true),
      markSucceeded: vi.fn(async () => ({ applied: true })),
      markRetrying: vi.fn(),
      markFailed: vi.fn(),
      cancel: vi.fn(),
      findPending: vi.fn(),
    }
    const registry = createJobRegistry()
    registry.register({
      type: "test",
      version: 1,
      scope: "system",
      maxAttempts: 3,
      retryDelayMs: 0,
      retryBackoffMultiplier: 1,
      decodePayload: (i) => i as Record<string, unknown>,
      execute: async () => ({ success: true }),
    })
    const info = vi.fn()
    const debug = vi.fn()
    const logger = { info, error: vi.fn(), warn: vi.fn(), debug }
    const result = await dispatchDueJobs({
      store,
      registry,
      workerId: "worker-1",
      leaseDurationMs: 100,
      claimLimit: 1,
      requester: { scope: "system" },
      logger,
    })
    expect(result.succeeded).toBe(1)
    expect(info).toHaveBeenCalledWith(
      "Dispatch claimed jobs",
      expect.objectContaining({ claimed: 1, workerId: "worker-1" })
    )
    expect(info).toHaveBeenCalledWith(
      "Dispatch batch completed",
      expect.objectContaining({ claimed: 1, succeeded: 1 })
    )
  })

  it("dispatcher warns when claimed job has no claim token (fencing)", async () => {
    const job = makeStoredJob({ claimToken: null })
    const store: JobStore = {
      enqueue: vi.fn(),
      getById: vi.fn(),
      getByCorrelationId: vi.fn(),
      getLatestPriorScheduleExecution: vi.fn(),
      getByIdempotencyKey: vi.fn(),
      claimDue: vi.fn(async () => [job]),
      renewLease: vi.fn(async () => true),
      markSucceeded: vi.fn(),
      markRetrying: vi.fn(),
      markFailed: vi.fn(),
      cancel: vi.fn(),
      findPending: vi.fn(),
    }
    const registry = createJobRegistry()
    registry.register({
      type: "test",
      version: 1,
      scope: "system",
      maxAttempts: 3,
      retryDelayMs: 0,
      retryBackoffMultiplier: 1,
      decodePayload: (i) => i as Record<string, unknown>,
      execute: vi.fn(async () => ({ success: true })),
    })
    const warn = vi.fn()
    const result = await dispatchDueJobs({
      store,
      registry,
      workerId: "worker-1",
      leaseDurationMs: 100,
      claimLimit: 1,
      requester: { scope: "system" },
      logger: { info: vi.fn(), error: vi.fn(), warn, debug: vi.fn() },
    })
    expect(result.leaseLost).toBe(1)
    expect(warn).toHaveBeenCalledWith(
      "Claimed job missing claim token",
      expect.objectContaining({ jobId: "job-1" })
    )
  })

  it("dispatcher warns on re-fence rejection (heartbeat leaseLost)", async () => {
    const job = makeStoredJob()
    const store: JobStore = {
      enqueue: vi.fn(),
      getById: vi.fn(),
      getByCorrelationId: vi.fn(),
      getLatestPriorScheduleExecution: vi.fn(),
      getByIdempotencyKey: vi.fn(),
      claimDue: vi.fn(async () => [job]),
      renewLease: vi.fn(async () => false),
      markSucceeded: vi.fn(),
      markRetrying: vi.fn(),
      markFailed: vi.fn(),
      cancel: vi.fn(),
      findPending: vi.fn(),
    }
    const registry = createJobRegistry()
    registry.register({
      type: "test",
      version: 1,
      scope: "system",
      maxAttempts: 3,
      retryDelayMs: 0,
      retryBackoffMultiplier: 1,
      decodePayload: (i) => i as Record<string, unknown>,
      execute: vi.fn(async () => ({ success: true })),
    })
    const warn = vi.fn()
    const result = await dispatchDueJobs({
      store,
      registry,
      workerId: "worker-1",
      leaseDurationMs: 100,
      claimLimit: 1,
      requester: { scope: "system" },
      logger: { info: vi.fn(), error: vi.fn(), warn, debug: vi.fn() },
    })
    expect(result.leaseLost).toBe(1)
    expect(warn).toHaveBeenCalledWith(
      "Job lease re-fence rejected",
      expect.objectContaining({ jobId: "job-1" })
    )
  })

  it("scheduleDispatcher double-fences enqueue and logs occurrence enqueue", async () => {
    const claim: FencedScheduleClaim = {
      scheduleId: "sched-1",
      scope: "platform",
      jobType: "test.job",
      jobVersion: 1,
      tenantId: null,
      payload: "{}",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      overlapPolicy: { type: "allow" },
      misfirePolicy: { type: "fire_now" },
      nextRunAt: new Date("2026-08-01T10:00:00Z"),
      lastRunAt: null,
      lastStatus: null,
      claimToken: "claim-1",
    }
    const renewScheduleLease = vi.fn(async () => true)
    const advanceSchedule = vi.fn(async () => true)
    const enqueue = vi.fn(async () => ({ id: "job-1" }))
    const scheduleStore: ScheduleStore = {
      claimDueSchedules: vi.fn(async () => [claim]),
      advanceSchedule,
      releaseSchedule: vi.fn(async () => true),
      renewScheduleLease,
    }
    const jobStore = {
      enqueue,
      getById: vi.fn(),
      getByCorrelationId: vi.fn(),
      getLatestPriorScheduleExecution: vi.fn(async () => null),
      getByIdempotencyKey: vi.fn(async () => null),
      claimDue: vi.fn(),
      renewLease: vi.fn(),
      markSucceeded: vi.fn(),
      markRetrying: vi.fn(),
      markFailed: vi.fn(),
      cancel: vi.fn(),
      findPending: vi.fn(),
    } as unknown as JobStore
    const info = vi.fn()
    const error = vi.fn()
    const now = new Date("2026-08-01T10:30:00Z")
    const result = await materializeDueSchedules({
      scheduleStore,
      jobStore,
      workerId: "worker-1",
      now,
      logger: { info, error },
    })
    expect(result.jobsEnqueued).toBe(1)
    // assertHeld called at least: before getByIdempotencyKey, after, and before final advance => >=3
    expect(renewScheduleLease.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(info).toHaveBeenCalledWith(
      "Schedules claimed",
      expect.objectContaining({ claimed: 1 })
    )
    expect(info).toHaveBeenCalledWith(
      "Enqueueing schedule occurrence",
      expect.objectContaining({ scheduleId: "sched-1" })
    )
    expect(info).toHaveBeenCalledWith(
      "Schedule advanced",
      expect.objectContaining({ scheduleId: "sched-1" })
    )
  })

  it("scheduleDispatcher logs best-effort advance failure", async () => {
    const claim: FencedScheduleClaim = {
      scheduleId: "sched-2",
      scope: "platform",
      jobType: "test.job",
      jobVersion: 1,
      tenantId: null,
      payload: "not-json",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      overlapPolicy: { type: "allow" },
      misfirePolicy: { type: "fire_now" },
      nextRunAt: new Date("2026-08-01T10:00:00Z"),
      lastRunAt: null,
      lastStatus: null,
      claimToken: "claim-2",
    }
    const scheduleStore: ScheduleStore = {
      claimDueSchedules: vi.fn(async () => [claim]),
      advanceSchedule: vi.fn(async () => {
        throw new Error("best-effort failed")
      }),
      releaseSchedule: vi.fn(async () => true),
      renewScheduleLease: vi.fn(async () => true),
    }
    const jobStore = {
      enqueue: vi.fn(),
      getById: vi.fn(),
      getByCorrelationId: vi.fn(),
      getLatestPriorScheduleExecution: vi.fn(async () => null),
      getByIdempotencyKey: vi.fn(async () => null),
      claimDue: vi.fn(),
      renewLease: vi.fn(),
      markSucceeded: vi.fn(),
      markRetrying: vi.fn(),
      markFailed: vi.fn(),
      cancel: vi.fn(),
      findPending: vi.fn(),
    } as unknown as JobStore
    const error = vi.fn()
    const info = vi.fn()
    const result = await materializeDueSchedules({
      scheduleStore,
      jobStore,
      workerId: "worker-1",
      now: new Date("2026-08-01T10:30:00Z"),
      logger: { info, error },
    })
    expect(result.errors[0]).toContain("not valid JSON")
    expect(error).toHaveBeenCalledWith(
      "Failed to mark schedule failed after processing error",
      {
        scheduleId: "sched-2",
        workerId: "worker-1",
        claimToken: "claim-2",
        originalError: "Schedule payload is not valid JSON.",
        bestEffortError: "best-effort failed",
      }
    )
  })

  it("fencedEffect blocks on lease loss and logs", async () => {
    const assertLease = vi.fn(async () => {
      throw new Error("Job lease was lost")
    })
    const warn = vi.fn()
    const debug = vi.fn()
    const logger = { info: vi.fn(), warn, error: vi.fn(), debug }
    const ctx = createExecutionContext({
      jobId: "job-1",
      jobType: "test",
      jobVersion: 1,
      attempt: 1,
      tenantId: null,
      correlationId: "c",
      startedAt: new Date(),
      logger,
      assertLease,
    })
    const fn = vi.fn(async () => "ok")
    if (!ctx.fencedEffect) throw new Error("Expected fenced effect")
    await expect(
      ctx.fencedEffect.execute({
        effectName: "external-call",
        idempotencyKey: "k1",
        fn,
      })
    ).rejects.toThrow("Job lease was lost")
    expect(fn).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      "Fenced effect blocked by lease loss",
      expect.objectContaining({ effectName: "external-call" })
    )
  })

  it("fencedEffect logs success and failure of effect", async () => {
    const assertLease = vi.fn(async () => {})
    const debug = vi.fn()
    const error = vi.fn()
    const logger = { info: vi.fn(), warn: vi.fn(), error, debug }
    const ctx = createExecutionContext({
      jobId: "job-1",
      jobType: "test",
      jobVersion: 1,
      attempt: 1,
      tenantId: null,
      correlationId: "c",
      startedAt: new Date(),
      logger,
      assertLease,
    })
    await ctx.fencedEffect.execute({
      effectName: "ok-effect",
      idempotencyKey: "ok-1",
      fn: async () => "done",
    })
    expect(debug).toHaveBeenCalledWith(
      "Executing fenced effect",
      expect.objectContaining({ effectName: "ok-effect" })
    )
    expect(debug).toHaveBeenCalledWith(
      "Fenced effect succeeded",
      expect.objectContaining({ effectName: "ok-effect" })
    )
    await expect(
      ctx.fencedEffect.execute({
        effectName: "fail-effect",
        idempotencyKey: "fail-1",
        fn: async () => {
          throw new Error("boom")
        },
      })
    ).rejects.toThrow("boom")
    expect(error).toHaveBeenCalledWith(
      "Fenced effect failed",
      expect.objectContaining({ effectName: "fail-effect", error: "boom" })
    )
  })
})
