import Fastify from "fastify"
import { int, mysqlTable, text } from "drizzle-orm/mysql-core"
import { z } from "zod"
import { describe, expect, it, vi } from "vitest"
import type { ValidationSchema } from "kittle-core/ports"
import { InMemoryCacheAdapter } from "../../cache"
import { createCrudFastifyRoutes } from "../createCrudFastifyRoutes"
import type { CrudRouteMap } from "../registerCrudRoutes"

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

function createQueryChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(rows).then(onFulfilled, onRejected),
  }
  for (const method of ["from", "where", "orderBy", "limit", "offset"]) {
    chain[method] = vi.fn(() => chain)
  }
  return chain
}

/** In-memory Drizzle MySQL stand-in that supports read-after-insert. */
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
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work(createMockDb(state))
    ),
  }
}

const resolveSession = (async ({ scope }: { scope: "platform" }) => ({
  scope,
  actor: { id: "user-1", type: scope, bypassAuthority: true },
  raw: null,
})) as never

const allRoutes: CrudRouteMap = {
  list: { method: "GET", path: "/products" },
  detail: { method: "GET", path: "/products/:id" },
  create: { method: "POST", path: "/products" },
  update: { method: "PUT", path: "/products/:id" },
  delete: { method: "DELETE", path: "/products/:id" },
}

const entity = {
  name: "Product",
  moduleKey: "product",
  versionField: "version",
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    price: { type: "number" as const },
    version: { type: "number" as const },
  },
}

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    db: createMockDb() as never,
    table: products,
    columnMap,
    entity,
    routes: allRoutes,
    validation: { createBody: passthrough, updateBody: passthrough },
    resolveSession,
    prefix: "/api",
    ...overrides,
  }
}

async function buildApp(options: Record<string, unknown>) {
  const app = Fastify()
  await app.register(createCrudFastifyRoutes(options as never))
  await app.ready()
  return app
}

describe("createCrudFastifyRoutes", () => {
  it("registers every configured route behind the URL prefix", async () => {
    const app = await buildApp(baseOptions())

    const list = await app.inject({ method: "GET", url: "/api/products" })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({ rows: [], rowCount: 0 })

    const detail = await app.inject({
      method: "GET",
      url: `/api/products/${MISSING_ID}`,
    })
    expect(detail.statusCode).toBe(404)

    const created = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "Desk", price: 120 },
    })
    expect(created.statusCode).toBeLessThan(300)

    const afterCreate = await app.inject({
      method: "GET",
      url: "/api/products",
    })
    expect(afterCreate.json()).toMatchObject({
      rows: [{ name: "Desk", price: 120 }],
    })

    await app.close()
  })

  it("only registers the routes present in the route map", async () => {
    const app = await buildApp(
      baseOptions({
        prefix: undefined,
        routes: {
          list: { method: "GET", path: "/products" },
          detail: { method: "GET", path: "/products/:id" },
          create: { method: "POST", path: "/products" },
        },
        entity: { ...entity, versionField: undefined },
      })
    )

    expect(
      (await app.inject({ method: "GET", url: "/products" })).statusCode
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/products/${MISSING_ID}`,
          payload: { name: "renamed" },
        })
      ).statusCode
    ).toBe(404)
    expect(
      (await app.inject({ method: "DELETE", url: "/products/x" })).statusCode
    ).toBe(404)

    await app.close()
  })

  it("skips route entries that have no matching CRUD handler", async () => {
    const app = await buildApp(
      baseOptions({
        routes: {
          list: { method: "GET", path: "/products" },
          create: undefined,
          export: { method: "GET", path: "/products/export" },
        } as unknown as CrudRouteMap,
      })
    )

    expect(
      (await app.inject({ method: "GET", url: "/api/products" })).statusCode
    ).toBe(200)
    expect(
      (await app.inject({ method: "GET", url: "/api/products/export" }))
        .statusCode
    ).toBe(404)

    await app.close()
  })

  it("applies list query validation, search, filter, and default sort options", async () => {
    const app = await buildApp(
      baseOptions({
        searchableColumns: ["name"],
        filterableColumns: ["price"],
        listDefaults: { sortDesc: true },
        validation: {
          createBody: passthrough,
          updateBody: passthrough,
          listQuery: z.object({ limit: z.string().regex(/^\d+$/) }),
        },
      })
    )

    const valid = await app.inject({
      method: "GET",
      url: "/api/products?limit=10&search=desk&filter[price]=120",
    })
    expect(valid.statusCode).toBe(200)

    const invalid = await app.inject({
      method: "GET",
      url: "/api/products?limit=not-a-number",
    })
    expect(invalid.statusCode).toBe(400)

    await app.close()
  })

  it("accepts a custom cache adapter and public scope", async () => {
    const app = await buildApp(
      baseOptions({
        cacheAdapter: new InMemoryCacheAdapter(),
        scope: "public",
        resolveSession: async () => ({
          scope: "public",
          actor: null,
          raw: null,
        }),
      })
    )

    const list = await app.inject({ method: "GET", url: "/api/products" })
    expect(list.statusCode).toBe(200)

    await app.close()
  })
})
