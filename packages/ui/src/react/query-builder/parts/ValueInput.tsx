import { Input } from "../../ui/input"
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
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type={inputType}
          value={rangeValue.from}
          onChange={(e) =>
            handleRangeChange({ ...rangeValue, from: e.target.value })
          }
          className="h-8 w-full"
          disabled={disabled}
        />
        <span className="text-muted-foreground">to</span>
        <Input
          type={inputType}
          value={rangeValue.to}
          onChange={(e) =>
            handleRangeChange({ ...rangeValue, to: e.target.value })
          }
          className="h-8 w-full"
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
        <SelectTrigger className="h-8 w-full sm:min-w-[120px]">
          <SelectValue placeholder="Select...">
            {
              field.options.find(
                (opt) => toDisplayString(opt.value) === toDisplayString(value)
              )?.label
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {field.options.map((opt) => (
            <SelectItem key={String(opt.value)} value={String(opt.value)}>
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
        className="w-full sm:min-w-[200px]"
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
        className="h-8 w-full sm:min-w-[100px]"
        disabled={disabled}
      />
    )
  }

  // Date field
  if (field.type === "date") {
    if (isRange) {
      const rangeValue = (value as { from?: string; to?: string }) ?? {}
      return (
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="date"
            value={rangeValue.from ?? ""}
            onChange={(e) => onChange({ ...rangeValue, from: e.target.value })}
            className="h-8 w-full"
            disabled={disabled}
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="date"
            value={rangeValue.to ?? ""}
            onChange={(e) => onChange({ ...rangeValue, to: e.target.value })}
            className="h-8 w-full"
            disabled={disabled}
          />
        </div>
      )
    }
    return (
      <Input
        type="date"
        value={toDisplayString(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full"
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
        className="h-8 w-full"
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
      className="h-8 w-full sm:min-w-[120px]"
      disabled={disabled}
    />
  )
}
