import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import type { AnyMySqlTable } from "drizzle-orm/mysql-core"
import type { BrandedEntityDefinition } from "kittle-core/entity"
import { defineEntity } from "kittle-core/entity"
import type { ValidationSchema } from "kittle-core/ports"
import type { MySqlDatabaseLike } from "../drizzle-mysql/mysqlSession"
import type { DrizzleColumnMap } from "../drizzle-shared/predicateCompiler"
import {
  DrizzleEntityRegistry,
  createDrizzlePersistenceProvider,
} from "../drizzle-mysql/drizzlePersistenceProvider"
import { createCrudRuntime } from "../drizzle-mysql/createCrudRuntime"
import type { CrudRuntime } from "../http/CRUD"
import { CRUD } from "../http/CRUD"
import type { FrameworkAdapterDeps, FrameworkScope } from "../server"
import { registerCrudRoutes, type CrudRouteConfig } from "./registerCrudRoutes"
import { wrapFetchHandler } from "./plugin"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Project-wide defaults applied to every entity unless overridden. */
export interface ProjectConfig {
  /** Drizzle MySQL database instance. */
  db: MySqlDatabaseLike

  /** Resolves a FrameworkSession from an incoming request. */
  resolveSession: FrameworkAdapterDeps["resolveSession"]

  /** Scope for all entities. Defaults to "platform". */
  scope?: FrameworkScope

  /** URL prefix for all routes. Defaults to "". */
  prefix?: string

  /** Auth mode. `false` = skip capability checks. A string = custom capability key. Defaults to false. */
  auth?: boolean | { capabilityKey: string }

  /** Enable rate limiting for all entities. Defaults to false. */
  rateLimit?: boolean

  /** Tenant scoping mode. Defaults to "none". */
  tenantScoping?: "none" | "scoped"

  /** Default CRUD operations enabled for all entities. All default to true. */
  crud?: {
    list?: boolean
    detail?: boolean
    create?: boolean
    update?: boolean
    delete?: boolean
  }
}

/** Per-entity configuration. Only entity-specific details are required. */
export interface EntityConfig {
  /** Entity name (e.g., "Product"). Also used to derive the module key. */
  name: string

  /** Drizzle table definition. */
  table: AnyMySqlTable

  /** Column map linking entity fields to Drizzle table columns. */
  columnMap: DrizzleColumnMap

  /** Entity field definitions. */
  fields: Record<string, { type: "string" | "number" | "boolean" }>

  /** Version field for optimistic concurrency. Required if update/delete are enabled. */
  version?: string

  /** Primary key field name. Defaults to "id". */
  primaryKey?: string

  /** Validation schemas. */
  validation?: {
    /** Zod schema for create request body. */
    create?: ValidationSchema
    /** Zod schema for update request body. */
    update?: ValidationSchema
    /** Zod schema for list query parameters. */
    list?: ValidationSchema
  }

  /** CRUD operation overrides. Inherits from project config, override per-entity. */
  crud?: {
    list?: boolean
    detail?: boolean
    create?: boolean
    update?: boolean
    delete?: boolean
  }

  /** Columns searchable via the list endpoint's `search` query parameter. */
  searchable?: string[]

  /** Columns filterable via the list endpoint's `filter[field]=value` syntax. */
  filterable?: string[]

  /** Default sort column and direction for list queries. */
  listDefaults?: {
    sortColumn?: string
    sortDesc?: boolean
  }

