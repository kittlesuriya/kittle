import * as React from "react"
import {
  format,
  addMonths,
  subMonths,
  addYears,
  subYears,
  setMonth as setDateMonth,
  setYear as setDateYear,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  getYear,
  getMonth,
  addDays,
} from "date-fns"
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { Button, buttonVariants } from "../ui/button"
import { cn } from "../../core/cn"
import { useUiRuntime } from "../../core/runtime"

interface DatePickerProps {
  id?: string
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  fromYear?: number
  toYear?: number
}

type ViewMode = "days" | "months" | "years"

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

export function DatePicker({
  id,
  value,
  onChange,
  disabled,
  className,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<ViewMode>("days")
  const { formatDate } = useUiRuntime().formatDate.useTenantDateFormatter()

  const selectedDate = React.useMemo(() => {
    if (!value) return undefined
    const d = new Date(value)
    return isNaN(d.getTime()) ? undefined : d
  }, [value])

  const [viewDate, setViewDate] = React.useState<Date>(
    () => selectedDate ?? new Date()
  )
  const [yearPageStart, setYearPageStart] = React.useState<number>(() => {
    const y = getYear(selectedDate ?? new Date())
    return Math.floor(y / 12) * 12
  })

  // Keep viewDate in sync when opened or when value changes
  React.useEffect(() => {
    if (selectedDate) {
      setViewDate(selectedDate)
      setYearPageStart(Math.floor(getYear(selectedDate) / 12) * 12)
    }
  }, [selectedDate])

  // Reset to "days" mode when popover closes
  const handleOpenChange = (open: boolean) => {
    if (disabled) return
    setIsOpen(open)
    if (!open) {
      setViewMode("days")
    } else {
      const target = selectedDate ?? new Date()
      setViewDate(target)
      setYearPageStart(Math.floor(getYear(target) / 12) * 12)
    }
  }

  const handleSelectDay = (day: Date) => {
    onChange(format(day, "yyyy-MM-dd"))
    setIsOpen(false)
  }

  const handleSelectMonth = (monthIndex: number) => {
    const nextDate = setDateMonth(viewDate, monthIndex)
    setViewDate(nextDate)
    setViewMode("days")
  }

  const handleSelectYear = (year: number) => {
    const nextDate = setDateYear(viewDate, year)
    setViewDate(nextDate)
    setViewMode("months")
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange("")
    setIsOpen(false)
  }

  const handleToday = () => {
    const today = new Date()
    setViewDate(today)
    handleSelectDay(today)
  }

  // Days grid calculation (fixed to 42 cells for stable container height)
  const calendarDays = React.useMemo(() => {
    const monthStart = startOfMonth(viewDate)
    const monthEnd = endOfMonth(monthStart)
    const startDate = startOfWeek(monthStart)
    const endDate = endOfWeek(monthEnd)
    const days = eachDayOfInterval({ start: startDate, end: endDate })

    while (days.length < 42) {
      const lastDay = days.at(-1)
      if (!lastDay) break
      days.push(addDays(lastDay, 1))
    }
    return days
  }, [viewDate])

  const currentYear = getYear(viewDate)
  const currentMonth = getMonth(viewDate)
  const yearsList = React.useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => yearPageStart + i)
  }, [yearPageStart])

  return (
    <div className="w-full">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          id={id}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-10 w-full justify-start text-left font-normal px-3",
            !selectedDate && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {selectedDate ? formatDate(selectedDate) : <span>Pick a date</span>}
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start" sideOffset={4}>
          <div className="p-3 bg-card rounded-md border border-border">
            {/* Header Toolbar */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (viewMode === "days") {
                    setViewDate((prev) => subMonths(prev, 1))
                  } else if (viewMode === "months") {
                    setViewDate((prev) => subYears(prev, 1))
                  } else {
                    setYearPageStart((prev) => prev - 12)
                  }
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {/* Title / Switcher Buttons */}
              <div className="flex items-center gap-1">
                {viewMode === "days" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setViewMode("months")}
                      className="px-2 py-1 text-sm font-semibold text-foreground hover:bg-accent rounded-md flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      {format(viewDate, "MMMM")}
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setYearPageStart(Math.floor(currentYear / 12) * 12)
                        setViewMode("years")
                      }}
                      className="px-2 py-1 text-sm font-semibold text-foreground hover:bg-accent rounded-md flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      {currentYear}
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </>
                )}

                {viewMode === "months" && (
                  <button
                    type="button"
                    onClick={() => {
                      setYearPageStart(Math.floor(currentYear / 12) * 12)
                      setViewMode("years")
                    }}
                    className="px-2.5 py-1 text-sm font-semibold text-foreground hover:bg-accent rounded-md flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>{currentYear}</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      (Select Month)
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}

                {viewMode === "years" && (
                  <div className="px-2 py-1 text-sm font-semibold text-foreground flex items-center gap-1">
                    <span>
                      {yearPageStart} – {yearPageStart + 11}
                    </span>
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (viewMode === "days") {
                    setViewDate((prev) => addMonths(prev, 1))
                  } else if (viewMode === "months") {
                    setViewDate((prev) => addYears(prev, 1))
                  } else {
                    setYearPageStart((prev) => prev + 12)
                  }
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* View 1: Days Grid */}
            {viewMode === "days" && (
              <div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground mb-1">
                  {WEEKDAYS.map((wd) => (
                    <div
                      key={wd}
                      className="h-6 flex items-center justify-center font-normal text-[0.75rem]"
                    >
                      {wd}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day, idx) => {
                    const isCurrentMonth = isSameMonth(day, viewDate)
                    const isSelected =
                      selectedDate && isSameDay(day, selectedDate)
                    const isTodayDate = isToday(day)

                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectDay(day)}
                        className={cn(
                          "h-8 w-8 mx-auto text-xs font-normal rounded-md flex items-center justify-center transition-colors cursor-pointer",
                          !isCurrentMonth && "text-muted-foreground/30",
                          isCurrentMonth &&
                            !isSelected &&
                            "text-foreground hover:bg-accent hover:text-accent-foreground",
                          isTodayDate &&
                            !isSelected &&
                            "border border-primary text-primary font-bold",
                          isSelected &&
                            "bg-primary text-primary-foreground font-semibold hover:bg-primary/90 shadow-xs"
                        )}
                      >
                        {format(day, "d")}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* View 2: Months Grid (3x4) */}
            {viewMode === "months" && (
              <div className="grid grid-cols-3 gap-2 py-2">
                {MONTHS_SHORT.map((monthName, idx) => {
                  const isCurrentSelectedMonth =
                    selectedDate &&
                    getYear(selectedDate) === currentYear &&
                    getMonth(selectedDate) === idx
                  const isViewingMonth = idx === currentMonth

                  return (
                    <button
                      key={monthName}
                      type="button"
                      onClick={() => handleSelectMonth(idx)}
                      className={cn(
                        "h-12 rounded-lg text-sm font-medium transition-colors flex items-center justify-center cursor-pointer",
                        isCurrentSelectedMonth
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : isViewingMonth
                            ? "border border-primary text-primary bg-primary/5 font-semibold"
                            : "text-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      {monthName}
                    </button>
                  )
                })}
              </div>
            )}

            {/* View 3: Years Grid (3x4) */}
            {viewMode === "years" && (
              <div className="grid grid-cols-3 gap-2 py-2">
                {yearsList.map((yr) => {
                  const isCurrentSelectedYear =
                    selectedDate && getYear(selectedDate) === yr
                  const isViewingYear = yr === currentYear

                  return (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => handleSelectYear(yr)}
                      className={cn(
                        "h-12 rounded-lg text-sm font-medium transition-colors flex items-center justify-center cursor-pointer",
                        isCurrentSelectedYear
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : isViewingYear
                            ? "border border-primary text-primary bg-primary/5 font-semibold"
                            : "text-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      {yr}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Quick Footer Action Bar */}
          <div className="flex items-center justify-between p-2 border-t border-border bg-card">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleToday}
              className="text-xs h-7 text-primary hover:text-primary hover:bg-primary/10"
            >
              Today
            </Button>
            {selectedDate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="text-xs h-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                Clear
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
