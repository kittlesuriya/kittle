import { GripVertical, Trash2 } from "lucide-react"
import { Button } from "../../ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select"
import { useTranslation } from "react-i18next"
import { cn } from "../../../core/cn"
import { ValueInput } from "./ValueInput"
import { resolveQueryBuilderFieldStyles } from "../../../core/query/resolveFieldStyles"
import {
  getDefaultValueForType,
  operatorNeedsRange,
  operatorNeedsValue,
} from "../../../core/query/utils"
import type {
  QueryConditionProps,
  FilterValue,
} from "../../../core/query/types"

/**
 * Single query condition row
 */
export function QueryCondition({
  condition,
  fields,
  onUpdate,
  onRemove,
  disabled,
  showDragHandle = false,
  translationNamespace,
  classNames,
  partClassNames,
  fieldStyles,
}: QueryConditionProps): React.ReactElement {
  const { t } = useTranslation()
  const selectedField = fields.find((f) => f.id === condition.field)
  const operators = selectedField?.operators ?? []
  const { classNames: fieldClassNames, partClassNames: fieldPartClassNames } =
    resolveQueryBuilderFieldStyles(
      classNames,
      partClassNames,
      fieldStyles?.[condition.field]
    )

  const handleFieldChange = (fieldId: string | null) => {
    if (!fieldId) return
    const newField = fields.find((f) => f.id === fieldId)
    const defaultValue = getDefaultValueForType(newField?.type ?? "text")
    onUpdate(condition.id, {
      field: fieldId,
      operator: newField?.operators?.[0]?.value ?? "equals",
      value: defaultValue,
    })
  }

  const normalizeRangeValue = (input: FilterValue): FilterValue => {
    if (Array.isArray(input)) {
      return {
        from: input[0] !== undefined ? String(input[0]) : "",
        to: input[1] !== undefined ? String(input[1]) : "",
      }
    }
    if (
      input &&
      typeof input === "object" &&
      "from" in input &&
      "to" in input
    ) {
      return input
    }
    return { from: "", to: "" }
  }

  const handleOperatorChange = (operator: string | null) => {
    if (!operator) return
    if (!operatorNeedsValue(operator)) {
      onUpdate(condition.id, { operator, value: null })
      return
    }

    if (operatorNeedsRange(operator)) {
      onUpdate(condition.id, {
        operator,
        value: normalizeRangeValue(condition.value),
      })
      return
    }

    onUpdate(condition.id, { operator })
  }

  const handleValueChange = (value: FilterValue) => {
    onUpdate(condition.id, { value })
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-2.5 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:px-3",
        fieldClassNames.condition
      )}
    >
      {showDragHandle && (
        <div className="cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical size={16} />
        </div>
      )}

      <Select
        value={condition.field}
        onValueChange={handleFieldChange}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn(
            "h-9 w-full sm:w-[180px]",
            fieldClassNames.fieldSelectTrigger,
            fieldPartClassNames.fieldSelect?.trigger
          )}
        >
          <SelectValue
            placeholder={t("querybuilder.select_field", {
              defaultValue: "Select field...",
            })}
          >
            {translationNamespace && selectedField
              ? t(`${translationNamespace}.fields.${selectedField.id}.label`, {
                  defaultValue: selectedField.label,
                })
              : selectedField?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className={fieldPartClassNames.fieldSelect?.content}>
          {fields.map((field) => (
            <SelectItem
              className={fieldPartClassNames.fieldSelect?.item}
              key={field.id}
              value={field.id}
            >
              {translationNamespace
                ? t(`${translationNamespace}.fields.${field.id}.label`, {
                    defaultValue: field.label,
                  })
                : field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={condition.operator}
        onValueChange={handleOperatorChange}
        disabled={disabled || !condition.field}
      >
        <SelectTrigger
          className={cn(
            "h-9 w-full sm:w-[140px]",
            fieldClassNames.operatorSelectTrigger,
            fieldPartClassNames.operatorSelect?.trigger
          )}
        >
          <SelectValue
            placeholder={t("querybuilder.operator", {
              defaultValue: "Operator",
            })}
          >
            {condition.operator
              ? t(`querybuilder.operators.${condition.operator}`, {
                  defaultValue: operators.find(
                    (op) => op.value === condition.operator
                  )?.label,
                })
              : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className={fieldPartClassNames.operatorSelect?.content}>
          {operators.map((op) => (
            <SelectItem
              className={fieldPartClassNames.operatorSelect?.item}
              key={op.value}
              value={op.value}
            >
              {t(`querybuilder.operators.${op.value}`, {
                defaultValue: op.label,
              })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div
        className={cn(
          "w-full sm:min-w-[150px] sm:flex-1",
          fieldClassNames.valueWrapper
        )}
      >
        {condition.field && selectedField && (
          <ValueInput
            field={selectedField}
            operator={condition.operator}
            value={condition.value}
            onChange={handleValueChange}
            disabled={disabled || !condition.field}
            classNames={fieldClassNames}
            partClassNames={fieldPartClassNames}
          />
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onRemove(condition.id)}
        disabled={disabled}
        className={cn(
          "h-9 w-9 self-end text-muted-foreground hover:text-destructive sm:self-auto",
          classNames?.removeConditionButton
        )}
      >
        <Trash2 size={16} />
      </Button>
    </div>
  )
}
