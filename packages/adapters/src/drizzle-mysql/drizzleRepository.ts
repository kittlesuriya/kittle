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
import type { AnyMySqlTable } from "drizzle-orm/mysql-core"
import type {
  DeleteOptions,
  EntityDescriptor,
  ListResult,
  PaginationSpec,
  QueryOptions,
  Repository,
  SortSpec,
  UpdateWhereOptions,
} from "kittle-core/ports"
import { assertVersionedWriteHasExpectedVersion } from "kittle-core/ports"
import type { PredicateNode } from "kittle-core/domain"
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
} from "kittle-core/domain"

export type SelectableRow = Record<string, unknown>

export interface DrizzleUpdateResult {
  affectedRows: number
}

export interface DrizzleSessionLike {
  select: (...args: unknown[]) => {
    from: (table: AnyMySqlTable) => {
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
  insert: (table: AnyMySqlTable) => {
    values: (data: unknown) => Promise<unknown> & {
      onDuplicateDoNothing?: (config?: {
        target: AnyColumn[]
      }) => Promise<unknown>
      onDuplicateDoUpdate?: (config: {
        target: AnyColumn[]
        set: unknown
      }) => Promise<unknown>
    }
  }
  update: (table: AnyMySqlTable) => {
    set: (data: unknown) => {
      where: (
        whereClause: SQL<unknown> | undefined
      ) => Promise<DrizzleUpdateResult>
    }
  }
  delete: (table: AnyMySqlTable) => {
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
  table: AnyMySqlTable
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

function findMysqlErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let i = 0; i < 5 && current; i++) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as Record<string, unknown>).code
      if (typeof code === "string") return code
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

  const code = findMysqlErrorCode(error)
  const msg = error instanceof Error ? error.message : String(error)

  // MySQL unique constraint violation
  if (code === "ER_DUP_ENTRY" || code === "23505" || /unique/i.test(msg)) {
    throw new ConflictError(
      resolveConstraintMessage(constraintMap, msg) ??
        "A record with this value already exists"
    )
  }
  // MySQL foreign key constraint violation
  if (
    code === "ER_NO_REFERENCED_ROW_2" ||
    code === "ER_NO_REFERENCED_ROW" ||
    code === "23503" ||
    /foreign key/i.test(msg)
  ) {
    throw new BusinessRuleError(
      resolveConstraintMessage(constraintMap, msg) ??
        "Referenced record not found"
    )
  }
  // MySQL NOT NULL constraint
  if (
    code === "ER_BAD_NULL_ERROR" ||
    code === "23502" ||
    /NOT NULL/i.test(msg)
  ) {
    throw new ValidationError("A required field is missing")
  }
  // MySQL CHECK constraint
  if (code === "ER_CHECK_CONSTRAINT_VIOLATED" || /CHECK constraint/i.test(msg)) {
    throw new BusinessRuleError("A validation check failed")
  }
  // MySQL deadlock
  if (code === "ER_LOCK_DEADLOCK" || code === "40P01") {
    throw new RetryablePersistenceError(
      "Deadlock detected — retry the operation",
      { mysqlCode: code }
    )
  }
  // MySQL lock wait timeout
  if (code === "ER_LOCK_WAIT_TIMEOUT") {
    throw new RetryablePersistenceError(
      "Lock wait timeout exceeded — retry the operation",
      { mysqlCode: code }
    )
  }
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

/**
 * Fetch a single row matching the where clause. MySQL does not support
 * .returning(), so we use SELECT * after the write operation.
 */
async function fetchFirstByWhere<T>(args: {
  db: DrizzleSessionLike
  table: AnyMySqlTable
  whereClause: SQL<unknown> | undefined
}): Promise<T | null> {
  const [row] = await args.db
    .select()
    .from(args.table)
    .where(args.whereClause)
    .limit(1)

  return (row as T | undefined) ?? null
}

/**
 * Fetch matching primary keys to determine how many rows would be affected.
 */
async function fetchMatchingPrimaryKeys<T>(args: {
  db: DrizzleSessionLike
  table: AnyMySqlTable
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
      "MySQL maxPageSize must be a finite positive integer"
    )
  }
  const constraintMap = args.constraintMap ?? DEFAULT_CONSTRAINT_MAP
  if (
    args.maxOffset !== undefined &&
    (!Number.isSafeInteger(args.maxOffset) || args.maxOffset < 0)
  ) {
    throw new ConfigurationError(
      "MySQL maxOffset must be a finite non-negative integer"
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
        await args.db.insert(args.table).values(data)
        // MySQL does not support .returning(). Fetch the inserted row by PK.
        const pkValue = (data as Record<string, unknown>)[primaryKey]
        if (pkValue === undefined) {
          // If the PK was auto-generated, we need to read it back from the
          // insert result. Since our session wrapper doesn't expose insertId,
          // we fall back to a best-effort read.
          throw new ConfigurationError(
            `${args.entity.name} INSERT on MySQL requires the primary key to be provided in the data`
          )
        }
        const inserted = await fetchFirstByWhere<T>({
          db: args.db,
          table: args.table,
          whereClause: eq(primaryKeyColumn, pkValue as never),
        })
        if (!inserted) {
          throw new ConfigurationError(
            `${args.entity.name} INSERT on MySQL could not read back the inserted row`
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
        const result = await args.db
          .update(args.table)
          .set(setData)
          .where(whereClause)
        if (result.affectedRows === 0) {
          if (options?.optimisticConcurrency) {
            throw new OptimisticConcurrencyError(
              `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
            )
          }
          throw new NotFoundError(`${args.entity.name} record not found`)
        }
        // Read back the updated row
        const updated = await fetchFirstByWhere<T>({
          db: args.db,
          table: args.table,
          whereClause: eq(primaryKeyColumn, id as never),
        })
        if (!updated) {
          throw new NotFoundError(`${args.entity.name} record not found after update`)
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
          const result = await args.db
            .update(args.table)
            .set(setData)
            .where(combinedWhere)

          if (options?.optimisticConcurrency && result.affectedRows === 0) {
            throw new OptimisticConcurrencyError(
              `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
            )
          }

          return { updatedCount: result.affectedRows }
        } catch (error) {
          if (error instanceof OptimisticConcurrencyError) throw error
          rethrowConstraintError(error, constraintMap)
        }
      }

      try {
        const result = await args.db
          .update(args.table)
          .set(setData)
          .where(oneRowFilter)
        return { updatedCount: result.affectedRows }
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
        const result = await args.db
          .update(args.table)
          .set(setData)
          .where(whereClause)

        if (result.affectedRows === 0 && options?.optimisticConcurrency) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }

        if (result.affectedRows === 0) return null

        // Read back the updated row (MySQL has no .returning())
        return await fetchFirstByWhere<T>({
          db: args.db,
          table: args.table,
          whereClause: eq(primaryKeyColumn, matchedPrimaryKey as never),
        })
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
        if (options?.optimisticConcurrency && result.affectedRows === 0) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return result.affectedRows
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

        if (result.affectedRows === 0 && options?.idempotent !== true) {
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
        const result = await args.db
          .delete(args.table)
          .where(whereClause)

        if (options?.optimisticConcurrency && result.affectedRows === 0) {
          throw new OptimisticConcurrencyError(
            `${args.entity.name} version mismatch: expected version ${String(options.optimisticConcurrency.expectedVersion)}`
          )
        }
        return { deletedCount: result.affectedRows }
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
