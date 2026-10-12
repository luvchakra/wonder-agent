import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { queueRemoval, withdrawGrants } from "./pendingGrants";

/**
 * WID-C02 — when a person leaves, everything they hold becomes removal
 * work at once: one removal task per live grant on their accounts, due
 * within a day (REMOVAL_SLA_DAYS), owned by the application's owner and
 * escalated to access managers when overdue. Grants approved but never
 * fulfilled are withdrawn. A person does each removal: a connector never
 * takes a leaver's access away on its own (#15, IDENTITY-P0-18), and the
 * removal counts only when a later read of the system no longer finds it.
 *
 * Called by the Identity Agent's lifecycle when a person becomes
 * disabled, terminated or archived. Service role: every read and write is
 * filtered on `tenantId`, and each row's tenant is checked (§14). Never
 * throws: a failure is audited and the lifecycle event still stands.
 */

type Row = Record<string, unknown>;

export async function openLeaverRemovals(
  tenantId: string,
  identityId: string,
  meta: { actorId: string | null; eventId: string | null },
): Promise<{ removals: number; withdrawn: number }> {
  try {
    const admin = supabaseServiceRole();
    const { data: accounts, error } = await admin.from("accounts").select("id, tenant_id, application_id").eq("tenant_id", tenantId).eq("identity_id", identityId).limit(500);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const appOf = new Map(((accounts ?? []) as Row[]).filter((a) => a.tenant_id === tenantId).map((a) => [a.id as string, a.application_id as string]));
    if (!appOf.size) return { removals: 0, withdrawn: 0 };
    const { data: grants, error: grantError } = await admin
      .from("access_grants")
      .select("id, tenant_id, account_id, fulfilment_status, removal_status")
      .eq("tenant_id", tenantId)
      .in("account_id", [...appOf.keys()])
      .is("revoked_at", null)
      .limit(2000);
    if (grantError) throw new ApiError(500, "QUERY_FAILED", grantError.message);
    const live = ((grants ?? []) as Row[]).filter((g) => g.tenant_id === tenantId);
    const unfulfilled = live.filter((g) => g.fulfilment_status === "pending_fulfilment").map((g) => g.id as string);
    await withdrawGrants(tenantId, unfulfilled);
    const marked = await queueRemoval(
      tenantId,
      live.filter((g) => g.fulfilment_status !== "pending_fulfilment" && g.removal_status === null).map((g) => ({ grantId: g.id as string, applicationId: appOf.get(g.account_id as string)! })),
      { reason: "leaver", manual: true },
    );
    if (marked.length || unfulfilled.length) {
      await writeAudit({
        tenantId,
        actorId: meta.actorId,
        actorType: meta.actorId ? "user" : "system",
        action: "access.leaver_removals_opened",
        objectType: "identity",
        objectId: identityId,
        outcome: "success",
        metadata: { eventId: meta.eventId, removalGrantIds: marked, withdrawnGrantIds: unfulfilled },
      });
    }
    return { removals: marked.length, withdrawn: unfulfilled.length };
  } catch (err) {
    await writeAudit({
      tenantId,
      actorId: meta.actorId,
      actorType: meta.actorId ? "user" : "system",
      action: "access.leaver_removals_opened",
      objectType: "identity",
      objectId: identityId,
      outcome: "failure",
      metadata: { eventId: meta.eventId, error: err instanceof ApiError ? err.code : "UNEXPECTED" },
    });
    return { removals: 0, withdrawn: 0 };
  }
}
