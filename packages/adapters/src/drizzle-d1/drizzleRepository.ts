import {
  and,
  asc,
  count,
  desc,
  eq,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm"
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core"
import type {
  DeleteOptions,
  EntityDescriptor,
  ListResult,
  PaginationSpec,
  QueryOptions,
  Repository,
  SortSpec,
  UpdateWhereOptions,
} from "core/ports"
import { assertVersionedWriteHasExpectedVersion } from "core/ports"
import { Predicate, type PredicateNode } from "core/domain"
import type {
  DrizzleColumnMap,
  DrizzlePredicateCompiler,
} from "./drizzlePredicateCompiler"
import { DrizzlePredicateCompiler as DefaultDrizzlePredicateCompiler } from "./drizzlePredicateCompiler"
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
  ConfigurationError,
  OptimisticConcurrencyError,
} from "core/domain"
import { getAffectedRows } from "./d1Utils"

type SelectableRow = Record<string, unknown>

export interface DrizzleUpdateResult {
  affectedRows: number
}

export interface DrizzleSessionLike {
  atomicJobTransition?: (args: {
    updateTable: AnySQLiteTable
    updateSet: unknown
    updateWhere: SQL<unknown> | undefined
    historyTable: AnySQLiteTable
    historyValues: Record<string, unknown>
    historyWhere: SQL<unknown> | undefined
  }) => Promise<{ applied: boolean; historyId: string }>
  select: (...args: unknown[]) => {
    from: (table: AnySQLiteTable) => {
      where: (whereClause: SQL<unknown> | undefined) => {
        limit: (limit: number) => Promise<unknown[]>
        orderBy: (orderBy: SQL<unknown> | AnyColumn) => {
          limit: (limit: number) => {
            offset: (offset: number) => Promise<unknown[]>
          }
        }
      }
    }
  }
  // Keep the executable Drizzle insert builder visible to D1 idempotency and outbox code.
  insert: (table: AnySQLiteTable) => { values: (data: unknown) => unknown }
  update: (table: AnySQLiteTable) => {
    set: (data: unknown) => {
      where: (
        whereClause: SQL<unknown> | undefined
      ) => Promise<DrizzleUpdateResult>
    }
  }
  updateReturning?: (
    table: AnySQLiteTable,
    data: unknown,
    whereClause: SQL<unknown> | undefined
  ) => Promise<unknown[]>
  delete: (table: AnySQLiteTable) => {
    where: (
      whereClause: SQL<unknown> | undefined
    ) => Promise<DrizzleUpdateResult>
  }
}

const DEFAULT_PAGE_SIZE = 20
const DEFAULT_MAX_PAGE_SIZE = 100

const DEFAULT_CONSTRAINT_MAP: Record<string, string> = {}

export interface CreateDrizzleRepositoryArgs<T> {
  db: DrizzleSessionLike
  table: AnySQLiteTable
  entity: EntityDescriptor<T>
  columnMap: DrizzleColumnMap
  predicateCompiler?: DrizzlePredicateCompiler
  maxPageSize?: number
  maxOffset?: number
  constraintMap?: Record<string, string>
}

function resolvePrimaryKey<T>(
  entity: EntityDescriptor<T>,
  columnMap: DrizzleColumnMap
): keyof T & string {
  const primaryKey = entity.primaryKey ?? ("id" as keyof T & string)
  if (!columnMap[primaryKey])
    throw new Error(
      `Entity ${entity.name} is missing primary key column \"${String(primaryKey)}\"`
    )
  return primaryKey
}

function resolveVersionField<T>(
  entity: EntityDescriptor<T>
): (keyof T & string) | undefined {
  return entity.versionField
}

function resolvePagination(
  pagination: PaginationSpec | undefined,
  maxPageSize: number,
  maxOffset?: number
) {
  const page = validatePaginationValue("page", pagination?.page ?? 1)
  const rawRequested = validatePaginationValue(
    "pageSize",
    pagination?.pageSize ?? DEFAULT_PAGE_SIZE
  )
  const pageSize = Math.min(Math.max(1, rawRequested), maxPageSize)
  const pageIndex = page - 1
  if (pageIndex > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) {
    throw new ValidationError(
      "pagination offset exceeds the maximum safe integer"
    )
  }
  const offset = pageIndex * pageSize
  if (maxOffset !== undefined && offset > maxOffset)
    throw new ValidationError(
      `pagination offset exceeds the configured maximum of ${maxOffset}`
    )
  return { page, pageSize, offset }
}

