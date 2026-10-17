import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./input-group"
import { cn } from "../../core/cn"

interface PasswordInputProps {
  id?: string
  name?: string
  value?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  autoComplete?: string
  autoFocus?: boolean
  className?: string
  "aria-invalid"?: boolean | string
  "aria-describedby"?: string
  onChange?: (value: string) => void
  onBlur?: () => void
}

export function PasswordInput({
  id,
  name,
  value,
  placeholder,
  disabled,
  required,
  autoComplete,
  autoFocus,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  onChange,
  onBlur,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <InputGroup className={cn(className)} data-disabled={disabled}>
      <InputGroupInput
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder ?? ""}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={ariaInvalid as unknown as boolean | undefined}
        aria-describedby={ariaDescribedBy}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          type="button"
          size="icon-xs"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((prev) => !prev)}
          disabled={disabled}
        >
          {visible ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
