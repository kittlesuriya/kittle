import { describe, expect, it, vi } from "vitest"
import { mysqlTable, text } from "drizzle-orm/mysql-core"
import { DrizzleMySqlIdempotencyStore } from "../drizzleIdempotencyStore"
import type { DrizzleSessionLike } from "../drizzleRepository"

const idempotencyTable = mysqlTable("idempotency", {
  id: text("id"),
  scope: text("scope"),
  key: text("key"),
  fingerprint: text("fingerprint"),
  token: text("token"),
  status: text("status"),
  result: text("result"),
  resourceEntity: text("resource_entity"),
  resourceId: text("resource_id"),
  resourceVersion: text("resource_version"),
  pendingInvalidations: text("pending_invalidations"),
  completedAt: text("completed_at"),
  createdAt: text("created_at"),
  finalizerClaimOwner: text("finalizer_claim_owner"),
  finalizerClaimToken: text("finalizer_claim_token"),
  finalizerClaimExpiresAt: text("finalizer_claim_expires_at"),
})

type Row = Record<string, unknown>

function createSimulation() {
  const rows = new Map<string, Row>()

  const db = {
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Row) => {
        const key = `${values.scope}:${values.key}`
        if (rows.has(key)) {
          const err = new Error("Duplicate entry") as Error & { code: string }
          err.code = "ER_DUP_ENTRY"
          throw err
        }
        rows.set(key, { ...values })
        return { affectedRows: 1 }
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [...rows.values()]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((updates: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          let affected = 0
          for (const [, row] of rows) {
            if (row.status !== undefined) {
              Object.assign(row, updates)
              affected = 1
              break
            }
          }
          return { affectedRows: affected }
        }),
      })),
    })),
  } as unknown as DrizzleSessionLike

  return { db, rows }
}

describe("DrizzleMySqlIdempotencyStore", () => {
  it("acquires a new reservation", async () => {
    const { db } = createSimulation()
    const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
    const result = await store.acquire({
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      leaseDurationMs: 30_000,
    })
    expect(result.outcome).toBe("acquired")
    expect(result).toHaveProperty("token")
  })

  it("returns replay when completed with same fingerprint", async () => {
    const { db, rows } = createSimulation()
    rows.set("test:k1", {
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      token: "tok",
      status: "completed",
      result: JSON.stringify({ ok: true }),
    })
    const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
    const result = await store.acquire({
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      leaseDurationMs: 30_000,
    })
    expect(result.outcome).toBe("replay")
    expect((result as { outcome: string; result: unknown }).result).toEqual({
      ok: true,
    })
  })

  it("returns conflict when fingerprint differs", async () => {
    const { db, rows } = createSimulation()
    rows.set("test:k1", {
      scope: "test",
      key: "k1",
      fingerprint: "different-fp",
      token: "tok",
      status: "completed",
      result: JSON.stringify({}),
    })
    const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
    const result = await store.acquire({
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      leaseDurationMs: 30_000,
    })
    expect(result.outcome).toBe("conflict")
  })

  it("returns business-committed for committed-but-unfinalized", async () => {
    const { db, rows } = createSimulation()
    rows.set("test:k1", {
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      token: "tok",
      status: "business-committed",
      result: null,
      resourceEntity: "Item",
      resourceId: "123",
    })
    const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
    const result = await store.acquire({
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      leaseDurationMs: 30_000,
    })
    expect(result.outcome).toBe("business-committed")
  })

  it("completes a reservation", async () => {
    const { db, rows } = createSimulation()
    rows.set("test:k1", {
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      token: "tok",
      status: "business-committed",
    })
    const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
    await store.complete({
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      token: "tok",
      result: { ok: true },
    })
    const row = rows.get("test:k1")
    expect(row?.status).toBe("completed")
  })

  it("recovers from in-progress to business-committed", async () => {
    const { db, rows } = createSimulation()
    rows.set("test:k1", {
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      token: "tok",
      status: "in-progress",
    })
    const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
    await store.recover({
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      token: "tok",
    })
    const row = rows.get("test:k1")
    expect(row?.status).toBe("business-committed")
  })

  it("renews a lease", async () => {
    const { db, rows } = createSimulation()
    rows.set("test:k1", {
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      token: "tok",
      status: "in-progress",
    })
    const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
    await store.renew({
      scope: "test",
      key: "k1",
      fingerprint: "fp1",
      token: "tok",
      leaseDurationMs: 30_000,
    })
    // Should not throw
  })

  it("rejects invalid lease duration", async () => {
    const { db } = createSimulation()
    const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
    await expect(
      store.acquire({
        scope: "test",
        key: "k1",
        fingerprint: "fp1",
        leaseDurationMs: 0,
      })
    ).rejects.toThrow("lease duration")
  })

  it("rejects lease duration > 24 hours", async () => {
    const { db } = createSimulation()
    const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
    await expect(
      store.acquire({
        scope: "test",
        key: "k1",
        fingerprint: "fp1",
        leaseDurationMs: 25 * 60 * 60 * 1000,
      })
    ).rejects.toThrow("lease duration")
  })
})
