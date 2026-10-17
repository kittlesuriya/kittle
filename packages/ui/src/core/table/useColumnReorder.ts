import type { ReactTable, RowData } from "@tanstack/react-table"
import type { SetStateAction, Dispatch } from "react"
import type { ColumnDropPosition, TableState } from "./types"
import type { DataTableFeatures } from "./features"

/**
 * Hook for handling column reordering via drag and drop.
 * The dragged column's leaf columns are moved immediately before (default)
 * or after the target column, keeping grouped columns intact.
 */
export function useColumnReorder<TData extends RowData>(
  setTableState: Dispatch<SetStateAction<TableState>>,
  leafIds: string[],
  table: ReactTable<DataTableFeatures, TData>
): (sourceId: string, targetId: string, position?: ColumnDropPosition) => void {
  return (sourceId, targetId, position = "before") => {
    setTableState((prev) => {
      const current =
        prev.columnOrder.length > 0 ? [...prev.columnOrder] : [...leafIds]

      const getLeafsForId = (id: string): string[] => {
        const col = table.getColumn(id)
        if (!col) return []
        return col.getLeafColumns().map((colItem) => colItem.id)
      }

      const sourceLeafs = getLeafsForId(sourceId)
      const targetLeafs = getLeafsForId(targetId)

      if (!sourceLeafs.length || !targetLeafs.length) return prev

      const newOrder = current.filter((id) => !sourceLeafs.includes(id))

      let targetIndex: number
      if (position === "after") {
        // Insert after the LAST target leaf still present in the order so
        // grouped targets keep their children on the correct side.
        const indices = targetLeafs
          .map((id) => newOrder.indexOf(id))
          .filter((index) => index >= 0)
        targetIndex =
          indices.length > 0 ? Math.max(...indices) + 1 : newOrder.length
      } else {
        const firstTargetId = targetLeafs[0]
        targetIndex = firstTargetId ? newOrder.indexOf(firstTargetId) : -1
        if (targetIndex === -1) targetIndex = newOrder.length
      }

      newOrder.splice(targetIndex, 0, ...sourceLeafs)

      return { ...prev, columnOrder: newOrder }
    })
  }
}
