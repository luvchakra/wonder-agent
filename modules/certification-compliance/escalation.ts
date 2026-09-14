import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { listOwners } from "@/modules/agent-identity/service";
import { toCertificationItem } from "./mappers";

/**
 * COMPLIANCE-P0-05. No scheduler exists in this codebase yet (the same gap
 * Integration Agent's sync jobs and Compliance's own `recomputeStaleControlMappings`
 * already flagged) — exposed as a callable function an operator or a future
 * job runner invokes, rather than wired to a cron. Escalates every `pending`
 * item in the tenant whose `due_date` has passed and hasn't been escalated
 * yet, to the agent's business owner (falling back to the campaign's
 * `created_by` if the agent has no business owner assigned) — recorded on
 * the item itself (`escalated_at`/`escalated_to`) and as an audited event
 * per item, per the story's acceptance criteria.
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
    escalatedCount += 1;
  }

  return escalatedCount;
}
