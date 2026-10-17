import { describe, expect, it } from "vitest"
import type { OperationsConfig } from "./types"
import { filterOperationsByGranular } from "./granularPermissions"

/**
 * The server's `buildGranularPermissions` only emits DataTable operation keys
 * (`add view detail edit delete export download print`) plus capability keys.
 * A custom operation key such as `domains` never appears in that map, so it is
 * dropped unless it declares an explicit `permissionKey`.
 */
const OWNER_OPS = ["view", "detail", "add", "edit", "delete"]
const READ_ONLY_OPS = ["view", "detail"]

const operations: OperationsConfig<{ id: string }> = {
  add: { handler: () => undefined },
  view: { handler: () => undefined },
  edit: { handler: () => undefined },
  delete: { handler: () => undefined },
  domains: { handler: () => undefined },
}

describe("filterOperationsByGranular", () => {
  it("keeps the standard operations for a full grant", () => {
    const result = filterOperationsByGranular(operations, OWNER_OPS)

    expect(Object.keys(result ?? {})).toEqual(["add", "view", "edit", "delete"])
  })

  it("drops a custom operation whose key is not in the granted map", () => {
    const result = filterOperationsByGranular(operations, OWNER_OPS)

    expect(result?.domains).toBeUndefined()
  })

  it("keeps a custom operation when permissionKey maps to a granted operation", () => {
    const withPermissionKey = {
      ...operations,
      domains: { ...operations.domains, permissionKey: "edit" },
    }

    const result = filterOperationsByGranular(withPermissionKey, OWNER_OPS)

    expect(result?.domains).toBeDefined()
  })

  it("hides that custom operation for a read-only grant", () => {
    const withPermissionKey = {
      ...operations,
      domains: { ...operations.domains, permissionKey: "edit" },
    }

    const result = filterOperationsByGranular(withPermissionKey, READ_ONLY_OPS)

    expect(result?.domains).toBeUndefined()
    expect(Object.keys(result ?? {})).toEqual(["view"])
  })

  it("returns undefined when no operations are granted", () => {
    expect(filterOperationsByGranular(operations, [])).toBeUndefined()
    expect(filterOperationsByGranular(operations, undefined)).toBeUndefined()
  })
})
