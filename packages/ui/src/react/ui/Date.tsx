import { cn } from "../../core/cn"
import { format as formatFns } from "date-fns"
import { parseDateInput } from "../../core/format/parseDateInput"
import { useUiRuntime } from "../../core/runtime"

interface DateProps {
  value: string | Date | null | undefined
  showTime?: boolean
  format?: string
  className?: string
}

export function Date({
  value,
  showTime,
  format: formatStr,
  className,
}: DateProps) {
  const { dateFnsPattern } = useUiRuntime().formatDate.useTenantDateFormatter()

  if (!value)
    return <span className={cn("text-muted-foreground", className)}>-</span>

  try {
    const date = parseDateInput(value)
    if (!date)
      return <span className={cn("text-muted-foreground", className)}>-</span>

    const fmt =
      formatStr ?? (showTime ? `${dateFnsPattern} HH:mm` : dateFnsPattern)
    return <span className={className}>{formatFns(date, fmt)}</span>
  } catch {
    return <span className={cn("text-muted-foreground", className)}>-</span>
  }
}
