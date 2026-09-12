import type { PersistenceProvider } from "./persistence"

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
  return {
    ...record,
    id: record.id ?? defaults.id,
    occurredAt: record.occurredAt ?? defaults.occurredAt,
  }
}

export interface OutboxSink {
  append(record: OutboxRecord): Promise<void>
}

export interface OutboxSinkFactory {
  create(persistence: PersistenceProvider): OutboxSink
}
