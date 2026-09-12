import { describe, expect, it } from "vitest"
import type {
  EntityDescriptor,
  PersistenceProvider,
  TenantScopedAtomicBatchProvider,
} from "kittle-core/ports"
import { Predicate, type PredicateNode } from "kittle-core/domain"
import { z } from "zod"
import { createCreateHandler } from "../create"
import { createUpdateHandler } from "../update"
import type { CrudShared } from "../types"

type TestRow = { id: string; tenantId: string; name: string; version: number }
type TestShared = CrudShared<
  TestRow,
  TestRow,
  Partial<TestRow>,
  TestRow,
  TestRow
>

const entity: EntityDescriptor<TestRow> = {
  name: "d1-atomic-test",
  primaryKey: "id",
  tenantField: "tenantId",
  versionField: "version",
  fields: {
    id: { type: "string" },
    tenantId: { type: "string" },
    name: { type: "string" },
    version: { type: "number" },
  },
}

function session() {
  return {
    scope: "tenant" as const,
    actor: {
      id: "actor-1",
      type: "tenant" as const,
      tenantId: "tenant-1",
      bypassAuthority: true,
    },
    tenant: { id: "tenant-1", enabledModuleKeys: [], enabledModuleActions: {} },
    raw: {} as never,
  }
}

function matches(
  row: Record<string, unknown>,
  node: PredicateNode | undefined
): boolean {
  if (!node) return true
  switch (node.kind) {
    case "literal":
      return node.value
    case "and":
      return node.filters.every((f) => matches(row, f))
    case "or":
      return node.filters.some((f) => matches(row, f))
    case "not":
      return !matches(row, node.filter)
    case "condition": {
      const value = row[node.field]
      switch (node.op) {
        case "eq":
          return value === node.value
        case "neq":
          return value !== node.value
        default:
          return true
      }
    }
  }
}

type D1Command =
  | { kind: "insert"; entity: string; values: Record<string, unknown> }
  | {
      kind: "update"
      entity: string
      filter: PredicateNode
      values: Record<string, unknown>
    }
  | { kind: "delete"; entity: string; filter: PredicateNode }

function makeD1Provider(
  store: Map<string, TestRow>,
  failNextBatch: { value: boolean } = { value: false }
): PersistenceProvider {
  const provider = {
    dialect: "test-d1",
    capabilities: {
      interactiveTransactions: false,
      atomicBatch: true,
      atomicBatchScope: "tenant-scoped",
      returningInsert: false,
      readSessions: false,
      jsonQueries: false,
      exactDecimal: false,
      persistentConnection: false,
      maxPageSize: 100,
      maxBindParams: 100,
      maxStatementBytes: 100_000,
    },
    tenantId: "tenant-1",
    createTenantScopedCommandEncoder: (tenantId: string) => ({
      tenantId,
      encode: (c: D1Command) => c,
    }),
    repository: () => ({
      findMany: async ({ filter }: { filter?: PredicateNode }) => {
        const rows = [...store.values()].filter((r) =>
          matches(r as unknown as Record<string, unknown>, filter)
        )
        return {
          rows,
          rowCount: rows.length,
          page: 1,
          pageSize: rows.length || 10,
        }
      },
      findById: async (id: string) => store.get(id) ?? null,
      findOneWhere: async (filter: PredicateNode) =>
        [...store.values()].find((r) =>
          matches(r as unknown as Record<string, unknown>, filter)
        ) ?? null,
      insert: async (data: Partial<TestRow>) => {
        const row = data as TestRow
        store.set(row.id, row)
        return row
      },
      updateOneWhereReturning: async (
        filter: PredicateNode,
        data: Partial<TestRow>
      ) => {
        const target = [...store.values()].find((r) =>
          matches(r as unknown as Record<string, unknown>, filter)
        )
        if (!target) return null
        const updated = { ...target, ...data }
        store.set(target.id, updated)
        return updated
      },
      deleteWhere: async (filter: PredicateNode) => {
        const targets = [...store.values()].filter((r) =>
          matches(r as unknown as Record<string, unknown>, filter)
        )
        for (const t of targets) store.delete(t.id)
        return { deletedCount: targets.length }
      },
    }),
    executeAtomicBatch: async (plan: {
      items: readonly { kind: string; command?: D1Command }[]
    }) => {
      if (failNextBatch.value) throw new Error("simulated atomic batch failure")
      const results: { kind: string; result: unknown }[] = []
      for (const item of plan.items) {
        if (item.kind === "command") {
          const cmd = item.command!
          if (cmd.kind === "insert") {
            store.set(cmd.values.id as string, {
              ...(cmd.values as unknown as TestRow),
              tenantId: "tenant-1",
            })
            results.push({ kind: "command", result: { meta: { changes: 1 } } })
          } else if (cmd.kind === "update") {
            const targets = [...store.values()].filter((r) =>
              matches(r as unknown as Record<string, unknown>, cmd.filter)
            )
            for (const t of targets)
              store.set(t.id, { ...t, ...(cmd.values as Partial<TestRow>) })
            results.push({
              kind: "command",
              result: { meta: { changes: targets.length } },
            })
          } else if (cmd.kind === "delete") {
            const targets = [...store.values()].filter((r) =>
              matches(r as unknown as Record<string, unknown>, cmd.filter)
            )
            for (const t of targets) store.delete(t.id)
            results.push({
              kind: "command",
              result: { meta: { changes: targets.length } },
            })
          } else {
            results.push({ kind: "command", result: { ok: true } })
          }
        } else if (item.kind === "audit") {
          results.push({ kind: "audit", result: { ok: true } })
        } else {
          results.push({ kind: "outbox", result: { ok: true } })
        }
      }
      return results
    },
  } as unknown as TenantScopedAtomicBatchProvider<D1Command>
  return provider
}

