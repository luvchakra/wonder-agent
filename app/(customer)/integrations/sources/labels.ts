import type { BadgeTone } from "@/modules/ui";
import type { IdentitySourceTarget, ReconciliationRunStatus } from "@/lib/shared/types/integrations";

export const TEMPLATE_LABEL = { csv: "CSV file", scim: "SCIM", rest: "REST API", hr_api: "HR system API", integration: "Existing integration" } as const;

export const TARGET_LABEL: Record<IdentitySourceTarget, string> = {
  externalId: "Source's unique id",
  managerExternalId: "Manager's source id",
  displayName: "Display name",
  email: "Email",
  username: "Username",
  subtype: "Subtype",
  department: "Department",
  title: "Job title",
  businessUnit: "Business unit",
  location: "Location",
  employmentType: "Employment type",
  organization: "Organization",
  startDate: "Start date",
  endDate: "End date",
  status: "Status",
};

export const RUN_STATUS: Record<ReconciliationRunStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Succeeded", tone: "success" },
  partial: { label: "Needs review", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
};

export const LEAVER_LABEL = {
  disable: "Mark as leaver (inactive, leave pending)",
  flag: "Report only",
  none: "Ignore (partial feed)",
} as const;
