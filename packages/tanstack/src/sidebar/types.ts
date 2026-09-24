import type { ReactNode } from "react"
import type { UiConfig } from "../ui"

export interface NavigationPermission {
  action: string
  subject: string
}
export interface MenuItem {
  id?: string
  title: string
  path?: string
  icon?: ReactNode
  badge?: string | number
  children?: MenuItem[]
  permission?: NavigationPermission
  disabled?: boolean
  hotkey?: string
  order?: number
  section?: string
  useSecondary?: boolean
}
export interface SidebarProps {
  items: MenuItem[]
  pathname?: string
  can?: (permission: NavigationPermission) => boolean
  collapsed?: boolean
  onNavigate?: (item: MenuItem) => void
  header?: ReactNode
  footer?: ReactNode
  className?: string
  components?: UiConfig | undefined
  showSearch?: boolean
  searchPlaceholder?: string
  showCollapse?: boolean
  initialCollapsed?: boolean
  persistKey?: string
  onCollapsedChange?: (collapsed: boolean) => void
  onSearch?: (value: string) => void
  renderItem?: (context: {
    item: MenuItem
    active: boolean
    collapsed: boolean
  }) => ReactNode
}
