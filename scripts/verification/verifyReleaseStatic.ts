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
import { join, resolve } from "node:path"
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
) as { adapters: Record<string, { implementation: string; checks: string[] }> }
const inventory = JSON.parse(
  readFileSync(join(root, "scripts/verification/adapter-coverage.json"), "utf8")
) as { required: string[]; evidence: Record<string, Record<string, string[]>> }
for (const [name, adapter] of Object.entries(matrix.adapters)) {
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

const packageManifests = ["core", "adapters", "testing"]
for (const pkg of packageManifests) {
  const manifest = JSON.parse(
    readFileSync(join(root, `packages/${pkg}/package.json`), "utf8")
  ) as {
    exports?: Record<string, { types?: string; default?: string } | string>
  }
  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    const declaration = typeof value === "string" ? value : value.types
    const runtime = typeof value === "string" ? value : value.default
    check(
      `exports.${pkg}.${subpath}.declaration`,
      Boolean(declaration) &&
        existsSync(
          join(
            root,
            `packages/${pkg}`,
            String(declaration).replace(/^\.\//, "")
          )
        ),
      "built declaration is missing; run build"
    )
    check(
      `exports.${pkg}.${subpath}.runtime`,
      Boolean(runtime) &&
        existsSync(
          join(root, `packages/${pkg}`, String(runtime).replace(/^\.\//, ""))
        ),
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
for (const pkg of packageManifests) checkBuiltTreeParity(`packages/${pkg}`)

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
    for (const pkg of packageManifests) {
      const before = new Set(readdirSync(workspace))
      const result = runNpm(
        ["pack", `./packages/${pkg}`, "--pack-destination", workspace],
        root
      )
      check(
        `pack.${pkg}`,
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
      const exports = packageManifests.flatMap((pkg) => {
        const manifest = JSON.parse(
          readFileSync(join(root, `packages/${pkg}/package.json`), "utf8")
        ) as { name: string; exports?: Record<string, unknown> }
        return Object.keys(manifest.exports ?? {}).map(
          (subpath) =>
            `${manifest.name}${subpath === "." ? "" : subpath.slice(1)}`
        )
      })
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
