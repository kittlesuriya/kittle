import type {
  AuditFieldClassifications,
  EntityDescriptor,
  ReadOnlyPersistenceProvider,
  RateLimitConfig,
  RateLimitPolicy,
  ValidationSchema,
} from "../ports"
import type { CapabilityCheckConfig } from "./capabilityCheck"
import { resolveCapabilityKey } from "./capabilityCheck"
import type { TenantScopingChoice } from "./tenantScoping"
import type { FilterFieldMeta } from "../domain"
import type { OperationContext, PostCommitOperationContext } from "../operation"
import { validateEntity } from "./validateEntity"
import { ConfigurationError } from "../domain"
import { cloneAndFreezeDefinition } from "../utils"

export type CrudRouteKey = "list" | "detail" | "create" | "update" | "delete"

export interface EntityValidationSchemas<
  TIdParams = unknown,
  TCreateBody = unknown,
  TUpdateBody = unknown,
  TListQuery = unknown,
> {
  idParams?: ValidationSchema<TIdParams>
  createBody?: ValidationSchema<TCreateBody>
  updateBody?: ValidationSchema<TUpdateBody>
  listQuery?: ValidationSchema<TListQuery>
}

export interface EntityAuditConfig {
  resource: string
  enabled: boolean
  emitOn: Array<"create" | "update" | "delete">
  includeValues: boolean
  readAudit: boolean
  fieldClassification?: AuditFieldClassifications
}
export interface EntityQueryLimits {
  maxSearchBytes?: number
  maxSearchableColumns?: number
  maxOffset?: number
  maxCount?: number
}
export interface EntitySearchStrategy {
  kind: "contains" | "prefix" | "fullText"
  indexName?: string
}

export interface EntityCacheConfig {
  enabled: boolean
  tag: string
  keyPrefix: string
}

export type EntityRateLimitSetting = RateLimitConfig &
  RateLimitPolicy & { consistency: NonNullable<RateLimitPolicy["consistency"]> }
export type EntityRateLimitConfig = Partial<
  Record<CrudRouteKey, EntityRateLimitSetting>
>

export interface EntityRouteConfig {
  list: boolean
  detail: boolean
  create: boolean
  update: boolean
  delete: boolean
}

/**
 * Optimistic concurrency is MANDATORY for any entity that enables `update` or
 * `delete` routes. Mutating routes run read-then-write authorization; without
 * a concrete numeric `versionField` the authorization snapshot is exposed to
 * TOCTOU. `validateEntity` rejects update/delete routes that declare neither
 * `entity.versionField` nor `optimisticConcurrency.versionField`.
 */

export interface CrudListResult<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number
  page: number
  pageSize: number
}

export interface ListQueryInput {
  page: number
  pageSize: number
  sorting?: string
  filters?: string
}

/** Context shared by mutation lifecycle hooks. Persistence is tenant-scoped; writability depends on hook configuration. */
export interface CrudMutationHookContext {
  tenantId: string
  persistence: ReadOnlyPersistenceProvider
  requestId: string
  correlationId: string
  operation?: Omit<OperationContext, "persistence"> & {
    persistence: ReadOnlyPersistenceProvider
  }
}

/** Context shared by read lifecycle hooks. Read hooks do not receive persistence. */
export interface CrudReadHookContext {
  tenantId: string
  requestId: string
  correlationId: string
  /** Operation services remain available, but generic persistence is not. */
  operation?: Omit<OperationContext, "persistence" | "withPersistence">
}

export interface CrudPostCommitHookContext {
  tenantId: string
  requestId: string
  correlationId: string
}

/**
 * Lifecycle hook ordering / idempotency contract (P1-14 clean split):
 *
 * - `beforeCommitTransform`: runs inside the mutation transaction
 *   before commit. It may transform the input/patch deterministically and must
 *   be idempotent under retries. Receives read-only persistence; it MUST NOT
 *   perform arbitrary writes — that would bypass ABAC/OCC/tenant scoping.
 *
 * - `afterCommitRepresentation`: runs after the durable commit
 *   (or inside the read transaction for list/detail) and is representation-
 *   only. It MUST NOT mutate durable state and must be idempotent — the
 *   persisted row is already authoritative. `afterCommitRepresentation` hooks run
 *   before the read-projection/ABAC re-application in list/detail and against a
 *   read-only persistence view in mutations.
 *
 * - `afterCommit`: post-commit side-effect hook (outbox, notifications).
 *   Not a representation transform — must not mutate the returned row.
 *
 * `validateEntity` enforces this contract: it rejects unknown hook names
 * and ensures hooks are functions. `crudHooks`
 * is intentionally empty — `writableMutationHooks` was removed in P1-06.
 */
