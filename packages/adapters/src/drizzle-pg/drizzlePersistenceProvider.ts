import type { AnyPgTable, PgTransactionConfig } from "drizzle-orm/pg-core"
import type {
  InteractiveTransactionProvider,
  TransactionOptions,
  PersistenceCapabilities,
  PersistenceProvider,
} from "core/ports"
import type { EntityDescriptor, Repository } from "core/ports"
import type { DrizzleSessionLike } from "./drizzleRepository"
import { createDrizzleRepository } from "./drizzleRepository"
import type { DrizzleColumnMap } from "./drizzlePredicateCompiler"
import { ConfigurationError } from "core/domain"
import { createPgSession, type PgDatabaseLike } from "./pgSession"

const sessionByProvider = new WeakMap<PersistenceProvider, DrizzleSessionLike>()

export function getDrizzleSession(
  provider: PersistenceProvider
): DrizzleSessionLike {
  const session = sessionByProvider.get(provider)
  if (!session)
    throw new ConfigurationError(
      "No Drizzle session found for this persistence provider"
    )
  return session
}

export interface EntityMapping {
  table: AnyPgTable
  columnMap: DrizzleColumnMap
}

export class DrizzleEntityRegistry {
  private mappings = new Map<string, EntityMapping>()

  register<T>(
    entity: EntityDescriptor<T>,
    table: AnyPgTable,
    columnMap: DrizzleColumnMap,
    namespace?: string
  ): this {
    const key = namespace ? `${namespace}:${entity.name}` : entity.name
    validateEntityRegistration(entity, columnMap, key)
    if (this.mappings.has(key)) {
      throw new ConfigurationError(
        `Entity "${key}" is already registered in the Drizzle entity registry.`
      )
    }
    this.mappings.set(key, { table, columnMap })
    return this
  }

  get(entityName: string, namespace?: string): EntityMapping | undefined {
    const key = namespace ? `${namespace}:${entityName}` : entityName
    return this.mappings.get(key)
  }
}

function validateEntityRegistration<T>(
  entity: EntityDescriptor<T>,
  columnMap: DrizzleColumnMap,
  key: string
): void {
  if (!entity || typeof entity.name !== "string" || entity.name.trim() === "") {
    throw new ConfigurationError(
      `Drizzle registry registration "${key}" requires a non-empty entity name.`
    )
  }
  if (
    !entity.fields ||
    typeof entity.fields !== "object" ||
    Object.keys(entity.fields).length === 0
  ) {
    throw new ConfigurationError(
      `Entity "${key}" must declare fields before registration.`
    )
  }
  for (const mapKey of Object.keys(columnMap)) {
    if (mapKey === "") {
      throw new ConfigurationError(
        `Entity "${key}" declares an empty column map key.`
      )
    }
  }
  const declaredFields = Object.keys(entity.fields)
  const missingFields = declaredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(columnMap, field)
  )
  if (missingFields.length > 0) {
    throw new ConfigurationError(
      `Entity "${key}" column map is missing fields: ${missingFields.join(", ")}.`
    )
  }
  const primaryKey = entity.primaryKey ?? ("id" as string)
  if (!declaredFields.includes(String(primaryKey))) {
    throw new ConfigurationError(
      `Entity "${key}" primary key "${String(primaryKey)}" is not a declared field.`
    )
  }
  if (
    entity.versionField !== undefined &&
    !declaredFields.includes(String(entity.versionField))
  ) {
    throw new ConfigurationError(
      `Entity "${key}" version field "${String(entity.versionField)}" is not a declared field.`
    )
  }
}

interface PgEntityRegistry {
  get(entityName: string, namespace?: string): EntityMapping | undefined
}

interface PgProviderArgs {
  db: PgDatabaseLike
  registry: PgEntityRegistry
  constraintMap?: Record<string, string>
  limits?: { maxPageSize?: number }
}

function validatePgConfiguredLimit(
  name: "maxPageSize",
  value: number | undefined
): number | undefined {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)
  ) {
    throw new ConfigurationError(
      `PostgreSQL ${name} must be a finite positive integer`
    )
  }
  return value
}

export function createDrizzlePersistenceProvider(
  args: PgProviderArgs
): InteractiveTransactionProvider {
  const maxPageSize = validatePgConfiguredLimit(
    "maxPageSize",
    args.limits?.maxPageSize
  )
  const capabilities: PersistenceCapabilities = {
    interactiveTransactions: true,
    atomicBatch: false,
    returningInsert: true,
    readSessions: false,
    jsonQueries: true,
    // The supported application PG schema maps numeric columns to number mode.
    exactDecimal: false,
    persistentConnection: true,
    conditionalAbacUpdate: true,
    maxPageSize: maxPageSize ?? 100,
  }

  function createScopedProvider(
    txDb: PgDatabaseLike,
    inTransaction: boolean
  ): InteractiveTransactionProvider {
    const session = createPgSession(txDb)
    const provider: InteractiveTransactionProvider = {
      dialect: "postgresql",
      capabilities: capabilities as PersistenceCapabilities & {
        interactiveTransactions: true
      },

      repository<T, TId = string>(
        entity: EntityDescriptor<T>
      ): Repository<T, TId> {
        const mapping = args.registry.get(
          entity.name,
          (entity as EntityDescriptor<T> & { namespace?: string }).namespace
        )
        if (!mapping) {
          throw new ConfigurationError(
            `Entity "${entity.name}" is not registered in the Drizzle entity registry`
          )
        }

        return createDrizzleRepository({
          db: session,
          table: mapping.table,
          entity: entity,
          columnMap: mapping.columnMap,
          ...(capabilities.maxPageSize !== undefined
            ? { maxPageSize: capabilities.maxPageSize }
            : {}),
          ...(args.constraintMap !== undefined
            ? { constraintMap: args.constraintMap }
            : {}),
        }) as unknown as Repository<T, TId>
      },

      async runInTransaction<TResult>(
        work: (scoped: InteractiveTransactionProvider) => Promise<TResult>,
        options?: TransactionOptions
      ): Promise<TResult> {
        if (inTransaction) {
          throw new ConfigurationError(
            "Nested PostgreSQL transactions are not supported by this adapter"
          )
        }
        const transactionOptions: PgTransactionConfig = {}
        if (options?.isolationLevel !== undefined)
          transactionOptions.isolationLevel = options.isolationLevel
        if (options?.accessMode !== undefined)
          transactionOptions.accessMode = options.accessMode
        return args.db.transaction(async (tx) => {
          const txProvider = createScopedProvider(tx, true)
          return work(txProvider)
        }, transactionOptions)
      },
    }
    sessionByProvider.set(provider, session)
    return provider
  }

  return createScopedProvider(args.db, false)
}
