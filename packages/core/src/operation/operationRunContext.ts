import type {
  NewOutboxRecord,
  OutboxRecord,
  PersistenceProvider,
  RuntimeCapability,
} from "../ports"
import type { CommitMarkerEntry } from "./operationEffectCollector"
import type { RequestContext } from "../foundation/requestContext"
import type { OperationServices } from "../foundation/operationServices"
import type { PostCommitOperationContext } from "./operationContext"
import type { OperationEffectCollector } from "./operationEffectCollector"

export interface OperationEnvironment {
  readonly persistence: PersistenceProvider
  readonly runtimeCapabilities: import("../ports").RuntimeCapabilities
  readonly request?: RequestContext
  readonly services: OperationServices
  readonly auditSink?: import("../ports").AuditSink
  readonly auditSanitizer?: (value: unknown) => unknown
  readonly enforceAbac?: import("../ports").AbacWriteEnforcer
  readonly auditSinkFactory?: import("../ports").AuditSinkFactory
  readonly outboxSinkFactory?: import("../ports").OutboxSinkFactory
  readonly commitMarkers?: readonly import("./operationEffectCollector").CommitMarkerEntry[]
  readonly effectFailureReporter?: (failure: {
    operationId?: string
    correlationId?: string
    phase: string
    effectName: string
    error: unknown
  }) => void
}

export interface OperationRunContext extends OperationEnvironment {
  readonly operationId: string
  readonly correlationId?: string
  requireRuntimeCapability(capability: RuntimeCapability): void
  addTransactionalEffect(
    name: string,
    execute: (operation?: OperationRunContext) => Promise<void>
  ): void
  addOutboxRecord(record: NewOutboxRecord): void
  /**
   * Registers a DURABLE post-commit obligation: the outbox record is committed
   * atomically with the mutation, so a correctness-critical effect survives a
   * crash and is processed by a durable consumer with its own idempotency.
   * Unlike best-effort effects, this work is never lost.
   */
  addDurableEffect(entry: { name: string; outbox: NewOutboxRecord }): void
  addBestEffortEffect(
    name: string,
    execute: (operation?: PostCommitOperationContext) => Promise<void>
  ): void
  addCommitMarker(marker: CommitMarkerEntry): void
  withPersistence(
    persistence: PersistenceProvider,
    options?: {
      effectPolicy?: import("./operationEffectCollector").OperationEffectPolicy
    }
  ): OperationRunContext
}

export interface InternalOperationRunContext extends OperationRunContext {
  readonly effects: OperationEffectCollector
  readonly isDisposed: boolean
  readonly transactionalEffects: import("./operationEffectCollector").TransactionalEffectEntry[]
  readonly outboxRecords: OutboxRecord[]
  readonly bestEffortEffects: import("./operationEffectCollector").BestEffortEffectEntry[]
  readonly commitMarkers: import("./operationEffectCollector").CommitMarkerEntry[]
  takePreCommitEffects(): ReturnType<
    OperationEffectCollector["takePreCommitEffects"]
  >
  takeDeferredEffects(): ReturnType<
    OperationEffectCollector["takeDeferredEffects"]
  >
  dispose(): void
  withPersistence(
    persistence: PersistenceProvider,
    options?: {
      effectPolicy?: import("./operationEffectCollector").OperationEffectPolicy
    }
  ): InternalOperationRunContext
}

export type SideEffectEntry = {
  name: string
  execute: (operation?: OperationRunContext) => Promise<void>
}
