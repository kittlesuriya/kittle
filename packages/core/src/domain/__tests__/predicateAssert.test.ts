import { describe, expect, it } from "vitest"
import { Predicate, assertPredicateNode } from "../predicate"
import { ConfigurationError } from "../../foundation/errors"

function deepNot(depth: number): unknown {
  let node: unknown = Predicate.eq("id", "row-1")
  for (let i = 0; i < depth; i++) {
    node = { kind: "not", filter: node }
  }
  return node
}

describe("assertPredicateNode", () => {
  it("accepts well-formed predicates", () => {
    expect(() =>
      assertPredicateNode(Predicate.eq("status", "active"))
    ).not.toThrow()
    expect(() =>
      assertPredicateNode(
        Predicate.and(
          Predicate.eq("status", "active"),
          Predicate.or(Predicate.isNull("deletedAt"), Predicate.gt("age", 18)),
          Predicate.not(Predicate.isEmpty("name")),
          Predicate.literal(true)
        )
      )
    ).not.toThrow()
    expect(() => assertPredicateNode(Predicate.alwaysTrue())).not.toThrow()
    expect(() => assertPredicateNode(Predicate.isEmpty("name"))).not.toThrow()
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "eq"],
    ["number", 42],
    ["array", []],
    ["missing kind", { field: "id", op: "eq", value: "row-1" }],
    ["bogus kind", { kind: "bogus", field: "id" }],
    ["empty kind", { kind: "", filters: [] }],
  ])("rejects %s", (_label, node) => {
    expect(() => assertPredicateNode(node)).toThrow(ConfigurationError)
  })

  it("rejects conditions with an empty field, unknown op, or missing value", () => {
    expect(() =>
      assertPredicateNode({ kind: "condition", field: "", op: "eq", value: 1 })
    ).toThrow(ConfigurationError)
    expect(() =>
      assertPredicateNode({
        kind: "condition",
        field: "id",
        op: "equals-ish",
        value: 1,
      })
    ).toThrow(ConfigurationError)
    expect(() =>
      assertPredicateNode({ kind: "condition", field: "id", op: "eq" })
    ).toThrow(ConfigurationError)
  })

  it("rejects malformed groups, negations, and literals", () => {
    expect(() =>
      assertPredicateNode({ kind: "and", filters: "nope" })
    ).toThrow(ConfigurationError)
    expect(() =>
      assertPredicateNode({
        kind: "and",
        filters: [Predicate.eq("id", "row-1"), { kind: "bogus" }],
      })
    ).toThrow(ConfigurationError)
    expect(() => assertPredicateNode({ kind: "not" })).toThrow(
      ConfigurationError
    )
    expect(() =>
      assertPredicateNode({ kind: "literal", value: "true" })
    ).toThrow(ConfigurationError)
  })

  it("fails closed on pathological nesting", () => {
    expect(() => assertPredicateNode(deepNot(101))).toThrow(ConfigurationError)
    expect(() => assertPredicateNode(deepNot(10))).not.toThrow()
  })
})
