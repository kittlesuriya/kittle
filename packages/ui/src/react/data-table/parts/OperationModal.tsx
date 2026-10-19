import { useCallback, useEffect, useId, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "../../ui/dialog"
import { Button } from "../../ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../../ui/sheet"
import type {
  BaseOperationConfig,
  DisplayMode,
  ModalType,
} from "../../../core/table/types"
import { getOperationIcon } from "../operationIcons"
import {
  OperationAnalyticsProvider,
  type OperationAnalyticsMeta,
} from "../../../core/table/operationAnalytics"
import { useModalDepth } from "../../ui/modal"
import { cn } from "../../../core/cn"

/**
 * Width classes for sheet/dialog sizing
 */
const WIDTH_CLASSES = {
  sm: "sm:!max-w-sm", // ~384px (fallback)
  md: "sm:!max-w-xl", // ~576px
  lg: "sm:!max-w-4xl", // ~896px
  xl: "sm:!max-w-6xl", // ~1152px
  wide: "sm:!max-w-[92vw] lg:!max-w-[84vw] xl:!max-w-[82vw] 2xl:!max-w-[78vw]",
  full: "!w-screen !max-w-none",
  detailSm: "w-full sm:!max-w-[420px] sm:!w-[420px]", // Small detail drawer 420px
  detailLg: "w-full sm:!max-w-[600px] sm:!w-[600px]", // Large detail drawer 600px
} as const

type WidthSize = keyof typeof WIDTH_CLASSES

interface OperationModalProps<TData> {
  open: boolean
  onOpenChange: (open: boolean) => void
  modalType: ModalType
  title: string
  operation?: BaseOperationConfig<TData>
  rowData: TData | null
  onExecute: (data?: TData) => void
  isLoading?: boolean
  displayMode?: DisplayMode
  width?: WidthSize
  analyticsMeta?: OperationAnalyticsMeta | null
  className?: string
  dialogClassNames?: import("../../ui/dialog").DialogContentClassNames
  sheetClassNames?: import("../../ui/sheet").SheetContentClassNames
  classNames?: import("../../../core/table/types").DataTableClassNames
}

const DEFAULT_DISPLAY_MODE: DisplayMode = "sheet"
const DEFAULT_WIDTH: WidthSize = "md"

export function OperationModal<TData>({
  open,
  onOpenChange,
  modalType,
  title,
  operation,
  rowData,
  onExecute,
  isLoading = false,
  displayMode = DEFAULT_DISPLAY_MODE,
  width,
  analyticsMeta,
  className,
  dialogClassNames,
  sheetClassNames,
  classNames,
}: OperationModalProps<TData>): React.ReactElement | null {
  const titleId = useId()

  useEffect(() => {
    if (open) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    }
  }, [open])

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange])

  // The global modal gateway renders as a sibling Base-UI root, so it does
  // not nest inside this sheet/dialog. A dismiss gesture on the top global
  // dialog (Escape, backdrop, close button) would otherwise also reach this
  // root's dismiss handler and close the underlying form. Ignore background
  // dismiss requests while any global modal is open; the top dialog closes
  // first and a subsequent gesture closes this layer.
  const globalModalDepth = useModalDepth()
  const handleRootOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && globalModalDepth > 0) return
      onOpenChange(nextOpen)
    },
    [globalModalDepth, onOpenChange]
  )

  if (!open || !modalType || !operation) return null

  const resolvedMode = displayMode ?? DEFAULT_DISPLAY_MODE
  const resolvedWidth = width ?? operation.width ?? DEFAULT_WIDTH
  const widthClass = WIDTH_CLASSES[resolvedWidth]
  const isSheetMode = resolvedMode === "sheet"
  const OperationComponent = operation.component
  const hasComponent = Boolean(OperationComponent)
  const needsConfirmation = Boolean(operation.confirmation)
  const titleText =
    typeof operation.modalTitle === "function"
      ? rowData
        ? operation.modalTitle(rowData)
        : ""
      : (operation.modalTitle ?? getOperationTitle(modalType, title))
  const descriptionText =
    typeof operation.modalDescription === "function"
      ? rowData
        ? operation.modalDescription(rowData)
        : ""
      : (operation.modalDescription ??
        getOperationDescription(modalType, title))

  const icon = operation.icon ?? getDefaultIcon(modalType)
  const confirmationMessage =
    operation.confirmation?.message || descriptionText || "Confirm this action."

  const renderDialog = (children: ReactNode) => (
    <Dialog open={open} onOpenChange={handleRootOpenChange}>
      <DialogContent
        aria-labelledby={titleId}
        className={cn(`max-w-2xl ${widthClass}`, className)}
        classNames={dialogClassNames}
      >
        {children}
      </DialogContent>
    </Dialog>
  )

  const renderSheet = (children: ReactNode) => (
    <Sheet open={open} onOpenChange={handleRootOpenChange}>
      <SheetContent
        side="right"
        showCloseButton
        aria-labelledby={titleId}
        className={cn(
          `w-full! ${widthClass} overflow-y-auto overflow-x-hidden p-0`,
          className
        )}
        classNames={sheetClassNames}
      >
        {children}
      </SheetContent>
    </Sheet>
  )

  const showDescription =
    !operation.confirmation?.message && Boolean(descriptionText)

  const dialogHeader = (
    <DialogHeader
      className={cn(
        "flex flex-row items-center gap-4 space-y-0 text-left",
        classNames?.operationModalHeader
      )}
    >
      {icon && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
      )}
      <div className="flex-1">
        <DialogTitle
          id={titleId}
          className={cn("text-lg font-bold", classNames?.operationModalTitle)}
        >
          {titleText}
        </DialogTitle>
        {showDescription && (
          <DialogDescription className={classNames?.operationModalDescription}>
            {descriptionText}
          </DialogDescription>
        )}
      </div>
    </DialogHeader>
  )

  const sheetHeader = (
    <SheetHeader
      className={cn(
        "flex flex-row items-center gap-4 space-y-0 text-left border-b pb-6 px-6 pt-6 shrink-0",
        classNames?.operationModalHeader
      )}
    >
      {icon && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
      )}
      <div className="flex-1">
        <SheetTitle
          id={titleId}
          className={cn("text-2xl font-bold", classNames?.operationModalTitle)}
        >
          {titleText}
        </SheetTitle>
        {showDescription && (
          <SheetDescription className={classNames?.operationModalDescription}>
            {descriptionText}
          </SheetDescription>
        )}
      </div>
    </SheetHeader>
  )

  const wrapWithAnalytics = (children: ReactNode) => (
    <OperationAnalyticsProvider value={analyticsMeta ?? null}>
      {children}
    </OperationAnalyticsProvider>
  )

  const confirmationBody = (confirmText: string, cancelText: string) => (
    <>
      {isSheetMode ? sheetHeader : dialogHeader}
      <div
        className={cn(
          "px-6 py-6 text-sm text-muted-foreground",
          classNames?.operationModalBody
        )}
      >
        <p>{confirmationMessage}</p>
      </div>
      {isSheetMode ? (
        <SheetFooter
          className={cn(
            "flex justify-end gap-2 px-6 py-4",
            classNames?.operationModalFooter
          )}
        >
          <Button
            className={classNames?.operationCancel}
            variant="secondary"
            type="button"
            onClick={handleClose}
          >
            {cancelText}
          </Button>
          <Button
            variant="destructive"
            className={classNames?.operationConfirm}
            type="button"
            onClick={() => onExecute(rowData ?? undefined)}
            disabled={isLoading}
          >
            {isLoading ? "Processing..." : confirmText}
          </Button>
        </SheetFooter>
      ) : (
        <DialogFooter className={classNames?.operationModalFooter}>
          <DialogClose
            render={
              <Button
                type="button"
                variant="secondary"
                className={classNames?.operationCancel}
              >
                {cancelText}
              </Button>
            }
          />
          <Button
            type="button"
            variant="destructive"
            className={classNames?.operationConfirm}
            onClick={() => onExecute(rowData ?? undefined)}
            disabled={isLoading}
          >
            {isLoading ? "Processing..." : confirmText}
          </Button>
        </DialogFooter>
      )}
    </>
  )

  if (hasComponent && OperationComponent) {
    const componentContent = (
      <>
        {isSheetMode ? sheetHeader : dialogHeader}
        <div
          className={cn(
            isSheetMode
              ? "flex-1 overflow-y-auto overflow-x-hidden px-6 py-6"
              : "p-6",
            classNames?.operationModalBody
          )}
        >
          <OperationComponent
            data={modalType === "add" ? undefined : (rowData ?? undefined)}
            onSuccess={handleClose}
            onCancel={handleClose}
          />
        </div>
      </>
    )

    return isSheetMode
      ? renderSheet(wrapWithAnalytics(componentContent))
      : renderDialog(wrapWithAnalytics(componentContent))
  }

  // Support API-based or handler-based operations with confirmation
  if (needsConfirmation && operation.confirmation) {
    const { confirmation } = operation
    return isSheetMode
      ? renderSheet(
          wrapWithAnalytics(
            confirmationBody(
              confirmation.confirmText ?? "Confirm",
              confirmation.cancelText ?? "Cancel"
            )
          )
        )
      : renderDialog(
          wrapWithAnalytics(
            confirmationBody(
              confirmation.confirmText ?? "Confirm",
              confirmation.cancelText ?? "Cancel"
            )
          )
        )
  }

  return null
}

