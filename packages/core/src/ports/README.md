# Core ports

Ports are the dependency-inversion boundary of the specification. They describe what the
core needs from persistence, caching, auditing, outbox delivery, idempotency,
and durable execution without selecting a vendor or runtime.

## Design rules

- Ports may use core domain types and TypeScript platform types.
- Ports must not import Drizzle, PostgreSQL, Cloudflare, HTTP frameworks, or
  application modules.
- Implementations belong in `kittle-adapters` or in the host application.
- Security-sensitive invariants must be checked by the implementation and by
  the core caller; a port is not permission to skip authorization.

## Main contracts

| Contract              | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `PersistenceProvider` | Transactions, atomic batches, capabilities, and repositories.     |
| `Repository`          | Typed reads, inserts, updates, deletes, filters, and OCC.         |
| `AuditSink`           | Writes audit records according to the requested guarantee.        |
| `OutboxSink`          | Persists records that must be delivered outside the transaction.  |
| `IdempotencyPort`     | Reserves request keys and stores replayable commit receipts.      |
| `JobStore`            | Enqueues, claims, renews, retries, completes, and cancels jobs.   |
| `ScheduleStore`       | Claims schedules and records occurrence execution history.        |
| `CacheAdapter`        | Values, tags, tag generations, and atomic rate-limit increments.  |
| `RateLimitStore`      | Best-effort or atomic request-window counters.                    |
| `AbacPolicyProvider`  | Resolves policies for a module, scope, and authorization context. |

## Persistence obligations

Implementations should provide the capability flags that accurately describe
their behavior. Core uses those flags to choose interactive transactions,
atomic batches, returning mutations, and idempotency strategies.

Repository implementations must preserve:

- tenant and structural filters;
- predicate null semantics;
- stable pagination ordering;
- version checks and version increments;
- conflict and retry classification;
- empty/all-true predicate safety guards.

The reusable contract suites in the workspace `testing` package are the
recommended conformance baseline for new implementations.

## Audit classification

Audit fields have explicit classification:

- `omit`: remove the field;
- `mask`: replace the value;
- `include`: keep the value but pass it through the configured sanitizer.

Heuristic redaction is best-effort. Applications should classify sensitive
fields explicitly and should never rely on redaction to protect arbitrary
secrets.

## Composition guidance

Create providers and sinks at the application composition root. Bind the
current tenant, session, and transaction there, then pass the resulting ports
to `createOperationContext` or the HTTP adapter. Do not let a repository infer
tenant identity from mutable request input.
