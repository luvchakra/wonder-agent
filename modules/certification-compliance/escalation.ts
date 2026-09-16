import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { notify } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { listOwners } from "@/modules/agent-identity/service";
import { toCertificationItem } from "./mappers";

/**
 * COMPLIANCE-P0-05. Escalates every `pending` item in the tenant whose
 * `due_date` has passed and hasn't been escalated yet, to the agent's
 * business owner (falling back to the campaign's `created_by` if the agent
 * has no business owner assigned) — recorded on the item itself
 * (`escalated_at`/`escalated_to`) and as an audited event per item, per the
 * story's acceptance criteria. Callable directly (operator/API-triggered,
 * `actorId` set to the calling user) or via `escalateOverdueItemsForAllTenants`
 * below (cron-triggered, `actorId` null — audited as `actorType: "system"`).
 */
export async function escalateOverdueItems(tenantId: string, actorId: string | null): Promise<number> {
  const supabase = supabaseServiceRole();
  const nowIso = new Date().toISOString();

  const { data: overdueRows, error } = await supabase
    .from("certification_items")
    .select("*, certification_campaigns(created_by)")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .is("escalated_at", null)
    .lt("due_date", nowIso)
    .returns<Array<Record<string, unknown> & { certification_campaigns: { created_by: string } | null }>>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  let escalatedCount = 0;
  for (const row of overdueRows ?? []) {
    const item = toCertificationItem(row);
    const owners = await listOwners(tenantId, item.agentId);
    const businessOwner = owners.find((o) => o.ownerType === "business_owner");
    const escalatedTo = businessOwner?.userId ?? row.certification_campaigns?.created_by ?? item.reviewerId;

    const { error: updateError } = await supabase
      .from("certification_items")
      .update({ escalated_at: nowIso, escalated_to: escalatedTo })
      .eq("id", item.id)
      .eq("tenant_id", tenantId);
    if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);

    await writeAudit({
      tenantId,
      actorId,
      actorType: actorId ? "user" : "system",
      action: "compliance.item_escalated",
      objectType: "certification_item",
      objectId: item.id,
      outcome: "success",
      metadata: { agentId: item.agentId, dueDate: item.dueDate, escalatedTo },
    });

    // OPERATIONS-P0-02.2 — wired per that story's own instruction that
    // each producing module picks this up in its own work. Targeted at
    // the specific escalatedTo user, not a tenant-wide broadcast, since
    // that's exactly who this event is actionable for.
    await notify({
      tenantId,
      userId: escalatedTo,
      type: "certification_overdue",
      title: "Certification item overdue",
      body: `A certification item for agent ${item.agentId} is overdue (due ${item.dueDate}) and has been escalated to you.`,
      referenceType: "certification_item",
      referenceId: item.id,
    });

    escalatedCount += 1;
  }

  return escalatedCount;
}

export type EscalationSweepResult = {
  tenantId: string;
  escalatedCount: number;
  error?: string;
};

/**
 * COMPLIANCE-P0-05's scheduler entry point (`app/api/cron/compliance-
 * escalate-overdue/route.ts`, wired to Vercel Cron via `vercel.json`).
 * `tenants` is Foundation's canonical schema (CLAUDE.md's Locked
 * Architecture) — read directly here rather than duplicated through
 * another module's service, since this is a plain unfiltered id read, not
 * a Platform-Administration operation. Only `active` tenants are swept.
 *
 * One tenant's failure must never abort the sweep for every other
 * tenant, so each tenant's escalation is isolated in its own try/catch;
 * a failed tenant is reported in the result array (`error` set) rather
 * than thrown, so the caller can log/alert on partial failure without the
 * whole cron invocation reporting a false "nothing happened."
 */
export async function escalateOverdueItemsForAllTenants(): Promise<EscalationSweepResult[]> {
  const supabase = supabaseServiceRole();
  const { data: tenants, error } = await supabase.from("tenants").select("id").eq("status", "active");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  const results: EscalationSweepResult[] = [];
  for (const tenant of tenants ?? []) {
    const tenantId = (tenant as { id: string }).id;
    try {
      const escalatedCount = await escalateOverdueItems(tenantId, null);
      results.push({ tenantId, escalatedCount });
    } catch (err) {
      results.push({ tenantId, escalatedCount: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
