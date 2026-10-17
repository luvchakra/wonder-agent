import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { Identity } from "@/lib/shared/types/agent-identity";
import { getIdentity, toIdentity } from "./directory";
import { chosenColumns, duplicateReason, mergeRefusal } from "./identityMerge";

/**
 * IDENTITY-P0-23 — merging two records of the same person (D-6). A person
 * with identity.manage compares the two side by side, chooses the surviving
 * value of each attribute that differs, and confirms. `merge_identities()`
 * (migration 0198) moves current access and references to the survivor in
 * one transaction and keeps every moved row, so `unmerge_identities()` can
 * put them back. Nothing merges by itself (#15).
 *
 * Reads run as the user under RLS and filter on the session's tenant; the
 * two functions run only as the service role and take the tenant
 * explicitly, finding nothing outside it (§14).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export type DuplicateCandidate = { identity: Identity; reason: "email" | "name" };

/** Other records of the same kind of person with the same email or name (at most five). */
export async function findDuplicatesOf(tenantId: string, identity: Identity): Promise<DuplicateCandidate[]> {
  if (!["HUMAN", "EXTERNAL"].includes(identity.identityType) || identity.mergedIntoIdentityId) return [];
  const supabase = await supabaseServer();
  const base = () =>
    supabase.from("identities").select().eq("tenant_id", tenantId).eq("identity_type", identity.identityType).neq("id", identity.id).is("merged_into_identity_id", null).limit(5);
  const [byEmail, byName] = await Promise.all([
    identity.email?.trim() ? base().ilike("email", escapeLike(identity.email.trim())) : Promise.resolve({ data: [], error: null }),
    identity.displayName.trim() ? base().ilike("display_name", escapeLike(identity.displayName.trim())) : Promise.resolve({ data: [], error: null }),
  ]);
  if (byEmail.error || byName.error) throw new ApiError(500, "QUERY_FAILED", (byEmail.error ?? byName.error)!.message);
  const out = new Map<string, DuplicateCandidate>();
  for (const row of [...(byEmail.data ?? []), ...(byName.data ?? [])]) {
    const other = toIdentity(row);
    const reason = duplicateReason(identity, other);
    if (reason && !out.has(other.id)) out.set(other.id, { identity: other, reason });
  }
  return [...out.values()].slice(0, 5);
}

export type MergePreview = {
  survivor: Identity;
  merged: Identity;
  refusal: string | null;
  /** What moves to the survivor, as counts. */
  moves: { accounts: number; packages: number; pendingRequests: number; openFindings: number; reports: number; sourceRecords: number };
};

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return n ?? 0;
}

/** The two records and what a merge would move. Null if either is not in this tenant. */
export async function getMergePreview(tenantId: string, survivorId: string, mergedId: string): Promise<MergePreview | null> {
  if (!UUID_RE.test(survivorId) || !UUID_RE.test(mergedId)) return null;
  const [survivor, merged] = await Promise.all([getIdentity(tenantId, survivorId), getIdentity(tenantId, mergedId)]);
  if (!survivor || !merged) return null;
  const supabase = await supabaseServer();
  const head = (table: string) => supabase.from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [accounts, packages, pendingRequests, openFindings, reports, sourceRecords] = await Promise.all([
    count(head("accounts").eq("identity_id", mergedId)),
    count(head("access_package_assignments").eq("identity_id", mergedId).in("status", ["provisioning", "active", "partially_failed"])),
    count(head("access_requests").eq("subject_identity_id", mergedId).eq("status", "pending")),
    count(head("risk_findings").eq("identity_id", mergedId).not("status", "in", "(resolved,false_positive)")),
    count(head("identities").eq("manager_identity_id", mergedId).neq("id", survivorId)),
    count(head("identity_source_links").eq("identity_id", mergedId)),
  ]);
  return { survivor, merged, refusal: mergeRefusal(survivor, merged), moves: { accounts, packages, pendingRequests, openFindings, reports, sourceRecords } };
}

function mergeError(err: { code?: string; message: string }): ApiError {
  if (err.code === "P0002") return new ApiError(404, "NOT_FOUND", err.message);
  if (err.code === "22023" || err.code === "23505") return new ApiError(409, "MERGE_REFUSED", err.message);
  return new ApiError(500, "MERGE_FAILED", "The merge could not be completed. Nothing was changed.");
}

/**
 * Merges `mergedId` into `survivorId`. `takeFromMerged` lists the attribute
 * columns whose value comes from the merged record. Returns the merge id.
 */
