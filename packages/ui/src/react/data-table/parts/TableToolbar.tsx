import {
  RefreshCw,
  Settings,
  ChevronDown,
  Plus,
  FileText,
  FileBarChart2,
  FileSpreadsheet,
  Download,
  Loader2,
} from "lucide-react"
import { Button } from "../../ui/button"
import { Checkbox } from "../../ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../ui/dropdown-menu"
import { useTranslation } from "react-i18next"
import type { RowData } from "@tanstack/react-table"
import type { TableToolbarProps, ColumnMeta } from "../../../core/table/types"
import type { ReactNode } from "react"
import { formatHotkey } from "../../../core/menu/hotKeys"
import { hotkeyClasses } from "../../../core/menu/constants"
import { cn } from "../../../core/cn"

interface ExtendedColumnMeta extends ColumnMeta {
  label?: string
}

function getExportIcon(key: string, customIcon?: ReactNode) {
  if (customIcon) return customIcon
  switch (key) {
    case "pdf":
      return <FileText size={16} />
    case "csv":
      return <FileBarChart2 size={16} />
    case "excel":
      return <FileSpreadsheet size={16} />
    default:
      return <Download size={16} />
  }
}

export function TableToolbar<TData extends RowData>({
  table,
  onRefresh,
  onAdd,
  addButtonText = "Add Item",
  showColumnMenu = true,
  visibilityState,
  nonHideableColumns,
  exports,
  onExport,
  isExporting,
  translationNamespace,
  classNames,
}: TableToolbarProps<TData>): React.ReactElement {
  const { t } = useTranslation()
  const hasExports = exports && Object.keys(exports).length > 0

  return (
    <div
      className={cn(
        "flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto",
        classNames?.toolbar
      )}
    >
      {/* Utilities Group (Columns, Export, Refresh) */}
      <div
        className={cn(
          "flex items-center gap-1.5 sm:gap-2",
          classNames?.toolbarButtons
        )}
      >
        {showColumnMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  className={cn(
                    "size-9 p-0 sm:h-9 sm:w-auto sm:px-3 gap-1.5 cursor-pointer",
                    classNames?.columnMenuButton
                  )}
                  title={t("common.columns", { defaultValue: "Columns" })}
                />
              }
            >
              <Settings size={15} />
              <span className="hidden sm:inline">
                {t("common.columns", { defaultValue: "Columns" })}
              </span>
              <ChevronDown size={14} className="hidden sm:inline opacity-70" />
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="start"
              aria-label={t("common.columns", { defaultValue: "Columns" })}
              className={cn(
                "w-56 p-2 max-h-64 overflow-y-auto",
                classNames?.columnMenuContent
              )}
            >
              {table
                .getAllLeafColumns()
                .filter((col) => !nonHideableColumns?.has(col.id))
                .map((col) => {
                  const isVisible = visibilityState
                    ? (visibilityState[col.id] ?? true)
                    : col.getIsVisible()

                  const checkboxId = `column-${col.id}`
                  const meta = col.columnDef.meta as
                    ExtendedColumnMeta | undefined
                  const headerValue = col.columnDef.header
                  const label =
                    meta?.label ??
                    (translationNamespace && typeof col.id === "string"
                      ? t(`${translationNamespace}.columns.${col.id}`, {
                          defaultValue:
                            typeof headerValue === "string"
                              ? headerValue
                              : col.id,
                        })
                      : typeof headerValue === "string"
                        ? headerValue
                        : col.id)

                  return (
                    <div
                      key={`${col.id}-${String(isVisible)}`}
                      className={cn("px-2 py-1.5", classNames?.columnMenuItem)}
                    >
                      <label
                        htmlFor={checkboxId}
                        className={cn(
                          "flex items-center space-x-2 text-sm cursor-pointer capitalize",
                          classNames?.columnMenuLabel
                        )}
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={isVisible}
                          onCheckedChange={(checked) => {
                            col.toggleVisibility(Boolean(checked))
                          }}
                        />
                        <span>{label}</span>
                      </label>
                    </div>
                  )
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {hasExports && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={Boolean(isExporting)}
              render={
                <Button
                  variant="outline"
                  className={cn(
                    "size-9 p-0 sm:h-9 sm:w-auto sm:px-3 gap-1.5 cursor-pointer",
                    classNames?.exportButton
                  )}
                  title={t("common.export", { defaultValue: "Export" })}
                />
              }
            >
              {isExporting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              <span className="hidden sm:inline">
                {t("common.export", { defaultValue: "Export" })}
              </span>
              <ChevronDown size={14} className="hidden sm:inline opacity-70" />
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="start"
              aria-label={t("common.export", { defaultValue: "Export" })}
              className={cn("w-48", classNames?.exportMenuContent)}
            >
              {Object.entries(exports).map(([key, config]) => {
                if (!config) return null
                const Icon = getExportIcon(key, config.icon)
                const label = config.label ?? key.toUpperCase()
                return (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => onExport?.(key)}
                    disabled={Boolean(isExporting)}
                    className={cn("cursor-pointer", classNames?.exportMenuItem)}
                  >
                    {Icon}
                    <span className="ml-2">{label}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={onRefresh}
          className={cn(
            "size-9 p-0 sm:h-9 sm:w-auto sm:px-3 gap-1.5 cursor-pointer",
            classNames?.refreshButton
          )}
          title={t("common.refresh", { defaultValue: "Refresh" })}
        >
          <RefreshCw size={15} />
          <span className="hidden sm:inline">
            {t("common.refresh", { defaultValue: "Refresh" })}
          </span>
        </Button>
      </div>

      {/* Primary Action (+ Add Item) */}
      {onAdd && (
        <Button
          type="button"
          onClick={onAdd}
          className={cn(
            "cursor-pointer size-9 p-0 sm:h-9 sm:w-auto sm:px-3 gap-1.5 shrink-0",
            classNames?.addButton
          )}
          title={`${addButtonText} (${formatHotkey("alt+n")})`}
        >
          <Plus size={16} />
          {typeof addButtonText === "string"
            ? addButtonText.replace(/^\+\s*/, "")
            : addButtonText}
          <kbd
            className={`${hotkeyClasses} hidden sm:inline`}
            aria-hidden="true"
          >
            {formatHotkey("alt+n")}
          </kbd>
        </Button>
      )}
    </div>
  )
}
