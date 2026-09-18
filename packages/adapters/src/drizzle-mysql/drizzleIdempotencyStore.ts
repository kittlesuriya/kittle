import { sql } from "drizzle-orm"
import type { AnyMySqlTable } from "drizzle-orm/mysql-core"
import type {
  ClaimedPendingInvalidation,
  IdempotencyAcquireResult,
  IdempotencyCompletion,
  IdempotencyCommitItem,
  IdempotencyFinalizationPort,
  IdempotencyRequest,
  PersistenceProvider,
  TransactionalIdempotencyPort,
} from "kittle-core/ports"
import { ConflictError } from "kittle-core/domain"
import type { DrizzleSessionLike } from "./drizzleRepository"
import { getAffectedRows } from "./mysqlUtils"
import { getDrizzleSession } from "./drizzlePersistenceProvider"

const DEFAULT_LEASE_DURATION_MS = 30_000
const MIN_LEASE_DURATION_MS = 1
const MAX_LEASE_DURATION_MS = 24 * 60 * 60 * 1_000

function findMysqlProperty(
  error: unknown,
  property: "code" | "constraint"
): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && property in current) {
      const value = (current as Record<string, unknown>)[property]
      if (typeof value === "string") return value
    }
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined
  }
  return undefined
}

export class DrizzleMySqlIdempotencyStore<TResult>
  implements
    TransactionalIdempotencyPort<TResult>,
    IdempotencyFinalizationPort<TResult>
{
  constructor(
    private readonly db: DrizzleSessionLike,
    private readonly table: AnyMySqlTable
  ) {}

  async acquire(
    request: IdempotencyRequest
  ): Promise<IdempotencyAcquireResult<TResult>> {
    const leaseDurationMs = validateLeaseDuration(request.leaseDurationMs)
    const token = crypto.randomUUID()
    try {
      await this.db.insert(this.table).values({
        id: crypto.randomUUID(),
        scope: request.scope,
        key: request.key,
        fingerprint: request.fingerprint,
        token,
        status: "in-progress",
        result: null,
      })
      return { outcome: "acquired", token }
    } catch (error) {
      const errorCode = findMysqlProperty(error, "code")
      if (errorCode !== "ER_DUP_ENTRY" && errorCode !== "23505") throw error
      const [existing] = await this.db
        .select()
        .from(this.table)
        .where(sql`scope = ${request.scope} AND key = ${request.key}`)
        .limit(1)
      const row = existing as Record<string, unknown> | undefined
      if (!row) throw error
      let resolved: IdempotencyAcquireResult<TResult> | undefined
      try {
        resolved = resolveExisting<TResult>(request, row, leaseDurationMs)
      } catch (error) {
        await this.db
          .update(this.table)
          .set({ status: "poisoned" })
          .where(
            sql`scope = ${row.scope} AND key = ${row.key} AND token = ${row.token} AND status = 'business-committed'`
          )
        throw error
      }
      if (resolved) return resolved
      return this.takeoverOrRecheck(request, leaseDurationMs)
    }
  }

  private async takeoverOrRecheck(
    request: IdempotencyRequest,
    leaseDurationMs: number
  ): Promise<IdempotencyAcquireResult<TResult>> {
    const takeoverToken = crypto.randomUUID()
    const updated = await this.db
      .update(this.table)
      .set({
        token: takeoverToken,
        createdAt: sql`NOW()`,
      })
      .where(
        sql`scope = ${request.scope} AND key = ${request.key} AND fingerprint = ${request.fingerprint} AND status = 'in-progress' AND created_at < NOW() - INTERVAL ${leaseDurationMs} MILLISECOND`
      )
    if (getAffectedRows(updated) === 1)
      return { outcome: "acquired", token: takeoverToken }
    const [current] = await this.db
      .select()
      .from(this.table)
      .where(sql`scope = ${request.scope} AND key = ${request.key}`)
      .limit(1)
    const currentRow = current as Record<string, unknown> | undefined
    if (!currentRow) return { outcome: "in-progress" }
    try {
      return (
        resolveExisting<TResult>(request, currentRow, leaseDurationMs) ?? {
          outcome: "in-progress",
        }
      )
    } catch (error) {
      await this.db
        .update(this.table)
        .set({ status: "poisoned" })
        .where(
          sql`scope = ${currentRow.scope} AND key = ${currentRow.key} AND token = ${currentRow.token} AND status = 'business-committed'`
        )
      throw error
    }
  }

  async renew(lease: {
    scope: string
    key: string
    fingerprint: string
    token: string
    leaseDurationMs?: number
  }): Promise<void> {
    validateLeaseDuration(lease.leaseDurationMs)
    const updated = await this.db
      .update(this.table)
      .set({ createdAt: sql`NOW()` })
      .where(
        sql`scope = ${lease.scope} AND key = ${lease.key} AND fingerprint = ${lease.fingerprint} AND token = ${lease.token} AND status = 'in-progress'`
      )
    if (getAffectedRows(updated) !== 1)
      throw new Error("Idempotency lease renewal lost ownership")
  }

  async markCommittedInTransaction(
    completion: IdempotencyCommitItem,
    persistence: PersistenceProvider
  ): Promise<void> {
    const session = getDrizzleSession(persistence)
    const updated = await session
      .update(this.table)
      .set({
        status: "business-committed",
        result: null,
        resourceEntity: completion.resource?.entity ?? null,
        resourceId: completion.resource?.id ?? null,
        resourceVersion:
          completion.resource?.version == null
            ? null
            : encodeResourceVersion(completion.resource.version),
        pendingInvalidations: serializeInvalidations(completion.invalidations),
        completedAt: sql`NOW()`,
      })
      .where(
        sql`scope = ${completion.scope} AND key = ${completion.key} AND fingerprint = ${completion.fingerprint} AND token = ${completion.token} AND status = 'in-progress'`
      )
    if (getAffectedRows(updated) !== 1) {
      throw new ConflictError(
        "Idempotency ownership was lost before the mutation committed"
      )
    }
  }

  async findCommittedWithPendingInvalidations(
    limit = 100
  ): Promise<import("kittle-core/ports").PendingInvalidation[]> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(
        sql`status = 'business-committed' AND pending_invalidations IS NOT NULL`
      )
      .limit(limit)
    const pending: import("kittle-core/ports").PendingInvalidation[] = []
    for (const rawRow of rows) {
      const row = rawRow as Record<string, unknown>
      try {
        pending.push({
          scope: row.scope as string,
          key: row.key as string,
          fingerprint: row.fingerprint as string,
          token: row.token as string,
          invalidations: parseInvalidations(row.pendingInvalidations),
          result:
            typeof row.result === "string"
              ? (() => {
                  try {
                    return JSON.parse(row.result) as unknown
                  } catch {
                    return null
                  }
                })()
              : null,
        })
      } catch {
        await this.db
          .update(this.table)
          .set({ status: "poisoned" })
          .where(
            sql`scope = ${row.scope} AND key = ${row.key} AND token = ${row.token} AND status = 'business-committed'`
          )
      }
    }
    return pending
  }

  async claimPendingInvalidations(args: {
    limit?: number
    claimOwner: string
    leaseMs: number
    claimToken?: string
  }): Promise<ClaimedPendingInvalidation[]> {
    const leaseMs = validateLeaseDuration(args.leaseMs)
    const limit = Math.min(args.limit ?? 100, 100)
    if (!args.claimOwner || typeof args.claimOwner !== "string")
      throw new Error("claimOwner is required")
    const claimToken = args.claimToken ?? crypto.randomUUID()
    const rows = await this.db
      .select()
      .from(this.table)
      .where(
        sql`status = 'business-committed' AND pending_invalidations IS NOT NULL AND (finalizer_claim_expires_at IS NULL OR finalizer_claim_expires_at < NOW())`
      )
      .limit(limit)
    const claimed: ClaimedPendingInvalidation[] = []
    for (const rawRow of rows) {
      const row = rawRow as Record<string, unknown>
      let invalidations: string[]
      try {
        invalidations = parseInvalidations(row.pendingInvalidations)
      } catch {
        await this.db
          .update(this.table)
          .set({ status: "poisoned" })
          .where(
            sql`scope = ${row.scope} AND key = ${row.key} AND token = ${row.token} AND status = 'business-committed'`
          )
        continue
      }
      const result: unknown =
        typeof row.result === "string"
          ? (() => {
              try {
                return JSON.parse(row.result) as unknown
              } catch {
                return null
              }
            })()
          : null
      const updated = await this.db
        .update(this.table)
        .set({
          finalizerClaimOwner: args.claimOwner,
          finalizerClaimToken: claimToken,
          finalizerClaimExpiresAt: sql`NOW() + INTERVAL ${leaseMs} MILLISECOND`,
        })
        .where(
          sql`scope = ${row.scope} AND key = ${row.key} AND token = ${row.token} AND status = 'business-committed' AND pending_invalidations IS NOT NULL AND (finalizer_claim_expires_at IS NULL OR finalizer_claim_expires_at < NOW())`
        )
      if (getAffectedRows(updated) === 1) {
        claimed.push({
          scope: row.scope as string,
          key: row.key as string,
          fingerprint: row.fingerprint as string,
          token: row.token as string,
          invalidations,
          result,
          claimToken,
          claimOwner: args.claimOwner,
        })
      }
    }
    return claimed
  }

  async recover(
    completion: Omit<IdempotencyCompletion<TResult>, "result">
  ): Promise<void> {
    const updated = await this.db
      .update(this.table)
      .set({ status: "business-committed" })
      .where(
        sql`scope = ${completion.scope} AND key = ${completion.key} AND fingerprint = ${completion.fingerprint} AND token = ${completion.token} AND status IN ('in-progress', 'business-committed')`
      )
    if (getAffectedRows(updated) !== 1)
      throw new Error("Idempotency recovery lost ownership of the reservation")
  }

  async ackInvalidations(request: {
    scope: string
    key: string
    fingerprint: string
    token: string
  }): Promise<void> {
    const updated = await this.db
      .update(this.table)
      .set({
        pendingInvalidations: null,
        finalizerClaimOwner: null,
        finalizerClaimToken: null,
        finalizerClaimExpiresAt: null,
      })
      .where(
        sql`scope = ${request.scope} AND key = ${request.key} AND fingerprint = ${request.fingerprint} AND token = ${request.token} AND status = 'business-committed'`
      )
    if (getAffectedRows(updated) !== 1)
      throw new Error("Idempotency ack invalidations lost ownership")
  }

  async ackClaimedInvalidation(request: {
    scope: string
    key: string
    fingerprint: string
    token: string
    claimToken: string
  }): Promise<void> {
    const updated = await this.db
      .update(this.table)
      .set({
        pendingInvalidations: null,
        finalizerClaimOwner: null,
        finalizerClaimToken: null,
        finalizerClaimExpiresAt: null,
      })
      .where(
        sql`scope = ${request.scope} AND key = ${request.key} AND fingerprint = ${request.fingerprint} AND token = ${request.token} AND finalizer_claim_token = ${request.claimToken} AND status = 'business-committed' AND finalizer_claim_expires_at > NOW()`
      )
    if (getAffectedRows(updated) !== 1)
      throw new Error(
        "Idempotency ack claimed invalidations lost ownership or lease expired"
      )
  }

  async completeClaimedInvalidation(
    completion: IdempotencyCompletion<TResult> & { claimToken: string }
  ): Promise<void> {
    const updated = await this.db
      .update(this.table)
      .set({
        status: "completed",
        result: JSON.stringify(completion.result),
        pendingInvalidations: null,
        finalizerClaimOwner: null,
        finalizerClaimToken: null,
        finalizerClaimExpiresAt: null,
        completedAt: sql`NOW()`,
      })
      .where(
        sql`scope = ${completion.scope} AND key = ${completion.key} AND fingerprint = ${completion.fingerprint} AND token = ${completion.token} AND finalizer_claim_token = ${completion.claimToken} AND status = 'business-committed' AND finalizer_claim_expires_at > NOW()`
      )
    if (getAffectedRows(updated) !== 1)
      throw new Error(
        "Idempotency complete claimed invalidations lost ownership or lease expired"
      )
  }

  async complete(completion: IdempotencyCompletion<TResult>): Promise<void> {
    const updated = await this.db
      .update(this.table)
      .set({
        status: "completed",
        result: JSON.stringify(completion.result),
        pendingInvalidations: null,
        finalizerClaimOwner: null,
        finalizerClaimToken: null,
        finalizerClaimExpiresAt: null,
        completedAt: sql`NOW()`,
      })
      .where(
        sql`scope = ${completion.scope} AND key = ${completion.key} AND fingerprint = ${completion.fingerprint} AND token = ${completion.token} AND status = 'business-committed'`
      )
    if (getAffectedRows(updated) !== 1)
      throw new Error(
        "Idempotency completion lost ownership of the reservation"
      )
  }
}

