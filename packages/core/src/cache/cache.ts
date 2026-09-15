import { CanonicalJsonError } from "../foundation/canonicalJson"

export const MAX_CACHE_KEY_DEPTH = 100
export const MAX_CACHE_KEY_KEYS = 10_000
export const MAX_CACHE_KEY_BYTES = 2 * 1024

function compareSerialized(left: unknown, right: unknown): number {
  const a = JSON.stringify(left) ?? ""
  const b = JSON.stringify(right) ?? ""
  return a < b ? -1 : a > b ? 1 : 0
}

function assertAcyclic(value: object, seen: Set<object>): void {
  if (seen.has(value)) {
    throw new CanonicalJsonError(
      "Cache key parts do not accept cyclic structures"
    )
  }
  seen.add(value)
}

function sortForSerialization(
  value: unknown,
  depth = 0,
  seen = new Set<object>()
): unknown {
  if (depth > MAX_CACHE_KEY_DEPTH) {
    throw new CanonicalJsonError(
      `Cache key nesting exceeds the maximum depth of ${MAX_CACHE_KEY_DEPTH}`
    )
  }
  if (value === undefined) return { $type: "undefined" }
  if (typeof value === "number" && Number.isNaN(value)) return { $type: "NaN" }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { $type: value > 0 ? "Infinity" : "-Infinity" }
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new CanonicalJsonError(
        "Cache key parts do not accept invalid Date values"
      )
    }
    return { $type: "Date", value: value.toISOString() }
  }
  if (typeof value === "bigint") {
    return { $type: "BigInt", value: value.toString() }
  }
  if (value instanceof Map) {
    assertAcyclic(value, seen)
    const entries = Array.from(value.entries())
      .map(
        ([k, v]) =>
          [
            sortForSerialization(k, depth + 1, seen),
            sortForSerialization(v, depth + 1, seen),
          ] as const
      )
      .sort((left, right) => compareSerialized(left[0], right[0]))
    seen.delete(value)
    return { $type: "Map", value: entries }
  }
  if (value instanceof Set) {
    assertAcyclic(value, seen)
    const items = Array.from(value)
      .map((item) => sortForSerialization(item, depth + 1, seen))
      .sort(compareSerialized)
    seen.delete(value)
    return { $type: "Set", value: items }
  }
  if (Array.isArray(value)) {
    assertAcyclic(value, seen)
    const items = value.map((item) =>
      sortForSerialization(item, depth + 1, seen)
    )
    seen.delete(value)
    return items
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if ("$type" in record) {
      throw new CanonicalJsonError(
        "Cache key parts do not accept objects with a reserved $type key"
      )
    }
    assertAcyclic(value, seen)
    const keys = Object.keys(record)
    if (keys.length > MAX_CACHE_KEY_KEYS) {
      throw new CanonicalJsonError(
        `Cache key object exceeds the maximum of ${MAX_CACHE_KEY_KEYS} keys`
      )
    }
    const result = keys.sort().reduce<Record<string, unknown>>(
      (acc, key) => {
        acc[key] = sortForSerialization(record[key], depth + 1, seen)
        return acc
      },
      Object.create(null) as Record<string, unknown>
    )
    seen.delete(value)
    return result
  }
  return value
}

export function serializeCacheKeyPart(value: unknown): string {
  return JSON.stringify(sortForSerialization(value))
}

export function buildKey(
  prefix: string,
  scope: string,
  suffix: string
): string {
  const encoded = [prefix, scope, suffix]
    .map((part) => encodeURIComponent(part))
    .join(":")
  const bytes = new TextEncoder().encode(encoded).byteLength
  if (bytes > MAX_CACHE_KEY_BYTES) {
    throw new CanonicalJsonError(
      `Cache key exceeds the maximum of ${MAX_CACHE_KEY_BYTES} bytes`
    )
  }
  return encoded
}

export class CacheAdapterError extends Error {
  readonly operation: string

  constructor(operation: string, options?: { cause?: unknown }) {
    super(`Cache operation failed: ${operation}`, options)
    this.name = "CacheAdapterError"
    this.operation = operation
  }
}

export interface CacheAdapter {
  /** Backend consistency guarantees used by correctness-critical callers. */
  readonly capabilities?: CacheCapabilities
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, data: T, ttlMs?: number): Promise<void>
  delete(key: string): Promise<boolean>
  has(key: string): Promise<boolean>
  clear(): Promise<void>
  addToTag(tag: string, key: string): Promise<void>
  getTagKeys(tag: string): Promise<string[]>
  deleteTag(tag: string): Promise<void>
  /** Best-effort epoch primitives used to fence in-flight resolver writes. */
  getTagGeneration?(tag: string): Promise<string | undefined>
  /** Atomically advances and returns a tag generation when the backend supports it. */
  advanceTagGeneration?(tag: string): Promise<string>
  /** Atomically increments a rate-limit bucket when the backend supports it. */
  incrementRateLimitAtomically?(
    key: string,
    windowMs: number
  ): Promise<{ count: number; resetAt: number }>
}

/**
 * Describes the consistency guarantees a cache backend can provide for
 * tag-based invalidation. Implementations should set the appropriate value
 * so callers can reason about correctness.
 */
export interface CacheCapabilities {
  /**
   * Whether the backend's tag generation tracking provides linearizable
   * (strong) or merely eventual consistency. When unset, callers should
   * assume eventual consistency.
   */
  tagGenerationConsistency?: "linearizable" | "eventual"
  /**
   * Whether generation and payload state is visible across every process and
   * instance ("shared") or only within the current JS process ("process").
   * Correctness-critical caches require shared scope so generation fencing
   * holds across the whole fleet, not just one event loop.
   */
  coherenceScope?: "process" | "shared"
}

// Re-export CacheService from its dedicated module for backward compatibility.
export { CacheService } from "./cacheService"
export type { CacheConfig, CacheTelemetry } from "./cacheService"
