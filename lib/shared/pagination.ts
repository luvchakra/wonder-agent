/**
 * QA-P0-04.3 (2026-09-16 follow-up) — a shared default cap for `list*()`
 * functions that don't yet have full server-side cursor/offset pagination
 * wired through their API routes and UI. Applying this as a DB-level
 * `.limit()` means the query itself can never return an unbounded
 * full-table scan (CLAUDE.md §15's "never fetch an entire table's rows to
 * the client"), matching the precedent already established by
 * `modules/runtime-assurance/quarantine.ts` and
 * `modules/operations/notifications.ts` before this pass. Real
 * caller-exposed pagination (limit/offset or keyset) for the highest-
 * traffic views is a separate, larger UI-wiring follow-up — this constant
 * only guarantees the query itself is bounded in the meantime.
 */
export const DEFAULT_LIST_LIMIT = 200;
