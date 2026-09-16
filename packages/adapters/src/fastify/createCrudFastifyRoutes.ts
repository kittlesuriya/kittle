import type { AnyMySqlTable } from "drizzle-orm/mysql-core"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import type { ValidationSchema } from "kittle-core/ports"
import { defineEntity } from "kittle-core/entity"
import type { MySqlDatabaseLike } from "../drizzle-mysql/mysqlSession"
import type { DrizzleColumnMap } from "../drizzle-mysql/drizzlePredicateCompiler"
import { createCrudRuntime } from "../drizzle-mysql/createCrudRuntime"
import { CRUD } from "../http/CRUD"
import type { CrudRuntime } from "../http/CRUD"
import type { CreateSimpleRuntimeOptions } from "../http/simpleRuntime"
import { wrapFetchHandler } from "./plugin"
import type { CrudRouteMap } from "./registerCrudRoutes"

/**
 * The CRUD pipeline's detail handler expects `(request, params)` directly,
 * but `wrapFetchHandler` passes `(request, context)` where
 * `context = { params: Promise<unknown> }`. This adapter bridges the gap.
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
 * Options for `createCrudFastifyRoutes` — a single-function API for
 * registering CRUD routes on a Fastify instance.
 */
export interface CrudFastifyRoutesOptions extends CreateSimpleRuntimeOptions {
  /** The Drizzle MySQL database instance. */
  db: MySqlDatabaseLike

  /** The Drizzle table definition. */
  table: AnyMySqlTable

  /** Column map linking entity fields to Drizzle table columns. */
  columnMap: DrizzleColumnMap

  /** Entity configuration. */
  entity: {
    /** Entity name (e.g., "Product"). */
    name: string
    /** Module key for ABAC/audit (e.g., "products"). */
    moduleKey: string
    /** Primary key field name. Defaults to "id". */
    primaryKey?: string
    /** Version field for optimistic concurrency. Required if update/delete routes are enabled. */
    versionField?: string
    /** Entity fields. Keys map to column names. */
    fields: Record<string, { type: "string" | "number" | "boolean" }>
  }

  /** Route configuration — single source of truth for paths and methods. */
  routes: CrudRouteMap

  /** Validation schemas. */
  validation?: {
    /** Zod schema for create request body. */
    createBody?: ValidationSchema
    /** Zod schema for update request body. */
    updateBody?: ValidationSchema
    /** Zod schema for list query parameters. */
    listQuery?: ValidationSchema
  }

  /** URL prefix prepended to all route paths. Defaults to "". */
  prefix?: string

  /** Columns searchable via the list endpoint's `search` query parameter. */
  searchableColumns?: string[]

  /** Columns filterable via the list endpoint's `filter[field]=value` syntax. */
  filterableColumns?: string[]

  /** Default sort column and direction for list queries. */
  listDefaults?: {
    sortColumn?: string
    sortDesc?: boolean
  }

  /** Optional namespace for the entity registry. */
  namespace?: string
}

/**
 * Creates a Fastify plugin that registers all CRUD routes for an entity.
 *
 * This is the single-function entry point for simple CRUD apps. It handles:
 * - Entity definition (via `defineEntity()`)
 * - Runtime creation (via `createCrudRuntime()`)
 * - Handler generation (via `CRUD()`)
 * - Route registration on Fastify
 *
 * @example
 * ```ts
 * import Fastify from "fastify"
 * import { createCrudFastifyRoutes } from "kittle-adapters/fastify"
 * import { db } from "./db"
 * import { products } from "./schema"
 * import { columnMap } from "./columnMap"
 *
 * const fastify = Fastify()
 *
 * fastify.register(createCrudFastifyRoutes({
 *   db,
 *   table: products,
 *   columnMap,
 *   entity: {
 *     name: "Product",
 *     moduleKey: "products",
 *     versionField: "version",
 *     fields: {
 *       id: { type: "string" },
 *       name: { type: "string" },
 *       price: { type: "string" },
 *       stock: { type: "number" },
 *       active: { type: "boolean" },
 *       version: { type: "number" },
 *     },
 *   },
 *   routes: {
 *     list:   { method: "GET",    path: "/products" },
 *     detail: { method: "GET",    path: "/products/:id" },
 *     create: { method: "POST",   path: "/products" },
 *     update: { method: "PUT",    path: "/products/:id" },
 *     delete: { method: "DELETE", path: "/products/:id" },
 *   },
 *   validation: {
 *     createBody: createProductSchema,
 *     updateBody: updateProductSchema,
 *   },
 *   resolveSession: async ({ scope }) => ({
 *     scope,
 *     actor: { id: "system", type: scope, bypassAuthority: true },
 *     raw: null,
 *   }),
 *   scope: "platform",
 * }))
 * ```
 */