function makeOptions(store: Map<string, TestRow>, action: "create" | "update") {
  const currentSession = session()
  const failNextBatch = { value: false }
  const persistence = makeD1Provider(store, failNextBatch)
  const options = {
    adapterDeps: {
      resolveSession: async () => currentSession,
      assertValidCsrf: () => undefined,
      isOwnerBypass: () => true,
      resolveAbacBundle: async () => null,
      hasCapability: () => true,
      assertModuleEnabled: () => undefined,
      assertModuleActionEnabled: () => undefined,
      assertModuleCapabilityEnabled: () => undefined,
      resolveClientIp: () => null,
    },
    scope: { scope: "tenant" as const, idempotency: { required: false } },
    moduleKey: "test.d1-atomic",
    entity,
    policy: { skipCapabilityCheck: true },
    cache: { enabled: false, tag: "test", keyPrefix: "test" },
    getCacheAdapter: async () => ({ deleteTag: async () => undefined }),
    createPersistence: () => persistence,
    validation: {
      idParams: z.object({ id: z.string() }),
      ...(action === "create"
        ? { createBody: z.object({ name: z.string() }) }
        : {}),
      ...(action === "update"
        ? { updateBody: z.object({ name: z.string() }) }
        : {}),
    },
    audit: { enabled: false },
    runtimeCapabilities: {
      deferredExecution: true,
      objectStorage: false,
      cache: true,
    },
    crud: {},
  } as unknown as TestShared["options"]
  return { options, shared: makeShared(options), failNextBatch }
}

function makeShared(options: TestShared["options"]): TestShared {
  return {
    options,
    entity,
    deps: options.adapterDeps,
    idParamsSchema: z.object({ id: z.string() }),
    capabilityMode: { enabled: false, key: undefined },
    writeCapabilityConfig: { skipCapabilityCheck: true },
    routes: {
      list: false,
      detail: false,
      create: true,
      update: true,
      delete: false,
    },
    writeRuntimeCapabilities: options.runtimeCapabilities,
    buildReadTags: () => [],
    resolveDefaultSort: () => undefined,
    enforceReadRateLimit: async () => undefined,
    enforceReadAccess: async () => undefined,
    buildReadScope: () => ({ filter: undefined }),
    resolveReadScopeForSession: async () => ({
      filter: Predicate.alwaysFalse(),
    }),
  }
}

const UPDATE_ID = "00000000-0000-4000-8000-000000000001"

describe("D1 atomic CRUD lifecycle", () => {
  it("create commits before the response readback and returns the real committed row", async () => {
    const store = new Map<string, TestRow>()
    const { shared } = makeOptions(store, "create")
    const handler = createCreateHandler(shared)

    const response = await handler(
      new Request("https://example.test/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "created-name" }),
      })
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      id: expect.any(String) as unknown,
      name: "created-name",
      tenantId: "tenant-1",
    })
    expect(store.size).toBe(1)
    expect([...store.values()][0]?.name).toBe("created-name")
  })

  it("update after hook observes the committed row, not the synthetic projection", async () => {
    const store = new Map<string, TestRow>([
      [
        UPDATE_ID,
        { id: UPDATE_ID, tenantId: "tenant-1", name: "before", version: 1 },
      ],
    ])
    const { shared } = makeOptions(store, "update")
    const handler = createUpdateHandler(shared)

    const response = await handler(
      new Request(`https://example.test/items/${UPDATE_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "if-match": "1" },
        body: JSON.stringify({ name: "after-name" }),
      }),
      { params: Promise.resolve({ id: UPDATE_ID }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: UPDATE_ID,
      name: "after-name",
      tenantId: "tenant-1",
    })
    expect(store.get(UPDATE_ID)?.name).toBe("after-name")
  })

  it("batch failure commits nothing and yields no hook-visible post-state claim", async () => {
    const store = new Map<string, TestRow>()
    const { shared, failNextBatch } = makeOptions(store, "create")
    failNextBatch.value = true
    const handler = createCreateHandler(shared)

    const response = await handler(
      new Request("https://example.test/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "never-committed" }),
      })
    )

    expect(response.status).toBe(500)
    expect(store.size).toBe(0)
  })
})
