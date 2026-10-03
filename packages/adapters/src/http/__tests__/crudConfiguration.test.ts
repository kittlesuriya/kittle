import { describe, expect, it } from "vitest"
import { defineEntity, ENTITY_DEFINITION_BRAND } from "kittle-core/entity"
import type { AuditSink } from "kittle-core/ports"
import type { FrameworkAdapterDeps } from "../../server"
import { CRUD, type CrudRuntime } from "../CRUD"
import { createStubAdapterDeps, resolveScopeConfig } from "../simpleRuntime"

const resolveSession = (async ({ scope }: { scope: "platform" }) => ({
  scope,
  actor: { id: "user-1", type: scope, bypassAuthority: true },
  raw: null,
})) as unknown as FrameworkAdapterDeps["resolveSession"]

const auditSinkFactory = (() =>
  ({}) as AuditSink) as unknown as NonNullable<
  CrudRuntime["auditSinkFactory"]
>

async function createRuntime(
  overrides: Partial<CrudRuntime> = {}
): Promise<CrudRuntime> {
  const scope = resolveScopeConfig("platform")
  return {
    adapterDeps: await createStubAdapterDeps(resolveSession, scope),
    scope,
    createPersistence: (() =>
      ({})) as unknown as NonNullable<CrudRuntime["createPersistence"]>,
    getCacheAdapter: async () => ({} as never),
    ...overrides,
  }
}

function createDefinition(audit?: { enabled?: boolean }) {
  return defineEntity({
    moduleKey: "tasks",
    entity: {
      name: "Task",
      primaryKey: "id",
      fields: {
        id: { type: "string" },
        title: { type: "string" },
        version: { type: "number" },
      },
    },
    tenantScoping: { mode: "none", acknowledged: true },
    policy: { skipCapabilityCheck: true },
    validation: {
      createBody: {
        parse: (input: unknown) => input,
        parseAsync: async (input: unknown) => input,
      },
      updateBody: {
        parse: (input: unknown) => input,
        parseAsync: async (input: unknown) => input,
      },
    },
    optimisticConcurrency: { versionField: "version" },
    ...(audit ? { audit } : {}),
  })
}

describe("CRUD() configuration guards", () => {
  it("rejects a definition that was not created by defineEntity()", async () => {
    const runtime = await createRuntime()

    expect(() => CRUD({} as never, runtime)).toThrow(
      "CRUD() requires an entity definition created by defineEntity()."
    )
  })

  it("rejects audit enabled when the runtime has no audit sink", async () => {
    const runtime = await createRuntime()
    const definition = createDefinition({ enabled: true })

    expect(() => CRUD(definition, runtime)).toThrow(
      'Entity "Task" has audit enabled but no auditSinkFactory was provided to CRUD().'
    )
  })

  it("rejects a durable audit guarantee when the runtime has no outbox sink", async () => {
    const runtime = await createRuntime({
      auditSinkFactory,
    })
    const definition = createDefinition({ enabled: true })
    // `defineEntity` does not model `auditGuarantee`, so mirror how the
    // pipeline reads it: a branded definition whose audit config carries it.
    const durable = {
      ...definition,
      audit: { ...definition.audit, auditGuarantee: "durable" },
    }
    Object.defineProperty(durable, ENTITY_DEFINITION_BRAND, {
      value: true,
      enumerable: false,
    })

    expect(() => CRUD(durable as never, runtime)).toThrow(
      'Entity "Task" configures durable audit guarantee without an outboxSinkFactory in CRUD().'
    )
  })

  it("builds the CRUD handler surface for a valid definition and runtime", async () => {
    const runtime = await createRuntime({ auditSinkFactory })
    const handlers = CRUD(createDefinition({ enabled: true }), runtime)

    expect(Object.keys(handlers).sort()).toEqual([
      "create",
      "delete",
      "detail",
      "list",
      "update",
    ])
    for (const handler of Object.values(handlers)) {
      expect(typeof handler).toBe("function")
    }
  })
})
