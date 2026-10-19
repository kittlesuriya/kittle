import { Input } from "../ui/input"
import { cn } from "../../core/cn"

export interface ColorPickerClassNames {
  root?: string
  swatch?: string
  input?: string
}
interface ColorPickerProps {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  id?: string
  className?: string
  classNames?: ColorPickerClassNames
}

export function ColorPicker({
  value,
  onChange,
  disabled,
  id,
  className,
  classNames,
}: ColorPickerProps) {
  const hex = value || "#6B7280"

  return (
    <div className={cn("flex items-center gap-3", className, classNames?.root)}>
      <div
        className={cn(
          "h-9 w-9 rounded-md border border-input shrink-0",
          classNames?.swatch
        )}
        style={{ backgroundColor: hex }}
      />
      <Input
        id={id}
        type="color"
        value={hex}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className={cn("h-10 w-full cursor-pointer", classNames?.input)}
      />
    </div>
  )
}
