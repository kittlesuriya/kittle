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

// Hardcoded locally (type-only import above) so this module keeps no runtime
// dependency on abacPolicySchema, which itself imports this module's types.
const KNOWN_POLICY_OPERATORS: ReadonlySet<string> = new Set([
  "equals",
  "notEquals",
  "contains",
  "startsWith",
  "endsWith",
  "isEmpty",
  "isNotEmpty",
  "greaterThan",
  "lessThan",
  "greaterOrEqual",
  "lessOrEqual",
  "isTrue",
  "isFalse",
  "isNull",
  "isNotNull",
  "includesAny",
  "includesAll",
  "before",
  "after",
  "between",
  "in",
])

const KNOWN_ABAC_FIELD_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "identifier",
  "string-array",
])

function assertNonEmptyString(value: unknown, message: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigurationError(message)
  }
}

function assertStringArray(value: unknown, message: string): void {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    throw new ConfigurationError(message)
  }
}

function assertCatalogFieldEntry(
  key: string,
  entry: unknown
): asserts entry is AbacFieldDefinition {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new ConfigurationError(
      `Abac catalog field "${key}" must be an object.`
    )
  }
  const candidate = entry as Partial<AbacFieldDefinition>
  if (
    typeof candidate.key !== "string" ||
    candidate.key.length === 0 ||
    candidate.key !== key
  ) {
    throw new ConfigurationError(
      `Abac catalog field "${key}" must declare a non-empty key matching its map key.`
    )
  }
  if (
    typeof candidate.type !== "string" ||
    !KNOWN_ABAC_FIELD_TYPES.has(candidate.type)
  ) {
    throw new ConfigurationError(
      `Abac catalog field "${key}" has an unknown type: ${String(candidate.type)}.`
    )
  }
  if (
    !Array.isArray(candidate.operators) ||
    candidate.operators.length === 0 ||
    !candidate.operators.every(
      (operator) =>
        typeof operator === "string" && KNOWN_POLICY_OPERATORS.has(operator)
    )
  ) {
    throw new ConfigurationError(
      `Abac catalog field "${key}" must declare a non-empty array of known policy operators.`
    )
  }
}

export function defineAbacModule(
  catalog: AbacModuleCatalog
): AbacModuleCatalog {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new ConfigurationError("Abac module catalog must be an object.")
  }
  assertNonEmptyString(
    catalog.moduleKey,
    "Abac module catalog requires a non-empty moduleKey."
  )
  assertStringArray(
    catalog.actions,
    "Abac module catalog actions must be an array of non-empty strings."
  )
  assertStringArray(
    catalog.capabilities,
    "Abac module catalog capabilities must be an array of non-empty strings."
  )
  if (
    !catalog.fields ||
    typeof catalog.fields !== "object" ||
    Array.isArray(catalog.fields)
  ) {
    throw new ConfigurationError("Abac module catalog fields must be an object.")
  }
  for (const key of Object.keys(catalog.fields)) {
    assertCatalogFieldEntry(key, catalog.fields[key])
  }
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
