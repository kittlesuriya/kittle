# testing

`testing` is the workspace-only contract-test package for the reference
implementation. It contains reusable
Vitest suites that adapter authors can run against their own implementations.
It is not a runtime framework and is currently private (`"private": true`).

## Purpose

The package prevents each persistence or cache implementation from inventing a
slightly different interpretation of the core contracts. A contract suite
receives an implementation factory and registers tests with Vitest.

Use these suites when adding a new database dialect, cache backend, atomic-batch
implementation, or concurrency implementation.

## Available suites

The package root exports:

| Export                                | Verifies                                                          |
| ------------------------------------- | ----------------------------------------------------------------- |
| `runRepositoryContractTests`          | Repository CRUD, filtering, pagination, tenant behavior, and OCC. |
| `runPersistenceProviderContractTests` | Provider capabilities and persistence-level guarantees.           |
| `runAtomicBatchContractTests`         | Atomic command execution and failure behavior.                    |
| `runCacheAdapterContractTests`        | Cache values, tags, invalidation, and consistency behavior.       |
| `runPredicateContractTests`           | Predicate construction and in-memory semantics.                   |
| `runAbacInvariantTests`               | ABAC normalization, deny-by-default, scope, and field invariants. |
| `runJobStoreConcurrencyContractTests` | Job lease fencing and concurrent claims.                          |
| `runScheduleConcurrencyContractTests` | Schedule lease ownership and occurrence serialization.            |
| `runOutboxConcurrencyContractTests`   | Outbox claim and delivery concurrency.                            |
| `runReleaseInvariantTests`            | Release and durability invariants.                                |

Additional subpath exports provide contract option types:

```ts
import {
  runRepositoryContractTests,
  runCacheAdapterContractTests,
} from "testing"

runRepositoryContractTests("my adapter", () => createProvider())
runCacheAdapterContractTests("my cache", {
  createAdapter: () => createCache(),
})
```

Check the exported TypeScript signatures for the exact options required by the
selected suite. Contract tests are deliberately typed against core ports rather
than a specific Drizzle implementation.

## Running tests

```sh
npm test --workspace testing
npm run test:property
npm run test:race
npm run test:crash
npm run build --workspace testing
```

The package depends on `kittle-core` and `kittle-adapters` for its contract
types and fixtures. Vitest is a peer dependency for consumers that embed the
suites in another package.

## Adding a contract

1. Define the smallest public behavior the port promises.
2. Test success, malformed input, boundary limits, and failure atomicity.
3. Include concurrent or retry behavior when the contract involves leases.
4. Keep tests independent of a specific database driver.
5. Export the suite and its options from `src/index.ts`.
6. Add a concrete adapter invocation under `tests/`.

Contract suites should fail loudly when an adapter returns a plausible but
incorrect result. They should not weaken assertions merely to accommodate a
provider-specific implementation detail.

## License

MIT
