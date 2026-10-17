import { Input } from "../ui/input"

interface ColorPickerProps {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  id?: string
}

export function ColorPicker({
  value,
  onChange,
  disabled,
  id,
}: ColorPickerProps) {
  const hex = value || "#6B7280"

  return (
    <div className="flex items-center gap-3">
      <div
        className="h-9 w-9 rounded-md border border-input shrink-0"
        style={{ backgroundColor: hex }}
      />
      <Input
        id={id}
        type="color"
        value={hex}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className="h-10 w-full cursor-pointer"
      />
    </div>
  )
}
