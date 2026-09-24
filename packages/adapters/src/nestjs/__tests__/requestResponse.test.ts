import { describe, expect, it, vi } from "vitest"
import { toNestFetchRequest } from "../request"
import { sendNestFetchResponse } from "../response"

describe("NestJS Fetch bridge", () => {
  it("preserves URL, query, headers, and parsed JSON bodies", async () => {
    const request = toNestFetchRequest({
      method: "POST",
      protocol: "https",
      headers: {
        host: "example.test",
        "x-request-id": "req-1",
      },
      originalUrl: "/tasks?status=open",
      body: { title: "Ship" },
    })

    expect(request.url).toBe("https://example.test/tasks?status=open")
    expect(request.headers.get("x-request-id")).toBe("req-1")
    expect(request.headers.get("content-type")).toBe("application/json")
    await expect(request.json()).resolves.toEqual({ title: "Ship" })
  })

  it("sends status, headers, and body through an Express-like reply", async () => {
    const status = vi.fn().mockReturnThis()
    const setHeader = vi.fn()
    const send = vi.fn()

    await sendNestFetchResponse(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
      { status, setHeader, send }
    )

    expect(status).toHaveBeenCalledWith(201)
    expect(setHeader).toHaveBeenCalledWith("content-type", "application/json")
    expect(Buffer.isBuffer(send.mock.calls[0]?.[0])).toBe(true)
  })

  it("supports the Fastify-style code and header methods", async () => {
    const code = vi.fn().mockReturnThis()
    const header = vi.fn().mockReturnThis()
    const send = vi.fn()

    await sendNestFetchResponse(new Response(null, { status: 204 }), {
      code,
      header,
      send,
    })

    expect(code).toHaveBeenCalledWith(204)
    expect(send).toHaveBeenCalled()
  })
})
