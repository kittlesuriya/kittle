import type { FastifyInstance } from "fastify"

/**
 * Configuration options for the Kittle Fastify adapter plugin.
 */
export interface FastifyPluginOptions {
  /**
   * The Fastify instance to register routes on.
   */
  fastify: FastifyInstance

  /**
   * Optional prefix for all registered routes (e.g., "/api/v1").
   */
  routePrefix?: string

  /**
   * Maximum body size in bytes for JSON request parsing.
   * Defaults to 1 MB.
   */
  bodyMaxBytes?: number
}
