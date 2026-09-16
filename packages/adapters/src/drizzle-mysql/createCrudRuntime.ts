import type { AnyMySqlTable } from "drizzle-orm/mysql-core"
import type { EntityDescriptor, PersistenceProvider } from "kittle-core/ports"
import type { FrameworkSession } from "../server"
import type { MySqlDatabaseLike } from "./mysqlSession"
import {
  createDrizzlePersistenceProvider,
  DrizzleEntityRegistry,
} from "./drizzlePersistenceProvider"
import type { DrizzleColumnMap } from "./drizzlePredicateCompiler"
import type {
  CreateSimpleRuntimeOptions,
  CrudRuntime,
} from "../http/simpleRuntime"
import {
  createStubAdapterDeps,
  resolveScopeConfig,
} from "../http/simpleRuntime"

/** No-op cache adapter for apps that don't use kittle's cache layer. */
const noopCache = {
  async get() { return undefined },
  async set() {},
  async delete() { return false },
  async has() { return false },
  async clear() {},
  async addToTag() {},
  async getTagKeys() { return [] },
  async deleteTag() {},
}

/**
 * Options for creating a CRUD runtime backed by Drizzle MySQL.
 */
export interface CreateCrudRuntimeOptions extends CreateSimpleRuntimeOptions {
  /** The Drizzle MySQL database instance. */
  db: MySqlDatabaseLike

  /** The entity descriptor (from `defineEntity()`). */
  entity: EntityDescriptor<unknown>

  /** The Drizzle table definition. */
  table: AnyMySqlTable

  /** Column map linking entity fields to Drizzle table columns. */
  columnMap: DrizzleColumnMap

  /** Optional namespace for the entity registry. */
  namespace?: string
}

/**
 * Creates a complete CrudRuntime backed by Drizzle MySQL.
 *
 * This is the recommended way to create a runtime for simple CRUD apps.
 * It wires up:
 * - Session resolution (via the provided `resolveSession` callback)
 * - Persistence (via Drizzle MySQL)
 * - Cache (no-op by default)
 * - Enterprise stubs (CSRF, ABAC, capabilities, module assertions)
 *
 * @example
 * ```ts
 * import { createCrudRuntime } from "kittle-adapters/drizzle-mysql"
 * import { CRUD } from "kittle-adapters/http"
 *
 * const runtime = await createCrudRuntime({
 *   db,
 *   entity: productDefinition.entity,
 *   table: products,
 *   columnMap,
 *   resolveSession: async ({ scope }) => {
 *     if (scope === "public") return { scope: "public", actor: null, raw: null }
 *     return { scope, actor: { id: "user-1", type: scope }, raw: null }
 *   },
 *   scope: "public",
 * })
 *
 * const handlers = CRUD(productDefinition, runtime)
 * ```
 */
export async function createCrudRuntime(
  options: CreateCrudRuntimeOptions
): Promise<CrudRuntime> {
  const scopeConfig = resolveScopeConfig(options.scope)
  const adapterDeps = await createStubAdapterDeps(
    options.resolveSession,
    scopeConfig
  )

  // Build a single-entity registry for the persistence provider
  const registry = new DrizzleEntityRegistry()
  registry.register(
    options.entity,
    options.table,
    options.columnMap,
    options.namespace
  )

  const interactiveProvider = createDrizzlePersistenceProvider({
    db: options.db,
    registry,
  })

  // The CRUD pipeline calls createPersistence(session) to get a provider
  // scoped to the request. For a simple single-connection app, we return
  // the same provider regardless of session.
  const createPersistence = (_session: FrameworkSession): PersistenceProvider =>
    interactiveProvider as unknown as PersistenceProvider

  return {
    adapterDeps,
    scope: scopeConfig,
    createPersistence,
    getCacheAdapter: async () => options.cacheAdapter ?? noopCache,
  }
}
