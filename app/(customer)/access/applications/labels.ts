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
