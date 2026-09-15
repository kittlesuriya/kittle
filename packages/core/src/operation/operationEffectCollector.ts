import type {
  AtomicBatchItem,
  OutboxRecord,
  PersistenceProvider,
} from "../ports"
import type {
  PostCommitOperationContext,
  OperationContext,
} from "./operationContext"
import {
  ConfigurationError,
  EffectCollectorDisposedError,
  EffectCollectorDrainedError,
} from "../foundation/errors"

export interface TransactionalEffectEntry {
  name: string
  execute: (operation?: OperationContext) => Promise<void>
}

/** A durable commit obligation that must participate in the business commit boundary. */
export interface CommitMarkerEntry {
  name: string
  /** Pre-batch ownership fence, run by non-transactional (atomic-batch) pipelines before commit. */
  fence?: (persistence: PersistenceProvider) => Promise<void>
  /** In-transaction commit hook, run by transactional pipelines immediately before commit. */
  commit?: (result: unknown, persistence: PersistenceProvider) => Promise<void>
  /** Self-contained atomic-batch item persisted atomically with business commands. */
  batchItem?: (
    result: unknown
  ) =>
    | AtomicBatchItem<unknown>
    | undefined
    | Promise<AtomicBatchItem<unknown> | undefined>
}

export interface BestEffortEffectEntry {
  name: string
  execute: (operation?: PostCommitOperationContext) => Promise<void>
}

export interface OperationEffectState {
  transactionalEffects: TransactionalEffectEntry[]
  outboxRecords: OutboxRecord[]
  bestEffortEffects: BestEffortEffectEntry[]
}

export interface OperationEffectStateWithCommitMarkers extends OperationEffectState {
  commitMarkers: CommitMarkerEntry[]
}

export interface OperationEffectPolicy {
  allowTransactionalEffects?: boolean
  allowOutboxRecords?: boolean
  allowDeferredEffects?: boolean
  /** Maximum number of deferred effects registered during one operation run. */
  maxDeferredEffects?: number
}

export type EffectCollectorState =
  "pre-commit" | "post-commit" | "deferred-taken" | "disposed"

export class OperationEffectCollector {
  static readonly defaultMaxDeferredEffects = 1000
  private readonly effectsState: OperationEffectStateWithCommitMarkers
  private deferredEffectCount: number
  private lifecycle: EffectCollectorState = "pre-commit"

  constructor(
    initial?: Partial<OperationEffectStateWithCommitMarkers>,
    private readonly policy: OperationEffectPolicy = {}
  ) {
    this.effectsState = {
      transactionalEffects: [...(initial?.transactionalEffects ?? [])],
      outboxRecords: [...(initial?.outboxRecords ?? [])],
      bestEffortEffects: [...(initial?.bestEffortEffects ?? [])],
      commitMarkers: [...(initial?.commitMarkers ?? [])],
    }
    this.deferredEffectCount = this.effectsState.bestEffortEffects.length
    if (this.deferredEffectCount > this.maxDeferredEffects) {
      throw new ConfigurationError(
        "Initial deferred effects exceed the configured budget."
      )
    }
  }

  get isDisposed(): boolean {
    return this.lifecycle === "disposed"
  }

  get lifecycleState(): EffectCollectorState {
    return this.lifecycle
  }

  get transactionalEffects(): TransactionalEffectEntry[] {
    return [...this.effectsState.transactionalEffects]
  }

  get outboxRecords(): OutboxRecord[] {
    return [...this.effectsState.outboxRecords]
  }

  get bestEffortEffects(): BestEffortEffectEntry[] {
    return [...this.effectsState.bestEffortEffects]
  }

  get commitMarkers(): CommitMarkerEntry[] {
    return [...this.effectsState.commitMarkers]
  }

  registerCommitMarker(entry: CommitMarkerEntry): void {
    this.assertPreCommit()
    this.register(() => this.effectsState.commitMarkers.push(entry))
  }

