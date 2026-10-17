// Form utilities for sanitization and ID management

import type { ArrayItemWithLocalId } from "./types"

// Internal symbol for tracking array items (won't serialize to JSON)
const ITEM_ID_MAP = new WeakMap<object, string>()

/**
 * Generate a unique ID for array items
 */
export function generateItemId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Get or create an ID for an array item
 */
export function getItemId(item: unknown): string {
  if (!item || typeof item !== "object") {
    return generateItemId()
  }

  // Check if item already has __localId (legacy support)
  const typedItem = item as Record<string, unknown>
  if (typeof typedItem.__localId === "string") {
    return typedItem.__localId
  }

  // Use WeakMap for new items
  let id = ITEM_ID_MAP.get(item)
  if (!id) {
    id = generateItemId()
    ITEM_ID_MAP.set(item, id)
  }
  return id
}

/**
 * Sanitize form data by removing internal tracking fields
 */
export function sanitizeFormData<T>(data: T): T {
  if (data === null || data === undefined) {
    return data
  }

  if (Array.isArray(data)) {
    return (data as unknown[]).map((item) =>
      sanitizeFormData(item)
    ) as unknown as T
  }

  if (typeof data === "object") {
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (key === "__localId") {
        continue
      }
      cleaned[key] = sanitizeFormData(value)
    }
    return cleaned as T
  }

  return data
}

/**
 * Add __localId to array items for tracking
 */
export function ensureLocalIds(items: unknown[]): ArrayItemWithLocalId[] {
  if (!Array.isArray(items)) {
    return items as ArrayItemWithLocalId[]
  }

  return items.map((item) => {
    if (!item || typeof item !== "object") {
      return item as ArrayItemWithLocalId
    }

    const typedItem = item as Record<string, unknown>

    // If already has __localId, keep it
    if (typeof typedItem.__localId === "string") {
      return typedItem as ArrayItemWithLocalId
    }

    // Add __localId for tracking
    return {
      ...typedItem,
      __localId: getItemId(item),
    }
  })
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  // Try structuredClone first
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(obj)
    } catch {
      // Fall through to manual implementation
    }
  }

  if (obj === null || obj === undefined) {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T
  }

  if (Array.isArray(obj)) {
    return (obj as unknown[]).map((item) => deepClone(item)) as unknown as T
  }

  if (typeof obj === "object") {
    const cloned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      cloned[key] = deepClone(value)
    }
    return cloned as T
  }

  return obj
}
