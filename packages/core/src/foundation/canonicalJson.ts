export const MAX_CANONICAL_JSON_DEPTH = 100
export const MAX_CANONICAL_JSON_KEYS = 10_000
export const MAX_CANONICAL_JSON_BYTES = 1024 * 1024

export const MAX_DURABLE_JSON_DEPTH = MAX_CANONICAL_JSON_DEPTH
export const MAX_DURABLE_JSON_STRING_BYTES = 65_536
export const MAX_DURABLE_JSON_TOTAL_KEYS = 10_000
export const MAX_DURABLE_JSON_SERIALIZED_BYTES = 1024 * 1024

export class CanonicalJsonError extends Error {
  override readonly name = "CanonicalJsonError"

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

function compareByte(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

/**
 * Strict canonical JSON. Only plain objects without a reserved `$type` key,
 * arrays, and JSON primitives are accepted. Date is encoded as a typed marker
 * (`{ $type: "Date", value }`) that ordinary JSON cannot forge, because plain
 * objects carrying a `$type` key are rejected. Map/Set/class instances,
 * undefined, NaN, Infinity, bigint, function and symbol values are rejected so
 * a durable fingerprint can never collapse to a different identity. Object keys
 * are ordered by UTF-16 code unit, never locale-sensitive.
 */
/**
 * Internal budget shared across recursive calls to enforce cumulative key
 * limits. Prevents an attacker from bypassing the per-object key limit by
 * distributing keys across many shallow objects.
 */
interface CanonicalKeyBudget {
  totalKeys: number
}

export function canonicalizeJson(
  value: unknown,
  depth = 0,
  budget: CanonicalKeyBudget = { totalKeys: 0 }
): unknown {
  if (depth > MAX_CANONICAL_JSON_DEPTH) {
    throw new CanonicalJsonError(
      `Canonical JSON nesting exceeds the maximum depth of ${MAX_CANONICAL_JSON_DEPTH}`
    )
  }
  if (value === undefined)
    throw new CanonicalJsonError("Canonical JSON does not accept undefined")
  if (
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new CanonicalJsonError(
      `Canonical JSON does not accept ${typeof value}`
    )
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new CanonicalJsonError(
      "Canonical JSON does not accept NaN or Infinity"
    )
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new CanonicalJsonError(
        "Canonical JSON does not accept invalid Date values"
      )
    }
    return { $type: "Date", value: value.toISOString() }
  }
  if (Array.isArray(value))
    return value.map((item) => canonicalizeJson(item, depth + 1, budget))
  if (value && typeof value === "object") {
    if (!isPlainObject(value)) {
      throw new CanonicalJsonError(
        "Canonical JSON does not accept class, Map, Set, or non-plain object instances"
      )
    }
    if ("$type" in value) {
      throw new CanonicalJsonError(
        "Canonical JSON does not accept objects with a reserved $type key"
      )
    }
    const keys = Object.keys(value)
    if (keys.length > MAX_CANONICAL_JSON_KEYS) {
      throw new CanonicalJsonError(
        `Canonical JSON object exceeds the maximum of ${MAX_CANONICAL_JSON_KEYS} keys`
      )
    }
    budget.totalKeys += keys.length
    if (budget.totalKeys > MAX_CANONICAL_JSON_KEYS) {
      throw new CanonicalJsonError(
        `Canonical JSON exceeds the maximum cumulative total of ${MAX_CANONICAL_JSON_KEYS} keys`
      )
    }
    if (
      Object.hasOwn(value, "__proto__") ||
      Object.hasOwn(value, "constructor") ||
      Object.hasOwn(value, "prototype")
    ) {
      throw new CanonicalJsonError(
        "Canonical JSON does not accept objects with __proto__, constructor, or prototype as own keys"
      )
    }
    keys.sort(compareByte)
    const record = Object.create(null) as Record<string, unknown>
    for (const key of keys) {
      record[key] = canonicalizeJson(
        (value as Record<string, unknown>)[key],
        depth + 1,
        budget
      )
    }
    return record
  }
  return value
}

export function assertDurableJson(label: string, value: unknown): void {
  const budget = { totalKeys: 0, totalBytes: 0 }
  const visited = new WeakSet<object>()
  const visit = (entry: unknown, depth: number): void => {
    if (depth > MAX_DURABLE_JSON_DEPTH) {
      throw new CanonicalJsonError(
        `${label} exceeds the maximum nesting depth of ${MAX_DURABLE_JSON_DEPTH}`
      )
    }
    if (
      entry === undefined ||
      typeof entry === "bigint" ||
      typeof entry === "function" ||
      typeof entry === "symbol" ||
      (typeof entry === "number" && !Number.isFinite(entry))
    ) {
      throw new CanonicalJsonError(`${label} contains a non-durable value`)
    }
    if (entry === null) return
    if (typeof entry === "string") {
      const bytes = new TextEncoder().encode(entry).byteLength
      if (bytes > MAX_DURABLE_JSON_STRING_BYTES) {
        throw new CanonicalJsonError(
          `${label} contains a string longer than ${MAX_DURABLE_JSON_STRING_BYTES} bytes`
        )
      }
      return
    }
    if (typeof entry === "number" || typeof entry === "boolean") return
    if (Array.isArray(entry)) {
      if (visited.has(entry))
        throw new CanonicalJsonError(`${label} contains a circular reference`)
      visited.add(entry)
      for (const item of entry) visit(item, depth + 1)
      visited.delete(entry)
      return
    }
    if (entry instanceof Date) {
      // Allow Date for outbox/audit durable records — canonicalJson will
      // encode it as { $type:"Date" } and string byte limits still apply.
      return
    }
    const prototype = Object.getPrototypeOf(entry) as object | null
    if (prototype !== Object.prototype && prototype !== null)
      throw new CanonicalJsonError(
        `${label} contains a Map, Set, class instance, or non-plain object`
      )
    if (visited.has(entry))
      throw new CanonicalJsonError(`${label} contains a circular reference`)
    visited.add(entry)
    const record = entry as Record<string, unknown>
    if (
      Object.hasOwn(record, "__proto__") ||
      Object.hasOwn(record, "constructor") ||
      Object.hasOwn(record, "prototype")
    ) {
      throw new CanonicalJsonError(
        `${label} contains __proto__, constructor, or prototype as own key`
      )
    }
    const keys = Object.keys(record)
    budget.totalKeys += keys.length
    if (budget.totalKeys > MAX_DURABLE_JSON_TOTAL_KEYS)
      throw new CanonicalJsonError(
        `${label} exceeds the maximum of ${MAX_DURABLE_JSON_TOTAL_KEYS} total keys`
      )
    for (const key of keys) {
      const keyBytes = new TextEncoder().encode(key).byteLength
      if (keyBytes > MAX_DURABLE_JSON_STRING_BYTES)
        throw new CanonicalJsonError(
          `${label} contains a key longer than ${MAX_DURABLE_JSON_STRING_BYTES} bytes`
        )
      visit(record[key], depth + 1)
    }
    visited.delete(entry)
  }
  visit(value, 0)
  const serialized = JSON.stringify(value)
  if (serialized !== undefined)
    budget.totalBytes += new TextEncoder().encode(serialized).byteLength
  if (budget.totalBytes > MAX_DURABLE_JSON_SERIALIZED_BYTES)
    throw new CanonicalJsonError(
      `${label} exceeds the maximum of ${MAX_DURABLE_JSON_SERIALIZED_BYTES} serialized bytes`
    )
}

export function assertDurableRecord(
  value: Record<string, unknown>,
  label: string
): void {
  assertDurableJson(label, value)
}

/**
 * Serializes a value as strict canonical JSON with hard bounds.
 *
 * Defense-in-depth: canonicalizeJson rejects non-plain prototypes via
 * isPlainObject, so the downstream JSON.stringify never encounters exotic
 * objects. No custom replacer is needed because the input is already
 * guaranteed to contain only plain objects, arrays, and JSON primitives.
 */
export function canonicalJsonString(value: unknown): string {
  const canonical = canonicalizeJson(value)
  const json = JSON.stringify(canonical)
  if (json === undefined)
    throw new CanonicalJsonError("Canonical JSON is not serializable")
  const bytes = new TextEncoder().encode(json).byteLength
  if (bytes > MAX_CANONICAL_JSON_BYTES) {
    throw new CanonicalJsonError(
      `Canonical JSON exceeds the maximum of ${MAX_CANONICAL_JSON_BYTES} bytes`
    )
  }
  return json
}
