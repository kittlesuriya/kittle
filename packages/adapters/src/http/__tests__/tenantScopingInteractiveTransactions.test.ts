/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, expect, it, vi } from "vitest"
import { createFrameworkWriteHandler } from "../createFrameworkWriteHandler"
import type { FrameworkAdapterDeps, FrameworkSession } from "../../server"
import type {
  PersistenceProvider,
  Repository,
  EntityDescriptor,
} from "kittle-core/ports"

type TestRow = {
  id: string
  tenantId: string
  name: string
}

const testEntity: EntityDescriptor<TestRow> = {
  name: "testRow",
  primaryKey: "id",
  tenantField: "tenantId",
  fields: {
    id: { type: "string" },
    tenantId: { type: "string" },
    name: { type: "string" },
  },
}

function createMockRepository(): Repository<TestRow> {
  return {
    findById: vi.fn(async () => null),
    findOneWhere: vi.fn(async () => null),
    findMany: vi.fn(async () => ({
      rows: [],
      rowCount: 0,
      page: 1,
      pageSize: 10,
    })),
    insert: vi.fn(async (data: Partial<TestRow>) => ({
      id: "row-1",
      tenantId: "tenant-a",
      name: "test",
      ...data,
    })),
    update: vi.fn(async (id: string, data: Partial<TestRow>) => ({
      id,
      tenantId: "tenant-a",
      name: "test",
      ...data,
    })),
    updateOneWhere: vi.fn(async () => ({ updatedCount: 1 })),
    updateManyWhere: vi.fn(async () => 1),
    delete: vi.fn(async () => undefined),
    deleteWhere: vi.fn(async () => ({ deletedCount: 1 })),
  }
}

function createInteractiveTransactionPersistence(
  repo: Repository<TestRow>
): PersistenceProvider {
  const basePersistence = {
    dialect: "test",
    capabilities: {
      interactiveTransactions: true,
      atomicBatch: false,
      returningInsert: false,
      readSessions: false,
      jsonQueries: false,
      exactDecimal: false,
      persistentConnection: false,
    },
    repository: (() => repo) as PersistenceProvider["repository"],
    runInTransaction: async <TResult>(
      work: (scoped: PersistenceProvider) => Promise<TResult>
    ): Promise<TResult> => {
      return work(basePersistence)
    },
  } as unknown as PersistenceProvider

  return basePersistence
}

function createTenantSession(tenantId: string): FrameworkSession {
  return {
    scope: "tenant" as const,
    actor: {
      id: "user-1",
      type: "tenant" as const,
      tenantId,
      bypassAuthority: true,
    },
    tenant: {
      id: tenantId,
      enabledModuleKeys: ["test.module"],
      enabledModuleActions: {},
    },
    raw: null,
  }
}

function createPlatformSession(): FrameworkSession {
  return {
    scope: "platform" as const,
    actor: { id: "user-1", type: "platform" as const, bypassAuthority: true },
    raw: null,
  }
}

function createHandler(
  session: FrameworkSession,
  repo: Repository<TestRow>,
  persistence: PersistenceProvider
) {
  const deps: FrameworkAdapterDeps = {
    assertValidCsrf: vi.fn(),
    resolveSession: vi.fn(async () => session),
    hasCapability: vi.fn(),
    resolveAbacBundle: vi.fn(async () => null),
    assertModuleEnabled: vi.fn(),
    assertModuleActionEnabled: vi.fn(),
    assertModuleCapabilityEnabled: vi.fn(),
    isOwnerBypass: vi.fn(() => true),
  }

  return createFrameworkWriteHandler({
    adapterDeps: deps,
    scope: { scope: session.scope },
    moduleKey: "test.module",
    action: "create",
    skipCapabilityCheck: true,
    runtimeCapabilities: {
      deferredExecution: true,
      objectStorage: false,
      cache: true,
    },
    createPersistence: () => persistence,
    definition: {
      key: "test.write",
      kind: "mutation",
      atomicity: { kind: "standard", mode: "required" },
      authorization: { authorize: async () => ({ allowed: true }) },
      execute: async ({
        operation,
      }: {
        operation: import("kittle-core/operation").OperationContext
      }) => {
        const scopedRepo = operation.persistence.repository(testEntity)
        await scopedRepo.findById("row-1")
        return { id: "row-1", name: "test" }
      },
    } as never,
    resolveInput: vi.fn(async () => ({})),
    validation: {
      body: {
        parse: (value: unknown) => value,
        parseAsync: async (value: unknown) => value,
      },
    },
  })
}

