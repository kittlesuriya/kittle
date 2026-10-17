import { Button } from "../ui/button"
import { Inbox, FolderOpen, Plus } from "lucide-react"

export function EmptyState({
  title,
  description,
  action,
  variant = "default",
}: {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  variant?: "default" | "search"
}) {
  const Icon = variant === "search" ? FolderOpen : Inbox

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="relative mb-6">
        <div className="size-20 rounded-full bg-muted flex items-center justify-center">
          <Icon className="size-10 text-muted-foreground/50" />
        </div>
        <div className="absolute inset-0 size-20 rounded-full bg-primary/5 animate-pulse" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      {description ? (
        <p className="text-muted-foreground text-sm max-w-sm text-center mb-6">
          {description}
        </p>
      ) : null}
      {action ? (
        <Button onClick={action.onClick} size="sm" className={"cursor-pointer"}>
          <Plus className="size-4 mr-2" /> {action.label}
        </Button>
      ) : null}
    </div>
  )
}
