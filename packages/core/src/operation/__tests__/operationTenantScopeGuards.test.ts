import { describe, expect, it } from "vitest"
import {
  createOperationContext,
  createOperationRunContext,
} from "../operationContext"
import { runOperation } from "../operationPipeline"
import { createTenantScopedPersistenceProvider } from "../../ports"
import type {
  PersistenceProvider,
  RuntimeCapabilities,
} from "../../ports"
import { TenantScopeViolationError } from "../../foundation/errors"

const defaultRuntimeCaps: RuntimeCapabilities = {
  deferredExecution: true,
  objectStorage: false,
  cache: true,
}

function baseProvider(): PersistenceProvider {
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

function tenantLessEnvironment(persistence: PersistenceProvider) {
  return createOperationContext({
    persistence,
    runtimeCapabilities: defaultRuntimeCaps,
    request: {
      requestId: "request-1",
      correlationId: "correlation-1",
    },
  })
}

describe("tenant-less requests cannot use tenant-scoped persistence", () => {
  it("rejects scoped persistence at run-context creation", () => {
    const scoped = createTenantScopedPersistenceProvider(
      baseProvider(),
      "tenant-a"
    )
    expect(() =>
      createOperationRunContext(tenantLessEnvironment(scoped))
    ).toThrow(TenantScopeViolationError)
  })

  it("rejects switching to scoped persistence via withPersistence", () => {
    const scoped = createTenantScopedPersistenceProvider(
      baseProvider(),
      "tenant-a"
    )
    const runContext = createOperationRunContext(
      tenantLessEnvironment(baseProvider())
    )
    expect(() => runContext.withPersistence(scoped)).toThrow(
      TenantScopeViolationError
    )
  })

  it("rejects the operation before executing", async () => {
    const scoped = createTenantScopedPersistenceProvider(
      baseProvider(),
      "tenant-a"
    )
    await expect(
      runOperation({
        operation: tenantLessEnvironment(scoped),
        definition: {
          key: "tenant-less-on-scoped",
          kind: "read",
          execute: async () => ({ ok: true }),
        },
        input: {},
      })
    ).rejects.toBeInstanceOf(TenantScopeViolationError)
  })

  it("still allows matching tenant requests on scoped persistence", async () => {
    const scoped = createTenantScopedPersistenceProvider(
      baseProvider(),
      "tenant-a"
    )
    await expect(
      runOperation({
        operation: createOperationContext({
          persistence: scoped,
          runtimeCapabilities: defaultRuntimeCaps,
          request: {
            requestId: "request-1",
            correlationId: "correlation-1",
            tenantId: "tenant-a",
          },
        }),
        definition: {
          key: "matched-tenant-read",
          kind: "read",
          execute: async () => ({ ok: true }),
        },
        input: {},
      })
    ).resolves.toEqual({ ok: true })
  })
})
