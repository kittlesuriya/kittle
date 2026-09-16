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

export class DrizzleOutboxSink implements OutboxSink {
  constructor(
    private readonly db: DrizzleSessionLike,
    private readonly table: AnyMySqlTable,
    private readonly mapRecord: (
      record: OutboxRecord
    ) => Record<string, unknown>
  ) {}

  async append(record: OutboxRecord): Promise<void> {
    const mapped = this.mapRecord(record)
    const fingerprint = await computeOutboxFingerprint(record)
    const columns = getTableColumns(this.table) as Record<string, AnyColumn>
    const scopeColumn = columns.tenantId ?? columns.idempotencyScope
    if (!scopeColumn || !columns.idempotencyKey) {
      throw new ConfigurationError(
        "MySQL outbox requires tenantId or idempotencyScope and idempotencyKey columns"
      )
    }

    // MySQL: use INSERT IGNORE for idempotent inserts
    const insertResult = await this.db.insert(this.table).values({
      id: record.id,
      ...mapped,
      eventFingerprint: fingerprint,
    })

    // If the insert was ignored (duplicate key), verify the existing row's fingerprint
    const scopeValue = columns.tenantId
      ? (record.tenantId ?? null)
      : (mapped.idempotencyScope ?? record.tenantId ?? "__platform__")
    const [existing] = await this.db
      .select()
      .from(this.table)
      .where(
        sql`${scopeColumn} = ${scopeValue} AND ${columns.idempotencyKey} = ${record.idempotencyKey}`
      )
      .limit(1)
    const existingRow = existing as Record<string, unknown> | undefined
    const existingFingerprint =
      existingRow?.eventFingerprint ?? existingRow?.event_fingerprint

    if (existingFingerprint === fingerprint) return

    if (
      typeof existingFingerprint !== "string" ||
      existingFingerprint.length === 0
    ) {
      // First insert succeeded, no conflict
      return
    }

    throw new ConflictError(
      "Outbox idempotency key was reused for a different event"
    )
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
