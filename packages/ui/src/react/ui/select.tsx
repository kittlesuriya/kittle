"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "../../core/cn"
import { toDisplayString } from "../../core/format/toDisplayString"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

interface SelectContextValue {
  registerItem: (value: string | number, label: React.ReactNode) => () => void
  getItemLabel: (value: string | number) => React.ReactNode | undefined
}

const SelectInternalContext = React.createContext<SelectContextValue | null>(
  null
)

function extractTextFromReactNode(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractTextFromReactNode).join("")
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    return extractTextFromReactNode(props.children)
  }
  return ""
}

function collectLabelsFromChildren(
  node: React.ReactNode,
  acc: Map<string | number, React.ReactNode> = new Map()
): Map<string | number, React.ReactNode> {
  if (!node) return acc
  React.Children.forEach(node, (child) => {
    if (React.isValidElement(child)) {
      const p = child.props as {
        value?: string | number
        children?: React.ReactNode
      }
      if (p && p.value !== undefined && p.children !== undefined) {
        const txt = extractTextFromReactNode(p.children) || p.children
        acc.set(p.value, txt)
      }
      if (p && p.children) {
        collectLabelsFromChildren(p.children, acc)
      }
    }
  })
  return acc
}

type SelectItems =
  | Array<{ value: string | number; label: React.ReactNode }>
  | Record<string, React.ReactNode>

// Generic default mirrors `SelectPrimitive.Root` so untyped call sites work.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Select<Value = any, Multiple extends boolean | undefined = false>({
  children,
  items,
  ...props
}: Omit<SelectPrimitive.Root.Props<Value, Multiple>, "items"> & {
  items?: SelectItems
}) {
  const [itemLabels, setItemLabels] = React.useState<
    Map<string | number, React.ReactNode>
  >(() => {
    const initial = new Map<string | number, React.ReactNode>()
    if (items) {
      if (Array.isArray(items)) {
        for (const item of items) {
          if (
            item &&
            typeof item === "object" &&
            "value" in item &&
            "label" in item
          ) {
            initial.set(item.value, item.label)
          }
        }
      } else if (typeof items === "object") {
        for (const [k, v] of Object.entries(items)) {
          initial.set(k, v)
        }
      }
    }
    collectLabelsFromChildren(children, initial)
    return initial
  })

  const registerItem = React.useCallback(
    (val: string | number, label: React.ReactNode) => {
      setItemLabels((prev) => {
        if (prev.get(val) === label) return prev
        const next = new Map(prev)
        next.set(val, label)
        return next
      })
      return () => {
        // Keep label around even after unmounting/closing popup so SelectValue continues to display it
      }
    },
    []
  )

  const getItemLabel = React.useCallback(
    (val: string | number) => {
      return itemLabels.get(val)
    },
    [itemLabels]
  )

  const ctxValue = React.useMemo(
    () => ({ registerItem, getItemLabel }),
    [registerItem, getItemLabel]
  )

  // Keep scanning children if new items are conditionally rendered
  React.useEffect(() => {
    const scanned = collectLabelsFromChildren(children)
    if (scanned.size > 0) {
      setItemLabels((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [k, v] of scanned.entries()) {
          if (next.get(k) !== v) {
            next.set(k, v)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
  }, [children])

  return (
    <SelectInternalContext.Provider value={ctxValue}>
      <SelectPrimitive.Root items={items} {...props}>
        {children}
      </SelectPrimitive.Root>
    </SelectInternalContext.Provider>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  className,
  children,
  options,
  placeholder,
  ...props
}: SelectPrimitive.Value.Props & {
  options?: Record<string | number, React.ReactNode>
}) {
  const ctx = React.useContext(SelectInternalContext)

  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      placeholder={placeholder}
      {...props}
    >
      {children ??
        ((selected: unknown) => {
          if (selected == null || selected === "") {
            return placeholder ?? null
          }
          if (options && options[selected as string | number] != null) {
            return options[selected as string | number]
          }
          const registeredLabel = ctx?.getItemLabel(selected as string | number)
          if (registeredLabel != null) {
            return registeredLabel
          }
          return toDisplayString(selected)
        })}
    </SelectPrimitive.Value>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 gap-1.5 rounded-md border bg-transparent py-2 pr-2 pl-2.5 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-[3px] aria-invalid:ring-[3px] data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:flex *:data-[slot=select-value]:gap-1.5 [&_svg:not([class*='size-'])]:size-4 flex w-full items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="text-muted-foreground size-4 pointer-events-none" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = false,
  collisionAvoidance: _collisionAvoidance,
  hideScrollButtons = false,
  ...props
}: SelectPrimitive.Popup.Props &
  Partial<
    Pick<
      SelectPrimitive.Positioner.Props,
      | "align"
      | "alignOffset"
      | "side"
      | "sideOffset"
      | "alignItemWithTrigger"
      | "collisionAvoidance"
    >
  > & { hideScrollButtons?: boolean }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-critical"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 min-w-36 rounded-md shadow-md ring-1 duration-100 relative isolate z-critical max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto",
            className
          )}
          {...props}
        >
          {!hideScrollButtons && <SelectScrollUpButton />}
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          {!hideScrollButtons && <SelectScrollDownButton />}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  value,
  ...props
}: SelectPrimitive.Item.Props) {
  const ctx = React.useContext(SelectInternalContext)

  React.useEffect(() => {
    if (!ctx || value == null) return undefined
    const textLabel = extractTextFromReactNode(children) || children
    return ctx.registerItem(value as string | number, textLabel)
  }, [ctx, value, children])

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={value as string | number}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2 relative flex w-full cursor-default items-center outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 gap-2 shrink-0 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border -mx-1 my-1 h-px pointer-events-none", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "bg-popover z-sticky flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4 top-0 w-full",
        className
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bg-popover z-sticky flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4 bottom-0 w-full",
        className
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
