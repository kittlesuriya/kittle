import { describe, expect, it } from "vitest"
import { mysqlTable, text, int } from "drizzle-orm/mysql-core"
import { MySqlDialect } from "drizzle-orm/mysql-core"
import {
  DrizzlePredicateCompiler,
  compileDrizzlePredicate,
} from "../drizzlePredicateCompiler"

const predicateTable = mysqlTable("predicate_table", {
  status: text("status"),
  value: int("value"),
})

const columnMap = {
  status: predicateTable.status,
  value: predicateTable.value,
}

const dialect = new MySqlDialect()

function toSql(
  filter: { kind: "literal"; value: boolean } | { kind: string; filters?: unknown[]; filter?: unknown; field?: string; op?: string; value?: unknown }
): { sql: string; params: unknown[] } {
  const compiled = compileDrizzlePredicate(filter as never, columnMap)
  return dialect.sqlToQuery(compiled)
}

describe("DrizzlePredicateCompiler (MySQL)", () => {
  it("compiles literal true to 1 = 1", () => {
    expect(toSql({ kind: "literal", value: true })).toEqual({
      sql: "1 = 1",
      params: [],
    })
  })

  it("compiles literal false to 1 = 0", () => {
    expect(toSql({ kind: "literal", value: false })).toEqual({
      sql: "1 = 0",
      params: [],
    })
  })

  it("compiles and/or predicates", () => {
    const compiler = new DrizzlePredicateCompiler(columnMap)
    const node = {
      kind: "and" as const,
      filters: [
        { kind: "condition", field: "status", op: "eq", value: "active" },
        { kind: "condition", field: "value", op: "gt", value: 5 },
      ],
    }
    const compiled = compiler.compile(node)
    const sql = dialect.sqlToQuery(compiled)
    expect(sql.sql).toContain("status")
    expect(sql.sql).toContain("value")
  })

  it("compiles or predicate", () => {
    const compiler = new DrizzlePredicateCompiler(columnMap)
    const node = {
      kind: "or" as const,
      filters: [
        { kind: "condition", field: "status", op: "eq", value: "active" },
        { kind: "condition", field: "status", op: "eq", value: "inactive" },
      ],
    }
    const compiled = compiler.compile(node)
    const sql = dialect.sqlToQuery(compiled)
    expect(sql.sql).toContain("status")
  })

  it("throws on unsupported operators (includesAll)", () => {
    const compiler = new DrizzlePredicateCompiler(columnMap)
    const node = {
      kind: "condition" as const,
      field: "status",
      op: "includesAll" as never,
      value: ["a", "b"],
    }
    expect(() => compiler.compile(node)).toThrow(/Unsupported predicate operator/)
  })

  it("protects against prototype field pollution", () => {
    const compiler = new DrizzlePredicateCompiler(columnMap)
    expect(() =>
      compiler.compile({
        kind: "condition",
        field: "constructor",
        op: "eq",
        value: "test",
      })
    ).toThrow(/unmapped field/)
  })
})
