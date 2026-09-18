import type { PersistenceProvider } from "./persistence"
import { assertDurableRecord } from "../foundation/canonicalJson"
import { ConfigurationError } from "../foundation/errors"

export interface NewOutboxRecord {
  id?: string
  type: string
  version: number
  tenantId?: string | null
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
  idempotencyKey: string
  occurredAt?: Date
}

export interface OutboxRecord extends NewOutboxRecord {
  id: string
  occurredAt: Date
}

export function normalizeOutboxRecord(
  record: NewOutboxRecord,
  defaults: { id: string; occurredAt: Date }
): OutboxRecord {
  assertNonEmptyOutboxField(record.type, "type")
  if (!Number.isSafeInteger(record.version) || record.version < 1) {
    throw new ConfigurationError(
      "Outbox record version must be a positive safe integer."
    )
  }
  assertNonEmptyOutboxField(record.aggregateType, "aggregateType")
  assertNonEmptyOutboxField(record.aggregateId, "aggregateId")
  assertNonEmptyOutboxField(record.idempotencyKey, "idempotencyKey")
  if (record.id !== undefined && typeof record.id !== "string") {
    throw new ConfigurationError(
      "Outbox record id must be a string when provided."
    )
  }
  if (
    record.occurredAt !== undefined &&
    (!(record.occurredAt instanceof Date) ||
      Number.isNaN(record.occurredAt.getTime()))
  ) {
    throw new ConfigurationError(
      "Outbox record occurredAt must be a valid Date when provided."
    )
  }
  if (
    record.tenantId !== undefined &&
    record.tenantId !== null &&
    typeof record.tenantId !== "string"
  ) {
    throw new ConfigurationError(
      "Outbox record tenantId must be a string or null when provided."
    )
  }
  assertDurableRecord(record.payload, "Outbox payload")
  return {
    ...record,
    id: record.id ?? defaults.id,
    occurredAt: record.occurredAt ?? defaults.occurredAt,
  }
}

function assertNonEmptyOutboxField(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigurationError(
      `Outbox record ${field} must be a non-empty string.`
    )
  }
}

export interface OutboxSink {
  append(record: OutboxRecord): Promise<void>
}

/** Fail-closed validation for an outbox sink produced by a sink factory. */
export function assertOutboxSink(
  sink: unknown,
  label: string
): asserts sink is OutboxSink {
  if (
    !sink ||
    typeof sink !== "object" ||
    Array.isArray(sink) ||
    typeof (sink as Partial<OutboxSink>).append !== "function"
  ) {
    throw new ConfigurationError(`${label} must expose append().`)
  }
}

/**
 * Resolves an outbox sink from a factory, failing fast when the factory or
 * its product does not honor the port contract.
 */
export function resolveOutboxSink(
  factory: unknown,
  persistence: PersistenceProvider,
  label: string
): OutboxSink {
  if (
    !factory ||
    typeof factory !== "object" ||
    typeof (factory as Partial<OutboxSinkFactory>).create !== "function"
  ) {
    throw new ConfigurationError(`${label} must expose create().`)
  }
  const sink = (factory as OutboxSinkFactory).create(persistence)
  assertOutboxSink(sink, label)
  return sink
}

export interface OutboxSinkFactory {
  create(persistence: PersistenceProvider): OutboxSink
}
