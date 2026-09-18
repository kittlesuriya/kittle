import { describe, expect, it } from "vitest"
import { pgTable, text } from "drizzle-orm/pg-core"
import { ConflictError } from "kittle-core/domain"
import { DrizzlePgIdempotencyStore } from "../drizzleIdempotencyStore"
import { createDrizzlePersistenceProvider } from "../drizzlePersistenceProvider"
import type { DrizzleSessionLike } from "../drizzleRepository"
import type { IdempotencyRequest } from "kittle-core/ports"

const idempotencyTable = pgTable("idempotency", {
  id: text("id"),
  scope: text("scope"),
  key: text("key"),
  fingerprint: text("fingerprint"),
  token: text("token"),
  status: text("status"),
  result: text("result"),
})

const DUP_ERROR = Object.assign(new Error("duplicate key value"), {
  code: "23505",
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
  insertError?: unknown
  selectRows?: unknown[][]
  updateResult?: unknown
} = {}) {
  let selectIndex = 0
  const whereArgs: unknown[] = []
  const setArgs: unknown[] = []
  const db = {
    insert: () => ({
      values: () => {
        if (options.insertError) {
          throw options.insertError instanceof Error
            ? options.insertError
            : new Error("insert failed")
        }
        return {}
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => options.selectRows?.[selectIndex++] ?? [],
        }),
      }),
    }),
    update: () => ({
      set: (data: unknown) => ({
        where: async (where: unknown) => {
          setArgs.push(data)
          whereArgs.push(where)
          return options.updateResult ?? { rowCount: 1 }
        },
      }),
    }),
  } as unknown as DrizzleSessionLike
  const store = new DrizzlePgIdempotencyStore(db, idempotencyTable)
  return { store, db, whereArgs, setArgs }
}

describe("PostgreSQL idempotency fencing", () => {
  it("never replays when the same key carries a different fingerprint", async () => {
    const { store } = createHarness({
      insertError: DUP_ERROR,
      // Even a completed row with a stored result must not replay on mismatch.
      selectRows: [[completedRow({ fingerprint: "fp-other" })]],
    })
    await expect(store.acquire(request())).resolves.toEqual({
      outcome: "conflict",
    })
  })

  it("replays a completed row only when the fingerprint matches", async () => {
    const { store } = createHarness({
      insertError: DUP_ERROR,
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
      insertError: DUP_ERROR,
      selectRows: [[row], [row]],
      updateResult: { rowCount: 0 },
    })
    await expect(store.acquire(request())).resolves.toEqual({
      outcome: "in-progress",
    })
  })

  it("allows lease takeover only for the same fingerprint after expiry", async () => {
    const row = completedRow({ status: "in-progress", result: null })
    const { store } = createHarness({
      insertError: DUP_ERROR,
      selectRows: [[row]],
      updateResult: { rowCount: 1 },
    })
    const acquired = await store.acquire(request())
    expect(acquired.outcome).toBe("acquired")
    if (acquired.outcome === "acquired") {
      expect(typeof acquired.token).toBe("string")
      expect(acquired.token.length).toBeGreaterThan(0)
    }
  })

  it("rejects renew with a wrong or stale token", async () => {
    const { store } = createHarness({ updateResult: { rowCount: 0 } })
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
    const { store } = createHarness({ updateResult: { rowCount: 0 } })
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
    const { store } = createHarness({ updateResult: { rowCount: 0 } })
    await expect(
      store.recover({
        scope: "s",
        key: "k",
        fingerprint: "fp-mine",
        token: "token-stale",
      })
    ).rejects.toThrow("lost ownership")
  })

  it("commits the receipt inside the caller's transaction session", async () => {
    const txUpdates: { table: unknown; data: Record<string, unknown> }[] = []
    const fakeTx = {
      update: (table: unknown) => ({
        set: (data: Record<string, unknown>) => ({
          where: async () => {
            txUpdates.push({ table, data })
            return { rowCount: 1 }
          },
        }),
      }),
    }
    const fakeDb = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(fakeTx),
    }
    const provider = createDrizzlePersistenceProvider({
      db: fakeDb as never,
      registry: { get: () => undefined },
    })
    const { store } = createHarness()

    await provider.runInTransaction(async (txProvider) => {
      await store.markCommittedInTransaction(
        {
          scope: "s",
          key: "k",
          fingerprint: "fp-mine",
          token: "token-mine",
          resource: { entity: "orders", id: "o1", version: 2 },
          invalidations: ["orders:list", "orders:list"],
        },
        txProvider
      )
    })

    // The marker ran exactly once, inside the transaction session: the receipt
    // is atomic with the business mutation, never a replayable response.
    expect(txUpdates).toHaveLength(1)
    expect(txUpdates[0]?.table).toBe(idempotencyTable)
    expect(txUpdates[0]?.data.status).toBe("business-committed")
    expect(txUpdates[0]?.data.result).toBeNull()
    expect(txUpdates[0]?.data.resourceId).toBe("o1")
  })

  it("fails the commit when ownership was lost before the mutation committed", async () => {
    const fakeTx = {
      update: () => ({
        set: () => ({
          where: async () => ({ rowCount: 0 }),
        }),
      }),
    }
    const fakeDb = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(fakeTx),
    }
    const provider = createDrizzlePersistenceProvider({
      db: fakeDb as never,
      registry: { get: () => undefined },
    })
    const { store } = createHarness()

    await expect(
      provider.runInTransaction(async (txProvider) => {
        await store.markCommittedInTransaction(
          { scope: "s", key: "k", fingerprint: "fp", token: "stale" },
          txProvider
        )
      })
    ).rejects.toBeInstanceOf(ConflictError)
  })
})
