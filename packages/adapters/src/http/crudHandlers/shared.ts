import {
  enforceRateLimit,
  type RateLimitConfig,
  type RateLimitPolicy,
  type RateLimitStore,
} from "core/ports"
import type { EntityRateLimitSetting } from "core/entity"
import {
  CapabilityError,
  ConfigurationError,
  assertVerifiedAbacBundle,
  createAbacAuthorizer,
  ForbiddenError,
  Predicate,
  projectResponseRecord,
  resolveFieldReadOverrides,
  type PredicateNode,
} from "core/domain"
import {
  createReadOnlyPersistenceProvider,
  createTenantScopedPersistenceProvider,
  type PersistenceProvider,
} from "core/ports"
import { CacheBackedRateLimitStore } from "../../cache"
import type {
  CrudMutationHookContext,
  CrudPostCommitHookContext,
  CrudReadHookContext,
} from "core/entity"
import type {
  PostCommitOperationContext,
  OperationContext,
} from "core/operation"
import type { FrameworkSession } from "../../server"
import type {
  CrudShared,
  AuditObject,
  CrudOptions,
  MutationResult,
  SelectableRow,
} from "./types"

export function getRequestIp(
  request: Request,
  resolveClientIp?: import("../requestBody").TrustedClientIpResolver,
  resolveHttpMetadata?: import("../../server/frameworkAdapterDeps").FrameworkAdapterDeps["resolveHttpMetadata"]
): string {
  return (
    resolveClientIp?.(request, resolveHttpMetadata?.(request))?.trim() ||
    "unknown"
  )
}

/**
 * Derives the cache partition for a read so that post-projection responses are
 * only shared within one security context. The partition is bound to the
 * verified ABAC security digest so two bundles with the same cacheScopeKey but
 * different authorization state can never share cached rows.
 */
export function deriveSecurityCachePartition(args: {
  bundle?: import("../../server").AbacBundle | undefined
  session: FrameworkSession
  cacheScopeKey?: string | undefined
  hasRepresentationHook: boolean
  deps: CrudOptions<SelectableRow>["adapterDeps"]
  scope: CrudOptions<SelectableRow>["scope"]["scope"]
}): { canCache: boolean; partition: string } {
  // Representation hook output is request-dependent. Until a reviewed
  // variance contract exists, never share a representation-hook execution.
  if (args.hasRepresentationHook) {
    return { canCache: false, partition: "" }
  }
  if (args.session.actor === null) {
    return { canCache: true, partition: `public:${args.scope}` }
  }
  if (canUseOwnerBypass(args.deps, args.scope, args.session)) {
    return { canCache: true, partition: `bypass:${args.session.actor.id}` }
  }
  const digest = args.bundle?.securityDigest
  if (!digest || digest.trim().length === 0) {
    return { canCache: false, partition: "" }
  }
  const scopeKey = args.cacheScopeKey
  const hasScopeKey = Boolean(scopeKey && scopeKey.trim().length > 0)
  return {
    canCache: hasScopeKey,
    partition: `abac:${digest}:${hasScopeKey ? scopeKey : "default"}`,
  }
}

export function canUseOwnerBypass(
  deps: CrudOptions<SelectableRow>["adapterDeps"],
  scope: CrudOptions<SelectableRow>["scope"]["scope"],
  session: FrameworkSession
): boolean {
  // Bypass requires an explicit bypassAuthority grant on the actor, is never
  // inherited by an impersonated session, and must also pass the host's
  // explicit owner-bypass decision. It is never implied from actor shape.
  return (
    session.actor?.bypassAuthority === true &&
    !session.actor.impersonatedById &&
    deps.isOwnerBypass({ scope, session })
  )
}

export function auditEmit<
  TRow extends SelectableRow,
  A,
  B,
  L extends SelectableRow,
  D extends SelectableRow,
>(
  options: CrudOptions<TRow, A, B, L, D>,
  action: "create" | "update" | "delete"
): boolean {
  if (options.audit?.enabled === false) return false
  return options.audit?.emitOn ? options.audit.emitOn.includes(action) : true
}
export function buildStructuralScope<TRow extends SelectableRow>(
  entity: CrudOptions<TRow>["entity"],
  session: FrameworkSession,
  tenantScoping: CrudOptions<TRow>["tenantScoping"]
): PredicateNode | undefined {
  let scope: PredicateNode | undefined =
    session.scope === "tenant" && entity.tenantField
      ? Predicate.eq(entity.tenantField, session.actor.tenantId)
      : undefined
  if (tenantScoping?.mode === "none" && tenantScoping.scopeFilter)
    scope = scope
      ? Predicate.and(scope, tenantScoping.scopeFilter)
      : tenantScoping.scopeFilter
  return scope
}

