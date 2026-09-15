import { RuntimeCapabilityError } from "../foundation/errors"

export interface PersistenceCapabilities {
  interactiveTransactions: boolean
  atomicBatch: boolean
  atomicBatchScope?: "unscoped" | "tenant-scoped"
  /** True when atomic batches can persist idempotency commit markers atomically with business commands. */
  atomicBatchIdempotency?: boolean
  returningInsert: boolean
  readSessions: boolean
  jsonQueries: boolean
  exactDecimal: boolean
  persistentConnection: boolean
  /** Whether the persistence adapter supports conditional ABAC-guarded updates via interactive transactions. */
  conditionalAbacUpdate?: boolean
  maxBindParams?: number
  maxStatementBytes?: number
  maxBatchItems?: number
  maxPageSize?: number
}

export interface RuntimeCapabilities {
  deferredExecution: boolean
  objectStorage: boolean
  cache: boolean
}

export type RuntimeCapability = keyof RuntimeCapabilities

const RUNTIME_CAPABILITY_NAMES: readonly RuntimeCapability[] = [
  "deferredExecution",
  "objectStorage",
  "cache",
]

/** Closed-universe guard for runtime capability names. */
export function isRuntimeCapability(value: string): value is RuntimeCapability {
  return (RUNTIME_CAPABILITY_NAMES as readonly string[]).includes(value)
}

/** Throws `RuntimeCapabilityError` when a value is not a known runtime capability. */
export function assertRuntimeCapability(
  value: string
): asserts value is RuntimeCapability {
  if (!isRuntimeCapability(value)) {
    throw new RuntimeCapabilityError(`Unknown runtime capability "${value}".`, {
      capability: value,
    })
  }
}

type BooleanKeys<T> = {
  [K in keyof T]: T[K] extends boolean ? K : never
}[keyof T]

export function requireCapability<
  TCapabilities extends object,
  TCapability extends BooleanKeys<TCapabilities>,
>(capabilities: TCapabilities, capability: TCapability): void {
  if (capabilities[capability]) return
  throw new RuntimeCapabilityError(
    `Runtime capability "${String(capability)}" is not available.`,
    {
      capability: String(capability),
    }
  )
}
