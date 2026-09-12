import { createHash } from "node:crypto"
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

export type ArchiveEntry = {
  path: string
  data: Buffer
  sha256: string
}

export type ReviewManifest = {
  formatVersion: 1
  archive: string
  archiveSha256: string
  entryCount: number
  entries: Array<{ path: string; size: number; sha256: string }>
}

export const REQUIRED_DOCUMENTS = ["package.json", "REVIEW-FIX.md"]

export const REQUIRED_ARCHIVE_ENTRIES = [...REQUIRED_DOCUMENTS]

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".cache",
  ".output",
  ".planning",
  ".tanstack",
  ".vite",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "reference",
  "test-results",
  "vitest-report",
])

const EXCLUDED_FILE_NAMES = new Set([
  "cloudflare-env.d.ts",
  "worker-configuration.d.ts",
])

const EXCLUDED_SUFFIXES = [".map", ".tsbuildinfo"]

export function manifestPathFor(archivePath: string): string {
  return `${archivePath}.manifest.json`
}

export function isExcludedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/")
  const parts = normalized.split("/")
  const name = parts.at(-1) ?? ""

  if (parts.some((part) => EXCLUDED_DIRECTORIES.has(part))) return true
  const isSafeEnvExample = name.endsWith(".env.example")
  const isEnvironmentLike = (part: string): boolean =>
    !part.endsWith(".env.example") &&
    (part === ".envrc" ||
      part.startsWith(".envrc.") ||
      part === "env" ||
      part.startsWith("env.") ||
      part === ".env" ||
      part.startsWith(".env.") ||
      part.endsWith(".env") ||
      part.includes(".env."))
  if (parts.some(isEnvironmentLike)) return true
  if (EXCLUDED_FILE_NAMES.has(name)) return true
  if (EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true
  if (
    normalized.includes("/src/generated/") ||
    normalized.startsWith("src/generated/")
  )
    return true
  return false
}

function collectFiles(
  root: string,
  excludedPaths: Set<string>,
  directory = root
): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []
  for (const name of readdirSync(directory).sort()) {
    const absolutePath = join(directory, name)
    const archivePath = relative(root, absolutePath).replaceAll("\\", "/")
    if (lstatSync(absolutePath).isSymbolicLink())
      throw new Error(
        `Symbolic links are not allowed in review archives: ${archivePath}`
      )
    if (isExcludedPath(archivePath) || excludedPaths.has(resolve(absolutePath)))
      continue

    if (lstatSync(absolutePath).isDirectory()) {
      entries.push(...collectFiles(root, excludedPaths, absolutePath))
      continue
    }

    const data = readFileSync(absolutePath)
    entries.push({
      path: archivePath,
      data,
      sha256: createHash("sha256").update(data).digest("hex"),
    })
  }
  return entries
}

export function collectArchiveEntries(
  root: string,
  excludedPaths: string[] = []
): ArchiveEntry[] {
  const entries = collectFiles(
    root,
    new Set(excludedPaths.map((path) => resolve(path)))
  )
  const paths = new Set(entries.map((entry) => entry.path))
  const missing = REQUIRED_ARCHIVE_ENTRIES.filter((path) => !paths.has(path))
  if (missing.length > 0)
    throw new Error(
      `Required review entries are missing from the archive: ${missing.join(", ")}`
    )
  return entries.sort((left, right) =>
    compareArchivePaths(left.path, right.path)
  )
}

export function compareArchivePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateAndTime(): { date: number; time: number } {
  return { date: ((2026 - 1980) << 9) | (1 << 5) | 1, time: 0 }
}

export function createZip(entries: ArchiveEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const { date, time } = dosDateAndTime()

  for (const entry of [...entries].sort((left, right) =>
    compareArchivePaths(left.path, right.path)
  )) {
    const name = Buffer.from(entry.path, "utf8")
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    localParts.push(local, entry.data)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centralParts.push(central)
    offset += local.length + entry.data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}

export function inspectZip(archive: Buffer): Map<string, Buffer> {
  const endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (endOffset < 0) throw new Error("Archive is missing its ZIP end record")
  const count = archive.readUInt16LE(endOffset + 10)
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  let cursor = centralOffset
  const entries = new Map<string, Buffer>()
  let previousPath: string | undefined

  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("Archive has an invalid central directory")
    const method = archive.readUInt16LE(cursor + 10)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const externalAttributes = archive.readUInt32LE(cursor + 38)
    const name = archive
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8")
    if (
      previousPath !== undefined &&
      compareArchivePaths(previousPath, name) >= 0
    )
      throw new Error("ZIP entries are not in deterministic path order")
    previousPath = name
    if (isExcludedPath(name))
      throw new Error(`Excluded path is present in ZIP: ${name}`)
    if (
      archive.readUInt16LE(cursor + 4) >> 8 === 3 &&
      ((externalAttributes >>> 16) & 0xf000) === 0xa000
    )
      throw new Error(
        `Symbolic links are not allowed in review archives: ${name}`
      )
    if (method !== 0 || compressedSize !== uncompressedSize)
      throw new Error(`Unsupported ZIP compression for ${name}`)
    if (archive.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error(`Invalid local ZIP entry for ${name}`)
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const data = Buffer.from(
      archive.subarray(dataStart, dataStart + compressedSize)
    )
    if (data.length !== uncompressedSize)
      throw new Error(`Truncated ZIP entry for ${name}`)
    if (entries.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`)
    entries.set(name, data)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export function createManifest(
  archivePath: string,
  archive: Buffer,
  entries: Map<string, Buffer>
): ReviewManifest {
  return {
    formatVersion: 1,
    archive: archivePath,
    archiveSha256: createHash("sha256").update(archive).digest("hex"),
    entryCount: entries.size,
    entries: [...entries.entries()]
      .sort(([left], [right]) => compareArchivePaths(left, right))
      .map(([path, data]) => ({
        path,
        size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      })),
  }
}

function main(): void {
  const root = resolve(import.meta.dirname, "..")
  const output = resolve(
    process.argv[2] ?? resolve(root, "..", "SolSource-review.zip")
  )
  const manifestPath = manifestPathFor(output)
  const entries = collectArchiveEntries(root, [output, manifestPath])
  const archive = createZip(entries)
  const inspectedEntries = inspectZip(archive)
  const manifest = createManifest(
    relative(root, output).replaceAll("\\", "/"),
    archive,
    inspectedEntries
  )

  writeFileSync(output, archive)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  console.log(`Created clean review archive: ${output}`)
  console.log(`Created review manifest: ${manifestPath}`)
  console.log(
    `Verified ${manifest.entryCount} ZIP entries before writing output.`
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  main()
