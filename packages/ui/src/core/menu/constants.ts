/**
 * Sidebar Constants
 * Animation variants, CSS presets, and configuration values
 */

import type { DrawerBreakpoint, SidebarDensity } from "./types"

export const sidebarAnimations = {
  expanded: { width: "var(--sidebar-width, 16rem)" },
  collapsed: { width: "var(--sidebar-collapsed-width, 4rem)" },
  transition: {
    duration: 0.3,
    ease: [0.25, 0.1, 0.25, 1],
  },
}

export const secondarySidebarAnimations = {
  slideRight: {
    initial: { x: "-100%", opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: "-100%", opacity: 0 },
  },
  slideLeft: {
    initial: { x: "100%", opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: "100%", opacity: 0 },
  },
  transition: {
    type: "spring",
    stiffness: 300,
    damping: 30,
  },
}

export const flyoutAnimations = {
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -8 },
  transition: {
    duration: 0.15,
    ease: "easeOut",
  },
}

export const dropdownAnimations = {
  initial: { opacity: 0, height: 0 },
  animate: {
    opacity: 1,
    height: "auto",
    transition: {
      height: { duration: 0.2, ease: "easeOut" },
      opacity: { duration: 0.15, delay: 0.05 },
    },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: {
      height: { duration: 0.15 },
      opacity: { duration: 0.1 },
    },
  },
}

export const CHORD_TIMEOUT = 1500
export const SEARCH_DEBOUNCE = 150
export const TOOLTIP_DELAY = 500

export const BREAKPOINTS = {
  mobile: 768,
  tablet: 1024,
  desktop: 1280,
} as const

export const HIDE_BUTTON: Record<DrawerBreakpoint, string> = {
  sm: "sm:hidden",
  md: "md:hidden",
  lg: "lg:hidden",
  xl: "xl:hidden",
}

export const SHOW_PILL: Record<DrawerBreakpoint, string> = {
  sm: "hidden sm:block",
  md: "hidden md:block",
  lg: "hidden lg:block",
  xl: "hidden xl:block",
}

export const DESKTOP_SIDEBAR: Record<DrawerBreakpoint, string> = {
  sm: "sm:relative sm:translate-x-0",
  md: "md:relative md:translate-x-0",
  lg: "lg:relative lg:translate-x-0",
  xl: "xl:relative xl:translate-x-0",
}

export const ITEM_PAD: Record<SidebarDensity, string> = {
  xs: "px-2 py-1.5 gap-1.5 text-[12px]",
  sm: "px-2.5 py-2 gap-2 text-[13px]",
  md: "px-3 py-2.5 gap-2.5 text-sm",
  lg: "px-4 py-3 gap-3 text-sm",
}

export const SEARCH_H: Record<SidebarDensity, string> = {
  xs: "py-1",
  sm: "py-1.5",
  md: "py-2",
  lg: "py-3",
}

export const PILL_W: Record<SidebarDensity, string> = {
  xs: "h-6 w-6",
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-9 w-9",
}

export const SECTION_GAP: Record<SidebarDensity, string> = {
  xs: "mb-1",
  sm: "mb-1.5",
  md: "mb-2",
  lg: "mb-3",
}

export const SECTION_HEADING: Record<SidebarDensity, string> = {
  xs: "px-2 py-0.5 text-[10px]",
  sm: "px-2.5 py-1 text-[11px]",
  md: "px-3 py-1.5 text-xs",
  lg: "px-3 py-2 text-xs",
}

export const ITEM_GAP: Record<SidebarDensity, string> = {
  xs: "space-y-0.5",
  sm: "space-y-0.5",
  md: "space-y-1",
  lg: "space-y-1.5",
}

export const DROPDOWN_CONTAINER: Record<SidebarDensity, string> = {
  xs: "ml-4 mt-0.5 space-y-0.5 pl-1.5",
  sm: "ml-5 mt-0.5 space-y-0.5 pl-2",
  md: "ml-5 mt-1 space-y-1 pl-2.5",
  lg: "ml-6 mt-1.5 space-y-1.5 pl-3",
}

export const DROPDOWN_ACTIVE_RAIL: Record<SidebarDensity, string> = {
  xs: "-left-[7.5px]",
  sm: "-left-[9.5px]",
  md: "-left-[11.5px]",
  lg: "-left-[13.5px]",
}

export const DROPDOWN_ITEM: Record<SidebarDensity, string> = {
  xs: "flex items-center gap-1.5 px-1.5 py-0.5 text-[12px]",
  sm: "flex items-center gap-1.5 px-2 py-1 text-[13px]",
  md: "flex items-center gap-2 px-2 py-1.5 text-sm",
  lg: "flex items-center gap-2 px-2.5 py-2 text-sm",
}

export const NAV_CONTAINER: Record<SidebarDensity, string> = {
  xs: "pt-0.5 px-1",
  sm: "pt-1 px-1.5",
  md: "pt-1.5 px-2",
  lg: "pt-2 px-3",
}

export const SECONDARY_HEADER: Record<SidebarDensity, string> = {
  xs: "px-3 py-2",
  sm: "px-3 py-2.5",
  md: "px-4 py-3",
  lg: "px-4 py-3",
}

export const SECONDARY_NAV_CONTAINER: Record<SidebarDensity, string> = {
  xs: "p-1.5",
  sm: "p-2",
  md: "p-2.5",
  lg: "p-3",
}

export const SECONDARY_ITEM: Record<SidebarDensity, string> = {
  xs: "px-2 py-1.5 gap-1.5 text-[13px]",
  sm: "px-2.5 py-2 gap-2 text-[13px]",
  md: "px-3 py-2.5 gap-3 text-sm",
  lg: "px-3 py-3 gap-3 text-sm",
}

export const RADIUS = {
  base: "rounded",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
  none: "rounded-none",
} as const

export type RadiusSize = keyof typeof RADIUS

export const menuItemBaseClasses = {
  default: [
    `flex items-center ${RADIUS.md}`,
    "text-[13px]",
    "text-sidebar-foreground",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    "transition-colors duration-150",
  ].join(" "),
  active: [
    "bg-sidebar-primary text-sidebar-primary-foreground font-medium",
    "hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground",
  ].join(" "),
  collapsed: "justify-center px-2 py-2.5",
  expanded: "w-full",
}

export const hotkeyClasses = `sidebar-hotkey ml-auto shrink-0 select-none rounded border px-1 py-px font-mono text-[10px] leading-tight transition-opacity duration-150 ${RADIUS.sm}`

export const badgeClasses = `bg-sidebar-accent text-sidebar-accent-foreground text-xs font-semibold px-2 py-0.5 ${RADIUS.full}`

export const ARIA_LABELS = {
  sidebar: "Main navigation",
  secondarySidebar: "Secondary navigation",
  backButton: "Go back to previous menu",
  closeButton: "Close menu",
  searchInput: "Search menu items",
  clearSearch: "Clear search",
} as const
