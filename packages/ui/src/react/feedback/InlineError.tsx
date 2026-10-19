import { cn } from "../../core/cn"

export interface InlineErrorClassNames {
  root?: string
}
export interface InlineErrorProps {
  message: string
  className?: string
  classNames?: InlineErrorClassNames
}

export function InlineError({
  message,
  className,
  classNames,
}: InlineErrorProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className,
        classNames?.root
      )}
    >
      {message}
    </div>
  )
}
