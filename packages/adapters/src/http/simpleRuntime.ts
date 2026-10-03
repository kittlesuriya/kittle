/* eslint-disable @typescript-eslint/require-await */
import { bindAbacSecurityDigest } from "kittle-core/domain"
import type { CacheAdapter, CacheMode } from "kittle-core/cache"
import type { FrameworkAdapterDeps, FrameworkScope } from "../server"
import type { CrudRuntime } from "./CRUD"
import type { CrudScopeConfig } from "./createFrameworkWriteHandler"
import { resolveRuntimeCacheAdapter } from "./runtimeCache"

export type { CrudRuntime } from "./CRUD"

/**
 * Options for creating a simple CRUD runtime.
 */
export interface CreateSimpleRuntimeOptions {
  /**
   * Resolves a FrameworkSession from an incoming request.
   * For "public" scope, can return `{ scope: "public", actor: null, raw: null }`.
   * For "tenant"/"platform" scope, must return a session with a non-null actor.
   */
  resolveSession: FrameworkAdapterDeps["resolveSession"]

  /**
   * Scope configuration. Accepts either a full CrudScopeConfig or just
   * a scope string ("public" | "tenant" | "platform") which is expanded
   * with sensible defaults.
   *
   * Defaults to "public" with sessionRequired=false.
   */
  scope?: CrudScopeConfig | FrameworkScope

  /**
   * Custom cache adapter. Defaults to a no-op cache, or to one shared
   * process-local `InMemoryCacheAdapter` when `cacheMode` is `inMemory`.
   */
  cacheAdapter?: CacheAdapter
  /** Use inMemory only when all cache readers and writers run in this JS process. */
  cacheMode?: CacheMode
}

/**
 * Creates the enterprise-stub adapter dependencies used by the CRUD pipeline.
 * Used internally by both `createSimpleRuntime` and `createCrudRuntime`.
 */
export async function createStubAdapterDeps(
  resolveSession: FrameworkAdapterDeps["resolveSession"],
  scopeConfig: CrudScopeConfig
): Promise<FrameworkAdapterDeps> {
  // Pre-build a stub ABAC bundle (empty policies, deny-by-default).
  // Required by the write pipeline even when skipCapabilityCheck=true.
  const stubBundle = await bindAbacSecurityDigest({
    mode: scopeConfig.scope === "public" ? "platform" : scopeConfig.scope,
    moduleKey: "__simple_runtime_stub__",
    policies: [],
    context: {},
    defaultEffect: "deny",
    fieldCatalog: {},
  })

  return {
    assertValidCsrf() {
      // No-op for simple apps
    },
    async resolveSession({ scope, request }) {
      return resolveSession({ scope, request })
    },
    hasCapability() {
      return true
    },
    async resolveAbacBundle() {
      return stubBundle
    },
    assertModuleEnabled() {
      // No-op for simple apps
    },
    assertModuleActionEnabled() {
      // No-op for simple apps
    },
    assertModuleCapabilityEnabled() {
      // No-op for simple apps
    },
    isOwnerBypass() {
      return true
    },
  }
}

/**
 * Resolves a CrudScopeConfig from a scope string or full config.
 */
export function resolveScopeConfig(
  scope?: CrudScopeConfig | FrameworkScope
): CrudScopeConfig {
  if (typeof scope === "string") {
    return {
      scope,
      sessionRequired: false,
      csrfRequired: false,
      idempotency: { required: false },
    }
  }
  return (
    scope ?? {
      scope: "public",
      sessionRequired: false,
      csrfRequired: false,
      idempotency: { required: false },
    }
  )
}

/**
 * Creates a CrudRuntime with sensible defaults for simple applications.
 *
 * Stubs out enterprise features (CSRF, ABAC, capabilities, module assertions)
 * so that `CRUD()` can be called without providing a full enterprise runtime.
 *
 * Does NOT provide `createPersistence` — use `createCrudRuntime` from the
 * database-specific adapter (e.g. `kittle-adapters/drizzle-mysql`) instead.
 *
 * @example
 * ```ts
 * import { createSimpleRuntime } from "kittle-adapters/http"
 * import { CRUD } from "kittle-adapters/http"
 *
 * const runtime = await createSimpleRuntime({
 *   resolveSession: async ({ scope }) => {
 *     if (scope === "public") return { scope: "public", actor: null, raw: null }
 *     return { scope, actor: { id: "user-1", type: scope }, raw: null }
 *   },
 *   scope: "public",
 * })
 *
 * // Override createPersistence with your database adapter
 * runtime.createPersistence = (session) => myPersistenceProvider(session)
 *
 * const handlers = CRUD(entityDefinition, runtime)
 * ```
 */
export async function createSimpleRuntime(
  options: CreateSimpleRuntimeOptions
): Promise<CrudRuntime> {
  const scopeConfig = resolveScopeConfig(options.scope)
  const adapterDeps = await createStubAdapterDeps(
    options.resolveSession,
    scopeConfig
  )
  const cacheAdapter = resolveRuntimeCacheAdapter(options)

  return {
    adapterDeps,
    scope: scopeConfig,
    createPersistence: () => {
      throw new Error(
        "createSimpleRuntime does not provide createPersistence. " +
          "Use createCrudRuntime from kittle-adapters/drizzle-mysql, " +
          "or override createPersistence on the returned runtime."
      )
    },
    getCacheAdapter: async () => cacheAdapter,
    ...(options.cacheMode ? { cacheMode: options.cacheMode } : {}),
  }
}
