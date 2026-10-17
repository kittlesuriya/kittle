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
}: OrganizationSwitcherProps): React.ReactElement {
  return (
    <button
      type="button"
      className={cn(
        `w-full flex items-center gap-3 p-2 ${RADIUS.md}`,
        "bg-sidebar-accent hover:bg-sidebar-accent/80 transition-colors",
        "text-sidebar-foreground",
        className
      )}
    >
      <div
        className={`flex items-center justify-center w-8 h-8 ${RADIUS.md} bg-sidebar-primary/20`}
      >
        <Building2 size={16} className="text-sidebar-primary" />
      </div>
      <div className="flex-1 text-left">
        <p className="text-sm font-medium truncate">Organization</p>
        <p className="text-xs text-muted-foreground truncate">
          Select organization
        </p>
      </div>
      <ChevronDown size={16} className="text-muted-foreground" />
    </button>
  )
}
