/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it } from "vitest"
import type { EntityDescriptor, PersistenceProvider } from "kittle-core/ports"
import { z } from "zod"
import { createCreateHandler } from "../create"
import type { CrudShared } from "../types"

type TestRow = { id: string; tenantId: string; name: string }
type TestShared = CrudShared<
  TestRow,
  TestRow,
  Partial<TestRow>,
  TestRow,
  TestRow
>

const entity: EntityDescriptor<TestRow> = {
  name: "mutation-hook-test",
  primaryKey: "id",
  tenantField: "tenantId",
  fields: {
    id: { type: "string" },
    tenantId: { type: "string" },
    name: { type: "string" },
  },
}

function makePersistence(store: Map<string, TestRow>): PersistenceProvider {
  return {
    dialect: "test",
    capabilities: {
      interactiveTransactions: true,
      atomicBatch: false,
      returningInsert: false,
      readSessions: false,
      jsonQueries: false,
      exactDecimal: false,
      persistentConnection: false,
      maxPageSize: 100,
      maxBindParams: 100,
      maxStatementBytes: 100_000,
    },
    repository: () => ({
      findMany: async () => ({
        rows: [...store.values()],
        rowCount: store.size,
        page: 1,
        pageSize: store.size || 10,
      }),
      findById: async (id: string) => store.get(id) ?? null,
      findOneWhere: async () => [...store.values()][0] ?? null,
      insert: async (data: Partial<TestRow>) => {
        const row = {
          id: "row-1",
          tenantId: "tenant-1",
          name: "hooked",
          ...data,
        }
        store.set(row.id, row)
        return row
      },
      update: async (id: string, data: Partial<TestRow>) => {
        const row = {
          ...(store.get(id) ?? { id, tenantId: "tenant-1", name: "" }),
          ...data,
        }
        store.set(id, row)
        return row
      },
      updateOneWhereReturning: async () => null,
      delete: async () => undefined,
      deleteWhere: async () => ({ deletedCount: 0 }),
    }),
    runInTransaction: async (
      work: (scoped: PersistenceProvider) => Promise<unknown>
    ) => work(makePersistence(store)),
  } as unknown as PersistenceProvider
}

function makeHandler(opts: { hookWrites: boolean }) {
  const store = new Map<string, TestRow>()
  const currentSession = {
    value: {
      scope: "tenant" as const,
      actor: {
        id: "actor-1",
        type: "tenant" as const,
        tenantId: "tenant-1",
        bypassAuthority: true,
      },
      tenant: {
        id: "tenant-1",
        enabledModuleKeys: [],
        enabledModuleActions: {},
      },
      raw: {} as never,
    },
  }
  const persistence = makePersistence(store)
  const options = {
    adapterDeps: {
      resolveSession: async () => currentSession.value,
      assertValidCsrf: () => undefined,
      isOwnerBypass: () => true,
      resolveAbacBundle: async () => null,
      hasCapability: () => true,
      assertModuleEnabled: () => undefined,
      assertModuleActionEnabled: () => undefined,
      assertModuleCapabilityEnabled: () => undefined,
      effectFailureReporter: () => undefined,
    },
    scope: { scope: "tenant" as const, idempotency: { required: false } },
    moduleKey: "test.mutation-hook",
    entity,
    policy: { skipCapabilityCheck: true },
    cache: { enabled: false, tag: "test", keyPrefix: "test" },
    getCacheAdapter: async () => ({ deleteTag: async () => undefined }),
    createPersistence: () => persistence,
    validation: { createBody: z.object({ name: z.string() }) },
    audit: { enabled: false },
    runtimeCapabilities: {
      deferredExecution: true,
      objectStorage: false,
      cache: true,
    },
    crud: opts.hookWrites
      ? {
          create: {
            beforeCommitTransform: async ({
              input,
              context,
            }: {
              input: { name: string }
              context: { persistence: PersistenceProvider }
            }) => {
              await context.persistence
                .repository(entity)
                .insert({ id: "hook-write", name: "from-hook" })
              return input
            },
          },
        }
      : {},
  } as unknown as TestShared["options"]
  const shared = {
    options,
    entity,
    deps: options.adapterDeps,
    routes: {
      list: false,
      detail: false,
      create: true,
      update: false,
      delete: false,
    },
    writeCapabilityConfig: { skipCapabilityCheck: true },
    writeRuntimeCapabilities: options.runtimeCapabilities,
    buildReadTags: () => [],
    resolveDefaultSort: () => undefined,
    enforceReadRateLimit: async () => undefined,
    enforceReadAccess: async () => undefined,
    buildReadScope: () => ({ filter: undefined }),
    resolveReadScopeForSession: async () => ({ filter: undefined }),
  } as unknown as TestShared
  options.adapterDeps.resolveSession = async () => currentSession.value
  options.createPersistence = () => persistence
  return { handler: createCreateHandler(shared), store }
}

