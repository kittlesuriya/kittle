import type { PolicyOperator } from "./abacPolicySchema"
import type { AbacFieldType } from "./coercePolicyValue"
import { ConfigurationError } from "../foundation/errors"

export interface AbacFieldDefinition {
  key: string
  type: AbacFieldType
  operators: PolicyOperator[]
}

export interface AbacModuleCatalog {
  moduleKey: string
  actions: string[]
  capabilities: string[]
  fields: Record<string, AbacFieldDefinition>
}

export const ABAC_CATALOG_BRAND: unique symbol = Symbol("kittle.abacCatalogBrand")

export type BrandedAbacModuleCatalog = AbacModuleCatalog & {
  readonly [ABAC_CATALOG_BRAND]: true
}

export function isAbacCatalog(value: unknown): value is BrandedAbacModuleCatalog {
  return (
    !!value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, ABAC_CATALOG_BRAND) &&
    (value as Record<symbol, unknown>)[ABAC_CATALOG_BRAND] === true
  )
}

export function assertAbacCatalog(
  catalog: AbacModuleCatalog
): asserts catalog is BrandedAbacModuleCatalog {
  if (!isAbacCatalog(catalog)) {
    throw new ConfigurationError(
      "Abac catalog must be created via defineAbacModule(); raw catalog objects are not accepted"
    )
  }
  if (Object.getPrototypeOf(catalog.fields) !== null) {
    throw new ConfigurationError(
      "Abac catalog fields must be a null-prototype object; use defineAbacModule()"
    )
  }
}

export function assertCatalogFieldsProto(
  fields: Record<string, AbacFieldDefinition>
): void {
  if (Object.getPrototypeOf(fields) !== null) {
    throw new ConfigurationError(
      "Abac catalog fields must be a null-prototype object; use defineAbacModule()"
    )
  }
}

/**
 * Register an ABAC module catalog.  The `fields` map is normalised to a
 * null-prototype object so that downstream lookups via `Object.hasOwn()`
 * cannot be spoofed by inherited properties such as `__proto__`,
 * `constructor`, or `toString`.
 */
export function defineAbacModule(
  catalog: AbacModuleCatalog
): AbacModuleCatalog {
  const safeFields = {} as Record<string, AbacFieldDefinition>
  Object.setPrototypeOf(safeFields, null)
  for (const key of Object.keys(catalog.fields)) {
    safeFields[key] = catalog.fields[key]!
  }
  const branded = { ...catalog, fields: safeFields } as BrandedAbacModuleCatalog
  Object.defineProperty(branded, ABAC_CATALOG_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return branded
}
