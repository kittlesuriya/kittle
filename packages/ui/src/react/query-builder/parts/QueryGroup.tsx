import { Plus, FolderPlus, Trash2 } from "lucide-react"
import { Button } from "../../ui/button"
import { cn } from "../../../core/cn"
import { QueryCondition } from "./QueryCondition"
import { useTranslation } from "react-i18next"
import type { QueryGroupProps } from "../../../core/query/types"

/**
 * QueryGroup component for grouping conditions with AND/OR logic
 */
export function QueryGroup({
  group,
  fields,
  onUpdateCondition,
  onAddCondition,
  onRemoveCondition,
  onAddGroup,
  onRemoveGroup,
  onToggleLogic,
  isRoot = false,
  disabled,
  translationNamespace,
  depth = 0,
}: QueryGroupProps): React.ReactElement {
  const { t } = useTranslation()
  const maxDepth = 2

  return (
    <div
      className={cn(
        "rounded-lg",
        isRoot ? "bg-muted/30" : "bg-muted/50",
        depth === 1 && "ml-2 border-l-4 border-l-primary/30 sm:ml-6",
        depth === 2 && "ml-2 border-l-4 border-l-secondary/50 sm:ml-6"
      )}
    >
      <div className="flex flex-wrap items-center gap-2 rounded-t-lg border-b border-border/50 bg-muted/50 px-3 py-2 sm:gap-3 sm:px-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onToggleLogic(group.id)}
          disabled={disabled}
          className={cn(
            "h-7 px-3 font-medium text-xs",
            group.logic === "AND"
              ? "bg-primary/10 text-primary border-primary/30"
              : "bg-secondary text-secondary-foreground border-secondary"
          )}
        >
          {group.logic === "AND"
            ? t("querybuilder.and", { defaultValue: "AND" })
            : t("querybuilder.or", { defaultValue: "OR" })}
        </Button>

        <span className="min-w-[10rem] flex-1 text-xs text-muted-foreground sm:text-sm">
          {group.logic === "AND"
            ? t("querybuilder.match_all", {
                defaultValue: "Match all conditions",
              })
            : t("querybuilder.match_any", {
                defaultValue: "Match any condition",
              })}
        </span>

        <div className="flex-1" />

        {!isRoot && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemoveGroup(group.id)}
            disabled={disabled}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>

      <div className="space-y-2 p-2.5 sm:p-3">
        {group.conditions.length === 0 ? (
          <div className="text-center py-4 text-sm text-muted-foreground">
            {t("querybuilder.no_conditions", {
              defaultValue: "No conditions. Add one below.",
            })}
          </div>
        ) : (
          group.conditions.map((item) => {
            if (item.type === "group") {
              return (
                <QueryGroup
                  key={item.id}
                  group={item}
                  fields={fields}
                  onUpdateCondition={onUpdateCondition}
                  onAddCondition={onAddCondition}
                  onRemoveCondition={onRemoveCondition}
                  onAddGroup={onAddGroup}
                  onRemoveGroup={onRemoveGroup}
                  onToggleLogic={onToggleLogic}
                  isRoot={false}
                  disabled={disabled}
                  translationNamespace={translationNamespace}
                  depth={depth + 1}
                />
              )
            }

            return (
              <QueryCondition
                key={item.id}
                condition={item}
                fields={fields}
                onUpdate={(id, updates) => onUpdateCondition(id, updates)}
                onRemove={() => onRemoveCondition(item.id)}
                disabled={disabled}
                translationNamespace={translationNamespace}
              />
            )
          })
        )}
      </div>

      <div className="flex flex-col items-stretch gap-2 rounded-b-lg border-t border-border/50 bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:px-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onAddCondition(group.id)}
          disabled={disabled}
          className="h-8 w-full text-primary hover:bg-primary/10 hover:text-primary sm:w-auto"
        >
          <Plus size={14} className="mr-1" />
          {t("querybuilder.add_condition", { defaultValue: "Add condition" })}
        </Button>

        {depth < maxDepth && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onAddGroup(group.id, group.logic === "AND" ? "OR" : "AND")
            }
            disabled={disabled}
            className="h-8 w-full text-muted-foreground hover:text-foreground sm:w-auto"
          >
            <FolderPlus size={14} className="mr-1" />
            {t("querybuilder.add_group", { defaultValue: "Add group" })}
          </Button>
        )}
      </div>
    </div>
  )
}
