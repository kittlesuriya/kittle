import type { ValidationSchema } from "kittle-core/ports"
import { createOperationContext } from "kittle-core/operation"
import {
  enforceRateLimit,
  type RateLimitConfig,
  type RateLimitStore,
} from "kittle-core/rate-limit"
import {
  assertIdempotencyAcquireResult,
  isAtomicBatchIdempotencyPort,
  isDurableIdempotencyPort,
  isTransactionalIdempotencyPort,
  type IdempotencyCommitItem,
  type IdempotencyResourceIdentity,
  type AbacWriteEnforcer,
} from "kittle-core/ports"
import {
  CapabilityError,
  ConfigurationError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  assertVerifiedAbacBundle,
  createAbacAuthorizer,
} from "kittle-core/domain"
import { redactPhiDeep } from "../utils/redact"
import type {
  FrameworkAdapterDeps,
  FrameworkScope,
  FrameworkSession,
} from "../server"
import type { OperationDefinition } from "kittle-core/operation"
import { runOperation } from "kittle-core/operation"
import type { CapabilityCheckConfig } from "kittle-core/entity/capabilityCheck"
import type { PersistenceProvider } from "kittle-core/ports"
import { createTenantScopedPersistenceProvider } from "kittle-core/ports"
import type { RuntimeCapabilities } from "kittle-core/ports"
import { CacheBackedRateLimitStore } from "../cache"
import { CacheService } from "kittle-core/cache"
import {
  createFrameworkErrorHandler,
  frameworkJson,
} from "./handleFrameworkCoreError"
import {
  parseJsonBodySafely,
  parseUniqueQueryParameters,
  resolveRequestMetadata,
} from "./requestBody"
import type { CacheAdapter } from "kittle-core/cache"
import type { AuditSink, OutboxSink } from "kittle-core/ports"
import {
  boundRateLimitKeyMaterial,
  buildIdempotencyScopeIdentity,
  buildIdempotencySecurityContext,
  deserializeResponse,
  fingerprintJson,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  serializeResponse,
  type SerializedResponse,
  type SerializedResponseIdempotencyPort,
} from "./idempotency"

const frameworkErrorHandler = createFrameworkErrorHandler()

export type ScopedFrameworkValidation = {
  params?: ValidationSchema
  query?: ValidationSchema
  body?: ValidationSchema
  bodyMaxBytes?: number
}

export type ScopedFrameworkValidatedContext = {
  validatedParams?: unknown
  validatedQuery?: unknown
  validatedBody?: unknown
}

export type CrudScopeConfig = {
  scope: FrameworkScope
  sessionRequired?: boolean
  csrfRequired?: boolean
  idempotency?: { required?: boolean }
}

function getCookieValue(name: string, request: Request): string | null {
  const header = request.headers.get("cookie")
  if (!header) return null
  for (const part of header.split("; ")) {
    const eqIdx = part.indexOf("=")
    if (eqIdx === -1) continue
    if (part.slice(0, eqIdx).trim() === name) return part.slice(eqIdx + 1)
  }
  return null
}

async function enrichValidatedContext(args: {
  request: Request
  context?: { params?: Promise<unknown> }
  validation?: ScopedFrameworkValidation
}): Promise<ScopedFrameworkValidatedContext> {
  const validatedParams = args.validation?.params
    ? args.validation.params.parse(
        args.context?.params ? await args.context.params : undefined
      )
    : undefined

  const queryObject = parseUniqueQueryParameters(args.request)
  const validatedQuery = args.validation?.query
    ? args.validation.query.parse(queryObject)
    : undefined

  const validatedBody = await parseJsonBodySafely(
    args.request,
    args.validation?.body,
    args.validation?.bodyMaxBytes
  )

  return { validatedParams, validatedQuery, validatedBody }
}

function resolveSessionRequired(scope: CrudScopeConfig): boolean {
  return scope.sessionRequired ?? scope.scope !== "public"
}

function resolveCsrfRequired(scope: CrudScopeConfig): boolean {
  return scope.csrfRequired ?? scope.scope !== "public"
}

export function createFrameworkWriteHandler<
  TInput,
  TResult,
  TExisting extends object = { [key: string]: unknown },
