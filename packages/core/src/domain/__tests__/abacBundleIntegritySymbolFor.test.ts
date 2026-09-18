import { describe, expect, it } from "vitest"
import {
  assertVerifiedAbacBundle,
  bindAbacSecurityDigest,
  deepFreeze,
  deriveAbacSecurityDigest,
} from "../abacBundleIntegrity"
import type { AbacPolicyBundle } from "../abacTypes"

function rawBundle(
  overrides: Partial<AbacPolicyBundle> = {}
): Omit<AbacPolicyBundle, "securityDigest"> {
  return {
    mode: "tenant",
    moduleKey: "test.bundle",
    policies: [],
    context: {},
    defaultEffect: "deny",
    fieldCatalog: {},
    ...overrides,
  }
}

describe("Batch H: Symbol.for verified-bundle brand", () => {
  it("shares the brand through the global symbol registry (duplicate modules agree)", async () => {
    const verified = await bindAbacSecurityDigest(rawBundle())
    const globalBrand = Symbol.for("kittle.verified-abac-bundle")
    expect(
      (verified as unknown as Record<symbol, unknown>)[globalBrand]
    ).toBe(true)
  })

  it("brand survives the clone-freeze round trip", async () => {
    const verified = await bindAbacSecurityDigest(rawBundle())
    const roundTripped = deepFreeze(verified)
    expect(() => assertVerifiedAbacBundle(roundTripped)).not.toThrow()
    expect(
      (roundTripped as unknown as Record<symbol, unknown>)[
        Symbol.for("kittle.verified-abac-bundle")
      ]
    ).toBe(true)
  })

  it("still rejects unbranded and forged bundles", async () => {
    const verified = await bindAbacSecurityDigest(rawBundle())
    // JSON strips symbol brands: recompute a self-consistent digest and it
    // must still be rejected as unverified.
    const stripped = JSON.parse(JSON.stringify(verified)) as AbacPolicyBundle
    const { securityDigest: _ignored, ...withoutDigest } = stripped
    const forged: AbacPolicyBundle = {
      ...withoutDigest,
      securityDigest: await deriveAbacSecurityDigest(withoutDigest),
    }
    expect(() => assertVerifiedAbacBundle(forged)).toThrow(
      "not a verified production bundle"
    )
    // Manually forging the global symbol alone is in-process malicious code
    // that could equally call bindAbacSecurityDigest; the digest check still
    // applies via assertAbacSecurityDigest (covered by existing tests).
    expect(() => assertVerifiedAbacBundle(stripped)).toThrow(
      "not a verified production bundle"
    )
  })
})
