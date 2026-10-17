import { CircleAlert } from "lucide-react"
import type { FieldErrorsProps } from "../../core/form/types"

/**
 * Display field validation errors, each prefixed with a danger-colored
 * alert icon so errors read as errors without parsing the text.
 */
export function FieldErrors({
  errors,
  testId,
}: FieldErrorsProps): React.ReactElement | null {
  if (!errors.length) return null

  return (
    <div className="mt-1 space-y-1" data-testid={testId}>
      {errors.map((error, index) => (
        <p
          key={`${error}-${index}`}
          className="flex items-start gap-1.5 text-sm text-destructive"
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
