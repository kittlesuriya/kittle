import type { LoadingOverlayProps } from "../../../core/form/types"

/**
 * Loading overlay for forms
 */
export function LoadingOverlay({
  visible,
  message,
}: LoadingOverlayProps): React.ReactElement | null {
  if (!visible) return null

  return (
    <div className="absolute inset-0 z-overlay flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-t-primary border-border rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">
          {message ?? "Loading..."}
        </p>
      </div>
    </div>
  )
}
