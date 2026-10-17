import { forwardRef } from "react"
import { Search, X } from "lucide-react"
import { cn } from "../../core/cn"
import { ARIA_LABELS, RADIUS } from "../../core/menu/constants"
import { useTranslation } from "react-i18next"
import type { SidebarSearchProps } from "../../core/menu/types"

/**
 * SidebarSearch component
 */
export const SidebarSearch = forwardRef<HTMLInputElement, SidebarSearchProps>(
  ({ value, onChange, className }, ref) => {
    const { t } = useTranslation()
    return (
      <div className={cn("px-3 pb-3", className)}>
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-foreground/80 pointer-events-none"
            size={16}
          />
          <input
            ref={ref}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t("sidebar.search_placeholder", {
              defaultValue: "Search... (Ctrl+/)",
            })}
            aria-label={ARIA_LABELS.searchInput}
            className={cn(
              "w-full pl-9 pr-9 py-2 text-sm",
              "bg-sidebar-accent border border-transparent",
              RADIUS.md,
              "text-sidebar-accent-foreground placeholder:text-sidebar-accent-foreground/80",
              "focus:outline-none focus:ring-2 focus:ring-sidebar-ring focus:ring-offset-0",
              "focus:bg-sidebar-accent focus:border-sidebar-border",
              "transition-all duration-200"
            )}
          />
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
              aria-label={ARIA_LABELS.clearSearch}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    )
  }
)

SidebarSearch.displayName = "SidebarSearch"
