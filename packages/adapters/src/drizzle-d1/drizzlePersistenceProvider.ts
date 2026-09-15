import { and, eq, sql, type AnyColumn } from "drizzle-orm"
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type {
  PersistenceCapabilities,
  AtomicBatchPlan,
  AtomicBatchProvider,
  AtomicBatchResult,
  AuditRecord,
  EntityDescriptor,
  OutboxRecord,
  PersistenceProvider,
  Repository,
  TenantScopedAtomicBatchCommandEncoder,
  TenantScopedWriteCommand,
} from "kittle-core/ports"
import { canonicalJsonString } from "kittle-core/foundation/canonicalJson"
import type { DrizzleD1Adapter } from "./d1Session"
import type { DrizzleSessionLike } from "./drizzleRepository"
import { createDrizzleD1Adapter } from "./d1Session"
import { createDrizzleRepository } from "./drizzleRepository"
import type { DrizzleColumnMap } from "./drizzlePredicateCompiler"
import {
  ConfigurationError,
  ConflictError,
  ImmutableFieldViolationError,
  TenantScopeViolationError,
} from "kittle-core/domain"
import { Predicate } from "kittle-core/domain"
import { compileDrizzlePredicate } from "./drizzlePredicateCompiler"
import { assertD1BatchLimits, estimateD1Statement } from "./d1BatchLimits"
import { d1CurrentEpochMilliseconds } from "./d1Utils"

const sessionByProvider = new WeakMap<PersistenceProvider, DrizzleSessionLike>()

export const PLATFORM_IDEMPOTENCY_SCOPE = "__platform__"

const OUTBOX_FINGERPRINT_VERSION = "v2"

/**
 * Canonical, locale-independent durable outbox event fingerprint. Only the
 * current versioned fingerprint is accepted; historical rows must be migrated
 * offline to this format before deployment (no runtime legacy matching).
 */
export async function fingerprintOutboxRecord(
  record: OutboxRecord
): Promise<string> {
  const canonical = canonicalJsonString({
    tenantId: record.tenantId ?? null,
    type: record.type,
    version: record.version,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    payload: record.payload,
  })
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  )
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `${OUTBOX_FINGERPRINT_VERSION}:${hex}`
}

export function getDrizzleSession(
  provider: PersistenceProvider
): DrizzleSessionLike {
  const session = sessionByProvider.get(provider)
  if (!session)
    throw new ConfigurationError(
      "No Drizzle session found for this persistence provider"
    )
  return session
}

export interface EntityMapping {
  table: AnySQLiteTable
  columnMap: DrizzleColumnMap
  entity: EntityDescriptor<Record<string, unknown>>
}

export type AuditRecordMapper = (record: AuditRecord) => Record<string, unknown>

export class DrizzleEntityRegistry {
  private mappings = new Map<string, EntityMapping>()

  register<T>(
    entity: EntityDescriptor<T>,
    table: AnySQLiteTable,
    columnMap: DrizzleColumnMap,
    namespace?: string
  ): this {
    const key = namespace ? `${namespace}:${entity.name}` : entity.name
    validateEntityRegistration(entity, columnMap, key)
    if (this.mappings.has(key)) {
      throw new ConfigurationError(
        `Entity "${key}" is already registered in the Drizzle entity registry.`
      )
    }
    this.mappings.set(key, { table, columnMap, entity })
    return this
  }

  get(entityName: string, namespace?: string): EntityMapping | undefined {
    const key = namespace ? `${namespace}:${entityName}` : entityName
    return this.mappings.get(key)
  }
}

