import { describe, expect, it } from "vitest"
import { commandVersion, releaseCommands } from "./verifyRelease"

describe("release verification gates", () => {
  it("recognizes a successful command with empty output", () => {
    expect(commandVersion(process.execPath, ["-e", ""])).toBe("")
  })

  it("covers each authoritative release gate", () => {
    expect(releaseCommands()).toEqual(
      expect.arrayContaining([
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
      ])
    )
  })

  it("keeps the deterministic testing gates separate", () => {
    const commands = releaseCommands()
    expect(commands).toEqual(
      expect.arrayContaining(["test:property", "test:race", "test:crash"])
    )
    expect(new Set(commands).size).toBe(commands.length)
  })
})
