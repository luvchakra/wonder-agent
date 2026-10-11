import type { BadgeTone } from "@/modules/ui";
import type { FulfilmentTask } from "@/modules/access-governance/service";

// ACCESS-P0-29/30 — how a fulfilment task reads, shared by Fulfilment Tasks
// and the requests inbox (EXPERIENCE-P0-29).

export const TASK_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: "To do", tone: "warning" },
  claimed: { label: "Claimed", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  completed: { label: "Done · waiting for verification", tone: "neutral" },
  verified: { label: "Verified at the source", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

// ACCESS-P0-30: what each task asks for on the target.
const KIND: Record<string, string> = { grant: "Add", remove: "Remove", create_account: "Create account", disable_account: "Disable account" };

/** "Add Finance in SAP", "Create account in SAP". */
export function taskLabel(t: Pick<FulfilmentTask, "kind" | "entitlementName" | "applicationName">): string {
  const what = t.kind === "create_account" || t.kind === "disable_account" ? KIND[t.kind] : `${KIND[t.kind] ?? "Add"} ${t.entitlementName ?? "access"}`;
  return `${what} in ${t.applicationName ?? "an application"}`;
}

/** The task's account: a placeholder (ACCESS-P0-28) is an account not created yet, never its internal reference. */
export function accountLabel(name: string | null): string {
  if (!name) return "—";
  return name.startsWith("pending:") ? "none yet" : name;
}
