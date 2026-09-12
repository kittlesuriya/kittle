/**
 * Approved public barrels for the framework packages. The root entrypoint of
 * each package may only re-export these modules. Adding a public surface
 * requires an explicit entry here; the hardening gate fails otherwise.
 */
export const approvedCoreBarrels = [
  "domain",
  "entity",
  "execution",
  "operation",
  "ports",
] as const

export const approvedAdapterBarrels = [
  "http",
  "cache",
  "server",
  "drizzle-d1",
  "drizzlePg",
] as const
