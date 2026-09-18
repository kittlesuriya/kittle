import { policyConditionsToPredicate } from "./abacConditionCompiler"
import { validatePayloadAgainstCatalog } from "./abacPolicySchema"
import type { AbacPolicyEffect } from "./abacPolicySchema"
import type {
  AbacPolicy,
  NormalizedAbacPolicy,
  AbacContext,
  AbacScopeType,
} from "./abacTypes"
import type { AbacFieldDefinition, AbacModuleCatalog } from "./abacCatalog"
import type { PredicateNode } from "./predicate"
import { deepFreeze } from "./abacBundleIntegrity"
import { ConfigurationError } from "../foundation/errors"
import {
  findNonPortablePredicate,
  findUnsupportedPredicateCombination,
} from "./predicate"

export type NormalizePolicyResult =
  | {
      success: true
      policy: NormalizedAbacPolicy
      /** Set when the policy is valid but currently outside its active window. */
      excluded?: "inactive"
    }
  | {
      success: false
      errors: NormalizationError[]
    }

export interface NormalizationError {
  code: string
  message: string
  path?: string
  policyId?: string
}

const POLICY_SCOPE_TYPES: readonly string[] = [
  "tenant_default",
  "platform_default",
  "role",
  "branch",
  "department",
  "user",
]

function describePolicyValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined"
  } catch {
    return "[unserializable]"
  }
}

/**
 * Fail-fast contract checks for provider-supplied policy headers. Every
 * decision path funnels into resolveTieredDecision, where a matched policy
 * whose effect is not "deny" falls through to ALLOW — so an unknown effect
 * would grant access, and unknown scope types or non-integer priorities
 * would corrupt tiering. The helpers throw ConfigurationError and
 * normalizeAbacPolicy converts them to NormalizationError failures so the
 * factory keeps surfacing per-policy InvalidPolicyConfigurationError.
 */
export function assertPolicyEffect(
  effect: unknown,
  policyId?: string
): asserts effect is AbacPolicyEffect {
  if (effect !== "allow" && effect !== "deny") {
    throw new ConfigurationError(
      `Policy effect must be "allow" or "deny", got ${describePolicyValue(effect)}`,
      { code: "POLICY_EFFECT_INVALID", policyId }
    )
  }
}

export function assertPolicyPriority(
  priority: unknown,
  policyId?: string
): asserts priority is number {
  if (typeof priority !== "number" || !Number.isSafeInteger(priority)) {
    throw new ConfigurationError(
      `Policy priority must be a safe integer, got ${describePolicyValue(priority)}`,
      { code: "POLICY_PRIORITY_INVALID", policyId }
    )
  }
}

export function assertPolicyScopeType(
  scopeType: unknown,
  policyId?: string
): asserts scopeType is AbacScopeType {
  if (typeof scopeType !== "string" || !POLICY_SCOPE_TYPES.includes(scopeType)) {
    throw new ConfigurationError(
      `Policy scopeType must be one of ${POLICY_SCOPE_TYPES.join(", ")}, got ${describePolicyValue(scopeType)}`,
      { code: "POLICY_SCOPE_INVALID", policyId }
    )
  }
}

function toNormalizationError(
  error: unknown,
  policyId?: string
): NormalizationError {
  if (error instanceof ConfigurationError) {
    const details =
      error.details && typeof error.details === "object"
        ? (error.details as { code?: unknown })
        : undefined
    const code =
      typeof details?.code === "string" ? details.code : "POLICY_HEADER_INVALID"
    return { code, message: error.message, ...(policyId !== undefined ? { policyId } : {}) }
  }
  throw error
}

function asDate(value: Date | string | null | undefined): Date | undefined {
  if (value == null) return undefined
  return typeof value === "string" ? new Date(value) : value
}

function isActive(source: AbacPolicy["source"], at: Date): boolean {
  const startsAt = asDate(source.startsAt)
  const endsAt = asDate(source.endsAt)
  if (startsAt && at < startsAt) return false
  if (endsAt && at > endsAt) return false
  return true
}

function validWindow(source: AbacPolicy["source"]): boolean {
  const startsAt = asDate(source.startsAt)
  const endsAt = asDate(source.endsAt)
  if (startsAt && Number.isNaN(startsAt.getTime())) return false
  if (endsAt && Number.isNaN(endsAt.getTime())) return false
  return !(startsAt && endsAt && startsAt > endsAt)
}

/**
 * String substring matching (collation/case/Unicode drift) and date scalar
 * ordering (evaluator-vs-DB date drift) are not portable across all persistence
 * engines. Reject them from security policies until every engine is proven
 * identical. Numeric gt/lt/gte/lte are portable, so date drift is rejected only
 * when the target field is a date/datetime type.
 */
