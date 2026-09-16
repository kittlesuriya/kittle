import { describe, expect, it, vi } from "vitest"
import { PassThrough } from "stream"
import { toFetchRequest } from "../request"

function createFastifyRequest(overrides: {
  url?: string
  method?: string
  protocol?: string
  hostname?: string
  headers?: Record<string, string | string[] | undefined>
  body?: string | Buffer
} = {}) {
  const raw = new PassThrough() as import("http").IncomingMessage & {
    method: string
    url: string
    headers: Record<string, string | string[] | undefined>
  }
  raw.method = overrides.method ?? "GET"
  raw.url = overrides.url ?? "/test"
  raw.headers = overrides.headers ?? {}
  ;(raw as unknown as { socket: unknown }).socket = { remoteAddress: "127.0.0.1" }

  // Write body and end the stream so reads don't hang
  if (overrides.body) {
    const body =
      typeof overrides.body === "string"
        ? Buffer.from(overrides.body)
        : overrides.body
    raw.push(body)
  }
  raw.push(null) // Signal end of stream

  return {
    protocol: overrides.protocol ?? "http",
    hostname: overrides.hostname ?? "localhost:3000",
    url: overrides.url ?? "/test",
    method: overrides.method ?? "GET",
    headers: overrides.headers ?? {},
    raw,
    params: {},
    query: {},
  }
}

describe("toFetchRequest", () => {
  it("converts a basic GET request", async () => {
    const request = createFastifyRequest({
      url: "/api/items?page=1",
      method: "GET",
      headers: { accept: "application/json" },
    })
    const fetchRequest = await toFetchRequest(request as never)
    expect(fetchRequest.method).toBe("GET")
    expect(fetchRequest.url).toContain("/api/items?page=1")
    expect(fetchRequest.headers.get("accept")).toBe("application/json")
  })

  it("converts a POST request with body", async () => {
    const body = JSON.stringify({ name: "test" })
    const request = createFastifyRequest({
      url: "/api/items",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      },
      body,
    })
    const fetchRequest = await toFetchRequest(request as never)
    expect(fetchRequest.method).toBe("POST")
    expect(fetchRequest.headers.get("content-type")).toBe("application/json")
    const readBody = await fetchRequest.text()
    expect(readBody).toBe(body)
  })

  it("handles array headers", async () => {
    const request = createFastifyRequest({
      url: "/test",
      headers: { "x-custom": ["value1", "value2"] },
    })
    const fetchRequest = await toFetchRequest(request as never)
    const values = fetchRequest.headers.get("x-custom")
    expect(values).toContain("value1")
    expect(values).toContain("value2")
  })

  it("handles missing headers gracefully", async () => {
    const request = createFastifyRequest({ headers: {} })
    const fetchRequest = await toFetchRequest(request as never)
    expect(fetchRequest.method).toBe("GET")
  })

  it("constructs full URL with protocol and hostname", async () => {
    const request = createFastifyRequest({
      protocol: "https",
      hostname: "api.example.com",
      url: "/v1/items",
    })
    const fetchRequest = await toFetchRequest(request as never)
    expect(fetchRequest.url).toBe("https://api.example.com/v1/items")
  })

  it("skips body for GET requests", async () => {
    const request = createFastifyRequest({
      method: "GET",
      body: "should-be-ignored",
    })
    const fetchRequest = await toFetchRequest(request as never)
    expect(fetchRequest.method).toBe("GET")
  })

  it("skips body for HEAD requests", async () => {
    const request = createFastifyRequest({
      method: "HEAD",
      body: "should-be-ignored",
    })
    const fetchRequest = await toFetchRequest(request as never)
    expect(fetchRequest.method).toBe("HEAD")
  })

  it("converts PUT request with body", async () => {
    const body = JSON.stringify({ name: "updated" })
    const request = createFastifyRequest({
      url: "/api/items/1",
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    })
    const fetchRequest = await toFetchRequest(request as never)
    expect(fetchRequest.method).toBe("PUT")
    const readBody = await fetchRequest.text()
    expect(readBody).toBe(body)
  })

  it("converts DELETE request without body", async () => {
    const request = createFastifyRequest({
      url: "/api/items/1",
      method: "DELETE",
    })
    const fetchRequest = await toFetchRequest(request as never)
    expect(fetchRequest.method).toBe("DELETE")
    expect(fetchRequest.url).toContain("/api/items/1")
  })
})
