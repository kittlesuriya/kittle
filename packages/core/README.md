# kittle-core

Domain, entity, execution, operation, and persistence-port primitives for building tenant-aware TypeScript applications with deny-by-default ABAC, optimistic concurrency, and durable execution.

> Framework core only — no HTTP, no database. Pair with [`kittle-adapters`](https://www.npmjs.com/package/kittle-adapters) for Drizzle (D1/Postgres), HTTP, cache, and server wiring.

## Why

* **Tenant isolation is structural**, not advisory — `tenantField` + `TenantScopingChoice` + `createTenantScopedPersistenceProvider` make cross-tenant access impossible by construction
* **ABAC is verifiable** — `VerifiedAbacPolicyBundle` carries a SHA-256 security digest; mutation re-validates the digest
* **Operations are atomic and observable** — `runOperation` enforces `before → execute → after → commit → afterCommit` with transactional vs atomic-batch paths, bounded retries, and committed-effect reporting
* **Execution is durable** — `JobStore`/`ScheduleStore` use opaque `claimToken` fencing, heartbeat `renewLease` every `lease/3`, and `partitionKey` serialization so crashes are recoverable

## Install

```sh
npm install kittle-core
```

* ESM only (`"type":"module"`), Node `>=20` (`packages/core/package.json:22`)
* `tsconfig.json` needs `moduleResolution: "nodenext"` for subpath exports

## Entrypoints

| Import | Purpose |
|---|---|
| `kittle-core` | barrel: domain + entity + execution + operation + ports |
| `kittle-core/domain` | `Predicate`, `defineAbacModule`, `createAbacBundle`, `createAbacAuthorizer`, errors |
| `kittle-core/domain/predicate` | `Predicate` factory + `findUnsupportedPredicateCombination` |
| `kittle-core/domain/filterFieldMeta` | `FilterFieldMeta` for `filterFieldMeta` on entities |
| `kittle-core/entity` | `defineEntity`, `validateEntity`, `ENTITY_DEFINITION_BRAND` |
| `kittle-core/entity/capabilityCheck` | `CapabilityCheckConfig` helpers |
| `kittle-core/execution` | `JobStore`, `ScheduleStore`, `dispatchDueJobs`, `materializeDueSchedules` |
| `kittle-core/execution/dispatcher` | `dispatchDueJobs` |
| `kittle-core/execution/executionContext` | `createExecutionContext` |
| `kittle-core/execution/jobRegistry` | `createJobRegistry` |
| `kittle-core/execution/retryPolicy` | `shouldRetry`/`computeNextAttemptAt` |
| `kittle-core/execution/jobFingerprint` | `fingerprintJob` |
| `kittle-core/execution/scheduleCalculator` | `parseCronExpression`/`getNextOccurrence`/`shouldFireSchedule` |
| `kittle-core/execution/scheduleDispatcher` | `materializeDueSchedules` |
| `kittle-core/execution/scheduleStore` | `ScheduleStore` types |
| `kittle-core/execution/types` | `NewJob`/`StoredJob`/`JobDefinition` etc. |
| `kittle-core/operation` | `createOperation`/`runOperation`/`runOperationDetailed` |
| `kittle-core/ports` | `PersistenceProvider`/`Repository`/`CacheAdapter` etc. |

`packages/core/package.json:32` is the source of truth.

---

## How to use — complete workflow

Build a tenant-scoped `tasks` entity with ABAC, an operation, and a durable job. Every snippet below compiles against the published types.

### 1. Define the ABAC catalog

The catalog is the contract between your code and your policy store. Do it once per `moduleKey`.

```ts
import { defineAbacModule } from "kittle-core/domain";

export const tasksCatalog = defineAbacModule({
  moduleKey: "tenant.tasks",
  actions: ["read", "create", "update", "delete"],
  capabilities: ["tasks:manage"],
  fields: {
    status:   { key: "status",   type: "string",     operators: ["eq", "neq", "in", "isNull"] },
    priority: { key: "priority", type: "number",     operators: ["eq", "gte", "lte", "between"] },
    dueAt:    { key: "dueAt",    type: "datetime",   operators: ["gte", "lte", "between"] },
    assignee: { key: "assignee", type: "identifier", operators: ["eq"] },
    title:    { key: "title",    type: "string",     operators: ["contains", "startsWith"] },
    // string-array example (non-portable — see predicate note below):
    // tags: { key: "tags", type: "string-array", operators: ["includesAny"] }
  },
});

 // defineAbacModule normalizes fields to a null-prototype object so
 // `__proto__` / `constructor` cannot be spoofed via catalog lookups.
```

**Rule:** `fields[].operators` must be a subset of the 20 policy operators in `abacPolicySchema.ts:1`. The compiler rejects unknown fields/types later via `findUnsupportedPredicateCombination`.

### 2. Define the entity

`defineEntity` is the single place you declare tenancy, concurrency, validation, search, and hooks. It is deeply frozen and branded — `CRUD()` will reject anything not created by it.

```ts
import { defineEntity } from "kittle-core/entity";
import { z } from "zod";

type TaskRow = {
  id: string;
  tenantId: string;
  title: string;
  status: "open" | "done";
  priority: number;
  dueAt: string | null;
  assignee: string | null;
  version: number; // numeric OCC field — mandatory when update/delete routes exist
};

const createBody = z.object({ title: z.string().min(1), priority: z.number().int() });
const updateBody = z.object({ title: z.string().min(1).optional(), status: z.enum(["open","done"]).optional() });

export const taskEntity = defineEntity<TaskRow>({
  moduleKey: "tenant.tasks",
  entity: {
    name: "task",
    fields: {
      id:       { type: "string" },
      tenantId: { type: "string" },
      title:    { type: "string" },
      status:   { type: "string" },
      priority: { type: "number" },
      dueAt:    { type: "string" },
      assignee: { type: "string" },
      version:  { type: "number" },
    },
    primaryKey: "id",
    tenantField: "tenantId",
    versionField: "version",
    immutableFields: ["tenantId"],
  },
  tenantScoping: { mode: "scoped" }, // or { mode:"none", acknowledged:true, scopeFilter?:PredicateNode }
  policy: { customCapabilityKey: "tasks:manage" }, // or { skipCapabilityCheck:true }
  validation: { createBody, updateBody, idParams: z.object({ id: z.string().uuid() }) },
  audit: { enabled: true, emitOn: ["create","update","delete"], includeValues: true, readAudit: false },
  cache: { enabled: true, tag: "task", keyPrefix: "task" },
  rateLimit: {
    list:   { max: 60,  timeWindow: "1 minute", consistency: "best-effort" },
    create: { max: 20,  timeWindow: "1 minute", consistency: "atomic" },
  },
  routes: { list: true, detail: true, create: true, update: true, delete: true },
  searchableColumns: ["title"],
  filterableColumns: ["status","priority","dueAt","assignee"],
  sortableColumns: ["dueAt","priority","title"],
  filterFieldMeta: {
    dueAt: { columnName: "due_at", kind: "date" },
  },
  queryLimits: { maxSearchBytes: 64_000, maxOffset: 10_000, maxCount: 100 },
  searchStrategy: { kind: "contains" },
  listDefaults: { sortColumn: "dueAt", sortDesc: false },
  optimisticConcurrency: { versionField: "version" }, // must match entity.versionField if both declared
  crud: {
    create: {
      beforeCommitTransform: async ({ input, context }) => {
        // read-only persistence, idempotent — never do arbitrary writes here
        return { ...input, title: input.title.trim() };
      },
      afterCommitRepresentation: async ({ result }) => result, // representation only
      afterCommit: async ({ operation, result }) => {
        // post-commit side-effect (outbox notify) — failure does NOT rollback business
        operation.addBestEffortEffect("notify", async () => {});
      },
    },
  },
});
```

Key contracts at `packages/core/src/entity/defineEntity.ts:71`:

* `update`/`delete` require a numeric `versionField` (OCC prevents TOCTOU between ABAC read scope and write)
* `tenantScoping.mode:"none"` must be explicitly acknowledged; otherwise `mode:"scoped"` requires `entity.tenantField`
* Hooks are **read-only** (`ReadOnlyPersistenceProvider`); `writableMutationHooks` was removed — use `afterCommit` with `addBestEffortEffect`/`addOutboxRecord`
* `filterableColumns`/`sortableColumns` are validated against `fields` at definition time

### 3. Issue and use an ABAC bundle

Policies live in your `AbacPolicyProvider`. The factory normalizes, validates catalog scope, compiles conditions to `PredicateNode`, sorts by `(priority desc, scopeOrder role>branch>department>user>tenant_default>platform_default, policyId)`, and binds a `securityDigest`.

```ts
import { createAbacBundle } from "kittle-core/domain";
import { createAbacAuthorizer } from "kittle-core/domain";
import type { AbacPolicyProvider } from "kittle-core/ports";
import { tasksCatalog } from "./catalog";
import { Predicate } from "kittle-core/domain/predicate";

const provider: AbacPolicyProvider = {
  async resolve({ mode, moduleKey, context, at }) {
    // fetch from DB — example: two policies
    return [
      {
        source: { policyId:"p1", scopeType:"role", scopeRefId: context.roleId!,  },
        moduleKey, effect:"allow", priority: 10,
        payload: {
          actions:["read","update"], capabilities:[],
          conditions:{
            version:2,
            systemScope:{ logic:"AND", conditions:[{ field:"status", operator:"equals", value:"open" }] },
            userFilters:{ logic:"AND", conditions:[] },
          },
          fieldAccess:{ read:{ title:"allow", assignee:"mask" }, write:["title","status"], query:{ filter:["status"], search:["title"], sort:["dueAt"] } }
        },
      },
    ];
  },
};

// Tenant request
const bundle = await createAbacBundle({
  provider,
  mode: "tenant",
  moduleKey: "tenant.tasks",
  context: { userId:"u1", roleId:"r1", tenantId:"t1", branchId:"b1" },
});
// bundle is VerifiedAbacPolicyBundle: { defaultEffect:"deny", securityDigest:string, fieldCatalog, policies:NormalizedAbacPolicy[] }
// Always deny-by-default; inactive windows (startsAt/endsAt) are excluded with inactivePolicyIds[]

const authorizer = createAbacAuthorizer(bundle);

// Record decision (per-row):
authorizer.canRecordAction(record, "update"); // boolean
authorizer.assertRecordAction(record, "update"); // throws ForbiddenError if denied

// Collection scope (push-down predicate for SQL):
const scope = authorizer.buildActionScope("read"); // PredicateNode
// { kind:"or", filters:[...allow predicates minus deny overlays...] } — combine with structural tenant scope:
// const accessFilter = Predicate.and(Predicate.eq("tenantId", tenantId), scope);

// Field projection
const plan = authorizer.fieldReadPlan("read");
import { projectResponseRecord } from "kittle-core/domain";
const projected = projectResponseRecord(row, plan); // omits/masks per policy
```

**Security note:** `scopeMatchesContext` at `packages/core/src/domain/abacBundleFactory.ts:48` enforces `mode:"tenant"` only allows `tenant_default|role|branch|department|user`; `role`/`branch`/`department`/`user` require `scopeRefId === context.*Id`. Any `POLICY_SCOPE_MISMATCH` or `POLICY_SCOPE_INVALID` fails the whole bundle with `InvalidPolicyConfigurationError`.

### 4. Write an operation

Operations are the only place business logic should live. They are reusable across HTTP, jobs, and tests.

```ts
import { createOperationContext, runOperation, runOperationDetailed } from "kittle-core/operation";
import type { PersistenceProvider } from "kittle-core/ports";

// Reusable definition — store it as a singleton
const createTaskOp = {
  key: "tenant.tasks.create",
  kind: "mutation" as const,
  atomicity: { kind: "standard" as const, mode: "required" as const, transactionRetry: { retrySafe:true, maxAttempts:3, delayMs:50, backoffMultiplier:2, maxDelayMs:500 } },
  authorization: { authorize: async ({ operation, input }) => ({ allowed: true }) },
  audit: {
    action: "task.created", resourceType: "task", required: true, auditGuarantee: "atomic" as const,
    resolveResourceId: ({ result }) => result.id,
  },
  outbox: { required: false },
  before: async ({ operation, input }) => ({ ...input, title: input.title.trim() }),
  execute: async ({ operation, input }: { operation: any; input: { title:string; tenantId:string } }) => {
    const repo = operation.persistence.repository({ name:"task", fields:{ id:{type:"string"}, tenantId:{type:"string"} } } as any);
    const row = await repo.insert({ id: crypto.randomUUID(), tenantId: input.tenantId, title: input.title, version: 1 });
    operation.addOutboxRecord({ type:"task.created", version:1, aggregateType:"task", aggregateId: row.id, payload:{ title: row.title }, idempotencyKey:`task:${row.id}` });
    return row;
  },
  after: async ({ result }) => result,
  afterCommit: async ({ operation }) => {
    operation.addBestEffortEffect("search-index", async () => {/* best-effort, never retried automatically */});
  },
} satisfies import("kittle-core/operation").OperationDefinition<any,any>;

// Per-request execution
const env = createOperationContext({
  persistence: myPersistenceProvider, // see kittle-adapters for Drizzle providers
  runtimeCapabilities: { cache:true, deferredExecution:true, objectStorage:false },
  request: { requestId: crypto.randomUUID(), correlationId: req.headers.get("x-correlation-id") ?? undefined, tenantId:"t1", actor:{ id:"u1", type:"user" } },
  auditSinkFactory: { create: (p) => myAuditSink },
  enforceAbac: async () => authorizer.assertRecordAction(record, "create"),
});

try {
  const row = await runOperation({ operation: env, definition: createTaskOp, input: { title:"Ship v1", tenantId:"t1" } });
} catch (e) {
  if (e instanceof OperationCommittedEffectError) {
    // Business committed, but afterCommit/bestEffort failed — e.failures / e.result available
  }
}

// Detailed outcome without throwing on committed+bestEffort failure:
const outcome = await runOperationDetailed({ operation: env, definition: createTaskOp, input:{ title:"Ship", tenantId:"t1" } });
// { result, operationId, correlationId?, committed:true, warnings:[], postCommitEffectFailures?:[] }
```

**Pipeline at `packages/core/src/operation/operationPipeline.ts:48`:**

* Validates definition first (`validateOperationDefinition` — `key` non-empty, `securitySensitive` requires `authorization`+`mode:"required"`, audit/outbox coherence)
* Creates a run-scoped `OperationRunContext` (fresh `operationId`/`correlationId`, read-only guard for `kind:"read"`)
* Routes to `runStandardOperation` (interactive `runInTransaction` if provider has `capabilities.interactiveTransactions`) or `runAtomicBatchOperation` (`executeAtomicBatch`)
* `before` may replace input deterministically; `after` may replace result; `afterCommit` is best-effort and cannot `addTransactionalEffect`/`addOutboxRecord`/`withPersistence`

**Atomic batch vs standard:**

```ts
// D1 path — no interactive transactions, but atomic-batch is available
const batchOp = {
  key:"tenant.tasks.batchCreate",
  kind:"mutation" as const,
  atomicity:{ kind:"atomic-batch" as const },
  authorization:{ authorize: async()=>({allowed:true}) },
  prepare: async ({ operation, input }) => {
    operation.addCommand({ kind:"insert", entity:"task", values:{ id:"id1", title:"A" }, filter: Predicate.eq("id","id1") });
    operation.addOutboxRecord({ type:"task.created", version:1, aggregateType:"task", aggregateId:"id1", payload:{}, idempotencyKey:"k1" });
    return { commands:[] as any[], result:{ ok:true }, verify: async({result, commandResults})=>{} };
  },
} satisfies import("kittle-core/operation").OperationDefinition<any,any,any>;
```

### 5. Durable execution — jobs and schedules

```ts
import { createJobRegistry, dispatchDueJobs, materializeDueSchedules } from "kittle-core/execution";
import type { JobStore, ScheduleStore, JobDefinition } from "kittle-core/execution";

const registry = createJobRegistry();
registry.register({
  type:"sendEmail", version:1, scope:"tenant", maxAttempts:5, retryDelayMs:1_000, retryBackoffMultiplier:2,
  decodePayload:(raw)=> raw as { to:string },
  execute: async ({ payload, tenantId, fencedEffect, logger }) => {
    await fencedEffect.execute({ effectName:"email", idempotencyKey:`email:${payload.to}`, fn: async () => {/* call provider */} });
    logger.info("sent", { to: payload.to });
    return { success:true };
  },
  onRetry: async (exec, err)=>{},
});

// Enqueue (requester scope gates stored scope)
import { assertJobScopeMatches } from "kittle-core/execution";
await jobStore.enqueue({
  requester:{ scope:"tenant", tenantId:"t1", actorId:"u1" },
  job:{ scope:"tenant", tenantId:"t1", jobType:"sendEmail", jobVersion:1, payload:{ to:"a@b" }, idempotencyKey:"email:a@b", partitionKey:"email:a@b", priority:1 }
});

// Worker loop (run every leaseDurationMs/3 heartbeat)
const result = await dispatchDueJobs({
  store: jobStore, registry, workerId:"worker-1", leaseDurationMs:30_000, claimLimit:20,
  requester:{ scope:"tenant", tenantId:"t1", actorId:"system" },
});
// { claimed, succeeded, failed, retried, deadLettered, leaseLost, stalled, errors[] }

// Schedules — cron + overlap/misfire
import { createIntlCronTimezoneAdapter } from "kittle-core/execution";
await materializeDueSchedules({
  scheduleStore, jobStore, workerId:"worker-1", limit:20, maxQueueAllOccurrences:50, now:new Date(),
  tzAdapter: createIntlCronTimezoneAdapter(),
});
// Each occurrence enqueued with idempotencyKey `schedule:${id}:${occurrenceISO}`, correlationId `sched:${id}`, partitionKey `schedule:${id}` when overlapPolicy queue
```

**Constraints at `packages/core/src/execution/types.ts:182`:** identifiers bounded in UTF-8 bytes, `payload`/`metadata` plain JSON only (no `Date`/`Map`/`bigint`, depth `<=50`, keys `<=10_000`, strings `<=64KiB`), `assertDurableJob` throws `TenantScopeViolationError` otherwise.

### 6. Predicates — persistence-neutral filtering

```ts
import { Predicate, findUnsupportedPredicateCombination } from "kittle-core/domain/predicate";
import { evaluatePredicate } from "kittle-core/domain";

const filter = Predicate.and(
  Predicate.eq("status","open"),
  Predicate.gte("priority", 2),
  Predicate.contains("title","urgent"),
  Predicate.between("dueAt", { from: new Date("2026-01-01"), to: new Date("2026-12-31") }),
);

// Validate against catalog before persisting policy / exposing to user
const issue = findUnsupportedPredicateCombination(filter, tasksCatalog.fields);
if (issue) throw new Error(issue.message);

// In-memory evaluation (three-valued — UNKNOWN collapses to false for tier fallthrough)
evaluatePredicate({ status:"open", priority:3, title:"urgent fix" }, filter); // true/false

// For DB push-down: hand filter to a PredicateCompiler (kittle-adapters provides Drizzle compilers)
// Non-portable ops (includesAny/includesAll/isEmpty/isNotEmpty) -> findNonPortablePredicate rejects them for SQL
```

### 7. Ports — what you must implement vs what adapters provide

| Port | You or adapters | Notes |
|---|---|---|
| `PersistenceProvider` + `Repository` | adapters: `createDrizzlePersistenceProvider` (PG interactive, D1 atomic-batch) | Register every entity via `DrizzleEntityRegistry`; add `tenantField` equality for `createTenantScopedPersistenceProvider` |
| `PredicateCompiler<SQL>` | adapters: `DrizzlePredicateCompiler` | Wraps leaves with `COALESCE(expr,FALSE)` so `NOT UNKNOWN` stays 2-valued |
| `CacheAdapter` | adapters: `InMemory`/`Kv`/`SharedGeneration` | `capabilities.coherenceScope`/`tagGenerationConsistency` drives `CacheService` correctness |
| `RateLimitStore`/`AtomicRateLimitStore` | adapters: `CacheBackedRateLimitStore` | `consistency:"atomic"` delegates to `incrementRateLimitAtomically` |
| `IdempotencyPort` | adapters: `DrizzlePgIdempotencyStore`/`DrizzleD1IdempotencyStore` | Fingerprint `v2:hex(SHA-256(canonicalJson))`, lease fencing |
| `AuditSink`/`OutboxSink` factories | adapters | Factories receive the bound `persistence` so audit/outbox participates in the same commit |
| `AbacPolicyProvider` | **you** | `resolve({mode, moduleKey, context, at?}) => AbacPolicy[]` from your DB |

Minimal custom persistence example:

```ts
import type { PersistenceProvider, Repository, EntityDescriptor } from "kittle-core/ports";
import { createTenantScopedPersistenceProvider } from "kittle-core/ports";
import { Predicate } from "kittle-core/domain/predicate";

const base: PersistenceProvider = { /* ... implement repository(entity) + capabilities */ } as any;
const tenantScoped = createTenantScopedPersistenceProvider(base, "t1", Predicate.eq("tenantId","t1"));
```

### 8. Error handling

```ts
import {
  ForbiddenError, NotFoundError, ConflictError, ValidationError,
  OptimisticConcurrencyError, RateLimitError, RetryablePersistenceError,
  InvalidPolicyConfigurationError, FrameworkCoreError,
} from "kittle-core/domain";

try {
  await runOperation({ operation: env, definition: updateOp, input:{ id, patch, expectedVersion: 3 } });
} catch (e) {
  if (e instanceof OptimisticConcurrencyError) {
    // version mismatch — reread + retry with fresh expectedVersion
  } else if (e instanceof ForbiddenError) {
    // ABAC deny — e.code === "FORBIDDEN"
  } else if (e instanceof RateLimitError) {
    // e.retryAfterMs
  } else if (e instanceof FrameworkCoreError) {
    // e.code in FrameworkCoreErrorCode (20 codes: CAPABILITY_REQUIRED, AUDIT_SINK_MISSING, ...)
  }
}
```

`auditGuarantee: "atomic"|"durable"|"best-effort"` controls whether missing `auditSink` aborts. `required:true` forbids `best-effort`.

## Entrypoints recap

See table at top. `packages/core/src/index.ts:1` re-exports domain/entity/execution/operation/ports; `utils/definitionIntegrity` is internal (frozen cloning).

## Development

```sh
npm run typecheck:core        # tsc -p packages/core/tsconfig.json --noEmit
npm run lint:core             # eslint src --max-warnings=0
npm test --workspace kittle-core   # vitest run — 410+ tests across domain/entity/operation/execution/ports
npm run build --workspace kittle-core  # tsc -b tsconfig.build.json && rewriteBuildExtensions
```

CI verifies `verify:hardening` + `verify:coverage-inventory` + `verify:release`.

## License

MIT
