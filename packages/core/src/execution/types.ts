import {
  TenantScopeViolationError,
  ValidationError,
} from "../foundation/errors"

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "retrying"
  | "failed"
  | "dead_letter"
  | "cancelled"

export type PriorScheduleExecutionStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled"

export type JobScope = "tenant" | "platform" | "system"

export interface Lease {
  owner: string
  /** Opaque value that fences stale workers from mutating this lease. */
  claimToken: string
  acquiredAt: Date
  expiresAt: Date
  durationMs: number
}

export interface NewJob {
  /** Execution scope is mandatory at enqueue time. */
  scope: JobScope
  jobType: string
  jobVersion: number
  tenantId?: string
  payload: Record<string, unknown>
  runAt?: Date
  maxAttempts?: number
  idempotencyKey?: string
  correlationId?: string
  priority?: number
  metadata?: Record<string, unknown>
  /**
   * Serializes execution: at most one job per partition may run at a time.
   * Set to a schedule identity so queued schedule occurrences never overlap.
   */
  partitionKey?: string
}

export interface StoredJob {
  id: string
  jobType: string
  jobVersion: number
  tenantId: string | null
  /** Persisted scope; unlike tenantId, this distinguishes platform from system. */
  scope: JobScope
  payload: string
  status: JobStatus
  priority: number
  attemptsCompleted: number
  currentAttempt: number
  maxAttempts?: number
  runAt: Date
  nextAttemptAt: Date | null
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  claimToken: string | null
  idempotencyKey: string | null
  fingerprint: string | null
  correlationId: string | null
  lastError: string | null
  resultPayload: string | null
  metadata: Record<string, unknown> | null
  /** Serialization partition; at most one job per non-null partition runs at a time. */
  partitionKey: string | null
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

const JOB_SCOPES: readonly string[] = ["tenant", "platform", "system"]

/**
 * Fail-closed shape check for a store-returned job. A job store that resolves
 * malformed rows (wrong types, missing identity, non-string payload) must
 * surface a contract error so the dispatcher dead-letters the claim instead
 * of executing garbage or corrupting retry arithmetic.
 */
export function assertStoredJobShape(job: unknown): asserts job is StoredJob {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new ValidationError("Stored job must be an object.")
  }
  const candidate = job as Partial<StoredJob>
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    throw new ValidationError("Stored job id must be a non-empty string.")
  }
  if (
    typeof candidate.jobType !== "string" ||
    candidate.jobType.trim() === ""
  ) {
    throw new ValidationError("Stored job jobType must be a non-empty string.")
  }
  if (!Number.isSafeInteger(candidate.jobVersion) || candidate.jobVersion! < 1) {
    throw new ValidationError("Stored job jobVersion must be a positive integer.")
  }
  if (
    typeof candidate.scope !== "string" ||
    !JOB_SCOPES.includes(candidate.scope)
  ) {
    throw new ValidationError("Stored job scope must be a valid job scope.")
  }
  if (
    candidate.tenantId !== null &&
    candidate.tenantId !== undefined &&
    typeof candidate.tenantId !== "string"
  ) {
    throw new ValidationError("Stored job tenantId must be a string or null.")
  }
  if (typeof candidate.payload !== "string") {
    throw new ValidationError("Stored job payload must be a string.")
  }
  if (
    !Number.isSafeInteger(candidate.attemptsCompleted) ||
    candidate.attemptsCompleted! < 0 ||
    !Number.isSafeInteger(candidate.currentAttempt) ||
    candidate.currentAttempt! < 0
  ) {
    throw new ValidationError(
      "Stored job attempt counters must be non-negative safe integers."
    )
  }
  if (
    candidate.maxAttempts !== undefined &&
    (!Number.isSafeInteger(candidate.maxAttempts) || candidate.maxAttempts < 1)
  ) {
    throw new ValidationError(
      "Stored job maxAttempts must be a positive integer when provided."
    )
  }
  if (
    candidate.claimToken !== null &&
    candidate.claimToken !== undefined &&
    typeof candidate.claimToken !== "string"
  ) {
    throw new ValidationError("Stored job claimToken must be a string or null.")
  }
  if (
    candidate.correlationId !== null &&
    candidate.correlationId !== undefined &&
    typeof candidate.correlationId !== "string"
  ) {
    throw new ValidationError(
      "Stored job correlationId must be a string or null."
    )
  }
  if (
    candidate.metadata !== null &&
    candidate.metadata !== undefined &&
    (typeof candidate.metadata !== "object" || Array.isArray(candidate.metadata))
  ) {
    throw new ValidationError("Stored job metadata must be an object or null.")
  }
}

