import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../..")

export type ReleaseResult = {
  command: string
  status: number
  durationMs: number
  startedAt: string
  testCount?: number
}

function commandVersion(
  command: string,
  args: string[] = ["--version"]
): string {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" })
  return (result.stdout || result.stderr || "unknown").trim()
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex")
}

function treeHash(directory: string): string {
  const entries: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry)
      if (entry === "dist" || entry === "coverage" || entry === "node_modules")
        continue
      if (statSync(path).isDirectory()) walk(path)
      else
        entries.push(`${path.slice(root.length)}:${sha256(readFileSync(path))}`)
    }
  }
  walk(directory)
  return sha256(entries.join("\n"))
}

function releaseEvidence() {
  const status = commandVersion("git", ["status", "--porcelain"])
  const commitSha = commandVersion("git", ["rev-parse", "HEAD"])
  const toolchainVersions = {
    node: process.version,
    npm: commandVersion(process.platform === "win32" ? "npm.cmd" : "npm"),
    typescript: commandVersion(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsc", "--version"]
    ),
    vitest: commandVersion(process.platform === "win32" ? "npx.cmd" : "npx", [
      "vitest",
      "--version",
    ]),
  }
  const packageHashes = Object.fromEntries(
    [
      ["kittle-core", "core"],
      ["kittle-adapters", "adapters"],
      ["testing", "testing"],
    ].map(([pkg, directory]) => [
      pkg,
      {
        treeSha256: treeHash(join(root, "packages", directory)),
        packageSha256: sha256(
          readFileSync(join(root, "packages", directory, "package.json"))
        ),
      },
    ])
  )
  return {
    // Keep immutable commit identity separate from the mutable worktree.
    commitSha,
    commitTreeSha: commandVersion("git", ["rev-parse", "HEAD^{tree}"]),
    cleanTree: status.length === 0,
    treeStatus: status ? status.split(/\r?\n/).filter(Boolean) : [],
    nodeVersion: toolchainVersions.node,
    npmVersion: toolchainVersions.npm,
    toolchainVersions,
    lockfileSha256: sha256(readFileSync(join(root, "package-lock.json"))),
    packageHashes,
  }
}

export function releaseCommands(): string[] {
  const commands = [
    "build",
    "verify:release:static",
    "verify:hardening",
    "verify:api-factory",
    "typecheck:core",
    "typecheck:adapters",
    "typecheck:testing",
    "lint:core",
    "lint:adapters",
    "lint:testing",
    "test:core",
    "test:adapters",
    "test:testing",
    "test:property",
    "test:race",
    "test:crash",
  ]

  return commands
}

function adapterEvidence(): string[] {
  const failures: string[] = []
  const matrix = JSON.parse(
    readFileSync(
      join(root, "scripts/verification/adapter-conformance.json"),
      "utf8"
    )
  ) as {
    "kittle-adapters": Record<string, { implementation: string }>
  }
  const inventory = JSON.parse(
    readFileSync(
      join(root, "scripts/verification/adapter-coverage.json"),
      "utf8"
    )
  ) as {
    required: string[]
    evidence: Record<string, Record<string, string[]>>
  }
  for (const [adapter, definition] of Object.entries(
    matrix["kittle-adapters"]
  )) {
    if (!existsSync(join(root, definition.implementation)))
      failures.push(`${adapter}: implementation directory is missing`)
    for (const capability of inventory.required) {
      const evidence = inventory.evidence[adapter]?.[capability] ?? []
      if (evidence.length === 0)
        failures.push(
          `${adapter}.${capability}: adapter-specific evidence is required`
        )
      for (const item of evidence)
        if (!existsSync(join(root, item)))
          failures.push(
            `${adapter}.${capability}: evidence file is missing: ${item}`
          )
    }
  }
  return failures
}

function commandArgs(command: string): { script: string; args: string[] } {
  return { script: command, args: [] }
}

