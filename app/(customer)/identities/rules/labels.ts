import type { IdentityRule } from "@/modules/agent-identity/service";

export const TRIGGER_LABEL: Record<string, string> = {
  "identity.created": "Created in WonderID",
  "identity.imported": "Imported from a source",
  "identity.attribute_changed": "An attribute changed",
};

/** One status a person can act on: what runs, and what waits. */
export function ruleStatus(r: Pick<IdentityRule, "status" | "publishRequestedBy" | "unpublishedChanges" | "publishedVersion">): { label: string; tone: "success" | "warning" | "neutral" | "info" } {
  if (r.status === "retired") return { label: "Retired", tone: "neutral" };
  if (r.publishRequestedBy) return { label: "Waiting for approval", tone: "warning" };
  if (r.status === "published")
    return r.unpublishedChanges ? { label: `v${r.publishedVersion} live · changes not published`, tone: "info" } : { label: `v${r.publishedVersion} live`, tone: "success" };
  return { label: "Draft", tone: "neutral" };
}
