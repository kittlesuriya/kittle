# Core domain

The domain layer owns decisions that must behave the same in HTTP handlers,
background jobs, command-line tools, and tests. It is independent of databases,
queues, web frameworks, and cloud runtimes.

## Responsibilities

- Define and normalize ABAC catalogs and policies.
- Compile and evaluate persistence-neutral predicates.
- Build verified policy bundles and authorization decisions.
- Resolve field read/write/query access.
- Normalize policy values and validate policy shapes.
- Provide structured framework errors.

## Authorization boundary

Policy data is untrusted input. `createAbacBundle` validates policy structure,
catalog scope, action names, field references, policy windows, and scope
references before creating a bundle. `createAbacAuthorizer` consumes the
verified bundle for record actions, collection scopes, and field plans.

Authorization is deny-by-default. A missing policy, inactive policy, invalid
scope, failed digest check, or unsupported predicate must not silently become
an allow decision.

## Dependency rules

Domain code may depend on other core domain modules and core port types. It must
not import:

- Drizzle or a database driver;
- HTTP `Request`/`Response` handling;
- Cloudflare or framework-specific APIs;
- application services or feature modules.

If a decision needs I/O, expose the capability through a port and keep the
decision itself deterministic and directly testable.

## Errors

Use the structured errors exported from the reference domain package rather than
throwing ad-hoc errors for framework-visible conditions. `FrameworkCoreError`
provides a stable string `code`, numeric `numericCode`, and optional internal
`details`. The adapter decides what is safe to serialize.

## Testing expectations

Domain changes should include focused tests for:

- deny-by-default behavior;
- tenant and policy scope boundaries;
- malformed and unsupported policy input;
- null/unknown predicate behavior;
- field masking and write restrictions;
- error classification and metadata.
