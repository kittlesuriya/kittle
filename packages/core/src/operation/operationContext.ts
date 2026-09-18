import {
  createReadOnlyPersistenceProvider,
  defaultAuditSanitizer,
  requireCapability,
  normalizeOutboxRecord,
  isTenantScopedPersistenceProvider,
  getTenantScopeId,
  assertPersistenceProviderShape,
  assertRuntimeCapabilities,
  type RuntimeCapabilities,
  type PersistenceProvider,
  type AuditSink,
  type AuditSinkFactory,
  type AbacWriteEnforcer,
  type OutboxSinkFactory,
} from "../ports"
import type { RequestContext } from "../foundation/requestContext"
import { assertRequestContext } from "../foundation/requestContext"
import { ConfigurationError, TenantScopeViolationError } from "../foundation/errors"
import {
  OperationEffectCollector,
  type CommitMarkerEntry,
  type OperationEffectPolicy,
  type OperationEffectState,
  type BestEffortEffectEntry,
  type TransactionalEffectEntry,
} from "./operationEffectCollector"
import {
  createOperationServices,
  assertOperationServices,
  type OperationLogger,
  type OperationServices,
} from "../foundation/operationServices"
import type {
  InternalOperationRunContext,
  OperationEnvironment,
  OperationRunContext,
  SideEffectEntry,
} from "./operationRunContext"

export type {
  OperationLogger,
  OperationServices,
  OperationEnvironment,
  OperationRunContext,
  SideEffectEntry,
}
export {
  OperationEffectCollector,
  createOperationServices,
  type CommitMarkerEntry,
  type OperationEffectPolicy,
  type OperationEffectState,
  type BestEffortEffectEntry,
  type TransactionalEffectEntry,
}

export type OperationContext = OperationRunContext

export interface OperationPersistenceOptions {
  effectPolicy?: OperationEffectPolicy
}

export interface PostCommitOperationContext {
  readonly operationId: string
  readonly correlationId?: string
  readonly services: OperationServices
  readonly metadata?: Record<string, unknown>
  addBestEffortEffect(
    name: string,
    execute: (operation?: PostCommitOperationContext) => Promise<void>
  ): void
}

export interface CreateOperationContextArgs {
  persistence: PersistenceProvider
  runtimeCapabilities: RuntimeCapabilities
  request?: RequestContext
  auditSink?: AuditSink
  auditSanitizer?: (value: unknown) => unknown
  enforceAbac?: AbacWriteEnforcer
  auditSinkFactory?: AuditSinkFactory
  outboxSinkFactory?: OutboxSinkFactory
  commitMarkers?: readonly CommitMarkerEntry[]
  effectFailureReporter?: OperationEnvironment["effectFailureReporter"]
  services?: OperationServices
  clock?: () => Date
  idGenerator?: () => string
  logger?: OperationLogger
}

/** Create reusable services and persistence configuration. Effects are run-scoped only. */
export function createOperationContext(
  args: CreateOperationContextArgs
): OperationEnvironment {
  assertPersistenceProviderShape(args.persistence)
  assertRuntimeCapabilities(args.runtimeCapabilities)
  if (args.request !== undefined) assertRequestContext(args.request)
  if (args.services !== undefined) assertOperationServices(args.services)
  const services =
    args.services ??
    createOperationServices({
      ...(args.clock !== undefined ? { clock: args.clock } : {}),
      ...(args.idGenerator !== undefined
        ? { idGenerator: args.idGenerator }
        : {}),
      ...(args.logger !== undefined ? { logger: args.logger } : {}),
    })
  return {
    persistence: args.persistence,
    runtimeCapabilities: args.runtimeCapabilities,
    ...(args.request !== undefined ? { request: args.request } : {}),
    services,
    ...(args.auditSink !== undefined ? { auditSink: args.auditSink } : {}),
    auditSanitizer: args.auditSanitizer ?? defaultAuditSanitizer,
    ...(args.enforceAbac !== undefined
      ? { enforceAbac: args.enforceAbac }
      : {}),
    ...(args.auditSinkFactory !== undefined
      ? { auditSinkFactory: args.auditSinkFactory }
      : {}),
    ...(args.outboxSinkFactory !== undefined
      ? { outboxSinkFactory: args.outboxSinkFactory }
      : {}),
    ...(args.commitMarkers !== undefined
      ? { commitMarkers: args.commitMarkers }
      : {}),
    ...(args.effectFailureReporter !== undefined
      ? { effectFailureReporter: args.effectFailureReporter }
      : {}),
  }
}

