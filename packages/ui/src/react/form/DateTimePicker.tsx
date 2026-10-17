import * as React from "react"
import { useRef } from "react"
import {
  format,
  addMonths,
  subMonths,
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
  setMonth as setDateMonth,
  setYear as setDateYear,
} from "date-fns"
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { Button, buttonVariants } from "../ui/button"
import { Input } from "../ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { cn } from "../../core/cn"
import { useUiRuntime } from "../../core/runtime"

// ---------------------------------------------------------------------------
// Time helpers (24-hour, boxed keyboard inputs)
// ---------------------------------------------------------------------------

type TimePickerType = "hours" | "minutes" | "seconds"
type Granularity = "minute" | "second"

function isValidHour(value: string) {
  return /^(0[0-9]|1[0-9]|2[0-3])$/.test(value)
}

function isValidMinuteOrSecond(value: string) {
  return /^[0-5][0-9]$/.test(value)
}

function getValidNumber(
  value: string,
  { max, min = 0, loop = false }: { max: number; min?: number; loop?: boolean }
) {
  let numericValue = parseInt(value, 10)

  if (!Number.isNaN(numericValue)) {
    if (!loop) {
      if (numericValue > max) numericValue = max
      if (numericValue < min) numericValue = min
    } else {
      if (numericValue > max) numericValue = min
      if (numericValue < min) numericValue = max
    }
    return numericValue.toString().padStart(2, "0")
  }

  return "00"
}

function getValidHour(value: string) {
  if (isValidHour(value)) return value
  return getValidNumber(value, { max: 23 })
}

function getValidMinuteOrSecond(value: string) {
  if (isValidMinuteOrSecond(value)) return value
  return getValidNumber(value, { max: 59 })
}

function getValidArrowNumber(
  value: string,
  { min, max, step }: { min: number; max: number; step: number }
) {
  let numericValue = parseInt(value, 10)
  if (!Number.isNaN(numericValue)) {
    numericValue += step
    return getValidNumber(String(numericValue), { min, max, loop: true })
  }
  return "00"
}

function getValidArrowHour(value: string, step: number) {
  return getValidArrowNumber(value, { min: 0, max: 23, step })
}

function getValidArrowMinuteOrSecond(value: string, step: number) {
  return getValidArrowNumber(value, { min: 0, max: 59, step })
}

function setDateByType(date: Date, value: string, type: TimePickerType) {
  switch (type) {
    case "minutes":
      date.setMinutes(parseInt(getValidMinuteOrSecond(value), 10))
      return date
    case "seconds":
      date.setSeconds(parseInt(getValidMinuteOrSecond(value), 10))
      return date
    case "hours":
      date.setHours(parseInt(getValidHour(value), 10))
      return date
    default:
      return date
  }
}

function getDateByType(date: Date | null, type: TimePickerType) {
  if (!date) return "00"
  switch (type) {
    case "minutes":
      return getValidMinuteOrSecond(String(date.getMinutes()))
    case "seconds":
      return getValidMinuteOrSecond(String(date.getSeconds()))
    case "hours":
      return getValidHour(String(date.getHours()))
    default:
      return "00"
  }
}

function getArrowByType(value: string, step: number, type: TimePickerType) {
  switch (type) {
    case "minutes":
      return getValidArrowMinuteOrSecond(value, step)
    case "seconds":
      return getValidArrowMinuteOrSecond(value, step)
    case "hours":
      return getValidArrowHour(value, step)
    default:
      return "00"
  }
}

interface TimePickerInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  picker: TimePickerType
  date?: Date | null
  onDateChange?: (date: Date | undefined) => void
  onRightFocus?: () => void
  onLeftFocus?: () => void
}

/**
 * A single boxed time segment. Digits replace (two keystrokes within 2s build a
 * two-digit value), Up/Down step, and Left/Right move between segments.
 */
const TimePickerInput = React.forwardRef<
  HTMLInputElement,
  TimePickerInputProps
