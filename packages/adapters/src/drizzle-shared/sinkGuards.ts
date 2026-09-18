import type { AuditRecord, OutboxRecord } from "kittle-core/ports"
import { ConfigurationError } from "kittle-core/domain"

function assertNonEmptyString(
  value: unknown,
  label: string,
  sink: string
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigurationError(
      `${sink} requires a non-empty string ${label}; refusing to persist a partial record.`
    )
  }
}

/**
 * Fail-closed identity check for outbox appends. The sink persists the full
 * event identity (id/type/version/aggregate/idempotencyKey/occurredAt) plus a
 * fingerprint; a malformed record must be rejected before any insert so it can
 * never partially persist (e.g. a row with an empty idempotency key that later
 * collides with legitimate events).
 */
export function assertOutboxRecordIdentity(
  record: OutboxRecord,
  sink: string
): void {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ConfigurationError(
      `${sink} requires an outbox record object; refusing to persist a partial record.`
    )
  }
  assertNonEmptyString(record.id, "id", sink)
  assertNonEmptyString(record.type, "type", sink)
  if (!Number.isSafeInteger(record.version) || record.version < 1) {
    throw new ConfigurationError(
      `${sink} requires a positive safe-integer version; refusing to persist a partial record.`
    )
  }
  assertNonEmptyString(record.aggregateType, "aggregateType", sink)
  assertNonEmptyString(record.aggregateId, "aggregateId", sink)
  assertNonEmptyString(record.idempotencyKey, "idempotencyKey", sink)
  if (!(record.occurredAt instanceof Date) || Number.isNaN(record.occurredAt.getTime())) {
    throw new ConfigurationError(
      `${sink} requires a valid occurredAt Date; refusing to persist a partial record.`
    )
  }
  if (
    record.tenantId !== undefined &&
    record.tenantId !== null &&
    typeof record.tenantId !== "string"
  ) {
    throw new ConfigurationError(
      `${sink} requires tenantId to be a string or null; refusing to persist a partial record.`
    )
  }
}

/**
 * Fail-closed identity check for audit writes. Rejects malformed records
 * before any insert so an unqueryable partial audit row is never persisted.
 */
export function assertAuditRecordIdentity(
  record: AuditRecord,
  sink: string
): void {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ConfigurationError(
      `${sink} requires an audit record object; refusing to persist a partial record.`
    )
  }
  assertNonEmptyString(record.id, "id", sink)
  assertNonEmptyString(record.action, "action", sink)
  assertNonEmptyString(record.resourceType, "resourceType", sink)
  assertNonEmptyString(record.resourceId, "resourceId", sink)
  if (!(record.occurredAt instanceof Date) || Number.isNaN(record.occurredAt.getTime())) {
    throw new ConfigurationError(
      `${sink} requires a valid occurredAt Date; refusing to persist a partial record.`
    )
  }
  if (
    record.tenantId !== undefined &&
    record.tenantId !== null &&
    typeof record.tenantId !== "string"
  ) {
    throw new ConfigurationError(
      `${sink} requires tenantId to be a string or null; refusing to persist a partial record.`
    )
  }
  const actor = record.actor as AuditRecord["actor"] | undefined
  if (!actor || typeof actor !== "object") {
    throw new ConfigurationError(
      `${sink} requires an actor context; refusing to persist a partial record.`
    )
  }
  assertNonEmptyString(actor.id, "actor.id", sink)
  assertNonEmptyString(actor.type, "actor.type", sink)
}
