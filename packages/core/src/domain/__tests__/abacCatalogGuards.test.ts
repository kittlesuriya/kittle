import { describe, expect, it } from "vitest"
import { defineAbacModule } from "../abacCatalog"
import { ConfigurationError } from "../../foundation/errors"
import type { AbacModuleCatalog } from "../abacCatalog"

function validCatalog(
  overrides: Partial<AbacModuleCatalog> = {}
): AbacModuleCatalog {
  return {
    moduleKey: "tenant.patients",
    actions: ["read"],
    capabilities: ["export"],
    fields: {
      status: { key: "status", type: "string", operators: ["equals"] },
    },
    ...overrides,
  }
}

describe("defineAbacModule input validation", () => {
  it("accepts a well-formed catalog and normalises fields", () => {
    const branded = defineAbacModule(validCatalog())
    expect(branded.moduleKey).toBe("tenant.patients")
    expect(Object.getPrototypeOf(branded.fields)).toBeNull()
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array", []],
    ["string", "catalog"],
  ])("rejects a non-object catalog (%s)", (_label, catalog) => {
    expect(() => defineAbacModule(catalog as never)).toThrow(ConfigurationError)
  })

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["non-string", 42],
  ])("rejects a bad moduleKey (%s)", (_label, moduleKey) => {
    expect(() =>
      defineAbacModule(validCatalog({ moduleKey: moduleKey as never }))
    ).toThrow(ConfigurationError)
  })

  it.each([
    ["not an array", "read"],
    ["empty-string entry", [""]],
    ["non-string entry", ["read", 42]],
  ])("rejects bad actions (%s)", (_label, actions) => {
    expect(() =>
      defineAbacModule(validCatalog({ actions: actions as never }))
    ).toThrow(ConfigurationError)
  })

  it("rejects bad capabilities", () => {
    expect(() =>
      defineAbacModule(validCatalog({ capabilities: ["ok", ""] as never }))
    ).toThrow(ConfigurationError)
  })

  it.each([
    ["missing", undefined],
    ["null", null],
    ["array", []],
  ])("rejects bad fields (%s)", (_label, fields) => {
    expect(() =>
      defineAbacModule(validCatalog({ fields: fields as never }))
    ).toThrow(ConfigurationError)
  })

  it("rejects field entries with a mismatched key, unknown type, or bad operators", () => {
    expect(() =>
      defineAbacModule(
        validCatalog({
          fields: {
            status: { key: "other", type: "string", operators: ["equals"] },
          },
        })
      )
    ).toThrow(ConfigurationError)
    expect(() =>
      defineAbacModule(
        validCatalog({
          fields: {
            status: { key: "status", type: "fancy", operators: ["equals"] } as never,
          },
        })
      )
    ).toThrow(ConfigurationError)
    expect(() =>
      defineAbacModule(
        validCatalog({
          fields: {
            status: { key: "status", type: "string", operators: [] },
          },
        })
      )
    ).toThrow(ConfigurationError)
    expect(() =>
      defineAbacModule(
        validCatalog({
          fields: {
            status: {
              key: "status",
              type: "string",
              operators: ["equals", "nope"] as never,
            },
          },
        })
      )
    ).toThrow(ConfigurationError)
    expect(() =>
      defineAbacModule(validCatalog({ fields: { status: null as never } }))
    ).toThrow(ConfigurationError)
  })
})
