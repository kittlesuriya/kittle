import { Input } from "../../ui/input"
import { cn } from "../../../core/cn"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select"
import {
  operatorNeedsValue,
  operatorNeedsRange,
} from "../../../core/query/operatorConfig"
import { MultiSelect } from "../../ui/multi-select"
import { toDisplayString } from "../../../core/format/toDisplayString"
import type {
  FilterValue,
  RangeValue,
  ValueInputProps,
} from "../../../core/query/types"

/**
 * Value input component for query conditions
 */
export function ValueInput({
  field,
  operator,
  value,
  onChange,
  disabled,
  classNames,
  partClassNames,
}: ValueInputProps): React.ReactElement | null {
  if (!operatorNeedsValue(operator)) {
    return null
  }

  const isRange = operatorNeedsRange(operator)

  const normalizeRangeValue = (
    input: FilterValue
  ): { from: string; to: string } => {
    if (Array.isArray(input)) {
      const range = input as RangeValue
      return {
        from: range[0] ?? "",
        to: range[1] ?? "",
      }
    }

    if (
      input &&
      typeof input === "object" &&
      "from" in input &&
      "to" in input
    ) {
      const typed = input
      return {
        from: typed.from ?? "",
        to: typed.to ?? "",
      }
    }

    return { from: "", to: "" }
  }

  const handleRangeChange = (next: { from: string; to: string }) => {
    onChange({ from: next.from, to: next.to })
  }

  if (isRange) {
    const rangeValue = normalizeRangeValue(value)
    const inputType =
      field.type === "date"
        ? "date"
        : field.type === "time"
          ? "time"
          : field.type === "number"
            ? "number"
            : "text"

    return (
      <div
        className={cn(
          "flex w-full flex-col gap-2 sm:flex-row sm:items-center",
          classNames?.rangeWrapper
        )}
      >
        <Input
          type={inputType}
          value={rangeValue.from}
          onChange={(e) =>
            handleRangeChange({ ...rangeValue, from: e.target.value })
          }
          className={cn(
            "h-8 w-full",
            classNames?.rangeInput,
            classNames?.valueInput
          )}
          disabled={disabled}
        />
        <span
          className={cn("text-muted-foreground", classNames?.rangeSeparator)}
        >
          to
        </span>
        <Input
          type={inputType}
          value={rangeValue.to}
          onChange={(e) =>
            handleRangeChange({ ...rangeValue, to: e.target.value })
          }
          className={cn(
            "h-8 w-full",
            classNames?.rangeInput,
            classNames?.valueInput
          )}
          disabled={disabled}
        />
      </div>
    )
  }

  // Select field
  if (field.type === "select" && field.options) {
    return (
      <Select
        value={toDisplayString(value)}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn(
            "h-8 w-full sm:min-w-[120px]",
            classNames?.selectTrigger,
            partClassNames?.valueSelect?.trigger
          )}
        >
          <SelectValue placeholder="Select...">
            {
              field.options.find(
                (opt) => toDisplayString(opt.value) === toDisplayString(value)
              )?.label
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent className={partClassNames?.valueSelect?.content}>
          {field.options.map((opt) => (
            <SelectItem
              className={partClassNames?.valueSelect?.item}
              key={String(opt.value)}
              value={String(opt.value)}
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === "multiselect" && field.options) {
    const selected = Array.isArray(value) ? value : []
    return (
      <MultiSelect
        options={field.options}
        value={selected}
        onValueChange={(next) => onChange(next)}
        placeholder="Select options..."
        maxCount={2}
        disabled={disabled}
        className={cn(
          "w-full sm:min-w-[200px]",
          classNames?.multiSelect,
          partClassNames?.multiSelect?.trigger
        )}
        classNames={partClassNames?.multiSelect}
      />
    )
  }

  // Number field
  if (field.type === "number") {
    return (
      <Input
        type="number"
        value={toDisplayString(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Value..."
        className={cn("h-8 w-full sm:min-w-[100px]", classNames?.valueInput)}
        disabled={disabled}
      />
    )
  }

  // Date field
  if (field.type === "date") {
    return (
      <Input
        type="date"
        value={toDisplayString(value)}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 w-full", classNames?.valueInput)}
        disabled={disabled}
      />
    )
  }

  // Time field
  if (field.type === "time") {
    return (
      <Input
        type="time"
        value={toDisplayString(value)}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 w-full", classNames?.valueInput)}
        disabled={disabled}
      />
    )
  }

  // Default text field
  return (
    <Input
      type="text"
      value={toDisplayString(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Value..."
      className={cn("h-8 w-full sm:min-w-[120px]", classNames?.valueInput)}
      disabled={disabled}
    />
  )
}
