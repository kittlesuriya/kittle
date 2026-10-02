import { describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"
import {
  BusinessRuleError,
  CapabilityError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "kittle-core/domain"
import { createFrameworkErrorHandler } from "../handleFrameworkCoreError"
import {
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
} from "../requestBody"

async function responseBody(response: Response): Promise<unknown> {
  const body: unknown = await response.json()
  return body
}

describe("framework HTTP error serialization", () => {
  it.each([
    [
      new UnauthorizedError("credential detail", { userId: "user-1" }),
      401,
      { error: "Unauthorized", code: "UNAUTHORIZED", numericCode: 1101 },
    ],
    [
      new ForbiddenError("ABAC policy detail", {
        policy: "secret-policy",
        fields: ["ssn"],
      }),
      403,
      { error: "Forbidden", code: "FORBIDDEN", numericCode: 1102 },
    ],
    [
      new CapabilityError("tenant.module:manage", {
        moduleKey: "tenant.module",
      }),
      403,
      { error: "Forbidden", code: "CAPABILITY_REQUIRED", numericCode: 1103 },
    ],
  ] as const)("sanitizes %s responses", async (error, status, expected) => {
    const reportError = vi.fn()
    const response = createFrameworkErrorHandler({ reportError })(error)

    expect(response.status).toBe(status)
    expect(await responseBody(response)).toEqual(expected)
    expect(reportError).toHaveBeenCalledWith(error)
  })

  it("does not leak freeform exception text on 4xx reason codes", async () => {
    const cases: Array<[unknown, number, Record<string, unknown>]> = [
      [
        new ValidationError("leaked validation detail", {
          dbPassword: "s3cret",
        }),
        400,
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          numericCode: 1001,
        },
      ],
      [
        new RequestBodyTooLargeError(1024),
        413,
        {
          error: "Request body is too large",
          code: "REQUEST_BODY_TOO_LARGE",
          numericCode: 1004,
        },
      ],
      [
        new UnsupportedMediaTypeError(),
        415,
        {
          error: "Unsupported media type",
          code: "UNSUPPORTED_MEDIA_TYPE",
          numericCode: 1005,
        },
      ],
    ]
    for (const [error, status, expected] of cases) {
      const response = createFrameworkErrorHandler()(error)
      expect(response.status).toBe(status)
      const body = await responseBody(response)
      expect(body).not.toMatchObject({
        error: expect.stringContaining("leaked") as unknown,
      })
      expect(body).toEqual(expected)
    }
  })

  it("exposes business-rule messages only when explicitly configured", async () => {
    const error = new BusinessRuleError(
      "Cannot delete role with assigned users",
      {
        roleId: "role-1",
      }
    )

    const sanitized = createFrameworkErrorHandler()(error)
    expect(await responseBody(sanitized)).toEqual({
      error: "Business rule violation",
      code: "BAD_REQUEST",
      numericCode: 1002,
    })

    const exposed = createFrameworkErrorHandler({
      errorExposure: { exposeBusinessRuleMessage: true },
    })(error)
    expect(await responseBody(exposed)).toEqual({
      error: "Cannot delete role with assigned users",
      code: "BAD_REQUEST",
      numericCode: 1002,
    })
  })

  it("exposes business-rule details only when separately configured", async () => {
    const error = new BusinessRuleError("Business rule failed", {
      roleId: "role-1",
    })
    const response = createFrameworkErrorHandler({
      errorExposure: {
        exposeBusinessRuleMessage: true,
        exposeBusinessRuleDetails: true,
      },
    })(error)

    expect(await responseBody(response)).toEqual({
      error: "Business rule failed",
      code: "BAD_REQUEST",
      numericCode: 1002,
      details: { roleId: "role-1" },
    })
  })

  it("maps driver errors to framework errors before safe HTTP serialization", async () => {
    const driverError = Object.assign(new Error("duplicate key: secret_table"), {
      code: "23505",
      constraint: "secret_constraint",
    })
    const mapDriverError = vi.fn((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        return new ConflictError("A record with this value already exists")
      }
      return undefined
    })

    const response = createFrameworkErrorHandler({ mapDriverError })(driverError)
    expect(response.status).toBe(409)
    const body = await responseBody(response)
    expect(body).toEqual({
      error: "Conflict",
      code: "CONFLICT",
      numericCode: 1202,
    })
    expect(JSON.stringify(body)).not.toContain("secret_constraint")
  })

  it("does not map existing framework errors", async () => {
    const mapDriverError = vi.fn(() => new ConflictError("mapped"))
    const response = createFrameworkErrorHandler({ mapDriverError })(
      new ValidationError("invalid")
    )
    expect(response.status).toBe(400)
    expect(mapDriverError).not.toHaveBeenCalled()
  })

  it("sanitizes ZodError issues and never returns raw issues", async () => {
    const zodError = new ZodError([
      {
        code: "custom",
        path: ["a", 1, "nested"],
        message: "boom",
        secret: "do-not-leak",
        input: { confidential: true },
      } as never,
    ])
    const response = createFrameworkErrorHandler()(zodError)
    expect(response.status).toBe(400)

    const body = await responseBody(response)
    expect(body).toEqual({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      numericCode: 1001,
      details: [{ code: "custom", path: "a.1.nested", message: "boom" }],
    })
    expect(JSON.stringify(body)).not.toContain("do-not-leak")
  })

  it("routes 413/415 and capability responses through metadata decoration", () => {
    const metadata = { requestId: "req-123", correlationId: "corr-456" }
    const cases = [
      createFrameworkErrorHandler()(
        new RequestBodyTooLargeError(1024),
        metadata
      ),
      createFrameworkErrorHandler()(new UnsupportedMediaTypeError(), metadata),
      createFrameworkErrorHandler()(
        new CapabilityError("tenant.module:manage", {
          moduleKey: "tenant.module",
        }),
        metadata
      ),
    ]
    for (const response of cases) {
      expect(response.headers.get("x-request-id")).toBe("req-123")
      expect(response.headers.get("x-correlation-id")).toBe("corr-456")
    }
    expect(cases.map((response) => response.status)).toEqual([413, 415, 403])
  })
})
