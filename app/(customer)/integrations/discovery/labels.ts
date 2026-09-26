import type { BadgeTone } from "@/modules/ui";

// INTEGRATION-P0-10 — application discovery labels.
export const DISCOVERY_STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  UNRECOGNIZED: { label: "Unrecognized", tone: "warning" },
  MATCHED: { label: "Matched", tone: "success" },
  REGISTERED: { label: "Registered", tone: "success" },
  EXCEPTION: { label: "Exception", tone: "info" },
  IGNORED: { label: "Ignored", tone: "neutral" },
};

export const DISCOVERY_SOURCE_LABEL: Record<string, string> = {
  integration: "Connector",
  openapi: "OpenAPI document",
  scim: "SCIM metadata",
  manual: "Reported by hand",
};

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);
