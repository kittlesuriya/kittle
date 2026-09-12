import { describe, expect, it, vi } from "vitest"
import { pgTable, text } from "drizzle-orm/pg-core"
import { ConfigurationError } from "kittle-core/domain"
import {
  DrizzleOutboxSink,
  computeOutboxFingerprint,
} from "../drizzleOutboxSink"
import type { DrizzleSessionLike } from "../drizzleRepository"
import type { OutboxRecord } from "kittle-core/ports"

const tenantOutboxTable = pgTable("outbox_events", {
  id: text("id"),
  tenantId: text("tenant_id"),
  eventType: text("event_type"),
  eventVersion: text("event_version"),
  aggregateType: text("aggregate_type"),
  aggregateId: text("aggregate_id"),
  payload: text("payload"),
  idempotencyKey: text("idempotency_key"),
  eventFingerprint: text("event_fingerprint"),
})

const scopedOutboxTable = pgTable("outbox_events", {
  id: text("id"),
  idempotencyScope: text("idempotency_scope"),
  idempotencyKey: text("idempotency_key"),
  eventFingerprint: text("event_fingerprint"),
})

const unsupportedOutboxTable = pgTable("outbox_events", {
  id: text("id"),
  idempotencyKey: text("idempotency_key"),
  eventFingerprint: text("event_fingerprint"),
})

const record: OutboxRecord = {
  id: "event-1",
  type: "appointment.created",
  version: 1,
  tenantId: "tenant-1",
  aggregateType: "appointment",
  aggregateId: "appointment-1",
  payload: { nested: { b: 2, a: 1 } },
  idempotencyKey: "appointment-1-created",
  occurredAt: new Date("2026-08-10T00:00:00Z"),
}

function createDb(
  insertResult: unknown = { rowCount: 1 },
  rows: unknown[] = []
) {
  let inserted: unknown
  const onConflictDoNothing = vi.fn(async () => insertResult)
  const values = vi.fn((data: unknown) => {
    inserted = data
    return { onConflictDoNothing }
  })
  const insert = vi.fn(() => ({ values }))
  const where = vi.fn(() => ({ limit: async () => rows }))
  const db = {
    insert,
    select: () => ({ from: () => ({ where }) }),
  } as unknown as DrizzleSessionLike
  return { db, insert, onConflictDoNothing, where, getInserted: () => inserted }
}

function mappedRecord(outboxRecord: OutboxRecord) {
  return {
    tenantId: outboxRecord.tenantId,
    eventType: outboxRecord.type,
    eventVersion: outboxRecord.version,
    aggregateType: outboxRecord.aggregateType,
    aggregateId: outboxRecord.aggregateId,
    payload: JSON.stringify(outboxRecord.payload),
    idempotencyKey: outboxRecord.idempotencyKey,
  }
}

describe("PostgreSQL outbox idempotency", () => {
  it("uses tenant columns for tenant-scoped tables", async () => {
    const { db, onConflictDoNothing, getInserted } = createDb()

    await new DrizzleOutboxSink(db, tenantOutboxTable, mappedRecord).append(
      record
    )

    expect(onConflictDoNothing).toHaveBeenCalledWith({
      target: [tenantOutboxTable.tenantId, tenantOutboxTable.idempotencyKey],
    })
    expect((getInserted() as Record<string, unknown>).eventFingerprint).toBe(
      await computeOutboxFingerprint(record)
    )
  })

  it("uses scope columns for scope-only tables and checks the existing fingerprint", async () => {
    const fingerprint = await computeOutboxFingerprint(record)
    const { db, onConflictDoNothing, where } = createDb({ rowCount: 0 }, [
      { eventFingerprint: fingerprint },
    ])

    await expect(
      new DrizzleOutboxSink(db, scopedOutboxTable, (value) => ({
        idempotencyScope: value.tenantId ?? "__platform__",
        idempotencyKey: value.idempotencyKey,
      })).append(record)
    ).resolves.toBeUndefined()
    expect(onConflictDoNothing).toHaveBeenCalledWith({
      target: [
        scopedOutboxTable.idempotencyScope,
        scopedOutboxTable.idempotencyKey,
      ],
    })
    expect(where).toHaveBeenCalled()
  })

  it("rejects a reused key with a different fingerprint", async () => {
    const { db } = createDb({ rowCount: 0 }, [
      { eventFingerprint: "different" },
    ])

    await expect(
      new DrizzleOutboxSink(db, tenantOutboxTable, mappedRecord).append(record)
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("requires an idempotency scope capability", async () => {
    const { db } = createDb()

    await expect(
      new DrizzleOutboxSink(db, unsupportedOutboxTable, mappedRecord).append(
        record
      )
    ).rejects.toBeInstanceOf(ConfigurationError)
  })

  it("requires migration when the stored fingerprint is missing", async () => {
    const { db } = createDb({ rowCount: 0 }, [{ eventFingerprint: null }])

    await expect(
      new DrizzleOutboxSink(db, tenantOutboxTable, mappedRecord).append(record)
    ).rejects.toThrow("migrate fingerprints")
  })

  it("stores a versioned v2 canonical fingerprint", async () => {
    expect((await computeOutboxFingerprint(record)).startsWith("v2:")).toBe(
      true
    )
  })
})
