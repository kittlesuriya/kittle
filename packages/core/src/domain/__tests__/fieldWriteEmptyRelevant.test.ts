import { describe, expect, it } from "vitest"
import { assertPolicyWritableFields } from "../fieldAccess"
import {
  enforceAbacWrite,
  evaluateWriteAccessForRecordDetailed,
} from "../abacWrite"
import { bindAbacSecurityDigest } from "../abacBundleIntegrity"
import { Predicate } from "../predicate"
import { ForbiddenError } from "../../foundation/errors"
import type { NormalizedAbacPolicy } from "../abacTypes"

function makePolicy(
  overrides: Partial<NormalizedAbacPolicy> = {}
): NormalizedAbacPolicy {
  return {
    source: { policyId: "p1", scopeType: "tenant_default" },
    moduleKey: "tenant.records",
    effect: "allow",
    priority: 100,
    payload: {
      actions: ["update"],
      capabilities: [],
      conditions: {
        version: 2,
        systemScope: { logic: "AND", conditions: [] },
        userFilters: { logic: "AND", conditions: [] },
      },
    },
    compiledConditions: Predicate.alwaysTrue(),
    ...overrides,
  }
}

async function makeBundle(policies: NormalizedAbacPolicy[]) {
  return bindAbacSecurityDigest({
    mode: "tenant",
    moduleKey: "tenant.records",
    policies,
    context: { tenantId: "t1" },
    defaultEffect: "deny",
    fieldCatalog: {},
  })
}

function reasonCodeOf(error: unknown): unknown {
  return (
    error instanceof ForbiddenError &&
    error.details !== null &&
    typeof error.details === "object" &&
    (error.details as { reasonCode?: unknown }).reasonCode
  )
}

describe("Batch H: field-write empty-relevant deny", () => {
  it("standalone assertPolicyWritableFields throws ForbiddenError with zero relevant policies", () => {
    let caught: unknown
    try {
      assertPolicyWritableFields({
        policies: [makePolicy({ moduleKey: "other.module" })],
        moduleKey: "tenant.records",
        action: "update",
        record: { name: "x" },
        changedFields: ["name"],
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ForbiddenError)
    expect(reasonCodeOf(caught)).toBe("ABAC_FIELD_WRITE_DENIED")
  })

  it("standalone assertPolicyWritableFields throws when policies exist but none matches the record", () => {
    let caught: unknown
    try {
      assertPolicyWritableFields({
        policies: [
          makePolicy({ compiledConditions: Predicate.eq("id", "other") }),
        ],
        moduleKey: "tenant.records",
        action: "update",
        record: { id: "row" },
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ForbiddenError)
    expect(reasonCodeOf(caught)).toBe("ABAC_FIELD_WRITE_DENIED")
  })

  it("enforceAbacWrite on a no-policy bundle still denies with the record-level reason code", async () => {
    const emptyBundle = await makeBundle([])
    let caught: unknown
    try {
      enforceAbacWrite({ bundle: emptyBundle, action: "update", record: {} })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ForbiddenError)
    // Record-level dominance preserved: empty bundle -> NO_RELEVANT_POLICY.
    expect(reasonCodeOf(caught)).toBe("NO_RELEVANT_POLICY")
  })

  it("enforceAbacWrite on an unmatched-record bundle still denies with NO_POLICY_MATCHED_RECORD", async () => {
    const bundle = await makeBundle([
      makePolicy({ compiledConditions: Predicate.eq("id", "other") }),
    ])
    let caught: unknown
    try {
      enforceAbacWrite({
        bundle,
        action: "update",
        record: { id: "row" },
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ForbiddenError)
    expect(reasonCodeOf(caught)).toBe("NO_POLICY_MATCHED_RECORD")
    // Sanity: the record-level evaluator agrees.
    expect(
      evaluateWriteAccessForRecordDetailed({
        policies: bundle.policies,
        moduleKey: bundle.moduleKey,
        action: "update",
        record: { id: "row" },
      }).reasonCode
    ).toBe("NO_POLICY_MATCHED_RECORD")
  })

  it("evaluates each matching write predicate only once", async () => {
    const bundle = await makeBundle([
      makePolicy({
        compiledConditions: Predicate.eq("status", "active"),
        payload: {
          ...makePolicy().payload,
          fieldAccess: { write: ["name"] },
        },
      }),
    ])
    let reads = 0
    const record = {
      get status() {
        reads += 1
        return "active"
      },
      name: "row",
    }
    expect(() =>
      enforceAbacWrite({
        bundle,
        action: "update",
        record,
        changedFields: ["name"],
      })
    ).not.toThrow()
    expect(reads).toBe(1)
  })

  it("preserves field-denial precedence over a matched record denial", async () => {
    const bundle = await makeBundle([
      makePolicy({
        effect: "deny",
        payload: {
          ...makePolicy().payload,
          fieldAccess: { write: ["name"] },
        },
      }),
    ])
    let caught: unknown
    try {
      enforceAbacWrite({
        bundle,
        action: "update",
        record: { name: "row" },
        changedFields: ["name"],
      })
    } catch (error) {
      caught = error
    }
    expect(reasonCodeOf(caught)).toBe("ABAC_FIELD_WRITE_DENIED")
  })
})