export type JobResult =
  | { success: true; data?: Record<string, unknown>; error?: never }
  | { success: false; data?: Record<string, unknown>; error?: JobError }

/**
 * Fail-closed shape check for a job `execute` resolution. An execute
 * implementation that resolves garbage (null, an array, or an object without
 * a boolean `success`) is a deterministic job bug — the dispatcher must
 * dead-letter it instead of reading `.success` off malformed data or
 * treating it as retryable.
 */
export function assertJobResult(result: unknown): asserts result is JobResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ValidationError("Job result must be a non-array object.")
  }
  if (typeof (result as Partial<JobResult>).success !== "boolean") {
    throw new ValidationError("Job result success must be a boolean.")
  }
}

export type JobFailureKind = "retryable" | "permanent" | "cancelled"
export type JobError = Error & { readonly kind?: JobFailureKind }

export interface RetryPolicy {
  maxAttempts: number
  delayMs: number
  backoffMultiplier: number
  maxDelayMs?: number
}

export class RetryableJobError extends Error {
  readonly kind = "retryable" as const
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "RetryableJobError"
  }
}

export class PermanentJobError extends Error {
  readonly kind = "permanent" as const
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "PermanentJobError"
  }
}

export class JobScopeMismatchError extends PermanentJobError {
  readonly storedScope: StoredJobScope
  readonly definitionScope: JobScope

  constructor(storedScope: StoredJobScope, definitionScope: JobScope) {
    super(
      `Job scope mismatch: stored job is ${storedScope}, definition requires ${definitionScope}`
    )
    this.name = "JobScopeMismatchError"
    this.storedScope = storedScope
    this.definitionScope = definitionScope
  }
}

export class CancelledJobError extends Error {
  readonly kind = "cancelled" as const
  constructor(message = "Job cancelled", options?: ErrorOptions) {
    super(message, options)
    this.name = "CancelledJobError"
  }
}

export class MalformedJobPayloadError extends PermanentJobError {
  constructor(message = "Job payload is malformed", options?: ErrorOptions) {
    super(message, options)
    this.name = "MalformedJobPayloadError"
  }
}

export class InvalidJobPayloadError extends PermanentJobError {
  constructor(
    message = "Job payload failed schema validation",
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "InvalidJobPayloadError"
  }
}

export interface ClaimDueJobsArgs {
  limit: number
  workerId: string
  leaseDurationMs: number
  requester: JobRequester
  now?: Date
}

export interface RenewLeaseArgs {
  jobId: string
  workerId: string
  claimToken: string
  /** Duration in milliseconds to extend the lease. The DB computes the absolute expiry. */
  extendByMs: number
}

export class CorruptJobMetadataError extends PermanentJobError {
  constructor(message = "Job metadata is malformed", options?: ErrorOptions) {
    super(message, options)
    this.name = "CorruptJobMetadataError"
  }
}

export interface CompleteJobArgs {
  jobId: string
  workerId: string
  claimToken: string
  attempt: number
  result?: Record<string, unknown>
}

