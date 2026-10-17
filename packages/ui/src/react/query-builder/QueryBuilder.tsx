import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { Search, X, Filter } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible"
import { cn } from "../../core/cn"
import { QueryGroup } from "./parts/QueryGroup"
import { useQueryBuilder } from "../../core/query/useQueryBuilder"
import { zodToFilterFields } from "../../core/query/zodToFilterFields"
import { translateListOperator } from "../../core/query/listOperators"
import {
  formatHotkey,
  isAltEnterSubmit,
  normaliseHotkey,
  useGlobalHotkeys,
} from "../../core/menu/hotKeys"
import { hotkeyClasses } from "../../core/menu/constants"
import { useTranslation } from "react-i18next"
import type {
  FilterField,
  FilterValue,
  QueryBuilderProps,
} from "../../core/query/types"
import { EmptyState } from "../feedback/EmptyState"
import { ValueInput } from "./parts/ValueInput"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"

type QueryBuilderMode = "advanced" | "simple"

import {
  FILTER_MODE_STORAGE_PREFIX,
  FILTER_STATE_STORAGE_PREFIX,
} from "../../core/query/queryBuilderStorage"

function hasUsableInitialValue(
  value: QueryBuilderProps["initialValue"]
): boolean {
  if (!value || typeof value !== "object") return false
  const typed = value as {
    conditions?: unknown[]
    search?: string
  }
  if (Array.isArray(typed.conditions) && typed.conditions.length > 0)
    return true
  if (typeof typed.search === "string" && typed.search.trim().length > 0)
    return true
  return false
}

function buildStorageScopeKey(fields: FilterField[]): string {
  const path =
    typeof window !== "undefined" ? window.location.pathname : "global"
  const schemaSignature = fields
    .map((field) => `${field.id}:${field.type}`)
    .sort()
    .join("|")
  return `${path}::${schemaSignature}`
}

function readStoredMode(scopeKey: string): QueryBuilderMode | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(
    `${FILTER_MODE_STORAGE_PREFIX}${scopeKey}`
  )
  if (raw === "advanced" || raw === "simple") return raw
  return null
}

function writeStoredMode(scopeKey: string, mode: QueryBuilderMode): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(`${FILTER_MODE_STORAGE_PREFIX}${scopeKey}`, mode)
}

function readStoredFilterState(
  scopeKey: string
): (Record<string, unknown> & { search?: string }) | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(
    `${FILTER_STATE_STORAGE_PREFIX}${scopeKey}`
  )
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function writeStoredFilterState(
  scopeKey: string,
  payload: Record<string, unknown>
): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(
    `${FILTER_STATE_STORAGE_PREFIX}${scopeKey}`,
    JSON.stringify(payload)
  )
}

function clearStoredFilterState(scopeKey: string): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(`${FILTER_STATE_STORAGE_PREFIX}${scopeKey}`)
}

function getFixedOperatorForField(field: FilterField): string {
  const operators = field.operators.map((operator) => operator.value)

  const pick = (preferred: string[]): string | undefined =>
    preferred.find((value) => operators.includes(value))

  switch (field.type) {
    case "text":
    case "email":
      return (
        pick(["contains", "equals"]) ?? field.operators[0]?.value ?? "equals"
      )
    case "number":
    case "select":
    case "date":
    case "time":
      return pick(["equals"]) ?? field.operators[0]?.value ?? "equals"
    case "multiselect":
      return (
        pick(["includesAny", "equals"]) ??
        field.operators[0]?.value ??
        "includesAny"
      )
    case "boolean":
    case "switch":
      return pick(["isTrue", "equals"]) ?? field.operators[0]?.value ?? "isTrue"
    default:
      return field.operators[0]?.value ?? "equals"
  }
}

function isSimpleEmptyValue(value: FilterValue): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim() === ""
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === "object" && "from" in value && "to" in value) {
    const from = typeof value.from === "string" ? value.from.trim() : ""
    const to = typeof value.to === "string" ? value.to.trim() : ""
    return from === "" && to === ""
  }
  return false
}

