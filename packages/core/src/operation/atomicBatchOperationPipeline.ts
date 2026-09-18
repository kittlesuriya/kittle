import { runAfterHooks, runBeforeHooks } from "./hooks"
import { assertAuthorizationDecision } from "./authorization"
import { runAfterCommitHooks } from "./hooks"
import {
  createPostCommitOperationContext,
  type PostCommitOperationContext,
} from "./operationContext"
import { createReadOnlyPersistenceProvider } from "../ports"
import type { InternalOperationRunContext } from "./operationRunContext"
import type {
  AtomicBatchOperationDefinition,
  AtomicBatchPreparationContext,
} from "./operationDefinition"
import {
  assertAuditRecordValue,
  assertAuditResourceId,
  buildAuditRecord,
  classifyAuditValue,
  defaultAuditSanitizer,
  requireCapability,
  type AtomicBatchItem,
  type AtomicBatchItemResult,
  type AtomicBatchPlan,
  type TenantScopedAtomicBatchPlan,
  type TenantScopedAtomicBatchProvider,
} from "../ports"
import {
  supportsAtomicBatch,
  supportsTenantScopedAtomicBatch,
} from "../ports/persistence"
import {
  AuditActorMissingError,
  ConfigurationError,
  ForbiddenError,
} from "../foundation/errors"

export interface CommittedEffectErrorContext {
  operationId?: string
  correlationId?: string
  result?: unknown
}

export class OperationCommittedEffectError extends Error {
  readonly committed = true
  readonly failures: readonly unknown[]
  readonly operationId?: string
  readonly correlationId?: string
  readonly result?: unknown
  override readonly cause: unknown

  constructor(
    message: string,
    cause: unknown,
    failures: readonly unknown[] = [cause],
    context: CommittedEffectErrorContext = {}
  ) {
    super(message, { cause })
    this.name = "OperationCommittedEffectError"
    this.cause = cause
    this.failures = failures
    if (context.operationId !== undefined)
      this.operationId = context.operationId
    if (context.correlationId !== undefined)
      this.correlationId = context.correlationId
    if (context.result !== undefined) this.result = context.result
  }
}

