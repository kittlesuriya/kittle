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
  INTERNAL_SERVER_ERROR_NUMERIC_CODE,
  NotFoundError,
  RateLimitError,
  RuntimeCapabilityError,
  UnauthorizedError,
  ValidationError,
} from "kittle-core/domain"
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
  errorExposure?: FrameworkErrorExposure
}

export interface FrameworkErrorExposure {
  exposeBusinessRuleMessage?: boolean
  exposeBusinessRuleDetails?: boolean
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
  const { reportError = defaultReportError, errorExposure = {} } = options
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
      return json(
        {
          error: "Unauthorized",
          code: error.code,
          numericCode: error.numericCode,
        },
        { status: 401 }
      )
    }

    if (error instanceof ForbiddenError) {
      reportError(error)
      return json(
        {
          error: "Forbidden",
          code: error.code,
          numericCode: error.numericCode,
        },
        { status: 403 }
      )
    }

    if (error instanceof NotFoundError) {
      return json(
        {
          error: "Not found",
          code: error.code,
          numericCode: error.numericCode,
        },
        { status: 404 }
      )
    }

    if (error instanceof ConflictError) {
      return json(
        { error: "Conflict", code: error.code, numericCode: error.numericCode },
        { status: 409 }
      )
    }

    if (error instanceof InvalidJsonError) {
      return json(
        {
          error: "Invalid JSON body",
          code: error.code,
          numericCode: error.numericCode,
        },
        { status: 400 }
      )
    }

    if (error instanceof RequestBodyTooLargeError) {
      return json(
        {
          error: "Request body is too large",
          code: error.code,
          numericCode: error.numericCode,
        },
        { status: 413 }
      )
    }

    if (error instanceof UnsupportedMediaTypeError) {
      return json(
        {
          error: "Unsupported media type",
          code: error.code,
          numericCode: error.numericCode,
        },
        { status: 415 }
      )
    }

    if (error instanceof ValidationError) {
      return json(
        {
          error: "Validation failed",
          code: error.code,
          numericCode: error.numericCode,
        },
        { status: 400 }
      )
    }

    if (error instanceof BusinessRuleError) {
      const body: Record<string, unknown> = {
        error: errorExposure.exposeBusinessRuleMessage
          ? error.message
          : "Business rule violation",
        code: error.code,
        numericCode: error.numericCode,
      }
      if (errorExposure.exposeBusinessRuleDetails) body.details = error.details
      return json(body, { status: 400 })
    }

    if (error instanceof CapabilityError) {
      reportError(error)
      return json(
        {
          error: "Forbidden",
          code: error.code,
          numericCode: error.numericCode,
        },
        { status: 403 }
      )
    }

    if (error instanceof RateLimitError) {
      return json(
        {
          error: error.message,
          code: error.code,
          numericCode: error.numericCode,
        },
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
        {
          error: "Internal Server Error",
          code: "INTERNAL_SERVER_ERROR",
          numericCode: INTERNAL_SERVER_ERROR_NUMERIC_CODE,
        },
        { status: 500 }
      )
    }

    if (error instanceof FrameworkCoreError) {
      reportError(error)
      return json(
        {
          error: "Internal Server Error",
          code: "INTERNAL_SERVER_ERROR",
          numericCode: INTERNAL_SERVER_ERROR_NUMERIC_CODE,
        },
        { status: 500 }
      )
    }

    if (error instanceof ZodError) {
      return json(
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          numericCode: 1001,
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
      {
        error: "Internal Server Error",
        code: "INTERNAL_SERVER_ERROR",
        numericCode: INTERNAL_SERVER_ERROR_NUMERIC_CODE,
      },
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
