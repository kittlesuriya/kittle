// Path utilities for accessing nested paths in objects

/**
 * Get a value from a nested path in an object
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj

  const keys = path.split(/[.[\]]/).filter(Boolean)

  let current: unknown = obj
  for (const key of keys) {
    if (current == null || typeof current !== "object") {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

/**
 * Set a value at a nested path immutably
 */
export function setByPath<T>(obj: T, path: string, value: unknown): T {
  if (!path) return value as T

  const keys = path.split(/[.[\]]/).filter(Boolean)

  function setRecursive(current: unknown, keyIndex: number): unknown {
    if (keyIndex >= keys.length) {
      return value
    }

    const key = keys[keyIndex]
    if (!key) return current

    const isArrayKey = /^\d+$/.test(key)

    if (current == null || typeof current !== "object") {
      current = isArrayKey ? [] : {}
    }

    if (Array.isArray(current)) {
      const index = parseInt(key, 10)
      const arr = current as unknown[]
      const copy: unknown[] = [...arr]
      copy[index] = setRecursive(arr[index], keyIndex + 1)
      return copy
    }

    return {
      ...(current as Record<string, unknown>),
      [key]: setRecursive(
        (current as Record<string, unknown>)[key],
        keyIndex + 1
      ),
    }
  }

  return setRecursive(obj, 0) as T
}

/**
 * Check if a path exists in an object
 */
export function hasPath(obj: unknown, path: string): boolean {
  return getByPath(obj, path) !== undefined
}
