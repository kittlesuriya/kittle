import {
  RuntimeCapabilityError,
  RateLimitError,
  ValidationError,
} from "../foundation/errors"

export interface RateLimitStore {
  /**
   * Increment the bucket for `key` and return the POST-increment count.
   *
   * Contract: the first hit of a window MUST return `count: 1` (1-based).
   * `checkRateLimit` computes `allowed: count <= limit` on this value, so a
   * 0-based store would silently allow `limit + 1` hits before denying.
   */
  increment(
    key: string,
    windowMs: number
  ): Promise<{ count: number; resetAt: number }>
}

/**
 * A store whose bucket increment is a single atomic backend operation.
 *
 * Contract: `incrementAtomically` follows the same 1-based post-increment
 * count as `increment` — first hit of a window returns `count: 1`.
 */
export interface AtomicRateLimitStore extends RateLimitStore {
  incrementAtomically(
    key: string,
    windowMs: number
  ): Promise<{ count: number; resetAt: number }>
}

export interface RateLimitConfig {
  max: number
  timeWindow: string | number
  consistency?: RateLimitConsistency
  /**
   * `fail-open` ONLY takes effect under `consistency: "best-effort"`;
   * atomic consistency always fails closed on store failure.
   */
  failureMode?: RateLimitFailureMode
}

export type RateLimitConsistency = "atomic" | "best-effort"
export type RateLimitFailureMode = "fail-closed" | "fail-open"

export interface RateLimitPolicy {
  /** Atomic increments are the security-safe default. */
  consistency?: RateLimitConsistency
  /**
   * Rate-limit infrastructure failures deny the request by default.
   *
   * Contract: `fail-open` ONLY takes effect under `consistency: "best-effort"`.
   * Atomic consistency always fails closed — a `fail-open` + `atomic` request
   * still throws on store failure (see checkRateLimit's
   * `failureMode === "fail-open" && consistency === "best-effort"` gate).
   */
  failureMode?: RateLimitFailureMode
}

export interface RateLimitCheckResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export function parseTimeWindowMs(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0)
      throw new ValidationError(
        "Rate-limit time window must be a finite positive number."
      )
    return value
  }
  const input = value.trim().toLowerCase()
  const match = input.match(
    /^(\d+)\s*(second|seconds|minute|minutes|hour|hours)$/
  )
  if (!match)
    throw new ValidationError(`Invalid rate-limit time window: ${value}`)

  const countText = match[1]
  const unit = match[2]
  if (countText === undefined || unit === undefined)
    throw new ValidationError(`Invalid rate-limit time window: ${value}`)
  const count = Number.parseInt(countText, 10)
  const result = unit.startsWith("second")
    ? count * 1000
    : unit.startsWith("hour")
      ? count * 60 * 60 * 1000
      : count * 60 * 1000
  if (!Number.isFinite(result) || result <= 0)
    throw new ValidationError("Rate-limit time window must be positive.")
  return result
}

function resolveConsistency(args: {
  consistency?: RateLimitConsistency
  policy?: RateLimitPolicy
}): RateLimitConsistency {
  if (
    args.consistency !== undefined &&
    args.policy?.consistency !== undefined &&
    args.consistency !== args.policy.consistency
  ) {
    throw new ValidationError(
      "Rate-limit consistency and policy options conflict."
    )
  }
  const consistency = args.consistency ?? args.policy?.consistency
  return consistency ?? "atomic"
}

function failOpenResult(
  limit: number,
  windowMs: number,
  nowMs: () => number
): RateLimitCheckResult {
  return { allowed: true, remaining: limit, resetAt: nowMs() + windowMs }
}

export async function checkRateLimit(args: {
  store: RateLimitStore
  key: string
  limit: number
  windowMs: number
  policy?: RateLimitPolicy
  consistency?: RateLimitConsistency
  failureMode?: RateLimitFailureMode
  nowMs?: () => number
}): Promise<RateLimitCheckResult> {
  if (args.key.trim().length === 0)
    throw new ValidationError("Rate-limit key must be non-empty.")
  if (!Number.isFinite(args.limit) || args.limit <= 0)
    throw new ValidationError("Rate-limit max must be positive.")
  if (!Number.isFinite(args.windowMs) || args.windowMs <= 0)
    throw new ValidationError("Rate-limit window must be positive.")
  const consistency = resolveConsistency(args)
  const failureMode =
    args.failureMode ?? args.policy?.failureMode ?? "fail-closed"
  const nowMs = args.nowMs ?? Date.now

  try {
    const atomicStore = isAtomicRateLimitStore(args.store)
      ? args.store
      : undefined
    if (consistency === "atomic" && !atomicStore) {
      throw new RuntimeCapabilityError("atomicIncrement")
    }

    const bucket =
      consistency === "atomic"
        ? await atomicStore!.incrementAtomically(args.key, args.windowMs)
        : await args.store.increment(args.key, args.windowMs)
    if (
      !Number.isFinite(bucket.count) ||
      bucket.count < 0 ||
      !Number.isFinite(bucket.resetAt)
    ) {
      throw new ValidationError("Rate-limit store returned an invalid bucket.")
    }
    const remaining = Math.max(args.limit - bucket.count, 0)

    return {
      allowed: bucket.count <= args.limit,
      remaining,
      resetAt: bucket.resetAt,
    }
  } catch (error) {
    if (failureMode === "fail-open" && consistency === "best-effort")
      return failOpenResult(args.limit, args.windowMs, nowMs)
    throw error
  }
}

function isAtomicRateLimitStore(
  store: RateLimitStore
): store is AtomicRateLimitStore {
  return (
    typeof (store as Partial<AtomicRateLimitStore>).incrementAtomically ===
    "function"
  )
}

export async function enforceRateLimit(args: {
  store: RateLimitStore
  key: string
  config: RateLimitConfig
  policy?: RateLimitPolicy
  consistency?: RateLimitConsistency
  failureMode?: RateLimitFailureMode
  nowMs?: () => number
}): Promise<RateLimitCheckResult> {
  if (!Number.isFinite(args.config.max) || args.config.max <= 0)
    throw new ValidationError("Rate-limit max must be positive.")
  const windowMs = parseTimeWindowMs(args.config.timeWindow)
  const result = await checkRateLimit({
    store: args.store,
    key: args.key,
    limit: args.config.max,
    windowMs,
    ...(args.policy !== undefined ? { policy: args.policy } : {}),
    ...(args.consistency !== undefined
      ? { consistency: args.consistency }
      : {}),
    ...(args.failureMode !== undefined
      ? { failureMode: args.failureMode }
      : {}),
    ...(args.nowMs !== undefined ? { nowMs: args.nowMs } : {}),
  })

  if (!result.allowed) {
    throw new RateLimitError(
      Math.max(result.resetAt - (args.nowMs?.() ?? Date.now()), 0)
    )
  }

  return result
}