export function getProtectedMutationFields<TRow extends SelectableRow>(
  entity: CrudOptions<TRow>["entity"]
): string[] {
  return [
    ...new Set(
      [
        entity.primaryKey,
        entity.tenantField,
        entity.versionField,
        ...(entity.immutableFields ?? []),
      ].filter((field): field is string => Boolean(field))
    ),
  ]
}

export function assertProtectedUpdateFields<TRow extends SelectableRow>(
  entity: CrudOptions<TRow>["entity"],
  patch: object
): void {
  const protectedFields = getProtectedMutationFields(entity)
  const provided = protectedFields.filter((field) =>
    Object.hasOwn(patch, field)
  )
  if (provided.length > 0)
    throw new ForbiddenError(
      `Cannot modify protected fields on ${entity.name}: ${provided.join(", ")}`,
      { fields: provided }
    )
}

export function assertProtectedCreateFields<TRow extends SelectableRow>(
  entity: CrudOptions<TRow>["entity"],
  body: object
): void {
  const protectedFields = getProtectedMutationFields(entity)
  const provided = protectedFields.filter((field) => Object.hasOwn(body, field))
  if (provided.length > 0)
    throw new ForbiddenError(
      `Cannot provide protected fields on ${entity.name}: ${provided.join(", ")}`,
      { fields: provided }
    )
}

export async function resolveActionScopeForSession<
  TRow extends SelectableRow,
  A = TRow,
  B = Partial<TRow>,
  L extends SelectableRow = TRow,
  D extends SelectableRow = TRow,
>(
  options: CrudOptions<TRow, A, B, L, D>,
  session: FrameworkSession,
  action: string
): Promise<PredicateNode | undefined> {
  if (
    !session.actor ||
    canUseOwnerBypass(options.adapterDeps, options.scope.scope, session)
  )
    return undefined
  const bundle = await options.adapterDeps.resolveAbacBundle({
    scope: options.scope.scope,
    moduleKey: options.moduleKey,
    session,
  })
  if (!bundle) throw new ForbiddenError("ABAC authorization bundle unavailable")
  assertVerifiedAbacBundle(bundle)
  return bundle
    ? createAbacAuthorizer(bundle).assertCollectionAction(action).scope
    : undefined
}

export async function readMutationResult<
  TRow extends SelectableRow,
  A = TRow,
  B = Partial<TRow>,
  L extends SelectableRow = TRow,
  D extends SelectableRow = TRow,
>(
  options: CrudOptions<TRow, A, B, L, D>,
  entity: CrudOptions<TRow>["entity"],
  session: FrameworkSession,
  id: string,
  persistence?: PersistenceProvider
): Promise<TRow | null> {
  const result = await loadReadableMutationRecord(
    options,
    entity,
    session,
    id,
    persistence
  )
  if (!result) return null
  const requiresAbac =
    session.actor &&
    !canUseOwnerBypass(options.adapterDeps, options.scope.scope, session)
  const bundle = requiresAbac
    ? await options.adapterDeps.resolveAbacBundle({
        scope: options.scope.scope,
        moduleKey: options.moduleKey,
        session,
      })
    : undefined
  if (requiresAbac && !bundle)
    throw new ForbiddenError("ABAC authorization bundle unavailable")
  if (bundle) assertVerifiedAbacBundle(bundle)
  return projectResponseRecord({
    entity,
    record: result,
    ...(bundle
      ? {
          overrides: resolveFieldReadOverrides({
            policies: bundle.policies,
            moduleKey: options.moduleKey,
            record: result,
          }),
        }
      : {}),
  })
}

/**
 * Compares two committed resource versions, accepting loose numeric equivalence
 * when both sides are numeric (numbers or canonical integer strings) so a
 * string-persisted version and a numeric version still match.
 */
function sameVersion(a: unknown, b: unknown): boolean {
  const aNumeric =
    typeof a === "number" || (typeof a === "string" && /^-?\d+$/.test(a))
  const bNumeric =
    typeof b === "number" || (typeof b === "string" && /^-?\d+$/.test(b))
  if (aNumeric && bNumeric) return Number(a) === Number(b)
  return a === b
}

/**
 * Rebuilds a safe committed mutation response by rereading the resource under
 * the current verified security context. Used to recover an idempotent request
 * whose committed response was never finalized (crash between commit and
 * complete). Returns null when the row is not readable, in which case the
 * caller must not invent a response.
 */
