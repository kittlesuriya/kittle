import type { PredicateNode } from "../domain"

export type TenantScopingChoice =
  | { mode: "scoped" }
  | { mode: "none"; acknowledged: true; scopeFilter?: PredicateNode }
