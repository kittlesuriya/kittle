import { useTranslation } from "react-i18next"
import type { TableEmptyStateProps } from "../../../core/table/types"
import { EmptyState } from "../../feedback/EmptyState"
import { cn } from "../../../core/cn"

/**
 * TableEmptyState component displayed when no data is available
 */
export function TableEmptyState({
  colSpan,
  message,
  hasFilters,
  onAddClick,
  addButtonLabel,
  className,
  classNames,
}: TableEmptyStateProps): React.ReactElement {
  const { t } = useTranslation()
  const title = hasFilters
    ? t("common.no_results", { defaultValue: "No matching results" })
    : t("common.no_data", { defaultValue: "No data yet" })
  const description =
    message ??
    (hasFilters
      ? t("common.no_results_desc", {
          defaultValue:
            "No records match your current filters. Try adjusting your search criteria.",
        })
      : t("common.no_data_desc", {
          defaultValue: "Get started by creating your first record.",
        }))

  return (
    <tbody>
      <tr>
        <td
          colSpan={colSpan}
          className={cn(
            "p-0 bg-card border-b rounded-b-lg overflow-hidden",
            className
          )}
        >
          <EmptyState
            title={title}
            description={description}
            variant={hasFilters ? "search" : "default"}
            classNames={classNames}
            action={
              onAddClick
                ? {
                    label:
                      addButtonLabel ??
                      t("common.add_new", { defaultValue: "Add New" }),
                    onClick: onAddClick,
                  }
                : undefined
            }
          />
        </td>
      </tr>
    </tbody>
  )
}
