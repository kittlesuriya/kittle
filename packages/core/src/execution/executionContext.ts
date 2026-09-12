import type {
  ExecutionClock,
  ExecutionLogger,
  FencedExternalEffect,
  JobExecutionContext,
  JobDefinition,
} from "./types"

export type {
  ExecutionClock,
  FencedExternalEffect,
  JobExecutionContext,
  ExecutionLogger,
}

export interface ExecutionContextFactory {
  fromJob(args: {
    job: {
      id: string
      jobType: string
      jobVersion: number
      tenantId: string | null
      correlationId: string | null
      attempt: number
      metadata: Record<string, unknown>
    }
    jobDef: JobDefinition
    now: Date
    logger?: ExecutionLogger
    signal?: AbortSignal
    clock?: ExecutionClock
  }): JobExecutionContext
}

export function createExecutionContext(args: {
  executionId?: string
  jobId: string
  jobType: string
  jobVersion: number
  attempt: number
  tenantId: string | null
  correlationId: string
  startedAt: Date
  logger?: ExecutionLogger
  signal?: AbortSignal
  deadline?: number
  metadata?: Record<string, unknown>
  clock?: ExecutionClock
  /** Lease assertion provided by the dispatcher; executed before every fenced effect. */
  assertLease: () => Promise<void>
}): JobExecutionContext {
  const logger = args.logger ?? createNoopLogger()
  /**
   * Framework-owned external effect API. Validates the current lease before
   * executing the effect. This is a lease fence, not an exactly-once guarantee.
   */
  const fencedEffect: FencedExternalEffect = {
    async execute<T>(effect: {
      effectName: string
      idempotencyKey: string
      fn: () => Promise<T>
    }): Promise<T> {
      try {
        await args.assertLease()
      } catch (leaseError) {
        logger.warn("Fenced effect blocked by lease loss", {
          jobId: args.jobId,
          jobType: args.jobType,
          effectName: effect.effectName,
          idempotencyKey: effect.idempotencyKey,
          error:
            leaseError instanceof Error
              ? leaseError.message
              : String(leaseError),
        })
        throw leaseError
      }
      logger.debug("Executing fenced effect", {
        jobId: args.jobId,
        effectName: effect.effectName,
        idempotencyKey: effect.idempotencyKey,
      })
      try {
        const result = await effect.fn()
        logger.debug("Fenced effect succeeded", {
          jobId: args.jobId,
          effectName: effect.effectName,
        })
        return result
      } catch (effectError) {
        logger.error("Fenced effect failed", {
          jobId: args.jobId,
          effectName: effect.effectName,
          error:
            effectError instanceof Error
              ? effectError.message
              : String(effectError),
        })
        throw effectError
      }
    },
  }
  const context: JobExecutionContext = {
    executionId: args.executionId ?? crypto.randomUUID(),
    jobId: args.jobId,
    jobType: args.jobType,
    jobVersion: args.jobVersion,
    attempt: args.attempt,
    tenantId: args.tenantId,
    correlationId: args.correlationId,
    startedAt: args.startedAt,
    logger: args.logger ?? createNoopLogger(),
    metadata: args.metadata ?? {},
    fencedEffect,
  }

  if (args.signal !== undefined) context.signal = args.signal
  if (args.deadline !== undefined) context.deadline = args.deadline
  if (args.clock !== undefined) context.clock = args.clock

  return context
}

export function createNoopLogger(): ExecutionLogger {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  }
}

export function consoleLogger(prefix?: string): ExecutionLogger {
  const p = prefix ? `[${prefix}]` : ""
  return {
    info(msg, data) {
      console.log(`${p} ${msg}`, data ?? "")
    },
    warn(msg, data) {
      console.warn(`${p} ${msg}`, data ?? "")
    },
    error(msg, data) {
      console.error(`${p} ${msg}`, data ?? "")
    },
    debug(msg, data) {
      console.debug(`${p} ${msg}`, data ?? "")
    },
  }
}
