import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common"
import { toNestFetchRequest } from "./request"
import { sendNestFetchResponse } from "./response"
import type {
  NestCrudControllerOptions,
  NestRequestLike,
  NestResponseLike,
} from "./types"

async function invokeStandard(
  handler: NestCrudControllerOptions["handlers"]["list"],
  request: NestRequestLike,
  response: NestResponseLike
): Promise<void> {
  await sendNestFetchResponse(
    await handler(toNestFetchRequest(request), {
      params: Promise.resolve(request.params ?? {}),
    }),
    response
  )
}

async function invokeDetail(
  handler: NestCrudControllerOptions["handlers"]["detail"],
  request: NestRequestLike,
  response: NestResponseLike
): Promise<void> {
  await sendNestFetchResponse(
    await handler(toNestFetchRequest(request), request.params ?? {}),
    response
  )
}

/** Create a Nest controller backed by existing Fetch CRUD handlers. */
export function createNestCrudController(options: NestCrudControllerOptions) {
  const prefix = options.prefix ?? ""

  @Controller(prefix)
  class GeneratedCrudController {
    @Get()
    async list(
      @Req() request: NestRequestLike,
      @Res() response: NestResponseLike
    ): Promise<void> {
      await invokeStandard(options.handlers.list, request, response)
    }

    @Get(":id")
    async detail(
      @Req() request: NestRequestLike,
      @Res() response: NestResponseLike
    ): Promise<void> {
      await invokeDetail(options.handlers.detail, request, response)
    }

    @Post()
    async create(
      @Req() request: NestRequestLike,
      @Res() response: NestResponseLike
    ): Promise<void> {
      await invokeStandard(options.handlers.create, request, response)
    }

    @Put(":id")
    async replace(
      @Req() request: NestRequestLike,
      @Res() response: NestResponseLike
    ): Promise<void> {
      await invokeStandard(options.handlers.update, request, response)
    }

    @Patch(":id")
    async update(
      @Req() request: NestRequestLike,
      @Res() response: NestResponseLike
    ): Promise<void> {
      await invokeStandard(options.handlers.update, request, response)
    }

    @Delete(":id")
    async delete(
      @Req() request: NestRequestLike,
      @Res() response: NestResponseLike
    ): Promise<void> {
      await invokeStandard(options.handlers.delete, request, response)
    }
  }

  return GeneratedCrudController
}
