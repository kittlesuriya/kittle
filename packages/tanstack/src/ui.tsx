import {
  createContext,
  type ComponentType,
  type InputHTMLAttributes,
  type MouseEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useContext,
} from "react"
import type { CustomFieldProps, FieldRendererProps } from "./schema-form/types"
import type { QueryBuilderProps } from "./query-builder/types"

export interface ButtonProps {
  children?: ReactNode
  className?: string | undefined
  disabled?: boolean | undefined
  type?: "button" | "submit" | "reset" | undefined
  onClick?: MouseEventHandler<HTMLButtonElement> | undefined
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement> | undefined
  title?: string | undefined
  "aria-expanded"?: boolean | undefined
  "aria-label"?: string | undefined
}

export interface SelectOption {
  value: string
  label: ReactNode
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange"
> {
  options?: SelectOption[]
  onChange?: (value: string | string[]) => void
}

export interface MultiSelectProps extends Omit<
  SelectProps,
  "multiple" | "value" | "onChange"
> {
  value?: string[]
  onChange?: (value: string[]) => void
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export interface UiComponents {
  Button: ComponentType<ButtonProps>
  Select: ComponentType<SelectProps>
  Input: ComponentType<InputProps>
  Textarea: ComponentType<TextareaProps>
  Autocomplete: ComponentType<SelectProps>
  MultiSelect: ComponentType<MultiSelectProps>
  Switch: ComponentType<InputProps>
  Checkbox: ComponentType<InputProps>
}

export interface UiConfig extends Partial<UiComponents> {
  fieldRegistry?: Record<string, ComponentType<CustomFieldProps>>
  fieldRenderer?: ComponentType<FieldRendererProps>
  renderFieldValue?: QueryBuilderProps["renderFieldValue"]
}

function DefaultButton({ className, ...props }: ButtonProps) {
  return (
    <button className={`ui__button ${className ?? ""}`.trim()} {...props} />
  )
}

function DefaultSelect({ options, onChange, ...props }: SelectProps) {
  return (
    <select
      {...props}
      onChange={(event) =>
        onChange?.(
          props.multiple
            ? Array.from(event.target.selectedOptions, (option) => option.value)
            : event.target.value
        )
      }
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function DefaultInput(props: InputProps) {
  return <input {...props} />
}

function DefaultTextarea(props: TextareaProps) {
  return <textarea {...props} />
}

export const defaultUiComponents: UiComponents = {
  Button: DefaultButton,
  Select: DefaultSelect,
  Input: DefaultInput,
  Textarea: DefaultTextarea,
  Autocomplete: DefaultSelect,
  MultiSelect: ({ value, onChange, options, ...props }) => (
    <DefaultSelect
      {...props}
      multiple
      {...(value ? { value } : {})}
      options={options ?? []}
      onChange={(next) => onChange?.(Array.isArray(next) ? next : [next])}
    />
  ),
  Switch: DefaultInput,
  Checkbox: DefaultInput,
}

const UiContext = createContext<UiComponents>(defaultUiComponents)

export function UiProvider({
  components,
  children,
}: {
  components?: Partial<UiComponents> | undefined
  children: ReactNode
}) {
  const value = { ...defaultUiComponents, ...components }
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>
}

/**
 * Creates a project-level component with UI renderers injected through props.
 * Local `components` passed to the wrapped component take precedence.
 */
export function withUi<P extends { components?: UiConfig }>(
  Component: ComponentType<P>,
  defaults: UiConfig
): ComponentType<Omit<P, "components"> & { components?: UiConfig }> {
  function UiWrapped(props: Omit<P, "components"> & { components?: UiConfig }) {
    const merged = { ...defaults, ...props.components }
    return <Component {...(props as P)} components={merged} />
  }
  UiWrapped.displayName = `withUi(${Component.displayName ?? Component.name ?? "Component"})`
  return UiWrapped
}

export function useUiComponents(
  overrides?: Partial<UiComponents>
): UiComponents {
  return { ...useContext(UiContext), ...overrides }
}
