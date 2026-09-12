import manifest from "../../package.json"
import { describe, expect, it } from "vitest"

const directSourceExports = [
  "./domain/filterFieldMeta",
  "./domain/predicate",
  "./entity/capabilityCheck",
  "./execution/dispatcher",
  "./execution/executionContext",
  "./execution/jobRegistry",
  "./execution/retryPolicy",
  "./execution/scheduleCalculator",
  "./execution/scheduleDispatcher",
  "./execution/scheduleStore",
  "./execution/types",
] as const

describe("core package exports", () => {
  it("exposes built runtime consumers with matching type declarations", () => {
    for (const subpath of directSourceExports) {
      const sourcePath = subpath.slice(2)
      expect(manifest.exports[subpath]).toEqual({
        types: `./dist/${sourcePath}.d.ts`,
        default: `./dist/${sourcePath}.js`,
      })
    }
  })

  it("exposes the operation entry point with matching type declarations", () => {
    expect(manifest.exports["./operation"]).toEqual({
      types: "./dist/operation/index.d.ts",
      default: "./dist/operation/index.js",
    })
  })

  it("does not expose operation implementation subpaths", () => {
    for (const subpath of [
      "./operation/operationEffectCollector",
      "./operation/operationRunContext",
      "./operation/standardOperationPipeline",
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(manifest.exports, subpath)
      ).toBe(false)
    }
  })

  it("does not expose the removed compatibility entry point", () => {
    expect(
      Object.prototype.hasOwnProperty.call(manifest.exports, "./compat")
    ).toBe(false)
  })
})