export async function runAtomicBatchOperation<TInput, TResult, TCommand>(args: {
  operation: InternalOperationRunContext
  definition: AtomicBatchOperationDefinition<TInput, TResult, TCommand>
  input: TInput
  onBusinessResult?: (
    result: TResult,
    operation: PostCommitOperationContext
  ) => Promise<void>
}): Promise<TResult> {
  const provider = args.operation.persistence
  for (const capability of args.definition.requiredRuntimeCapabilities ?? [])
    requireCapability(args.operation.runtimeCapabilities, capability)
  if (!supportsAtomicBatch(provider))
    throw new ConfigurationError(
      `Operation ${args.definition.key} requires atomic-batch persistence support.`
    )
  const tenantScoped = supportsTenantScopedAtomicBatch(provider)
  if (
    provider.capabilities.atomicBatchScope === "tenant-scoped" &&
    !tenantScoped
  ) {
    throw new ConfigurationError(
      `Operation ${args.definition.key} requires a complete tenant-scoped persistence capability.`
    )
  }
  if (tenantScoped) {
    if (operationTenantId(args.operation) !== provider.tenantId) {
      throw new ConfigurationError(
        `Operation ${args.definition.key} tenant does not match the persistence provider.`
      )
    }
  }
  // Atomic fallback has no transaction around lifecycle hooks. Keep hooks
  // pure with respect to ordinary persistence; commands and outbox records
  // are still collected and committed by executeAtomicBatch below.
  const operation = args.operation.withPersistence(
    createReadOnlyPersistenceProvider(
      provider
    ) as import("../ports").PersistenceProvider
  )
  let postCommitOperation: InternalOperationRunContext | undefined
  try {
    const input = await runBeforeHooks({
      operation,
      input: args.input,
      ...(args.definition.before !== undefined
        ? { hooks: args.definition.before }
        : {}),
    })
    if (
      args.definition.kind === "mutation" &&
      (!args.definition.authorization ||
        typeof args.definition.authorization.authorize !== "function")
    ) {
      throw new ConfigurationError(
        `Atomic-batch mutation ${args.definition.key} requires authorization.`
      )
    }
    const decision = await args.definition.authorization?.authorize({
      operation,
      input,
    })
    if (decision === undefined) {
      throw new ConfigurationError(
        `Atomic-batch mutation ${args.definition.key} requires authorization.`
      )
    }
    assertAuthorizationDecision(decision, args.definition.key)
    if (!decision.allowed) {
      throw new ForbiddenError(
        decision.reason ??
          `Operation is not allowed: ${args.definition.key}. Operation ${args.definition.key} is not allowed.`
      )
    }
    if (
      args.definition.audit &&
      args.definition.audit.required !== false &&
      !operation.request?.actor
    )
      throw new AuditActorMissingError(
        `Audit actor missing for operation: ${args.definition.audit.action}`
      )
    const commands: TCommand[] = []
    const preparationOperation: AtomicBatchPreparationContext<TCommand> = {
      operationId: operation.operationId,
      ...(operation.correlationId !== undefined
        ? { correlationId: operation.correlationId }
        : {}),
      ...(operation.request !== undefined
        ? { request: operation.request }
        : {}),
      services: operation.services,
      addCommand: (command) => {
        commands.push(command)
      },
      addOutboxRecord: (record) => operation.addOutboxRecord(record),
      addDurableEffect: (entry) => operation.addDurableEffect(entry),
      addBestEffortEffect: (name, execute) =>
        operation.addBestEffortEffect(name, execute),
    }
    const prepared = await args.definition.prepare({
      operation: preparationOperation,
      input,
    })
    assertPreparedBatch(args.definition.key, prepared)
    commands.push(...prepared.commands)
    if (operation.transactionalEffects.length) {
      throw new ConfigurationError(
        `Atomic operation ${args.definition.key} cannot register transactional effects.`
      )
    }
    const items: AtomicBatchItem<TCommand>[] = commands.map((command) => ({
      kind: "command",
      command,
    }))
    // The atomic audit must be derivable from deterministic pre-commit command
    // state. A post-state row cannot exist until after the batch commits.
    if (args.definition.audit) {
      const audit = args.definition.audit
      const actor = operation.request?.actor
      if (actor) {
        const sanitize = (value: unknown) =>
          (operation.auditSanitizer ?? defaultAuditSanitizer)(
            classifyAuditValue(value, audit.fieldClassification)
          )
        const resourceId = audit.resolveResourceId({
          input,
          result: prepared.result,
        })
        assertAuditResourceId(resourceId, args.definition.key)
        const rawOldValue = audit.extractOldValue
          ? sanitize(audit.extractOldValue({ input }) ?? {})
          : null
        assertAuditRecordValue(
          rawOldValue,
          `Audit oldValue for operation ${args.definition.key}`
        )
        const rawNewValue = audit.extractNewValue
          ? sanitize(
              audit.extractNewValue({ input, result: prepared.result }) ?? {}
            )
          : null
        assertAuditRecordValue(
          rawNewValue,
          `Audit newValue for operation ${args.definition.key}`
        )
        const record = buildAuditRecord({
          id: operation.services.idGenerator(),
          occurredAt: operation.services.clock(),
          actor,
          action: audit.action,
          resourceType: audit.resourceType,
          resourceId,
          tenantId: operation.request?.tenantId ?? null,
          oldValue: rawOldValue,
          newValue: rawNewValue,
        })
        items.push({ kind: "audit", record })
      }
    }
    items.push(
      ...operation.outboxRecords.map((record): AtomicBatchItem<TCommand> => ({
        kind: "outbox",
        record: {
          ...record,
          id: record.id || operation.services.idGenerator(),
          occurredAt: record.occurredAt ?? operation.services.clock(),
        },
      }))
    )
    // Close the pre-commit effect collector before the irreversible commit. Any
    // transactional/outbox registration after this point is a hard error rather
    // than silently discarded work.
    const pendingEffects = operation.takePreCommitEffects()
    // Durable commit obligations assert exclusive ownership immediately before
    // the atomic batch executes. A lost fence aborts before anything commits,
    // and self-contained markers join the batch so they are atomic with it.
    for (const marker of operation.commitMarkers) {
      await marker.fence?.(operation.persistence)
      const batchItem = await marker.batchItem?.(prepared.result)
      if (batchItem === undefined) continue
      if (!isAtomicBatchItem(batchItem)) {
        throw new ConfigurationError(
          `Operation ${args.definition.key} commit marker produced a malformed atomic batch item.`
        )
      }
      items.push(batchItem as AtomicBatchItem<TCommand>)
    }
    const plan: AtomicBatchPlan<TCommand> = { items }
    const itemResults = tenantScoped
      ? await (
          provider as TenantScopedAtomicBatchProvider<TCommand>
        ).executeAtomicBatch({
          ...plan,
        } satisfies TenantScopedAtomicBatchPlan<TCommand>)
      : await provider.executeAtomicBatch(plan)
    let commandResults: unknown[]
    try {
      commandResults = validateBatchResults(
        args.definition.key,
        items,
        itemResults
      )
    } catch (error) {
      throw new OperationCommittedEffectError(
        `Operation ${args.definition.key} committed, but the persistence provider returned incomplete or malformed batch results.`,
        error,
        [error],
        {
          operationId: operation.operationId,
          ...(operation.correlationId !== undefined
            ? { correlationId: operation.correlationId }
            : {}),
        }
      )
    }
    try {
      await prepared.verify?.({ result: prepared.result, commandResults })
    } catch (error) {
      throw new OperationCommittedEffectError(
        `Operation ${args.definition.key} committed, but result verification failed.`,
        error,
        [error],
        {
          operationId: operation.operationId,
          ...(operation.correlationId !== undefined
            ? { correlationId: operation.correlationId }
            : {}),
        }
      )
    }
    // The generic after hooks are representation/enrichment and must only run
    // after the batch has committed so they can observe committed state.
    let finalResult: TResult
    try {
      finalResult = await runAfterHooks({
        operation,
        input,
        result: prepared.result,
        ...(args.definition.after !== undefined
          ? { hooks: args.definition.after }
          : {}),
      })
    } catch (error) {
      throw new OperationCommittedEffectError(
        `Operation ${args.definition.key} committed, but a post-commit hook failed.`,
        error,
        [error],
        {
          operationId: operation.operationId,
          ...(operation.correlationId !== undefined
            ? { correlationId: operation.correlationId }
            : {}),
          result: prepared.result,
        }
      )
    }
    // The atomic provider has committed the command, audit, and outbox items.
    const restrictedOperation = operation.withPersistence(
      operation.persistence,
      {
        effectPolicy: {
          allowTransactionalEffects: false,
          allowOutboxRecords: false,
        },
      }
    )
    postCommitOperation = restrictedOperation
    const postCommitContext =
      createPostCommitOperationContext(restrictedOperation)
    const failures: unknown[] = []
    try {
      await args.onBusinessResult?.(finalResult, postCommitContext)
    } catch (error) {
      failures.push(error)
      reportEffectFailure(
        operation,
        "onBusinessResult",
        "business-result",
        error
      )
    }
    for (const effect of pendingEffects.bestEffortEffects)
      restrictedOperation.addBestEffortEffect(effect.name, effect.execute)
    for (const hook of asArray(args.definition.afterCommit)) {
      try {
        await runAfterCommitHooks({
          operation: postCommitContext,
          input,
          result: finalResult,
          hooks: hook,
        })
      } catch (error) {
        failures.push(error)
        reportEffectFailure(restrictedOperation, "afterCommit", "hooks", error)
      }
    }
    await runPendingEffects(restrictedOperation, postCommitContext)
    if (failures.length > 0) {
      throw new OperationCommittedEffectError(
        `Operation ${args.definition.key} committed, but a post-commit effect failed.`,
        failures[0],
        failures,
        {
          operationId: operation.operationId,
          ...(operation.correlationId !== undefined
            ? { correlationId: operation.correlationId }
            : {}),
          result: finalResult,
        }
      )
    }
    return finalResult
  } finally {
    postCommitOperation?.dispose()
    operation.dispose()
  }
}

