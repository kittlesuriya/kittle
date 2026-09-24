import { useEffect, useMemo, useState } from "react"
import { useUiComponents, type UiComponents } from "../ui"
import type { MenuItem, SidebarProps } from "./types"

function visible(item: MenuItem, can?: SidebarProps["can"]): boolean {
  return !item.permission || can?.(item.permission) !== false
}

function normalize(path?: string): string {
  if (!path || path === "/") return path ?? ""
  return path.replace(/\/+$/, "")
}

function active(item: MenuItem, pathname?: string): boolean {
  const current = normalize(pathname)
  const path = normalize(item.path)
  return Boolean(path && (current === path || current.startsWith(`${path}/`)))
}

function filterItems(
  items: MenuItem[],
  search: string,
  can?: SidebarProps["can"]
): MenuItem[] {
  const needle = search.trim().toLowerCase()
  return items
    .filter((item) => visible(item, can))
    .map((item) => ({
      ...item,
      children: filterItems(item.children ?? [], search, can),
    }))
    .filter(
      (item) =>
        !needle ||
        item.title.toLowerCase().includes(needle) ||
        (item.children?.length ?? 0) > 0
    )
}

function NavigationItem({
  item,
  pathname,
  can,
  collapsed,
  onNavigate,
  expanded,
  onToggle,
  renderItem,
  components,
}: {
  item: MenuItem
  pathname: string | undefined
  can?: SidebarProps["can"]
  collapsed: boolean
  onNavigate?: SidebarProps["onNavigate"]
  expanded: boolean
  onToggle: () => void
  renderItem?: SidebarProps["renderItem"]
  components: UiComponents
}) {
  const { Button } = components
  const isActive = active(item, pathname)
  const hasChildren = Boolean(item.children?.length)
  if (!visible(item, can)) return null
  return (
    <li>
      {renderItem?.({ item, active: isActive, collapsed }) ?? (
        <Button
          className={`ui__nav-item ${isActive ? "ui__nav-item--active" : ""}`}
          type="button"
          disabled={item.disabled}
          title={collapsed ? item.title : undefined}
          aria-expanded={hasChildren ? expanded : undefined}
          onClick={() => {
            if (hasChildren) onToggle()
            else onNavigate?.(item)
          }}
          onKeyDown={(event) => {
            if (
              (event.key === "Enter" || event.key === " ") &&
              !item.disabled
            ) {
              event.preventDefault()
              if (hasChildren) onToggle()
              else onNavigate?.(item)
            }
          }}
        >
          {item.icon}
          {!collapsed && <span>{item.title}</span>}
          {!collapsed && item.badge !== undefined && (
            <small>{item.badge}</small>
          )}
          {!collapsed && item.hotkey && <kbd>{item.hotkey}</kbd>}
        </Button>
      )}
      {hasChildren && expanded && !collapsed && (
        <ul>
          {item.children?.map((child) => (
            <NavigationItem
              key={child.id ?? child.path ?? child.title}
              item={child}
              pathname={pathname}
              can={can}
              collapsed={collapsed}
              onNavigate={onNavigate}
              expanded={active(child, pathname)}
              onToggle={() => undefined}
              renderItem={renderItem}
              components={components}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Permission-aware, router-neutral navigation component. */
export function Sidebar({
  items,
  pathname,
  can,
  collapsed: controlledCollapsed,
  onNavigate,
  header,
  footer,
  className,
  components,
  showSearch = true,
  searchPlaceholder = "Search navigation…",
  showCollapse = true,
  initialCollapsed = false,
  persistKey,
  onCollapsedChange,
  onSearch,
  renderItem,
}: SidebarProps) {
  const resolvedComponents = useUiComponents(components)
  const { Button, Input } = resolvedComponents
  const [internalCollapsed, setInternalCollapsed] = useState(() => {
    if (!persistKey || typeof window === "undefined") return initialCollapsed
    return window.localStorage.getItem(`${persistKey}:collapsed`) === "true"
  })
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const collapsed = controlledCollapsed ?? internalCollapsed
  const filtered = useMemo(
    () => filterItems(items, search, can),
    [can, items, search]
  )

  useEffect(() => {
    const next = new Set<string>()
    const visit = (nodes: MenuItem[]) =>
      nodes.forEach((item) => {
        if (
          item.children?.some(
            (child) =>
              active(child, pathname) ||
              child.children?.some((nested) => active(nested, pathname))
          )
        )
          next.add(item.id ?? item.path ?? item.title)
        visit(item.children ?? [])
      })
    visit(items)
    setExpanded(next)
  }, [items, pathname])

  const toggleCollapsed = () => {
    const next = !collapsed
    if (controlledCollapsed === undefined) setInternalCollapsed(next)
    if (persistKey && typeof window !== "undefined")
      window.localStorage.setItem(`${persistKey}:collapsed`, String(next))
    onCollapsedChange?.(next)
  }
  const setSearchValue = (value: string) => {
    setSearch(value)
    onSearch?.(value)
  }

  return (
    <aside
      className={`ui ui__sidebar ${collapsed ? "ui__sidebar--collapsed" : ""} ${className ?? ""}`.trim()}
    >
      {header}
      <nav aria-label="Application navigation">
        {showSearch && !collapsed && (
          <Input
            aria-label="Search navigation"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => setSearchValue(event.target.value)}
          />
        )}
        <ul>
          {filtered
            .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
            .map((item) => {
              const key = item.id ?? item.path ?? item.title
              return (
                <NavigationItem
                  key={key}
                  item={item}
                  pathname={pathname}
                  can={can}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                  expanded={expanded.has(key)}
                  onToggle={() =>
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(key)) next.delete(key)
                      else next.add(key)
                      return next
                    })
                  }
                  renderItem={renderItem}
                  components={resolvedComponents}
                />
              )
            })}
        </ul>
      </nav>
      {showCollapse && (
        <Button
          type="button"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={toggleCollapsed}
        >
          {collapsed ? "→" : "←"}
        </Button>
      )}
      {footer}
    </aside>
  )
}
