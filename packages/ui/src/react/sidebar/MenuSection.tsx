import { RuntimeLink as Link } from "../../core/runtime"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "../../core/cn"
import {
  isDeepActive,
  shouldUseSecondary,
  getMenuItemAria,
} from "../../core/menu/utils"
import {
  menuItemBaseClasses,
  hotkeyClasses,
  badgeClasses,
  RADIUS,
  ITEM_PAD,
  SECTION_GAP,
  SECTION_HEADING,
  ITEM_GAP,
  DROPDOWN_CONTAINER,
  DROPDOWN_ITEM,
  DROPDOWN_ACTIVE_RAIL,
} from "../../core/menu/constants"
import { formatHotkey } from "../../core/menu/hotKeys"
import { MarqueeText } from "../ui/marquee-text"
import { useTranslation } from "react-i18next"
import type { MenuSectionProps } from "../../core/menu/types"
/**
 * MenuSection component for rendering a group of menu items
 */
export function MenuSection({
  title,
  items,
  collapsed,
  openIdx,
  pathname,
  toggleDropdown,
  keyToggleDropdown,
  keyNavigate,
  setRef,
  startIndex,
  showBadge,
  showHotkeys,
  density = "xs",
  onOpenSecondary,
}: MenuSectionProps): React.ReactElement {
  const { t } = useTranslation()
  const itemPad = ITEM_PAD[density]
  const sectionGap = SECTION_GAP[density]
  const sectionHeading = SECTION_HEADING[density]
  const itemGap = ITEM_GAP[density]
  const dropdownContainer = DROPDOWN_CONTAINER[density]
  const dropdownItem = DROPDOWN_ITEM[density]
  const dropdownActiveRail = DROPDOWN_ACTIVE_RAIL[density]
  return (
    <div className={sectionGap}>
      {!collapsed && title && (
        <div
          className={`${sectionHeading} font-semibold text-sidebar-foreground/80 uppercase tracking-wider`}
        >
          {t(`sidebar.sections.${title.toLowerCase()}`, {
            defaultValue: title,
          })}
        </div>
      )}

      <div className={itemGap}>
        {items.map((item, idx) => {
          // Prefer stable ids; avoid path-only keys because parent nodes use "#"
          const itemKey = item.id || item.path || `${item.title}-${idx}`

          const globalIdx = startIndex + idx
          const isActive = isDeepActive(item, pathname)
          const hasChildren = Boolean(item.children && item.children.length > 0)
          const useSecondary = shouldUseSecondary(item)
          const isOpen = openIdx === globalIdx && !useSecondary

          const ariaProps = getMenuItemAria(
            isActive,
            hasChildren,
            Boolean(isOpen)
          )

          // Item without children
          if (!hasChildren) {
            if (collapsed) {
              if (item.disabled) {
                return (
                  <div
                    key={itemKey}
                    ref={(el) => setRef(el, globalIdx)}
                    className={cn(
                      menuItemBaseClasses.default,
                      menuItemBaseClasses.collapsed,
                      "w-full opacity-50 cursor-not-allowed"
                    )}
                    title={`${item.title}${item.badge ? ` (${String(item.badge)})` : ""}`}
                    aria-disabled="true"
                    {...ariaProps}
                  >
                    {item.icon && <item.icon size={18} />}
                  </div>
                )
              }

              return (
                <Link
                  key={itemKey}
                  ref={(el: HTMLElement | null) => setRef(el, globalIdx)}
                  href={item.path}
                  className={cn(
                    menuItemBaseClasses.default,
                    menuItemBaseClasses.collapsed,
                    isActive && menuItemBaseClasses.active,
                    "w-full"
                  )}
                  title={item.title}
                  onKeyDown={keyNavigate(item.path)}
                  {...ariaProps}
                >
                  {item.icon && <item.icon size={18} />}
                </Link>
              )
            }

            if (item.disabled) {
              return (
                <div
                  key={itemKey}
                  ref={(el) => setRef(el, globalIdx)}
                  className={cn(
                    menuItemBaseClasses.default,
                    menuItemBaseClasses.expanded,
                    itemPad,
                    "w-full opacity-50 cursor-not-allowed"
                  )}
                  aria-disabled="true"
                  title={`${item.title}${item.badge ? ` (${String(item.badge)})` : ""}`}
                  {...ariaProps}
                >
                  {item.icon && <item.icon size={18} />}
                  <span className="flex-1 truncate">
                    {t(`sidebar.links.${item.title}`, {
                      defaultValue: item.title,
                    })}
                  </span>
                  {showBadge && item.badge && (
                    <span className={badgeClasses}>{item.badge}</span>
                  )}
                </div>
              )
            }

            return (
              <Link
                key={itemKey}
                ref={(el: HTMLElement | null) => setRef(el, globalIdx)}
                href={item.path}
                className={cn(
                  "group",
                  menuItemBaseClasses.default,
                  menuItemBaseClasses.expanded,
                  itemPad,
                  isActive && menuItemBaseClasses.active
                )}
                onKeyDown={keyNavigate(item.path)}
                {...ariaProps}
              >
                {item.icon && <item.icon size={18} />}
                <MarqueeText
                  label={t(`sidebar.links.${item.title}`, {
                    defaultValue: item.title,
                  })}
                  fallback="truncate"
                />
                {showBadge && item.badge && (
                  <span className={badgeClasses}>{item.badge}</span>
                )}
                {showHotkeys && item.hotkey && !isActive && (
                  <kbd className={hotkeyClasses}>
                    {formatHotkey(item.hotkey)}
                  </kbd>
                )}
              </Link>
            )
          }

          // Item with children - use secondary or dropdown
          if (useSecondary && onOpenSecondary) {
            if (collapsed) {
              return (
                <button
                  key={itemKey}
                  ref={(el: HTMLElement | null) => setRef(el, globalIdx)}
                  type="button"
                  onClick={() => toggleDropdown(globalIdx)}
                  onKeyDown={keyToggleDropdown(globalIdx)}
                  className={cn(
                    menuItemBaseClasses.default,
                    menuItemBaseClasses.collapsed,
                    isActive && menuItemBaseClasses.active,
                    "w-full"
                  )}
                  title={item.title}
                  {...ariaProps}
                >
                  {item.icon && <item.icon size={18} />}
                </button>
              )
            }

            return (
              <button
                key={itemKey}
                ref={(el: HTMLElement | null) => setRef(el, globalIdx)}
                type="button"
                onClick={() => onOpenSecondary(item)}
                className={cn(
                  menuItemBaseClasses.default,
                  menuItemBaseClasses.expanded,
                  itemPad,
                  isActive && menuItemBaseClasses.active,
                  "w-full"
                )}
                {...ariaProps}
              >
                {item.icon && <item.icon size={18} />}
                <span className="flex-1 truncate text-left">
                  {t(`sidebar.links.${item.title}`, {
                    defaultValue: item.title,
                  })}
                </span>
                <ChevronRight
                  size={14}
                  className={cn(
                    "shrink-0",
                    isActive
                      ? "text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80"
                  )}
                />
              </button>
            )
          }

          if (collapsed) {
            return (
              <button
                key={itemKey}
                ref={(el: HTMLElement | null) => setRef(el, globalIdx)}
                type="button"
                onClick={() => toggleDropdown(globalIdx)}
                onKeyDown={keyToggleDropdown(globalIdx)}
                className={cn(
                  menuItemBaseClasses.default,
                  menuItemBaseClasses.collapsed,
                  isActive && menuItemBaseClasses.active,
                  "w-full"
                )}
                title={item.title}
                {...ariaProps}
              >
                {item.icon && <item.icon size={18} />}
              </button>
            )
          }

          // Dropdown menu
          return (
            <div key={itemKey}>
              <button
                ref={(el: HTMLElement | null) => setRef(el, globalIdx)}
                type="button"
                onClick={() => toggleDropdown(globalIdx)}
                onKeyDown={keyToggleDropdown(globalIdx)}
                className={cn(
                  menuItemBaseClasses.default,
                  menuItemBaseClasses.expanded,
                  itemPad,
                  isActive && menuItemBaseClasses.active,
                  "w-full"
                )}
                {...ariaProps}
              >
                {item.icon && <item.icon size={18} />}
                <span className="flex-1 truncate text-left">
                  {t(`sidebar.links.${item.title}`, {
                    defaultValue: item.title,
                  })}
                </span>
                <ChevronDown
                  size={14}
                  className={cn(
                    "shrink-0 transition-transform duration-200",
                    isActive
                      ? "text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80",
                    isOpen && "rotate-180"
                  )}
                />
              </button>

              {isOpen && item.children && (
                <div
                  className={`${dropdownContainer} border-l border-sidebar-border`}
                >
                  {item.children.map((child) => {
                    const childActive = pathname === child.path

                    if (child.disabled) {
                      return (
                        <div
                          key={child.id || child.path}
                          className={cn(
                            `${dropdownItem} ${RADIUS.md}`,
                            "text-sidebar-foreground opacity-50 cursor-not-allowed"
                          )}
                          aria-disabled="true"
                          title={`${child.title}${child.badge ? ` (${String(child.badge)})` : ""}`}
                        >
                          {child.icon && <child.icon size={14} />}
                          <span>
                            {t(`sidebar.links.${child.title}`, {
                              defaultValue: child.title,
                            })}
                          </span>
                          {showBadge && child.badge && (
                            <span className={badgeClasses}>{child.badge}</span>
                          )}
                        </div>
                      )
                    }

                    return (
                      <Link
                        key={child.id || child.path}
                        href={child.path}
                        preload={false}
                        className={cn(
                          "group",
                          `${dropdownItem} ${RADIUS.md}`,
                          "relative",
                          "text-sidebar-foreground",
                          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
                          childActive &&
                            "bg-sidebar-primary text-sidebar-primary-foreground font-medium hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground"
                        )}
                      >
                        {childActive && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute top-0 bottom-0 w-[2px] rounded-full bg-sidebar-primary",
                              dropdownActiveRail
                            )}
                          />
                        )}
                        {child.icon && <child.icon size={14} />}
                        <MarqueeText
                          label={t(`sidebar.links.${child.title}`, {
                            defaultValue: child.title,
                          })}
                          fallback="truncate"
                        />
                        {showBadge && child.badge && (
                          <span className={badgeClasses}>{child.badge}</span>
                        )}
                        {showHotkeys && child.hotkey && !childActive && (
                          <kbd className={hotkeyClasses}>
                            {formatHotkey(child.hotkey)}
                          </kbd>
                        )}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
