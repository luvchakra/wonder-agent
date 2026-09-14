import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_SEVERITY_WEIGHTS } from "./scoring";

/**
 * RISK-P0-02.2 — merges this tenant's `risk_severity_weights` overrides
 * onto the deterministic defaults. `risk_severity_weights` grants a
 * client-facing SELECT policy (migration 0044), so this runs as the
 * calling user; a missing row for a given factor means "use the default,"
 * never a silent zero.
 */
export async function getSeverityWeights(tenantId: string): Promise<Record<string, number>> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("risk_severity_weights")
    .select("factor_name, weight")
    .eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  const overrides: Record<string, number> = { ...DEFAULT_SEVERITY_WEIGHTS };
  for (const row of data ?? []) {
    overrides[row.factor_name] = row.weight;
  }
  return overrides;
}

/**
 * Changing a severity weight is an audited, admin-only action
 * (requirePermission('risk.manage') is enforced by the caller). Runs as
 * the calling user — `risk_severity_weights` grants client-facing
 * INSERT/UPDATE (migration 0044), same division of labor as Access
 * Agent's `updatePolicy()`: RLS's job is only tenant isolation, not
 * authorization.
 */
export async function setSeverityWeight(
  tenantId: string,
  actorId: string,
  factorName: string,
  weight: number,
): Promise<void> {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new ApiError(400, "INVALID_INPUT", "weight must be a non-negative number");
  }
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("risk_severity_weights")
    .upsert(
      { tenant_id: tenantId, factor_name: factorName, weight, updated_by: actorId, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,factor_name" },
    );
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "risk.severity_weight_changed",
    objectType: "risk_severity_weight",
    objectId: factorName,
    outcome: "success",
    metadata: { factorName, weight },
  });
}
