import type { JobScope, NewJob } from "./types"
import { canonicalJsonString } from "../foundation/canonicalJson"

export const JOB_FINGERPRINT_VERSION = 2

export interface JobFingerprintInput {
  scope: JobScope
  jobType: string
  jobVersion: number
  tenantId: string | null
  payload: Record<string, unknown>
  runAt: Date
  maxAttempts: number
  priority: number
  correlationId: string | null
  partitionKey: string | null
  metadata: Record<string, unknown> | null
}

export function buildJobFingerprintInput(
  job: NewJob,
  scope: JobScope,
  runAt: Date
): JobFingerprintInput {
  return {
    scope,
    jobType: job.jobType,
    jobVersion: job.jobVersion,
    tenantId: job.tenantId ?? null,
    payload: job.payload,
    runAt,
    maxAttempts: job.maxAttempts ?? 3,
    priority: job.priority ?? 0,
    correlationId: job.correlationId ?? null,
    partitionKey: job.partitionKey ?? null,
    metadata: job.metadata ?? null,
  }
}

export async function fingerprintJob(
  input: JobFingerprintInput
): Promise<string> {
  // Canonical JSON rejects Date values, so the run time is normalized to an
  // ISO string primitive before canonicalization to keep the digest durable.
  const canonical = canonicalJsonString({
    version: JOB_FINGERPRINT_VERSION,
    job: { ...input, runAt: input.runAt.toISOString() },
  })
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}
