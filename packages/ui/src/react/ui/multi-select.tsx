"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import {
  CheckIcon,
  ChevronDownIcon,
  MinusIcon,
  SearchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "../../core/cn"
import { Badge } from "./badge"
import { MarqueeText } from "./marquee-text"
import { cascadeToggle, partialSelected } from "./treeSelection"

export interface MultiSelectOption {
  label: string
  value: string | number
  disabled?: boolean
  icon?: LucideIcon
  /**
   * Tree depth for hierarchical option lists (0 = top). The row indents
   * 14px per level so parents read apart from children. Ignored elsewhere
   * (chips, counts) — purely a list affordance.
   */
  depth?: number
  style?: {
    badgeColor?: string
    gradient?: string
    iconColor?: string
  }
  [key: string]: unknown
}

export interface MultiSelectGroup {
  heading: string
  options: MultiSelectOption[]
}

export type MultiSelectValue = Array<MultiSelectOption["value"]>

export interface MultiSelectHandle {
  reset: () => void
  getSelectedValues: () => MultiSelectValue
  setSelectedValues: (values: MultiSelectValue) => void
  clear: () => void
  focus: () => void
}

export interface MultiSelectProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "defaultValue" | "value" | "onChange"
> {
  options: MultiSelectOption[] | MultiSelectGroup[]
  value?: MultiSelectValue
  defaultValue?: MultiSelectValue
  onValueChange: (value: MultiSelectValue) => void
  placeholder?: string
  searchPlaceholder?: string
  maxCount?: number
  disabled?: boolean
  className?: string
  popoverClassName?: string
  hideSelectAll?: boolean
  searchable?: boolean
  emptyIndicator?: string
  singleSelect?: boolean
  closeOnSelect?: boolean
  resetOnDefaultValueChange?: boolean
  deduplicateOptions?: boolean
  variant?: "default" | "secondary" | "destructive" | "inverted"
  autoSize?: boolean
  singleLine?: boolean
  minWidth?: string
  maxWidth?: string
  responsive?: unknown
  modalPopover?: boolean
  /**
   * Tree cascade (opt-in): given a value, return ALL of its descendant
   * values in display order. Toggling a parent then selects/deselects the
   * whole subtree; a parent with a partially selected subtree renders an
   * indeterminate mark. Absent = flat toggle, exactly as before.
   */
  getDescendantValues?: (value: string | number) => Array<string | number>
}

export const MultiSelect = React.forwardRef<
  MultiSelectHandle,
  MultiSelectProps