>(
  args: {
    adapterDeps: FrameworkAdapterDeps
    scope: CrudScopeConfig
    moduleKey: string
    action: "create" | "update" | "delete"
    validation?: ScopedFrameworkValidation
    rateLimit?: {
      config: RateLimitConfig
      consistency?: "atomic" | "best-effort"
      failureMode?: import("kittle-core/rate-limit").RateLimitFailureMode
      key?: (request: Request, session: FrameworkSession) => string
    }
    getRateLimitStore?: () => Promise<RateLimitStore>
    getCacheAdapter?: () => Promise<CacheAdapter>
    runtimeCapabilities?: RuntimeCapabilities
    auditSinkFactory?: (
      session: FrameworkSession,
      persistence?: PersistenceProvider
    ) => AuditSink
    outboxSinkFactory?: (
      session: FrameworkSession,
      persistence?: PersistenceProvider
    ) => OutboxSink
    invalidateTags?: (
      validated: ScopedFrameworkValidatedContext,
      session: FrameworkSession
    ) => string[] | Promise<string[]>
    createPersistence: (session: FrameworkSession) => PersistenceProvider
    definition: OperationDefinition<TInput, TResult>
    resolveInput: (args: {
      request: Request
      validated: ScopedFrameworkValidatedContext
      session: FrameworkSession
      existing?: TExisting
    }) => Promise<TInput>
    resolveExistingRecord?: (args: {
      request: Request
      validated: ScopedFrameworkValidatedContext
      session: FrameworkSession
    }) => Promise<TExisting | undefined>
    /** Stable resource identity used to build the durable commit receipt. */
    resolveResourceIdentity?: (args: {
      input: TInput
      session: FrameworkSession
    }) => IdempotencyResourceIdentity
    /**
     * Rebuilds a safe committed response for a business-committed row that lost
     * its in-flight finalization, by rereading the resource under the current
     * verified security context. Generic operations may omit this and receive a
     * deterministic business-committed outcome instead.
     */
    recoverCommittedResponse?: (args: {
      resource: IdempotencyResourceIdentity
      session: FrameworkSession
    }) => Promise<TResult | null>
    toResponse?: (result: TResult) => Response
  } & CapabilityCheckConfig
) {
  // Correctness-critical cache invalidation requires a durable obligation, which
  // is only available when the mutation participates in idempotency.
  if (args.invalidateTags && args.scope.idempotency?.required !== true) {
    throw new ConfigurationError(
      `"${args.moduleKey}" configures correctness-critical invalidateTags without required idempotency; durable cache invalidation needs idempotency`
    )
  }
  if (args.invalidateTags && !args.getCacheAdapter) {
    throw new ConfigurationError(
      `"${args.moduleKey}" configures invalidateTags without a cache adapter provider`
    )
  }
  if (
    args.definition.audit?.auditGuarantee === "durable" &&
    !args.outboxSinkFactory
  ) {
    throw new ConfigurationError(
      `"${args.moduleKey}" configures durable audit guarantee without an outboxSinkFactory`
    )
  }
  return async (request: Request, context?: { params?: Promise<unknown> }) => {
    let requestMetadata = resolveRequestMetadata(request)
    const responseWithMetadata = (
      response: Response,
      metadata: ReturnType<typeof resolveRequestMetadata>
    ): Response => {
      response.headers.set("x-request-id", metadata.requestId)
      if (metadata.correlationId)
        response.headers.set("x-correlation-id", metadata.correlationId)
      response.headers.set("cache-control", "no-store")
      return response
    }
    try {
      const deps = args.adapterDeps
      requestMetadata = resolveRequestMetadata(
        request,
        deps.resolveClientIp,
        deps.resolveHttpMetadata?.(request)
      )
      const capabilityMode =
        args.skipCapabilityCheck === true
          ? { enabled: false as const, key: undefined }
          : args.customCapabilityKey
            ? { enabled: true as const, key: args.customCapabilityKey }
            : null

      if (!capabilityMode) {
        throw new ConfigurationError(
          `Write handler for "${args.moduleKey}" must either declare customCapabilityKey or set skipCapabilityCheck: true`
        )
      }

      if (args.scope.scope === "public") {
        throw new ConfigurationError(
          `Public write handlers are not supported for "${args.moduleKey}"`
        )
      }

      if (resolveCsrfRequired(args.scope)) {
        deps.assertValidCsrf(request)
      }

      const session = await deps.resolveSession({
        scope: args.scope.scope,
        request,
        requireSession: resolveSessionRequired(args.scope),
      })

      if (!session.actor) {
        throw new UnauthorizedError()
      }

      let abacBundle = null

      // Impersonated sessions and sessions without an explicit bypassAuthority
      // grant are always evaluated under full ABAC; bypass is never implied
      // from the actor's role shape.
      if (
        session.actor.impersonatedById ||
        session.actor.bypassAuthority !== true ||
        !deps.isOwnerBypass({ scope: args.scope.scope, session })
      ) {
        if (
          capabilityMode.enabled &&
          !deps.hasCapability({
            scope: args.scope.scope,
            moduleKey: args.moduleKey,
            capabilityKey: capabilityMode.key,
            session,
          })
        ) {
          throw new CapabilityError(`${args.moduleKey}:${capabilityMode.key}`)
        }

        abacBundle = await deps.resolveAbacBundle({
          scope: args.scope.scope,
          moduleKey: args.moduleKey,
          session,
        })

        if (!abacBundle) {
          throw new ForbiddenError("ABAC authorization bundle unavailable")
        }
        assertVerifiedAbacBundle(abacBundle)
        if (capabilityMode.enabled && abacBundle) {
          createAbacAuthorizer(abacBundle).assertGlobalCapability(
            capabilityMode.key
          )
        }
      }

      deps.assertModuleEnabled({
        scope: args.scope.scope,
        moduleKey: args.moduleKey,
        session,
      })
      deps.assertModuleActionEnabled({
        scope: args.scope.scope,
        moduleKey: args.moduleKey,
        action: args.action,
        session,
      })
      if (capabilityMode.enabled) {
        deps.assertModuleCapabilityEnabled({
          scope: args.scope.scope,
          moduleKey: args.moduleKey,
          capabilityKey: capabilityMode.key,
          session,
        })
      }

      const validated = await enrichValidatedContext({
        request,
        ...(context ? { context } : {}),
        ...(args.validation ? { validation: args.validation } : {}),
      })
      const rateLimitConsistency =
        args.rateLimit?.consistency ??
        args.rateLimit?.config.consistency ??
        "atomic"
      const needsCache = Boolean(
        args.invalidateTags ||
        (args.rateLimit && rateLimitConsistency !== "atomic")
      )
      const cacheAdapter =
        needsCache && args.getCacheAdapter ? await args.getCacheAdapter() : null
      if (args.invalidateTags && !cacheAdapter) {
        throw new ConfigurationError(
          `Cache invalidation for "${args.moduleKey}" requires an available cache adapter`
        )
      }

      if (args.rateLimit) {
        if (rateLimitConsistency !== "atomic" && !cacheAdapter) {
          throw new ConfigurationError(
            `Rate limit configured for "${args.moduleKey}" but no cache adapter is available`
          )
        }

        const consistency = rateLimitConsistency
        const rateLimitStore =
          consistency === "atomic"
            ? args.getRateLimitStore
              ? await args.getRateLimitStore()
              : null
            : new CacheBackedRateLimitStore(cacheAdapter!)
        if (!rateLimitStore) {
          throw new ConfigurationError(
            `Atomic rate limit for "${args.moduleKey}" requires an atomic rate-limit store`
          )
        }
        const customKey = args.rateLimit.key?.(request, session)
        const customMaterial =
          customKey !== undefined
            ? await boundRateLimitKeyMaterial(customKey)
            : undefined
        // Always namespace by module and action so a custom key cannot collide
        // across endpoints; the bounded custom segment is appended last.
        const rateKey = `${args.scope.scope}:${session.actor.tenantId ?? "platform"}:${args.moduleKey}:${args.action}:${customMaterial ?? `${session.actor.id}:${requestMetadata.ipAddress}`}`
        await enforceRateLimit({
          store: rateLimitStore,
          key: rateKey,
          config: args.rateLimit.config,
          consistency,
          ...(args.rateLimit.failureMode !== undefined
            ? { failureMode: args.rateLimit.failureMode }
            : {}),
        })
      }

      const existing = args.resolveExistingRecord
        ? await args.resolveExistingRecord({ request, validated, session })
        : undefined

      const authorizer = abacBundle ? createAbacAuthorizer(abacBundle) : null
      const enforceAbac: AbacWriteEnforcer | undefined = authorizer
        ? {
            enforce: (
              action: string,
              record: Record<string, unknown>,
              changedFields?: string[]
            ) =>
              authorizer.assertWrite({
                action: action as "create" | "update" | "delete",
                record,
                ...(changedFields ? { changedFields } : {}),
              }),
          }
        : undefined

      const input = await args.resolveInput({
        request,
        validated,
        session,
        ...(existing !== undefined ? { existing } : {}),
      })
      const basePersistence = args.createPersistence(session)
      const operationPersistence =
        session.scope === "tenant"
          ? createTenantScopedPersistenceProvider(
              basePersistence,
              session.actor.tenantId
            )
          : basePersistence
      const auditSinkFactory = args.auditSinkFactory
        ? {
            create: (persistence: PersistenceProvider) =>
              args.auditSinkFactory!(session, persistence),
          }
        : undefined
      const outboxSinkFactory = args.outboxSinkFactory
        ? {
            create: (persistence: PersistenceProvider) =>
              args.outboxSinkFactory!(session, persistence),
          }
        : undefined

      const idempotencyKey =
        request.headers.get("Idempotency-Key")?.trim() || undefined
      if (
        idempotencyKey &&
        idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
      ) {
        throw new ValidationError("Idempotency-Key is too long")
      }
      if (args.scope.idempotency?.required && !idempotencyKey) {
        throw new ValidationError("Idempotency-Key header is required")
      }

      const serializeBusinessResult = async (
        businessResult: TResult
      ): Promise<SerializedResponse> => {
        const response = args.toResponse
          ? args.toResponse(businessResult)
          : frameworkJson(businessResult)
        return serializeResponse(response.clone())
      }
      // The invalidation obligation is computed once and persisted with the
      // durable idempotency marker, so physical cache invalidation is retried
      // (replay + finalizer) even if the original request never returns.
      const invalidationTags: string[] | undefined = args.invalidateTags
        ? await args.invalidateTags(validated, session)
        : undefined
      if (invalidationTags) {
        const MAX_INVALIDATION_TAGS = 50
        const MAX_TAG_BYTES = 255
        if (invalidationTags.length > MAX_INVALIDATION_TAGS) {
          throw new ConfigurationError(
            `Invalidation tag count ${invalidationTags.length} exceeds maximum ${MAX_INVALIDATION_TAGS}`
          )
        }
        for (const tag of invalidationTags) {
          if (new TextEncoder().encode(tag).length > MAX_TAG_BYTES) {
            throw new ConfigurationError(
              `Invalidation tag "${tag}" exceeds maximum byte length of ${MAX_TAG_BYTES}`
            )
          }
        }
      }
      const invalidateAfterCommit = async (): Promise<void> => {
        if (!invalidationTags) return
        if (!cacheAdapter)
          throw new ConfigurationError(
            `Cache invalidation for "${args.moduleKey}" requires an available cache adapter`
          )
        await new CacheService({
          adapter: cacheAdapter,
          correctnessCritical: true,
        }).invalidateTags(invalidationTags)
      }

      let idempotency:
        | {
            port: SerializedResponseIdempotencyPort
            request: {
              scope: string
              key: string
              fingerprint: string
              leaseDurationMs: number
            }
            token: string
          }
        | undefined
      if (idempotencyKey) {
        if (!deps.createIdempotencyPort) {
          throw new ConfigurationError(
            `Idempotency is not configured for "${args.moduleKey}"`
          )
        }
        const securityContext = buildIdempotencySecurityContext(session)
        const scopeIdentity = buildIdempotencyScopeIdentity(session)
        const scope =
          args.scope.scope === "tenant"
            ? `tenant:${session.actor.tenantId}:${args.moduleKey}:${args.action}:principal:${scopeIdentity}`
            : `platform:${args.moduleKey}:${args.action}:principal:${scopeIdentity}`
        const idempotencyRequest = {
          scope,
          key: idempotencyKey,
          fingerprint: await fingerprintJson({
            moduleKey: args.moduleKey,
            action: args.action,
            securityContext,
            clientMutation: {
              ...(validated.validatedParams !== undefined
                ? { params: validated.validatedParams }
                : {}),
              ...(validated.validatedQuery !== undefined
                ? { query: validated.validatedQuery }
                : {}),
              ...(validated.validatedBody !== undefined
                ? { body: validated.validatedBody }
                : {}),
            },
            // Semantic concurrency preconditions must be part of the identity.
            preconditions: {
              ...(request.headers.get("if-match")
                ? { ifMatch: request.headers.get("if-match") }
                : {}),
              ...(request.headers.get("if-none-match")
                ? { ifNoneMatch: request.headers.get("if-none-match") }
                : {}),
            },
            // A replay is only valid under the exact policy bundle that
            // authorized the original mutation.
            abacSecurityDigest: abacBundle?.securityDigest ?? null,
          }),
          leaseDurationMs: 30_000,
        }
        const port = deps.createIdempotencyPort<SerializedResponse>({
          scope: args.scope.scope,
          session,
        })
        // A mutation may only run when the port can join the business commit
        // boundary (transaction or atomic batch). A port that can only mark
        // committed afterward recreates the exactly-once crash window.
        if (!isDurableIdempotencyPort(port)) {
          throw new ConfigurationError(
            `Idempotency for "${args.moduleKey}" requires a transaction- or atomic-batch-integrated idempotency port`
          )
        }
        const acquired = await port.acquire(idempotencyRequest)
        // Fail closed on a malformed store response: unknown outcomes,
        // tokenless acquisitions, and resultless replays throw
        // ConfigurationError here (mapped to 500 below) instead of replaying
        // `undefined` or authorizing an unfenced mutation.
        assertIdempotencyAcquireResult<SerializedResponse>(acquired)
        if (acquired.outcome === "replay") {
          return responseWithMetadata(
            deserializeResponse(acquired.result),
            requestMetadata
          )
        }
        if (acquired.outcome === "business-committed") {
          const resource = acquired.resource
          // Replay the durable receipt, never tags recomputed for this retry.
          // This also drains the obligation when the resource was deleted or
          // the authorized recovery reread cannot produce a response.
          if (acquired.invalidations) {
            if (!cacheAdapter) {
              throw new ConfigurationError(
                `Cache invalidation for "${args.moduleKey}" requires an available cache adapter`
              )
            }
            await new CacheService({
              adapter: cacheAdapter,
              correctnessCritical: true,
            }).invalidateTags([...acquired.invalidations])
          }
          if (resource && args.recoverCommittedResponse) {
            const recovered = await args.recoverCommittedResponse({
              resource,
              session,
            })
            if (recovered !== null) {
              const serialized = await serializeBusinessResult(recovered)
              // Complete the row to establish stable replay for future retries
              await port.complete({
                ...idempotencyRequest,
                token: acquired.token,
                result: serialized,
                ...(resource ? { resource } : {}),
                ...(acquired.invalidations
                  ? { invalidations: acquired.invalidations }
                  : {}),
              })
              return responseWithMetadata(
                deserializeResponse(serialized),
                requestMetadata
              )
            }
          }
          throw new ConflictError(
            "The mutation for this Idempotency-Key committed without a replayable response"
          )
        }
        if (acquired.outcome === "conflict")
          throw new ConflictError(
            "Idempotency-Key was reused for a different mutation"
          )
        if (acquired.outcome === "in-progress")
          throw new ConflictError(
            "The mutation for this Idempotency-Key is already in progress"
          )
        idempotency = {
          port,
          request: idempotencyRequest,
          token: acquired.token,
        }
      }

      // The durable receipt joins the business commit boundary: in-transaction
      // for transactional adapters, in-batch for atomic-batch adapters. The
      // receipt never carries a replayable response.
      const useInBatchMarker =
        idempotency !== undefined &&
        isAtomicBatchIdempotencyPort(idempotency.port) &&
        operationPersistence.capabilities.atomicBatchIdempotency === true
      if (
        idempotency &&
        isAtomicBatchIdempotencyPort(idempotency.port) &&
        !useInBatchMarker
      ) {
        throw new ConfigurationError(
          `"${args.moduleKey}" requires atomic-batch idempotency persistence for the configured D1 idempotency port`
        )
      }

      const resourceIdentity = args.resolveResourceIdentity
        ? args.resolveResourceIdentity({ input, session })
        : undefined

      const commitMarkers: import("kittle-core/operation").CommitMarkerEntry[] =
        idempotency
          ? (() => {
              const idemPort = idempotency.port
              const lease = {
                request: idempotency.request,
                token: idempotency.token,
              }
              const receipt: IdempotencyCommitItem = {
                scope: idempotency.request.scope,
                key: idempotency.request.key,
                fingerprint: idempotency.request.fingerprint,
                token: lease.token,
                ...(resourceIdentity ? { resource: resourceIdentity } : {}),
                ...(invalidationTags
                  ? { invalidations: invalidationTags }
                  : {}),
              }
              const marker: import("kittle-core/operation").CommitMarkerEntry =
                {
                  name: "idempotency-commit",
                }
              if (isTransactionalIdempotencyPort(idemPort)) {
                marker.commit = async (_businessResult, persistence) => {
                  await idemPort.markCommittedInTransaction.call(
                    idemPort,
                    receipt,
                    persistence
                  )
                }
              } else if (isAtomicBatchIdempotencyPort(idemPort)) {
                marker.batchItem = () =>
                  idemPort.createCommitBatchItem.call(idemPort, receipt)
              }
              return [marker]
            })()
          : []

      const operationContext = createOperationContext({
        ...(commitMarkers.length > 0 ? { commitMarkers } : {}),
        persistence: operationPersistence,
        runtimeCapabilities:
          args.runtimeCapabilities ??
          (() => {
            throw new ConfigurationError(
              `Runtime capabilities are required for "${args.moduleKey}"`
            )
          })(),
        request: {
          requestId: requestMetadata.requestId,
          correlationId: requestMetadata.correlationId,
          tenantId: session.actor.tenantId ?? null,
          actor: {
            id: session.actor.id,
            type: session.actor.type,
            impersonatedById: session.actor.impersonatedById ?? null,
          },
          metadata: {
            requestId: requestMetadata.requestId,
            ipAddress: requestMetadata.ipAddress,
            userAgent: requestMetadata.userAgent,
            cookiesPresent: getCookieValue("session", request) !== null,
            scope: args.scope.scope,
            frameworkSession: session,
          },
        },
        ...(args.auditSinkFactory
          ? { auditSink: args.auditSinkFactory(session, operationPersistence) }
          : {}),
        ...(auditSinkFactory ? { auditSinkFactory } : {}),
        ...(outboxSinkFactory ? { outboxSinkFactory } : {}),
        ...(deps.effectFailureReporter
          ? { effectFailureReporter: deps.effectFailureReporter }
          : {}),
        auditSanitizer: redactPhiDeep,
        ...(enforceAbac ? { enforceAbac } : {}),
      })

      let serializedResponse: SerializedResponse | undefined
      let businessResponse: Response | undefined
      let result: TResult
      const heartbeat = idempotency
        ? setInterval(
            () => {
              void idempotency?.port
                .renew({ ...idempotency.request, token: idempotency.token })
                .catch((error: unknown) => {
                  // A lost heartbeat is a liveness signal, not the ownership
                  // fence (the commit boundary asserts ownership). Report it so
                  // lease-loss is operationally visible rather than swallowed.
                  deps.effectFailureReporter?.({
                    ...(idempotency?.request.scope
                      ? { operationId: idempotency.request.scope }
                      : {}),
                    phase: "idempotency-heartbeat",
                    effectName: "renew",
                    error,
                  })
                })
            },
            Math.max(
              1_000,
              Math.floor((idempotency.request.leaseDurationMs ?? 30_000) / 3)
            )
          )
        : undefined
      try {
        result = await runOperation<TInput, TResult>({
          operation: operationContext,
          definition: args.definition,
          input,
          onBusinessResult: (businessResult) => {
            businessResponse = args.toResponse
              ? args.toResponse(businessResult)
              : frameworkJson(businessResult)
            return Promise.resolve()
          },
        })
      } catch (error) {
        if (
          !idempotency &&
          error &&
          typeof error === "object" &&
          "committed" in error &&
          (error as { committed?: unknown }).committed === true &&
          businessResponse
        )
          return businessResponse
        throw error
      } finally {
        if (heartbeat) clearInterval(heartbeat)
      }

      // The durable commit receipt is atomic with the business mutation
      // (in-transaction for transactional adapters, in-batch for
      // non-transactional adapters) and never carries a replayable response.
      // The safe response is produced by the operation's own committed
      // reread/projection phase, serialized here, and written by complete().
      // Physical invalidation runs before finalization so the durable
      // obligation is only cleared after a successful invalidation.
      if (idempotency) {
        try {
          const serialized = await serializeBusinessResult(result)
          serializedResponse = serialized
          await invalidateAfterCommit()
          await idempotency.port.complete({
            ...idempotency.request,
            token: idempotency.token,
            result: serialized,
            ...(resourceIdentity ? { resource: resourceIdentity } : {}),
            ...(invalidationTags ? { invalidations: invalidationTags } : {}),
          })
        } catch (error) {
          await idempotency.port.recover({
            ...idempotency.request,
            token: idempotency.token,
          })
          throw error
        }
      } else {
        await invalidateAfterCommit()
      }

      const response = serializedResponse
        ? deserializeResponse(serializedResponse)
        : (businessResponse ??
          (args.toResponse ? args.toResponse(result) : frameworkJson(result)))
      return responseWithMetadata(response, requestMetadata)
    } catch (error) {
      return frameworkErrorHandler(error, requestMetadata)
    }
  }
}
