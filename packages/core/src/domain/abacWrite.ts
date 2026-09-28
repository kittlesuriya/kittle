import { evaluatePredicate } from "./evaluatePredicate"
import { ForbiddenError } from "../foundation/errors"
import { resolveTieredDecision } from "../foundation/abacTierDecision"
import { assertMatchedPolicyWritableFields } from "./fieldWriteInternals"
import { toEvidence } from "./abacDecision"
import type { NormalizedAbacPolicy, AbacPolicyBundle } from "./abacTypes"
import { assertVerifiedAbacBundle } from "./abacBundleIntegrity"

export interface WriteAccessEvaluation {
  allowed: boolean
  reasonCode: string
  message: string
  policyMeta?: { moduleKey: string; effect: "allow" | "deny"; priority: number }
  evidence: Array<{
    policyId?: string
    effect: "allow" | "deny"
    priority: number
    scopeType?: string
    scopeRefId?: string | null
  }>
}

function policyAppliesToAction(
  policy: NormalizedAbacPolicy,
  action: string
): boolean {
  return policy.payload.actions.includes(action)
}

function policyMatchesRecord(
  policy: NormalizedAbacPolicy,
  record: Record<string, unknown>
): boolean {
  return evaluatePredicate(record, policy.compiledConditions)
}

export function evaluateWriteAccessForRecordDetailed(args: {
  policies: NormalizedAbacPolicy[]
  moduleKey: string
  action: string
  record: Record<string, unknown>
}): WriteAccessEvaluation {
  const relevant = args.policies.filter(
    (policy) =>
      policy.moduleKey === args.moduleKey &&
      policyAppliesToAction(policy, args.action)
  )

  return evaluateRelevantWriteAccess(relevant, args.moduleKey, (policy) =>
    policyMatchesRecord(policy, args.record)
  )
}

function evaluateRelevantWriteAccess(
  relevant: NormalizedAbacPolicy[],
  moduleKey: string,
  matches: (policy: NormalizedAbacPolicy) => boolean
): WriteAccessEvaluation {
  const result = resolveTieredDecision({
    policies: relevant,
    getPriority: (p) => p.priority,
    getEffect: (p) => p.effect,
    matches,
    defaultEffect: "deny",
  })

  const evidence = relevant.map(toEvidence)

  switch (result.reason) {
    case "ALLOW_POLICY_MATCHED":
      return {
        allowed: true,
        reasonCode: "ALLOW_POLICY_MATCHED",
        message: "An allow policy matched this record.",
        policyMeta: {
          moduleKey,
          effect: result.decidingPolicies[0]?.effect ?? "allow",
          priority: result.decidingPolicies[0]?.priority ?? 0,
        },
        evidence,
      }
    case "DENY_POLICY_MATCHED":
      return {
        allowed: false,
        reasonCode: "DENY_POLICY_MATCHED",
        message:
          "You do not have permission to update this record with the current values.",
        policyMeta: {
          moduleKey,
          effect: "deny",
          priority: result.decidingPolicies[0]?.priority ?? 0,
        },
        evidence,
      }
    case "NO_RELEVANT_POLICY":
      return {
        allowed: false,
        reasonCode: "NO_RELEVANT_POLICY",
        message: "No matching policy restrictions found for this action.",
        evidence,
      }
    default:
      return {
        allowed: false,
        reasonCode: "NO_POLICY_MATCHED_RECORD",
        message:
          "You do not have permission to update this record with the current values.",
        evidence,
      }
  }
}

export function enforceAbacWrite(args: {
  bundle: AbacPolicyBundle
  action: string
  record: Record<string, unknown>
  changedFields?: string[]
}): void {
  assertVerifiedAbacBundle(args.bundle)
  let evaluation: WriteAccessEvaluation
  if (args.action !== "delete") {
    // Check-before-field-deny: assertPolicyWritableFields is independently
    // fail-closed on zero relevant policies, but through this path the
    // record-level NO_RELEVANT_POLICY / NO_POLICY_MATCHED_RECORD reason codes
    // stay dominant. Skipping the field throw when nothing is relevant lets
    // the record evaluation below produce the observable denial; the field
    // check still runs (and keeps its ABAC_FIELD_WRITE_DENIED precedence)
    // whenever at least one policy is relevant to this record.
    const relevant = args.bundle.policies.filter(
      (policy) =>
        policy.moduleKey === args.bundle.moduleKey &&
        policyAppliesToAction(policy, args.action)
    )
    const matched = relevant.filter((policy) =>
      policyMatchesRecord(policy, args.record)
    )
    if (matched.length > 0)
      assertMatchedPolicyWritableFields(
        matched,
        args.record,
        args.changedFields
      )
    const matchedSet = new Set(matched)
    evaluation = evaluateRelevantWriteAccess(
      relevant,
      args.bundle.moduleKey,
      (policy) => matchedSet.has(policy)
    )
  } else {
    evaluation = evaluateWriteAccessForRecordDetailed({
      policies: args.bundle.policies,
      moduleKey: args.bundle.moduleKey,
      action: args.action,
      record: args.record,
    })
  }

  if (evaluation.allowed) return

  throw new ForbiddenError(evaluation.message, {
    reasonCode: evaluation.reasonCode,
    moduleKey: args.bundle.moduleKey,
    action: args.action,
    policy: evaluation.policyMeta,
    evidence: evaluation.evidence,
  })
}
