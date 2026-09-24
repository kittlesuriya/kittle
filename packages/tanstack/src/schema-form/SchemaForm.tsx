import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import type { z } from "zod"
import { useUiComponents } from "../ui"
import { getFormLayout, schemaToFieldConfigs } from "./schemaAdapter"
import { resolveFormLayout } from "./layout"
import type {
  FieldConfig,
  FieldErrors,
  FieldOption,
  FormInstance,
  SchemaFormProps,
} from "./types"
import type { UiComponents } from "../ui"

function getPath(value: unknown, path: string): unknown {
  return path
    .split(/[.[\]]/)
    .filter(Boolean)
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value
    )
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  return ""
}

function visibleWhen(
  condition: NonNullable<FieldConfig["visibleWhen"]>,
  values: Record<string, unknown>
): boolean {
  return (Array.isArray(condition) ? condition : [condition]).every(
    ({ field, operator, value }) => {
      const actual = getPath(values, field)
      if (operator === "equals") return actual === value
      if (operator === "notEquals") return actual !== value
      if (operator === "contains")
        return Array.isArray(actual)
          ? actual.includes(value)
          : textValue(actual).includes(textValue(value))
      if (operator === "notContains")
        return Array.isArray(actual)
          ? !actual.includes(value)
          : !textValue(actual).includes(textValue(value))
      if (operator === "greaterThan") return Number(actual) > Number(value)
      return Number(actual) < Number(value)
    }
  )
}

function stripLocalIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLocalIds)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "__localId")
        .map(([key, child]) => [key, stripLocalIds(child)])
    )
  return value
}

function fieldErrors(errors: FieldErrors, name: string): string[] {
  return Object.entries(errors)
    .filter(([key]) => key === name || key.startsWith(`${name}.`))
    .flatMap(([, messages]) => messages)
}

function normalizeValues(
  input: Record<string, unknown>,
  fields: FieldConfig[]
): Record<string, unknown> {
  const output = { ...input }
  const normalize = (value: unknown, field: FieldConfig): unknown => {
    if (field.type === "array" && Array.isArray(value)) {
      return (value as unknown[]).map((row) => {
        if (!row || typeof row !== "object") return row
        const normalized = { ...(row as Record<string, unknown>) }
        for (const item of field.arrayItemSchema ?? [])
          normalized[item.name] = normalize(normalized[item.name], item)
        return normalized
      })
    }
    if (
      field.dataType === "number" &&
      typeof value === "string" &&
      value !== ""
    )
      return Number(value)
    if (field.dataType === "date" && typeof value === "string" && value)
      return new Date(value)
    return value
  }
  for (const field of fields)
    output[field.name] = normalize(output[field.name], field)
  return output
}

function options(value: FieldConfig["options"]): FieldOption[] {
  if (!value) return []
  const isFieldOption = (item: unknown): item is FieldOption =>
    item !== null &&
    typeof item === "object" &&
    "label" in item &&
    "value" in item
  return value.reduce<FieldOption[]>((result, item) => {
    let grouped: unknown
    if (item !== null && typeof item === "object" && "options" in item)
      grouped = item.options
    if (Array.isArray(grouped)) {
      result.push(...grouped.filter(isFieldOption))
    } else if (isFieldOption(item)) {
      result.push(item)
    }
    return result
  }, [])
}

const builtinFieldTypes = new Set([
  "text",
  "email",
  "password",
  "textarea",
  "number",
  "date",
  "time",
  "datetime",
  "select",
  "radio",
  "autocomplete",
  "multiselect",
  "checkbox",
  "switch",
  "color",
  "array",
])