function request() {
  return new Request("https://example.test/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "created" }),
  })
}

describe("mutation lifecycle hooks are read-only by default", () => {
  it("rejects a repository write from a create before hook", async () => {
    const { handler, store } = makeHandler({ hookWrites: true })
    const response = await handler(request())
    expect(response.status).toBe(500)
    expect(store.size).toBe(0)
  })
})

function makeHandlerViaOperation(opts: {
  operationWrite: "insert" | "update" | "delete"
}) {
  const store = new Map<string, TestRow>()
  const currentSession = {
    value: {
      scope: "tenant" as const,
      actor: {
        id: "actor-1",
        type: "tenant" as const,
        tenantId: "tenant-1",
        bypassAuthority: true,
      },
      tenant: {
        id: "tenant-1",
        enabledModuleKeys: [],
        enabledModuleActions: {},
      },
      raw: {} as never,
    },
  }
  const persistence = makePersistence(store)
  const options = {
    adapterDeps: {
      resolveSession: async () => currentSession.value,
      assertValidCsrf: () => undefined,
      isOwnerBypass: () => true,
      resolveAbacBundle: async () => null,
      hasCapability: () => true,
      assertModuleEnabled: () => undefined,
      assertModuleActionEnabled: () => undefined,
      assertModuleCapabilityEnabled: () => undefined,
      effectFailureReporter: () => undefined,
    },
    scope: { scope: "tenant" as const, idempotency: { required: false } },
    moduleKey: "test.mutation-hook",
    entity,
    policy: { skipCapabilityCheck: true },
    cache: { enabled: false, tag: "test", keyPrefix: "test" },
    getCacheAdapter: async () => ({ deleteTag: async () => undefined }),
    createPersistence: () => persistence,
    validation: { createBody: z.object({ name: z.string() }) },
    audit: { enabled: false },
    runtimeCapabilities: {
      deferredExecution: true,
      objectStorage: false,
      cache: true,
    },
    crud: {
      create: {
        beforeCommitTransform: async ({
          input,
          context,
        }: {
          input: { name: string }
          context: {
            persistence: PersistenceProvider
            operation?: { persistence: PersistenceProvider }
          }
        }) => {
          const repo = context.operation!.persistence.repository(entity)
          if (opts.operationWrite === "insert") {
            await repo.insert({
              id: "op-hook-write",
              name: "from-operation-hook",
            })
          } else if (opts.operationWrite === "update") {
            await repo.update("existing-id", { name: "from-operation-hook" })
          } else {
            await repo.delete("existing-id")
          }
          return input
        },
      },
    },
  } as unknown as TestShared["options"]
  const shared = {
    options,
    entity,
    deps: options.adapterDeps,
    routes: {
      list: false,
      detail: false,
      create: true,
      update: false,
      delete: false,
    },
    writeCapabilityConfig: { skipCapabilityCheck: true },
    writeRuntimeCapabilities: options.runtimeCapabilities,
    buildReadTags: () => [],
    resolveDefaultSort: () => undefined,
    enforceReadRateLimit: async () => undefined,
    enforceReadAccess: async () => undefined,
    buildReadScope: () => ({ filter: undefined }),
    resolveReadScopeForSession: async () => ({ filter: undefined }),
  } as unknown as TestShared
  options.adapterDeps.resolveSession = async () => currentSession.value
  options.createPersistence = () => persistence
  return { handler: createCreateHandler(shared), store }
}

describe("context.operation.persistence is also read-only by default", () => {
  it("rejects insert via context.operation.persistence", async () => {
    const { handler, store } = makeHandlerViaOperation({
      operationWrite: "insert",
    })
    const response = await handler(request())
    expect(response.status).toBe(500)
    expect(store.size).toBe(0)
  })

  it("rejects update via context.operation.persistence", async () => {
    const { handler, store } = makeHandlerViaOperation({
      operationWrite: "update",
    })
    const response = await handler(request())
    expect(response.status).toBe(500)
  })

  it("rejects delete via context.operation.persistence", async () => {
    const { handler, store } = makeHandlerViaOperation({
      operationWrite: "delete",
    })
    const response = await handler(request())
    expect(response.status).toBe(500)
  })
})

// P1-06: The "writable hooks expose mutable persistence through both aliases"
// describe block was removed — writableMutationHooks is no longer supported.
// All mutation hooks are now always read-only.
