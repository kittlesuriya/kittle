import { Button } from "../ui/button"
import { Inbox, FolderOpen, Plus } from "lucide-react"
import { cn } from "../../core/cn"

export interface EmptyStateClassNames {
  root?: string
  iconWrap?: string
  icon?: string
  pulse?: string
  title?: string
  description?: string
  action?: string
  iconBackground?: string
  actionIcon?: string
}
export interface EmptyStateProps {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  variant?: "default" | "search"
  className?: string
  classNames?: EmptyStateClassNames
}

export function EmptyState({
  title,
  description,
  action,
  variant = "default",
  className,
  classNames,
}: EmptyStateProps) {
  const Icon = variant === "search" ? FolderOpen : Inbox

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-4",
        className,
        classNames?.root
      )}
    >
      <div className={cn("relative mb-6", classNames?.iconWrap)}>
        <div
          className={cn(
            "size-20 rounded-full bg-muted flex items-center justify-center",
            classNames?.iconBackground
          )}
        >
          <Icon
            className={cn("size-10 text-muted-foreground/50", classNames?.icon)}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 size-20 rounded-full bg-primary/5 animate-pulse",
            classNames?.pulse
          )}
        />
      </div>
      <h3
        className={cn(
          "text-lg font-semibold text-foreground mb-2",
          classNames?.title
        )}
      >
        {title}
      </h3>
      {description ? (
        <p
          className={cn(
            "text-muted-foreground text-sm max-w-sm text-center mb-6",
            classNames?.description
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? (
        <Button
          onClick={action.onClick}
          size="sm"
          className={cn("cursor-pointer", classNames?.action)}
        >
          <Plus className={cn("size-4 mr-2", classNames?.actionIcon)} />{" "}
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
