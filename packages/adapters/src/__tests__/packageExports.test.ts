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

  it("exports the drizzle-mysql adapter", () => {
    expect(manifest.exports["./drizzle-mysql"]).toEqual({
      types: "./dist/drizzle-mysql/index.d.ts",
      default: "./dist/drizzle-mysql/index.js",
    })
  })

  it("exports the fastify adapter", () => {
    expect(manifest.exports["./fastify"]).toEqual({
      types: "./dist/fastify/index.d.ts",
      default: "./dist/fastify/index.js",
    })
  })

  it("exports the NestJS adapter", () => {
    expect(manifest.exports["./nestjs"]).toEqual({
      types: "./dist/nestjs/index.d.ts",
      default: "./dist/nestjs/index.js",
    })
  })
})
