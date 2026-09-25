import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { EmergencyControl, EmergencyControlType } from "@/lib/shared/types/runtime";
import type { RuntimeEmergencyState } from "@/modules/access-governance/service";

/**
 * RUNTIME-P0-18 — emergency controls (master stories P0-35).
 *
 * The kill switch, tool and MCP-server suspension and session termination
 * are stored as rows the Runtime Gateway reads on every request. The
 * decision engine denies a request any active control covers.
 *
 * Engaging or lifting a control is an emergency action. The caller must
 * hold `runtime.emergency` (checked by the route or server action), must
 * give a reason (enforced here and by the database), and the action is
 * audited (#11). The confirmation is the UI's ConfirmActionDialog.
 * Controls are lifted, never deleted, so their history stays.
 */

export const EMERGENCY_CONTROL_TYPES: readonly EmergencyControlType[] = [
  "kill_switch",
  "tool_suspension",
  "mcp_server_suspension",
  "session_termination",
];

type ControlRow = {
  id: string;
  tenant_id: string;
  control_type: EmergencyControlType;
  target: string | null;
  reason: string;
  engaged_by: string | null;
  engaged_at: string;
  lifted_by: string | null;
  lifted_at: string | null;
  lift_reason: string | null;
};

function toControl(row: ControlRow): EmergencyControl {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    controlType: row.control_type,
    target: row.target,
    reason: row.reason,
    engagedBy: row.engaged_by,
    engagedAt: row.engaged_at,
    liftedBy: row.lifted_by,
    liftedAt: row.lifted_at,
    liftReason: row.lift_reason,
    active: row.lifted_at === null,
  };
}

/** Folds active control rows into the state the decision engine reads. Pure. */
export function toEmergencyState(rows: Array<Pick<ControlRow, "control_type" | "target">>): RuntimeEmergencyState {
  const state: RuntimeEmergencyState = { killSwitch: false, suspendedTools: [], suspendedMcpServers: [], terminatedSessions: [] };
  for (const r of rows) {
    if (r.control_type === "kill_switch") state.killSwitch = true;
    else if (r.control_type === "tool_suspension" && r.target) state.suspendedTools.push(r.target);
    else if (r.control_type === "mcp_server_suspension" && r.target) state.suspendedMcpServers.push(r.target);
    else if (r.control_type === "session_termination" && r.target) state.terminatedSessions.push(r.target);
  }
  return state;
}

/**
 * The gateway's read of the active controls, through the service role
 * (there is no user session on a gateway call), filtered to the tenant
 * taken from the verified key. It throws on failure, and the decision then
 * fails closed.
 */
export async function loadActiveEmergencyState(tenantId: string): Promise<RuntimeEmergencyState> {
  const { data, error } = await supabaseServiceRole()
    .from("runtime_emergency_controls")
    .select("tenant_id, control_type, target")
    .eq("tenant_id", tenantId)
    .is("lifted_at", null);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return toEmergencyState(((data ?? []) as Array<ControlRow>).filter((r) => r.tenant_id === tenantId));
}

/** For the customer UI: the user's own tenant, through RLS plus an explicit filter. */
export async function listEmergencyControls(tenantId: string, opts: { activeOnly?: boolean; limit?: number } = {}): Promise<EmergencyControl[]> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("runtime_emergency_controls")
    .select()
    .eq("tenant_id", tenantId)
    .order("engaged_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 50, 200));
  if (opts.activeOnly) query = query.is("lifted_at", null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as ControlRow[]).map(toControl);
}

export async function engageEmergencyControl(
  tenantId: string,
  actorId: string,
  input: { controlType: string; target?: string | null; reason: string },
): Promise<EmergencyControl> {
  if (!EMERGENCY_CONTROL_TYPES.includes(input.controlType as EmergencyControlType)) {
    throw new ApiError(400, "VALIDATION_FAILED", `controlType must be one of: ${EMERGENCY_CONTROL_TYPES.join(", ")}`);
  }
  const controlType = input.controlType as EmergencyControlType;
  const reason = input.reason?.trim() ?? "";
  if (!reason || reason.length > 500) throw new ApiError(400, "VALIDATION_FAILED", "A reason (up to 500 characters) is required");
  const target = controlType === "kill_switch" ? null : input.target?.trim() ?? "";
  if (controlType !== "kill_switch" && (!target || target.length > 200)) {
    throw new ApiError(400, "VALIDATION_FAILED", "A target (tool, MCP server or session id, up to 200 characters) is required");
  }

  const { data, error } = await supabaseServiceRole()
    .from("runtime_emergency_controls")
    .insert({ tenant_id: tenantId, control_type: controlType, target, reason, engaged_by: actorId })
    .select()
    .single<ControlRow>();
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "ALREADY_ENGAGED", "That control is already engaged");
    throw new ApiError(500, "CREATE_FAILED", error.message);
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "runtime.emergency_control_engaged",
    objectType: "runtime_emergency_control",
    objectId: data.id,
    outcome: "success",
    metadata: { controlType, target, reason },
  });
  return toControl(data);
}

export async function liftEmergencyControl(tenantId: string, actorId: string, controlId: string, reason: string): Promise<EmergencyControl> {
  const liftReason = reason?.trim() ?? "";
  if (!liftReason || liftReason.length > 500) throw new ApiError(400, "VALIDATION_FAILED", "A reason (up to 500 characters) is required");
  const supabase = supabaseServiceRole();
  const { data: existing, error: readError } = await supabase
    .from("runtime_emergency_controls")
    .select()
    .eq("id", controlId)
    .eq("tenant_id", tenantId)
    .maybeSingle<ControlRow>();
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  if (!existing || existing.tenant_id !== tenantId) throw new ApiError(404, "CONTROL_NOT_FOUND");
  if (existing.lifted_at) return toControl(existing);

  const { data, error } = await supabase
    .from("runtime_emergency_controls")
    .update({ lifted_at: new Date().toISOString(), lifted_by: actorId, lift_reason: liftReason })
    .eq("id", controlId)
    .eq("tenant_id", tenantId)
    .select()
    .single<ControlRow>();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to lift control");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "runtime.emergency_control_lifted",
    objectType: "runtime_emergency_control",
    objectId: controlId,
    outcome: "success",
    metadata: { controlType: existing.control_type, target: existing.target, reason: liftReason },
  });
  return toControl(data);
}
