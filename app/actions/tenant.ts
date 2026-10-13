"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getHostTenant, urlForTenant } from "@/lib/tenant/hostTenant";
import { TENANT_COOKIE_NAME, getMyMemberships } from "@/lib/tenant/getTenantContext";
import { getSessionUser } from "@/lib/tenant/session";
import { SESSION_LAST_SEEN_COOKIE, SESSION_STARTED_COOKIE } from "@/lib/tenant/sessionSecurity";
import { ORGANIZATION_NAME_MAX, PREFIX_MAX, environmentSlug, isOrganizationEnvironment } from "@/lib/tenant/organizationName";
import { slugProblem } from "@/lib/tenant/host";
import { writeAudit } from "@/lib/audit/writeAudit";
import { renameOrganization } from "@/lib/tenant/organization";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { revalidatePath } from "next/cache";

export type SetUpOrganizationState = { ok: boolean; error: string | null; name?: string };

/**
 * FOUNDATION-P0-03.2, owner request 2026-10-13 — "Create a new
 * organization" on /onboarding: a person names their organization and chooses its address prefix and
 * environment (production `<prefix>`, or `<prefix>-dev`, `-test`,
 * `-staging`). Delegates the write to create_tenant_with_owner (migration
 * 0157; no client INSERT policy on tenants or memberships).
 * Returns what went wrong in words; never reports success for a failure.
 */
export async function setUpOrganizationAction(_prev: SetUpOrganizationState, formData: FormData): Promise<SetUpOrganizationState> {
  const name = String(formData.get("name") ?? "").trim();
  const prefix = String(formData.get("prefix") ?? "").trim().toLowerCase();
  const environment = String(formData.get("environment") ?? "production");
  if (name.length < 2) return { ok: false, error: "Give the organization a name (at least 2 characters)." };
  if (name.length > ORGANIZATION_NAME_MAX) return { ok: false, error: `The name can be at most ${ORGANIZATION_NAME_MAX} characters.` };
  if (!isOrganizationEnvironment(environment)) return { ok: false, error: "Choose an environment." };
  if (prefix.length > PREFIX_MAX) return { ok: false, error: `The address prefix can be at most ${PREFIX_MAX} characters.` };
  const slug = environmentSlug(prefix, environment);
  const problem = slugProblem(slug);
  if (problem) return { ok: false, error: `Address: ${problem}.` };

  // FOUNDATION-P0-22 — organizations are created from the WonderID address, never from inside another organization's.
  const host = await getHostTenant();
  if (host.target.kind !== "none" && host.target.kind !== "base") return { ok: false, error: "Create organizations from the main WonderID address." };

  const supabase = await supabaseServer();
  const { data: available } = await supabase.rpc("tenant_slug_available", { p_slug: slug });
  if (available === false) return { ok: false, error: `${slug} is already taken. Choose another prefix.` };

  const { data: tenantId, error } = await supabase.rpc("create_tenant_with_owner", {
    tenant_name: name,
    tenant_slug: slug,
    p_environment: environment,
  });
  if (error) return { ok: false, error: error.code === "23505" ? `${slug} is already taken. Choose another prefix.` : "The organization could not be created. Try again." };
  if (typeof tenantId !== "string") return { ok: false, error: "The organization could not be created. Try again." };

  const user = await getSessionUser();
  await writeAudit({ tenantId, actorId: user?.id ?? null, actorType: "user", action: "tenant.created", objectType: "tenant", objectId: tenantId, outcome: "success", metadata: { automatic: false, environment, slug } });

  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE_NAME, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return { ok: true, error: null, name };
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
  // The caller's OWN active membership (my_memberships(), migration 0152).
  // It includes an organization that requires MFA the session has not
  // passed yet (RLS hides that membership row), so switching there leads to
  // the MFA step rather than failing as "Not a member".
  const membership = (await getMyMemberships()).find((m) => m.tenantId === tenantId);
  if (!membership) {
    throw new Error("Not a member of the requested tenant");
  }

  // FOUNDATION-P0-22 — on an organization's own address the address decides
  // the organization, so switching means going to the other one's address
  // (where the user signs in; sessions are per address).
  const host = await getHostTenant();
  if (host.target.kind === "subdomain" || host.target.kind === "invalid") {
    const url = membership.slug ? await urlForTenant(membership.slug) : null;
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
