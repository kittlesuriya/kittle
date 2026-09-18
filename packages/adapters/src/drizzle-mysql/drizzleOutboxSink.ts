import type {
  OutboxRecord,
  OutboxSink,
  OutboxSinkFactory,
  PersistenceProvider,
} from "kittle-core/ports"
import { canonicalJsonString } from "kittle-core/foundation/canonicalJson"
import type { DrizzleSessionLike } from "./drizzleRepository"
import type { AnyMySqlTable } from "drizzle-orm/mysql-core"
import { getTableColumns, sql, type AnyColumn } from "drizzle-orm"
import { ConfigurationError, ConflictError } from "kittle-core/domain"
import { getDrizzleSession } from "./drizzlePersistenceProvider"
import { assertOutboxRecordIdentity } from "../drizzle-shared/sinkGuards"

const OUTBOX_FINGERPRINT_VERSION = "v2"

export type OutboxFingerprintRecord = Pick<
  OutboxRecord,
  "type" | "version" | "tenantId" | "aggregateType" | "aggregateId" | "payload"
>

/**
 * Canonical, locale-independent durable outbox event fingerprint. Only the
 * current versioned fingerprint is accepted; historical rows must be migrated
 * offline to this format before deployment (no runtime fallback matching).
 */
export async function computeOutboxFingerprint(
  record: OutboxFingerprintRecord
): Promise<string> {
  const canonical = canonicalJsonString({
    type: record.type,
    version: record.version,
    tenantId: record.tenantId ?? null,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    payload: record.payload,
  })
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  )
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `${OUTBOX_FINGERPRINT_VERSION}:${hex}`
}

function scopeValueOf(
  columns: Record<string, AnyColumn>,
  mapped: Record<string, unknown>,
  record: OutboxRecord
): unknown {
  return columns.tenantId
    ? (record.tenantId ?? null)
    : (mapped.idempotencyScope ?? record.tenantId ?? "__platform__")
}

/**
 * Verifies the stored row's fingerprint after a duplicate-key collision. A
 * matching fingerprint is an idempotent replay; a different one is a key-reuse
 * conflict. Fails closed when the stored row cannot prove its identity.
 */
function verifyExistingFingerprint(
  existingRow: Record<string, unknown>,
  fingerprint: string
): void {
  const existingFingerprint =
    existingRow.eventFingerprint ?? existingRow.event_fingerprint

  if (existingFingerprint === fingerprint) return

  if (
    typeof existingFingerprint !== "string" ||
    existingFingerprint.length === 0
  ) {
    throw new Error(
      "Stored outbox fingerprint is missing; migrate fingerprints before replaying events."
    )
  }

  throw new ConflictError(
    "Outbox idempotency key was reused for a different event"
  )
}
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

export class DrizzleOutboxSink implements OutboxSink {
  constructor(
    private readonly db: DrizzleSessionLike,
    private readonly table: AnyMySqlTable,
    private readonly mapRecord: (
      record: OutboxRecord
    ) => Record<string, unknown>
  ) {}

  async append(record: OutboxRecord): Promise<void> {
    assertOutboxRecordIdentity(record, "MySQL outbox")
    const mapped = this.mapRecord(record)
    const fingerprint = await computeOutboxFingerprint(record)
    const columns = getTableColumns(this.table) as Record<string, AnyColumn>
    const scopeColumn = columns.tenantId ?? columns.idempotencyScope
    if (!scopeColumn || !columns.idempotencyKey) {
      throw new ConfigurationError(
        "MySQL outbox requires tenantId or idempotencyScope and idempotencyKey columns"
      )
    }

    try {
      await this.db.insert(this.table).values({
        id: record.id,
        ...mapped,
        eventFingerprint: fingerprint,
      })
      return
    } catch (error) {
      // A plain insert throws ER_DUP_ENTRY on any unique collision. Only a
      // collision on the outbox (scope, idempotencyKey) identity is an
      // idempotency replay; anything else must propagate unchanged.
      if (findMysqlProperty(error, "code") !== "ER_DUP_ENTRY") throw error
      const [existing] = await this.db
        .select()
        .from(this.table)
        .where(
          sql`${scopeColumn} <=> ${scopeValueOf(columns, mapped, record)} AND ${columns.idempotencyKey} = ${record.idempotencyKey}`
        )
        .limit(1)
      const existingRow = existing as Record<string, unknown> | undefined
      // No row under our identity: the collision was unrelated (e.g. primary
      // key). Propagate the original error rather than inventing a verdict.
      if (!existingRow) throw error
      verifyExistingFingerprint(existingRow, fingerprint)
      return
    }
  }
}

export function createDrizzleOutboxSinkFactory(
  table: AnyMySqlTable,
  mapRecord: (record: OutboxRecord) => Record<string, unknown>
): OutboxSinkFactory {
  return {
    create(persistence: PersistenceProvider) {
      const session = getDrizzleSession(persistence)
      return new DrizzleOutboxSink(session, table, mapRecord)
    },
  }
}
