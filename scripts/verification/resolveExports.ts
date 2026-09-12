import { readFileSync, existsSync, statSync } from "node:fs"
import { join, dirname, resolve } from "node:path"

const DIRECT_EXPORT =
  /export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
const NAMED_FROM = /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g
const NAMED_LOCAL = /export\s+(?:type\s+)?\{([^}]*)\}/g
const STAR = /export\s+\*\s+from\s+["']([^"']+)["']/g
const STAR_NS = /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/g

function parseNamed(list: string): string[] {
  return list
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const asMatch = part.match(/^(.+?)\s+as\s+([A-Za-z_$][\w$]*)$/)
      if (asMatch) return asMatch[2] ?? ""
      const typeMatch = part.match(/^type\s+(.+)$/)
      if (typeMatch) return (typeMatch[1] ?? "").trim()
      return part
    })
    .filter(Boolean)
}

function resolveCandidates(base: string): string[] {
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]
}

/** Resolves every named export reachable from a module, following `export *` chains. */
export function resolveExports(
  filePath: string,
  visited = new Set<string>()
): Set<string> {
  const resolved = resolve(filePath)
  if (visited.has(resolved)) return new Set()
  visited.add(resolved)
  if (!existsSync(resolved)) return new Set()

  const source = readFileSync(resolved, "utf8")
  const names = new Set<string>()

  for (const match of source.matchAll(DIRECT_EXPORT)) {
    if (match[1]) names.add(match[1])
  }
  for (const match of source.matchAll(NAMED_FROM)) {
    for (const name of parseNamed(match[1] ?? "")) names.add(name)
  }
  for (const match of source.matchAll(NAMED_LOCAL)) {
    const lineEnd = source.indexOf("\n", match.index ?? 0)
    const rest = source.slice(
      match.index ?? 0,
      lineEnd === -1 ? undefined : lineEnd
    )
    if (!/\bfrom\s+["']/.test(rest)) {
      for (const name of parseNamed(match[1] ?? "")) names.add(name)
    }
  }
  for (const match of source.matchAll(STAR_NS)) {
    if (match[1]) names.add(match[1])
  }
  for (const match of source.matchAll(STAR)) {
    const target = match[1] ?? ""
    if (!target.startsWith(".")) continue
    const base = resolve(join(dirname(resolved), target))
    for (const candidate of resolveCandidates(base)) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        for (const name of resolveExports(candidate, visited)) names.add(name)
        break
      }
    }
  }

  return names
}