function operationTenantId(
  operation: InternalOperationRunContext
): string | undefined {
  return operation.request?.tenantId ?? undefined
}

function assertPreparedBatch<TCommand, TResult>(
  key: string,
  prepared: unknown
): asserts prepared is {
  commands: readonly TCommand[]
  result: TResult
  verify?: (args: {
    result: TResult
    commandResults: readonly unknown[]
  }) => unknown
} {
  if (typeof prepared !== "object" || prepared === null) {
    throw new ConfigurationError(
      `Atomic operation ${key} prepare must return a prepared batch.`
    )
  }
  const candidate = prepared as {
    commands?: unknown
    result?: unknown
    verify?: unknown
  }
  if (
    !Array.isArray(candidate.commands) ||
    !Object.prototype.hasOwnProperty.call(candidate, "result")
  ) {
    throw new ConfigurationError(
      `Atomic operation ${key} prepare must return commands and a result.`
    )
  }
  if (
    candidate.verify !== undefined &&
    typeof candidate.verify !== "function"
  ) {
    throw new ConfigurationError(
      `Atomic operation ${key} prepare.verify must be a function when provided.`
    )
  }
}

function validateBatchResults(
  key: string,
  items: readonly AtomicBatchItem[],
  results: unknown
): unknown[] {
  if (!Array.isArray(results) || results.length !== items.length) {
    throw new ConfigurationError(
      `Expected ${items.length} results for ${items.length} atomic batch items.`
    )
  }
  const commandResults: unknown[] = []
  for (const [index, item] of items.entries()) {
    const result: unknown = results[index]
    if (!isAtomicBatchItemResult(result) || result.kind !== item.kind) {
      throw new ConfigurationError(
        `Atomic batch result at index ${index} does not match the submitted ${item.kind} item.`
      )
    }
    if (item.kind === "command") commandResults.push(result.result)
  }
  return commandResults
}

