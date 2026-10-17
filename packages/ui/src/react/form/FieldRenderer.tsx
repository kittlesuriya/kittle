import { Input } from "../ui/input"
import { PasswordInput } from "../ui/password-input"
import { Textarea } from "../ui/textarea"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select"
import { Checkbox } from "../ui/checkbox"
import { Switch } from "../ui/switch"
import { Label } from "../ui/label"
import { RadioGroup, RadioGroupItem } from "../ui/radio-group"
import { MultiSelect } from "../ui/multi-select"
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteList,
  AutocompleteTrigger,
} from "../ui/autocomplete"
import { FieldArray } from "./FieldArray"
import { DatePicker } from "./DatePicker"
import { ColorPicker } from "./ColorPicker"
import { getCustomFieldRenderer } from "../../core/form/fieldRegistry"
import { toDisplayString } from "../../core/format/toDisplayString"
import type {
  FieldRendererProps,
  FieldOption,
  GroupedFieldOptions,
  ArrayFieldConfig,
  ArrayItemWithLocalId,
  MultiSelectFieldConfig,
  SelectFieldConfig,
  FieldValue,
} from "../../core/form/types"

/**
 * Check if options are grouped
 */
function isGroupedOptions(
  items: FieldOption[] | GroupedFieldOptions[]
): items is GroupedFieldOptions[] {
  return (
    items.length > 0 &&
    Object.prototype.hasOwnProperty.call(items[0], "heading")
  )
}

/**
 * Get label for a value from options
 */
function getLabelForValue(
  currentValue: unknown,
  flatOptions: FieldOption[]
): string {
  if (
    currentValue === null ||
    currentValue === undefined ||
    currentValue === ""
  )
    return ""
  const match = flatOptions.find(
    (option) => toDisplayString(option.value) === toDisplayString(currentValue)
  )
  if (match) return match.label
  return toDisplayString(currentValue)
}

/**
 * Render form fields based on configuration
 */
