import { cn } from "../../core/cn"
import { Card, CardContent } from "./card"
import { Skeleton } from "./skeleton"
import { TrendingUp, TrendingDown } from "lucide-react"
import { type CardVariant, cardVariantTone } from "./cardVariant"

type StatCardVariant = CardVariant

interface StatCardProps {
  label: string
  value: React.ReactNode
  variant?: StatCardVariant
  icon?: React.ComponentType<{ className?: string }>
  badge?: React.ReactNode
  description?: string
  isLoading?: boolean
  size?: "sm" | "md"
  className?: string
  valueClassName?: string
  iconClassName?: string
  labelClassName?: string
  trend?: { value: number; label?: string; isPositive?: boolean }
  /** Recent values rendered as an inline SVG sparkline. Needs >1 point. */
  sparkline?: number[]
}

export function StatCard({
  label,
  value,
  variant = "default",
  icon: Icon,
  badge,
  description,
  isLoading = false,
  size = "sm",
  className,
  valueClassName,
  iconClassName,
  labelClassName,
  trend,
  sparkline,
}: StatCardProps) {
  const styles = cardVariantTone[variant]
  // `isPositive` lets a metric whose *rise is bad* (errors, latency) colour
  // itself red even though the delta is positive.
  const trendIsPositive =
    trend?.isPositive ?? (trend ? trend.value >= 0 : false)
  // Trend pill reuses the shared variant colours — not a third copy of them.
  const trendStyles = trendIsPositive
    ? cardVariantTone.success
    : cardVariantTone.danger

  const showSparkline = !isLoading && Boolean(sparkline && sparkline.length > 1)

  return (
    <Card
      size={size === "md" ? "default" : "sm"}
      className={cn(
        "transition-colors hover:bg-accent/5 ring-0 border-0 shadow-md",
        cardVariantTone[variant].card,
        className
      )}
    >
      <CardContent
        className={cn("flex flex-col gap-1.5", size === "md" && "gap-2")}
      >
        {Icon && (
          <div
            className={cn(
              "mb-1 flex h-9 w-9 items-center justify-center rounded-lg",
              styles.iconBg,
              styles.iconText,
              iconClassName
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </div>
        )}
        <span
          className={cn(
            "text-xs font-medium text-muted-foreground tracking-wide uppercase",
            labelClassName
          )}
        >
          {label}
        </span>
        <div className="flex items-center justify-between gap-2">
          {isLoading ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <span
              className={cn(
                "tracking-tight tabular-nums",
                size === "md" ? "text-3xl font-bold" : "text-2xl font-bold",
                styles.value,
                valueClassName
              )}
            >
              {value}
            </span>
          )}
          {!isLoading && (badge || showSparkline) && (
            <div className="flex shrink-0 items-center gap-2">
              {badge}
              {showSparkline && (
                <StatSparkline
                  values={sparkline!}
                  className={
                    trend
                      ? trendIsPositive
                        ? "text-success"
                        : "text-destructive"
                      : styles.value || "text-primary"
                  }
                />
              )}
            </div>
          )}
        </div>
        {description && !isLoading && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {trend && !isLoading && (
          <div
            className={cn(
              "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium w-fit",
              trendStyles.iconBg,
              trendStyles.iconText
            )}
          >
            {trend.value >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {trend.value >= 0 ? "+" : ""}
            {trend.value}%{trend.label ? ` ${trend.label}` : ""}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Inline area sparkline — deliberately dependency-free (no chart library).
 * `currentColor` drives both the line and the fill, so the caller colours it
 * with a single text-* class.
 */
function StatSparkline({
  values,
  className,
}: {
  values: number[]
  className?: string
}) {
  const min = Math.min(...values)
  const range = Math.max(...values) - min || 1
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 96
      const y = 30 - ((value - min) / range) * 24
      return `${x},${y}`
    })
    .join(" ")
  const lastPoint = points.split(" ").at(-1)?.split(",")

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 96 36"
      className={cn("h-9 w-20 overflow-visible", className)}
      fill="none"
    >
      <polygon
        points={`0,36 ${points} 96,36`}
        fill="currentColor"
        opacity="0.08"
      />
      <polyline
        points={points}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      {lastPoint && (
        <>
          <circle
            cx={lastPoint[0]}
            cy={lastPoint[1]}
            r="4"
            fill="currentColor"
            opacity="0.16"
          />
          <circle
            cx={lastPoint[0]}
            cy={lastPoint[1]}
            r="2"
            fill="currentColor"
          />
        </>
      )}
    </svg>
  )
}

export type { StatCardVariant, StatCardProps }
