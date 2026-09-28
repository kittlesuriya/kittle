import { describe, expect, it } from "vitest"
import { resolveTieredDecision } from "../abacTierDecision"
import { buildTieredPolicyOutcome } from "../policyTierResolver"

type Policy = {
  id: string
  priority: number
  effect: "allow" | "deny"
  matches: boolean
}

const policies: Policy[] = [
  { id: "low", priority: 1, effect: "allow", matches: true },
  { id: "high-allow", priority: 5, effect: "allow", matches: true },
  { id: "high-deny", priority: 5, effect: "deny", matches: true },
  { id: "high-other", priority: 5, effect: "allow", matches: false },
]

describe("policy tier algorithms", () => {
  it("retains deny precedence and input order within the highest matching tier", () => {
    const result = resolveTieredDecision({
      policies,
      getPriority: (policy) => policy.priority,
      getEffect: (policy) => policy.effect,
      matches: (policy) => policy.matches,
    })
    expect(result.reason).toBe("DENY_POLICY_MATCHED")
    expect(result.priority).toBe(5)
    expect(result.matchedPolicies.map((policy) => policy.id)).toEqual([
      "high-allow",
      "high-deny",
    ])
    expect(result.decidingPolicies.map((policy) => policy.id)).toEqual([
      "high-deny",
    ])
  })

  it("preserves collection scope expression ordering and deny-wins semantics", () => {
    const expression = buildTieredPolicyOutcome({
      policies,
      getPriority: (policy) => policy.priority,
      getEffect: (policy) => policy.effect,
      getMatch: (policy) => policy.id,
      ops: {
        alwaysTrue: () => "true",
        alwaysFalse: () => "false",
        and: (items) => `and(${items.join(",")})`,
        or: (items) => `or(${items.join(",")})`,
        not: (item) => `not(${item})`,
      },
    })
    expect(expression).toBe(
      "or(and(true,or(high-allow,high-other),not(or(high-deny))),and(and(true,not(or(high-allow,high-deny,high-other))),or(low),not(or())))"
    )
  })
})
