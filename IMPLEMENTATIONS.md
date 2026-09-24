# Implementation guide

This repository contains the TypeScript reference implementation of the
Application Security and Execution Specification. Other implementations may be
written in Go, Rust, Java, Python, or another language.

## Required layers

An implementation SHOULD provide equivalent modules for:

```text
domain       policy, predicates, errors, field access
entity       definitions, validation, tenancy, concurrency
operation    lifecycle, authorization, transaction boundaries
ports        persistence, cache, audit, outbox, idempotency, execution
adapters     HTTP, database, cache, and runtime integrations
testing      reusable conformance and failure-injection suites
```

Names, generics, async models, and database libraries may differ. Security
meaning and observable outcomes must not differ without a new specification
revision.

## Interoperability priorities

Implementations that exchange data should standardize these artifacts first:

1. policy bundle JSON and catalog schema;
2. predicate tree JSON and operator names;
3. canonical JSON and fingerprint construction;
4. error-code registry and response shape;
5. durable job and schedule payload envelopes;
6. conformance test vectors.

The transport encoding may be HTTP, RPC, messaging, or an internal call. The
domain contract remains independent of that choice.

## Porting process

1. Read [`SPECIFICATION.md`](./SPECIFICATION.md) and record the revision.
2. Implement the domain model without database dependencies.
3. Implement ports with explicit capability declarations.
4. Add tenant, ABAC, predicate, concurrency, and idempotency tests before HTTP.
5. Add the runtime adapters and failure-injection tests.
6. Run the checklist in [`CONFORMANCE.md`](./CONFORMANCE.md).
7. Publish the implementation's supported revision and known deviations.

## Compatibility rules

An implementation MUST NOT silently reinterpret:

- deny as allow;
- an absent tenant as a global tenant;
- an unknown policy field as an unrestricted field;
- a lost lease as current ownership;
- a fingerprint mismatch as a replay;
- a committed mutation as rolled back;
- an internal error message as safe client text.

Provider limitations should be represented as capabilities or explicit errors.
For example, a database without interactive transactions should use the
specified atomic-batch model or reject an operation requiring an interactive
transaction; it should not claim equivalent guarantees without implementing
them.

## Reference package mapping

| Specification area                    | TypeScript reference package |
| ------------------------------------- | ---------------------------- |
| Domain, entity, operations, and ports | `kittle-core`                |
| HTTP and request boundaries           | `kittle-adapters/http`       |
| Database providers and stores         | `kittle-adapters/drizzle-*`  |
| Cache and rate limits                 | `kittle-adapters/cache`      |
| Server authorization composition      | `kittle-adapters/server`     |
| Contract suites                       | workspace package `testing`  |

These package names are implementation details of this repository. A port in
another language should document its own package layout while preserving the
same normative behavior.
