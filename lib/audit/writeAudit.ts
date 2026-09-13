import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import type { AuditEvent } from "@/lib/shared/types/foundation";

/**
 * The ONLY sanctioned way any module writes to audit_logs. Uses the
 * service-role client because audit_logs has no client-facing INSERT policy
 * (see supabase/migrations/0005_foundation_audit.sql) — regular authenticated
 * clients can never write or tamper with an audit row. See
 * docs/plan/01-FOUNDATION-AGENT-BACKLOG.md FOUNDATION-P0-05.1.
 *
 * Never throws in a way that aborts the caller's primary action — an audit
 * write failure is logged, not propagated, so a transient audit outage can
 * never block a legitimate user operation. (It also never silently swallows
 * the failure: it always surfaces to server logs.)
 */
export async function writeAudit(event: AuditEvent): Promise<void> {
  try {
    const supabase = supabaseServiceRole();
    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: event.tenantId,
      actor_id: event.actorId ?? null,
      actor_type: event.actorType,
      action: event.action,
      object_type: event.objectType,
      object_id: event.objectId,
      outcome: event.outcome,
      metadata: event.metadata ?? {},
      ...(event.correlationId ? { correlation_id: event.correlationId } : {}),
    });
    if (error) {
      console.error("writeAudit failed", { action: event.action, error: error.message });
    }
  } catch (err) {
    console.error("writeAudit threw", { action: event.action, err });
  }
}
