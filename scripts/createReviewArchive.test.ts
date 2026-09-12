import { createHash } from "node:crypto"
import { mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  createZip,
  createManifest,
  inspectZip,
  isExcludedPath,
  REQUIRED_ARCHIVE_ENTRIES,
  type ArchiveEntry,
} from "./createReviewArchive"

describe("review archive policy", () => {
  it("excludes secrets, caches, build output, metadata, and generated artifacts", () => {
    expect(isExcludedPath(".env")).toBe(true)
    expect(isExcludedPath(".envrc")).toBe(true)
    expect(isExcludedPath("config.env.local")).toBe(true)
    expect(isExcludedPath("config.env.local/secrets.txt")).toBe(true)
    expect(isExcludedPath("env.local")).toBe(true)
    expect(isExcludedPath("packages/core/.env.production")).toBe(true)
    expect(isExcludedPath("packages/core/config.env")).toBe(true)
    expect(isExcludedPath("packages/core/.env.example")).toBe(false)
    expect(isExcludedPath("packages/core/custom.env.example")).toBe(false)
    expect(isExcludedPath("node_modules/react/index.js")).toBe(true)
    expect(isExcludedPath("packages/core/dist/index.js")).toBe(true)
    expect(
      isExcludedPath("packages/core/src/generated/accessManifest.ts")
    ).toBe(true)
    expect(isExcludedPath("REVIEW-FIX.md")).toBe(false)
    expect(isExcludedPath("docs/operations/deployment-checklist.md")).toBe(
      false
    )
  })

  it("rejects symbolic links while collecting source", async () => {
    const { collectArchiveEntries } = await import("./createReviewArchive")
    const root = mkdtempSync(join(tmpdir(), "review-archive-"))
    writeFileSync(join(root, "README.md"), "source")
    try {
      symlinkSync(join(root, "README.md"), join(root, "linked.md"))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return
      throw error
    }
    expect(() => collectArchiveEntries(root)).toThrow(/Symbolic links/)
    unlinkSync(join(root, "linked.md"))
  })

  it("rejects symbolic-link metadata in ZIP entries", () => {
    const archive = createZip([
      {
        path: "README.md",
        data: Buffer.from("source"),
        sha256: createHash("sha256").update("source").digest("hex"),
      },
    ])
    const centralOffset = archive.readUInt32LE(archive.length - 6)
    const central = Buffer.from(archive)
    central.writeUInt16LE(0x0314, centralOffset + 4)
    central.writeUInt32LE(0xa0000000, centralOffset + 38)
    expect(() => inspectZip(central)).toThrow(/Symbolic links/)
  })

  it("requires the framework review documents in the archive", () => {
    expect(REQUIRED_ARCHIVE_ENTRIES).toEqual(
      expect.arrayContaining(["package.json", "REVIEW-FIX.md"])
    )
  })

  it("inspects the actual ZIP payloads", () => {
    const data = Buffer.from("reviewable source")
    const entries: ArchiveEntry[] = [
      {
        path: "README.md",
        data,
        sha256: createHash("sha256").update(data).digest("hex"),
      },
    ]
    const inspected = inspectZip(createZip(entries))

    expect([...inspected.keys()]).toEqual(["README.md"])
    expect(inspected.get("README.md")?.toString()).toBe("reviewable source")
  })

  it("sorts ZIP entries and manifest entries deterministically", () => {
    const makeEntry = (path: string): ArchiveEntry => {
      const data = Buffer.from(path)
      return {
        path,
        data,
        sha256: createHash("sha256").update(data).digest("hex"),
      }
    }
    const archive = createZip([makeEntry("z.txt"), makeEntry("a.txt")])
    expect([...inspectZip(archive).keys()]).toEqual(["a.txt", "z.txt"])
    expect(
      createManifest("review.zip", archive, inspectZip(archive)).entries.map(
        (entry) => entry.path
      )
    ).toEqual(["a.txt", "z.txt"])
  })
})
