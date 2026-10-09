"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getHostTenant, urlForTenant } from "@/lib/tenant/hostTenant";
import { TENANT_COOKIE_NAME } from "@/lib/tenant/getTenantContext";
import { getSessionUser } from "@/lib/tenant/session";
import { SESSION_LAST_SEEN_COOKIE, SESSION_STARTED_COOKIE } from "@/lib/tenant/sessionSecurity";
import { ORGANIZATION_NAME_MAX, newTenantSlug } from "@/lib/tenant/organizationName";
import { writeAudit } from "@/lib/audit/writeAudit";
import { renameOrganization } from "@/lib/tenant/organization";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { revalidatePath } from "next/cache";

/**
 * FOUNDATION-P0-03.2 — self-service tenant creation. Delegates the actual
 * write to the create_tenant_with_owner() security-definer RPC
 * (supabase/migrations/0008_foundation_create_tenant_rpc.sql) rather than
 * inserting into tenants/tenant_memberships directly, since neither table
 * grants an authenticated client an INSERT policy.
 */
export async function createTenantAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Organization name is required");
  }
  if (name.length > ORGANIZATION_NAME_MAX) {
    throw new Error(`Organization name must be at most ${ORGANIZATION_NAME_MAX} characters`);
  }

  // FOUNDATION-P0-22 — organizations are created from the WonderID address, never from inside another organization's.
  const host = await getHostTenant();
  if (host.target.kind !== "none" && host.target.kind !== "base") {
    throw new Error("Organizations are created from the main WonderID address, not from an organization's own address");
  }

  const supabase = await supabaseServer();
  const slug = newTenantSlug(name);

  const { data: tenantId, error } = await supabase.rpc("create_tenant_with_owner", {
    tenant_name: name,
    tenant_slug: slug,
  });

  if (error || !tenantId) {
    throw new Error(error?.message ?? "Failed to create tenant");
  }

  const user = await getSessionUser();
  await writeAudit({ tenantId, actorId: user?.id ?? null, actorType: "user", action: "tenant.created", objectType: "tenant", objectId: tenantId, outcome: "success", metadata: { automatic: false } });

  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE_NAME, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  redirect("/");
}

/**
 * Sets the active-tenant cookie after verifying the caller actually has an
 * active membership in the requested tenant — never trust the posted value
 * on its own (CLAUDE.md non-negotiable #2).
 */
export async function selectTenantAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const supabase = await supabaseServer();

  // QA-P0-17: the caller's OWN membership. The tenant_memberships policy
  // lets every member read the tenant's membership rows, so without the
  // user filter an organization with two or more members returned several
  // rows, maybeSingle() gave no data, and switching failed as "Not a member".
  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) {
    throw new Error("Not a member of the requested tenant");
  }

  // FOUNDATION-P0-22 — on an organization's own address the address decides
  // the organization, so switching means going to the other one's address
  // (where the user signs in; sessions are per address).
  const host = await getHostTenant();
  if (host.target.kind === "subdomain" || host.target.kind === "invalid") {
    const { data: target } = await supabase.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
    const url = target?.slug ? await urlForTenant(target.slug as string) : null;
    if (url) redirect(url);
  }

  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE_NAME, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  redirect("/");
}

export async function signOutAction() {
  const supabase = await supabaseServer();
  // `scope: "global"` is stated explicitly, not left to supabase-js's
  // default, because it is a deliberate product decision (user, 2026-09-17):
  // logging out revokes EVERY refresh token this user holds, on every
  // device, not just the session doing the logging out. Appropriate for a
  // security product — an administrator who suspects a session is
  // compromised gets one control that ends all of them. Writing it down
  // also means a supabase-js upgrade that changes the default cannot
  // silently downgrade the posture.
  await supabase.auth.signOut({ scope: "global" });
  const cookieStore = await cookies();
  cookieStore.delete(TENANT_COOKIE_NAME);
  // FOUNDATION-P0-09 — logout invalidation must also clear the session-
  // security cookies, not just the Supabase session itself, so a stale
  // last-seen/started-at value can't outlive the session it was stamped for.
  cookieStore.delete(SESSION_STARTED_COOKIE);
  cookieStore.delete(SESSION_LAST_SEEN_COOKIE);
  redirect("/sign-in");
}

export type RenameOrganizationState = { ok: boolean; message: string | null };

/**
 * Administration → Organization: rename the active organization. Needs
 * "Manage organization settings" (tenant.settings); the tenant comes from
 * the session, never the form.
 */
export async function renameOrganizationAction(_prev: RenameOrganizationState, formData: FormData): Promise<RenameOrganizationState> {
  let ctx;
  try {
    ctx = await requirePermission("tenant.settings");
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, message: err.status === 403 ? "You don't have permission to rename this organization." : err.message };
    throw err;
  }
  const result = await renameOrganization(ctx.tenantId!, ctx.userId, formData.get("name"));
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}
