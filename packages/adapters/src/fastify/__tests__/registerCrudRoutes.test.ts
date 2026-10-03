import Fastify from "fastify"
import { int, mysqlTable, text } from "drizzle-orm/mysql-core"
import { describe, expect, it, vi } from "vitest"
import { defineEntity } from "kittle-core/entity"
import type { ValidationSchema } from "kittle-core/ports"
import { createCrudRuntime } from "../../drizzle-mysql/createCrudRuntime"
import { registerCrudRoutes, type CrudRouteMap } from "../registerCrudRoutes"

const tasks = mysqlTable("tasks", {
  id: text("id"),
  title: text("title"),
  version: int("version"),
})

const columnMap = { id: tasks.id, title: tasks.title, version: tasks.version }

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

function createMockDb(state = { rows: [] as Record<string, unknown>[] }) {
  return {
    select: vi.fn(() => createQueryChain(state.rows)),
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work(createMockDb(state))
    ),
  }
}

const definition = defineEntity({
  moduleKey: "task",
  entity: {
    name: "Task",
    primaryKey: "id",
    versionField: "version",
    fields: {
      id: { type: "string" },
      title: { type: "string" },
      version: { type: "number" },
    },
  } as never,
  tenantScoping: { mode: "none", acknowledged: true },
  policy: { skipCapabilityCheck: true },
  validation: { createBody: passthrough, updateBody: passthrough },
  routes: { list: true, detail: true, create: false, update: false },
  audit: { enabled: false },
  cache: { enabled: false },
})

async function createRuntime() {
  return createCrudRuntime({
    db: createMockDb() as never,
    entity: definition.entity,
    table: tasks,
    columnMap,
    resolveSession: (async ({ scope }: { scope: "platform" }) => ({
      scope,
      actor: { id: "user-1", type: scope, bypassAuthority: true },
      raw: null,
    })) as never,
    scope: "platform",
  })
}

describe("registerCrudRoutes", () => {
  it("registers list and detail routes under a prefix", async () => {
    const app = Fastify()
    registerCrudRoutes({
      app,
      routes: {
        list: { method: "GET", path: "/tasks" },
        detail: { method: "GET", path: "/tasks/:id" },
      },
      definition,
      runtime: await createRuntime(),
      prefix: "/api",
    })
    await app.ready()

    const list = await app.inject({ method: "GET", url: "/api/tasks" })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({ rows: [], rowCount: 0 })

    const detail = await app.inject({
      method: "GET",
      url: `/api/tasks/${MISSING_ID}`,
    })
    expect(detail.statusCode).toBe(404)

    await app.close()
  })

  it("skips entries that have no route config or no matching handler", async () => {
    const app = Fastify()
    registerCrudRoutes({
      app,
      routes: {
        list: { method: "GET", path: "/tasks" },
        detail: undefined,
        export: { method: "GET", path: "/tasks/export" },
      } as unknown as CrudRouteMap,
      definition,
      runtime: await createRuntime(),
    })
    await app.ready()

    expect(
      (await app.inject({ method: "GET", url: "/tasks" })).statusCode
    ).toBe(200)
    // `detail` had no route config, so the parameterised route is absent.
    expect(
      (await app.inject({ method: "GET", url: `/tasks/${MISSING_ID}` }))
        .statusCode
    ).toBe(404)
    // `export` has a route config but no CRUD handler to attach to it.
    expect(
      (await app.inject({ method: "GET", url: "/tasks/export" })).statusCode
    ).toBe(404)

    await app.close()
  })
})
