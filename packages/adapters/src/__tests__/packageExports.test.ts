import manifest from "../../package.json"
import { describe, expect, it } from "vitest"

describe("adapters package exports", () => {
  it("keeps internal HTTP helpers out of the public package surface", () => {
    const exports = manifest.exports as Record<string, unknown>
    expect(exports["./http/filterInterop"]).toBeUndefined()
    expect(exports["./http/createTenantFrameworkWriteHandler"]).toBeUndefined()
  })

  it("exports the generic HTTP surface", () => {
    expect(manifest.exports["./http"]).toEqual({
      types: "./dist/http/index.d.ts",
      default: "./dist/http/index.js",
    })
  })
})
