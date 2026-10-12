import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { FindingStatus } from "@/lib/shared/types/risk";
import { remediationPlan } from "./accessRemediationRules";

/**
 * RISK-P0-13 (core, F3) — "Remove this access" on a rogue-access finding.
 *
 * The finding asks Access for an ordinary remove-access request (or
 * disable-account, for an account nothing approved), submitted as the
 * reviewer who asked, with the finding as its justification. From there
 * nothing is special: the application's request policy decides the
 * approval (non-negotiable #15), approval opens the removal task, a
 * connector with writes turned on makes the change (INTEGRATION-P0-13),
 * and reconciliation verifies it. When the access is gone the ledger no
 * longer reports it rogue, and syncRogueAccessFindings() resolves the
 * finding as verified fixed. Nothing here revokes anything directly.
 *
 * Findings are written with the service role only (no client write
 * policy), every statement filtered on `tenantId` (§14).
 */

type Row = Record<string, unknown>;

export async function requestAccessFindingRemoval(
  tenantId: string,
  actor: { userId: string; canManageAccess: boolean },
  findingId: string,
): Promise<{ requestId: string; requestStatus: string; duplicate: boolean }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(findingId)) throw new ApiError(404, "FINDING_NOT_FOUND");
  const admin = supabaseServiceRole();
  const { data: finding, error } = await admin
    .from("risk_findings")
    .select("id, tenant_id, category, status, title, identity_id, application_id, entitlement_id, account_id, remediation_request_id")
    .eq("tenant_id", tenantId)
    .eq("id", findingId)
    .maybeSingle<Row>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!finding || finding.tenant_id !== tenantId) throw new ApiError(404, "FINDING_NOT_FOUND");

  let currentStatus: string | null = null;
  if (finding.remediation_request_id) {
    const { data: req } = await admin.from("access_requests").select("tenant_id, status").eq("tenant_id", tenantId).eq("id", finding.remediation_request_id as string).maybeSingle();
    currentStatus = req && req.tenant_id === tenantId ? (req.status as string) : null;
  }
  const plan = remediationPlan(
    {
      category: finding.category as string,
      status: finding.status as FindingStatus,
      identityId: (finding.identity_id as string | null) ?? null,
      applicationId: (finding.application_id as string | null) ?? null,
      entitlementId: (finding.entitlement_id as string | null) ?? null,
    },
    currentStatus,
  );
  if (!plan.ok) throw new ApiError(409, plan.code, plan.message);

  // Access's published contract; imported here, not at the top, because Access's ledger calls Risk.
  const { submitAccessRequest } = await import("@/modules/access-governance/service");
  const { request, duplicate } = await submitAccessRequest(tenantId, actor, {
    subjectIdentityId: plan.subjectIdentityId,
    applicationId: plan.applicationId,
    entitlementId: plan.entitlementId ?? undefined,
    requestType: plan.requestType,
    justification: `Rogue access finding: ${String(finding.title).slice(0, 300)}`,
  });

  const { error: updateError } = await admin
    .from("risk_findings")
    .update({ status: "remediation_in_progress", remediation_request_id: request.id, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", findingId);
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  await writeAudit({
    tenantId,
    actorId: actor.userId,
    actorType: "user",
    action: "risk.remediation_requested",
    objectType: "risk_finding",
    objectId: findingId,
    outcome: "success",
    metadata: { category: "rogue_access", requestId: request.id, requestType: plan.requestType, requestStatus: request.status, duplicate, accountId: finding.account_id ?? null, entitlementId: plan.entitlementId },
  });
  return { requestId: request.id, requestStatus: request.status, duplicate };
}
