import "server-only";

import { cache } from "react";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { getSessionUser } from "@/lib/tenant/session";
import { ApiError } from "@/lib/shared/types/foundation";

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
  return data !== null;
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