function toSimpleInitialValues(args: {
  fields: FilterField[]
  initialValue: QueryBuilderProps["initialValue"]
}): Record<string, FilterValue> {
  const values: Record<string, FilterValue> = {}

  for (const field of args.fields) {
    values[field.id] = field.type === "multiselect" ? [] : null
  }

  if (!args.initialValue || typeof args.initialValue !== "object") {
    return values
  }

  const maybeGroup = args.initialValue as {
    conditions?: Array<Record<string, unknown>>
  }

  const conditions = Array.isArray(maybeGroup.conditions)
    ? maybeGroup.conditions
    : []

  for (const condition of conditions) {
    const fieldId = typeof condition.field === "string" ? condition.field : null
    if (!fieldId || !(fieldId in values)) continue

    const field = args.fields.find((candidate) => candidate.id === fieldId)
    if (!field) continue

    const operator =
      typeof condition.operator === "string" ? condition.operator : ""
    const rawValue = condition.value as FilterValue

    if (field.type === "boolean" || field.type === "switch") {
      if (operator === "isTrue") {
        values[fieldId] = true
        continue
      }
      if (operator === "isFalse") {
        values[fieldId] = false
        continue
      }
      if (typeof rawValue === "boolean") {
        values[fieldId] = rawValue
      }
      continue
    }

    values[fieldId] = rawValue
  }

  return values
}

function buildSimpleConditions(args: {
  fields: FilterField[]
  values: Record<string, FilterValue>
  fixedOperators: Record<string, string>
}): Array<{ field: string; operator: string; value: FilterValue }> {
  return args.fields
    .map((field) => {
      const value = args.values[field.id]

      if (field.type === "boolean" || field.type === "switch") {
        if (value === true) {
          return {
            field: field.id,
            operator: "isTrue",
            value: null,
          }
        }

        if (value === false) {
          return {
            field: field.id,
            operator: "isFalse",
            value: null,
          }
        }

        return null
      }

      if (value === undefined || isSimpleEmptyValue(value)) {
        return null
      }

      // Simple mode uses fixed ABAC operators (multiselect → includesAny);
      // translate to the CRUD vocabulary the list endpoints accept, same as
      // the advanced path. Sending ABAC operators raw 400s (VALIDATION_ERROR).
      return {
        field: field.id,
        operator: translateListOperator(
          args.fixedOperators[field.id] ?? "equals"
        ),
        value,
      }
    })
    .filter(
      (condition): condition is NonNullable<typeof condition> =>
        condition !== null
    )
}

/**
 * QueryBuilder - Visual filter builder from Zod schemas
 */
