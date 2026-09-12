import { beforeEach, describe, expect, it } from "vitest"
import { Predicate } from "kittle-core/domain"
import type {
  EntityDescriptor,
  PersistenceProvider,
  Repository,
} from "kittle-core/ports"

interface ContractRow {
  id: string
  name: string
  value: number
  tenantId?: string
  version?: number
}

const contractEntity: EntityDescriptor<ContractRow> = {
  name: "framework_contract_rows",
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

export interface PersistenceProviderContractOptions {
  createProvider: () => PersistenceProvider
  createTenantProvider: (
    provider: PersistenceProvider,
    tenantId: string
  ) => PersistenceProvider
  beforeEach?: () => void | Promise<void>
}

/** Runs the provider behavior every persistence adapter must support. */
export function runPersistenceProviderContractTests(
  label: string,
  options: PersistenceProviderContractOptions
): void {
  describe.sequential(`Persistence provider contract: ${label}`, () => {
    let provider: PersistenceProvider
    let repository: Repository<ContractRow, string>

    beforeEach(() => {
      provider = options.createProvider()
      repository = provider.repository(contractEntity)
      return options.beforeEach?.()
    })

    it("supports insert, read, update, list, and delete", async () => {
      const inserted = await repository.insert({
        id: "crud-row",
        name: "created",
        value: 1,
        version: 1,
      })
      expect(inserted.id).toBeTruthy()
      expect(await repository.findById(inserted.id)).toMatchObject({
        name: "created",
        value: 1,
      })

      const updated = await repository.update(
        inserted.id,
        { name: "updated", value: 2 },
        {
          optimisticConcurrency: { expectedVersion: 1 },
        }
      )
      expect(updated).toMatchObject({
        id: inserted.id,
        name: "updated",
        value: 2,
      })
      expect((await repository.findMany()).rowCount).toBeGreaterThanOrEqual(1)

      await repository.delete(inserted.id, {
        idempotent: true,
        optimisticConcurrency: { expectedVersion: 2 },
      })
      expect(await repository.findById(inserted.id)).toBeNull()
    })

    it("rejects stale optimistic-concurrency updates", async () => {
      const inserted = await repository.insert({
        id: "version-row",
        name: "versioned",
        value: 1,
        version: 1,
      })
      const updated = await repository.update(
        inserted.id,
        { name: "new", value: 2 },
        {
          optimisticConcurrency: { expectedVersion: 1 },
        }
      )
      expect(updated.version).toBe(2)
      await expect(
        repository.update(
          inserted.id,
          { name: "stale" },
          {
            optimisticConcurrency: { expectedVersion: 1 },
          }
        )
      ).rejects.toThrow()
    })

    it("allows only one concurrent mutation for the same expected version", async () => {
      const inserted = await repository.insert({
        id: "race-row",
        name: "versioned",
        value: 1,
        version: 1,
      })
      const results = await Promise.allSettled([
        repository.update(
          inserted.id,
          { name: "winner-a" },
          { optimisticConcurrency: { expectedVersion: 1 } }
        ),
        repository.update(
          inserted.id,
          { name: "winner-b" },
          { optimisticConcurrency: { expectedVersion: 1 } }
        ),
      ])

      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1)
      expect(
        results.filter((result) => result.status === "rejected")
      ).toHaveLength(1)
      expect((await repository.findById(inserted.id))?.version).toBe(2)
    })

    it("keeps tenant reads and writes isolated", async () => {
      const { tenantField: _tenantField, ...unscopedEntity } = contractEntity
      const unscoped = provider.repository<ContractRow>(unscopedEntity)
      await unscoped.insert({
        id: "tenant-a-row",
        name: "tenant-a",
        value: 1,
        version: 1,
        tenantId: "tenant-a",
      })
      await unscoped.insert({
        id: "tenant-b-row",
        name: "tenant-b",
        value: 2,
        version: 1,
        tenantId: "tenant-b",
      })

      const scoped = options
        .createTenantProvider(provider, "tenant-a")
        .repository(contractEntity)
      const result = await scoped.findMany()
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]?.tenantId).toBe("tenant-a")

      const hidden = await scoped.findOneWhere?.(
        Predicate.eq("name", "tenant-b")
      )
      expect(hidden).toBeNull()

      // A caller-supplied conflicting tenant must be rejected, never silently
      // overwritten; an insert without a tenant is injected with the scoped one.
      await expect(
        scoped.insert({
          id: "scoped-insert",
          name: "inserted",
          value: 3,
          tenantId: "tenant-b",
          version: 1,
        })
      ).rejects.toThrow()
      const inserted = await scoped.insert({
        id: "scoped-insert",
        name: "inserted",
        value: 3,
        version: 1,
      })
      expect(inserted.tenantId).toBe("tenant-a")

      await expect(
        scoped.update(
          "tenant-b-row",
          { name: "must-stay-tenant-b" },
          {
            optimisticConcurrency: { expectedVersion: 1 },
          }
        )
      ).rejects.toThrow()
      expect(await unscoped.findById("tenant-b-row")).toMatchObject({
        name: "tenant-b",
        tenantId: "tenant-b",
      })

      await scoped.update(
        "tenant-a-row",
        { name: "updated-by-tenant-a" },
        {
          optimisticConcurrency: { expectedVersion: 1 },
        }
      )
      expect(await unscoped.findById("tenant-a-row")).toMatchObject({
        name: "updated-by-tenant-a",
        tenantId: "tenant-a",
      })

      await expect(
        scoped.delete("tenant-b-row", {
          optimisticConcurrency: { expectedVersion: 1 },
        })
      ).rejects.toThrow()
      expect(await unscoped.findById("tenant-b-row")).toMatchObject({
        name: "tenant-b",
        tenantId: "tenant-b",
      })

      await scoped.delete("tenant-a-row", {
        optimisticConcurrency: { expectedVersion: 2 },
      })
      expect(await unscoped.findById("tenant-a-row")).toBeNull()
    })

    it("returns correctly sized pagination slices and total counts", async () => {
      for (let value = 1; value <= 5; value += 1) {
        await repository.insert({
          id: `page-row-${value}`,
          name: `page-${value}`,
          value,
          version: 1,
        })
      }

      const page1 = await repository.findMany({
        sort: [{ field: "name", direction: "asc" }],
        pagination: { page: 1, pageSize: 2 },
      })
      const page2 = await repository.findMany({
        sort: [{ field: "name", direction: "asc" }],
        pagination: { page: 2, pageSize: 2 },
      })

      expect(page1).toMatchObject({ page: 1, pageSize: 2, rowCount: 5 })
      expect(page2).toMatchObject({ page: 2, pageSize: 2, rowCount: 5 })
      expect(page1.rows).toHaveLength(2)
      expect(page2.rows).toHaveLength(2)
      expect(page1.rows.map((row) => row.id)).not.toEqual(
        page2.rows.map((row) => row.id)
      )
    })
  })
}
