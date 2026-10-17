// Grid utilities for column span handling

type ColSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

const COL_SPAN_MAP: Record<ColSpan, string> = {
  1: "col-span-12 md:col-span-1",
  2: "col-span-12 md:col-span-2",
  3: "col-span-12 md:col-span-3",
  4: "col-span-12 md:col-span-4",
  5: "col-span-12 md:col-span-5",
  6: "col-span-12 md:col-span-6",
  7: "col-span-12 md:col-span-7",
  8: "col-span-12 md:col-span-8",
  9: "col-span-12 md:col-span-9",
  10: "col-span-12 md:col-span-10",
  11: "col-span-12 md:col-span-11",
  12: "col-span-12 md:col-span-12",
}

/**
 * Get Tailwind column span class
 */
export function colSpanClass(span: number): string {
  return COL_SPAN_MAP[span as ColSpan] ?? "md:col-span-12"
}

/**
 * Alias for getColSpanClass
 */
export const getColSpanClass = colSpanClass

/**
 * Clamp value between min and max
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max)
}
