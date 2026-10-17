"use client"

import { useCallback, useEffect, useRef } from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../core/cn"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "gap-2 group/tabs flex data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "rounded-lg p-[3px] group-data-horizontal/tabs:h-9 data-[variant=line]:rounded-none group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  onClickCapture,
  onKeyDownCapture,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the selected tab visible in the scrollable bar (narrow screens):
  // `[role="tab"][aria-selected]` is standard ARIA, independent of the
  // underlying tab library's data attributes.
  const scrollActiveIntoView = useCallback((smooth: boolean) => {
    const active = listRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]'
    )
    // Guarded: jsdom and SSR have no `scrollIntoView`.
    active?.scrollIntoView?.({
      behavior: smooth ? "smooth" : "auto",
      inline: "nearest",
      block: "nearest",
    })
  }, [])

  // Mount only: deep links (`?tab=contents`) must land on a visible tab.
  useEffect(() => {
    scrollActiveIntoView(false)
  }, [scrollActiveIntoView])

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      ref={listRef}
      onClickCapture={(event) => {
        onClickCapture?.(event)
        requestAnimationFrame(() => scrollActiveIntoView(true))
      }}
      onKeyDownCapture={(event) => {
        onKeyDownCapture?.(event)
        if (
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "Home" ||
          event.key === "End"
        ) {
          requestAnimationFrame(() => scrollActiveIntoView(true))
        }
      }}
      className={cn(
        tabsListVariants({ variant }),
        // Scrollable tab bar: full-width with a thin horizontal scrollbar on
        // narrow screens (the pill keeps `w-fit` from sm up). `justify-start`
        // is load-bearing here: with `justify-center`, overflowing content
        // spills past BOTH edges and the first tab is cut off unreachable at
        // scroll 0. `overflow-y` stays hidden: the triggers' `::after`
        // underline sits 5px below the list edge and would otherwise force a
        // vertical scrollbar. `whitespace-nowrap` triggers live on the tabs
        // themselves.
        "max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain w-full justify-start sm:w-fit sm:justify-center",
        "[scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center whitespace-nowrap transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // Project theme logic: the active tab wears the same solid pill as an
        // active sidebar item (`menuItemBaseClasses.active`) —
        // `bg-sidebar-primary` + `sidebar-primary-foreground` in both modes.
        // Both the plain and `dark:`-stacked chains are declared because the
        // base `dark:text-muted-foreground` / `hover:text-foreground` ties
        // with a lone `data-active:` selector and would otherwise win by
        // stylesheet order.
        "data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:font-medium data-active:hover:bg-sidebar-primary/90 data-active:hover:text-sidebar-primary-foreground data-active:shadow-sm dark:data-active:bg-sidebar-primary dark:data-active:text-sidebar-primary-foreground dark:data-active:hover:bg-sidebar-primary/90 dark:data-active:hover:text-sidebar-primary-foreground",
        "after:bg-foreground after:absolute after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("text-sm flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
