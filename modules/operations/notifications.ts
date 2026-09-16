import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { Notification, NotificationPreference, NotifyEvent, NotificationType } from "@/lib/shared/types/operations";
import { MANDATORY_NOTIFICATION_TYPES } from "@/lib/shared/types/operations";
import { toNotification, toNotificationPreference } from "./mappers";
import { sendNotificationEmail } from "./email";

/**
 * OPERATIONS-P0-02.2's published entry point — every producing module
 * calls this at the moment its own P0 trigger event occurs (e.g. Risk
 * Agent calls `notify({type: 'critical_finding', ...})` right after
 * inserting a `critical` `risk_findings` row). Operations Agent does not
 * poll for these conditions itself. Writes via the service-role client
 * (clients have no INSERT policy on `notifications`) and never throws —
 * same never-fails-the-caller discipline as `writeAudit()`, since a
 * notification-delivery failure must never abort the legitimate action
 * that triggered it.
 *
 * **Email channel**: resolved 2026-09-16 (user picked Resend) — see
 * `./email.ts`'s `sendNotificationEmail()`. It also never throws, so
 * awaiting it here is safe even when Resend isn't configured (it's a
 * no-op) or a send fails (logged, not propagated).
 */
export async function notify(event: NotifyEvent): Promise<void> {
  try {
    const supabase = supabaseServiceRole();
    const { error } = await supabase.from("notifications").insert({
      tenant_id: event.tenantId,
      user_id: event.userId ?? null,
      type: event.type,
      title: event.title,
      body: event.body,
      reference_type: event.referenceType ?? null,
      reference_id: event.referenceId ?? null,
    });
    if (error) {
      console.error("notify() failed to write notification", { type: event.type, error: error.message });
    }
  } catch (err) {
    console.error("notify() threw", { type: event.type, err });
  }

  await sendNotificationEmail(event);
}

/** In-app channel read: the caller's own targeted notifications plus every tenant-wide broadcast. */
export async function listNotifications(tenantId: string, userId: string, unreadOnly = false): Promise<Notification[]> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("notifications")
    .select()
    .eq("tenant_id", tenantId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (unreadOnly) query = query.is("read_at", null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toNotification);
}

/**
 * Only marks the caller's own targeted notification read — a broadcast
 * (`user_id is null`) row has no client-facing UPDATE policy at all
 * (migration 0048's own comment), so marking a broadcast read per-user is
 * explicitly out of P0 scope, not silently attempted here.
 */
export async function markNotificationRead(tenantId: string, userId: string, notificationId: string): Promise<Notification> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "NOTIFICATION_NOT_FOUND");
  return toNotification(data);
}

/**
 * OPERATIONS-P0-05.1. A missing row for a (user, type) means "use the
 * default" (both channels on) — never a silent all-off state.
 */
export async function listNotificationPreferences(tenantId: string, userId: string): Promise<NotificationPreference[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("notification_preferences").select().eq("tenant_id", tenantId).eq("user_id", userId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toNotificationPreference);
}

/**
 * Structurally prevents suppressing a mandatory P0 type: rejects the write
 * outright rather than silently ignoring the `false` value, so the caller
 * gets a clear error instead of a preference that looks saved but isn't
 * honored.
 */
export async function setNotificationPreference(
  tenantId: string,
  userId: string,
  type: NotificationType,
  input: { inAppEnabled?: boolean; emailEnabled?: boolean },
): Promise<NotificationPreference> {
  if (MANDATORY_NOTIFICATION_TYPES.includes(type) && (input.inAppEnabled === false || input.emailEnabled === false)) {
    throw new ApiError(400, "MANDATORY_NOTIFICATION_TYPE", `${type} is a mandatory security/audit notification and cannot be suppressed`);
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("notification_preferences")
    .upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        type,
        in_app_enabled: input.inAppEnabled ?? true,
        email_enabled: input.emailEnabled ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,user_id,type" },
    )
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to update preference");
  return toNotificationPreference(data);
}