export async function mergeIdentities(
  tenantId: string,
  actorId: string,
  input: { survivorId: string; mergedId: string; takeFromMerged: string[]; reason?: string | null },
): Promise<string> {
  const preview = await getMergePreview(tenantId, input.survivorId, input.mergedId);
  if (!preview) throw new ApiError(404, "NOT_FOUND", "One of the records was not found in this organization.");
  if (preview.refusal) throw new ApiError(409, "MERGE_REFUSED", preview.refusal);
  const fields = chosenColumns(preview.survivor, preview.merged, input.takeFromMerged);
  const reason = input.reason?.trim().slice(0, 500) || null;
  const { data, error } = await supabaseServiceRole().rpc("merge_identities", {
    p_tenant: tenantId,
    p_survivor: preview.survivor.id,
    p_merged: preview.merged.id,
    p_fields: fields,
    p_actor: actorId,
    p_reason: reason,
  });
  if (error) {
    await writeAudit({ tenantId, actorId, actorType: "user", action: "identity.merged", objectType: "identity", objectId: preview.survivor.id, outcome: "failure", metadata: { mergedIdentityId: preview.merged.id, error: error.code ?? "error" } });
    throw mergeError(error);
  }
  const mergeId = data as string;
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.merged",
    objectType: "identity",
    objectId: preview.survivor.id,
    outcome: "success",
    metadata: { mergeId, mergedIdentityId: preview.merged.id, fields, moves: preview.moves },
    typedText: { reason },
  });
  return mergeId;
}

export type IdentityMerge = {
  id: string;
  survivorIdentityId: string;
  mergedIdentityId: string;
  fields: string[];
  reason: string | null;
  mergedBy: string | null;
  mergedAt: string;
  undoneAt: string | null;
};

/** The merges this identity took part in that are still in effect. */
export async function listActiveMergesFor(tenantId: string, identityId: string): Promise<IdentityMerge[]> {
  if (!UUID_RE.test(identityId)) return [];
  const supabase = await supabaseServer();
  const cols = "id, survivor_identity_id, merged_identity_id, fields, reason, merged_by, merged_at, undone_at";
  const [asSurvivor, asMerged] = await Promise.all([
    supabase.from("identity_merges").select(cols).eq("tenant_id", tenantId).eq("survivor_identity_id", identityId).is("undone_at", null).order("merged_at", { ascending: false }).limit(20),
    supabase.from("identity_merges").select(cols).eq("tenant_id", tenantId).eq("merged_identity_id", identityId).is("undone_at", null).limit(1),
  ]);
  if (asSurvivor.error || asMerged.error) throw new ApiError(500, "QUERY_FAILED", (asSurvivor.error ?? asMerged.error)!.message);
  return [...(asMerged.data ?? []), ...(asSurvivor.data ?? [])].map((r) => ({
    id: r.id as string,
    survivorIdentityId: r.survivor_identity_id as string,
    mergedIdentityId: r.merged_identity_id as string,
    fields: (r.fields as string[]) ?? [],
    reason: (r.reason as string | null) ?? null,
    mergedBy: (r.merged_by as string | null) ?? null,
    mergedAt: r.merged_at as string,
    undoneAt: (r.undone_at as string | null) ?? null,
  }));
}

/** Undoes a merge: the moved rows, the attributes and the sign-in go back. */
export async function undoIdentityMerge(tenantId: string, actorId: string, mergeId: string, reason: string): Promise<void> {
  if (!UUID_RE.test(mergeId)) throw new ApiError(404, "NOT_FOUND", "That merge was not found in this organization.");
  const why = reason.trim().slice(0, 500);
  if (!why) throw new ApiError(400, "VALIDATION_FAILED", "Say why the merge is being undone.");
  const supabase = await supabaseServer();
  const { data: row, error: readError } = await supabase.from("identity_merges").select("survivor_identity_id, merged_identity_id").eq("tenant_id", tenantId).eq("id", mergeId).maybeSingle();
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That merge was not found in this organization.");
  const { error } = await supabaseServiceRole().rpc("unmerge_identities", { p_tenant: tenantId, p_merge: mergeId, p_actor: actorId, p_reason: why });
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.merge_undone",
    objectType: "identity",
    objectId: row.survivor_identity_id as string,
    outcome: error ? "failure" : "success",
    metadata: { mergeId, mergedIdentityId: row.merged_identity_id, ...(error ? { error: error.code ?? "error" } : {}) },
    typedText: { reason: why },
  });
  if (error) throw mergeError(error);
}
