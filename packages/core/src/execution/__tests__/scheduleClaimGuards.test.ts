import { describe, expect, it, vi } from "vitest"
import { materializeDueSchedules } from "../scheduleDispatcher"
import type { JobStore } from "../types"
import type { FencedScheduleClaim, ScheduleStore } from "../scheduleStore"

function makeClaim(
  overrides: Partial<FencedScheduleClaim> = {}
): FencedScheduleClaim {
  return {
    scheduleId: "schedule-1",
    scope: "platform",
    jobType: "test.job",
    jobVersion: 1,
    tenantId: null,
    payload: '{"source":"schedule"}',
    cronExpression: "0 * * * *",
    timezone: "UTC",
    overlapPolicy: { type: "allow" },
    misfirePolicy: { type: "fire_now" },
    nextRunAt: new Date("2026-08-01T10:00:00Z"),
    lastRunAt: null,
    lastStatus: null,
    claimToken: "claim-1",
    ...overrides,
  }
}

function makeStores(claim: FencedScheduleClaim) {
  const claimDueSchedules = vi.fn(async () => [claim])
  const advanceSchedule = vi.fn(async () => true)
  const enqueue = vi.fn(async () => ({}) as never)
  const scheduleStore: ScheduleStore = {
    claimDueSchedules,
    advanceSchedule,
    releaseSchedule: vi.fn(async () => true),
    renewScheduleLease: vi.fn(async () => true),
  }
  const jobStore = {
    enqueue,
    getByIdempotencyKey: vi.fn(async () => null),
    getLatestPriorScheduleExecution: vi.fn(async () => null),
  } as unknown as JobStore
  return { scheduleStore, jobStore, advanceSchedule, enqueue }
}

async function materialize(claim: FencedScheduleClaim) {
  const { scheduleStore, jobStore, enqueue } = makeStores(claim)
  const result = await materializeDueSchedules({
    scheduleStore,
    jobStore,
    workerId: "worker-1",
    now: new Date("2026-08-01T10:30:00Z"),
  })
  return { result, enqueue }
}

describe("schedule dispatcher claim guards", () => {
  it("records an error without enqueueing when the claim token is missing", async () => {
    const { result, enqueue } = await materialize(
      makeClaim({ claimToken: "" })
    )
    expect(result.schedulesProcessed).toBe(0)
    expect(result.jobsEnqueued).toBe(0)
    expect(enqueue).not.toHaveBeenCalled()
    expect(result.errors).toHaveLength(1)
  })

  it("records an error without enqueueing when nextRunAt is malformed", async () => {
    const { result, enqueue } = await materialize(
      makeClaim({ nextRunAt: "tomorrow" as never })
    )
    expect(result.schedulesProcessed).toBe(0)
    expect(enqueue).not.toHaveBeenCalled()
    expect(result.errors).toHaveLength(1)
  })

  it("records an error when a prior execution has an unknown status", async () => {
    const { scheduleStore, jobStore } = makeStores(makeClaim())
    jobStore.getLatestPriorScheduleExecution = vi.fn(async () => ({
      id: "job-0",
      jobType: "test.job",
      jobVersion: 1,
      tenantId: null,
      scope: "platform",
      payload: "{}",
      status: "exploded",
      attemptsCompleted: 1,
      currentAttempt: 1,
    })) as never
    const result = await materializeDueSchedules({
      scheduleStore,
      jobStore,
      workerId: "worker-1",
      now: new Date("2026-08-01T10:30:00Z"),
    })
    expect(result.schedulesProcessed).toBe(0)
    expect(result.errors).toHaveLength(1)
  })
})