function validateEntityRegistration<T>(
  entity: EntityDescriptor<T>,
  columnMap: DrizzleColumnMap,
  key: string
): void {
  if (!entity || typeof entity.name !== "string" || entity.name.trim() === "") {
    throw new ConfigurationError(
      `Drizzle registry registration "${key}" requires a non-empty entity name.`
    )
  }
  if (
    !entity.fields ||
    typeof entity.fields !== "object" ||
    Object.keys(entity.fields).length === 0
  ) {
    throw new ConfigurationError(
      `Entity "${key}" must declare fields before registration.`
    )
  }
  for (const mapKey of Object.keys(columnMap)) {
    if (mapKey === "") {
      throw new ConfigurationError(
        `Entity "${key}" declares an empty column map key.`
      )
    }
  }
  const declaredFields = Object.keys(entity.fields)
  const missingFields = declaredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(columnMap, field)
  )
  if (missingFields.length > 0) {
    throw new ConfigurationError(
      `Entity "${key}" column map is missing fields: ${missingFields.join(", ")}.`
    )
  }
  const primaryKey = entity.primaryKey ?? ("id" as string)
  if (!declaredFields.includes(String(primaryKey))) {
    throw new ConfigurationError(
      `Entity "${key}" primary key "${String(primaryKey)}" is not a declared field.`
    )
  }
  if (
    entity.versionField !== undefined &&
    !declaredFields.includes(String(entity.versionField))
  ) {
    throw new ConfigurationError(
      `Entity "${key}" version field "${String(entity.versionField)}" is not a declared field.`
    )
  }
}

export interface DrizzlePersistenceProviderArgs {
  db:
    | DrizzleD1Database<Record<string, never>>
    | DrizzleSessionLike
    | DrizzleD1Adapter
  registry: DrizzleEntityRegistry
  auditTable?: AnySQLiteTable
  outboxTable?: AnySQLiteTable
  /** Enables atomic idempotency commit receipts inside batches. */
  idempotencyTable?: AnySQLiteTable
  /**
   * Table used by the in-batch DB-enforced ownership assertion. A BEFORE INSERT
   * trigger on this table RAISEs when the exact reservation token is no longer
   * valid, which aborts the whole atomic batch.
   */
  idempotencyAssertionTable?: AnySQLiteTable
  /** Table with expected_affected_rows/actual_affected_rows CHECK constraint. */
  mutationAssertionTable?: AnySQLiteTable
  mapOutboxRecord?: (record: OutboxRecord) => Record<string, unknown>
  mapAuditRecord?: AuditRecordMapper
  limits?: {
    maxPageSize?: number
    maxBindParams?: number
    maxStatementBytes?: number
    maxBatchItems?: number
  }
  constraintMap?: Record<string, string>
}

type D1ConfiguredLimit =
  "maxPageSize" | "maxBindParams" | "maxStatementBytes" | "maxBatchItems"

function validateD1ConfiguredLimit(
  name: D1ConfiguredLimit,
  value: number | undefined
): number | undefined {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)
  ) {
    throw new ConfigurationError(`D1 ${name} must be a finite positive integer`)
  }
  return value
}

type EncodedD1Command = {
  readonly kind: "statement"
  readonly statement: RunnableQuery<unknown, "sqlite">
  readonly expectedAffectedRows?: number
}
export type DrizzleD1Command =
  RunnableQuery<unknown, "sqlite"> | TenantScopedWriteCommand | EncodedD1Command

function isEncodedD1Command(command: unknown): command is EncodedD1Command {
  return (
    typeof command === "object" &&
    command !== null &&
    (command as { kind?: unknown }).kind === "statement"
  )
}

function isTenantWriteCommand(
  command: DrizzleD1Command
): command is TenantScopedWriteCommand {
  return (
    typeof command === "object" &&
    command !== null &&
    "kind" in command &&
    (command.kind === "insert" ||
      command.kind === "update" ||
      command.kind === "delete")
  )
}

function drizzleValues(
  command: TenantScopedWriteCommand,
  mapping: EntityMapping,
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(values)) {
    const column = mapping.columnMap[field]
    if (!column)
      throw new ConfigurationError(
        `Entity "${command.entity}" does not map field "${field}"`
      )
    result[field] = value
  }
  return result
}

function assertProtectedUpdateFields(
  command: Extract<TenantScopedWriteCommand, { kind: "update" }>,
  mapping: EntityMapping
): void {
  const protectedFields = new Set<string>([
    mapping.entity.primaryKey ?? "id",
    ...(mapping.entity.versionField ? [mapping.entity.versionField] : []),
    ...(mapping.entity.immutableFields ?? []),
  ])
  const tenantField = mapping.entity.tenantField
  if (tenantField) protectedFields.add(tenantField)
  const provided = Object.keys(command.values).filter((field) =>
    protectedFields.has(field)
  )
  if (provided.length === 0) return
  if (tenantField && provided.includes(tenantField)) {
    throw new TenantScopeViolationError(
      `Cannot mutate tenant field "${tenantField}" on entity "${command.entity}" through update operations.`
    )
  }
  throw new ImmutableFieldViolationError(
    `Cannot mutate protected fields on entity "${command.entity}": ${provided.join(", ")}`
  )
}

