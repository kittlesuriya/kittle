import { ConfigurationError } from "./errors"

export interface ActorContext {
  id: string
  type: string
  impersonatedById?: string | null
}

export interface RequestContext {
  requestId: string
  correlationId: string
  tenantId?: string | null
  actor?: ActorContext
  metadata?: Record<string, unknown>
}

/**
 * Fail-closed shape check for a caller-supplied request context. Identity
 * fields (actor id/type) are held to non-empty strings; observability ids
 * must be strings. Catches wiring bugs at operation entry instead of
 * persisting malformed audit records or mis-scoping tenants downstream.
 */
export function assertRequestContext(
  request: unknown
): asserts request is RequestContext {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new ConfigurationError(
      "Operation request context must be an object."
    )
  }
  const candidate = request as Partial<RequestContext>
  if (
    typeof candidate.requestId !== "string" ||
    typeof candidate.correlationId !== "string"
  ) {
    throw new ConfigurationError(
      "Operation request context must carry string requestId and correlationId."
    )
  }
  if (
    candidate.tenantId !== undefined &&
    candidate.tenantId !== null &&
    typeof candidate.tenantId !== "string"
  ) {
    throw new ConfigurationError(
      "Operation request tenantId must be a string or null when provided."
    )
  }
  if (candidate.actor !== undefined) {
    if (
      !candidate.actor ||
      typeof candidate.actor !== "object" ||
      Array.isArray(candidate.actor)
    ) {
      throw new ConfigurationError(
        "Operation request actor must be an object when provided."
      )
    }
    if (
      typeof candidate.actor.id !== "string" ||
      candidate.actor.id.trim() === "" ||
      typeof candidate.actor.type !== "string" ||
      candidate.actor.type.trim() === ""
    ) {
      throw new ConfigurationError(
        "Operation request actor must carry non-empty string id and type."
      )
    }
  }
  if (
    candidate.metadata !== undefined &&
    (!candidate.metadata ||
      typeof candidate.metadata !== "object" ||
      Array.isArray(candidate.metadata))
  ) {
    throw new ConfigurationError(
      "Operation request metadata must be an object when provided."
    )
  }
}
