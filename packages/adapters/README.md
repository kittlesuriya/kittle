# Runtime and persistence adapters

This package connects the TypeScript reference implementation to real
application runtimes. It provides Fetch-compatible HTTP handlers, Drizzle persistence
providers, cache and rate-limit adapters, server authorization wiring,
idempotency stores, audit/outbox sinks, and durable job/schedule stores.

## Install

```sh
npm install kittle-core kittle-adapters
```

The package is ESM-only and requires Node.js 20 or newer. Add the database
driver required by the selected dialect and use the matching Drizzle runtime:

| Dialect       | Adapter                         | Runtime dependency                   |
| ------------- | ------------------------------- | ------------------------------------ |
| PostgreSQL    | `kittle-adapters/drizzle-pg`    | `drizzle-orm/node-postgres` and `pg` |
| Cloudflare D1 | `kittle-adapters/drizzle-d1`    | `drizzle-orm/d1` and a D1 binding    |
| MySQL         | `kittle-adapters/drizzle-mysql` | matching Drizzle MySQL driver        |

Migrations are application-owned. `drizzle-kit` is useful during development
but is not required at runtime.

## Entry points

| Import                          | Contents                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `kittle-adapters`               | Main barrel: HTTP, cache, server, and D1 exports. PostgreSQL is namespaced as `drizzlePg`.       |
| `kittle-adapters/http`          | `CRUD`, custom write handlers, request parsing, error serialization, and idempotency finalizers. |
| `kittle-adapters/server`        | `FrameworkAdapterDeps`, authorized repositories, and server-side ABAC helpers.                   |
| `kittle-adapters/drizzle-pg`    | PostgreSQL provider, registry, repositories, sinks, idempotency, jobs, and schedules.            |
| `kittle-adapters/drizzle-d1`    | D1 provider, atomic batches, repositories, sinks, idempotency, jobs, and schedules.              |
| `kittle-adapters/drizzle-mysql` | MySQL provider, repositories, sinks, idempotency, jobs, and schedules.                           |
| `kittle-adapters/cache`         | In-memory, KV, shared-generation cache, and rate-limit stores.                                   |
| `kittle-adapters/fastify`       | Fastify route registration and project integration.                                              |
| `kittle-adapters/utils/redact`  | Audit-oriented email, phone, and sensitive-text redaction helpers.                               |

Use package subpaths instead of importing from `src`. The package export map is
the supported API surface.

## Integration model

Adapters are intentionally explicit. An application supplies:

1. a session resolver and trusted request metadata;
2. an ABAC bundle resolver;
3. a persistence provider and entity registry;
4. cache, audit, outbox, and idempotency implementations as needed;
5. route registration for the chosen web framework.

The handlers use Fetch `Request` and `Response`, so they can be mounted in
Hono, Cloudflare Workers, Next-style route handlers, or a custom server. The
Fastify integration translates framework requests at the edge and keeps the
core HTTP handlers framework-neutral.

## Database setup

### PostgreSQL

PostgreSQL supports interactive transactions. Register every entity touched by
operations and map every declared field to a Drizzle column.

```ts
import { drizzle } from "drizzle-orm/node-postgres"
import { pgTable, text, integer } from "drizzle-orm/pg-core"
import {
  DrizzleEntityRegistry,
  createDrizzlePersistenceProvider,
} from "kittle-adapters/drizzle-pg"

const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull(),
})

const db = drizzle(process.env.DATABASE_URL!)
const registry = new DrizzleEntityRegistry().register(
  taskEntity.entity,
  tasks,
  {
    id: tasks.id,
    tenantId: tasks.tenantId,
    title: tasks.title,
    status: tasks.status,
    version: tasks.version,
  }
)

const provider = createDrizzlePersistenceProvider({ db, registry })
```

PostgreSQL can use interactive transaction capabilities and `returning()` for
mutation results. SQL constraint errors are classified into conflict, business
rule, validation, and retryable persistence errors where the dialect permits.

### Cloudflare D1

D1 does not provide interactive transactions. The D1 adapter uses Drizzle's raw batch
capability for atomic-batch operations and validates statement, bind-parameter,
and batch-item limits before execution.

