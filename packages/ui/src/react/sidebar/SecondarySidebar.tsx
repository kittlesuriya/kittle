import { RuntimeLink as Link } from "../../core/runtime"
import { ArrowLeft, X, ChevronRight } from "lucide-react"
import { cn } from "../../core/cn"
import { filterItemsBySearch, isDeepActive } from "../../core/menu/utils"
import {
  ARIA_LABELS,
  RADIUS,
  SECONDARY_HEADER,
  SECONDARY_NAV_CONTAINER,
  SECONDARY_ITEM,
  hotkeyClasses,
  badgeClasses,
} from "../../core/menu/constants"
import { formatHotkey } from "../../core/menu/hotKeys"
import { MarqueeText } from "../ui/marquee-text"
import { useTranslation } from "react-i18next"
import type { SecondarySidebarProps } from "../../core/menu/types"

/**
 * SecondarySidebar component for nested navigation
 */
export function SecondarySidebar({
  isOpen,
  items,
  parentTitle,
  onBack,
  onClose,
  onNavigateDeeper,
  searchTerm,
  pathname,
  density = "xs",
  showHotkeys = true,
  showBadge = true,
}: SecondarySidebarProps): React.ReactElement | null {
  const { t } = useTranslation()
  if (!isOpen) return null

  const filteredItems = filterItemsBySearch(items, searchTerm)
  const headerPad = SECONDARY_HEADER[density]
  const navPad = SECONDARY_NAV_CONTAINER[density]
  const itemPad = SECONDARY_ITEM[density]
  const iconSize = density === "xs" || density === "sm" ? 15 : 16
  const iconGap = density === "xs" ? "gap-1.5" : "gap-3"

  return (
    <div
      className={cn(
        "absolute inset-0 bg-sidebar z-sidebar",
        "animate-in slide-in-from-left duration-200"
      )}
      aria-label={ARIA_LABELS.secondarySidebar}
    >
      <div
        className={`flex items-center justify-between ${headerPad} border-b border-sidebar-border`}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-sidebar-foreground hover:text-sidebar-primary transition-colors"
          aria-label={ARIA_LABELS.backButton}
        >
          <ArrowLeft size={16} />
          <span className="font-medium">
            {t(`sidebar.links.${parentTitle}`, { defaultValue: parentTitle })}
          </span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-sidebar-accent transition-colors"
          aria-label={ARIA_LABELS.closeButton}
        >
          <X size={16} />
        </button>
      </div>

      <nav className={`app-scrollbar overflow-y-auto ${navPad}`}>
        {filteredItems.map((item) => {
          const hasChildren = item.children && item.children.length > 0
          const isActive = isDeepActive(item, pathname)

          if (hasChildren) {
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => onNavigateDeeper(item)}
                disabled={item.disabled}
                className={cn(
                  `w-full flex items-center justify-between ${itemPad} ${RADIUS.md}`,
                  "text-sidebar-foreground",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
                  isActive &&
                    "bg-sidebar-primary text-sidebar-primary-foreground font-medium hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground",
                  item.disabled &&
                    "opacity-50 cursor-not-allowed hover:bg-transparent"
                )}
              >
                <div className={`flex items-center ${iconGap}`}>
                  {item.icon && <item.icon size={iconSize} />}
                  <span>
                    {t(`sidebar.links.${item.title}`, {
                      defaultValue: item.title,
                    })}
                  </span>
                </div>
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

          if (item.disabled) {
            return (
              <div
                key={item.path}
                className={cn(
                  `flex items-center ${itemPad} ${RADIUS.md}`,
                  "text-sidebar-foreground opacity-50 cursor-not-allowed"
                )}
                aria-disabled="true"
                title={`${item.title}${item.badge ? ` (${String(item.badge)})` : ""}`}
              >
                {item.icon && <item.icon size={iconSize} />}
                <span className="flex-1">
                  {t(`sidebar.links.${item.title}`, {
                    defaultValue: item.title,
                  })}
                </span>
                {showBadge && item.badge ? (
                  <span className={badgeClasses}>{item.badge}</span>
                ) : null}
              </div>
            )
          }

          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                "group",
                `flex items-center ${itemPad} ${RADIUS.md}`,
                "text-sidebar-foreground",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
                isActive &&
                  "bg-sidebar-primary text-sidebar-primary-foreground font-medium hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground"
              )}
            >
              {item.icon && <item.icon size={iconSize} />}
              <MarqueeText
                label={t(`sidebar.links.${item.title}`, {
                  defaultValue: item.title,
                })}
                fallback="truncate"
              />
              {showBadge && item.badge ? (
                <span className={badgeClasses}>{item.badge}</span>
              ) : null}
              {showHotkeys && item.hotkey && !isActive && (
                <kbd className={hotkeyClasses}>{formatHotkey(item.hotkey)}</kbd>
              )}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
