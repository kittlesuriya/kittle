import type { PersistenceCapabilities } from "./capabilities"
import type { PredicateNode } from "../domain/predicate"
import type { AuditRecord } from "./audit"
import type { OutboxRecord } from "./outbox"
import { ConfigurationError } from "../domain"

export interface SortSpec {
  field: string
  direction: "asc" | "desc"
}

export interface PaginationSpec {
  page: number
  pageSize: number
}

export interface QueryOptions {
  filter?: PredicateNode
  sort?: SortSpec[]
  pagination?: PaginationSpec
}

export interface ListResult<T> {
  rows: T[]
  rowCount: number
  page: number
  pageSize: number
}

export interface FieldDescriptor {
  type: "string" | "number" | "boolean" | "date" | "json"
  nullable?: boolean
  format?: FieldFormat
}

export type FieldFormat =
  "text" | "email" | "phone" | "date" | "identifier" | "json"

export interface EntityDescriptor<T> {
  name: string
  namespace?: string
  primaryKey?: keyof T & string
  tenantField?: keyof T & string
  versionField?: keyof T & string
  fields: Record<keyof T & string, FieldDescriptor>
  immutableFields?: Array<keyof T & string>
}

/** Brand token for `VersionBypassCapability`; signals intentional OCC bypass. */
const VERSION_BYPASS_BRAND: unique symbol = Symbol.for("core.version-bypass")

/**
 * Defense-in-depth capability for internal code that intentionally skips OCC
 * version checks on versioned entities. Callers holding this token acknowledge
 * they are bypassing optimistic concurrency and accept the risk of stale writes.
 * The auto-increment in repository update methods is the primary safeguard;
 * this capability is for cases where bypass is deliberate and documented.
 */
export interface VersionBypassCapability {
  readonly [VERSION_BYPASS_BRAND]: true
}

export interface UpdateWhereOptions {
  optimisticConcurrency?: { expectedVersion: string | number }
}

export interface DeleteOptions {
  idempotent?: boolean
  /** Delete only when the row still has this version. */
  optimisticConcurrency?: { expectedVersion: string | number }
}

/**
 * Version discipline contract: every entity that declares `versionField` is a
 * versioned (OCC) entity. Every write to such an entity MUST advance
 * `versionField`, and conditional writes MUST fence on the expected version so
 * a concurrent policy-relevant writer cannot slip a stale authorization
 * decision past the mutation. Raw writes that bypass OCC (plain update/delete
 * without an expected version) are unsafe for versioned entities and are only
 * permitted through explicit, consciously-opted-in internal paths.
 */
export interface Repository<T, TId = string> {
  findById(id: TId): Promise<T | null>
  findOneWhere?(filter: PredicateNode): Promise<T | null>
  findMany(options?: QueryOptions): Promise<ListResult<T>>
  insert(data: Partial<T>): Promise<T>
  /**
   * Updates a record by primary key. Version fields on versioned entities are
   * framework-owned: callers must NOT include the version field in the data.
   * The framework auto-increments the version on every update.
   * A primary-key update returns the post-mutation row.
   */
  update(id: TId, data: Partial<T>, options?: UpdateWhereOptions): Promise<T>
  /** Conditional updates intentionally return only their affected-row count. */
  updateOneWhere?(
    filter: PredicateNode,
    data: Partial<T>,
    options?: UpdateWhereOptions
  ): Promise<{ updatedCount: number }>
  /** A conditional update returns the exact post-mutation row, or null when no row matched. */
  updateOneWhereReturning?(
    filter: PredicateNode,
    data: Partial<T>,
    options?: UpdateWhereOptions
  ): Promise<T | null>
  updateManyWhere?(
    filter: PredicateNode,
    data: Partial<T>,
    options?: UpdateWhereOptions
  ): Promise<number>
  delete(id: TId, options?: DeleteOptions): Promise<void>
  deleteWhere?(
    filter: PredicateNode,
    options?: DeleteOptions
  ): Promise<{ deletedCount: number }>
  bulkInsert?(data: Partial<T>[]): Promise<T[]>
}

export interface PersistenceProvider {
  readonly dialect: string
  readonly capabilities: PersistenceCapabilities

  repository<T, TId = string>(entity: EntityDescriptor<T>): Repository<T, TId>
}

/** The read-only surface exposed to read lifecycle hooks. */
export interface ReadOnlyRepository<T, TId = string> {
  findById(id: TId): Promise<T | null>
  findOneWhere?(filter: PredicateNode): Promise<T | null>
  findMany(options?: QueryOptions): Promise<ListResult<T>>
}

