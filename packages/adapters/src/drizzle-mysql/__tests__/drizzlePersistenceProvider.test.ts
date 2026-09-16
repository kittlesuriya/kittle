import { describe, expect, it, vi } from "vitest"
import { mysqlTable, text } from "drizzle-orm/mysql-core"
import { ConfigurationError } from "kittle-core/domain"
import { createDrizzlePersistenceProvider, DrizzleEntityRegistry, getDrizzleSession } from "../drizzlePersistenceProvider"
import type { EntityDescriptor } from "kittle-core/ports"

const itemTable = mysqlTable("items", {
  id: text("id"),
  name: text("name"),
})

const entity: EntityDescriptor<{ id: string; name: string }> = {
  name: "Item",
  primaryKey: "id",
  fields: { id: { type: "string" }, name: { type: "string" } },
}

function createMockDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async () => ({ affectedRows: 1 })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => ({ affectedRows: 1 })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => ({ affectedRows: 1 })),
    })),
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work(createMockDb())
    ),
  }
}

describe("createDrizzlePersistenceProvider (MySQL)", () => {
  it("returns a provider with MySQL dialect", () => {
    const db = createMockDb()
    const registry = new DrizzleEntityRegistry()
    registry.register(entity, itemTable, {
      id: itemTable.id,
      name: itemTable.name,
    })
    const provider = createDrizzlePersistenceProvider({ db: db as never, registry })
    expect(provider.dialect).toBe("mysql")
  })

  it("exposes correct capabilities", () => {
    const db = createMockDb()
    const registry = new DrizzleEntityRegistry()
    registry.register(entity, itemTable, {
      id: itemTable.id,
      name: itemTable.name,
    })
    const provider = createDrizzlePersistenceProvider({ db: db as never, registry })
    expect(provider.capabilities.interactiveTransactions).toBe(true)
    expect(provider.capabilities.atomicBatch).toBe(false)
    expect(provider.capabilities.returningInsert).toBe(false)
    expect(provider.capabilities.persistentConnection).toBe(true)
  })

  it("creates a repository for a registered entity", () => {
    const db = createMockDb()
    const registry = new DrizzleEntityRegistry()
    registry.register(entity, itemTable, {
      id: itemTable.id,
      name: itemTable.name,
    })
    const provider = createDrizzlePersistenceProvider({ db: db as never, registry })
    const repo = provider.repository(entity)
    expect(repo).toBeDefined()
    expect(typeof repo.findById).toBe("function")
  })

  it("throws for unregistered entity", () => {
    const db = createMockDb()
    const registry = new DrizzleEntityRegistry()
    const provider = createDrizzlePersistenceProvider({ db: db as never, registry })
    expect(() => provider.repository(entity)).toThrow(ConfigurationError)
    expect(() => provider.repository(entity)).toThrow(/not registered/)
  })

  it("supports runInTransaction", async () => {
    const db = createMockDb()
    const registry = new DrizzleEntityRegistry()
    registry.register(entity, itemTable, {
      id: itemTable.id,
      name: itemTable.name,
    })
    const provider = createDrizzlePersistenceProvider({ db: db as never, registry })
    const result = await provider.runInTransaction(async (scoped) => {
      expect(scoped.dialect).toBe("mysql")
      return "done"
    })
    expect(result).toBe("done")
    expect(db.transaction).toHaveBeenCalled()
  })

  it("rejects nested transactions", async () => {
    const db = createMockDb()
    const registry = new DrizzleEntityRegistry()
    registry.register(entity, itemTable, {
      id: itemTable.id,
      name: itemTable.name,
    })
    const provider = createDrizzlePersistenceProvider({ db: db as never, registry })
    await expect(
      provider.runInTransaction(async (scoped) => {
        await scoped.runInTransaction(async () => "nested")
      })
    ).rejects.toThrow(ConfigurationError)
  })

  it("validates maxPageSize limit", () => {
    const db = createMockDb()
    const registry = new DrizzleEntityRegistry()
    expect(() =>
      createDrizzlePersistenceProvider({
        db: db as never,
        registry,
        limits: { maxPageSize: -1 },
      })
    ).toThrow(ConfigurationError)
  })
})

describe("getDrizzleSession", () => {
  it("returns the session for a provider", () => {
    const db = createMockDb()
    const registry = new DrizzleEntityRegistry()
    registry.register(entity, itemTable, {
      id: itemTable.id,
      name: itemTable.name,
    })
    const provider = createDrizzlePersistenceProvider({ db: db as never, registry })
    const session = getDrizzleSession(provider)
    expect(session).toBeDefined()
    expect(typeof session.select).toBe("function")
  })

  it("throws for unknown provider", () => {
    expect(() =>
      getDrizzleSession({ dialect: "unknown" } as never)
    ).toThrow(ConfigurationError)
  })
})
