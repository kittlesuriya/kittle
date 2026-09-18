/** The identity of one mutation within an idempotency scope. */
export interface IdempotencyRequest {
  scope: string
  key: string
  fingerprint: string
  /** Reservation lifetime before a failed worker may be safely replaced. */
  leaseDurationMs?: number
}

/** A reservation that may complete the mutation it acquired. */
export interface IdempotencyAcquired {
  outcome: "acquired"
  token: string
}

/** The result of an earlier completed mutation with the same identity. */
export interface IdempotencyReplay<TResult> {
  outcome: "replay"
  result: TResult
}

/** Another mutation with the same identity is still being completed. */
export interface IdempotencyInProgress {
  outcome: "in-progress"
}

export interface IdempotencyLease extends IdempotencyRequest {
  token: string
}

/**
 * The mutation committed, but a safe replayable response has not been finalized
 * yet. Callers must never invent a response; they should either recover via a
 * route-provided committed-response resolver or retry until the row completes.
 */
export interface IdempotencyBusinessCommitted {
  outcome: "business-committed"
  token: string
  resource?: IdempotencyResourceIdentity
  invalidations?: readonly string[]
}

/** The key was already used for a different mutation fingerprint. */
export interface IdempotencyConflict {
  outcome: "conflict"
}

/** Stable mutation identity used by the durable commit receipt. */
export interface IdempotencyResourceIdentity {
  entity: string
  id: string
  /** Committed resource generation/version, when the resource exposes one. */
  version?: string | number
}

/**
 * Durable commit receipt persisted atomically with the business mutation. It
 * proves the mutation committed and carries only stable identity + durable
 * obligations. It NEVER carries a replayable business/HTTP response, because a
 * response must be produced by the authorized committed reread/projection path.
 */
export interface IdempotencyCommitItem {
  scope: string
  key: string
  fingerprint: string
  token: string
  /** Stable resource identity used to rebuild a safe response after a crash. */
  resource?: IdempotencyResourceIdentity
  /** Durable cache-invalidation obligations committed with the mutation. */
  invalidations?: readonly string[]
}

export type IdempotencyAcquireResult<TResult> =
  | IdempotencyAcquired
  | IdempotencyReplay<TResult>
  | IdempotencyInProgress
  | IdempotencyBusinessCommitted
  | IdempotencyConflict

export interface IdempotencyCompletion<TResult> extends IdempotencyRequest {
  token: string
  /** The final replayable result, written only by complete(). */
  result: TResult
  resource?: IdempotencyResourceIdentity
  invalidations?: readonly string[]
}

/** A committed reservation whose durable invalidation obligation is still pending. */
export interface PendingInvalidation {
  scope: string
  key: string
  fingerprint: string
  token: string
  invalidations: string[]
  /** The durable committed result descriptor, enough to reconstruct completion. */
  result: unknown
}

/** A claimed pending invalidation leased to a finalizer worker. */
export interface ClaimedPendingInvalidation extends PendingInvalidation {
  claimToken: string
  claimOwner: string
}

/**
 * Base idempotency boundary. `acquire` must atomically reserve a new request
 * identity; implementations must never replay a result for a different
 * fingerprint. The base port can only finalize AFTER a commit and must never be
 * used to authorize a mutation unless it is a durable port below.
 * Per P3 audit: keep this focused on acquire/renew/complete/recover only.
 * Scanning/claiming belongs exclusively to IdempotencyFinalizationPort.
 */
export interface IdempotencyPort<TResult = unknown> {
  acquire(
    request: IdempotencyRequest
  ): Promise<IdempotencyAcquireResult<TResult>>
  /** Extends the reservation only when the caller still owns it. */
  renew(lease: IdempotencyLease): Promise<void>
  /** Records the final replayable result after commit. */
  complete(completion: IdempotencyCompletion<TResult>): Promise<void>
  /** Conservatively prevents a committed mutation from being taken over when finalization failed. */
  recover(
    completion: Omit<IdempotencyCompletion<TResult>, "result">
  ): Promise<void>
}

/**
 * Dedicated finalization boundary for durable invalidation obligations.
 * Exclusively owns scanning and claiming; the base IdempotencyPort must not
 * duplicate these operations. Implementations that need finalizer behavior
 * should implement both ports (FinalizerPort = IdempotencyPort & IdempotencyFinalizationPort).
 */
export interface IdempotencyFinalizationPort<TResult = unknown> {
  /** Scan committed rows whose durable invalidation obligation is still pending (unclaimed path). */
  findCommittedWithPendingInvalidations(
    limit?: number
  ): Promise<PendingInvalidation[]>
  /** Lease a batch of pending invalidations to a specific finalizer worker. */
  claimPendingInvalidations(args: {
    limit?: number
    claimOwner: string
    leaseMs: number
    claimToken?: string
  }): Promise<ClaimedPendingInvalidation[]>
  /** Acknowledges pending invalidations for a committed row without requiring a full result. */
  ackInvalidations(request: {
    scope: string
    key: string
    fingerprint: string
    token: string
  }): Promise<void>
  /** Acknowledges a claimed invalidation obligation (lease-guarded). */
  ackClaimedInvalidation(request: {
    scope: string
    key: string
    fingerprint: string
    token: string
    claimToken: string
  }): Promise<void>
  /** Completes a claimed invalidation obligation with a replayable result (lease-guarded). */
  completeClaimedInvalidation(
    completion: IdempotencyCompletion<TResult> & { claimToken: string }
  ): Promise<void>
}

