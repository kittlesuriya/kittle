export type FrameworkCoreErrorCode =
  | "FORBIDDEN"
  | "CONFLICT"
  | "RETRYABLE_PERSISTENCE_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "CAPABILITY_REQUIRED"
  | "RUNTIME_CAPABILITY_REQUIRED"
  | "VALIDATION_ERROR"
  | "BAD_REQUEST"
  | "AUDIT_SINK_MISSING"
  | "AUDIT_ACTOR_MISSING"
  | "OUTBOX_SINK_MISSING"
  | "RATE_LIMIT_EXCEEDED"
  | "CONFIGURATION_ERROR"
  | "INVALID_POLICY_CONFIGURATION"
  | "OPTIMISTIC_CONCURRENCY_FAILED"
  | "OPERATION_CONTEXT_INACTIVE"
  | "EFFECT_REGISTRATION_CLOSED"
  | "EFFECT_COLLECTOR_DISPOSED"
  | "EFFECTS_ALREADY_DRAINED"

/** Stable numeric identifiers for framework errors.
 *
 * These are intentionally separate from HTTP status codes. HTTP statuses
 * describe the transport response, while these identifiers describe the
 * application error and remain stable across transports.
 */
export const FRAMEWORK_ERROR_NUMERIC_CODES = {
  VALIDATION_ERROR: 1001,
  BAD_REQUEST: 1002,
  UNAUTHORIZED: 1101,
  FORBIDDEN: 1102,
  CAPABILITY_REQUIRED: 1103,
  RUNTIME_CAPABILITY_REQUIRED: 1104,
  NOT_FOUND: 1201,
  CONFLICT: 1202,
  OPTIMISTIC_CONCURRENCY_FAILED: 1203,
  RATE_LIMIT_EXCEEDED: 1301,
  AUDIT_SINK_MISSING: 2001,
  AUDIT_ACTOR_MISSING: 2002,
  OUTBOX_SINK_MISSING: 2003,
  CONFIGURATION_ERROR: 2004,
  INVALID_POLICY_CONFIGURATION: 2005,
  RETRYABLE_PERSISTENCE_ERROR: 3001,
  OPERATION_CONTEXT_INACTIVE: 4001,
  EFFECT_REGISTRATION_CLOSED: 4002,
  EFFECT_COLLECTOR_DISPOSED: 4003,
  EFFECTS_ALREADY_DRAINED: 4004,
} as const satisfies Record<FrameworkCoreErrorCode, number>

export type FrameworkCoreErrorNumericCode =
  (typeof FRAMEWORK_ERROR_NUMERIC_CODES)[FrameworkCoreErrorCode]

export const INTERNAL_SERVER_ERROR_NUMERIC_CODE = 5001

export class FrameworkCoreError extends Error {
  public readonly code: FrameworkCoreErrorCode
  public readonly numericCode: FrameworkCoreErrorNumericCode
  public readonly details?: unknown

  constructor(
    message: string,
    code: FrameworkCoreErrorCode,
    details?: unknown
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.numericCode = FRAMEWORK_ERROR_NUMERIC_CODES[code]
    this.details = details
  }
}

export class ForbiddenError extends FrameworkCoreError {
  constructor(message: string = "Forbidden", details?: unknown) {
    super(message, "FORBIDDEN", details)
  }
}

export class UnauthorizedError extends FrameworkCoreError {
  constructor(message: string = "Unauthorized", details?: unknown) {
    super(message, "UNAUTHORIZED", details)
  }
}

export class ConflictError extends FrameworkCoreError {
  constructor(message: string = "Conflict", details?: unknown) {
    super(message, "CONFLICT", details)
  }
}

export class RetryablePersistenceError extends FrameworkCoreError {
  readonly kind = "retryable" as const

  constructor(
    message: string = "A transient persistence failure occurred",
    details?: unknown
  ) {
    super(message, "RETRYABLE_PERSISTENCE_ERROR", details)
  }
}

export class NotFoundError extends FrameworkCoreError {
  constructor(message: string = "Not found", details?: unknown) {
    super(message, "NOT_FOUND", details)
  }
}

export class CapabilityError extends FrameworkCoreError {
  constructor(
    message: string = "Required capability is not available",
    details?: unknown
  ) {
    super(message, "CAPABILITY_REQUIRED", details)
  }
}

