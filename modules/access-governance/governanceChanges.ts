import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { decisionRefusal, diffFields, type FieldChange } from "./governanceChangeRules";
import { applyRequestPolicy } from "./requestCatalog";

/**
 * ACCESS-P0-35 part 1 — approved changes to governance objects (request
 * policies first). Proposals are made by saveRequestPolicy; here they are
 * listed (as the caller, RLS: those who manage access) and decided by
 * someone other than the proposer: approving applies the change as the
 * object's next version, unless the object moved on since.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GovernanceChange = {
  id: string;
  objectType: "request_policy";
  objectId: string | null;
  objectKey: { applicationId: string | null; entitlementId: string | null };
  status: "pending" | "approved" | "rejected" | "cancelled";
  changes: FieldChange[];
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

function toChange(r: Row): GovernanceChange {
  return {
    id: r.id as string,
    objectType: r.object_type as "request_policy",
    objectId: (r.object_id as string | null) ?? null,
    objectKey: { applicationId: null, entitlementId: null, ...((r.object_key as Record<string, string | null>) ?? {}) },
    status: r.status as GovernanceChange["status"],
    changes: diffFields((r.previous as Record<string, unknown> | null) ?? null, (r.proposed as Record<string, unknown>) ?? {}),
    requestedBy: r.requested_by as string,
    requestedAt: r.requested_at as string,
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
  };
}

/** Changes, newest first: waiting ones by default. */
export async function listGovernanceChanges(tenantId: string, opts: { status?: string } = {}): Promise<GovernanceChange[]> {
  const supabase = await supabaseServer();
  let q = supabase.from("governance_changes").select("*").eq("tenant_id", tenantId);
  if (opts.status !== "all") q = q.eq("status", opts.status ?? "pending");
  const { data, error } = await q.order("requested_at", { ascending: false }).limit(100);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map(toChange);
}

/** Approve (apply) or reject a waiting change; never the proposer's own. */
export async function decideGovernanceChange(tenantId: string, actorId: string, changeId: string, decision: unknown, note?: unknown): Promise<GovernanceChange> {
  if (!UUID_RE.test(changeId)) throw new ApiError(404, "NOT_FOUND", "No such change");
  const admin = supabaseServiceRole();
  const { data: row, error } = await admin.from("governance_changes").select("*").eq("tenant_id", tenantId).eq("id", changeId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!row || row.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such change");
  const refusal = decisionRefusal({ status: row.status as string, requestedBy: row.requested_by as string }, actorId, decision);
  if (refusal) throw new ApiError(refusal.status, refusal.code, refusal.message);
  const decisionNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 1000) : null;

  // Claim it first, so two people deciding at once cannot both act.
  const { data: claimed, error: claimError } = await admin
    .from("governance_changes")
    .update({ status: decision, decided_by: actorId, decided_at: new Date().toISOString(), decision_note: decisionNote })
    .eq("tenant_id", tenantId)
    .eq("id", changeId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (claimError) throw new ApiError(500, "WRITE_FAILED", claimError.message);
  if (!claimed) throw new ApiError(409, "INVALID_TRANSITION", "Decided meanwhile; reload");

  if (decision === "approved") {
    try {
      const key = { applicationId: null, entitlementId: null, ...((row.object_key as Record<string, string | null>) ?? {}) };
      const policy = await applyRequestPolicy(tenantId, actorId, key, row.proposed as Record<string, unknown>, {
        createdBy: row.requested_by as string,
        approvedBy: actorId,
        changeId,
        baseVersion: (row.base_version as number | null) ?? null,
      });
      if (!row.object_id) await admin.from("governance_changes").update({ object_id: policy.id }).eq("tenant_id", tenantId).eq("id", changeId);
    } catch (err) {
      // Not applied: it waits again, and the reason is the answer.
      await admin.from("governance_changes").update({ status: "pending", decided_by: null, decided_at: null, decision_note: null }).eq("tenant_id", tenantId).eq("id", changeId);
      throw err;
    }
  }
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: decision === "approved" ? "access.governance_change_approved" : "access.governance_change_rejected",
    objectType: "governance_change",
    objectId: changeId,
    outcome: "success",
    metadata: { objectType: row.object_type, objectId: row.object_id, requestedBy: row.requested_by },
    typedText: { note: decisionNote },
  });
  const { data: final } = await admin.from("governance_changes").select("*").eq("tenant_id", tenantId).eq("id", changeId).single();
  return toChange(final ?? claimed);
}
