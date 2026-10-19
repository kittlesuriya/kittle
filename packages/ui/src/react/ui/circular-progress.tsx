import * as React from "react"
import { cn } from "../../core/cn"

export interface CircularProgressProps {
  /** 0–100. Ignored when `indeterminate` is set. */
  percent?: number
  /** Diameter in px. */
  size?: number
  /** Ring thickness in px. */
  strokeWidth?: number
  /** Spinning arc for unknown-duration work (hashing, single-POST). */
  indeterminate?: boolean
  /** Red ring for failed transfers. */
  error?: boolean
  /** Content centered inside the ring (percent label, icon, thumbnail). */
  children?: React.ReactNode
  className?: string
  classNames?: CircularProgressClassNames
}

export interface CircularProgressClassNames {
  root?: string
  svg?: string
  track?: string
  indicator?: string
  content?: string
}

/**
 * Determinate ring for chunked uploads, indeterminate spinner for
 * unknown-duration work. Same `role="progressbar"` contract as the bar it
 * replaces, so progress stays announced to assistive tech.
 */
export function CircularProgress({
  percent = 0,
  size = 72,
  strokeWidth = 6,
  indeterminate = false,
  error = false,
  children,
  className,
  classNames,
}: CircularProgressProps): React.ReactElement {
  const clamped = Math.min(100, Math.max(0, percent))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center",
        indeterminate && "animate-spin",
        classNames?.root
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn("absolute inset-0", className, classNames?.svg)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={cn("stroke-muted", classNames?.track)}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={
            indeterminate
              ? `${circumference * 0.25} ${circumference}`
              : circumference
          }
          strokeDashoffset={indeterminate ? 0 : offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={cn(
            "transition-[stroke-dashoffset] duration-200",
            error ? "stroke-destructive" : "stroke-primary",
            classNames?.indicator
          )}
        />
      </svg>
      {children ? (
        <div
          className={cn(
            indeterminate && "animate-[spin_1s_linear_infinite_reverse]",
            classNames?.content
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
