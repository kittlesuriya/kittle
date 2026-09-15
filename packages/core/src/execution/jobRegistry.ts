import type { JobDefinition } from "./types"
import { ConfigurationError, ValidationError } from "../foundation/errors"
import { cloneAndFreezeDefinition } from "../foundation/definitionIntegrity"

export interface JobRegistryEntry {
  definition: JobDefinition
  registeredAt: Date
}
export interface JobRegistry {
  register(definition: JobDefinition): void
  get(type: string, version: number): JobDefinition | undefined
  has(type: string, version: number): boolean
  list(): readonly JobRegistryEntry[]
}

export function createJobRegistry(options?: { now?: () => Date }): JobRegistry {
  const entries = new Map<
    string,
    { definition: JobDefinition; registeredAt: Date }
  >()

  function key(type: string, version: number): string {
    return `${type}@${version}`
  }

  return {
    register(definition: JobDefinition): void {
      validateJobDefinition(definition)
      const k = key(definition.type, definition.version)
      if (entries.has(k)) {
        throw new ConfigurationError(
          `Job definition already registered: ${definition.type}@${definition.version}`
        )
      }
      entries.set(k, {
        definition: cloneAndFreezeDefinition(definition),
        registeredAt: options?.now?.() ?? new Date(),
      })
    },

    get(type: string, version: number): JobDefinition | undefined {
      return entries.get(key(type, version))?.definition
    },

    has(type: string, version: number): boolean {
      return entries.has(key(type, version))
    },

    list(): readonly JobRegistryEntry[] {
      return Array.from(entries.values()).map((entry) => ({
        definition: entry.definition,
        registeredAt: entry.registeredAt,
      }))
    },
  }
}

function validateJobDefinition(definition: JobDefinition): void {
  if (!definition || typeof definition !== "object")
    throw new ValidationError("Job definition must be an object.")
  if (
    typeof definition.type !== "string" ||
    definition.type.trim().length === 0
  )
    throw new ValidationError("Job type must be non-empty.")
  if (!Number.isInteger(definition.version) || definition.version < 1)
    throw new ValidationError("Job version must be a positive integer.")
  if (!Number.isInteger(definition.maxAttempts) || definition.maxAttempts < 1)
    throw new ValidationError("maxAttempts must be a positive integer.")
  if (!Number.isFinite(definition.retryDelayMs) || definition.retryDelayMs < 0)
    throw new ValidationError("retryDelayMs must be finite and non-negative.")
  if (
    !Number.isFinite(definition.retryBackoffMultiplier) ||
    definition.retryBackoffMultiplier <= 0
  )
    throw new ValidationError(
      "retryBackoffMultiplier must be finite and greater than zero."
    )
  if (
    definition.timeoutMs !== undefined &&
    (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0)
  )
    throw new ValidationError("timeoutMs must be finite and greater than zero.")
  if (typeof definition.decodePayload !== "function")
    throw new ValidationError("Job definition must provide decodePayload.")
  if (typeof definition.execute !== "function")
    throw new ValidationError("Job definition must provide execute.")
}
