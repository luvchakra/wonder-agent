import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import type { HostResolution } from "@/lib/tenant/hostTenant";

/**
 * FOUNDATION-P0-22 — after someone authenticates on an organization's own
 * address (by password, or since 2026-10-13 by Google, Microsoft or
 * LinkedIn): an account that is not an active (or invited) member there is
 * signed straight back out of this new session only, audited
 * `auth.sign_in_refused`. The address never grants access. Returns the
 * refusal in words, or null when the person may go on.
 */
export async function refuseNonMemberOnTenantAddress(supabase: SupabaseClient, host: HostResolution, userId: string): Promise<string | null> {
  if (host.target.kind !== "subdomain" && host.target.kind !== "invalid") return null;
  if (!host.tenant || host.tenant.status !== "active") {
    await supabase.auth.signOut({ scope: "local" });
    return host.tenant ? `${host.tenant.name} is suspended. Sign-in is paused; contact your administrator.` : "No organization is at this address.";
  }
  // The person just authenticated, reading their own membership in the
  // addressed organization. Service role: a membership that is not yet
  // active (an invitation) is outside their RLS view.
  const { data: membership } = await supabaseServiceRole().from("tenant_memberships").select("status").eq("tenant_id", host.tenant.tenantId).eq("user_id", userId).maybeSingle();
  // An invitation lets them in far enough to accept it (FOUNDATION-P0-23).
  if (membership?.status === "active" || membership?.status === "invited") return null;
  // Only this new session ends; the account's other sessions are not touched.
  await supabase.auth.signOut({ scope: "local" });
  await writeAudit({
    tenantId: host.tenant.tenantId,
    actorId: userId,
    actorType: "user",
    action: "auth.sign_in_refused",
    objectType: "tenant",
    objectId: host.tenant.tenantId,
    outcome: "failure",
    metadata: { reason: membership ? `membership ${membership.status}` : "not a member" },
  });
  return `This account is not an active member of ${host.tenant.name}.`;
}
