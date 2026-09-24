# Application Security and Execution Specification

This is a portable specification for building secure, tenant-aware applications,
along with a TypeScript reference implementation and production adapters for
HTTP, persistence, caching, idempotency, auditing, outbox delivery, and durable
jobs.

The specification is designed around a few non-negotiable properties:

- **Deny by default** authorization with ABAC policy bundles.
- **Structural tenant isolation** instead of convention-only filtering.
- **Optimistic concurrency** for mutation safety.
- **Atomic business mutations** with audit, outbox, and idempotency records.
- **Durable execution** with fenced leases and retry-aware workers.
- **Portable boundaries** based on Fetch `Request`/`Response` and core ports.

## Packages

| Package                                  | Use it for                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`kittle-core`](./packages/core)         | Domain models, entities, ABAC, operations, execution contracts, predicates, errors, and ports.                                       |
| [`kittle-adapters`](./packages/adapters) | HTTP CRUD, Drizzle persistence for PostgreSQL/D1/MySQL, cache adapters, server wiring, audit/outbox, and idempotency.                |
| [`testing`](./packages/testing)          | Reusable contract suites for persistence providers, repositories, predicates, ABAC, cache adapters, atomic batches, and concurrency. |

For an application, install `kittle-core` and `kittle-adapters`. The `testing`
package is a private workspace package used to verify implementations and is
not part of the public runtime installation path.

## Installation

```sh
npm install kittle-core kittle-adapters
```

The reference packages are ESM-only and require Node.js 20 or newer. Applications should use
TypeScript's `moduleResolution: "bundler"` or a compatible ESM configuration.

Install only the database driver needed by the selected adapter:

```sh
# PostgreSQL
npm install pg

# Cloudflare D1
# drizzle-orm is used with the D1 binding in the Worker runtime
```

## Architecture

```text
application
    │
    ├── kittle-adapters/http       Fetch handlers and HTTP serialization
    ├── kittle-adapters/server     Session, ABAC, and repository composition
    ├── kittle-adapters/drizzle-*  Database implementations
    └── kittle-adapters/cache      Cache and rate-limit implementations
    │
    └── kittle-core                Domain rules, operations, ports, execution
```

`kittle-core` does not import HTTP frameworks, databases, Cloudflare APIs, or
application code. Adapters implement core ports at the composition root.

## Typical request path

1. The application resolves a session and trusted request metadata.
2. The adapter checks scope, CSRF, module enablement, capabilities, and ABAC.
3. Tenant scope and policy scope are combined before persistence access.
4. Input is validated and normalized.
5. The operation runs through the configured transactional or atomic-batch path.
6. Audit, outbox, cache invalidation, and idempotency obligations are committed
   with the business mutation where their guarantee requires it.
7. The adapter projects the response and serializes a safe HTTP result.

## Minimal domain example

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

See [`kittle-core/README.md`](./packages/core/README.md) for the complete
domain workflow and [`kittle-adapters/README.md`](./packages/adapters/README.md)
for database and HTTP composition.

The portable contract is documented in [`SPECIFICATION.md`](./SPECIFICATION.md).
Use [`CONFORMANCE.md`](./CONFORMANCE.md) to review an implementation and
[`IMPLEMENTATIONS.md`](./IMPLEMENTATIONS.md) to port the model to another
language or runtime.

## Project documentation

- [`CHANGELOG.md`](./CHANGELOG.md) — release history and publishing checklist.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — development workflow and pull
  request expectations.
- [`SECURITY.md`](./SECURITY.md) — vulnerability reporting and security
  responsibilities.
- [`SUPPORT.md`](./SUPPORT.md) — troubleshooting and issue-reporting guidance.
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — community standards.

## Security model

The specification treats security as a composition of independent controls:

- **Authentication** is supplied by the host application through
  `FrameworkAdapterDeps.resolveSession`.
- **Capability checks** determine whether a caller may enter a module/action.
- **ABAC** determines record scope, field access, and query access.
- **Tenant scoping** adds a structural tenant predicate and protected insert
  values.
- **OCC** prevents stale writes after authorization and read-scope evaluation.
- **Input limits** bound body size, query size, nesting, identifiers, and
  durable payloads.

Applications remain responsible for identity providers, session storage, secret
management, database migrations, and deployment configuration.

## Error responses

Framework errors have stable string and numeric identifiers. HTTP responses use
the following shape:

```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "numericCode": 1001
}
```

Business-rule messages are sanitized by default. HTTP applications may opt in
to exposing a `BusinessRuleError` message through `CrudRuntime.errorExposure`;
see the adapters documentation for the security implications.

## Development

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Useful focused commands:

```sh
npm run test:core
npm run test:adapters
npm run test:testing
npm run verify:hardening
npm run verify:release
```

## Repository layout

```text
packages/core/       Public framework-independent package
packages/adapters/   Public runtime and persistence adapters
packages/testing/    Workspace-only contract test helpers
scripts/             Release and repository verification scripts
```

## License

MIT
