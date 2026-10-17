/**
 * Sidebar Utility Functions
 */

import type { MenuItem } from "./types"

const MAX_DEPTH = 10

/**
 * Check if item or its children match the current path
 */
export function isDeepActive(
  item: MenuItem,
  pathname: string,
  depth = 0
): boolean {
  if (depth >= MAX_DEPTH) return false
  if (pathname === item.path) return true
  if (item.children) {
    return item.children.some((child) =>
      isDeepActive(child, pathname, depth + 1)
    )
  }
  return false
}

/**
 * Check if item matches search term
 */
export function matchItem(item: MenuItem, term: string): boolean {
  if (!term) return true
  return (
    item.title.toLowerCase().includes(term) ||
    item.path.toLowerCase().includes(term)
  )
}

/**
 * Check if item or children match search term
 */
export function matchDeep(item: MenuItem, term: string, depth = 0): boolean {
  if (depth >= MAX_DEPTH) return false
  if (!term) return true
  if (matchItem(item, term)) return true
  if (item.children) {
    return item.children.some((child) => matchDeep(child, term, depth + 1))
  }
  return false
}

/**
 * Filter items by search term
 */
export function filterItemsBySearch(
  items: MenuItem[],
  term: string
): MenuItem[] {
  if (!term) return items
  return items.filter((item) => matchDeep(item, term))
}

/**
 * Check if item has deeply nested children
 */
export function hasDeepChildren(item: MenuItem): boolean {
  if (!item.children || item.children.length === 0) return false
  return item.children.some(
    (child) => child.children && child.children.length > 0
  )
}

/**
 * Check if item should use secondary sidebar
 */
export function shouldUseSecondary(item: MenuItem): boolean {
  const hasChildren = item.children && item.children.length > 0
  if (!hasChildren) return false
  const deepNested = hasDeepChildren(item)
  return deepNested || (item.useSecondary ?? false)
}

/**
 * Generate menu item ID
 */
export function getMenuItemId(prefix: string, index: number): string {
  return `${prefix}-item-${index}`
}

/**
 * Get ARIA attributes for menu item
 */
export function getMenuItemAria(
  isActive: boolean,
  hasChildren: boolean,
  isExpanded: boolean
): Record<string, string | boolean | undefined> {
  return {
    role: "menuitem",
    "aria-current": isActive ? "page" : undefined,
    "aria-haspopup": hasChildren ? "menu" : undefined,
    "aria-expanded": hasChildren ? isExpanded : undefined,
  }
}
