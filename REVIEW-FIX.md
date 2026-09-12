---
phase: p1
fixed_at: 2026-08-17T00:00:00Z
review_path: REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase P1: Code Review Fix Report

**Fixed at:** 2026-08-17
**Source review:** REVIEW.md
**Iteration:** 1

**Summary:**

- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### P1-06: Remove writableMutationHooks escape hatch

**Files modified:**

- `packages/framework-core/src/entity/defineEntity.ts`
- `packages/framework-adapters/src/http/crudHandlers/shared.ts`
- `packages/framework-adapters/src/http/crudHandlers/create.ts`
- `packages/framework-adapters/src/http/crudHandlers/update.ts`
- `packages/framework-adapters/src/http/crudHandlers/delete.ts`
- `packages/framework-adapters/src/http/crudHandlers/__tests__/mutationHookReadOnly.test.ts`
- `apps/clinic/src/__tests__/framework-adapters/crud.integration.test.ts`
- 22 module config files in `apps/clinic/src/server/modules/` and `apps/clinic-postgres/src/server/modules/`

**Commit:** 94fba2c

**Applied fix:**

- Removed `writableMutationHooks` boolean property from `EntityCrudHooksConfig` interface
- Removed `writableHooks` parameter from `toCrudContext()` — hooks now always receive read-only persistence
- Removed all `crudHooks: { writableMutationHooks: true }` entries from 22 module config files
- Updated CRUD handlers (create/update/delete) to not pass the removed flag
- Updated test files to reflect read-only-only hook behavior
- Added documentation comments explaining the security rationale

### P1-07: Guard transaction retries against non-idempotent side effects

**Files modified:**

- `packages/framework-core/src/operation/standardOperationPipeline.ts`

**Commit:** cea888f

**Applied fix:**

- Added `hadSideEffects` tracking variable to detect when transactional effects or outbox records were registered during a failed attempt
- Added guard that prevents retry when side effects are detected (these may have partially executed external side effects that cannot be retracted)
- Added detailed comment block documenting the risk, current mitigation, and future improvement needed (operation-level `retrySafe` flag)

### P1-16: Warn when required post-commit effects lack durable path

**Files modified:**

- `packages/framework-core/src/operation/standardOperationPipeline.ts`
- `packages/framework-core/src/operation/atomicBatchOperationPipeline.ts`

**Commit:** 913412a

**Applied fix:**

- Added validation in `finish()` function (standard pipeline) that detects required post-commit effects running without an outbox sink factory
- Added identical validation in atomic batch pipeline for consistency
- Emits structured `[P1-16]` warning when required post-commit effects have no durable path
- Warning includes operation key, effect count, and effect names for debugging

## Skipped Issues

None — all findings were successfully fixed.

---

_Fixed: 2026-08-17_
_Fixer: OpenCode (gsd-code-fixer)_
_Iteration: 1_
