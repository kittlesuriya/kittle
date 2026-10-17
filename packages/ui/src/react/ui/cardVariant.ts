export type CardVariant =
  "default" | "success" | "warning" | "danger" | "info" | "accent" | "muted"

/**
 * The dashboard-card tone pairing, owned ONCE.
 *
 * Every tinted card in the app — analytics stats and breakdowns, the tenant
 * and platform dashboards, the learning dashboard, settings cards — is one
 * `variant` prop that resolves here: a pale theme-variable wash for the card
 * surface (`card`) plus the dark saturated ink for its icon chip (`iconBg` /
 * `iconText`) and headline value (`value`). The pairing lives in the theme
 * tokens (`--success-bg` vs `--success`, …), so it inverts correctly in dark
 * mode with no per-card logic; consumers must never hand-pair a bg from one
 * variant with ink from another.
 *
 * This used to be two maps (`cardVariantBg`, `cardVariantIcon`) that each
 * consumer joined by hand, plus hand-rolled copies in both settings modules
 * and the StatCard trend pill — which is how copies drifted. One lookup now.
 */
export interface CardVariantTone {
  /** Pale tint wash for the card surface. Empty = untinted. */
  card: string
  /** Background for an icon chip rendered on the card. */
  iconBg: string
  /** Foreground for that icon chip. */
  iconText: string
  /** Foreground for the card's headline number. Empty = inherit. */
  value: string
}

export const cardVariantTone: Record<CardVariant, CardVariantTone> = {
  default: {
    card: "",
    iconBg: "bg-muted",
    iconText: "text-muted-foreground",
    value: "",
  },
  success: {
    card: "bg-success-bg/50",
    iconBg: "bg-success-bg",
    iconText: "text-success",
    value: "text-success",
  },
  warning: {
    card: "bg-warning-bg/50",
    iconBg: "bg-warning-bg",
    iconText: "text-warning",
    value: "text-warning",
  },
  danger: {
    card: "bg-destructive/5",
    iconBg: "bg-destructive/10",
    iconText: "text-destructive",
    value: "text-destructive",
  },
  info: {
    card: "bg-info-bg/50",
    iconBg: "bg-info-bg",
    iconText: "text-info",
    value: "text-info",
  },
  accent: {
    card: "bg-primary/5",
    iconBg: "bg-primary/10",
    iconText: "text-primary",
    value: "text-primary",
  },
  muted: {
    card: "",
    iconBg: "bg-muted",
    iconText: "text-muted-foreground",
    value: "text-muted-foreground",
  },
}
