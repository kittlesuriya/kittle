import { describe, expect, it } from "vitest"
import * as root from "../index"
import * as http from "../http"
import * as server from "../server"
import * as mysql from "../drizzle-mysql"
import * as fastifyBarrel from "../fastify"
import * as nestjsBarrel from "../nestjs"

/**
 * Every public entry point is re-exported from a barrel. Barrel modules are
 * only executed when something imports them, so these assertions keep the
 * package subpaths honest instead of leaving them as unverified re-exports.
 */
describe("public barrel modules", () => {
  it("re-exports the generic HTTP surface", () => {
    expect(typeof http.CRUD).toBe("function")
    expect(typeof http.createSimpleRuntime).toBe("function")
    expect(typeof http.createFrameworkWriteHandler).toBe("function")
    expect(typeof http.createFrameworkErrorHandler).toBe("function")
  })

  it("re-exports the cache surface from the package root", () => {
    expect(typeof root.InMemoryCacheAdapter).toBe("function")
    expect(typeof root.SharedGenerationCacheAdapter).toBe("function")
    expect(root.CRUD).toBe(http.CRUD)
  })

  it("re-exports server helpers, including the ABAC read scope", () => {
    expect(typeof server.buildActionScope).toBe("function")
    expect(root.buildActionScope).toBe(server.buildActionScope)
    expect(typeof server.createAuthorizedRepository).toBe("function")
  })

  it("re-exports the Drizzle MySQL runtime", () => {
    expect(typeof mysql.createCrudRuntime).toBe("function")
    expect(typeof mysql.createDrizzlePersistenceProvider).toBe("function")
  })

  it("re-exports the Fastify integration surface", () => {
    expect(typeof fastifyBarrel.defineProject).toBe("function")
    expect(typeof fastifyBarrel.registerCrudRoutes).toBe("function")
    expect(typeof fastifyBarrel.createCrudFastifyRoutes).toBe("function")
    expect(typeof fastifyBarrel.wrapFetchHandler).toBe("function")
    expect(typeof fastifyBarrel.sendFetchResponse).toBe("function")
  })

  it("re-exports the NestJS integration surface", () => {
    expect(typeof nestjsBarrel.createNestCrudController).toBe("function")
    expect(typeof nestjsBarrel.createNestCrudModule).toBe("function")
    expect(typeof nestjsBarrel.toNestFetchRequest).toBe("function")
  })

  it("re-exports the package root barrel for the Drizzle drivers", () => {
    expect(root.drizzlePg).toBeDefined()
    expect(typeof root.getDrizzleSession).toBe("function")
  })
})
