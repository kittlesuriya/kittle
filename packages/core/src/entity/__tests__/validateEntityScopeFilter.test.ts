import { describe, expect, it } from "vitest"
import { ConfigurationError } from "../../foundation/errors"
import { Predicate } from "../../domain/predicate"
import { validateEntity } from "../validateEntity"

const schema = {} as never

function inputWithTenantScoping(tenantScoping: unknown) {
  return {
    moduleKey: "tenant.globals",
    entity: {
      name: "global",
      primaryKey: "id" as const,
      versionField: "version" as const,
      fields: {
        id: { type: "string" as const },
        name: { type: "string" as const },
        version: { type: "number" as const },
      },
    },
    tenantScoping,
    policy: { skipCapabilityCheck: true as const },
    validation: { createBody: schema, updateBody: schema },
  } as never
}

const routes = {
  list: true,
  detail: true,
  create: true,
  update: true,
  delete: true,
} as const

describe("validateEntity tenantScoping scopeFilter", () => {
  it("accepts a well-formed scopeFilter on an unscoped entity", () => {
    expect(() =>
      validateEntity(
        inputWithTenantScoping({
          mode: "none",
          acknowledged: true,
          scopeFilter: Predicate.eq("region", "eu"),
        }),
        routes
      )
    ).not.toThrow()
  })

  it("accepts an unscoped entity without a scopeFilter", () => {
    expect(() =>
      validateEntity(
        inputWithTenantScoping({ mode: "none", acknowledged: true }),
        routes
      )
    ).not.toThrow()
  })

  it.each([
    ["bogus kind", { kind: "bogus" }],
    ["empty-field condition", { kind: "condition", field: "", op: "eq", value: 1 }],
    ["non-object", "region = eu"],
  ])("rejects a malformed scopeFilter (%s)", (_label, scopeFilter) => {
    expect(() =>
      validateEntity(
        inputWithTenantScoping({
          mode: "none",
          acknowledged: true,
          scopeFilter,
        }),
        routes
      )
    ).toThrow(ConfigurationError)
  })
})
