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
import { ValueInput } from "./ValueInput"
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
}: QueryConditionProps): React.ReactElement {
  const { t } = useTranslation()
  const selectedField = fields.find((f) => f.id === condition.field)
  const operators = selectedField?.operators ?? []

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
    <div className="flex flex-col gap-2 px-2.5 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:px-3">
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
        <SelectTrigger className="h-9 w-full sm:w-[180px]">
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
        <SelectContent>
          {fields.map((field) => (
            <SelectItem key={field.id} value={field.id}>
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
        <SelectTrigger className="h-9 w-full sm:w-[140px]">
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
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {t(`querybuilder.operators.${op.value}`, {
                defaultValue: op.label,
              })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="w-full sm:min-w-[150px] sm:flex-1">
        {condition.field && selectedField && (
          <ValueInput
            field={selectedField}
            operator={condition.operator}
            value={condition.value}
            onChange={handleValueChange}
            disabled={disabled || !condition.field}
          />
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onRemove(condition.id)}
        disabled={disabled}
        className="h-9 w-9 self-end text-muted-foreground hover:text-destructive sm:self-auto"
      >
        <Trash2 size={16} />
      </Button>
    </div>
  )
}