function validatePaginationValue(
  name: "page" | "pageSize",
  value: number
): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${name} must be a finite positive integer`)
  }
  return value
}

function compileOrderBy(
  sort: SortSpec[] | undefined,
  columnMap: DrizzleColumnMap,
  fallbackColumn: AnyColumn,
  primaryKey: string,
  primaryKeyColumn: AnyColumn
): SQL<unknown> {
  if (!sort || sort.length === 0) {
    return fallbackColumn === primaryKeyColumn
      ? sql`${fallbackColumn}`
      : sql`${asc(fallbackColumn)}, ${asc(primaryKeyColumn)}`
  }

  const clauses = sort.map((s) => {
    const column = columnMap[s.field]
    if (!column) throw new ValidationError(`Unknown sort field: "${s.field}"`)
    return s.direction === "desc" ? desc(column) : asc(column)
  })

  if (!sort.some((s) => s.field === primaryKey)) {
    const direction = sort[sort.length - 1]!.direction
    clauses.push(
      direction === "desc" ? desc(primaryKeyColumn) : asc(primaryKeyColumn)
    )
  }
  if (clauses.length === 1) return clauses[0]!
  return sql.join(clauses, sql`, `)
}

function resolveConstraintMessage(
  constraintMap: Record<string, string>,
  errorMessage: string
): string | undefined {
  for (const [pattern, message] of Object.entries(constraintMap)) {
    if (new RegExp(pattern, "i").test(errorMessage)) return message
  }
  return undefined
}

interface DrizzleNativeError {
  message: string
  code?: string | number
  cause?: unknown
}

function isDrizzleNativeError(error: unknown): error is DrizzleNativeError {
  return (
    error !== null &&
    error !== undefined &&
    typeof error === "object" &&
    "message" in error
  )
}

function rethrowConstraintError(
  error: unknown,
  constraintMap: Record<string, string>
): never {
  if (!isDrizzleNativeError(error))
    throw error instanceof Error ? error : new Error(String(error))

  const msg = error.message
  const code = error.code

  if (code === "SQLITE_CONSTRAINT" || /UNIQUE constraint|unique/i.test(msg)) {
    const custom = resolveConstraintMessage(constraintMap, msg)
    throw new ConflictError(custom ?? "A record with this value already exists")
  }
  if (/FOREIGN KEY constraint/i.test(msg)) {
    const custom = resolveConstraintMessage(constraintMap, msg)
    throw new BusinessRuleError(custom ?? "Referenced record not found")
  }
  if (/NOT NULL constraint/i.test(msg)) {
    throw new ValidationError("A required field is missing")
  }
  if (/CHECK constraint/i.test(msg)) {
    throw new BusinessRuleError("A validation check failed")
  }

  throw new Error(error.message)
}

function guardEmptyPredicate(
  filter: PredicateNode | undefined,
  operation: string,
  entityName: string
): void {
  if (filter === undefined || filter === null) {
    throw new ValidationError(
      `${operation}: cannot execute on ${entityName} without a filter predicate — empty predicates would match all rows.`
    )
  }
}

function isAlwaysTruePredicate(node: PredicateNode): boolean {
  switch (node.kind) {
    case "literal":
      return node.value === true
    case "and":
      return (
        node.filters.length === 0 || node.filters.every(isAlwaysTruePredicate)
      )
    case "or":
      return node.filters.length > 0 && node.filters.some(isAlwaysTruePredicate)
    case "not":
      return isAlwaysFalsePredicate(node.filter)
    default:
      return false
  }
}

function isAlwaysFalsePredicate(node: PredicateNode): boolean {
  switch (node.kind) {
    case "literal":
      return node.value === false
    case "or":
      return (
        node.filters.length === 0 || node.filters.every(isAlwaysFalsePredicate)
      )
    case "and":
      return (
        node.filters.length > 0 && node.filters.some(isAlwaysFalsePredicate)
      )
    case "not":
      return isAlwaysTruePredicate(node.filter)
    default:
      return false
  }
}

function guardAllRowDestructive(
  filter: PredicateNode,
  operation: string,
  entityName: string
): void {
  if (isAlwaysTruePredicate(filter)) {
    throw new ConfigurationError(
      `All-row ${operation} on entity "${entityName}" is forbidden.`
    )
  }
}

async function fetchFirstByWhere<T>(args: {
  db: DrizzleSessionLike
  table: AnySQLiteTable
  whereClause: SQL<unknown> | undefined
}): Promise<T | null> {
  const [row] = await args.db
    .select()
    .from(args.table)
    .where(args.whereClause)
    .limit(1)

  return (row as T | undefined) ?? null
}

async function fetchMatchingPrimaryKeys<T>(args: {
  db: DrizzleSessionLike
  table: AnySQLiteTable
  whereClause: SQL<unknown>
  primaryKeyColumn: AnyColumn
}): Promise<T[]> {
  const rows = await args.db
    .select({ primaryKey: args.primaryKeyColumn })
    .from(args.table)
    .where(args.whereClause)
    .limit(2)
  return rows as T[]
}

export function createDrizzleRepository<T extends SelectableRow, TId = string>(
  args: CreateDrizzleRepositoryArgs<T>
): Repository<T, TId> {
  const predicateCompiler =
    args.predicateCompiler ??
    new DefaultDrizzlePredicateCompiler(args.columnMap)
  const primaryKey = resolvePrimaryKey(args.entity, args.columnMap)
  const primaryKeyColumn = args.columnMap[primaryKey]!
  const versionField = resolveVersionField(args.entity)
  const fallbackSortColumn = args.columnMap.createdAt ?? primaryKeyColumn
  const maxPageSize = args.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE
  if (!Number.isSafeInteger(maxPageSize) || maxPageSize <= 0) {
    throw new ConfigurationError(
      "D1 maxPageSize must be a finite positive integer"
    )
  }
  const constraintMap = args.constraintMap ?? DEFAULT_CONSTRAINT_MAP
  if (
    args.maxOffset !== undefined &&
    (!Number.isSafeInteger(args.maxOffset) || args.maxOffset < 0)
  ) {
    throw new ConfigurationError(
      "D1 maxOffset must be a finite non-negative integer"
    )
  }

  const repository = {
    async findById(id: TId): Promise<T | null> {
      return fetchFirstByWhere<T>({
        db: args.db,
        table: args.table,
        whereClause: eq(primaryKeyColumn, id as never),
      })
    },
    async findOneWhere(filter: PredicateNode): Promise<T | null> {
      guardEmptyPredicate(filter, "findOneWhere", args.entity.name)
      return fetchFirstByWhere<T>({
        db: args.db,
        table: args.table,
        whereClause: predicateCompiler.compile(filter),
      })
    },
    async findMany(options?: QueryOptions): Promise<ListResult<T>> {
      const pagination = resolvePagination(
        options?.pagination,
        maxPageSize,
        args.maxOffset
      )
      const whereClause = options?.filter
        ? predicateCompiler.compile(options.filter)
        : undefined
      const [countResult] = await args.db
        .select({ count: count() })
        .from(args.table)
        .where(whereClause)
        .limit(1)

      const rowCount = Number(
        (countResult as { count?: number } | undefined)?.count ?? 0
      )
      const orderBy = compileOrderBy(
        options?.sort,
        args.columnMap,
        fallbackSortColumn,
        primaryKey,
        primaryKeyColumn
      )
      const rows = await args.db
        .select()
        .from(args.table)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(pagination.pageSize)
        .offset(pagination.offset)

      return {
        rows: rows as T[],
        rowCount,
        page: pagination.page,
        pageSize: pagination.pageSize,
      }
    },
    async insert(data: Partial<T>): Promise<T> {
      try {
        await args.db.insert(args.table).values(data)
      } catch (error) {
        rethrowConstraintError(error, constraintMap)
      }

      const id = data[primaryKey] as TId | undefined
      if (id === undefined)
        throw new Error(
          `Inserted ${args.entity.name} record is missing primary key value`
        )
      const inserted = await fetchFirstByWhere<T>({
        db: args.db,
        table: args.table,
        whereClause: eq(primaryKeyColumn, id as never),
      })

      if (!inserted)
        throw new NotFoundError(
          `${args.entity.name} record not found after insert`
        )
      return inserted
    },
    async update(
      id: TId,
      data: Partial<T>,
      options?: UpdateWhereOptions
    ): Promise<T> {
      assertVersionedWriteHasExpectedVersion(
        args.entity as unknown as EntityDescriptor<unknown>,
        options
      )
      if (!repository.updateOneWhereReturning) {
        throw new ConfigurationError(
          `Entity "${args.entity.name}" requires updateOneWhereReturning for update(id)`
        )
      }
      const updated = await repository.updateOneWhereReturning(
        Predicate.eq(primaryKey, id as never),
        data,
        options
      )
      if (!updated)
        throw new NotFoundError(`${args.entity.name} record not found`)
      return updated
    },
    async updateOneWhere(
      filter,
      data: Partial<T>,
      options?: UpdateWhereOptions
    ): Promise<{ updatedCount: number }> {
      guardEmptyPredicate(filter, "updateOneWhere", args.entity.name)
      guardAllRowDestructive(filter, "updateOneWhere", args.entity.name)
      assertVersionedWriteHasExpectedVersion(
        args.entity as unknown as EntityDescriptor<unknown>,
        options
      )

      if (options?.optimisticConcurrency) {
        if (!versionField) {
          throw new ConfigurationError(
            `Entity "${args.entity.name}" has no versionField configured. Optimistic concurrency requires a version column.`
          )
        }
      }

      let compiledFilter = predicateCompiler.compile(filter)
      const matchingRows = await fetchMatchingPrimaryKeys<{ primaryKey: TId }>({
        db: args.db,
        table: args.table,
        whereClause: compiledFilter,
        primaryKeyColumn,
      })
      if (matchingRows.length > 1) {
        throw new ValidationError(
          `${args.entity.name} updateOneWhere matched multiple rows`
        )
      }
      if (matchingRows.length === 0) {
        if (options?.optimisticConcurrency) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return { updatedCount: 0 }
      }
      compiledFilter = sql`${compiledFilter} AND ${eq(primaryKeyColumn, matchingRows[0]!.primaryKey as never)}`

      let setData = data as Record<string, unknown>

      if (versionField) {
        if (versionField in (data as Record<string, unknown>)) {
          throw new ConfigurationError(
            `Cannot set version field "${String(versionField)}" directly; the framework auto-increments it`
          )
        }
        const versionColumn = args.columnMap[versionField]!
        if (options?.optimisticConcurrency) {
          const expectedVersion = options.optimisticConcurrency.expectedVersion
          compiledFilter = sql`${compiledFilter} AND ${versionColumn} = ${expectedVersion as never}`
        }
        setData = {
          ...setData,
          [versionField]: sql`${versionColumn} + 1`,
        }
      }

      try {
        const result = await args.db
          .update(args.table)
          .set(setData)
          .where(compiledFilter)
        const updatedCount = getAffectedRows(result)
        if (options?.optimisticConcurrency && updatedCount === 0) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return { updatedCount }
      } catch (error) {
        if (error instanceof OptimisticConcurrencyError) throw error
        rethrowConstraintError(error, constraintMap)
      }
    },
    async updateManyWhere(
      filter,
      data: Partial<T>,
      options?: UpdateWhereOptions
    ): Promise<number> {
      guardEmptyPredicate(filter, "updateManyWhere", args.entity.name)
      guardAllRowDestructive(filter, "updateManyWhere", args.entity.name)
      assertVersionedWriteHasExpectedVersion(
        args.entity as unknown as EntityDescriptor<unknown>,
        options
      )
      if (options?.optimisticConcurrency && !versionField) {
        throw new ConfigurationError(
          `Entity "${args.entity.name}" has no versionField configured. Optimistic concurrency requires a version column.`
        )
      }
      const compiledWhere = predicateCompiler.compile(filter)
      if (!compiledWhere)
        throw new Error(
          `Update filter for ${args.entity.name} compiled to an empty where clause`
        )
      let updateWhere = compiledWhere
      let setData = data as Record<string, unknown>
      if (versionField) {
        const versionColumn = args.columnMap[versionField]!
        if (options?.optimisticConcurrency) {
          updateWhere = sql`${updateWhere} AND ${versionColumn} = ${options.optimisticConcurrency.expectedVersion as never}`
        }
        setData = { ...setData, [versionField]: sql`${versionColumn} + 1` }
      }
      try {
        const result = await args.db
          .update(args.table)
          .set(setData)
          .where(updateWhere)
        const updatedCount = getAffectedRows(result)
        if (options?.optimisticConcurrency && updatedCount === 0) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return updatedCount
      } catch (error) {
        if (error instanceof OptimisticConcurrencyError) throw error
        rethrowConstraintError(error, constraintMap)
      }
    },
    async delete(id: TId, options?: DeleteOptions): Promise<void> {
      assertVersionedWriteHasExpectedVersion(
        args.entity as unknown as EntityDescriptor<unknown>,
        options
      )
      const versionField = args.entity.versionField
      const versionColumn = versionField
        ? args.columnMap[versionField]
        : undefined
      if (options?.optimisticConcurrency && !versionColumn)
        throw new ConfigurationError(
          `Optimistic concurrency for "${args.entity.name}" requires a mapped version field`
        )
      const result = await args.db
        .delete(args.table)
        .where(
          options?.optimisticConcurrency
            ? and(
                eq(primaryKeyColumn, id as never),
                eq(
                  versionColumn!,
                  options.optimisticConcurrency.expectedVersion as never
                )
              )
            : eq(primaryKeyColumn, id as never)
        )

      if (getAffectedRows(result) === 0 && options?.idempotent !== true) {
        throw new NotFoundError(`${args.entity.name} record not found`)
      }
    },
    async deleteWhere(
      filter,
      options?: DeleteOptions
    ): Promise<{ deletedCount: number }> {
      guardEmptyPredicate(filter, "deleteWhere", args.entity.name)
      guardAllRowDestructive(filter, "deleteWhere", args.entity.name)
      assertVersionedWriteHasExpectedVersion(
        args.entity as unknown as EntityDescriptor<unknown>,
        options
      )
      const versionField = args.entity.versionField
      const versionColumn = versionField
        ? args.columnMap[versionField]
        : undefined
      if (options?.optimisticConcurrency && !versionColumn) {
        throw new ConfigurationError(
          `Optimistic concurrency for "${args.entity.name}" requires a mapped version field`
        )
      }
      const compiledWhere = predicateCompiler.compile(filter)
      if (!compiledWhere)
        throw new Error(
          `Delete filter for ${args.entity.name} compiled to an empty where clause`
        )
      let whereClause = compiledWhere
      if (options?.optimisticConcurrency) {
        whereClause = and(
          whereClause,
          eq(
            versionColumn!,
            options.optimisticConcurrency.expectedVersion as never
          )
        )!
      }
      const result = await args.db.delete(args.table).where(whereClause)

      const deletedCount = getAffectedRows(result)
      if (options?.optimisticConcurrency && deletedCount === 0) {
        throw new OptimisticConcurrencyError(
          `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
        )
      }
      return { deletedCount }
    },
  } as Repository<T, TId>

  const updateReturning = args.db.updateReturning
  if (updateReturning) {
    repository.updateOneWhereReturning = async (filter, data, options) => {
      guardEmptyPredicate(filter, "updateOneWhereReturning", args.entity.name)
      guardAllRowDestructive(
        filter,
        "updateOneWhereReturning",
        args.entity.name
      )
      assertVersionedWriteHasExpectedVersion(
        args.entity as unknown as EntityDescriptor<unknown>,
        options
      )
      if (options?.optimisticConcurrency && !versionField) {
        throw new ConfigurationError(
          `Entity "${args.entity.name}" has no versionField configured. Optimistic concurrency requires a version column.`
        )
      }
      const compiledFilter = predicateCompiler.compile(filter)
      const matchingRows = await fetchMatchingPrimaryKeys<{ primaryKey: TId }>({
        db: args.db,
        table: args.table,
        whereClause: compiledFilter,
        primaryKeyColumn,
      })
      if (matchingRows.length > 1) {
        throw new ValidationError(
          `${args.entity.name} updateOneWhereReturning matched multiple rows`
        )
      }
      if (matchingRows.length === 0) {
        if (options?.optimisticConcurrency) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return null
      }

      let whereClause: SQL<unknown> = sql`${compiledFilter} AND ${eq(primaryKeyColumn, matchingRows[0]!.primaryKey)}`
      let setData = data as Record<string, unknown>
      if (versionField) {
        if (versionField in setData) {
          throw new ConfigurationError(
            `Cannot set version field "${String(versionField)}" directly; the framework auto-increments it`
          )
        }
        const versionColumn = args.columnMap[versionField]!
        if (options?.optimisticConcurrency) {
          whereClause = sql`${whereClause} AND ${versionColumn} = ${options.optimisticConcurrency.expectedVersion as never}`
        }
        setData = { ...setData, [versionField]: sql`${versionColumn} + 1` }
      }

      try {
        const [updated] = await updateReturning(
          args.table,
          setData,
          whereClause
        )
        if (!updated && options?.optimisticConcurrency) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return (updated as T | undefined) ?? null
      } catch (error) {
        if (error instanceof OptimisticConcurrencyError) throw error
        rethrowConstraintError(error, constraintMap)
      }
    }
  }

  return repository
}