function serializeInvalidations(
  invalidations: readonly string[] | undefined
): string | null {
  if (!invalidations || invalidations.length === 0) return null
  return JSON.stringify([...new Set(invalidations)])
}

function parseInvalidations(raw: unknown): string[] {
  if (raw === null || raw === undefined) return []
  if (typeof raw !== "string") {
    throw new Error(
      `Corrupted idempotency invalidation data: expected string, got ${typeof raw}`
    )
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error("Corrupted idempotency invalidation data: expected array")
    }
    if (!parsed.every((entry): entry is string => typeof entry === "string")) {
      throw new Error(
        "Corrupted idempotency invalidation data: expected string entries"
      )
    }
    return [...new Set(parsed)]
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Corrupted idempotency invalidation data: malformed JSON`)
    }
    throw error
  }
}

function encodeResourceVersion(version: string | number): string {
  return typeof version === "number"
    ? JSON.stringify({ type: "number", value: version })
    : JSON.stringify({ type: "string", value: version })
}

function decodeResourceVersion(
  raw: string | undefined | null
): string | number | undefined {
  if (raw === undefined || raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      "value" in parsed
    ) {
      const record = parsed as { type?: unknown; value?: unknown }
      if (record.type === "number" && typeof record.value === "number")
        return record.value
      if (record.type === "string" && typeof record.value === "string")
        return record.value
    }
  } catch {
    // Not the typed envelope — fall through to legacy handling.
  }
  if (/^-?\d+$/.test(raw)) return Number(raw)
  return raw
}

function resolveExisting<TResult>(
  request: IdempotencyRequest,
  row: Record<string, unknown>,
  _leaseDurationMs: number
): IdempotencyAcquireResult<TResult> | undefined {
  if (row.fingerprint !== request.fingerprint) return { outcome: "conflict" }
  if (row.status === "completed" && typeof row.result === "string") {
    return { outcome: "replay", result: JSON.parse(row.result) as TResult }
  }
  if (row.status === "business-committed") {
    const resourceEntity = row.resourceEntity as string | undefined
    const resourceId = row.resourceId as string | undefined
    const resourceVersion = decodeResourceVersion(
      row.resourceVersion as string | undefined
    )
    return {
      outcome: "business-committed" as const,
      token: row.token as string,
      ...(resourceEntity && resourceId
        ? {
            resource: {
              entity: resourceEntity,
              id: resourceId,
              ...(resourceVersion !== undefined
                ? { version: resourceVersion }
                : {}),
            },
          }
        : {}),
      invalidations: parseInvalidations(row.pendingInvalidations),
    }
  }
  return undefined
}

function validateLeaseDuration(value: number | undefined): number {
  const duration = value ?? DEFAULT_LEASE_DURATION_MS
  if (
    !Number.isFinite(duration) ||
    duration < MIN_LEASE_DURATION_MS ||
    duration > MAX_LEASE_DURATION_MS
  ) {
    throw new Error(
      "Idempotency lease duration must be finite and within the allowed bounds"
    )
  }
  return duration
}

export function createDrizzleMySqlIdempotencyStore<TResult>(
  db: DrizzleSessionLike,
  table: AnyMySqlTable
): TransactionalIdempotencyPort<TResult> &
  IdempotencyFinalizationPort<TResult> {
  return new DrizzleMySqlIdempotencyStore<TResult>(db, table)
}
