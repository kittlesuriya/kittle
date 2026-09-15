import { describe, expect, it, vi } from "vitest"
import { consoleLogger, createExecutionContext } from "../executionContext"
import { ValidationError } from "../../domain"
import {
  assertDurableJob,
  assertDurableIdentifier,
  assertJobRequesterCanEnqueue,
  assertRequesterCanEnqueueScope,
  assertJobScopeMatches,
  getStoredJobScope,
  isSystemOrPlatform,
  requesterTenantId,
  requesterToActorId,
  assertJobScopeCanEnqueue,
  requesterJobScope,
  JobScopeMismatchError,
  RetryableJobError,
  PermanentJobError,
  MalformedJobPayloadError,
  InvalidJobPayloadError,
  CorruptJobMetadataError,
  type JobRequester,
} from "../types"

describe("execution context and scope helpers", () => {
  it("creates contexts with defaults and optional execution values", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z")
    const signal = new AbortController().signal
    const clock = { now: vi.fn(() => startedAt), sleep: vi.fn(async () => {}) }
    const context = createExecutionContext({
      executionId: "execution-1",
      jobId: "job-1",
      jobType: "email",
      jobVersion: 2,
      attempt: 1,
      tenantId: "tenant-1",
      correlationId: "correlation-1",
      startedAt,
      signal,
      deadline: 123,
      metadata: { source: "test" },
      clock,
      assertLease: async () => {},
    })
    expect(context).toMatchObject({
      executionId: "execution-1",
      tenantId: "tenant-1",
      metadata: { source: "test" },
      signal,
      deadline: 123,
      clock,
    })
    const defaultLogger = createExecutionContext({
      jobId: "job",
      jobType: "test",
      jobVersion: 1,
      attempt: 1,
      tenantId: null,
      correlationId: "c",
      startedAt,
      assertLease: async () => {},
    }).logger
    expect(Object.keys(defaultLogger)).toEqual([
      "info",
      "warn",
      "error",
      "debug",
    ])
    defaultLogger.info("noop")
    defaultLogger.warn("noop")
    defaultLogger.error("noop")
    defaultLogger.debug("noop")
  })

  it("emits console logger calls with and without prefixes", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {})
    const logger = consoleLogger("worker")
    logger.info("started", { id: "1" })
    logger.warn("slow")
    logger.error("failed")
    logger.debug("trace")
    expect(info).toHaveBeenCalledWith("[worker] started", { id: "1" })
    expect(warn).toHaveBeenCalledWith("[worker] slow", "")
    expect(error).toHaveBeenCalledWith("[worker] failed", "")
    expect(debug).toHaveBeenCalledWith("[worker] trace", "")
    info.mockRestore()
    warn.mockRestore()
    error.mockRestore()
    debug.mockRestore()
    const plainLogger = consoleLogger()
    plainLogger.info("plain")
    plainLogger.warn("plain")
    plainLogger.error("plain")
    plainLogger.debug("plain")
  })

  it("enforces stored job scope and requester tenant boundaries", () => {
    expect(() => getStoredJobScope(null, undefined as never)).toThrow(
      "scope is required"
    )
    expect(getStoredJobScope("tenant-1", "tenant")).toBe("tenant")
    expect(getStoredJobScope(null, "system")).toBe("system")
    expect(getStoredJobScope(null, "platform")).toBe("platform")
    expect(() =>
      assertJobScopeMatches("tenant-1", "tenant", "tenant")
    ).not.toThrow()
    expect(() => assertJobScopeMatches(null, "system", "system")).not.toThrow()
    expect(() => assertJobScopeMatches(null, "tenant", "platform")).toThrow(
      JobScopeMismatchError
    )
    expect(() =>
      assertJobScopeMatches("tenant-1", "platform", "tenant")
    ).toThrow(JobScopeMismatchError)

    const tenant: JobRequester = {
      scope: "tenant",
      tenantId: "tenant-1",
      actorId: "actor",
    }
    expect(() => assertJobRequesterCanEnqueue(tenant, "tenant-1")).not.toThrow()
    expect(() => assertJobRequesterCanEnqueue(tenant, null)).toThrow(
      "its tenant"
    )
    expect(() =>
      assertJobRequesterCanEnqueue(
        { scope: "platform", actorId: "platform" },
        "other"
      )
    ).not.toThrow()
    expect(() =>
      assertJobRequesterCanEnqueue({ scope: "system" }, "other")
    ).not.toThrow()
    expect(() =>
      assertRequesterCanEnqueueScope(
        { scope: "platform", actorId: "platform" },
        "platform",
        null
      )
    ).not.toThrow()
    expect(() =>
      assertRequesterCanEnqueueScope(
        { scope: "platform", actorId: "platform" },
        "system",
        null
      )
    ).toThrow("cannot enqueue system")
    expect(() =>
      assertRequesterCanEnqueueScope(
        {
          scope: "platform",
          actorId: "platform",
          capabilities: ["enqueue:system"],
        },
        "system",
        null
      )
    ).not.toThrow()
    expect(() =>
      assertRequesterCanEnqueueScope(tenant, "system", null)
    ).toThrow("its tenant")
    expect(requesterTenantId(tenant)).toBe("tenant-1")
    expect(requesterTenantId({ scope: "system" })).toBeNull()
    expect(isSystemOrPlatform({ scope: "platform", actorId: "a" })).toBe(true)
    expect(isSystemOrPlatform(tenant)).toBe(false)
    expect(requesterToActorId({ scope: "system" })).toBe("system")
    expect(requesterToActorId({ scope: "platform", actorId: "p" })).toBe("p")
    expect(requesterToActorId(tenant)).toBe("actor")
    expect(requesterJobScope(tenant)).toBe("tenant")
    expect(requesterJobScope({ scope: "platform", actorId: "p" })).toBe(
      "platform"
    )
    expect(requesterJobScope({ scope: "system" })).toBe("system")

    expect(() => assertJobScopeCanEnqueue("tenant", "tenant-1")).not.toThrow()
    expect(() => assertJobScopeCanEnqueue("tenant", null)).toThrow(
      "Tenant jobs require"
    )
    expect(() => assertJobScopeCanEnqueue("platform", undefined)).not.toThrow()
    expect(() => assertJobScopeCanEnqueue("system", null)).not.toThrow()
    expect(() => assertJobScopeCanEnqueue("platform", "tenant-1")).toThrow(
      "platform/system jobs"
    )

    expect(() =>
      assertJobScopeMatches("tenant-1", "tenant", "tenant")
    ).not.toThrow()
    expect(() => assertJobScopeMatches(null, "system", "system")).not.toThrow()
    expect(() => assertJobScopeMatches(null, "platform", "system")).toThrow(
      "scope mismatch"
    )
    expect(() =>
      assertJobScopeMatches("tenant-1", "tenant", "platform")
    ).toThrow("scope mismatch")
  })

  it("exposes the job error types with their stable kinds and defaults", () => {
    expect(new RetryableJobError("retry")).toMatchObject({
      name: "RetryableJobError",
      kind: "retryable",
    })
    expect(new PermanentJobError("permanent")).toMatchObject({
      name: "PermanentJobError",
      kind: "permanent",
    })
    expect(new MalformedJobPayloadError()).toHaveProperty(
      "message",
      "Job payload is malformed"
    )
    expect(new InvalidJobPayloadError()).toHaveProperty(
      "message",
      "Job payload failed schema validation"
    )
    expect(new CorruptJobMetadataError()).toMatchObject({
      name: "CorruptJobMetadataError",
      kind: "permanent",
      message: "Job metadata is malformed",
    })
  })
})