/** Intersection helper for stores that serve both mutation and finalization. */
export type FinalizerPort<TResult = unknown> = IdempotencyPort<TResult> &
  IdempotencyFinalizationPort<TResult>

/**
 * A port whose committed receipt joins the interactive business transaction.
 * The token-fenced marker aborts the transaction when ownership is lost, so a
 * mutation can never commit and then re-execute.
 */
export interface TransactionalIdempotencyPort<
  TResult = unknown,
> extends IdempotencyPort<TResult> {
  markCommittedInTransaction(
    completion: IdempotencyCommitItem,
    persistence: import("./persistence").PersistenceProvider
  ): Promise<void>
}

/**
 * A port whose committed receipt joins a non-transactional adapter's atomic
 * batch as an adapter-owned item. The item must include a database-enforced
 * ownership assertion that aborts the whole batch when the reservation token is
 * stale, and must never carry a replayable response.
 */
export interface AtomicBatchIdempotencyPort<
  TResult = unknown,
> extends IdempotencyPort<TResult> {
  createCommitBatchItem(
    completion: IdempotencyCommitItem
  ): import("./persistence").AtomicBatchItem<unknown>
}

export type DurableIdempotencyPort<TResult = unknown> =
  TransactionalIdempotencyPort<TResult> | AtomicBatchIdempotencyPort<TResult>

export function isTransactionalIdempotencyPort<TResult>(
  port: IdempotencyPort<TResult>
): port is TransactionalIdempotencyPort<TResult> {
  return (
    typeof (port as Partial<TransactionalIdempotencyPort<TResult>>)
      .markCommittedInTransaction === "function"
  )
}

export function isAtomicBatchIdempotencyPort<TResult>(
  port: IdempotencyPort<TResult>
): port is AtomicBatchIdempotencyPort<TResult> {
  return (
    typeof (port as Partial<AtomicBatchIdempotencyPort<TResult>>)
      .createCommitBatchItem === "function"
  )
}

export function isDurableIdempotencyPort<TResult>(
  port: IdempotencyPort<TResult>
): port is DurableIdempotencyPort<TResult> {
  return (
    isTransactionalIdempotencyPort(port) || isAtomicBatchIdempotencyPort(port)
  )
}

export function isIdempotencyFinalizationPort<TResult>(
  port: IdempotencyPort<TResult>
): port is FinalizerPort<TResult> {
  const p = port as Partial<IdempotencyFinalizationPort<TResult>>
  return (
    typeof p.findCommittedWithPendingInvalidations === "function" &&
    typeof p.claimPendingInvalidations === "function" &&
    typeof p.ackInvalidations === "function" &&
    typeof p.ackClaimedInvalidation === "function" &&
    typeof p.completeClaimedInvalidation === "function"
  )
}

const IDEMPOTENCY_OUTCOMES = [
  "acquired",
  "replay",
  "in-progress",
  "business-committed",
  "conflict",
] as const

import { ConfigurationError } from "../foundation/errors"

/**
 * Fail-closed validation for `IdempotencyPort.acquire()` results. A replay
 * without a result, an acquisition without a token, or an unknown outcome
 * must surface here instead of replaying `undefined` as a committed result
 * or authorizing a mutation that was never fenced.
 */
export function assertIdempotencyAcquireResult<TResult>(
  result: unknown
): asserts result is IdempotencyAcquireResult<TResult> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ConfigurationError(
      "Idempotency acquire must resolve to an outcome object."
    )
  }
  const candidate = result as {
    outcome?: unknown
    token?: unknown
  }
  if (
    typeof candidate.outcome !== "string" ||
    !(IDEMPOTENCY_OUTCOMES as readonly string[]).includes(candidate.outcome)
  ) {
    throw new ConfigurationError(
      `Idempotency acquire returned an unknown outcome: ${String(candidate.outcome)}.`
    )
  }
  if (
    (candidate.outcome === "acquired" ||
      candidate.outcome === "business-committed") &&
    (typeof candidate.token !== "string" || candidate.token.length === 0)
  ) {
    throw new ConfigurationError(
      `Idempotency acquire with outcome "${candidate.outcome}" must carry a non-empty token.`
    )
  }
  if (
    candidate.outcome === "replay" &&
    !Object.prototype.hasOwnProperty.call(result, "result")
  ) {
    throw new ConfigurationError("Idempotency replay must carry a result.")
  }
}