/** A persistence capability that structurally cannot mutate durable state. */
export interface ReadOnlyPersistenceProvider {
  readonly dialect: string
  readonly capabilities: PersistenceCapabilities

  repository<T, TId = string>(
    entity: EntityDescriptor<T>
  ): ReadOnlyRepository<T, TId>
}

/** Wrap a provider so operation code can only use its read path. */
export function createReadOnlyPersistenceProvider(
  provider: PersistenceProvider
): ReadOnlyPersistenceProvider {
  const readOnlyRepository = <T, TId>(
    entity: EntityDescriptor<T>
  ): ReadOnlyRepository<T, TId> => {
    const repository = provider.repository<T, TId>(entity)
    const reject = (): Promise<never> => {
      return Promise.reject(
        new ConfigurationError(
          "Read operations cannot perform persistence mutations."
        )
      )
    }
    const readOnlyRepo: ReadOnlyRepository<T, TId> = {
      findById: (id) => repository.findById(id),
      ...(repository.findOneWhere
        ? {
            findOneWhere: (filter: PredicateNode) =>
              repository.findOneWhere!(filter),
          }
        : {}),
      findMany: (options) => repository.findMany(options),
    }
    // Runtime enforcement for callers that cast the read-only surface to a
    // mutable Repository type: mutations reject instead of failing obscurely.
    return Object.assign(readOnlyRepo, {
      insert: reject,
      update: reject,
      ...(repository.updateOneWhere ? { updateOneWhere: reject } : {}),
      ...(repository.updateOneWhereReturning
        ? { updateOneWhereReturning: reject }
        : {}),
      ...(repository.updateManyWhere ? { updateManyWhere: reject } : {}),
      delete: reject,
      ...(repository.deleteWhere ? { deleteWhere: reject } : {}),
      ...(repository.bulkInsert ? { bulkInsert: reject } : {}),
    })
  }

  const readOnly: ReadOnlyPersistenceProvider = {
    dialect: provider.dialect,
    capabilities: provider.capabilities,
    repository: readOnlyRepository,
  }
  if (supportsInteractiveTransactions(provider)) {
    const transactional = readOnly as unknown as InteractiveTransactionProvider
    transactional.runInTransaction = (work, options) =>
      provider.runInTransaction(
        (scoped) =>
          work(
            createReadOnlyPersistenceProvider(
              scoped
            ) as unknown as PersistenceProvider
          ),
        { ...options, accessMode: "read only" }
      )
  }
  return readOnly
}

export interface TransactionOptions {
  isolationLevel?: "read committed" | "repeatable read" | "serializable"
  accessMode?: "read only" | "read write"
}

export interface InteractiveTransactionProvider extends PersistenceProvider {
  readonly capabilities: PersistenceCapabilities & {
    interactiveTransactions: true
  }
  runInTransaction<TResult>(
    work: (scoped: PersistenceProvider) => Promise<TResult>,
    options?: TransactionOptions
  ): Promise<TResult>
}

export function supportsInteractiveTransactions(
  provider: PersistenceProvider
): provider is InteractiveTransactionProvider {
  return (
    provider.capabilities.interactiveTransactions === true &&
    typeof (provider as Partial<InteractiveTransactionProvider>)
      .runInTransaction === "function"
  )
}

export type AtomicBatchItem<TCommand = unknown> =
  | { kind: "command"; command: TCommand }
  | { kind: "audit"; record: AuditRecord }
  | { kind: "outbox"; record: OutboxRecord }
  | {
      kind: "idempotency"
      commit: import("./idempotency").IdempotencyCommitItem
    }

export interface AtomicBatchPlan<TCommand = unknown> {
  readonly items: readonly AtomicBatchItem<TCommand>[]
}

export type AtomicBatchItemResult =
  | { readonly kind: "command"; readonly result: unknown }
  | { readonly kind: "audit"; readonly result: unknown }
  | { readonly kind: "outbox"; readonly result: unknown }
  | { readonly kind: "idempotency"; readonly result: unknown }

export type AtomicBatchResult = readonly AtomicBatchItemResult[]

export type TenantScopedWriteCommand =
  | {
      readonly kind: "insert"
      readonly entity: string
      readonly values: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: "update"
      readonly entity: string
      readonly filter: PredicateNode
      readonly values: Readonly<Record<string, unknown>>
      readonly expectedVersion?: string | number
      readonly expectedAffectedRows?: number
    }
  | {
      readonly kind: "delete"
      readonly entity: string
      readonly filter: PredicateNode
      readonly expectedVersion?: string | number
      readonly expectedAffectedRows?: number
    }

