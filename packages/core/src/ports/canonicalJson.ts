export const MAX_CANONICAL_JSON_DEPTH = 100
export const MAX_CANONICAL_JSON_KEYS = 10_000
export const MAX_CANONICAL_JSON_BYTES = 1024 * 1024

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
export function canonicalizeJson(value: unknown, depth = 0): unknown {
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
    return value.map((item) => canonicalizeJson(item, depth + 1))
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
        depth + 1
      )
    }
    return record
  }
  return value
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
