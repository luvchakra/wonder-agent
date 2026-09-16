import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function ensureApplication(supabase: SupabaseClient, tenantId: string, name: string): Promise<string> {
  const { data: existing, error: selectError } = await supabase.from("applications").select("id").eq("tenant_id", tenantId).eq("name", name).maybeSingle();
  if (selectError) throw new Error(`ensureApplication(${name}) select failed: ${selectError.message}`);
  if (existing) return existing.id as string;

  const { data: created, error: insertError } = await supabase.from("applications").insert({ tenant_id: tenantId, name }).select("id").single();
  if (insertError || !created) throw new Error(`ensureApplication(${name}) insert failed: ${insertError?.message}`);
  return created.id as string;
}

export async function getTenantIdBySlug(slug: string): Promise<string> {
  const supabase = adminClient();
  const { data, error } = await supabase.from("tenants").select("id").eq("slug", slug).single();
  if (error || !data) throw new Error(`getTenantIdBySlug(${slug}) failed: ${error?.message ?? "not found"}`);
  return data.id as string;
}

export type FinanceBotAccess = {
  snowflakeApplicationId: string;
  customerDbEntitlementId: string;
  customerDbGrantId: string;
};

/**
 * QA-P0-03.1 / CLAUDE.md §11's central acceptance scenario, its CAN half.
 * There is no UI path to create an `accounts` row (they only ever arrive
 * via an integration sync — see docs/design/qa-agent-backlog-audit.md's
 * note on this real product gap) — so this seeds the same
 * Application → Account → Entitlement → AccessGrant chain
 * `tests/access/financebot-scenario-and-tenant-isolation.sql` already
 * builds at the SQL-fixture level, but through Supabase's Admin API so
 * `financebot-central-scenario.spec.ts` can drive the SHOULD (contract,
 * via the real UI form) and DID (a real runtime-event submission) halves
 * of the same scenario through the browser. `dataClassification:
 * "customer_data"` is deliberately NOT compatible with the contract's
 * "financial reporting" approved data (modules/runtime-assurance/
 * compare.ts's `classificationsCompatible()` is a case-insensitive
 * substring match either direction) — this is the specific mismatch the
 * PRD scenario turns into an `excessive_access` finding.
 */
export async function seedFinanceBotAccess(tenantId: string, agentId: string): Promise<FinanceBotAccess> {
  const supabase = adminClient();

  const snowflakeApplicationId = await ensureApplication(supabase, tenantId, "Snowflake");

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .insert({ tenant_id: tenantId, agent_id: agentId, application_id: snowflakeApplicationId, external_account_ref: `financebot-svc-${agentId.slice(0, 8)}` })
    .select("id")
    .single();
  if (accountError || !account) throw new Error(`seedFinanceBotAccess: account insert failed: ${accountError?.message}`);

  const { data: entitlement, error: entitlementError } = await supabase
    .from("entitlements")
    .insert({ tenant_id: tenantId, application_id: snowflakeApplicationId, name: "CustomerDB_READ", data_classification: "customer_data", privilege_level: "standard" })
    .select("id")
    .single();
  if (entitlementError || !entitlement) throw new Error(`seedFinanceBotAccess: entitlement insert failed: ${entitlementError?.message}`);

  const { data: grant, error: grantError } = await supabase
    .from("access_grants")
    .insert({ tenant_id: tenantId, account_id: account.id, entitlement_id: entitlement.id, grant_type: "direct" })
    .select("id")
    .single();
  if (grantError || !grant) throw new Error(`seedFinanceBotAccess: grant insert failed: ${grantError?.message}`);

  return { snowflakeApplicationId, customerDbEntitlementId: entitlement.id as string, customerDbGrantId: grant.id as string };
}
