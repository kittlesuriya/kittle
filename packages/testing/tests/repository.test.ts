import {
  evaluatePredicate,
  OptimisticConcurrencyError,
  type PredicateNode,
} from "core/domain"
import type {
  PersistenceProvider,
  EntityDescriptor,
  Repository,
  QueryOptions,
  ListResult,
  DeleteOptions,
  UpdateWhereOptions,
} from "core/ports"
import { runRepositoryContractTests } from "../src/repository-contracts"

function createInMemoryPersistenceProvider(): PersistenceProvider {
  let nextId = 1
  const store = new Map<string, Record<string, unknown>>()

  function allRows<T>(): T[] {
    return Array.from(store.values()).map((r) => ({ ...r }) as T)
  }

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
    repository<T, TId = string>(
      _entity: EntityDescriptor<T>
    ): Repository<T, TId> {
      const pk = _entity.primaryKey ?? "id"

      return {
        async findById(id: TId): Promise<T | null> {
          const row = store.get(String(id))
          return row ? ({ ...row } as T) : null
        },

        async findOneWhere(filter: PredicateNode): Promise<T | null> {
          for (const row of store.values()) {
            if (evaluatePredicate(row, filter)) {
              return { ...row } as T
            }
          }
          return null
        },

        async findMany(options?: QueryOptions): Promise<ListResult<T>> {
          let all = allRows<T>()
          if (options?.filter) {
            all = all.filter((r) =>
              evaluatePredicate(r as Record<string, unknown>, options.filter!)
            )
          }
          const total = all.length
          const page = options?.pagination?.page ?? 1
          const pageSize = options?.pagination?.pageSize ?? 100
          const paged = all.slice((page - 1) * pageSize, page * pageSize)
          return { rows: paged, rowCount: total, page, pageSize }
        },

        async insert(data: Partial<T>): Promise<T> {
          const id = String(nextId++)
          const row = { ...data, [pk]: id } as Record<string, unknown>
          store.set(id, row)
          return { ...row } as T
        },

        async update(
          id: TId,
          data: Partial<T>,
          options?: UpdateWhereOptions
        ): Promise<T> {
          const key = String(id)
          const existing = store.get(key)
          if (!existing) throw new Error("Not found")
          if (
            options?.optimisticConcurrency &&
            existing.version !== options.optimisticConcurrency.expectedVersion
          ) {
            throw new OptimisticConcurrencyError("stale version")
          }
          const updated = {
            ...existing,
            ...data,
            ...(typeof existing.version === "number"
              ? { version: existing.version + 1 }
              : {}),
          }
          store.set(key, updated)
          return { ...updated } as T
        },

        async updateOneWhere(
          filter: PredicateNode,
          data: Partial<T>,
          options?: UpdateWhereOptions
        ): Promise<{ updatedCount: number }> {
          for (const [key, row] of store.entries()) {
            if (
              evaluatePredicate(row, filter) &&
              (!options?.optimisticConcurrency ||
                row.version === options.optimisticConcurrency.expectedVersion)
            ) {
              store.set(key, {
                ...row,
                ...data,
                ...(typeof row.version === "number"
                  ? { version: row.version + 1 }
                  : {}),
              })
              return { updatedCount: 1 }
            }
          }
          if (options?.optimisticConcurrency)
            throw new OptimisticConcurrencyError("stale version")
          return { updatedCount: 0 }
        },

        async updateManyWhere(
          filter: PredicateNode,
          data: Partial<T>,
          options?: UpdateWhereOptions
        ): Promise<number> {
          let count = 0
          for (const [key, row] of store.entries()) {
            if (
              evaluatePredicate(row, filter) &&
              (!options?.optimisticConcurrency ||
                row.version === options.optimisticConcurrency.expectedVersion)
            ) {
              store.set(key, {
                ...row,
                ...data,
                ...(typeof row.version === "number"
                  ? { version: row.version + 1 }
                  : {}),
              })
              count++
            }
          }
          if (options?.optimisticConcurrency && count === 0)
            throw new OptimisticConcurrencyError("stale version")
          return count
        },

        async delete(id: TId, _options?: DeleteOptions): Promise<void> {
          store.delete(String(id))
        },

        async deleteWhere(
          filter: PredicateNode,
          _options?: DeleteOptions
        ): Promise<{ deletedCount: number }> {
          let count = 0
          for (const [key, row] of store.entries()) {
            if (evaluatePredicate(row, filter)) {
              store.delete(key)
              count++
            }
          }
          return { deletedCount: count }
        },
      }
    },
  }
}

runRepositoryContractTests("in-memory", createInMemoryPersistenceProvider)
