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
  return {
    clock: args?.clock ?? (() => new Date()),
    idGenerator: args?.idGenerator ?? (() => crypto.randomUUID()),
    logger: args?.logger ?? createNoopOperationLogger(),
  }
}
