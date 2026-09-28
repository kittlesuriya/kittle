import { ForbiddenError } from "../foundation/errors"
import type { NormalizedAbacPolicy } from "./abacTypes"

/** Internal fast path for an already-evaluated record-policy set. */
export function assertMatchedPolicyWritableFields(
  relevant: NormalizedAbacPolicy[],
  record: Record<string, unknown>,
  changedFields?: string[]
): void {
  if (relevant.length === 0) {
    // The standalone field check fails closed, while enforceAbacWrite skips
    // this call when record-level denial needs to take precedence.
    const fields = changedFields ?? Object.keys(record)
    throw new ForbiddenError(
      "You do not have permission to update one or more fields.",
      {
        fields,
        reasonCode: "ABAC_FIELD_WRITE_DENIED",
      }
    )
  }

  let topPriority = -Infinity
  for (const policy of relevant)
    if (policy.priority > topPriority) topPriority = policy.priority
  const topTier = relevant.filter((p) => p.priority === topPriority)

  const denyPolicies = topTier.filter((p) => p.effect === "deny")
  const allowPolicies = topTier.filter((p) => p.effect === "allow")

  const denyAll = denyPolicies.some(
    (p) => !p.payload.fieldAccess?.write?.length
  )
  const allowAll = allowPolicies.some(
    (p) => !p.payload.fieldAccess?.write?.length
  )

  const fields = changedFields ?? Object.keys(record)
  const denied: string[] = []
  const deniedByPolicy = new Set(
    denyPolicies.flatMap((p) => p.payload.fieldAccess?.write ?? [])
  )
  const allowedByPolicy = new Set(
    allowPolicies.flatMap((p) => p.payload.fieldAccess?.write ?? [])
  )

  for (const field of fields) {
    if (denyAll) {
      denied.push(field)
      continue
    }
    if (deniedByPolicy.has(field)) {
      denied.push(field)
      continue
    }
    if (allowAll) continue
    if (allowedByPolicy.has(field)) continue
    if (allowPolicies.length > 0) denied.push(field)
  }

  if (denied.length > 0) {
    throw new ForbiddenError(
      "You do not have permission to update one or more fields.",
      {
        fields: denied,
        reasonCode: "ABAC_FIELD_WRITE_DENIED",
      }
    )
  }
}
