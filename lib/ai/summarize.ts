import "server-only";

import type { AiSummaryKind, AiSummaryRequest, AiSummaryResult } from "@/lib/shared/types/ai";

/**
 * FOUNDATION-P0-16 — the shared, read-only, advisory-only LLM summarization
 * primitive every module's investigation UI calls through, matching how
 * `lib/audit/writeAudit()` is the one sanctioned way to write an audit row.
 *
 * Hard boundaries enforced by this file's own shape, not just documented:
 * - This module has no Supabase client import anywhere in it and never will
 *   — it cannot query a database itself. Every fact it summarizes must
 *   already be computed and passed in by the calling module via `data`.
 * - It has no write path to anything — its only export returns a string.
 * - Its output is typed `AiSummaryResult.summary: string` (prose), never a
 *   structured value — nothing in this codebase may read a summarization
 *   result back into a deterministic decision (authorization, risk score,
 *   policy evaluation, remediation), per non-negotiable #9.
 *
 * Provider wiring is deliberately NOT implemented yet. Per the story's own
 * resolution (docs/plan/01-FOUNDATION-AGENT-BACKLOG.md, FOUNDATION-P0-16):
 * "Needs an explicit provider/credential decision... before the first real
 * call; stub/interface can be built without one." Which LLM API, and where
 * its credential is stored/scoped (a new table? platform-wide or
 * per-tenant? via encryptSecret()?) is the same open question
 * PLATFORM-P0-05.2 (AI Provider Configuration) was already deferred on —
 * inventing a schema/table here to answer it unilaterally would be exactly
 * the kind of new shared-foundation-location decision
 * docs/design/ownership-map.md §5 reserves to the user. Until that lands,
 * every call deterministically throws `AiNotConfiguredError`, and callers
 * are expected to render that as "Connect an AI provider" — never a crash,
 * never a silently-empty summary.
 */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("No AI provider is configured for this deployment.");
    this.name = "AiNotConfiguredError";
  }
}

function isConfigured(): boolean {
  // No provider/credential decision has been made yet (see the file-level
  // comment above) — always false until that lands. A single explicit
  // function rather than an inline check so the "not configured" path has
  // exactly one place to change once a provider is chosen.
  return false;
}

/**
 * Summarizes already-computed evidence for the Experience Agent's
 * AI-Assisted Investigation UI (EXPERIENCE-P0-14). Throws
 * `AiNotConfiguredError` until a provider is wired — never returns a fake
 * or empty summary, and never partially succeeds.
 */
export async function summarize(request: AiSummaryRequest): Promise<AiSummaryResult> {
  void request; // used once a provider is wired; see the file-level comment
  if (!isConfigured()) {
    throw new AiNotConfiguredError();
  }
  // Provider call goes here once one is configured — intentionally left
  // unimplemented rather than guessed at. See the file-level comment.
  throw new AiNotConfiguredError();
}

export type { AiSummaryKind, AiSummaryRequest, AiSummaryResult };