const MAX_JOB_JSON_DEPTH = 50
const MAX_JOB_JSON_TOTAL_KEYS = 10_000
const MAX_JOB_JSON_STRING_BYTES = 65_536
const MAX_JOB_JSON_SERIALIZED_BYTES = 1024 * 1024

export const MAX_DURABLE_JOB_TYPE_BYTES = 100
export const MAX_DURABLE_IDEMPOTENCY_KEY_BYTES = 255
export const MAX_DURABLE_CORRELATION_ID_BYTES = 100
export const MAX_DURABLE_SCOPE_BYTES = 10
export const MAX_DURABLE_WORKER_ID_BYTES = 100
export const MAX_DURABLE_PARTITION_KEY_BYTES = 255

/**
 * Bounds a durable identifier that maps to a DB column/index. Bounds are
 * measured in UTF-8 bytes (via TextEncoder) so multi-byte characters cannot
 * exceed the underlying column capacity.
 */
export function assertDurableIdentifier(
  value: string,
  label: string,
  maxBytes: number
): void {
  if (typeof value !== "string")
    throw new ValidationError(`${label} must be a string`)
  const bytes = new TextEncoder().encode(value).byteLength
  if (bytes > maxBytes)
    throw new ValidationError(
      `${label} exceeds the maximum of ${maxBytes} bytes`
    )
}

/** Reject values that cannot be represented deterministically in durable JSON. */
export function assertDurableJob(
  job: NewJob,
  runAt: Date = job.runAt ?? new Date()
): void {
  if (!job.scope || !["tenant", "platform", "system"].includes(job.scope))
    throw new ValidationError(
      "Job scope is required and must be valid"
    )
  assertDurableIdentifier(job.scope, "Job scope", MAX_DURABLE_SCOPE_BYTES)
  if (typeof job.jobType !== "string" || job.jobType.trim().length === 0)
    throw new ValidationError("Job type must be non-empty")
  assertDurableIdentifier(
    job.jobType,
    "Job jobType",
    MAX_DURABLE_JOB_TYPE_BYTES
  )
  if (!Number.isSafeInteger(job.jobVersion) || job.jobVersion < 1)
    throw new ValidationError(
      "Job version must be a positive integer"
    )
  if (!(runAt instanceof Date) || !Number.isFinite(runAt.getTime()))
    throw new ValidationError("Job runAt must be a valid date")
  if (
    job.maxAttempts !== undefined &&
    (!Number.isSafeInteger(job.maxAttempts) || job.maxAttempts < 1)
  )
    throw new ValidationError(
      "Job maxAttempts must be a positive integer"
    )
  if (job.priority !== undefined && !Number.isSafeInteger(job.priority))
    throw new ValidationError("Job priority must be a safe integer")
  if (
    job.idempotencyKey !== undefined &&
    (typeof job.idempotencyKey !== "string" || job.idempotencyKey.length === 0)
  )
    throw new ValidationError("Job idempotencyKey must be non-empty")
  if (job.idempotencyKey !== undefined)
    assertDurableIdentifier(
      job.idempotencyKey,
      "Job idempotencyKey",
      MAX_DURABLE_IDEMPOTENCY_KEY_BYTES
    )
  if (
    job.correlationId !== undefined &&
    (typeof job.correlationId !== "string" || job.correlationId.length === 0)
  )
    throw new ValidationError("Job correlationId must be non-empty")
  if (job.correlationId !== undefined)
    assertDurableIdentifier(
      job.correlationId,
      "Job correlationId",
      MAX_DURABLE_CORRELATION_ID_BYTES
    )
  if (job.partitionKey !== undefined) {
    if (typeof job.partitionKey !== "string" || job.partitionKey.length === 0)
      throw new ValidationError(
        "Job partitionKey must be a non-empty string"
      )
    assertDurableIdentifier(
      job.partitionKey,
      "Job partitionKey",
      MAX_DURABLE_PARTITION_KEY_BYTES
    )
  }
  const budget = { totalKeys: 0, totalBytes: 0 }
  assertJsonObject(job.payload, "Job payload", budget)
  if (job.metadata !== undefined)
    assertJsonObject(job.metadata, "Job metadata", budget)
}

