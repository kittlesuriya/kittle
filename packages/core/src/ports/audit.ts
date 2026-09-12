import type { ActorContext } from "../domain/requestContext"
import type { PersistenceProvider } from "./persistence"

export type { ActorContext }

export type AuditSanitizer = (value: unknown) => unknown
export type AuditFieldClassification = "include" | "mask" | "omit"
export type AuditFieldClassifications = Record<string, AuditFieldClassification>

const SENSITIVE_AUDIT_KEYS =
  /(?:address|api.?key|auth|birth|card|clinical|diagnos|email|name|note|password|patient|phone|secret|ssn|symptom|token|medical|\bmrn\b)/i
const SENSITIVE_AUDIT_VALUE =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|\b(?:\+?\d[ -.]*){10,}\b|\b\d{4}-\d{2}-\d{2}\b/g

/** Conservative fallback used when an operation has not supplied an app policy. */
export function defaultAuditSanitizer(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(SENSITIVE_AUDIT_VALUE, "[redacted]")
  if (Array.isArray(value)) return value.map(defaultAuditSanitizer)
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      result[key] = SENSITIVE_AUDIT_KEYS.test(key)
        ? "[redacted]"
        : defaultAuditSanitizer(entry)
    }
    return result
  }
  return value
}

/** Applies explicit schema policy before heuristic redaction. Omission is structural and wins. */
export function classifyAuditValue(
  value: unknown,
  classifications?: AuditFieldClassifications
): unknown {
  if (!classifications || !value || typeof value !== "object") return value
  if (Array.isArray(value))
    return value.map((entry) => classifyAuditValue(entry, classifications))
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const classification = classifications[key]
    if (classification === "omit") continue
    result[key] =
      classification === "mask"
        ? "[masked]"
        : classifyAuditValue(entry, classifications)
  }
  return result
}

export interface AuditRecord {
  id: string
  occurredAt: Date
  action: string
  resourceType: string
  resourceId: string
  actor: ActorContext
  tenantId: string | null
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

export function buildAuditRecord(args: {
  id: string
  occurredAt: Date
  actor: ActorContext
  action: string
  resourceType: string
  resourceId: string
  tenantId: string | null
  oldValue?: Record<string, unknown> | null
  newValue?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}): AuditRecord {
  return {
    id: args.id,
    occurredAt: args.occurredAt,
    actor: args.actor,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    tenantId: args.tenantId,
    oldValue: args.oldValue ?? null,
    newValue: args.newValue ?? null,
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
  }
}

export interface AuditSink {
  write(record: AuditRecord): Promise<void>
}

export interface AuditSinkFactory {
  create(persistence: PersistenceProvider): AuditSink
}

/** Adapts a persistence-aware sink constructor to the common composition port. */
export function createAuditSinkFactory(
  create: (persistence: PersistenceProvider) => AuditSink
): AuditSinkFactory {
  return { create }
}
