import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TENANT_ONE, TENANT_TWO, TEST_USERS, type TestUserKey } from "./testUsers";

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "tests/e2e/support/seedTestData.ts requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(the same dev Supabase project the app itself runs against — see .env.local.example). " +
        "Set them before running `npm run test:e2e`.",
    );
  }
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function ensureTenant(supabase: SupabaseClient, tenant: { name: string; slug: string }): Promise<string> {
  const { data: existing, error: selectError } = await supabase.from("tenants").select("id").eq("slug", tenant.slug).maybeSingle();
  if (selectError) throw new Error(`ensureTenant(${tenant.slug}) select failed: ${selectError.message}`);
  if (existing) {
    // Idempotent for tenants seeded before this helper existed, too.
    await ensurePlatformTenant(supabase, existing.id as string);
    return existing.id as string;
  }

  const { data: created, error: insertError } = await supabase.from("tenants").insert({ name: tenant.name, slug: tenant.slug }).select("id").single();
  if (insertError || !created) throw new Error(`ensureTenant(${tenant.slug}) insert failed: ${insertError?.message}`);

  const { error: settingsError } = await supabase.from("tenant_settings").insert({ tenant_id: created.id });
  if (settingsError) throw new Error(`ensureTenant(${tenant.slug}) tenant_settings insert failed: ${settingsError.message}`);

  await ensurePlatformTenant(supabase, created.id as string);
  return created.id as string;
}

/**
 * `auth.admin.createUser` errors on an already-registered email rather
 * than returning the existing user, and older supabase-js versions have
 * no direct "get auth user by email" admin call — but `public.users`
 * mirrors `auth.users` 1:1 via the `handle_new_user()` trigger
 * (supabase/migrations/0002_foundation_users.sql), so falling back to a
 * plain table lookup there is reliable and version-independent.
 */
/**
 * The vendor console lists platform_tenants, not tenants — that row is
 * created by the platform-admin "create tenant" flow, so a tenant seeded
 * straight into `tenants` (as this fixture does, and as every tests/**\/*.sql
 * fixture does) is invisible at /platform-admin/tenants. Mirroring the real
 * flow here keeps platform-admin.spec.ts meaningful instead of asserting
 * against a tenant the console was never going to show.
 */
async function ensurePlatformTenant(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const { error } = await supabase.from("platform_tenants").upsert({ tenant_id: tenantId }, { onConflict: "tenant_id" });
  if (error) throw new Error(`ensurePlatformTenant(${tenantId}) failed: ${error.message}`);
}

async function ensureAuthUser(supabase: SupabaseClient, email: string, password: string): Promise<string> {
  const { data: existing, error: selectError } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
  if (selectError) throw new Error(`ensureAuthUser(${email}) select failed: ${selectError.message}`);
  if (existing) return existing.id as string;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw new Error(`ensureAuthUser(${email}) createUser failed: ${createError?.message}`);
  return created.user.id;
}

async function ensureMembership(supabase: SupabaseClient, tenantId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("tenant_memberships").upsert({ tenant_id: tenantId, user_id: userId, status: "active" }, { onConflict: "tenant_id,user_id" });
  if (error) throw new Error(`ensureMembership(${tenantId}, ${userId}) failed: ${error.message}`);
}

async function ensureRole(supabase: SupabaseClient, tenantId: string, userId: string, roleName: string): Promise<void> {
  const { data: role, error: roleError } = await supabase.from("roles").select("id").is("tenant_id", null).eq("name", roleName).maybeSingle();
  if (roleError) throw new Error(`ensureRole lookup for ${roleName} failed: ${roleError.message}`);
  if (!role) throw new Error(`System role template "${roleName}" not found — has supabase/migrations/0003_foundation_rbac.sql been applied to this project?`);

  const { error } = await supabase.from("user_roles").upsert({ tenant_id: tenantId, user_id: userId, role_id: role.id }, { onConflict: "tenant_id,user_id,role_id" });
  if (error) throw new Error(`ensureRole(${tenantId}, ${userId}, ${roleName}) failed: ${error.message}`);
}

async function ensurePlatformAdmin(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase.from("platform_admins").upsert({ user_id: userId, granted_by: userId }, { onConflict: "user_id" });
  if (error) throw new Error(`ensurePlatformAdmin(${userId}) failed: ${error.message}`);
}