  addTransactionalEffect(
    name: string,
    execute: (
      operation?: import("./operationContext").OperationContext
    ) => Promise<void>,
    policy = this.policy
  ): void {
    if (policy.allowTransactionalEffects === false) {
      throw new ConfigurationError(
        "Transactional effects cannot be registered after commit."
      )
    }
    this.assertPreCommit()
    this.register(() =>
      this.effectsState.transactionalEffects.push({ name, execute })
    )
  }

  addOutboxRecord(record: OutboxRecord, policy = this.policy): void {
    if (policy.allowOutboxRecords === false) {
      throw new ConfigurationError(
        "Outbox records cannot be registered after commit."
      )
    }
    this.assertPreCommit()
    this.register(() => this.effectsState.outboxRecords.push(record))
  }

  addBestEffortEffect(
    name: string,
    execute: (operation?: PostCommitOperationContext) => Promise<void>
  ): void {
    if (this.policy.allowDeferredEffects === false) {
      throw new ConfigurationError(
        "Read-only operations cannot register deferred effects."
      )
    }
    this.registerDeferred(() =>
      this.effectsState.bestEffortEffects.push({ name, execute })
    )
  }

  takePreCommitEffects(): OperationEffectState {
    if (this.lifecycle !== "pre-commit") {
      throw new EffectCollectorDisposedError(
        "Pre-commit effects have already been taken."
      )
    }
    const drained: OperationEffectState = {
      transactionalEffects: this.effectsState.transactionalEffects.splice(0),
      outboxRecords: this.effectsState.outboxRecords.splice(0),
      bestEffortEffects: this.effectsState.bestEffortEffects.splice(0),
    }
    this.lifecycle = "post-commit"
    return drained
  }

  takeDeferredEffects(): OperationEffectState {
    if (this.lifecycle === "deferred-taken") {
      throw new EffectCollectorDrainedError(
        "Deferred effects have already been taken; register another effect before draining again."
      )
    }
    if (this.lifecycle !== "post-commit") {
      throw new EffectCollectorDisposedError(
        "Deferred effects can only be taken after the operation has committed."
      )
    }
    const drained = {
      transactionalEffects: [],
      outboxRecords: [],
      bestEffortEffects: this.effectsState.bestEffortEffects.splice(0),
    }
    this.lifecycle = "deferred-taken"
    return drained
  }

  dispose(): void {
    if (this.lifecycle === "disposed") return
    this.effectsState.transactionalEffects.length = 0
    this.effectsState.outboxRecords.length = 0
    this.effectsState.bestEffortEffects.length = 0
    this.lifecycle = "disposed"
  }

  private register(add: () => void): void {
    if (this.lifecycle === "disposed") {
      throw new EffectCollectorDisposedError(
        "Operation run has been disposed; late effect registration is not allowed."
      )
    }
    add()
  }

  private registerDeferred(add: () => void): void {
    if (this.lifecycle === "disposed") {
      throw new EffectCollectorDisposedError(
        "Operation run has been disposed; late effect registration is not allowed."
      )
    }
    if (this.deferredEffectCount >= this.maxDeferredEffects) {
      throw new ConfigurationError("Deferred effect budget exceeded.")
    }
    if (this.lifecycle === "deferred-taken") this.lifecycle = "post-commit"
    this.deferredEffectCount += 1
    add()
  }

  private get maxDeferredEffects(): number {
    const value =
      this.policy.maxDeferredEffects ??
      OperationEffectCollector.defaultMaxDeferredEffects
    if (!Number.isInteger(value) || value < 0) {
      throw new ConfigurationError(
        "Deferred effect budget must be a non-negative integer."
      )
    }
    return value
  }

  private assertPreCommit(): void {
    if (this.lifecycle !== "pre-commit") {
      throw new EffectCollectorDisposedError(
        "Transactional effects can only be registered before commit."
      )
    }
  }
}
