import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
  type Ref,
} from "react"
import { format as formatFns } from "date-fns"
import { parseDateInput } from "../format/parseDateInput"
import type {
  DocumentationPort,
  LinkComponentProps,
  LocalePort,
  MutationHandle,
  MutationRequest,
  NotifyPort,
  QueryHandle,
  QueryRequest,
  TenantDateFormatter,
  UiRuntime,
} from "./types"

const noop = () => {}

/**
 * Hook-stable fallback for an unbound request port. It enters the same call
 * order as a real adapter (single hook), so components rendered outside the
 * provider keep a consistent hook sequence and mutations no-op loudly.
 */
function useUnboundMutation<TVariables>(
  config: MutationRequest<TVariables>
): MutationHandle<TVariables> {
  const endpoint = config.endpoint
  return useMemo(
    () => ({
      mutate: () => {
        console.error(
          "[ui-runtime] No request port bound; mutation skipped.",
          endpoint
        )
      },
      mutateAsync: () =>
        Promise.reject(
          new Error(
            "[ui-runtime] No request port bound; cannot perform the mutation."
          )
        ),
      isPending: false,
    }),
    [endpoint]
  )
}

/** Unbound read fallback: renders empty state, refetch warns loudly. */
function useUnboundQuery<TData>(
  config: QueryRequest<TData>
): QueryHandle<TData> {
  const endpoint = config.endpoint
  return useMemo(
    () => ({
      data: undefined,
      error: undefined,
      isLoading: false,
      isFetching: false,
      refetch: () => {
        console.error(
          "[ui-runtime] No request port bound; refetch skipped.",
          endpoint
        )
      },
    }),
    [endpoint]
  )
}

const EMPTY_DOC = { data: undefined } as const

const DEFAULT_DOCUMENTATION: DocumentationPort = {
  useModuleDocumentation: () => EMPTY_DOC,
  open: () => {
    console.warn("[ui-runtime] No documentation port bound.")
  },
}

const DEFAULT_NOTIFY: NotifyPort = {
  success: (message) => {
    console.info("[ui-runtime]", message)
  },
  error: (message) => {
    console.error("[ui-runtime]", message)
  },
}

/** Neutral DD/MM/YYYY fallback; the app binds the tenant-aware formatter. */
const DEFAULT_PATTERN = "dd/MM/yyyy"

/** Plain anchor fallback; the app binds its router link. */
function DefaultLink({ href, children, ref, ...rest }: LinkComponentProps) {
  return (
    <a href={href} ref={ref as Ref<HTMLAnchorElement>} {...rest}>
      {children}
    </a>
  )
}

/** Identity-ish locale fallback; the app owns supported-locale policy. */
const DEFAULT_LOCALE: LocalePort = {
  normalizeLocale: (locale) => {
    const base = (locale ?? "").toLowerCase().split("-")[0]
    return base || "en"
  },
  persistLocale: () => {},
}

function defaultTenantDateFormatter(): TenantDateFormatter {
  return {
    dateFnsPattern: DEFAULT_PATTERN,
    formatDate: (input, fallback = "-") => {
      const d = parseDateInput(input)
      return d ? formatFns(d, DEFAULT_PATTERN) : fallback
    },
    formatDateTime: (input, fallback = "-") => {
      const d = parseDateInput(input)
      if (!d) return fallback
      const hours = String(d.getHours()).padStart(2, "0")
      const minutes = String(d.getMinutes()).padStart(2, "0")
      return `${formatFns(d, DEFAULT_PATTERN)} ${hours}:${minutes}`
    },
  }
}

/** Runtime used when no provider is mounted: safe no-ops, loud on misuse. */
export const DEFAULT_UI_RUNTIME: UiRuntime = {
  request: { useMutation: useUnboundMutation, useQuery: useUnboundQuery },
  queryClient: { invalidateQueries: noop },
  notify: DEFAULT_NOTIFY,
  documentation: DEFAULT_DOCUMENTATION,
  formatDate: { useTenantDateFormatter: defaultTenantDateFormatter },
  link: DefaultLink,
  locale: DEFAULT_LOCALE,
  formatError: (error, fallback = "Operation failed") =>
    error instanceof Error && error.message ? error.message : fallback,
}

const UiRuntimeContext = createContext<UiRuntime>(DEFAULT_UI_RUNTIME)

export function UiRuntimeProvider({
  runtime,
  children,
}: {
  /** Overrides merged over the enclosing runtime (defaults at the root). */
  runtime: Partial<UiRuntime>
  children: ReactNode
}) {
  const parent = useContext(UiRuntimeContext)
  const value = useMemo(() => ({ ...parent, ...runtime }), [parent, runtime])
  return (
    <UiRuntimeContext.Provider value={value}>
      {children}
    </UiRuntimeContext.Provider>
  )
}

/** The bound runtime (defaults are always present). */
export function useUiRuntime(): UiRuntime {
  return useContext(UiRuntimeContext)
}