describe("durable job payload validation", () => {
  const valid = {
    scope: "platform" as const,
    jobType: "test.job",
    jobVersion: 1,
    payload: { ok: true },
  }

  it("accepts a plain JSON payload and rejects non-plain values", () => {
    expect(() => assertDurableJob(valid)).not.toThrow()
    expect(() =>
      assertDurableJob({ ...valid, payload: { value: new Map([["k", "v"]]) } })
    ).toThrow(ValidationError)
    expect(() =>
      assertDurableJob({ ...valid, payload: { value: new Set(["x"]) } })
    ).toThrow(ValidationError)
    expect(() =>
      assertDurableJob({ ...valid, payload: { value: new Date() } })
    ).toThrow(ValidationError)
    expect(() =>
      assertDurableJob({
        ...valid,
        payload: {
          value: {
            toJSON() {
              return "x"
            },
          },
        },
      })
    ).toThrow(ValidationError)
  })

  it("rejects a circular payload", () => {
    const payload: Record<string, unknown> = { nested: {} }
    payload.nested = payload
    expect(() => assertDurableJob({ ...valid, payload })).toThrow(/circular/i)
  })

  it("rejects payloads that exceed the maximum nesting depth", () => {
    let nested: unknown = {}
    for (let i = 0; i < 60; i++) nested = { next: nested }
    expect(() => assertDurableJob({ ...valid, payload: { nested } })).toThrow(
      /nesting depth/
    )
  })

  it("rejects an oversized string value", () => {
    expect(() =>
      assertDurableJob({ ...valid, payload: { data: "x".repeat(70_000) } })
    ).toThrow(/longer than/)
  })

  it("rejects oversized keys and excessive total keys", () => {
    const oversizedKey: Record<string, unknown> = {}
    oversizedKey["k".repeat(70_000)] = 1
    expect(() => assertDurableJob({ ...valid, payload: oversizedKey })).toThrow(
      /key longer than/
    )
    const tooManyKeys = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, i) => [`k${i}`, i])
    )
    expect(() => assertDurableJob({ ...valid, payload: tooManyKeys })).toThrow(
      /keys/
    )
  })

  it("rejects a serialized payload and metadata combination over the byte budget", () => {
    const big = { data: Array.from({ length: 20 }, () => "y".repeat(60_000)) }
    expect(() => assertDurableJob({ ...valid, payload: big })).toThrow(
      /serialized bytes/
    )
    expect(() =>
      assertDurableJob({ ...valid, payload: { a: "b" }, metadata: big })
    ).toThrow(/serialized bytes/)
  })

  it("rejects undefined, NaN, and Infinity values", () => {
    expect(() =>
      assertDurableJob({ ...valid, payload: { value: undefined } })
    ).toThrow(/non-durable/)
    expect(() =>
      assertDurableJob({ ...valid, payload: { value: Number.NaN } })
    ).toThrow(/non-durable/)
    expect(() =>
      assertDurableJob({
        ...valid,
        payload: { value: Number.POSITIVE_INFINITY },
      })
    ).toThrow(/non-durable/)
  })

  it("bounds durable identifiers by UTF-8 byte length", () => {
    expect(() =>
      assertDurableJob({ ...valid, jobType: "t".repeat(100) })
    ).not.toThrow()
    expect(() =>
      assertDurableJob({ ...valid, jobType: "t".repeat(101) })
    ).toThrow(/jobType.*100 bytes/)
    // A 50-character multi-byte string exceeds 100 bytes even though it is short.
    expect(() =>
      assertDurableJob({ ...valid, jobType: "水".repeat(50) })
    ).toThrow(/jobType.*100 bytes/)

    expect(() =>
      assertDurableJob({ ...valid, idempotencyKey: "k".repeat(255) })
    ).not.toThrow()
    expect(() =>
      assertDurableJob({ ...valid, idempotencyKey: "k".repeat(256) })
    ).toThrow(/idempotencyKey.*255 bytes/)

    expect(() =>
      assertDurableJob({ ...valid, correlationId: "c".repeat(100) })
    ).not.toThrow()
    expect(() =>
      assertDurableJob({ ...valid, correlationId: "c".repeat(101) })
    ).toThrow(/correlationId.*100 bytes/)

    expect(() =>
      assertDurableIdentifier("w".repeat(100), "workerId", 100)
    ).not.toThrow()
    expect(() =>
      assertDurableIdentifier("w".repeat(101), "workerId", 100)
    ).toThrow(/workerId.*100 bytes/)
  })
})

