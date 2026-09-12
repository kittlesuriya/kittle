import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import {
  compareArchivePaths,
  inspectZip,
  isExcludedPath,
  manifestPathFor,
  REQUIRED_ARCHIVE_ENTRIES,
  type ReviewManifest,
} from "./createReviewArchive"

function isManifest(value: unknown): value is ReviewManifest {
  if (!value || typeof value !== "object") return false
  const manifest = value as Partial<ReviewManifest>
  return (
    manifest.formatVersion === 1 &&
    typeof manifest.archive === "string" &&
    typeof manifest.archiveSha256 === "string" &&
    Number.isInteger(manifest.entryCount) &&
    Array.isArray(manifest.entries) &&
    manifest.entries.every(isManifestEntry)
  )
}

function isManifestEntry(
  value: unknown
): value is ReviewManifest["entries"][number] {
  if (!value || typeof value !== "object") return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.path === "string" &&
    Number.isInteger(entry.size) &&
    typeof entry.sha256 === "string"
  )
}

export function verifyReviewArchive(archivePath: string): string[] {
  const manifestPath = manifestPathFor(archivePath)
  const archive = readFileSync(archivePath)
  const rawManifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  const failures: string[] = []
  if (!isManifest(rawManifest)) return ["Manifest has an invalid structure"]
  const manifest = rawManifest
  const entries = inspectZip(archive)
  const expected = new Map(manifest.entries.map((entry) => [entry.path, entry]))
  const root = resolve(import.meta.dirname, "..")
  const expectedArchivePath = relative(root, archivePath).replaceAll("\\", "/")

  if (manifest.archive !== expectedArchivePath)
    failures.push(
      `Manifest archive path ${manifest.archive} does not match ${expectedArchivePath}`
    )
  if (manifest.entryCount !== entries.size)
    failures.push(
      `Manifest entry count ${manifest.entryCount} does not match ZIP count ${entries.size}`
    )
  if (manifest.entries.length !== expected.size)
    failures.push("Manifest contains duplicate entry paths")
  if (
    manifest.entries.some(
      (entry, index, all) =>
        index > 0 && compareArchivePaths(all[index - 1].path, entry.path) >= 0
    )
  )
    failures.push("Manifest entries are not in deterministic path order")
  if (
    manifest.archiveSha256 !==
    createHash("sha256").update(archive).digest("hex")
  )
    failures.push("Archive SHA-256 does not match manifest")
  for (const path of REQUIRED_ARCHIVE_ENTRIES) {
    if (!entries.has(path))
      failures.push(`Required archive entry is absent from ZIP: ${path}`)
    if (!expected.has(path))
      failures.push(`Required source entry is absent from manifest: ${path}`)
  }

  for (const [path, data] of entries) {
    const item = expected.get(path)
    const sha256 = createHash("sha256").update(data).digest("hex")
    if (!item) failures.push(`ZIP entry is absent from manifest: ${path}`)
    else {
      if (item.size !== data.length) failures.push(`Size mismatch for ${path}`)
      if (item.sha256 !== sha256) failures.push(`SHA-256 mismatch for ${path}`)
    }
    if (isExcludedPath(path))
      failures.push(`Excluded path is present in ZIP: ${path}`)
  }
  for (const path of expected.keys()) {
    if (isExcludedPath(path))
      failures.push(`Excluded path is present in manifest: ${path}`)
    if (!entries.has(path))
      failures.push(`Manifest entry is absent from ZIP: ${path}`)
  }
  return failures
}

const archivePath = resolve(
  process.argv[2] ??
    resolve(import.meta.dirname, "..", "..", "SolSource-review.zip")
)
const failures = verifyReviewArchive(archivePath)

if (failures.length > 0) {
  console.error("Review archive verification failed:")
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`Review archive verified: ${archivePath}, SHA-256 verified`)
