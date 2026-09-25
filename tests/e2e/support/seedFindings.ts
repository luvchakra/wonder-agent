import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * RISK-P0-11's E2E needs open findings to group. Findings are normally
 * produced by the risk rule engine from a full SHOULD/CAN/DID setup (the
 * FinanceBot spec drives that whole journey); the investigations spec is
 * about grouping and tracking, so it seeds findings directly, the same
 * way seedFinanceBotAccess() seeds CAN. Test data only.
 */
export async function seedFindings(tenantId: string, agentId: string, findings: Array<{ title: string; severity: "low" | "medium" | "high" | "critical" }>): Promise<string[]> {
  const { data, error } = await adminClient()
    .from("risk_findings")
    .insert(
      findings.map((f) => ({
        tenant_id: tenantId,
        agent_id: agentId,
        category: "excessive_access",
        severity: f.severity,
        title: f.title,
        explanation: `${f.title}: seeded for the investigations spec.`,
        recommendation: "Remove the entitlement.",
      })),
    )
    .select("id");
  if (error || !data) throw new Error(`seedFindings failed: ${error?.message}`);
  return data.map((r: { id: string }) => r.id);
}

/** Stands in for the finding's own remediate-and-resolve flow, which the FinanceBot spec covers end to end. */
export async function markFindingsResolved(tenantId: string, findingIds: string[]): Promise<void> {
  const { error } = await adminClient()
    .from("risk_findings")
    .update({ status: "resolved", resolution_type: "verified_fixed", resolved_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .in("id", findingIds);
  if (error) throw new Error(`markFindingsResolved failed: ${error.message}`);
}
