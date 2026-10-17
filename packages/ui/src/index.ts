export * from "./core/runtime/index"
export * from "./core/form/index"
export * from "./core/query/index"
export * from "./core/menu/index"
export * from "./core/table/index"

// Cross-area name collision: "ValidationResult" exists in both core/form
// (field validation outcome) and core/table (operation-config validation).
// The root barrel exposes the form one; import the operation one directly
// from "kittle-ui/core/table/validateOperation".
export type { ValidationResult } from "./core/form/index"
