import { useEffect, useState } from "react"
import type {
  FilterCondition,
  FilterField,
  FilterGroup,
  FilterValue,
  QueryBuilderProps,
} from "./types"
import { useUiComponents, type UiComponents } from "../ui"

const defaultGroup = (): FilterGroup => ({ logic: "AND", conditions: [] })

function operatorValue(
  operator: string | { value: string; label: string }
): string {
  return typeof operator === "string" ? operator : operator.value
}

function operatorLabel(
  operator: string | { value: string; label: string }
): string {
  return typeof operator === "string" ? operator : operator.label
}

function isGroup(value: FilterCondition | FilterGroup): value is FilterGroup {
  return "conditions" in value
}

function newCondition(field?: FilterField): FilterCondition {
  return {
    field: field?.id ?? "",
    operator: field?.operators?.[0]
      ? operatorValue(field.operators[0])
      : "equals",
    value: "",
  }
}

function updateAtPath(
  group: FilterGroup,
  path: number[],
  update: (node: FilterCondition | FilterGroup) => FilterCondition | FilterGroup
): FilterGroup {
  if (path.length === 0) return update(group) as FilterGroup
  const [index, ...rest] = path
  return {
    ...group,
    conditions: group.conditions.map((node, nodeIndex) => {
      if (nodeIndex !== index) return node
      if (rest.length === 0) return update(node)
      if (!isGroup(node)) return node
      return updateAtPath(node, rest, update)
    }),
  }
}

function removeAtPath(group: FilterGroup, path: number[]): FilterGroup {
  if (path.length === 1) {
    return {
      ...group,
      conditions: group.conditions.filter((_, index) => index !== path[0]),
    }
  }
  const [index, ...rest] = path
  return {
    ...group,
    conditions: group.conditions.map((node, nodeIndex) =>
      nodeIndex === index && isGroup(node) ? removeAtPath(node, rest) : node
    ),
  }
}

function formatValue(value: FilterValue): string {
  if (value === null) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return Array.isArray(value) ? value.join(",") : String(value)
}

function ConditionEditor({
  condition,
  fields,
  onChange,
  onRemove,
  disabled,
  renderFieldValue,
  components,
}: {
  condition: FilterCondition
  fields: FilterField[]
  onChange: (value: FilterCondition) => void
  onRemove: () => void
  disabled: boolean
  renderFieldValue?: QueryBuilderProps["renderFieldValue"]
  components: UiComponents
}) {
  const { Button, Select, Input } = components
  const field = fields.find((item) => item.id === condition.field) ?? fields[0]
  const operators = field?.operators ?? ["equals", "contains"]
  const set = (patch: Partial<FilterCondition>) =>
    onChange({ ...condition, ...patch })
  return (
    <div className="ui__query-condition">
      <Select
        aria-label="Filter field"
        value={condition.field}
        options={fields.map((item) => ({ value: item.id, label: item.label }))}
        onChange={(value) =>
          set({ field: typeof value === "string" ? value : (value[0] ?? "") })
        }
      />
      <Select
        aria-label="Filter operator"
        value={condition.operator}
        options={operators.map((operator) => ({
          value: operatorValue(operator),
          label: operatorLabel(operator),
        }))}
        onChange={(value) =>
          set({
            operator: typeof value === "string" ? value : (value[0] ?? ""),
          })
        }
      />
      {renderFieldValue ? (
        renderFieldValue({
          field: field ?? { id: "", label: "" },
          value: condition.value,
          onChange: (value) => set({ value }),
          disabled,
        })
      ) : field?.options ? (
        <Select
          aria-label="Filter value"
          value={formatValue(condition.value)}
          options={[
            { value: "", label: "Select…" },
            ...field.options.map((option) => ({
              value: String(option.value),
              label: option.label,
            })),
          ]}
          onChange={(value) => set({ value })}
        />
      ) : (
        <Input
          aria-label="Filter value"
          value={formatValue(condition.value)}
          onChange={(event) => set({ value: event.target.value })}
        />
      )}
      <Button
        className="ui__button ui__button--danger"
        type="button"
        onClick={onRemove}
        disabled={disabled}
      >
        Remove
      </Button>
    </div>
  )
}