export function FieldRenderer({
  cfg,
  id,
  labelledBy,
  value,
  onChange,
  onBlur,
  disabled,
  overrideOptions,
  errors,
  isSubmitted,
  translationNamespace,
  formValues,
}: FieldRendererProps & {
  translationNamespace?: string
}): React.ReactElement | null {
  const options =
    overrideOptions ?? (cfg as { options?: FieldOption[] }).options ?? []

  const flatOptions: FieldOption[] = isGroupedOptions(options)
    ? options.flatMap((group) => group.options)
    : options

  const fieldId = id ?? cfg.name

  switch (cfg.type) {
    case "array": {
      const arrayConfig = cfg as ArrayFieldConfig
      const arrayValue = Array.isArray(value)
        ? (value as ArrayItemWithLocalId[])
        : []

      return (
        <FieldArray
          name={cfg.name}
          label={cfg.label}
          singularLabel={arrayConfig.singularLabel}
          allowAdd={arrayConfig.allowAdd}
          allowRemove={arrayConfig.allowRemove}
          itemFields={arrayConfig.arrayItemSchema ?? []}
          value={arrayValue}
          onChange={onChange}
          onBlur={onBlur}
          errors={errors}
          disabled={disabled}
          isSubmitted={isSubmitted}
          translationNamespace={translationNamespace}
          formValues={formValues}
          itemHeader={arrayConfig.itemHeader}
          emptyMessage={arrayConfig.emptyMessage}
          listClassName={arrayConfig.listClassName}
          compactItems={arrayConfig.compactItems}
          help={arrayConfig.help}
          idPrefix={id}
        />
      )
    }

    case "text":
    case "email":
      return (
        <Input
          id={fieldId}
          type={cfg.type}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={cfg.placeholder ?? ""}
          disabled={disabled}
          className="h-10"
        />
      )

    case "password":
      return (
        <PasswordInput
          id={fieldId}
          value={(value as string) ?? ""}
          onChange={(next) => onChange(next)}
          onBlur={onBlur}
          placeholder={cfg.placeholder ?? ""}
          disabled={disabled}
          className="h-10"
        />
      )

    case "textarea":
      return (
        <Textarea
          id={fieldId}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={cfg.placeholder ?? ""}
          disabled={disabled}
          rows={4}
          className="resize-none"
        />
      )

    case "number":
      return (
        <Input
          id={fieldId}
          type="number"
          value={toDisplayString(value)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={cfg.placeholder ?? ""}
          disabled={disabled}
          inputMode="numeric"
          className="h-10"
        />
      )

    case "date":
      return (
        <DatePicker
          id={fieldId}
          value={value as string}
          onChange={onChange}
          disabled={disabled}
          className="h-10"
        />
      )

    case "time":
      return (
        <Input
          id={fieldId}
          type="time"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className="h-10"
        />
      )

    case "datetime":
      return (
        <Input
          id={fieldId}
          type="datetime-local"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className="h-10"
        />
      )

    case "select":
      return (
        <Select
          value={(value as string) ?? ""}
          // Empty means absent for option pickers: `""` fails even an
          // optional `z.enum()`, and reads worse than the clean "Required"
          // error an absent value produces on a required one. The required
          // `*` marker (SchemaForm) is driven separately by `cfg.required`.
          onValueChange={(v) =>
            onChange((v === "" ? undefined : v) as FieldValue)
          }
          disabled={disabled}
        >
          <SelectTrigger id={fieldId} className="h-10 w-full">
            <SelectValue placeholder={cfg.placeholder ?? "Select an option"}>
              {value ? getLabelForValue(value, flatOptions) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {flatOptions.map((o) => (
              <SelectItem key={String(o.value)} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    case "radio":
      return (
        <RadioGroup
          value={value ?? ""}
          onValueChange={(v: string) => onChange(v)}
          disabled={disabled}
          className="space-y-2"
        >
          {flatOptions.map((o) => {
            const safeValue = String(o.value).replace(/[^a-zA-Z0-9-_]/g, "_")
            const radioId = `${fieldId}-${safeValue}`
            return (
              <div key={String(o.value)} className="flex items-center gap-2">
                <RadioGroupItem id={radioId} value={String(o.value)} />
                <Label
                  htmlFor={radioId}
                  className="text-sm font-normal cursor-pointer"
                >
                  {o.label}
                </Label>
              </div>
            )
          })}
        </RadioGroup>
      )

    case "checkbox":
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={fieldId}
            checked={Boolean(value)}
            onCheckedChange={(v) => onChange(Boolean(v))}
            disabled={disabled}
          />
          <Label
            htmlFor={fieldId}
            className="text-sm font-normal cursor-pointer"
          >
            {cfg.placeholder ?? cfg.label}
          </Label>
        </div>
      )

    case "switch":
      return (
        <Switch
          id={fieldId}
          checked={Boolean(value)}
          onCheckedChange={(v) => onChange(Boolean(v))}
          disabled={disabled}
        />
      )

    case "multiselect": {
      const msCfg = cfg as MultiSelectFieldConfig
      return (
        <MultiSelect
          id={fieldId}
          options={options}
          onValueChange={(next) => onChange(next)}
          defaultValue={
            Array.isArray(value) ? (value as Array<string | number>) : []
          }
          placeholder={cfg.placeholder ?? "Select options"}
          variant="default"
          maxCount={msCfg.maxCount ?? 3}
          disabled={disabled}
          getDescendantValues={msCfg.getDescendantValues}
        />
      )
    }

    case "autocomplete": {
      const acCfg = cfg as SelectFieldConfig
      return (
        <Autocomplete
          items={flatOptions}
          value={value as string | number | null}
          onValueChange={(nextValue) => {
            if (typeof nextValue === "object" && nextValue !== null) {
              onChange((nextValue as FieldOption).value)
            } else {
              onChange(nextValue)
            }
          }}
          placeholder={cfg.placeholder ?? "Search..."}
          disabled={disabled}
        >
          <AutocompleteTrigger id={fieldId} onBlur={onBlur} />
          <AutocompleteContent>
            <AutocompleteEmpty>
              {acCfg.emptyIndicator ?? "No results found."}
            </AutocompleteEmpty>
            <AutocompleteList />
          </AutocompleteContent>
        </Autocomplete>
      )
    }

    case "color":
      return (
        <ColorPicker
          id={fieldId}
          value={value as string}
          onChange={onChange}
          disabled={disabled}
        />
      )

    default: {
      // Module-specific types render via their registered handler —
      // Feature modules may register custom field types; unknown types warn in dev.
      const CustomRenderer = getCustomFieldRenderer(cfg.type)
      if (CustomRenderer) {
        return (
          <CustomRenderer
            cfg={
              cfg as Record<string, unknown> & { name: string; label: string }
            }
            fieldId={fieldId}
            value={value}
            onChange={(v) => onChange(v as FieldValue)}
            disabled={disabled}
            formValues={formValues}
            labelledBy={labelledBy}
          />
        )
      }
      if (import.meta.env?.DEV) {
        console.warn(
          `[FieldRenderer] No renderer for field type "${cfg.type}" (field "${cfg.name}")`
        )
      }
      return null
    }
  }
}
