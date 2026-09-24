# Application Security and Execution Specification

This document defines a portable model for building secure, tenant-aware
applications. It is independent of programming language, database, HTTP
framework, queue, and cloud provider.

The TypeScript packages in this repository are a reference implementation. A
different language implementation may use different names and APIs while
preserving the requirements in this document.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are to be interpreted as normative requirements.

## 1. Design goals

An implementation SHOULD provide:

1. deny-by-default authorization;
2. structural tenant isolation;
3. explicit field and query access;
4. optimistic concurrency for stale-write prevention;
5. atomic business mutations and durable obligations;
6. idempotent request and job execution;
7. fenced leases for crash recovery;
8. deterministic serialization and fingerprints;
9. portable contracts between domain logic and infrastructure.

The specification does not prescribe an identity provider, policy database,
schema migration tool, web framework, or message broker.

## 2. Architecture

Implementations SHOULD separate the following layers:

```text
application composition
        │
adapters and infrastructure
        │
ports and contracts
        │
domain, policy, operations, and execution rules
```

Domain rules MUST NOT depend directly on a database, HTTP framework, queue
client, or provider-specific runtime. Infrastructure MUST implement explicit
ports rather than being reached through global state.

## 3. Tenancy

An entity that belongs to a tenant MUST declare a tenant field. A tenant-scoped
operation MUST add a structural equality predicate for the active tenant to
every read and mutation.

Implementations:

- MUST NOT accept an untrusted request field as the authoritative tenant;
- MUST bind tenant values from the authenticated session or trusted execution
  context;
- MUST add tenant values to inserts structurally;
- MUST include tenant predicates in updates and deletes;
- MUST reject cross-tenant references before persistence execution;
- SHOULD support explicitly acknowledged global/platform entities rather than
  silently treating missing tenant metadata as global access.

## 4. Authorization and ABAC

Authorization is deny-by-default. An implementation MUST distinguish:

- authentication: who is calling;
- capability: whether the caller may enter a module/action;
- record authorization: which records may be accessed;
- field authorization: which fields may be read or written;
- query authorization: which fields may be filtered, searched, or sorted.

### 4.1 Catalogs

A module catalog MUST define its module key, actions, capabilities, fields, field
types, and supported operators. Policy data MUST be validated against that
catalog before execution.

### 4.2 Policy bundles

A policy bundle SHOULD contain:

- a default effect, which SHOULD be deny;
- normalized policies;
- module and scope identity;
- field access rules;
- a security digest or equivalent integrity binding.

Policy scope references MUST be checked against the current authorization
context. Invalid scope, unknown fields, unsupported operators, malformed
values, and digest failures MUST fail closed.

### 4.3 Query and field access

A collection read MUST combine the structural tenant scope, policy read scope,
and caller filter. A response MUST be projected through the field read plan
before it is returned. Query fields MUST be checked before database execution;
filtering a forbidden field and then hiding it is not sufficient.

## 5. Predicates

Predicates are portable data trees. A predicate implementation MUST define:

- condition fields and operators;
- group logic (`AND`/`OR`);
- negation behavior;
- null and unknown semantics;
- value coercion and validation;
- limits for nesting, conditions, strings, and serialized size.

The in-memory evaluator and database compiler MUST agree on observable boolean
behavior. Nullable database expressions SHOULD be normalized to explicit
boolean results so `NOT UNKNOWN` cannot become an accidental allow.

## 6. Entity and mutation model

An entity definition SHOULD include:

- stable module and entity names;
- field descriptors and nullability;
- primary key;
- tenant field where applicable;
- version field for mutable resources;
- immutable fields;
- validation schemas;
- route and query capabilities;
- audit, cache, and rate-limit policy.

Update and delete operations MUST use optimistic concurrency when the resource
is mutable. A versioned mutation MUST match the expected version and MUST
advance the stored version atomically. A version mismatch MUST be reported as a
conflict rather than silently overwriting data.

## 7. Operation lifecycle

The reference lifecycle is:

```text
validate → authorize → before → execute → after → commit → afterCommit
```

Implementations MUST define which phases are transactional. `before`,
`execute`, and `after` MUST NOT report a successful response before the business
commit. `afterCommit` MUST be treated as post-commit work; its failure MUST NOT
pretend that a committed business mutation was rolled back.

An operation definition SHOULD be reusable across HTTP, jobs, and tests.

## 8. Idempotency

An idempotent mutation MUST bind a request key to a deterministic fingerprint.
The fingerprint SHOULD include the operation identity, authenticated security
context, client mutation, preconditions, and policy/security version.

For a given scope and key:

- a matching in-progress request MUST be leased or safely observed;
- a matching completed request SHOULD replay its committed response;
- a different fingerprint MUST be rejected as a conflict;
- a crashed request MUST be recoverable without duplicating the mutation;
- the reservation and business commit SHOULD be atomic.

## 9. Audit and outbox

Audit and outbox records MUST declare their consistency guarantee. Supported
guarantees commonly include:

- best effort;
- atomic with the business mutation;
- durable delivery through an outbox.

An audit record MUST NOT be used as a substitute for authorization. Sensitive
fields SHOULD be classified explicitly as omitted, masked, or included through
a sanitizer. Heuristic redaction alone is not a security boundary.

## 10. Durable execution

Job and schedule stores MUST use opaque claim tokens or equivalent fencing.
Lease renewal MUST prove ownership. A worker MUST NOT complete, retry, or
mutate a job after losing its claim.

Durable jobs SHOULD define:

- scope and tenant identity;
- payload version and validation;
- idempotency key and fingerprint;
- maximum attempts and retry policy;
- run/lease timestamps;
- correlation identity;
- partition key for serialization;
- terminal result or failure state.

Schedules MUST define timezone, overlap, misfire, and occurrence identity
semantics. Occurrence decisions MUST be based on durable execution history when
that history is required by the configured policy.

## 11. Canonical data and limits

Data used for fingerprints, durable payloads, policy storage, or cache keys MUST
have deterministic serialization. Implementations MUST bound depth, key count,
string size, identifier size, body size, and collection size before expensive
work or persistence.

Canonical JSON SHOULD reject ambiguous values such as functions, symbols,
non-finite numbers, unsupported class instances, and unbounded recursive data.

## 12. Errors

Public framework errors SHOULD provide:

- a stable semantic string code;
- a stable numeric identifier;
- a safe category or retry classification;
- optional structured internal details.

Transport status codes and application error identifiers MUST remain separate.
Internal messages and details MUST NOT be serialized by default. Business-rule
message exposure MAY be enabled explicitly by an HTTP policy after reviewing
the content.

## 13. Conformance

An implementation conforms to this specification when it documents its choices
for every section, passes the applicable conformance suites, and demonstrates
that security failures fail closed. See [`CONFORMANCE.md`](./CONFORMANCE.md)
for the review checklist and [`IMPLEMENTATIONS.md`](./IMPLEMENTATIONS.md) for
porting guidance.

## 14. Versioning

Specification changes MUST be classified as:

- editorial: no observable contract change;
- clarification: resolves ambiguity without changing intended behavior;
- compatible: adds optional behavior or new identifiers;
- breaking: changes required behavior, data shape, or security meaning.

Implementations SHOULD publish the specification revision they conform to and
MUST version serialized policy, durable payload, and error contracts when a
breaking change is unavoidable.