>(function TimePickerInput(
  {
    className,
    type = "tel",
    value,
    id,
    name,
    date = new Date(new Date().setHours(0, 0, 0, 0)),
    onDateChange,
    onChange,
    onKeyDown,
    picker,
    onLeftFocus,
    onRightFocus,
    ...props
  },
  ref
) {
  const [flag, setFlag] = React.useState(false)

  // Allow the user to enter the second digit within 2 seconds, otherwise
  // the next digit starts a fresh value.
  React.useEffect(() => {
    if (!flag) return
    const timer = setTimeout(() => setFlag(false), 2000)
    return () => clearTimeout(timer)
  }, [flag])

  const calculatedValue = React.useMemo(
    () => getDateByType(date, picker),
    [date, picker]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") return
    e.preventDefault()
    if (e.key === "ArrowRight") onRightFocus?.()
    if (e.key === "ArrowLeft") onLeftFocus?.()
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const step = e.key === "ArrowUp" ? 1 : -1
      const newValue = getArrowByType(calculatedValue, step, picker)
      if (flag) setFlag(false)
      const tempDate = date ? new Date(date) : new Date()
      onDateChange?.(setDateByType(tempDate, newValue, picker))
    }
    if (e.key >= "0" && e.key <= "9") {
      const newValue = !flag ? `0${e.key}` : calculatedValue.slice(1, 2) + e.key
      if (flag) onRightFocus?.()
      setFlag((prev) => !prev)
      const tempDate = date ? new Date(date) : new Date()
      onDateChange?.(setDateByType(tempDate, newValue, picker))
    }
  }

  return (
    <Input
      ref={ref}
      id={id || picker}
      name={name || picker}
      className={cn(
        "w-[48px] text-center font-mono text-base tabular-nums caret-transparent focus:bg-accent focus:text-accent-foreground [&::-webkit-inner-spin-button]:appearance-none",
        className
      )}
      value={value || calculatedValue}
      onChange={(e) => {
        e.preventDefault()
        onChange?.(e)
      }}
      type={type}
      inputMode="decimal"
      onKeyDown={(e) => {
        onKeyDown?.(e)
        handleKeyDown(e)
      }}
      {...props}
    />
  )
})

interface TimePickerProps {
  date?: Date | null
  onChange?: (date: Date | undefined) => void
  /** Smallest unit shown. Defaults to "second". */
  granularity?: Granularity
}

