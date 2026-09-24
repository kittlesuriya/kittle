# Changelog

All notable changes to the specification and its reference packages are
documented here.

The project follows [Semantic Versioning](https://semver.org/): patch releases
fix behavior without changing the public contract, minor releases add
backwards-compatible functionality, and major releases may contain breaking
changes.

Package versions are currently maintained independently:

- `kittle-core` — `0.3.1`
- `kittle-adapters` — `0.4.2`
- `testing` — private workspace package, `0.1.0`

## [Unreleased]

Future changes will be documented here.

## Runtime adapters package `0.4.1` — 2026-09-24

### Added

- Added stable numeric error identifiers alongside string error codes.
- Added opt-in CRUD exposure for business-rule messages and separately
  controlled business-rule details.
- Added specification-first documentation, implementation guidance, and
  conformance documentation.

### Package quality

- Added package metadata, release guidance, security policy, contribution
  guidance, support documentation, and GitHub issue/PR templates.

## Core reference package `0.3.1` — 2026-09-24

### HTTP and errors

- Added stable numeric identifiers alongside existing framework error codes.
- Added a complete portable specification and conformance model for core
  domain, policy, operations, persistence, idempotency, and execution behavior.

### Documentation

- Reworked core, ports, domain, repository, and package documentation around
  the language-neutral specification.

## Runtime adapters package `0.4.0`

### Added

- Fetch-compatible HTTP CRUD and custom write handlers.
- PostgreSQL, Cloudflare D1, and MySQL Drizzle adapters.
- Cache, shared-generation invalidation, and rate-limit adapters.
- Transactional and atomic-batch idempotency stores.
- Audit, outbox, job, and schedule stores.
- Fastify route integration and trusted client metadata helpers.

### Security and correctness

- Structural tenant scoping and verified ABAC enforcement at adapter boundaries.
- Optimistic concurrency protection for update and delete operations.
- Bounded request bodies, query input, pagination, filtering, sorting, and
  durable payloads.
- Fenced leases, claim tokens, replay protection, and crash-recovery paths.

## Runtime adapters package `0.4.2` — 2026-09-24

### Added

- Added the optional `kittle-adapters/nestjs` controller and dynamic-module
  integration for Nest Express and Fastify applications.
- Reused the Fetch HTTP boundary so security, validation, tenancy, idempotency,
  and error serialization remain centralized.

## Core reference package `0.3.0`

### Added

- Framework-independent entity, operation, domain, and execution primitives.
- Deny-by-default ABAC catalogs, normalized policy bundles, field access plans,
  and security digests.
- Persistence, repository, audit, outbox, cache, idempotency, job, and schedule
  ports.
- Predicate construction and in-memory evaluation.
- Transactional and atomic-batch operation pipelines.
- Durable jobs, schedules, retry policies, lease fencing, and partition
  serialization.
- Structured framework errors with string and numeric identifiers.

## Release checklist

Before publishing a package:

1. Update the relevant package version.
2. Move user-visible entries from `Unreleased` into a versioned section.
3. Run `npm run verify:release` and the package build.
4. Verify packed contents with `npm pack --dry-run`.
5. Publish packages in dependency order: core before adapters.

[Unreleased]: https://github.com/kittlesuriya/kittle/compare/main...HEAD