function findNonPortableSecurityPredicate(
  node: PredicateNode,
  fields: Record<string, AbacFieldDefinition>
): { op: string; field: string } | undefined {
  if (node.kind === "condition") {
    if (
      node.op === "contains" ||
      node.op === "startsWith" ||
      node.op === "endsWith"
    ) {
      return { op: node.op, field: node.field }
    }
    const fieldType = Object.hasOwn(fields, node.field)
      ? fields[node.field]?.type
      : undefined
    const isDateField = fieldType === "date" || fieldType === "datetime"
    if (
      isDateField &&
      (node.op === "gt" ||
        node.op === "lt" ||
        node.op === "gte" ||
        node.op === "lte" ||
        node.op === "between")
    ) {
      return { op: node.op, field: node.field }
    }
    return undefined
  }
  if (node.kind === "not")
    return findNonPortableSecurityPredicate(node.filter, fields)
  if (node.kind === "and" || node.kind === "or") {
    for (const filter of node.filters) {
      const found = findNonPortableSecurityPredicate(filter, fields)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Date internal slots stay mutable under Object.freeze, so any Date that
 * survives into a normalized policy could be mutated by a caller. Replace every
 * Date instance with its canonical ISO string primitive so deepFreeze produces
 * a truly immutable durable payload.
 */
function canonicalizeDurable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalizeDurable)
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      record[key] = canonicalizeDurable(entry)
    }
    return record
  }
  return value
}

export function normalizeAbacPolicy(args: {
  policy: AbacPolicy
  catalog: AbacModuleCatalog
  context: AbacContext
  at?: Date
}): NormalizePolicyResult {
  const errors: NormalizationError[] = []
  const at = args.at ?? new Date()
  const policyId = args.policy.source.policyId

  // Fail-fast header checks run before compilation: resolveTieredDecision
  // treats any matched non-"deny" effect as ALLOW, so an unknown effect
  // would grant access instead of failing closed. The errors gate below
  // returns before compilation whenever any check fails.
  const headerChecks: Array<() => void> = [
    () => assertPolicyEffect(args.policy.effect, policyId),
    () => assertPolicyPriority(args.policy.priority, policyId),
    () => assertPolicyScopeType(args.policy.source.scopeType, policyId),
  ]
  for (const check of headerChecks) {
    try {
      check()
    } catch (error) {
      errors.push(toNormalizationError(error, policyId))
    }
  }

  const windowValid = validWindow(args.policy.source)
  if (!windowValid) {
    errors.push({
      code: "POLICY_WINDOW_INVALID",
      message: "Policy active window is invalid",
      policyId: args.policy.source.policyId,
    })
  }
  const inactive = !isActive(args.policy.source, at)

  if (args.policy.moduleKey !== args.catalog.moduleKey) {
    errors.push({
      code: "MODULE_KEY_MISMATCH",
      message: `Policy moduleKey "${args.policy.moduleKey}" does not match catalog moduleKey "${args.catalog.moduleKey}"`,
      policyId: args.policy.source.policyId,
    })
  }

  const catalogErrors = validatePayloadAgainstCatalog(
    args.policy.payload,
    args.catalog
  )
  if (catalogErrors.length > 0) {
    return {
      success: false,
      errors: catalogErrors.map((e) => ({
        code: "CATALOG_VALIDATION_FAILED",
        message: e.message,
        path: e.path,
        policyId: args.policy.source.policyId,
      })),
    }
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  const compileResult = policyConditionsToPredicate({
    conditions: args.policy.payload.conditions,
    context: args.context,
    fieldCatalog: args.catalog.fields,
  })

  if (!compileResult.success) {
    return {
      success: false,
      errors: [
        {
          code: "CONDITION_COMPILATION_FAILED",
          message: compileResult.error,
          policyId: args.policy.source.policyId,
        },
      ],
    }
  }

  const nonPortable = findNonPortablePredicate(compileResult.predicate)
  if (nonPortable) {
    return {
      success: false,
      errors: [
        {
          code: "NON_PORTABLE_PREDICATE",
          message: `Predicate operator "${nonPortable.op}" is not supported consistently by all persistence adapters`,
          policyId: args.policy.source.policyId,
        },
      ],
    }
  }

  const securityViolation = findNonPortableSecurityPredicate(
    compileResult.predicate,
    args.catalog.fields
  )
  if (securityViolation) {
    return {
      success: false,
      errors: [
        {
          code: "NON_PORTABLE_PREDICATE",
          message: `Predicate operator "${securityViolation.op}" on field "${securityViolation.field}" is not supported consistently by all persistence adapters`,
          policyId: args.policy.source.policyId,
        },
      ],
    }
  }

  const unsupported = findUnsupportedPredicateCombination(
    compileResult.predicate,
    args.catalog.fields
  )
  if (unsupported) {
    return {
      success: false,
      errors: [
        {
          code: "UNSUPPORTED_PREDICATE_COMBINATION",
          message: unsupported.message,
          path: `conditions.${unsupported.condition.field}`,
          policyId: args.policy.source.policyId,
        },
      ],
    }
  }

  const normalized = deepFreeze(
    structuredClone(
      canonicalizeDurable({
        ...args.policy,
        compiledConditions: compileResult.predicate,
      })
    )
  ) as NormalizedAbacPolicy

  if (inactive) {
    return { success: true, policy: normalized, excluded: "inactive" }
  }

  return { success: true, policy: normalized }
}
