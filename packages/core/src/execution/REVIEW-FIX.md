---
phase: P1-15
fixed_at: 2026-08-17T00:00:00Z
review_path: packages/framework-core/src/execution/REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase P1-15: Code Review Fix Report

**Fixed at:** 2026-08-17T00:00:00Z
**Source review:** packages/framework-core/src/execution/REVIEW.md
**Iteration:** 1

**Summary:**

- Findings in scope: 1
- Fixed: 1
- Skipped: 0

## Fixed Issues

### P1-15: External job side-effect fencing remains cooperative

**Files modified:** `packages/framework-core/src/execution/types.ts`, `packages/framework-core/src/execution/executionContext.ts`
**Commit:** d9689f5
**Applied fix:** Added `FencedExternalEffect` interface to `types.ts` with an `execute<T>` method that requires `effectName`, optional `idempotencyKey`, and the effect `fn`. Added `fencedEffect?: FencedExternalEffect` property to `JobExecutionContext`. Implemented the concrete `fencedEffect` in `executionContext.ts`'s `createExecutionContext` function, which calls `assertLease()` (if present) before executing the effect. This makes the lease-validation-before-side-effect path framework-enforced rather than relying on job code to call `assertLease` manually.

## Skipped Issues

None — all findings were skipped.

---

_Fixed: 2026-08-17T00:00:00Z_
_Fixer: OpenCode (gsd-code-fixer)_
_Iteration: 1_