export interface CrudLifecycle<
  TRow = Record<string, unknown>,
  TCreateBody = TRow,
  TUpdateBody = Partial<TRow>,
  TListRow = TRow,
  TDetailRow = TRow,
> {
  list?: {
    beforeCommitTransform?(args: {
      query: ListQueryInput
      context: CrudReadHookContext
    }): Promise<void | { query?: ListQueryInput }>
    afterCommitRepresentation?(args: {
      result: CrudListResult<TListRow>
      context: CrudReadHookContext
    }): Promise<CrudListResult<TListRow>>
  }
  detail?: {
    beforeCommitTransform?(args: {
      id: string
      context: CrudReadHookContext
    }): Promise<void>
    afterCommitRepresentation?(args: {
      row: TRow
      context: CrudReadHookContext
    }): Promise<TDetailRow>
  }
  create?: {
    beforeCommitTransform?(args: {
      input: TCreateBody
      context: CrudMutationHookContext
    }): Promise<TCreateBody | void>
    afterCommitRepresentation?(args: {
      input: TCreateBody
      originalInput?: TCreateBody
      result: TRow
      context: CrudMutationHookContext
    }): Promise<TRow | void>
    afterCommit?(args: {
      input: TCreateBody
      result: TRow
      operation: PostCommitOperationContext
      context: CrudPostCommitHookContext
    }): Promise<void>
  }
  update?: {
    beforeCommitTransform?(args: {
      existing: TRow
      patch: TUpdateBody
      context: CrudMutationHookContext
    }): Promise<TUpdateBody | void>
    afterCommitRepresentation?(args: {
      existing: TRow
      patch: TUpdateBody
      originalPatch?: TUpdateBody
      result: TRow
      context: CrudMutationHookContext
    }): Promise<TRow | void>
    afterCommit?(args: {
      existing: TRow
      patch: TUpdateBody
      result: TRow
      operation: PostCommitOperationContext
      context: CrudPostCommitHookContext
    }): Promise<void>
  }
  delete?: {
    beforeCommitTransform?(args: {
      existing: TRow
      context: CrudMutationHookContext
    }): Promise<void>
    afterCommitRepresentation?(args: {
      existing: TRow
      context: CrudMutationHookContext
    }): Promise<void>
    afterCommit?(args: {
      existing: TRow
      operation: PostCommitOperationContext
      context: CrudPostCommitHookContext
    }): Promise<void>
  }
}

export interface EntityListDefaults {
  sortColumn?: string
  sortDesc?: boolean
}

export interface EntityOptimisticConcurrencyConfig<TRow> {
  versionField?: keyof TRow & string
}

/**
 * Mutation lifecycle hook configuration. Mutation hooks are always read-only;
 * arbitrary repository writes from a hook bypass the entity/action's ABAC
 * and OCC contract. Hooks that need to persist data should use scoped
 * repository access or explicit write targets instead.
 *
 * @security Hooks receive a read-only `PersistenceProvider`. This ensures
 * that mutation lifecycle hooks cannot bypass ABAC, OCC, or tenant scoping
 * through arbitrary repository writes.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EntityCrudHooksConfig {
  // Intentionally empty: the previous `writableMutationHooks` escape hatch
  // was removed (P1-06) because it granted unrestricted persistence access,
  // bypassing entity-specific ABAC/OCC and tenant scoping. Hooks are always
  // read-only. Future hook configuration (e.g., scoped write targets) can
  // be added here when available.
}

export interface EntityDefinitionInput<
  TRow,
  TCreateBody = TRow,
  TUpdateBody = Partial<TRow>,
  TListRow = TRow,
  TDetailRow = TRow,
  TIdParams = unknown,
  TListQuery = unknown,
> {
  moduleKey: string
  entity: EntityDescriptor<TRow>
  tenantScoping: TenantScopingChoice
  policy: CapabilityCheckConfig
  validation?: EntityValidationSchemas<
    TIdParams,
    TCreateBody,
    TUpdateBody,
    TListQuery
  >
  audit?: Partial<EntityAuditConfig>
  cache?: Partial<EntityCacheConfig>
  rateLimit?: EntityRateLimitConfig
  crud?: CrudLifecycle<TRow, TCreateBody, TUpdateBody, TListRow, TDetailRow>
  routes?: Partial<EntityRouteConfig>
  searchableColumns?: string[]
  queryLimits?: EntityQueryLimits
  searchStrategy?: EntitySearchStrategy
  filterableColumns?: string[]
  sortableColumns?: string[]
  filterFieldMeta?: Record<string, FilterFieldMeta>
  listDefaults?: EntityListDefaults
  /**
   * Optimistic concurrency. Required when `update` or `delete` routes are
   * enabled (see {@link EntityRouteConfig}); the effective concurrency field
   * must be a declared numeric field.
   */
  optimisticConcurrency?: EntityOptimisticConcurrencyConfig<TRow>
  crudHooks?: EntityCrudHooksConfig
}

