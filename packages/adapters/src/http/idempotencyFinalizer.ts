import type {
  ClaimedPendingInvalidation,
  FinalizerPort as CoreFinalizerPort,
} from "core/ports"

export type FinalizerPort = CoreFinalizerPort

export interface InvalidationFinalizerTelemetry {
  onError?: (entry: { scope: string; key: string; error: unknown }) => void
  onDrained?: (drained: number, acked: number) => void
  onAttempt?: (entry: {
    scope: string
    key: string
    invalidations: number
  }) => void
}

/** Finalize only rows leased to this worker; stale workers cannot complete. */
export async function drainPendingInvalidations(args: {
  port: FinalizerPort
  invalidate: (tags: string[]) => Promise<void>
  limit?: number
  claimOwner: string
  leaseMs: number
  telemetry?: InvalidationFinalizerTelemetry
}): Promise<{ drained: number; acked: number }> {
  const effectiveLimit = Math.min(args.limit ?? 100, 100)
  if (!args.claimOwner || !Number.isFinite(args.leaseMs) || args.leaseMs <= 0) {
    throw new Error("Finalizer claimOwner and positive leaseMs are required")
  }

  const claimed: ClaimedPendingInvalidation[] =
    await args.port.claimPendingInvalidations({
      limit: effectiveLimit,
      claimOwner: args.claimOwner,
      leaseMs: args.leaseMs,
    })
  let drained = 0
  let acked = 0
  for (const entry of claimed) {
    try {
      args.telemetry?.onAttempt?.({
        scope: entry.scope,
        key: entry.key,
        invalidations: entry.invalidations.length,
      })
      await args.invalidate(entry.invalidations)
      if (entry.result !== null && entry.result !== undefined) {
        await args.port.completeClaimedInvalidation({
          scope: entry.scope,
          key: entry.key,
          fingerprint: entry.fingerprint,
          token: entry.token,
          claimToken: entry.claimToken,
          result: entry.result,
          invalidations: entry.invalidations,
        })
        drained += 1
      } else {
        await args.port.ackClaimedInvalidation({
          scope: entry.scope,
          key: entry.key,
          fingerprint: entry.fingerprint,
          token: entry.token,
          claimToken: entry.claimToken,
        })
        acked += 1
      }
    } catch (error) {
      args.telemetry?.onError?.({ scope: entry.scope, key: entry.key, error })
    }
  }
  args.telemetry?.onDrained?.(drained, acked)
  return { drained, acked }
}

/** A periodic finalizer service with health-visible drain results. */
export function createIdempotencyFinalizerService(args: {
  drain: () => Promise<{ drained: number; acked: number }>
  intervalMs: number
  telemetry?: InvalidationFinalizerTelemetry
}): { start(): void; stop(): void } {
  let timer: ReturnType<typeof setInterval> | undefined
  let inFlight: Promise<void> | undefined
  return {
    start() {
      if (timer) return
      timer = setInterval(() => {
        if (inFlight) return
        inFlight = args
          .drain()
          .then(() => undefined)
          .catch((error) =>
            args.telemetry?.onError?.({
              scope: "finalizer",
              key: "drain",
              error,
            })
          )
          .finally(() => {
            inFlight = undefined
          })
      }, args.intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
  }
}
