import { describe, expect, expectTypeOf, it } from "vitest"
import * as operationApi from ".."
import type {
  AtomicBatchAtomicity,
  AtomicBatchPreparationContext,
  OperationAtomicity,
  OperationContext,
  OperationDefinition,
  OperationEnvironment,
  PostCommitOperationContext,
  PreparedAtomicBatch,
  StandardAtomicityMode,
  StandardOperationDefinition,
  TransactionRetryPolicy,
} from ".."

// OperationRunContext is an implementation detail and must not be part of the public barrel.
// @ts-expect-error OperationRunContext is intentionally not publicly exported.
import type { OperationRunContext as _OperationRunContext } from ".."

// Effect collectors are implementation details and must not be part of the public barrel.
// @ts-expect-error OperationEffectCollector is intentionally not publicly exported.
import type { OperationEffectCollector as _OperationEffectCollector } from ".."

describe("operation public API", () => {
  it("preserves the public operation environment contracts", () => {
    expectTypeOf<OperationEnvironment>().not.toEqualTypeOf<OperationContext>()
    expectTypeOf<PostCommitOperationContext>().toHaveProperty("services")
    expectTypeOf<PostCommitOperationContext>().toHaveProperty(
      "addBestEffortEffect"
    )
    expectTypeOf<PostCommitOperationContext>().toHaveProperty("metadata")
    expectTypeOf<PostCommitOperationContext>().not.toHaveProperty("persistence")
    expectTypeOf<PostCommitOperationContext>().not.toHaveProperty(
      "addPostCommitEffect"
    )
    expectTypeOf<PostCommitOperationContext>().not.toHaveProperty(
      "addTransactionalEffect"
    )
    expectTypeOf<PostCommitOperationContext>().not.toHaveProperty(
      "addOutboxRecord"
    )
  })

  it("exposes the operation definition contracts", () => {
    expectTypeOf<OperationAtomicity>().toEqualTypeOf<
      | {
          kind: "standard"
          mode: StandardAtomicityMode
          transactionOptions?: import("../../ports").TransactionOptions
          transactionRetry?: TransactionRetryPolicy
        }
      | AtomicBatchAtomicity
    >()
    expectTypeOf<
      StandardOperationDefinition<{ input: string }, string>
    >().toMatchTypeOf<OperationDefinition<{ input: string }, string>>()
    expectTypeOf<PreparedAtomicBatch<string, number>>().toHaveProperty(
      "commands"
    )
    expectTypeOf<AtomicBatchPreparationContext>().toHaveProperty("addCommand")
  })

  it("exports only the operation entry points at runtime", () => {
    expect(Object.keys(operationApi).sort()).toEqual([
      "OperationCommittedEffectError",
      "createOperation",
      "createOperationContext",
      "runOperation",
      "runOperationDetailed",
    ])
  })
})
