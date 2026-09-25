import type { BadgeTone } from "@/modules/ui";

/**
 * What a runtime event's result means, in words (RUNTIME-P0-16).
 *
 * An observed action either succeeded or failed; that is all `success`
 * records. It is never "blocked": nothing is enforced while the gateway
 * is observe-only (CLAUDE.md §17.5). A gateway decision event carries the
 * decision itself, marked "observed" when it was not enforced.
 */
const DECISION: Record<string, { label: string; tone: BadgeTone }> = {
  ALLOW: { label: "Allow", tone: "success" },
  ALLOW_WITH_RESTRICTIONS: { label: "Allow, restricted", tone: "info" },
  REQUIRE_APPROVAL: { label: "Needs approval", tone: "warning" },
  DENY: { label: "Deny", tone: "danger" },
};

export function eventResult(event: { source: string; success: boolean; raw: Record<string, unknown> }): {
  label: string;
  tone: BadgeTone;
  isDecision: boolean;
} {
  if (event.source === "gateway" && typeof event.raw.decision === "string" && DECISION[event.raw.decision]) {
    const d = DECISION[event.raw.decision];
    return { label: event.raw.enforced ? d.label : `${d.label} (observed)`, tone: d.tone, isDecision: true };
  }
  return event.success ? { label: "Succeeded", tone: "success", isDecision: false } : { label: "Failed", tone: "danger", isDecision: false };
}

export function humanizeEventType(type: string): string {
  const s = type.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
