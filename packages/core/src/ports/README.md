# Core Ports

Ports define the capabilities required by framework operations without choosing a storage or runtime implementation.

Persistence, cache, audit, outbox, job, schedule, and rate-limit interfaces belong here. Adapters implement these contracts; applications select implementations at their composition roots.

Keep executable policy and normalization logic small and directly tested. Do not import Drizzle, Cloudflare, PostgreSQL, HTTP, or application modules into this layer.

Audit classification is explicit policy: `omit` removes a field before heuristic sanitization, `mask` replaces it, and `include` still passes through the heuristic sanitizer. Heuristic redaction is best-effort and cannot guarantee detection of arbitrary sensitive text; applications should classify sensitive schema fields explicitly.
