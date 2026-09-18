/**
 * A persistence-neutral predicate AST shared by filtering, policy scope
 * compilation, and in-memory record evaluation.
 */

import { ConfigurationError } from "../foundation/errors"

export type PredicatePrimitive = string | number | boolean | null | Date

export interface PredicateRangeValue {
  from?: PredicatePrimitive
  to?: PredicatePrimitive
}

export type PredicateValue =
  PredicatePrimitive | PredicatePrimitive[] | PredicateRangeValue

export type PredicateOp =
  | "eq"
  | "neq"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "isNotEmpty"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "isTrue"
  | "isFalse"
  | "isNull"
  | "isNotNull"
  | "in"
  | "includesAny"
  | "includesAll"
  | "between"

export interface PredicateCondition {
  kind: "condition"
  field: string
  op: PredicateOp
  value?: PredicateValue
}

export interface PredicateGroup {
  kind: "and" | "or"
  filters: PredicateNode[]
}

export interface PredicateNegation {
  kind: "not"
  filter: PredicateNode
}

export interface PredicateLiteral {
  kind: "literal"
  value: boolean
}

export type PredicateNode =
  PredicateCondition | PredicateGroup | PredicateNegation | PredicateLiteral

function condition(
  field: string,
  op: PredicateOp,
  value?: PredicateValue
): PredicateCondition {
  return value === undefined
    ? { kind: "condition", field, op }
    : { kind: "condition", field, op, value }
}

export const Predicate = {
  alwaysTrue: (): PredicateGroup => ({ kind: "and", filters: [] }),
  alwaysFalse: (): PredicateGroup => ({ kind: "or", filters: [] }),

  eq: (field: string, value: PredicatePrimitive) =>
    condition(field, "eq", value),
  neq: (field: string, value: PredicatePrimitive) =>
    condition(field, "neq", value),

  gt: (field: string, value: PredicatePrimitive) =>
    condition(field, "gt", value),
  lt: (field: string, value: PredicatePrimitive) =>
    condition(field, "lt", value),
  gte: (field: string, value: PredicatePrimitive) =>
    condition(field, "gte", value),
  lte: (field: string, value: PredicatePrimitive) =>
    condition(field, "lte", value),

  contains: (field: string, value: string) =>
    condition(field, "contains", value),
  startsWith: (field: string, value: string) =>
    condition(field, "startsWith", value),
  endsWith: (field: string, value: string) =>
    condition(field, "endsWith", value),

  isEmpty: (field: string) => condition(field, "isEmpty"),
  isNotEmpty: (field: string) => condition(field, "isNotEmpty"),
  isTrue: (field: string) => condition(field, "isTrue"),
  isFalse: (field: string) => condition(field, "isFalse"),
  isNull: (field: string) => condition(field, "isNull"),
  isNotNull: (field: string) => condition(field, "isNotNull"),

  in: (field: string, values: PredicatePrimitive[]) =>
    condition(field, "in", values),
  includesAny: (field: string, values: PredicatePrimitive[]) =>
    condition(field, "includesAny", values),
  includesAll: (field: string, values: PredicatePrimitive[]) =>
    condition(field, "includesAll", values),

  between: (
    field: string,
    value: PredicateRangeValue | [PredicatePrimitive, PredicatePrimitive]
  ) => {
    if (Array.isArray(value)) {
      return condition(field, "between", { from: value[0], to: value[1] })
    }
    return condition(field, "between", value)
  },

  and: (...filters: PredicateNode[]): PredicateGroup => ({
    kind: "and",
    filters,
  }),
  or: (...filters: PredicateNode[]): PredicateGroup => ({
    kind: "or",
    filters,
  }),
  not: (filter: PredicateNode): PredicateNegation => ({ kind: "not", filter }),
  literal: (value: boolean): PredicateLiteral => ({ kind: "literal", value }),
}

export interface PredicateCompiler<TCompiled> {
  compile(filter: PredicateNode): TCompiled
}