export async function buildCommittedReadResponse<
  TRow extends SelectableRow,
  A,
  B,
  L extends SelectableRow,
  D extends SelectableRow,
>(args: {
  options: CrudOptions<TRow, A, B, L, D>
  entity: CrudOptions<TRow>["entity"]
  session: FrameworkSession
  id: string
  resourceVersion?: string | number
}): Promise<MutationResult<TRow> | null> {
  const readable = await loadReadableMutationRecord(
    args.options,
    args.entity,
    args.session,
    args.id
  )
  if (!readable) return null
  if (args.resourceVersion !== undefined) {
    const versionField = args.entity.versionField
    if (
      !versionField ||
      !sameVersion(readable[versionField], args.resourceVersion)
    )
      return null
  }
  const bundle =
    args.session.actor &&
    !canUseOwnerBypass(
      args.options.adapterDeps,
      args.options.scope.scope,
      args.session
    )
      ? await args.options.adapterDeps.resolveAbacBundle({
          scope: args.options.scope.scope,
          moduleKey: args.options.moduleKey,
          session: args.session,
        })
      : undefined
  if (bundle) assertVerifiedAbacBundle(bundle)
  return {
    record: projectResponseRecord({
      entity: args.entity,
      record: readable,
      ...(bundle
        ? {
            overrides: resolveFieldReadOverrides({
              policies: bundle.policies,
              moduleKey: args.options.moduleKey,
              record: readable,
            }),
          }
        : {}),
    }),
  }
}

export async function loadReadableMutationRecord<
  TRow extends SelectableRow,
  A = TRow,
  B = Partial<TRow>,
  L extends SelectableRow = TRow,
  D extends SelectableRow = TRow,
>(
  options: CrudOptions<TRow, A, B, L, D>,
  entity: CrudOptions<TRow>["entity"],
  session: FrameworkSession,
  id: string,
  persistence?: PersistenceProvider
): Promise<TRow | null> {
  const structural = buildStructuralScope(
    entity,
    session,
    options.tenantScoping
  )
  const readBundle =
    !session.actor ||
    canUseOwnerBypass(options.adapterDeps, options.scope.scope, session)
      ? undefined
      : await options.adapterDeps.resolveAbacBundle({
          scope: options.scope.scope,
          moduleKey: options.moduleKey,
          session,
        })
  if (
    session.actor &&
    !canUseOwnerBypass(options.adapterDeps, options.scope.scope, session) &&
    !readBundle
  )
    throw new ForbiddenError("ABAC authorization bundle unavailable")
  if (readBundle) assertVerifiedAbacBundle(readBundle)
  const resolvedReadScope = readBundle
    ? createAbacAuthorizer(readBundle).authorizeCollection("read").scope
    : undefined
  const scope =
    structural && resolvedReadScope
      ? Predicate.and(structural, resolvedReadScope)
      : (structural ?? resolvedReadScope)
  const filter = scope
    ? Predicate.and(Predicate.eq(entity.primaryKey ?? "id", id), scope)
    : Predicate.eq(entity.primaryKey ?? "id", id)
  const basePersistence = persistence ?? options.createPersistence(session)
  const row = await (
    entity.tenantField
      ? withScopedPersistence(session, basePersistence)
      : basePersistence
  )
    .repository(entity)
    .findMany({
      filter,
      pagination: { page: 1, pageSize: 1 },
    })
  return row.rows[0] ?? null
}
export function withScopedPersistence(
  session: FrameworkSession,
  persistence: PersistenceProvider
): PersistenceProvider {
  return session.scope === "tenant"
    ? createTenantScopedPersistenceProvider(persistence, session.actor.tenantId)
    : persistence
}
export function toCrudContext(
  session: FrameworkSession,
  operation: OperationContext
): CrudMutationHookContext {
  const scopedOperation =
    session.scope === "tenant"
      ? {
          ...operation,
          persistence: withScopedPersistence(session, operation.persistence),
        }
      : operation
  // Mutation hooks are always read-only: arbitrary hook writes bypass the
  // entity/action ABAC and OCC contract (P1-06).
  const hookPersistence = createReadOnlyPersistenceProvider(
    scopedOperation.persistence
  )

  return {
    tenantId: session.scope === "tenant" ? session.actor.tenantId : "",
    persistence: hookPersistence,
    requestId: operation.request?.requestId ?? "",
    correlationId: operation.request?.correlationId ?? "",
    operation: { ...scopedOperation, persistence: hookPersistence },
  }
}
export function toCrudPostCommitContext(
  session: FrameworkSession,
  operation: PostCommitOperationContext
): CrudPostCommitHookContext {
  const requestId =
    typeof operation.metadata?.requestId === "string"
      ? operation.metadata.requestId
      : (operation.correlationId ?? "")
  return {
    tenantId: session.scope === "tenant" ? session.actor.tenantId : "",
    requestId,
    correlationId: operation.correlationId ?? "",
  }
}
export function toCrudReadContext(
  session: FrameworkSession,
  operation: OperationContext
): CrudReadHookContext {
  const metadataRequestId =
    typeof operation?.request?.metadata?.requestId === "string"
      ? operation.request.metadata.requestId
      : undefined
  return {
    tenantId: session.scope === "tenant" ? session.actor.tenantId : "",
    requestId: operation?.request?.requestId ?? metadataRequestId ?? "",
    correlationId:
      operation?.request?.correlationId ?? operation?.correlationId ?? "",
    operation: (() => {
      // The read hook context intentionally omits mutation-only persistence helpers.
      /* eslint-disable @typescript-eslint/unbound-method -- destructured helpers are intentionally dropped, never called */
      const {
        persistence: _persistence,
        withPersistence: _withPersistence,
        ...readOperation
      } = operation
      /* eslint-enable @typescript-eslint/unbound-method */
      return readOperation
    })(),
  }
}
export function resolveOperationFrameworkSession(
  operation: OperationContext | PostCommitOperationContext
): FrameworkSession {
  const metadata =
    "metadata" in operation
      ? operation.metadata
      : "request" in operation
        ? operation.request?.metadata
        : undefined
  const session = metadata?.frameworkSession as FrameworkSession | undefined
  if (!session)
    throw new ConfigurationError(
      "Framework session metadata missing for CRUD hook context"
    )
  return session
}

