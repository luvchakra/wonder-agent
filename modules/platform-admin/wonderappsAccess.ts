import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { writePlatformAudit } from "./auditLog";

/**
 * Owner decision (13 October 2026): the WonderApps dashboard (the owner's
 * company platform) reads WonderID's data across organizations through the
 * `wonderapps_dashboard` database role, under a switch a platform
 * administrator turns on or off here (migration 0155). On: read grants on
 * the tables its policies cover (never the encrypted AI key). Off: every
 * grant revoked. Vendor-only (callers pass requirePlatformAdmin()), and
 * every change is written to platform_audit_logs with the before/after
 * state (#11).
 */

/** Whether WonderApps can read now; null when the state cannot be read (the console says so). */
export async function getWonderappsDashboardAccess(): Promise<boolean | null> {
  const { data, error } = await supabaseServiceRole().rpc("wonderapps_dashboard_access");
  if (error) return null;
  return data === true;
}

/** Turns the access on or off and audits it. Returns the state the database reports afterwards. */
export async function setWonderappsDashboardAccess(actorId: string, enabled: boolean): Promise<boolean> {
  const before = await getWonderappsDashboardAccess();
  const { data, error } = await supabaseServiceRole().rpc("set_wonderapps_dashboard_access", { p_enabled: enabled });
  if (error) {
    await writePlatformAudit({ actorId, action: "platform.wonderapps_dashboard_access_changed", oldValue: { enabled: before }, newValue: { requested: enabled }, result: "failure" });
    throw new ApiError(500, "UPDATE_FAILED", "WonderApps access could not be changed. Nothing was changed; try again.");
  }
  const after = data === true;
  await writePlatformAudit({ actorId, action: "platform.wonderapps_dashboard_access_changed", oldValue: { enabled: before }, newValue: { enabled: after }, result: after === enabled ? "success" : "failure" });
  if (after !== enabled) throw new ApiError(500, "UPDATE_FAILED", "The database did not confirm the change.");
  return after;
}
