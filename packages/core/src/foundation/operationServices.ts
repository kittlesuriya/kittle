import { ConfigurationError } from "./errors"

export interface OperationLogger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

export interface OperationServices {
  readonly clock: () => Date
  readonly idGenerator: () => string
  readonly logger: OperationLogger
}

export function createNoopOperationLogger(): OperationLogger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  }
}

export function createOperationServices(args?: {
  clock?: () => Date
  idGenerator?: () => string
  logger?: OperationLogger
}): OperationServices {
  if (args?.clock !== undefined && typeof args.clock !== "function") {
    throw new ConfigurationError(
      "Operation services clock must be a function returning a Date."
    )
  }
  if (
    args?.idGenerator !== undefined &&
    typeof args.idGenerator !== "function"
  ) {
    throw new ConfigurationError(
      "Operation services idGenerator must be a function returning a non-empty string."
    )
  }
  if (args?.logger !== undefined) assertOperationLogger(args.logger)
  const clock = args?.clock ?? (() => new Date())
  const idGenerator = args?.idGenerator ?? (() => crypto.randomUUID())
  return {
    // Service outputs are validated at the boundary on every call: a clock
    // returning a non-Date or an idGenerator returning an empty id would
    // otherwise poison audit/outbox identity silently.
    clock: () => {
      const now = clock()
      if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new ConfigurationError(
          "Operation services clock must return a valid Date."
        )
      }
      return now
    },
    idGenerator: () => {
      const id = idGenerator()
      if (typeof id !== "string" || id.trim() === "") {
        throw new ConfigurationError(
          "Operation services idGenerator must return a non-empty string."
        )
      }
      return id
    },
    logger: args?.logger ?? createNoopOperationLogger(),
  }
}

/** Fail-closed shape check for a caller-supplied services object. */
export function assertOperationServices(
  services: unknown
): asserts services is OperationServices {
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new ConfigurationError(
      "Operation services must be an object with clock, idGenerator, and logger."
    )
  }
  const candidate = services as Partial<OperationServices>
  if (typeof candidate.clock !== "function") {
    throw new ConfigurationError(
      "Operation services clock must be a function returning a Date."
    )
  }
  if (typeof candidate.idGenerator !== "function") {
    throw new ConfigurationError(
      "Operation services idGenerator must be a function returning a non-empty string."
    )
  }
  assertOperationLogger(candidate.logger)
}

function assertOperationLogger(logger: unknown): asserts logger is OperationLogger {
  if (!logger || typeof logger !== "object" || Array.isArray(logger)) {
    throw new ConfigurationError(
      "Operation services logger must expose debug, info, warn, and error."
    )
  }
  for (const method of ["debug", "info", "warn", "error"] as const) {
    if (typeof (logger as Record<string, unknown>)[method] !== "function") {
      throw new ConfigurationError(
        `Operation services logger must expose ${method}().`
      )
    }
  }
}
