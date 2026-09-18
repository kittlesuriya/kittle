import { serializeCacheKeyPart } from "./cache"
import type { CacheAdapter } from "./cache"
import { CacheAdapterError } from "./cache"

export interface CacheConfig {
  adapter?: CacheAdapter
  defaultTtlMs?: number
  debug?: boolean
  telemetry?: CacheTelemetry
  /**
   * Do not read or write tagged cache data when generation state cannot be
   * verified. When enabled, the cache service requires `getTagGeneration` and
   * `advanceTagGeneration` on the adapter and throws if they are absent.
   *
   * This flag requires the adapter to declare linearizable tag-generation
   * consistency, a shared coherence scope (generation state visible to every
   * process and instance), and the generation primitives.
   */
  correctnessCritical?: boolean
}

export interface CacheTelemetry {
  onError?: (event: { operation: string; key?: string; error: unknown }) => void
}

export class CacheService {
  private adapter: CacheAdapter
  private defaultTtlMs: number
  /**
   * Instance-local deduplication map for in-flight cache resolutions.
   *
   * @note Stampede coalescing is per-CacheService instance and request-scoped,
   * NOT distributed. Concurrent requests to different instances or processes
   * will each independently resolve the same key. This is an optimization
   * boundary, never a correctness mechanism. A miss simply recomputes the value.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private readonly localTagGenerations = new Map<string, string>()
  private readonly telemetry: CacheTelemetry | undefined
  private readonly correctnessCritical: boolean

  constructor(config: CacheConfig & { adapter: CacheAdapter }) {
    assertCacheAdapter(config?.adapter)
    this.adapter = config.adapter
    this.defaultTtlMs = config.defaultTtlMs ?? 120_000
    this.telemetry = config.telemetry
    this.correctnessCritical = config.correctnessCritical === true
    if (
      this.correctnessCritical &&
      (this.adapter.capabilities?.tagGenerationConsistency !== "linearizable" ||
        this.adapter.capabilities?.coherenceScope !== "shared" ||
        !this.adapter.getTagGeneration ||
        !this.adapter.advanceTagGeneration)
    ) {
      throw new CacheAdapterError("shared tag generation unavailable")
    }
  }

  async getOrSet<T>(
    key: string,
    resolver: () => Promise<T>,
    tags: string[] = [],
    ttlMs?: number
  ): Promise<T> {
    this.requireSharedGeneration(tags)
    const generation =
      tags.length > 0 ? await this.getTagGeneration(tags) : undefined
    const storageKey =
      generation === undefined ? key : this.generationKey(key, generation)
    const existing = await this.get<T>(storageKey)
    if (existing !== undefined) {
      const currentGeneration =
        tags.length > 0 ? await this.getTagGeneration(tags) : undefined
      if (currentGeneration === generation) return existing
    }

    const pending = this.inFlight.get(storageKey)
    if (pending) return pending as Promise<T>

    const work = (async () => {
      const value = await resolver()
      if (tags.length > 0) {
        const currentGeneration = await this.getTagGeneration(tags)
        if (currentGeneration !== generation) return value
      }
      // A resolver may have started before a write invalidated its tags. Its
      // generation-qualified key is intentionally no longer readable.
      await this.set(storageKey, value, ttlMs ?? this.defaultTtlMs)

      for (const tag of tags) {
        try {
          await this.adapter.addToTag(tag, storageKey)
        } catch {
          // Cache tags are an invalidation hint, not a correctness boundary.
        }
      }

      return value
    })()

    this.inFlight.set(storageKey, work)
    try {
      return await work
    } finally {
      if (this.inFlight.get(storageKey) === work)
        this.inFlight.delete(storageKey)
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const value = await this.adapter.get<T>(key)
      if (value === null) {
        // The port contract reserves undefined for a miss. A null hit would
        // otherwise be returned to callers as a T.
        this.reportError(
          "get",
          key,
          new Error("Cache adapter returned null for a miss; expected undefined")
        )
        return undefined
      }
      return value
    } catch (error) {
      this.reportError("get", key, error)
      if (this.correctnessCritical) throw error
      return undefined
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      await this.adapter.set(key, value, ttlMs ?? this.defaultTtlMs)
    } catch (error) {
      this.reportError("set", key, error)
      if (this.correctnessCritical) throw error
      // A cache write must not turn a best-effort cache into a request failure.
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const deleted = await this.adapter.delete(key)
      if (typeof deleted !== "boolean") {
        throw new CacheAdapterError("delete")
      }
      return deleted
    } catch (error) {
      this.reportError("delete", key, error)
      return false
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const present = await this.adapter.has(key)
      if (typeof present !== "boolean") {
        throw new CacheAdapterError("has")
      }
      return present
    } catch (error) {
      this.reportError("has", key, error)
      return false
    }
  }

  async clear(): Promise<void> {
    try {
      await this.adapter.clear()
    } catch (error) {
      this.reportError("clear", undefined, error)
      // Cache eviction is best effort.
    }
  }

  async invalidateTag(tag: string): Promise<void> {
    this.requireSharedGeneration([tag])
    await this.advanceTagGeneration(tag)
    // A shared, linearizable generation advance fences every pre-invalidation
    // key across all processes. Do not physically delete tag members in the
    // critical path: a stale tag index must never be allowed to delete a newer
    // reuse of the same key.
    if (this.correctnessCritical) return
    try {
      await this.adapter.deleteTag(tag)
    } catch (error) {
      this.reportError("invalidateTag", tag, error)
      // Cache invalidation is best effort.
    }
  }

  async invalidateTags(tags: string[]): Promise<void> {
    for (const tag of tags) {
      await this.invalidateTag(tag)
    }
  }

  async addToTag(tag: string, key: string): Promise<void> {
    try {
      await this.adapter.addToTag(tag, key)
    } catch (error) {
      this.reportError("addToTag", key, error)
      if (this.correctnessCritical) throw error
    }
  }

  private generationKey(key: string, generation: string): string {
    return `__generation__:${serializeCacheKeyPart(generation)}:${key}`
  }

  private async getTagGeneration(tags: string[]): Promise<string | undefined> {
    if (tags.length === 0) return undefined
    if (!this.adapter.getTagGeneration) {
      if (this.correctnessCritical)
        throw new CacheAdapterError("getTagGeneration")
      return serializeCacheKeyPart(
        tags.map((tag) => this.localTagGenerations.get(tag) ?? "0")
      )
    }
    const generations = await Promise.all(
      tags.map(async (tag) => {
        try {
          const generation = await this.adapter.getTagGeneration!(tag)
          if (
            generation !== undefined &&
            (typeof generation !== "string" || generation.length === 0)
          ) {
            throw new CacheAdapterError("getTagGeneration")
          }
          if (generation !== undefined)
            this.localTagGenerations.set(tag, generation)
          return generation ?? this.localTagGenerations.get(tag) ?? "0"
        } catch (error) {
          if (this.correctnessCritical) throw error
          return this.localTagGenerations.get(tag) ?? "0"
        }
      })
    )
    return serializeCacheKeyPart(generations)
  }

  private async advanceTagGeneration(tag: string): Promise<void> {
    try {
      if (this.adapter.advanceTagGeneration) {
        const next = await this.adapter.advanceTagGeneration(tag)
        if (typeof next !== "string" || next.length === 0) {
          throw new CacheAdapterError("advanceTagGeneration")
        }
        this.localTagGenerations.set(tag, next)
      } else {
        if (this.correctnessCritical)
          throw new CacheAdapterError("advanceTagGeneration")
        this.localTagGenerations.set(
          tag,
          String(Number(this.localTagGenerations.get(tag) ?? "0") + 1)
        )
      }
    } catch (error) {
      if (this.correctnessCritical) {
        if (error instanceof CacheAdapterError) throw error
        throw new CacheAdapterError("advanceTagGeneration", { cause: error })
      }
      // Invalidation remains best effort, but fence local in-flight work.
      this.localTagGenerations.set(
        tag,
        String(Number(this.localTagGenerations.get(tag) ?? "0") + 1)
      )
    }
  }

  private requireSharedGeneration(tags: string[]): void {
    if (!this.correctnessCritical || tags.length === 0) return
    if (!this.adapter.getTagGeneration || !this.adapter.advanceTagGeneration) {
      throw new CacheAdapterError("shared tag generation unavailable")
    }
  }

  private reportError(
    operation: string,
    key: string | undefined,
    error: unknown
  ): void {
    try {
      this.telemetry?.onError?.({
        operation,
        ...(key !== undefined ? { key } : {}),
        error,
      })
    } catch {
      // Telemetry must never change cache semantics.
    }
  }
}

/**
 * Fail-closed contract check for the cache adapter boundary. A caller that
 * passes a missing or partial adapter must fail at construction — never as
 * an obscure `adapter.get is not a function` crash on first use.
 */
function assertCacheAdapter(adapter: unknown): asserts adapter is CacheAdapter {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new CacheAdapterError("adapter must be an object")
  }
  const candidate = adapter as Partial<Record<string, unknown>>
  for (const method of [
    "get",
    "set",
    "delete",
    "has",
    "clear",
    "addToTag",
    "getTagKeys",
    "deleteTag",
  ] as const) {
    if (typeof candidate[method] !== "function") {
      throw new CacheAdapterError(`adapter.${method} must be a function`)
    }
  }
  for (const method of [
    "getTagGeneration",
    "advanceTagGeneration",
    "incrementRateLimitAtomically",
  ] as const) {
    if (
      candidate[method] !== undefined &&
      typeof candidate[method] !== "function"
    ) {
      throw new CacheAdapterError(`adapter.${method} must be a function`)
    }
  }
}
