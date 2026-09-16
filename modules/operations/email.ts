import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { getResendApiKey, getResendFromEmail } from "@/lib/db/env";
import type { NotifyEvent } from "@/lib/shared/types/operations";

const RESEND_SEND_URL = "https://api.resend.com/emails";

/**
 * OPERATIONS-P0-02.1's email channel, resolved 2026-09-16 (user picked
 * Resend). Internal-only — never exported via modules/operations/service.ts;
 * notify() (./notifications.ts) is the only caller. Never throws: an email
 * delivery failure must never abort the in-app notification write that
 * triggered it, same never-fails-the-caller discipline as writeAudit()
 * and notify() itself.
 *
 * Calls Resend's REST API directly via fetch() — no new npm dependency,
 * matching this codebase's minimal-dependency ethos (same choice already
 * made for OpenAI/Gemini in lib/ai/summarize.ts).
 */
export async function sendNotificationEmail(event: NotifyEvent): Promise<void> {
  const apiKey = getResendApiKey();
  const fromEmail = getResendFromEmail();
  if (!apiKey || !fromEmail) return; // Not configured — in-app-only, no error.

  try {
    const recipients = await resolveEmailRecipients(event);
    if (recipients.length === 0) return;

    await Promise.all(
      recipients.map(async (to) => {
        const response = await fetch(RESEND_SEND_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            from: fromEmail,
            to,
            subject: event.title,
            text: event.body,
          }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          console.error("sendNotificationEmail failed", {
            type: event.type,
            status: response.status,
            detail: detail.slice(0, 500),
          });
        }
      }),
    );
  } catch (err) {
    console.error("sendNotificationEmail threw", { type: event.type, err });
  }
}

/**
 * `event.userId` set -> that one user, if their preference for this type
 * allows email. `event.userId` unset -> every active tenant member whose
 * preference allows it — the same tenant-wide broadcast semantics the
 * in-app channel already uses (`listNotifications()` shows a
 * null-user_id row to every tenant member). A missing preference row
 * defaults to enabled, per OPERATIONS-P0-05.1's own documented default
 * ("a missing row means use the default — both channels on").
 *
 * Every P0 notification type is mandatory in this build (see
 * MANDATORY_NOTIFICATION_TYPES / setNotificationPreference()'s own
 * rejection of emailEnabled:false for a mandatory type), so in practice
 * every recipient's preference is always enabled today — this still reads
 * the real preference row rather than hard-coding that assumption, so it
 * stays correct if a non-mandatory (P1) notification type is ever added.
 */
async function resolveEmailRecipients(event: NotifyEvent): Promise<string[]> {
  const supabase = supabaseServiceRole();

  const userIds: string[] = [];
  if (event.userId) {
    userIds.push(event.userId);
  } else {
    const { data, error } = await supabase
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", event.tenantId)
      .eq("status", "active");
    if (error) {
      console.error("resolveEmailRecipients failed to list tenant members", error.message);
      return [];
    }
    userIds.push(...(data ?? []).map((r: { user_id: string }) => r.user_id));
  }
  if (userIds.length === 0) return [];

  const [usersResult, prefsResult] = await Promise.all([
    supabase.from("users").select("id, email").in("id", userIds),
    supabase
      .from("notification_preferences")
      .select("user_id, email_enabled")
      .eq("tenant_id", event.tenantId)
      .eq("type", event.type)
      .in("user_id", userIds),
  ]);
  if (usersResult.error) {
    console.error("resolveEmailRecipients failed to load users", usersResult.error.message);
    return [];
  }
  if (prefsResult.error) {
    console.error("resolveEmailRecipients failed to load preferences", prefsResult.error.message);
  }

  const disabled = new Set(
    (prefsResult.data ?? [])
      .filter((p: { email_enabled: boolean }) => p.email_enabled === false)
      .map((p: { user_id: string }) => p.user_id),
  );
  return (usersResult.data ?? [])
    .filter((u: { id: string }) => !disabled.has(u.id))
    .map((u: { email: string }) => u.email);
}
