import { describe, expect, it, vi } from "vitest"
import { createAbacBundle } from "../abacBundleFactory"
import { InvalidPolicyConfigurationError } from "../../foundation/errors"
import type { AbacModuleCatalog } from "../abacCatalog"

const catalog: AbacModuleCatalog = {
  moduleKey: "tenant.patients",
  actions: ["read"],
  capabilities: [],
  fields: { status: { key: "status", type: "string", operators: ["equals"] } },
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    provider: { resolve: vi.fn(async () => []) },
    mode: "tenant" as const,
    moduleKey: "tenant.patients",
    context: { userId: "user-1", tenantId: "tenant-1" },
    catalog,
    ...overrides,
  }
}

describe("createAbacBundle provider-shape guards", () => {
  it("rejects a non-array resolve() result fail-closed", async () => {
    for (const resolved of [null, undefined, {}, "policies"]) {
      const error = await createAbacBundle(
        baseInput({ provider: { resolve: vi.fn(async () => resolved) } })
      ).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(InvalidPolicyConfigurationError)
    }
  })

  it("rejects a provider without resolve()", async () => {
    const error = await createAbacBundle(
      baseInput({ provider: {} })
    ).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(InvalidPolicyConfigurationError)
  })

  it("rejects malformed policy entries without dereferencing source", async () => {
    const error = await createAbacBundle(
      baseInput({
        provider: {
          resolve: vi.fn(async () => [null, { nope: true }, { source: {} }]),
        },
      })
    ).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(InvalidPolicyConfigurationError)
    const issues = (error as InvalidPolicyConfigurationError)
      .issues as Array<{ code?: string }>
    expect(issues.length).toBe(3)
    for (const issue of issues) {
      expect(issue.code).toBe("POLICY_SOURCE_INVALID")
    }
  })

  it("rejects an invalid mode or catalog before normalization", async () => {
    const badMode = await createAbacBundle(
      baseInput({ mode: "global" })
    ).catch((error: unknown) => error)
    expect(badMode).toBeInstanceOf(InvalidPolicyConfigurationError)

    const badCatalog = await createAbacBundle(
      baseInput({ catalog: null })
    ).catch((error: unknown) => error)
    expect(badCatalog).toBeInstanceOf(InvalidPolicyConfigurationError)
  })
})
