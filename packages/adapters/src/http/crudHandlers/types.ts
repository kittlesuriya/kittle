import { z } from "zod"
import type {
  AuditSink,
  CacheAdapter,
  OutboxSink,
  PersistenceProvider,
  RuntimeCapabilities,
  ValidationSchema,
} from "kittle-core/ports"
import type {
  CapabilityCheckConfig,
  CrudLifecycle,
  TenantScopingChoice,
} from "kittle-core/entity"
import type { EntityDescriptor } from "kittle-core/ports"
import type { FrameworkAdapterDeps, FrameworkSession } from "../../server"
import type {
  CrudScopeConfig,
  ScopedFrameworkValidatedContext,
} from "../createFrameworkWriteHandler"
import type { FilterFieldMeta } from "kittle-core/domain"

export type SelectableRow = Record<string, unknown>
export type AuditObject = Record<string, unknown>

export type CreateOperationInput<TCreateBody> = {
  body: TCreateBody
  originalBody: TCreateBody
  id: string
}
export type UpdateOperationInput<TRow, TUpdateBody> = {
  id: string
  patch: TUpdateBody
  originalPatch: TUpdateBody
  existing: TRow
  expectedVersion?: number
}
export type DeleteOperationInput<TRow> = {
  id: string
  existing: TRow
  expectedVersion?: number
}
export type MutationOutsideReadScope = {
  success: true
  reason: "CREATED_OUTSIDE_READ_SCOPE" | "UPDATED_OUTSIDE_READ_SCOPE"
}
export type MutationResult<TRow> = { record: TRow } | MutationOutsideReadScope

export type RateLimitConfigs = {
  list?: import("kittle-core/entity").EntityRateLimitSetting
  detail?: import("kittle-core/entity").EntityRateLimitSetting
  create?: import("kittle-core/entity").EntityRateLimitSetting
  update?: import("kittle-core/entity").EntityRateLimitSetting
  delete?: import("kittle-core/entity").EntityRateLimitSetting
}
export type ValidationSchemas = {
  idParams?: ValidationSchema
  createBody?: ValidationSchema
  updateBody?: ValidationSchema
  listQuery?: ValidationSchema
}
export interface AuditConfig {
  resource: string
  enabled?: boolean
  emitOn?: ("create" | "update" | "delete")[]
  includeValues?: boolean
  readAudit?: boolean
  fieldClassification?: import("kittle-core/ports").AuditFieldClassifications
  required?: boolean
  auditGuarantee?: "atomic" | "durable" | "best-effort"
  requiredStateSemantics?: "committed-state"
}
export type ListDefaults = { sortColumn?: string; sortDesc?: boolean }
export type OptimisticConcurrencyConfig<TRow extends SelectableRow> = {
  versionField?: keyof TRow & string
}
export interface CrudRoutesConfig {
  list: boolean
  detail: boolean
  create: boolean
  update: boolean
  delete: boolean
}

export type EntityQueryLimitsWithBytes =
  import("kittle-core/entity").EntityQueryLimits & {
    maxFilterJsonBytes?: number
    maxSortJsonBytes?: number
    maxFilterValueBytes?: number
  }

export interface CrudOptions<
  TRow extends SelectableRow,
  TCreateBody = TRow,
  TUpdateBody = Partial<TRow>,
  TListRow extends SelectableRow = TRow,
  TDetailRow extends SelectableRow = TRow,
> {
  adapterDeps: FrameworkAdapterDeps
  scope: CrudScopeConfig
  moduleKey: string
  entity: EntityDescriptor<TRow>
  tenantScoping?: TenantScopingChoice
  policy: CapabilityCheckConfig
  cache: { enabled?: boolean; tag: string; keyPrefix: string }
  getCacheAdapter: () => Promise<CacheAdapter>
  getRateLimitStore?: () => Promise<import("kittle-core/ports").RateLimitStore>
  createPersistence: (session: FrameworkSession) => PersistenceProvider
  auditSinkFactory?: (
    session: FrameworkSession,
    persistence?: PersistenceProvider
  ) => AuditSink
  outboxSinkFactory?: (
    session: FrameworkSession,
    persistence?: PersistenceProvider
  ) => OutboxSink
  runtimeCapabilities: RuntimeCapabilities
  validation?: ValidationSchemas
  rateLimit?: RateLimitConfigs
  crud?: CrudLifecycle<TRow, TCreateBody, TUpdateBody, TListRow, TDetailRow>
  crudHooks?: import("kittle-core/entity").EntityCrudHooksConfig
  routes?: Partial<CrudRoutesConfig>
  audit?: AuditConfig
  searchableColumns?: string[]
  queryLimits?: EntityQueryLimitsWithBytes
  searchStrategy?: import("kittle-core/entity").EntitySearchStrategy
  filterableColumns?: string[]
  sortableColumns?: string[]
  filterFieldMeta?: Record<string, FilterFieldMeta>
  listDefaults?: ListDefaults
  optimisticConcurrency?: OptimisticConcurrencyConfig<TRow>
}

export const defaultListQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  pageSize: z.coerce.number().min(1).max(100).optional(),
  sorting: z
    .string()
    .max(64 * 1024)
    .optional(),
  filters: z
    .string()
    .max(64 * 1024)
    .optional(),
})
export const defaultIdParams = z.object({ id: z.string().uuid() }).strict()
export type ReadQuery = {
  page: number
  pageSize: number
  sorting?: string
  filters?: string
}

export type CrudShared<
  TRow extends SelectableRow,
  TCreateBody,
  TUpdateBody,
  TListRow extends SelectableRow,
  TDetailRow extends SelectableRow,
> = {
  options: CrudOptions<TRow, TCreateBody, TUpdateBody, TListRow, TDetailRow>
  entity: EntityDescriptor<TRow>
  deps: FrameworkAdapterDeps
  idParamsSchema: ValidationSchema
  capabilityMode: { enabled: boolean; key: string | undefined }
  writeCapabilityConfig: CapabilityCheckConfig
  routes: CrudRoutesConfig
  writeRuntimeCapabilities: RuntimeCapabilities
  invalidateTags?: (
    validated: ScopedFrameworkValidatedContext,
    session: FrameworkSession
  ) => string[] | Promise<string[]>
  buildReadTags: (session: FrameworkSession) => string[]
  resolveDefaultSort: () => import("kittle-core/ports").SortSpec[] | undefined
  enforceReadRateLimit: (
    route: "list" | "detail",
    config: import("kittle-core/entity").EntityRateLimitSetting | undefined,
    request: Request,
    session: FrameworkSession
  ) => Promise<void>
  enforceReadAccess: (
    request: Request,
    session: FrameworkSession
  ) => Promise<import("../../server").AbacBundle | undefined>
  buildReadScope: (bundle: import("../../server").AbacBundle | undefined) => {
    filter: import("kittle-core/domain").PredicateNode | undefined
    cacheScopeKey?: string
  }
  resolveReadScopeForSession: (session: FrameworkSession) => Promise<{
    filter: import("kittle-core/domain").PredicateNode | undefined
    cacheScopeKey?: string
  }>
}
