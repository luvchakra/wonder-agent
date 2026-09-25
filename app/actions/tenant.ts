"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { TENANT_COOKIE_NAME } from "@/lib/tenant/getTenantContext";
import { getSessionUser } from "@/lib/tenant/session";
import { SESSION_LAST_SEEN_COOKIE, SESSION_STARTED_COOKIE } from "@/lib/tenant/sessionSecurity";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "tenant"
  );
}

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

  const supabase = await supabaseServer();
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;

  const { data: tenantId, error } = await supabase.rpc("create_tenant_with_owner", {
    tenant_name: name,
    tenant_slug: slug,
  });

  if (error || !tenantId) {
    throw new Error(error?.message ?? "Failed to create tenant");
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
