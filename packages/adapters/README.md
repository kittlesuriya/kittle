# kittle-adapters

Drizzle (D1/Postgres), HTTP, cache, and server adapters implementing the `kittle-core` ports.

> Implements every `kittle-core/ports` contract so you can run `kittle-core` operations without writing SQL, HTTP, or cache plumbing.

## Install

```sh
npm install kittle-adapters kittle-core drizzle-orm zod uuidv7
# plus one of: drizzle-orm pg driver (pg) or Cloudflare D1
```

* ESM only (`"type":"module"`), Node `>=20` (`packages/adapters/package.json:23`)
* Requires `drizzle-orm ^0.45.2`, `zod ^4.3.6`, `uuidv7 ^1.2.1`
* `drizzle-kit` for migrations (not a runtime dep)

## Entrypoints

| Import | What it wires |
|---|---|
| `kittle-adapters` | barrel: `http` + `cache` + `server` + `drizzle-d1` |
| `kittle-adapters/http` | `CRUD`/`createFrameworkWriteHandler`/`handleFrameworkCoreError`/`requestBody` |
| `kittle-adapters/server` | `FrameworkAdapterDeps` + `createAuthorizedRepository` + `buildActionScope` re-export |
| `kittle-adapters/drizzle-d1` | Cloudflare D1 SQLite: `DrizzlePersistenceProvider` (atomic-batch), `Repository`, sinks, job/schedule/idempotency stores |
| `kittle-adapters/drizzle-pg` | Postgres: `DrizzlePersistenceProvider` (interactive transactions), `Repository`, sinks, job/schedule/idempotency stores |
| `kittle-adapters/cache` | `InMemoryCacheAdapter`, `KvCacheAdapter`, `SharedGenerationCacheAdapter`, `DbTagGenerationStore`, rate-limit stores |
| `kittle-adapters/utils/redact` | `redactPhi`/`redactPhiDeep` (used as `auditSanitizer`) |

`packages/adapters/package.json:33` is authoritative; `drizzle-pg` is also available as `kittle-adapters/drizzle-pg` (namespaced via `drizzlePg` barrel).

---

## How to use — from DB to HTTP

### 1. Pick a persistence provider

Both dialects share `DrizzleEntityRegistry`. Register **every** entity your operations will touch.

#### Postgres (interactive transactions)

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { DrizzleEntityRegistry, createDrizzlePersistenceProvider } from "kittle-adapters/drizzle-pg";
import { taskEntity } from "./entities/task"; // defineEntity(...) from kittle-core/entity

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull(),
});

const db = drizzle(process.env.DATABASE_URL!);

const registry = new DrizzleEntityRegistry()
  .register(taskEntity.entity, tasks, {
    id: tasks.id, tenantId: tasks.tenantId, title: tasks.title, status: tasks.status, version: tasks.version,
  });

export const pgProvider = createDrizzlePersistenceProvider({
  db, registry, constraintMap: { tasks_title_unique: "tasks.title" }, limits:{ maxPageSize: 100 },
});
// capabilities: { interactiveTransactions:true, atomicBatch:false, returningInsert:true, conditionalAbacUpdate:true }
```

* `getDrizzleSession(provider)` at `packages/adapters/src/drizzle-pg/drizzlePersistenceProvider.ts:17` gives you the bound `DrizzleSessionLike` for sink factories.
* Throws `ConfigurationError` if `columnMap` misses `fields`, `primaryKey`, or `versionField`.

#### Cloudflare D1 (atomic batch)

D1 has no interactive transactions — writes are batched atomically via `executeAtomicBatch`.

```ts
import { drizzle } from "drizzle-orm/d1";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { DrizzleEntityRegistry, createDrizzlePersistenceProvider } from "kittle-adapters/drizzle-d1";
import { createDrizzleD1Adapter } from "kittle-adapters/drizzle-d1";
import { taskEntity } from "./entities/task";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull(),
});

