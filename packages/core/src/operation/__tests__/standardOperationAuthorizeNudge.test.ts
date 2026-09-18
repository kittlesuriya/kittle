import { describe, expect, it, vi } from "vitest"
import { createOperationContext } from "../operationContext"
import { runOperation } from "../operationPipeline"
import type { PersistenceProvider } from "../../ports"

function noTxProvider(): PersistenceProvider {
  return {
    dialect: "memory",
    capabilities: {
      interactiveTransactions: false,
      atomicBatch: false,
      returningInsert: false,
      readSessions: false,
      jsonQueries: false,
      exactDecimal: false,
      persistentConnection: false,
    },
    repository: () => {
      throw new Error("not used")
    },
  }
}

const runtimeCapabilities = {
  deferredExecution: true,
  objectStorage: false,
  cache: true,
} as const

describe("Batch H: read-without-authorization nudge", () => {
  it("warns for auth-less reads and names the operation key", async () => {
    const warn = vi.fn()
    const operation = createOperationContext({
      persistence: noTxProvider(),
      runtimeCapabilities: { ...runtimeCapabilities },
      logger: {
        debug: () => {},
        info: () => {},
        warn,
        error: () => {},
      },
    })

    const result = await runOperation({
      operation,
      definition: {
        key: "public-read",
        kind: "read",
        execute: async () => ({ ok: true }),
      },
      input: {},
    })

    expect(result).toEqual({ ok: true })
    expect(warn).toHaveBeenCalledTimes(1)
    const [message, data] = warn.mock.calls[0] as [
      string,
      Record<string, unknown>?,
    ]
    expect(message).toContain("public-read")
    expect(data).toMatchObject({ operationKey: "public-read" })
  })

  it("does not warn when authorization is present", async () => {
    const warn = vi.fn()
    const operation = createOperationContext({
      persistence: noTxProvider(),
      runtimeCapabilities: { ...runtimeCapabilities },
      logger: {
        debug: () => {},
        info: () => {},
        warn,
        error: () => {},
      },
    })

    await runOperation({
      operation,
      definition: {
        key: "guarded-read",
        kind: "read",
        authorization: { authorize: async () => ({ allowed: true }) },
        execute: async () => ({ ok: true }),
      },
      input: {},
    })

    expect(warn).not.toHaveBeenCalled()
  })
})
