# Support

## Documentation first

- Start with the [repository README](./README.md).
- Use [`kittle-core/README.md`](./packages/core/README.md) for domain and port
  contracts.
- Use [`kittle-adapters/README.md`](./packages/adapters/README.md) for HTTP,
  database, cache, and deployment integration.
- Use [`packages/testing/README.md`](./packages/testing/README.md) for adapter
  contract suites.
- Check [`CHANGELOG.md`](./CHANGELOG.md) for behavior and compatibility notes.

## Asking for help

When opening a GitHub issue, include:

- package and exact version;
- Node.js and runtime details;
- database dialect and adapter version;
- a minimal reproducible example;
- expected and actual behavior;
- relevant error code and sanitized logs;
- commands used to reproduce the problem.

Do not include credentials, production data, access tokens, or unredacted
tenant information.

## Bug reports and feature requests

Use GitHub Issues for reproducible bugs and scoped feature proposals. Security
issues must follow [`SECURITY.md`](./SECURITY.md), not public issue tracking.

## Questions

Questions are welcome when they include enough context for someone else to
reproduce the situation. Search existing issues before opening a duplicate.
