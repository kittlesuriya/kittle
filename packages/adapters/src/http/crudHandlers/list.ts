import {
  buildAuditRecord,
  createReadOnlyPersistenceProvider,
  type PersistenceProvider,
} from "kittle-core/ports"
import {
  CacheService,
  buildKey,
  serializeCacheKeyPart,
} from "kittle-core/cache"
import {
  createOperationContext,
  runOperation,
  type OperationDefinition,
} from "kittle-core/operation"
import {
  ForbiddenError,
  ValidationError,
  Predicate,
  projectResponseRecord,
  resolveFieldQueryDenials,
  resolveFieldReadOverrides,
  type PredicateNode,
} from "kittle-core/domain"
import {
  DEFAULT_MAX_QUERY_JSON_BYTES,
  filtersToPredicate,
  parseSortString,
} from "../filterInterop"
import { fingerprintJson } from "../idempotency"
import {
  parseUniqueQueryParameters,
  resolveRequestMetadata,
} from "../requestBody"
import {
  frameworkJson,
  createFrameworkErrorHandler,
} from "../handleFrameworkCoreError"
import {
  defaultListQuerySchema,
  type CrudShared,
  type ReadQuery,
  type SelectableRow,
} from "./types"
import {
  buildStructuralScope,
  deriveSecurityCachePartition,
  getRequestIp,
  resolveOperationFrameworkSession,
  toCrudReadContext,
  withScopedPersistence,
} from "./shared"

type ListReadResult<TRow> = {
  rows: TRow[]
  rowCount: number
  page: number
  pageSize: number
}

export function createListHandler<
  TRow extends SelectableRow,
  A,
  B,
  L extends SelectableRow,
  D extends SelectableRow,