export function runReleaseVerification(): void {
  if (process.env.RELEASE_VERIFY_BYPASS || process.env.SKIP_VERIFY) {
    console.error(
      "Release verification bypass is forbidden (RELEASE_VERIFY_BYPASS/SKIP_VERIFY must not be set)"
    )
    process.exitCode = 1
    return
  }
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const results: ReleaseResult[] = []
  const evidenceFailures = adapterEvidence()
  const initialReleaseEvidence = releaseEvidence()
  if (!initialReleaseEvidence.cleanTree) {
    evidenceFailures.push(
      "release tree is dirty; release verification requires a clean git tree"
    )
  }
  const commands = releaseCommands()
  let abortedCommand: string | null = null
  try {
    for (const command of commands) {
      const { script, args } = commandArgs(command)
      const commandStartedAt = new Date().toISOString()
      const commandStartedMs = Date.now()
      const commandLine = ["npm.cmd", "run", script, ...args].join(" ")
      const result = spawnSync(
        process.platform === "win32"
          ? (process.env.ComSpec ?? "cmd.exe")
          : "npm",
        process.platform === "win32"
          ? ["/d", "/s", "/c", commandLine]
          : ["run", script, ...args],
        {
          cwd: root,
          encoding: "utf8",
        }
      )
      process.stdout.write(result.stdout ?? "")
      process.stderr.write(result.stderr ?? "")
      const durationMs = Date.now() - commandStartedMs
      const testMatch = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(
        /Tests\s+(\d+)\s+(?:passed|failed)/i
      )
      results.push({
        command,
        status: result.status ?? 1,
        durationMs,
        startedAt: commandStartedAt,
        ...(testMatch ? { testCount: Number(testMatch[1]) } : {}),
      })
      const statusIcon = (result.status ?? 1) === 0 ? "✓" : "✗"
      const countInfo = testMatch ? ` tests:${testMatch[1]}` : ""
      console.log(
        `[verify:release] ${statusIcon} ${command} (${durationMs}ms${countInfo})`
      )
      if ((result.status ?? 1) !== 0) {
        abortedCommand = command
        break
      }
    }
  } finally {
    const totalDurationMs = Date.now() - startedMs
    const completedAt = new Date().toISOString()
    const failedCommands = results.filter((result) => result.status !== 0)
    const pendingCommands = commands.slice(results.length)
    const summary = {
      version: 4,
      command: "verify:release",
      startedAt,
      completedAt,
      totalDurationMs,
      passed:
        evidenceFailures.length === 0 &&
        results.length === commands.length &&
        failedCommands.length === 0,
      evidence: {
        passed: evidenceFailures.length === 0,
        failures: evidenceFailures,
      },
      results,
      pendingCommands: pendingCommands.length > 0 ? pendingCommands : undefined,
      abortedCommand: abortedCommand ?? undefined,
      releaseEvidence: {
        // Preserve evidence captured before commands generate artifacts.
        ...initialReleaseEvidence,
        testCounts: Object.fromEntries(
          results
            .filter((result) => result.testCount !== undefined)
            .map((result) => [result.command, result.testCount])
        ),
        timing: Object.fromEntries(
          results.map((result) => [
            result.command,
            { durationMs: result.durationMs, startedAt: result.startedAt },
          ])
        ),
        totalDurationMs,
      },
    }
    mkdirSync(join(root, "ci-artifacts"), { recursive: true })
    writeFileSync(
      join(root, "ci-artifacts/release-verification.json"),
      `${JSON.stringify(summary, null, 2)}\n`
    )
    console.log(JSON.stringify(summary, null, 2))
    console.log(
      `[verify:release] summary: ${summary.passed ? "PASS" : "FAIL"} ${results.length}/${commands.length} steps, ${totalDurationMs}ms total${failedCommands.length ? `, failed: ${failedCommands.map((r) => r.command).join(", ")}` : ""}${pendingCommands.length ? `, pending: ${pendingCommands.join(", ")}` : ""}`
    )
    if (!summary.passed) process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  runReleaseVerification()
