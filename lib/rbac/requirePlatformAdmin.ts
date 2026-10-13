import "server-only";

import { cache } from "react";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { getSessionUser } from "@/lib/tenant/session";
import { ApiError } from "@/lib/shared/types/foundation";
import { isListedPlatformAdmin, parsePlatformAdminEmails } from "./platformAdminEmails";

/**
 * Separate authorization boundary from customer RBAC — see CLAUDE.md
 * non-negotiable #3 and docs/plan/01-FOUNDATION-AGENT-BACKLOG.md
 * FOUNDATION-P0-06. No customer role, however privileged, can ever satisfy
 * this check: `platform_admins` has no RLS policy granting any access to
 * regular authenticated clients, so this always reads it via the
 * service-role client.
 *
 * Resolved once per request (`cache()`): the customer layout asks this to
 * decide whether to show the "Admin console" link, and the platform-admin
 * routes ask it to gate themselves; they share one lookup.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getSessionUser();
  if (!user) return false;

  const admin = supabaseServiceRole();
  const { data, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return false;
  if (data !== null) return true;

  // Owner request (2026-10-13): or listed in PLATFORM_ADMIN_EMAILS, for an
  // account whose email Supabase Auth has confirmed (read from Auth, never
  // from the request).
  const list = parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS);
  if (list.size === 0 || !user.email || !list.has(user.email.trim().toLowerCase())) return false;
  const { data: account, error: accountError } = await admin.auth.admin.getUserById(user.id);
  if (accountError || !account?.user) return false;
  return isListedPlatformAdmin(list, { email: account.user.email, emailConfirmedAt: account.user.email_confirmed_at });
});

export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const user = await getSessionUser();
  if (!user) {
    throw new ApiError(401, "UNAUTHENTICATED");
  }
  if (!(await isPlatformAdmin())) {
    throw new ApiError(403, "FORBIDDEN", "Platform admin access required");
  }
  return { userId: user.id };
}
