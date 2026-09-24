export type NestHeaderValue = string | string[] | undefined

/** The subset of Express/Fastify request APIs used by the Nest bridge. */
export interface NestRequestLike {
  method: string
  protocol?: string
  hostname?: string
  originalUrl?: string
  url?: string
  headers: Record<string, NestHeaderValue>
  body?: unknown
  params?: Record<string, string>
  get?: (name: string) => string | undefined
  raw?: { headers?: Record<string, NestHeaderValue> }
}

/** The subset of Express/Fastify response APIs used by the Nest bridge. */
export interface NestResponseLike {
  status?: (statusCode: number) => NestResponseLike
  code?: (statusCode: number) => NestResponseLike
  setHeader?: (name: string, value: string) => void
  header?: (name: string, value: string) => NestResponseLike
  set?: (name: string, value: string) => NestResponseLike
  send: (body?: unknown) => unknown
}

export interface NestCrudHandlers {
  list: (
    request: Request,
    context?: { params?: Promise<unknown> }
  ) => Promise<Response>
  detail: (
    request: Request,
    params: Record<string, string>
  ) => Promise<Response>
  create: (
    request: Request,
    context?: { params?: Promise<unknown> }
  ) => Promise<Response>
  update: (
    request: Request,
    context?: { params?: Promise<unknown> }
  ) => Promise<Response>
  delete: (
    request: Request,
    context?: { params?: Promise<unknown> }
  ) => Promise<Response>
}

export interface NestCrudControllerOptions {
  handlers: NestCrudHandlers
  prefix?: string
}

export interface NestCrudModuleOptions extends NestCrudControllerOptions {
  moduleName?: string
}
