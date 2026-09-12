import type { AbacPolicyBundle, VerifiedAbacPolicyBundle } from "./abacTypes"
import { canonicalizeJson } from "../ports/canonicalJson"
import { cloneAndFreezeDefinition } from "../utils"

const VERIFIED_ABAC_BUNDLE = Symbol("verified-abac-bundle")

type BrandedVerifiedBundle = VerifiedAbacPolicyBundle & {
  readonly [VERIFIED_ABAC_BUNDLE]: true
}

export const deepFreeze = cloneAndFreezeDefinition

export async function deriveAbacSecurityDigest(
  bundle: Omit<AbacPolicyBundle, "securityDigest">
): Promise<string> {
  const canonical = JSON.stringify({
    version: 1,
    bundle: canonicalizeJson(bundle),
  })
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export async function bindAbacSecurityDigest(
  bundle: Omit<AbacPolicyBundle, "securityDigest">
): Promise<VerifiedAbacPolicyBundle> {
  if (bundle.defaultEffect !== "deny")
    throw new Error("ABAC bundles must be deny-by-default")
  const { securityDigest: _ignored, ...withoutDigest } =
    bundle as AbacPolicyBundle
  const securityDigest = await deriveAbacSecurityDigest(withoutDigest)
  return deepFreeze({
    ...withoutDigest,
    securityDigest,
    [VERIFIED_ABAC_BUNDLE]: true,
  }) as BrandedVerifiedBundle
}

/**
 * Verification helper — intended for consumers only, not an
 * enforcement primitive for the framework's own paths.
 *
 * The SHA-256 digest alone is recomputable by any caller, so a self-consistent
 * digest is NOT an unforgeable brand. This helper therefore also requires the
 * un-forgeable verified brand (`assertVerifiedAbacBundle`): a raw or forged
 * bundle is rejected even when its digest matches its own content. The missing-
 * digest diagnostic is surfaced first only to preserve a clearer error for
 * bundles that never carried a digest; every digest-bearing bundle must prove
 * the verified brand before its digest is trusted.
 */
export async function assertAbacSecurityDigest(
  bundle: AbacPolicyBundle
): Promise<void> {
  if (bundle.defaultEffect !== "deny")
    throw new Error("ABAC bundles must be deny-by-default")
  if (!bundle.securityDigest)
    throw new Error("ABAC bundle security digest is missing")
  assertVerifiedAbacBundle(bundle)
  const { securityDigest: _ignored, ...withoutDigest } = bundle
  const expected = await deriveAbacSecurityDigest(withoutDigest)
  if (expected !== bundle.securityDigest)
    throw new Error("ABAC bundle security digest mismatch")
}

export function assertVerifiedAbacBundle(
  bundle: AbacPolicyBundle
): asserts bundle is VerifiedAbacPolicyBundle {
  if (
    !bundle ||
    typeof bundle !== "object" ||
    bundle.defaultEffect !== "deny" ||
    !Object.prototype.hasOwnProperty.call(bundle, VERIFIED_ABAC_BUNDLE) ||
    (bundle as BrandedVerifiedBundle)[VERIFIED_ABAC_BUNDLE] !== true ||
    typeof bundle.securityDigest !== "string"
  ) {
    throw new Error("ABAC bundle is not a verified production bundle")
  }
}
