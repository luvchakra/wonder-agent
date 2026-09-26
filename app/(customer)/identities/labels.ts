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

export const LIFECYCLE_STATE_LABEL: Record<string, string> = {
  PRE_JOIN: "Joining",
  ACTIVE: "Active",
  LEAVE_PENDING: "Leaving",
  DISABLED: "Disabled",
  TERMINATED: "Terminated",
  ARCHIVED: "Archived",
};

export const LIFECYCLE_EVENT_LABEL: Record<string, string> = {
  joiner: "Joiner",
  mover: "Mover",
  leaver: "Leaver",
  rehire: "Rehire",
  conversion: "Conversion",
  manager_change: "New manager",
  leaver_cancelled: "Departure cancelled",
  disabled: "Disabled",
  terminated: "Terminated",
  archived: "Archived",
  hire_cancelled: "Hire cancelled",
};

export const LIFECYCLE_TASK_LABEL: Record<string, { title: string; help: string }> = {
  request_baseline_access: { title: "Request baseline access", help: "Ask for the access this person's role needs to start work." },
  review_access: { title: "Review access", help: "Remove access the new role or return no longer justifies." },
  transfer_ownership: { title: "Transfer ownership", help: "Hand everything this person owns, sponsors or manages to someone else." },
  revoke_access: { title: "Revoke access", help: "Remove this person's access in every connected system." },
  disable_sign_in: { title: "Disable sign-in", help: "Suspend their WonderID membership under Administration → Organization." },
};

/** The step each transition takes, as a person would say it. */
export const TRANSITION_LABEL: Record<string, string> = {
  joiner: "Start work (joined)",
  hire_cancelled: "Cancel the hire",
  leaver: "Start leaving",
  disabled: "Disable",
  leaver_cancelled: "Cancel the departure",
  terminated: "Terminate",
  archived: "Archive",
  rehire: "Rehire",
};
