import { describe, expect, it } from "vitest"
import {
  assertUserAttrResolved,
  policyClauseToPredicate,
} from "../abacConditionCompiler"
import { normalizeAbacPolicy } from "../abacPolicyNormalizer"
import { evaluatePredicate } from "../evaluatePredicate"
import { ConfigurationError } from "../../foundation/errors"
import type { AbacContext } from "../abacTypes"
import type { AbacFieldDefinition } from "../abacCatalog"
import type { AbacModuleCatalog } from "../abacCatalog"
import type { AbacPolicy } from "../abacTypes"

const fields: Record<string, AbacFieldDefinition> = {
  ownerId: { key: "ownerId", type: "string", operators: ["equals"] },
  status: { key: "status", type: "string", operators: ["equals", "in"] },
  tags: {
    key: "tags",
    type: "string-array",
    operators: ["includesAny", "includesAll", "in"],
  },
}

const catalog: AbacModuleCatalog = {
  moduleKey: "test.module",
  actions: ["read"],
  capabilities: [],
  fields,
}

function makePolicy(effect: "allow" | "deny"): AbacPolicy {
  return {
    source: { policyId: `${effect}-policy`, scopeType: "tenant_default" },
    moduleKey: "test.module",
    effect,
    priority: 100,
    payload: {
      actions: ["read"],
      capabilities: [],
      conditions: {
        version: 2,
        systemScope: {
          logic: "AND",
          conditions: [
            { field: "ownerId", operator: "equals", userAttr: "user.branchId" },
          ],
        },
        userFilters: { logic: "AND", conditions: [] },
      },
    },
  }
}

describe("abac userAttr resolution guards", () => {
  it("fails a scalar clause when a known userAttr is missing from context", () => {
    const result = policyClauseToPredicate({
      clause: {
        field: "ownerId",
        operator: "equals",
        userAttr: "user.branchId",
      },
      context: { userId: "user-1", tenantId: "tenant-1" },
      fieldCatalog: fields,
    })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error).toContain("user.branchId")
  })

  it.each(["deny", "allow"] as const)(
    "fails normalization for a %s policy with a missing context attribute",
    (effect) => {
      const result = normalizeAbacPolicy({
        policy: makePolicy(effect),
        catalog,
        // branchId is absent, so user.branchId cannot resolve.
        context: { userId: "user-1", tenantId: "tenant-1" },
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({ code: "CONDITION_COMPILATION_FAILED" })
        )
      }
    }
  )

  it("compiles as before when the attribute is present", () => {
    const result = policyClauseToPredicate({
      clause: {
        field: "ownerId",
        operator: "equals",
        userAttr: "user.branchId",
      },
      context: { userId: "user-1", branchId: "branch-1" },
      fieldCatalog: fields,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(evaluatePredicate({ ownerId: "branch-1" }, result.predicate)).toBe(
        true
      )
      expect(evaluatePredicate({ ownerId: "other" }, result.predicate)).toBe(
        false
      )
    }
    const normalized = normalizeAbacPolicy({
      policy: makePolicy("deny"),
      catalog,
      context: { userId: "user-1", branchId: "branch-1" },
    })
    expect(normalized.success).toBe(true)
  })

  it("keeps the in-family empty-to-alwaysFalse mapping for missing attributes", () => {
    const context: AbacContext = { userId: "user-1" }
    const listResult = policyClauseToPredicate({
      clause: { field: "tags", operator: "includesAny", userAttr: "user.branchId" },
      context,
      fieldCatalog: fields,
    })
    expect(listResult.success).toBe(true)
    if (listResult.success) {
      expect(evaluatePredicate({ tags: ["branch-1"] }, listResult.predicate)).toBe(
        false
      )
    }
    const inResult = policyClauseToPredicate({
      clause: { field: "status", operator: "in", userAttr: "user.branchId" },
      context,
      fieldCatalog: fields,
    })
    expect(inResult.success).toBe(true)
    if (inResult.success) {
      expect(evaluatePredicate({ status: "branch-1" }, inResult.predicate)).toBe(
        false
      )
    }
  })

  it("keeps null eq-null semantics for nullable context attributes", () => {
    const result = policyClauseToPredicate({
      clause: {
        field: "ownerId",
        operator: "equals",
        userAttr: "user.roleId",
      },
      context: { userId: "user-1", roleId: null },
      fieldCatalog: fields,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.predicate).toMatchObject({
        kind: "condition",
        field: "ownerId",
        op: "eq",
        value: null,
      })
    }
  })

  it("assertUserAttrResolved throws only for missing known attributes", () => {
    expect(() =>
      assertUserAttrResolved({
        userAttr: "user.branchId",
        resolvedValue: undefined,
        field: "ownerId",
      })
    ).toThrow(ConfigurationError)
    expect(() =>
      assertUserAttrResolved({
        userAttr: "user.branchId",
        resolvedValue: "branch-1",
        field: "ownerId",
      })
    ).not.toThrow()
    expect(() =>
      assertUserAttrResolved({
        userAttr: "user.roleId",
        resolvedValue: null,
        field: "ownerId",
      })
    ).not.toThrow()
    expect(() =>
      assertUserAttrResolved({
        userAttr: undefined,
        resolvedValue: undefined,
        field: "ownerId",
      })
    ).not.toThrow()
  })
})