function encodeResourceVersion(version: string | number): string {
  return typeof version === "number"
    ? JSON.stringify({ type: "number", value: version })
    : JSON.stringify({ type: "string", value: version })
}

function createTenantCommandEncoder(
  adapter: DrizzleD1Adapter,
  registry: DrizzleEntityRegistry,
  tenantId: string
): TenantScopedAtomicBatchCommandEncoder<DrizzleD1Command> {
  return {
    tenantId,
    encode(command) {
      if (!isTenantWriteCommand(command)) {
        throw new ConfigurationError(
          "Tenant-scoped D1 batches reject opaque Drizzle queries"
        )
      }
      const qualifiedCommand = command as TenantScopedWriteCommand & {
        namespace?: string
      }
      const mapping = registry.get(command.entity, qualifiedCommand.namespace)
      if (!mapping?.entity.tenantField) {
        throw new ConfigurationError(
          `Tenant-scoped command entity "${command.entity}" is not tenant-scoped`
        )
      }
      const tenantField = mapping.entity.tenantField
      if (command.kind === "insert") {
        const suppliedTenant = command.values[tenantField]
        if (suppliedTenant !== undefined && suppliedTenant !== tenantId) {
          throw new ConfigurationError(
            `Tenant-scoped insert for "${command.entity}" targets another tenant`
          )
        }
        const insertValues = mapping.entity.versionField
          ? { ...command.values, [mapping.entity.versionField]: 1 }
          : command.values
        return adapter.raw.insert(mapping.table).values(
          drizzleValues(command, mapping, {
            ...insertValues,
            [tenantField]: tenantId,
          })
        ) as DrizzleD1Command
      }
      const filter = Predicate.and(
        command.filter,
        Predicate.eq(tenantField, tenantId)
      )
      if (command.kind === "update") {
        assertProtectedUpdateFields(command, mapping)
        const versionField = mapping.entity.versionField
        if (versionField && command.expectedVersion === undefined) {
          throw new ConfigurationError(
            `Atomic update for versioned entity "${command.entity}" requires expectedVersion`
          )
        }
        const expectedVersion = command.expectedVersion
        const versionColumn = versionField
          ? mapping.columnMap[versionField]
          : undefined
        const values = versionField
          ? { ...command.values, [versionField]: sql`${versionColumn!} + 1` }
          : command.values
        const versionedFilter = versionField
          ? Predicate.and(filter, Predicate.eq(versionField, expectedVersion!))
          : filter
        return {
          kind: "statement",
          ...(command.expectedAffectedRows !== undefined
            ? { expectedAffectedRows: command.expectedAffectedRows }
            : {}),
          statement: adapter.raw
            .update(mapping.table)
            .set(drizzleValues(command, mapping, values))
            .where(
              compileDrizzlePredicate(versionedFilter, mapping.columnMap)
            ) as RunnableQuery<unknown, "sqlite">,
        }
      }
      if (
        mapping.entity.versionField &&
        command.expectedVersion === undefined
      ) {
        throw new ConfigurationError(
          `Atomic delete for versioned entity "${command.entity}" requires expectedVersion`
        )
      }
      const expectedVersion = command.expectedVersion
      const versionedFilter = mapping.entity.versionField
        ? Predicate.and(
            filter,
            Predicate.eq(mapping.entity.versionField, expectedVersion!)
          )
        : filter
      return {
        kind: "statement",
        ...(command.expectedAffectedRows !== undefined
          ? { expectedAffectedRows: command.expectedAffectedRows }
          : {}),
        statement: adapter.raw
          .delete(mapping.table)
          .where(
            compileDrizzlePredicate(versionedFilter, mapping.columnMap)
          ) as RunnableQuery<unknown, "sqlite">,
      }
    },
  }
}

