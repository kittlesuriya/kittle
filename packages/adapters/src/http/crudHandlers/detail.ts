import {
  CacheService,
  buildAuditRecord,
  buildKey,
  createReadOnlyPersistenceProvider,
  serializeCacheKeyPart,
  type PersistenceProvider,
} from "core/ports"
import {
  createOperationContext,
  runOperation,
  type OperationDefinition,
} from "core/operation"
import {
  Predicate,
  projectResponseRecord,
  resolveFieldReadOverrides,
  NotFoundError,
} from "core/domain"
import {
  frameworkJson,
  createFrameworkErrorHandler,
} from "../handleFrameworkCoreError"
import { resolveRequestMetadata } from "../requestBody"
import type { CrudShared, SelectableRow } from "./types"
import {
  buildStructuralScope,
  deriveSecurityCachePartition,
  getRequestIp,
  resolveOperationFrameworkSession,
  toCrudReadContext,
  withScopedPersistence,
} from "./shared"

const frameworkErrorHandler = createFrameworkErrorHandler()

export function createDetailHandler<
  TRow extends SelectableRow,
  A,
  B,
  L extends SelectableRow,
  D extends SelectableRow,
>(shared: CrudShared<TRow, A, B, L, D>) {
  const { options, entity } = shared
  return async (
    request: Request,
    params: Record<string, string>
  ): Promise<Response> => {
    let requestMetadata: ReturnType<typeof resolveRequestMetadata> | undefined
    try {
      if (!shared.routes.detail)
        return frameworkJson({ error: "Method Not Allowed" }, { status: 405 })
      requestMetadata = resolveRequestMetadata(
        request,
        shared.deps.resolveClientIp,
        shared.deps.resolveHttpMetadata?.(request)
      )
      const { id } = (
        options.validation?.idParams ??
        (await import("./types")).defaultIdParams
      ).parse(params) as { id: string }
      const session = await shared.deps.resolveSession({
        scope: options.scope.scope,
        request,
        requireSession:
          options.scope.sessionRequired ?? options.scope.scope !== "public",
      })
      const abacBundle = await shared.enforceReadAccess(request, session)
      const readScope = shared.buildReadScope(abacBundle)
      await shared.enforceReadRateLimit(
        "detail",
        options.rateLimit?.detail,
        request,
        session
      )
      const basePersistence = options.createPersistence(session)
      const persistence = entity.tenantField
        ? withScopedPersistence(session, basePersistence)
        : basePersistence

      const readEnvironment = createOperationContext({
        persistence: createReadOnlyPersistenceProvider(
          persistence
        ) as unknown as PersistenceProvider,
        runtimeCapabilities: shared.writeRuntimeCapabilities,
        request: {
          requestId: requestMetadata.requestId,
          correlationId: requestMetadata.correlationId,
          tenantId: session.actor?.tenantId ?? null,
          ...(session.actor
            ? {
                actor: {
                  id: session.actor.id,
                  type: session.actor.type,
                  impersonatedById: session.actor.impersonatedById ?? null,
                },
              }
            : {}),
          metadata: {
            requestId: requestMetadata.requestId,
            ipAddress: requestMetadata.ipAddress,
            userAgent: requestMetadata.userAgent,
            scope: session.scope,
            frameworkSession: session,
          },
        },
      })

      const structural = buildStructuralScope(
        entity,
        session,
        options.tenantScoping
      )
      const filter = readScope.filter
        ? structural
          ? Predicate.and(structural, readScope.filter)
          : readScope.filter
        : structural

      const definition: OperationDefinition<{ id: string }, SelectableRow> = {
        key: `${options.moduleKey}.detail`,
        kind: "read",
        atomicity: { kind: "standard", mode: "none" },
        execute: async ({ operation, input }) => {
          const repo = operation.persistence.repository(entity)
          const row = filter
            ? repo.findOneWhere
              ? await repo.findOneWhere(
                  Predicate.and(
                    Predicate.eq(entity.primaryKey ?? "id", input.id),
                    filter
                  )
                )
              : ((
                  await repo.findMany({
                    filter: Predicate.and(
                      Predicate.eq(entity.primaryKey ?? "id", input.id),
                      filter
                    ),
                  })
                ).rows[0] ?? null)
            : await repo.findById(input.id)
          if (!row) throw new NotFoundError(`${entity.name} not found`)
          return row
        },
        after: async ({ operation, input: _input, result }) => {
          const hookSession = resolveOperationFrameworkSession(operation)
          const durableRow = result
          const overrides = abacBundle
            ? resolveFieldReadOverrides({
                policies: abacBundle.policies,
                moduleKey: options.moduleKey,
                record: durableRow,
              })
            : undefined
          const projectedRow = projectResponseRecord({
            entity,
            record: durableRow,
            ...(overrides ? { overrides } : {}),
          })
          const enriched = options.crud?.detail?.afterCommitRepresentation
            ? await options.crud.detail.afterCommitRepresentation({
                row: projectedRow as unknown as TRow,
                context: toCrudReadContext(hookSession, operation),
              })
            : projectedRow
          return projectResponseRecord({
            entity,
            record: enriched,
            ...(overrides ? { overrides } : {}),
          })
        },
      }

      if (options.crud?.detail?.beforeCommitTransform) {
        await runOperation<{ id: string }, { id: string }>({
          operation: readEnvironment,
          definition: {
            key: `${options.moduleKey}.detail.beforeCommitTransform`,
            kind: "read",
            atomicity: { kind: "standard", mode: "none" },
            execute: async ({ operation, input }) => {
              const hookSession = resolveOperationFrameworkSession(operation)
              await options.crud!.detail!.beforeCommitTransform!({
                id: input.id,
                context: toCrudReadContext(hookSession, operation),
              })
              return input
            },
          },
          input: { id },
        })
      }

      const resolveDetail = () =>
        runOperation<{ id: string }, SelectableRow>({
          operation: readEnvironment,
          definition,
          input: { id },
        })
      const scopeKey =
        session.scope === "tenant"
          ? readScope.cacheScopeKey
            ? `${session.actor.tenantId}:${readScope.cacheScopeKey}`
            : session.actor.tenantId
          : `${session.scope}:${readScope.cacheScopeKey ?? "global"}`
      const cachePartition = deriveSecurityCachePartition({
        bundle: abacBundle,
        session,
        cacheScopeKey: readScope.cacheScopeKey,
        hasRepresentationHook:
          typeof options.crud?.detail?.afterCommitRepresentation === "function",
        deps: options.adapterDeps,
        scope: options.scope.scope,
      })
      const useCache = options.cache.enabled === true && cachePartition.canCache
      const result = useCache
        ? await new CacheService({
            adapter: await options.getCacheAdapter(),
            correctnessCritical: Boolean(abacBundle),
          }).getOrSet(
            buildKey(
              options.cache.keyPrefix,
              `${cachePartition.partition}:${scopeKey}`,
              serializeCacheKeyPart({ type: "detail", id })
            ),
            resolveDetail,
            shared.buildReadTags(session)
          )
        : await resolveDetail()
      if (
        result &&
        options.audit?.readAudit &&
        options.auditSinkFactory &&
        session.actor
      )
        await options.auditSinkFactory(session).write(
          buildAuditRecord({
            id: crypto.randomUUID(),
            occurredAt: new Date(),
            actor: {
              id: session.actor.id,
              type: session.actor.type,
              impersonatedById: session.actor.impersonatedById ?? null,
            },
            action: `${options.audit.resource}.read`,
            resourceType: options.audit.resource,
            resourceId: id,
            tenantId: session.actor.tenantId ?? null,
            metadata: {
              ipAddress: getRequestIp(
                request,
                shared.deps.resolveClientIp,
                shared.deps.resolveHttpMetadata
              ),
              userAgent: requestMetadata.userAgent,
              scope: session.scope,
            },
          })
        )
      return withReadMetadata(frameworkJson(result), requestMetadata)
    } catch (error) {
      return frameworkErrorHandler(error, requestMetadata)
    }
  }
}

function withReadMetadata(
  response: Response,
  metadata: ReturnType<typeof resolveRequestMetadata> | undefined
): Response {
  if (!metadata) return response
  response.headers.set("x-request-id", metadata.requestId)
  if (metadata.correlationId)
    response.headers.set("x-correlation-id", metadata.correlationId)
  return response
}
