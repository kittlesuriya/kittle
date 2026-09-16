import { describe, expect, it, vi } from "vitest"
import { mysqlTable, text, int } from "drizzle-orm/mysql-core"
import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
  OptimisticConcurrencyError,
  ValidationError,
} from "kittle-core/domain"
import {
  createDrizzleRepository,
  type DrizzleSessionLike,
  type DrizzleUpdateResult,
} from "../drizzleRepository"
import type { EntityDescriptor } from "kittle-core/ports"

const itemTable = mysqlTable("items", {
  id: text("id"),
  name: text("name"),
  status: text("status"),
  version: int("version"),
})

const columnMap = {
  id: itemTable.id,
  name: itemTable.name,
  status: itemTable.status,
  version: itemTable.version,
}

// Entity without versionField for basic tests
const entity: EntityDescriptor<{
  id: string
  name: string
  status: string
}> = {
  name: "Item",
  primaryKey: "id",
  fields: {
    id: { type: "string" },
    name: { type: "string" },
    status: { type: "string" },
  },
}

// Entity with versionField for OCC tests
const versionedEntity: EntityDescriptor<{
  id: string
  name: string
  status: string
  version: number
}> = {
  name: "Item",
  primaryKey: "id",
  versionField: "version",
  fields: {
    id: { type: "string" },
    name: { type: "string" },
    status: { type: "string" },
    version: { type: "number" },
  },
}

function createDb(overrides: {
  selectRows?: Record<string, unknown>[]
  updateAffectedRows?: number
  insertError?: Error
} = {}): DrizzleSessionLike {
  const selectRows = overrides.selectRows ?? []
  const updateAffected = overrides.updateAffectedRows ?? 1

  const db: DrizzleSessionLike = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectRows),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              offset: vi.fn(async () => selectRows),
            })),
          })),
        })),
      })),
    })) as unknown as DrizzleSessionLike["select"],
    insert: vi.fn(() => ({
      values: overrides.insertError
        ? (() => { throw overrides.insertError })()
        : vi.fn(async () => ({ affectedRows: 1 })),
    })) as unknown as DrizzleSessionLike["insert"],
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async (): Promise<DrizzleUpdateResult> => ({
          affectedRows: updateAffected,
        })),
      })),
    })) as unknown as DrizzleSessionLike["update"],
    delete: vi.fn(() => ({
      where: vi.fn(async (): Promise<DrizzleUpdateResult> => ({
        affectedRows: 1,
      })),
    })) as unknown as DrizzleSessionLike["delete"],
  }
  return db
}

function createRepo(db: DrizzleSessionLike, useVersioned = false) {
  return createDrizzleRepository({
    db,
    table: itemTable,
    entity: useVersioned ? versionedEntity : entity,
    columnMap,
  })
}

