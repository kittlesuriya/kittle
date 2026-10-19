import { RuntimeLink as Link } from "../../core/runtime"
import { cn } from "../../core/cn"
import type { SidebarHeaderProps } from "../../core/menu/types"
import { RADIUS } from "../../core/menu/constants"
import { useTranslation } from "react-i18next"

/**
 * SidebarHeader component with logo and title
 */
export function SidebarHeader({
  collapsed,
  logo,
  title = "App Name",
  subtitle,
  homeLink = "/",
  classNames,
}: SidebarHeaderProps): React.ReactElement {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        "border-b border-sidebar-border bg-sidebar h-[61px]",
        classNames?.header
      )}
    >
      {!collapsed && (
        <Link
          href={homeLink}
          className={cn(
            "flex items-center gap-3 px-4 py-3 hover:bg-sidebar-accent transition-colors",
            classNames?.headerLink
          )}
        >
          {logo ? (
            logo
          ) : (
            <div
              className={cn(
                `flex items-center justify-center w-8 h-8 ${RADIUS.md} bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm`,
                classNames?.headerLogo
              )}
            >
              {title.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex flex-col">
            <h2
              className={cn(
                "font-bold text-base text-sidebar-foreground leading-tight",
                classNames?.headerTitle
              )}
            >
              {title}
            </h2>
            <span
              className={cn(
                "text-[10px] text-sidebar-foreground/80",
                classNames?.headerSubtitle
              )}
            >
              {subtitle ??
                t(`sidebar.links.Dashboard`, { defaultValue: "Dashboard" })}
            </span>
          </div>
        </Link>
      )}

      {collapsed && (
        <Link
          href={homeLink}
          className={cn(
            "flex items-center justify-center py-3 hover:bg-sidebar-accent transition-colors",
            classNames?.headerLink
          )}
          title={title}
        >
          {logo ? (
            logo
          ) : (
            <div
              className={cn(
                `flex items-center justify-center w-8 h-8 ${RADIUS.md} bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm`,
                classNames?.headerLogo
              )}
            >
              {title.charAt(0).toUpperCase()}
            </div>
          )}
        </Link>
      )}
    </div>
  )
}
