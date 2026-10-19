import type { ReactNode, CSSProperties } from "react"
import type { LucideIcon } from "lucide-react"
import type { AbilityLike } from "../runtime/types"

// =============================================================================
// Menu Item Types
// =============================================================================

/**
 * Single menu item
 */
export interface MenuItem {
  id?: string
  moduleKey?: string
  title: string
  path: string
  icon?: LucideIcon
  badge?: string | number
  hotkey?: string
  disabled?: boolean
  order?: number
  children?: MenuItem[]
  section?: string
  useSecondary?: boolean
  permission?: MenuItemPermission
}

/**
 * Menu section containing items
 */
export interface MenuSection {
  title: string
  items: MenuItem[]
}

/**
 * Permission descriptor for menu items
 */
export interface MenuItemPermission {
  action: string
  subject: string
}

// =============================================================================
// Sidebar Configuration
// =============================================================================

/**
 * Breakpoint options
 */
export type DrawerBreakpoint = "sm" | "md" | "lg" | "xl"

/**
 * Density options
 */
export type SidebarDensity = "xs" | "sm" | "md" | "lg"

/** Stable styling hooks for the sidebar and its independently usable parts. */
export interface SidebarClassNames {
  drawer?: string
  nav?: string
  topbar?: string
  main?: string
  collapseButton?: string
  header?: string
  search?: string
  searchInput?: string
  searchIcon?: string
  searchClearButton?: string
  menuSection?: string
  menuItem?: string
  menuDropdown?: string
  menuBadge?: string
  menuHotkey?: string
  menuActiveIndicator?: string
  menuDisclosureIcon?: string
  menuSectionHeading?: string
  headerLink?: string
  /** Generated initial/logo placeholder only; a supplied logo remains caller-owned. */
  headerLogo?: string
  headerTitle?: string
  headerSubtitle?: string
  secondary?: string
  secondaryHeader?: string
  secondaryBackButton?: string
  secondaryCloseButton?: string
  flyout?: string
  flyoutHeader?: string
  flyoutBackButton?: string
  userMenuTrigger?: string
  userMenuContent?: string
  userMenuProfile?: string
  userMenuLanguageSection?: string
  userMenuLanguageOption?: string
  userMenuAppearanceSection?: string
  userMenuAppearanceOption?: string
  userMenuLogoutButton?: string
  organizationSwitcher?: string
  organizationSwitcherIcon?: string
  organizationSwitcherLabel?: string
  organizationSwitcherDescription?: string
  organizationSwitcherChevron?: string
}

/**
 * Animation direction
 */
export type AnimationDirection = "slide-right" | "slide-left"

/**
 * Secondary sidebar configuration
 */
export interface SecondarySidebarConfig {
  behavior?: "overlay" | "push"
  showOn?: "click" | "hover"
  closeOnSelect?: boolean
  closeOnOutsideClick?: boolean
  animationDirection?: AnimationDirection
}

/**
 * Navigation stack item
 */
export interface NavStackItem {
  items: MenuItem[]
  title: string
  parentPath: string
}

// =============================================================================
// Component Props
// =============================================================================

/**
 * Sidebar component props
 */
export interface SidebarProps {
  children: ReactNode
  menuItems?: MenuItem[]
  useSecondary?: boolean
  drawerBreakpoint?: DrawerBreakpoint
  showCollapse?: boolean
  showBadge?: boolean
  showHotkeys?: boolean
  showSearch?: boolean
  showOrganizationSwitcher?: boolean
  density?: SidebarDensity
  onLogout?: () => void
  logo?: ReactNode
  title?: string
  subtitle?: string
  homeLink?: string
  /** Content to display in the center of the top header navbar. */
  headerCenter?: ReactNode
  /** Actions pinned to the right of the top header navbar, before the user menu. */
  headerActions?: ReactNode
  /** Signed-in user for the header avatar menu. */
  user?: {
    name?: string
    email?: string
    avatarUrl?: string
  }
  className?: string
  classNames?: SidebarClassNames
}

export interface UserMenuProps {
  name?: string
  email?: string
  avatarUrl?: string
  onLogout?: () => void
  /** Second line under the name. Falls back to `email` when omitted. */
  subtitle?: string
  /** Overrides the default "Signed in" badge label (e.g. "Verified Customer"). */
  badgeLabel?: string
  classNames?: SidebarClassNames
}

/**
 * SidebarHeader props
 */
export interface SidebarHeaderProps {
  collapsed: boolean
  logo?: ReactNode
  title: string
  subtitle?: string
  homeLink: string
  classNames?: SidebarClassNames
}

/**
 * SidebarSearch props
 */
export interface SidebarSearchProps {
  value: string
  onChange: (value: string) => void
  className?: string
  classNames?: SidebarClassNames
}

/**
 * MenuSection component props
 */
export interface MenuSectionProps {
  title: string
  items: MenuItem[]
  collapsed: boolean
  openIdx: number | null
  pathname: string
  searchTerm: string
  toggleDropdown: (idx: number) => void
  keyToggleDropdown: (idx: number) => (event: React.KeyboardEvent) => void
  keyNavigate: (path: string) => (event: React.KeyboardEvent) => void
  setRef: (el: HTMLElement | null, index: number) => void
  startIndex: number
  showBadge: boolean
  showHotkeys: boolean
  density?: SidebarDensity
  onOpenSecondary?: (item: MenuItem) => void
  classNames?: SidebarClassNames
}

/**
 * SecondarySidebar props
 */
export interface SecondarySidebarProps {
  isOpen: boolean
  items: MenuItem[]
  parentTitle: string
  onBack: () => void
  onClose: () => void
  onNavigateDeeper: (item: MenuItem) => void
  config: SecondarySidebarConfig
  width: string
  collapsed: boolean
  searchTerm: string
  pathname: string
  density?: SidebarDensity
  showHotkeys?: boolean
  showBadge?: boolean
  classNames?: SidebarClassNames
}

/**
 * FlyoutMenu props
 */
export interface FlyoutMenuProps {
  currentItem: MenuItem
  pathname: string
  style: CSSProperties
  navStack: NavStackItem[]
  onNavigateDeeper: (item: MenuItem) => void
  onGoBack: () => void
  onClose: () => void
  showHotkeys?: boolean
  showBadge?: boolean
  classNames?: SidebarClassNames
}

/**
 * OrganizationSwitcher props
 */
export interface OrganizationSwitcherProps {
  className?: string
  classNames?: SidebarClassNames
}

// =============================================================================
// Hook Return Types
// =============================================================================

/**
 * Filtered sections result
 */
export interface FilteredSectionsResult {
  sections: MenuSection[]
  filteredFlat: MenuItem[]
}

/**
 * Simplified ability interface for permission checks. The canonical
 * definition lives with the runtime ports (`AbilityLike`).
 */
export type Ability = AbilityLike
