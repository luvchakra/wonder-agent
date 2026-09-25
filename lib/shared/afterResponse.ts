import "server-only";

import { after } from "next/server";

/**
 * Runs `task` after the response has been sent (Next.js `after()`, the
 * pattern CLAUDE.md §15 names for work that must not block the request).
 * Used for bookkeeping on the Runtime Gateway's hot path: key last-used
 * stamps and audit rows.
 *
 * Outside a request scope (unit tests, scripts) `after()` throws, so the
 * task simply runs in the background instead. Either way a failure is
 * logged, never thrown into the caller.
 */
export function runAfterResponse(task: () => Promise<unknown>): void {
  const safe = () =>
    task().catch((err) => {
      console.error("background task failed", err);
    });
  try {
    after(safe);
  } catch {
    void safe();
  }
}
