import { RuntimeLink as Link } from "../../core/runtime"
import { forwardRef } from "react"
import { ChevronRight, ArrowLeft } from "lucide-react"
import { cn } from "../../core/cn"
import { isDeepActive } from "../../core/menu/utils"
import { RADIUS, hotkeyClasses, badgeClasses } from "../../core/menu/constants"
import { formatHotkey } from "../../core/menu/hotKeys"
import { MarqueeText } from "../ui/marquee-text"
import { useTranslation } from "react-i18next"
import type { FlyoutMenuProps } from "../../core/menu/types"

/**
 * FlyoutMenu component for collapsed sidebar
 */
export const FlyoutMenu = forwardRef<HTMLDivElement, FlyoutMenuProps>(
  (
    {
      currentItem,
      pathname,
      style,
      navStack,
      onNavigateDeeper,
      onGoBack,
      onClose,
      showHotkeys = true,
      showBadge = true,
      classNames,
    },
    ref
  ) => {
    const { t } = useTranslation()
    const currentNav = navStack[navStack.length - 1]
    const items = currentNav?.items ?? currentItem.children ?? []
    const title = currentNav?.title ?? currentItem.title
    const showBack = navStack.length > 0

    return (
      <div
        ref={ref}
        className={cn(
          `fixed z-dropdown min-w-48 bg-sidebar text-sidebar-foreground border border-sidebar-border ${RADIUS.lg} shadow-lg py-1`,
          classNames?.flyout
        )}
        style={style}
      >
        <div
          className={cn(
            "px-3 py-2 border-b border-sidebar-border flex items-center gap-2",
            classNames?.flyoutHeader
          )}
        >
          {showBack && (
            <button
              type="button"
              onClick={onGoBack}
              className={cn(
                "p-1 rounded hover:bg-sidebar-accent transition-colors",
                classNames?.flyoutBackButton
              )}
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <span className="text-sm font-medium text-sidebar-foreground">
            {t(`sidebar.links.${title}`, { defaultValue: title })}
          </span>
        </div>

        <div className="py-1 max-h-[min(60vh,480px)] overflow-y-auto">
          {items.map((item) => {
            const isActive = isDeepActive(item, pathname)
            const hasChildren = item.children && item.children.length > 0

            if (hasChildren) {
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => onNavigateDeeper(item)}
                  disabled={item.disabled}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-sm",
                    "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
                    isActive &&
                      "bg-sidebar-primary text-sidebar-primary-foreground font-medium hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground",
                    item.disabled &&
                      "opacity-50 cursor-not-allowed hover:bg-transparent",
                    classNames?.menuItem
                  )}
                >
                  <div className="flex items-center gap-2">
                    {item.icon && <item.icon size={16} />}
                    <span>
                      {t(`sidebar.links.${item.title}`, {
                        defaultValue: item.title,
                      })}
                    </span>
                  </div>
                  <ChevronRight
                    size={14}
                    className={cn(
                      "shrink-0 text-sidebar-foreground/80",
                      classNames?.menuDisclosureIcon
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
                    "flex items-center gap-2 px-3 py-2 text-sm",
                    "text-sidebar-foreground/60 opacity-70 cursor-not-allowed",
                    classNames?.menuItem
                  )}
                  aria-disabled="true"
                  title={`${item.title}${item.badge ? ` (${String(item.badge)})` : ""}`}
                >
                  {item.icon && <item.icon size={16} />}
                  <span className="flex-1">
                    {t(`sidebar.links.${item.title}`, {
                      defaultValue: item.title,
                    })}
                  </span>
                  {showBadge && item.badge ? (
                    <span className={cn(badgeClasses, classNames?.menuBadge)}>
                      {item.badge}
                    </span>
                  ) : null}
                </div>
              )
            }

            return (
              <Link
                key={item.path}
                href={item.path}
                preload={false}
                onClick={onClose}
                className={cn(
                  "group",
                  "flex items-center gap-2 px-3 py-2 text-sm",
                  "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
                  isActive &&
                    "bg-sidebar-primary text-sidebar-primary-foreground font-medium hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground",
                  classNames?.menuItem
                )}
              >
                {item.icon && <item.icon size={16} />}
                <MarqueeText
                  label={t(`sidebar.links.${item.title}`, {
                    defaultValue: item.title,
                  })}
                  fallback="truncate"
                />
                {showBadge && item.badge ? (
                  <span className={cn(badgeClasses, classNames?.menuBadge)}>
                    {item.badge}
                  </span>
                ) : null}
                {showHotkeys && item.hotkey && !isActive && (
                  <kbd className={cn(hotkeyClasses, classNames?.menuHotkey)}>
                    {formatHotkey(item.hotkey)}
                  </kbd>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    )
  }
)

FlyoutMenu.displayName = "FlyoutMenu"
