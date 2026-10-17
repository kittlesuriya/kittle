import type { Row } from "@tanstack/react-table"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../ui/dropdown-menu"
import { MoreVertical } from "lucide-react"
import type { OperationsConfig } from "../../../core/table/types"
import type { DataTableFeatures } from "../../../core/table/features"
import { MarqueeText } from "../../ui/marquee-text"
import { getOperationColorClass, getOperationIcon } from "../operationIcons"
import { sortRowOperations } from "../../../core/table/rowOperationOrder"

interface RowWithId {
  id: string | number
  [key: string]: unknown
}

interface RowActionsProps<TData extends RowWithId> {
  row: Row<DataTableFeatures, TData>
  operations?: OperationsConfig<TData>
  onOperationClick: (operationType: string, rowData: TData) => void
}

export function RowActions<TData extends RowWithId>({
  row,
  operations,
  onOperationClick,
}: RowActionsProps<TData>): React.ReactElement | null {
  const data = row.original

  if (!operations) return null

  // Filter out 'add' (table-level) and any operations that shouldn't appear in row actions.
  // Then apply the canonical menu order (View -> Edit -> custom -> Delete last);
  // pages declare operations in whatever order suits them, so ordering is a
  // component-level rule, not a per-page convention.
  const rowLevelOperations = sortRowOperations(
    Object.entries(operations).filter(([key, operation]) => {
      if (key === "add") return false
      if (!operation) return false
      if (operation.isVisible && !operation.isVisible(data)) return false
      return true
    })
  )

  if (rowLevelOperations.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Row actions"
        className="cursor-pointer p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md"
      >
        <MoreVertical size={18} />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        aria-label="Row actions"
        align="end"
        className="min-w-48 max-w-72"
        style={{ minWidth: 192, maxWidth: 288 }}
      >
        {rowLevelOperations.map(([key, operation]) => {
          if (!operation) return null

          const Icon = operation.icon ?? getDefaultIcon(key)
          // Capitalize first letter if no label
          const label =
            operation.label ?? key.charAt(0).toUpperCase() + key.slice(1)
          const colorClass = operation.colorClass ?? getOperationColorClass(key)

          return (
            <DropdownMenuItem
              key={key}
              onClick={() => onOperationClick(key, data)}
              className={`flex items-center gap-2 cursor-pointer group ${colorClass}`}
            >
              {Icon && <span className="shrink-0 text-inherit">{Icon}</span>}
              <MarqueeText label={label} />
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getDefaultIcon(operationType: string): React.ReactNode {
  const OperationIcon = getOperationIcon(operationType)
  return OperationIcon ? <OperationIcon className="h-4 w-4" /> : null
}
