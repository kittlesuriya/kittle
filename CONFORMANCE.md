# Conformance checklist

Use this checklist when reviewing a new implementation in another language,
database, or runtime. A checked item should have an automated test or an
explicit design record.

## Architecture

- [ ] Domain logic is independent of transport and storage implementations.
- [ ] Infrastructure is accessed through explicit ports.
- [ ] Capability claims accurately describe provider behavior.
- [ ] Unsupported provider behavior fails explicitly rather than degrading
      silently.

## Tenancy

- [ ] Tenant-scoped entities declare a tenant field.
- [ ] Every tenant read includes the structural tenant predicate.
- [ ] Every tenant update/delete includes the structural tenant predicate.
- [ ] Inserts bind tenant identity from trusted execution context.
- [ ] Cross-tenant identifiers cannot be used to read or mutate data.
- [ ] Global/platform entities require explicit configuration.

## Authorization

- [ ] Missing authorization defaults to deny.
- [ ] Capabilities are checked before module actions execute.
- [ ] Policy scope references are checked against the active context.
- [ ] Invalid policies fail bundle creation.
- [ ] Record, field, and query access are enforced independently.
- [ ] Response projection removes or masks denied fields.
- [ ] ABAC integrity/digest verification occurs at the enforcement boundary.

## Predicates and input

- [ ] Predicate trees have bounded depth and size.
- [ ] Unknown fields and operators are rejected.
- [ ] In-memory and database evaluation agree on null semantics.
- [ ] User filters cannot bypass structural or policy scope.
- [ ] Request bodies, identifiers, query values, and durable payloads are bounded.
- [ ] Canonical serialization is deterministic across processes.

## Mutations and consistency

- [ ] Mutable resources use optimistic concurrency.
- [ ] Version checks and increments are atomic.
- [ ] Operation phases and transaction boundaries are documented.
- [ ] Post-commit failures cannot be reported as business rollback.
- [ ] Audit/outbox guarantees are explicit.
- [ ] Sensitive audit fields are classified and sanitized.

## Idempotency

- [ ] Keys are scoped to the operation and security context.
- [ ] Fingerprints are deterministic and include preconditions.
- [ ] Fingerprint conflicts are rejected.
- [ ] Completed requests can replay safely.
- [ ] Crashed requests can recover without duplicate business effects.
- [ ] Reservation and business commit share the required atomic boundary.

## Durable execution

- [ ] Claims use opaque ownership tokens.
- [ ] Lease renewal proves current ownership.
- [ ] Lost workers cannot complete or retry claimed work.
- [ ] Retry attempts and terminal states are durable.
- [ ] Partition keys prevent forbidden concurrent execution.
- [ ] Schedule overlap and misfire behavior is tested.

## Errors and observability

- [ ] Public errors have stable string and numeric identifiers.
- [ ] Transport status and application error identifiers are separate.
- [ ] Internal messages/details are sanitized by default.
- [ ] Correlation and request IDs are propagated safely.
- [ ] Logs do not contain credentials or unredacted tenant data.
- [ ] Business-message exposure is an explicit configuration choice.
