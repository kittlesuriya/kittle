import { describe, expect, it, vi } from "vitest"
import { pgTable, text } from "drizzle-orm/pg-core"
import { mysqlTable, text as mysqlText } from "drizzle-orm/mysql-core"
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core"
import { ConfigurationError } from "kittle-core/domain"
import type { AuditRecord, OutboxRecord } from "kittle-core/ports"
import {
  assertAuditRecordIdentity,
  assertOutboxRecordIdentity,
} from "../sinkGuards"
import { DrizzleOutboxSink as PgOutboxSink } from "../../drizzle-pg/drizzleOutboxSink"
import { DrizzleAuditSink as PgAuditSink } from "../../drizzle-pg/drizzleAuditSink"
import { DrizzleOutboxSink as MysqlOutboxSink } from "../../drizzle-mysql/drizzleOutboxSink"
import { DrizzleAuditSink as MysqlAuditSink } from "../../drizzle-mysql/drizzleAuditSink"
import { DrizzleOutboxSink as D1OutboxSink } from "../../drizzle-d1/drizzleOutboxSink"
import { DrizzleAuditSink as D1AuditSink } from "../../drizzle-d1/drizzleAuditSink"
import type { DrizzleSessionLike } from "../../drizzle-pg/drizzleRepository"
import type { DrizzleSessionLike as MysqlDrizzleSessionLike } from "../../drizzle-mysql/drizzleRepository"
import type { DrizzleSessionLike as D1DrizzleSessionLike } from "../../drizzle-d1/drizzleRepository"

const OCCURRED_AT = new Date("2026-08-10T00:00:00Z")

function validOutbox(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: "event-1",
    type: "order.created",
    version: 1,
    tenantId: "tenant-1",
    aggregateType: "order",
    aggregateId: "order-1",
    payload: { total: 10 },
    idempotencyKey: "order-1-created",
    occurredAt: OCCURRED_AT,
    ...overrides,
  }
}

function validAudit(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "audit-1",
    occurredAt: OCCURRED_AT,
    action: "order.created",
    resourceType: "order",
    resourceId: "order-1",
    actor: { id: "actor-1", type: "user" },
    tenantId: "tenant-1",
    oldValue: null,
    newValue: { total: 10 },
    ...overrides,
  }
}

const pgOutboxTable = pgTable("outbox_events", {
  id: text("id"),
  tenantId: text("tenant_id"),
  idempotencyKey: text("idempotency_key"),
  eventFingerprint: text("event_fingerprint"),
})

const pgAuditTable = pgTable("audit_log", {
  id: text("id"),
})

const mysqlOutboxTable = mysqlTable("outbox", {
  id: mysqlText("id"),
  tenantId: mysqlText("tenant_id"),
  idempotencyKey: mysqlText("idempotency_key"),
  eventFingerprint: mysqlText("event_fingerprint"),
})

const mysqlAuditTable = mysqlTable("audit_log", {
  id: mysqlText("id"),
})

const d1OutboxTable = sqliteTable("outbox_events", {
  id: sqliteText("id"),
  idempotencyScope: sqliteText("idempotency_scope"),
  idempotencyKey: sqliteText("idempotency_key"),
  eventFingerprint: sqliteText("event_fingerprint"),
})

const d1AuditTable = sqliteTable("audit_log", {
  id: sqliteText("id"),
})

function pgDb() {
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(async () => ({ rowCount: 1 })),
    })),
  }))
  return {
    db: { insert } as unknown as DrizzleSessionLike,
    insert,
  }
}

function mysqlDb() {
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({ affectedRows: 1 })),
  }))
  return {
    db: { insert } as unknown as MysqlDrizzleSessionLike,
    insert,
  }
}

function d1Db() {
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(async () => ({ meta: { changes: 1 } })),
    })),
  }))
  return {
    db: { insert } as unknown as D1DrizzleSessionLike,
    insert,
  }
}

describe("sink identity guards", () => {
  it("accepts fully-identified outbox records", () => {
    expect(() =>
      assertOutboxRecordIdentity(validOutbox(), "test")
    ).not.toThrow()
  })

  it.each([
    ["empty id", { id: "  " }],
    ["empty type", { type: "" }],
    ["non-integer version", { version: 0 }],
    ["empty aggregateType", { aggregateType: "" }],
    ["empty aggregateId", { aggregateId: "" }],
    ["empty idempotencyKey", { idempotencyKey: "" }],
    ["invalid occurredAt", { occurredAt: new Date("invalid") }],
    ["non-string tenantId", { tenantId: 42 }],
  ])("rejects outbox records with %s", (_label, overrides) => {
    expect(() =>
      assertOutboxRecordIdentity(
        validOutbox(overrides as Partial<OutboxRecord>),
        "test"
      )
    ).toThrow(ConfigurationError)
  })

  it.each([
    ["empty action", { action: "" }],
    ["empty resourceType", { resourceType: "" }],
    ["empty resourceId", { resourceId: " " }],
    ["missing actor", { actor: undefined }],
    ["invalid occurredAt", { occurredAt: "not-a-date" }],
  ])("rejects audit records with %s", (_label, overrides) => {
    expect(() =>
      assertAuditRecordIdentity(
        validAudit(overrides as unknown as Partial<AuditRecord>),
        "test"
      )
    ).toThrow(ConfigurationError)
  })

  it("pg outbox rejects malformed records before any insert", async () => {
    const { db, insert } = pgDb()
    const sink = new PgOutboxSink(db, pgOutboxTable, () => ({}))
    await expect(
      sink.append(validOutbox({ idempotencyKey: "" }))
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(insert).not.toHaveBeenCalled()
    await expect(sink.append(validOutbox())).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("mysql outbox rejects malformed records before any insert", async () => {
    const { db, insert } = mysqlDb()
    const sink = new MysqlOutboxSink(db, mysqlOutboxTable, () => ({}))
    await expect(
      sink.append(validOutbox({ version: 1.5 }))
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(insert).not.toHaveBeenCalled()
    await expect(sink.append(validOutbox())).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("d1 outbox rejects malformed records before any insert", async () => {
    const { db, insert } = d1Db()
    const sink = new D1OutboxSink(db, d1OutboxTable, () => ({}))
    await expect(
      sink.append(validOutbox({ aggregateId: "" }))
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(insert).not.toHaveBeenCalled()
    await expect(sink.append(validOutbox())).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("pg audit rejects malformed records before any insert", async () => {
    const { db, insert } = pgDb()
    const sink = new PgAuditSink(db, pgAuditTable)
    await expect(
      sink.write(validAudit({ resourceId: "" }))
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(insert).not.toHaveBeenCalled()
    await expect(sink.write(validAudit())).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("mysql audit rejects malformed records before any insert", async () => {
    const { db, insert } = mysqlDb()
    const sink = new MysqlAuditSink(db, mysqlAuditTable)
    await expect(
      sink.write(validAudit({ action: "" }))
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(insert).not.toHaveBeenCalled()
    await expect(sink.write(validAudit())).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("d1 audit rejects malformed records before any insert", async () => {
    const { db, insert } = d1Db()
    const sink = new D1AuditSink(db, d1AuditTable)
    await expect(
      sink.write(validAudit({ actor: undefined as never }))
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(insert).not.toHaveBeenCalled()
    await expect(sink.write(validAudit())).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
  })
})
