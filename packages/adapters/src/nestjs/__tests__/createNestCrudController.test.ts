import "reflect-metadata"
import { describe, expect, it, vi } from "vitest"
import { createNestCrudController } from "../createNestCrudController"
import { createNestCrudModule } from "../createNestCrudModule"
import type { NestRequestLike, NestResponseLike } from "../types"

function createHandlers() {
  return {
    list: vi.fn(
      async (_request: Request, _context?: { params?: Promise<unknown> }) =>
        new Response(JSON.stringify([{ id: "1" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    ),
    detail: vi.fn(
      async (_request: Request, _params: Record<string, string>) =>
        new Response(JSON.stringify({ id: "1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    ),
    create: vi.fn(
      async (_request: Request) => new Response("{}", { status: 201 })
    ),
    update: vi.fn(
      async (_request: Request) => new Response("{}", { status: 200 })
    ),
    delete: vi.fn(
      async (_request: Request) => new Response(null, { status: 204 })
    ),
  }
}

function createRequest(
  overrides: Partial<NestRequestLike> = {}
): NestRequestLike {
  return {
    method: "GET",
    protocol: "https",
    hostname: "example.test",
    headers: { host: "example.test" },
    originalUrl: "/tasks",
    params: { id: "task-1" },
    ...overrides,
  }
}

function createResponse() {
  const sent = {
    status: undefined as number | undefined,
    body: undefined as unknown,
    headers: [] as Array<[string, string]>,
  }
  const response: NestResponseLike = {
    status(statusCode: number) {
      sent.status = statusCode
      return response
    },
    setHeader(name: string, value: string) {
      sent.headers.push([name, value])
    },
    send(body?: unknown) {
      sent.body = body
      return undefined
    },
  }
  return { response, sent }
}

describe("createNestCrudController", () => {
  it("creates a controller class backed by the Fetch handlers", () => {
    const Controller = createNestCrudController({ handlers: createHandlers() })
    expect(typeof Controller).toBe("function")
    expect(new Controller()).toBeInstanceOf(Controller)
  })

  it("routes list requests through the Fetch handler", async () => {
    const handlers = createHandlers()
    const Controller = createNestCrudController({ handlers })
    const { response, sent } = createResponse()

    await new Controller().list(createRequest(), response)

    expect(handlers.list).toHaveBeenCalledTimes(1)
    expect(sent.status).toBe(200)
    expect(sent.body).toBeInstanceOf(Buffer)
    const [request, context] = handlers.list.mock.calls[0]!
    expect(request).toBeInstanceOf(Request)
    expect(await (context as { params?: Promise<unknown> }).params).toEqual({
      id: "task-1",
    })
  })

  it("passes params directly to the detail handler", async () => {
    const handlers = createHandlers()
    const Controller = createNestCrudController({ handlers })
    const { response, sent } = createResponse()

    await new Controller().detail(createRequest({ method: "GET" }), response)

    expect(handlers.detail).toHaveBeenCalledTimes(1)
    expect(sent.status).toBe(200)
    expect(handlers.detail.mock.calls[0]![1]).toEqual({ id: "task-1" })
  })

  it("drives create, replace, update, and delete handlers", async () => {
    const handlers = createHandlers()
    const Controller = createNestCrudController({ handlers })
    const controller = new Controller()

    const created = createResponse()
    await controller.create(
      createRequest({ method: "POST", originalUrl: "/tasks" }),
      created.response
    )
    expect(handlers.create).toHaveBeenCalledTimes(1)
    expect(created.sent.status).toBe(201)

    const replaced = createResponse()
    await controller.replace(createRequest({ method: "PUT" }), replaced.response)
    expect(handlers.update).toHaveBeenCalledTimes(1)
    expect(replaced.sent.status).toBe(200)

    const patched = createResponse()
    await controller.update(createRequest({ method: "PATCH" }), patched.response)
    expect(handlers.update).toHaveBeenCalledTimes(2)
    expect(patched.sent.status).toBe(200)

    const removed = createResponse()
    await controller.delete(
      createRequest({ method: "DELETE" }),
      removed.response
    )
    expect(handlers.delete).toHaveBeenCalledTimes(1)
    expect(removed.sent.status).toBe(204)
  })

  it("applies the controller prefix as Nest path metadata", () => {
    const Controller = createNestCrudController({
      handlers: createHandlers(),
      prefix: "/api/tasks",
    })
    expect(Reflect.getMetadata("path", Controller)).toBe("/api/tasks")
  })

  it("defaults the controller prefix to the root path", () => {
    const Controller = createNestCrudController({ handlers: createHandlers() })
    expect(Reflect.getMetadata("path", Controller)).toEqual("")
  })
})

describe("createNestCrudModule", () => {
  it("returns a dynamic module wrapping the generated controller", () => {
    const handlers = createHandlers()
    const module = createNestCrudModule({ handlers })

    expect(module.controllers).toHaveLength(1)
    expect(typeof module.module).toBe("function")
    expect(module.module.name).toBe("GeneratedCrudModule")
  })

  it("names the module when a module name is provided", () => {
    const module = createNestCrudModule({
      handlers: createHandlers(),
      moduleName: "TasksModule",
      prefix: "/tasks",
    })

    expect(module.module.name).toBe("TasksModule")
    expect(module.controllers).toHaveLength(1)
  })
})
