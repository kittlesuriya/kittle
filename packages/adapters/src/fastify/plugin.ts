import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
  RouteShorthandOptions,
} from "fastify"
import type { FastifyPluginOptions } from "./types"
import { toFetchRequest } from "./request"
import { sendFetchResponse } from "./reply"

/**
 * Wraps a Fetch-based handler (Request → Response) into a Fastify route handler.
 * Converts the incoming Fastify request to a Fetch Request, calls the handler,
 * and sends the Fetch Response back through Fastify's reply.
 *
 * @example
 * ```ts
 * const crud = CRUD(entityDefinition, runtime)
 * fastify.get("/api/items", wrapFetchHandler(crud.list))
 * fastify.post("/api/items", wrapFetchHandler(crud.create))
 * ```
 */
export function wrapFetchHandler(
  handler: (request: Request, context?: { params?: Promise<unknown> }) => Promise<Response>,
  options?: { bodyMaxBytes?: number }
): (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const fetchRequest = await toFetchRequest(request)
    const context = {
      params: Promise.resolve(request.params),
    }
    const response = await handler(fetchRequest, context)
    await sendFetchResponse(reply, response)
  }
}

/**
 * Creates a Fastify plugin that registers utility functions on the Fastify instance
 * for working with kittle's Fetch-based HTTP handlers.
 *
 * The plugin decorates the Fastify instance with:
 * - `wrapFetchHandler` - wraps a Fetch handler into a Fastify handler
 * - `toFetchRequest` - converts a Fastify request to a Fetch Request
 * - `sendFetchResponse` - sends a Fetch Response through Fastify's reply
 *
 * @example
 * ```ts
 * import Fastify from "fastify"
 * import { createKittleFastifyPlugin } from "kittle-adapters/fastify"
 * import { CRUD } from "kittle-adapters/http"
 *
 * const fastify = Fastify()
 * fastify.register(createKittleFastifyPlugin())
 *
 * const crud = CRUD(entityDefinition, runtime)
 * fastify.get("/api/items", fastify.kittle.wrapFetchHandler(crud.list))
 * ```
 */
export const createKittleFastifyPlugin: FastifyPluginAsync<
  FastifyPluginOptions
> = async (fastify: FastifyInstance): Promise<void> => {
  // Decorate the Fastify instance with kittle utilities
  fastify.decorate("kittle", {
    wrapFetchHandler,
    toFetchRequest,
    sendFetchResponse,
  })
}

// Type augmentation for Fastify decorations
declare module "fastify" {
  interface FastifyInstance {
    kittle: {
      wrapFetchHandler: typeof wrapFetchHandler
      toFetchRequest: typeof toFetchRequest
      sendFetchResponse: typeof sendFetchResponse
    }
  }
}

/**
 * Creates route options for a Fastify route that uses a Fetch-based handler.
 * Sets appropriate body limit and content type parsing.
 */
export function createFetchRouteOptions(
  options?: {
    bodyMaxBytes?: number
    contentType?: string
  }
): RouteShorthandOptions {
  return {
    schema: {
      // Disable Fastify's built-in body parsing — we handle it in the Fetch bridge
      body: false,
    },
    // Set body size limit
    ...(options?.bodyMaxBytes
      ? { bodyLimit: options.bodyMaxBytes }
      : {}),
  }
}