function GroupEditor({
  group,
  fields,
  path,
  allowNestedGroups,
  onChange,
  disabled,
  renderFieldValue,
  components,
}: {
  group: FilterGroup
  fields: FilterField[]
  path: number[]
  allowNestedGroups: boolean
  onChange: (
    path: number[],
    update: (
      node: FilterCondition | FilterGroup
    ) => FilterCondition | FilterGroup
  ) => void
  disabled: boolean
  renderFieldValue?: QueryBuilderProps["renderFieldValue"]
  components: UiComponents
}) {
  const { Button } = components
  return (
    <div className="ui__query-group">
      <div className="ui__query-condition">
        <strong>{path.length === 0 ? "Filters" : "Group"}</strong>
        <Button
          className="ui__button"
          type="button"
          onClick={() =>
            onChange(path, (node) => ({
              ...(node as FilterGroup),
              logic: (node as FilterGroup).logic === "AND" ? "OR" : "AND",
            }))
          }
        >
          Match {group.logic}
        </Button>
      </div>
      {group.conditions.map((node, index) =>
        isGroup(node) ? (
          <GroupEditor
            key={`group-${index}`}
            group={node}
            fields={fields}
            path={[...path, index]}
            allowNestedGroups={allowNestedGroups}
            onChange={onChange}
            disabled={disabled}
            renderFieldValue={renderFieldValue}
            components={components}
          />
        ) : (
          <ConditionEditor
            key={`condition-${index}`}
            condition={node}
            fields={fields}
            onChange={(next) => onChange([...path, index], () => next)}
            onRemove={() => onChange(path, () => removeAtPath(group, [index]))}
            disabled={disabled}
            renderFieldValue={renderFieldValue}
            components={components}
          />
        )
      )}
      <div className="ui__query-condition">
        <Button
          className="ui__button"
          type="button"
          onClick={() =>
            onChange(path, (node) => ({
              ...(node as FilterGroup),
              conditions: [
                ...(node as FilterGroup).conditions,
                newCondition(fields[0]),
              ],
            }))
          }
          disabled={disabled}
        >
          Add condition
        </Button>
        {allowNestedGroups && (
          <Button
            className="ui__button"
            type="button"
            onClick={() =>
              onChange(path, (node) => ({
                ...(node as FilterGroup),
                conditions: [
                  ...(node as FilterGroup).conditions,
                  defaultGroup(),
                ],
              }))
            }
            disabled={disabled}
          >
            Add group
          </Button>
        )}
      </div>
    </div>
  )
}

