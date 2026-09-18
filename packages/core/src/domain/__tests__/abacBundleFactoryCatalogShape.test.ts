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

describe("createAbacBundle catalog shape guard", () => {
  it.each([
    ["null catalog", null],
    ["missing fields", { moduleKey: "tenant.patients" }],
    ["null fields", { moduleKey: "tenant.patients", fields: null }],
    ["array fields", { moduleKey: "tenant.patients", fields: [] }],
    ["non-string moduleKey", { moduleKey: 42, fields: {} }],
  ])("rejects %s with InvalidPolicyConfigurationError", async (_label, bad) => {
    const error = await createAbacBundle(
      baseInput({ catalog: bad })
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvalidPolicyConfigurationError)
  })

  it("still accepts an unbranded but well-shaped catalog", async () => {
    const bundle = await createAbacBundle(baseInput())
    expect(bundle.moduleKey).toBe("tenant.patients")
    expect(bundle.defaultEffect).toBe("deny")
  })
})