interface JsonObjectBudget {
  totalKeys: number
  totalBytes: number
}

function assertJsonObject(
  value: unknown,
  label: string,
  budget: JsonObjectBudget
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError(`${label} must be a JSON object`)
  const visited = new WeakSet<object>()
  const visit = (entry: unknown, depth: number): void => {
    if (depth > MAX_JOB_JSON_DEPTH)
      throw new ValidationError(
        `${label} exceeds the maximum nesting depth of ${MAX_JOB_JSON_DEPTH}`
      )
    if (
      entry === undefined ||
      typeof entry === "bigint" ||
      typeof entry === "function" ||
      typeof entry === "symbol" ||
      (typeof entry === "number" && !Number.isFinite(entry))
    )
      throw new ValidationError(
        `${label} contains a non-durable value`
      )
    if (entry === null) return
    if (typeof entry === "string") {
      const bytes = new TextEncoder().encode(entry).byteLength
      if (bytes > MAX_JOB_JSON_STRING_BYTES)
        throw new ValidationError(
          `${label} contains a string longer than ${MAX_JOB_JSON_STRING_BYTES} bytes`
        )
      return
    }
    if (typeof entry === "number" || typeof entry === "boolean") return
    if (Array.isArray(entry)) {
      if (visited.has(entry))
        throw new ValidationError(
          `${label} contains a circular reference`
        )
      visited.add(entry)
      for (const item of entry) visit(item, depth + 1)
      visited.delete(entry)
      return
    }
    if (entry instanceof Date)
      throw new ValidationError(
        `${label} contains a Date; only plain JSON values are allowed`
      )
    const prototype = Object.getPrototypeOf(entry) as object | null
    if (prototype !== Object.prototype && prototype !== null)
      throw new ValidationError(
        `${label} contains a Map, Set, class instance, or non-plain object`
      )
    if (visited.has(entry))
      throw new ValidationError(
        `${label} contains a circular reference`
      )
    visited.add(entry)
    const record = entry as Record<string, unknown>
    const keys = Object.keys(record)
    budget.totalKeys += keys.length
    if (budget.totalKeys > MAX_JOB_JSON_TOTAL_KEYS)
      throw new ValidationError(
        `${label} exceeds the maximum of ${MAX_JOB_JSON_TOTAL_KEYS} total keys`
      )
    for (const key of keys) {
      const keyBytes = new TextEncoder().encode(key).byteLength
      if (keyBytes > MAX_JOB_JSON_STRING_BYTES)
        throw new ValidationError(
          `${label} contains a key longer than ${MAX_JOB_JSON_STRING_BYTES} bytes`
        )
      visit(record[key], depth + 1)
    }
    visited.delete(entry)
  }
  visit(value, 0)
  const serialized = JSON.stringify(value)
  if (serialized !== undefined)
    budget.totalBytes += new TextEncoder().encode(serialized).byteLength
  if (budget.totalBytes > MAX_JOB_JSON_SERIALIZED_BYTES)
    throw new ValidationError(
      `${label} exceeds the maximum of ${MAX_JOB_JSON_SERIALIZED_BYTES} serialized bytes for payload and metadata`
    )
}

export interface JobTransitionResult {
  applied: boolean
  reason?: "LEASE_LOST" | "INVALID_STATE" | "HISTORY_FAILED"
  /** Present when the transition was applied and can be used by post-transition hooks. */
  transitionToken?: string
  /** Set when required execution history could not be persisted. */
  historyError?: string
}

const JOB_TRANSITION_REASONS: readonly string[] = [
  "LEASE_LOST",
  "INVALID_STATE",
  "HISTORY_FAILED",
]

