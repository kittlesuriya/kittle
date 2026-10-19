"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "../../core/cn"

export interface ScrollAreaClassNames {
  root?: string
  viewport?: string
  scrollbar?: string
  thumb?: string
  corner?: string
}

function ScrollArea({
  className,
  classNames,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & { classNames?: ScrollAreaClassNames }) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className, classNames?.root)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          classNames?.viewport
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar classNames={classNames} />
      <ScrollAreaPrimitive.Corner className={classNames?.corner} />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  classNames,
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props & {
  classNames?: Pick<ScrollAreaClassNames, "scrollbar" | "thumb">
}) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent flex touch-none p-px transition-colors select-none",
        className,
        classNames?.scrollbar
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          "rounded-full bg-border relative flex-1",
          classNames?.thumb
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
