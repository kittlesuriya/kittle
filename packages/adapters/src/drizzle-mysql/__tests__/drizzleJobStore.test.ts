import { describe, expect, it, vi } from "vitest"
import { mysqlTable, text, int } from "drizzle-orm/mysql-core"
import { ConfigurationError } from "kittle-core/domain"
import { createDrizzleJobStore, type DrizzleJobStoreConfig } from "../drizzleJobStore"
import type { DrizzleSessionLike } from "../drizzleRepository"

const jobsTable = mysqlTable("jobs", {
  id: text("id"),
  jobType: text("job_type"),
  jobVersion: int("job_version"),
  tenantId: text("tenant_id"),
  scope: text("scope"),
  payload: text("payload"),
  status: text("status"),
  priority: int("priority"),
  attempts: int("attempts"),
  maxAttempts: int("max_attempts"),
  runAt: text("run_at"),
  nextAttemptAt: text("next_attempt_at"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  claimToken: text("claim_token"),
  idempotencyKey: text("idempotency_key"),
  idempotencyScope: text("idempotency_scope"),
  fingerprint: text("fingerprint"),
  correlationId: text("correlation_id"),
  lastError: text("last_error"),
  resultPayload: text("result_payload"),
  metadata: text("metadata"),
  createdAt: text("created_at"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  partitionKey: text("partition_key"),
})

const executionsTable = mysqlTable("executions", {
  id: text("id"),
  jobId: text("job_id"),
  attempt: int("attempt"),
  workerId: text("worker_id"),
  status: text("status"),
  errorMessage: text("error_message"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
})

function createConfig(): DrizzleJobStoreConfig {
  return {
    jobsTable,
    executionsTable,
    columnMap: {
      jobs: {
        id: jobsTable.id,
        jobType: jobsTable.jobType,
        jobVersion: jobsTable.jobVersion,
        tenantId: jobsTable.tenantId,
        scope: jobsTable.scope,
        payload: jobsTable.payload,
        status: jobsTable.status,
        priority: jobsTable.priority,
        attempts: jobsTable.attempts,
        maxAttempts: jobsTable.maxAttempts,
        runAt: jobsTable.runAt,
        nextAttemptAt: jobsTable.nextAttemptAt,
        leaseOwner: jobsTable.leaseOwner,
        leaseExpiresAt: jobsTable.leaseExpiresAt,
        claimToken: jobsTable.claimToken,
        idempotencyKey: jobsTable.idempotencyKey,
        idempotencyScope: jobsTable.idempotencyScope,
        fingerprint: jobsTable.fingerprint,
        correlationId: jobsTable.correlationId,
        lastError: jobsTable.lastError,
        resultPayload: jobsTable.resultPayload,
        metadata: jobsTable.metadata,
        createdAt: jobsTable.createdAt,
        startedAt: jobsTable.startedAt,
        completedAt: jobsTable.completedAt,
        partitionKey: jobsTable.partitionKey,
      },
      executions: {
        id: executionsTable.id,
        jobId: executionsTable.jobId,
        attempt: executionsTable.attempt,
        workerId: executionsTable.workerId,
        status: executionsTable.status,
        errorMessage: executionsTable.errorMessage,
        startedAt: executionsTable.startedAt,
        finishedAt: executionsTable.finishedAt,
      },
    },
  }
}

function createStore(options: {
  selectRows?: Record<string, unknown>[]
  affectedRows?: number
  insertError?: Error
} = {}) {
  const selectRows = options.selectRows ?? []
  const affectedRows = options.affectedRows ?? 0
  const db = {
    insert: options.insertError
      ? vi.fn(() => {
          throw options.insertError
        })
      : vi.fn(() => ({
          values: vi.fn(async () => ({ affectedRows: 1 })),
        })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectRows),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              offset: vi.fn(async () => selectRows),
            })),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => ({ affectedRows })),
      })),
    })),
  } as unknown as DrizzleSessionLike

  const store = createDrizzleJobStore(db, createConfig())
  return { store, db }
}

