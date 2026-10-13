import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import type { AddableEnvironment, PlatformTenant, TenantEnvironment } from "@/lib/shared/types/platform";
import { toPlatformTenant } from "./mappers";
import { writePlatformAudit } from "./auditLog";
import { slugProblem } from "@/lib/tenant/host";

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

/**
 * Owner request (2026-10-13): a development, test or staging environment of
 * a production organization. It is its own organization with its own data,
 * at `<slug>-dev` (or -test, -staging), so `<slug>-dev.<BASE_APP_HOST>`; the
 * production organization's active administrators become its administrators.
 * Platform administrators only (owner decision); one transaction in the
 * database (create_tenant_environment, migration 0156); audited.
 */
export const ADDABLE_ENVIRONMENTS: AddableEnvironment[] = ["development", "test", "staging"];

export async function createTenantEnvironment(actorId: string, parentTenantId: string, environment: string): Promise<{ tenantId: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentTenantId)) throw new ApiError(404, "TENANT_NOT_FOUND");
  if (!ADDABLE_ENVIRONMENTS.includes(environment as AddableEnvironment)) throw new ApiError(400, "INVALID_INPUT", "environment: development, test or staging");
  const { data, error } = await supabaseServiceRole().rpc("create_tenant_environment", { p_parent: parentTenantId, p_environment: environment });
  if (error) {
    const reason =
      error.code === "23505" ? "That environment already exists" : error.code === "P0002" ? "Organization not found" : error.code === "22023" || error.code === "23514" ? error.message : null;
    await writePlatformAudit({ actorId, tenantId: parentTenantId, action: "platform.tenant_environment_created", newValue: { environment }, result: "failure" });
    if (reason) throw new ApiError(error.code === "P0002" ? 404 : 409, "ENVIRONMENT_REFUSED", reason);
    throw new ApiError(500, "CREATE_FAILED", "The environment could not be created");
  }
  const tenantId = data as string;
  await writePlatformAudit({ actorId, tenantId, action: "platform.tenant_environment_created", newValue: { parentTenantId, environment }, result: "success" });
  return { tenantId };
}

/**
 * Owner request (2026-10-13): a platform administrator changes an
 * organization's address prefix (its slug) at any time. One transaction in
 * the database (rename_tenant_slug, migration 0157): the slug and the
 * platform subdomain move together, and the old address stops resolving.
 * The uuid, the security identity, never changes. Audited.
 */
export async function renameTenantSlug(actorId: string, tenantId: string, slug: string): Promise<{ from: string; to: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) throw new ApiError(404, "TENANT_NOT_FOUND");
  const to = slug.trim().toLowerCase();
  const problem = slugProblem(to);
  if (problem) throw new ApiError(400, "INVALID_INPUT", `Address: ${problem}`);
  const { data, error } = await supabaseServiceRole().rpc("rename_tenant_slug", { p_tenant: tenantId, p_slug: to });
  if (error) {
    await writePlatformAudit({ actorId, tenantId, action: "platform.tenant_address_changed", newValue: { to }, result: "failure" });
    if (error.code === "23505") throw new ApiError(409, "ADDRESS_TAKEN", `${to} is already taken`);
    if (error.code === "P0002") throw new ApiError(404, "TENANT_NOT_FOUND");
    if (error.code === "22023") throw new ApiError(400, "INVALID_INPUT", "Not a valid address prefix");
    throw new ApiError(500, "UPDATE_FAILED", "The address could not be changed");
  }
  const from = data as string;
  if (from !== to) await writePlatformAudit({ actorId, tenantId, action: "platform.tenant_address_changed", oldValue: { slug: from }, newValue: { slug: to }, result: "success" });
  return { from, to };
}

