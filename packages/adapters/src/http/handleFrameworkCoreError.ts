import { ZodError } from "zod"
import {
  AuditActorMissingError,
  AuditSinkMissingError,
  BusinessRuleError,
  CapabilityError,
  ConfigurationError,
  ConflictError,
  ForbiddenError,
  FrameworkCoreError,
  NotFoundError,
  RateLimitError,
  RuntimeCapabilityError,
  UnauthorizedError,
  ValidationError,
} from "core/domain"
import {
  InvalidJsonError,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
} from "./requestBody"

export function frameworkJson<T>(data: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("cache-control", "no-store")
  return Response.json(data, { ...init, headers })
}

export interface FrameworkErrorHandlerOptions {
  reportError?: (error: unknown) => void
}

export type FrameworkResponseMetadata = {
  requestId: string
  correlationId: string
}

const MAX_ISSUE_PATH_LENGTH = 200
const MAX_ISSUE_MESSAGE_LENGTH = 300

function formatIssuePath(path: readonly (string | number | symbol)[]): string {
  const joined = path.map((segment) => String(segment)).join(".")
  return joined.length > MAX_ISSUE_PATH_LENGTH
    ? joined.slice(0, MAX_ISSUE_PATH_LENGTH)
    : joined
}

function defaultReportError(_error: unknown) {}

export function createFrameworkErrorHandler(
  options: FrameworkErrorHandlerOptions = {}
) {
  const { reportError = defaultReportError } = options
  return (error: unknown, metadata?: FrameworkResponseMetadata): Response => {
    const finish = (response: Response): Response => {
      if (metadata?.requestId)
        response.headers.set("x-request-id", metadata.requestId)
      if (metadata?.correlationId)
        response.headers.set("x-correlation-id", metadata.correlationId)
      return response
    }
    const json = <T>(data: T, init?: ResponseInit) =>
      finish(frameworkJson(data, init))
    if (error instanceof UnauthorizedError) {
      reportError(error)
      return json({ error: "Unauthorized", code: error.code }, { status: 401 })
    }

    if (error instanceof ForbiddenError) {
      reportError(error)
      return json({ error: "Forbidden", code: error.code }, { status: 403 })
    }

    if (error instanceof NotFoundError) {
      return json({ error: "Not found", code: error.code }, { status: 404 })
    }

    if (error instanceof ConflictError) {
      return json({ error: "Conflict", code: error.code }, { status: 409 })
    }

    if (error instanceof InvalidJsonError) {
      return json(
        { error: "Invalid JSON body", code: error.code },
        { status: 400 }
      )
    }

    if (error instanceof RequestBodyTooLargeError) {
      return json(
        { error: "Request body is too large", code: error.code },
        { status: 413 }
      )
    }

    if (error instanceof UnsupportedMediaTypeError) {
      return json(
        { error: "Unsupported media type", code: error.code },
        { status: 415 }
      )
    }

    if (error instanceof ValidationError) {
      return json(
        { error: "Validation failed", code: error.code },
        { status: 400 }
      )
    }

    if (error instanceof BusinessRuleError) {
      return json(
        { error: "Business rule violation", code: error.code },
        { status: 400 }
      )
    }

    if (error instanceof CapabilityError) {
      reportError(error)
      return json({ error: "Forbidden", code: error.code }, { status: 403 })
    }

    if (error instanceof RateLimitError) {
      return json(
        { error: error.message, code: error.code },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(error.retryAfterMs / 1000)),
          },
        }
      )
    }

    if (
      error instanceof AuditSinkMissingError ||
      error instanceof AuditActorMissingError ||
      error instanceof ConfigurationError ||
      error instanceof RuntimeCapabilityError
    ) {
      // 5xx framework errors never serialize internal implementation details.
      reportError(error)
      return json(
        { error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" },
        { status: 500 }
      )
    }

    if (error instanceof FrameworkCoreError) {
      reportError(error)
      return json(
        { error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" },
        { status: 500 }
      )
    }

    if (error instanceof ZodError) {
      return json(
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details: error.issues.map((issue) => ({
            code: issue.code,
            path: formatIssuePath(issue.path),
            message: issue.message.slice(0, MAX_ISSUE_MESSAGE_LENGTH),
          })),
        },
        { status: 400 }
      )
    }

    reportError(error)
    return json(
      { error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    )
  }
}

export {
  InvalidJsonError,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
  parseJsonBodySafely,
} from "./requestBody"
