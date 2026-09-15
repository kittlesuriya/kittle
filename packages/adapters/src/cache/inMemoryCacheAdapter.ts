import type { CacheAdapter } from "kittle-core/cache"

const TAG_PREFIX = "__tag__"

export class InMemoryCacheAdapter implements CacheAdapter {
  // Synchronous map mutations are atomic within this adapter's event loop, so
  // tag generations are linearizable, but only within a single JS process.
  // Correctness-critical callers must compose this adapter with a shared
  // generation store (SharedGenerationCacheAdapter) to fence across instances.
  // Memory bounds: every map is pruned. `delete`/`deleteTag` remove revisions
  // and tag memberships immediately; expired values and rate-limit buckets
  // are swept by an amortized prune (no background timer to manage).
  readonly capabilities = {
    tagGenerationConsistency: "linearizable" as const,
    coherenceScope: "process" as const,
  }
  private values = new Map<
    string,
    { value: unknown; expiresAt?: number; revision: number }
  >()
  private revisions = new Map<string, number>()
  private tags = new Map<string, Map<string, number>>()
  private generations = new Map<string, string>()
  private rateLimitBuckets = new Map<
    string,
    { count: number; resetAt: number }
  >()
  private mutationsSincePrune = 0
  private static readonly PRUNE_EVERY_MUTATIONS = 128

  /**
   * Removes expired values (with their revisions), tag memberships of keys
   * that no longer exist, and expired rate-limit buckets.
   */
  private pruneExpired(now: number = Date.now()): void {
    for (const [key, record] of this.values) {
      if (record.expiresAt !== undefined && record.expiresAt <= now) {
        this.values.delete(key)
        this.revisions.delete(key)
      }
    }
    for (const [tagKey, keys] of this.tags) {
      for (const key of keys.keys()) {
        if (!this.values.has(key)) keys.delete(key)
      }
      if (keys.size === 0) this.tags.delete(tagKey)
    }
    for (const [key, bucket] of this.rateLimitBuckets) {
      if (bucket.resetAt <= now) this.rateLimitBuckets.delete(key)
    }
  }

  private noteMutation(): void {
    this.mutationsSincePrune += 1
    if (
      this.mutationsSincePrune >= InMemoryCacheAdapter.PRUNE_EVERY_MUTATIONS
    ) {
      this.mutationsSincePrune = 0
      this.pruneExpired()
    }
  }

  private isExpired(record: { expiresAt?: number } | undefined): boolean {
    return record?.expiresAt !== undefined && record.expiresAt <= Date.now()
  }

  private clone<T>(value: T): T {
    return structuredClone(value)
  }

  private pruneIfExpired(key: string): void {
    const record = this.values.get(key)
    if (this.isExpired(record)) {
      this.values.delete(key)
      this.revisions.delete(key)
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get<T>(key: string): Promise<T | undefined> {
    this.pruneIfExpired(key)
    const record = this.values.get(key)
    return record ? this.clone(record.value as T) : undefined
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async set<T>(key: string, data: T, ttlMs?: number): Promise<void> {
    const value = this.clone(data)
    const revision = (this.revisions.get(key) ?? 0) + 1
    this.revisions.set(key, revision)
    this.values.set(
      key,
      ttlMs
        ? { value, expiresAt: Date.now() + ttlMs, revision }
        : { value, revision }
    )
    this.noteMutation()
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(key: string): Promise<boolean> {
    const existed = this.values.delete(key)
    this.revisions.delete(key)
    this.noteMutation()
    return existed
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async has(key: string): Promise<boolean> {
    this.pruneIfExpired(key)
    return this.values.has(key)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clear(): Promise<void> {
    this.values.clear()
    this.revisions.clear()
    this.tags.clear()
    this.generations.clear()
    this.rateLimitBuckets.clear()
    this.mutationsSincePrune = 0
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async addToTag(tag: string, key: string): Promise<void> {
    const tagKey = `${TAG_PREFIX}:${tag}`
    const keys = this.tags.get(tagKey) ?? new Map<string, number>()
    keys.set(key, this.revisions.get(key) ?? 0)
    this.tags.set(tagKey, keys)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getTagKeys(tag: string): Promise<string[]> {
    const tagKey = `${TAG_PREFIX}:${tag}`
    return Array.from(this.tags.get(tagKey)?.keys() ?? [])
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteTag(tag: string): Promise<void> {
    const tagKey = `${TAG_PREFIX}:${tag}`
    const keys = this.tags.get(tagKey)
    if (keys) {
      for (const [key, taggedRevision] of keys) {
        if (taggedRevision === this.values.get(key)?.revision) {
          this.values.delete(key)
          this.revisions.delete(key)
        }
      }
    }
    this.tags.delete(tagKey)
    this.noteMutation()
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getTagGeneration(tag: string): Promise<string> {
    return this.generations.get(tag) ?? "0"
  }

  // A single map update is atomic within this adapter's event loop.
  // eslint-disable-next-line @typescript-eslint/require-await
  async advanceTagGeneration(tag: string): Promise<string> {
    const next = String(Number(this.generations.get(tag) ?? "0") + 1)
    this.generations.set(tag, next)
    return next
  }

  // Synchronous map mutation is atomic for this single-process adapter.
  // eslint-disable-next-line @typescript-eslint/require-await
  async incrementRateLimitAtomically(
    key: string,
    windowMs: number
  ): Promise<{ count: number; resetAt: number }> {
    const now = Date.now()
    const current = this.rateLimitBuckets.get(key)
    const bucket =
      current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + windowMs }
    bucket.count += 1
    this.rateLimitBuckets.set(key, bucket)
    this.noteMutation()
    return { ...bucket }
  }
}