```ts
import { drizzle } from "drizzle-orm/d1"
import { createDrizzleD1Adapter } from "kittle-adapters/drizzle-d1"
import {
  DrizzleEntityRegistry,
  createDrizzlePersistenceProvider,
} from "kittle-adapters/drizzle-d1"

export function createProvider(database: D1Database) {
  const db = drizzle(database)
  const adapter = createDrizzleD1Adapter(db)
  const registry = new DrizzleEntityRegistry().register(
    taskEntity.entity,
    tasks,
    {
      id: tasks.id,
      tenantId: tasks.tenantId,
      title: tasks.title,
      status: tasks.status,
      version: tasks.version,
    }
  )
  return createDrizzlePersistenceProvider({ db: adapter, registry })
}
```

D1 providers must be created per request when the D1 binding is request-scoped.
Use tenant-scoped command encoding for atomic writes and configure the tables
required by audit, outbox, and idempotency guarantees.

### MySQL

The MySQL adapter follows the same entity registry and repository contracts.
Use `kittle-adapters/drizzle-mysql` for dialect-specific stores and map the
database's duplicate-key, foreign-key, nullability, check, deadlock, and lock
timeout errors through the provider's classification logic.

## HTTP CRUD

`CRUD()` wires an entity definition to list, detail, create, update, and delete
handlers.

```ts
import { CRUD } from "kittle-adapters/http"

const handlers = CRUD(taskEntity, {
  adapterDeps,
  scope: { scope: "tenant" },
  createPersistence: (session) =>
    createTenantScopedPersistenceProvider(
      provider,
      session.tenant.id,
      Predicate.eq("tenantId", session.tenant.id)
    ),
  getCacheAdapter: () => cache,
  getRateLimitStore: () => rateLimitStore,
  auditSinkFactory: (_session, persistence) => createAuditSink(persistence),
  outboxSinkFactory: (_session, persistence) => createOutboxSink(persistence),
  runtimeCapabilities: {
    cache: true,
    deferredExecution: true,
    objectStorage: false,
  },
  errorExposure: {
    exposeBusinessRuleMessage: true,
  },
})

app.get("/tasks", (request) => handlers.list(request))
app.get("/tasks/:id", (request, context) =>
  handlers.detail(request, context.params)
)
app.post("/tasks", (request) => handlers.create(request))
app.patch("/tasks/:id", (request, context) => handlers.update(request, context))
app.delete("/tasks/:id", (request, context) =>
  handlers.delete(request, context)
)
```

CRUD handlers enforce the entity's validation, tenancy, capability, ABAC,
field-access, rate-limit, cache, audit, outbox, idempotency, and concurrency
configuration. The application still owns route prefixes, authentication, and
framework-specific middleware.

### Error responses

`createFrameworkErrorHandler` maps typed errors to safe HTTP responses and adds
request/correlation headers:

```ts
import { createFrameworkErrorHandler } from "kittle-adapters/http"

app.onError(
  createFrameworkErrorHandler({
    reportError: (error) => logger.error(error),
  })
)
```

Typical responses include:

| Error                          | Status |
| ------------------------------ | -----: |
| Unauthorized                   |    401 |
| Forbidden / capability denied  |    403 |
| Validation / business rule     |    400 |
| Not found                      |    404 |
| Conflict / OCC failure         |    409 |
| Request body too large         |    413 |
| Unsupported media type         |    415 |
| Rate limit exceeded            |    429 |
| Configuration/internal failure |    500 |

Responses include a stable string `code` and numeric `numericCode`. Internal
messages and details are not serialized by default.

### Opt-in business-rule messages

CRUD catches errors internally, so configure exposure on its runtime rather than
expecting an outer framework `onError` callback to recover the original error.

```ts
const handlers = CRUD(taskEntity, {
  // existing CRUD runtime fields
  adapterDeps,
  scope: { scope: "tenant" },
  createPersistence,
  getCacheAdapter,
  errorExposure: {
    exposeBusinessRuleMessage: true,
    // Keep false unless the details have been deliberately designed for clients.
    exposeBusinessRuleDetails: false,
  },
})
```

With the option enabled, a `BusinessRuleError("Cannot delete role with assigned users")`
becomes:

```json
{
  "error": "Cannot delete role with assigned users",
  "code": "BAD_REQUEST",
  "numericCode": 1002
}
```

Message exposure is opt-in because business messages can accidentally include
database details, identifiers, or sensitive policy information.

## Request boundaries

The HTTP layer provides defensive limits and normalization:

- JSON bodies are limited to the configured maximum, defaulting to 1 MiB.
- Content type must be JSON with UTF-8 encoding.
- Query parameter names must be unique.
- Query/filter/sort payloads have byte, depth, and item limits.
- Request and correlation metadata are bounded before propagation.
- Forwarded client IP headers are trusted only through an authenticated,
  configured proxy chain.
