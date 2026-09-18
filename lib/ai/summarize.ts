import "server-only";

import type { AiSummaryKind, AiSummaryRequest, AiSummaryResult } from "@/lib/shared/types/ai";
import { resolveAiProviderKey } from "@/modules/platform-admin/service";
import { callAiProvider } from "./provider";

/**
 * FOUNDATION-P0-16 — the shared, read-only, advisory-only LLM summarization
 * primitive every module's investigation UI calls through, matching how
 * `lib/audit/writeAudit()` is the one sanctioned way to write an audit row.
 *
 * Hard boundaries enforced by this file's own shape, not just documented:
 * - This module has no Supabase client import anywhere in it and never will
 *   — it cannot query a database itself. Every fact it summarizes must
 *   already be computed and passed in by the calling module via `data`.
 *   The one exception is `resolveAiProviderKey()` — a published contract
 *   call into Platform Agent's own module (same "a shared primitive calls
 *   another module's already-published service function" pattern used
 *   elsewhere in this build, e.g. Compliance calling Operations' export
 *   primitive), not a direct database query of its own.
 * - It has no write path to anything — its only export returns a string.
 * - Its output is typed `AiSummaryResult.summary: string` (prose), never a
 *   structured value — nothing in this codebase may read a summarization
 *   result back into a deterministic decision (authorization, risk score,
 *   policy evaluation, remediation), per non-negotiable #9.
 *
 * Providers: OpenAI, resolved 2026-09-16 via AskUserQuestion, plus Gemini
 * (added the same day per a follow-up user request) — see PLATFORM-P0-05.2
 * / modules/platform-admin/aiProviderConfig.ts. A tenant may bring its own
 * key for whichever provider it configured (BYOK) or fall back to that
 * same provider's platform-wide default key; `resolveAiProviderKey()`
 * picks whichever applies and which provider. When neither is configured,
 * every call deterministically throws `AiNotConfiguredError`, and callers
 * are expected to render that as "Connect an AI provider" — never a
 * crash, never a silently-empty summary.
 */
export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "No AI provider is configured for this workspace. Bring your own key in " +
        "Settings → AI, or ask your platform administrator to set a default (there's " +
        "no Platform Admin page for this yet — set PLATFORM_OPENAI_API_KEY or " +
        "PLATFORM_GEMINI_API_KEY as a deployment environment variable).",
    );
    this.name = "AiNotConfiguredError";
  }
}

const KIND_INSTRUCTIONS: Record<AiSummaryKind, string> = {
  finding: "Summarize this risk finding for a security administrator: what happened, why it matters, and what evidence supports it. Do not recommend a specific remediation action — only describe the evidence.",
  evidence_bundle: "Summarize this evidence bundle in plain language for an auditor reviewing it, highlighting what it does and does not demonstrate.",
  should_can_did_comparison: "Summarize this SHOULD vs CAN vs DID comparison for a reviewer: what the agent is approved to do, what it can technically do, and what it actually did, and where they diverge.",
  certification_item: "Summarize this access certification item for a reviewer deciding whether to keep, review, or remove the access, describing the risk and usage evidence without stating a recommendation.",
};

const SYSTEM_PROMPT =
  "You are an assistant that summarizes already-computed enterprise AI-governance data for a human reviewer. " +
  "You only describe and explain the data you are given — you never invent facts not present in it, and you never " +
  "state or imply an authorization, risk-scoring, policy, or remediation decision; those are made deterministically " +
  "elsewhere in the system, never by you. Keep the summary to a few sentences of plain prose.";

function buildUserPrompt(request: AiSummaryRequest): string {
  return `${KIND_INSTRUCTIONS[request.kind]}\n\nData:\n${JSON.stringify(request.data, null, 2)}`;
}

/**
 * Summarizes already-computed evidence for the Experience Agent's
 * AI-Assisted Investigation UI (EXPERIENCE-P0-14). `tenantId` is the
 * server-resolved tenant context (never client-supplied — CLAUDE.md §14),
 * used only to look up which provider/key to call. Throws
 * `AiNotConfiguredError` when no key is configured — never returns a fake
 * or empty summary, and never partially succeeds.
 */
export async function summarize(tenantId: string, request: AiSummaryRequest): Promise<AiSummaryResult> {
  const resolved = await resolveAiProviderKey(tenantId);
  if (!resolved) {
    throw new AiNotConfiguredError();
  }

  const content = await callAiProvider(resolved, { system: SYSTEM_PROMPT, user: buildUserPrompt(request) });

  return {
    kind: request.kind,
    summary: content,
    provider: resolved.provider,
    generatedAt: new Date().toISOString(),
  };
}

export type { AiSummaryKind, AiSummaryRequest, AiSummaryResult };
