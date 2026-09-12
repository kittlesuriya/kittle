/* eslint-disable @typescript-eslint/require-await */
import type { OperationDefinition } from "kittle-core/operation"
import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
  Predicate,
  projectResponseRecord,
} from "kittle-core/domain"
import { createFrameworkWriteHandler } from "../createFrameworkWriteHandler"
import { frameworkJson } from "../handleFrameworkCoreError"
import type { CrudShared, DeleteOperationInput, SelectableRow } from "./types"
import { parseIfMatchVersion } from "./update"
import {
  auditEmit,
  buildStructuralScope,
  loadExistingRecord,
  resolveOperationFrameworkSession,
  toAuditObject,
  toCrudContext,
  toCrudPostCommitContext,
  resolveActionScopeForSession,
} from "./shared"

export function createDeleteHandler<
  TRow extends SelectableRow,
  A,
  B,
  L extends SelectableRow,
  D extends SelectableRow,
>(shared: CrudShared<TRow, A, B, L, D>) {
  const { options, entity } = shared
  const auditActive = auditEmit(options, "delete")
  const definition: OperationDefinition<
    DeleteOperationInput<TRow>,
    { success: true }
  > = {
    key: `${options.moduleKey}.delete`,
    kind: "mutation",
    atomicity: { kind: "standard", mode: "required" },
    ...(options.crud?.delete?.beforeCommitTransform
      ? {
          before: async ({ operation, input }) => {
            const session = resolveOperationFrameworkSession(operation)
            await options.crud!.delete!.beforeCommitTransform!({
              existing: input.existing,
              context: toCrudContext(session, operation),
            })
          },
        }
      : {}),
    execute: async ({ operation, input }) => {
      const session = resolveOperationFrameworkSession(operation)
      const filter = Predicate.eq(entity.primaryKey ?? "id", input.id)
      const structural = buildStructuralScope(
        entity,
        session,
        options.tenantScoping
      )
      const actionScope = await resolveActionScopeForSession(
        options,
        session,
        "delete"
      )
      const repo = operation.persistence.repository(entity)
      if (!repo.deleteWhere)
        throw new ConfigurationError(
          `Secure delete for ${entity.name} requires deleteWhere support`
        )
      let deleteFilter =
        structural && actionScope
          ? Predicate.and(filter, structural, actionScope)
          : structural
            ? Predicate.and(filter, structural)
            : actionScope
              ? Predicate.and(filter, actionScope)
              : filter
      const versionField =
        options.optimisticConcurrency?.versionField ?? entity.versionField
      const current = repo.findOneWhere
        ? await repo.findOneWhere(deleteFilter)
        : ((
            await repo.findMany({
              filter: deleteFilter,
              pagination: { page: 1, pageSize: 1 },
            })
          ).rows[0] ?? null)
      if (!current) throw new NotFoundError(`${entity.name} not found`)
      if (operation.enforceAbac)
        operation.enforceAbac.enforce("delete", toAuditObject(current))
      if (versionField) {
        if (input.expectedVersion === undefined)
          throw new ConflictError("Version is required for this delete")
        if (typeof input.existing[versionField] !== "number")
          throw new ConfigurationError(
            `Optimistic concurrency for "${entity.name}" requires numeric version field "${versionField}"`
          )
        deleteFilter = Predicate.and(
          deleteFilter,
          Predicate.eq(versionField, input.expectedVersion)
        )
      }
      const result = await repo.deleteWhere(
        deleteFilter,
        versionField
          ? {
              optimisticConcurrency: {
                expectedVersion: input.expectedVersion!,
              },
            }
          : undefined
      )
      if (result.deletedCount === 0) {
        if (versionField && input.expectedVersion !== undefined)
          throw new ConflictError(
            "This record was modified by another user. Please reload and try again."
          )
        throw new NotFoundError(`${entity.name} not found`)
      }
      return { success: true }
    },
    atomicBatch: {
      prepare: async ({ operation, input }) => {
        const session = resolveOperationFrameworkSession(operation)
        const structural = buildStructuralScope(
          entity,
          session,
          options.tenantScoping
        )
        const actionScope = await resolveActionScopeForSession(
          options,
          session,
          "delete"
        )
        const base = Predicate.eq(entity.primaryKey ?? "id", input.id)
        let filter =
          structural && actionScope
            ? Predicate.and(base, structural, actionScope)
            : structural
              ? Predicate.and(base, structural)
              : actionScope
                ? Predicate.and(base, actionScope)
                : base
        const versionField =
          options.optimisticConcurrency?.versionField ?? entity.versionField
        if (versionField) {
          if (input.expectedVersion === undefined)
            throw new ConflictError("Version is required for this delete")
          if (typeof input.existing[versionField] !== "number")
            throw new ConfigurationError(
              `Optimistic concurrency for "${entity.name}" requires numeric version field "${versionField}"`
            )
          filter = Predicate.and(
            filter,
            Predicate.eq(versionField, input.expectedVersion)
          )
        }
        return {
          commands: [
            {
              kind: "delete",
              entity: entity.name,
              ...(entity.namespace ? { namespace: entity.namespace } : {}),
              filter,
              expectedAffectedRows: 1,
              ...(versionField
                ? { expectedVersion: input.expectedVersion }
                : {}),
            },
          ],
          // MUTATION INTENT, NOT DB-real post-state: the result is the
          // deterministic command-state projection of what the batch is about to
          // delete. No post-commit read is attempted inside audit; the projection
          // must stay stable across idempotent retries.
          result: { success: true as const },
          verify: ({ commandResults }) => {
            const result = commandResults[0] as
              | {
                  meta?: { changes?: number }
                  changes?: number
                  affectedRows?: number
                }
              | undefined
            const changes =
              result?.meta?.changes ?? result?.changes ?? result?.affectedRows
            if (changes === undefined)
              throw new ConfigurationError(
                "Atomic delete did not return affected-row metadata"
              )
            if (changes !== 1) {
              if (versionField && input.expectedVersion !== undefined)
                throw new ConflictError(
                  "This record was modified by another user. Please reload and try again."
                )
              throw new NotFoundError(`${entity.name} not found`)
            }
          },
        }
      },
    },
    ...(options.crud?.delete?.afterCommitRepresentation
      ? {
          after: async ({ operation, input }) => {
            const session = resolveOperationFrameworkSession(operation)
            await options.crud!.delete!.afterCommitRepresentation!({
              existing: input.existing,
              context: toCrudContext(session, operation),
            })
          },
        }
      : {}),
    ...(options.crud?.delete?.afterCommit
      ? {
          afterCommit: async ({ operation, input }) => {
            const session = resolveOperationFrameworkSession(operation)
            await options.crud!.delete!.afterCommit!({
              existing: input.existing,
              operation,
              context: toCrudPostCommitContext(session, operation),
            })
          },
        }
      : {}),
    authorization: {
      authorize: async ({ operation, input }) => {
        if (operation.enforceAbac)
          operation.enforceAbac.enforce("delete", toAuditObject(input.existing))
        return { allowed: true }
      },
    },
    ...(auditActive
      ? {
          audit: {
            action: `${options.audit?.resource ?? entity.name}.deleted`,
            resourceType: options.audit?.resource ?? entity.name,
            ...(options.audit?.fieldClassification
              ? { fieldClassification: options.audit.fieldClassification }
              : {}),
            ...(options.audit?.required !== undefined
              ? { required: options.audit.required }
              : {}),
            ...(options.audit?.auditGuarantee !== undefined
              ? { auditGuarantee: options.audit.auditGuarantee }
              : {}),
            ...(options.audit?.requiredStateSemantics !== undefined
              ? { requiredStateSemantics: options.audit.requiredStateSemantics }
              : {}),
            resolveResourceId: ({ input }) => input.id,
            ...(options.audit?.includeValues === true
              ? {
                  extractOldValue: ({
                    input,
                  }: {
                    input: DeleteOperationInput<TRow>
                  }) =>
                    projectResponseRecord({ entity, record: input.existing }),
                }
              : {}),
          },
        }
      : {}),
  }
  return createFrameworkWriteHandler({
    adapterDeps: shared.deps,
    scope: options.scope,
    moduleKey: options.moduleKey,
    action: "delete",
    ...shared.writeCapabilityConfig,
    resolveResourceIdentity: ({ input }) => ({
      entity: options.moduleKey,
      id: input.id,
    }),
    recoverCommittedResponse: async (): Promise<{ success: true } | null> => ({
      success: true,
    }),
    validation: { params: shared.idParamsSchema },
    ...(options.rateLimit?.delete
      ? {
          rateLimit: {
            config: options.rateLimit.delete,
            consistency: options.rateLimit.delete.consistency,
            ...(options.rateLimit.delete.failureMode !== undefined
              ? { failureMode: options.rateLimit.delete.failureMode }
              : {}),
          },
        }
      : {}),
    getCacheAdapter: options.getCacheAdapter,
    ...(options.getRateLimitStore
      ? { getRateLimitStore: options.getRateLimitStore }
      : {}),
    runtimeCapabilities: shared.writeRuntimeCapabilities,
    ...(auditActive && options.auditSinkFactory
      ? { auditSinkFactory: options.auditSinkFactory }
      : {}),
    ...(options.outboxSinkFactory
      ? { outboxSinkFactory: options.outboxSinkFactory }
      : {}),
    createPersistence: options.createPersistence,
    definition,
    resolveExistingRecord: async ({ validated, session }) => {
      const id = (validated.validatedParams as { id: string }).id
      const existing = await loadExistingRecord(
        options,
        id,
        session,
        await resolveActionScopeForSession(options, session, "delete")
      )
      if (!existing) throw new NotFoundError(`${entity.name} not found`)
      return existing
    },
    resolveInput: async ({ request, validated, existing }) => {
      const versionField =
        options.optimisticConcurrency?.versionField ?? entity.versionField
      if (!versionField)
        return {
          id: (validated.validatedParams as { id: string }).id,
          existing: existing as TRow,
        }
      // If-Match is the ONLY concurrency transport for delete; a body version
      // field is never treated as the expected version.
      const expectedVersion = parseIfMatchVersion(
        request.headers.get("if-match")
      )
      if (
        expectedVersion !== undefined &&
        (!Number.isInteger(expectedVersion) || expectedVersion < 0)
      )
        throw new ConflictError("Version must be a non-negative integer")
      return {
        id: (validated.validatedParams as { id: string }).id,
        existing: existing as TRow,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      }
    },
    ...(shared.invalidateTags ? { invalidateTags: shared.invalidateTags } : {}),
    toResponse: () => frameworkJson({ message: "Deleted" }),
  })
}
