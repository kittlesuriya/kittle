import type { OrganizationSwitcherProps } from "../../core/menu/types"
import { Building2, ChevronDown } from "lucide-react"
import { cn } from "../../core/cn"
import { RADIUS } from "../../core/menu/constants"

/**
 * OrganizationSwitcher placeholder component
 * TODO: Implement with actual organization context
 */
export function OrganizationSwitcher({
  className,
  classNames,
}: OrganizationSwitcherProps): React.ReactElement {
  return (
    <button
      type="button"
      className={cn(
        `w-full flex items-center gap-3 p-2 ${RADIUS.md}`,
        "bg-sidebar-accent hover:bg-sidebar-accent/80 transition-colors",
        "text-sidebar-foreground",
        className,
        classNames?.organizationSwitcher
      )}
    >
      <div
        className={cn(
          `flex items-center justify-center w-8 h-8 ${RADIUS.md} bg-sidebar-primary/20`,
          classNames?.organizationSwitcherIcon
        )}
      >
        <Building2 size={16} className="text-sidebar-primary" />
      </div>
      <div className="flex-1 text-left">
        <p
          className={cn(
            "text-sm font-medium truncate",
            classNames?.organizationSwitcherLabel
          )}
        >
          Organization
        </p>
        <p
          className={cn(
            "text-xs text-muted-foreground truncate",
            classNames?.organizationSwitcherDescription
          )}
        >
          Select organization
        </p>
      </div>
      <ChevronDown
        size={16}
        className={cn(
          "text-muted-foreground",
          classNames?.organizationSwitcherChevron
        )}
      />
    </button>
  )
}