export function makeD1Provider(d1: D1Database) {
  const db = drizzle(d1);
  const adapter = createDrizzleD1Adapter(db); // provides .raw.batch()
  const registry = new DrizzleEntityRegistry().register(taskEntity.entity, tasks, {
    id: tasks.id, tenantId: tasks.tenantId, title: tasks.title, status: tasks.status, version: tasks.version,
  });
  return createDrizzlePersistenceProvider({
    db: adapter, registry,
    auditTable: auditTable, outboxTable: outboxTable,
    idempotencyTable: idempoTable, idempotencyAssertionTable: idempoAssertTable,
    mutationAssertionTable: mutationAssertTable,
    mapOutboxRecord: (r) => ({ id:r.id, type:r.type, payload: JSON.stringify(r.payload), tenantId: r.tenantId ?? null }),
    limits:{ maxPageSize:100, maxBindParams:100, maxStatementBytes:100_000, maxBatchItems:100 },
  });
}
// capabilities: { interactiveTransactions:false, atomicBatch:true, atomicBatchScope:"unscoped", atomicBatchIdempotency: !!(idempotencyTable&&assertion), returningInsert:false }
```

* `D1BatchLimitExceededError` at `packages/adapters/src/drizzle-d1/d1BatchLimits.ts:1` is thrown before `raw.batch()` if estimated `bindParams`/`statementBytes`/`batchItems` exceed limits.
* Tenant-scoped batches use `adapter.createTenantScopedCommandEncoder(tenantId).encode({kind:"insert"|"update"|"delete", ...})` — inserts auto-add `tenantField`+`version=1`, updates/deletes fence with `tenantField=tenantId` + `versionField+1`.
* D1 `repository.insert` does `insert.values` then `findFirst(where pk)`; PG uses `returning()`.

**Repository contract both dialects honor** (`packages/adapters/src/drizzle-pg/drizzleRepository.ts:1` / `drizzle-d1/drizzleRepository.ts:1`):

* `findMany({filter, sort, pagination})` — pagination validated (`page>=1`, `pageSize 1..maxPageSize`), stable pagination appends `PK` tie-breaker, `PredicateNode` compiled via `DrizzlePredicateCompiler` with `COALESCE(expr,FALSE)` so `NOT UNKNOWN` is sound
* `updateOneWhereReturning`/`deleteWhere` guard empty predicates → `ValidationError`, all-true `Predicate.and()` → `ConfigurationError`, multi-row fetch → `ValidationError`
* OCC: `versionField` auto `+1` SQL, `expectedVersion` required; mismatch → `OptimisticConcurrencyError`
* Constraint mapping: PG `23505→ConflictError, 23503→BusinessRuleError, 40001→RetryablePersistenceError`; D1 `SQLITE_CONSTRAINT→Conflict` etc.

---

### 2. Expose HTTP

Two levels: one-liner `CRUD()` for entities, or `createFrameworkWriteHandler` for custom operations.

#### One-liner CRUD

`CRUD()` validates `ENTITY_DEFINITION_BRAND` + `validateEntity` + `skipCapabilityCheck` vs `customCapabilityKey` before wiring.

```ts
import { CRUD } from "kittle-adapters/http";
import { taskEntity } from "./entities/task";
import type { FrameworkAdapterDeps } from "kittle-adapters/server";

const deps: FrameworkAdapterDeps = {
  resolveSession: async ({ scope, request }) => { /* return FrameworkSession */ },
  resolveAbacBundle: async ({ scope, moduleKey, session }) => bundle, // VerifiedAbacPolicyBundle
  hasCapability: ({ capabilityKey, session }) => true,
  assertValidCsrf: (req) => {},
  assertModuleEnabled: () => {},
  assertModuleActionEnabled: () => {},
  assertModuleCapabilityEnabled: () => {},
  isOwnerBypass: ({ session }) => !!session.actor?.bypassAuthority,
  // optional: getRateLimitStore, createIdempotencyPort, resolveClientIp, effectFailureReporter
};