function TimePicker({
  date,
  onChange,
  granularity = "second",
}: TimePickerProps) {
  const hourRef = useRef<HTMLInputElement>(null)
  const minuteRef = useRef<HTMLInputElement>(null)
  const secondRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex items-center justify-center gap-2">
      <Clock className="h-4 w-4 text-muted-foreground" />
      <TimePickerInput
        picker="hours"
        date={date}
        onDateChange={onChange}
        ref={hourRef}
        onRightFocus={() => minuteRef.current?.focus()}
      />
      <span className="text-muted-foreground">:</span>
      <TimePickerInput
        picker="minutes"
        date={date}
        onDateChange={onChange}
        ref={minuteRef}
        onLeftFocus={() => hourRef.current?.focus()}
        onRightFocus={() => secondRef.current?.focus()}
      />
      {granularity === "second" && (
        <>
          <span className="text-muted-foreground">:</span>
          <TimePickerInput
            picker="seconds"
            date={date}
            onDateChange={onChange}
            ref={secondRef}
            onLeftFocus={() => minuteRef.current?.focus()}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DateTimePicker
// ---------------------------------------------------------------------------

interface DateTimePickerProps {
  id?: string
  /** Wall-clock value in "yyyy-MM-ddTHH:mm[:ss]" form; "" when empty. */
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  /** Smallest unit shown and stored. Defaults to "second". */
  granularity?: Granularity
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  format(new Date(2021, i, 1), "MMMM")
)

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

/**
 * Parse the form's wall-clock string into a local Date. A bare
 * "yyyy-MM-ddTHH:mm[:ss]" (no offset) is parsed as local time, so the digits
 * the user typed come back unchanged ΓÇö matching `parseWallDateTime`.
 */
function parseValue(value?: string): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return isNaN(d.getTime()) ? undefined : d
}

export function DateTimePicker({
  id,
  value,
  onChange,
  disabled,
  className,
  granularity = "second",
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const { dateFnsPattern } = useUiRuntime().formatDate.useTenantDateFormatter()

  const selectedDate = React.useMemo(() => parseValue(value), [value])
  const [viewDate, setViewDate] = React.useState<Date>(
    () => selectedDate ?? new Date()
  )

  // Keep the visible month in sync when the value changes.
  React.useEffect(() => {
    if (selectedDate) setViewDate(selectedDate)
  }, [selectedDate])

  const handleOpenChange = (open: boolean) => {
    if (disabled) return
    setIsOpen(open)
    if (open) setViewDate(selectedDate ?? new Date())
  }

  // The time inputs show a sensible default even before a date is picked.
  const timeSource = selectedDate ?? viewDate

  const emit = (date: Date) =>
    onChange(
      format(
        date,
        granularity === "second"
          ? "yyyy-MM-dd'T'HH:mm:ss"
          : "yyyy-MM-dd'T'HH:mm"
      )
    )

  const handleSelectDay = (day: Date) => {
    const base = selectedDate ?? new Date()
    const next = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      base.getHours(),
      base.getMinutes(),
      base.getSeconds()
    )
    emit(next)
    setViewDate(next)
  }

  const handleTimeChange = (next: Date | undefined) => {
    if (!next) return
    emit(next)
    setViewDate(next)
  }

  const handleNow = () => {
    const now = new Date()
    setViewDate(now)
    emit(now)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange("")
    setIsOpen(false)
  }

  // 42 days (6 weeks) keeps the container height stable.
  const calendarDays = React.useMemo(() => {
    const monthStart = startOfMonth(viewDate)
    const monthEnd = endOfMonth(monthStart)
    const startDate = startOfWeek(monthStart)
    const endDate = endOfWeek(monthEnd)
    const days = eachDayOfInterval({ start: startDate, end: endDate })

    while (days.length < 42) {
      const last = days[days.length - 1]
      if (!last) break
      days.push(addDays(last, 1))
    }
    return days
  }, [viewDate])

  const currentYear = getYear(viewDate)
  const currentMonth = getMonth(viewDate)
  const yearsList = React.useMemo(() => {
    const start = currentYear - 100
    return Array.from({ length: 121 }, (_, i) => start + i)
  }, [currentYear])

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
          {selectedDate ? (
            format(
              selectedDate,
              granularity === "second"
                ? `${dateFnsPattern} HH:mm:ss`
                : `${dateFnsPattern} HH:mm`
            )
          ) : (
            <span>Pick date &amp; time</span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start" sideOffset={4}>
          <div className="p-3 bg-card rounded-md border border-border">
            {/* Header Toolbar */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setViewDate((prev) => subMonths(prev, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-1">
                <Select
                  value={String(currentMonth)}
                  onValueChange={(v) => {
                    if (v == null) return
                    setViewDate((prev) => setDateMonth(prev, Number(v)))
                  }}
                >
                  <SelectTrigger className="w-fit gap-1 border-none p-0 font-semibold text-foreground focus:bg-accent">
                    <SelectValue>{MONTHS[currentMonth]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((monthName, idx) => (
                      <SelectItem key={monthName} value={String(idx)}>
                        {monthName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={String(currentYear)}
                  onValueChange={(v) => {
                    if (v == null) return
                    setViewDate((prev) => setDateYear(prev, Number(v)))
                  }}
                >
                  <SelectTrigger className="w-fit gap-1 border-none p-0 font-semibold text-foreground focus:bg-accent">
                    <SelectValue>{currentYear}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-[260px]">
                    {yearsList.map((yr) => (
                      <SelectItem key={yr} value={String(yr)}>
                        {yr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setViewDate((prev) => addMonths(prev, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Days Grid */}
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

            {/* Time Row */}
            <div className="mt-3 pt-3 border-t border-border/60">
              <TimePicker
                date={timeSource}
                onChange={handleTimeChange}
                granularity={granularity}
              />
            </div>
          </div>

          {/* Quick Footer Action Bar */}
          <div className="flex items-center justify-between p-2 border-t border-border bg-card">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleNow}
              className="text-xs h-7 text-primary hover:text-primary hover:bg-primary/10"
            >
              Now
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
