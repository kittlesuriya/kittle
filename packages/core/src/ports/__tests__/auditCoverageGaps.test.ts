import { describe, expect, it } from "vitest"
import {
  buildAuditRecord,
  classifyAuditValue,
  defaultAuditSanitizer,
} from "../audit"

describe("audit port coverage paths", () => {
  it("sanitizes sensitive keys, scalar values, arrays, and nested objects", () => {
    expect(defaultAuditSanitizer("email@example.com and 2026-08-05")).toBe(
      "[redacted] and [redacted]"
    )
    expect(defaultAuditSanitizer(["+1 234 567 8901", 42, null])).toEqual([
      "+[redacted]",
      42,
      null,
    ])
    expect(
      defaultAuditSanitizer({
        patientName: "Alice",
        safe: { note: "private", value: "ok" },
      })
    ).toEqual({
      patientName: "[redacted]",
      safe: { note: "[redacted]", value: "ok" },
    })
    expect(defaultAuditSanitizer(false)).toBe(false)
  })

  it("builds defaults while preserving explicit nulls and metadata", () => {
    const occurredAt = new Date("2026-08-05T00:00:00Z")
    const actor = { id: "user-1", type: "user" as const }
    expect(
      buildAuditRecord({
        id: "audit-1",
        occurredAt,
        actor,
        action: "update",
        resourceType: "patient",
        resourceId: "patient-1",
        tenantId: null,
        oldValue: null,
        newValue: { status: "active" },
        metadata: { source: "test" },
      })
    ).toEqual(
      expect.objectContaining({
        id: "audit-1",
        oldValue: null,
        newValue: { status: "active" },
        metadata: { source: "test" },
      })
    )
    expect(
      buildAuditRecord({
        id: "audit-2",
        occurredAt,
        actor,
        action: "read",
        resourceType: "x",
        resourceId: "y",
        tenantId: "tenant-1",
      })
    ).toEqual(expect.objectContaining({ oldValue: null, newValue: null }))
  })

  it("omits classified free-text fields before heuristic sanitization", () => {
    const classified = classifyAuditValue(
      {
        note: "email@example.com",
        status: "ok",
        nested: { secret: "keep out" },
      },
      {
        note: "omit",
        nested: "include",
      }
    )
    expect(defaultAuditSanitizer(classified)).toEqual({
      status: "ok",
      nested: { secret: "[redacted]" },
    })
  })
})
