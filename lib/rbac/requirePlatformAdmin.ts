import "server-only";

import { cache } from "react";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { getSessionUser } from "@/lib/tenant/session";
import { ApiError } from "@/lib/shared/types/foundation";
import { writePlatformAudit } from "@/modules/platform-admin/auditLog";
import { isListedPlatformAdmin, parsePlatformAdminEmails } from "./platformAdminEmails";

/**
 * Separate authorization boundary from customer RBAC — see CLAUDE.md
 * non-negotiable #3 and docs/plan/01-FOUNDATION-AGENT-BACKLOG.md
 * FOUNDATION-P0-06. No customer role, however privileged, can ever satisfy
 * this check: `platform_admins` has no RLS policy granting any access to
 * regular authenticated clients, so this always reads it via the
 * service-role client.
 *
 * WID-H10, owner decision 2026-10-14: vendor access comes only from the
 * audited `platform_admins` table. An address in `PLATFORM_ADMIN_EMAILS`
 * is a bootstrap and nothing more: it may open Platform Admins and add an
 * entry to the table (`isPlatformAdminBootstrap`), never the rest of the
 * console, and only when signed in by a method that proves the mailbox.
 *
 * Resolved once per request (`cache()`): the customer layout asks this to
 * decide whether to show the "Admin console" link, and the platform-admin
 * routes ask it to gate themselves; they share one lookup.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getSessionUser();
  if (!user) return false;
  const { data, error } = await supabaseServiceRole().from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return !error && data !== null;
});

/**
 * Listed in PLATFORM_ADMIN_EMAILS (owner request, 2026-10-13), for an
 * account whose email Supabase Auth has confirmed (read from Auth, never
 * from the request), signed in by a method that proves the mailbox, never
 * enterprise SSO (WID-H10). Grants only the bootstrap: adding entries to
 * `platform_admins`. The first use leaves a platform audit record.
 */
export const isPlatformAdminBootstrap = cache(async (): Promise<boolean> => {
  const user = await getSessionUser();
  if (!user) return false;
  const list = parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS);
  if (list.size === 0 || !user.email || !list.has(user.email.trim().toLowerCase())) return false;
  const admin = supabaseServiceRole();
  const { data: account, error: accountError } = await admin.auth.admin.getUserById(user.id);
  if (accountError || !account?.user) return false;
  const providers = (account.user.identities ?? []).map((i) => i.provider);
  const admitted = isListedPlatformAdmin(list, { email: account.user.email, emailConfirmedAt: account.user.email_confirmed_at, isSsoUser: account.user.is_sso_user, providers });
  if (admitted) {
    const { data: seen, error: seenError } = await admin.from("platform_audit_logs").select("id").eq("actor_id", user.id).eq("action", ENV_ACCESS_ACTION).limit(1);
    if (!seenError && !seen?.length) await writePlatformAudit({ actorId: user.id, action: ENV_ACCESS_ACTION, newValue: { via: "PLATFORM_ADMIN_EMAILS", providers }, result: "success" });
  }
  return admitted;
});

const ENV_ACCESS_ACTION = "platform.admin_access_via_env";

/** What this session may open in the vendor console: all of it, only Platform Admins (the bootstrap), or nothing. */
export async function platformConsoleAccess(): Promise<"full" | "bootstrap" | null> {
  if (await isPlatformAdmin()) return "full";
  return (await isPlatformAdminBootstrap()) ? "bootstrap" : null;
}

/** The whole vendor console: a `platform_admins` entry only. */
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

/** Platform Admins and adding an entry there: a `platform_admins` entry, or the PLATFORM_ADMIN_EMAILS bootstrap. */
export async function requirePlatformAdminOrBootstrap(): Promise<{ userId: string; bootstrap: boolean }> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "UNAUTHENTICATED");
  const access = await platformConsoleAccess();
  if (!access) throw new ApiError(403, "FORBIDDEN", "Platform admin access required");
  return { userId: user.id, bootstrap: access === "bootstrap" };
}
