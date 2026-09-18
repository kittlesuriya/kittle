import { Predicate, type PredicateNode } from "../domain/predicate"
import {
  ConfigurationError,
  UnsupportedCapabilityError,
  NotFoundError,
  TenantScopeViolationError,
  ImmutableFieldViolationError,
} from "../foundation/errors"
import type { EntityDescriptor } from "./persistence"
import type {
  AtomicBatchPlan,
  AtomicBatchProvider,
  AtomicBatchResult,
  TenantScopedAtomicBatchPlan,
  TenantScopedAtomicBatchProvider,
  TenantScopedAtomicBatchCommandProvider,
  PersistenceProvider,
  InteractiveTransactionProvider,
  TransactionOptions,
  Repository,
  UpdateWhereOptions,
  DeleteOptions,
  QueryOptions,
  ListResult,
} from "./persistence"
import {
  assertVersionedWriteHasExpectedVersion,
  assertQueryOptions,
} from "./persistence"
import type { AuditRecord } from "./audit"
import type { OutboxRecord } from "./outbox"

function withTenantScope(
  filter: PredicateNode | undefined,
  tenantField: string,
  tenantId: string
): PredicateNode {
  const tenantScope = Predicate.eq(tenantField, tenantId)
  return filter ? Predicate.and(filter, tenantScope) : tenantScope
}

function getPrimaryKey<T>(entity: EntityDescriptor<T>): keyof T & string {
  return entity.primaryKey ?? ("id" as keyof T & string)
}

function assertTenantFieldUnchanged<T>(
  data: Partial<T>,
  tenantField: keyof T & string,
  entityName: string
): void {
  if (Object.prototype.hasOwnProperty.call(data, tenantField)) {
    throw new TenantScopeViolationError(
      `Cannot mutate tenant field "${String(tenantField)}" on entity "${entityName}" through update operations. ` +
        `Tenant assignment is managed by the framework.`
    )
  }
}

function assertImmutableFieldsUnchanged<T>(
  data: Partial<T>,
  entity: EntityDescriptor<T>
): void {
  if (!entity.immutableFields) return
  for (const field of entity.immutableFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      throw new ImmutableFieldViolationError(
        `Cannot mutate immutable field "${String(field)}" on entity "${entity.name}".`
      )
    }
  }
}

function assertPrimaryKeyUnchanged<T>(
  data: Partial<T>,
  entity: EntityDescriptor<T>
): void {
  const primaryKey = getPrimaryKey(entity)
  if (Object.prototype.hasOwnProperty.call(data, primaryKey)) {
    throw new ImmutableFieldViolationError(
      `Cannot mutate primary key field "${String(primaryKey)}" on entity "${entity.name}".`
    )
  }
}

function assertVersionFieldUnchanged<T>(
  data: Partial<T>,
  entity: EntityDescriptor<T>
): void {
  const versionField = entity.versionField
  if (
    versionField &&
    Object.prototype.hasOwnProperty.call(data, versionField)
  ) {
    throw new ImmutableFieldViolationError(
      `Cannot mutate version field "${String(versionField)}" on entity "${entity.name}".`
    )
  }
}

function assertUpdateDataValid<T>(
  data: Partial<T>,
  entity: EntityDescriptor<T>
): void {
  const tenantField = entity.tenantField
  if (tenantField) {
    assertTenantFieldUnchanged(data, tenantField, entity.name)
  }
  assertPrimaryKeyUnchanged(data, entity)
  assertVersionFieldUnchanged(data, entity)
  assertImmutableFieldsUnchanged(data, entity)
}

function isAlwaysTrueFilter(node: PredicateNode): boolean {
  switch (node.kind) {
    case "literal":
      return node.value === true
    case "and":
      return node.filters.length === 0 || node.filters.every(isAlwaysTrueFilter)
    case "or":
      return node.filters.length > 0 && node.filters.some(isAlwaysTrueFilter)
    case "not":
      return isAlwaysFalseFilter(node.filter)
    default:
      return false
  }
}

function isAlwaysFalseFilter(node: PredicateNode): boolean {
  switch (node.kind) {
    case "literal":
      return node.value === false
    case "or":
      return (
        node.filters.length === 0 || node.filters.every(isAlwaysFalseFilter)
      )
    case "and":
      return node.filters.length > 0 && node.filters.some(isAlwaysFalseFilter)
    case "not":
      return isAlwaysTrueFilter(node.filter)
    default:
      return false
  }
}