export class RuntimeCapabilityError extends FrameworkCoreError {
  constructor(
    message: string = "Required runtime capability is not available",
    details?: unknown
  ) {
    super(message, "RUNTIME_CAPABILITY_REQUIRED", details)
  }
}

export class ValidationError extends FrameworkCoreError {
  constructor(message: string = "Validation error", details?: unknown) {
    super(message, "VALIDATION_ERROR", details)
  }
}

export class BusinessRuleError extends FrameworkCoreError {
  constructor(message: string = "Business rule violation", details?: unknown) {
    super(message, "BAD_REQUEST", details)
  }
}

export class RateLimitError extends FrameworkCoreError {
  public readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super("Rate limit exceeded", "RATE_LIMIT_EXCEEDED", { retryAfterMs })
    this.retryAfterMs = retryAfterMs
  }
}

export class AuditSinkMissingError extends FrameworkCoreError {
  constructor(
    message: string = "Audit sink is required but missing",
    details?: unknown
  ) {
    super(message, "AUDIT_SINK_MISSING", details)
  }
}

export class AuditActorMissingError extends FrameworkCoreError {
  constructor(
    message: string = "Audit actor is required but missing",
    details?: unknown
  ) {
    super(message, "AUDIT_ACTOR_MISSING", details)
  }
}

export class OutboxSinkMissingError extends FrameworkCoreError {
  constructor(
    message: string = "Outbox sink is required but missing",
    details?: unknown
  ) {
    super(message, "OUTBOX_SINK_MISSING", details)
  }
}

export class ConfigurationError extends FrameworkCoreError {
  constructor(message: string = "Configuration error", details?: unknown) {
    super(message, "CONFIGURATION_ERROR", details)
  }
}

export class InvalidPolicyConfigurationError extends FrameworkCoreError {
  readonly moduleKey: string
  readonly policyId: string | null
  readonly issues: unknown[]
  readonly catalogModuleKey?: string

  constructor(
    message: string,
    details: {
      moduleKey: string
      policyId: string | null
      issues: unknown[]
      catalogModuleKey?: string
    }
  ) {
    super(message, "INVALID_POLICY_CONFIGURATION", {
      moduleKey: details.moduleKey,
      policyId: details.policyId,
    })
    this.moduleKey = details.moduleKey
    this.policyId = details.policyId
    this.issues = details.issues
    if (details.catalogModuleKey !== undefined)
      this.catalogModuleKey = details.catalogModuleKey
  }
}

export class UnsupportedCapabilityError extends FrameworkCoreError {
  constructor(message: string = "Unsupported capability", details?: unknown) {
    super(message, "CAPABILITY_REQUIRED", details)
  }
}

export class OptimisticConcurrencyError extends FrameworkCoreError {
  constructor(
    message: string = "Optimistic concurrency conflict — version mismatch",
    details?: unknown
  ) {
    super(message, "OPTIMISTIC_CONCURRENCY_FAILED", details)
  }
}

export class TenantScopeViolationError extends FrameworkCoreError {
  constructor(message: string = "Tenant scope violation", details?: unknown) {
    super(message, "CONFIGURATION_ERROR", details)
  }
}

export class ImmutableFieldViolationError extends FrameworkCoreError {
  constructor(
    message: string = "Immutable field violation",
    details?: unknown
  ) {
    super(message, "VALIDATION_ERROR", details)
  }
}

export class TransactionUnavailableError extends FrameworkCoreError {
  constructor(
    message: string = "Transaction is unavailable",
    details?: unknown
  ) {
    super(message, "CONFIGURATION_ERROR", details)
  }
}

export class OperationContextInactiveError extends FrameworkCoreError {
  constructor(
    message = "Operation context is no longer active",
    details?: unknown
  ) {
    super(message, "OPERATION_CONTEXT_INACTIVE", details)
  }
}

export class EffectRegistrationClosedError extends FrameworkCoreError {
  constructor(message = "Effect registration is closed", details?: unknown) {
    super(message, "EFFECT_REGISTRATION_CLOSED", details)
  }
}

export class EffectCollectorDisposedError extends FrameworkCoreError {
  constructor(
    message = "Effect collector has been disposed",
    details?: unknown
  ) {
    super(message, "EFFECT_COLLECTOR_DISPOSED", details)
  }
}

export class EffectCollectorDrainedError extends FrameworkCoreError {
  constructor(
    message = "Deferred effects have already been drained",
    details?: unknown
  ) {
    super(message, "EFFECTS_ALREADY_DRAINED", details)
  }
}
