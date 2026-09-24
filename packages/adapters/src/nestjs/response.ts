import type { NestResponseLike } from "./types"

/** Send a Fetch response through a Nest Express or Fastify response object. */
export async function sendNestFetchResponse(
  response: Response,
  reply: NestResponseLike
): Promise<void> {
  if (reply.status) reply.status(response.status)
  else reply.code?.(response.status)

  response.headers.forEach((value, name) => {
    if (reply.setHeader) reply.setHeader(name, value)
    else if (reply.header) reply.header(name, value)
    else reply.set?.(name, value)
  })

  reply.send(Buffer.from(await response.arrayBuffer()))
}
