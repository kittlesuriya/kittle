import { describe, expect, it, vi } from "vitest"
import { mysqlTable, text } from "drizzle-orm/mysql-core"
import { ConflictError, ConfigurationError } from "kittle-core/domain"
import { DrizzleOutboxSink, computeOutboxFingerprint } from "../drizzleOutboxSink"
import type { DrizzleSessionLike } from "../drizzleRepository"
import type { OutboxRecord } from "kittle-core/ports"

const outboxTable = mysqlTable("outbox", {
  id: text("id"),
  tenantId: text("tenant_id"),
  idempotencyKey: text("idempotency_key"),
  eventFingerprint: text("event_fingerprint"),
  type: text("type"),
  payload: text("payload"),
})

const DUP_ENTRY = Object.assign(new Error("Duplicate entry"), {
  code: "ER_DUP_ENTRY",
})

function validRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: "1",
    type: "Created",
    version: 1,
    tenantId: "t1",
    aggregateType: "Item",
    aggregateId: "a1",
    payload: { data: "test" },
    idempotencyKey: "ik1",
    occurredAt: new Date("2026-08-10T00:00:00Z"),
    ...overrides,
  }
}

function createDb(options: {
  insertError?: unknown
  existingRows?: unknown[]
} = {}) {
  let insertedData: unknown
  const values = vi.fn((data: unknown) => {
    insertedData = data
    if (options.insertError) {
      throw options.insertError instanceof Error
        ? options.insertError
        : new Error("insert failed")
    }
    return { affectedRows: 1 }
  })
  const insert = vi.fn(() => ({ values }))
  const limit = vi.fn(async () => options.existingRows ?? [])
  const where = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({
    from: vi.fn(() => ({ where })),
  }))
  const db = {
    insert,
    select,
  } as unknown as DrizzleSessionLike
  return { db, insert, select, getInserted: () => insertedData }
}

describe("DrizzleOutboxSink (MySQL)", () => {
  const mapRecord = (record: { type: string; payload: unknown }) => ({
    type: record.type,
    payload: JSON.stringify(record.payload),
  })

  it("inserts an outbox record with full identity and fingerprint", async () => {
    const { db, insert, select, getInserted } = createDb()
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    const record = validRecord()
    await sink.append(record)
    expect(insert).toHaveBeenCalled()
    // A successful first insert returns without a follow-up verification read.
    expect(select).not.toHaveBeenCalled()
    const inserted = getInserted() as Record<string, unknown>
    expect(inserted.id).toBe(record.id)
    expect(inserted.type).toBe(record.type)
    expect(inserted.eventFingerprint).toBe(
      await computeOutboxFingerprint(record)
    )
  })

  it("computes a versioned canonical fingerprint", async () => {
    const fp = await computeOutboxFingerprint({
      type: "Created",
      version: 1,
      tenantId: "t1",
      aggregateType: "Item",
      aggregateId: "a1",
      payload: { data: "test" },
    })
    expect(fp).toMatch(/^v2:[a-f0-9]{64}$/)
  })

  it("throws ConflictError on fingerprint mismatch after a duplicate", async () => {
    const record = validRecord({ id: "2" })
    const existingFingerprint = await computeOutboxFingerprint({
      ...record,
      payload: { data: "different" },
    })
    const { db } = createDb({
      insertError: DUP_ENTRY,
      existingRows: [
        {
          id: "1",
          idempotency_key: "ik1",
          event_fingerprint: existingFingerprint,
          tenant_id: "t1",
        },
      ],
    })
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    await expect(sink.append(record)).rejects.toThrow(ConflictError)
  })

  it("allows a duplicate when the fingerprint matches (idempotent replay)", async () => {
    const record = validRecord({ id: "2" })
    const fp = await computeOutboxFingerprint(record)
    const { db } = createDb({
      insertError: DUP_ENTRY,
      existingRows: [
        {
          id: "1",
          idempotency_key: "ik1",
          event_fingerprint: fp,
          tenant_id: "t1",
        },
      ],
    })
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    await expect(sink.append(record)).resolves.toBeUndefined()
  })

  it("fails closed when the collided row has no fingerprint", async () => {
    const { db } = createDb({
      insertError: DUP_ENTRY,
      existingRows: [{ id: "1", event_fingerprint: null }],
    })
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    await expect(sink.append(validRecord({ id: "2" }))).rejects.toThrow(
      "migrate fingerprints"
    )
  })

  it("propagates the original error when no row matches our identity", async () => {
    const { db, select } = createDb({
      insertError: DUP_ENTRY,
      existingRows: [],
    })
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    // The collision was on an unrelated unique key: the original duplicate
    // error must surface, not an invented fingerprint verdict.
    await expect(sink.append(validRecord({ id: "2" }))).rejects.toBe(DUP_ENTRY)
    expect(select).toHaveBeenCalled()
  })

  it("propagates non-duplicate insert errors without verification", async () => {
    const failure = new Error("connection lost")
    const { db, select } = createDb({ insertError: failure })
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    await expect(sink.append(validRecord())).rejects.toBe(failure)
    expect(select).not.toHaveBeenCalled()
  })

  it("rejects malformed records before touching the database", async () => {
    const { db, insert } = createDb()
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    await expect(
      sink.append(validRecord({ idempotencyKey: "   " }))
    ).rejects.toBeInstanceOf(ConfigurationError)
    await expect(
      sink.append(validRecord({ version: 0 }))
    ).rejects.toBeInstanceOf(ConfigurationError)
    await expect(
      sink.append(validRecord({ occurredAt: new Date("invalid") }))
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(insert).not.toHaveBeenCalled()
  })
})
