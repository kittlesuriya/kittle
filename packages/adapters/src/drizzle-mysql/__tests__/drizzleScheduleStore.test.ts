import { describe, expect, it, vi } from "vitest"
import { mysqlTable, text, int, boolean } from "drizzle-orm/mysql-core"
import { ConfigurationError, ValidationError } from "kittle-core/domain"
import { createDrizzleScheduleStore, type DrizzleScheduleStoreConfig } from "../drizzleScheduleStore"
import type { DrizzleSessionLike } from "../drizzleRepository"

const schedulesTable = mysqlTable("schedules", {
  id: text("id"),
  jobType: text("job_type"),
  jobVersion: int("job_version"),
  tenantId: text("tenant_id"),
  scope: text("scope"),
  payload: text("payload"),
  cronExpression: text("cron_expression"),
  timezone: text("timezone"),
  enabled: boolean("enabled"),
  overlapPolicy: text("overlap_policy"),
  misfirePolicy: text("misfire_policy"),
  nextRunAt: text("next_run_at"),
  lastRunAt: text("last_run_at"),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  claimToken: text("claim_token"),
})

function createConfig(
  overrides: Partial<{
    resolveTenantTimezones: DrizzleScheduleStoreConfig["resolveTenantTimezones"]
  }> = {}
): DrizzleScheduleStoreConfig {
  return {
    schedulesTable,
    columnMap: {
      schedules: {
        id: schedulesTable.id,
        jobType: schedulesTable.jobType,
        jobVersion: schedulesTable.jobVersion,
        tenantId: schedulesTable.tenantId,
        scope: schedulesTable.scope,
        payload: schedulesTable.payload,
        cronExpression: schedulesTable.cronExpression,
        timezone: schedulesTable.timezone,
        enabled: schedulesTable.enabled,
        overlapPolicy: schedulesTable.overlapPolicy,
        misfirePolicy: schedulesTable.misfirePolicy,
        nextRunAt: schedulesTable.nextRunAt,
        lastRunAt: schedulesTable.lastRunAt,
        lastStatus: schedulesTable.lastStatus,
        lastError: schedulesTable.lastError,
        leaseOwner: schedulesTable.leaseOwner,
        leaseExpiresAt: schedulesTable.leaseExpiresAt,
        claimToken: schedulesTable.claimToken,
      },
    },
    ...overrides,
  }
}

function createStore(
  rows: Record<string, unknown>[] = [],
  affectedRows: number[] = []
) {
  const updates: Record<string, unknown>[] = []
  const affectedQueue = [...affectedRows]
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => rows),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              offset: vi.fn(async () => rows),
            })),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values)
        return {
          where: vi.fn(async () => {
            const affected = affectedQueue.shift() ?? 1
            if (affected > 0 && rows[0]) Object.assign(rows[0], values)
            return { affectedRows: affected }
          }),
        }
      }),
    })),
  } as unknown as DrizzleSessionLike

  const config = createConfig()
  const store = createDrizzleScheduleStore(db, config, "Europe/Berlin")
  return { store, updates, db }
}

describe("DrizzleScheduleStore (MySQL)", () => {
  describe("column map validation", () => {
    it("throws ConfigurationError for missing required columns", () => {
      const db = {} as DrizzleSessionLike
      expect(() =>
        createDrizzleScheduleStore(db, {
          schedulesTable,
          columnMap: { schedules: {} },
        })
      ).toThrow(ConfigurationError)
    })
  })

  describe("claimDueSchedules", () => {
    it("claims eligible schedules", async () => {
      const { store } = createStore([
        {
          id: "s1",
          scope: "tenant",
          jobType: "SendEmail",
          jobVersion: 1,
          tenantId: "t1",
          payload: "{}",
          cronExpression: "0 * * * *",
          timezone: "UTC",
          overlapPolicy: "allow",
          misfirePolicy: "fire_now",
          nextRunAt: new Date().toISOString(),
          lastRunAt: null,
          lastStatus: null,
        },
      ])
      const claims = await store.claimDueSchedules({
        workerId: "w1",
        leaseDurationMs: 30_000,
        limit: 10,
      })
      expect(claims).toHaveLength(1)
      expect(claims[0].scheduleId).toBe("s1")
      expect(claims[0].scope).toBe("tenant")
      expect(claims[0].timezone).toBe("UTC")
    })

    it("returns empty when no eligible schedules", async () => {
      const { store } = createStore([])
      const claims = await store.claimDueSchedules({
        workerId: "w1",
        leaseDurationMs: 30_000,
        limit: 10,
      })
      expect(claims).toHaveLength(0)
    })

    it("rejects invalid workerId", async () => {
      const { store } = createStore([{ id: "s1", enabled: true, nextRunAt: new Date().toISOString(), lastStatus: null }])
      await expect(
        store.claimDueSchedules({
          workerId: "",
          leaseDurationMs: 30_000,
          limit: 10,
        })
      ).rejects.toThrow()
    })

    it("preserves stored timezone from schedule", async () => {
      const { store } = createStore([
        {
          id: "s1",
          scope: "tenant",
          jobType: "Job",
          jobVersion: 1,
          tenantId: "t1",
          payload: "{}",
          cronExpression: "0 * * * *",
          timezone: "America/New_York",
          overlapPolicy: "allow",
          misfirePolicy: "fire_now",
          nextRunAt: new Date().toISOString(),
          lastRunAt: null,
          lastStatus: null,
        },
      ])
      const claims = await store.claimDueSchedules({
        workerId: "w1",
        leaseDurationMs: 30_000,
        limit: 10,
      })
      expect(claims[0].timezone).toBe("America/New_York")
    })
  })

  describe("advanceSchedule", () => {
    it("returns true when schedule advanced", async () => {
      const { store } = createStore([{ id: "s1" }], [1])
      const result = await store.advanceSchedule({
        scheduleId: "s1",
        workerId: "w1",
        claimToken: "tok",
        nextRunAt: new Date(),
        lastRunAt: new Date(),
        lastStatus: "succeeded",
      })
      expect(result).toBe(true)
    })

    it("returns false when no claimToken", async () => {
      const { store } = createStore()
      const result = await store.advanceSchedule({
        scheduleId: "s1",
        workerId: "w1",
        claimToken: undefined,
        nextRunAt: new Date(),
        lastRunAt: new Date(),
        lastStatus: "succeeded",
      })
      expect(result).toBe(false)
    })
  })

  describe("releaseSchedule", () => {
    it("returns true when released", async () => {
      const { store } = createStore([{ id: "s1" }], [1])
      const result = await store.releaseSchedule({
        scheduleId: "s1",
        workerId: "w1",
        claimToken: "tok",
      })
      expect(result).toBe(true)
    })

    it("returns false when no claimToken", async () => {
      const { store } = createStore()
      const result = await store.releaseSchedule({
        scheduleId: "s1",
        workerId: "w1",
        claimToken: undefined,
      })
      expect(result).toBe(false)
    })
  })

  describe("renewScheduleLease", () => {
    it("returns true on successful renewal", async () => {
      const { store } = createStore([{ id: "s1" }], [1])
      const result = await store.renewScheduleLease({
        scheduleId: "s1",
        workerId: "w1",
        claimToken: "tok",
        extendByMs: 10_000,
      })
      expect(result).toBe(true)
    })

    it("returns false for non-positive extension", async () => {
      const { store } = createStore()
      const result = await store.renewScheduleLease({
        scheduleId: "s1",
        workerId: "w1",
        claimToken: "tok",
        extendByMs: -1,
      })
      expect(result).toBe(false)
    })
  })
})
