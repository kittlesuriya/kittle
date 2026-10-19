import { CircleAlert } from "lucide-react"
import type { FieldErrorsProps } from "../../core/form/types"
import { cn } from "../../core/cn"

/**
 * Display field validation errors, each prefixed with a danger-colored
 * alert icon so errors read as errors without parsing the text.
 */
export function FieldErrors({
  errors,
  testId,
  className,
  rowClassName,
}: FieldErrorsProps): React.ReactElement | null {
  if (!errors.length) return null

  return (
    <div className={cn("mt-1 space-y-1", className)} data-testid={testId}>
      {errors.map((error, index) => (
        <p
          key={`${error}-${index}`}
          className={cn(
            "flex items-start gap-1.5 text-sm text-destructive",
            rowClassName
          )}
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
          />
          <span>{error}</span>
        </p>
      ))}
    </div>
  )
}
