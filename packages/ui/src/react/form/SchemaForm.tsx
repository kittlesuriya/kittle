import * as React from "react"
import { useForm } from "@tanstack/react-form"
import type { z } from "zod"

import { FieldRenderer } from "./FieldRenderer"
import { FieldErrors } from "./FieldErrors"
import { LoadingOverlay } from "./components/LoadingOverlay"
import { FieldHelp } from "./components/FieldHelp"
import {
  isLabelledByFieldType,
  isSelfLabelingFieldType,
} from "../../core/form/fieldRegistry"

import { Button } from "../ui/button"
import { Label } from "../ui/label"
import { Separator } from "../ui/separator"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible"
import { EmptyState } from "../feedback/EmptyState"
import { InlineError } from "../feedback/InlineError"
import { ChevronDown } from "lucide-react"
import { cn } from "../../core/cn"

import { useTranslation } from "react-i18next"
import { parseZodSchema } from "../../core/form/schemaParser"
import {
  addLocalIdsToArrayItems,
  buildDefaultValues,
  normalizeValues,
} from "../../core/form/formLogic"
import { removeInternalFields } from "../../core/form/dataCleanup"
import {
  validateWithZod,
  getFieldErrors,
} from "../../core/form/validationLogic"
import { isFieldVisible } from "../../core/form/conditionLogic"
import { getColSpanClass, clamp } from "../../core/form/gridLogic"
import { resolveFormLayout } from "../../core/form/layout"
import { getFormLayout } from "../../core/form/schemaMetadata"
import { useFormGuard } from "./hooks/useFormGuard"
import { useUiRuntime } from "../../core/runtime"
import { formatHotkey, isAltEnterSubmit } from "../../core/menu/hotKeys"
import { hotkeyClasses } from "../../core/menu/constants"

import type {
  SchemaFormProps,
  FormInstance,
  FieldConfig,
  FieldErrorEntry,
  FieldOption,
  GroupedFieldOptions,
  FormValues,
  FieldErrors as FieldErrorsType,
  FieldValue,
  ResolvedFormSection,
  SubmissionGuard,
} from "../../core/form/types"

