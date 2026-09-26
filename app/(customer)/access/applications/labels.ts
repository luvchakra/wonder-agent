import type { BadgeTone } from "@/modules/ui";
import type { ApplicationOnboardingStatus, ApplicationType } from "@/lib/shared/types/access-governance";

export const APP_TYPE_LABEL: Record<ApplicationType, string> = {
  saas: "SaaS",
  on_prem: "On-premises",
  custom: "Custom / in-house",
  cloud_platform: "Cloud platform",
  database: "Database",
  directory: "Directory",
  ai_service: "AI service",
  api: "API",
  other: "Other",
};

export const ONBOARDING_LABEL: Record<ApplicationOnboardingStatus, { label: string; tone: BadgeTone }> = {
  DISCOVERED: { label: "Discovered", tone: "info" },
  CONFIGURING: { label: "Configuring", tone: "info" },
  CONNECTED: { label: "Connected", tone: "info" },
  VALIDATING: { label: "Validating", tone: "info" },
  SIMULATION_FAILED: { label: "Simulation failed", tone: "danger" },
  READY_FOR_APPROVAL: { label: "Ready for approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  ACTIVE: { label: "Active", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "warning" },
  RETIRED: { label: "Retired", tone: "neutral" },
};

export const LEVEL_TONE: Record<string, BadgeTone> = { low: "neutral", medium: "info", high: "warning", critical: "danger" };

// ACCESS-P0-16 — onboarding (client-safe copies of onboardingRules' lists).
export const ONBOARDING_STAGE_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  CONFIGURING: { label: "Configuring", tone: "info" },
  VALIDATING: { label: "Validated", tone: "info" },
  SIMULATING: { label: "Simulating", tone: "info" },
  WAITING_FOR_APPROVAL: { label: "Waiting for approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  PROMOTED: { label: "Promoted", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  REJECTED: { label: "Rejected", tone: "danger" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

export const ONBOARDING_MODES = [
  { value: "quick_start", label: "Quick start", description: "Connect, pick a template, map the essentials." },
  { value: "assisted", label: "Assisted", description: "Guided steps with the full checklist." },
  { value: "advanced", label: "Advanced", description: "Every field and operation, for complex applications." },
] as const;

export const ONBOARDING_OPERATION_LABEL = {
  createAccount: "Create account",
  updateAccount: "Update account",
  disableAccount: "Disable account",
  deleteAccount: "Delete account",
  grantAccess: "Grant entitlement",
  revokeAccess: "Revoke entitlement",
} as const;

export const REQUEST_POLICY_LABEL = {
  not_requestable: "Not requestable",
  manager_approval: "Manager approves",
  owner_approval: "Application owner approves",
  manager_and_owner: "Manager, then owner",
} as const;

export const CERTIFICATION_POLICY_LABEL = { none: "Not certified", quarterly: "Quarterly", semiannual: "Every six months", annual: "Annually" } as const;

export const CORRELATION_IDENTITY_LABEL = { email: "Email", username: "Username", displayName: "Display name" } as const;
