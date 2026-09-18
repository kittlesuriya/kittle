import { describe, expect, it, vi } from "vitest"
import {
  assertAuditRecordValue,
  assertAuditResourceId,
  assertAuditSink,
  resolveAuditSink,
} from "../audit"
import {
  assertOutboxSink,
  normalizeOutboxRecord,
  resolveOutboxSink,
} from "../outbox"
import { ConfigurationError } from "../../foundation/errors"

const validOutbox = {
  type: "row.created",
  version: 1,
  aggregateType: "row",
  aggregateId: "row-1",
  payload: {},
  idempotencyKey: "row-1",
}
const defaults = { id: "generated", occurredAt: new Date("2026-01-01T00:00:00Z") }

describe("outbox record identity guards", () => {
  it("accepts a well-formed record", () => {
    expect(normalizeOutboxRecord(validOutbox, defaults)).toMatchObject({
      id: "generated",
      type: "row.created",
    })
  })

  it.each([
    ["empty type", { ...validOutbox, type: "" }],
    ["missing type", { ...validOutbox, type: undefined }],
    ["zero version", { ...validOutbox, version: 0 }],
    ["string version", { ...validOutbox, version: "1" }],
    ["NaN version", { ...validOutbox, version: NaN }],
    ["empty aggregateType", { ...validOutbox, aggregateType: "  " }],
    ["empty aggregateId", { ...validOutbox, aggregateId: "" }],
    ["empty idempotencyKey", { ...validOutbox, idempotencyKey: "" }],
    ["numeric tenantId", { ...validOutbox, tenantId: 42 }],
    ["numeric id", { ...validOutbox, id: 42 }],
    ["string occurredAt", { ...validOutbox, occurredAt: "now" }],
    ["invalid occurredAt", { ...validOutbox, occurredAt: new Date(NaN) }],
  ])("rejects a record with %s", (_label, record) => {
    expect(() =>
      normalizeOutboxRecord(record as never, defaults)
    ).toThrow(ConfigurationError)
  })
})

describe("audit value guards", () => {
  it("accepts non-empty resource ids", () => {
    expect(() => assertAuditResourceId("row-1", "op")).not.toThrow()
  })

  it.each([[""], ["  "], [undefined], [null], [42]])(
    "rejects resource id %p",
    (value) => {
      expect(() => assertAuditResourceId(value, "op")).toThrow(
        ConfigurationError
      )
    }
  )

  it("accepts null and plain objects as audit values", () => {
    expect(() => assertAuditRecordValue(null, "label")).not.toThrow()
    expect(() => assertAuditRecordValue({ a: 1 }, "label")).not.toThrow()
  })

  it.each([[[]], ["x"], [42], [true]])(
    "rejects audit value %p",
    (value) => {
      expect(() => assertAuditRecordValue(value, "label")).toThrow(
        ConfigurationError
      )
    }
  )
})

describe("sink factory product guards", () => {
  const persistence = {
    dialect: "memory",
    capabilities: {
      interactiveTransactions: false,
      atomicBatch: false,
      returningInsert: false,
      readSessions: false,
      jsonQueries: false,
      exactDecimal: false,
      persistentConnection: false,
    },
    repository: (() => {
      throw new Error("not used")
    }) as never,
  }

  it("resolves well-formed sinks", () => {
    const auditSink = { write: vi.fn() }
    expect(
      resolveAuditSink({ create: () => auditSink }, persistence, "Audit")
    ).toBe(auditSink)
    const outboxSink = { append: vi.fn() }
    expect(
      resolveOutboxSink({ create: () => outboxSink }, persistence, "Outbox")
    ).toBe(outboxSink)
  })

  it.each([[null], [undefined], [{}], [{ write: "yes" }]])(
    "rejects malformed audit sink %p",
    (sink) => {
      expect(() => assertAuditSink(sink, "Audit sink")).toThrow(
        ConfigurationError
      )
    }
  )

  it.each([[null], [undefined], [{}], [{ append: 42 }]])(
    "rejects malformed outbox sink %p",
    (sink) => {
      expect(() => assertOutboxSink(sink, "Outbox sink")).toThrow(
        ConfigurationError
      )
    }
  )

  it("rejects factories without create()", () => {
    expect(() =>
      resolveAuditSink({}, persistence, "Audit")
    ).toThrow(ConfigurationError)
    expect(() =>
      resolveOutboxSink({ create: "x" }, persistence, "Outbox")
    ).toThrow(ConfigurationError)
  })

  it("rejects factories whose product is malformed", () => {
    expect(() =>
      resolveAuditSink({ create: () => null }, persistence, "Audit")
    ).toThrow(ConfigurationError)
    expect(() =>
      resolveOutboxSink({ create: () => ({}) }, persistence, "Outbox")
    ).toThrow(ConfigurationError)
  })
})