function BasicField({
  field,
  value,
  onChange,
  onBlur,
  disabled,
  error,
  components,
}: {
  field: FieldConfig
  value: unknown
  onChange: (value: unknown) => void
  onBlur?: () => void
  disabled: boolean
  error?: string
  components?: Partial<UiComponents>
}) {
  const {
    Input,
    Select,
    Textarea,
    Autocomplete,
    MultiSelect,
    Switch,
    Checkbox,
  } = useUiComponents(components)
  const stringValue = textValue(value)
  const common = {
    id: `field-${field.name}`,
    name: field.name,
    disabled,
    required: field.required,
    "aria-invalid": Boolean(error),
    onBlur,
  }
  if (field.type === "textarea")
    return (
      <Textarea
        {...common}
        value={stringValue}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  if (field.type === "autocomplete")
    return (
      <Autocomplete
        {...common}
        value={stringValue}
        options={options(field.options).map((item) => ({
          value: String(item.value),
          label: item.label,
        }))}
        onChange={onChange}
      />
    )
  if (field.type === "select" || field.type === "radio")
    return (
      <Select
        {...common}
        value={stringValue}
        options={[
          { value: "", label: field.placeholder ?? "Select…" },
          ...options(field.options).map((item) => ({
            value: String(item.value),
            label: item.label,
          })),
        ]}
        onChange={onChange}
      />
    )
  if (field.type === "checkbox")
    return (
      <Checkbox
        {...common}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  if (field.type === "switch")
    return (
      <Switch
        {...common}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  if (field.type === "multiselect")
    return (
      <MultiSelect
        {...common}
        value={Array.isArray(value) ? value.map(String) : []}
        options={options(field.options).map((item) => ({
          value: String(item.value),
          label: item.label,
        }))}
        onChange={(next) => onChange(next)}
      />
    )
  return (
    <Input
      {...common}
      type={
        field.type === "datetime"
          ? "datetime-local"
          : [
                "text",
                "email",
                "password",
                "number",
                "date",
                "time",
                "color",
              ].includes(field.type)
            ? field.type
            : "text"
      }
      value={stringValue}
      placeholder={field.placeholder}
      onChange={(event) =>
        onChange(
          field.type === "number"
            ? event.target.value === ""
              ? ""
              : Number(event.target.value)
            : event.target.value
        )
      }
    />
  )
}

function ArrayField({
  field,
  value,
  onChange,
  disabled,
  errors,
  components,
  onBlur,
}: {
  field: FieldConfig
  value: unknown
  onChange: (value: unknown) => void
  disabled: boolean
  errors: FieldErrors
  components?: Partial<UiComponents>
  onBlur?: (name: string) => void
}) {
  const rows = Array.isArray(value)
    ? (value as Array<Record<string, unknown>>)
    : []
  const itemFields = field.arrayItemSchema ?? []
  const update = (index: number, name: string, next: unknown) =>
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [name]: next } : row
      )
    )
  return (
    <div className="ui__query-group">
      {rows.map((row, index) => (
        <div
          className="ui__query-group"
          key={
            typeof row.__localId === "string" ||
            typeof row.__localId === "number"
              ? row.__localId
              : index
          }
        >
          {itemFields.map((item) => (
            <div className="ui__field" key={item.name}>
              <label>{item.label}</label>
              <BasicField
                field={item}
                value={row[item.name]}
                onChange={(next) => update(index, item.name, next)}
                disabled={disabled || Boolean(item.disabled)}
                {...(components ? { components } : {})}
                onBlur={() => onBlur?.(`${field.name}.${index}.${item.name}`)}
                {...(() => {
                  const error = fieldErrors(
                    errors,
                    `${field.name}.${index}.${item.name}`
                  )[0]
                  return error ? { error } : {}
                })()}
              />
            </div>
          ))}
          {field.allowRemove !== false && (
            <button
              className="ui__button ui__button--danger"
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange(rows.filter((_, rowIndex) => rowIndex !== index))
              }
            >
              Remove {field.singularLabel ?? "item"}
            </button>
          )}
        </div>
      ))}
      {field.allowAdd !== false && (
        <button
          className="ui__button"
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange([
              ...rows,
              {
                __localId: `${Date.now()}-${rows.length}`,
                ...Object.fromEntries(
                  itemFields.map((item) => [
                    item.name,
                    item.type === "checkbox" || item.type === "switch"
                      ? false
                      : item.type === "array"
                        ? []
                        : "",
                  ])
                ),
              },
            ])
          }
        >
          Add {field.singularLabel ?? "item"}
        </button>
      )}
    </div>
  )
}

