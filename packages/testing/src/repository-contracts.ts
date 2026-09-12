import { describe, it, expect, beforeAll } from "vitest"
import { Predicate } from "core/domain"
import type {
  PersistenceProvider,
  EntityDescriptor,
  Repository,
} from "core/ports"

interface TestEntity {
  id: string
  name: string
  value: number
  tenantId?: string
  version?: number
}

const testEntityDescriptor: EntityDescriptor<TestEntity> = {
  name: "test_entity",
  primaryKey: "id",
  tenantField: "tenantId",
  versionField: "version",
  fields: {
    id: { type: "string" },
    name: { type: "string" },
    value: { type: "number" },
    tenantId: { type: "string", nullable: true },
    version: { type: "number", nullable: true },
  },
}

export function runRepositoryContractTests(
  label: string,
  adapterFactory: () => PersistenceProvider
): void {
  describe(`Repository contract: ${label}`, () => {
    let persistence: PersistenceProvider
    let repo: Repository<TestEntity, string>

    beforeAll(() => {
      persistence = adapterFactory()
      repo = persistence.repository<TestEntity>(testEntityDescriptor)
    })

    it("Insert returns a row with an ID", async () => {
      const row = await repo.insert({ name: "test", value: 42 })
      expect(row).toBeDefined()
      expect(row.id).toBeDefined()
      expect(row.name).toBe("test")
      expect(row.value).toBe(42)
    })

    it("FindMany returns all rows", async () => {
      await repo.insert({ name: "a", value: 1 })
      await repo.insert({ name: "b", value: 2 })
      const result = await repo.findMany()
      expect(result.rows.length).toBeGreaterThanOrEqual(2)
      expect(result.rowCount).toBeGreaterThanOrEqual(2)
    })

    it("FindById returns the correct row", async () => {
      const inserted = await repo.insert({ name: "find-me", value: 99 })
      const found = await repo.findById(inserted.id)
      expect(found).toBeDefined()
      expect(found!.name).toBe("find-me")
      expect(found!.value).toBe(99)
    })

    it("Update changes the correct row", async () => {
      const inserted = await repo.insert({ name: "update-me", value: 10 })
      const updated = await repo.update(inserted.id, {
        name: "updated",
        value: 20,
      })
      expect(updated.name).toBe("updated")
      expect(updated.value).toBe(20)
    })

    it("Delete removes the row", async () => {
      const inserted = await repo.insert({ name: "delete-me", value: 0 })
      await repo.delete(inserted.id, { idempotent: true })
      const found = await repo.findById(inserted.id)
      expect(found).toBeNull()
    })

    it("Scoped findMany respects tenant scope", async () => {
      const tenantField = testEntityDescriptor.tenantField!
      const tenantPersistence = persistence
      const { tenantField: _tenantField, ...unscopedDescriptor } =
        testEntityDescriptor
      const unscopedRepo =
        tenantPersistence.repository<TestEntity>(unscopedDescriptor)

      await unscopedRepo.insert({
        name: "tenant-a-row",
        value: 1,
        [tenantField]: "tenant-a",
      })
      await unscopedRepo.insert({
        name: "tenant-b-row",
        value: 2,
        [tenantField]: "tenant-b",
      })

      const { createTenantScopedPersistenceProvider } =
        await import("core/ports")
      const scopedPersistence = createTenantScopedPersistenceProvider(
        persistence,
        "tenant-a"
      )
      const scopedRepo =
        scopedPersistence.repository<TestEntity>(testEntityDescriptor)

      const result = await scopedRepo.findMany()
      for (const row of result.rows) {
        expect(row.tenantId).toBe("tenant-a")
      }
    })

    it("Optimistic concurrency fails on stale version", async () => {
      const inserted = await repo.insert({
        name: "version-test",
        value: 1,
        version: 1,
      })

      // First update succeeds
      const updated1 = await repo.update(inserted.id, { name: "v2", value: 2 })

      expect(updated1.version).toBe(2)
      await expect(
        repo.update(
          inserted.id,
          { name: "stale" },
          {
            optimisticConcurrency: { expectedVersion: 1 },
          }
        )
      ).rejects.toThrow()

      const manyUpdated = await repo.updateManyWhere!(
        Predicate.eq("id", inserted.id),
        { name: "v3", version: 999 },
        { optimisticConcurrency: { expectedVersion: 2 } }
      )
      expect(manyUpdated).toBe(1)
      expect((await repo.findById(inserted.id))?.version).toBe(3)
    })

    it("Pagination returns correct slices", async () => {
      // Seed at least 5 rows
      for (let i = 0; i < 5; i++) {
        await repo.insert({ name: `page-row-${i}`, value: i })
      }

      const page1 = await repo.findMany({
        pagination: { page: 1, pageSize: 2 },
      })
      expect(page1.rows.length).toBeLessThanOrEqual(2)
      expect(page1.page).toBe(1)
      expect(page1.pageSize).toBe(2)
      expect(page1.rowCount).toBeGreaterThanOrEqual(5)

      if (page1.rows.length === 2) {
        const page2 = await repo.findMany({
          pagination: { page: 2, pageSize: 2 },
        })
        expect(page2.rows.length).toBeLessThanOrEqual(2)
        expect(page2.page).toBe(2)
      }
    })
  })
}
