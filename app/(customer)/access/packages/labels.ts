import type { BadgeTone } from "@/modules/ui";

// ACCESS-P0-20 — access package labels.
export const RISK_TONE: Record<string, BadgeTone> = { low: "neutral", medium: "info", high: "warning", critical: "danger" };
export const STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", active: "success", retired: "neutral" };
export const APPROVAL: Record<string, string> = { manager_approval: "your manager", owner_approval: "the package owner", manager_and_owner: "your manager and the package owner" };
export const ITEM: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "To be granted", tone: "warning" },
  fulfilled: { label: "Granted", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  revoke_pending: { label: "To be removed", tone: "warning" },
  revoked: { label: "Removed", tone: "neutral" },
};
export const ASSIGNMENT: Record<string, { label: string; tone: BadgeTone }> = {
  provisioning: { label: "Being granted", tone: "info" },
  active: { label: "Active", tone: "success" },
  partially_failed: { label: "Partially failed", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "neutral" },
};
