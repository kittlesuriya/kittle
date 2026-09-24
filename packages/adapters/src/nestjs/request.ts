import type { NestRequestLike } from "./types"

function headerEntries(
  request: NestRequestLike
): Array<[string, string | string[]]> {
  const source = request.headers ?? request.raw?.headers ?? {}
  return Object.entries(source).flatMap(([name, value]) =>
    value === undefined ? [] : [[name, value]]
  )
}

function resolveHost(request: NestRequestLike): string {
  return (
    request.get?.("host") ?? request.headers.host?.toString() ?? "localhost"
  )
}

/** Convert a Nest/Express/Fastify request into the standard Fetch request. */
export function toNestFetchRequest(request: NestRequestLike): Request {
  const protocol = request.protocol ?? "http"
  const path = request.originalUrl ?? request.url ?? "/"
  const headers = new Headers()

  for (const [name, value] of headerEntries(request)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }

  const method = request.method.toUpperCase()
  const init: RequestInit = { method, headers }

  if (method !== "GET" && method !== "HEAD" && request.body !== undefined) {
    init.body =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body)
    if (!headers.has("content-type"))
      headers.set("content-type", "application/json")
  }

  return new Request(`${protocol}://${resolveHost(request)}${path}`, init)
}