function assertSafeDestructiveFilter(
  filter: PredicateNode,
  entityName: string
): void {
  if (isAlwaysTrueFilter(filter)) {
    throw new ConfigurationError(
      `Destructive operations on ${entityName} cannot target every row.`
    )
  }
}

function assertScopedTenantInsert<T>(
  data: Partial<T>,
  tenantField: keyof T & string,
  tenantId: string,
  entityName: string
): void {
  if (Object.prototype.hasOwnProperty.call(data, tenantField)) {
    const supplied = (data as Record<string, unknown>)[tenantField]
    if (supplied !== tenantId) {
      throw new TenantScopeViolationError(
        `Cannot insert into "${entityName}" with tenant field "${String(tenantField)}" set to "${String(supplied)}" for tenant "${tenantId}". ` +
          "Tenant assignment is managed by the framework."
      )
    }
  }
}

function normalizeTenantRecord<T extends { tenantId?: string | null }>(
  record: T,
  tenantId: string,
  kind: string
): T & { tenantId: string } {
  if (record.tenantId != null && record.tenantId !== tenantId) {
    throw new TenantScopeViolationError(
      `Cannot include ${kind} for tenant "${record.tenantId}" in a batch for tenant "${tenantId}".`
    )
  }
  return { ...record, tenantId }
}

/**
 * Fail-closed validation for rows returned by the underlying adapter through
 * a tenant-scoped repository. The scoped wrapper adds the tenant filter to
 * the query, but a buggy adapter may ignore it — every returned row must
 * prove it belongs to the scope tenant before reaching the caller.
 */
function assertTenantRowEcho<T>(
  row: unknown,
  entityName: string,
  tenantField: keyof T & string,
  tenantId: string
): asserts row is T {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new ConfigurationError(
      `Repository adapter for "${entityName}" returned a malformed row; an object scoped to tenant "${tenantId}" is required.`
    )
  }
  if ((row as Record<string, unknown>)[tenantField] !== tenantId) {
    throw new TenantScopeViolationError(
      `Repository adapter for "${entityName}" returned a row outside tenant "${tenantId}".`
    )
  }
}

function assertTenantRowsEcho<T>(
  rows: unknown,
  entityName: string,
  tenantField: keyof T & string,
  tenantId: string
): asserts rows is T[] {
  if (!Array.isArray(rows)) {
    throw new ConfigurationError(
      `Repository adapter for "${entityName}" returned a malformed row list; an array scoped to tenant "${tenantId}" is required.`
    )
  }
  for (const row of rows) {
    assertTenantRowEcho(row, entityName, tenantField, tenantId)
  }
}

function assertListResultShape<T>(
  result: unknown,
  entityName: string
): asserts result is ListResult<T> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ConfigurationError(
      `Repository adapter for "${entityName}" returned a malformed list result; { rows, rowCount, page, pageSize } is required.`
    )
  }
  const candidate = result as Partial<ListResult<T>>
  if (!Array.isArray(candidate.rows)) {
    throw new ConfigurationError(
      `Repository adapter for "${entityName}" returned a malformed list result; "rows" must be an array.`
    )
  }
  if (
    !Number.isSafeInteger(candidate.rowCount) ||
    (candidate.rowCount as number) < 0
  ) {
    throw new ConfigurationError(
      `Repository adapter for "${entityName}" returned a malformed list result; "rowCount" must be a non-negative safe integer.`
    )
  }
  if (
    !Number.isSafeInteger(candidate.page) ||
    (candidate.page as number) < 1 ||
    !Number.isSafeInteger(candidate.pageSize) ||
    (candidate.pageSize as number) < 1
  ) {
    throw new ConfigurationError(
      `Repository adapter for "${entityName}" returned a malformed list result; "page" and "pageSize" must be positive safe integers.`
    )
  }
}

