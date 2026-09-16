/**
 * Shared contracts for FOUNDATION-P0-16's `lib/ai/` primitive. Other
 * modules import these instead of redefining the summarization request/
 * result shape. See lib/ai/summarize.ts for the full boundary contract.
 */

/**
 * What kind of already-computed evidence is being summarized. Closed set,
 * not a free-text string — every summarizable shape must be deliberately
 * added here (and given a prompt template in lib/ai/summarize.ts) rather
 * than callers passing arbitrary unstructured data.
 */
export type AiSummaryKind = "finding" | "evidence_bundle" | "should_can_did_comparison" | "certification_item";

export type AiSummaryRequest = {
  kind: AiSummaryKind;
  /** Already-computed data the calling module owns — never fetched by this primitive itself. */
  data: Record<string, unknown>;
};

export type AiSummaryResult = {
  kind: AiSummaryKind;
  /** Always advisory prose — never a structured value a deterministic decision reads back (non-negotiable #9). */
  summary: string;
  /** Which provider produced this (e.g. "anthropic"); useful for the UI's disclosure text. */
  provider: string;
  generatedAt: string;
};