/** Adapters own this encoder; callers only submit typed write commands. */
export interface TenantScopedAtomicBatchCommandEncoder<TCommand = unknown> {
  readonly tenantId: string
  encode(command: TCommand): TCommand
}

export interface TenantScopedAtomicBatchCommandProvider<TCommand = unknown> {
  createTenantScopedCommandEncoder(
    tenantId: string
  ): TenantScopedAtomicBatchCommandEncoder<TCommand>
}

export type TenantScopedAtomicBatchPlan<TCommand = unknown> =
  AtomicBatchPlan<TCommand>

export interface AtomicBatchProvider<
  TCommand = unknown,
> extends PersistenceProvider {
  readonly capabilities: PersistenceCapabilities & {
    atomicBatch: true
    atomicBatchScope?: "unscoped"
  }
  executeAtomicBatch(
    plan: AtomicBatchPlan<TCommand>
  ): Promise<AtomicBatchResult>
}

export interface TenantScopedAtomicBatchProvider<
  TCommand = unknown,
> extends PersistenceProvider {
  readonly capabilities: PersistenceCapabilities & {
    atomicBatch: true
    atomicBatchScope: "tenant-scoped"
  }
  /** The scoped provider's adapter-owned command encoder. */
  readonly tenantId: string
  readonly commandEncoder: TenantScopedAtomicBatchCommandEncoder<TCommand>
  executeAtomicBatch(
    plan: TenantScopedAtomicBatchPlan<TCommand>
  ): Promise<AtomicBatchResult>
}

export type AtomicBatchCapableProvider<TCommand = unknown> =
  AtomicBatchProvider<TCommand> | TenantScopedAtomicBatchProvider<TCommand>

function hasTenantScopedAtomicBatchContract(
  provider: PersistenceProvider
): boolean {
  return (
    typeof (provider as Partial<TenantScopedAtomicBatchProvider>)
      .executeAtomicBatch === "function" &&
    typeof (provider as Partial<TenantScopedAtomicBatchProvider>).tenantId ===
      "string" &&
    typeof (provider as Partial<TenantScopedAtomicBatchProvider>).commandEncoder
      ?.encode === "function"
  )
}

export function supportsAtomicBatch(
  provider: PersistenceProvider
): provider is AtomicBatchCapableProvider {
  return (
    provider.capabilities.atomicBatch === true &&
    (provider.capabilities.atomicBatchScope === undefined ||
    provider.capabilities.atomicBatchScope === "unscoped"
      ? typeof (provider as Partial<AtomicBatchProvider>).executeAtomicBatch ===
        "function"
      : provider.capabilities.atomicBatchScope === "tenant-scoped" &&
        hasTenantScopedAtomicBatchContract(provider))
  )
}

export function supportsTenantScopedAtomicBatch(
  provider: PersistenceProvider
): provider is TenantScopedAtomicBatchProvider {
  return (
    provider.capabilities.atomicBatch === true &&
    provider.capabilities.atomicBatchScope === "tenant-scoped" &&
    hasTenantScopedAtomicBatchContract(provider)
  )
}

/**
 * Batch 1 version discipline helper.
 * Ensures every write to a versioned entity supplies an expectedVersion so
 * concurrent policy-relevant writers cannot slip a stale authorization decision
 * past the mutation. The check is exposed for adapter reuse; repositories call
 * it at the start of each mutating method.
 *
 * All versioned writes require an expected version.
 */
export function assertVersionedWriteHasExpectedVersion(
  entity: EntityDescriptor<unknown>,
  options?: UpdateWhereOptions | DeleteOptions
): void {
  if (!entity.versionField) return
  const oc = options?.optimisticConcurrency
  if (!oc || oc.expectedVersion === undefined || oc.expectedVersion === null) {
    throw new ConfigurationError(
      `Versioned entity "${entity.name}" requires optimisticConcurrency.expectedVersion`
    )
  }
  const v = oc.expectedVersion
  if (
    v === undefined ||
    v === null ||
    (typeof v !== "string" && typeof v !== "number")
  ) {
    throw new ConfigurationError(
      `Versioned entity "${entity.name}" requires optimisticConcurrency.expectedVersion to be a string or number`
    )
  }
  if (typeof v === "string" && v.trim() === "") {
    throw new ConfigurationError(
      `Versioned entity "${entity.name}" requires a non-empty expectedVersion`
    )
  }
  if (typeof v === "number" && (!Number.isSafeInteger(v) || v < 0)) {
    throw new ConfigurationError(
      `Versioned entity "${entity.name}" requires expectedVersion to be a non-negative safe integer`
    )
  }
}
