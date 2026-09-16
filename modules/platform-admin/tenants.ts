import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import type { PlatformTenant, TenantEnvironment } from "@/lib/shared/types/platform";
import { toPlatformTenant } from "./mappers";
import { writePlatformAudit } from "./auditLog";

export type CreateTenantInput = {
  name: string;
  slug: string;
  environment?: TenantEnvironment;
  notes?: string;
};

/**
 * PLATFORM-P0-02.2. Platform-initiated tenant creation, distinct from
 * Foundation's self-service `create_tenant_with_owner()` RPC (migration
 * 0008) — both paths coexist, since a vendor may provision a tenant before
 * any customer user exists to sign up into it. Mirrors Foundation's own
 * `tenants`/`tenant_settings` insert shape for consistency but does not
 * create a membership/owner (there may be no user yet) — that happens
 * separately when the customer's first admin signs up or is invited.
 */
export async function createTenant(actorId: string, input: CreateTenantInput): Promise<PlatformTenant> {
  if (!input.name.trim() || !input.slug.trim()) {
    throw new ApiError(400, "INVALID_INPUT", "name and slug are required");
  }

  const supabase = supabaseServiceRole();
  const { data: tenant, error: tenantError } = await supabase.from("tenants").insert({ name: input.name, slug: input.slug }).select().single();
  if (tenantError || !tenant) throw new ApiError(500, "CREATE_FAILED", tenantError?.message ?? "Failed to create tenant");

  const { error: settingsError } = await supabase.from("tenant_settings").insert({ tenant_id: tenant.id });
  if (settingsError) throw new ApiError(500, "CREATE_FAILED", settingsError.message);

  const { data: platformTenant, error: platformTenantError } = await supabase
    .from("platform_tenants")
    .insert({ tenant_id: tenant.id, environment: input.environment ?? "production", notes: input.notes ?? null })
    .select()
    .single();
  if (platformTenantError || !platformTenant) throw new ApiError(500, "CREATE_FAILED", platformTenantError?.message ?? "Failed to create platform tenant record");

  await writePlatformAudit({
    actorId,
    tenantId: tenant.id,
    action: "platform.tenant_created",
    newValue: { name: input.name, slug: input.slug, environment: input.environment ?? "production" },
    result: "success",
  });

  return { ...toPlatformTenant(platformTenant), name: tenant.name, slug: tenant.slug, status: tenant.status };
}

export async function listTenants(): Promise<PlatformTenant[]> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("platform_tenants")
    .select("*, tenants(name, slug, status)")
    .order("created_at", { ascending: false })
    .limit(DEFAULT_LIST_LIMIT);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPlatformTenant);
}

export async function getTenant(tenantId: string): Promise<PlatformTenant | null> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase.from("platform_tenants").select("*, tenants(name, slug, status)").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toPlatformTenant(data) : null;
}

type TenantStatus = "active" | "suspended" | "deprovisioned";

async function setTenantStatus(actorId: string, tenantId: string, status: TenantStatus, action: string): Promise<void> {
  const supabase = supabaseServiceRole();
  const { data: previous, error: fetchError } = await supabase.from("tenants").select("status").eq("id", tenantId).maybeSingle();
  if (fetchError) throw new ApiError(500, "QUERY_FAILED", fetchError.message);
  if (!previous) throw new ApiError(404, "TENANT_NOT_FOUND");

  const { error } = await supabase.from("tenants").update({ status, updated_at: new Date().toISOString() }).eq("id", tenantId);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);

  await writePlatformAudit({
    actorId,
    tenantId,
    action,
    oldValue: { status: previous.status },
    newValue: { status },
    result: "success",
  });
}

/**
 * Flagged, not silently assumed: this story says "Foundation's RLS/
 * authorization must already deny active use of a suspended tenant —
 * verify this holds rather than duplicating the check here." It does
 * NOT currently hold — `current_tenant_ids()` (migration 0004) filters
 * only on `tenant_memberships.status = 'active'`, never on
 * `tenants.status`, so a suspended tenant's members retain full RLS
 * access to every tenant-scoped table. This is a real, live gap in
 * Foundation's shared RLS function, not a Platform Agent implementation
 * choice — recorded prominently in this module's audit log (and echoed to
 * the user directly) rather than silently patched here: modifying
 * `current_tenant_ids()` is Foundation's shared authentication-model
 * function to change, not this module's (non-negotiable #14/#18).
 * `tenants.status` is still updated correctly below — the gap is entirely
 * in enforcement, not in this function.
 */
export async function suspendTenant(actorId: string, tenantId: string): Promise<void> {
  await setTenantStatus(actorId, tenantId, "suspended", "platform.tenant_suspended");
}

export async function activateTenant(actorId: string, tenantId: string): Promise<void> {
  await setTenantStatus(actorId, tenantId, "active", "platform.tenant_activated");
}

/**
 * Soft decommission only — sets tenants.status = 'deprovisioned'. Actual
 * data deletion is a deliberately separate, explicitly-confirmed
 * destructive action that this function never performs, per the backlog's
 * explicit instruction.
 */
export async function decommissionTenant(actorId: string, tenantId: string): Promise<void> {
  await setTenantStatus(actorId, tenantId, "deprovisioned", "platform.tenant_decommissioned");
}