/**
 * The sign-in server action rate-limits 10 attempts per email AND per IP
 * per 5 minutes (app/actions/auth.ts). A full E2E run signs in far more
 * often than that from a single address — the setup project alone logs in
 * as five roles, and auth.spec.ts adds more — so without this the suite
 * throttles itself and every later login fails with "Too many sign-in
 * attempts", which looks like an auth bug and isn't one. Observed for real
 * on this suite's first green-ish run.
 *
 * Clears only the throttle counters: the seeded test identities' own rows,
 * plus the IP buckets (which regenerate immediately and hold no audit
 * value — real audit lives in audit_logs). Deliberately does NOT touch
 * other users' email buckets. This is one more reason the suite must only
 * ever be pointed at the dev project, as playwright.config.ts documents.
 */
export async function clearAuthRateLimits(): Promise<void> {
  const supabase = adminClient();
  const emails = Object.values(TEST_USERS).map((u) => u.email);
  const { error: byEmail } = await supabase.from("auth_rate_limit_attempts").delete().in("subject", emails);
  if (byEmail) throw new Error(`clearAuthRateLimits(email) failed: ${byEmail.message}`);
  const { error: byIp } = await supabase.from("auth_rate_limit_attempts").delete().in("bucket", ["signin:ip", "signup:ip", "password-reset:ip"]);
  if (byIp) throw new Error(`clearAuthRateLimits(ip) failed: ${byIp.message}`);
}

/**
 * Every run of agents/access/runtime/financebot registers new agents and
 * never removes them, so the E2E tenants grow without bound: nine runs had
 * left 43 agents in Tenant One. That is not just untidy — campaign launch
 * populates certification items per agent, so the suite got measurably
 * slower every run (~440ms per agent; 19s by the time it was noticed, past
 * Playwright's 10s expect timeout) and would eventually fail on time alone.
 *
 * Pruning back to the stable fixture agents at the start of each run makes
 * the suite repeatable and keeps its runtime flat. Safe and complete: every
 * child FK of `agents` is ON DELETE CASCADE (one SET NULL), so identities,
 * contracts, owners, grants, runtime events, findings and certification
 * items all go with it. Scoped to the two `e2e-*` tenants only.
 */
export async function pruneThrowawayAgents(tenantIds: string[]): Promise<void> {
  const supabase = adminClient();
  const keep = [TENANT_ONE, TENANT_TWO].map((t) => `"E2E Agent ${t.slug}"`).join(",");
  for (const tenantId of tenantIds) {
    const { error } = await supabase
      .from("agents")
      .delete()
      .eq("tenant_id", tenantId)
      .not("agent_name", "in", `(${keep})`);
    if (error) throw new Error(`pruneThrowawayAgents(${tenantId}) failed: ${error.message}`);
  }
}

/**
 * Same reasoning as pruneThrowawayAgents(), for what specs create beside
 * agents (2026-09-25): integrations named "E2E …" (credentials, sync jobs,
 * objects and mappings cascade), data sources named "E2E …" and runtime
 * quarantine rows. Left alone,
 * integrations piled up to 25 in Tenant One and the discovery page
 * measurably slowed, and old Shadow AI quarantine rows outlived the agents
 * registered from them. Scoped to the two `e2e-*` tenants only.
 */
export async function pruneThrowawayIntegrationsAndQuarantine(tenantIds: string[]): Promise<void> {
  const supabase = adminClient();
  for (const tenantId of tenantIds) {
    const integrations = await supabase.from("integrations").delete().eq("tenant_id", tenantId).like("name", "E2E %");
    if (integrations.error) throw new Error(`prune integrations(${tenantId}) failed: ${integrations.error.message}`);
    // ACCESS-P0-13: throwaway data sources (entitlements pointing at one fall back to null).
    const dataSources = await supabase.from("data_sources").delete().eq("tenant_id", tenantId).like("name", "E2E %");
    if (dataSources.error) throw new Error(`prune data sources(${tenantId}) failed: ${dataSources.error.message}`);
    // Throwaway applications named "E2E …" (2026-09-26): specs create one per
    // run, and at 200+ they pushed seeded ones like "Snowflake" past the
    // 200-row list limit of the pickers that data-sources.spec uses. Their
    // access requests go first (the only foreign key that doesn't cascade).
    const { data: apps, error: appsError } = await supabase.from("applications").select("id").eq("tenant_id", tenantId).like("name", "E2E %");
    if (appsError) throw new Error(`list throwaway applications(${tenantId}) failed: ${appsError.message}`);
    const appIds = (apps ?? []).map((a) => a.id as string);
    for (let i = 0; i < appIds.length; i += 100) {
      const batch = appIds.slice(i, i + 100);
      const requests = await supabase.from("access_requests").delete().eq("tenant_id", tenantId).in("application_id", batch);
      if (requests.error) throw new Error(`prune throwaway access requests(${tenantId}) failed: ${requests.error.message}`);
      const deleted = await supabase.from("applications").delete().eq("tenant_id", tenantId).in("id", batch);
      if (deleted.error) throw new Error(`prune throwaway applications(${tenantId}) failed: ${deleted.error.message}`);
    }
    // Throwaway custom roles named "E2E …" (FOUNDATION-P0-25), with their assignments.
    const { data: roles } = await supabase.from("roles").select("id").eq("tenant_id", tenantId).like("name", "E2E %");
    const roleIds = (roles ?? []).map((r) => r.id as string);
    if (roleIds.length) {
      await supabase.from("user_roles").delete().eq("tenant_id", tenantId).in("role_id", roleIds);
      const deletedRoles = await supabase.from("roles").delete().eq("tenant_id", tenantId).in("id", roleIds);
      if (deletedRoles.error) throw new Error(`prune throwaway roles(${tenantId}) failed: ${deletedRoles.error.message}`);
    }
    // Throwaway groups named "E2E …" (FOUNDATION-P0-26); members and roles cascade.
    const groups = await supabase.from("groups").delete().eq("tenant_id", tenantId).like("name", "E2E %");
    if (groups.error) throw new Error(`prune throwaway groups(${tenantId}) failed: ${groups.error.message}`);
    const quarantine = await supabase.from("runtime_event_quarantine").delete().eq("tenant_id", tenantId);
    if (quarantine.error) throw new Error(`prune quarantine(${tenantId}) failed: ${quarantine.error.message}`);
  }
}

