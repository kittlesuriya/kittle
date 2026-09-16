import type {
  AnyMySqlTable,
  MySqlDatabase,
  MySqlTransaction,
} from "drizzle-orm/mysql-core"
import type {
  DrizzleSessionLike,
  DrizzleUpdateResult,
} from "./drizzleRepository"

/**
 * Wraps a real Drizzle MySQL database into the DrizzleSessionLike interface
 * that drizzleRepository.ts consumes. This is the bridge between the
 * generic repository adapter and a local MySQL connection.
 *
 * MySQL does not support .returning() on INSERT, UPDATE, or DELETE.
 * Affected rows are reported via ResultSetHeader.affectedRows.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- driver-neutral boundary, see above */
export type MySqlDatabaseLike =
  | MySqlDatabase<any, any, any>
  | MySqlTransaction<any, any, any>
/* eslint-enable @typescript-eslint/no-explicit-any */

export function createMysqlSession(db: MySqlDatabaseLike): DrizzleSessionLike {
  return {
    select(...args: unknown[]) {
      const selectFn =
        args.length > 0
          ? // Drizzle's overloaded select signature cannot accept the session's untyped argument list directly.
            db.select(args[0] as Parameters<typeof db.select>[0])
          : db.select()

      return {
        from(table: AnyMySqlTable) {
          const fromBuilder = (
            selectFn as { from(t: AnyMySqlTable): unknown }
          ).from(table)
          return {
            where(whereClause: unknown) {
              const whereBuilder = (
                fromBuilder as { where(w: unknown): unknown }
              ).where(whereClause)
              return {
                limit(n: number) {
                  return (
                    whereBuilder as { limit(n: number): Promise<unknown[]> }
                  ).limit(n)
                },
                orderBy(orderBy: unknown) {
                  return {
                    limit(n: number) {
                      return {
                        offset(o: number) {
                          return (
                            whereBuilder as {
                              orderBy(o: unknown): {
                                limit(n: number): {
                                  offset(o: number): Promise<unknown[]>
                                }
                              }
                            }
                          )
                            .orderBy(orderBy)
                            .limit(n)
                            .offset(o)
                        },
                      }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },

    insert(table: AnyMySqlTable) {
      const insertBuilder = db.insert(table) as {
        values(d: unknown): Promise<unknown> & {
          onDuplicateDoNothing?: (config?: {
            target: unknown[]
          }) => Promise<unknown>
          onDuplicateDoUpdate?: (config: {
            target: unknown[]
            set: unknown
          }) => Promise<unknown>
        }
      }
      return {
        values(data: unknown) {
          const valuesBuilder = insertBuilder.values(data)
          return valuesBuilder
        },
      }
    },

    update(table: AnyMySqlTable) {
      return {
        set(data: unknown) {
          const setBuilder = (
            db.update(table) as {
              set(d: unknown): {
                where(w: unknown): Promise<DrizzleUpdateResult>
              }
            }
          ).set(data)
          return {
            where(whereClause: unknown) {
              return setBuilder.where(whereClause)
            },
          }
        },
      }
    },

    delete(table: AnyMySqlTable) {
      return {
        where(whereClause: unknown) {
          return (
            db.delete(table) as {
              where(w: unknown): Promise<DrizzleUpdateResult>
            }
          ).where(whereClause)
        },
      }
    },
  }
}
