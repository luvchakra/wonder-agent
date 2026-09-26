import type { BadgeTone } from "@/modules/ui";

// ACCESS-P0-18 — request catalog labels.
export const RISK_TONE: Record<string, BadgeTone> = { low: "neutral", medium: "info", high: "warning", critical: "danger" };
export const APPROVAL_LABEL: Record<string, string> = {
  manager_approval: "your manager",
  owner_approval: "the owner",
  manager_and_owner: "your manager and the owner",
};
/**
 * What a request will meet, as computed by the server's rules
 * (requestRules.approvalOutcome); critical risk adds an access-manager
 * review (ACCESS-P0-19). The exact chain is shown on the request itself.
 */
export function approvalPreview(approval: string | null, risk?: string): string {
  if (!approval) return "Not requestable";
  if (approval === "automatic") return "Approved automatically";
  return `Needs approval from ${APPROVAL_LABEL[approval] ?? "an approver"}${risk === "critical" ? ", then an access manager" : ""}`;
}
