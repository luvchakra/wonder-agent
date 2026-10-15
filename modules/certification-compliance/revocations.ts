import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { removalOutcomes } from "@/modules/access-governance/service";

/**
 * COMPLIANCE-P0-14 part 2 — closed-loop revocation: every revoke a reviewer
 * decided, and whether the access is really gone. A person's application
 * access is removed through an approved removal request and counts only
 * once a read of the system no longer finds it (Access's removalOutcomes);
 * a WonderID role and an agent's grant are removed when the decision is
 * recorded. Service role, every query filtered on `tenantId` (§14).
 */

type Row = Record<string, unknown>;
type Snapshot = {
  person?: { displayName?: string };
  role?: { displayName?: string };
  accessGrant?: { application?: string; entitlementName?: string } | null;
  package?: { name?: string; resource?: { applicationName?: string; entitlementName?: string | null } };
};

export type RevocationRow = {
  itemId: string;
  campaignId: string;
  campaignName: string;
  subject: string;
  access: string;
  decidedAt: string;
  how: "removal_request" | "role_removed" | "grant_revoked" | "package_resource_removed";
  outcome: "verified" | "removed_unverified" | "pending" | "failed" | "removed";
  dueAt: string | null;
  verifiedAt: string | null;
};

export async function listRevocations(tenantId: string, limit = 1000): Promise<RevocationRow[]> {
  const admin = supabaseServiceRole();
  const { data: items, error } = await admin
    .from("certification_items")
    .select("id, tenant_id, campaign_id, agent_id, identity_id, role_source, package_resource_id, snapshot, certification_campaigns(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "decided")
    .order("updated_at", { ascending: false })
    .limit(5000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const own = ((items ?? []) as Row[]).filter((r) => r.tenant_id === tenantId);
  const byId = new Map(own.map((r) => [r.id as string, r]));
  const decisions: Row[] = [];
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: dErr } = await admin.from("certification_decisions").select("item_id, decision, decided_at, remediation_id").eq("decision", "revoke").in("item_id", ids.slice(i, i + 200));
    if (dErr) throw new ApiError(500, "QUERY_FAILED", dErr.message);
    decisions.push(...((data ?? []) as Row[]).filter((d) => byId.has(d.item_id as string)));
  }
  decisions.sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)));
  const picked = decisions.slice(0, limit);
  const requestIds = picked
    .filter((d) => {
      const item = byId.get(d.item_id as string)!;
      return !item.agent_id && !item.role_source && !item.package_resource_id && d.remediation_id;
    })
    .map((d) => d.remediation_id as string);
  const outcomes = await removalOutcomes(tenantId, requestIds);
  return picked.map((d) => {
    const item = byId.get(d.item_id as string)!;
    const snap = ((item.snapshot as Snapshot | null) ?? {}) as Snapshot;
    const subject = snap.person?.displayName ?? snap.package?.name ?? (item.agent_id as string | null) ?? "";
    const access =
      snap.role?.displayName ??
      (snap.package?.resource ? [snap.package.resource.applicationName, snap.package.resource.entitlementName].filter(Boolean).join(" · ") : [snap.accessGrant?.application, snap.accessGrant?.entitlementName].filter(Boolean).join(" · "));
    const base = { itemId: item.id as string, campaignId: item.campaign_id as string, campaignName: (item.certification_campaigns as { name?: string } | null)?.name ?? "", subject, access, decidedAt: d.decided_at as string };
    if (item.package_resource_id) return { ...base, how: "package_resource_removed" as const, outcome: "removed" as const, dueAt: null, verifiedAt: d.decided_at as string };
    if (item.role_source) return { ...base, how: "role_removed" as const, outcome: "removed" as const, dueAt: null, verifiedAt: d.decided_at as string };
    if (item.agent_id) return { ...base, how: "grant_revoked" as const, outcome: "removed" as const, dueAt: null, verifiedAt: d.decided_at as string };
    const o = d.remediation_id ? outcomes.get(d.remediation_id as string) : undefined;
    return { ...base, how: "removal_request" as const, outcome: o?.outcome ?? "pending", dueAt: o?.dueAt ?? null, verifiedAt: o?.verifiedAt ?? null };
  });
}
