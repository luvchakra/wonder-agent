import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * Separate authorization boundary from customer RBAC — see CLAUDE.md
 * non-negotiable #3 and docs/plan/01-FOUNDATION-AGENT-BACKLOG.md
 * FOUNDATION-P0-06. No customer role, however privileged, can ever satisfy
 * this check: `platform_admins` has no RLS policy granting any access to
 * regular authenticated clients, so this always reads it via the
 * service-role client.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const admin = supabaseServiceRole();
  const { data, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return false;
  return data !== null;
}

export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new ApiError(401, "UNAUTHENTICATED");
  }
  if (!(await isPlatformAdmin())) {
    throw new ApiError(403, "FORBIDDEN", "Platform admin access required");
  }
  return { userId: user.id };
}
