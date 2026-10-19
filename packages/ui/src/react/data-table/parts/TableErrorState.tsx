import { X } from "lucide-react"
import { Button } from "../../ui/button"
import { InlineError } from "../../feedback/InlineError"
import type { TableErrorStateProps } from "../../../core/table/types"
import { cn } from "../../../core/cn"

/**
 * TableErrorState component displayed when data loading fails
 */
export function TableErrorState({
  onRetry,
  message,
  className,
  classNames,
  iconClassName,
  contentClassName,
  retryClassName,
}: TableErrorStateProps): React.ReactElement {
  return (
    <div className={cn("w-full rounded-lg border bg-card p-6", className)}>
      <div className="flex flex-col items-center gap-4 text-center">
        <div
          className={cn(
            "rounded-full bg-destructive/10 p-3 text-destructive",
            iconClassName
          )}
        >
          <X size={24} />
        </div>
        <div className={cn("w-full max-w-md", contentClassName)}>
          <InlineError
            message={
              message ??
              "There was a problem fetching the requested data. Please try again."
            }
            classNames={classNames}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          className={retryClassName}
        >
          Retry
        </Button>
      </div>
    </div>
  )
}