export function normalizeEntityRateLimitSetting(
  setting: EntityRateLimitSetting
): {
  config: RateLimitConfig
  consistency: NonNullable<EntityRateLimitSetting["consistency"]>
  policy?: Pick<RateLimitPolicy, "failureMode">
} {
  const { max, timeWindow, consistency, failureMode } = setting
  return {
    config: { max, timeWindow },
    consistency,
    ...(failureMode !== undefined ? { policy: { failureMode } } : {}),
  }
}

export async function loadExistingRecord<
  TRow extends SelectableRow,
  A,
  B,
  L extends SelectableRow,
  D extends SelectableRow,
>(
  options: CrudOptions<TRow, A, B, L, D>,
  id: string,
  session: FrameworkSession,
  extraFilter?: PredicateNode
): Promise<TRow | null> {
  const basePersistence = options.createPersistence(session)
  const repo = (
    options.entity.tenantField
      ? withScopedPersistence(session, basePersistence)
      : basePersistence
  ).repository(options.entity)
  const structural = buildStructuralScope(
    options.entity,
    session,
    options.tenantScoping
  )
  const scope = extraFilter
    ? structural
      ? Predicate.and(structural, extraFilter)
      : extraFilter
    : structural
  const filter = scope
    ? Predicate.and(Predicate.eq(options.entity.primaryKey ?? "id", id), scope)
    : Predicate.eq(options.entity.primaryKey ?? "id", id)
  if (scope)
    return repo.findOneWhere
      ? repo.findOneWhere(filter)
      : ((await repo.findMany({ filter })).rows[0] ?? null)
  return repo.findById(id)
}
export function toAuditObject(value: object): AuditObject {
  return value as AuditObject
}
export function buildScopedCreateRecord<TRow extends SelectableRow>(
  entity: CrudOptions<TRow>["entity"],
  input: { id: string },
  body: AuditObject,
  session: FrameworkSession
): Partial<TRow> {
  return {
    ...body,
    id: input.id,
    ...(session.scope === "tenant" && entity.tenantField
      ? { [entity.tenantField]: session.actor.tenantId }
      : {}),
  } as unknown as Partial<TRow>
}
export function createShared<
  TRow extends SelectableRow,
  A,
  B,
  L extends SelectableRow,
  D extends SelectableRow,
>(
  options: CrudOptions<TRow, A, B, L, D>,
  routes: CrudShared<TRow, A, B, L, D>["routes"],
  capabilityMode: CrudShared<TRow, A, B, L, D>["capabilityMode"]
): Pick<
  CrudShared<TRow, A, B, L, D>,
  | "buildReadTags"
  | "enforceReadRateLimit"
  | "enforceReadAccess"
  | "buildReadScope"
  | "resolveReadScopeForSession"
