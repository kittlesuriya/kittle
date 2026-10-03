import { describe, expect, it, vi } from "vitest"
import { int, mysqlTable, text } from "drizzle-orm/mysql-core"
import { defineEntity } from "kittle-core/entity"
import type {
  EntityDescriptor,
  ValidationSchema,
} from "kittle-core/ports"
import { createCrudRuntime } from "../createCrudRuntime"
import { CRUD } from "../../http/CRUD"

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

const definition = defineEntity({
  moduleKey: "product",
  entity: {
    name: "Product",
    primaryKey: "id",
    versionField: "version",
    fields: {
      id: { type: "string" },
      name: { type: "string" },
      price: { type: "number" },
      version: { type: "number" },
    },
  },
  tenantScoping: { mode: "none", acknowledged: true },
  policy: { skipCapabilityCheck: true },
  validation: { createBody: passthrough, updateBody: passthrough },
  routes: { list: true, detail: true, create: true, update: true, delete: true },
  audit: { enabled: false },
  cache: { enabled: false },
})

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

async function createRuntime() {
  return createCrudRuntime({
    db: createMockDb() as never,
    entity: definition.entity as unknown as EntityDescriptor<unknown>,
    table: products,
    columnMap,
    resolveSession: (async ({ scope }: { scope: "platform" }) => ({
      scope,
      actor: { id: "user-1", type: scope, bypassAuthority: true },
      raw: null,
    })) as never,
    scope: "platform",
  })
}

describe("createCrudRuntime (MySQL)", () => {
  it("wires scope, persistence, and cache adapters for the entity", async () => {
    const runtime = await createRuntime()

    expect(runtime.scope).toMatchObject({ scope: "platform" })
    expect(typeof runtime.createPersistence).toBe("function")
    expect(runtime.cacheMode).toBeUndefined()
    await expect(runtime.getCacheAdapter()).resolves.toBeDefined()

    const session = {
      scope: "platform" as const,
      actor: { id: "user-1", type: "platform" as const },
      raw: null,
    }
    expect(runtime.createPersistence(session)).toMatchObject({
      dialect: "mysql",
    })
  })

  it("builds CRUD handlers that list and create through the mock db", async () => {
    const reportError = vi.fn()
    const runtime = { ...(await createRuntime()), reportError }
    const handlers = CRUD(definition, runtime)
    const url = "http://localhost/api/Product"

    const list = await handlers.list(new Request(url, { method: "GET" }))
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({ rows: [], rowCount: 0 })

    const created = await handlers.create(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Desk", price: 120 }),
      })
    )
    expect(created.status).toBeLessThan(300)

    const afterCreate = await handlers.list(new Request(url, { method: "GET" }))
    expect(await afterCreate.json()).toMatchObject({
      rows: [{ name: "Desk", price: 120 }],
    })
    expect(reportError).not.toHaveBeenCalled()
  })
})