>(shared: CrudShared<TRow, A, B, L, D>) {
  const { options, entity } = shared
  const frameworkErrorHandler = createFrameworkErrorHandler({
    ...(options.errorExposure ? { errorExposure: options.errorExposure } : {}),
  })
  return async (request: Request): Promise<Response> => {
    let requestMetadata: ReturnType<typeof resolveRequestMetadata> | undefined
    try {
      if (!shared.routes.list)
        return frameworkJson({ error: "Method Not Allowed" }, { status: 405 })
      requestMetadata = resolveRequestMetadata(
        request,
        shared.deps.resolveClientIp,
        shared.deps.resolveHttpMetadata?.(request)
      )
      const session = await shared.deps.resolveSession({
        scope: options.scope.scope,
        request,
        requireSession:
          options.scope.sessionRequired ?? options.scope.scope !== "public",
      })
      const abacBundle = await shared.enforceReadAccess(request, session)
      const readScope = shared.buildReadScope(abacBundle)
      await shared.enforceReadRateLimit(
        "list",
        options.rateLimit?.list,
        request,
        session
      )
      // Field-level query gating: caller filter/search/sort must never touch
      // fields ABAC masks or omits from responses, or those values could be
      // probed via query predicates, search substrings, sort order, and
      // row-count inference. The effective allowlists are the entity-declared
      // lists minus the ABAC query denials.
      const queryDenials = abacBundle
        ? resolveFieldQueryDenials({
            policies: abacBundle.policies,
            moduleKey: options.moduleKey,
          })
        : undefined
      const entityFieldNames = Object.keys(entity.fields ?? {})
      const effectiveFilterableColumns = queryDenials
        ? (options.filterableColumns ?? entityFieldNames).filter(
            (field) => !queryDenials.filter.includes(field)
          )
        : options.filterableColumns
      const effectiveSearchableColumns = queryDenials
        ? (options.searchableColumns ?? entityFieldNames).filter(
            (field) => !queryDenials.search.includes(field)
          )
        : (options.searchableColumns ?? [])
      const effectiveSortableColumns = queryDenials
        ? (options.sortableColumns ?? entityFieldNames).filter(
            (field) => !queryDenials.sort.includes(field)
          )
        : options.sortableColumns
      const rawQuery = parseUniqueQueryParameters(request)
      const listQuerySchema =
        options.validation?.listQuery ?? defaultListQuerySchema
      const parsed = listQuerySchema.parse(rawQuery) as Partial<ReadQuery>
      const query: ReadQuery = {
        page: parsed.page ?? 1,
        pageSize: parsed.pageSize ?? 10,
        ...(parsed.sorting !== undefined ? { sorting: parsed.sorting } : {}),
        ...(parsed.filters !== undefined ? { filters: parsed.filters } : {}),
      }
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

      const definition: OperationDefinition<
        { query: ReadQuery },
        ListReadResult<SelectableRow>
      > = {
        key: `${options.moduleKey}.list`,
        kind: "read",
        atomicity: { kind: "standard", mode: "none" },
        execute: async ({ operation, input }) => {
          const hookSession = resolveOperationFrameworkSession(operation)
          let filter: PredicateNode | undefined = buildStructuralScope(
            entity,
            hookSession,
            options.tenantScoping
          )
          if (readScope.filter)
            filter = filter
              ? Predicate.and(filter, readScope.filter)
              : readScope.filter
          if (input.query.filters) {
            const search = filtersToPredicate(
              input.query.filters,
              effectiveSearchableColumns,
              effectiveFilterableColumns,
              options.filterFieldMeta,
              options.queryLimits,
              options.searchStrategy
            )
            if (search) filter = filter ? Predicate.and(filter, search) : search
          }
          const sort =
            parseSortString(input.query.sorting, {
              ...(effectiveSortableColumns
                ? { allowedFields: effectiveSortableColumns }
                : {}),
              ...(options.queryLimits?.maxSortJsonBytes !== undefined
                ? { maxBytes: options.queryLimits.maxSortJsonBytes }
                : {}),
            }) ?? shared.resolveDefaultSort()
          const raw = await operation.persistence.repository(entity).findMany({
            ...(filter ? { filter } : {}),
            ...(sort ? { sort } : {}),
            pagination: {
              page: input.query.page,
              pageSize: input.query.pageSize,
            },
          })
          if (
            options.queryLimits?.maxCount !== undefined &&
            raw.rowCount > options.queryLimits.maxCount
          ) {
            throw new ValidationError(
              `query result count exceeds the configured maximum of ${options.queryLimits.maxCount}`
            )
          }
          return {
            rows: raw.rows as unknown as SelectableRow[],
            rowCount: raw.rowCount,
            page: raw.page,
            pageSize: raw.pageSize,
          }
        },
        after: async ({ operation, input: _input, result }) => {
          const hookSession = resolveOperationFrameworkSession(operation)
          const primaryKey = entity.primaryKey ?? "id"
          // Decide each row's visibility from its trusted durable row so an
          // enrichment hook cannot rewrite policy-driving attributes. Durable
          // rows are authorized and projected BEFORE the representation hook
          // sees them, so a hook can never detach a row from its plan.
          const durableRows = result.rows
          // Internal identity tokens come from the trusted durable rows BEFORE
          // projection, so the order/cardinality contract never depends on
          // whether the ABAC plan happens to leave the primary key visible.
          const durableKeys = durableRows.map((row) => String(row[primaryKey]))
          const projectedRows = durableRows.map((durableRow) =>
            projectResponseRecord({
              entity,
              record: durableRow,
              // The visibility plan is decided against the trusted durable row.
              ...(abacBundle
                ? {
                    overrides: resolveFieldReadOverrides({
                      policies: abacBundle.policies,
                      moduleKey: options.moduleKey,
                      record: durableRow,
                    }),
                  }
                : {}),
            })
          )
          if (!options.crud?.list?.afterCommitRepresentation) {
            return { ...result, rows: projectedRows }
          }
          const enriched = await options.crud.list.afterCommitRepresentation({
            result: {
              ...result,
              rows: projectedRows as unknown as L[],
            },
            context: toCrudReadContext(hookSession, operation),
          })
          // The hook must preserve the durable row set: same length and same
          // primary-key identity at every index. Reordering, adding, removing,
          // duplicating, or fabricating rows would otherwise escape the
          // already-applied field-visibility plan without re-authorization.
          if (enriched.rows.length !== durableRows.length)
            throw new ForbiddenError(
              `The 'afterCommitRepresentation' hook for ${options.moduleKey}.list returned ${enriched.rows.length} rows for ${durableRows.length} durable rows; list enrichment hooks must return the same row set`
            )
          for (let index = 0; index < durableRows.length; index += 1) {
            // Identity integrity beyond the primary key cannot be proven from
            // projected data — the hook only ever receives projected rows and
            // the internal durable tokens never leave this scope. The
            // enforceable contract is therefore (a) equal length and (b) the
            // hook did not falsify the primary key at index i when it is
            // visible. A masked/omitted primary key is allowed because the hook
            // cannot forge it from the projected payload.
            const hookKey = enriched.rows[index]?.[primaryKey]
            if (hookKey !== undefined && String(hookKey) !== durableKeys[index])
              throw new ForbiddenError(
                `The 'afterCommitRepresentation' hook for ${options.moduleKey}.list changed, reordered, duplicated, removed, or fabricated the row at index ${index}; list enrichment hooks must preserve row identity`
              )
          }
          return {
            ...enriched,
            rows: enriched.rows.map((row, index) =>
              projectResponseRecord({
                entity,
                record: row,
                ...(abacBundle
                  ? {
                      overrides: resolveFieldReadOverrides({
                        policies: abacBundle.policies,
                        moduleKey: options.moduleKey,
                        record: durableRows[index]!,
                      }),
                    }
                  : {}),
              })
            ),
          }
        },
      }
      if (
        options.queryLimits?.maxOffset !== undefined &&
        (query.page - 1) * query.pageSize > options.queryLimits.maxOffset
      ) {
        throw new ValidationError(
          `pagination offset exceeds the configured maximum of ${options.queryLimits.maxOffset}`
        )
      }

      const transformedQuery = options.crud?.list?.beforeCommitTransform
        ? (
            await runOperation<{ query: ReadQuery }, { query: ReadQuery }>({
              operation: readEnvironment,
              definition: {
                key: `${options.moduleKey}.list.beforeCommitTransform`,
                kind: "read",
                atomicity: { kind: "standard", mode: "none" },
                execute: async ({ operation, input }) => {
                  const hookSession =
                    resolveOperationFrameworkSession(operation)
                  const hookResult = await options.crud!.list!
                    .beforeCommitTransform!({
                    query: input.query,
                    context: toCrudReadContext(hookSession, operation),
                  })
                  return {
                    query: hookResult?.query
                      ? { ...input.query, ...hookResult.query }
                      : input.query,
                  }
                },
              },
              input: { query },
            })
          ).query
        : query

      // Hooks may return values that did not come from the request schema.
      // Normalize and bound the transformed query before caching or execution.
      const transformedParsed = listQuerySchema.parse(
        transformedQuery
      ) as Partial<ReadQuery>
      const validatedTransformedQuery: ReadQuery = {
        page: transformedParsed.page ?? 1,
        pageSize: transformedParsed.pageSize ?? 10,
        ...(transformedParsed.sorting !== undefined
          ? { sorting: transformedParsed.sorting }
          : {}),
        ...(transformedParsed.filters !== undefined
          ? { filters: transformedParsed.filters }
          : {}),
      }
      if (
        options.queryLimits?.maxOffset !== undefined &&
        (validatedTransformedQuery.page - 1) *
          validatedTransformedQuery.pageSize >
          options.queryLimits.maxOffset
      ) {
        throw new ValidationError(
          `pagination offset exceeds the configured maximum of ${options.queryLimits.maxOffset}`
        )
      }
      const maxFilterBytes =
        options.queryLimits?.maxFilterJsonBytes ?? DEFAULT_MAX_QUERY_JSON_BYTES
      if (
        validatedTransformedQuery.filters !== undefined &&
        new TextEncoder().encode(validatedTransformedQuery.filters).byteLength >
          maxFilterBytes
      ) {
        throw new ValidationError(
          `Filters JSON exceeds the maximum of ${maxFilterBytes} UTF-8 bytes`
        )
      }
      const maxSortBytes =
        options.queryLimits?.maxSortJsonBytes ?? DEFAULT_MAX_QUERY_JSON_BYTES
      if (
        validatedTransformedQuery.sorting !== undefined &&
        new TextEncoder().encode(validatedTransformedQuery.sorting).byteLength >
          maxSortBytes
      ) {
        throw new ValidationError(
          `Sorting JSON exceeds the maximum of ${maxSortBytes} UTF-8 bytes`
        )
      }

      const resolveList = () =>
        runOperation<{ query: ReadQuery }, ListReadResult<SelectableRow>>({
          operation: readEnvironment,
          definition,
          input: { query: validatedTransformedQuery },
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
          typeof options.crud?.list?.afterCommitRepresentation === "function",
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
              serializeCacheKeyPart({
                type: "list",
                query: validatedTransformedQuery,
              })
            ),
            resolveList,
            shared.buildReadTags(session)
          )
        : await resolveList()
      if (
        result &&
        options.audit?.readAudit &&
        options.auditSinkFactory &&
        session.actor
      ) {
        try {
          await options.auditSinkFactory(session).write(
            buildAuditRecord({
              id: crypto.randomUUID(),
              occurredAt: new Date(),
              actor: {
                id: session.actor.id,
                type: session.actor.type,
                impersonatedById: session.actor.impersonatedById ?? null,
              },
              action: `${options.audit.resource}.readList`,
              resourceType: options.audit.resource,
              resourceId: "",
              tenantId: session.actor.tenantId ?? null,
              metadata: {
                ipAddress: getRequestIp(
                  request,
                  shared.deps.resolveClientIp,
                  shared.deps.resolveHttpMetadata
                ),
                userAgent: requestMetadata.userAgent,
                scope: session.scope,
                page: result.page,
                pageSize: result.pageSize,
                resultCount: result.rowCount,
                // Bounded query fingerprint so audit records stay small and
                // never dump the caller's filter values or record set.
                queryFingerprint: await fingerprintJson(
                  validatedTransformedQuery
                ),
              },
            })
          )
        } catch {
          // Best-effort read audit: a sink or hashing failure must not fail the read.
        }
      }
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
