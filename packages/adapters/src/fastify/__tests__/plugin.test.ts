import { describe, expect, it, vi } from "vitest"
import { wrapFetchHandler, createFetchRouteOptions } from "../plugin"
import { sendFetchResponse } from "../reply"

function createMockReply() {
  const headers: Record<string, string> = {}
  const reply = {
    code: vi.fn().mockReturnThis(),
    header: vi.fn((key: string, value: string) => {
      headers[key] = value
      return reply
    }),
    send: vi.fn(),
    getHeaders: () => headers,
  }
  return reply
}

describe("wrapFetchHandler", () => {
  it("bridges a Fetch handler to Fastify", async () => {
    const handler = vi.fn(async (request: Request) => {
      return new Response(JSON.stringify({ method: request.method }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })

    const wrapped = wrapFetchHandler(handler)
    const reply = createMockReply()
    const request = {
      method: "GET",
      url: "/test",
      protocol: "http",
      hostname: "localhost",
      headers: {},
      raw: { push: vi.fn(), on: vi.fn() },
      params: {},
    }

    await wrapped(request as never, reply as never)
    expect(handler).toHaveBeenCalled()
    expect(reply.code).toHaveBeenCalledWith(200)
    expect(reply.send).toHaveBeenCalled()
  })

  it("passes params context to handler", async () => {
    const handler = vi.fn(async () => new Response("ok"))
    const wrapped = wrapFetchHandler(handler)
    const reply = createMockReply()
    const request = {
      method: "GET",
      url: "/test",
      protocol: "http",
      hostname: "localhost",
      headers: {},
      raw: { push: vi.fn(), on: vi.fn() },
      params: { id: "123" },
    }

    await wrapped(request as never, reply as never)
    expect(handler).toHaveBeenCalled()
    const [, context] = handler.mock.calls[0]!
    expect(context).toBeDefined()
    expect(context.params).toBeDefined()
  })

  it("handles error responses", async () => {
    const handler = vi.fn(async () => {
      return new Response("Not Found", { status: 404 })
    })

    const wrapped = wrapFetchHandler(handler)
    const reply = createMockReply()
    const request = {
      method: "GET",
      url: "/missing",
      protocol: "http",
      hostname: "localhost",
      headers: {},
      raw: { push: vi.fn(), on: vi.fn() },
      params: {},
    }

    await wrapped(request as never, reply as never)
    expect(reply.code).toHaveBeenCalledWith(404)
  })

  it("forwards headers from Fetch response", async () => {
    const handler = vi.fn(async () => {
      return new Response("ok", {
        status: 200,
        headers: { "x-request-id": "abc-123", "cache-control": "no-store" },
      })
    })

    const wrapped = wrapFetchHandler(handler)
    const reply = createMockReply()
    const request = {
      method: "GET",
      url: "/test",
      protocol: "http",
      hostname: "localhost",
      headers: {},
      raw: { push: vi.fn(), on: vi.fn() },
      params: {},
    }

    await wrapped(request as never, reply as never)
    expect(reply.header).toHaveBeenCalledWith("x-request-id", "abc-123")
    expect(reply.header).toHaveBeenCalledWith("cache-control", "no-store")
  })
})

describe("sendFetchResponse", () => {
  it("sends status code to reply", async () => {
    const reply = createMockReply()
    const response = new Response("ok", { status: 201 })
    await sendFetchResponse(reply as never, response)
    expect(reply.code).toHaveBeenCalledWith(201)
  })

  it("sends headers to reply", async () => {
    const reply = createMockReply()
    const response = new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain", "x-custom": "value" },
    })
    await sendFetchResponse(reply as never, response)
    expect(reply.header).toHaveBeenCalledWith("content-type", "text/plain")
    expect(reply.header).toHaveBeenCalledWith("x-custom", "value")
  })

  it("sends body buffer to reply", async () => {
    const reply = createMockReply()
    const body = JSON.stringify({ data: "test" })
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
    await sendFetchResponse(reply as never, response)
    expect(reply.send).toHaveBeenCalled()
    const sentBuffer = reply.send.mock.calls[0]![0] as Buffer
    expect(Buffer.isBuffer(sentBuffer)).toBe(true)
    expect(JSON.parse(sentBuffer.toString())).toEqual({ data: "test" })
  })
})

describe("createFetchRouteOptions", () => {
  it("returns route options with body disabled", () => {
    const options = createFetchRouteOptions()
    expect(options.schema?.body).toBe(false)
  })

  it("includes bodyLimit when specified", () => {
    const options = createFetchRouteOptions({ bodyMaxBytes: 1024 })
    expect(options.bodyLimit).toBe(1024)
  })

  it("does not include bodyLimit when not specified", () => {
    const options = createFetchRouteOptions()
    expect(options.bodyLimit).toBeUndefined()
  })
})
