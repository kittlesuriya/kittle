import type { FastifyRequest } from "fastify"

/**
 * Converts a Fastify request to a standard Fetch API Request object.
 * This bridges Fastify's request model with the existing Fetch-based
 * HTTP/CRUD handlers in kittle-adapters.
 */
export async function toFetchRequest(request: FastifyRequest): Promise<Request> {
  // Build the full URL from Fastify's request properties
  const protocol = request.protocol
  const host = request.hostname
  const url = request.url

  const fullUrl = `${protocol}://${host}${url}`

  // Build headers from Fastify's request
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined) headers.append(key, v)
      }
    } else {
      headers.set(key, String(value))
    }
  }

  // Extract the HTTP method
  const method = (request.method ?? "GET").toUpperCase()

  // Build the Fetch Request init
  const init: RequestInit = {
    method,
    headers,
  }

  // For methods that can have a body, use Fastify's already-parsed body
  // (Fastify consumes the raw stream, so we can't read it again)
  if (method !== "GET" && method !== "HEAD") {
    if (request.body !== undefined && request.body !== null) {
      // Fastify already parsed the body — serialize it back
      init.body = typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body)
      // Ensure content-type is set for JSON bodies
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json")
      }
    } else {
      // Fallback: try reading from the raw stream (may be empty if Fastify consumed it)
      const chunks: Buffer[] = []
      for await (const chunk of request.raw) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
      }
      if (chunks.length > 0) {
        init.body = Buffer.concat(chunks)
      }
    }
  }

  return new Request(fullUrl, init)
}
