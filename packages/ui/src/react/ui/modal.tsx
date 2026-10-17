import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react"
import { Dialog, DialogContent } from "./dialog"

interface ModalContextValue {
  open: (content: ReactNode) => void
  close: () => void
  depth: number
}

const ModalContext = createContext<ModalContextValue | null>(null)

export interface ModalProviderProps {
  children?: ReactNode
  /** Props forwarded to the underlying DialogContent (e.g. className). */
  contentProps?: ComponentProps<typeof DialogContent>
}

/**
 * Centralized portal-based modal gateway.
 *
 * Mount once inside the app (under i18n/theme providers) and open any
 * component through `useModal().open(<Node/>)`. The hook does not need to know
 * about the content — the provider simply renders the given node inside the
 * shared Dialog, which handles the overlay/backdrop and open/close lifecycle.
 */
export function ModalProvider({ children, contentProps }: ModalProviderProps) {
  const [stack, setStack] = useState<ReactNode[]>([])

  const open = useCallback((content: ReactNode) => {
    setStack((prev) => [...prev, content])
  }, [])

  const close = useCallback(() => {
    setStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev))
  }, [])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) close()
    },
    [close]
  )

  const value = useMemo(
    () => ({ open, close, depth: stack.length }),
    [open, close, stack.length]
  )

  const top = stack.length > 0 ? stack[stack.length - 1] : null

  return (
    <ModalContext.Provider value={value}>
      {children}
      <Dialog open={stack.length > 0} onOpenChange={handleOpenChange}>
        <DialogContent {...contentProps}>{top}</DialogContent>
      </Dialog>
    </ModalContext.Provider>
  )
}

/**
 * Access the open modal gateway.
 *
 * @example
 * const modal = useModal();
 */
export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext)
  if (!ctx) {
    throw new Error("useModal must be used within a <ModalProvider>")
  }
  return ctx
}

/**
 * Global modal stack depth. Returns 0 outside a provider so background
 * layers (sheets/dialogs) can safely subscribe without throwing.
 *
 * Sibling Base-UI roots do not nest, so a dismiss gesture on the top global
 * dialog (Escape, backdrop, close button) would otherwise also reach the
 * underlying sheet/dialog dismiss handler. Callers must ignore background
 * `onOpenChange(false)` while depth > 0.
 */
export function useModalDepth(): number {
  const ctx = useContext(ModalContext)
  return ctx?.depth ?? 0
}
