import { describe, expect, it } from "vitest"
import { cardVariantTone, type CardVariant } from "./cardVariant"

/**
 * The shared card-tint contract. `StatCard`, `ChartCard`,
 * `BreakdownChartCard` and `SettingsCard` all resolve one `variant` through
 * this single map — a tone missing here renders uncoloured there, so the
 * coverage is pinned rather than re-verified per consumer.
 */
const variants: CardVariant[] = [
  "default",
  "success",
  "warning",
  "danger",
  "info",
  "accent",
  "muted",
]

describe("cardVariantTone", () => {
  it("covers every variant with a card wash plus icon-chip and value ink", () => {
    for (const variant of variants) {
      const tone = cardVariantTone[variant]
      expect(typeof tone.card).toBe("string")
      expect(tone.iconBg).toBeTruthy()
      expect(tone.iconText).toBeTruthy()
      expect(typeof tone.value).toBe("string")
    }
  })

  it("keeps the StatCard trend-pill colours on the shared tones", () => {
    expect(cardVariantTone.success).toMatchObject({
      iconBg: "bg-success-bg",
      iconText: "text-success",
    })
    expect(cardVariantTone.danger).toMatchObject({
      iconBg: "bg-destructive/10",
      iconText: "text-destructive",
    })
  })
})
