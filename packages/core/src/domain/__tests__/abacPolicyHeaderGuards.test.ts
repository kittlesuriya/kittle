import { describe, expect, it } from "vitest"
import {
  assertPolicyEffect,
  assertPolicyPriority,
  assertPolicyScopeType,
  normalizeAbacPolicy,
} from "../abacPolicyNormalizer"
import { ConfigurationError } from "../../foundation/errors"
import type { AbacModuleCatalog } from "../abacCatalog"
import type { AbacPolicy, AbacContext } from "../abacTypes"

const catalog: AbacModuleCatalog = {
  moduleKey: "test.module",
  actions: ["read"],
  capabilities: [],
  fields: {
    status: { key: "status", type: "string", operators: ["equals"] },
    ownerId: { key: "ownerId", type: "string", operators: ["equals"] },
  },
}

const context: AbacContext = {
  userId: "user-1",
  roleId: "role-1",
  tenantId: "tenant-1",
}

function makePolicy(overrides: Partial<AbacPolicy> = {}): AbacPolicy {
  return {
    source: { policyId: "test-policy", scopeType: "tenant_default" },
    moduleKey: "test.module",
    effect: "allow",
    priority: 100,
    payload: {
      actions: ["read"],
      capabilities: [],
      conditions: {
        version: 2,
        systemScope: {
          logic: "AND",
          conditions: [
            { field: "status", operator: "equals", value: "active" },
          ],
        },
        userFilters: { logic: "AND", conditions: [] },
      },
    },
    ...overrides,
  }
}

describe("abac policy header guards", () => {
  it.each(["whatever", "", "ALLOW", "Allow", null, undefined])(
    "rejects garbage effect %s instead of allowing on match",
    (effect) => {
      const result = normalizeAbacPolicy({
        policy: makePolicy({ effect: effect as never }),
        catalog,
        context,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "POLICY_EFFECT_INVALID",
            policyId: "test-policy",
          })
        )
      }
    }
  )

  it.each(["allow", "deny"] as const)(
    "accepts valid effect %s with compiled conditions intact",
    (effect) => {
      const result = normalizeAbacPolicy({
        policy: makePolicy({ effect }),
        catalog,
        context,
      })
      expect(result.success).toBe(true)
      if (result.success)
        expect(result.policy.compiledConditions).toBeDefined()
    }
  )

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, "100", null, undefined])(
    "rejects non-safe-integer priority %s",
    (priority) => {
      const result = normalizeAbacPolicy({
        policy: makePolicy({ priority: priority as never }),
        catalog,
        context,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "POLICY_PRIORITY_INVALID",
            policyId: "test-policy",
          })
        )
      }
    }
  )

  it.each([0, 100, -5, Number.MAX_SAFE_INTEGER])(
    "accepts safe-integer priority %s",
    (priority) => {
      const result = normalizeAbacPolicy({
        policy: makePolicy({ priority }),
        catalog,
        context,
      })
      expect(result.success).toBe(true)
    }
  )

  it.each(["global", "", "TENANT_DEFAULT", "tenant", null, undefined])(
    "rejects unknown scopeType %s",
    (scopeType) => {
      const result = normalizeAbacPolicy({
        policy: makePolicy({
          source: { policyId: "test-policy", scopeType: scopeType as never },
        }),
        catalog,
        context,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "POLICY_SCOPE_INVALID",
            policyId: "test-policy",
          })
        )
      }
    }
  )

  it.each([
    "tenant_default",
    "platform_default",
    "role",
    "branch",
    "department",
    "user",
  ] as const)("accepts known scopeType %s", (scopeType) => {
    const result = normalizeAbacPolicy({
      policy: makePolicy({
        source: { policyId: "test-policy", scopeType },
      }),
      catalog,
      context,
    })
    expect(result.success).toBe(true)
  })

  it("reports every invalid header in one failure", () => {
    const result = normalizeAbacPolicy({
      policy: makePolicy({
        effect: "whatever" as never,
        priority: 1.5,
        source: { policyId: "test-policy", scopeType: "global" as never },
      }),
      catalog,
      context,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const codes = result.errors.map((error) => error.code)
      expect(codes).toContain("POLICY_EFFECT_INVALID")
      expect(codes).toContain("POLICY_PRIORITY_INVALID")
      expect(codes).toContain("POLICY_SCOPE_INVALID")
    }
  })

  it("assert helpers throw ConfigurationError carrying the failure code", () => {
    expect(() => assertPolicyEffect("whatever", "p1")).toThrow(
      ConfigurationError
    )
    expect(() => assertPolicyPriority(1.5, "p1")).toThrow(ConfigurationError)
    expect(() => assertPolicyScopeType("global", "p1")).toThrow(
      ConfigurationError
    )
    try {
      assertPolicyEffect("whatever", "p1")
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError)
      expect((error as ConfigurationError).details).toMatchObject({
        code: "POLICY_EFFECT_INVALID",
        policyId: "p1",
      })
    }
    expect(() => assertPolicyEffect("allow")).not.toThrow()
    expect(() => assertPolicyEffect("deny")).not.toThrow()
    expect(() => assertPolicyPriority(0)).not.toThrow()
    expect(() => assertPolicyScopeType("user")).not.toThrow()
  })
})
