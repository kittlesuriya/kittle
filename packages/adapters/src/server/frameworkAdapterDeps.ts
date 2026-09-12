import type { VerifiedAbacPolicyBundle, AbacReadScope } from "core/domain"
import type { HttpRequestMetadata } from "../http/trustedClientIp"
import type { TrustedClientIpResolver } from "../http/requestBody"
import type { IdempotencyPort, RateLimitStore } from "core/ports"

export type AbacBundle = VerifiedAbacPolicyBundle

export type FrameworkScope = "tenant" | "platform" | "public"

export type FrameworkAction = "read" | "create" | "update" | "delete"

export interface FrameworkEffectFailure {
  operationId?: string
  correlationId?: string
  phase: string
  effectName: string
  error: unknown
}

export type FrameworkEffectFailureReporter = (
  failure: FrameworkEffectFailure
) => void

export interface FrameworkActor {
  id: string
  type: FrameworkScope
  roleId?: string | null
  roleSlug?: string | null
  tenantId?: string | null
  branchId?: string | null
  departmentId?: string | null
  impersonatedById?: string | null
  /**
   * Explicit owner/administrative bypass grant. The framework never infers
   * bypass from role shape; a session can only bypass when this explicit
   * capability flag is set by the host application, and it is never inherited
   * by an impersonated session.
   */
  bypassAuthority?: boolean
}

export type FrameworkSession =
  | {
      scope: "tenant"
      actor: FrameworkActor & { type: "tenant"; tenantId: string }
      tenant: {
        id: string
        enabledModuleKeys: string[]
        enabledModuleActions: Record<string, string[]>
      }
      raw: unknown
    }
  | {
      scope: "platform"
      actor: FrameworkActor & { type: "platform" }
      raw: unknown
    }
  | {
      scope: "public"
      actor: null
      raw: null
    }

export interface FrameworkAdapterDeps {
  /** Atomic store used by security-sensitive route policies. */
  getRateLimitStore?: () => Promise<RateLimitStore>
  effectFailureReporter?: FrameworkEffectFailureReporter
  /** Resolves the client IP from trusted runtime context. Forwarded headers are never used by the framework. */
  resolveClientIp?: TrustedClientIpResolver
  resolveHttpMetadata?: (request: Request) => HttpRequestMetadata | undefined
  assertValidCsrf(request: Request): void
  resolveSession(args: {
    scope: FrameworkScope
    request: Request
    requireSession?: boolean
  }): Promise<FrameworkSession>
  hasCapability(args: {
    scope: FrameworkScope
    moduleKey: string
    capabilityKey: string
    session: FrameworkSession
  }): boolean
  resolveAbacBundle(args: {
    scope: FrameworkScope
    moduleKey: string
    session: FrameworkSession
  }): Promise<AbacBundle | null>
  hasGlobalAbacCapability?(args: {
    bundle: AbacBundle
    capabilityKey: string
  }): boolean
  resolveAbacReadScope?(args: {
    bundle: AbacBundle
    moduleKey: string
  }): AbacReadScope
  enforceAbacWrite?(args: {
    bundle: AbacBundle
    action: string
    record: Record<string, unknown>
  }): void
  assertModuleEnabled(args: {
    scope: FrameworkScope
    moduleKey: string
    session: FrameworkSession
  }): void
  assertModuleActionEnabled(args: {
    scope: FrameworkScope
    moduleKey: string
    action: FrameworkAction
    session: FrameworkSession
  }): void
  assertModuleCapabilityEnabled(args: {
    scope: FrameworkScope
    moduleKey: string
    capabilityKey: string
    session: FrameworkSession
  }): void
  isOwnerBypass(args: {
    scope: FrameworkScope
    session: FrameworkSession
  }): boolean
  createIdempotencyPort?: <TResult>(args: {
    scope: FrameworkScope
    session: FrameworkSession
  }) => IdempotencyPort<TResult>
}
