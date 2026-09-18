import type { ActorContext } from "../foundation/requestContext"
import type { PersistenceProvider } from "./persistence"
import { assertDurableRecord } from "../foundation/canonicalJson"
import { ConfigurationError } from "../foundation/errors"

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
  if (args.oldValue) assertDurableRecord(args.oldValue, "Audit oldValue")
  if (args.newValue) assertDurableRecord(args.newValue, "Audit newValue")
  if (args.metadata) assertDurableRecord(args.metadata, "Audit metadata")
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

/**
 * Fail-closed validation for an audit resource id produced by operation
 * config (`resolveResourceId`) or caller code. An empty or non-string id
 * would persist an unqueryable audit record.
 */
export function assertAuditResourceId(
  value: unknown,
  operationKey: string
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigurationError(
      `Audit configuration for operation ${operationKey} must resolve a non-empty resource id.`
    )
  }
}

/**
 * Fail-closed validation for an audit value after extraction and
 * sanitization. The audit record stores plain JSON objects; arrays,
 * primitives, or class instances from a custom extractor/sanitizer are an
 * adapter/caller contract violation, not silent data.
 */
export function assertAuditRecordValue(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> | null {
  if (value === null) return
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigurationError(
      `${label} must be a JSON object or null after sanitization.`
    )
  }
}

/** Fail-closed validation for an audit sink produced by a sink factory. */
export function assertAuditSink(
  sink: unknown,
  label: string
): asserts sink is AuditSink {
  if (
    !sink ||
    typeof sink !== "object" ||
    Array.isArray(sink) ||
    typeof (sink as Partial<AuditSink>).write !== "function"
  ) {
    throw new ConfigurationError(`${label} must expose write().`)
  }
}

/**
 * Resolves an audit sink from a factory, failing fast when the factory or
 * its product does not honor the port contract.
 */
export function resolveAuditSink(
  factory: unknown,
  persistence: PersistenceProvider,
  label: string
): AuditSink {
  if (
    !factory ||
    typeof factory !== "object" ||
    typeof (factory as Partial<AuditSinkFactory>).create !== "function"
  ) {
    throw new ConfigurationError(`${label} must expose create().`)
  }
  const sink = (factory as AuditSinkFactory).create(persistence)
  assertAuditSink(sink, label)
  return sink
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
