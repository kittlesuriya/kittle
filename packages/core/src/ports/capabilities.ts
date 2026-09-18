import {
  ConfigurationError,
  RuntimeCapabilityError,
} from "../foundation/errors"

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

/** Closed-universe guard for the runtime capabilities document. */
export function assertRuntimeCapabilities(
  capabilities: unknown
): asserts capabilities is RuntimeCapabilities {
  if (
    !capabilities ||
    typeof capabilities !== "object" ||
    Array.isArray(capabilities)
  ) {
    throw new ConfigurationError("Runtime capabilities must be an object.")
  }
  const candidate = capabilities as Record<string, unknown>
  for (const key of ["deferredExecution", "objectStorage", "cache"] as const) {
    if (typeof candidate[key] !== "boolean") {
      throw new ConfigurationError(
        `Runtime capability "${key}" must be a boolean.`
      )
    }
  }
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

const REQUIRED_BOOLEAN_CAPABILITIES = [
  "interactiveTransactions",
  "atomicBatch",
  "returningInsert",
  "readSessions",
  "jsonQueries",
  "exactDecimal",
  "persistentConnection",
] as const

const NUMERIC_CAPABILITY_BOUNDS = [
  "maxBindParams",
  "maxStatementBytes",
  "maxBatchItems",
  "maxPageSize",
] as const

/**
 * Fail-closed validation for an adapter-declared capabilities object. A
 * malformed capabilities document (missing object, non-boolean flags, unknown
 * scope strings) must throw here instead of silently degrading to a weaker
 * execution path downstream.
 */
export function assertPersistenceCapabilities(
  capabilities: unknown
): asserts capabilities is PersistenceCapabilities {
  if (
    !capabilities ||
    typeof capabilities !== "object" ||
    Array.isArray(capabilities)
  ) {
    throw new ConfigurationError(
      "Persistence capabilities must be an object."
    )
  }
  const candidate = capabilities as Record<string, unknown>
  // Only fields the adapter actually declares are validated; a missing flag
  // keeps its historical falsy meaning (capability absent, enforced loudly
  // downstream when an operation requires it). A present-but-mistyped field
  // is a contract violation and throws here.
  for (const key of REQUIRED_BOOLEAN_CAPABILITIES) {
    if (candidate[key] !== undefined && typeof candidate[key] !== "boolean") {
      throw new ConfigurationError(
        `Persistence capability "${key}" must be a boolean when provided.`
      )
    }
  }
  if (
    candidate.atomicBatchScope !== undefined &&
    candidate.atomicBatchScope !== "unscoped" &&
    candidate.atomicBatchScope !== "tenant-scoped"
  ) {
    throw new ConfigurationError(
      'Persistence capability "atomicBatchScope" must be "unscoped" or "tenant-scoped" when provided.'
    )
  }
  for (const key of ["atomicBatchIdempotency", "conditionalAbacUpdate"] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== "boolean") {
      throw new ConfigurationError(
        `Persistence capability "${key}" must be a boolean when provided.`
      )
    }
  }
  for (const key of NUMERIC_CAPABILITY_BOUNDS) {
    const value = candidate[key]
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 1)
    ) {
      throw new ConfigurationError(
        `Persistence capability "${key}" must be a finite number >= 1 when provided.`
      )
    }
  }
}
