/**
 * Runtime ports — the app-side capabilities that the extracted UI code needs.
 *
 * The package never imports app modules. Every coupling is expressed as a
 * port, bound once by the app (see `erp/src/lib/ui-runtime.tsx`) through the
 * `UiRuntimeProvider`. Interfaces are structural so the app can bind its own
 * concrete types without adapters.
 */

import type { AnchorHTMLAttributes, ComponentType, Ref } from "react"

/** Minimal CASL-like ability. Classic method syntax (not a property type)
 *  keeps the app's `AppAbility` assignable — method bivariance. */
export interface AbilityLike {
  can(action: string, subject: string): boolean
}

/** Props accepted by the link renderer used for menu navigation. */
export interface LinkComponentProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  /** Router prefetch hint (ignored by non-router implementations). */
  preload?: boolean
  /** Callback ref used by menu measurement (React 19 ref-as-prop). */
  ref?: Ref<HTMLElement>
}

/** Renders app links (router-aware in the app, plain <a> by default). */
export type LinkComponent = ComponentType<LinkComponentProps>

/** Locale normalisation + persistence; the app owns i18n policy. */
export interface LocalePort {
  /** Normalise a raw language tag (e.g. "ta-IN") to a supported locale. */
  normalizeLocale: (locale: string | null | undefined) => string
  /** Persist the chosen locale (storage strategy app-owned). */
  persistLocale: (locale: string) => void
}

export interface NotifyPort {
  success(message: string): void
  error(message: string): void
}

/**
 * UI analytics. Implementations decide which scopes are tracked (the app
 * gates on `isTrackedScope`) so call sites never need that policy.
 */
export interface AnalyticsPort {
  trackEvent(name: "UI_ACTION", payload: Record<string, unknown>): void
}

export interface NavigationPort {
  pathname: string
  /** Raw query string (no leading "?"), as consumed by `URLSearchParams`. */
  search: string
  navigate: (to: string, opts?: { replace?: boolean }) => void
  /** True when the path matches a registered app route (menu validation).
   *  Undefined → menu validation is skipped. */
  hasRoute?: (path: string) => boolean
}

export interface InvalidatableQueryClient {
  invalidateQueries(args: {
    queryKey: readonly unknown[]
    exact?: boolean
    refetchType?: "active"
  }): void
}

/** Mutation config — mirror of the app's `useApiMutation` config. */
export interface MutationRequest<TVariables = unknown> {
  endpoint: string | ((variables: TVariables) => string)
  method?: "POST" | "PUT" | "PATCH" | "DELETE"
  headers?: HeadersInit | ((variables: TVariables) => HeadersInit)
  mapBody?: (variables: TVariables) => unknown
  organizationId?: string
  revalidateTags?: string[]
  onSuccess?: (data: unknown, variables: TVariables) => void
  onError?: (error: unknown, variables: TVariables) => void
}

export interface MutationHandle<TVariables = unknown> {
  mutate: (variables: TVariables) => void
  mutateAsync: (variables: TVariables) => Promise<unknown>
  isPending: boolean
}

/** Query config — mirror of the app's `useApiQuery` config (consumed subset). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- TData documents the data shape the port returns for this config
export interface QueryRequest<TData = unknown> {
  /** Query key — string or array; the app serialises params onto it. */
  key: string | readonly unknown[]
  endpoint: string
  method?: "GET" | "POST"
  queryParams?: Record<string, unknown>
  organizationId?: string
  scope?: "tenant" | "platform"
  enabled?: boolean
  requireOrganization?: boolean
  /** Extra TanStack query options (e.g. `placeholderData`). */
  options?: {
    placeholderData?: unknown
    enabled?: boolean
  }
}

/** Query handle — the subset of `UseQueryResult` the extracted tables use. */
export interface QueryHandle<TData = unknown> {
  data: TData | undefined
  error: unknown
  isLoading: boolean
  isFetching: boolean
  refetch: () => void
}

export interface RequestPort {
  /**
   * Mutation hook adapter. Must be called unconditionally during render
   * (hook semantics); the app binds it to its TanStack-based adapter so
   * pending state, invalidation and analytics behave exactly as before.
   */
  useMutation<TVariables = unknown>(
    config: MutationRequest<TVariables>
  ): MutationHandle<TVariables>
  /**
   * Read adapter. Same hook semantics as `useMutation`; the app binds it to
   * its session-aware query hook (org resolution, query keys, gc policy).
   */
  useQuery<TData = unknown>(config: QueryRequest<TData>): QueryHandle<TData>
}

export type DocumentationScope = "platform" | "tenant"

export interface DocumentationPort {
  /** Availability query — warms the same cache entry the drawer reads. */
  useModuleDocumentation(
    moduleKey: string | undefined,
    scope: DocumentationScope
  ): { data?: unknown }
  /** Open the shared documentation drawer for a module. */
  open(moduleKey: string | undefined, scope: DocumentationScope): void
}

/**
 * Tenant date presentation. The app owns the (future) tenant date-preference
 * setting; the package only renders through whatever it resolves.
 */
export interface TenantDateFormatter {
  /** date-fns pattern resolved from the tenant preference. */
  dateFnsPattern: string
  formatDate: (
    input: string | Date | null | undefined,
    fallback?: string
  ) => string
  formatDateTime: (
    input: string | Date | null | undefined,
    fallback?: string
  ) => string
}

export interface DateFormatPort {
  /** Hook-shaped so call order matches when bound and unbound. */
  useTenantDateFormatter(): TenantDateFormatter
}

export interface SubjectResolutionInput {
  moduleKey?: string
  endpoint: string
}

/**
 * Full runtime surface. Required ports carry package-side defaults (see
 * `DEFAULT_UI_RUNTIME`) so an unbound runtime degrades to safe no-ops
 * instead of crashing renders; optional ports are skipped when absent.
 */
export interface UiRuntime {
  request: RequestPort
  queryClient: InvalidatableQueryClient
  notify: NotifyPort
  /** Undefined → analytics calls are skipped. */
  analytics?: AnalyticsPort
  /** Undefined → consumers fall back to window-based navigation. */
  navigation?: NavigationPort
  /** Resolve a DataTable module key (or legacy endpoint) to a CASL subject. */
  resolveSubject?: (input: SubjectResolutionInput) => string | undefined
  documentation: DocumentationPort
  /** Tenant date pattern + formatters for `<Date>` and the form family. */
  formatDate: DateFormatPort
  /** Link renderer used by sidebar/menu navigation. */
  link: LinkComponent
  /** Locale helpers used by the user menu. */
  locale: LocalePort
  /**
   * Per-layout CASL ability, bound by a nested provider inside each shell.
   * Unbound behaves as full access — matching the app's contextual default.
   */
  ability?: AbilityLike
  /** Rewrite an internal path to the workspace-display URL for analytics. */
  buildWorkspaceUrl?: (input: string) => string
  /** App error formatter (ApiError-aware). */
  formatError: (error: unknown, fallback?: string) => string
}
