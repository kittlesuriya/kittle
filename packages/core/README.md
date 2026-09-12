# kittle-core

Domain, entity, execution, operation, and persistence-port primitives for building tenant-aware TypeScript applications.

## Install

```sh
npm install kittle-core
```

Requires Node.js >= 20.

## Usage

```ts
import { defineEntity } from "kittle-core/entity"
import { runOperation } from "kittle-core/operation"
import type { PersistenceProvider } from "kittle-core/ports"
```

Available entrypoints: `.`, `./domain`, `./domain/filterFieldMeta`, `./domain/predicate`, `./entity`, `./entity/capabilityCheck`, `./execution` (+ `dispatcher`, `executionContext`, `jobRegistry`, `retryPolicy`, `jobFingerprint`, `scheduleCalculator`, `scheduleDispatcher`, `scheduleStore`, `types`), `./operation`, `./ports`.

## License

MIT
