# kittle-adapters

Drizzle (D1/Postgres), HTTP, cache, and server adapters implementing the kittle-core ports.

## Install

```sh
npm install kittle-adapters kittle-core drizzle-orm zod uuidv7
```

Requires Node.js >= 20.

## Usage

```ts
import { createFrameworkWriteHandler } from "kittle-adapters/http"
import { createDrizzlePersistenceProvider } from "kittle-adapters/drizzle-pg"
```

Available entrypoints: `.`, `./http`, `./server`, `./drizzle-d1`, `./drizzle-pg`, `./cache`, `./utils/redact`.

## License

MIT
