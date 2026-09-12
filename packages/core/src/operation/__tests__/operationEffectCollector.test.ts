import { describe, expect, it } from "vitest"
import {
  ConfigurationError,
  EffectCollectorDisposedError,
  EffectCollectorDrainedError,
} from "../../domain"
import { OperationEffectCollector } from "../operationEffectCollector"

describe("OperationEffectCollector lifecycle", () => {
  it("separates pre-commit and deferred effect phases", async () => {
    const collector = new OperationEffectCollector()
    collector.addTransactionalEffect("transactional", async () => {})
    collector.addBestEffortEffect("post", async () => {})

    const preCommit = collector.takePreCommitEffects()
    expect(collector.lifecycleState).toBe("post-commit")
    expect(preCommit.transactionalEffects).toHaveLength(1)
    expect(preCommit.bestEffortEffects).toHaveLength(1)

    collector.addBestEffortEffect("deferred", async () => {})
    expect(collector.takeDeferredEffects().bestEffortEffects).toHaveLength(1)
    expect(collector.lifecycleState).toBe("deferred-taken")
    expect(() => collector.takeDeferredEffects()).toThrow(
      EffectCollectorDrainedError
    )
  })

  it("reopens the deferred phase when a post-commit effect registers more work", () => {
    const collector = new OperationEffectCollector()
    collector.takePreCommitEffects()
    collector.addBestEffortEffect("first", async () => {})

    expect(collector.takeDeferredEffects().bestEffortEffects).toHaveLength(1)
    expect(collector.lifecycleState).toBe("deferred-taken")

    collector.addBestEffortEffect("second", async () => {})
    expect(collector.lifecycleState).toBe("post-commit")
    expect(collector.takeDeferredEffects().bestEffortEffects).toHaveLength(1)
  })

  it("rejects transactional registration after commit", () => {
    const collector = new OperationEffectCollector()
    collector.takePreCommitEffects()

    expect(() =>
      collector.addTransactionalEffect("late", async () => {})
    ).toThrow(EffectCollectorDisposedError)
    expect(() => collector.addOutboxRecord({} as never)).toThrow(
      EffectCollectorDisposedError
    )
  })

  it("preserves restricted-operation configuration errors", () => {
    const collector = new OperationEffectCollector(undefined, {
      allowTransactionalEffects: false,
    })
    collector.takePreCommitEffects()

    expect(() =>
      collector.addTransactionalEffect("late", async () => {})
    ).toThrow(ConfigurationError)
  })

  it("rejects drains outside the committed phase and after disposal", () => {
    const collector = new OperationEffectCollector()
    expect(() => collector.takeDeferredEffects()).toThrow(
      EffectCollectorDisposedError
    )

    collector.takePreCommitEffects()
    collector.dispose()
    expect(collector.lifecycleState).toBe("disposed")
    expect(() => collector.takeDeferredEffects()).toThrow(
      EffectCollectorDisposedError
    )
    expect(() => collector.addBestEffortEffect("late", async () => {})).toThrow(
      EffectCollectorDisposedError
    )
  })

  it("covers initial snapshots, outbox policy, and idempotent disposal", () => {
    const record = { id: "outbox-1" } as never
    const collector = new OperationEffectCollector(
      { outboxRecords: [record] },
      { allowOutboxRecords: false }
    )
    expect(collector.outboxRecords).toEqual([record])
    expect(collector.transactionalEffects).toEqual([])
    expect(collector.bestEffortEffects).toEqual([])
    expect(collector.bestEffortEffects).toEqual([])
    expect(() => collector.addOutboxRecord(record)).toThrow(ConfigurationError)

    collector.dispose()
    collector.dispose()
    expect(collector.isDisposed).toBe(true)
    expect(collector.outboxRecords).toEqual([])
    expect(() => collector.addBestEffortEffect("late", async () => {})).toThrow(
      EffectCollectorDisposedError
    )
  })

  it("bounds deferred effect registration across drain cycles", () => {
    const collector = new OperationEffectCollector(undefined, {
      maxDeferredEffects: 2,
    })
    collector.takePreCommitEffects()
    collector.addBestEffortEffect("first", async () => {})
    collector.addBestEffortEffect("second", async () => {})

    expect(() =>
      collector.addBestEffortEffect("third", async () => {})
    ).toThrow(ConfigurationError)
    collector.takeDeferredEffects()
    expect(() => collector.addBestEffortEffect("late", async () => {})).toThrow(
      ConfigurationError
    )
  })
})
