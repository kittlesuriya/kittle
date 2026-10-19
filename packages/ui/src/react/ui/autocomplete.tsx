import * as React from "react"
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete"
import { CheckIcon } from "lucide-react"
import { cn } from "../../core/cn"
import { toDisplayString } from "../../core/format/toDisplayString"

export interface AutocompleteClassNames {
  control?: string
  input?: string
  trigger?: string
  content?: string
  list?: string
  item?: string
  group?: string
  groupLabel?: string
  empty?: string
  itemLabel?: string
  itemIndicator?: string
}

export interface AutocompleteItem {
  label?: string
  value?: string | number
  disabled?: boolean
  [key: string]: unknown
}

interface AutocompleteContextValue {
  placeholder?: string
  disabled?: boolean
  items: AutocompleteItem[]
  classNames?: AutocompleteClassNames
}

const AutocompleteContext = React.createContext<AutocompleteContextValue>({
  placeholder: undefined,
  disabled: false,
  items: [],
})

export function defaultFilter(item: AutocompleteItem, query: string): boolean {
  if (!query) return true
  const label = item.label ?? toDisplayString(item.value)
  return label.toLowerCase().includes(query.toLowerCase())
}

type AutocompleteRootProps = React.ComponentPropsWithoutRef<
  typeof AutocompletePrimitive.Root
>

export interface AutocompleteProps extends Omit<
  AutocompleteRootProps,
  "items" | "value" | "onValueChange" | "defaultValue" | "filter"
> {
  children: React.ReactNode
  placeholder?: string
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  value?: AutocompleteItem | string | number | null
  onValueChange?: (value: AutocompleteItem | string | number | null) => void
  defaultValue?: AutocompleteItem | string | number | null
  items?: AutocompleteItem[]
  filter?: (item: AutocompleteItem, query: string) => boolean
  classNames?: AutocompleteClassNames
}

export function Autocomplete({
  children,
  placeholder,
  disabled,
  open,
  onOpenChange,
  value,
  onValueChange,
  defaultValue,
  items = [],
  filter = defaultFilter,
  classNames,
  ...props
}: AutocompleteProps): React.ReactElement {
  return (
    <AutocompleteContext.Provider
      value={{ placeholder, disabled, items, classNames }}
    >
      <AutocompletePrimitive.Root
        open={open}
        onOpenChange={onOpenChange}
        value={value as AutocompleteRootProps["value"]}
        onValueChange={onValueChange}
        defaultValue={defaultValue as AutocompleteRootProps["defaultValue"]}
        disabled={disabled}
        items={items}
        filter={filter as AutocompleteRootProps["filter"]}
        {...props}
      >
        {children}
      </AutocompletePrimitive.Root>
    </AutocompleteContext.Provider>
  )
}

export function AutocompleteTrigger({
  className,
  id,
  ...props
}: AutocompletePrimitive.Input.Props): React.ReactElement {
  const { placeholder, disabled, classNames } =
    React.useContext(AutocompleteContext)
  return (
    <div
      className={cn("relative flex items-center w-full", classNames?.control)}
      data-slot="autocomplete-control"
    >
      <AutocompletePrimitive.Input
        id={id}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "border-input placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] aria-invalid:ring-[3px] disabled:pointer-events-none disabled:opacity-50 pr-8",
          classNames?.input,
          className
        )}
        {...props}
      />
      <AutocompletePrimitive.Trigger
        className={cn(
          "text-muted-foreground hover:text-foreground absolute right-2 flex size-4 items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-50",
          classNames?.trigger
        )}
      />
    </div>
  )
}

export function AutocompleteContent({
  className,
  children,
  side = "bottom",
  sideOffset = 8,
  align = "start",
  alignOffset = 0,
  ...props
}: AutocompletePrimitive.Popup.Props &
  Pick<
    AutocompletePrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >): React.ReactElement {
  const { classNames } = React.useContext(AutocompleteContext)
  return (
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="z-critical"
      >
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-content"
          className={cn(
            "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 min-w-40 rounded-md shadow-md ring-1 duration-100 relative isolate z-critical max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-hidden",
            classNames?.content,
            className
          )}
          {...props}
        >
          {children}
        </AutocompletePrimitive.Popup>
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  )
}

