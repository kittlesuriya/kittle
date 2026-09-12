import { describe, expect, it, vi } from "vitest"
import type { EntityDescriptor, PersistenceProvider } from "kittle-core/ports"
import {
  bindAbacSecurityDigest,
  deriveAbacSecurityDigest,
  type AbacPolicyBundle,
  type VerifiedAbacPolicyBundle,
} from "kittle-core/domain"
import { createCrudHandlersInternal } from "../createCrudHandlers"
import { createFrameworkWriteHandler } from "../createFrameworkWriteHandler"
import type { FrameworkAdapterDeps, FrameworkSession } from "../../server"

type TestRow = { id: string; value: string }

const entity: EntityDescriptor<TestRow> = {
  name: "brand-enforcement-test",
  primaryKey: "id",
  fields: {
    id: { type: "string" },
    value: { type: "string" },
  },
}

function makeSession(): FrameworkSession {
  return {
    scope: "tenant",
    actor: { id: "actor-1", type: "tenant", tenantId: "tenant-1" },
    tenant: { id: "tenant-1", enabledModuleKeys: [], enabledModuleActions: {} },
    raw: {},
  }
}

function makePersistence(): PersistenceProvider {
  return {
    dialect: "test",
    capabilities: {} as PersistenceProvider["capabilities"],
    repository: () => ({
      findMany: async () => ({
        rows: [{ id: "row-1", value: "v1" }],
        rowCount: 1,
        page: 1,
        pageSize: 10,
      }),
      findById: async () => ({ id: "row-1", value: "v1" }),
      findOneWhere: async () => ({ id: "row-1", value: "v1" }),
    }),
  } as unknown as PersistenceProvider
}

function makeAdapterDeps(
  bundle: AbacPolicyBundle | null
): FrameworkAdapterDeps {
  const forgedAsVerified = bundle as unknown as
    import("../../server").AbacBundle | null
  return {
    assertValidCsrf: vi.fn(),
    resolveSession: vi.fn(async () => makeSession()),
    hasCapability: vi.fn(() => true),
    resolveAbacBundle: vi.fn(async () => forgedAsVerified),
    assertModuleEnabled: vi.fn(),
    assertModuleActionEnabled: vi.fn(),
    assertModuleCapabilityEnabled: vi.fn(),
    isOwnerBypass: vi.fn(() => false),
  }
}

/**
 * The exact forgery vector from P1-01: start from a factory-verified bundle,
 * strip the un-forgeable symbol brand by cloning through JSON, then recompute a
 * SHA-256 digest that is self-consistent with the forged content. The result
 * satisfies any digest-only check but never passed the production factory.
 */
async function forgeBundle(): Promise<AbacPolicyBundle> {
  const verified = await bindAbacSecurityDigest({
    mode: "tenant",
    moduleKey: "test.brand",
    policies: [],
    context: { tenantId: "tenant-1" },
    defaultEffect: "deny",
    fieldCatalog: {},
  })
  const stripped = JSON.parse(JSON.stringify(verified)) as AbacPolicyBundle
  const { securityDigest: _ignored, ...withoutDigest } = stripped
  return {
    ...withoutDigest,
    securityDigest: await deriveAbacSecurityDigest(withoutDigest),
  }
}

async function verifiedBundle(): Promise<VerifiedAbacPolicyBundle> {
  return bindAbacSecurityDigest({
    mode: "tenant",
    moduleKey: "test.brand",
    policies: [],
    context: { tenantId: "tenant-1" },
    defaultEffect: "deny",
    fieldCatalog: {},
  })
}

function makeReadHandlers(bundle: AbacPolicyBundle | null) {
  const handlers = createCrudHandlersInternal<TestRow>({
    adapterDeps: makeAdapterDeps(bundle),
    scope: { scope: "tenant" },
    moduleKey: "test.brand",
    entity,
    policy: { skipCapabilityCheck: true },
    cache: { enabled: false, tag: "test", keyPrefix: "test" },
    getCacheAdapter: async () => null as never,
    createPersistence: () => makePersistence(),
    runtimeCapabilities: {
      deferredExecution: false,
      objectStorage: false,
      cache: false,
    },
  })
  return handlers
}

describe("ABAC enforcement requires the verified brand at the enforcement boundary", () => {
  it("rejects a self-digest, brand-stripped bundle on the list read handler", async () => {
    const forged = await forgeBundle()
    const handlers = makeReadHandlers(forged)

    const response = await handlers.list(
      new Request("https://example.test/items")
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "Internal Server Error",
      code: "INTERNAL_SERVER_ERROR",
    })
  })

  it("still honors a factory-verified bundle on the list read handler", async () => {
    const verified = await verifiedBundle()
    const handlers = makeReadHandlers(verified)

    const response = await handlers.list(
      new Request("https://example.test/items")
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      rows: [{ id: "row-1", value: "v1" }],
    })
  })

  it("rejects a self-digest, brand-stripped bundle on the write handler", async () => {
    const forged = await forgeBundle()
    const handler = createFrameworkWriteHandler({
      adapterDeps: makeAdapterDeps(forged),
      scope: { scope: "tenant" },
      moduleKey: "test.brand",
      action: "create",
      skipCapabilityCheck: true,
      runtimeCapabilities: {
        deferredExecution: false,
        objectStorage: false,
        cache: false,
      },
      createPersistence: () => makePersistence(),
      definition: {
        key: "test.brand.create",
        kind: "mutation",
        atomicity: { kind: "standard", mode: "required" },
        authorization: { authorize: async () => ({ allowed: true }) },
        execute: async () => ({}),
      } as never,
      resolveInput: vi.fn(async () => ({})),
    })

    const response = await handler(
      new Request("https://example.test/items", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "Internal Server Error",
      code: "INTERNAL_SERVER_ERROR",
    })
  })
})
