import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { resolveExports } from "./resolveExports"

const root = resolve(import.meta.dirname, "../..")
const failures: string[] = []
const checks: Record<string, "pass" | "fail"> = {}
const check = (name: string, condition: boolean, detail: string) => {
  checks[name] = condition ? "pass" : "fail"
  if (!condition) failures.push(`${name}: ${detail}`)
}

const matrix = JSON.parse(
  readFileSync(
    join(root, "scripts/verification/adapter-conformance.json"),
    "utf8"
  )
) as {
  adapters?: Record<string, { implementation: string; checks: string[] }>
  "kittle-adapters"?: Record<
    string,
    { implementation: string; checks: string[] }
  >
}
const adaptersMatrix = matrix.adapters ?? matrix["kittle-adapters"] ?? {}
const inventory = JSON.parse(
  readFileSync(join(root, "scripts/verification/adapter-coverage.json"), "utf8")
) as { required: string[]; evidence: Record<string, Record<string, string[]>> }
for (const [name, adapter] of Object.entries(adaptersMatrix)) {
  check(
    `${name}.implementation`,
    existsSync(join(root, adapter.implementation)),
    "implementation directory is missing"
  )
  for (const capability of inventory.required) {
    check(
      `${name}.${capability}`,
      adapter.checks.includes(capability),
      "capability is absent from conformance matrix"
    )
    const evidence = inventory.evidence[name]?.[capability] ?? []
    check(
      `${name}.${capability}.evidence`,
      evidence.length > 0,
      "adapter capability has no evidence"
    )
    for (const item of evidence)
      check(
        `evidence.${name}.${capability}.${item}`,
        existsSync(join(root, item)),
        "evidence file is missing"
      )
  }
}

function walkFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walkFiles(path) : [path]
  })
}

/**
 * Files under `pkgDir` matching a single-`*` export pattern such as
 * "./dist/core/*.d.ts", together with the captured `*` segment.
 */
