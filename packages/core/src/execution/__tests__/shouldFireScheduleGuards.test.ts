import { describe, expect, it } from "vitest"
import {
  assertSchedulePolicies,
  shouldFireSchedule,
} from "../scheduleCalculator"
import { ValidationError } from "../../foundation/errors"
import type { ScheduleDefinition } from "../types"

type FireSchedule = Parameters<typeof shouldFireSchedule>[0]["schedule"]

function makeSchedule(overrides: Partial<FireSchedule> = {}): FireSchedule {
  return {
    cronExpression: "* * * * *",
    timezone: "UTC",
    enabled: true,
    misfirePolicy: { type: "fire_now" },
    overlapPolicy: { type: "allow" },
    nextRunAt: new Date("2026-08-01T10:00:00Z"),
    lastRunAt: null,
    lastStatus: null,
    ...overrides,
  }
}

const onTime = new Date("2026-08-01T10:01:00Z")
const stale = new Date("2026-08-01T12:30:00Z")

function fire(
  schedule: FireSchedule,
  now: Date = onTime,
  priorExecutionStatus: Parameters<typeof shouldFireSchedule>[0]["priorExecutionStatus"] = null
) {
  return shouldFireSchedule({ schedule, now, priorExecutionStatus })
}

describe("shouldFireSchedule policy guards", () => {
  it.each(["sometimes", "", "ALLOW", null, undefined])(
    "throws ValidationError on unknown overlapPolicy type %s",
    (type) => {
      expect(() =>
        fire(
          makeSchedule({ overlapPolicy: { type: type as never } })
        )
      ).toThrow(ValidationError)
    }
  )

  it.each(["eventually", "", "FIRE_NOW", null, undefined])(
    "throws ValidationError on unknown misfirePolicy type %s",
    (type) => {
      expect(() =>
        fire(makeSchedule({ misfirePolicy: { type: type as never } }))
      ).toThrow(ValidationError)
    }
  )

  it("validates policies before any firing decision", () => {
    // Even a disabled schedule with an unknown policy must fail loudly
    // instead of silently ignoring malformed policy data.
    expect(() =>
      fire(
        makeSchedule({
          enabled: false,
          overlapPolicy: { type: "bogus" as never },
        })
      )
    ).toThrow(ValidationError)
    expect(() =>
      fire(
        makeSchedule({
          enabled: false,
          misfirePolicy: { type: "bogus" as never },
        })
      )
    ).toThrow(ValidationError)
  })

  it("assertSchedulePolicies accepts known types and rejects unknown ones", () => {
    expect(() =>
      assertSchedulePolicies({
        overlapPolicy: { type: "skip" },
        misfirePolicy: { type: "queue_all" },
      })
    ).not.toThrow()
    expect(() =>
      assertSchedulePolicies({
        overlapPolicy: { type: "bogus" },
        misfirePolicy: { type: "fire_now" },
      })
    ).toThrow(ValidationError)
    expect(() =>
      assertSchedulePolicies({
        overlapPolicy: { type: "allow" },
        misfirePolicy: { type: "bogus" },
      })
    ).toThrow(ValidationError)
  })

  it.each([
    ["allow", "fire"],
    ["queue", "queue"],
  ] as const)("overlap %s behaves as before", (type, expected) => {
    expect(fire(makeSchedule({ overlapPolicy: { type } }))).toBe(expected)
  })

  it("overlap skip still skips only while prior work is active", () => {
    const schedule = makeSchedule({ overlapPolicy: { type: "skip" } })
    expect(fire(schedule, onTime, "queued")).toBe("skip")
    expect(fire(schedule, onTime, "running")).toBe("skip")
    expect(fire(schedule, onTime, "completed")).toBe("fire")
    expect(fire(schedule, onTime, "failed")).toBe("fire")
    expect(
      fire(
        makeSchedule({
          overlapPolicy: { type: "skip" },
          lastStatus: "running",
        }),
        onTime,
        null
      )
    ).toBe("skip")
  })

  it.each([
    ["skip", "skip"],
    ["fire_now", "fire"],
    ["queue_all", "fire"],
  ] as const)("stale misfire %s behaves as before", (type, expected) => {
    expect(
      fire(makeSchedule({ misfirePolicy: { type } }), stale, null)
    ).toBe(expected)
  })

  it("non-stale and disabled schedules are ignored as before", () => {
    expect(
      fire(makeSchedule({ misfirePolicy: { type: "skip" } }), onTime, null)
    ).toBe("fire")
    expect(
      fire(makeSchedule({ enabled: false }), onTime, null)
    ).toBe("ignore")
    expect(
      fire(makeSchedule(), new Date("2026-08-01T09:59:00Z"), null)
    ).toBe("ignore")
  })

  it("accepts every ScheduleDefinition policy combination without throwing", () => {
    const overlaps: ScheduleDefinition["overlapPolicy"]["type"][] = [
      "allow",
      "skip",
      "queue",
    ]
    const misfires: ScheduleDefinition["misfirePolicy"]["type"][] = [
      "skip",
      "fire_now",
      "queue_all",
    ]
    for (const overlap of overlaps) {
      for (const misfire of misfires) {
        expect(() =>
          fire(
            makeSchedule({
              overlapPolicy: { type: overlap },
              misfirePolicy: { type: misfire },
            })
          )
        ).not.toThrow()
      }
    }
  })
})
