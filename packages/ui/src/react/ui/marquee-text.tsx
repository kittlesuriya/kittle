import { useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { cn } from "../../core/cn"

interface MarqueeTextProps {
  label: string
  className?: string
  /**
   * Reduced-motion fallback. `"wrap"` (default) breaks words onto multiple
   * lines; `"truncate"` keeps single-line ellipsis for fixed-height rows
   * such as sidebar items.
   */
  fallback?: "wrap" | "truncate"
  /**
   * `"eager"` (default) measures on mount — right for the handful of labels
   * in menus and sidebars. `"lazy"` measures on first hover/focus intent and
   * disconnects on leave — for long option lists where mounting hundreds of
   * observers and forced layouts up front costs more than one measurement per
   * interaction. Only one label ever animates at a time either way.
   */
  mode?: "eager" | "lazy"
}

/** Visible breathing room between loop copies; the slide step adds the same
 * gap so each pass still lands the next copy exactly where the first stood. */
const COPY_GAP_PX = 48

/** Shared `matchMedia` handle: creating one list per instance is pure garbage
 * (the change listener still attaches per mounted instance, only while
 * armed — see below). */
let sharedMotionQuery: MediaQueryList | null = null
function reducedMotionNow(): boolean {
  if (typeof window === "undefined") return false
  if (!sharedMotionQuery) {
    sharedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  }
  return sharedMotionQuery.matches
}

/**
 * Single-line label that loops overflowed text — two passes, then a rest —
 * while its menu item is hovered or keyboard-highlighted. Timing lives
 * entirely in CSS (no timers anywhere): this component only measures widths
 * (copy one's width vs the wrapper) and exposes them as custom properties.
 * Labels that fit render statically. `prefers-reduced-motion` falls back to
 * wrapping with no animation. The full label is always exposed via `title`;
 * the repeated copies are aria-hidden so readers hear it once.
 */
export function MarqueeText({
  label,
  className,
  fallback = "wrap",
  mode = "eager",
}: MarqueeTextProps) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const copyRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(reducedMotionNow)
  const [metrics, setMetrics] = useState({ copyWidth: 0, passMs: 0 })
  // Lazy instances stay fully inert (no observers, no listeners, no layout
  // reads) until the first hover/focus intent, then behave like eager ones.
  const [armed, setArmed] = useState(mode !== "lazy")
  const arm = () => setArmed(true)

  useLayoutEffect(() => {
    if (!armed) return
    const wrap = wrapRef.current
    const copy = copyRef.current
    if (!wrap || !copy) return
    const measure = () => {
      const copyWidth = copy.offsetWidth
      const over = copyWidth > wrap.clientWidth + 1
      setOverflow(over)
      if (over) {
        // One pass across the overrun; the CSS cycle adds two passes + rest.
        const passMs = Math.min(
          6000,
          Math.max(1600, 400 + (copyWidth - wrap.clientWidth) * 14)
        )
        setMetrics({ copyWidth, passMs })
      }
    }
    measure()
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onMotion = () => setReducedMotion(mq.matches)
    mq.addEventListener("change", onMotion)
    // Observe both: the wrapper tracks menu width, the copy tracks its own
    // text width (webfont swaps change the copy, not the wrapper's box).
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    ro.observe(copy)
    return () => {
      mq.removeEventListener("change", onMotion)
      ro.disconnect()
    }
    // Re-observe when the rendered copy node swaps (static <-> track).
  }, [label, overflow, armed])

  if (reducedMotion) {
    return (
      <span
        title={label}
        onMouseEnter={mode === "lazy" ? arm : undefined}
        onFocus={mode === "lazy" ? arm : undefined}
        className={cn(
          "min-w-0 flex-1",
          fallback === "truncate" ? "truncate" : "break-words",
          className
        )}
      >
        {label}
      </span>
    )
  }

  return (
    <span
      ref={wrapRef}
      title={label}
      data-overflow={overflow || undefined}
      onMouseEnter={mode === "lazy" && !armed ? arm : undefined}
      onFocus={mode === "lazy" && !armed ? arm : undefined}
      className={cn(
        "block min-w-0 flex-1 overflow-hidden whitespace-nowrap",
        className
      )}
    >
      {overflow ? (
        <span
          className="marquee-track inline-flex whitespace-nowrap will-change-transform"
          style={
            {
              "--marquee-step": `${metrics.copyWidth + COPY_GAP_PX}px`,
              "--marquee-gap": `${COPY_GAP_PX}px`,
              "--marquee-cycle": `calc(${metrics.passMs}ms * 2 + 5000ms)`,
            } as CSSProperties
          }
        >
          <span ref={copyRef}>{label}</span>
          <span aria-hidden="true">{label}</span>
          <span aria-hidden="true">{label}</span>
        </span>
      ) : (
        <span ref={copyRef} className="inline-block">
          {label}
        </span>
      )}
    </span>
  )
}