/** Owner request (2026-10-13): a platform administrator changes an organization's environment later (set_tenant_environment, migration 0157). Audited. */
export async function setTenantEnvironment(actorId: string, tenantId: string, environment: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) throw new ApiError(404, "TENANT_NOT_FOUND");
  if (!["production", "development", "test", "staging", "sandbox"].includes(environment)) throw new ApiError(400, "INVALID_INPUT", "environment: production, development, test, staging or sandbox");
  const before = await getTenant(tenantId);
  const { error } = await supabaseServiceRole().rpc("set_tenant_environment", { p_tenant: tenantId, p_environment: environment });
  if (error) {
    await writePlatformAudit({ actorId, tenantId, action: "platform.tenant_environment_changed", newValue: { environment }, result: "failure" });
    throw new ApiError(error.code === "P0002" ? 404 : 500, "UPDATE_FAILED", "The environment could not be changed");
  }
  await writePlatformAudit({
    actorId,
    tenantId,
    action: "platform.tenant_environment_changed",
    oldValue: { environment: before?.environment ?? "production" },
    newValue: { environment },
    result: "success",
  });
}

/**
 * Every organization, from `tenants` itself: one created by self-service
 * sign-up has no platform record yet and counts as production (owner
 * report 2026-10-13: such organizations were missing from Tenants).
 * Decommissioned ones only when asked for.
 */
const TENANT_COLUMNS = "id, name, slug, status, created_at, platform:platform_tenants!platform_tenants_tenant_id_fkey(environment, notes, created_at, parent_tenant_id)";

type TenantRow = { id: string; name: string; slug: string; status: PlatformTenant["status"]; created_at: string; platform: Record<string, unknown> | Record<string, unknown>[] | null };

function fromTenantRow(r: TenantRow): PlatformTenant {
  const p = (Array.isArray(r.platform) ? r.platform[0] : r.platform) ?? null;
  return {
    tenantId: r.id,
    environment: ((p?.environment as TenantEnvironment | undefined) ?? "production") as TenantEnvironment,
    parentTenantId: (p?.parent_tenant_id as string | null | undefined) ?? null,
    notes: (p?.notes as string | null | undefined) ?? null,
    createdAt: (p?.created_at as string | undefined) ?? r.created_at,
    name: r.name,
    slug: r.slug,
    status: r.status,
  };
}

export async function listTenants(opts: { includeDecommissioned?: boolean } = {}): Promise<PlatformTenant[]> {
  let q = supabaseServiceRole().from("tenants").select(TENANT_COLUMNS);
  if (!opts.includeDecommissioned) q = q.neq("status", "deprovisioned");
  const { data, error } = await q.order("created_at", { ascending: false }).limit(DEFAULT_LIST_LIMIT);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as unknown as TenantRow[]).map(fromTenantRow);
}

