import type { Identity } from "@/lib/shared/types/agent-identity";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * IDENTITY-P0-23 — merging two records of the same person. Pure (#9): which
 * attributes a person may choose between, where the two records differ, and
 * the checks made before the database merges them (migration 0198, which
 * checks again).
 */

/** Kept in step with identity_merge_fields() in migration 0198. */
export const MERGE_FIELDS = [
  { column: "display_name", key: "displayName", label: "Name" },
  { column: "email", key: "email", label: "Email" },
  { column: "username", key: "username", label: "Username" },
  { column: "title", key: "title", label: "Job title" },
  { column: "department", key: "department", label: "Department" },
  { column: "business_unit", key: "businessUnit", label: "Business unit" },
  { column: "location", key: "location", label: "Location" },
  { column: "employment_type", key: "employmentType", label: "Employment type" },
  { column: "organization", key: "organization", label: "Organization" },
  { column: "manager_identity_id", key: "managerIdentityId", label: "Manager" },
  { column: "start_date", key: "startDate", label: "Start date" },
  { column: "end_date", key: "endDate", label: "End date" },
] as const satisfies readonly { column: string; key: keyof Identity; label: string }[];

export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeColumn = MergeField["column"];

const COLUMNS = new Set<string>(MERGE_FIELDS.map((f) => f.column));

type Comparable = Pick<Identity, "id" | "identityType" | "status" | "userId" | "mergedIntoIdentityId" | MergeField["key"]>;

/** The attributes on which the two records differ: only these need a choice. */
export function mergeDifferences(survivor: Comparable, merged: Comparable): MergeField[] {
  return MERGE_FIELDS.filter((f) => (survivor[f.key] ?? null) !== (merged[f.key] ?? null));
}

/**
 * The columns taken from the merged record. A blank on the survivor takes
 * the merged value without asking; a blank on the merged record never wins.
 */
export function chosenColumns(survivor: Comparable, merged: Comparable, takeFromMerged: readonly string[]): MergeColumn[] {
  const take = new Set(takeFromMerged);
  for (const c of take) if (!COLUMNS.has(c)) throw new ApiError(400, "VALIDATION_FAILED", "An attribute that cannot be merged was chosen.");
  return mergeDifferences(survivor, merged)
    .filter((f) => (merged[f.key] ?? null) !== null && (take.has(f.column) || (survivor[f.key] ?? null) === null))
    .map((f) => f.column);
}

/** Why these two records cannot be merged, or null. The database checks the rest. */
export function mergeRefusal(survivor: Comparable, merged: Comparable): string | null {
  if (survivor.id === merged.id) return "Choose two different records.";
  if (survivor.identityType !== merged.identityType || !["HUMAN", "EXTERNAL"].includes(survivor.identityType)) {
    return "Only two records of the same kind of person can be merged.";
  }
  if (survivor.mergedIntoIdentityId || merged.mergedIntoIdentityId) return "One of the records has already been merged.";
  if (survivor.userId && merged.userId) return "Both records sign in to WonderID. Remove one person's access first.";
  return null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Why `other` looks like the same person as `identity`, or null. */
export function duplicateReason(identity: Pick<Identity, "id" | "displayName" | "email">, other: Pick<Identity, "id" | "displayName" | "email">): "email" | "name" | null {
  if (identity.id === other.id) return null;
  if (norm(identity.email) && norm(identity.email) === norm(other.email)) return "email";
  if (norm(identity.displayName) && norm(identity.displayName) === norm(other.displayName)) return "name";
  return null;
}
