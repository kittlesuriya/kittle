import {
  useState,
  useRef,
  useMemo,
  useEffect,
  useLayoutEffect,
  useCallback,
  type CSSProperties,
} from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { MenuSection } from "./MenuSection"
import { SidebarHeader } from "./SidebarHeader"
import { SecondarySidebar } from "./SecondarySidebar"
import { SidebarSearch } from "./SidebarSearch"
import { FlyoutMenu } from "./FlyoutMenu"
import { useFilteredMenuSections } from "../../core/menu/useFilteredMenuSections"
import { useGlobalHotkeys, normaliseHotkey } from "../../core/menu/hotKeys"
import {
  HIDE_BUTTON,
  SHOW_PILL,
  DESKTOP_SIDEBAR,
  SEARCH_H,
  PILL_W,
  NAV_CONTAINER,
  RADIUS,
} from "../../core/menu/constants"
import { cn } from "../../core/cn"
import { OrganizationSwitcher } from "./OrganizationSwitcher"
import { UserMenu } from "./UserMenu"
import { ALLOW_ALL_ABILITY, useUiRuntime } from "../../core/runtime"
import { shouldUseSecondary, isDeepActive } from "../../core/menu/utils"
import { useTranslation } from "react-i18next"
import type {
  SidebarProps,
  MenuItem,
  NavStackItem,
  SecondarySidebarConfig,
} from "../../core/menu/types"

/**
 * Main Sidebar component with navigation, search, and nested menus
 */
