import { TableProperties, Map } from "lucide-react"
import { Button } from "./button"
import { cn } from "../../core/cn"

export type ViewMode = "table" | "map"

interface ViewToggleProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  className?: string
}

export function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  return (
    <div className={cn("inline-flex rounded-md bg-muted p-1", className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 px-2.5 gap-1",
          value === "table" && "bg-background shadow-sm text-foreground"
        )}
        onClick={() => onChange("table")}
      >
        <TableProperties className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Table</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 px-2.5 gap-1",
          value === "map" && "bg-background shadow-sm text-foreground"
        )}
        onClick={() => onChange("map")}
      >
        <Map className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Map</span>
      </Button>
    </div>
  )
}
