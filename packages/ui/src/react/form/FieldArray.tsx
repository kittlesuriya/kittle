import { useMemo, useState } from "react"
import { Button } from "../ui/button"
import { Card } from "../ui/card"
import { Trash2, Plus } from "lucide-react"
import { FieldRenderer } from "./FieldRenderer"
import { FieldErrors } from "./FieldErrors"
import { FieldHelp } from "./components/FieldHelp"
import { Label } from "../ui/label"
import { cn } from "../../core/cn"
import { colSpanClass } from "../../core/form/gridHelpers"
import { toDisplayString } from "../../core/format/toDisplayString"
import { getItemId, ensureLocalIds } from "../../core/form/formHelpers"
import { useTranslation } from "react-i18next"
import {
  mergeFieldStyles,
  resolveFieldStyles,
} from "../../core/form/fieldStyles"
import type {
  FieldArrayProps,
  ArrayItemWithLocalId,
  FieldConfig,
  FieldValue,
} from "../../core/form/types"

/**
 * Normalized error structure
 */
interface NormalizedError {
  path: string
  message: string
}

/**
 * FieldArray component for managing arrays of items
 */
export function FieldArray({
  name,
  label,
  singularLabel,
  allowAdd = true,
  allowRemove = true,
  itemFields,
  value = [],
  onChange,
  onBlur,
  errors,
  disabled,
  isSubmitted,
  itemHeader,
  emptyMessage,
  listClassName,
  compactItems = false,
  help,
  idPrefix,
  classNames,
  partClassNames,
  fieldPath,
  fieldStyles,
  baseClassNames,
  basePartClassNames,
}: FieldArrayProps): React.ReactElement {
  const { t } = useTranslation()
  // Item input id base. Prefixed per form instance when provided so sibling
  // forms sharing an array name cannot emit duplicate ids.
  const itemIdBase = idPrefix ?? name
  const inheritedClassNames = baseClassNames ?? classNames
  const inheritedPartClassNames = basePartClassNames ?? partClassNames
  // Ensure all items have IDs
  const items = useMemo(
    () => ensureLocalIds(Array.isArray(value) ? value : []),
    [value]
  )

  const [touchedFields, setTouchedFields] = useState<Set<string>>(
    () => new Set()
  )

  const markTouched = (path: string) => {
    setTouchedFields((prev) => {
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }

  const addItem = () => {
    if (!allowAdd) return
    const newItem: ArrayItemWithLocalId = {
      __localId: getItemId({}),
    }
    for (const field of itemFields) {
      switch (field.type) {
        case "number":
          newItem[field.name] = undefined
          break
        case "checkbox":
        case "switch":
          newItem[field.name] = false
          break
        case "file":
          newItem[field.name] = null
          break
        default:
          newItem[field.name] = ""
      }
    }
    onChange([...items, newItem])
  }

  const removeItem = (index: number) => {
    if (!allowRemove) return
    onChange(items.filter((_, i) => i !== index))
  }

  const updateItem = (
    index: number,
    fieldName: string,
    fieldValue: unknown
  ) => {
    const updated = [...items]
    const currentItem = updated[index]
    if (!currentItem) return

    const nextItem = { ...currentItem, [fieldName]: fieldValue }

    // When a field that others depend on (via filterBy) changes,
    // reset dependent fields whose values are no longer valid.
    for (const field of itemFields) {
      if (
        field.filterBy &&
        field.filterBy.field === fieldName &&
        field.name !== fieldName
      ) {
        const { optionKey } = field.filterBy
        const options =
          (field as { options?: Array<Record<string, unknown>> }).options ?? []
        const currentDepValue = nextItem[field.name]
        if (currentDepValue !== undefined && currentDepValue !== "") {
          const isStillValid = options.some(
            (opt) =>
              toDisplayString(opt.value) === toDisplayString(currentDepValue) &&
              Array.isArray(opt[optionKey]) &&
              (opt[optionKey] as unknown[]).includes(fieldValue)
          )
          if (!isStillValid) {
            nextItem[field.name] = ""
          }
        }
      }
    }

    updated[index] = nextItem
    onChange(updated)
    markTouched(`${name}.${index}.${fieldName}`)
  }

  /**
   * Compute filtered options for a field based on filterBy config
   * and the current item's values (row-scoped filtering).
   */
  const getFilteredOptions = (
    field: FieldConfig,
    item: ArrayItemWithLocalId
  ): typeof field extends { options: infer O } ? O : undefined => {
    if (!("options" in field) || !Array.isArray(field.options)) {
      return undefined
    }

    let filtered = field.options as Array<Record<string, unknown>>

    if (field.filterBy) {
      const { field: depField, optionKey } = field.filterBy
      const depValue = item[depField]
      if (depValue !== undefined && depValue !== null && depValue !== "") {
        filtered = filtered.filter((opt) => {
          const optKeyValue = opt[optionKey]
          if (Array.isArray(optKeyValue)) {
            return optKeyValue.includes(depValue)
          }
          return optKeyValue === depValue
        })
      }
    }

    return filtered as never
  }

  // Separate array-level errors from item-level errors
  const arrayErrors = useMemo(() => {
    if (!errors) return []

    const messages: string[] = []
    for (const e of errors) {
      if (typeof e === "string") {
        messages.push(e)
      } else if (typeof e === "object" && e !== null) {
        const err = e as NormalizedError
        if (typeof err.message === "string") {
          const path = err.path ?? ""
          if (path === name || path === "" || !path.includes(".")) {
            messages.push(err.message)
          }
        }
      }
    }
    return messages
  }, [errors, name])

  const itemErrorsMap = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!errors) return map

    for (const e of errors) {
      if (typeof e === "object" && e !== null) {
        const err = e as NormalizedError
        if (err.path && err.message) {
          const existing = map.get(err.path) ?? []
          existing.push(err.message)
          map.set(err.path, existing)
        }
      }
    }
    return map
  }, [errors])

  const getItemErrors = (
    index: number,
    fieldName: string
  ): string[] | undefined => {
    const path = `${name}.${index}.${fieldName}`
    const itemErrors = itemErrorsMap.get(path)
    if (!itemErrors) return undefined

    // The parent forwards errors only once its own gate has fired (field
    // touched, or a submit attempt), so honour that decision rather than
    // re-hiding an item this component never saw the user touch: a failed
    // submit leaves `isSubmitted` false, and the row at fault may be one
    // that was seeded rather than edited.
    const parentShowsErrors = (errors?.length ?? 0) > 0
    if (parentShowsErrors || touchedFields.has(path) || isSubmitted) {
      return itemErrors
    }
    return undefined
  }

  return (
    <div
      className={cn("space-y-3", classNames?.array)}
      data-testid={`field-array-${name}`}
    >
      <div
        className={cn(
          "flex items-center justify-between",
          classNames?.arrayHeader
        )}
      >
        <div className="flex items-center gap-1">
          <Label className={cn("text-sm font-medium", classNames?.arrayLabel)}>
            {label}
          </Label>
          {help?.description ? (
            <FieldHelp
              title={help.title ?? label}
              description={help.description}
              bullets={help.bullets}
              example={help.example}
              className={classNames?.arrayHelp}
              classNames={partClassNames?.help}
            />
          ) : null}
        </div>
        {allowAdd && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addItem}
            disabled={disabled}
            data-testid={`add-${name}-item`}
            className={classNames?.arrayAddButton}
          >
            <Plus className="h-4 w-4 mr-1" />
            {t("common.add", { defaultValue: "Add" })} {singularLabel ?? label}
          </Button>
        )}
      </div>

      {items.length === 0 && (
        <div
          className={cn(
            "text-sm text-muted-foreground italic",
            classNames?.arrayEmpty
          )}
        >
          {emptyMessage ??
            t("common.no_items", {
              defaultValue:
                'No items added yet. Click "Add {{label}}" to begin.',
              label: singularLabel ?? label,
            })}
        </div>
      )}

      <div
        className={cn(
          compactItems ? "space-y-2" : "space-y-3",
          classNames?.arrayList,
          listClassName
        )}
      >
        {items.map((item, index) => {
          const visibleFields = [...itemFields].filter((field) => !field.hidden)
          if (compactItems) {
            // Slim row: the header names the row, the single input sits
            // beside it, labels go screen-reader-only. The caller opts in
            // per array (see `ArrayFieldConfig.compactItems`).
            return (
              <Card
                key={getItemId(item)}
                className={cn(
                  "p-2",
                  classNames?.arrayItem,
                  classNames?.arrayCompactItem
                )}
                data-testid={`${name}-item-${index}`}
              >
                <div
                  className={cn(
                    "flex items-center gap-3",
                    classNames?.arrayCompactContent
                  )}
                >
                  <h4
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm font-medium",
                      classNames?.arrayItemHeader
                    )}
                  >
                    {itemHeader
                      ? itemHeader(item, index)
                      : `${singularLabel ?? label} #${index + 1}`}
                  </h4>
                  {visibleFields.map((field: FieldConfig) => {
                    const path = `${fieldPath ?? name}.${index}.${field.name}`
                    const styles = mergeFieldStyles(
                      {
                        classNames: inheritedClassNames ?? {},
                        partClassNames: inheritedPartClassNames,
                      },
                      ...resolveFieldStyles(fieldStyles, path)
                    )
                    const nestedClassNames = {
                      ...(inheritedClassNames ?? {}),
                      ...(styles.classNames ?? {}),
                    }
                    const fieldErrors = getItemErrors(index, field.name)
                    return (
                      <div
                        key={field.name}
                        className={cn(
                          "w-44 shrink-0",
                          styles.classNames?.field
                        )}
                      >
                        <Label
                          htmlFor={`${itemIdBase}.${index}.${field.name}`}
                          className={cn("sr-only", styles.classNames?.label)}
                        >
                          {field.label}
                          {field.required && (
                            <span className="text-destructive ml-1">*</span>
                          )}
                        </Label>
                        <FieldRenderer
                          cfg={field}
                          id={`${itemIdBase}.${index}.${field.name}`}
                          value={item[field.name] as FieldValue}
                          onChange={(v) => updateItem(index, field.name, v)}
                          onBlur={() => {
                            onBlur?.()
                            markTouched(`${name}.${index}.${field.name}`)
                          }}
                          disabled={disabled || field.disabled}
                          overrideOptions={getFilteredOptions(field, item)}
                          classNames={nestedClassNames}
                          partClassNames={styles.partClassNames}
                          fieldPath={path}
                          fieldStyles={fieldStyles}
                          baseClassNames={inheritedClassNames ?? {}}
                          basePartClassNames={inheritedPartClassNames ?? {}}
                        />
                        {fieldErrors && (
                          <FieldErrors
                            errors={fieldErrors}
                            className={styles.classNames?.errors}
                            rowClassName={styles.classNames?.errorRow}
                          />
                        )}
                      </div>
                    )
                  })}
                  {allowRemove && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeItem(index)}
                      disabled={disabled}
                      data-testid={`remove-${name}-item-${index}`}
                      className={classNames?.arrayRemoveButton}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </Card>
            )
          }
          return (
            <Card
              key={getItemId(item)}
              className={cn("p-4", classNames?.arrayItem)}
              data-testid={`${name}-item-${index}`}
            >
              <div className="flex items-center justify-between mb-2">
                <h4
                  className={cn(
                    "text-sm font-medium",
                    classNames?.arrayItemHeader
                  )}
                >
                  {itemHeader
                    ? itemHeader(item, index)
                    : `${singularLabel ?? label} #${index + 1}`}
                </h4>
                {allowRemove && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => removeItem(index)}
                    disabled={disabled}
                    data-testid={`remove-${name}-item-${index}`}
                    className={classNames?.arrayRemoveButton}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div
                className={cn("grid grid-cols-12 gap-4", classNames?.arrayGrid)}
              >
                {[...itemFields]
                  .filter((field) => !field.hidden)
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((field: FieldConfig) => {
                    const path = `${fieldPath ?? name}.${index}.${field.name}`
                    const styles = mergeFieldStyles(
                      {
                        classNames: inheritedClassNames ?? {},
                        partClassNames: inheritedPartClassNames,
                      },
                      ...resolveFieldStyles(fieldStyles, path)
                    )
                    const nestedClassNames = {
                      ...(inheritedClassNames ?? {}),
                      ...(styles.classNames ?? {}),
                    }
                    const span = field.colSpan ?? 12
                    const colClass = colSpanClass(span)
                    const fieldErrors = getItemErrors(index, field.name)

                    return (
                      <div
                        key={field.name}
                        className={cn(
                          `col-span-12 ${colClass} space-y-1.5`,
                          styles.classNames?.field
                        )}
                      >
                        <Label
                          htmlFor={`${itemIdBase}.${index}.${field.name}`}
                          className={cn("text-sm", styles.classNames?.label)}
                        >
                          {field.label}
                          {field.required && (
                            <span className="text-destructive ml-1">*</span>
                          )}
                        </Label>
                        <FieldRenderer
                          cfg={field}
                          id={`${itemIdBase}.${index}.${field.name}`}
                          value={item[field.name] as FieldValue}
                          onChange={(v) => updateItem(index, field.name, v)}
                          onBlur={() => {
                            onBlur?.()
                            markTouched(`${name}.${index}.${field.name}`)
                          }}
                          disabled={disabled || field.disabled}
                          overrideOptions={getFilteredOptions(field, item)}
                          classNames={nestedClassNames}
                          partClassNames={styles.partClassNames}
                          fieldPath={path}
                          fieldStyles={fieldStyles}
                          baseClassNames={inheritedClassNames ?? {}}
                          basePartClassNames={inheritedPartClassNames ?? {}}
                        />
                        {fieldErrors && (
                          <FieldErrors
                            errors={fieldErrors}
                            className={styles.classNames?.errors}
                            rowClassName={styles.classNames?.errorRow}
                          />
                        )}
                      </div>
                    )
                  })}
              </div>
            </Card>
          )
        })}
      </div>

      <FieldErrors
        errors={arrayErrors}
        className={cn(classNames?.errors, classNames?.arrayErrors)}
        rowClassName={classNames?.errorRow}
      />
    </div>
  )
}
