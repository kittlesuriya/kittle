import { ConfigurationError, ValidationError } from "../foundation/errors"
import { assertPredicateNode } from "../domain/predicate"
import type {
  CrudRouteKey,
  EntityDefinitionInput,
  EntityRouteConfig,
} from "./defineEntity"
import type { RateLimitConfig, RateLimitPolicy } from "../rate-limit"
import { isRuntimeCapability } from "../ports/capabilities"
import {
  assertCapabilityConfigValid,
  resolveCapabilityKey,
} from "./capabilityCheck"

function routeRequires(route: CrudRouteKey, routes: EntityRouteConfig) {
  return routes[route] !== false
}

export function validateEntity<
  TRow,
  TCreateBody = TRow,
  TUpdateBody = Partial<TRow>,
  TListRow = TRow,
  TDetailRow = TRow,
  TIdParams = unknown,
  TListQuery = unknown,
>(
  input: EntityDefinitionInput<
    TRow,
    TCreateBody,
    TUpdateBody,
    TListRow,
    TDetailRow,
    TIdParams,
    TListQuery
  >,
  routes: EntityRouteConfig
): void {
  const entityName = input.entity.name
  const fields = input.entity.fields
  const fieldNames = new Set(
    fields && typeof fields === "object" ? Object.keys(fields) : []
  )
  const requireText = (value: unknown, label: string) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid ${label}.`
      )
    }
  }
  const requireField = (value: unknown, label: string) => {
    requireText(value, label)
    if (!fieldNames.has(String(value))) {
      throw new ConfigurationError(
        `Entity "${entityName}" references unknown ${label} "${String(value)}".`
      )
    }
  }
  const validateFieldList = (
    values: readonly string[] | undefined,
    label: string
  ) => {
    if (!values) return
    if (new Set(values).size !== values.length) {
      throw new ConfigurationError(
        `Entity "${entityName}" has duplicate ${label}.`
      )
    }
    for (const value of values) requireField(value, `${label} field`)
  }

  if (
    !/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/.test(input.moduleKey)
  ) {
    throw new ConfigurationError(
      `Entity "${entityName}" has an invalid module key.`
    )
  }

  requireText(entityName, "name")
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(entityName)) {
    throw new ConfigurationError(`Entity "${entityName}" has an invalid name.`)
  }
  if (!fields || Object.keys(fields).length === 0) {
    throw new ConfigurationError(`Entity "${entityName}" must declare fields.`)
  }

  // P2-05: durability — every field descriptor must declare a valid type/format
  const ALLOWED_FIELD_TYPES = new Set([
    "string",
    "number",
    "boolean",
    "date",
    "json",
  ])
  const ALLOWED_FIELD_FORMATS = new Set([
    "text",
    "email",
    "phone",
    "date",
    "identifier",
    "json",
  ])
  for (const [fieldName, descriptor] of Object.entries(
    fields as Record<string, unknown>
  )) {
    if (
      !descriptor ||
      typeof descriptor !== "object" ||
      Array.isArray(descriptor)
    ) {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid field descriptor for "${fieldName}".`
      )
    }
    const desc = descriptor as {
      type?: unknown
      nullable?: unknown
      format?: unknown
    }
    if (typeof desc.type !== "string" || !ALLOWED_FIELD_TYPES.has(desc.type)) {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid field type for "${fieldName}".`
      )
    }
    if (desc.nullable !== undefined && typeof desc.nullable !== "boolean") {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid nullable flag for "${fieldName}".`
      )
    }
    if (desc.format !== undefined) {
      if (
        typeof desc.format !== "string" ||
        !ALLOWED_FIELD_FORMATS.has(desc.format)
      ) {
        throw new ConfigurationError(
          `Entity "${entityName}" has an invalid field format for "${fieldName}".`
        )
      }
    }
  }

  requireField(input.entity.primaryKey, "primary key")
  if (input.entity.tenantField)
    requireField(input.entity.tenantField, "tenant field")
  if (input.entity.versionField !== undefined) {
    requireField(input.entity.versionField, "version field")
    if (fields[input.entity.versionField]?.type !== "number") {
      throw new ConfigurationError(
        `Entity "${entityName}" requires version field "${String(input.entity.versionField)}" to have type "number".`
      )
    }
  }
  validateFieldList(input.entity.immutableFields, "immutable fields")
  validateFieldList(input.searchableColumns, "searchable")
  validateFieldList(input.filterableColumns, "filterable")
  validateFieldList(input.sortableColumns, "sortable")

  if (
    input.tenantScoping.mode === "none" &&
    input.tenantScoping.acknowledged !== true
  ) {
    throw new ConfigurationError(
      `Entity "${entityName}" must acknowledge tenantScoping mode "none".`
    )
  }

  // scopeFilter is consumed by the HTTP CRUD adapters (buildStructuralScope):
  // a malformed filter must fail here, not as a downstream TypeError at
  // request time. Validated whenever present, regardless of mode.
  const tenantScoping = input.tenantScoping as {
    mode: string
    scopeFilter?: unknown
  }
  if (tenantScoping.scopeFilter !== undefined) {
    try {
      assertPredicateNode(tenantScoping.scopeFilter)
    } catch (error) {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid tenantScoping scopeFilter.`,
        { cause: error instanceof Error ? error.message : String(error) }
      )
    }
  }

  const policy = input.policy
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new ConfigurationError(
      `Entity "${entityName}" has an invalid capability configuration.`
    )
  }
  assertCapabilityConfigValid(policy)
  const resolvedCapability = resolveCapabilityKey(policy)
  if (resolvedCapability.enabled && resolvedCapability.key !== undefined) {
    if (
      isRuntimeCapability(resolvedCapability.key) ||
      resolvedCapability.key === "bypassAuthority"
    ) {
      throw new ConfigurationError(
        `Entity "${entityName}" declares capability key "${resolvedCapability.key}" which collides with a framework-reserved capability name.`
      )
    }
  }

  if (input.listDefaults) {
    if (input.listDefaults.sortColumn !== undefined) {
      requireField(input.listDefaults.sortColumn, "default sort")
      if (
        input.sortableColumns &&
        !input.sortableColumns.includes(input.listDefaults.sortColumn)
      ) {
        throw new ValidationError(
          `Entity "${entityName}" default sort column "${input.listDefaults.sortColumn}" must be declared in sortableColumns.`
        )
      }
    }
    if (
      input.listDefaults.sortDesc !== undefined &&
      typeof input.listDefaults.sortDesc !== "boolean"
    ) {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid default sort direction.`
      )
    }
  }

  if (input.optimisticConcurrency) {
    const concurrency = input.optimisticConcurrency
    const concurrencyVersionField =
      concurrency.versionField ?? input.entity.versionField
    requireField(concurrencyVersionField, "concurrency version")
    if (
      fields[concurrencyVersionField as keyof typeof fields]?.type !== "number"
    ) {
      throw new ConfigurationError(
        `Entity "${entityName}" requires concurrency version field "${String(concurrencyVersionField)}" to have type "number".`
      )
    }
    if (
      concurrency.versionField !== undefined &&
      input.entity.versionField !== undefined &&
      concurrency.versionField !== input.entity.versionField
    ) {
      throw new ConfigurationError(
        `Entity "${entityName}" has conflicting concurrency version fields.`
      )
    }
  }

  for (const [route, config] of Object.entries(input.rateLimit ?? {})) {
    if (!["list", "detail", "create", "update", "delete"].includes(route)) {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid rate-limit route.`
      )
    }
    validateRateLimit(config, entityName, route)
  }

  if (input.entity.tenantField && input.tenantScoping.mode === "none") {
    throw new ConfigurationError(
      `Entity "${input.entity.name}" declares tenantField "${String(input.entity.tenantField)}" but tenantScoping is explicitly "none". Remove tenantField if this entity is not tenant-scoped.`
    )
  }

  if (!input.entity.tenantField && input.tenantScoping.mode === "scoped") {
    throw new ConfigurationError(
      `Entity "${input.entity.name}" requests tenant scoping but declares no tenantField.`
    )
  }

  // Mandatory OCC for mutating routes (P1-03): update/delete routes run
  // read-then-write authorization; without a concrete numeric version field
  // the authorization snapshot is exposed to TOCTOU. The numeric-type
  // requirement is enforced by the versionField/optimisticConcurrency checks
  // above; here we require that at least one source actually declares the field.
  if (routeRequires("update", routes) || routeRequires("delete", routes)) {
    const concurrencyVersionField =
      input.entity.versionField ?? input.optimisticConcurrency?.versionField
    if (concurrencyVersionField === undefined) {
      throw new ConfigurationError(
        `Entity "${input.entity.name}" enables update or delete routes but declares no version field. Optimistic concurrency is mandatory for mutating routes: declare entity.versionField or optimisticConcurrency.versionField as a numeric field.`
      )
    }
  }

  if (
    !input.entity.primaryKey &&
    !Object.prototype.hasOwnProperty.call(input.entity.fields, "id")
  ) {
    throw new ConfigurationError(
      `Entity "${input.entity.name}" needs an explicit or inferable primary key.`
    )
  }

  if (input.audit?.enabled && !input.audit.resource) {
    throw new ConfigurationError(
      `Entity "${input.entity.name}" has audit enabled but no resource name.`
    )
  }

  for (const [field, classification] of Object.entries(
    input.audit?.fieldClassification ?? {}
  )) {
    requireField(field, "audit classification field")
    if (
      classification !== "include" &&
      classification !== "mask" &&
      classification !== "omit"
    ) {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid audit classification for "${field}".`
      )
    }
  }
  for (const [name, value] of Object.entries(input.queryLimits ?? {})) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid query limit for ${name}.`
      )
    }
  }
  if (
    input.searchStrategy &&
    !["contains", "prefix", "fullText"].includes(input.searchStrategy.kind)
  ) {
    throw new ConfigurationError(
      `Entity "${entityName}" has an invalid search strategy.`
    )
  }

  if (input.cache?.enabled && (!input.cache.tag || !input.cache.keyPrefix)) {
    throw new ConfigurationError(
      `Entity "${input.entity.name}" has cache enabled but no cache tag/keyPrefix.`
    )
  }

  if (routeRequires("create", routes) && !input.validation?.createBody) {
    throw new ConfigurationError(
      `Entity "${input.entity.name}" enables create but provides no createBody validation schema.`
    )
  }

  if (routeRequires("update", routes) && !input.validation?.updateBody) {
    throw new ConfigurationError(
      `Entity "${input.entity.name}" enables update but provides no updateBody validation schema.`
    )
  }

  // Enforce lifecycle hook names, read-only persistence, and representation-only semantics.
  validateCrudHooksConfig(input.crudHooks, entityName)
  validateCrudLifecycle(input.crud, entityName)
}

const ALLOWED_CRUD_ROUTES = new Set([
  "list",
  "detail",
  "create",
  "update",
  "delete",
])
const CRUD_HOOK_ALLOWLIST: Record<string, readonly string[]> = {
  list: ["beforeCommitTransform", "afterCommitRepresentation"],
  detail: ["beforeCommitTransform", "afterCommitRepresentation"],
  create: ["beforeCommitTransform", "afterCommitRepresentation", "afterCommit"],
  update: ["beforeCommitTransform", "afterCommitRepresentation", "afterCommit"],
  delete: ["beforeCommitTransform", "afterCommitRepresentation", "afterCommit"],
}

function validateCrudHooksConfig(crudHooks: unknown, entityName: string): void {
  if (crudHooks === undefined) return
  if (!crudHooks || typeof crudHooks !== "object" || Array.isArray(crudHooks)) {
    throw new ConfigurationError(
      `Entity "${entityName}" has an invalid crudHooks configuration.`
    )
  }
  const record = crudHooks as Record<string, unknown>
  if ("writableMutationHooks" in record) {
    throw new ConfigurationError(
      `Entity "${entityName}" declares removed crudHooks.writableMutationHooks — mutation hooks are always read-only (P1-06). Remove this flag.`
    )
  }
  for (const key of Object.keys(record)) {
    throw new ConfigurationError(
      `Entity "${entityName}" has invalid crudHooks property "${key}". EntityCrudHooksConfig is currently empty — no writable persistence hooks are supported.`
    )
  }
}

function validateCrudLifecycle(crud: unknown, entityName: string): void {
  if (crud === undefined) return
  if (!crud || typeof crud !== "object" || Array.isArray(crud)) {
    throw new ConfigurationError(
      `Entity "${entityName}" has an invalid crud configuration.`
    )
  }
  const ALL_HOOK_NAMES = new Set([
    "beforeCommitTransform",
    "afterCommitRepresentation",
    "afterCommit",
  ])
  for (const [route, hooks] of Object.entries(
    crud as Record<string, unknown>
  )) {
    if (!ALLOWED_CRUD_ROUTES.has(route)) {
      // Allow non-route opaque/plain data used by defineEntity freezing tests
      // (e.g., crud.nested, crud.map). Only reject if the value looks like a
      // lifecycle route object containing hook names.
      if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
        const keys = Object.keys(hooks)
        const containsHook = keys.some((k) => ALL_HOOK_NAMES.has(k))
        if (containsHook) {
          throw new ConfigurationError(
            `Entity "${entityName}" has an invalid crud route "${route}".`
          )
        }
      } else if (typeof hooks === "function") {
        throw new ConfigurationError(
          `Entity "${entityName}" has an invalid crud route "${route}".`
        )
      }
      continue
    }
    if (hooks === undefined || hooks === null) continue
    if (typeof hooks !== "object" || Array.isArray(hooks)) {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid crud hooks configuration for route "${route}".`
      )
    }
    const allowed = CRUD_HOOK_ALLOWLIST[route] ?? []
    for (const [hookName, hookFn] of Object.entries(
      hooks as Record<string, unknown>
    )) {
      if (!allowed.includes(hookName)) {
        throw new ConfigurationError(
          `Entity "${entityName}" has invalid hook "${hookName}" for route "${route}". Allowed hooks: ${allowed.join(", ")}.`
        )
      }
      if (hookFn !== undefined && typeof hookFn !== "function") {
        throw new ConfigurationError(
          `Entity "${entityName}" has an invalid hook "${hookName}" for route "${route}" — hook must be a function.`
        )
      }
    }

    // Runtime persistence restrictions enforce the remaining lifecycle contract.
  }
}

function validateRateLimit(
  config: RateLimitConfig,
  entityName: string,
  route: string
): void {
  if (!config || !Number.isInteger(config.max) || config.max <= 0) {
    throw new ConfigurationError(
      `Entity "${entityName}" has an invalid rate-limit max for ${route}.`
    )
  }
  const consistency = (config as RateLimitPolicy).consistency
  if (consistency !== "atomic" && consistency !== "best-effort") {
    throw new ConfigurationError(
      `Entity "${entityName}" must declare rate-limit consistency for ${route}.`
    )
  }
  if (typeof config.timeWindow === "number") {
    if (!Number.isFinite(config.timeWindow) || config.timeWindow <= 0) {
      throw new ConfigurationError(
        `Entity "${entityName}" has an invalid rate-limit window for ${route}.`
      )
    }
    return
  }
  if (
    typeof config.timeWindow !== "string" ||
    !/^[1-9]\d*\s*(second|seconds|minute|minutes|hour|hours)$/.test(
      config.timeWindow.trim().toLowerCase()
    )
  ) {
    throw new ConfigurationError(
      `Entity "${entityName}" has an invalid rate-limit window for ${route}.`
    )
  }
}
