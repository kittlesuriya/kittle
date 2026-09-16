import type { FastifyReply } from "fastify"

/**
 * Sends a standard Fetch API Response through a Fastify reply.
 * Bridges the Fetch response model back to Fastify's reply model.
 */
export async function sendFetchResponse(
  reply: FastifyReply,
  response: Response
): Promise<void> {
  // Set the status code
  reply.code(response.status)

  // Set all headers from the Fetch response
  response.headers.forEach((value, key) => {
    reply.header(key, value)
  })

  // Read the response body as a buffer and send it
  const body = await response.arrayBuffer()
  reply.send(Buffer.from(body))
}