export interface EntityDefinition<
  TRow,
  TCreateBody = TRow,
  TUpdateBody = Partial<TRow>,
  TListRow = TRow,
  TDetailRow = TRow,
  TIdParams = unknown,
  TListQuery = unknown,
> {
  moduleKey: string
  entity: EntityDescriptor<TRow>
  tenantScoping: TenantScopingChoice
  policy: CapabilityCheckConfig
  validation: EntityValidationSchemas<
    TIdParams,
    TCreateBody,
    TUpdateBody,
    TListQuery
  >
  audit: EntityAuditConfig
  cache: EntityCacheConfig
  rateLimit: EntityRateLimitConfig
  crud: CrudLifecycle<TRow, TCreateBody, TUpdateBody, TListRow, TDetailRow>
  routes: EntityRouteConfig
  searchableColumns: string[]
  queryLimits?: EntityQueryLimits
  searchStrategy?: EntitySearchStrategy
  filterableColumns: string[]
  sortableColumns: string[]
  filterFieldMeta?: Record<string, FilterFieldMeta>
  listDefaults?: EntityListDefaults
  optimisticConcurrency?: EntityOptimisticConcurrencyConfig<TRow>
  crudHooks?: EntityCrudHooksConfig
}

/** Runtime marker preventing CRUD construction from accepting an unvalidated object. */
export const ENTITY_DEFINITION_BRAND: unique symbol = Symbol(
  "core.entityDefinition"
)
export type BrandedEntityDefinition<
  TRow,
  TCreateBody = TRow,
  TUpdateBody = Partial<TRow>,
  TListRow = TRow,
  TDetailRow = TRow,
  TIdParams = unknown,
  TListQuery = unknown,
> = EntityDefinition<
  TRow,
  TCreateBody,
  TUpdateBody,
  TListRow,
  TDetailRow,
  TIdParams,
  TListQuery
> & {
  readonly [ENTITY_DEFINITION_BRAND]: true
}

const DEFAULT_AUDIT_EMIT_ON: Array<"create" | "update" | "delete"> = [
  "create",
  "update",
  "delete",
]

function normalizeRoutes(
  routes?: Partial<EntityRouteConfig>
): EntityRouteConfig {
  return {
    list: routes?.list !== false,
    detail: routes?.detail !== false,
    create: routes?.create !== false,
    update: routes?.update !== false,
    delete: routes?.delete !== false,
  }
}

/**
 * Canonicalizes a capability policy at definition time. `resolveCapabilityKey`
 * rejects configs that claim both branches (unsound runtime casts), so the
 * stored policy (and therefore the derived capability mode used by the CRUD
 * handlers) is always exactly one of `{ customCapabilityKey }` or
 * `{ skipCapabilityCheck: true }`.
 */
function normalizeCapabilityPolicy(
  config: CapabilityCheckConfig
): CapabilityCheckConfig {
  const resolved = resolveCapabilityKey(config)
  return resolved.enabled
    ? { customCapabilityKey: resolved.key! }
    : { skipCapabilityCheck: true }
}

export function defineEntity<
  TRow,
  TCreateBody = TRow,
  TUpdateBody = Partial<TRow>,
  TListRow = TRow,
  TDetailRow = TRow,
  TIdParams = unknown,
  TListQuery = unknown,