function resolveFieldHelp(args: {
  cfg: FieldConfig
  translationNamespace?: string
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const { cfg, translationNamespace, t } = args
  const fallback = cfg.help
  const fieldName = cfg.name

  if (!translationNamespace) {
    if (!fallback?.description) return null
    return {
      title: fallback.title ?? cfg.label,
      description: fallback.description,
      bullets: fallback.bullets,
      example: fallback.example,
    }
  }

  const title = t(`${translationNamespace}.fields.${fieldName}.help.title`, {
    defaultValue: fallback?.title ?? cfg.label,
  })

  const description = t(
    `${translationNamespace}.fields.${fieldName}.help.description`,
    {
      defaultValue: fallback?.description ?? "",
    }
  )

  const example = t(
    `${translationNamespace}.fields.${fieldName}.help.example`,
    {
      defaultValue: fallback?.example ?? "",
    }
  )

  const bulletsRaw = t(
    `${translationNamespace}.fields.${fieldName}.help.bullets`,
    {
      returnObjects: true,
      defaultValue: fallback?.bullets ?? [],
    }
  ) as unknown

  const bullets = Array.isArray(bulletsRaw)
    ? bulletsRaw.filter((item): item is string => typeof item === "string")
    : (fallback?.bullets ?? [])

  if (!description) return null

  return {
    title,
    description,
    bullets,
    example: example || undefined,
  }
}

/**
 * Cell class for the flat 12-column grid — the pre-sections behaviour, kept
 * exactly as it was so forms that do not opt into sections render identically.
 */
function flatSpanClass(cfg: FieldConfig): string {
  return `col-span-12 ${getColSpanClass(clamp(cfg.colSpan ?? 12, 1, 12))}`
}

/**
 * Cell class for a field inside a layout group.
 *
 * The group keeps the same 12-column container and narrows each cell to the
 * group's column width, so `columns` fields sit per row. Staying inside 12
 * matters: a span wider than the container would make CSS Grid invent implicit
 * columns and break the row. Mobile keeps the full-width base class.
 */
function groupSpanClass(cfg: FieldConfig, columns: number): string {
  const perColumn = Math.floor(12 / columns)
  const span = clamp(Math.min(cfg.colSpan ?? 12, perColumn), 1, 12)
  return `col-span-12 ${getColSpanClass(span)}`
}

/**
 * One section of a sectioned form: heading (optionally collapsible), then its
 * groups and any fields placed straight on the section. Both kinds of container
 * delegate every field to the same `renderField`, so sectioned and flat forms
 * behave identically field for field.
 */
function FormSectionView({
  section,
  renderField,
}: {
  section: ResolvedFormSection
  renderField: (cfg: FieldConfig, spanClass: string) => React.ReactNode
}) {
  // Sections start open: a form field hidden behind a collapsed heading is a
  // validation error the user cannot see or fix.
  const [open, setOpen] = React.useState(section.defaultOpen ?? true)
  const headingId = `${section.id}-heading`

  const body = (
    <div className="space-y-4">
      {section.groups.map((group) => (
        <div key={group.id} className="space-y-3">
          {group.title ? (
            <div className="space-y-1">
              <h3 className="font-medium">{group.title}</h3>
              {group.description ? (
                <p className="text-sm text-muted-foreground">
                  {group.description}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-12 gap-x-4 gap-y-5">
            {group.fields.map((cfg) =>
              renderField(cfg, groupSpanClass(cfg, group.columns))
            )}
          </div>
        </div>
      ))}
      {section.fields.length > 0 ? (
        <div className="grid grid-cols-12 gap-x-4 gap-y-5">
          {section.fields.map((cfg) => renderField(cfg, flatSpanClass(cfg)))}
        </div>
      ) : null}
    </div>
  )

  const description = section.description ? (
    <p className="text-sm text-muted-foreground">{section.description}</p>
  ) : null

  // A collapsible heading must be a <button>, so it carries a span rather than
  // an <h2> — <button> only accepts phrasing content. The section still names
  // itself through that span, so it keeps its landmark.
  const heading = section.collapsible ? (
    <CollapsibleTrigger
      render={
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
        />
      }
    >
      <span id={headingId} className="text-base font-semibold">
        {section.title}
      </span>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 transition-transform",
          open ? "" : "-rotate-90"
        )}
      />
    </CollapsibleTrigger>
  ) : (
    <h2 id={headingId} className="text-base font-semibold">
      {section.title}
    </h2>
  )

  const headingBlock = (
    <div className="space-y-1">
      {heading}
      {description}
    </div>
  )

  if (section.collapsible) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <section aria-labelledby={headingId} className="space-y-3">
          {headingBlock}
          <CollapsibleContent>{body}</CollapsibleContent>
        </section>
      </Collapsible>
    )
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      {headingBlock}
      {body}
    </section>
  )
}

/**
 * SchemaForm - Dynamic form generator from Zod schemas
 */
export function SchemaForm<T extends z.ZodTypeAny>({
  children,
  schema,
  onSubmit,
  submitLabel = "Submit",
  className,
  defaultValues: initialValues,
  formKey,
  onCancel,
  onReset,
  renderActions,
  hideActions = false,
  disabledFields = [],
  onFieldChange,
  isLoading = false,
  loadingMessage,
  disabled = false,
  enableNavigationGuard = false,
  navigationGuardMessage,
  formRef,
  translationNamespace,
  fieldSlots,
  layout,
}: SchemaFormProps<T>): React.ReactElement {
  const { t } = useTranslation()
  const runtime = useUiRuntime()
  // Per-instance id namespace: input ids are `${prefix}-${fieldName}` so two
  // mounted forms sharing field names (inline section forms, sheet over page)
  // cannot emit duplicate ids. Labels use the same helper to stay associated.
  const formIdPrefix = React.useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const fieldIdFor = (name: string): string => `${formIdPrefix}-${name}`
  const fields = React.useMemo(() => parseZodSchema(schema), [schema])

  const defaultValues = React.useMemo(() => {
    const defaults = buildDefaultValues(fields)
    if (initialValues) {
      const withIds = addLocalIdsToArrayItems(initialValues, fields)
      return { ...defaults, ...withIds }
    }
    return defaults
  }, [fields, initialValues])

  const validateFileRequirements = React.useCallback(
    (values: FormValues): FieldErrorsType | null => {
      const errors: FieldErrorsType = {}

      for (const field of fields) {
        if (field.type !== "file") continue

        const minFiles =
          typeof (field as { minFiles?: number }).minFiles === "number"
            ? (field as { minFiles: number }).minFiles
            : 1
        if (minFiles <= 0) continue

        const rawValue = values?.[field.name]
        const count = Array.isArray(rawValue)
          ? rawValue.filter(Boolean).length
          : rawValue
            ? 1
            : 0

        if (count < minFiles) {
          errors[field.name] = [
            `Please upload at least ${minFiles} file${minFiles === 1 ? "" : "s"}.`,
          ]
        }
      }

      return Object.keys(errors).length > 0 ? errors : null
    },
    [fields]
  )

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      // Run all registered submission guards
      for (const guard of guardsRef.current.values()) {
        const error = guard()
        if (error) {
          setSubmitError(error)
          return
        }
      }

      const normalized = normalizeValues(value, fields)
      const sanitized = removeInternalFields(normalized)
      const result = validateWithZod(schema, sanitized)

      if (!result.success) {
        return
      }

      const fileErrors = validateFileRequirements(sanitized)
      if (fileErrors) {
        return
      }

      if (result.data && onSubmit) {
        await onSubmit(result.data)
      }
    },
    validators: {
      onSubmit: ({ value }) => {
        const normalized = normalizeValues(value, fields)
        const sanitized = removeInternalFields(normalized)

        const result = validateWithZod(schema, sanitized)
        const fileErrors = validateFileRequirements(sanitized)

        if (!result.success) {
          return fileErrors
            ? { ...result.errors, ...fileErrors }
            : result.errors
        }

        return fileErrors ?? undefined
      },
    },
  })

  // Submission guards registry
  const guardsRef = React.useRef<Map<string, SubmissionGuard>>(new Map())

  // Expose form instance via ref (with guard support)
  React.useImperativeHandle(formRef, () => {
    const base = form as unknown as FormInstance
    return {
      ...base,
      registerGuard: (key: string, guard: SubmissionGuard) => {
        guardsRef.current.set(key, guard)
        return () => {
          guardsRef.current.delete(key)
        }
      },
    }
  })

  // Track previous formKey
  const prevFormKeyRef = React.useRef(formKey)

  // Reset form when formKey changes
  React.useEffect(() => {
    if (formKey !== undefined && formKey !== prevFormKeyRef.current) {
      form.reset({ values: defaultValues })
      prevFormKeyRef.current = formKey
    }
  }, [formKey, form, defaultValues])

  // Navigation guard
  useFormGuard({
    enabled: enableNavigationGuard && form.state.isDirty,
    message: navigationGuardMessage,
  })

  const [submitError, setSubmitError] = React.useState<string | null>(null)

  if (!fields.length) {
    return (
      <EmptyState
        title="No fields to show"
        description="This form has no configurable fields yet."
      />
    )
  }

  const isFormDisabled = disabled || isLoading

  const sortedFields = React.useMemo(
    () => [...fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [fields]
  )

  // Sections and groups are opt-in: no `layout` prop and no field declaring
  // a `section`/`group` means the flat 12-column grid, exactly as before.
  const layoutConfig = layout ?? getFormLayout(schema)
  const useSections =
    Boolean(layoutConfig) ||
    sortedFields.some((cfg) => Boolean(cfg.section || cfg.group))
  // Hidden fields are dropped before resolving, so a hidden `primaryId`
  // cannot synthesise an empty "General" section heading.
  const resolvedLayout = useSections
    ? resolveFormLayout(
        sortedFields.filter((cfg) => !cfg.hidden),
        layoutConfig
      )
    : null

  /**
   * Render one field cell. `spanClass` is that cell's grid span: the flat
   * 12-column grid passes its own `col-span-N`, a layout group passes the
   * group's column width. Both layouts call this function, so visibility,
   * errors, option filtering and `fieldSlots` cannot drift between them.
   */
  const renderField = (
    cfg: FieldConfig,
    spanClass: string
  ): React.ReactNode => (
    <form.Field key={cfg.name} name={cfg.name}>
      {(field) => {
        if (cfg.hidden) {
          return null
        }
        const isRequired = Boolean(cfg.required)
        const fieldValue = field.state.value as FieldValue

        return (
          <form.Subscribe
            selector={(s) => ({
              errors: s.errors,
              isSubmitted: s.isSubmitted,
              values: s.values,
            })}
          >
            {({ errors: formErrors, isSubmitted, values }) => {
              // Check visibility
              if (!isFieldVisible(cfg.name, cfg.visibleWhen, values)) {
                return null
              }

              const extraErrors = getFieldErrors(formErrors, cfg.name)
              const allErrors: string[] = [
                ...((field.state.meta.errors ?? []) as unknown as string[]),
                ...extraErrors.map((e) => e.message),
              ]
              // `FieldArray` places item errors by their path
              // (`rows.0.weight`); bare messages can only reach its
              // array-level bucket, so it gets the path-bearing entries.
              const rawErrors: FieldErrorEntry[] = [
                ...((field.state.meta.errors ??
                  []) as unknown as FieldErrorEntry[]),
                ...extraErrors,
              ]

              const showErrors =
                (field.state.meta.isTouched || isSubmitted) &&
                allErrors.length > 0

              // Filter options based on excludeFrom field
              const hasOptions = "options" in cfg && Array.isArray(cfg.options)

              const isGroupedOptions = (
                items: FieldOption[] | GroupedFieldOptions[]
              ): items is GroupedFieldOptions[] => {
                const first = items[0]
                if (!first) return false
                return "heading" in first
              }

              const filterOptions = (
                items: FieldOption[] | GroupedFieldOptions[],
                predicate: (option: FieldOption) => boolean
              ): FieldOption[] | GroupedFieldOptions[] => {
                if (isGroupedOptions(items)) {
                  return items
                    .map((group) => ({
                      ...group,
                      options: group.options.filter(predicate),
                    }))
                    .filter((group) => group.options.length > 0)
                }

                return items.filter(predicate)
              }

              let filteredOptions:
                FieldOption[] | GroupedFieldOptions[] | undefined = hasOptions
                ? (cfg.options as FieldOption[] | GroupedFieldOptions[])
                : undefined

              // Translate options if translationNamespace is provided
              if (translationNamespace && filteredOptions) {
                const translateOption = (opt: FieldOption) => ({
                  ...opt,
                  label: t(
                    `${translationNamespace}.fields.${cfg.name}.options.${opt.value}`,
                    { defaultValue: opt.label }
                  ),
                })

                if (isGroupedOptions(filteredOptions)) {
                  filteredOptions = filteredOptions.map((group) => ({
                    ...group,
                    heading: t(
                      `${translationNamespace}.fields.${cfg.name}.groups.${group.heading}`,
                      { defaultValue: group.heading }
                    ),
                    options: group.options.map(translateOption),
                  }))
                } else {
                  filteredOptions = filteredOptions.map(translateOption)
                }
              }

              if (cfg.excludeFrom && filteredOptions) {
                const excludeValue = values?.[cfg.excludeFrom]
                if (excludeValue !== undefined && excludeValue !== null) {
                  filteredOptions = filterOptions(
                    filteredOptions,
                    (opt) => opt.value !== excludeValue
                  )
                }
              }

              // Filter options based on filterBy field
              if (cfg.filterBy && filteredOptions) {
                const { field, optionKey } = cfg.filterBy
                const filterValue = values?.[field]
                if (filterValue !== undefined && filterValue !== null) {
                  filteredOptions = filterOptions(
                    filteredOptions,
                    (opt) => opt[optionKey] === filterValue
                  )
                }
              }

              // Handle switch layout
              if (cfg.type === "switch") {
                const fieldHelp = resolveFieldHelp({
                  cfg,
                  translationNamespace,
                  t,
                })

                return (
                  <div className={spanClass}>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-1">
                        <Label
                          htmlFor={fieldIdFor(cfg.name)}
                          className="text-sm font-medium flex items-center gap-1 cursor-pointer"
                        >
                          {translationNamespace
                            ? t(
                                `${translationNamespace}.fields.${cfg.name}.label`,
                                { defaultValue: cfg.label }
                              )
                            : cfg.label}
                          {isRequired && (
                            <span className="text-destructive text-sm">*</span>
                          )}
                        </Label>
                        {fieldHelp ? (
                          <FieldHelp
                            title={fieldHelp.title}
                            description={fieldHelp.description}
                            bullets={fieldHelp.bullets}
                            example={fieldHelp.example}
                          />
                        ) : null}
                      </div>

                      <FieldRenderer
                        cfg={cfg}
                        id={fieldIdFor(cfg.name)}
                        value={fieldValue}
                        onChange={(val) => {
                          field.handleChange(val)
                          onFieldChange?.(cfg.name, val)
                        }}
                        onBlur={field.handleBlur}
                        disabled={
                          isFormDisabled ||
                          cfg.disabled ||
                          disabledFields.includes(cfg.name)
                        }
                        formValues={values}
                      />
                    </div>
                    {showErrors && (
                      <FieldErrors
                        errors={allErrors}
                        testId={`error-${cfg.name}`}
                      />
                    )}

                    {fieldSlots?.[cfg.name]?.({
                      form: form as unknown as FormInstance,
                      values: values,
                      field: {
                        value: fieldValue,
                        handleChange: (v) => field.handleChange(v),
                      },
                    })}
                  </div>
                )
              }

              // Self-labeling components render without the default label row
              if (isSelfLabelingFieldType(cfg.type)) {
                return (
                  <div className={`${spanClass} space-y-1.5`}>
                    <FieldRenderer
                      cfg={cfg}
                      id={fieldIdFor(cfg.name)}
                      value={fieldValue}
                      onChange={(val) => {
                        field.handleChange(val)
                        onFieldChange?.(cfg.name, val)
                      }}
                      onBlur={field.handleBlur}
                      errors={
                        showErrors
                          ? cfg.type === "array"
                            ? rawErrors
                            : allErrors
                          : []
                      }
                      isSubmitted={isSubmitted}
                      disabled={isFormDisabled || cfg.disabled}
                      formValues={values}
                    />

                    {fieldSlots?.[cfg.name]?.({
                      form: form as unknown as FormInstance,
                      values: values,
                      field: {
                        value: fieldValue,
                        handleChange: (v) => field.handleChange(v),
                      },
                    })}
                  </div>
                )
              }

              // Default layout
              const fieldHelp = resolveFieldHelp({
                cfg,
                translationNamespace,
                t,
              })

              // Rich editors render no labelable input: the label carries an
              // id and the editor references it via aria-labelledby instead
              // of htmlFor. Every other type keeps htmlFor + input id.
              const useLabelledBy = isLabelledByFieldType(cfg.type)
              const labelId = `${fieldIdFor(cfg.name)}-label`

              return (
                <div className={`${spanClass} space-y-1.5 min-w-0`}>
                  <div className="flex items-center gap-1">
                    <Label
                      {...(useLabelledBy
                        ? { id: labelId }
                        : { htmlFor: fieldIdFor(cfg.name) })}
                      className="text-sm font-medium flex items-center gap-1"
                    >
                      {translationNamespace
                        ? t(
                            `${translationNamespace}.fields.${cfg.name}.label`,
                            { defaultValue: cfg.label }
                          )
                        : cfg.label}
                      {isRequired && (
                        <span className="text-destructive text-sm">*</span>
                      )}
                    </Label>
                    {fieldHelp ? (
                      <FieldHelp
                        title={fieldHelp.title}
                        description={fieldHelp.description}
                        bullets={fieldHelp.bullets}
                        example={fieldHelp.example}
                      />
                    ) : null}
                  </div>

                  <FieldRenderer
                    cfg={{
                      ...cfg,
                      label: translationNamespace
                        ? t(
                            `${translationNamespace}.fields.${cfg.name}.label`,
                            { defaultValue: cfg.label }
                          )
                        : cfg.label,
                      placeholder: translationNamespace
                        ? t(
                            `${translationNamespace}.fields.${cfg.name}.placeholder`,
                            { defaultValue: cfg.placeholder ?? "" }
                          )
                        : (cfg.placeholder ?? ""),
                    }}
                    id={fieldIdFor(cfg.name)}
                    labelledBy={useLabelledBy ? labelId : undefined}
                    translationNamespace={translationNamespace}
                    value={fieldValue}
                    onChange={(val) => {
                      field.handleChange(val)
                      onFieldChange?.(cfg.name, val)
                    }}
                    onBlur={field.handleBlur}
                    disabled={
                      isFormDisabled ||
                      cfg.disabled ||
                      disabledFields.includes(cfg.name)
                    }
                    overrideOptions={filteredOptions}
                    formValues={values}
                  />

                  {showErrors && (
                    <FieldErrors
                      errors={allErrors}
                      testId={`error-${cfg.name}`}
                    />
                  )}

                  {fieldSlots?.[cfg.name]?.({
                    form: form as unknown as FormInstance,
                    values: values,
                    field: {
                      value: fieldValue,
                      handleChange: (v) => field.handleChange(v),
                    },
                  })}
                </div>
              )
            }}
          </form.Subscribe>
        )
      }}
    </form.Field>
  )

  return (
    <div className="relative" data-testid="schema-form">
      <LoadingOverlay visible={isLoading} message={loadingMessage} />

      <form
        className={className ?? "space-y-6"}
        data-testid="schema-form-element"
        onKeyDown={(e) => {
          // Alt+Enter submits from anywhere in the form, including focused
          // inputs and textareas (plain Enter keeps its native behaviour).
          if (!isAltEnterSubmit(e)) return
          if (isFormDisabled || form.state.isSubmitting) return
          e.preventDefault()
          e.currentTarget.requestSubmit()
        }}
        onSubmit={async (e) => {
          e.preventDefault()
          e.stopPropagation()
          try {
            setSubmitError(null)
            await form.handleSubmit()
          } catch (err) {
            const message = runtime.formatError(
              err,
              "Unable to submit the form. Please try again."
            )
            setSubmitError(message)
          }
        }}
      >
        {submitError ? <InlineError message={submitError} /> : null}
        {resolvedLayout ? (
          <div className="space-y-6">
            {resolvedLayout.sections.map((section) => (
              <FormSectionView
                key={section.id}
                section={section}
                renderField={renderField}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-x-4 gap-y-5">
            {sortedFields.map((cfg: FieldConfig) =>
              renderField(cfg, flatSpanClass(cfg))
            )}
          </div>
        )}

        {children}

        <Separator className="mb-3" />

        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([canSubmit, isSubmitting]) => {
            if (hideActions) {
              return null
            }
            if (renderActions) {
              return renderActions({
                form: form as unknown as FormInstance,
                canSubmit: Boolean(canSubmit),
                isSubmitting: Boolean(isSubmitting),
                onCancel,
                onReset,
              })
            }

            return (
              <div className="flex items-center justify-end gap-2">
                {onCancel && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onCancel}
                    disabled={Boolean(isSubmitting) || isFormDisabled}
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Button>
                )}
                {onReset && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      onReset()
                      form.reset()
                    }}
                    disabled={Boolean(isSubmitting) || isFormDisabled}
                  >
                    {t("common.reset", { defaultValue: "Reset" })}
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={Boolean(isSubmitting) || isFormDisabled}
                  className={onCancel || onReset ? "" : "w-full"}
                  title={`${submitLabel} (${formatHotkey("alt+enter")})`}
                >
                  {isSubmitting ? (
                    t("common.submitting", { defaultValue: "Submitting…" })
                  ) : (
                    <>
                      {submitLabel}
                      <kbd
                        className={`${hotkeyClasses} hidden sm:inline`}
                        aria-hidden="true"
                      >
                        {formatHotkey("alt+enter")}
                      </kbd>
                    </>
                  )}
                </Button>
              </div>
            )
          }}
        </form.Subscribe>
      </form>
    </div>
  )
}
