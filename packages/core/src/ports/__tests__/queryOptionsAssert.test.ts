import { describe, expect, it, vi } from "vitest"
import { Predicate } from "../../domain/predicate"
import { ConfigurationError } from "../../foundation/errors"
import {
  assertQueryOptions,
  type EntityDescriptor,
  type ListResult,
  type PersistenceProvider,
  type Repository,
} from "../persistence"
import { createTenantScopedPersistenceProvider } from "../scopedPersistence"

type Row = { id: string; tenantId?: string; name: string }

const entity: EntityDescriptor<Row> = {
  name: "row",
  primaryKey: "id",
  tenantField: "tenantId",
  fields: {
    id: { type: "string" },
    tenantId: { type: "string", nullable: true },
    name: { type: "string" },
  },
}

function baseProvider(findMany: Repository<Row>["findMany"]): PersistenceProvider {
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
    repository: (() => ({
      findById: vi.fn(async () => null),
      findMany,
    })) as unknown as PersistenceProvider["repository"],
  }
}

describe("assertQueryOptions", () => {
  it("accepts undefined and well-formed options", () => {
    expect(() => assertQueryOptions(undefined)).not.toThrow()
    expect(() => assertQueryOptions({})).not.toThrow()
    expect(() =>
      assertQueryOptions({
        filter: Predicate.eq("name", "row"),
        pagination: { page: 1, pageSize: 10 },
        sort: [{ field: "name", direction: "asc" }],
      })
    ).not.toThrow()
  })

  it.each([
    ["null", null],
    ["array", []],
    ["string", "filter"],
  ])("rejects non-object options (%s)", (_label, options) => {
    expect(() => assertQueryOptions(options)).toThrow(ConfigurationError)
  })

  it("rejects malformed filters", () => {
    expect(() =>
      assertQueryOptions({ filter: { kind: "bogus" } })
    ).toThrow(ConfigurationError)
    expect(() =>
      assertQueryOptions({
        filter: { kind: "condition", field: "", op: "eq", value: 1 },
      })
    ).toThrow(ConfigurationError)
  })

  it.each([
    ["missing pagination object", "nope"],
    ["page zero", { page: 0, pageSize: 10 }],
    ["pageSize zero", { page: 1, pageSize: 0 }],
    ["non-integer page", { page: 1.5, pageSize: 10 }],
    ["missing pageSize", { page: 1 }],
  ])("rejects bad pagination (%s)", (_label, pagination) => {
    expect(() => assertQueryOptions({ pagination })).toThrow(ConfigurationError)
  })

  it.each([
    ["non-array sort", "name"],
    ["empty field", [{ field: "", direction: "asc" }]],
    ["bad direction", [{ field: "name", direction: "sideways" }]],
    ["non-object entry", ["name"]],
  ])("rejects bad sort (%s)", (_label, sort) => {
    expect(() => assertQueryOptions({ sort })).toThrow(ConfigurationError)
  })
})

describe("scoped findMany query validation", () => {
  it("rejects a bogus-kind filter with ConfigurationError before reaching the adapter", async () => {
    const findMany = vi.fn(async (): Promise<ListResult<Row>> => ({
      rows: [],
      rowCount: 0,
      page: 1,
      pageSize: 10,
    }))
    const scoped = createTenantScopedPersistenceProvider(
      baseProvider(findMany),
      "tenant-a"
    )
    await expect(
      scoped.repository(entity).findMany({ filter: { kind: "bogus" } as never })
    ).rejects.toBeInstanceOf(ConfigurationError)
    expect(findMany).not.toHaveBeenCalled()
  })
})