/**
 * Fail-closed shape check for a store-returned job transition. Callers treat
 * a malformed transition as lease loss (never double-execute); the explicit
 * check keeps a truthy-garbage `applied` from faking success.
 */
export function assertJobTransitionResult(
  result: unknown,
  operation: string
): asserts result is JobTransitionResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ValidationError(
      `Job store ${operation} must resolve a transition result object.`
    )
  }
  const candidate = result as Partial<JobTransitionResult>
  if (typeof candidate.applied !== "boolean") {
    throw new ValidationError(
      `Job store ${operation} must resolve a boolean applied flag.`
    )
  }
  if (
    candidate.reason !== undefined &&
    (typeof candidate.reason !== "string" ||
      !JOB_TRANSITION_REASONS.includes(candidate.reason))
  ) {
    throw new ValidationError(
      `Job store ${operation} returned an unknown transition reason.`
    )
  }
  for (const key of ["transitionToken", "historyError"] as const) {
    const value = candidate[key]
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length === 0)
    ) {
      throw new ValidationError(
        `Job store ${operation} returned a malformed ${key}.`
      )
    }
  }
}

export type ScheduleScope = "tenant" | "platform" | "system"

export interface LocalDateTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  dayOfWeek: number
}

export type CronDisambiguation = "skip" | "earlier" | "later" | "reject"

export interface CronTimezoneAdapter {
  toLocalDateTimeParts(utcDate: Date, timezone: string): LocalDateTime
  localToUtc(
    local: LocalDateTime,
    timezone: string,
    disambiguation?: CronDisambiguation
  ): Date
}

export interface RetryJobArgs {
  jobId: string
  workerId: string
  claimToken: string
  nextAttemptAt: Date
  error: string
  attempt: number
}

export interface FailJobArgs {
  jobId: string
  workerId: string
  claimToken: string
  error: string
  status: "failed" | "dead_letter" | "cancelled"
  attempt: number
}

export interface OverlapPolicy {
  type: "allow" | "skip" | "queue"
}

export interface MisfirePolicy {
  type: "skip" | "fire_now" | "queue_all"
}

export interface ScheduleDefinition {
  id: string
  name: string
  jobType: string
  jobVersion: number
  tenantId: string | null
  payload: string
  cronExpression: string
  timezone: string
  enabled: boolean
  overlapPolicy: OverlapPolicy
  misfirePolicy: MisfirePolicy
  nextRunAt: Date | null
  lastRunAt: Date | null
  lastStatus: string | null
  createdAt: Date
  updatedAt: Date
}

export type JobRequester =
  | { scope: "system" }
  | {
      scope: "platform"
      actorId: string
      capabilities?: readonly JobEnqueueCapability[]
    }
  | { scope: "tenant"; tenantId: string; actorId: string }

export type JobEnqueueCapability = "enqueue:platform" | "enqueue:system"

/** Jobs persist tenant identity rather than a separate platform/system marker. */
export type StoredJobScope = JobScope

export function getStoredJobScope(
  tenantId: string | null,
  scope: JobScope
): StoredJobScope {
  if (!scope)
    throw new TenantScopeViolationError("Persisted job scope is required", {
      tenantId,
    })
  return scope
}

export function assertJobScopeMatches(
  tenantId: string | null,
  definitionScope: JobScope,
  storedScope: JobScope
): void {
  const actualScope = getStoredJobScope(tenantId, storedScope)
  if (actualScope !== definitionScope) {
    throw new JobScopeMismatchError(actualScope, definitionScope)
  }
}

export interface GetJobByIdArgs {
  id: string
  requester: JobRequester
}

export interface GetByCorrelationIdArgs {
  correlationId: string
  requester: JobRequester
}

export interface GetLatestPriorScheduleExecutionArgs {
  scheduleId: string
  beforeOccurrence: Date
  requester: JobRequester
}

/** Stable correlation id used by every occurrence of a schedule. */
export function scheduleCorrelationId(scheduleId: string): string {
  return `sched:${scheduleId}`
}

