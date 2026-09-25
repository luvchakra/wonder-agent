import type { BadgeTone } from "@/modules/ui";
import type { IdentityRelationshipType, IdentityStatus, IdentityType } from "@/lib/shared/types/agent-identity";

/** Plain-language names for the identity model's enums (shared by the directory's pages and forms). */
export const IDENTITY_TYPE_LABEL: Record<IdentityType, string> = {
  HUMAN: "Person",
  EXTERNAL: "External person",
  MACHINE: "Machine",
  SERVICE_ACCOUNT: "Service account",
  APPLICATION: "Application account",
  WORKLOAD: "Workload",
  API: "API client",
  AI_AGENT: "AI agent",
};

export const STATUS_LABEL: Record<IdentityStatus, string> = {
  pending: "Pending",
  active: "Active",
  inactive: "Inactive",
  disabled: "Disabled",
  terminated: "Terminated",
  archived: "Archived",
};

export const STATUS_TONE: Record<IdentityStatus, BadgeTone> = {
  pending: "info",
  active: "success",
  inactive: "neutral",
  disabled: "warning",
  terminated: "danger",
  archived: "neutral",
};

/** Read as "<source> <label> <target>". */
export const RELATIONSHIP_LABEL: Record<IdentityRelationshipType, string> = {
  manager_of: "manages",
  owns: "owns",
  sponsors: "sponsors",
  delegates_to: "delegates to",
  service_account_for: "is a service account for",
  workload_runs_for: "runs workloads for",
  member_of: "is a member of",
};

/** The directory's views: a path segment each, and the types it lists. */
export const DIRECTORY_VIEWS = {
  all: { title: "All identities", types: [] as IdentityType[], description: "Every identity in this organization, of every type." },
  humans: { title: "People", types: ["HUMAN"] as IdentityType[], description: "Employees and members of this organization." },
  external: {
    title: "External identities",
    types: ["EXTERNAL"] as IdentityType[],
    description: "Contractors, partners and vendors. Each has a sponsor and an end date.",
  },
  machines: {
    title: "Machine identities",
    types: ["SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API", "MACHINE"] as IdentityType[],
    description: "Service accounts, application accounts, workloads, API clients and machines. Each has an accountable owner.",
  },
} as const;
export type DirectoryView = keyof typeof DIRECTORY_VIEWS;