const PREDICATE_KINDS: ReadonlySet<string> = new Set([
  "condition",
  "and",
  "or",
  "not",
  "literal",
])

const PREDICATE_OPS: ReadonlySet<string> = new Set([
  "eq",
  "neq",
  "contains",
  "startsWith",
  "endsWith",
  "isEmpty",
  "isNotEmpty",
  "gt",
  "lt",
  "gte",
  "lte",
  "isTrue",
  "isFalse",
  "isNull",
  "isNotNull",
  "in",
  "includesAny",
  "includesAll",
  "between",
])

const NO_VALUE_PREDICATE_OPS: ReadonlySet<string> = new Set([
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isFalse",
  "isNull",
  "isNotNull",
])

/** Fail-closed cap on predicate nesting so pathological input cannot blow the stack. */
const MAX_PREDICATE_DEPTH = 100

/**
 * Fail-closed shape check for a caller/adapter-supplied predicate AST.
 * Rejects malformed filters at the boundary instead of letting them surface
 * as downstream TypeErrors inside compilers and evaluators.
 */
export function assertPredicateNode(
  node: unknown,
  depth = 0
): asserts node is PredicateNode {
  if (depth > MAX_PREDICATE_DEPTH) {
    throw new ConfigurationError(
      "Predicate filter exceeds maximum nesting depth."
    )
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new ConfigurationError("Predicate filter must be an object.")
  }
  const candidate = node as Record<string, unknown>
  if (typeof candidate.kind !== "string" || !PREDICATE_KINDS.has(candidate.kind)) {
    throw new ConfigurationError(
      "Predicate filter has an unknown kind; expected one of condition, and, or, not, literal."
    )
  }
  switch (candidate.kind) {
    case "condition": {
      if (
        typeof candidate.field !== "string" ||
        candidate.field.length === 0
      ) {
        throw new ConfigurationError(
          "Predicate condition requires a non-empty field."
        )
      }
      if (typeof candidate.op !== "string" || !PREDICATE_OPS.has(candidate.op)) {
        throw new ConfigurationError(
          `Predicate condition has an unknown operator: ${String(candidate.op)}.`
        )
      }
      if (
        !NO_VALUE_PREDICATE_OPS.has(candidate.op) &&
        candidate.value === undefined
      ) {
        throw new ConfigurationError(
          `Predicate operator "${candidate.op}" requires a value.`
        )
      }
      return
    }
    case "and":
    case "or": {
      if (!Array.isArray(candidate.filters)) {
        throw new ConfigurationError(
          `Predicate "${candidate.kind}" requires a filters array.`
        )
      }
      for (const child of candidate.filters) {
        assertPredicateNode(child, depth + 1)
      }
      return
    }
    case "not": {
      assertPredicateNode(candidate.filter, depth + 1)
      return
    }
    case "literal": {
      if (typeof candidate.value !== "boolean") {
        throw new ConfigurationError(
          "Predicate literal requires a boolean value."
        )
      }
      return
    }
  }
}

import type { AbacFieldDefinition } from "./abacCatalog"

function isScalarField(type: AbacFieldDefinition["type"]): boolean {
  return type !== "string-array"
}

function isStringField(type: AbacFieldDefinition["type"]): boolean {
  return type === "string" || type === "identifier"
}

function isOrderedField(type: AbacFieldDefinition["type"]): boolean {
  return type === "number" || type === "date" || type === "datetime"
}