/** A recursive, controlled filter builder that emits a portable filter tree. */
export function QueryBuilder({
  fields,
  value,
  onChange,
  onSubmit,
  allowNestedGroups = true,
  className,
  components,
  disabled = false,
  defaultOpen = true,
  searchable = true,
  searchPlaceholder = "Search…",
  showModeToggle = true,
  initialMode = "advanced",
  persistKey,
  embedded = true,
  headerLeft,
  renderFieldValue,
}: QueryBuilderProps) {
  const resolvedComponents = useUiComponents(components)
  const { Button, Input, Select } = resolvedComponents
  const resolvedFieldValueRenderer =
    renderFieldValue ?? components?.renderFieldValue
  const [query, setQuery] = useState<FilterGroup>(() => {
    if (value) return value
    if (persistKey && typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(`${persistKey}:query`)
        if (stored) return JSON.parse(stored) as FilterGroup
      } catch {
        // Ignore invalid persisted state.
      }
    }
    return defaultGroup()
  })
  const [mode, setMode] = useState<"simple" | "advanced">(() => {
    if (persistKey && typeof window !== "undefined") {
      const stored = window.localStorage.getItem(`${persistKey}:mode`)
      if (stored === "simple" || stored === "advanced") return stored
    }
    return initialMode
  })
  const [open, setOpen] = useState(defaultOpen)
  const [search, setSearch] = useState("")
  const [simpleValues, setSimpleValues] = useState<Record<string, FilterValue>>(
    () => {
      const result: Record<string, FilterValue> = {}
      for (const field of fields)
        result[field.id] = field.type === "multiselect" ? [] : null
      return result
    }
  )

  useEffect(() => {
    if (value) setQuery(value)
  }, [value])

  function change(next: FilterGroup) {
    setQuery(next)
    onChange?.(next)
    if (persistKey && typeof window !== "undefined")
      window.localStorage.setItem(`${persistKey}:query`, JSON.stringify(next))
  }

  function submit() {
    if (mode === "simple") {
      const conditions: FilterCondition[] = []
      for (const field of fields) {
        const current = simpleValues[field.id]
        if (
          current !== null &&
          current !== undefined &&
          current !== "" &&
          (!Array.isArray(current) || current.length > 0)
        )
          conditions.push({
            field: field.id,
            operator: operatorValue(field.operators?.[0] ?? "equals"),
            value: current,
          })
      }
      onSubmit?.({ logic: "AND", conditions, search })
      return
    }
    onSubmit?.({ ...query, search })
  }

  function update(
    path: number[],
    updater: (
      node: FilterCondition | FilterGroup
    ) => FilterCondition | FilterGroup
  ) {
    change(updateAtPath(query, path, updater))
  }

  const visibleFields = fields.filter((field) =>
    field.label.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div className={`ui ${className ?? ""}`.trim()}>
      {!embedded && (
        <div className="ui__toolbar">
          <span>{headerLeft}</span>
          <Button type="button" onClick={() => setOpen((current) => !current)}>
            {open ? "Hide filters" : "Show filters"}
          </Button>
        </div>
      )}
      {open && (
        <>
          <div className="ui__toolbar">
            {searchable && (
              <Input
                aria-label="Filter search"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={disabled}
              />
            )}
            {showModeToggle && (
              <>
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setMode("simple")
                    if (persistKey)
                      window.localStorage.setItem(
                        `${persistKey}:mode`,
                        "simple"
                      )
                  }}
                >
                  Simple
                </Button>
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setMode("advanced")
                    if (persistKey)
                      window.localStorage.setItem(
                        `${persistKey}:mode`,
                        "advanced"
                      )
                  }}
                >
                  Advanced
                </Button>
              </>
            )}
          </div>
          {mode === "simple" ? (
            <div className="ui__query-group">
              {visibleFields.map((field) => (
                <div className="ui__query-condition" key={field.id}>
                  <label>{field.label}</label>
                  {resolvedFieldValueRenderer ? (
                    resolvedFieldValueRenderer({
                      field,
                      value: simpleValues[field.id] ?? null,
                      onChange: (next) =>
                        setSimpleValues((current) => ({
                          ...current,
                          [field.id]: next,
                        })),
                      disabled,
                    })
                  ) : field.options ? (
                    <Select
                      aria-label={field.label}
                      value={formatValue(simpleValues[field.id] ?? null)}
                      options={[
                        { value: "", label: "Any" },
                        ...field.options.map((option) => ({
                          value: String(option.value),
                          label: option.label,
                        })),
                      ]}
                      onChange={(next) =>
                        setSimpleValues((current) => ({
                          ...current,
                          [field.id]: next,
                        }))
                      }
                    />
                  ) : (
                    <Input
                      aria-label={field.label}
                      value={formatValue(simpleValues[field.id] ?? null)}
                      onChange={(event) =>
                        setSimpleValues((current) => ({
                          ...current,
                          [field.id]: event.target.value,
                        }))
                      }
                      disabled={disabled}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <GroupEditor
              group={query}
              fields={fields}
              path={[]}
              allowNestedGroups={allowNestedGroups}
              onChange={update}
              disabled={disabled}
              renderFieldValue={resolvedFieldValueRenderer}
              components={resolvedComponents}
            />
          )}
        </>
      )}
      <div className="ui__toolbar">
        <Button
          className="ui__button ui__button--primary"
          type="button"
          onClick={submit}
          disabled={disabled}
        >
          Apply
        </Button>
        <Button
          className="ui__button"
          type="button"
          onClick={() => {
            change(defaultGroup())
            setSimpleValues({})
            setSearch("")
            if (persistKey && typeof window !== "undefined")
              window.localStorage.removeItem(`${persistKey}:query`)
          }}
          disabled={disabled}
        >
          Clear
        </Button>
      </div>
    </div>
  )
}