>(
  input: EntityDefinitionInput<
    TRow,
    TCreateBody,
    TUpdateBody,
    TListRow,
    TDetailRow,
    TIdParams,
    TListQuery
  >
): BrandedEntityDefinition<
  TRow,
  TCreateBody,
  TUpdateBody,
  TListRow,
  TDetailRow,
  TIdParams,
  TListQuery
> {
  const routes = normalizeRoutes(input.routes)
  const concurrencyVersionField = input.optimisticConcurrency?.versionField
  if (
    input.entity.versionField !== undefined &&
    concurrencyVersionField !== undefined &&
    input.entity.versionField !== concurrencyVersionField
  ) {
    throw new ConfigurationError(
      `Entity "${input.entity.name}" has conflicting concurrency version fields.`
    )
  }
  const versionField = input.entity.versionField ?? concurrencyVersionField
  const normalizedEntity: EntityDescriptor<TRow> = {
    ...input.entity,
    ...(input.entity.primaryKey !== undefined ||
    Object.prototype.hasOwnProperty.call(input.entity.fields, "id")
      ? { primaryKey: input.entity.primaryKey ?? ("id" as keyof TRow & string) }
      : {}),
    ...(versionField !== undefined ? { versionField } : {}),
    fields: cloneAndFreezeDefinition(input.entity.fields),
    ...(input.entity.immutableFields !== undefined
      ? { immutableFields: [...input.entity.immutableFields] }
      : {}),
  }
  const normalized: EntityDefinition<
    TRow,
    TCreateBody,
    TUpdateBody,
    TListRow,
    TDetailRow,
    TIdParams,
    TListQuery
  > = {
    moduleKey: input.moduleKey,
    entity: normalizedEntity,
    tenantScoping: cloneAndFreezeDefinition(input.tenantScoping),
    policy: cloneAndFreezeDefinition(normalizeCapabilityPolicy(input.policy)),
    validation: cloneAndFreezeDefinition(input.validation ?? {}),
    audit: {
      resource: input.audit?.resource ?? input.entity.name,
      enabled: input.audit?.enabled ?? false,
      emitOn: input.audit?.emitOn
        ? [...input.audit.emitOn]
        : [...DEFAULT_AUDIT_EMIT_ON],
      includeValues: input.audit?.includeValues ?? true,
      readAudit: input.audit?.readAudit ?? false,
      ...(input.audit?.fieldClassification
        ? { fieldClassification: { ...input.audit.fieldClassification } }
        : {}),
    },
    cache: {
      enabled: input.cache?.enabled ?? false,
      tag: input.cache?.tag ?? input.entity.name,
      keyPrefix: input.cache?.keyPrefix ?? input.entity.name,
    },
    rateLimit: input.rateLimit ? cloneAndFreezeDefinition(input.rateLimit) : {},
    crud: cloneAndFreezeDefinition(input.crud ?? {}),
    routes,
    searchableColumns: input.searchableColumns
      ? [...input.searchableColumns]
      : [],
    ...(input.queryLimits !== undefined
      ? { queryLimits: { ...input.queryLimits } }
      : {}),
    ...(input.searchStrategy !== undefined
      ? { searchStrategy: { ...input.searchStrategy } }
      : {}),
    filterableColumns: input.filterableColumns
      ? [...input.filterableColumns]
      : [],
    sortableColumns: input.sortableColumns ? [...input.sortableColumns] : [],
    ...(input.filterFieldMeta !== undefined
      ? { filterFieldMeta: cloneAndFreezeDefinition(input.filterFieldMeta) }
      : {}),
    ...(input.listDefaults !== undefined
      ? { listDefaults: cloneAndFreezeDefinition(input.listDefaults) }
      : {}),
    ...(input.optimisticConcurrency !== undefined
      ? {
          optimisticConcurrency: cloneAndFreezeDefinition(
            input.optimisticConcurrency
          ),
        }
      : {}),
    ...(input.crudHooks !== undefined
      ? { crudHooks: cloneAndFreezeDefinition(input.crudHooks) }
      : {}),
  }

  validateEntity(normalized, routes)
  Object.defineProperty(normalized, ENTITY_DEFINITION_BRAND, {
    value: true,
    enumerable: false,
  })
  return cloneAndFreezeDefinition(normalized) as BrandedEntityDefinition<
    TRow,
    TCreateBody,
    TUpdateBody,
    TListRow,
    TDetailRow,
    TIdParams,
    TListQuery
  >
}