function assertAffectedCount(
  result: unknown,
  entityName: string,
  field: "updatedCount" | "deletedCount"
): asserts result is Record<typeof field, number> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ConfigurationError(
      `Repository adapter for "${entityName}" returned a malformed mutation result; { ${field}: number } is required.`
    )
  }
  const count = (result as Record<string, unknown>)[field]
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    throw new ConfigurationError(
      `Repository adapter for "${entityName}" returned a malformed mutation result; "${field}" must be a non-negative safe integer.`
    )
  }
}

export const TENANT_SCOPED_BRAND: unique symbol = Symbol(
  "kittle.tenantScoped"
)

const tenantScopedProviders = new WeakSet<PersistenceProvider>()
const tenantScopeIds = new WeakMap<PersistenceProvider, string>()

export function isTenantScopedPersistenceProvider(
  provider: PersistenceProvider
): boolean {
  return tenantScopedProviders.has(provider)
}

export function getTenantScopeId(
  provider: PersistenceProvider
): string | undefined {
  return tenantScopeIds.get(provider)
}

export function createTenantScopedPersistenceProvider(
  base: PersistenceProvider,
  tenantId: string
): PersistenceProvider {
  const scoped: PersistenceProvider = {
    dialect: base.dialect,
    capabilities: base.capabilities.atomicBatch
      ? { ...base.capabilities, atomicBatchScope: "tenant-scoped" }
      : base.capabilities,
    repository<T, TId = string>(
      entity: EntityDescriptor<T>
    ): Repository<T, TId> {
      const tenantField = entity.tenantField

      if (!tenantField) {
        throw new TenantScopeViolationError(
          `Global entity "${entity.name}" cannot be accessed through tenant-scoped persistence. ` +
            "Use an explicit platform-scoped provider and authorize the required global capability."
        )
      }

      const repo = base.repository<T, TId>(entity)

      const primaryKey = getPrimaryKey(entity)

      const scoped: Repository<T, TId> = {
        async findById(id: TId): Promise<T | null> {
          const filter = withTenantScope(
            Predicate.eq(primaryKey, id as never),
            tenantField,
            tenantId
          )
          if (repo.findOneWhere) {
            const row = await repo.findOneWhere(filter)
            if (row === null) return null
            // Check-before-fanout: validate the tenant echo before any fan-out/caching/logging.
            assertTenantRowEcho(row, entity.name, tenantField, tenantId)
            return row
          }
          const result = await repo.findMany({
            filter,
            pagination: { page: 1, pageSize: 1 },
          })
          assertListResultShape<T>(result, entity.name)
          // Check-before-fanout: validate the tenant echo before any fan-out/caching/logging.
          assertTenantRowsEcho(result.rows, entity.name, tenantField, tenantId)
          return result.rows[0] ?? null
        },
        async findOneWhere(filter: PredicateNode): Promise<T | null> {
          const scopedFilter = withTenantScope(filter, tenantField, tenantId)
          if (repo.findOneWhere) {
            const row = await repo.findOneWhere(scopedFilter)
            if (row === null) return null
            // Check-before-fanout: validate the tenant echo before any fan-out/caching/logging.
            assertTenantRowEcho(row, entity.name, tenantField, tenantId)
            return row
          }
          const result = await repo.findMany({
            filter: scopedFilter,
            pagination: { page: 1, pageSize: 1 },
          })
          assertListResultShape<T>(result, entity.name)
          // Check-before-fanout: validate the tenant echo before any fan-out/caching/logging.
          assertTenantRowsEcho(result.rows, entity.name, tenantField, tenantId)
          return result.rows[0] ?? null
        },
        async findMany(options?: QueryOptions): Promise<ListResult<T>> {
          assertQueryOptions(options)
          const result = await repo.findMany({
            ...options,
            filter: withTenantScope(options?.filter, tenantField, tenantId),
          })
          assertListResultShape<T>(result, entity.name)
          // Check-before-fanout: validate the tenant echo before any fan-out/caching/logging.
          assertTenantRowsEcho(result.rows, entity.name, tenantField, tenantId)
          return result
        },
        async insert(data: Partial<T>): Promise<T> {
          assertScopedTenantInsert(data, tenantField, tenantId, entity.name)
          const row = await repo.insert({
            ...data,
            [tenantField]: tenantId,
          })
          // Check-before-fanout: validate the tenant echo before any fan-out/caching/logging.
          assertTenantRowEcho(row, entity.name, tenantField, tenantId)
          return row
        },
        async update(
          id: TId,
          data: Partial<T>,
          options?: UpdateWhereOptions
        ): Promise<T> {
          assertUpdateDataValid(data, entity)
          assertVersionedWriteHasExpectedVersion(
            entity as EntityDescriptor<unknown>,
            options
          )

          if (!repo.updateOneWhereReturning) {
            throw new UnsupportedCapabilityError(
              `Scoped update by ID is not supported by the ${entity.name} repository adapter. ` +
                "Exact post-mutation row semantics require updateOneWhereReturning; an update-then-read fallback could observe a concurrent writer."
            )
          }
          const updated = await repo.updateOneWhereReturning(
            withTenantScope(
              Predicate.eq(primaryKey, id as never),
              tenantField,
              tenantId
            ),
            data,
            options
          )
          if (updated === null) {
            throw new NotFoundError(
              `Scoped update failed: ${entity.name} not found`,
              { entity: entity.name, id }
            )
          }
          // Check-before-fanout: validate the tenant echo before any fan-out/caching/logging.
          assertTenantRowEcho(updated, entity.name, tenantField, tenantId)
          return updated
        },
        async updateOneWhere(
          filter: PredicateNode,
          data: Partial<T>,
          options?: UpdateWhereOptions
        ): Promise<{ updatedCount: number }> {
          assertUpdateDataValid(data, entity)
          assertSafeDestructiveFilter(filter, entity.name)
          assertVersionedWriteHasExpectedVersion(
            entity as EntityDescriptor<unknown>,
            options
          )

          const scopedFilter = withTenantScope(filter, tenantField, tenantId)
          if (repo.updateOneWhere) {
            const result = await repo.updateOneWhere(scopedFilter, data, options)
            assertAffectedCount(result, entity.name, "updatedCount")
            return result
          }
          throw new UnsupportedCapabilityError(
            `updateOneWhere is not supported by the ${entity.name} repository adapter.`
          )
        },
        ...(repo.updateOneWhereReturning != null && {
          updateOneWhereReturning: async (
            filter: PredicateNode,
            data: Partial<T>,
            options?: UpdateWhereOptions
          ): Promise<T | null> => {
            assertUpdateDataValid(data, entity)
            assertSafeDestructiveFilter(filter, entity.name)
            assertVersionedWriteHasExpectedVersion(
              entity as EntityDescriptor<unknown>,
              options
            )

            const scopedFilter = withTenantScope(filter, tenantField, tenantId)
            const row = await repo.updateOneWhereReturning!(
              scopedFilter,
              data,
              options
            )
            if (row === null) return null
            // Check-before-fanout: validate the tenant echo before any fan-out/caching/logging.
            assertTenantRowEcho(row, entity.name, tenantField, tenantId)
            return row
          },
        }),
        async updateManyWhere(
          filter: PredicateNode,
          data: Partial<T>,
          options?: UpdateWhereOptions
        ): Promise<number> {
          assertUpdateDataValid(data, entity)
          assertSafeDestructiveFilter(filter, entity.name)
          assertVersionedWriteHasExpectedVersion(
            entity as EntityDescriptor<unknown>,
            options
          )

          const scopedFilter = withTenantScope(filter, tenantField, tenantId)
          if (repo.updateManyWhere) {
            const count = await repo.updateManyWhere(
              scopedFilter,
              data,
              options
            )
            if (!Number.isSafeInteger(count) || count < 0) {
              throw new ConfigurationError(
                `Repository adapter for "${entity.name}" returned a malformed mutation result; updateManyWhere count must be a non-negative safe integer.`
              )
            }
            return count
          }
          throw new UnsupportedCapabilityError(
            `updateManyWhere is not supported by the ${entity.name} repository adapter. ` +
              "Use a loop with individual updates or implement updateManyWhere on the adapter."
          )
        },
        async delete(id: TId, options?: DeleteOptions): Promise<void> {
          assertVersionedWriteHasExpectedVersion(
            entity as EntityDescriptor<unknown>,
            options
          )
          if (!repo.deleteWhere) {
            throw new UnsupportedCapabilityError(
              `Scoped delete by ID is not supported by the ${entity.name} repository adapter.`
            )
          }
          const result = await repo.deleteWhere(
            withTenantScope(
              Predicate.eq(primaryKey, id as never),
              tenantField,
              tenantId
            ),
            options
          )
          assertAffectedCount(result, entity.name, "deletedCount")
          if (result.deletedCount === 0 && !options?.idempotent) {
            throw new NotFoundError(
              `Scoped delete failed: ${entity.name} not found`,
              { entity: entity.name, id }
            )
          }
          return
        },
        async deleteWhere(
          filter: PredicateNode,
          options?: DeleteOptions
        ): Promise<{ deletedCount: number }> {
          assertSafeDestructiveFilter(filter, entity.name)
          assertVersionedWriteHasExpectedVersion(
            entity as EntityDescriptor<unknown>,
            options
          )
          const scopedFilter = withTenantScope(filter, tenantField, tenantId)
          if (repo.deleteWhere) {
            const result = await repo.deleteWhere(scopedFilter, options)
            assertAffectedCount(result, entity.name, "deletedCount")
            return result
          }
          throw new UnsupportedCapabilityError(
            `deleteWhere is not supported by the ${entity.name} repository adapter.`
          )
        },
        ...(repo.bulkInsert != null && {
          bulkInsert: async (data: Partial<T>[]) => {
            const normalized = data.map((row) => {
              assertScopedTenantInsert(row, tenantField, tenantId, entity.name)
              return {
                ...row,
                [tenantField]: tenantId,
              }
            })
            const rows = await repo.bulkInsert!(normalized)
            // Check-before-fanout: validate the tenant echo before any fan-out/caching/logging.
            assertTenantRowsEcho(rows, entity.name, tenantField, tenantId)
            return rows
          },
        }),
      }

      return scoped
    },
  }

  const atomicBase = base as Partial<
    AtomicBatchProvider & TenantScopedAtomicBatchCommandProvider
  >
  if (typeof atomicBase.executeAtomicBatch === "function") {
    const atomicScoped = scoped as TenantScopedAtomicBatchProvider
    const commandEncoder =
      atomicBase.createTenantScopedCommandEncoder?.(tenantId)
    Object.assign(atomicScoped, { tenantId, commandEncoder })
    atomicScoped.executeAtomicBatch = async (
      plan: TenantScopedAtomicBatchPlan<unknown>
    ): Promise<AtomicBatchResult> => {
      if (!commandEncoder) {
        throw new ConfigurationError(
          "Tenant-scoped atomic batches require an adapter-owned command encoder."
        )
      }

      const encodedPlan: AtomicBatchPlan<unknown> = {
        ...plan,
        items: plan.items.map((item) => {
          if (item.kind === "command") {
            return {
              kind: "command",
              command: commandEncoder.encode(item.command),
            }
          }
          if (item.kind === "audit") {
            return {
              kind: "audit",
              record: normalizeTenantRecord<AuditRecord>(
                item.record,
                tenantId,
                "audit record"
              ),
            }
          }
          if (item.kind === "outbox") {
            return {
              kind: "outbox",
              record: normalizeTenantRecord<OutboxRecord>(
                item.record,
                tenantId,
                "outbox record"
              ),
            }
          }
          return { kind: "idempotency", commit: item.commit }
        }),
      }
      return atomicBase.executeAtomicBatch!(encodedPlan)
    }
  }

  const interactiveBase = base as Partial<InteractiveTransactionProvider>
  if (typeof interactiveBase.runInTransaction === "function") {
    const interactiveScoped = scoped as InteractiveTransactionProvider
    interactiveScoped.runInTransaction = async <TResult>(
      work: (transactionScoped: PersistenceProvider) => Promise<TResult>,
      options?: TransactionOptions
    ): Promise<TResult> =>
      interactiveBase.runInTransaction!(
        (transactionBase) =>
          work(
            createTenantScopedPersistenceProvider(transactionBase, tenantId)
          ),
        options
      )
  }

  tenantScopedProviders.add(scoped)
  tenantScopeIds.set(scoped, tenantId)
  return scoped
}

export function createTenantScopedInteractiveTransactionProvider(
  base: InteractiveTransactionProvider,
  tenantId: string
): InteractiveTransactionProvider {
  return createTenantScopedPersistenceProvider(
    base,
    tenantId
  ) as InteractiveTransactionProvider
}