describe("DrizzleJobStore (MySQL)", () => {
  describe("column map validation", () => {
    it("throws ConfigurationError for missing job columns", () => {
      const db = {} as DrizzleSessionLike
      expect(() =>
        createDrizzleJobStore(db, {
          jobsTable,
          executionsTable,
          columnMap: { jobs: {}, executions: {} },
        })
      ).toThrow(ConfigurationError)
    })

    it("throws ConfigurationError for missing execution columns", () => {
      const db = {} as DrizzleSessionLike
      const config = createConfig()
      config.columnMap.executions = {}
      expect(() => createDrizzleJobStore(db, config)).toThrow(
        ConfigurationError
      )
    })
  })

  describe("getById", () => {
    it("returns a job when found", async () => {
      const { store } = createStore({
        selectRows: [
          {
            id: "j1",
            jobType: "SendEmail",
            jobVersion: 1,
            tenantId: "t1",
            scope: "tenant",
            payload: "{}",
            status: "pending",
            priority: 0,
            attempts: 0,
            maxAttempts: 3,
            runAt: new Date().toISOString(),
            nextAttemptAt: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            claimToken: null,
            idempotencyKey: null,
            idempotencyScope: null,
            fingerprint: null,
            correlationId: null,
            lastError: null,
            resultPayload: null,
            metadata: null,
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            partitionKey: null,
          },
        ],
      })
      const job = await store.getById({
        id: "j1",
        requester: { scope: "tenant", tenantId: "t1" },
      })
      expect(job).not.toBeNull()
      expect(job?.id).toBe("j1")
      expect(job?.jobType).toBe("SendEmail")
    })

    it("returns null when not found", async () => {
      const { store } = createStore({ selectRows: [] })
      const job = await store.getById({
        id: "missing",
        requester: { scope: "platform" },
      })
      expect(job).toBeNull()
    })
  })

  describe("enqueue", () => {
    it("enqueues a job without idempotency key", async () => {
      const { store, db } = createStore({
        selectRows: [
          {
            id: "new-id",
            jobType: "TestJob",
            jobVersion: 1,
            tenantId: null,
            scope: "platform",
            payload: '{"data":"test"}',
            status: "pending",
            priority: 0,
            attempts: 0,
            maxAttempts: 3,
            runAt: new Date().toISOString(),
            nextAttemptAt: new Date().toISOString(),
            leaseOwner: null,
            leaseExpiresAt: null,
            claimToken: null,
            idempotencyKey: null,
            idempotencyScope: null,
            fingerprint: null,
            correlationId: null,
            lastError: null,
            resultPayload: null,
            metadata: null,
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            partitionKey: null,
          },
        ],
      })
      const job = await store.enqueue({
        job: {
          jobType: "TestJob",
          jobVersion: 1,
          scope: "platform",
          payload: { data: "test" },
        },
        requester: { scope: "platform" },
      })
      expect(job.status).toBe("pending")
      expect(db.insert).toHaveBeenCalled()
    })
  })

  describe("markSucceeded", () => {
    it("returns LEASE_LOST when no rows affected", async () => {
      const { store } = createStore({ affectedRows: 0 })
      const result = await store.markSucceeded({
        jobId: "j1",
        workerId: "w1",
        claimToken: "tok",
        attempt: 1,
        result: { ok: true },
      })
      expect(result.applied).toBe(false)
      expect(result.reason).toBe("LEASE_LOST")
    })

    it("applies successfully when rows affected", async () => {
      const { store } = createStore({ affectedRows: 1 })
      const result = await store.markSucceeded({
        jobId: "j1",
        workerId: "w1",
        claimToken: "tok",
        attempt: 1,
        result: { ok: true },
      })
      expect(result.applied).toBe(true)
      expect(result.transitionToken).toBeDefined()
    })
  })

  describe("markRetrying", () => {
    it("returns LEASE_LOST when no rows affected", async () => {
      const { store } = createStore({ affectedRows: 0 })
      const result = await store.markRetrying({
        jobId: "j1",
        workerId: "w1",
        claimToken: "tok",
        attempt: 1,
        error: "failed",
        nextAttemptAt: new Date(),
      })
      expect(result.applied).toBe(false)
      expect(result.reason).toBe("LEASE_LOST")
    })
  })

  describe("markFailed", () => {
    it("applies when rows affected", async () => {
      const { store } = createStore({ affectedRows: 1 })
      const result = await store.markFailed({
        jobId: "j1",
        workerId: "w1",
        claimToken: "tok",
        attempt: 1,
        error: "boom",
        status: "dead_letter",
      })
      expect(result.applied).toBe(true)
    })
  })

  describe("cancel", () => {
    it("returns INVALID_STATE when job not found", async () => {
      const { store } = createStore({ selectRows: [], affectedRows: 0 })
      const result = await store.cancel({
        jobId: "j1",
        requester: { scope: "platform" },
      })
      expect(result.applied).toBe(false)
      expect(result.reason).toBe("INVALID_STATE")
    })
  })

  describe("findPending", () => {
    it("returns pending jobs", async () => {
      const { store } = createStore({
        selectRows: [
          {
            id: "j1",
            jobType: "TestJob",
            jobVersion: 1,
            tenantId: null,
            scope: "platform",
            payload: "{}",
            status: "pending",
            priority: 0,
            attempts: 0,
            maxAttempts: 3,
            runAt: new Date().toISOString(),
            nextAttemptAt: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            claimToken: null,
            idempotencyKey: null,
            idempotencyScope: null,
            fingerprint: null,
            correlationId: null,
            lastError: null,
            resultPayload: null,
            metadata: null,
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            partitionKey: null,
          },
        ],
      })
      const jobs = await store.findPending({
        requester: { scope: "platform" },
        limit: 10,
      })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe("j1")
    })
  })
})
