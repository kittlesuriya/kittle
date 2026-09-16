import type { FastifyInstance } from "fastify"
import type { BrandedEntityDefinition } from "kittle-core/entity"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { CRUD, type CrudRuntime } from "../http/CRUD"
import { wrapFetchHandler } from "./plugin"

/**
 * HTTP method and path for a single CRUD route.
 */
export interface CrudRouteConfig {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  path: string
}

/**
 * Route configuration keyed by CRUD operation name.
 */
export type CrudRouteMap = Record<string, CrudRouteConfig>

/**
 * Options for registering CRUD routes on a Fastify instance.
 */
export interface RegisterCrudRoutesOptions {
  /** The Fastify instance to register routes on. */
  app: FastifyInstance

  /** Route configuration mapping operation names to method+path. */
  routes: CrudRouteMap

  /** The branded entity definition (from `defineEntity()`). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  definition: BrandedEntityDefinition<any, any, any, any, any, any, any>

  /** The CRUD runtime (from `createCrudRuntime` or `createSimpleRuntime`). */
  runtime: CrudRuntime

  /**
   * Optional URL prefix prepended to all route paths.
   * @example "/api"
   */
  prefix?: string
}

/**
 * The CRUD pipeline's detail handler expects `(request, params)` directly,
 * but `wrapFetchHandler` passes `(request, context)` where
 * `context = { params: Promise<unknown> }`. This adapter bridges the gap
 * by unwrapping `context.params` and passing it directly to the handler.
 */
function adaptDetailHandler(
  handler: (request: Request, params: Record<string, string>) => Promise<Response>
) {
  return async (
    request: Request,
    context?: { params?: Promise<unknown> }
  ): Promise<Response> => {
    const params = (await context?.params) as Record<string, string> | undefined
    return handler(request, params ?? {})
  }
}

/**
 * Automatically registers CRUD routes on a Fastify instance.
 *
 * Reads route paths and methods from the provided route config,
 * calls `CRUD()` to generate Fetch-based handlers, wraps each
 * with `wrapFetchHandler()`, and registers them on Fastify.
 *
 * This eliminates the need to manually list each route — the route
 * config is the single source of truth.
 *
 * @example
 * ```ts
 * import { registerCrudRoutes } from "kittle-adapters/fastify"
 *
 * const productRoutes = {
 *   list:   { method: "GET",    path: "/products" },
 *   detail: { method: "GET",    path: "/products/:id" },
 *   create: { method: "POST",   path: "/products" },
 *   update: { method: "PUT",    path: "/products/:id" },
 *   delete: { method: "DELETE", path: "/products/:id" },
 * } as const
 *
 * registerCrudRoutes({
 *   app: fastify,
 *   routes: productRoutes,
 *   definition: productDefinition,
 *   runtime,
 *   prefix: "/api",
 * })
 * ```
 */
export function registerCrudRoutes(
  options: RegisterCrudRoutesOptions
): void {
  const { app, routes, definition, runtime, prefix = "" } = options

  // Generate Fetch-based handlers from the entity definition + runtime
  const handlers = CRUD(definition, runtime)

  // Register each route on the Fastify instance
  for (const [key, route] of Object.entries(routes)) {
    if (!route) continue

    const method = route.method.toLowerCase() as
      | "get"
      | "post"
      | "put"
      | "delete"
      | "patch"
    const fullPath = `${prefix}${route.path}`

    // The detail handler has a different signature (request, params) vs
    // the standard (request, context) that wrapFetchHandler provides.
    // Adapt it by unwrapping context.params.
    if (key === "detail" && handlers.detail) {
      app[method](
        fullPath,
        wrapFetchHandler(adaptDetailHandler(handlers.detail as any))
      )
    } else {
      const handler = handlers[key as keyof typeof handlers]
      if (!handler) continue

      app[method](
        fullPath,
        wrapFetchHandler(
          handler as (
            request: Request,
            context?: { params?: Promise<unknown> }
          ) => Promise<Response>
        )
      )
    }
  }
}