> {
  const deps = options.adapterDeps
  const buildTagScopeKey = (session: FrameworkSession) =>
    session.scope === "tenant" ? session.actor.tenantId : session.scope
  const buildReadTags = (session: FrameworkSession) => {
    // Tenant data is namespaced by tenant so one tenant's write cannot churn
    // every tenant's cache. The bare global module tag is reserved for
    // genuinely global (platform/public) shared data.
    const globalTag = session.scope === "tenant" ? [] : [options.cache.tag]
    return [
      `${options.cache.tag}:${buildTagScopeKey(session)}`,
      `scope:${session.scope}`,
      ...globalTag,
    ]
  }
  const enforceReadRateLimit = async (
    route: "list" | "detail",
    config: import("core/entity").EntityRateLimitSetting | undefined,
    request: Request,
    session: FrameworkSession
  ) => {
    if (!config) return
    const key = session.actor
      ? `${options.scope.scope}:${session.actor.tenantId ?? "platform"}:${session.actor.id}:${options.moduleKey}:${route}:${getRequestIp(request, deps.resolveClientIp, deps.resolveHttpMetadata)}`
      : `public:global:${options.moduleKey}:${route}:${getRequestIp(request, deps.resolveClientIp, deps.resolveHttpMetadata)}`
    const normalized = normalizeEntityRateLimitSetting(config)
    if (normalized.consistency === "atomic" && !options.getRateLimitStore) {
      throw new ConfigurationError(
        "Atomic rate limiting requires an atomic rate-limit store"
      )
    }
    const store: RateLimitStore =
      normalized.consistency === "atomic"
        ? await options.getRateLimitStore!()
        : new CacheBackedRateLimitStore(await options.getCacheAdapter())
    await enforceRateLimit({ store, key, ...normalized })
  }
  const enforceReadAccess = async (
    _request: Request,
    session: FrameworkSession
  ) => {
    let abacBundle
    if (
      session.actor &&
      !canUseOwnerBypass(deps, options.scope.scope, session)
    ) {
      if (
        capabilityMode.enabled &&
        !deps.hasCapability({
          scope: options.scope.scope,
          moduleKey: options.moduleKey,
          capabilityKey: capabilityMode.key!,
          session,
        })
      )
        throw new CapabilityError(`${options.moduleKey}:${capabilityMode.key}`)
      abacBundle =
        (await deps.resolveAbacBundle({
          scope: options.scope.scope,
          moduleKey: options.moduleKey,
          session,
        })) ?? undefined
      if (!abacBundle)
        throw new ForbiddenError("ABAC authorization bundle unavailable")
      assertVerifiedAbacBundle(abacBundle)
      if (capabilityMode.enabled && abacBundle)
        createAbacAuthorizer(abacBundle).assertGlobalCapability(
          capabilityMode.key!
        )
    } else if (!session.actor && capabilityMode.enabled)
      throw new ForbiddenError("This operation is not permitted")
    deps.assertModuleEnabled({
      scope: options.scope.scope,
      moduleKey: options.moduleKey,
      session,
    })
    deps.assertModuleActionEnabled({
      scope: options.scope.scope,
      moduleKey: options.moduleKey,
      action: "read",
      session,
    })
    if (capabilityMode.enabled)
      deps.assertModuleCapabilityEnabled({
        scope: options.scope.scope,
        moduleKey: options.moduleKey,
        capabilityKey: capabilityMode.key!,
        session,
      })
    return abacBundle
  }
  const buildReadScope = (
    bundle: import("../../server").AbacBundle | undefined
  ) => {
    const scope = bundle
      ? createAbacAuthorizer(bundle).buildActionScope("read")
      : { filter: undefined, cacheScopeKey: undefined }
    return {
      filter: scope.filter,
      ...(scope.cacheScopeKey !== undefined
        ? { cacheScopeKey: scope.cacheScopeKey }
        : {}),
    }
  }
  const resolveReadScopeForSession = async (session: FrameworkSession) => {
    if (!session.actor || canUseOwnerBypass(deps, options.scope.scope, session))
      return { filter: undefined }
    const bundle = await deps.resolveAbacBundle({
      scope: options.scope.scope,
      moduleKey: options.moduleKey,
      session,
    })
    if (!bundle)
      throw new ForbiddenError("ABAC authorization bundle unavailable")
    assertVerifiedAbacBundle(bundle)
    return buildReadScope(bundle)
  }
  return {
    buildReadTags,
    enforceReadRateLimit,
    enforceReadAccess,
    buildReadScope,
    resolveReadScopeForSession,
  }
}
