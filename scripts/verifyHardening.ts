import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import {
  approvedCoreBarrels,
  approvedAdapterBarrels,
} from "./verification/packageExportManifest"
import { resolveExports } from "./verification/resolveExports"

const approvedExports = JSON.parse(
  readFileSync(
    join(
      resolve(import.meta.dirname, ".."),
      "scripts",
      "verification",
      "approvedExports.json"
    ),
    "utf8"
  )
) as Record<string, string[]>

const root = resolve(import.meta.dirname, "..")
const packageRoots = ["packages/core", "packages/adapters"]
const removedExports = new Set([
  "./compat",
  "./domain/can",
  "./domain/compileScope",
  "./domain/policy",
])
const approvedBarrels: Record<string, Set<string>> = {
  "packages/core": new Set(approvedCoreBarrels),
  "packages/adapters": new Set(approvedAdapterBarrels),
}
const violations: Array<{ file: string; line: number; message: string }> = []

function isTestFile(path: string): boolean {
  return (
    path.includes("__tests__") || /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(path)
  )
}

function report(path: string, line: number, message: string): void {
  violations.push({ file: relative(root, path), line, message })
}

function assertNoSourceLine(
  path: string,
  pattern: RegExp,
  message: string
): void {
  const source = readFileSync(path, "utf8")
  source.split(/\r?\n/).forEach((line, index) => {
    if (pattern.test(line)) report(path, index + 1, message)
  })
}

/**
 * Durable security digests must never use locale-sensitive key ordering.
 * There is no longer any exemption: `localeCompare` in package source is
 * always reported.
 */
function scanLocaleCompare(directory: string): void {
  if (!existsSync(directory)) return
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        if (
          entry === "node_modules" ||
          entry === "dist" ||
          entry === ".wrangler"
        )
          continue
        walk(path)
        continue
      }
      if (!/\.tsx?$/.test(entry) || isTestFile(path)) continue
      const lines = readFileSync(path, "utf8").split(/\r?\n/)
      lines.forEach((line, index) => {
        const trimmed = line.trim()
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*")
        )
          return
        if (/localeCompare/.test(line)) {
          report(
            path,
            index + 1,
            "locale-sensitive key ordering in a durable security digest"
          )
        }
      })
    }
  }
  walk(directory)
}

