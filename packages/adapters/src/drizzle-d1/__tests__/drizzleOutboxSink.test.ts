import { describe, expect, it, vi } from "vitest"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { OutboxRecord } from "core/ports"
import type { DrizzleSessionLike } from "../drizzleRepository"
import { DrizzleOutboxSink } from "../drizzleOutboxSink"

const outboxTable = sqliteTable("outbox_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  idempotencyScope: text("idempotency_scope").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  eventFingerprint: text("event_fingerprint"),
  eventType: text("event_type").notNull(),
  eventVersion: text("event_version").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  payload: text("payload").notNull(),
})

const record: OutboxRecord = {
  id: "event-1",
  type: "appointment.created",
  version: 1,
  tenantId: "tenant-1",
  aggregateType: "appointment",
  aggregateId: "appointment-1",
  payload: { nested: { value: "created" }, order: 1 },
  idempotencyKey: "appointment.created:appointment-1",
  occurredAt: new Date("2026-08-01T00:00:00Z"),
}

function dbWith(
  existing: Record<string, unknown> | undefined,
  insertResult: unknown = existing
    ? { meta: { changes: 0 } }
    : { meta: { changes: 1 } }
) {
  const limit = vi.fn(async () => (existing ? [existing] : []))
  const insertedValues: unknown[] = []
  const values = vi.fn((data: unknown) => {
    insertedValues.push(data)
    return { onConflictDoNothing }
  })
  const onConflictDoNothing = vi.fn(async () => insertResult)
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })),
    })),
    insert: vi.fn(() => ({ values, onConflictDoNothing })),
  } as unknown as DrizzleSessionLike
  return { db, values, onConflictDoNothing, insertedValues }
}

describe("D1 outbox idempotency", () => {
  it("accepts a replay with the same logical event fingerprint", async () => {
    const first = dbWith(undefined)
    const sink = new DrizzleOutboxSink(first.db, outboxTable, () => ({}))
    await sink.append(record)
    const fingerprint = (first.insertedValues[0] as Record<string, unknown>)
      .eventFingerprint
    const replay = dbWith({
      ...record,
      eventType: record.type,
      eventVersion: record.version,
      eventFingerprint: fingerprint,
    })

    await new DrizzleOutboxSink(replay.db, outboxTable, () => ({})).append({
      ...record,
      payload: { order: 1, nested: { value: "created" } },
    })
    expect(replay.values).toHaveBeenCalled()
  })

  it("rejects a different event using the same idempotency key", async () => {
    const existing = dbWith(undefined)
    await new DrizzleOutboxSink(existing.db, outboxTable, () => ({})).append(
      record
    )
    const fingerprint = (existing.insertedValues[0] as Record<string, unknown>)
      .eventFingerprint
    const replay = dbWith({
      ...record,
      eventType: record.type,
      eventVersion: record.version,
      eventFingerprint: fingerprint,
    })

    await expect(
      new DrizzleOutboxSink(replay.db, outboxTable, () => ({})).append({
        ...record,
        aggregateId: "appointment-2",
      })
    ).rejects.toThrow("Outbox idempotency key was reused")
  })

  it("does not swallow an unrelated primary-key conflict", async () => {
    const conflict = new Error("UNIQUE constraint failed: outbox_events.id")
    const { db } = dbWith(undefined, conflict)
    const values = vi.fn(async () => {
      throw conflict
    })
    ;(db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values })

    await expect(
      new DrizzleOutboxSink(db, outboxTable, () => ({})).append(record)
    ).rejects.toThrow(conflict)
  })

  it("resolves a raced platform replay by fingerprint", async () => {
    const racedRecord = {
      ...record,
      tenantId: null,
      idempotencyKey: "platform-event-1",
    }
    const first = dbWith(undefined)
    await new DrizzleOutboxSink(first.db, outboxTable, () => ({})).append(
      racedRecord
    )
    const fingerprint = (first.insertedValues[0] as Record<string, unknown>)
      .eventFingerprint
    const existing = {
      ...racedRecord,
      tenantId: null,
      idempotencyScope: "__platform__",
      eventType: racedRecord.type,
      eventVersion: racedRecord.version,
      eventFingerprint: fingerprint,
    }
    const selectLimit = vi.fn().mockResolvedValueOnce([existing])
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimit })) })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(async () => ({ meta: { changes: 0 } })),
        })),
      })),
    } as unknown as DrizzleSessionLike

    await expect(
      new DrizzleOutboxSink(db, outboxTable, () => ({})).append(racedRecord)
    ).resolves.toBeUndefined()
  })

  it("rejects a raced platform conflict with a different fingerprint", async () => {
    const selectLimit = vi
      .fn()
      .mockResolvedValueOnce([
        { tenantId: null, eventFingerprint: "different" },
      ])
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimit })) })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(async () => ({ meta: { changes: 0 } })),
        })),
      })),
    } as unknown as DrizzleSessionLike

    await expect(
      new DrizzleOutboxSink(db, outboxTable, () => ({})).append({
        ...record,
        tenantId: null,
        idempotencyKey: "platform-event-2",
      })
    ).rejects.toThrow("Outbox idempotency key was reused")
  })

  it("requires migration when a raced row has no fingerprint", async () => {
    const { db } = dbWith({ tenantId: null, eventFingerprint: null })

    await expect(
      new DrizzleOutboxSink(db, outboxTable, () => ({})).append({
        ...record,
        tenantId: null,
        idempotencyKey: "platform-event-missing-fingerprint",
      })
    ).rejects.toThrow("migrate fingerprints")
  })
})