function createUnscopedCommandEncoder(
  adapter: DrizzleD1Adapter,
  registry: DrizzleEntityRegistry
): (command: TenantScopedWriteCommand) => DrizzleD1Command {
  return (command) => {
    const qualifiedCommand = command as TenantScopedWriteCommand & {
      namespace?: string
    }
    const mapping = registry.get(command.entity, qualifiedCommand.namespace)
    if (!mapping)
      throw new ConfigurationError(
        `Entity "${command.entity}" is not registered in the Drizzle entity registry`
      )
    if (mapping.entity.tenantField) {
      throw new ConfigurationError(
        `Global D1 command entity "${command.entity}" must not be tenant-scoped`
      )
    }
    if (command.kind === "insert") {
      const insertValues = mapping.entity.versionField
        ? { ...command.values, [mapping.entity.versionField]: 1 }
        : command.values
      return adapter.raw
        .insert(mapping.table)
        .values(drizzleValues(command, mapping, insertValues)) as RunnableQuery<
        unknown,
        "sqlite"
      >
    }
    if (command.kind === "update") {
      assertProtectedUpdateFields(command, mapping)
      const versionField = mapping.entity.versionField
      if (versionField && command.expectedVersion === undefined) {
        throw new ConfigurationError(
          `Atomic update for versioned entity "${command.entity}" requires expectedVersion`
        )
      }
      const versionColumn = versionField
        ? mapping.columnMap[versionField]
        : undefined
      const values = versionField
        ? { ...command.values, [versionField]: sql`${versionColumn!} + 1` }
        : command.values
      const filter = versionField
        ? Predicate.and(
            command.filter,
            Predicate.eq(versionField, command.expectedVersion!)
          )
        : command.filter
      return {
        kind: "statement",
        ...(command.expectedAffectedRows !== undefined
          ? { expectedAffectedRows: command.expectedAffectedRows }
          : {}),
        statement: adapter.raw
          .update(mapping.table)
          .set(drizzleValues(command, mapping, values))
          .where(
            compileDrizzlePredicate(filter, mapping.columnMap)
          ) as RunnableQuery<unknown, "sqlite">,
      }
    }
    if (mapping.entity.versionField && command.expectedVersion === undefined) {
      throw new ConfigurationError(
        `Atomic delete for versioned entity "${command.entity}" requires expectedVersion`
      )
    }
    const filter = mapping.entity.versionField
      ? Predicate.and(
          command.filter,
          Predicate.eq(mapping.entity.versionField, command.expectedVersion!)
        )
      : command.filter
    return {
      kind: "statement",
      ...(command.expectedAffectedRows !== undefined
        ? { expectedAffectedRows: command.expectedAffectedRows }
        : {}),
      statement: adapter.raw
        .delete(mapping.table)
        .where(
          compileDrizzlePredicate(filter, mapping.columnMap)
        ) as RunnableQuery<unknown, "sqlite">,
    }
  }
}

function resolveAdapter(
  db: DrizzlePersistenceProviderArgs["db"]
): DrizzleD1Adapter | null {
  if ("raw" in db && "repository" in db) return db
  if ("batch" in db && typeof db.batch === "function")
    return createDrizzleD1Adapter(db)
  return null
}

export function mapAuditRecord(record: AuditRecord): Record<string, unknown> {
  return {
    id: record.id,
    createdAt: record.occurredAt,
    tenantId: record.tenantId,
    action: record.action,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    actorId: record.actor.id,
    actorType: record.actor.type,
    impersonatedByAdminId: record.actor.impersonatedById ?? null,
    oldValue: record.oldValue ? JSON.stringify(record.oldValue) : null,
    newValue: record.newValue ? JSON.stringify(record.newValue) : null,
    metadata: record.metadata ? JSON.stringify(record.metadata) : null,
  }
}

