import { X } from "lucide-react"
import { Button } from "../../ui/button"
import { InlineError } from "../../feedback/InlineError"
import type { TableErrorStateProps } from "../../../core/table/types"

/**
 * TableErrorState component displayed when data loading fails
 */
export function TableErrorState({
  onRetry,
  message,
}: TableErrorStateProps): React.ReactElement {
  return (
    <div className="w-full rounded-lg border bg-card p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-destructive/10 p-3 text-destructive">
          <X size={24} />
        </div>
        <div className="w-full max-w-md">
          <InlineError
            message={
              message ??
              "There was a problem fetching the requested data. Please try again."
            }
          />
        </div>
        <Button type="button" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  )
}
