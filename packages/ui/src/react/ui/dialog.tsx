import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "../../core/cn"
import { Button } from "./button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  onClick,
  ...props
}: DialogPrimitive.Backdrop.Props & {
  onClick?: React.MouseEventHandler<HTMLDivElement>
}) {
  return (
    <DialogPrimitive.Backdrop
      forceRender
      data-slot="dialog-overlay"
      // forceRender: base-ui suppresses nested dialog scrims by default.
      // A dialog opened over a sheet still needs its own dim layer,
      // otherwise the sheet behind stays fully bright.
      // forceRender
      className={cn(
        "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 bg-overlay-heavy supports-backdrop-filter:backdrop-blur-md duration-200 fixed inset-0 z-dialog-overlay cursor-pointer",
        className
      )}
      onClick={onClick}
      onPointerDown={(e) => {
        // Prevent the event from reaching document-level listeners
        // so that parent sheets/dialogs don't treat this as an
        // "outside" interaction and close themselves.
        e.stopPropagation()
        if (e.target === e.currentTarget && onClick) {
          onClick(e)
        }
      }}
      {...props}
    />
  )
}

function DialogContent({
  className,
  overlayClassName,
  onOverlayClick,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** Optional extra classes for the dim/blur backdrop (defaults preserved). */
  overlayClassName?: string
  onOverlayClick?: React.MouseEventHandler<HTMLDivElement>
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} onClick={onOverlayClick} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "bg-background data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 grid max-w-[calc(100%-2rem)] gap-6 rounded-xl p-6 text-sm ring-1 duration-100 sm:max-w-md fixed top-1/2 left-1/2 z-critical w-full -translate-x-1/2 -translate-y-1/2 outline-none shadow-2xl",
          className
        )}
        {...props}
        // Stop propagation so parent sheets/dialogs don't close
        // when the user interacts inside this popup (e.g. close button).
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("gap-2 flex flex-col", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "gap-2 flex flex-col-reverse sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
