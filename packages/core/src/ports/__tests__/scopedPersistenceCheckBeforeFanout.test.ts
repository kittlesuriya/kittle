import { describe, expect, it, vi } from "vitest"
import { Predicate } from "../../domain"
import { TenantScopeViolationError } from "../../foundation/errors"
import { createTenantScopedPersistenceProvider } from "../scopedPersistence"
import type {
  EntityDescriptor,
  ListResult,
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

describe("Batch H: check-before-fanout lock", () => {
  it("stops after a forged row with no further adapter interaction", async () => {
    const forged: Row = { id: "1", tenantId: "tenant-b", name: "forged" }
    const findMany = vi.fn(async (): Promise<ListResult<Row>> => ({
      rows: [forged],
      rowCount: 1,
      page: 1,
      pageSize: 10,
    }))
    const repo = {
      findById: vi.fn(async () => null),
      findOneWhere: vi.fn(async () => null),
      findMany,
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as Repository<Row>
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
    const scopedRepo = createTenantScopedPersistenceProvider(
      provider,
      "tenant-a"
    ).repository(entity)

    let caught: unknown
    let result: ListResult<Row> | undefined
    try {
      result = await scopedRepo.findMany({
        filter: Predicate.eq("name", "n"),
      })
    } catch (error) {
      caught = error
    }

    // The forged row is rejected before any fan-out/caching/logging: the
    // caller never receives it and the adapter sees exactly one call.
    expect(caught).toBeInstanceOf(TenantScopeViolationError)
    expect(result).toBeUndefined()
    expect(findMany).toHaveBeenCalledTimes(1)
  })
})
