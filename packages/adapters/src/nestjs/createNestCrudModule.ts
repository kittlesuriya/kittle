import type { DynamicModule } from "@nestjs/common"
import { createNestCrudController } from "./createNestCrudController"
import type { NestCrudModuleOptions } from "./types"

/** Create a dynamic Nest module containing a generated CRUD controller. */
export function createNestCrudModule(
  options: NestCrudModuleOptions
): DynamicModule {
  const controller = createNestCrudController(options)
  const moduleName = options.moduleName ?? "GeneratedCrudModule"
  const moduleClass = { [moduleName]: class {} }[moduleName]!

  return { module: moduleClass, controllers: [controller] }
}