/**
 * Generates a real Supabase Auth recovery link for `email` without sending
 * any mail — bypasses the project's built-in-SMTP quota entirely (see the
 * "fresh, valid email" sign-up test's own comment on that quota), and lets
 * a spec drive the actual forgot-password round trip end to end: navigate
 * to the returned link exactly as a clicked email link would, land on
 * app/auth/callback/route.ts's code-exchange, and continue to
 * /update-password. `redirectTo` must match `requestPasswordResetAction`'s
 * own shape (`${origin}/auth/callback?next=/update-password`) since that is
 * what a real password-reset email would carry.
 */
export async function generateRecoveryActionLink(email: string, redirectTo: string): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    throw new Error(`generateRecoveryActionLink(${email}) failed: ${error?.message ?? "no action_link returned"}`);
  }
  return data.properties.action_link;
}

/**
 * Resolves a seeded identity's user id. Some screens take a raw user id as
 * input (the agent-detail "Assign owner" form asks for a uuid, since there
 * is no member picker yet), and a spec has no other way to learn it.
 */
export async function getSeededUserId(email: string): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
  if (error) throw new Error(`getSeededUserId(${email}) failed: ${error.message}`);
  if (!data) throw new Error(`getSeededUserId(${email}): no such user — has seedTestData() run?`);
  return data.id as string;
}

export type SeededTestData = {
  tenantIds: { one: string; two: string };
  userIds: Record<TestUserKey, string>;
};

/**
 * Idempotent — safe to run before every E2E run (local or CI) without
 * accumulating duplicate rows or erroring on a second run. Called once
 * from tests/e2e/auth.setup.ts, before any role logs in.
 */
export async function seedTestData(): Promise<SeededTestData> {
  const supabase = adminClient();

  const tenantOneId = await ensureTenant(supabase, TENANT_ONE);
  const tenantTwoId = await ensureTenant(supabase, TENANT_TWO);

  const userIds = {} as Record<TestUserKey, string>;
  for (const [key, spec] of Object.entries(TEST_USERS) as [TestUserKey, (typeof TEST_USERS)[TestUserKey]][]) {
    const userId = await ensureAuthUser(supabase, spec.email, spec.password);
    userIds[key] = userId;

    if (spec.tenant && spec.role) {
      const tenantId = spec.tenant.slug === TENANT_ONE.slug ? tenantOneId : tenantTwoId;
      await ensureMembership(supabase, tenantId, userId);
      await ensureRole(supabase, tenantId, userId, spec.role);
    }
    if (spec.alsoIn) {
      const tenantId = spec.alsoIn.tenant.slug === TENANT_ONE.slug ? tenantOneId : tenantTwoId;
      await ensureMembership(supabase, tenantId, userId);
      await ensureRole(supabase, tenantId, userId, spec.alsoIn.role);
    }
    if (spec.isPlatformAdmin) {
      await ensurePlatformAdmin(supabase, userId);
    }
  }

  return { tenantIds: { one: tenantOneId, two: tenantTwoId }, userIds };
}