export function createDrizzlePersistenceProvider(
  args: DrizzlePersistenceProviderArgs
): PersistenceProvider {
  const adapter = resolveAdapter(args.db)
  const auditMapper = args.mapAuditRecord ?? mapAuditRecord
  const repositoryDb: DrizzleSessionLike =
    adapter?.repository ?? (args.db as DrizzleSessionLike)
  const maxPageSize = validateD1ConfiguredLimit(
    "maxPageSize",
    args.limits?.maxPageSize
  )
  const maxBindParams = validateD1ConfiguredLimit(
    "maxBindParams",
    args.limits?.maxBindParams
  )
  const maxStatementBytes = validateD1ConfiguredLimit(
    "maxStatementBytes",
    args.limits?.maxStatementBytes
  )
  const maxBatchItems = validateD1ConfiguredLimit(
    "maxBatchItems",
    args.limits?.maxBatchItems
  )
  const capabilities: PersistenceCapabilities = {
    interactiveTransactions: false,
    atomicBatch: adapter !== null,
    ...(adapter ? { atomicBatchScope: "unscoped" as const } : {}),
    ...(args.idempotencyTable && args.idempotencyAssertionTable
      ? { atomicBatchIdempotency: true as const }
      : {}),
    returningInsert: false,
    readSessions: false,
    jsonQueries: false,
    exactDecimal: false,
    persistentConnection: false,
    conditionalAbacUpdate: false,
    maxPageSize: maxPageSize ?? 100,
    maxBindParams: maxBindParams ?? 100,
    maxStatementBytes: maxStatementBytes ?? 100_000,
    maxBatchItems: maxBatchItems ?? 100,
  }

  const provider: PersistenceProvider = {
    dialect: "cloudflare-d1",
    capabilities,

    repository<T, TId = string>(
      entity: EntityDescriptor<T>
    ): Repository<T, TId> {
      const mapping = args.registry.get(
        entity.name,
        (entity as EntityDescriptor<T> & { namespace?: string }).namespace
      )
      if (!mapping) {
        throw new ConfigurationError(
          `Entity "${entity.name}" is not registered in the Drizzle entity registry`
        )
      }

      const repositoryArgs = {
        db: repositoryDb,
        table: mapping.table,
        entity: entity,
        columnMap: mapping.columnMap,
        ...(capabilities.maxPageSize !== undefined
          ? { maxPageSize: capabilities.maxPageSize }
          : {}),
        ...(args.constraintMap !== undefined
          ? { constraintMap: args.constraintMap }
          : {}),
      }
      return createDrizzleRepository(repositoryArgs) as unknown as Repository<
        T,
        TId
      >
    },
  }

  if (adapter) {
    const atomicProvider = provider as AtomicBatchProvider<DrizzleD1Command> & {
      createTenantScopedCommandEncoder: (
        tenantId: string
      ) => TenantScopedAtomicBatchCommandEncoder<DrizzleD1Command>
    }
    atomicProvider.createTenantScopedCommandEncoder = (tenantId) =>
      createTenantCommandEncoder(adapter, args.registry, tenantId)
    atomicProvider.executeAtomicBatch = async (
      plan: AtomicBatchPlan<DrizzleD1Command>
    ): Promise<AtomicBatchResult> => {
      const fingerprints = new Map<string, string>()
      const outboxFingerprints = new Map<OutboxRecord, string>()
      const verifiedIdempotentNoOps = new Set<OutboxRecord>()
      // Precheck: two concurrent identical requests may both see "absent" here,
      // so both build batches and the unique index on (scope, idempotencyKey)
      // deterministically aborts the loser's whole batch. That is safe — the
      // batch is atomic, so no duplicate commit can occur — but it does not
      // silently succeed; callers should retry the winning response.
      for (const item of plan.items) {
        if (item.kind !== "outbox") continue
        const scope = item.record.tenantId ?? PLATFORM_IDEMPOTENCY_SCOPE
        const key = `${scope}\u0000${item.record.idempotencyKey}`
        const fingerprint = await fingerprintOutboxRecord(item.record)
        outboxFingerprints.set(item.record, fingerprint)
        const previous = fingerprints.get(key)
        if (previous && previous !== fingerprint) {
          throw new ConflictError(
            "Outbox idempotency key was reused for a different event"
          )
        }
        fingerprints.set(key, fingerprint)
        if (!args.outboxTable) continue
        const table = args.outboxTable as AnySQLiteTable & {
          idempotencyScope?: AnyColumn
          idempotencyKey?: AnyColumn
        }
        if (!table.idempotencyScope || !table.idempotencyKey) continue
        const existingRows = await adapter.repository
          .select()
          .from(args.outboxTable)
          .where(
            and(
              eq(table.idempotencyScope, scope),
              eq(table.idempotencyKey, item.record.idempotencyKey)
            )
          )
          .limit(1)
        const existing = existingRows[0] as
          { eventFingerprint?: unknown } | undefined
        if (existing && existing.eventFingerprint !== fingerprint) {
          throw new ConflictError(
            "Outbox idempotency key was reused for a different event"
          )
        }
        if (existing) verifiedIdempotentNoOps.add(item.record)
      }
      const statementEntries: {
        itemIndex: number
        statement: RunnableQuery<unknown, "sqlite">
      }[] = []
      for (const [itemIndex, item] of plan.items.entries()) {
        if (item.kind === "command") {
          const encoded = isTenantWriteCommand(item.command)
            ? createUnscopedCommandEncoder(adapter, args.registry)(item.command)
            : item.command
          statementEntries.push({
            itemIndex,
            statement: isEncodedD1Command(encoded)
              ? encoded.statement
              : (encoded as RunnableQuery<unknown, "sqlite">),
          })
          if (
            isEncodedD1Command(encoded) &&
            encoded.expectedAffectedRows !== undefined
          ) {
            const mutationAssertionTable = args.mutationAssertionTable
            if (!mutationAssertionTable)
              throw new ConfigurationError(
                "D1 conditional atomic mutations require mutationAssertionTable"
              )
            statementEntries.push({
              itemIndex,
              statement: createMutationAssertion(
                adapter,
                mutationAssertionTable,
                encoded.expectedAffectedRows
              ),
            })
          }
          continue
        }
        if (item.kind === "audit") {
          if (!args.auditTable)
            throw new ConfigurationError(
              "D1 atomic batches require auditTable for audit items"
            )
          // Audit newValue/oldValue are the deterministic pre-commit command
          // projection (requested MUTATION INTENT), not the DB-real committed
          // state. DB defaults, triggers, generated columns, and framework
          // version increments may differ from what is recorded here.
          statementEntries.push({
            itemIndex,
            statement: adapter.raw.insert(args.auditTable).values({
              ...auditMapper(item.record),
              id: item.record.id,
            }),
          })
          continue
        }
        if (item.kind === "idempotency") {
          if (!args.idempotencyTable || !args.idempotencyAssertionTable) {
            throw new ConfigurationError(
              "D1 atomic batches require idempotencyTable and idempotencyAssertionTable for idempotency commit receipts"
            )
          }
          const columns = args.idempotencyTable as AnySQLiteTable & {
            scope?: AnyColumn
            key?: AnyColumn
            fingerprint?: AnyColumn
            token?: AnyColumn
            status?: AnyColumn
            result?: AnyColumn
            resourceEntity?: AnyColumn
            resourceId?: AnyColumn
            pendingInvalidations?: AnyColumn
            completedAt?: AnyColumn
          }
          // DB-enforced ownership fence: the assertion insert fires a trigger
          // that RAISEs (aborting the whole batch) when the exact reservation
          // token is no longer in-progress. A zero-row conditional UPDATE could
          // not abort the batch, so this assertion is mandatory.
          const assertion = adapter.raw
            .insert(args.idempotencyAssertionTable)
            .values({
              scope: item.commit.scope,
              key: item.commit.key,
              fingerprint: item.commit.fingerprint,
              token: item.commit.token,
            }) as unknown as RunnableQuery<unknown, "sqlite">
          // Durable commit receipt: proves the mutation committed and records
          // stable identity + obligations. It never stores a replayable result.
          const receipt = adapter.raw
            .update(args.idempotencyTable)
            .set({
              status: "business-committed",
              result: null,
              resourceEntity: item.commit.resource?.entity ?? null,
              resourceId: item.commit.resource?.id ?? null,
              resourceVersion:
                item.commit.resource?.version == null
                  ? null
                  : encodeResourceVersion(item.commit.resource.version),
              pendingInvalidations:
                item.commit.invalidations &&
                item.commit.invalidations.length > 0
                  ? JSON.stringify([...new Set(item.commit.invalidations)])
                  : null,
              completedAt: d1CurrentEpochMilliseconds(),
            })
            .where(
              and(
                eq(columns.scope!, item.commit.scope),
                eq(columns.key!, item.commit.key),
                eq(columns.fingerprint!, item.commit.fingerprint),
                eq(columns.token!, item.commit.token),
                eq(columns.status!, "in-progress")
              )
            ) as unknown as RunnableQuery<unknown, "sqlite">
          statementEntries.push(
            { itemIndex, statement: assertion },
            { itemIndex, statement: receipt }
          )
          continue
        }
        if (!args.outboxTable || !args.mapOutboxRecord) {
          throw new ConfigurationError(
            "D1 atomic batches require outboxTable and mapOutboxRecord for outbox items"
          )
        }
        const fingerprint = outboxFingerprints.get(item.record)
        if (!fingerprint)
          throw new ConfigurationError(
            "D1 atomic batch could not fingerprint its outbox item"
          )
        if (verifiedIdempotentNoOps.has(item.record)) {
          // Verified identical replay: emit a trivial SELECT so the batch still
          // returns a per-item result entry without re-inserting the event. The
          // no-table `SELECT 1` is constant-cost and never scans the outbox table.
          statementEntries.push({
            itemIndex,
            statement: adapter.raw.select({
              noop: sql`1`,
            }) as unknown as RunnableQuery<unknown, "sqlite">,
          })
          continue
        }
        statementEntries.push({
          itemIndex,
          statement: adapter.raw.insert(args.outboxTable).values({
            ...args.mapOutboxRecord(item.record),
            id: item.record.id,
            idempotencyScope:
              item.record.tenantId ?? PLATFORM_IDEMPOTENCY_SCOPE,
            eventFingerprint: fingerprint,
          }),
        })
      }
      if (statementEntries.length === 0) return []
      const statements = statementEntries.map((entry) => entry.statement)
      const [firstStatement, ...remainingStatements] = statements
      if (!firstStatement) return []
      const batchStatements =
        remainingStatements.length > 0
          ? ([firstStatement, ...remainingStatements] as const)
          : ([firstStatement] as const)
      assertD1BatchLimits(batchStatements.map(estimateD1Statement), {
        maxBindParams: capabilities.maxBindParams ?? 100,
        maxStatementBytes: capabilities.maxStatementBytes ?? 100_000,
        maxBatchItems: capabilities.maxBatchItems ?? 100,
      })
      const results: readonly unknown[] =
        await adapter.raw.batch(batchStatements)
      // Align batch results back to plan items (an idempotency item expands to
      // an assertion + a receipt statement).
      const perItemResults: import("kittle-core/ports").AtomicBatchItemResult[] =
        []
      let offset = 0
      for (const [itemIndex, item] of plan.items.entries()) {
        const count =
          statementEntries.filter((entry) => entry.itemIndex === itemIndex)
            .length || 1
        const itemResults = results.slice(offset, offset + count)
        offset += count
        if (item.kind === "idempotency") {
          perItemResults.push({
            kind: "idempotency",
            result: { assertion: itemResults[0], receipt: itemResults[1] },
          })
        } else {
          const first = itemResults[0]
          if (first === undefined)
            throw new ConfigurationError(
              "D1 atomic batch returned an unaddressable result."
            )
          perItemResults.push({ kind: item.kind, result: first })
        }
      }
      return perItemResults
    }
  }

  sessionByProvider.set(provider, repositoryDb)
  return provider
}

function createMutationAssertion(
  adapter: DrizzleD1Adapter,
  table: AnySQLiteTable,
  expectedAffectedRows: number
): RunnableQuery<unknown, "sqlite"> {
  const columns = table as AnySQLiteTable & {
    expectedAffectedRows?: AnyColumn
    actualAffectedRows?: AnyColumn
  }
  if (!columns.expectedAffectedRows || !columns.actualAffectedRows) {
    throw new ConfigurationError(
      "mutationAssertionTable must expose expectedAffectedRows and actualAffectedRows columns"
    )
  }
  return adapter.raw.insert(table).values({
    scope: "__mutation__",
    key: `mutation-${crypto.randomUUID()}`,
    fingerprint: "",
    token: "",
    expectedAffectedRows,
    actualAffectedRows: sql`changes()`,
  })
}
