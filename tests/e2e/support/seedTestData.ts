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
  if (existing) return existing.id as string;

  const { data: created, error: insertError } = await supabase.from("tenants").insert({ name: tenant.name, slug: tenant.slug }).select("id").single();
  if (insertError || !created) throw new Error(`ensureTenant(${tenant.slug}) insert failed: ${insertError?.message}`);

  const { error: settingsError } = await supabase.from("tenant_settings").insert({ tenant_id: created.id });
  if (settingsError) throw new Error(`ensureTenant(${tenant.slug}) tenant_settings insert failed: ${settingsError.message}`);

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
    if (spec.isPlatformAdmin) {
      await ensurePlatformAdmin(supabase, userId);
    }
  }

  return { tenantIds: { one: tenantOneId, two: tenantTwoId }, userIds };
}
