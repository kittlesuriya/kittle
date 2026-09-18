import { ConfigurationError } from "../foundation/errors"
import type { AuthorizationDecision } from "./operationDefinition"

/**
 * Fail-closed validation for `OperationAuthorizationPort.authorize()` results.
 *
 * A missing or malformed decision must never be treated as "allowed".
 * Callers must only proceed when the port returns an explicit object whose
 * `allowed` field is a boolean.
 */
export function assertAuthorizationDecision(
  decision: unknown,
  operationKey: string
): asserts decision is AuthorizationDecision {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw new ConfigurationError(
      `Authorization for operation ${operationKey} returned no decision; an explicit { allowed: boolean } decision is required.`
    )
  }
  const candidate = decision as Partial<AuthorizationDecision>
  if (typeof candidate.allowed !== "boolean") {
    throw new ConfigurationError(
      `Authorization for operation ${operationKey} returned a malformed decision; "allowed" must be a boolean.`
    )
  }
  if (
    candidate.reason !== undefined &&
    typeof candidate.reason !== "string"
  ) {
    throw new ConfigurationError(
      `Authorization for operation ${operationKey} returned a malformed decision; "reason" must be a string when provided.`
    )
  }
}