export interface GetByIdempotencyKeyArgs {
  key: string
  requester: JobRequester
}

export interface CancelJobArgs {
  jobId: string
  requester: JobRequester
  reason?: string
}

export interface FindPendingArgs {
  requester: JobRequester
  jobType?: string
  limit?: number
}

export interface EnqueueJobArgs {
  requester: JobRequester
  job: NewJob
}

export function assertJobRequesterCanEnqueue(
  requester: JobRequester,
  jobTenantId: string | null | undefined
): void {
  if (
    requester.scope === "tenant" &&
    requester.tenantId !== (jobTenantId ?? null)
  ) {
    throw new TenantScopeViolationError(
      "Tenant requester may only enqueue jobs for its tenant",
      {
        requesterTenantId: requester.tenantId,
        jobTenantId: jobTenantId ?? null,
      }
    )
  }
}

export interface JobStore {
  /**
   * When idempotencyKey is supplied, enqueue must atomically return the
   * existing job for the same scope and key instead of creating a duplicate.
   */
  enqueue(args: EnqueueJobArgs): Promise<StoredJob>
  getById(args: GetJobByIdArgs): Promise<StoredJob | null>
  getByCorrelationId(args: GetByCorrelationIdArgs): Promise<StoredJob[]>
  /**
   * Returns the single most recent job of the schedule correlation that ran
   * strictly before the given occurrence. This is a dedicated primitive so
   * overlap decisions never depend on a bounded top-N correlation list.
   */
  getLatestPriorScheduleExecution(
    args: GetLatestPriorScheduleExecutionArgs
  ): Promise<StoredJob | null>
  getByIdempotencyKey(args: GetByIdempotencyKeyArgs): Promise<StoredJob | null>
  /** Every returned running job must carry a fresh, opaque claimToken. */
  claimDue(args: ClaimDueJobsArgs): Promise<StoredJob[]>
  renewLease(args: RenewLeaseArgs): Promise<boolean>
  markSucceeded(args: CompleteJobArgs): Promise<JobTransitionResult>
  markRetrying(args: RetryJobArgs): Promise<JobTransitionResult>
  markFailed(args: FailJobArgs): Promise<JobTransitionResult>
  cancel(args: CancelJobArgs): Promise<JobTransitionResult>
  findPending(args: FindPendingArgs): Promise<StoredJob[]>
}

export class JobIdempotencyConflictError extends Error {
  readonly code = "JOB_IDEMPOTENCY_CONFLICT" as const
  constructor(
    public readonly scope: string,
    public readonly key: string
  ) {
    super(
      `Job idempotency key already exists with a different fingerprint: ${scope}/${key}`
    )
    this.name = "JobIdempotencyConflictError"
  }
}

export function assertJobScopeCanEnqueue(
  scope: JobScope,
  jobTenantId: string | null | undefined
): void {
  const hasTenant = jobTenantId !== null && jobTenantId !== undefined
  if ((scope === "tenant") !== hasTenant) {
    throw new TenantScopeViolationError(
      "Tenant jobs require a tenant id and platform/system jobs must not have one",
      {
        scope,
        jobTenantId: jobTenantId ?? null,
      }
    )
  }
}

export function requesterJobScope(requester: JobRequester): JobScope {
  return requester.scope
}

export interface ExecutionLogger {
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
  debug(msg: string, data?: Record<string, unknown>): void
}

export interface ExecutionClock {
  now(): Date
  sleep(ms: number): Promise<void>
  setTimeout?(callback: () => void, ms: number): unknown
  clearTimeout?(handle: unknown): void
}

/**
 * Framework-owned external effect API. External calls that produce durable
 * side effects must go through this interface, which enforces the current
 * claim token/fence and an idempotency key. This makes the safe
 * path unavoidable rather than documentation-only.
 */
