import { describe, expect, it } from "vitest"
import { mysqlTable, text, int } from "drizzle-orm/mysql-core"
import { ConfigurationError } from "kittle-core/domain"
import { DrizzleEntityRegistry } from "../drizzlePersistenceProvider"

const table = mysqlTable("registry_rows", {
  id: text("id"),
  name: text("name"),
  version: int("version"),
})

const columns = {
  id: table.id,
  name: table.name,
  version: table.version,
}

const entity = {
  name: "registryRow",
  primaryKey: "id" as const,
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    version: { type: "number" as const },
  },
}

describe("DrizzleEntityRegistry (MySQL)", () => {
  it("registers and retrieves an entity mapping", () => {
    const registry = new DrizzleEntityRegistry()
    registry.register(entity, table, columns)
    const mapping = registry.get("registryRow")
    expect(mapping).toBeDefined()
    expect(mapping!.table).toBe(table)
    expect(mapping!.columnMap).toBe(columns)
  })

  it("supports namespace-scoped registration", () => {
    const registry = new DrizzleEntityRegistry()
    registry.register(entity, table, columns, "tenant1")
    expect(registry.get("registryRow", "tenant1")).toBeDefined()
    expect(registry.get("registryRow")).toBeUndefined()
    expect(registry.get("registryRow", "tenant2")).toBeUndefined()
  })

  it("allows extra column map keys beyond entity fields", () => {
    const registry = new DrizzleEntityRegistry()
    const extraColumns = { ...columns, extra: table.id }
    registry.register(entity, table, extraColumns)
    expect(registry.get("registryRow")).toBeDefined()
  })

  it("rejects empty entity name", () => {
    const registry = new DrizzleEntityRegistry()
    expect(() =>
      registry.register({ ...entity, name: "" }, table, columns)
    ).toThrow(ConfigurationError)
  })

  it("rejects entity without fields", () => {
    const registry = new DrizzleEntityRegistry()
    expect(() =>
      registry.register(
        { ...entity, name: "noFields", fields: {} },
        table,
        columns
      )
    ).toThrow(ConfigurationError)
  })

  it("rejects missing column map fields", () => {
    const registry = new DrizzleEntityRegistry()
    const incompleteColumns = { id: table.id }
    expect(() =>
      registry.register(entity, table, incompleteColumns)
    ).toThrow(ConfigurationError)
    expect(() =>
      registry.register(entity, table, incompleteColumns)
    ).toThrow(/missing fields/)
  })

  it("rejects empty column map key", () => {
    const registry = new DrizzleEntityRegistry()
    const badColumns = { ...columns, "": table.id }
    expect(() => registry.register(entity, table, badColumns)).toThrow(
      ConfigurationError
    )
  })

  it("rejects duplicate registration", () => {
    const registry = new DrizzleEntityRegistry()
    registry.register(entity, table, columns)
    expect(() => registry.register(entity, table, columns)).toThrow(
      ConfigurationError
    )
    expect(() => registry.register(entity, table, columns)).toThrow(
      /already registered/
    )
  })

  it("rejects unknown primary key", () => {
    const registry = new DrizzleEntityRegistry()
    expect(() =>
      registry.register(
        { ...entity, primaryKey: "nonexistent" as never },
        table,
        columns
      )
    ).toThrow(ConfigurationError)
  })

  it("rejects unknown version field", () => {
    const registry = new DrizzleEntityRegistry()
    expect(() =>
      registry.register(
        { ...entity, versionField: "nonexistent" as never },
        table,
        columns
      )
    ).toThrow(ConfigurationError)
  })

  it("returns undefined for unknown entity", () => {
    const registry = new DrizzleEntityRegistry()
    expect(registry.get("unknown")).toBeUndefined()
  })
})
