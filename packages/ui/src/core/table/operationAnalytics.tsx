import { createContext, useContext } from "react"

export type OperationAnalyticsMeta = {
  scope: "tenant" | "platform"
  moduleKey: string
  action: string
  path?: string
  entityId?: string | number
}

const OperationAnalyticsContext = createContext<OperationAnalyticsMeta | null>(
  null
)

export function OperationAnalyticsProvider({
  value,
  children,
}: {
  value: OperationAnalyticsMeta | null
  children: React.ReactNode
}) {
  return (
    <OperationAnalyticsContext.Provider value={value}>
      {children}
    </OperationAnalyticsContext.Provider>
  )
}

export function useOperationAnalyticsMeta() {
  return useContext(OperationAnalyticsContext)
}
