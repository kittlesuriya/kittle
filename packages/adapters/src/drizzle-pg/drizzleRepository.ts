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
import type { AnyPgTable } from "drizzle-orm/pg-core"
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
import type { PredicateNode } from "core/domain"
import type {
  DrizzleColumnMap,
  DrizzlePredicateCompiler,
} from "./drizzlePredicateCompiler"
import { DrizzlePredicateCompiler as DefaultDrizzlePredicateCompiler } from "./drizzlePredicateCompiler"
import {
  BusinessRuleError,
  ConflictError,
  FrameworkCoreError,
  NotFoundError,
  RetryablePersistenceError,
  ValidationError,
  ConfigurationError,
  OptimisticConcurrencyError,
} from "core/domain"

export type SelectableRow = Record<string, unknown>

export interface DrizzleUpdateResult {
  affectedRows: number
}

export interface DrizzleSessionLike {
  atomicJobTransition?: (args: {
    updateTable: AnyPgTable
    updateSet: unknown
    updateWhere: SQL<unknown> | undefined
    historyTable: AnyPgTable
    historyValues: Record<string, unknown>
    historyWhere: SQL<unknown> | undefined
  }) => Promise<{ applied: boolean; historyId: string }>
  select: (...args: unknown[]) => {
    from: (table: AnyPgTable) => {
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
  insert: (table: AnyPgTable) => {
    values: (data: unknown) => Promise<unknown> & {
      onConflictDoNothing: (config?: {
        target: AnyColumn[]
      }) => Promise<unknown>
      returning: <TReturning>(columns?: unknown) => Promise<TReturning[]>
    }
  }
  update: (table: AnyPgTable) => {
    set: (data: unknown) => {
      where: (
        whereClause: SQL<unknown> | undefined
      ) => Promise<DrizzleUpdateResult> & {
        returning: <TReturning>(columns?: unknown) => Promise<TReturning[]>
      }
    }
  }
  delete: (table: AnyPgTable) => {
    where: (
      whereClause: SQL<unknown> | undefined
    ) => Promise<DrizzleUpdateResult> & {
      returning: <TReturning>(columns?: unknown) => Promise<TReturning[]>
    }
  }
}

const DEFAULT_PAGE_SIZE = 20
const DEFAULT_MAX_PAGE_SIZE = 100

const DEFAULT_CONSTRAINT_MAP: Record<string, string> = {}

export interface CreateDrizzleRepositoryArgs<T> {
  db: DrizzleSessionLike
  table: AnyPgTable
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

function findPgErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let i = 0; i < 5 && current; i++) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as Record<string, unknown>).code
      if (typeof code === "string" && code.length === 5) return code
    }
    current = (current as Record<string, unknown>)?.cause
  }
  return undefined
}

