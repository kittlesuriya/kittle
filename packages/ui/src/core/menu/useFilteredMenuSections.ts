import { useMemo } from "react"
import { matchDeep, shouldUseSecondary } from "./utils"
import type {
  Ability,
  MenuItem,
  MenuSection,
  FilteredSectionsResult,
} from "./types"

/**
 * Hook to filter and group menu sections based on search and permissions
 */
export function useFilteredMenuSections(
  menuItems: MenuItem[],
  searchTerm: string,
  ability: Ability
): FilteredSectionsResult {
  return useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const match = (value: string) => value.toLowerCase().includes(term)
    const grouped: MenuSection[] = []

    const ensure = (title: string): MenuSection => {
      let group = grouped.find((section) => section.title === title)
      if (!group) {
        group = { title, items: [] }
        grouped.push(group)
      }
      return group
    }

    const canSee = (item: MenuItem): boolean => {
      if (item.path === "#") {
        const hasChildren = item.children && item.children.length > 0
        if (!hasChildren) return false

        const visibleChildren = (item.children ?? []).filter((child) =>
          canSee(child)
        )
        return visibleChildren.length > 0
      }

      const permission = item.permission
      if (!permission) return true
      return ability.can(permission.action, permission.subject)
    }

    const pushItem = (
      section: MenuSection,
      item: MenuItem,
      visibleChildren: MenuItem[]
    ) => {
      if (visibleChildren.length > 0) {
        section.items.push({ ...item, children: visibleChildren })
      } else {
        const { children: _children, ...rest } = item
        section.items.push(rest)
      }
    }

    for (const item of menuItems) {
      if (!canSee(item)) continue

      const secTitle = item.section ?? "General"
      const section = ensure(secTitle)

      const hasChildren = item.children && item.children.length > 0
      const isSecondary = shouldUseSecondary(item)

      if (!term || match(secTitle)) {
        if (hasChildren && !isSecondary) {
          const visibleChildren = (item.children ?? []).filter((child) =>
            canSee(child)
          )
          if (visibleChildren.length > 0 || item.path !== "#") {
            pushItem(section, item, visibleChildren)
          }
        } else {
          section.items.push(item)
        }
        continue
      }

      if (hasChildren && !isSecondary) {
        const visibleChildren = (item.children ?? []).filter((child) =>
          canSee(child)
        )

        const parentHit = match(item.title) || match(item.path)
        if (parentHit) {
          if (visibleChildren.length > 0 || item.path !== "#") {
            pushItem(section, item, visibleChildren)
          }
          continue
        }

        const matchedChildren = visibleChildren.filter(
          (child) => match(child.title) || match(child.path)
        )
        if (matchedChildren.length) pushItem(section, item, matchedChildren)
        continue
      }

      if (hasChildren && isSecondary && matchDeep(item, term)) {
        section.items.push(item)
        continue
      }

      if (match(item.title) || match(item.path)) section.items.push(item)
    }

    const nonEmpty = grouped.filter((section) => section.items.length)
    return {
      sections: nonEmpty,
      filteredFlat: nonEmpty.flatMap((section) => section.items),
    }
  }, [menuItems, searchTerm, ability])
}
