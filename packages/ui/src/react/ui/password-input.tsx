import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./input-group"
import { cn } from "../../core/cn"

export interface PasswordInputClassNames {
  root?: string
  input?: string
  addon?: string
  toggle?: string
  icon?: string
}

export interface PasswordInputProps {
  id?: string
  name?: string
  value?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  autoComplete?: string
  autoFocus?: boolean
  className?: string
  classNames?: PasswordInputClassNames
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
  classNames,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  onChange,
  onBlur,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <InputGroup
      className={cn(className, classNames?.root)}
      data-disabled={disabled}
    >
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
        className={cn(classNames?.input)}
      />
      <InputGroupAddon align="inline-end" className={cn(classNames?.addon)}>
        <InputGroupButton
          type="button"
          size="icon-xs"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((prev) => !prev)}
          disabled={disabled}
          className={cn(classNames?.toggle)}
        >
          {visible ? (
            <EyeOff className={cn(classNames?.icon)} />
          ) : (
            <Eye className={cn(classNames?.icon)} />
          )}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
