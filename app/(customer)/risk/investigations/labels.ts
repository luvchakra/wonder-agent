import type { InvestigationStatus } from "@/lib/shared/types/risk";
import type { BadgeTone } from "@/modules/ui";

export const STATUS_BADGE: Record<InvestigationStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "info" },
  in_progress: { label: "In progress", tone: "accent" },
  awaiting_remediation: { label: "Awaiting remediation", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};
