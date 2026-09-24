# Security policy

The specification is intended for security-sensitive, tenant-aware applications. Please
report vulnerabilities responsibly so they can be investigated before public
disclosure.

## Supported versions

Security fixes are applied to the latest release line. Consumers should keep
`kittle-core` and `kittle-adapters` on compatible current versions and should
upgrade both packages together when an adapter depends on a newer core API.

| Version line                  | Supported    |
| ----------------------------- | ------------ |
| Latest published minor        | Yes          |
| Older minor releases          | Best effort  |
| Unreleased development builds | No guarantee |

## Reporting a vulnerability

Do not open a public GitHub issue for a suspected vulnerability. Use the
[repository's private security advisory](https://github.com/kittlesuriya/kittle/security/advisories/new)
when available. If private advisories are unavailable, contact the repository
maintainer through the GitHub profile and include **security report** in
the subject.

Include:

- affected package and version;
- affected import path or file;
- a minimal reproduction or proof of concept;
- expected and actual behavior;
- whether authentication, tenant scope, ABAC, or data confidentiality is
  affected;
- any proposed mitigation.

Please avoid real credentials, production tenant data, or personal information.
Redact logs and use synthetic identifiers.

## Response process

The maintainers will acknowledge a report when possible, reproduce and assess
the impact, coordinate a fix, and publish release notes after a fix is
available. Timelines depend on severity and the quality of the reproduction.

The project may credit reporters in release notes unless anonymity is requested.

## Security expectations for applications

The specification does not replace application security controls. Applications must still:

- authenticate sessions and protect session credentials;
- configure trusted proxy boundaries correctly;
- provide real ABAC policy data and keep policy providers secure;
- use tenant-scoped persistence providers;
- review business-message and error-detail exposure;
- classify and sanitize audit values;
- apply database least privilege and migration controls;
- keep dependencies and deployment secrets current.

See the package READMEs for the security defaults and invariants enforced by
core and adapters.