function matchExportPattern(
  pkgDir: string,
  pattern: string | undefined
): { file: string; capture: string }[] {
  if (!pattern || !pattern.includes("*")) return []
  const normalized = pattern.replace(/^\.\//, "").replaceAll("\\", "/")
  const star = normalized.indexOf("*")
  const prefix = normalized.slice(0, star)
  const suffix = normalized.slice(star + 1)
  const dirPart = prefix.endsWith("/") ? prefix.slice(0, -1) : dirname(prefix)
  const searchDir = join(pkgDir, dirPart)
  if (!existsSync(searchDir)) return []
  return walkFiles(searchDir)
    .map((file) => relative(pkgDir, file).replaceAll("\\", "/"))
    .filter((rel) => rel.startsWith(prefix) && rel.endsWith(suffix))
    .map((rel) => ({
      file: join(pkgDir, rel),
      capture: rel.slice(prefix.length, rel.length - suffix.length),
    }))
}

const packageManifests = [
  { name: "kittle-core", dir: "core" },
  { name: "kittle-adapters", dir: "adapters" },
  { name: "kittle-ui", dir: "ui" },
  { name: "testing", dir: "testing" },
]
for (const { name: pkg, dir } of packageManifests) {
  const pkgDir = join(root, `packages/${dir}`)
  const manifest = JSON.parse(
    readFileSync(join(pkgDir, "package.json"), "utf8")
  ) as {
    exports?: Record<string, { types?: string; default?: string } | string>
  }
  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    const declaration = typeof value === "string" ? value : value.types
    const runtime = typeof value === "string" ? value : value.default
    if (subpath.includes("*")) {
      const declarations = matchExportPattern(pkgDir, declaration)
      const runtimes = matchExportPattern(pkgDir, runtime)
      check(
        `exports.${pkg}.${subpath}.declaration`,
        declarations.length > 0,
        "wildcard declaration pattern matched no built files; run build"
      )
      const declarationCaptures = new Set(
        declarations.map((item) => item.capture)
      )
      const runtimeCaptures = new Set(runtimes.map((item) => item.capture))
      check(
        `exports.${pkg}.${subpath}.parity`,
        declarationCaptures.size === runtimeCaptures.size &&
          [...declarationCaptures].every((capture) =>
            runtimeCaptures.has(capture)
          ),
        "wildcard runtime and declaration trees do not have parity"
      )
      continue
    }
    check(
      `exports.${pkg}.${subpath}.declaration`,
      Boolean(declaration) &&
        existsSync(join(pkgDir, String(declaration).replace(/^\.\//, ""))),
      "built declaration is missing; run build"
    )
    check(
      `exports.${pkg}.${subpath}.runtime`,
      Boolean(runtime) &&
        existsSync(join(pkgDir, String(runtime).replace(/^\.\//, ""))),
      "built runtime is missing; run build"
    )
    check(
      `exports.${pkg}.${subpath}.parity`,
      typeof declaration === "string" &&
        typeof runtime === "string" &&
        declaration.replace(/\.d\.ts$/, ".js") === runtime,
      "runtime and declaration targets do not have parity"
    )
  }
}

function sourcePathFromDeclaration(target: string): string {
  return target.replace(/^\.\/dist\//, "./src/").replace(/\.d\.ts$/, ".ts")
}

// Approved manifests are deny-by-default in both directions: additions and stale names require review.
for (const [key, approved] of Object.entries(
  JSON.parse(
    readFileSync(
      join(root, "scripts/verification/approvedExports.json"),
      "utf8"
    )
  ) as Record<string, string[]>
)) {
  const separator = key.indexOf(":")
  const pkg = key.slice(0, separator)
  const subpath = key.slice(separator + 1)
  const manifest = JSON.parse(
    readFileSync(join(root, pkg, "package.json"), "utf8")
  ) as { exports?: Record<string, { types?: string; default?: string }> }
  const target = manifest.exports?.[subpath]
  check(
    `approved.${key}.entrypoint`,
    Boolean(target),
    "approved export entry is stale"
  )
  if (!target) continue
  const source = join(root, pkg, sourcePathFromDeclaration(target.types ?? ""))
  const actual = existsSync(source)
    ? new Set([...resolveExports(source)])
    : new Set<string>()
  for (const name of approved)
    check(
      `approved.${key}.${name}`,
      actual.has(name),
      "approved export name is stale"
    )
}

function checkBuiltTreeParity(pkg: string): void {
  const dist = join(root, pkg, "dist")
  if (!existsSync(dist)) return
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? files(path) : [path]
    })
  const js = new Set(
    files(dist)
      .filter((file) => file.endsWith(".js"))
      .map((file) => file.slice(0, -3))
  )
  const declarations = new Set(
    files(dist)
      .filter((file) => file.endsWith(".d.ts"))
      .map((file) => file.slice(0, -5))
  )
  check(
    `${pkg}.built-js-declaration-parity`,
    js.size === declarations.size &&
      [...js].every((file) => declarations.has(file)),
    "built JavaScript and declarations differ"
  )
}
for (const { dir } of packageManifests) checkBuiltTreeParity(`packages/${dir}`)

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

function runNpm(args: string[], cwd: string) {
  return spawnSync(npmCommand(), args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  })
}

function packConsumerSmoke(): void {
  const workspace = mkdtempSync(join(tmpdir(), "release-consumer-"))
  try {
    const tarballs: string[] = []
    for (const { name: pkgName, dir } of packageManifests) {
      const before = new Set(readdirSync(workspace))
      const result = runNpm(
        ["pack", `./packages/${dir}`, "--pack-destination", workspace],
        root
      )
      check(
        `pack.${pkgName}`,
        result.status === 0,
        `${result.stderr || result.stdout || "npm pack failed"}`
      )
      if (result.status === 0) {
        const filename = readdirSync(workspace).find(
          (entry) => !before.has(entry) && entry.endsWith(".tgz")
        )
        if (filename) tarballs.push(join(workspace, filename))
      }
    }
    const consumer = join(workspace, "consumer")
    mkdirSync(consumer, { recursive: true })
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "release-consumer",
        private: true,
        type: "module",
      })
    )
    const install = runNpm(
      [
        "install",
        "--prefix",
        consumer,
        "--no-save",
        "--ignore-scripts",
        "--package-lock=false",
        "--legacy-peer-deps",
        // The NestJS entrypoint is an optional peer; install it explicitly
        // when smoke-importing every public subpath.
        "@nestjs/common@^11.0.0",
        "reflect-metadata@^0.2.0",
        "rxjs@^7.1.0",
        // kittle-ui peer dependencies, plus react types for the declaration
        // check and i18next for the react-i18next runtime.
        "@types/react@^19.0.0",
        "@types/react-dom@^19.0.0",
        "react@^19.0.0",
        "react-dom@^19.0.0",
        "i18next@^26.0.0",
        "@tanstack/react-form@^1.29.0",
        "@tanstack/react-query@^5.99.0",
        "@tanstack/react-table@^9.2.4",
        "lucide-react@^1.8.0",
        "react-i18next@^17.0.4",
        "sonner@^2.0.7",
        "zod@^4.3.6",
        ...tarballs,
      ],
      root
    )
    check(
      "consumer.install",
      install.status === 0,
      `${install.stderr || install.stdout || "consumer npm install failed"}`
    )
    if (install.status === 0) {
      const expandExports = (name: string, dir: string): string[] => {
        const manifest = JSON.parse(
          readFileSync(join(root, `packages/${dir}/package.json`), "utf8")
        ) as { exports?: Record<string, { types?: string } | string> }
        return Object.entries(manifest.exports ?? {}).flatMap(
          ([subpath, value]) => {
            if (!subpath.includes("*")) {
              return [`${name}${subpath === "." ? "" : subpath.slice(1)}`]
            }
            const declaration = typeof value === "string" ? value : value.types
            return matchExportPattern(
              join(root, `packages/${dir}`),
              declaration
            )
              .map(
                (item) =>
                  `${name}/${subpath
                    .replace(/^\.\//, "")
                    .replace("*", item.capture)}`
              )
              .sort()
          }
        )
      }
      const exports = packageManifests.flatMap(({ name, dir }) =>
        expandExports(name, dir)
      )
      // testing ships vitest-backed contract helpers, so it requires
      // vitest at runtime by design. Smoke-import only the runtime packages;
      // declarations are still checked for all three.
      const runtimeExports = exports.filter(
        (specifier) => !specifier.startsWith("testing")
      )
      const runtimeSmoke = runtimeExports
        .map((specifier) => `await import(${JSON.stringify(specifier)})`)
        .join("; ")
      const smoke = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", runtimeSmoke],
        { cwd: consumer, encoding: "utf8" }
      )
      check(
        "consumer.imports",
        smoke.status === 0,
        `${smoke.stderr || smoke.stdout || "consumer package imports failed"}`
      )

      const typeImports = exports
        .map(
          (specifier, index) =>
            `import type * as Export${index} from ${JSON.stringify(specifier)}`
        )
        .join("\n")
      const consumerSource = join(consumer, "index.ts")
      const consumerConfig = join(consumer, "tsconfig.json")
      writeFileSync(consumerSource, `${typeImports}\n`)
      writeFileSync(
        consumerConfig,
        JSON.stringify({
          compilerOptions: {
            strict: true,
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["index.ts"],
        })
      )
      const typecheck = spawnSync(
        process.execPath,
        [join(root, "node_modules/typescript/bin/tsc"), "-p", consumerConfig],
        { cwd: consumer, encoding: "utf8" }
      )
      check(
        "consumer.declarations",
        typecheck.status === 0,
        `${typecheck.stderr || typecheck.stdout || "consumer declaration resolution failed"}`
      )
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}
packConsumerSmoke()

const summary = {
  version: 1,
  command: "verify:release:static",
  passed: failures.length === 0,
  checks,
  failures,
}
console.log(JSON.stringify(summary, null, 2))
if (failures.length > 0) process.exit(1)
