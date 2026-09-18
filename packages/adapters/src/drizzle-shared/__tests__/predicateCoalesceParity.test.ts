import { describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core/dialect"
import { MySqlDialect } from "drizzle-orm/mysql-core/dialect"
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core/dialect"
import { integer, pgTable, text } from "drizzle-orm/pg-core"
import { Predicate, evaluatePredicate } from "kittle-core/domain"
import {
  compileDrizzlePredicate,
  type DrizzleColumnMap,
} from "../predicateCompiler"

const pgDialect = new PgDialect()
const mysqlDialect = new MySqlDialect()
const sqliteDialect = new SQLiteSyncDialect()

const predicateTable = pgTable("predicate_table", {
  status: text("status"),
  value: integer("value"),
})

const columnMap: DrizzleColumnMap = {
  status: predicateTable.status,
  value: predicateTable.value,
}

function renderAll(filter: Parameters<typeof compileDrizzlePredicate>[0]) {
  const compiled = compileDrizzlePredicate(filter, columnMap)
  return [
    pgDialect.sqlToQuery(compiled).sql,
    mysqlDialect.sqlToQuery(compiled).sql,
    sqliteDialect.sqlToQuery(compiled).sql,
  ]
}

/**
 * Locks the tiered-negation parity contract documented in core's
 * evaluatePredicate: the JS tier resolver collapses an UNKNOWN leaf to FALSE
 * before negation, so SQL scope builders must wrap leaves with
 * COALESCE(expr, FALSE) before NOT. Without the wrap, SQL NOT UNKNOWN stays
 * UNKNOWN and the null-valued row is excluded — diverging from the JS tier
 * fallthrough (which proceeds as if the tier did not match).
 */
describe("predicate compiler tiered-negation parity", () => {
  it("wraps negated leaves with COALESCE before NOT on every dialect", () => {
    for (const sql of renderAll(
      Predicate.not(Predicate.eq("status", "active"))
    )) {
      expect(sql).toMatch(/not\s+coalesce/i)
    }
  })

  it("matches the JS tier fallthrough on null-valued rows for negated deny tiers", () => {
    // Row with a null-valued field: the deny-tier leaf is UNKNOWN.
    const record: Record<string, unknown> = {}
    const denyLeaf = Predicate.eq("status", "banned")

    // JS reference (per-tier collapse, as the tier resolver consumes it):
    // UNKNOWN collapses to FALSE, so the tier does not match and its
    // negation is TRUE — the fallthrough proceeds.
    expect(evaluatePredicate(record, denyLeaf)).toBe(false)
    const jsTierNegation = !evaluatePredicate(record, denyLeaf)
    expect(jsTierNegation).toBe(true)

    // SQL must evaluate the same tier negation to TRUE on a null row:
    // NOT(COALESCE(leaf, FALSE)) = NOT FALSE = TRUE. A bare NOT(leaf)
    // would stay UNKNOWN and exclude the row (the divergence).
    for (const sql of renderAll(
      Predicate.and(Predicate.literal(true), Predicate.not(denyLeaf))
    )) {
      expect(sql).toMatch(/not\s+coalesce/i)
      expect(sql).not.toMatch(/not\s+"/i)
    }
  })

  it("keeps multi-tier fallthrough composition two-valued on null rows", () => {
    // or(and(not(tier1Match), tier2Allow)) with tier1 UNKNOWN, tier2 TRUE.
    // JS tier composition (collapsed booleans): !false && true = true.
    const record: Record<string, unknown> = {}
    const tier1Match = Predicate.eq("status", "active")
    const tier2Allow = Predicate.eq("value", 1)
    const jsOutcome =
      !evaluatePredicate(record, tier1Match) &&
      evaluatePredicate({ value: 1 }, tier2Allow)
    expect(jsOutcome).toBe(true)

    for (const sql of renderAll(
      Predicate.or(
        Predicate.and(Predicate.not(tier1Match), Predicate.eq("value", 1))
      )
    )) {
      expect(sql).toMatch(/coalesce/i)
      expect(sql).toMatch(/not\s+coalesce/i)
    }
  })

  it("wraps compound and/or branches so UNKNOWN cannot leak past negation", () => {
    for (const sql of renderAll(
      Predicate.not(
        Predicate.or(
          Predicate.eq("status", "active"),
          Predicate.gt("value", 1)
        )
      )
    )) {
      const coalesceCount = (sql.match(/coalesce/gi) ?? []).length
      expect(coalesceCount).toBeGreaterThanOrEqual(3)
    }
  })
})
