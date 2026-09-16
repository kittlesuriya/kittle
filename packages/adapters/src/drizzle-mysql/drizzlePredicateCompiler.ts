/**
 * MySQL re-export of the shared Drizzle predicate compiler.
 * Drizzle's MySQL SQL operators are identical to the PostgreSQL ones
 * used in the shared compiler, so no MySQL-specific adaptation is needed.
 */
export {
  DrizzlePredicateCompiler,
  compileDrizzlePredicate,
  type DrizzleColumnMap,
} from "../drizzle-shared/predicateCompiler"
