import { uuidv7 } from "uuidv7"
import type {
  OutboxRecord,
  OutboxSink,
  OutboxSinkFactory,
  PersistenceProvider,
} from "kittle-core/ports"
import { ConflictError } from "kittle-core/domain"
import type { DrizzleSessionLike } from "./drizzleRepository"
import type { AnyColumn } from "drizzle-orm"
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core"
import { and, eq } from "drizzle-orm"
import {
  fingerprintOutboxRecord,
  getDrizzleSession,
  PLATFORM_IDEMPOTENCY_SCOPE,
} from "./drizzlePersistenceProvider"
import { assertOutboxRecordIdentity } from "../drizzle-shared/sinkGuards"
import { getAffectedRows } from "./d1Utils"

type OutboxColumns = AnySQLiteTable & {
  idempotencyScope: AnyColumn
  idempotencyKey: AnyColumn
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function scopeAndKey(columns: OutboxColumns, record: OutboxRecord) {
  return and(
    eq(columns.idempotencyScope, record.tenantId ?? PLATFORM_IDEMPOTENCY_SCOPE),
    eq(columns.idempotencyKey, record.idempotencyKey)
  )
}

export class DrizzleOutboxSink implements OutboxSink {
  constructor(
    private readonly db: DrizzleSessionLike,
    private readonly table: AnySQLiteTable,
    private readonly mapRecord: (
      record: OutboxRecord
    ) => Record<string, unknown>
  ) {}

  async append(record: OutboxRecord): Promise<void> {
    assertOutboxRecordIdentity(record, "D1 outbox")
    const columns = this.table as OutboxColumns
    const fingerprint = await fingerprintOutboxRecord(record)
    const mapped = this.mapRecord(record)
    const insertion = this.db.insert(this.table).values({
      ...mapped,
      id: record.id ?? uuidv7(),
      idempotencyScope: record.tenantId ?? PLATFORM_IDEMPOTENCY_SCOPE,
      eventFingerprint: fingerprint,
    })
    if (
      typeof (insertion as { onConflictDoNothing?: unknown })
        .onConflictDoNothing === "function"
    ) {
      const result = await (
        insertion as {
          onConflictDoNothing: (config: {
            target: AnyColumn[]
          }) => Promise<unknown>
        }
      ).onConflictDoNothing({
        target: [columns.idempotencyScope, columns.idempotencyKey],
      })
      if (getAffectedRows(result) === 0) {
        const conflictRows = await this.db
          .select()
          .from(this.table)
          .where(scopeAndKey(columns, record))
          .limit(1)
        const conflict = conflictRows[0]
        if (!isRow(conflict)) throw new Error("Outbox conflict row disappeared")
        if (
          typeof conflict.eventFingerprint !== "string" ||
          conflict.eventFingerprint.length === 0
        ) {
          throw new Error(
            "Stored outbox fingerprint is missing; migrate fingerprints before replaying events."
          )
        }
        if (conflict.eventFingerprint !== fingerprint) {
          throw new ConflictError(
            "Outbox idempotency key was reused for a different event"
          )
        }
      }
      return
    }
    await insertion
  }
}

export function createDrizzleOutboxSinkFactory(
  table: AnySQLiteTable,
  mapRecord: (record: OutboxRecord) => Record<string, unknown>
): OutboxSinkFactory {
  return {
    create(persistence: PersistenceProvider) {
      const session = getDrizzleSession(persistence)
      return new DrizzleOutboxSink(session, table, mapRecord)
    },
  }
}
