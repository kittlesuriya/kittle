import { describe, expect, it, vi } from "vitest"
import { createAbacBundle } from "../abacBundleFactory"
import type { AbacModuleCatalog } from "../abacCatalog"
import type { AbacPolicy } from "../abacTypes"
import type { AbacPolicyProvider } from "../../ports/abacPolicyProvider"
import { InvalidPolicyConfigurationError } from "../../foundation/errors"

const catalog: AbacModuleCatalog = {
  moduleKey: "tenant.patients",
  actions: ["read", "update"],
  capabilities: ["manage"],
  fields: { status: { key: "status", type: "string", operators: ["equals"] } },
}

function policyWithConditionField(
  policyId: string,
  field: string
): AbacPolicy {
  return {
    source: { policyId, scopeType: "tenant_default" },
    moduleKey: "tenant.patients",
    effect: "allow",
    priority: 100,
    payload: {
      actions: ["read"],
      capabilities: [],
      conditions: {
        version: 2,
        systemScope: {
          logic: "AND",
          conditions: [{ field, operator: "equals", value: "active" }],
        },
        userFilters: { logic: "AND", conditions: [] },
      },
    },
  }
}

function inputFor(field: string) {
  const provider: AbacPolicyProvider = {
    resolve: vi.fn(async () => [policyWithConditionField("p1", field)]),
  }
  return {
    provider,
    mode: "tenant" as const,
    moduleKey: "tenant.patients",
    context: { userId: "user-1", tenantId: "tenant-1" },
    catalog,
  }
}

describe("Batch H: condition-field rejection lock-in", () => {
  it.each([["profile.ssn"], ["nonexistent"]])(
    "fails bundle creation loudly for dotted/typo'd condition field %s",
    async (field) => {
      const error = await createAbacBundle(inputFor(field)).catch(
        (error: unknown) => error
      )
      expect(error).toBeInstanceOf(InvalidPolicyConfigurationError)
    }
  )
})
