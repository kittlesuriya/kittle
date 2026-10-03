/* eslint-disable @typescript-eslint/require-await */
import type { CacheAdapter, CacheMode } from "kittle-core/cache"
import { InMemoryCacheAdapter } from "../cache/inMemoryCacheAdapter"

/**
 * Minimal no-op cache adapter. All reads return undefined/empty,
 * all writes are silently ignored. Suitable for apps that don't use
 * kittle's cache layer.
 */
const noopCache: CacheAdapter = {
  async get() {
    return undefined
  },
  async set() {},
  async delete() {
    return false
  },
  async has() {
    return false
  },
  async clear() {},
  async addToTag() {},
  async getTagKeys() {
    return []
  },
  async deleteTag() {},
}

/**
 * Resolves the cache adapter once, at runtime creation, so every CRUD handler
 * shares one payload and one generation state for the life of the process.
 *
 * `inMemory` mode creates a process-local adapter because its promise is that a
 * cache hit never reaches the database. Every other mode keeps the no-op
 * default: a shared deployment must be given an adapter with shared,
 * linearizable generations rather than silently falling back to memory.
 */
export function resolveRuntimeCacheAdapter(options: {
  cacheAdapter?: CacheAdapter
  cacheMode?: CacheMode
}): CacheAdapter {
  return (
    options.cacheAdapter ??
    (options.cacheMode === "inMemory" ? new InMemoryCacheAdapter() : noopCache)
  )
}
