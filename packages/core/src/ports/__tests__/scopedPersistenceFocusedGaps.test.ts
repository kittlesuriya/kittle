import { describe, expect, it, vi } from "vitest"
import { Predicate } from "../../domain"
import {
  ConfigurationError,
  ImmutableFieldViolationError,
  NotFoundError,
  TenantScopeViolationError,
  UnsupportedCapabilityError,
} from "../../foundation/errors"
import { createTenantScopedPersistenceProvider } from "../scopedPersistence"
import {
  type EntityDescriptor,
  type PersistenceProvider,
  type Repository,
} from "../persistence"

type Row = {
  id: string
  tenantId: string
  version?: number
  createdBy?: string
  name: string
}
const occ = { optimisticConcurrency: { expectedVersion: 1 } }
const entity: EntityDescriptor<Row> = {
  name: "row",
  primaryKey: "id",
  tenantField: "tenantId",
  versionField: "version",
  immutableFields: ["createdBy"],
  fields: {
    id: { type: "string" },
    tenantId: { type: "string" },
    version: { type: "number" },
    createdBy: { type: "string", nullable: true },
    name: { type: "string" },
  },
}
function makeRepo(overrides: Partial<Repository<Row>> = {}): Repository<Row> {
  return {
    findById: vi.fn(async (): Promise<Row | null> => null),
    findMany: vi.fn(async () => ({
      rows: [] as Row[],
      rowCount: 0,
      page: 1,
      pageSize: 1,
    })),
    insert: vi.fn(async (data: Partial<Row>): Promise<Row> => ({
      id: "1",
      name: "n",
      tenantId: "tenant-a",
      version: 1,
      ...data,
    })),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  }
}
function makeProvider(
  repo: Repository<Row>,
  extras: Record<string, unknown> = {}
): PersistenceProvider {
  return {
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
    repository: (() => repo) as PersistenceProvider["repository"],
    ...extras,
  }
}

