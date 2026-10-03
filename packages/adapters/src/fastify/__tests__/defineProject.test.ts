import Fastify from "fastify"
import { int, mysqlTable, text } from "drizzle-orm/mysql-core"
import { describe, expect, it, vi } from "vitest"
import type { ValidationSchema } from "kittle-core/ports"
import {
  defineProject,
  type EntityConfig,
  type ProjectConfig,
} from "../defineProject"
import type { FrameworkAdapterDeps } from "../../server"

const products = mysqlTable("products", {
  id: text("id"),
  name: text("name"),
  price: int("price"),
  version: int("version"),
})

const columnMap = {
  id: products.id,
  name: products.name,
  price: products.price,
  version: products.version,
}

const passthrough: ValidationSchema = {
  parse: (input: unknown) => input,
  parseAsync: async (input: unknown) => input,
}

/** Detail routes validate path params against a UUID schema by default. */
const MISSING_ID = "01900000-0000-7000-8000-000000000000"

const resolveSession = (async ({ scope }: { scope: "platform" }) => ({
  scope,
  actor: { id: "user-1", type: scope, bypassAuthority: true },
  raw: null,
})) as unknown as FrameworkAdapterDeps["resolveSession"]

function createQueryChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(rows).then(onFulfilled, onRejected),
  }
  for (const method of [
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "groupBy",
    "having",
    "innerJoin",
    "leftJoin",
  ]) {
    chain[method] = vi.fn(() => chain)
  }
  return chain
}

/**
 * In-memory stand-in for the Drizzle MySQL driver. Writes are stored so the
 * repository's read-after-insert (MySQL has no `RETURNING`) resolves, and
 * count projections are answered like `SELECT count(*)`.
 */
function createMockDb(state = { rows: [] as Record<string, unknown>[] }) {
  return {
    state,
    select: vi.fn((projection?: Record<string, unknown>) =>
      createQueryChain(
        projection && Object.hasOwn(projection, "count")
          ? [{ count: state.rows.length }]
          : state.rows
      )
    ),
    insert: vi.fn(() => ({
      values: vi.fn(async (data: Record<string, unknown>) => {
        state.rows.push({ ...data })
        return { affectedRows: 1, insertId: data.id }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => ({ affectedRows: 1 })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => ({ affectedRows: 1 })),
    })),
    // Transaction callbacks run against the same in-memory row store.
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work(createMockDb(state))
    ),
  }
}

function createProject(overrides: Partial<ProjectConfig> = {}) {
  return defineProject({
    db: createMockDb() as never,
    resolveSession,
    scope: "platform",
    prefix: "/api",
    ...overrides,
  })
}

function productConfig(overrides: Partial<EntityConfig> = {}): EntityConfig {
  return {
    name: "Product",
    table: products,
    columnMap,
    fields: {
      id: { type: "string" },
      name: { type: "string" },
      price: { type: "number" },
      version: { type: "number" },
    },
    version: "version",
    validation: { create: passthrough, update: passthrough },
    ...overrides,
  }
}

describe("defineProject entity configuration", () => {
  it("derives the module key from the entity name", () => {
    const project = createProject()

    expect(project.entity(productConfig()).moduleKey).toBe("product")
    expect(project.entity(productConfig({ name: "Task" })).moduleKey).toBe(
      "task"
    )
  })

  it("rejects entities without a name or without fields", () => {
    const project = createProject()

    expect(() => project.entity(productConfig({ name: "   " }))).toThrow(
      "Entity name is required"
    )
    expect(() => project.entity(productConfig({ fields: {} }))).toThrow(
      'Entity "Product" must declare fields.'
    )
  })

  it("applies project auth, scoping, and search defaults to definitions", () => {
    const project = createProject({ auth: { capabilityKey: "product:manage" } })

    const definition = project.entity(
      productConfig({
        searchable: ["name"],
        filterable: ["price"],
        listDefaults: { sortDesc: true },
      })
    )

    expect(definition.policy).toEqual({ customCapabilityKey: "product:manage" })
    expect(definition.tenantScoping).toEqual({ mode: "none", acknowledged: true })
    expect(definition.searchableColumns).toEqual(["name"])
    expect(definition.filterableColumns).toEqual(["price"])
    expect(definition.listDefaults).toEqual({ sortDesc: true })
    expect(definition.routes).toEqual({
      list: true,
      detail: true,
      create: true,
      update: true,
      delete: true,
    })
  })

  it("skips capability checks when project auth is disabled", () => {
    const project = createProject({ auth: false })

    expect(project.entity(productConfig()).policy).toEqual({
      skipCapabilityCheck: true,
    })
  })
})

describe("defineProject plugin", () => {
  it("registers CRUD routes for every enabled operation", async () => {
    const { entity, plugin } = createProject()
    entity(productConfig())

    const app = Fastify()
    await app.register(plugin())
    await app.ready()

    const routes = app.printRoutes()
    expect(routes).toContain("Product")

    const list = await app.inject({ method: "GET", url: "/api/Product" })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({ rows: [], rowCount: 0 })

    const detail = await app.inject({
      method: "GET",
      url: `/api/Product/${MISSING_ID}`,
    })
    expect(detail.statusCode).toBe(404)

    await app.close()
  })

  it("honours per-entity CRUD overrides", async () => {
    const { entity, plugin } = createProject()
    entity(productConfig({ crud: { update: false, delete: false } }))

    const app = Fastify()
    await app.register(plugin())
    await app.ready()

    expect(
      (await app.inject({ method: "GET", url: "/api/Product" })).statusCode
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/Product/row-1",
          payload: { name: "renamed" },
        })
      ).statusCode
    ).toBe(404)
    expect(
      (await app.inject({ method: "DELETE", url: "/api/Product/row-1" }))
        .statusCode
    ).toBe(404)

    await app.close()
  })

  it("creates a resource through the generated POST route", async () => {
    const { entity, plugin } = createProject()
    entity(productConfig())

    const app = Fastify()
    await app.register(plugin())
    await app.ready()

    const created = await app.inject({
      method: "POST",
      url: "/api/Product",
      payload: { name: "Desk", price: 120 },
    })

    expect(created.statusCode).toBeLessThan(300)

    const list = await app.inject({ method: "GET", url: "/api/Product" })
    expect(list.json()).toMatchObject({ rows: [{ name: "Desk", price: 120 }] })
    await app.close()
  })

  it("invokes custom route callbacks with handlers and runtime context", async () => {
    const routes = vi.fn<NonNullable<EntityConfig["routes"]>>()
    const { entity, plugin } = createProject()
    entity(productConfig({ routes }))

    const app = Fastify()
    await app.register(plugin())
    await app.ready()

    expect(routes).toHaveBeenCalledTimes(1)
    const [instance, handlers, context] = routes.mock.calls[0]!
    expect(instance).toBeTypeOf("object")
    expect(typeof handlers.list).toBe("function")
    expect(typeof handlers.create).toBe("function")
    expect(typeof context!.wrapFetchHandler).toBe("function")
    expect(typeof context!.runtime.createPersistence).toBe("function")
    expect(context!.definition.moduleKey).toBe("product")

    await app.close()
  })

  it("registers each entity exactly once per plugin", async () => {
    const { entity, plugin } = createProject()
    entity(productConfig())
    entity(productConfig({ name: "Order" }))

    const app = Fastify()
    await app.register(plugin())
    await app.ready()

    expect(
      (await app.inject({ method: "GET", url: "/api/Product" })).statusCode
    ).toBe(200)
    expect(
      (await app.inject({ method: "GET", url: "/api/Order" })).statusCode
    ).toBe(200)

    await app.close()
  })
})