export interface FencedExternalEffect {
  /** Executes an external effect under the current claim token fence. */
  execute<T>(args: {
    effectName: string
    idempotencyKey: string
    fn: () => Promise<T>
  }): Promise<T>
}

export interface JobExecutionContext {
  executionId: string
  jobId: string
  jobType: string
  jobVersion: number
  attempt: number
  tenantId: string | null
  correlationId: string
  startedAt: Date
  deadline?: number
  signal?: AbortSignal
  logger: ExecutionLogger
  metadata: Record<string, unknown>
  clock?: ExecutionClock
  /** Framework-owned fence for external effects that produce durable side effects. */
  fencedEffect: FencedExternalEffect
  /** Token for an already-applied transition; this is not a running lease. */
  transitionToken?: string
}

/** Explicit requester-to-target matrix. Platform callers cannot create system work by default. */
export function assertRequesterCanEnqueueScope(
  requester: JobRequester,
  targetScope: JobScope,
  jobTenantId: string | null | undefined
): void {
  assertJobRequesterCanEnqueue(requester, jobTenantId)
  const allowed =
    requester.scope === "system"
      ? true
      : requester.scope === "tenant"
        ? targetScope === "tenant"
        : targetScope === "platform" ||
          requester.capabilities?.includes("enqueue:system") === true
  if (!allowed) {
    throw new TenantScopeViolationError(
      `Requester scope ${requester.scope} cannot enqueue ${targetScope} jobs`,
      {
        requesterScope: requester.scope,
        targetScope,
        capability: "enqueue:system",
      }
    )
  }
  if (requester.scope === "tenant" && targetScope !== "tenant") {
    throw new TenantScopeViolationError(
      "Tenant requester may only enqueue tenant jobs",
      { targetScope }
    )
  }
}

export interface JobDefinition<TPayload = Record<string, unknown>> {
  type: string
  version: number
  scope: JobScope
  maxAttempts: number
  retryDelayMs: number
  retryBackoffMultiplier: number
  timeoutMs?: number
  decodePayload(input: unknown): TPayload
  execute(args: JobExecution<TPayload>): Promise<JobResult>
  onRetry?(args: JobExecution<TPayload>, error: Error): Promise<void>
  onMaxRetriesExceeded?(
    args: JobExecution<TPayload>,
    error: Error
  ): Promise<void>
}

export type JobExecution<TPayload = Record<string, unknown>> =
  JobExecutionContext & {
    payload: TPayload
  }

export interface ScheduleOccurrence {
  scheduleId: string
  jobType: string
  jobVersion: number
  tenantId: string | null
  payload: string
  correlationId: string
  scheduledAt: Date
}

export interface ScheduleClaim {
  scheduleId: string
  scope: ScheduleScope
  jobType: string
  jobVersion: number
  tenantId: string | null
  payload: string
  cronExpression: string
  timezone: string
  overlapPolicy: OverlapPolicy
  misfirePolicy: MisfirePolicy
  nextRunAt: Date
  lastRunAt: Date | null
  lastStatus: string | null
}

export interface ClaimDueSchedulesArgs {
  workerId: string
  limit: number
  now?: Date
  leaseDurationMs: number
}

export interface AdvanceScheduleArgs {
  scheduleId: string
  workerId: string
  nextRunAt: Date | null
  lastRunAt: Date
  lastStatus: string
  lastError?: string
}

export interface ReleaseScheduleArgs {
  scheduleId: string
  workerId: string
}

export function requesterTenantId(requester: JobRequester): string | null {
  if (requester.scope === "tenant") return requester.tenantId
  return null
}

export function isSystemOrPlatform(requester: JobRequester): boolean {
  return requester.scope === "system" || requester.scope === "platform"
}

export function requesterToActorId(requester: JobRequester): string {
  switch (requester.scope) {
    case "system":
      return "system"
    case "platform":
      return requester.actorId
    case "tenant":
      return requester.actorId
  }
}