function getOperationTitle(type: ModalType, entityTitle: string): string {
  switch (type) {
    case "add":
      return `Add ${entityTitle}`
    case "edit":
      return `Edit ${entityTitle}`
    case "view":
      return `View ${entityTitle}`
    case "delete":
      return `Delete ${entityTitle}`
    case "complete":
      return `Complete ${entityTitle}`
    case "dismiss":
      return `Dismiss ${entityTitle}`
    case "cancel":
      return `Cancel ${entityTitle}`
    default:
      return entityTitle
  }
}

function getOperationDescription(type: ModalType, entityTitle: string): string {
  switch (type) {
    case "add":
      return `Fill in the details to add a new ${entityTitle.toLowerCase()}.`
    case "edit":
      return `Make changes to this ${entityTitle.toLowerCase()}.`
    case "view":
      return `View details of this ${entityTitle.toLowerCase()}.`
    case "delete":
      return `Are you sure you want to delete this ${entityTitle.toLowerCase()}?`
    case "complete":
      return `Mark this ${entityTitle.toLowerCase()} as complete.`
    case "dismiss":
      return `Dismiss this ${entityTitle.toLowerCase()}.`
    case "cancel":
      return `Are you sure you want to cancel this ${entityTitle.toLowerCase()}?`
    default:
      return ""
  }
}

function getDefaultIcon(type: ModalType): ReactNode | undefined {
  // Shared with `RowActions` so the sheet header tile and the row-menu icon
  // can no longer disagree about an operation. `ModalType` also carries `null`
  // for an operation rendered without a key — that has no icon either.
  const OperationIcon = type ? getOperationIcon(type) : undefined
  return OperationIcon ? <OperationIcon className="h-5 w-5" /> : undefined
}
