import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { resolveExports } from "./resolveExports"

const root = resolve(import.meta.dirname, "..", "..")
const packages = ["packages/core", "packages/adapters"]

/**
 * Regenerates scripts/verification/approvedExports.json from the current
 * public export surface. Run after deliberately adding a public export; the
 * hardening gate then fails on any export added without this manifest update.
 */
function main(): void {
  const result: Record<string, string[]> = {}
  for (const pkg of packages) {
    const manifest = JSON.parse(
      readFileSync(join(root, pkg, "package.json"), "utf8")
    ) as { exports?: Record<string, unknown> }
    for (const [subpath, rawTarget] of Object.entries(manifest.exports ?? {})) {
      if (typeof rawTarget !== "object" || rawTarget === null) continue
      const target = rawTarget as Record<string, string>
      const srcTarget = target.default ?? target.types
      if (typeof srcTarget !== "string") continue
      const file = join(root, pkg, srcTarget)
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue
      const names = [...resolveExports(file)].sort()
      result[`${pkg}:${subpath}`] = names
    }
  }
  const outPath = join(root, "scripts", "verification", "approvedExports.json")
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(
    `Generated ${outPath} (${Object.keys(result).length} entrypoints)`
  )
}

main()
