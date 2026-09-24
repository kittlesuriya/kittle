# Reference implementation

This package contains the framework-independent TypeScript reference
implementation of the Application Security and Execution Specification. It has
no HTTP framework, database driver, queue client, or Cloudflare runtime
dependency.

## What this package provides

- **Entities**: branded, validated definitions for tenancy, fields, routes,
  optimistic concurrency, caching, rate limits, and lifecycle hooks.
- **ABAC**: catalogs, policy normalization, verified policy bundles,
  deny-by-default authorization, field access, and query scope generation.
- **Operations**: a controlled `before → execute → after → commit → afterCommit`
  pipeline with transaction and atomic-batch execution.
- **Durable execution contracts**: jobs, schedules, retries, fencing, and
  partition serialization.
- **Ports**: persistence, repositories, audit, outbox, cache, idempotency,
  job, and schedule interfaces.
- **Predicates**: persistence-neutral filters that can be evaluated in memory
  or compiled by an adapter.
- **Structured errors**: stable string codes, numeric codes, safe details, and
  retry classification.

## Install

```sh
npm install kittle-core
```

Requirements:

- Node.js 20 or newer.
- ESM (`"type": "module"`).
- TypeScript configured for ESM imports and package subpath exports.

## Public entrypoints

| Import                                 | Contents                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `kittle-core`                          | Foundation, domain, entity, execution, and operation barrel.                     |
| `kittle-core/foundation`               | Errors, request context, canonical JSON, validation, and security foundations.   |
| `kittle-core/foundation/errors`        | `FrameworkCoreError`, error classes, and error-code registries.                  |
| `kittle-core/foundation/canonicalJson` | Deterministic JSON canonicalization and limits.                                  |
| `kittle-core/domain`                   | ABAC, predicates, authorization, policy normalization, and domain errors.        |
| `kittle-core/domain/predicate`         | `Predicate` factories and predicate capability checks.                           |
| `kittle-core/entity`                   | `defineEntity`, entity validation, and entity brands.                            |
| `kittle-core/entity/capabilityCheck`   | Capability configuration types and helpers.                                      |
| `kittle-core/operation`                | Operation definitions, execution contexts, and runners.                          |
| `kittle-core/execution`                | Job/schedule types, registries, dispatchers, and retry helpers.                  |
| `kittle-core/ports`                    | Persistence, repository, audit, outbox, cache, idempotency, and execution ports. |
| `kittle-core/cache`                    | Cache contracts, cache service, key construction, and cache errors.              |
| `kittle-core/rate-limit`               | Rate-limit contracts and enforcement helpers.                                    |

The package export map in `package.json` is the source of truth for supported
subpaths. Prefer public subpaths over importing from `src`.

## Core concepts

### Entity definitions

An entity definition is the contract shared by domain code and adapters. It
declares the shape of a row and the security-sensitive behavior around it.

```ts
import { z } from "zod"
import { defineEntity } from "kittle-core/entity"

type Task = {
  id: string
  tenantId: string
  title: string
  status: "open" | "done"
  version: number
}

export const taskEntity = defineEntity<Task>({
  moduleKey: "tenant.tasks",
  entity: {
    name: "task",
    fields: {
      id: { type: "string" },
      tenantId: { type: "string" },
      title: { type: "string" },
      status: { type: "string" },
      version: { type: "number" },
    },
    primaryKey: "id",
    tenantField: "tenantId",
    versionField: "version",
    immutableFields: ["tenantId"],
  },
  tenantScoping: { mode: "scoped" },
  policy: { customCapabilityKey: "tasks:manage" },
  validation: {
    createBody: z.object({ title: z.string().min(1) }),
    updateBody: z.object({ title: z.string().min(1).optional() }),
    idParams: z.object({ id: z.string().uuid() }),
  },
  routes: {
    list: true,
    detail: true,
    create: true,
    update: true,
    delete: true,
  },
})
```

Important invariants:

- `tenantScoping.mode: "scoped"` requires `entity.tenantField`.
- `tenantScoping.mode: "none"` requires explicit acknowledgement.
- Update and delete routes require a numeric `versionField` for OCC.
- The version field must match `optimisticConcurrency.versionField` when both
  are declared.
- `filterableColumns` and `sortableColumns` must reference declared fields.
- Entity definitions are validated, frozen, and branded. Adapters reject
  arbitrary objects passed in place of a definition.

### ABAC catalogs and policy bundles

The catalog defines the fields and operators that policies may reference. It
is the boundary between policy storage and executable authorization.

```ts
import { defineAbacModule } from "kittle-core/domain"

export const taskCatalog = defineAbacModule({
  moduleKey: "tenant.tasks",
  actions: ["read", "create", "update", "delete"],
  capabilities: ["tasks:manage"],
  fields: {
    status: { key: "status", type: "string", operators: ["eq", "in"] },
    title: { key: "title", type: "string", operators: ["contains"] },
  },
})
```

`createAbacBundle` resolves policies through an application-supplied
`AbacPolicyProvider`, normalizes and validates them, applies scope rules, and
binds a security digest. The resulting `VerifiedAbacPolicyBundle` is required
at enforcement boundaries.

```ts
import { createAbacAuthorizer, createAbacBundle } from "kittle-core/domain"

const bundle = await createAbacBundle({
  provider,
  mode: "tenant",
  moduleKey: "tenant.tasks",
  context: { userId: "user-1", tenantId: "tenant-1" },
})

const authorizer = createAbacAuthorizer(bundle)
authorizer.assertRecordAction(task, "update")

const readScope = authorizer.buildActionScope("read")
const readPlan = authorizer.fieldReadPlan("read")
```

