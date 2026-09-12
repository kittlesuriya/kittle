import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")

function normalizedSource(path: string): string {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n")
}

const sharedPredicateCompiler = resolve(
  root,
  "packages/adapters/src/drizzle-shared/predicateCompiler.ts"
)
const predicateCompilerWrappers = [
  resolve(root, "packages/adapters/src/drizzle-pg/drizzlePredicateCompiler.ts"),
  resolve(root, "packages/adapters/src/drizzle-d1/drizzlePredicateCompiler.ts"),
]
const expectedWrapper = 'export * from "../drizzle-shared/predicateCompiler"\n'

if (!existsSync(sharedPredicateCompiler)) {
  console.error(`Missing shared predicate compiler: ${sharedPredicateCompiler}`)
  process.exit(1)
}
for (const wrapper of predicateCompilerWrappers) {
  if (normalizedSource(wrapper) !== expectedWrapper) {
    console.error(
      `Adapter predicate compiler wrapper is not using the shared implementation: ${wrapper}`
    )
    process.exit(1)
  }
}

console.log(
  "Drizzle predicate compiler implementations are shared across adapters."
)
