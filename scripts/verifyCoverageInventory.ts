import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const targets = [
  {
    name: "kittle-core",
    source: join(root, "packages", "kittle-core", "src"),
    coverage: join(
      root,
      "packages",
      "kittle-core",
      "coverage",
      "coverage-final.json"
    ),
  },
  {
    name: "kittle-adapters",
    source: join(root, "packages", "kittle-adapters", "src"),
    coverage: join(
      root,
      "packages",
      "kittle-adapters",
      "coverage",
      "coverage-final.json"
    ),
  },
  {
    name: "testing",
    source: join(root, "packages", "testing", "src"),
    coverage: join(
      root,
      "packages",
      "testing",
      "coverage",
      "coverage-final.json"
    ),
  },
]

function visit(directory: string, files: string[] = []): string[] {
  if (!existsSync(directory)) return files
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) visit(path, files)
    else if (
      /\.(ts|tsx)$/.test(entry) &&
      !/\.d\.ts$/.test(entry) &&
      !/\.test\.(ts|tsx)$/.test(entry) &&
      !path.includes(`${join("src", "__tests__")}`)
    )
      files.push(path)
  }
  return files
}

function coveragePaths(path: string): Set<string> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >
  return new Set(
    Object.keys(parsed).map((value) => value.replaceAll("\\", "/"))
  )
}

const failures: string[] = []
for (const target of targets) {
  if (!existsSync(target.coverage)) {
    failures.push(`${target.name}: missing ${relative(root, target.coverage)}`)
    continue
  }
  const covered = coveragePaths(target.coverage)
  const missing = visit(target.source).filter((file) => {
    const normalized = file.replaceAll("\\", "/")
    return ![...covered].some(
      (entry) =>
        entry === normalized ||
        entry.endsWith(normalized.slice(normalized.indexOf("/src/")))
    )
  })
  if (missing.length > 0) {
    failures.push(
      `${target.name}: ${missing.map((file) => relative(root, file)).join(", ")}`
    )
  }
}

if (failures.length > 0) {
  console.error("Coverage inventory is incomplete:")
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(
  "Coverage inventory includes every production TypeScript source file."
)
