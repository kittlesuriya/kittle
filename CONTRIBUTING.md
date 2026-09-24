# Contributing

Thank you for helping improve the specification and its reference packages.
Contributions should preserve the
project's security model, public package boundaries, and adapter portability.

## Before you start

1. Read the relevant package README.
2. Search existing issues and pull requests.
3. For security vulnerabilities, follow [`SECURITY.md`](./SECURITY.md) instead
   of opening a public issue.
4. For a large API or architecture change, open an issue first to agree on the
   design and compatibility impact.

## Repository setup

Requirements are Node.js 20 or newer and npm with workspace support.

```sh
npm install
npm run typecheck
npm run lint
npm test
```

The repository is an npm workspace:

```text
packages/core       framework-independent contracts and domain logic
packages/adapters   runtime, HTTP, database, and cache implementations
packages/testing    reusable contract suites
scripts/            verification and release tooling
```

## Making changes

### Core changes

Keep core independent of HTTP frameworks, database drivers, Cloudflare APIs,
and application modules. If a feature needs I/O, add or use a port. Add tests
for security boundaries, malformed input, concurrency, and error classification.

### Adapter changes

Adapters must honor the contracts defined by core. Add dialect-specific tests
where behavior differs, especially for transactions, atomic batches, SQL null
semantics, constraint mapping, leases, and idempotency.

### Public API changes

Treat package exports, error codes, response shapes, and TypeScript types as
public contracts. Do not remove or rename an export without documenting the
breaking change. Add a changelog entry for user-visible behavior.

### Security-sensitive changes

Explain the threat model in the pull request. Include tests demonstrating that
the new behavior cannot bypass tenant scope, ABAC, field access, CSRF, OCC,
idempotency, or lease fencing.

## Tests and checks

Run focused checks while developing, then run the full suite:

```sh
npm run typecheck:core
npm run typecheck:adapters
npm run typecheck:testing
npm run lint
npm test
npm run verify:hardening
npm run verify:release
```

Report environment-specific or legacy failures separately from failures caused
by your change. Do not silence a failing runtime test to make a type check pass.

## Pull requests

A good pull request includes a problem statement, design, affected packages and
public APIs, verification commands, migration/deployment notes, and changelog
or documentation updates when users are affected.

Keep commits focused. Avoid formatting unrelated files or changing generated
artifacts by hand. Review the final diff for accidental secrets, generated
files, and unrelated changes before requesting review.

## Documentation style

- Use clear, direct language.
- Prefer runnable TypeScript examples.
- Document security defaults before opt-in behavior.
- Distinguish core contracts from adapter implementations.
- Never document internal source paths as public import paths.

## License

By contributing, you agree that your contribution is provided under the
repository's [MIT License](./LICENSE).
