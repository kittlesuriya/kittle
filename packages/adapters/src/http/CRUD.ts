import { ConfigurationError } from "kittle-core/domain"
import {
  ENTITY_DEFINITION_BRAND,
  validateEntity,
  type BrandedEntityDefinition,
} from "kittle-core/entity"
import type { CacheAdapter } from "kittle-core/cache"
import type { RateLimitStore } from "kittle-core/rate-limit"
import type {
  AuditSink,
  OutboxSink,
  PersistenceProvider,
  RuntimeCapabilities,
} from "kittle-core/ports"
import type { FrameworkAdapterDeps, FrameworkSession } from "../server"
import { createCrudHandlersInternal } from "./createCrudHandlers"
import type { CrudScopeConfig } from "./createFrameworkWriteHandler"

type SelectableRow = Record<string, unknown>

export interface CrudRuntime {
  adapterDeps: FrameworkAdapterDeps
  scope: CrudScopeConfig
  createPersistence: (session: FrameworkSession) => PersistenceProvider
  getCacheAdapter: () => Promise<CacheAdapter>
  getRateLimitStore?: () => Promise<import("kittle-core/rate-limit").RateLimitStore>
  auditSinkFactory?: (
    session: FrameworkSession,
    persistence?: PersistenceProvider
  ) => AuditSink
  outboxSinkFactory?: (
    session: FrameworkSession,
    persistence?: PersistenceProvider
  ) => OutboxSink
  runtimeCapabilities?: RuntimeCapabilities
}

export function CRUD<
  TRow extends SelectableRow,
  TCreateBody = TRow,
  TUpdateBody = Partial<TRow>,
  TListRow extends SelectableRow = TRow,
  TDetailRow extends SelectableRow = TRow,
  TIdParams = unknown,
  TListQuery = unknown,
>(
  definition: BrandedEntityDefinition<
    TRow,
    TCreateBody,
    TUpdateBody,
    TListRow,
    TDetailRow,
    TIdParams,
    TListQuery
  >,
  runtime: CrudRuntime
) {
  if (
    (definition as unknown as Record<PropertyKey, unknown>)[
      ENTITY_DEFINITION_BRAND
    ] !== true
  ) {
    throw new ConfigurationError(
      "CRUD() requires an entity definition created by defineEntity()."
    )
  }
  validateEntity(definition, definition.routes)
  if (
    !definition.policy ||
    typeof definition.policy !== "object" ||
    (definition.policy.skipCapabilityCheck !== true &&
      typeof definition.policy.customCapabilityKey !== "string") ||
    (definition.policy.skipCapabilityCheck === true &&
      definition.policy.customCapabilityKey !== undefined)
  ) {
    throw new ConfigurationError(
      `Entity "${definition.entity.name}" has an invalid capability configuration.`
    )
  }
  if (definition.audit.enabled && !runtime.auditSinkFactory) {
    throw new ConfigurationError(
      `Entity "${definition.entity.name}" has audit enabled but no auditSinkFactory was provided to CRUD().`
    )
  }
  if (
    (definition.audit as unknown as { auditGuarantee?: string })
      .auditGuarantee === "durable" &&
    !runtime.outboxSinkFactory
  ) {
    throw new ConfigurationError(
      `Entity "${definition.entity.name}" configures durable audit guarantee without an outboxSinkFactory in CRUD().`
    )
  }

  return createCrudHandlersInternal({
    adapterDeps: runtime.adapterDeps,
    scope: runtime.scope,
    moduleKey: definition.moduleKey,
    entity: definition.entity,
    tenantScoping: definition.tenantScoping,
    policy: definition.policy,
    cache: definition.cache,
    getCacheAdapter: runtime.getCacheAdapter,
    ...((runtime.getRateLimitStore ??
    (
      runtime.adapterDeps as FrameworkAdapterDeps & {
        getRateLimitStore?: () => Promise<RateLimitStore>
      }
    ).getRateLimitStore)
      ? {
          getRateLimitStore:
            runtime.getRateLimitStore ??
            (
              runtime.adapterDeps as FrameworkAdapterDeps & {
                getRateLimitStore?: () => Promise<RateLimitStore>
              }
            ).getRateLimitStore,
        }
      : {}),
    createPersistence: runtime.createPersistence,
    ...(runtime.auditSinkFactory
      ? { auditSinkFactory: runtime.auditSinkFactory }
      : {}),
    ...(runtime.outboxSinkFactory
      ? { outboxSinkFactory: runtime.outboxSinkFactory }
      : {}),
    runtimeCapabilities: runtime.runtimeCapabilities ?? {
      deferredExecution: false,
      objectStorage: false,
      cache: false,
    },
    validation: definition.validation,
    rateLimit: definition.rateLimit,
    crud: definition.crud,
    routes: definition.routes,
    audit: definition.audit,
    searchableColumns: definition.searchableColumns,
    ...(definition.queryLimits ? { queryLimits: definition.queryLimits } : {}),
    ...(definition.searchStrategy
      ? { searchStrategy: definition.searchStrategy }
      : {}),
    filterableColumns: definition.filterableColumns,
    ...(definition.filterFieldMeta
      ? { filterFieldMeta: definition.filterFieldMeta }
      : {}),
    ...(definition.listDefaults
      ? { listDefaults: definition.listDefaults }
      : {}),
    ...(definition.optimisticConcurrency
      ? { optimisticConcurrency: definition.optimisticConcurrency }
      : {}),
    ...(definition.crudHooks ? { crudHooks: definition.crudHooks } : {}),
  })
}