export function createOperationRunContext(
  environment: OperationEnvironment,
  options?: {
    operationId?: string
    correlationId?: string
    effectPolicy?: OperationEffectPolicy
    readOnly?: boolean
  }
): InternalOperationRunContext {
  assertPersistenceScopeMatchesRequest(
    environment.persistence,
    environment.request?.tenantId
  )
  const correlationId =
    options?.correlationId ??
    environment.request?.correlationId ??
    environment.request?.requestId
  const operationId = options?.operationId ?? environment.services.idGenerator()
  const effectPolicy = options?.readOnly
    ? {
        ...options.effectPolicy,
        allowTransactionalEffects: false,
        allowOutboxRecords: false,
        allowDeferredEffects: false,
      }
    : options?.effectPolicy
  const collector = new OperationEffectCollector(
    environment.commitMarkers
      ? { commitMarkers: [...environment.commitMarkers] }
      : undefined,
    effectPolicy
  )

  return createRunContext(
    options?.readOnly
      ? {
          ...environment,
          persistence: createReadOnlyPersistenceProvider(
            environment.persistence
          ) as PersistenceProvider,
        }
      : environment,
    collector,
    operationId,
    correlationId,
    effectPolicy
  )
}

/**
 * Fail-closed tenant/persistence wiring check. A tenant-scoped provider must
 * only serve the request tenant it was scoped for — including the case where
 * the request carries no tenant at all (platform/system operations must use
 * an explicit platform-scoped provider, never an unrelated tenant's scope).
 */
function assertPersistenceScopeMatchesRequest(
  persistence: PersistenceProvider,
  requestTenantId: string | null | undefined
): void {
  if (!isTenantScopedPersistenceProvider(persistence)) return
  const scopeTenantId = getTenantScopeId(persistence)
  if (scopeTenantId === undefined) return
  if (requestTenantId == null) {
    throw new TenantScopeViolationError(
      `Operations without a request tenant cannot use persistence scoped to tenant "${scopeTenantId}". ` +
        "Use an explicit platform-scoped provider."
    )
  }
  if (scopeTenantId !== requestTenantId) {
    throw new TenantScopeViolationError(
      `Request tenant "${requestTenantId}" does not match persistence scope "${scopeTenantId}"`
    )
  }
}

function createRunContext(  environment: OperationEnvironment,
  collector: OperationEffectCollector,
  operationId: string,
  correlationId: string | undefined,
  effectPolicy?: OperationEffectPolicy
): InternalOperationRunContext {
  const context: InternalOperationRunContext = {
    ...environment,
    operationId,
    ...(correlationId !== undefined ? { correlationId } : {}),
    effects: collector,
    get isDisposed() {
      return collector.isDisposed
    },
    get transactionalEffects() {
      return collector.transactionalEffects
    },
    get outboxRecords() {
      return collector.outboxRecords
    },
    get bestEffortEffects() {
      return collector.bestEffortEffects
    },
    get commitMarkers() {
      return collector.commitMarkers
    },
    requireRuntimeCapability: (capability) =>
      requireCapability(environment.runtimeCapabilities, capability),
    addTransactionalEffect: (name, execute) =>
      collector.addTransactionalEffect(name, execute, effectPolicy),
    addOutboxRecord: (record) =>
      collector.addOutboxRecord(
        normalizeOutboxRecord(record, {
          id: record.id ?? environment.services.idGenerator(),
          occurredAt: record.occurredAt ?? environment.services.clock(),
        }),
        effectPolicy
      ),
    addDurableEffect: ({ name, outbox }) => {
      if (!name || typeof name !== "string") {
        throw new ConfigurationError(
          "addDurableEffect requires a non-empty effect name."
        )
      }
      collector.addOutboxRecord(
        normalizeOutboxRecord(outbox, {
          id: outbox.id ?? environment.services.idGenerator(),
          occurredAt: outbox.occurredAt ?? environment.services.clock(),
        }),
        effectPolicy
      )
    },
    addBestEffortEffect: (name, execute) => {
      requireCapability(environment.runtimeCapabilities, "deferredExecution")
      collector.addBestEffortEffect(name, execute)
    },
    addCommitMarker: (marker) => collector.registerCommitMarker(marker),
    withPersistence: (persistence, options) => {
      assertPersistenceProviderShape(persistence)
      assertPersistenceScopeMatchesRequest(
        persistence,
        environment.request?.tenantId
      )
      return createRunContext(
        { ...environment, persistence },
        collector,
        operationId,
        correlationId,
        options?.effectPolicy ?? effectPolicy
      )
    },
    takePreCommitEffects: () => collector.takePreCommitEffects(),
    takeDeferredEffects: () => collector.takeDeferredEffects(),
    dispose: () => collector.dispose(),
  }
  return context
}

export function createPostCommitOperationContext(
  operation: OperationContext
): PostCommitOperationContext {
  const restricted: PostCommitOperationContext = {
    operationId: operation.operationId,
    ...(operation.correlationId !== undefined
      ? { correlationId: operation.correlationId }
      : {}),
    services: operation.services,
    ...(operation.request?.metadata !== undefined
      ? { metadata: operation.request.metadata }
      : {}),
    addBestEffortEffect: (name, execute) => {
      operation.addBestEffortEffect(name, async () => execute(restricted))
    },
  }
  return restricted
}