export function AutocompleteList({
  className,
  renderItem,
  ...props
}: AutocompletePrimitive.List.Props & {
  renderItem?: (item: AutocompleteItem) => React.ReactNode
}): React.ReactElement {
  const { classNames: slots } = React.useContext(AutocompleteContext)
  return (
    <AutocompletePrimitive.List
      data-slot="autocomplete-list"
      className={cn(
        "p-1 overflow-y-auto max-h-[var(--available-height,300px)] overscroll-contain flex flex-col",
        slots?.list,
        className
      )}
      {...props}
    >
      {(item: AutocompleteItem) => {
        const label = item.label ?? toDisplayString(item.value)
        const itemValue = item.value ?? label
        const isDisabled = Boolean(item.disabled)

        if (renderItem) {
          return renderItem(item)
        }

        return (
          <AutocompletePrimitive.Item
            key={String(itemValue)}
            value={item}
            disabled={isDisabled}
            data-slot="autocomplete-item"
            className={cn(
              "focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 transition-colors group",
              slots?.item
            )}
          >
            <span
              className={cn("flex-1 flex items-center gap-2", slots?.itemLabel)}
            >
              {label}
            </span>
            <CheckIcon
              className={cn(
                "size-4 absolute right-2 opacity-0 group-data-[selected]:opacity-100 transition-opacity",
                slots?.itemIndicator
              )}
            />
          </AutocompletePrimitive.Item>
        )
      }}
    </AutocompletePrimitive.List>
  )
}

export function AutocompleteItem({
  className,
  children,
  value,
  ...props
}: AutocompletePrimitive.Item.Props): React.ReactElement {
  const { classNames: slots } = React.useContext(AutocompleteContext)
  return (
    <AutocompletePrimitive.Item
      value={value as string | number}
      data-slot="autocomplete-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 transition-colors group",
        slots?.item,
        className
      )}
      {...props}
    >
      <span className={cn("flex-1 flex items-center gap-2", slots?.itemLabel)}>
        {children}
      </span>
      <CheckIcon
        className={cn(
          "size-4 absolute right-2 opacity-0 group-data-[selected]:opacity-100 transition-opacity",
          slots?.itemIndicator
        )}
      />
    </AutocompletePrimitive.Item>
  )
}

export function AutocompleteEmpty({
  className,
  children,
  ...props
}: AutocompletePrimitive.Empty.Props): React.ReactElement {
  const { classNames: slots } = React.useContext(AutocompleteContext)
  return (
    <AutocompletePrimitive.Empty
      data-slot="autocomplete-empty"
      className={cn(
        "text-muted-foreground text-center text-sm empty:hidden empty:m-0 empty:p-0 py-6",
        slots?.empty,
        className
      )}
      {...props}
    >
      {children}
    </AutocompletePrimitive.Empty>
  )
}

interface AutocompleteGroupProps extends AutocompletePrimitive.Group.Props {
  heading?: string
}

export function AutocompleteGroup({
  className,
  heading,
  children,
  ...props
}: AutocompleteGroupProps): React.ReactElement {
  const { classNames: slots } = React.useContext(AutocompleteContext)
  return (
    <AutocompletePrimitive.Group
      data-slot="autocomplete-group"
      className={cn("overflow-hidden p-1", slots?.group, className)}
      {...props}
    >
      {heading && (
        <AutocompletePrimitive.GroupLabel
          data-slot="autocomplete-group-label"
          className={cn(
            "text-muted-foreground px-2 py-1.5 text-xs font-medium",
            slots?.groupLabel
          )}
        >
          {heading}
        </AutocompletePrimitive.GroupLabel>
      )}
      {children}
    </AutocompletePrimitive.Group>
  )
}

export function AutocompleteSeparator({
  className,
  ...props
}: AutocompletePrimitive.Separator.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.Separator
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}