describe("createDrizzleRepository (MySQL)", () => {
  describe("findById", () => {
    it("returns a row when found", async () => {
      const db = createDb({ selectRows: [{ id: "1", name: "Test" }] })
      const repo = createRepo(db)
      const result = await repo.findById("1")
      expect(result).toEqual({ id: "1", name: "Test" })
    })

    it("returns null when not found", async () => {
      const db = createDb({ selectRows: [] })
      const repo = createRepo(db)
      const result = await repo.findById("missing")
      expect(result).toBeNull()
    })
  })

  describe("findMany", () => {
    it("returns rows with pagination", async () => {
      const rows = [
        { id: "1", name: "A" },
        { id: "2", name: "B" },
      ]
      const db = createDb({ selectRows: rows })
      const repo = createRepo(db)
      const result = await repo.findMany()
      expect(result.rows).toEqual(rows)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })
  })

  describe("insert", () => {
    it("inserts and reads back the row (MySQL has no .returning())", async () => {
      const db = createDb({
        selectRows: [{ id: "1", name: "New" }],
      })
      const repo = createRepo(db)
      const result = await repo.insert({ id: "1", name: "New" })
      expect(result).toEqual({ id: "1", name: "New" })
    })

    it("maps unique constraint errors to ConflictError", async () => {
      const error = new Error("Duplicate entry") as Error & { code: string }
      error.code = "ER_DUP_ENTRY"
      const db = createDb({ insertError: error })
      const repo = createRepo(db)
      await expect(
        repo.insert({ id: "1", name: "Dup" })
      ).rejects.toThrow(ConflictError)
    })
  })

  describe("update", () => {
    it("updates and returns the updated row", async () => {
      const db = createDb({
        selectRows: [{ id: "1", name: "Updated" }],
        updateAffectedRows: 1,
      })
      const repo = createRepo(db)
      const result = await repo.update("1", { name: "Updated" })
      expect(result.name).toBe("Updated")
    })

    it("throws NotFoundError when affectedRows is 0", async () => {
      const db = createDb({
        selectRows: [],
        updateAffectedRows: 0,
      })
      const repo = createRepo(db)
      await expect(repo.update("missing", { name: "X" })).rejects.toThrow(
        NotFoundError
      )
    })
  })

  describe("update with versioned entity", () => {
    it("rejects setting version field directly", async () => {
      const db = createDb()
      const repo = createRepo(db, true)
      await expect(
        repo.update("1", { version: 99 } as never, {
          optimisticConcurrency: { expectedVersion: 1 },
        })
      ).rejects.toThrow(ConfigurationError)
    })

    it("rejects optimistic concurrency without version field on entity", async () => {
      const entityNoVersion = { ...versionedEntity, versionField: undefined }
      const db = createDb()
      const repo = createDrizzleRepository({
        db,
        table: itemTable,
        entity: entityNoVersion,
        columnMap,
      })
      await expect(
        repo.update("1", { name: "X" }, { optimisticConcurrency: { expectedVersion: 1 } })
      ).rejects.toThrow(ConfigurationError)
    })
  })

  describe("updateOneWhere", () => {
    it("rejects empty predicate", async () => {
      const db = createDb()
      const repo = createRepo(db)
      await expect(
        repo.updateOneWhere(undefined as never, { name: "X" })
      ).rejects.toThrow(ValidationError)
    })

    it("rejects always-true predicate (all-row destructive)", async () => {
      const db = createDb()
      const repo = createRepo(db)
      await expect(
        repo.updateOneWhere(
          { kind: "literal", value: true } as never,
          { name: "X" }
        )
      ).rejects.toThrow(ConfigurationError)
    })

    it("returns updatedCount: 0 when no rows match", async () => {
      const db = createDb({ selectRows: [], updateAffectedRows: 0 })
      const repo = createRepo(db)
      const result = await repo.updateOneWhere(
        { kind: "condition", field: "status", op: "eq", value: "active" } as never,
        { name: "X" }
      )
      expect(result.updatedCount).toBe(0)
    })
  })

  describe("delete", () => {
    it("deletes successfully", async () => {
      const db = createDb()
      const repo = createRepo(db)
      await expect(repo.delete("1")).resolves.toBeUndefined()
    })

    it("throws NotFoundError when record not found", async () => {
      const db = createDb({ updateAffectedRows: 0 })
      // Override delete to return 0 affected
      const deleteDb = {
        ...db,
        delete: vi.fn(() => ({
          where: vi.fn(async (): Promise<DrizzleUpdateResult> => ({
            affectedRows: 0,
          })),
        })),
      } as unknown as DrizzleSessionLike
      const repo = createRepo(deleteDb)
      await expect(repo.delete("missing")).rejects.toThrow(NotFoundError)
    })

    it("does not throw NotFoundError when idempotent", async () => {
      const deleteDb = {
        ...createDb(),
        delete: vi.fn(() => ({
          where: vi.fn(async (): Promise<DrizzleUpdateResult> => ({
            affectedRows: 0,
          })),
        })),
      } as unknown as DrizzleSessionLike
      const repo = createRepo(deleteDb)
      await expect(
        repo.delete("missing", { idempotent: true })
      ).resolves.toBeUndefined()
    })
  })

  describe("deleteWhere", () => {
    it("rejects empty predicate", async () => {
      const db = createDb()
      const repo = createRepo(db)
      await expect(
        repo.deleteWhere(undefined as never)
      ).rejects.toThrow(ValidationError)
    })

    it("rejects always-true predicate", async () => {
      const db = createDb()
      const repo = createRepo(db)
      await expect(
        repo.deleteWhere(
          { kind: "literal", value: true } as never
        )
      ).rejects.toThrow(ConfigurationError)
    })

    it("returns deleted count", async () => {
      const deleteDb = {
        ...createDb(),
        delete: vi.fn(() => ({
          where: vi.fn(async (): Promise<DrizzleUpdateResult> => ({
            affectedRows: 3,
          })),
        })),
      } as unknown as DrizzleSessionLike
      const repo = createRepo(deleteDb)
      const result = await repo.deleteWhere(
        { kind: "condition", field: "status", op: "eq", value: "archived" } as never
      )
      expect(result.deletedCount).toBe(3)
    })
  })

  describe("pagination", () => {
    it("rejects invalid page number", async () => {
      const db = createDb({ selectRows: [] })
      const repo = createRepo(db)
      await expect(
        repo.findMany({ pagination: { page: 0, pageSize: 10 } })
      ).rejects.toThrow(ValidationError)
    })

    it("rejects invalid pageSize", async () => {
      const db = createDb({ selectRows: [] })
      const repo = createRepo(db)
      await expect(
        repo.findMany({ pagination: { page: 1, pageSize: -1 } })
      ).rejects.toThrow(ValidationError)
    })

    it("caps pageSize at maxPageSize", async () => {
      const db = createDb({ selectRows: [] })
      const repo = createDrizzleRepository({
        db,
        table: itemTable,
        entity,
        columnMap,
        maxPageSize: 50,
      })
      const result = await repo.findMany({
        pagination: { page: 1, pageSize: 100 },
      })
      expect(result.pageSize).toBe(50)
    })
  })
})
