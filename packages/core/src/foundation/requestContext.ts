export interface ActorContext {
  id: string
  type: string
  impersonatedById?: string | null
}

export interface RequestContext {
  requestId: string
  correlationId: string
  tenantId?: string | null
  actor?: ActorContext
  metadata?: Record<string, unknown>
}