export function SchemaForm<T extends z.ZodTypeAny>({
  schema,
  fields: suppliedFields,
  defaultValues,
  onSubmit,
  submitLabel = "Submit",
  disabled = false,
  disabledFields = [],
  fieldRegistry,
  components,
  className,
  validationMode = "submit",
  formKey,
  formRef,
  serverErrors = {},
  onFieldChange,
  onCancel,
  onReset,
  hideActions = false,
  renderActions,
  isLoading = false,
  loadingMessage = "Loading…",
  layout: suppliedLayout,
  iconResolver,
  enableNavigationGuard = false,
  navigationGuardMessage = "You have unsaved changes. Are you sure you want to leave?",
  fieldSlots,
  customFieldRenderer: CustomFieldRenderer,
  children,
}: SchemaFormProps<T>) {
  const fields = useMemo(() => {
    if (suppliedFields) return suppliedFields
    const candidate = schema as unknown as { shape?: unknown }
    return candidate.shape
      ? schemaToFieldConfigs(schema as unknown as z.ZodObject)
      : []
  }, [schema, suppliedFields])
  const layout = useMemo(
    () => resolveFormLayout(fields, suppliedLayout ?? getFormLayout(schema)),
    [fields, schema, suppliedLayout]
  )
  const { Button } = useUiComponents(components)
  const resolvedFieldRegistry = {
    ...(components?.fieldRegistry ?? {}),
    ...(fieldRegistry ?? {}),
  }
  const ResolvedFieldRenderer = CustomFieldRenderer ?? components?.fieldRenderer
  const [values, setValues] = useState<Record<string, unknown>>({
    ...(defaultValues as Record<string, unknown> | undefined),
  })
  const [errors, setErrors] = useState<FieldErrors>(serverErrors)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const initial = useRef({
    ...(defaultValues as Record<string, unknown> | undefined),
  })
  const guards = useRef(new Map<string, () => string | null>())

  useEffect(() => {
    if (formKey !== undefined) {
      initial.current = {
        ...(defaultValues as Record<string, unknown> | undefined),
      }
      setValues(initial.current)
      setTouched(new Set())
      setSubmitted(false)
    }
  }, [formKey, defaultValues])
  useEffect(() => {
    setErrors(serverErrors)
  }, [serverErrors])

  const validate = useCallback(
    (input: Record<string, unknown>, fieldName?: string) => {
      const result = schema.safeParse(
        stripLocalIds(normalizeValues(input, fields))
      )
      const next: FieldErrors = {}
      if (!result.success)
        for (const issue of result.error.issues) {
          const key = issue.path.length
            ? issue.path.map(String).join(".")
            : "form"
          ;(next[key] ??= []).push(issue.message)
        }
      setErrors((current) =>
        fieldName
          ? {
              ...Object.fromEntries(
                Object.entries(current).filter(
                  ([key]) =>
                    !(`${key}` === fieldName || key.startsWith(`${fieldName}.`))
                )
              ),
              ...Object.fromEntries(
                Object.entries(next).filter(
                  ([key]) =>
                    key === fieldName || key.startsWith(`${fieldName}.`)
                )
              ),
            }
          : next
      )
      return result.success ? result.data : undefined
    },
    [fields, schema]
  )

  const setField = useCallback(
    (name: string, value: unknown) => {
      const next = { ...values, [name]: value }
      setValues(next)
      onFieldChange?.(name, value)
      if (validationMode === "change") validate(next, name)
    },
    [onFieldChange, validate, validationMode, values]
  )
  const blur = useCallback(
    (name: string) => {
      setTouched((current) => new Set(current).add(name))
      if (validationMode === "blur") validate(values, name)
    },
    [validate, validationMode, values]
  )
  const instance = useMemo<FormInstance>(
    () => ({
      reset: (options) => {
        const next = { ...(options?.values ?? defaultValues ?? {}) }
        initial.current = next
        setValues(next)
        setErrors({})
        setTouched(new Set())
        setSubmitted(false)
      },
      handleSubmit: async () => {
        setSubmitted(true)
        const guard = [...guards.current.values()]
          .map((item) => item())
          .find(Boolean)
        if (guard) {
          setErrors({ form: [guard] })
          return
        }
        const data = validate(values)
        if (!data || !onSubmit) return
        setSubmitting(true)
        try {
          await onSubmit(data)
        } finally {
          setSubmitting(false)
        }
      },
      setFieldValue: setField,
      registerGuard: (key, guard) => {
        guards.current.set(key, guard)
        return () => guards.current.delete(key)
      },
      state: {
        isDirty: JSON.stringify(initial.current) !== JSON.stringify(values),
        isSubmitted: submitted,
        isSubmitting: submitting,
        canSubmit: !submitting,
        values,
      },
    }),
    [defaultValues, onSubmit, setField, submitted, submitting, validate, values]
  )
  useEffect(() => {
    if (formRef) formRef.current = instance
    return () => {
      if (formRef?.current === instance) formRef.current = null
    }
  }, [formRef, instance])
  useEffect(() => {
    if (!enableNavigationGuard || typeof window === "undefined") return
    const handler = (event: BeforeUnloadEvent) => {
      if (!instance.state.isDirty) return
      event.preventDefault()
      event.returnValue = navigationGuardMessage
      return navigationGuardMessage
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [enableNavigationGuard, instance, navigationGuardMessage])

  const renderField = (field: FieldConfig) => {
    if (
      field.hidden ||
      (field.visibleWhen && !visibleWhen(field.visibleWhen, values))
    )
      return null
    const fieldError = fieldErrors(errors, field.name)
    const showError =
      submitted || touched.has(field.name) || Boolean(serverErrors[field.name])
    const isDisabled =
      disabled ||
      isLoading ||
      disabledFields.includes(field.name) ||
      Boolean(field.disabled)
    const Custom = resolvedFieldRegistry[field.type]
    const control =
      field.type === "array" ? (
        <ArrayField
          field={field}
          value={values[field.name]}
          onChange={(next) => setField(field.name, next)}
          disabled={isDisabled}
          errors={errors}
          {...(components ? { components } : {})}
          onBlur={(name) => blur(name)}
        />
      ) : Custom ? (
        <Custom
          field={field}
          value={values[field.name]}
          onChange={(next) => setField(field.name, next)}
          disabled={isDisabled}
          {...(showError && fieldError[0] ? { error: fieldError[0] } : {})}
        />
      ) : ResolvedFieldRenderer && !builtinFieldTypes.has(field.type) ? (
        <ResolvedFieldRenderer
          cfg={field}
          id={`field-${field.name}`}
          value={values[field.name]}
          onChange={(next) => setField(field.name, next)}
          onBlur={() => blur(field.name)}
          disabled={isDisabled}
          errors={showError ? fieldError : []}
          isSubmitted={submitted}
          formValues={values}
        />
      ) : (
        <BasicField
          field={field}
          value={values[field.name]}
          onChange={(next) => setField(field.name, next)}
          onBlur={() => blur(field.name)}
          disabled={isDisabled}
          {...(components ? { components } : {})}
          {...(showError && fieldError[0] ? { error: fieldError[0] } : {})}
        />
      )
    return (
      <div
        className="ui__field"
        key={field.name}
        style={{ order: field.order }}
      >
        <label htmlFor={`field-${field.name}`}>
          {field.label}
          {field.required ? " *" : ""}
        </label>
        {field.help?.description && (
          <span className="ui__muted">{field.help.description}</span>
        )}
        {control}
        {showError &&
          fieldError.map((error) => (
            <span className="ui__error" key={`${field.name}-${error}`}>
              {error}
            </span>
          ))}
        {fieldSlots?.[field.name]?.({
          form: instance,
          values,
          field: {
            value: values[field.name],
            handleChange: (next) => setField(field.name, next),
          },
        })}
      </div>
    )
  }

  return (
    <form
      noValidate
      className={`ui ${className ?? ""}`.trim()}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        void instance.handleSubmit()
      }}
      aria-busy={isLoading || submitting}
    >
      {isLoading && <div role="status">{loadingMessage}</div>}
      {errors.form && submitted && (
        <div className="ui__error" role="alert">
          {errors.form.join(" ")}
        </div>
      )}
      {layout.sections.map((section) => (
        <section key={section.id}>
          <h2>
            {iconResolver?.(section.icon ?? "")}
            {section.title}
          </h2>
          {section.description && (
            <p className="ui__muted">{section.description}</p>
          )}
          {section.groups.map((group) => (
            <div key={group.id}>
              <h3>{group.title}</h3>
              <div className="ui__query-group">
                {group.fields.map(renderField)}
              </div>
            </div>
          ))}
          <div className="ui__query-group">
            {section.fields.map(renderField)}
          </div>
        </section>
      ))}
      {children}
      {!hideActions &&
        (renderActions ? (
          renderActions({
            form: instance,
            canSubmit: !disabled && !submitting,
            isSubmitting: submitting,
            ...(onCancel ? { onCancel } : {}),
            ...(onReset ? { onReset } : {}),
          })
        ) : (
          <div className="ui__toolbar">
            {onCancel && (
              <Button className="ui__button" type="button" onClick={onCancel}>
                Cancel
              </Button>
            )}
            {onReset && (
              <Button
                className="ui__button"
                type="button"
                onClick={() => {
                  instance.reset()
                  onReset()
                }}
              >
                Reset
              </Button>
            )}
            <Button
              className="ui__button ui__button--primary"
              type="submit"
              disabled={disabled || isLoading || submitting}
            >
              {submitting ? "Submitting…" : submitLabel}
            </Button>
          </div>
        ))}
    </form>
  )
}

export { BasicField as FieldControl }