export function createCrudFastifyRoutes(
  options: CrudFastifyRoutesOptions
): FastifyPluginAsync {
  return async (fastify: FastifyInstance): Promise<void> => {
    // Build the kittle entity definition from the simplified config.
    // Cast to any because our simplified entity config uses plain strings
    // while defineEntity's generics expect keyof T & string.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const definition = defineEntity({
      entity: {
        name: options.entity.name,
        primaryKey: options.entity.primaryKey ?? "id",
        ...(options.entity.versionField
          ? { versionField: options.entity.versionField }
          : {}),
        fields: options.entity.fields,
      } as any,
      moduleKey: options.entity.moduleKey,
      routes: {
        list: options.routes.list !== undefined,
        detail: options.routes.detail !== undefined,
        create: options.routes.create !== undefined,
        update: options.routes.update !== undefined,
        delete: options.routes.delete !== undefined,
      },
      policy: { skipCapabilityCheck: true },
      audit: { enabled: false },
      cache: { enabled: false },
      tenantScoping: { mode: "none", acknowledged: true },
      ...(options.entity.versionField
        ? { optimisticConcurrency: { versionField: options.entity.versionField } }
        : {}),
      ...(options.validation
        ? {
            validation: {
              ...(options.validation.createBody
                ? { createBody: options.validation.createBody }
                : {}),
              ...(options.validation.updateBody
                ? { updateBody: options.validation.updateBody }
                : {}),
              ...(options.validation.listQuery
                ? { listQuery: options.validation.listQuery }
                : {}),
            },
          }
        : {}),
      ...(options.searchableColumns
        ? { searchableColumns: options.searchableColumns }
        : {}),
      ...(options.filterableColumns
        ? { filterableColumns: options.filterableColumns }
        : {}),
      ...(options.listDefaults ? { listDefaults: options.listDefaults } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    // Create the CRUD runtime
    const scopeConfig = options.scope ?? "platform"
    const runtime: CrudRuntime = await createCrudRuntime({
      db: options.db,
      entity: definition.entity,
      table: options.table,
      columnMap: options.columnMap,
      resolveSession: options.resolveSession,
      scope: scopeConfig,
      ...(options.cacheAdapter ? { cacheAdapter: options.cacheAdapter } : {}),
      ...(options.namespace ? { namespace: options.namespace } : {}),
    })

    // Generate Fetch-based handlers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = CRUD(definition as any, runtime)

    // Register each route
    const prefix = options.prefix ?? ""
    for (const [key, route] of Object.entries(options.routes)) {
      if (!route) continue
      const r = route as { method: string; path: string }

      const method = r.method.toLowerCase() as
        | "get"
        | "post"
        | "put"
        | "delete"
        | "patch"
      const fullPath = `${prefix}${r.path}`

      // The detail handler has a different signature (request, params) vs
      // the standard (request, context) that wrapFetchHandler provides.
      if (key === "detail" && handlers.detail) {
        fastify[method](
          fullPath,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          wrapFetchHandler(adaptDetailHandler(handlers.detail as any))
        )
      } else {
        const handler = handlers[key as keyof typeof handlers]
        if (!handler) continue

        fastify[method](
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
}