/** Match a predicate node that represents a tenant-scoped AND filter */
function tenantScopedFilter(tenantId: string) {
  return expect.objectContaining({
    kind: "and",
    filters: expect.arrayContaining([
      expect.objectContaining({
        kind: "condition",
        op: "eq",
        field: "tenantId",
        value: tenantId,
      }),
    ]),
  })
}

describe("tenant scoping with interactive transactions", () => {
  it("applies tenant scoping for tenant sessions with interactive transactions", async () => {
    const repo = createMockRepository()
    const persistence = createInteractiveTransactionPersistence(repo)
    const session = createTenantSession("tenant-a")

    const handler = createHandler(session, repo, persistence)
    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
    )

    expect(response.status).toBe(200)

    // The tenant-scoped wrapper calls findOneWhere (not findById) with a tenant-scoped filter
    expect(repo.findOneWhere).toHaveBeenCalledWith(
      tenantScopedFilter("tenant-a")
    )
  })

  it("does not apply tenant scoping for platform sessions", async () => {
    const repo = createMockRepository()
    const persistence = createInteractiveTransactionPersistence(repo)
    const session = createPlatformSession()

    const handler = createHandler(session, repo, persistence)
    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
    )

    expect(response.status).toBe(200)

    // Without tenant scoping, the scoped repo's findById calls the underlying findById
    // with the raw filter (no tenant scope injected)
    expect(repo.findById).toHaveBeenCalledWith("row-1")
  })

  it("verifies tenant isolation prevents cross-tenant data access", async () => {
    const repo = createMockRepository()
    // Simulate a row that belongs to a different tenant
    const otherTenantRow: TestRow = {
      id: "row-1",
      tenantId: "tenant-other",
      name: "other tenant data",
    }
    repo.findOneWhere = vi.fn(async () => otherTenantRow)

    const persistence = createInteractiveTransactionPersistence(repo)
    const session = createTenantSession("tenant-a")

    const handler = createHandler(session, repo, persistence)
    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
    )

    expect(response.status).toBe(200)

    // The tenant scoping wrapper adds tenant filter to prevent cross-tenant access
    expect(repo.findOneWhere).toHaveBeenCalledWith(
      tenantScopedFilter("tenant-a")
    )
  })

  it("re-wraps transaction-local persistence for tenant sessions with interactive transactions", async () => {
    const repo = createMockRepository()
    const tenantRepo = createMockRepository()

    // Create a transaction provider that returns a different persistence in the transaction
    const transactionLocalPersistence: PersistenceProvider = {
      dialect: "test",
      capabilities: {
        interactiveTransactions: true,
        atomicBatch: false,
        returningInsert: false,
        readSessions: false,
        jsonQueries: false,
        exactDecimal: false,
        persistentConnection: false,
      },
      repository: (() => tenantRepo) as PersistenceProvider["repository"],
    } as unknown as PersistenceProvider

    const transactionProvider: PersistenceProvider = {
      dialect: "test",
      capabilities: {
        interactiveTransactions: true,
        atomicBatch: false,
        returningInsert: false,
        readSessions: false,
        jsonQueries: false,
        exactDecimal: false,
        persistentConnection: false,
      },
      repository: (() => repo) as PersistenceProvider["repository"],
      runInTransaction: async <TResult>(
        work: (scoped: PersistenceProvider) => Promise<TResult>
      ): Promise<TResult> => {
        // Transaction provides a different persistence object
        return work(transactionLocalPersistence)
      },
    } as unknown as PersistenceProvider

    const session = createTenantSession("tenant-c")
    const handler = createHandler(session, repo, transactionProvider)

    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
    )

    expect(response.status).toBe(200)

    // The tenant scoping should be applied to the transaction-local persistence too
    // Because createTenantScopedPersistenceProvider wraps runInTransaction to re-wrap the callback arg
    expect(tenantRepo.findOneWhere).toHaveBeenCalledWith(
      tenantScopedFilter("tenant-c")
    )
  })
})
