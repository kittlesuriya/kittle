import { describe, expect, it } from "vitest"
import { mysqlTable, text } from "drizzle-orm/mysql-core"
import { MySqlDialect } from "drizzle-orm/mysql-core/dialect"
import type { SQL } from "drizzle-orm"
import { ConflictError } from "kittle-core/domain"
import { DrizzleMySqlIdempotencyStore } from "../drizzleIdempotencyStore"
import { createDrizzlePersistenceProvider } from "../drizzlePersistenceProvider"
import type { DrizzleSessionLike } from "../drizzleRepository"
import type { IdempotencyRequest } from "kittle-core/ports"

const dialect = new MySqlDialect()

const idempotencyTable = mysqlTable("idempotency", {
  id: text("id"),
  scope: text("scope"),
  key: text("key"),
  fingerprint: text("fingerprint"),
  token: text("token"),
  status: text("status"),
  result: text("result"),
})

const DUP_ERROR = Object.assign(new Error("Duplicate entry"), {
  code: "ER_DUP_ENTRY",
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
  const db = {
    insert: () => ({
      values: () => {
        if (options.insertError) {
          throw options.insertError instanceof Error
            ? options.insertError
            : new Error("insert failed")
        }
        return { affectedRows: 1 }
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
      set: () => ({
        where: async (where: unknown) => {
          whereArgs.push(where)
          return options.updateResult ?? { affectedRows: 1 }
        },
      }),
    }),
  } as unknown as DrizzleSessionLike
  const store = new DrizzleMySqlIdempotencyStore(db, idempotencyTable)
  return { store, db, whereArgs }
}

describe("MySQL idempotency fencing", () => {
  it("never replays when the same key carries a different fingerprint", async () => {
    const { store } = createHarness({
      insertError: DUP_ERROR,
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
      updateResult: { affectedRows: 0 },
    })
    await expect(store.acquire(request())).resolves.toEqual({
      outcome: "in-progress",
    })
  })

  it("rejects renew with a wrong or stale token", async () => {
    const { store } = createHarness({ updateResult: { affectedRows: 0 } })
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
    const { store } = createHarness({ updateResult: { affectedRows: 0 } })
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
    const { store } = createHarness({ updateResult: { affectedRows: 0 } })
    await expect(
      store.recover({
        scope: "s",
        key: "k",
        fingerprint: "fp-mine",
        token: "token-stale",
      })
    ).rejects.toThrow("lost ownership")
  })

  it("scopes invalidation claims to the exact reservation row", async () => {
    const row = {
      scope: "tenant:t1:orders:create:principal:u1",
      key: "key-1",
      fingerprint: "fp-mine",
      token: "token-mine",
      pendingInvalidations: JSON.stringify(["orders:list"]),
      result: null,
    }
    const { store, whereArgs } = createHarness({
      selectRows: [[row]],
      updateResult: { affectedRows: 1 },
    })
    const claimed = await store.claimPendingInvalidations({
      claimOwner: "finalizer-1",
      leaseMs: 30_000,
    })
    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toMatchObject({
      scope: row.scope,
      key: row.key,
      token: row.token,
    })
    // The claim UPDATE must fence on the exact (scope, key, token) row —
    // a global claim predicate could steal another reservation's obligations.
    const claimWhere = whereArgs[whereArgs.length - 1] as SQL<unknown>
    const rendered = dialect.sqlToQuery(claimWhere)
    expect(rendered.sql).toContain("scope")
    expect(rendered.sql).toContain("token")
    expect(rendered.params).toContain(row.scope)
    expect(rendered.params).toContain(row.key)
    expect(rendered.params).toContain(row.token)
  })

  it("commits the receipt inside the caller's transaction session", async () => {
    const txUpdates: { table: unknown; data: Record<string, unknown> }[] = []
    const fakeTx = {
      update: (table: unknown) => ({
        set: (data: Record<string, unknown>) => ({
          where: async () => {
            txUpdates.push({ table, data })
            return { affectedRows: 1 }
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
          where: async () => ({ affectedRows: 0 }),
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
