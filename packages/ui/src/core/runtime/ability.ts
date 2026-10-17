import type { AbilityLike } from "./types"

/**
 * Full-access ability used when no per-layout ability is bound.
 *
 * Matches the app's contextual default (`AbilityContext` falls back to
 * `createFullAccessAbility()`), so unbound rendering behaves like the
 * pre-extraction sidebar: menu filtering stays on but permits everything.
 */
export const ALLOW_ALL_ABILITY: AbilityLike = {
  can: () => true,
}