export async function getTenant(tenantId: string): Promise<PlatformTenant | null> {
  const { data, error } = await supabaseServiceRole().from("tenants").select(TENANT_COLUMNS).eq("id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? fromTenantRow(data as unknown as TenantRow) : null;
}

type TenantStatus = "active" | "suspended" | "deprovisioned";

async function setTenantStatus(actorId: string, tenantId: string, status: TenantStatus, action: string): Promise<void> {
  const supabase = supabaseServiceRole();
  const { data: previous, error: fetchError } = await supabase.from("tenants").select("status").eq("id", tenantId).maybeSingle();
  if (fetchError) throw new ApiError(500, "QUERY_FAILED", fetchError.message);
  if (!previous) throw new ApiError(404, "TENANT_NOT_FOUND");

  // A platform suspension is not the owner's to lift (migration 0161), even of an organization its owner had disabled.
  const { error } = await supabase
    .from("tenants")
    .update({ status, updated_at: new Date().toISOString(), ...(status === "suspended" ? { disabled_by_owner: false } : {}) })
    .eq("id", tenantId);
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

/** Email domains the E2E suite and SQL fixtures use (tests/e2e/support/testUsers.ts, tests/**.sql). */
const TEST_EMAIL = /@(e2e\.wonderagent\.test|example\.test)$/i;

/**
 * Owner request (2026-10-13): keep test organizations apart from real ones
 * in the console. A test organization has a test slug (`e2e-`, `fixture-`)
 * or members who are all test accounts. Read with the service role, the
 * ids given only; used for display, never for access.
 */
export async function testTenantIds(tenants: { tenantId: string; slug?: string }[]): Promise<Set<string>> {
  const out = new Set(tenants.filter((t) => /^(e2e-|fixture-)/.test(t.slug ?? "")).map((t) => t.tenantId));
  const rest = tenants.filter((t) => !out.has(t.tenantId)).map((t) => t.tenantId);
  if (!rest.length) return out;
  const { data, error } = await supabaseServiceRole().from("tenant_memberships").select("tenant_id, users!tenant_memberships_user_id_fkey(email)").in("tenant_id", rest).limit(5000);
  if (error) return out;
  const emails = new Map<string, string[]>();
  for (const r of (data ?? []) as unknown as { tenant_id: string; users: { email: string } | { email: string }[] | null }[]) {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    emails.set(r.tenant_id, [...(emails.get(r.tenant_id) ?? []), u?.email ?? ""]);
  }
  for (const [id, list] of emails) if (list.length && list.every((e) => TEST_EMAIL.test(e))) out.add(id);
  return out;
}

/**
 * Owner request (2026-10-13): remove an environment from its organization.
 * It is decommissioned (data kept, nobody signs in), and its address and
 * slot are freed so the same environment can be added again
 * (remove_tenant_environment, migration 0160). Never production. Audited.
 */
export async function removeTenantEnvironment(actorId: string, tenantId: string): Promise<{ address: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) throw new ApiError(404, "TENANT_NOT_FOUND");
  const before = await getTenant(tenantId);
  const { data, error } = await supabaseServiceRole().rpc("remove_tenant_environment", { p_tenant: tenantId });
  if (error) {
    await writePlatformAudit({ actorId, tenantId, action: "platform.tenant_environment_removed", result: "failure" });
    if (error.code === "22023") throw new ApiError(409, "NOT_AN_ENVIRONMENT", "Only a development, test or staging environment of an organization can be removed");
    throw new ApiError(500, "REMOVE_FAILED", "The environment could not be removed");
  }
  await writePlatformAudit({
    actorId,
    tenantId,
    action: "platform.tenant_environment_removed",
    oldValue: { slug: data, environment: before?.environment, parentTenantId: before?.parentTenantId },
    newValue: { status: "deprovisioned" },
    result: "success",
  });
  return { address: data as string };
}

/**
 * Owner request (2026-10-13): an organization's owners in the console: the
 * active administrators (TENANT_SUPER_ADMIN) of each tenant given. Service
 * role, the given tenants only; for display.
 */
export async function organizationOwners(tenantIds: string[]): Promise<Map<string, { userId: string; email: string; name: string | null }[]>> {
  const out = new Map<string, { userId: string; email: string; name: string | null }[]>();
  if (!tenantIds.length) return out;
  const admin = supabaseServiceRole();
  const { data: role } = await admin.from("roles").select("id").is("tenant_id", null).eq("name", "TENANT_SUPER_ADMIN").maybeSingle();
  if (!role) return out;
  const [{ data: grants }, { data: members }] = await Promise.all([
    admin.from("user_roles").select("tenant_id, user_id").eq("role_id", role.id).in("tenant_id", tenantIds).limit(5000),
    admin.from("tenant_memberships").select("tenant_id, user_id").eq("status", "active").in("tenant_id", tenantIds).limit(5000),
  ]);
  const active = new Set(((members ?? []) as { tenant_id: string; user_id: string }[]).map((m) => `${m.tenant_id}|${m.user_id}`));
  const pairs = ((grants ?? []) as { tenant_id: string; user_id: string }[]).filter((g) => active.has(`${g.tenant_id}|${g.user_id}`));
  const userIds = [...new Set(pairs.map((p) => p.user_id))];
  const { data: users } = userIds.length ? await admin.from("users").select("id, email, display_name").in("id", userIds) : { data: [] };
  const byId = new Map(((users ?? []) as { id: string; email: string; display_name: string | null }[]).map((u) => [u.id, u]));
  for (const p of pairs) {
    const u = byId.get(p.user_id);
    if (!u) continue;
    out.set(p.tenant_id, [...(out.get(p.tenant_id) ?? []), { userId: u.id, email: u.email, name: u.display_name }]);
  }
  return out;
}