>(
  (
    {
      options,
      value,
      defaultValue = [],
      onValueChange,
      placeholder = "Select options...",
      searchPlaceholder = "Search options...",
      maxCount = 2,
      disabled = false,
      className,
      popoverClassName,
      hideSelectAll = false,
      searchable = true,
      emptyIndicator = "No options found.",
      singleSelect = false,
      closeOnSelect,
      resetOnDefaultValueChange = true,
      deduplicateOptions = false,
      minWidth,
      maxWidth,
      autoSize = false,
      getDescendantValues,
    },
    ref
  ) => {
    const [uncontrolledValue, setUncontrolledValue] =
      React.useState<MultiSelectValue>(
        singleSelect ? defaultValue.slice(0, 1) : defaultValue
      )
    const [searchQuery, setSearchQuery] = React.useState("")
    const [open, setOpen] = React.useState(false)
    const buttonRef = React.useRef<HTMLButtonElement | null>(null)

    const isControlled = value !== undefined
    const selectedValues = React.useMemo(() => {
      const raw = isControlled ? (value ?? []) : uncontrolledValue
      return singleSelect ? raw.slice(0, 1) : raw
    }, [isControlled, value, uncontrolledValue, singleSelect])

    const isGroupedOptions = React.useCallback(
      (
        opts: MultiSelectOption[] | MultiSelectGroup[]
      ): opts is MultiSelectGroup[] => {
        const first = opts[0]
        if (!first) return false
        return "heading" in first
      },
      []
    )

    const flatOptions = React.useMemo(() => {
      if (options.length === 0) return [] as MultiSelectOption[]
      let raw: MultiSelectOption[]
      if (isGroupedOptions(options)) {
        raw = options.flatMap((g) => g.options)
      } else {
        raw = options
      }

      if (!deduplicateOptions) return raw
      const seen = new Set<string>()
      return raw.filter((opt) => {
        const key = String(opt.value)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }, [options, deduplicateOptions, isGroupedOptions])

    const prevDefaultRef = React.useRef(defaultValue)
    React.useEffect(() => {
      if (!resetOnDefaultValueChange) return
      const prev = prevDefaultRef.current
      const current = defaultValue
      const isDifferent =
        prev.length !== current.length ||
        prev.some((v, i) => String(v) !== String(current[i]))
      if (isDifferent) {
        prevDefaultRef.current = current
        if (!isControlled) {
          setUncontrolledValue(singleSelect ? current.slice(0, 1) : current)
        }
      }
    }, [defaultValue, isControlled, resetOnDefaultValueChange, singleSelect])

    const handleValueChange = React.useCallback(
      (next: MultiSelectValue) => {
        // Tree cascade lives in `./treeSelection` (pinned by its tests):
        // `next` differs from `selectedValues` by exactly the toggled value
        // (Base-UI toggles one item per interaction), so the diff expands a
        // check to the whole subtree or drops a broken one.
        const finalValues =
          !singleSelect && getDescendantValues
            ? cascadeToggle(selectedValues, next, getDescendantValues)
            : singleSelect
              ? next.slice(-1)
              : next
        if (!isControlled) {
          setUncontrolledValue(finalValues)
        }
        onValueChange(finalValues)

        if (singleSelect && closeOnSelect !== false) {
          setOpen(false)
        } else if (closeOnSelect === true) {
          setOpen(false)
        }
      },
      [
        isControlled,
        onValueChange,
        singleSelect,
        closeOnSelect,
        selectedValues,
        getDescendantValues,
      ]
    )

    const handleRemoveValue = React.useCallback(
      (valToRemove: MultiSelectOption["value"]) => {
        const next = selectedValues.filter(
          (v) => String(v) !== String(valToRemove)
        )
        handleValueChange(next)
      },
      [selectedValues, handleValueChange]
    )

    const handleClearAll = React.useCallback(() => {
      handleValueChange([])
    }, [handleValueChange])

    const activeSelectableOptions = React.useMemo(
      () => flatOptions.filter((opt) => !opt.disabled),
      [flatOptions]
    )

    const isAllSelected = React.useMemo(() => {
      if (activeSelectableOptions.length === 0) return false
      const selectedSet = new Set(selectedValues.map(String))
      return activeSelectableOptions.every((opt) =>
        selectedSet.has(String(opt.value))
      )
    }, [activeSelectableOptions, selectedValues])

    const handleToggleAll = React.useCallback(() => {
      if (isAllSelected) {
        handleValueChange([])
      } else {
        const allValues = activeSelectableOptions.map((opt) => opt.value)
        handleValueChange(allValues)
      }
    }, [isAllSelected, activeSelectableOptions, handleValueChange])

    const filteredOptionsOrGroups = React.useMemo(() => {
      const q = searchQuery.toLowerCase().trim()
      if (!searchable || !q) return options

      if (isGroupedOptions(options)) {
        return options
          .map((g) => ({
            ...g,
            options: g.options.filter(
              (opt) =>
                opt.label.toLowerCase().includes(q) ||
                String(opt.value).toLowerCase().includes(q)
            ),
          }))
          .filter((g) => g.options.length > 0)
      }

      return options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(q) ||
          String(opt.value).toLowerCase().includes(q)
      )
    }, [options, searchQuery, searchable, isGroupedOptions])

    const getOption = React.useCallback(
      (val: MultiSelectOption["value"]) => {
        return flatOptions.find((opt) => String(opt.value) === String(val))
      },
      [flatOptions]
    )

    React.useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          handleValueChange(
            singleSelect ? defaultValue.slice(0, 1) : defaultValue
          )
          setOpen(false)
          setSearchQuery("")
        },
        getSelectedValues: () => selectedValues,
        setSelectedValues: (vals) => handleValueChange(vals),
        clear: handleClearAll,
        focus: () => {
          buttonRef.current?.focus()
        },
      }),
      [
        handleValueChange,
        selectedValues,
        handleClearAll,
        defaultValue,
        singleSelect,
      ]
    )

    // Partial (indeterminate) marks for cascade mode — see `treeSelection`.
    const partialValues = React.useMemo(() => {
      if (!getDescendantValues) return new Set<string>()
      return partialSelected(
        selectedValues,
        flatOptions.map((opt) => opt.value),
        getDescendantValues
      )
    }, [flatOptions, selectedValues, getDescendantValues])

    const hasAnyOptions = React.useMemo(() => {
      if (isGroupedOptions(filteredOptionsOrGroups)) {
        return filteredOptionsOrGroups.some((g) => g.options.length > 0)
      }
      return filteredOptionsOrGroups.length > 0
    }, [filteredOptionsOrGroups, isGroupedOptions])

    return (
      <ComboboxPrimitive.Root<string | number, true>
        multiple
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) {
            setSearchQuery("")
          }
        }}
        value={selectedValues}
        onValueChange={(nextValues) => {
          handleValueChange(nextValues ?? [])
        }}
        isItemEqualToValue={(itemVal, currentVal) =>
          String(itemVal) === String(currentVal)
        }
      >
        <ComboboxPrimitive.Trigger
          ref={buttonRef}
          disabled={disabled}
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 gap-1.5 rounded-md border bg-transparent min-h-8 h-auto py-0 pr-2.5 pl-2.5 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-[3px] aria-invalid:ring-[3px] flex items-center justify-between outline-none disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer",
            autoSize ? "w-auto" : "w-full",
            className
          )}
          style={{
            minWidth: minWidth ?? "auto",
            maxWidth: maxWidth ?? "100%",
          }}
        >
          <div className="flex flex-1 flex-wrap items-center gap-1 min-w-0 pr-1 text-left py-1">
            {selectedValues.length === 0 ? (
              <span className="text-muted-foreground text-sm truncate">
                {placeholder}
              </span>
            ) : singleSelect ? (
              <span className="text-foreground text-sm truncate">
                {getOption(selectedValues[0] ?? "")?.label ??
                  String(selectedValues[0] ?? "")}
              </span>
            ) : (
              <>
                {selectedValues.slice(0, maxCount).map((val) => {
                  const opt = getOption(val)
                  const IconComp = opt?.icon
                  return (
                    <Badge
                      key={String(val)}
                      variant="default"
                      className="text-xs px-2 py-0.5 font-normal flex items-center gap-1.5 max-w-[160px] truncate bg-primary text-primary-foreground border-transparent"
                    >
                      {IconComp && (
                        <IconComp
                          className="h-3 w-3 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">
                        {opt?.label ?? String(val)}
                      </span>
                      {!disabled && (
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={`Remove ${opt?.label ?? String(val)}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            handleRemoveValue(val)
                          }}
                          className="inline-flex size-3.5 items-center justify-center rounded-full text-primary-foreground/75 hover:text-primary-foreground hover:bg-primary-foreground/20 active:scale-95 cursor-pointer transition-colors -mr-0.5"
                        >
                          <XIcon className="size-2.5 stroke-[2.5]" />
                        </span>
                      )}
                    </Badge>
                  )
                })}
                {selectedValues.length > maxCount && (
                  <Badge
                    variant="outline"
                    className="text-xs px-1.5 py-0.5 font-normal"
                  >
                    +{selectedValues.length - maxCount} more
                  </Badge>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
            {selectedValues.length > 0 && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear all"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  handleClearAll()
                }}
                className="hover:text-foreground hover:bg-muted p-0.5 rounded-sm cursor-pointer transition-colors inline-flex items-center justify-center"
                title="Clear all"
              >
                <XIcon className="size-3.5" />
              </span>
            )}
            <ChevronDownIcon className="size-4 pointer-events-none" />
          </div>
        </ComboboxPrimitive.Trigger>

        <ComboboxPrimitive.Portal>
          <ComboboxPrimitive.Positioner
            side="bottom"
            align="start"
            sideOffset={4}
            className="isolate z-critical"
          >
            <ComboboxPrimitive.Popup
              data-slot="combobox-popup"
              className={cn(
                "bg-popover text-popover-foreground ring-foreground/10 min-w-[200px] w-(--anchor-width) max-w-(--available-width) rounded-md p-1 shadow-md ring-1 duration-100 z-critical isolate overflow-hidden outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                popoverClassName
              )}
            >
              {searchable && (
                <div className="p-1 pb-1.5 border-b border-border/60">
                  <div className="flex items-center gap-2 px-2.5 h-8 rounded-md bg-input/30 border border-input/30">
                    <SearchIcon className="size-4 text-muted-foreground shrink-0" />
                    <ComboboxPrimitive.Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={searchPlaceholder}
                      className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setSearchQuery("")}
                        className="text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {!hideSelectAll && !searchQuery && !singleSelect && (
                <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground border-b border-border/40">
                  <button
                    type="button"
                    onClick={handleToggleAll}
                    className="hover:text-foreground font-medium cursor-pointer"
                  >
                    {isAllSelected ? "Deselect all" : "Select all"}
                  </button>
                  {selectedValues.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="hover:text-destructive cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              <ComboboxPrimitive.List className="max-h-60 overflow-y-auto p-1 space-y-0.5 outline-none">
                {!hasAnyOptions ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {emptyIndicator}
                  </div>
                ) : isGroupedOptions(filteredOptionsOrGroups) ? (
                  filteredOptionsOrGroups.map((group) => (
                    <ComboboxPrimitive.Group key={group.heading}>
                      <ComboboxPrimitive.GroupLabel className="px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        {group.heading}
                      </ComboboxPrimitive.GroupLabel>
                      {group.options.map((option) => (
                        <OptionItem
                          key={String(option.value)}
                          option={option}
                          partial={partialValues.has(String(option.value))}
                        />
                      ))}
                    </ComboboxPrimitive.Group>
                  ))
                ) : (
                  filteredOptionsOrGroups.map((option) => (
                    <OptionItem
                      key={String(option.value)}
                      option={option}
                      partial={partialValues.has(String(option.value))}
                    />
                  ))
                )}
              </ComboboxPrimitive.List>
            </ComboboxPrimitive.Popup>
          </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
      </ComboboxPrimitive.Root>
    )
  }
)

MultiSelect.displayName = "MultiSelect"

/**
 * Memoized: option objects keep identity through search filtering (same
 * element refs), so typing in the picker skips every untouched row instead of
 * re-rendering + re-measuring all of them. `partial` is a plain boolean.
 */
const OptionItem = React.memo(function OptionItem({
  option,
  partial = false,
}: {
  option: MultiSelectOption
  partial?: boolean
}) {
  const IconComp = option.icon
  return (
    <ComboboxPrimitive.Item
      value={option.value}
      disabled={option.disabled}
      className="group focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary data-[selected=true]:font-medium gap-2 rounded-sm py-1.5 pr-8 pl-2.5 text-sm relative flex w-full cursor-pointer items-center outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
      style={
        option.depth
          ? { paddingLeft: `${10 + option.depth * 14}px` }
          : undefined
      }
    >
      {IconComp && (
        <IconComp
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      )}
      {/* Long labels loop on hover/highlight via the shared marquee (same as
          row-action and sidebar labels); `group` on the item drives the
          `:hover` trigger, `data-highlighted` drives keyboard navigation.
          `lazy` keeps hundred-row lists cheap: no observers or layout reads
          until first hover/focus intent (option objects keep identity through
          filtering, so memo below actually holds). */}
      <MarqueeText
        label={option.label}
        fallback="truncate"
        mode="lazy"
        className="text-sm"
      />
      {partial && (
        <span
          className="pointer-events-none absolute right-2 flex size-4 items-center justify-center text-primary"
          aria-hidden="true"
        >
          <MinusIcon className="size-4 stroke-[2.5]" />
        </span>
      )}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center text-primary" />
        }
      >
        <CheckIcon className="size-4 stroke-[2.5]" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
})