export function QueryBuilder({
  schema,
  onSubmit,
  ui,
  className,
  disabled = false,
  defaultOpen = false,
  initialValue,
  translationNamespace,
  embedded = false,
  headerLeft,
}: QueryBuilderProps): React.ReactElement | null {
  const { t } = useTranslation()
  const fields = useMemo(() => zodToFilterFields(schema), [schema])
  const allowedModes = useMemo(() => {
    const modes = ui?.allowedModes?.filter(
      (mode): mode is QueryBuilderMode =>
        mode === "simple" || mode === "advanced"
    )
    if (!modes || modes.length === 0)
      return ["simple", "advanced"] as QueryBuilderMode[]
    return Array.from(new Set(modes))
  }, [ui?.allowedModes])
  const defaultMode: QueryBuilderMode = allowedModes.includes(
    ui?.defaultMode ?? "simple"
  )
    ? (ui?.defaultMode ?? "simple")
    : (allowedModes[0] ?? "simple")
  const showModeToggle = (ui?.showModeToggle ?? true) && allowedModes.length > 1
  const persistMode = ui?.persistMode ?? true
  const storageScopeKey = useMemo(() => buildStorageScopeKey(fields), [fields])
  const effectiveInitialValue = useMemo(() => {
    if (hasUsableInitialValue(initialValue)) {
      return initialValue
    }
    return readStoredFilterState(storageScopeKey) ?? initialValue
  }, [initialValue, storageScopeKey])
  const [activeMode, setActiveMode] = useState<QueryBuilderMode>(() => {
    if (!persistMode) return defaultMode
    const stored = readStoredMode(storageScopeKey)
    return stored && allowedModes.includes(stored) ? stored : defaultMode
  })
  const isSimpleMode = activeMode === "simple"

  // Filter panel open state (Alt+K). Controlled so the hotkey can open it;
  // the trigger toggles through onOpenChange as before.
  const [panelOpen, setPanelOpen] = useState(defaultOpen)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const focusSearchOnOpenRef = useRef(false)

  useEffect(() => {
    if (panelOpen && focusSearchOnOpenRef.current) {
      focusSearchOnOpenRef.current = false
      searchInputRef.current?.focus()
    }
  }, [panelOpen])

  const openFilterPanel = useCallback(() => {
    focusSearchOnOpenRef.current = true
    setPanelOpen(true)
    // Already open: the effect above won't rerun, so focus now. When
    // closed, the ref is unmounted and the effect focuses after opening.
    queueMicrotask(() => {
      if (searchInputRef.current) {
        focusSearchOnOpenRef.current = false
        searchInputRef.current.focus()
      }
    })
  }, [])

  const filterHotkeyMap = useMemo(() => {
    if (embedded || disabled || fields.length === 0) {
      return new Map<string, () => void>()
    }
    return new Map<string, () => void>([
      [normaliseHotkey("alt+k"), openFilterPanel],
    ])
  }, [embedded, disabled, fields.length, openFilterPanel])
  useGlobalHotkeys(filterHotkeyMap)

  const fixedOperators = useMemo(() => {
    const map: Record<string, string> = {}
    for (const field of fields) {
      map[field.id] = getFixedOperatorForField(field)
    }
    return map
  }, [fields])

  const {
    query,
    updateCondition,
    addCondition,
    removeCondition,
    addGroup,
    removeGroup,
    toggleGroupLogic,
    clearQuery,
    buildFilterOutput,
    hasConditions,
  } = useQueryBuilder(fields, { initialQuery: effectiveInitialValue })

  const [simpleValues, setSimpleValues] = useState<Record<string, FilterValue>>(
    () => toSimpleInitialValues({ fields, initialValue: effectiveInitialValue })
  )

  const [search, setSearch] = useState(
    (effectiveInitialValue as { search?: string })?.search ?? ""
  )
  const submitRef = useRef(onSubmit)
  const lastEmbeddedPayloadRef = useRef<string | null>(null)

  useEffect(() => {
    submitRef.current = onSubmit
  }, [onSubmit])

  useEffect(() => {
    if (!persistMode) {
      setActiveMode(defaultMode)
      return
    }
    const stored = readStoredMode(storageScopeKey)
    if (stored && allowedModes.includes(stored)) {
      setActiveMode(stored)
      return
    }
    setActiveMode(defaultMode)
  }, [defaultMode, persistMode, storageScopeKey, allowedModes])

  const handleModeChange = (nextMode: QueryBuilderMode) => {
    if (!allowedModes.includes(nextMode)) return
    setActiveMode(nextMode)
    if (persistMode) {
      writeStoredMode(storageScopeKey, nextMode)
    }
  }

  const handleSubmit = () => {
    if (isSimpleMode) {
      const conditions = buildSimpleConditions({
        fields,
        values: simpleValues,
        fixedOperators,
      })

      const payload = { logic: "AND" as const, conditions, search }
      writeStoredFilterState(storageScopeKey, payload)
      onSubmit?.(payload)
      return
    }

    const filters = buildFilterOutput()
    const payload = { ...filters, search }
    writeStoredFilterState(storageScopeKey, payload)
    onSubmit?.(payload)
  }

  const handleClear = () => {
    if (isSimpleMode) {
      const next: Record<string, FilterValue> = {}
      for (const field of fields) {
        next[field.id] = field.type === "multiselect" ? [] : null
      }
      setSimpleValues(next)
    } else {
      clearQuery()
    }
    setSearch("")
    clearStoredFilterState(storageScopeKey)
    onSubmit?.(null)
  }

  useEffect(() => {
    if (!embedded) return

    if (isSimpleMode) {
      const conditions = buildSimpleConditions({
        fields,
        values: simpleValues,
        fixedOperators,
      })

      const payload = { logic: "AND" as const, conditions, search: "" }
      const serialized = JSON.stringify(payload)
      if (lastEmbeddedPayloadRef.current === serialized) return
      lastEmbeddedPayloadRef.current = serialized
      writeStoredFilterState(storageScopeKey, payload)
      submitRef.current?.(payload)
      return
    }

    const filters = buildFilterOutput()
    const payload = { ...filters, search: "" }
    const serialized = JSON.stringify(payload)
    if (lastEmbeddedPayloadRef.current === serialized) return
    lastEmbeddedPayloadRef.current = serialized
    writeStoredFilterState(storageScopeKey, payload)
    submitRef.current?.(payload)
  }, [
    embedded,
    isSimpleMode,
    query,
    buildFilterOutput,
    fields,
    simpleValues,
    fixedOperators,
    storageScopeKey,
  ])

  const hasSimpleConditions = useMemo(
    () =>
      fields.some((field) => {
        const value = simpleValues[field.id]
        if (field.type === "boolean" || field.type === "switch") {
          return value === true || value === false
        }
        return value !== undefined && !isSimpleEmptyValue(value)
      }),
    [fields, simpleValues]
  )

  const effectiveHasConditions = isSimpleMode
    ? hasSimpleConditions
    : hasConditions

  // Applied (last-submitted) filters come in live via the `initialValue` prop.
  // Buttons must stay enabled while applied filters exist even after the draft
  // is emptied by hand — otherwise the emptied state can never be submitted
  // and the stale applied filter is stuck on the table.
  const hasAppliedFilters = hasUsableInitialValue(initialValue)
  const hasDraftContent = effectiveHasConditions || !!search?.trim()
  const hasActionableFilters = hasDraftContent || hasAppliedFilters

  const handleSimpleValueChange = (fieldId: string, value: FilterValue) => {
    setSimpleValues((prev) => ({
      ...prev,
      [fieldId]: value,
    }))
  }

  // Alt+Enter submits from anywhere in the panel, including focused inputs
  // (the global engine skips those by design). Plain Enter in textareas
  // still inserts a newline.
  const handlePanelKeyDown = (e: KeyboardEvent) => {
    if (!isAltEnterSubmit(e)) return
    if (disabled || !hasActionableFilters) return
    e.preventDefault()
    handleSubmit()
  }

  if (fields.length === 0) {
    return (
      <EmptyState
        title={t("querybuilder.no_filters", {
          defaultValue: "No filters available",
        })}
        description={t("querybuilder.no_filters_desc", {
          defaultValue: "This dataset does not expose filterable fields yet.",
        })}
      />
    )
  }

  const content = (
    <div
      className="space-y-4 rounded-xl bg-card shadow-md p-3 sm:p-4"
      onKeyDown={handlePanelKeyDown}
    >
      <div
        className={cn(
          "flex flex-col gap-2 sm:flex-row sm:items-center",
          embedded && "sm:justify-end"
        )}
      >
        {!embedded && (
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("common.search", { defaultValue: "Search..." })}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
              ref={searchInputRef}
            />
          </div>
        )}

        {showModeToggle && (
          <div className="inline-flex rounded-md bg-muted p-1">
            <Button
              type="button"
              size="sm"
              variant={activeMode === "simple" ? "secondary" : "ghost"}
              onClick={() => handleModeChange("simple")}
              disabled={disabled}
              className="h-7 px-2.5"
            >
              {t("querybuilder.simple", { defaultValue: "Simple" })}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeMode === "advanced" ? "secondary" : "ghost"}
              onClick={() => handleModeChange("advanced")}
              disabled={disabled}
              className="h-7 px-2.5"
            >
              {t("querybuilder.advanced", { defaultValue: "Advanced" })}
            </Button>
          </div>
        )}
      </div>

      {isSimpleMode ? (
        <div className="rounded-lg bg-muted/30 p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {fields.map((field) => {
              const rawValue = simpleValues[field.id]
              const fixedOperator = fixedOperators[field.id] ?? "equals"

              return (
                <div key={field.id} className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground">
                    {translationNamespace
                      ? t(`${translationNamespace}.fields.${field.id}.label`, {
                          defaultValue: field.label,
                        })
                      : field.label}
                  </label>

                  {field.type === "boolean" || field.type === "switch" ? (
                    <Select
                      value={
                        rawValue === true
                          ? "true"
                          : rawValue === false
                            ? "false"
                            : "any"
                      }
                      onValueChange={(next) => {
                        if (next === "true") {
                          handleSimpleValueChange(field.id, true)
                          return
                        }
                        if (next === "false") {
                          handleSimpleValueChange(field.id, false)
                          return
                        }
                        handleSimpleValueChange(field.id, null)
                      }}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue placeholder="Any" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="true">True</SelectItem>
                        <SelectItem value="false">False</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <ValueInput
                      field={field}
                      operator={fixedOperator}
                      value={rawValue ?? null}
                      onChange={(next) =>
                        handleSimpleValueChange(field.id, next)
                      }
                      disabled={disabled}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <QueryGroup
          group={query}
          fields={fields}
          onUpdateCondition={updateCondition}
          onAddCondition={addCondition}
          onRemoveCondition={removeCondition}
          onAddGroup={addGroup}
          onRemoveGroup={removeGroup}
          onToggleLogic={toggleGroupLogic}
          isRoot={true}
          disabled={disabled}
          translationNamespace={translationNamespace}
        />
      )}

      {!embedded && (
        <div className="flex flex-col-reverse gap-2 border-t border-border/50 pt-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={disabled || !hasActionableFilters}
            className="w-full text-muted-foreground sm:w-auto"
          >
            <X size={14} className="mr-1" />
            {t("common.clear", { defaultValue: "Clear" })}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={disabled || !hasActionableFilters}
            className="w-full gap-2 sm:w-auto"
            title={t("common.filter", { defaultValue: "Filter" })}
          >
            <Search size={14} />
            {t("common.filter", { defaultValue: "Filter" })}
            <kbd
              className={`${hotkeyClasses} hidden sm:inline`}
              aria-hidden="true"
            >
              {formatHotkey("alt+enter")}
            </kbd>
          </Button>
        </div>
      )}
    </div>
  )

  if (embedded) {
    return <div className={cn("w-full", className)}>{content}</div>
  }

  return (
    <Collapsible
      open={panelOpen}
      onOpenChange={setPanelOpen}
      className={cn("w-full", className)}
    >
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-center mb-3",
          headerLeft ? "sm:justify-between" : "justify-end"
        )}
      >
        {headerLeft && <div className="flex-1">{headerLeft}</div>}
        <div className="flex items-center justify-end">
          <CollapsibleTrigger
            render={<Button variant="outline" size="sm" className="gap-2" />}
          >
            <Filter size={14} />
            {t("common.filter", { defaultValue: "Filters" })}
            <kbd
              className={`${hotkeyClasses} hidden sm:inline`}
              aria-hidden="true"
            >
              {formatHotkey("alt+k")}
            </kbd>
            {hasActionableFilters && (
              <span className="h-2 w-2 rounded-full bg-primary" />
            )}
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>{content}</CollapsibleContent>
    </Collapsible>
  )
}