/** Fail on explicit backward-compatibility surfaces that must not exist. */
function scanExplicitCompatibilitySurfaces(): void {
  const coreRoot = join(root, "packages/core/src")
  const adaptersRoot = join(root, "packages/adapters/src")

  // P1-04: createTenantFrameworkWriteHandler must be deleted
  const tenantHandler = join(
    adaptersRoot,
    "http",
    "createTenantFrameworkWriteHandler.ts"
  )
  if (existsSync(tenantHandler)) {
    report(
      tenantHandler,
      1,
      "old createTenantFrameworkWriteHandler must be deleted"
    )
  }

  // Verify the old tenant write handler is not imported anywhere in package source
  const tenantHandlerName = "createTenantFrameworkWriteHandler"
  for (const pkgRoot of [coreRoot, adaptersRoot]) {
    if (!existsSync(pkgRoot)) continue
    const walkForImport = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        const stat = statSync(path)
        if (stat.isDirectory()) {
          if (
            entry === "node_modules" ||
            entry === "dist" ||
            entry === "__tests__"
          )
            continue
          walkForImport(path)
          continue
        }
        if (!/\.tsx?$/.test(entry) || isTestFile(path)) continue
        assertNoSourceLine(
          path,
          new RegExp(`\\bimport\\b.*\\b${tenantHandlerName}\\b`),
          `import of removed ${tenantHandlerName} must not exist in package source`
        )
        assertNoSourceLine(
          path,
          new RegExp(`\\b${tenantHandlerName}\\b.*\\bfrom\\b`),
          `usage of removed ${tenantHandlerName} must not exist in package source`
        )
      }
    }
    walkForImport(pkgRoot)
  }

  const fieldAccess = join(coreRoot, "domain", "fieldAccess.ts")
  assertNoSourceLine(
    fieldAccess,
    /\bexport\s+const\s+redactRecord\b/,
    "backward-compatible redactRecord alias must not exist"
  )

  const persistence = join(coreRoot, "ports", "persistence.ts")
  assertNoSourceLine(
    persistence,
    /from\s+["']\.\/scopedPersistence["']/,
    "scoped-persistence compatibility re-export must not exist"
  )

  const defineEntity = join(coreRoot, "entity", "defineEntity.ts")
  assertNoSourceLine(
    defineEntity,
    /\brequestField\b/,
    "requestField must not exist in the entity OCC public types"
  )

  const crudTypes = join(adaptersRoot, "http", "crudHandlers", "types.ts")
  assertNoSourceLine(
    crudTypes,
    /\brequestField\b/,
    "requestField must not exist in adapter OCC types"
  )

  const scheduleStore = join(coreRoot, "execution", "scheduleStore.ts")
  assertNoSourceLine(
    scheduleStore,
    /\brenewScheduleLease\?\s*\(/,
    "schedule renewal must be mandatory, not optional"
  )

  const adapterDeps = join(adaptersRoot, "server", "frameworkAdapterDeps.ts")
  assertNoSourceLine(
    adapterDeps,
    /\bexport\s+.*\bServerDeps\b/,
    "ServerDeps must not be exported from adapter deps"
  )
  assertNoSourceLine(
    adapterDeps,
    /\bexport\s+.*\bAbacContext\b/,
    "old AbacContext must not be exported from adapter deps"
  )

  const pgJobStore = join(adaptersRoot, "drizzle-pg", "drizzleJobStore.ts")
  const d1JobStore = join(adaptersRoot, "drizzle-d1", "drizzleJobStore.ts")
  for (const jobStore of [pgJobStore, d1JobStore]) {
    assertNoSourceLine(
      jobStore,
      /\?\?\s*\(row\.tenantId\s*\?\s*["']tenant["']\s*:\s*["']platform["']\)/,
      "inferred persisted job scope fallback must not exist"
    )
    assertNoSourceLine(
      jobStore,
      /\.\.\.\(this\.jobs\.scope\s*\?\s*\{\s*scope\b/,
      "conditional persisted job scope write must not exist"
    )
  }
}

/** Every public subpath export must be in the approved export manifest. */
function scanPublicExportManifest(packagePath: string): void {
  const manifestPath = join(root, packagePath, "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    exports?: Record<string, unknown>
  }
  for (const [subpath, rawTarget] of Object.entries(manifest.exports ?? {})) {
    const key = `${packagePath}:${subpath}`
    const approved = approvedExports[key]
    if (!approved) {
      report(
        manifestPath,
        1,
        `public export ${subpath} is missing from the approved export manifest`
      )
      continue
    }
    if (typeof rawTarget !== "object" || rawTarget === null) continue
    // Resolve from source files, not dist targets, so the gate catches new
    // re-exports even before a fresh build.
    const srcRelative =
      subpath === "." ? "src/index.ts" : `src/${subpath.slice(2)}.ts`
    const candidates = [
      join(root, packagePath, srcRelative),
      join(root, packagePath, `src/${subpath.slice(2)}/index.ts`),
    ]
    let file: string | undefined
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        file = candidate
        break
      }
    }
    if (!file) continue
    for (const name of resolveExports(file)) {
      if (!approved.includes(name)) {
        report(file, 1, `unapproved public export "${name}" from ${subpath}`)
      }
    }
  }
}

/** The package root entrypoint may only re-export approved public barrels. */
function scanRootBarrel(packagePath: string): void {
  const index = join(root, packagePath, "src", "index.ts")
  if (!existsSync(index)) {
    report(index, 1, "root public entrypoint is missing")
    return
  }
  const approved = approvedBarrels[packagePath]
  if (!approved) return
  const source = readFileSync(index, "utf8")
  source.split(/\r?\n/).forEach((line, lineNumber) => {
    const starMatch = line.match(/export\s+\*\s+from\s+["']([^"']+)["']/)
    if (starMatch) {
      const target = starMatch[1] ?? ""
      const barrelName = target.replace(/^\.\//, "").split("/")[0] ?? target
      if (!approved.has(barrelName)) {
        report(
          index,
          lineNumber,
          `root entrypoint re-exports an unapproved barrel "${barrelName}"`
        )
      }
    }
    const namespaceMatch = line.match(
      /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/
    )
    if (namespaceMatch) {
      const name = namespaceMatch[1] ?? ""
      if (!approved.has(name)) {
        report(
          index,
          lineNumber,
          `root entrypoint exposes an unapproved namespace "${name}"`
        )
      }
    }
  })
}

function scanSource(directory: string): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (entry === "compat")
        report(path, 1, "compatibility source directory must not exist")
      scanSource(path)
      continue
    }
    if (!/\.tsx?$/.test(entry) || isTestFile(path)) continue

    const lines = readFileSync(path, "utf8").split(/\r?\n/)
    lines.forEach((line, index) => {
      const lineNumber = index + 1
      if (/@deprecated\b/.test(line))
        report(path, lineNumber, "deprecated package API")
      if (/\blegacy[A-Z]\w*\b/i.test(line)) {
        report(path, lineNumber, "legacy runtime surface")
      }
      if (/\bbackward-compatible\b/i.test(line)) {
        report(path, lineNumber, "backward-compatible surface")
      }
      if (
        /\bcompat(?:ibility|ible)?\b/i.test(line) ||
        /\bcompat[A-Z]\w*\b/i.test(line)
      ) {
        report(path, lineNumber, "compatibility surface")
      }
      if (
        /\b(?:system_scope|user_filters|field_access|user_attribute)\b/.test(
          line
        )
      ) {
        report(path, lineNumber, "legacy ABAC alias")
      }
      if (/\bexport\b.*\b(?:Unsafe|unsafe)[A-Z]\w*/.test(line)) {
        report(path, lineNumber, "unsafe public package symbol")
      }
      if (/\bexport\b.*\bscope\?\s*:/.test(line)) {
        report(path, lineNumber, "optional public scope")
      }
      if (/\bexport\b.*\brenewal\b/i.test(line)) {
        report(path, lineNumber, "public renewal compatibility surface")
      }
      if (/\bredis\b/i.test(line))
        report(path, lineNumber, "removed Redis adapter surface")
      if (/\bcreateAllowAllAbacAuthorizer\b/.test(line))
        report(path, lineNumber, "public allow-all ABAC authorizer")
      if (/\bdefaultEffect\s*:\s*["']allow["']\s*[,}]/.test(line))
        report(path, lineNumber, "public allow-default ABAC bundle")
    })
  }
}

scanExplicitCompatibilitySurfaces()

// Sweep package source for any remaining locale-sensitive ordering in
// durable security digests. No legacy exemption exists anymore.
scanLocaleCompare(join(root, "packages", "kittle-core", "src"))
scanLocaleCompare(join(root, "packages", "kittle-adapters", "src"))

for (const packagePath of packageRoots) {
  const packageRoot = join(root, packagePath)
  const sourceRoot = join(packageRoot, "src")
  const manifestPath = join(packageRoot, "package.json")

  if (!existsSync(sourceRoot)) {
    report(sourceRoot, 1, "package source directory is missing")
    continue
  }
  scanSource(sourceRoot)
  scanRootBarrel(packagePath)
  scanPublicExportManifest(packagePath)

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    exports?: Record<string, unknown>
  }
  for (const exportPath of Object.keys(manifest.exports ?? {})) {
    if (removedExports.has(exportPath) || exportPath.includes("compat")) {
      report(manifestPath, 1, `removed compatibility export: ${exportPath}`)
    }
  }

  // When a build is present, verify that every declared public entrypoint is
  // actually materialized. This catches export-map drift that source scans
  // cannot detect.
  const distRoot = join(packageRoot, "dist")
  if (existsSync(distRoot)) {
    for (const [exportPath, target] of Object.entries(manifest.exports ?? {})) {
      if (!target || typeof target !== "object") continue
      for (const field of ["types", "default"]) {
        const relativeTarget = (target as Record<string, unknown>)[field]
        if (typeof relativeTarget !== "string") {
          report(
            manifestPath,
            1,
            `public export ${exportPath} is missing ${field} target`
          )
        } else if (!existsSync(join(packageRoot, relativeTarget))) {
          report(
            manifestPath,
            1,
            `missing built export target ${exportPath} (${field}): ${relativeTarget}`
          )
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Package hardening violations found:")
  for (const violation of violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line
  )) {
    console.error(`  ${violation.file}:${violation.line} ${violation.message}`)
  }
  process.exit(1)
}

console.log("Package compatibility and deprecated surface is hardened.")