  /**
   * Custom routes for this entity. Receives the Fastify instance and the
   * auto-generated CRUD Fetch handlers. Register any additional routes here.
   *
   * The `app` is the root Fastify instance — prefix is handled automatically
   * by the CRUD route registration.
   *
   * @example
   * ```ts
   * routes: (app, handlers) => {
   *   app.get("/products/:id/variants", async (request, reply) => {
   *     const { id } = request.params as { id: string }
   *     return reply.send(await fetchVariants(id))
   *   })
   * }
   * ```
   */
  routes?: (
    app: FastifyInstance,
    handlers: {
      list?: (request: Request, context?: { params?: Promise<unknown> }) => Promise<Response>
      detail?: (request: Request, params: Record<string, string>) => Promise<Response>
      create?: (request: Request, context?: { params?: Promise<unknown> }) => Promise<Response>
      update?: (request: Request, context?: { params?: Promise<unknown> }) => Promise<Response>
      delete?: (request: Request, context?: { params?: Promise<unknown> }) => Promise<Response>
    },
    context?: {
      runtime: CrudRuntime
      definition: BrandedEntityDefinition<any, any, any, any, any, any, any>
      wrapFetchHandler: typeof wrapFetchHandler
    }
  ) => void
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ResolvedEntity {
  entityConfig: EntityConfig
  moduleKey: string
  crudEnabled: Record<string, boolean>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  definition: BrandedEntityDefinition<any, any, any, any, any, any, any>
  customRoutesFn?: EntityConfig["routes"]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toModuleKey(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()
}

function resolveCrudRoutes(
  name: string,
  crud: Record<string, boolean>
): Record<string, CrudRouteConfig> {
  const base = `/${name}`
  const withId = `${base}/:id`
  const routes: Record<string, CrudRouteConfig> = {}

  if (crud.list !== false) routes.list = { method: "GET", path: base }
  if (crud.detail !== false) routes.detail = { method: "GET", path: withId }
  if (crud.create !== false) routes.create = { method: "POST", path: base }
  if (crud.update !== false) routes.update = { method: "PUT", path: withId }
  if (crud.delete !== false) routes.delete = { method: "DELETE", path: withId }

  return routes
}

// ---------------------------------------------------------------------------
// defineProject
// ---------------------------------------------------------------------------

/**
 * Creates a project-level wrapper that captures shared infrastructure once.
 *
 * Returns a bound `entity()` function for defining entities with minimal config,
 * and a `plugin()` function that generates a Fastify plugin registering all
 * entity CRUD routes.
 *
 * @example
 * ```ts
 * import { defineProject } from "kittle-adapters/fastify/mysql"
 *
 * const { entity, plugin } = defineProject({
 *   db,
 *   resolveSession: async ({ scope }) => ({
 *     scope,
 *     actor: { id: "system", type: scope, bypassAuthority: true },
 *     raw: null,
 *   }),
 *   scope: "platform",
 *   prefix: "/api",
 *   auth: false,
 * })
 *
 * const productDef = entity({
 *   name: "Product",
 *   table: products,
 *   columnMap: productColumnMap,
 *   fields: { id: { type: "string" }, name: { type: "string" }, version: { type: "number" } },
 *   version: "version",
 *   validation: { create: createProductSchema, update: updateProductSchema },
 * })
 *
 * await fastify.register(plugin())
 * ```
 */
export function defineProject(config: ProjectConfig) {
  const projectDefaults = {
    scope: (config.scope ?? "platform") as FrameworkScope,
    prefix: config.prefix ?? "",
    auth: config.auth ?? false,
    rateLimit: config.rateLimit ?? false,
    tenantScoping: (config.tenantScoping ?? "none") as "none" | "scoped",
    crud: {
      list: true,
      detail: true,
      create: true,
      update: true,
      delete: true,
      ...config.crud,
    },
  }

  const registeredEntities: ResolvedEntity[] = []

  /**
   * Define an entity with minimal config. Project defaults are applied
   * automatically — only entity-specific details are needed.
   */
  function entity(entityConfig: EntityConfig): BrandedEntityDefinition<any, any, any, any, any, any, any> {
    if (!entityConfig.name || entityConfig.name.trim() === "") {
      throw new Error("Entity name is required")
    }
    if (!entityConfig.fields || Object.keys(entityConfig.fields).length === 0) {
      throw new Error(`Entity "${entityConfig.name}" must declare fields.`)
    }

    const moduleKey = toModuleKey(entityConfig.name)

    // Merge project CRUD defaults with entity overrides
    const crudEnabled = { ...projectDefaults.crud, ...entityConfig.crud }

    // Build the full entity definition for defineEntity()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const definition = defineEntity({
      moduleKey,
      entity: {
        name: entityConfig.name,
        primaryKey: entityConfig.primaryKey ?? "id",
        ...(entityConfig.version
          ? { versionField: entityConfig.version }
          : {}),
        fields: entityConfig.fields as any,
      } as any,
      tenantScoping:
        projectDefaults.tenantScoping === "none"
          ? { mode: "none", acknowledged: true }
          : { mode: "scoped" },
      policy:
        typeof projectDefaults.auth === "object" && projectDefaults.auth !== null
          ? { customCapabilityKey: projectDefaults.auth.capabilityKey }
          : { skipCapabilityCheck: true },
      validation: {
        ...(entityConfig.validation?.create
          ? { createBody: entityConfig.validation.create }
          : {}),
        ...(entityConfig.validation?.update
          ? { updateBody: entityConfig.validation.update }
          : {}),
        ...(entityConfig.validation?.list
          ? { listQuery: entityConfig.validation.list }
          : {}),
      },
      routes: {
        list: crudEnabled.list !== false,
        detail: crudEnabled.detail !== false,
        create: crudEnabled.create !== false,
        update: crudEnabled.update !== false,
        delete: crudEnabled.delete !== false,
      },
      ...(entityConfig.searchable
        ? { searchableColumns: entityConfig.searchable }
        : {}),
      ...(entityConfig.filterable
        ? { filterableColumns: entityConfig.filterable }
        : {}),
      ...(entityConfig.listDefaults ? { listDefaults: entityConfig.listDefaults } : {}),
      audit: { enabled: false },
      cache: { enabled: false },
    })

    // Store registration for plugin()
    const resolved: ResolvedEntity = {
      entityConfig,
      moduleKey,
      crudEnabled,
      definition,
      customRoutesFn: entityConfig.routes,
    }
    registeredEntities.push(resolved)

    return definition
  }

