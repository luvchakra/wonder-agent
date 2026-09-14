import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { writePlatformAudit } from "./auditLog";

/**
 * PLATFORM-P0-01.2. Builds the UI/API for a platform admin to grant
 * platform-admin status to another user going forward — does not
 * re-implement Foundation's `platform_admins` table (FOUNDATION-P0-06.1).
 * How the FIRST platform admin was granted (this table starts empty, and
 * no route can grant the first one — a bootstrap problem every "vendor
 * admin" system has) is documented in this module's audit log, not in
 * application code: see docs/design/platform-agent-backlog-audit.md.
 */
export async function grantPlatformAdmin(actorId: string, targetUserId: string): Promise<void> {
  const supabase = supabaseServiceRole();
  const { data: targetUser, error: userError } = await supabase.from("users").select("id, email").eq("id", targetUserId).maybeSingle();
  if (userError) throw new ApiError(500, "QUERY_FAILED", userError.message);
  if (!targetUser) throw new ApiError(404, "USER_NOT_FOUND");

  const { error } = await supabase.from("platform_admins").insert({ user_id: targetUserId, granted_by: actorId });
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "ALREADY_PLATFORM_ADMIN");
    throw new ApiError(500, "CREATE_FAILED", error.message);
  }

  await writePlatformAudit({
    actorId,
    action: "platform.admin_granted",
    newValue: { targetUserId, email: targetUser.email },
    result: "success",
  });
}

export async function revokePlatformAdmin(actorId: string, targetUserId: string): Promise<void> {
  const supabase = supabaseServiceRole();
  const { error } = await supabase.from("platform_admins").delete().eq("user_id", targetUserId);
  if (error) throw new ApiError(500, "DELETE_FAILED", error.message);

  await writePlatformAudit({ actorId, action: "platform.admin_revoked", newValue: { targetUserId }, result: "success" });
}

export async function listPlatformAdmins(): Promise<{ userId: string; email: string; grantedAt: string }[]> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase.from("platform_admins").select("user_id, granted_at, users(email)").order("granted_at", { ascending: true });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((row: { user_id: string; granted_at: string; users: { email: string }[] | { email: string } | null }) => ({
    userId: row.user_id,
    email: (Array.isArray(row.users) ? row.users[0]?.email : row.users?.email) ?? "",
    grantedAt: row.granted_at,
  }));
}
