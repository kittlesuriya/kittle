import { describe, expect, it, vi } from "vitest"
import { mysqlTable, text } from "drizzle-orm/mysql-core"
import { ConflictError, ConfigurationError } from "kittle-core/domain"
import { DrizzleOutboxSink, computeOutboxFingerprint } from "../drizzleOutboxSink"
import type { DrizzleSessionLike } from "../drizzleRepository"

const outboxTable = mysqlTable("outbox", {
  id: text("id"),
  tenantId: text("tenant_id"),
  idempotencyKey: text("idempotency_key"),
  eventFingerprint: text("event_fingerprint"),
  type: text("type"),
  payload: text("payload"),
})

function createDb(insertResult?: unknown, existingRows: unknown[] = []) {
  let insertedData: unknown
  const values = vi.fn((data: unknown) => {
    insertedData = data
    return {
      affectedRows: 1,
    }
  })
  const insert = vi.fn(() => ({ values }))
  const limit = vi.fn(async () => existingRows)
  const where = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({
    from: vi.fn(() => ({ where })),
  }))
  const db = {
    insert,
    select,
  } as unknown as DrizzleSessionLike
  return { db, insert, getInserted: () => insertedData }
}

describe("DrizzleOutboxSink (MySQL)", () => {
  const mapRecord = (record: { type: string; payload: unknown }) => ({
    type: record.type,
    payload: JSON.stringify(record.payload),
  })

  it("inserts an outbox record", async () => {
    const { db, insert } = createDb()
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    await sink.append({
      id: "1",
      type: "Created",
      version: "1.0",
      tenantId: "t1",
      aggregateType: "Item",
      aggregateId: "a1",
      payload: { data: "test" },
      idempotencyKey: "ik1",
    } as never)
    expect(insert).toHaveBeenCalled()
  })

  it("computes fingerprint and verifies on duplicate", async () => {
    const fp = await computeOutboxFingerprint({
      type: "Created",
      version: "1.0",
      tenantId: "t1",
      aggregateType: "Item",
      aggregateId: "a1",
      payload: { data: "test" },
    })
    expect(fp).toMatch(/^v2:[a-f0-9]{64}$/)
  })

  it("throws ConflictError on fingerprint mismatch", async () => {
    const existingFingerprint = await computeOutboxFingerprint({
      type: "Created",
      version: "1.0",
      tenantId: "t1",
      aggregateType: "Item",
      aggregateId: "a1",
      payload: { data: "different" },
    })
    const { db } = createDb(undefined, [
      {
        id: "1",
        idempotency_key: "ik1",
        event_fingerprint: existingFingerprint,
        tenant_id: "t1",
      },
    ])
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    await expect(
      sink.append({
        id: "2",
        type: "Created",
        version: "1.0",
        tenantId: "t1",
        aggregateType: "Item",
        aggregateId: "a1",
        payload: { data: "test" },
        idempotencyKey: "ik1",
      } as never)
    ).rejects.toThrow(ConflictError)
  })

  it("allows duplicate when fingerprint matches", async () => {
    const fp = await computeOutboxFingerprint({
      type: "Created",
      version: "1.0",
      tenantId: "t1",
      aggregateType: "Item",
      aggregateId: "a1",
      payload: { data: "test" },
    })
    const { db } = createDb(undefined, [
      {
        id: "1",
        idempotency_key: "ik1",
        event_fingerprint: fp,
        tenant_id: "t1",
      },
    ])
    const sink = new DrizzleOutboxSink(db, outboxTable, mapRecord)
    await expect(
      sink.append({
        id: "2",
        type: "Created",
        version: "1.0",
        tenantId: "t1",
        aggregateType: "Item",
        aggregateId: "a1",
        payload: { data: "test" },
        idempotencyKey: "ik1",
      } as never)
    ).resolves.toBeUndefined()
  })
})
