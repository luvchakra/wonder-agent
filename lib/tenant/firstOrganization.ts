import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { firstOrganizationName, newTenantSlug } from "./organizationName";

/**
 * Gives a brand-new account its first organization, so sign-up lands in the
 * product instead of on a "create an organization" form (user request,
 * 2026-10-09).
 *
 * The decision is the database's (create_first_tenant_for_current_user,
 * migration 0107): under a per-user lock it creates nothing for an account
 * that has any membership row (an invitation, a suspension or a removal
 * included) or is a platform administrator, so this can never hand someone
 * a second organization or give the vendor boundary a tenant. It runs as
 * the signed-in user (session client), never the service role, and the RPC
 * scopes every write to auth.uid() (non-negotiable #2).
 *
 * Returns the new tenant's id and name, or null when nothing was created — the
 * caller then falls back to /onboarding, which shows invitations or the
 * manual form. A failure is reported as null, never as success (§17.5).
 */
export async function ensureFirstOrganization(): Promise<{ tenantId: string; name: string } | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const meta = user.user_metadata ?? {};
  const fullName = [meta.full_name, meta.name, meta.display_name].find((v): v is string => typeof v === "string" && v.trim().length > 0) ?? null;
  const name = firstOrganizationName(user.email, fullName);

  const { data: tenantId, error } = await supabase.rpc("create_first_tenant_for_current_user", {
    tenant_name: name,
    tenant_slug: newTenantSlug(name),
  });
  if (error) {
    console.error("ensureFirstOrganization failed", { error: error.message });
    return null;
  }
  if (typeof tenantId !== "string") return null;

  await writeAudit({
    tenantId,
    actorId: user.id,
    actorType: "user",
    action: "tenant.created",
    objectType: "tenant",
    objectId: tenantId,
    outcome: "success",
    metadata: { automatic: true, reason: "first_sign_in" },
  });
  return { tenantId, name };
}