export function Sidebar({
  children,
  menuItems = [],
  useSecondary = true,
  drawerBreakpoint = "md",
  showCollapse = true,
  showBadge = true,
  showHotkeys = true,
  showSearch = true,
  showOrganizationSwitcher = true,
  density = "md",
  onLogout,
  logo,
  title,
  subtitle,
  homeLink = "/",
  headerCenter,
  headerActions,
  user,
  className,
  classNames,
}: SidebarProps): React.ReactElement {
  const { t } = useTranslation()
  const resolvedTitle =
    title ?? t("common.app_name", { defaultValue: "App Name" })
  const runtime = useUiRuntime()
  const navigation = runtime.navigation
  const pathname = navigation?.pathname ?? window.location.pathname
  const navigate =
    navigation?.navigate ??
    ((to: string) => {
      window.location.href = to
    })
  const hasRoute = navigation?.hasRoute ?? (() => true)
  const ability = runtime.ability ?? ALLOW_ALL_ABILITY

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const [flyoutStyle, setFlyoutStyle] = useState<CSSProperties>({})

  const [navStack, setNavStack] = useState<NavStackItem[]>([])
  const secondaryOpen = navStack.length > 0
  const currentNav = navStack[navStack.length - 1]

  const [flyoutNavStack, setFlyoutNavStack] = useState<NavStackItem[]>([])

  const userDismissedSecondary = useRef(false)
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname
  const navStackRef = useRef(navStack)
  navStackRef.current = navStack
  const searchRef = useRef<HTMLInputElement>(null)
  // Avoid spamming console warnings on re-renders
  const warnedMissingRoutes = useRef(new Set<string>())
  const menuRefs = useRef<(HTMLElement | null)[]>([])
  const flyoutRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const validatedMenuItems = useMemo(() => {
    const normalisePath = (p: string) => {
      if (p === "/") return p
      return p.endsWith("/") ? p.slice(0, -1) : p
    }

    const toDynamicRoutePath = (p: string) => {
      const normalized = normalisePath(p)
      const segments = normalized.split("/")
      if (
        segments.length >= 3 &&
        (segments[1] === "t" || segments[1] === "learn") &&
        segments[2] &&
        !segments[2].startsWith("$")
      ) {
        segments[2] = "$slug"
        return segments.join("/")
      }
      return normalized
    }

    const validateItems = (items: MenuItem[]): MenuItem[] => {
      return items.map((item) => {
        const children = item.children
          ? validateItems(item.children)
          : undefined
        const hasChildren = Boolean(children && children.length > 0)
        const path = normalisePath(item.path)

        // Only validate leaf links. Parent items are rendered as buttons.
        const shouldValidate =
          !hasChildren && path !== "#" && path.startsWith("/")
        const dynamicPath = shouldValidate ? toDynamicRoutePath(path) : path
        const exists = shouldValidate
          ? hasRoute(path) ||
            hasRoute(dynamicPath) ||
            hasRoute(`${dynamicPath}/`)
          : true

        if (shouldValidate && !exists) {
          const warnKey = `${item.id ?? item.title}:${path}`
          if (!warnedMissingRoutes.current.has(warnKey)) {
            warnedMissingRoutes.current.add(warnKey)
            console.warn("[Navigation] Missing frontend route for menu item", {
              id: item.id,
              title: item.title,
              path,
            })
          }

          return {
            ...item,
            path,
            disabled: true,
            badge: "Missing route",
            children,
          }
        }

        return {
          ...item,
          path,
          children,
        }
      })
    }

    return validateItems(menuItems)
  }, [menuItems, hasRoute])

  const hideBtn = HIDE_BUTTON[drawerBreakpoint]
  const showPill = SHOW_PILL[drawerBreakpoint]
  const desktopCt = DESKTOP_SIDEBAR[drawerBreakpoint]
  const toggleMobile = () => setMobileOpen((open) => !open)
  const toggleSidebar = () => {
    setCollapsed((prev) => !prev)
    setOpenDropdown(null)
    setFlyoutNavStack([])
  }

  const secondaryConfig: SecondarySidebarConfig = {
    behavior: "overlay",
    showOn: "click",
    closeOnSelect: true,
    closeOnOutsideClick: true,
    animationDirection: "slide-right",
  }

  const openSecondary = useCallback((item: MenuItem) => {
    if (item.children && item.children.length > 0) {
      setNavStack((prev) => {
        if (prev[0]?.title === item.title) {
          userDismissedSecondary.current = true
          return []
        }
        userDismissedSecondary.current = false
        return [
          { items: item.children!, title: item.title, parentPath: item.path },
        ]
      })
    }
  }, [])

  const navigateDeeper = useCallback(
    (item: MenuItem) => {
      if (item.children && item.children.length > 0) {
        setNavStack((prev) => [
          ...prev,
          { items: item.children!, title: item.title, parentPath: item.path },
        ])
      } else {
        navigate(item.path)
      }
    },
    [navigate]
  )

  const goBack = useCallback(() => {
    setNavStack((prev) => prev.slice(0, -1))
  }, [])

  const closeSecondary = useCallback(() => {
    setNavStack([])
  }, [])

  const flyoutNavigateDeeper = useCallback(
    (item: MenuItem) => {
      if (item.children && item.children.length > 0) {
        setFlyoutNavStack((prev) => [
          ...prev,
          { items: item.children!, title: item.title, parentPath: item.path },
        ])
      } else {
        navigate(item.path)
        setOpenDropdown(null)
        setFlyoutNavStack([])
      }
    },
    [navigate]
  )

  const flyoutGoBack = useCallback(() => {
    setFlyoutNavStack((prev) => prev.slice(0, -1))
  }, [])

  const flyoutClose = useCallback(() => {
    setOpenDropdown(null)
    setFlyoutNavStack([])
  }, [])

  // Sync flyout stack
  if (openDropdown === null && flyoutNavStack.length > 0) {
    setFlyoutNavStack([])
  }

  // Auto-sync secondary sidebar with current route
  useEffect(() => {
    if (!useSecondary) return
    if (userDismissedSecondary.current) return

    const matchingParent = validatedMenuItems.find(
      (item) =>
        shouldUseSecondary(item) &&
        item.children?.some((child) => isDeepActive(child, pathname))
    )

    if (matchingParent) {
      setNavStack((prev) => {
        if (prev[0]?.title === matchingParent.title) return prev
        return [
          {
            items: matchingParent.children!,
            title: matchingParent.title,
            parentPath: matchingParent.path,
          },
        ]
      })
    } else {
      setNavStack([])
    }
  }, [pathname, validatedMenuItems, useSecondary])

  useEffect(() => {
    if (!secondaryOpen || !secondaryConfig.closeOnOutsideClick) return

    const handleClickOutside = (event: MouseEvent) => {
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(event.target as Node)
      ) {
        const stack = navStackRef.current
        const currentItems = stack[stack.length - 1]?.items
        const onChildPage = currentItems?.some((item) =>
          isDeepActive(item, pathnameRef.current)
        )
        if (onChildPage) return // don't dismiss when still on a child page
        closeSecondary()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [secondaryOpen, secondaryConfig.closeOnOutsideClick, closeSecondary])

  const effectiveCollapsed = mobileOpen ? false : collapsed
  const widthClass = effectiveCollapsed ? "w-17" : "w-68"

  const searchPad = SEARCH_H[density]
  const pillSize = PILL_W[density]
  const navContainer = NAV_CONTAINER[density]

  const hotkeyMap = useMemo(() => {
    const map = new Map<string, () => void>()
    const owners = new Map<string, string>()

    if (showHotkeys) {
      const canSee = (item: MenuItem): boolean => {
        if (item.disabled) return false
        if (item.permission) {
          try {
            if (!ability.can(item.permission.action, item.permission.subject))
              return false
          } catch {
            return false
          }
        }
        return true
      }

      const register = (item: MenuItem) => {
        if (item.hotkey && item.path !== "#" && canSee(item)) {
          const key = normaliseHotkey(item.hotkey)
          const owner = owners.get(key)
          if (owner) {
            console.warn("[Navigation] Duplicate hotkey ignored", {
              hotkey: item.hotkey,
              id: item.id ?? item.title,
              owner,
            })
          } else {
            owners.set(key, item.id ?? item.title)
            const path = item.path
            map.set(key, () => {
              navigate(path)
            })
          }
        }
      }

      const registerTree = (items: MenuItem[]) => {
        items.forEach((item) => {
          register(item)
          if (item.children) registerTree(item.children)
        })
      }

      registerTree(validatedMenuItems)
    }

    return map
  }, [validatedMenuItems, navigate, showHotkeys, ability])

  useEffect(() => {
    if (!showSearch) return
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [showSearch])

  useGlobalHotkeys(hotkeyMap)

  const searchTerm = search.trim().toLowerCase()

  const { sections, filteredFlat } = useFilteredMenuSections(
    validatedMenuItems,
    searchTerm,
    ability
  )

  const computeFlyoutStyle = useCallback(
    (idx: number, measuredSize?: { width: number; height: number }) => {
      const el = menuRefs.current[idx]
      if (!el) return

      const rect = el.getBoundingClientRect()
      const viewportPad = 8
      const flyoutGap = 12
      const itemHeight = 36
      const headerHeight = 44
      const items = filteredFlat[idx]?.children
      const estimatedHeight = (items?.length ?? 1) * itemHeight + headerHeight
      const estimatedWidth = 192
      const height = measuredSize?.height ?? estimatedHeight
      const width = measuredSize?.width ?? estimatedWidth
      const maxTop = Math.max(
        viewportPad,
        window.innerHeight - height - viewportPad
      )
      const left = Math.max(
        viewportPad,
        Math.min(
          rect.right + flyoutGap,
          window.innerWidth - width - viewportPad
        )
      )
      let top: number

      if (rect.top + height <= window.innerHeight - viewportPad) {
        top = rect.top
      } else if (rect.bottom - height >= viewportPad) {
        top = rect.bottom - height
      } else {
        top = Math.min(Math.max(rect.top, viewportPad), maxTop)
      }

      setFlyoutStyle({ position: "fixed", top, left })
    },
    [filteredFlat]
  )

  // Auto-open flyout for matching secondary parent when collapsed (only on path change, not collapse toggle)
  useEffect(() => {
    if (!effectiveCollapsed || !useSecondary) return

    const matchingIdx = filteredFlat.findIndex(
      (item) =>
        shouldUseSecondary(item) &&
        item.children?.some((child) => isDeepActive(child, pathname))
    )

    if (matchingIdx >= 0) {
      computeFlyoutStyle(matchingIdx)
      setOpenDropdown(matchingIdx)
    }
    // effectiveCollapsed is intentionally not a dep: re-running on collapse
    // toggle would steal the open menu. Only path/data changes re-evaluate.
  }, [pathname, filteredFlat, useSecondary, computeFlyoutStyle])

  useEffect(() => {
    if (!effectiveCollapsed || openDropdown === null) return

    menuRefs.current = menuRefs.current.slice(0, filteredFlat.length)
    const handler = (event: MouseEvent) => {
      if (
        flyoutRef.current &&
        !flyoutRef.current.contains(event.target as Node) &&
        menuRefs.current.every(
          (refItem) => refItem && !refItem.contains(event.target as Node)
        )
      ) {
        setOpenDropdown(null)
      }
    }
    window.addEventListener("mousedown", handler)
    return () => window.removeEventListener("mousedown", handler)
  }, [effectiveCollapsed, filteredFlat.length, openDropdown])

  useLayoutEffect(() => {
    if (!effectiveCollapsed || openDropdown === null) return

    const reposition = () => {
      const rect = flyoutRef.current?.getBoundingClientRect()
      computeFlyoutStyle(
        openDropdown,
        rect ? { width: rect.width, height: rect.height } : undefined
      )
    }

    reposition()
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    return () => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    }
  }, [computeFlyoutStyle, effectiveCollapsed, flyoutNavStack, openDropdown])

  const toggleDropdown = (idx: number) => {
    if (effectiveCollapsed) {
      computeFlyoutStyle(idx)
    }
    setOpenDropdown((prev) => (prev === idx ? null : idx))
  }

  const keyToggleDropdown = (idx: number) => (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      toggleDropdown(idx)
    }
  }

  const keyNavigate = (path: string) => (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      navigate(path)
    }
  }

  return (
    <div
      className={cn(
        "fixed inset-0 flex overflow-hidden bg-background",
        className
      )}
    >
      {mobileOpen && (
        <button
          type="button"
          onClick={toggleMobile}
          aria-label="Close menu overlay"
          className={cn("fixed inset-0 bg-overlay-heavy z-overlay", hideBtn)}
        />
      )}

      <nav
        ref={sidebarRef}
        aria-label="Primary"
        className={cn(
          "flex flex-col shadow-lg bg-sidebar text-sidebar-foreground",
          "transition-all duration-300",
          widthClass,
          desktopCt,
          "fixed inset-y-0 left-0",
          // Mobile drawer must paint above the scrim (z-overlay).
          // Desktop is in-flow (relative), so the base sidebar level is fine there.
          mobileOpen ? "z-modal" : "z-sidebar",
          "transform",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          classNames?.drawer
        )}
      >
        <SidebarHeader
          collapsed={effectiveCollapsed}
          logo={logo}
          title={resolvedTitle}
          subtitle={subtitle}
          homeLink={homeLink}
          classNames={classNames}
        />

        {showSearch && !collapsed && (
          <SidebarSearch
            ref={searchRef}
            value={search}
            onChange={setSearch}
            className={searchPad}
            classNames={classNames}
          />
        )}

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          <nav
            className={cn(
              `app-scrollbar min-h-0 flex-1 overflow-y-auto ${navContainer}`,
              classNames?.nav
            )}
          >
            {sections.map((section, idx) => {
              const start = sections
                .slice(0, idx)
                .reduce((sum, sec) => sum + sec.items.length, 0)
              return (
                <MenuSection
                  key={section.title}
                  title={section.title}
                  items={section.items}
                  collapsed={effectiveCollapsed}
                  openIdx={openDropdown}
                  pathname={pathname}
                  searchTerm={searchTerm}
                  toggleDropdown={toggleDropdown}
                  keyToggleDropdown={keyToggleDropdown}
                  keyNavigate={keyNavigate}
                  setRef={(el, index) => {
                    menuRefs.current[index] = el
                  }}
                  startIndex={start}
                  showBadge={showBadge}
                  showHotkeys={showHotkeys}
                  density={density}
                  onOpenSecondary={useSecondary ? openSecondary : undefined}
                  classNames={classNames}
                />
              )
            })}
          </nav>

          {!effectiveCollapsed && secondaryOpen && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none z-sidebar">
              <div className="pointer-events-auto h-full">
                <SecondarySidebar
                  isOpen={secondaryOpen}
                  items={currentNav?.items ?? []}
                  parentTitle={currentNav?.title ?? ""}
                  onBack={goBack}
                  onClose={closeSecondary}
                  onNavigateDeeper={navigateDeeper}
                  config={secondaryConfig}
                  width={widthClass}
                  collapsed={effectiveCollapsed}
                  searchTerm={searchTerm}
                  pathname={pathname}
                  density={density}
                  showHotkeys={showHotkeys}
                  showBadge={showBadge}
                  classNames={classNames}
                />
              </div>
            </div>
          )}
        </div>

        {effectiveCollapsed &&
          openDropdown !== null &&
          filteredFlat[openDropdown] && (
            <FlyoutMenu
              ref={flyoutRef}
              currentItem={filteredFlat[openDropdown]}
              pathname={pathname}
              style={flyoutStyle}
              navStack={flyoutNavStack}
              onNavigateDeeper={flyoutNavigateDeeper}
              onGoBack={flyoutGoBack}
              onClose={flyoutClose}
              showHotkeys={showHotkeys}
              showBadge={showBadge}
              classNames={classNames}
            />
          )}

        {!effectiveCollapsed && showOrganizationSwitcher && (
          <div className="border-t border-sidebar-border bg-sidebar p-3 mt-auto">
            <OrganizationSwitcher classNames={classNames} />
          </div>
        )}
      </nav>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <header
          className={cn(
            "z-sticky flex min-h-16 items-center justify-between gap-2 border-b border-border/70 bg-card/95 px-3 py-2 shadow-sm backdrop-blur sm:px-6",
            classNames?.topbar
          )}
        >
          <button
            type="button"
            onClick={toggleMobile}
            className={`md:hidden p-1.5 shrink-0 ${RADIUS.md} bg-card shadow`}
            aria-label={t("sidebar.menu", { defaultValue: "Menu" })}
          >
            <svg
              className="w-5 h-5 text-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <title>{t("sidebar.menu", { defaultValue: "Menu" })}</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>

          {showCollapse && !mobileOpen && (
            <button
              type="button"
              onClick={toggleSidebar}
              className={cn(
                showPill,
                "group z-sticky",
                pillSize,
                `${RADIUS.md} bg-card shadow h-9 w-9`,
                "hidden md:flex items-center justify-center text-primary",
                "transition-all duration-200",
                "hover:bg-primary hover:text-primary-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                classNames?.collapseButton
              )}
              aria-label={
                collapsed
                  ? t("sidebar.expand", { defaultValue: "Expand sidebar" })
                  : t("sidebar.collapse", { defaultValue: "Collapse sidebar" })
              }
            >
              {collapsed ? (
                <ChevronRight
                  size={20}
                  className="m-auto transition-transform group-hover:translate-x-0.5"
                />
              ) : (
                <ChevronLeft
                  size={20}
                  className="m-auto transition-transform group-hover:-translate-x-0.5"
                />
              )}
            </button>
          )}

          {headerCenter ? (
            <div className="flex-1 flex items-center justify-center px-1 sm:px-4 min-w-0">
              {headerCenter}
            </div>
          ) : (
            <div className="flex-1" />
          )}

          <div className="flex shrink-0 items-center gap-1 rounded-xl border border-border/70 bg-background/70 p-1 shadow-xs">
            {headerActions ? (
              <div className="flex items-center gap-0.5 border-r border-border/70 pr-1">
                {headerActions}
              </div>
            ) : null}
            <UserMenu
              name={user?.name}
              email={user?.email}
              avatarUrl={user?.avatarUrl}
              onLogout={onLogout}
              classNames={classNames}
            />
          </div>
        </header>

        <main
          className={cn(
            "app-scrollbar flex-1 min-h-0 p-3 bg-background overflow-y-auto flex flex-col",
            classNames?.main
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