  /**
   * Returns a Fastify plugin that registers CRUD routes for all entities
   * defined via `entity()`. Also invokes any custom `routes` callbacks
   * provided in entity configs.
   *
   * @example
   * ```ts
   * await fastify.register(plugin())
   * ```
   */
  function plugin(): FastifyPluginAsync {
    return async (fastify: FastifyInstance): Promise<void> => {
      // Build the entity registry with all registered entities
      const registry = new DrizzleEntityRegistry()
      for (const resolved of registeredEntities) {
        registry.register(
          resolved.definition.entity,
          resolved.entityConfig.table,
          resolved.entityConfig.columnMap
        )
      }

      // Create the persistence provider (shared across all entities)
      const interactiveProvider = createDrizzlePersistenceProvider({
        db: config.db,
        registry,
      })

      // Set up each entity
      for (const resolved of registeredEntities) {
        const routeMap = resolveCrudRoutes(
          resolved.entityConfig.name,
          resolved.crudEnabled
        )

        // Build the CRUD runtime for this entity
        const runtime = await createCrudRuntime({
          db: config.db,
          entity: resolved.definition.entity,
          table: resolved.entityConfig.table,
          columnMap: resolved.entityConfig.columnMap,
          resolveSession: config.resolveSession,
          scope: projectDefaults.scope,
        })

        // Generate Fetch-based CRUD handlers
        const handlers = CRUD(resolved.definition, runtime)

        // Register standard CRUD routes
        registerCrudRoutes({
          app: fastify,
          routes: routeMap,
          definition: resolved.definition,
          runtime,
          prefix: projectDefaults.prefix,
        })

        // Register custom routes if provided
        if (resolved.customRoutesFn) {
          resolved.customRoutesFn(fastify, handlers, {
            runtime,
            definition: resolved.definition,
            wrapFetchHandler,
          })
        }
      }
    }
  }

  return { entity, plugin }
}
