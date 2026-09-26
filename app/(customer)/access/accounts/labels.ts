import type { BadgeTone } from "@/modules/ui";
export { IDENTITY_TYPE_LABEL } from "../../identities/labels";

// ACCESS-P0-17 — account inventory labels.
export const CORRELATION_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  correlated: { label: "Matched", tone: "success" },
  manual: { label: "Linked by hand", tone: "info" },
  orphan: { label: "Orphan", tone: "danger" },
  ambiguous: { label: "Ambiguous", tone: "warning" },
};

export const ACCOUNT_TYPE_LABEL: Record<string, string> = { standard: "Standard", privileged: "Privileged", service: "Service", shared: "Shared" };

export const VIEW_LABEL: Record<string, string> = {
  all: "All accounts",
  orphan: "Orphan",
  ambiguous: "Ambiguous",
  dormant: "Dormant",
  privileged: "Privileged",
  missing: "Missing from source",
};

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);