- Responses set `cache-control: no-store` and carry request/correlation IDs.

## Cache and rate limits

| Adapter                        | Behavior                                | Appropriate for                                |
| ------------------------------ | --------------------------------------- | ---------------------------------------------- |
| `InMemoryCacheAdapter`         | Process-local, linearizable             | Tests and single-instance deployments.         |
| `KvCacheAdapter`               | Shared, eventual KV storage             | Best-effort caching and globally shared reads. |
| `SharedGenerationCacheAdapter` | Shared payloads plus generation fencing | Correctness-critical invalidation.             |
| `DbTagGenerationStore`         | Atomic tag-generation storage           | PostgreSQL or D1 shared invalidation.          |

Atomic rate limits require an adapter implementing
`incrementRateLimitAtomically`. Otherwise use the explicitly best-effort store.
Do not describe an eventual cache as correctness-critical without generation
fencing.

## Idempotency

Mutation handlers use an `Idempotency-Key` when idempotency is required. The
fingerprint includes the module/action, security context, client mutation,
preconditions, and ABAC digest. A matching completed request replays the stored
response; a key reused with a different fingerprint becomes a conflict.

PostgreSQL stores receipts in the transaction. D1 includes the receipt and
assertion command in the atomic batch. Configure the finalizer service to drain
pending cache invalidations after a crash:

```ts
import {
  createIdempotencyFinalizerService,
  drainPendingInvalidations,
} from "kittle-adapters/http"

const finalizer = createIdempotencyFinalizerService({
  intervalMs: 10_000,
  drain: () =>
    drainPendingInvalidations({
      port: idempotencyPort,
      invalidate: (tags) => cache.invalidateTags(tags),
      limit: 100,
      claimOwner: "worker-1",
      leaseMs: 30_000,
    }),
})

finalizer.start()
```

Stop background services during graceful shutdown.

## Jobs and schedules

Drizzle job and schedule stores implement the core execution contracts. Workers
should renew leases at approximately one third of the lease duration, use a
stable worker ID, and handle process restarts. Configure execution history when
schedule overlap and misfire decisions need durable evidence.

The core dispatcher remains storage-independent:

```ts
import { dispatchDueJobs, materializeDueSchedules } from "kittle-core/execution"

await dispatchDueJobs({
  store: jobStore,
  registry,
  workerId: "worker-1",
  leaseDurationMs: 30_000,
  claimLimit: 20,
  requester: { scope: "platform", actorId: "worker-1" },
})

await materializeDueSchedules({
  scheduleStore,
  jobStore,
  workerId: "worker-1",
  limit: 20,
  now: new Date(),
  tzAdapter: createIntlCronTimezoneAdapter(),
})
```

## Audit and outbox

Audit and outbox sinks receive the persistence provider bound to the current
operation. This is important: constructing a sink from an unrelated database
connection can move records outside the business transaction.

Choose guarantees deliberately:

- `best-effort`: the business operation may succeed if the side effect fails;
- `atomic`: the mutation and record must succeed together;
- `durable`: use an outbox-backed obligation for later delivery.

Sanitize values before writing audit records and classify fields explicitly.

## Predicate compilation

The dialect adapters compile core predicates into SQL. Compilation preserves
boolean semantics by coalescing nullable expressions and rejects unsupported
operators rather than silently approximating them.

```ts
import { Predicate } from "kittle-core/domain/predicate"
import { DrizzlePredicateCompiler } from "kittle-adapters/drizzle-pg"

const filter = Predicate.and(
  Predicate.eq("status", "open"),
  Predicate.gte("priority", 1)
)
const where = new DrizzlePredicateCompiler().compile(filter)
```

## Deployment checklist

- Run database migrations before enabling routes.
- Register every entity field used by operations.
- Configure tenant scope and verify structural predicates in integration tests.
- Require CSRF protection for browser-authenticated non-public writes.
- Configure trusted proxy addresses before using forwarded client IPs.
- Use a shared-generation cache for correctness-critical invalidation.
- Configure the idempotency finalizer for crash recovery.
- Run workers with stable IDs and graceful lease shutdown.
- Do not expose business messages or details without reviewing their contents.
- Keep request, correlation, and audit logs free of secrets.

## Development

```sh
npm run typecheck:adapters
npm run lint:adapters
npm test --workspace kittle-adapters
npm run build --workspace kittle-adapters
```

## License

MIT
