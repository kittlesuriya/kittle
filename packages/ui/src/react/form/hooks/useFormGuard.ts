import { useCallback, useEffect } from "react"

interface FormGuardOptions {
  enabled?: boolean
  message?: string
  onNavigate?: () => boolean | Promise<boolean>
}

/**
 * Prevent navigation when form has unsaved changes
 */
export function useFormGuard({
  enabled = false,
  message = "You have unsaved changes. Are you sure you want to leave?",
  onNavigate,
}: FormGuardOptions = {}): { confirmNavigation: () => Promise<boolean> } {
  useEffect(() => {
    if (!enabled) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = message
      return message
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [enabled, message])

  const confirmNavigation = useCallback(async () => {
    if (!enabled) return true

    if (onNavigate) {
      return await onNavigate()
    }

    return window.confirm(message)
  }, [enabled, message, onNavigate])

  return { confirmNavigation }
}
