import { ConfigurationError } from "kittle-core/domain"

/**
 * Normalize MySQL result shapes to extract affected-rows count.
 * Handles mysql2 (ResultSetHeader.affectedRows), Drizzle wrappers,
 * and framework ({ affectedRows }) result shapes.
 */
export function getAffectedRows(result: unknown): number {
  if (!result || typeof result !== "object") {
    throw new ConfigurationError(
      "Unsupported MySQL mutation result shape: expected an object"
    )
  }

  const obj = result as Record<string, unknown>

  if (typeof obj.affectedRows === "number") return obj.affectedRows
  if (typeof obj.rowCount === "number") return obj.rowCount
  if (typeof obj.rowsAffected === "number") return obj.rowsAffected
  if (typeof obj.count === "number") return obj.count

  if (obj.meta && typeof obj.meta === "object") {
    const meta = obj.meta as Record<string, unknown>
    if (typeof meta.affectedRows === "number") return meta.affectedRows
    if (typeof meta.rowCount === "number") return meta.rowCount
    if (typeof meta.changes === "number") return meta.changes
  }

  throw new ConfigurationError(
    "Unsupported MySQL mutation result shape: could not extract affected rows"
  )
}
