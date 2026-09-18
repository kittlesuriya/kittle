import { describe, expect, it } from "vitest"
import {
  assertPersistenceCapabilities,
  assertRuntimeCapabilities,
} from "../capabilities"
import { assertPersistenceProviderShape } from "../persistence"
import { ConfigurationError } from "../../foundation/errors"

const validCapabilities = {
  interactiveTransactions: false,
  atomicBatch: false,
  returningInsert: false,
  readSessions: false,
  jsonQueries: false,
  exactDecimal: false,
  persistentConnection: false,
}

function validProvider() {
  return {
    dialect: "memory",
    capabilities: { ...validCapabilities },
    repository: () => {
      throw new Error("not used")
    },
  }
}

describe("capability and provider shape guards", () => {
  it("accepts well-formed documents", () => {
    expect(() =>
      assertPersistenceCapabilities({
        ...validCapabilities,
        atomicBatchScope: "tenant-scoped",
        maxPageSize: 100,
      })
    ).not.toThrow()
    expect(() =>
      assertRuntimeCapabilities({
        deferredExecution: true,
        objectStorage: false,
        cache: true,
      })
    ).not.toThrow()
    expect(() => assertPersistenceProviderShape(validProvider())).not.toThrow()
  })

  it.each([[null], [[]], [{ ...validCapabilities, atomicBatch: "yes" }], [{ ...validCapabilities, atomicBatchScope: "global" }], [{ ...validCapabilities, maxPageSize: 0 }]])(
    "rejects malformed capabilities %p",
    (capabilities) => {
      expect(() => assertPersistenceCapabilities(capabilities)).toThrow(
        ConfigurationError
      )
    }
  )

  it.each([[null], [{ deferredExecution: true }], [{ deferredExecution: "yes", objectStorage: false, cache: false }]])(
    "rejects malformed runtime capabilities %p",
    (capabilities) => {
      expect(() => assertRuntimeCapabilities(capabilities)).toThrow(
        ConfigurationError
      )
    }
  )

  it.each([
    [null],
    [{ ...validProvider(), dialect: "" }],
    [{ ...validProvider(), repository: undefined }],
    [{ ...validProvider(), capabilities: null }],
  ])("rejects malformed providers %p", (provider) => {
    expect(() => assertPersistenceProviderShape(provider)).toThrow(
      ConfigurationError
    )
  })
})