describe("scoped persistence fallback and failure paths", () => {
  it("requires expectedVersion for every versioned scoped mutation", async () => {
    const repo = makeRepo({
      deleteWhere: vi.fn(async () => ({ deletedCount: 1 })),
    })
    const scoped = createTenantScopedPersistenceProvider(
      makeProvider(repo),
      "tenant-a"
    ).repository(entity)

    await expect(scoped.update("1", { name: "x" })).rejects.toThrow(
      "expectedVersion"
    )
    await expect(scoped.delete("1")).rejects.toThrow("expectedVersion")
  })

  it.each([
    ["primary key", { id: "other" }, ImmutableFieldViolationError],
    ["version", { version: 2 }, ImmutableFieldViolationError],
    ["tenant", { tenantId: "tenant-b" }, TenantScopeViolationError],
    ["immutable", { createdBy: "other" }, ImmutableFieldViolationError],
  ] as const)(
    "rejects protected %s fields on every scoped update path",
    async (_field, patch, error) => {
      const update = vi.fn()
      const updateOneWhere = vi.fn()
      const updateManyWhere = vi.fn()
      const repo = makeRepo({ update, updateOneWhere, updateManyWhere })
      const scoped = createTenantScopedPersistenceProvider(
        makeProvider(repo),
        "tenant-a"
      ).repository(entity)

      await expect(scoped.update("1", patch)).rejects.toBeInstanceOf(error)
      await expect(
        scoped.updateOneWhere!(Predicate.alwaysTrue(), patch)
      ).rejects.toBeInstanceOf(error)
      await expect(
        scoped.updateManyWhere!(Predicate.alwaysTrue(), patch)
      ).rejects.toBeInstanceOf(error)
      expect(update).not.toHaveBeenCalled()
      expect(updateOneWhere).not.toHaveBeenCalled()
      expect(updateManyWhere).not.toHaveBeenCalled()
    }
  )

  it("applies protected-field validation to non-tenant scoped wrappers", async () => {
    const update = vi.fn()
    const updateOneWhere = vi.fn()
    const updateManyWhere = vi.fn()
    const repo = makeRepo({ update, updateOneWhere, updateManyWhere })
    const { tenantField: _tenantField, ...globalEntity } = entity
    expect(() =>
      createTenantScopedPersistenceProvider(
        makeProvider(repo),
        "tenant-a"
      ).repository(globalEntity)
    ).toThrow(TenantScopeViolationError)
    expect(update).not.toHaveBeenCalled()
    expect(updateOneWhere).not.toHaveBeenCalled()
    expect(updateManyWhere).not.toHaveBeenCalled()
  })

  it("falls back to findMany for reads and requires exact-row update semantics", async () => {
    const repo = makeRepo({
      findMany: vi.fn(async () => ({
        rows: [{ id: "1", tenantId: "tenant-a", name: "n" }],
        rowCount: 1,
        page: 1,
        pageSize: 1,
      })),
    })
    const scoped = createTenantScopedPersistenceProvider(
      makeProvider(repo),
      "tenant-a"
    ).repository(entity)
    await expect(scoped.findById("1")).resolves.toEqual(
      expect.objectContaining({ id: "1" })
    )
    await expect(scoped.findOneWhere!(Predicate.alwaysTrue())).resolves.toEqual(
      expect.objectContaining({ id: "1" })
    )

    // Without updateOneWhereReturning, an exact post-mutation row cannot be
    // guaranteed; the update-then-read fallback could observe a concurrent
    // writer and is refused.
    const updateOneWhere = vi.fn(async () => ({ updatedCount: 0 }))
    const updateRepo = makeRepo({ updateOneWhere })
    const updateScoped = createTenantScopedPersistenceProvider(
      makeProvider(updateRepo),
      "tenant-a"
    ).repository(entity)
    await expect(
      updateScoped.update("1", { name: "x" }, occ)
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError)
    expect(updateOneWhere).not.toHaveBeenCalled()

    const updateOneWhereReturning = vi.fn<() => Promise<Row | null>>(
      async () => null
    )
    const returningRepo = makeRepo({ updateOneWhereReturning })
    const returningScoped = createTenantScopedPersistenceProvider(
      makeProvider(returningRepo),
      "tenant-a"
    ).repository(entity)
    await expect(
      returningScoped.update("1", { name: "x" }, occ)
    ).rejects.toBeInstanceOf(NotFoundError)
    updateOneWhereReturning.mockResolvedValue({
      id: "1",
      tenantId: "tenant-a",
      name: "x",
    })
    await expect(
      returningScoped.update("1", { name: "x" }, occ)
    ).resolves.toEqual(expect.objectContaining({ name: "x" }))
  })

  it("uses the inferred id and returns the exact post-mutation row from a scoped update", async () => {
    const repo = makeRepo({
      findMany: vi.fn(async () => ({
        rows: [{ id: "1", tenantId: "tenant-a", name: "updated" }],
        rowCount: 1,
        page: 1,
        pageSize: 1,
      })),
      updateOneWhereReturning: vi.fn(async () => ({
        id: "1",
        tenantId: "tenant-a",
        name: "updated",
      })),
    })
    delete repo.findOneWhere
    const { primaryKey: _primaryKey, ...inferredEntity } = entity
    const scoped = createTenantScopedPersistenceProvider(
      makeProvider(repo),
      "tenant-a"
    ).repository(inferredEntity)
    await expect(scoped.findById("1")).resolves.toEqual(
      expect.objectContaining({ id: "1" })
    )
    await expect(scoped.update("1", { name: "updated" }, occ)).resolves.toEqual(
      expect.objectContaining({ name: "updated" })
    )
  })

  it("supports successful scoped deletes and preserves explicit tenant values", async () => {
    const deleteWhere = vi.fn(async () => ({ deletedCount: 1 }))
    const insert = vi.fn(async (data: Partial<Row>): Promise<Row> => ({
      id: "1",
      name: "n",
      tenantId: "tenant-a",
      ...data,
    }))
    const repo = makeRepo({ deleteWhere, insert })
    const scoped = createTenantScopedPersistenceProvider(
      makeProvider(repo),
      "tenant-a"
    ).repository(entity)

    await expect(scoped.delete("1", occ)).resolves.toBeUndefined()
    await expect(
      scoped.insert({ name: "created", tenantId: "tenant-a" })
    ).resolves.toMatchObject({ tenantId: "tenant-a" })
    expect(deleteWhere).toHaveBeenCalledOnce()
    expect(insert).toHaveBeenCalledWith({
      name: "created",
      tenantId: "tenant-a",
    })
  })

  it("rejects unsupported scoped operations and missing primary-key capabilities", async () => {
    const repo = makeRepo()
    delete repo.updateOneWhere
    delete repo.updateManyWhere
    delete repo.deleteWhere
    const scoped = createTenantScopedPersistenceProvider(
      makeProvider(repo),
      "tenant-a"
    ).repository(entity)
    await expect(scoped.update("1", { name: "x" }, occ)).rejects.toBeInstanceOf(
      UnsupportedCapabilityError
    )
    await expect(
      scoped.updateOneWhere!(Predicate.alwaysTrue(), { name: "x" }, occ)
    ).rejects.toBeInstanceOf(ConfigurationError)
    await expect(
      scoped.updateManyWhere!(Predicate.alwaysTrue(), { name: "x" }, occ)
    ).rejects.toBeInstanceOf(ConfigurationError)
    await expect(scoped.delete("1", occ)).rejects.toBeInstanceOf(
      UnsupportedCapabilityError
    )
    await expect(
      scoped.deleteWhere!(Predicate.alwaysTrue(), occ)
    ).rejects.toBeInstanceOf(ConfigurationError)
  })

  it("rejects always-true destructive filters unconditionally", async () => {
    const deleteWhere = vi.fn(async () => ({ deletedCount: 1 }))
    const repo = makeRepo({ deleteWhere })
    const scoped = createTenantScopedPersistenceProvider(
      makeProvider(repo),
      "tenant-a"
    ).repository(entity)

    await expect(
      scoped.deleteWhere!(Predicate.alwaysTrue(), occ)
    ).rejects.toThrow("cannot target every row")
    expect(deleteWhere).not.toHaveBeenCalled()
  })

  it("rejects insert and bulkInsert with a conflicting tenant field", async () => {
    const insert = vi.fn(async (data: Partial<Row>): Promise<Row> => ({
      id: "1",
      name: "n",
      tenantId: "tenant-a",
      ...data,
    }))
    const bulkInsert = vi.fn(async (rows: Partial<Row>[]) =>
      rows.map((row) => ({ id: "1", name: "n", tenantId: "tenant-a", ...row }))
    )
    const repo = makeRepo({ insert, bulkInsert })
    const scoped = createTenantScopedPersistenceProvider(
      makeProvider(repo),
      "tenant-a"
    ).repository(entity)

    await expect(
      scoped.insert({ name: "x", tenantId: "tenant-b" })
    ).rejects.toBeInstanceOf(TenantScopeViolationError)
    await expect(
      scoped.bulkInsert!([{ id: "1", name: "x", tenantId: "tenant-b" }])
    ).rejects.toBeInstanceOf(TenantScopeViolationError)
    expect(insert).not.toHaveBeenCalled()
    expect(bulkInsert).not.toHaveBeenCalled()

    await expect(
      scoped.insert({ name: "x", tenantId: "tenant-a" })
    ).resolves.toMatchObject({ tenantId: "tenant-a" })
    await expect(
      scoped.bulkInsert!([{ id: "1", name: "x", tenantId: "tenant-a" }])
    ).resolves.toMatchObject([{ tenantId: "tenant-a" }])
    expect(insert).toHaveBeenCalledWith({ name: "x", tenantId: "tenant-a" })
  })

  it("wraps transactions and bulk inserts while rejecting forged tenant records", async () => {
    const repo = makeRepo({
      bulkInsert: vi.fn(async (rows: Partial<Row>[]) =>
        rows.map((row) => ({
          id: "1",
          name: "n",
          tenantId: "tenant-a",
          ...row,
        }))
      ),
    })
    const transaction = vi.fn(
      async (work: (provider: PersistenceProvider) => Promise<unknown>) =>
        work(makeProvider(repo))
    )
    const scoped = createTenantScopedPersistenceProvider(
      makeProvider(repo, { runInTransaction: transaction }),
      "tenant-a"
    )
    await scoped.repository(entity).bulkInsert!([
      { id: "1", name: "x", tenantId: "tenant-a" },
    ])
    await (
      scoped as PersistenceProvider & { runInTransaction: typeof transaction }
    ).runInTransaction(async (tx) => tx.repository(entity).findMany())
    expect(transaction).toHaveBeenCalledOnce()

    const atomic = vi.fn(async () => [])
    const noEncoder = createTenantScopedPersistenceProvider(
      makeProvider(repo, {
        capabilities: { ...makeProvider(repo).capabilities, atomicBatch: true },
        executeAtomicBatch: atomic,
      }),
      "tenant-a"
    )
    await expect(
      (
        noEncoder as unknown as {
          executeAtomicBatch: (plan: unknown) => Promise<unknown>
        }
      ).executeAtomicBatch({ items: [] })
    ).rejects.toThrow("command encoder")

    const globalRepo = makeRepo({
      update: vi.fn(async (id: string, data: Partial<Row>): Promise<Row> => ({
        id,
        name: "n",
        tenantId: "tenant-a",
        ...data,
      })),
      updateOneWhere: vi.fn(async () => ({ updatedCount: 1 })),
      updateManyWhere: vi.fn(async () => 1),
    })
    const { tenantField: _tenantField, ...globalEntity } = entity
    expect(() =>
      createTenantScopedPersistenceProvider(
        makeProvider(globalRepo),
        "tenant-a"
      ).repository(globalEntity)
    ).toThrow(TenantScopeViolationError)

    const { primaryKey: _fallbackPrimaryKey, ...fallbackEntity } = globalEntity
    expect(() =>
      createTenantScopedPersistenceProvider(
        makeProvider(globalRepo),
        "tenant-a"
      ).repository(fallbackEntity)
    ).toThrow(TenantScopeViolationError)
  })
})
