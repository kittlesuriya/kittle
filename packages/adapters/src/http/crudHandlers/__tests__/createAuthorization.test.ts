/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { describe, expect, it, vi } from "vitest"
import type { EntityDescriptor, PersistenceProvider } from "core/ports"
import { ForbiddenError } from "core/domain"
import { assertProtectedCreateFields } from "../shared"
import type { FrameworkAdapterDeps, FrameworkSession } from "../../../server"
import { createFrameworkWriteHandler } from "../../createFrameworkWriteHandler"

type TestRow = {
  id: string
  tenantId: string
  version: number
  immutableCode: string
  name: string
}

const entity: EntityDescriptor<TestRow> = {
  name: "create-authorization-test",
  primaryKey: "id",
  tenantField: "tenantId",
  versionField: "version",
  immutableFields: ["immutableCode"],
  fields: {
    id: { type: "string" },
    tenantId: { type: "string" },
    version: { type: "number" },
    immutableCode: { type: "string" },
    name: { type: "string" },
  },
}

function session(): FrameworkSession {
  return {
    scope: "tenant",
    actor: { id: "actor-1", type: "tenant", tenantId: "tenant-1" },
    tenant: { id: "tenant-1", enabledModuleKeys: [], enabledModuleActions: {} },
    raw: {} as never,
  }
}

describe("CRUD create authorization", () => {
  it.each(["id", "tenantId", "version", "immutableCode"])(
    "rejects client-supplied %s",
    (field) => {
      expect(() =>
        assertProtectedCreateFields(entity, { [field]: "client" })
      ).toThrow(ForbiddenError)
    }
  )

  it("fails closed when a capability-enabled write has no ABAC bundle", async () => {
    const execute = vi.fn()
    const deps: FrameworkAdapterDeps = {
      assertValidCsrf: vi.fn(),
      resolveSession: vi.fn(async () => session()),
      hasCapability: vi.fn(() => true),
      resolveAbacBundle: vi.fn(async () => null),
      assertModuleEnabled: vi.fn(),
      assertModuleActionEnabled: vi.fn(),
      assertModuleCapabilityEnabled: vi.fn(),
      isOwnerBypass: vi.fn(() => false),
    }
    const handler = createFrameworkWriteHandler({
      adapterDeps: deps,
      scope: { scope: "tenant" },
      moduleKey: "test.create-authorization",
      action: "create",
      customCapabilityKey: "manage",
      createPersistence: vi.fn(() => ({}) as PersistenceProvider),
      definition: { key: "test.create", execute } as never,
      resolveInput: vi.fn(async () => ({})),
    })

    const response = await handler(
      new Request("https://example.test/items", { method: "POST" })
    )

    expect(response.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  it("fails closed when a skip-capability write has no ABAC bundle", async () => {
    const execute = vi.fn()
    const deps: FrameworkAdapterDeps = {
      assertValidCsrf: vi.fn(),
      resolveSession: vi.fn(async () => session()),
      hasCapability: vi.fn(),
      resolveAbacBundle: vi.fn(async () => null),
      assertModuleEnabled: vi.fn(),
      assertModuleActionEnabled: vi.fn(),
      assertModuleCapabilityEnabled: vi.fn(),
      isOwnerBypass: vi.fn(() => false),
    }
    const handler = createFrameworkWriteHandler({
      adapterDeps: deps,
      scope: { scope: "tenant" },
      moduleKey: "test.create-authorization",
      action: "create",
      skipCapabilityCheck: true,
      createPersistence: vi.fn(() => ({}) as PersistenceProvider),
      definition: { key: "test.create", execute } as never,
      resolveInput: vi.fn(async () => ({})),
    })

    const response = await handler(
      new Request("https://example.test/items", { method: "POST" })
    )

    expect(response.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  it("does not let an impersonated owner bypass ABAC", async () => {
    const execute = vi.fn()
    const resolveAbacBundle = vi.fn(async () => null)
    const impersonated = session()
    if (impersonated.actor)
      impersonated.actor.impersonatedById = "platform-admin-1"
    const deps: FrameworkAdapterDeps = {
      assertValidCsrf: vi.fn(),
      resolveSession: vi.fn(async () => impersonated),
      hasCapability: vi.fn(() => true),
      resolveAbacBundle,
      assertModuleEnabled: vi.fn(),
      assertModuleActionEnabled: vi.fn(),
      assertModuleCapabilityEnabled: vi.fn(),
      isOwnerBypass: vi.fn(() => true),
    }
    const handler = createFrameworkWriteHandler({
      adapterDeps: deps,
      scope: { scope: "tenant" },
      moduleKey: "test.create-authorization",
      action: "create",
      skipCapabilityCheck: true,
      createPersistence: vi.fn(() => ({}) as PersistenceProvider),
      definition: { key: "test.create", execute } as never,
      resolveInput: vi.fn(async () => ({})),
    })

    const response = await handler(
      new Request("https://example.test/items", { method: "POST" })
    )

    expect(response.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
    expect(resolveAbacBundle).toHaveBeenCalledTimes(1)
  })
})
