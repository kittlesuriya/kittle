import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const packages = process.argv.slice(2)
const root = resolve(import.meta.dirname, "../..")

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : [path]
  })
}

function rewriteFile(file: string): void {
  const source = readFileSync(file, "utf8")
  let rewritten = source
  const rewriteSpecifier = (
    prefix: string,
    target: string,
    suffix: string
  ): string => {
    if (target.endsWith(".js") || target.endsWith(".json"))
      return `${prefix}${target}${suffix}`
    const fileTarget = join(dirname(file), target) + ".js"
    const indexTarget = join(dirname(file), target, "index.js")
    if (existsSync(fileTarget)) return `${prefix}${target}.js${suffix}`
    if (existsSync(indexTarget)) return `${prefix}${target}/index.js${suffix}`
    return `${prefix}${target}${suffix}`
  }
  rewritten = rewritten.replace(
    /(from\s+["'])(\.[^"']+)(["'])/g,
    (_match, prefix: string, target: string, suffix: string) =>
      rewriteSpecifier(prefix, target, suffix)
  )
  rewritten = rewritten.replace(
    /(import\s*\(\s*["'])(\.[^"']+)(["']\s*\))/g,
    (_match, prefix: string, target: string, suffix: string) =>
      rewriteSpecifier(prefix, target, suffix)
  )
  rewritten = rewritten.replace(
    /(import\s+["'])(\.[^"']+)(["'])/g,
    (_match, prefix: string, target: string, suffix: string) =>
      rewriteSpecifier(prefix, target, suffix)
  )
  rewritten = rewritten.replace(
    /(export\s+.*from\s+["'])(\.[^"']+)(["'])/g,
    (_match, prefix: string, target: string, suffix: string) =>
      rewriteSpecifier(prefix, target, suffix)
  )
  if (rewritten !== source) writeFileSync(file, rewritten)
}

for (const packagePath of packages) {
  const dist = join(root, packagePath, "dist")
  if (!existsSync(dist)) throw new Error(`Build output is missing: ${dist}`)
  for (const file of filesIn(dist).filter(
    (path) => path.endsWith(".js") || path.endsWith(".d.ts")
  ))
    rewriteFile(file)
}
