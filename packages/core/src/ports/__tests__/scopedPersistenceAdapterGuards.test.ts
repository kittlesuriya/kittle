import { describe, expect, it, vi } from "vitest"
import { Predicate } from "../../domain"
import {
  ConfigurationError,
  TenantScopeViolationError,
} from "../../foundation/errors"
import { createTenantScopedPersistenceProvider } from "../scopedPersistence"
import type {
  EntityDescriptor,
  PersistenceProvider,
  Repository,
} from "../persistence"

type Row = {
  id: string
  tenantId: string
  name: string
}

const entity: EntityDescriptor<Row> = {
  name: "row",
  primaryKey: "id",
  tenantField: "tenantId",
  fields: {
    id: { type: "string" },
    tenantId: { type: "string" },
    name: { type: "string" },
  },
}

function makeRepo(overrides: Partial<Repository<Row>> = {}): Repository<Row> {
  return {
    findById: vi.fn(async () => null),
    findOneWhere: vi.fn(async () => null),
    findMany: vi.fn(async () => ({
      rows: [] as Row[],
      rowCount: 0,
      page: 1,
      pageSize: 10,
    })),
    insert: vi.fn(async (data: Partial<Row>): Promise<Row> => ({
      id: "1",
      name: "n",
      tenantId: "tenant-a",
      ...data,
    })),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  }
}

function scoped(repo: Repository<Row>) {
  const provider: PersistenceProvider = {
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
  }
  return createTenantScopedPersistenceProvider(
    provider,
    "tenant-a"
  ).repository(entity)
}

describe("scoped persistence adapter-return guards", () => {
  it("rejects cross-tenant rows on every read path", async () => {
    const foreign = { id: "1", tenantId: "tenant-b", name: "n" }
    const byId = scoped(makeRepo({ findOneWhere: vi.fn(async () => foreign) }))
    await expect(byId.findById("1")).rejects.toBeInstanceOf(
      TenantScopeViolationError
    )

    const oneWhere = scoped(
      makeRepo({ findOneWhere: vi.fn(async () => foreign) })
    )
    await expect(
      oneWhere.findOneWhere!(Predicate.eq("id", "1"))
    ).rejects.toBeInstanceOf(TenantScopeViolationError)

    const many = scoped(
      makeRepo({
        findMany: vi.fn(async () => ({
          rows: [
            { id: "1", tenantId: "tenant-a", name: "ok" },
            foreign,
          ],
          rowCount: 2,
          page: 1,
          pageSize: 10,
        })),
      })
    )
    await expect(
      many.findMany({ filter: Predicate.eq("name", "n") })
    ).rejects.toBeInstanceOf(TenantScopeViolationError)
  })

  it("rejects malformed rows and list shapes instead of returning them", async () => {
    const undefinedRow = scoped(
      makeRepo({ findOneWhere: vi.fn(async () => undefined as never) })
    )
    await expect(undefinedRow.findById("1")).rejects.toBeInstanceOf(
      ConfigurationError
    )

    for (const malformed of [
      { rows: null, rowCount: 0, page: 1, pageSize: 10 },
      { rows: [], rowCount: -1, page: 1, pageSize: 10 },
      { rows: [], rowCount: NaN, page: 1, pageSize: 10 },
      null,
    ]) {
      const repo = scoped(
        makeRepo({ findMany: vi.fn(async () => malformed as never) })
      )
      await expect(repo.findMany()).rejects.toBeInstanceOf(ConfigurationError)
    }
  })

  it("rejects cross-tenant echoes on write returns", async () => {
    const foreignInsert = scoped(
      makeRepo({
        insert: vi.fn(async () => ({
          id: "1",
          tenantId: "tenant-b",
          name: "n",
        })),
      })
    )
    await expect(foreignInsert.insert({ name: "n" })).rejects.toBeInstanceOf(
      TenantScopeViolationError
    )

    const foreignReturning = scoped(
      makeRepo({
        updateOneWhereReturning: vi.fn(async () => ({
          id: "1",
          tenantId: "tenant-b",
          name: "x",
        })),
      })
    )
    await expect(
      foreignReturning.updateOneWhereReturning!(
        Predicate.eq("id", "1"),
        { name: "x" }
      )
    ).rejects.toBeInstanceOf(TenantScopeViolationError)

    const foreignBulk = scoped(
      makeRepo({
        bulkInsert: vi.fn(async () => [
          { id: "1", tenantId: "tenant-a", name: "ok" },
          { id: "2", tenantId: "tenant-b", name: "bad" },
        ]),
      })
    )
    await expect(
      foreignBulk.bulkInsert!([{ name: "ok" }, { name: "bad" }])
    ).rejects.toBeInstanceOf(TenantScopeViolationError)
  })

  it("preserves null as no-match while rejecting undefined echoes", async () => {
    const repo = scoped(
      makeRepo({ updateOneWhereReturning: vi.fn(async () => null) })
    )
    await expect(
      repo.updateOneWhereReturning!(Predicate.eq("id", "1"), { name: "x" })
    ).resolves.toBeNull()

    const undefinedEcho = scoped(
      makeRepo({
        updateOneWhereReturning: vi.fn(async () => undefined as never),
      })
    )
    await expect(
      undefinedEcho.updateOneWhereReturning!(Predicate.eq("id", "1"), {
        name: "x",
      })
    ).rejects.toBeInstanceOf(ConfigurationError)
  })

  it("rejects malformed affected-count returns", async () => {
    const badUpdateCount = scoped(
      makeRepo({ updateOneWhere: vi.fn(async () => ({ updatedCount: "1" })) as never })
    )
    await expect(
      badUpdateCount.updateOneWhere!(Predicate.eq("id", "1"), { name: "x" })
    ).rejects.toBeInstanceOf(ConfigurationError)

    const missingDelete = scoped(
      makeRepo({ deleteWhere: vi.fn(async () => undefined as never) })
    )
    await expect(
      missingDelete.deleteWhere!(Predicate.eq("id", "1"))
    ).rejects.toBeInstanceOf(ConfigurationError)

    const nanMany = scoped(
      makeRepo({ updateManyWhere: vi.fn(async () => NaN as never) })
    )
    await expect(
      nanMany.updateManyWhere!(Predicate.eq("id", "1"), { name: "x" })
    ).rejects.toBeInstanceOf(ConfigurationError)
  })
})