ABAC is deny-by-default. Policy scope references are checked against the active
authorization context, inactive policies are excluded, and a malformed or
scope-incompatible policy fails bundle creation rather than weakening access.

### Predicates

Predicates are data structures, not database expressions:

```ts
import { Predicate } from "kittle-core/domain/predicate"

const openTasks = Predicate.and(
  Predicate.eq("status", "open"),
  Predicate.contains("title", "urgent")
)
```

Use `evaluatePredicate` for in-memory decisions. Database adapters compile the
same tree to SQL and preserve the framework's three-valued/null semantics.
Validate user or policy predicates against the catalog before persisting or
executing them.

### Operations

Operations keep business logic independent from HTTP and workers.

```ts
import { runOperation } from "kittle-core/operation"

const createTask = {
  key: "tenant.tasks.create",
  kind: "mutation",
  atomicity: { kind: "standard", mode: "required" },
  authorization: { authorize: async () => ({ allowed: true }) },
  execute: async ({ operation, input }) => {
    const repository = operation.persistence.repository(taskEntity.entity)
    return repository.insert(input)
  },
}

const result = await runOperation({ operation, definition: createTask, input })
```

The operation pipeline validates the definition, creates a run-scoped context,
enforces authorization, executes through the provider's transaction capability,
and separates committed business results from post-commit effect failures.

Use `runOperationDetailed` when the caller needs a committed outcome and
warnings rather than exception-only control flow.

### Durable jobs and schedules

The execution APIs define storage and worker contracts. They do not assume a
queue provider. Jobs use:

- opaque claim tokens and lease ownership;
- heartbeat renewal and stale-lease recovery;
- retry policies and attempt accounting;
- tenant/platform scope validation;
- idempotency keys and deterministic fingerprints;
- `partitionKey` serialization for mutually exclusive work.

Schedules add cron calculation, timezone handling, overlap policies, and
misfire policies. See the execution subpath types and the adapter-specific job
stores for storage schemas.

### Ports

Core ports are dependency-inversion boundaries. Applications or adapters
implement them; core consumes them.

| Port                         | Responsibility                                           |
| ---------------------------- | -------------------------------------------------------- |
| `PersistenceProvider`        | Provider capabilities, transactions, and atomic batches. |
| `Repository`                 | Typed entity reads and mutations with filtering and OCC. |
| `AuditSink`                  | Durable or best-effort audit records.                    |
| `OutboxSink`                 | Transactional records for external delivery.             |
| `CacheAdapter`               | Cache values, tags, generations, and atomic counters.    |
| `IdempotencyPort`            | Reservation, lease, commit receipt, and replay.          |
| `JobStore` / `ScheduleStore` | Durable worker and scheduler state.                      |

## Error handling

All `FrameworkCoreError` instances expose:

- `code`: stable semantic string identifier;
- `numericCode`: stable application error number;
- `details`: optional structured metadata, which should be treated as internal.

Numeric codes are not HTTP status codes. The HTTP adapter maps them to a status
and sanitizes messages by default. Business-rule message exposure is an
adapter-level policy, not a core behavior.

The framework registry currently assigns these ranges:

| Numeric range | Category                         | Examples                                                                            |
| ------------: | -------------------------------- | ----------------------------------------------------------------------------------- |
|   `1000–1099` | Client input                     | `VALIDATION_ERROR` (`1001`), `BAD_REQUEST` (`1002`)                                 |
|   `1100–1199` | Identity and authorization       | `UNAUTHORIZED` (`1101`), `FORBIDDEN` (`1102`), `CAPABILITY_REQUIRED` (`1103`)       |
|   `1200–1299` | Resource and concurrency         | `NOT_FOUND` (`1201`), `CONFLICT` (`1202`), `OPTIMISTIC_CONCURRENCY_FAILED` (`1203`) |
|   `1300–1399` | Traffic control                  | `RATE_LIMIT_EXCEEDED` (`1301`)                                                      |
|   `2000–2099` | Configuration and infrastructure | `CONFIGURATION_ERROR` (`2004`), `INVALID_POLICY_CONFIGURATION` (`2005`)             |
|   `3000–3099` | Persistence                      | `RETRYABLE_PERSISTENCE_ERROR` (`3001`)                                              |
|   `4000–4099` | Operation lifecycle              | `OPERATION_CONTEXT_INACTIVE` (`4001`), effect lifecycle errors                      |
|   `5000–5099` | HTTP fallback                    | `INTERNAL_SERVER_ERROR` (`5001`)                                                    |

Applications should not reuse framework numbers for unrelated domain APIs. Add
application-specific business numbers in an application registry and keep them
separate from the framework `numericCode` when a stable public contract is
needed.

```ts
import { BusinessRuleError, FrameworkCoreError } from "kittle-core/domain"

throw new BusinessRuleError("Cannot delete a role with assigned users", {
  roleId,
})

try {
  await runOperation(/* ... */)
} catch (error) {
  if (error instanceof FrameworkCoreError) {
    console.log(error.code, error.numericCode)
  }
}
```

## Security and correctness rules

1. Never bypass tenant scoping by accepting a tenant ID from an untrusted body.
2. Use the verified ABAC bundle at the enforcement boundary; do not trust a
   caller-provided digest or policy result.
3. Require OCC for update/delete paths.
4. Treat `afterCommit` as post-commit work; it cannot make a committed mutation
   roll back.
5. Use canonical JSON for durable fingerprints and enforce payload limits.
6. Keep audit classification explicit. Heuristic redaction is not a substitute
   for schema-level sensitivity classification.

## Development

```sh
npm run typecheck:core
npm run lint:core
npm run test:core
npm run build --workspace kittle-core
```

## License

MIT