function rethrowConstraintError(
  error: unknown,
  constraintMap: Record<string, string>
): never {
  if (error instanceof FrameworkCoreError) throw error

  const code = findPgErrorCode(error)
  const msg = error instanceof Error ? error.message : String(error)

  if (code === "23505" || /unique/i.test(msg)) {
    throw new ConflictError(
      resolveConstraintMessage(constraintMap, msg) ??
        "A record with this value already exists"
    )
  }
  if (code === "23503" || /foreign key/i.test(msg)) {
    throw new BusinessRuleError(
      resolveConstraintMessage(constraintMap, msg) ??
        "Referenced record not found"
    )
  }
  if (code === "23502" || /NOT NULL/i.test(msg)) {
    throw new ValidationError("A required field is missing")
  }
  if (code === "23514" || /CHECK constraint/i.test(msg)) {
    throw new BusinessRuleError("A validation check failed")
  }
  if (code === "40001")
    throw new RetryablePersistenceError(
      "Serialization failure detected — retry the operation",
      { postgresCode: code }
    )
  if (code === "40P01")
    throw new RetryablePersistenceError(
      "Deadlock detected — retry the operation",
      { postgresCode: code }
    )
  throw error instanceof Error ? error : new Error(msg)
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
  table: AnyPgTable
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
  table: AnyPgTable
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
      "PostgreSQL maxPageSize must be a finite positive integer"
    )
  }
  const constraintMap = args.constraintMap ?? DEFAULT_CONSTRAINT_MAP
  if (
    args.maxOffset !== undefined &&
    (!Number.isSafeInteger(args.maxOffset) || args.maxOffset < 0)
  ) {
    throw new ConfigurationError(
      "PostgreSQL maxOffset must be a finite non-negative integer"
    )
  }

  return {
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
        const [inserted] = await args.db
          .insert(args.table)
          .values(data)
          .returning<T>()
        if (!inserted) {
          throw new ConfigurationError(
            `${args.entity.name} INSERT ... RETURNING returned no rows`
          )
        }
        return inserted
      } catch (error) {
        rethrowConstraintError(error, constraintMap)
      }
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
      if (options?.optimisticConcurrency && !versionField) {
        throw new ConfigurationError(
          `Entity "${args.entity.name}" has no versionField configured. Optimistic concurrency requires a version column.`
        )
      }

      if (versionField && versionField in (data as Record<string, unknown>)) {
        throw new ConfigurationError(
          `Cannot set version field "${String(versionField)}" directly; the framework auto-increments it`
        )
      }
      const setData = versionField
        ? {
            ...(data as Record<string, unknown>),
            [versionField]: sql`${args.columnMap[versionField]!} + 1`,
          }
        : data
      const whereClause =
        options?.optimisticConcurrency && versionField
          ? sql`${eq(primaryKeyColumn, id as never)} AND ${args.columnMap[versionField]!} = ${options.optimisticConcurrency.expectedVersion as never}`
          : eq(primaryKeyColumn, id as never)

      try {
        const [updated] = await args.db
          .update(args.table)
          .set(setData)
          .where(whereClause)
          .returning<T>()
        if (!updated) {
          if (options?.optimisticConcurrency) {
            throw new OptimisticConcurrencyError(
              `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
            )
          }
          throw new NotFoundError(`${args.entity.name} record not found`)
        }
        return updated
      } catch (error) {
        rethrowConstraintError(error, constraintMap)
      }
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

      const compiledFilter = predicateCompiler.compile(filter)
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
      const matchedPrimaryKey = matchingRows[0]!.primaryKey
      const oneRowFilter = sql`${compiledFilter} AND ${eq(primaryKeyColumn, matchedPrimaryKey as never)}`

      let setData = data as Record<string, unknown>

      if (versionField) {
        const versionColumn = args.columnMap[versionField]!
        setData = {
          ...setData,
          [versionField]: sql`${versionColumn} + 1`,
        }

        const combinedWhere = options?.optimisticConcurrency
          ? sql`${oneRowFilter} AND ${versionColumn} = ${options.optimisticConcurrency.expectedVersion as never}`
          : oneRowFilter
        try {
          const updated = await args.db
            .update(args.table)
            .set(setData)
            .where(combinedWhere)
            .returning<T>()
          const updatedCount = updated.length

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
      }

      try {
        const updated = await args.db
          .update(args.table)
          .set(setData)
          .where(oneRowFilter)
          .returning<T>()
        return { updatedCount: updated.length }
      } catch (error) {
        rethrowConstraintError(error, constraintMap)
      }
    },
    async updateOneWhereReturning(
      filter,
      data: Partial<T>,
      options?: UpdateWhereOptions
    ): Promise<T | null> {
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

      const matchedPrimaryKey = matchingRows[0]!.primaryKey
      const oneRowFilter = sql`${compiledFilter} AND ${eq(primaryKeyColumn, matchedPrimaryKey as never)}`
      let whereClause = oneRowFilter
      let setData = data as Record<string, unknown>
      if (versionField) {
        const versionColumn = args.columnMap[versionField]!
        setData = { ...setData, [versionField]: sql`${versionColumn} + 1` }
        if (options?.optimisticConcurrency) {
          whereClause = sql`${whereClause} AND ${versionColumn} = ${options.optimisticConcurrency.expectedVersion as never}`
        }
      }

      try {
        const [updated] = await args.db
          .update(args.table)
          .set(setData)
          .where(whereClause)
          .returning<T>()
        if (!updated && options?.optimisticConcurrency) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return updated ?? null
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
        const updated = await args.db
          .update(args.table)
          .set(setData)
          .where(updateWhere)
          .returning<T>()
        if (options?.optimisticConcurrency && updated.length === 0) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return updated.length
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
      try {
        const versionField = args.entity.versionField
        const versionColumn = versionField
          ? args.columnMap[versionField]
          : undefined
        if (options?.optimisticConcurrency && !versionColumn)
          throw new ConfigurationError(
            `Optimistic concurrency for "${args.entity.name}" requires a mapped version field`
          )
        const deleted = await args.db
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
          .returning<T>()

        if (deleted.length === 0 && options?.idempotent !== true) {
          throw new NotFoundError(`${args.entity.name} record not found`)
        }
      } catch (error) {
        if (error instanceof NotFoundError) throw error
        rethrowConstraintError(error, constraintMap)
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
      try {
        const versionField = args.entity.versionField
        const versionColumn = versionField
          ? args.columnMap[versionField]
          : undefined
        if (options?.optimisticConcurrency && !versionColumn) {
          throw new ConfigurationError(
            `Optimistic concurrency for "${args.entity.name}" requires a mapped version field`
          )
        }
        let whereClause = predicateCompiler.compile(filter)
        if (options?.optimisticConcurrency) {
          const versionPredicate = eq(
            versionColumn!,
            options.optimisticConcurrency.expectedVersion as never
          )
          whereClause = whereClause
            ? (and(whereClause, versionPredicate) ?? versionPredicate)
            : versionPredicate
        }
        const deleted = await args.db
          .delete(args.table)
          .where(whereClause)
          .returning<T>()

        if (options?.optimisticConcurrency && deleted.length === 0) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return { deletedCount: deleted.length }
      } catch (error) {
        if (
          error instanceof OptimisticConcurrencyError ||
          error instanceof ConfigurationError
        )
          throw error
        rethrowConstraintError(error, constraintMap)
      }
    },
  }
}
