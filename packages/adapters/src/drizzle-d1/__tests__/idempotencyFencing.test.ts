import { describe, expect, it } from "vitest"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { DrizzleD1IdempotencyStore } from "../drizzleIdempotencyStore"
import type { DrizzleSessionLike } from "../drizzleRepository"
import type { IdempotencyRequest } from "kittle-core/ports"

const idempotencyTable = sqliteTable("idempotency", {
  id: text("id"),
  scope: text("scope"),
  key: text("key"),
  fingerprint: text("fingerprint"),
  token: text("token"),
  status: text("status"),
  result: text("result"),
  pendingInvalidations: text("pending_invalidations"),
  resourceEntity: text("resource_entity"),
  resourceId: text("resource_id"),
  resourceVersion: text("resource_version"),
  createdAt: integer("created_at"),
  completedAt: integer("completed_at"),
  finalizerClaimOwner: text("finalizer_claim_owner"),
  finalizerClaimToken: text("finalizer_claim_token"),
  finalizerClaimExpiresAt: integer("finalizer_claim_expires_at"),
})

function request(overrides: Partial<IdempotencyRequest> = {}): IdempotencyRequest {
  return {
    scope: "tenant:t1:orders:create:principal:u1",
    key: "key-1",
    fingerprint: "fp-mine",
    ...overrides,
  }
}

function completedRow(overrides: Record<string, unknown> = {}) {
  return {
    scope: "tenant:t1:orders:create:principal:u1",
    key: "key-1",
    fingerprint: "fp-mine",
    token: "token-original",
    status: "completed",
    result: JSON.stringify({ ok: true }),
    pendingInvalidations: null,
    resourceEntity: null,
    resourceId: null,
    resourceVersion: null,
    ...overrides,
  }
}

function createHarness(options: {
  insertChanges?: number
  selectRows?: unknown[][]
  updateChanges?: number
} = {}) {
  let selectIndex = 0
  const db = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => ({
          meta: { changes: options.insertChanges ?? 1 },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => options.selectRows?.[selectIndex++] ?? [],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => ({ meta: { changes: options.updateChanges ?? 1 } }),
      }),
    }),
  } as unknown as DrizzleSessionLike
  const store = new DrizzleD1IdempotencyStore(db, idempotencyTable)
  return { store, db }
}

describe("D1 idempotency fencing", () => {
  it("acquires a fresh reservation through the conflict primitive", async () => {
    const { store } = createHarness({ insertChanges: 1 })
    const acquired = await store.acquire(request())
    expect(acquired.outcome).toBe("acquired")
    if (acquired.outcome === "acquired") {
      expect(typeof acquired.token).toBe("string")
      expect(acquired.token.length).toBeGreaterThan(0)
    }
  })

  it("never replays when the same key carries a different fingerprint", async () => {
    const { store } = createHarness({
      insertChanges: 0,
      selectRows: [[completedRow({ fingerprint: "fp-other" })]],
    })
    await expect(store.acquire(request())).resolves.toEqual({
      outcome: "conflict",
    })
  })

  it("replays a completed row only when the fingerprint matches", async () => {
    const { store } = createHarness({
      insertChanges: 0,
      selectRows: [[completedRow()]],
    })
    await expect(store.acquire(request())).resolves.toEqual({
      outcome: "replay",
      result: { ok: true },
    })
  })

  it("reports in-progress (not acquired) while a matching lease is fresh", async () => {
    const row = completedRow({ status: "in-progress", result: null })
    const { store } = createHarness({
      insertChanges: 0,
      selectRows: [[row], [row]],
      updateChanges: 0,
    })
    await expect(store.acquire(request())).resolves.toEqual({
      outcome: "in-progress",
    })
  })

  it("rejects renew with a wrong or stale token", async () => {
    const { store } = createHarness({ updateChanges: 0 })
    await expect(
      store.renew({
        scope: "s",
        key: "k",
        fingerprint: "fp-mine",
        token: "token-stale",
      })
    ).rejects.toThrow("lost ownership")
  })

  it("rejects complete with a wrong or stale token", async () => {
    const { store } = createHarness({ updateChanges: 0 })
    await expect(
      store.complete({
        scope: "s",
        key: "k",
        fingerprint: "fp-mine",
        token: "token-stale",
        result: { ok: true },
      })
    ).rejects.toThrow("lost ownership")
  })

  it("rejects recover with a wrong or stale token", async () => {
    const { store } = createHarness({ updateChanges: 0 })
    await expect(
      store.recover({
        scope: "s",
        key: "k",
        fingerprint: "fp-mine",
        token: "token-stale",
      })
    ).rejects.toThrow("lost ownership")
  })

  it("builds an atomic-batch commit receipt that never carries a replayable response", async () => {
    const { store } = createHarness()
    const item = store.createCommitBatchItem({
      scope: "s",
      key: "k",
      fingerprint: "fp-mine",
      token: "token-mine",
      resource: { entity: "orders", id: "o1", version: 2 },
      invalidations: ["orders:list", "orders:list"],
    })
    expect(item.kind).toBe("idempotency")
    if (item.kind !== "idempotency") throw new Error("unreachable")
    // The receipt is identity + obligations only; complete() writes the
    // replayable response. A stored result here would be a replay hole.
    expect("result" in item.commit).toBe(false)
    expect(item.commit).toMatchObject({
      scope: "s",
      key: "k",
      fingerprint: "fp-mine",
      token: "token-mine",
      resource: { entity: "orders", id: "o1", version: 2 },
    })
    expect(item.commit.invalidations).toEqual(["orders:list"])
  })
})
