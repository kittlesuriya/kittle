import type { OperationContext } from "./operationContext"
import type { AfterCommitHook, OperationHooks } from "./hooks"
import type { RuntimeCapability } from "../ports"
import type { TransactionOptions } from "../ports"
import type { AuditFieldClassifications } from "../ports"

export type MaybePromise<T> = T | Promise<T>

export type StandardAtomicityMode = "none" | "preferred" | "required"

export type OperationKind = "read" | "mutation"

/**
 * Bounded retries for failures raised before an interactive transaction commits.
 * The operation callback, including its hooks and transactional effects, is
 * rerun from the beginning for each attempt. Best-effort effects are never
 * part of a retry attempt.
 */
export interface TransactionRetryPolicy {
  /** Explicitly acknowledges that rerunning the operation is safe. */
  retrySafe: true
  /** Total transaction attempts, including the initial attempt. */
  maxAttempts: number
  /** Delay before the second attempt. */
  delayMs: number
  /** Exponential delay multiplier for subsequent attempts. */
  backoffMultiplier: number
  /** Upper bound for any delay between attempts. */
  maxDelayMs: number
}

export interface StandardAtomicity {
  kind: "standard"
  mode: StandardAtomicityMode
  transactionOptions?: TransactionOptions
  transactionRetry?: TransactionRetryPolicy
}

export interface AtomicBatchAtomicity {
  kind: "atomic-batch"
}

export type OperationAtomicity = StandardAtomicity | AtomicBatchAtomicity

export interface AuthorizationDecision {
  allowed: boolean
  reason?: string
}

export interface OperationAuthorizationPort<TInput = unknown> {
  authorize(args: {
    operation: OperationContext
    input: TInput
  }): Promise<AuthorizationDecision>
}

/** The delivery guarantee requested for an operation audit record. */
export type AuditGuarantee = "atomic" | "durable" | "best-effort"

export interface OperationAuditConfig<TInput, TResult> {
  action: string
  resourceType: string
  required?: boolean
  auditGuarantee?: AuditGuarantee
  fallbackAuditGuarantee?: "best-effort"
  resolveResourceId: (args: { input: TInput; result: TResult }) => string
  extractOldValue?: (args: { input: TInput }) => Record<string, unknown> | null
  extractNewValue?: (args: {
    input: TInput
    result: TResult
  }) => Record<string, unknown> | null
  fieldClassification?: AuditFieldClassifications
}

export interface BaseOperationDefinition<
  TInput,
  TResult,
> extends OperationHooks<TInput, TResult> {
  key: string
  kind: OperationKind
  atomicity?: OperationAtomicity
  authorization?: OperationAuthorizationPort<TInput>
  securitySensitive?: boolean
  requiredRuntimeCapabilities?: readonly RuntimeCapability[]
  audit?: OperationAuditConfig<TInput, TResult>
  outbox?: { required: boolean }
}

export interface StandardReadOperationDefinition<
  TInput,
  TResult,
> extends BaseOperationDefinition<TInput, TResult> {
  kind: "read"
  atomicity?: StandardAtomicity
  execute: (args: {
    operation: OperationContext
    input: TInput
  }) => MaybePromise<TResult>
}

export interface StandardMutationOperationDefinition<
  TInput,
  TResult,
> extends BaseOperationDefinition<TInput, TResult> {
  kind: "mutation"
  atomicity: StandardAtomicity & { mode: "required" }
  authorization: OperationAuthorizationPort<TInput>
  execute: (args: {
    operation: OperationContext
    input: TInput
  }) => MaybePromise<TResult>
  /** Optional adapter-native fallback when interactive transactions are unavailable. */
  atomicBatch?: {
    prepare: (args: {
      operation: AtomicBatchPreparationContext<unknown>
      input: TInput
    }) => MaybePromise<PreparedAtomicBatch<unknown, TResult>>
  }
}

export type StandardOperationDefinition<TInput, TResult> =
  | StandardReadOperationDefinition<TInput, TResult>
  | StandardMutationOperationDefinition<TInput, TResult>

export interface PreparedAtomicBatch<TCommand, TResult> {
  commands: readonly TCommand[]
  /** The domain result represented by the prepared commands. */
  result: TResult
  /** Verifies raw command results after the provider has committed the batch. */
  verify?: (args: {
    result: TResult
    commandResults: readonly unknown[]
  }) => MaybePromise<void>
}

export type AtomicBatchPreparation<TCommand, TResult> = PreparedAtomicBatch<
  TCommand,
  TResult
>

export interface AtomicBatchPreparationContext<TCommand = unknown> {
  readonly operationId: string
  readonly correlationId?: string
  readonly request?: OperationContext["request"]
  readonly services: OperationContext["services"]
  addCommand(command: TCommand): void
  addOutboxRecord: OperationContext["addOutboxRecord"]
  addDurableEffect: OperationContext["addDurableEffect"]
  addBestEffortEffect: OperationContext["addBestEffortEffect"]
}

export interface AtomicBatchOperationDefinition<
  TInput,
  TResult,
  TCommand = unknown,
> extends Omit<
  BaseOperationDefinition<TInput, TResult>,
  "afterCommit" | "kind" | "authorization"
> {
  kind: "mutation"
  authorization: OperationAuthorizationPort<TInput>
  atomicity: AtomicBatchAtomicity
  afterCommit?:
    AfterCommitHook<TInput, TResult> | AfterCommitHook<TInput, TResult>[]
  prepare: (args: {
    operation: AtomicBatchPreparationContext<TCommand>
    input: TInput
  }) => MaybePromise<PreparedAtomicBatch<TCommand, TResult>>
}

export type OperationDefinition<TInput, TResult, TCommand = unknown> =
  | StandardOperationDefinition<TInput, TResult>
  | AtomicBatchOperationDefinition<TInput, TResult, TCommand>
