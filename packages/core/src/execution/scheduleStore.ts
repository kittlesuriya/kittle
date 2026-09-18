import type {
  ScheduleClaim,
  ClaimDueSchedulesArgs,
  AdvanceScheduleArgs,
  ReleaseScheduleArgs,
} from "./types"

/** An opaque value that changes for every successful schedule claim. */
export type ScheduleClaimToken = string

export type FencedScheduleClaim = ScheduleClaim & {
  /** Fresh opaque token returned by the store that owns the schedule lease. */
  claimToken: ScheduleClaimToken
}

export type RenewScheduleLeaseArgs = {
  scheduleId: string
  workerId: string
  claimToken: ScheduleClaimToken
  now: Date
  extendByMs: number
}

export type FencedAdvanceScheduleArgs = AdvanceScheduleArgs & {
  claimToken: ScheduleClaimToken
}

export type FencedReleaseScheduleArgs = ReleaseScheduleArgs & {
  claimToken: ScheduleClaimToken
}

export interface ScheduleStore {
  /** Atomically claims due schedules; each returned claim carries a fresh opaque claimToken fencing the lease. */
  claimDueSchedules(args: ClaimDueSchedulesArgs): Promise<FencedScheduleClaim[]>
  /** Advances the schedule only if the claimToken still fences the lease; returns false on lease loss. */
  advanceSchedule(args: FencedAdvanceScheduleArgs): Promise<boolean>
  /** Releases the lease without advancing; fenced by claimToken. */
  releaseSchedule(args: FencedReleaseScheduleArgs): Promise<boolean>
  /** Renews the lease for the given claimToken; returns false if lease was lost or token mismatched. */
  renewScheduleLease(args: RenewScheduleLeaseArgs): Promise<boolean>
}

/** Validates that a fenced claim token is present and durable (P1-08). */
export function assertFencedScheduleClaim(
  claimToken: string | null | undefined,
  scheduleId: string
): asserts claimToken is string {
  if (
    !claimToken ||
    typeof claimToken !== "string" ||
    claimToken.trim().length === 0
  ) {
    throw new Error(
      `Schedule ${scheduleId} has no claim token; lease was not fenced`
    )
  }
}

const SCHEDULE_SCOPES: readonly string[] = ["tenant", "platform", "system"]

function assertSchedulePolicy(
  policy: unknown,
  scheduleId: string,
  field: "overlapPolicy" | "misfirePolicy",
  allowed: readonly string[]
): void {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error(`Schedule ${scheduleId} has a malformed ${field}.`)
  }
  const type = (policy as { type?: unknown }).type
  if (typeof type !== "string" || !allowed.includes(type)) {
    throw new Error(`Schedule ${scheduleId} has an unknown ${field} type.`)
  }
}

/**
 * Fail-closed shape check for a store-returned schedule claim. A claim with a
 * missing token, non-Date run time, or unknown policies must fail loudly
 * instead of enqueueing work for the wrong identity or advancing past it.
 */
export function assertScheduleClaimShape(
  claim: unknown
): asserts claim is FencedScheduleClaim {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new Error("Schedule store must resolve claim objects.")
  }
  const candidate = claim as Partial<FencedScheduleClaim>
  if (
    typeof candidate.scheduleId !== "string" ||
    candidate.scheduleId.trim() === ""
  ) {
    throw new Error("Schedule claim must carry a non-empty scheduleId.")
  }
  assertFencedScheduleClaim(candidate.claimToken, candidate.scheduleId)
  if (
    typeof candidate.scope !== "string" ||
    !SCHEDULE_SCOPES.includes(candidate.scope)
  ) {
    throw new Error(`Schedule ${candidate.scheduleId} has an invalid scope.`)
  }
  if (
    typeof candidate.jobType !== "string" ||
    candidate.jobType.trim() === "" ||
    !Number.isSafeInteger(candidate.jobVersion) ||
    candidate.jobVersion! < 1
  ) {
    throw new Error(
      `Schedule ${candidate.scheduleId} has an invalid job identity.`
    )
  }
  if (
    candidate.tenantId !== null &&
    candidate.tenantId !== undefined &&
    typeof candidate.tenantId !== "string"
  ) {
    throw new Error(`Schedule ${candidate.scheduleId} has an invalid tenantId.`)
  }
  if (typeof candidate.payload !== "string") {
    throw new Error(`Schedule ${candidate.scheduleId} has a malformed payload.`)
  }
  if (
    typeof candidate.cronExpression !== "string" ||
    candidate.cronExpression.trim() === "" ||
    typeof candidate.timezone !== "string" ||
    candidate.timezone.trim() === ""
  ) {
    throw new Error(
      `Schedule ${candidate.scheduleId} has an invalid cron expression or timezone.`
    )
  }
  if (
    !(candidate.nextRunAt instanceof Date) ||
    Number.isNaN(candidate.nextRunAt.getTime())
  ) {
    throw new Error(`Schedule ${candidate.scheduleId} has an invalid nextRunAt.`)
  }
  if (
    candidate.lastRunAt !== null &&
    candidate.lastRunAt !== undefined &&
    (!(candidate.lastRunAt instanceof Date) ||
      Number.isNaN(candidate.lastRunAt.getTime()))
  ) {
    throw new Error(`Schedule ${candidate.scheduleId} has an invalid lastRunAt.`)
  }
  assertSchedulePolicy(candidate.overlapPolicy, candidate.scheduleId, "overlapPolicy", [
    "allow",
    "skip",
    "queue",
  ])
  assertSchedulePolicy(candidate.misfirePolicy, candidate.scheduleId, "misfirePolicy", [
    "skip",
    "fire_now",
    "queue_all",
  ])
}
