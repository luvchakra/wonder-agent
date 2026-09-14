import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";

export type PlatformAuditEvent = {
  actorId: string;
  tenantId?: string | null;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  result: "success" | "failure";
};

/**
 * PLATFORM-P0-04.1. The ONLY sanctioned way any Platform Agent function
 * writes to platform_audit_logs — distinct from Foundation's writeAudit()/
 * audit_logs, and never exposed to any customer role or route. Same
 * never-throws discipline as Foundation's writeAudit(): an audit-write
 * failure must never abort a legitimate platform-admin action.
 */
export async function writePlatformAudit(event: PlatformAuditEvent): Promise<void> {
  try {
    const supabase = supabaseServiceRole();
    const { error } = await supabase.from("platform_audit_logs").insert({
      actor_id: event.actorId,
      tenant_id: event.tenantId ?? null,
      action: event.action,
      old_value: event.oldValue ?? null,
      new_value: event.newValue ?? null,
      result: event.result,
    });
    if (error) {
      console.error("writePlatformAudit failed", { action: event.action, error: error.message });
    }
  } catch (err) {
    console.error("writePlatformAudit threw", { action: event.action, err });
  }
}