function isAtomicBatchItem(value: unknown): value is AtomicBatchItem {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as {
    kind?: unknown
    command?: unknown
    record?: unknown
    commit?: unknown
  }
  switch (candidate.kind) {
    case "command":
      return Object.prototype.hasOwnProperty.call(value, "command")
    case "audit":
    case "outbox":
      return Object.prototype.hasOwnProperty.call(value, "record")
    case "idempotency":
      return Object.prototype.hasOwnProperty.call(value, "commit")
    default:
      return false
  }
}

function isAtomicBatchItemResult(
  value: unknown
): value is AtomicBatchItemResult {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { kind?: unknown }
  return (
    (candidate.kind === "command" ||
      candidate.kind === "audit" ||
      candidate.kind === "outbox" ||
      candidate.kind === "idempotency") &&
    Object.prototype.hasOwnProperty.call(value, "result")
  )
}

async function runEffects(
  operation: InternalOperationRunContext,
  postCommitContext: PostCommitOperationContext,
  effects: {
    name: string
    execute: (operation?: PostCommitOperationContext) => Promise<void>
  }[],
  phase: string
): Promise<unknown[]> {
  const failures: unknown[] = []
  for (const effect of effects) {
    try {
      await effect.execute(postCommitContext)
    } catch (error) {
      failures.push(error)
      reportEffectFailure(operation, phase, effect.name, error)
    }
  }
  return failures
}

async function runPendingEffects(
  operation: InternalOperationRunContext,
  postCommitContext: PostCommitOperationContext
): Promise<void> {
  while (operation.bestEffortEffects.length) {
    const drained = operation.takeDeferredEffects()
    await runEffects(
      operation,
      postCommitContext,
      drained.bestEffortEffects,
      "bestEffort"
    )
  }
}

function reportEffectFailure(
  operation: InternalOperationRunContext,
  phase: string,
  effectName: string,
  error: unknown
): void {
  try {
    operation.effectFailureReporter?.({
      operationId: operation.operationId,
      ...(operation.correlationId !== undefined
        ? { correlationId: operation.correlationId }
        : {}),
      phase,
      effectName,
      error,
    })
  } catch {
    // A throwing reporter must never mask the real post-commit failure;
    // metadata bookkeeping below still runs.
  }
  const metadata = operation.request?.metadata
  if (!metadata) return
  const failures =
    (metadata._effectFailures as Array<Record<string, unknown>> | undefined) ??
    []
  failures.push({ phase, effectName, error: String(error) })
  metadata._effectFailures = failures
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}
