import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { listPermissionCatalog } from "./permissionCatalog";
import { validatePolicy } from "./policyRules";
import type { PolicyEffect, ScopeType } from "./authorizeCore";

/**
 * FOUNDATION-P0-19 — the tenant's explicit authorization policies (spec
 * §21): deny, or require approval, for permissions in a scope, with
 * exempt roles. The engine reads the active ones on every request
 * (getTenantContext()). Reads use the member's client (RLS); writes use
 * the service role with an explicit tenant filter, and are audited with
 * what changed. Callers check tenant.security.manage first.
 */

export type AuthorizationPolicyRecord = {
  id: string;
  name: string;
  description: string | null;
  effect: PolicyEffect;
  permissions: string[];
  scopeType: ScopeType;
  scopeValues: string[];
  exemptRoleIds: string[];
  status: "active" | "inactive";
  updatedAt: string;
};

type Row = {
  id: string;
  name: string;
  description: string | null;
  effect: PolicyEffect;
  permissions: string[];
  scope_type: ScopeType;
  scope_values: string[];
  exempt_role_ids: string[];
  status: "active" | "inactive";
  updated_at: string;
};

const SELECT = "id, name, description, effect, permissions, scope_type, scope_values, exempt_role_ids, status, updated_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toRecord = (r: Row): AuthorizationPolicyRecord => ({
  id: r.id,
  name: r.name,
  description: r.description,
  effect: r.effect,
  permissions: r.permissions,
  scopeType: r.scope_type,
  scopeValues: r.scope_values,
  exemptRoleIds: r.exempt_role_ids,
  status: r.status,
  updatedAt: r.updated_at,
});

export async function listAuthorizationPolicies(tenantId: string): Promise<AuthorizationPolicyRecord[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("authorization_policies").select(SELECT).eq("tenant_id", tenantId).order("name").limit(200).returns<Row[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toRecord);
}

export async function getAuthorizationPolicy(tenantId: string, id: string): Promise<AuthorizationPolicyRecord | null> {
  if (!UUID_RE.test(id)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("authorization_policies").select(SELECT).eq("tenant_id", tenantId).eq("id", id).maybeSingle<Row>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toRecord(data) : null;
}

function refusal(error: { code?: string; message?: string }): ApiError {
  const msg = error.message ?? "";
  if (error.code === "23505") return new ApiError(409, "POLICY_NAME_TAKEN", "A policy with that name already exists.");
  if (msg.includes("SCOPE_NOT_IN_TENANT")) return new ApiError(400, "SCOPE_NOT_IN_TENANT", "The scope names an application or agent that isn't in this organization.");
  if (msg.includes("ROLE_NOT_IN_TENANT")) return new ApiError(400, "ROLE_NOT_IN_TENANT", "An exempt role isn't in this organization.");
  if (msg.includes("authorization_policies_no_lockout")) return new ApiError(400, "POLICY_LOCKOUT", "A policy can't cover tenant.security.manage.");
  return new ApiError(500, "SAVE_FAILED", msg);
}

export type PolicyResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

async function validated(input: Parameters<typeof validatePolicy>[0]) {
  const catalog = (await listPermissionCatalog()).map((p) => p.key);
  return validatePolicy(input, catalog);
}

const toRow = (v: Extract<ReturnType<typeof validatePolicy>, { ok: true }>["value"]) => ({
  name: v.name,
  description: v.description,
  effect: v.effect,
  permissions: v.permissions,
  scope_type: v.scopeType,
  scope_values: v.scopeValues,
  exempt_role_ids: v.exemptRoleIds,
});

export async function createAuthorizationPolicy(tenantId: string, actorId: string, input: Parameters<typeof validatePolicy>[0]): Promise<PolicyResult> {
  const v = await validated(input);
  if (!v.ok) return v;
  const { data, error } = await supabaseServiceRole()
    .from("authorization_policies")
    .insert({ tenant_id: tenantId, ...toRow(v.value), created_by: actorId, updated_by: actorId })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw refusal(error ?? {});
  await writeAudit({ tenantId, actorId, actorType: "user", action: "authorization_policy.created", objectType: "authorization_policy", objectId: data.id, outcome: "success", metadata: toRow(v.value) });
  return { ok: true, id: data.id };
}

export async function updateAuthorizationPolicy(tenantId: string, actorId: string, id: string, input: Parameters<typeof validatePolicy>[0]): Promise<PolicyResult> {
  const before = await getAuthorizationPolicy(tenantId, id);
  if (!before) throw new ApiError(404, "NOT_FOUND", "No such policy in this organization");
  const v = await validated(input);
  if (!v.ok) return v;
  const { data, error } = await supabaseServiceRole()
    .from("authorization_policies")
    .update({ ...toRow(v.value), updated_by: actorId })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("id");
  if (error) throw refusal(error);
  if (!data?.length) throw new ApiError(404, "NOT_FOUND", "No such policy in this organization");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "authorization_policy.updated",
    objectType: "authorization_policy",
    objectId: id,
    outcome: "success",
    metadata: { before: { effect: before.effect, permissions: before.permissions, scopeType: before.scopeType, scopeValues: before.scopeValues, exemptRoleIds: before.exemptRoleIds }, after: toRow(v.value) },
  });
  return { ok: true, id };
}

export async function setAuthorizationPolicyStatus(tenantId: string, actorId: string, id: string, status: "active" | "inactive"): Promise<void> {
  const { data, error } = await supabaseServiceRole()
    .from("authorization_policies")
    .update({ status, updated_by: actorId })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("name");
  if (error) throw refusal(error);
  if (!data?.length) throw new ApiError(404, "NOT_FOUND", "No such policy in this organization");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: status === "active" ? "authorization_policy.activated" : "authorization_policy.deactivated",
    objectType: "authorization_policy",
    objectId: id,
    outcome: "success",
    metadata: { name: (data[0] as { name: string }).name },
  });
}

export async function deleteAuthorizationPolicy(tenantId: string, actorId: string, id: string): Promise<void> {
  const { data, error } = await supabaseServiceRole().from("authorization_policies").delete().eq("tenant_id", tenantId).eq("id", id).select("name, effect, permissions");
  if (error) throw refusal(error);
  if (!data?.length) throw new ApiError(404, "NOT_FOUND", "No such policy in this organization");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "authorization_policy.deleted", objectType: "authorization_policy", objectId: id, outcome: "success", metadata: data[0] as Record<string, unknown> });
}