/** Returns the first type/operator mismatch in a predicate, if any. */
export function findUnsupportedPredicateCombination(
  node: PredicateNode,
  fields: Record<string, AbacFieldDefinition>
): { condition: PredicateCondition; message: string } | undefined {
  const visit = (
    current: PredicateNode
  ): { condition: PredicateCondition; message: string } | undefined => {
    if (current.kind === "condition") {
      const field = Object.hasOwn(fields, current.field)
        ? fields[current.field]
        : undefined
      if (!field)
        return {
          condition: current,
          message: `Unknown field: ${current.field}`,
        }
      const arrayValue = Array.isArray(current.value)
      const objectValue =
        current.value !== undefined &&
        typeof current.value === "object" &&
        !arrayValue &&
        !(current.value instanceof Date)
      const scalar = isScalarField(field.type)

      if (
        !scalar &&
        ![
          "includesAny",
          "includesAll",
          "isEmpty",
          "isNotEmpty",
          "isNull",
          "isNotNull",
        ].includes(current.op)
      )
        return {
          condition: current,
          message: `Operator "${current.op}" requires a scalar field`,
        }
      if (
        (current.op === "includesAny" || current.op === "includesAll") &&
        scalar
      )
        return {
          condition: current,
          message: `Operator "${current.op}" requires an array field`,
        }
      if (current.op === "in" && !scalar)
        return {
          condition: current,
          message: `Operator "in" requires a scalar field`,
        }
      if (current.op === "in" && !arrayValue)
        return {
          condition: current,
          message: `Operator "in" requires an array value`,
        }
      if (
        (current.op === "contains" ||
          current.op === "startsWith" ||
          current.op === "endsWith") &&
        (!isStringField(field.type) || typeof current.value !== "string")
      )
        return {
          condition: current,
          message: `Operator "${current.op}" requires a string field and scalar string value`,
        }
      if (
        (current.op === "gt" ||
          current.op === "lt" ||
          current.op === "gte" ||
          current.op === "lte" ||
          current.op === "between") &&
        (!isOrderedField(field.type) || arrayValue || objectValue)
      )
        return {
          condition: current,
          message: `Operator "${current.op}" requires an ordered scalar field`,
        }
      if (
        (current.op === "isTrue" || current.op === "isFalse") &&
        field.type !== "boolean"
      )
        return {
          condition: current,
          message: `Operator "${current.op}" requires a boolean field`,
        }
      if (
        (current.op === "isEmpty" || current.op === "isNotEmpty") &&
        scalar &&
        !isStringField(field.type)
      )
        return {
          condition: current,
          message: `Operator "${current.op}" requires a string or array field`,
        }
      if (scalar && (arrayValue || objectValue) && current.op !== "between")
        return {
          condition: current,
          message: `Operator "${current.op}" requires a scalar value`,
        }
      return undefined
    }
    if (current.kind === "not") return visit(current.filter)
    if (current.kind === "and" || current.kind === "or") {
      for (const child of current.filters) {
        const issue = visit(child)
        if (issue) return issue
      }
    }
    return undefined
  }
  return visit(node)
}

/**
 * Wrap a predicate leaf with COALESCE(expr, FALSE) semantics for SQL parity.
 * Use this when compiling predicates to SQL for tiered ABAC negation.
 * The JS evaluator collapses UNKNOWN to false via === true; SQL must do
 * COALESCE before NOT to avoid three-valued logic divergence.
 */
export function strictBooleanPredicate(
  node: PredicateNode
): PredicateNode {
  // No-op in core — represents the COALESCE wrapper. Adapters should apply
  // COALESCE when compiling: the JS tree stays two-valued via evaluatePredicate.
  return node
}

/**
 * Array-valued predicates require database-specific array operators, and empty
 * semantics differ between in-memory arrays and SQL. Keep them out of activated
 * policies until every persistence compiler has identical semantics.
 */
export function findNonPortablePredicate(
  node: PredicateNode
): PredicateCondition | undefined {
  switch (node.kind) {
    case "condition":
      return node.op === "includesAny" ||
        node.op === "includesAll" ||
        node.op === "isEmpty" ||
        node.op === "isNotEmpty"
        ? node
        : undefined
    case "and":
    case "or":
      for (const filter of node.filters) {
        const unsupported = findNonPortablePredicate(filter)
        if (unsupported) return unsupported
      }
      return undefined
    case "not":
      return findNonPortablePredicate(node.filter)
    case "literal":
      return undefined
  }
}