describe("fencedEffect lease assertion", () => {
  const baseArgs = {
    jobId: "job-1",
    jobType: "test",
    jobVersion: 1,
    attempt: 1,
    tenantId: null,
    correlationId: "c",
    startedAt: new Date(),
  }

  it("calls assertLease before executing the effect function", async () => {
    const assertLease = vi.fn(async () => {})
    const context = createExecutionContext({ ...baseArgs, assertLease })
    const fn = vi.fn(async () => "result")
    const result = await context.fencedEffect.execute({
      effectName: "test",
      idempotencyKey: "test-1",
      fn,
    })
    expect(assertLease).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledOnce()
    expect(result).toBe("result")
  })

  it("does not invoke the effect function when assertLease rejects", async () => {
    const assertLease = vi.fn(async () => {
      throw new Error("Job lease was lost")
    })
    const context = createExecutionContext({ ...baseArgs, assertLease })
    const fn = vi.fn(async () => "result")
    await expect(
      context.fencedEffect.execute({
        effectName: "test",
        idempotencyKey: "test-2",
        fn,
      })
    ).rejects.toThrow("Job lease was lost")
    expect(fn).not.toHaveBeenCalled()
  })

  it("fences a stale worker whose renewLease returned false (assertLease rejects)", async () => {
    const assertLease = vi.fn(async () => {
      throw new Error("Stale worker: lease renewal failed")
    })
    const context = createExecutionContext({ ...baseArgs, assertLease })
    const fn = vi.fn(async () => {
      throw new Error("Should never be called — lease was lost")
    })
    await expect(
      context.fencedEffect.execute({
        effectName: "payment-gateway",
        idempotencyKey: "payment-1",
        fn,
      })
    ).rejects.toThrow("Stale worker: lease renewal failed")
    expect(fn).not.toHaveBeenCalled()
    expect(assertLease).toHaveBeenCalledOnce()
  })
})
