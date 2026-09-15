import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { resolve } from "path"

const srcDir = resolve(__dirname, "..")

function getSourceFiles(dir: string): string[] {
  const files: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory() && entry.name !== "__tests__") {
      files.push(...getSourceFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(fullPath)
    }
  }
  return files
}

function getImports(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8")
  const importRegex = /from\s+["']([^"']+)["']/g
  const imports: string[] = []
  let match
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]!)
  }
  return imports
}

describe("Architectural boundaries", () => {
  it("foundation/ must not import from any other subsystem", () => {
    const files = getSourceFiles(resolve(srcDir, "foundation"))
    const violations: string[] = []

    for (const file of files) {
      const imports = getImports(file)
      for (const imp of imports) {
        // Only match actual subsystem directories, not file names containing the substring
        if (
          imp.startsWith("../domain") ||
          imp.startsWith("../entity") ||
          imp.startsWith("../operation") ||
          imp.startsWith("../execution") ||
          imp.startsWith("../ports") ||
          imp.startsWith("../cache") ||
          imp.startsWith("../rate-limit") ||
          imp.includes("/domain/") ||
          imp.includes("/entity/") ||
          imp.includes("/operation/") ||
          imp.includes("/execution/") ||
          imp.includes("/ports/") ||
          imp.includes("/cache/") ||
          imp.includes("/rate-limit/")
        ) {
          violations.push(`${file.replace(srcDir, ".")}: ${imp}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("cache/ must not import from domain, entity, operation, execution, or ports", () => {
    const files = getSourceFiles(resolve(srcDir, "cache"))
    const violations: string[] = []

    for (const file of files) {
      const imports = getImports(file)
      for (const imp of imports) {
        if (
          imp.startsWith("../domain") ||
          imp.startsWith("../entity") ||
          imp.startsWith("../operation") ||
          imp.startsWith("../execution") ||
          imp.startsWith("../ports") ||
          imp.includes("/domain/") ||
          imp.includes("/entity/") ||
          imp.includes("/operation/") ||
          imp.includes("/execution/") ||
          imp.includes("/ports/")
        ) {
          violations.push(`${file.replace(srcDir, ".")}: ${imp}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("rate-limit/ must not import from domain, entity, operation, execution, or ports", () => {
    const files = getSourceFiles(resolve(srcDir, "rate-limit"))
    const violations: string[] = []

    for (const file of files) {
      const imports = getImports(file)
      for (const imp of imports) {
        if (
          imp.startsWith("../domain") ||
          imp.startsWith("../entity") ||
          imp.startsWith("../operation") ||
          imp.startsWith("../execution") ||
          imp.startsWith("../ports") ||
          imp.includes("/domain/") ||
          imp.includes("/entity/") ||
          imp.includes("/operation/") ||
          imp.includes("/execution/") ||
          imp.includes("/ports/")
        ) {
          violations.push(`${file.replace(srcDir, ".")}: ${imp}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("entity/ must not import from execution", () => {
    const files = getSourceFiles(resolve(srcDir, "entity"))
    const violations: string[] = []

    for (const file of files) {
      const imports = getImports(file)
      for (const imp of imports) {
        if (imp.includes("/execution")) {
          violations.push(`${file.replace(srcDir, ".")}: ${imp}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