const handlers = CRUD(taskEntity, {
  adapterDeps: deps,
  scope: { type:"tenant", moduleKey:"tenant.tasks" }, // CrudScopeConfig
  createPersistence: (session) => session.tenantId ? createTenantScopedProvider(pgProvider, session.tenantId) : pgProvider,
  getCacheAdapter: () => getCacheAdapter({ engine:"memory" }, factories),
  getRateLimitStore: () => Promise.resolve(rateLimitStore),
  auditSinkFactory: (session) => createDrizzleAuditSink(pgProvider),
  outboxSinkFactory: (session) => createDrizzleOutboxSink(pgProvider),
  runtimeCapabilities: { cache:true, deferredExecution:true, objectStorage:false },
});

// Hono / Next / Cloudflare Workers — all are Fetch Request/Response
app.get("/tasks", (req) => handlers.list(req));
app.get("/tasks/:id", (req) => handlers.detail(req));
app.post("/tasks", (req) => handlers.create(req));
app.patch("/tasks/:id", (req) => handlers.update(req));
app.delete("/tasks/:id", (req) => handlers.delete(req));
```

What you get per route (`packages/adapters/src/http/crudHandlers/*.ts`):

* **list/detail**: `structuralScope` (`tenantField=tenantId`) `AND` ABAC `buildActionScope("read")` `AND` `filtersToPredicate` → `PredicateNode` → SQL; `sort` via `parseSortString` (max 3 keys); `q`/`filters` JSON validated (max 64KiB, depth 5, conditions 50); field-level `resolveFieldQueryDenials` → `assertFieldQueryAccess` throws `ForbiddenError` before DB; result rows `projectResponseRecord` with `fieldReadPlan`; cached via `CacheService` key `buildKey(prefix, partition:abacDigest:scopeKey, serializeCacheKeyPart({type:list, query}))` tags `[tag:scopeKey, scope:scope]`
* **create/update/delete**: `Idempotency-Key` required (255 bytes, fingerprint `v2:hex(SHA-256(canonicalJson(module/action/securityContext/clientMutation/preconditions/abacDigest)))`), `resolveExistingRecord` + `resolveInput`, tenant-scoped `PersistenceProvider`, heartbeat `renew` every `lease/3`, durable receipt (`business-committed` without result in same tx/batch), bounded `invalidateAfterCommit`, `complete` after projection — idempotent replay returns prior `SerializedResponse`

#### Custom operation

```ts
import { createFrameworkWriteHandler } from "kittle-adapters/http";
import { z } from "zod";

const updateStatus = createFrameworkWriteHandler({
  adapterDeps: deps,
  scope: { type:"tenant", moduleKey:"tenant.tasks" },
  moduleKey:"tenant.tasks", action:"update",
  validation: { body: z.object({ status: z.enum(["open","done"]), expectedVersion: z.number().int() }) },
  rateLimit: { max:20, timeWindow:"1 minute", consistency:"atomic" },
  getRateLimitStore: () => pgRateLimitStore,
  getCacheAdapter: () => kvAdapter,
  createPersistence: (session) => provider,
  definition: {
    key:"tenant.tasks.updateStatus", kind:"mutation", atomicity:{ kind:"standard", mode:"required" },
    authorization:{ authorize: async()=>({ allowed:true }) },
    execute: async ({ operation, input }) => {
      const repo = operation.persistence.repository(taskEntity.entity);
      return repo.updateOneWhereReturning(Predicate.eq("id", input.id), { status: input.status }, { expectedVersion: input.expectedVersion });
    },
  },
  resolveInput: async ({ request, body }) => ({ id: request.params.id, ...body }),
  resolveExistingRecord: async ({ input, operation }) => operation.persistence.repository(taskEntity.entity).findById(input.id),
  resolveResourceIdentity: () => ({ entity:"tenant.tasks", id: input.id }),
  recoverCommittedResponse: async ({ input }) => Response.json(await repo.findById(input.id)),
  toResponse: (row) => Response.json(row, { status:200 }),
});
```

#### Error mapping

```ts
import { createFrameworkErrorHandler } from "kittle-adapters/http";
const onError = createFrameworkErrorHandler({ reportError: console.error });
// Unauthorized→401, Forbidden/Capability→403, NotFound→404, Conflict→409, InvalidJson→400, RequestBodyTooLarge→413, UnsupportedMediaType→415, ZodError→400 with details, RateLimit→429+Retry-After, Configuration/RuntimeCapability→500, fallback 500
// Always sets x-request-id / x-correlation-id / cache-control:no-store
```

`requestBody.ts:1` caps `content-length` + stream bytes at `1MiB`, validates `content-type: application/json; charset=utf-8`, bounds `x-correlation-id` 256 / `user-agent` 512, `parseUniqueQueryParameters` rejects duplicate keys.

---

### 3. Server — ABAC + tenant enforcement outside HTTP

```ts
import { createAuthorizedRepository } from "kittle-adapters/server";
import { createAbacAuthorizer } from "kittle-core/domain";
import { Predicate } from "kittle-core/domain/predicate";
import { createTenantScopedPersistenceProvider } from "kittle-core/ports";

const authorizer = createAbacAuthorizer(bundle);
const structuralScope = Predicate.eq("tenantId", session.tenant.id); // or scopeFilter for global entities

const secured = createAuthorizedRepository({
  repository: pgProvider.repository(taskEntity.entity),
  entity: taskEntity.entity,
  authorizer,
  structuralScope,
  structuralInsertValues: { tenantId: session.tenant.id },
  bundle,
});
// secured.findMany({ filter, pagination, sort }) // merges structuralScope AND buildActionScope("read") AND caller filter
// secured.insert({ title }) // blocks pk/tenant/version/immutable writes, asserts authorizer.assertWrite(create), rereads under read scope
// secured.update(id, patch, { expectedVersion }) // OCC fenced via updateOneWhereReturning
// secured.delete(id, { expectedVersion }) // requires integer expectedVersion
```

`FrameworkSession` at `packages/adapters/src/server/frameworkAdapterDeps.ts:1`:

```ts
type FrameworkSession =
 | { scope:"tenant", actor:{ id, type:"tenant", roleId, tenantId, branchId, bypassAuthority? }, tenant:{ id, enabledModuleKeys, enabledModuleActions }, raw }
 | { scope:"platform", actor:{ id, type:"platform", roleId }, raw }
 | { scope:"public", actor:null, raw }
```

---

### 4. Cache

| Adapter | Consistency | Coherence | Use |
|---|---|---|---|
| `InMemoryCacheAdapter` | `linearizable` | `process` | single-instance / tests — `incrementRateLimitAtomically` via Map |
| `KvCacheAdapter` | `eventual` | `shared` | Cloudflare KV — best-effort `addToTag` |
| `SharedGenerationCacheAdapter` | `linearizable` | `shared` | Wraps `Kv`/`Memory` payload with a `TagGenerationStore` (DB) so invalidation is correctness-critical |
| `DbTagGenerationStore` | atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING generation+1` | — | Postgres (`pgTable`) or D1 (`sqliteTable`) `{tag, generation}` table |

```ts
import { getCacheAdapter } from "kittle-adapters/cache";
import { InMemoryCacheAdapter } from "kittle-adapters/cache";
import { KvCacheAdapter } from "kittle-adapters/cache";
import { SharedGenerationCacheAdapter, DbTagGenerationStore } from "kittle-adapters/cache";

const factories = {
  memory: () => new InMemoryCacheAdapter(),
  kv: async () => new KvCacheAdapter(kvNamespace),
};

// Memoized per factories WeakMap, promise dedup, evict on error:
const mem = await getCacheAdapter({ engine:"memory" }, factories);
const kv  = await getCacheAdapter({ engine:"kv" }, factories);

// Correctness-critical shared invalidation (PG example):
const tagStore = new DbTagGenerationStore(pgDb, tagTable); // pgTable("cache_tags", { tag:text().primaryKey(), generation: integer().notNull() })
const shared = new SharedGenerationCacheAdapter({ payload: kv, generations: tagStore });

// CRUD handlers use: get(key) / set(key,data,ttlMs) / delete(key) / addToTag(tag,key) / advanceTagGeneration(tag)
```

Rate limiting over cache:

```ts
import { CacheBackedRateLimitStore, AtomicCacheBackedRateLimitStore } from "kittle-adapters/cache";
const bestEffort = new CacheBackedRateLimitStore(cache); // consistency:"best-effort" — read-modify-write
const atomic    = new AtomicCacheBackedRateLimitStore(cache); // consistency:"atomic" — delegates to cache.incrementRateLimitAtomically
// Key namespaced scope:tenant:module:action:ip/custom + boundRateLimitKeyMaterial fingerprint for long keys
```

---

### 5. Idempotency — exactly-once commit

Both dialects guarantee the business mutation and the durable receipt commit atomically.

* **PG** (`DrizzlePgIdempotencyStore` `packages/adapters/src/drizzle-pg/drizzleIdempotencyStore.ts:1`): `TransactionalIdempotencyPort` — `acquire` inserts `in-progress` row → on `23505` rereads, `resolveExisting` (fingerprint mismatch→`Conflict`, `completed`→replay, `business-committed`→businessCommitted), `renew` updates `createdAt`, `markCommittedInTransaction` updates to `business-committed` inside same `runInTransaction`
* **D1** (`DrizzleD1IdempotencyStore` `packages/adapters/src/drizzle-d1/drizzleIdempotencyStore.ts:1`): `AtomicBatchIdempotencyPort` — `createCommitBatchItem` returns `{kind:"idempotency", commit:{scope,key,fingerprint,token,resource,invalidations}}` joined into the same `batch()`, plus an `idempotencyAssertionTable` BEFORE INSERT trigger that `RAISE`s if the reservation token is stale (aborts whole batch)

Lease: `30s` default, `1ms..24h` via `validateLeaseDuration`, heartbeat `lease/3` by `createFrameworkWriteHandler`.

**Finalizer (drain pending invalidations):**

```ts
import { drainPendingInvalidations, createIdempotencyFinalizerService } from "kittle-adapters/http";

await drainPendingInvalidations({
  port: d1IdempotencyStore, // IdempotencyFinalizationPort: claimPendingInvalidations + ack/complete
  invalidate: async (tags) => {
    for (const tag of tags) await shared.advanceTagGeneration(tag);
  },
  limit: 100, claimOwner:"worker-1", leaseMs:30_000,
});

const svc = createIdempotencyFinalizerService({ drain: () => drainPendingInvalidations({...}), intervalMs: 10_000 });
svc.start(); // interval with in-flight guard, telemetry.onError
// Call svc.stop() on shutdown
```

---

### 6. Jobs & schedules

DDL is yours (see `packages/adapters/src/drizzle-pg/drizzleJobStore.ts` / `drizzle-d1/drizzleJobStore.ts` for columns). Minimal:

```sql
-- Postgres jobs: id, job_type, job_version, tenant_id, scope, payload, status, priority, attempts_completed, current_attempt, max_attempts, run_at, next_attempt_at, lease_owner, lease_expires_at, claim_token, idempotency_key, fingerprint, correlation_id, last_error, result_payload, metadata, partition_key, created_at, started_at, completed_at
-- Schedules: id, scope, job_type, job_version, tenant_id, payload, cron_expression, timezone, enabled, overlap_policy, misfire_policy, next_run_at, last_run_at, last_status, created_at, updated_at, lease_owner, claim_token, lease_expires_at
```

```ts
import { DrizzleJobStore, DrizzleScheduleStore } from "kittle-adapters/drizzle-pg";
import { dispatchDueJobs } from "kittle-core/execution/dispatcher";
import { materializeDueSchedules } from "kittle-core/execution/scheduleDispatcher";
import { createIntlCronTimezoneAdapter } from "kittle-core/execution";

const jobStore = new DrizzleJobStore(pgDb, { jobsTable, executionsTable, executionHistory:"required", columnMap });
const scheduleStore = new DrizzleScheduleStore(pgDb, { schedulesTable, columnMap, resolveTenantTimezones, platformTimezone:"UTC" });

// Worker loops
setInterval(async () => {
  await dispatchDueJobs({ store: jobStore, registry, workerId:"w1", leaseDurationMs:30_000, claimLimit:20, requester:{ scope:"system" } });
}, 5_000);

setInterval(async () => {
  await materializeDueSchedules({
    scheduleStore, jobStore, workerId:"w1", limit:20, maxQueueAllOccurrences:50, now:new Date(),
    tzAdapter: createIntlCronTimezoneAdapter(), // DST-aware via Intl.DateTimeFormat
    leaseDurationMs:30_000,
  });
}, 30_000);
```

* `jobStore.enqueue` computes `fingerprintJob(buildJobFingerprintInput(NewJob))` (`v2:hex(SHA-256(canonicalJson))`) and `idempotencyScope = tenant:tenantId | scope` — duplicate `scope+idempotencyKey` with different fingerprint → `JobIdempotencyConflictError`
* `claimDue` selects `pending|retrying` (`attempts<max && nextAttemptAt<=now`) OR expired `running` leases, ordered `priority asc, runAt asc`, fenced with `NOT EXISTS running sibling where partition_key` for `partitionKey` serialization (`schedule:<id>` for queued schedules)
* Schedule materialization: `claimDueSchedules` fenced by `claimToken` (uuidv7), `getLatestPriorScheduleExecution` (fenced by `schedule:occurrence` not wall-clock) drives `shouldFireSchedule` `skip|queue|allow` + misfire `skip|fire_now|queue_all` per occurrence

---

### 7. Predicate compilation

```ts
import { DrizzlePredicateCompiler, compileDrizzlePredicate } from "kittle-adapters/drizzle-pg";
import { Predicate } from "kittle-core/domain/predicate";

const compiler = new DrizzlePredicateCompiler();
// or: compileDrizzlePredicate(filter, columnMap)
const where = compiler.compile(Predicate.and(Predicate.eq("status","open"), Predicate.gte("priority", 1)));
// -> SQL: COALESCE(status = 'open', FALSE) AND COALESCE(priority >= 1, FALSE)
```

Shared at `packages/adapters/src/drizzle-shared/predicateCompiler.ts:1`: `LIKE ESCAPE '\\'` with `escapeLike`, `isEmpty→ isNull OR =''`, `isNotEmpty→ isNotNull AND <>''`, `in→ inArray` or `1=0`, `between→ gte/lte`, all leaves `COALESCE(...,FALSE)` via `strictBoolean`. Throws for `includesAny/includesAll`.

---

### 8. Recipes

#### End-to-end: tasks with tenant ABAC, cache, audit, outbox (PG + Hono)

```ts
import { Hono } from "hono";
import { CRUD } from "kittle-adapters/http";
import { createFrameworkErrorHandler, createIdempotencyFinalizerService, drainPendingInvalidations } from "kittle-adapters/http";
import { DrizzleEntityRegistry, createDrizzlePersistenceProvider, DrizzleJobStore } from "kittle-adapters/drizzle-pg";
import { DrizzleAuditSink, DrizzleOutboxSink } from "kittle-adapters/drizzle-pg";
import { DrizzlePgIdempotencyStore } from "kittle-adapters/drizzle-pg";
import { getCacheAdapter } from "kittle-adapters/cache";
import { taskEntity } from "./entities/task";
import { tasks } from "./db/schema";
import { db } from "./db";
import { deps } from "./server/deps"; // FrameworkAdapterDeps impl + resolveAbacBundle via createAbacBundle

const registry = new DrizzleEntityRegistry().register(taskEntity.entity, tasks, { id:tasks.id, tenantId:tasks.tenantId, title:tasks.title, status:tasks.status, version:tasks.version });
const provider = createDrizzlePersistenceProvider({ db, registry });
const handlers = CRUD(taskEntity, {
  adapterDeps: deps, scope:{ type:"tenant", moduleKey:"tenant.tasks" },
  createPersistence: (s) => createTenantScopedPersistenceProvider(provider, s.tenant!.id, Predicate.eq("tenantId", s.tenant!.id)),
  getCacheAdapter: () => getCacheAdapter({ engine:"memory" }, factories),
  auditSinkFactory: () => new DrizzleAuditSink(db, auditTable),
  outboxSinkFactory: () => new DrizzleOutboxSink(db, outboxTable, (r)=>({ type:r.type, payload: JSON.stringify(r.payload) })),
});
const app = new Hono();
app.get("/tasks", (c) => handlers.list(c.req.raw));
app.post("/tasks", (c) => handlers.create(c.req.raw));
app.onError(createFrameworkErrorHandler());
```

#### D1 + Cloudflare Workers

```ts
import { createDrizzleD1Adapter, DrizzleEntityRegistry, createDrizzlePersistenceProvider } from "kittle-adapters/drizzle-d1";
export default {
  async fetch(request, env) {
    const provider = makeD1Provider(env.DB); // per-request D1Database
    const handlers = CRUD(taskEntity, { adapterDeps: makeDeps(env), scope:{ type:"tenant", moduleKey:"tenant.tasks" }, createPersistence:()=>provider, getCacheAdapter: ()=>kvAdapter(env.KV) });
    return handlers.list(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(materializeDueSchedules({ scheduleStore: makeScheduleStore(env.DB), jobStore: makeJobStore(env.DB), workerId:"worker-1", limit:20, now:new Date(), tzAdapter: createIntlCronTimezoneAdapter() }));
  },
};
```

#### Field masking

```ts
import { redactPhiDeep } from "kittle-adapters/utils/redact";
// createOperationContext({ auditSanitizer: redactPhiDeep, ... })
// redactPhi("user@example.com 415-555-0100") -> "[email redacted] [phone redacted]"
```

---

### 9. Deployment notes

* **D1 batch limits** — `maxBindParams:100`/`maxStatementBytes:100_000`/`maxBatchItems:100` validated via `assertD1BatchLimits` — large outbox + audit + idempotency batches must stay within the Cloudflare 100-statement `raw.batch()` limit
* **KV invalidation** — raw `KvCacheAdapter` is `eventual`/`shared`; wrap with `SharedGenerationCacheAdapter` + `DbTagGenerationStore` for correctness-critical reads (listed list/detail must not serve stale)
* **Rate limit coherence** — `consistency:"atomic"` requires `AtomicCacheBackedRateLimitStore` i.e. cache providing `incrementRateLimitAtomically` (InMemory or SharedGeneration); otherwise it throws and CRUD falls back to `CacheBackedRateLimitStore` best-effort
* **Trusted proxy** — `resolveTrustedClientIp(req, {trustedProxyIps, trustedProxyHops}, {peerAddress, trustedProxy})` validates `x-forwarded-for` length `== hops+1` and that last `hops` are trusted before trusting `forwarded[0]`

## Development

```sh
npm run typecheck:adapters      # tsc -p packages/adapters/tsconfig.json --noEmit
npm run lint:adapters           # eslint src --max-warnings=0
npm test --workspace kittle-adapters  # vitest run — 46 files / 410 tests
npm run build --workspace kittle-adapters
npm run verify:hardening && npm run verify:release
```

## License

MIT
