import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getTenantIdBySlug } from "./seedFinanceBotAccess";

/**
 * ACCESS-P0-17 — a connector that has already imported accounts, for the
 * account-inventory spec. A real sync needs a reachable target system, so
 * this writes what a succeeded sync leaves behind (an integration, a
 * succeeded sync job and its `account` objects) through Supabase's Admin
 * API, the same way seedFinanceBotAccess seeds CAN. Everything after this
 * (onboarding, reconciliation, the inventory) runs through the app.
 */

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type SeedAccount = { externalId: string; raw: Record<string, unknown> };

export async function seedIntegrationWithAccounts(tenantSlug: string, name: string, accounts: SeedAccount[]): Promise<string> {
  const supabase = adminClient();
  const tenantId = await getTenantIdBySlug(tenantSlug);
  const { data: integration, error } = await supabase
    .from("integrations")
    .insert({ tenant_id: tenantId, integration_type_id: "generic_rest", name, config: { baseUrl: "https://accounts.example.test" }, capabilities: { importAccounts: true }, status: "connected" })
    .select("id")
    .single();
  if (error || !integration) throw new Error(`seedIntegrationWithAccounts: integration insert failed: ${error?.message}`);
  const now = new Date().toISOString();
  const { data: job, error: jobError } = await supabase
    .from("integration_sync_jobs")
    .insert({ tenant_id: tenantId, integration_id: integration.id, trigger: "manual", status: "succeeded", started_at: now, ended_at: now, records_processed: accounts.length })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`seedIntegrationWithAccounts: sync job insert failed: ${jobError?.message}`);
  await replaceIntegrationAccounts(integration.id as string, tenantId, accounts, job.id as string);
  return integration.id as string;
}

/** What a later sync would leave: exactly these accounts. */
export async function replaceIntegrationAccounts(integrationId: string, tenantId: string, accounts: SeedAccount[], syncJobId: string | null = null): Promise<void> {
  const supabase = adminClient();
  const { error: delError } = await supabase.from("integration_objects").delete().eq("tenant_id", tenantId).eq("integration_id", integrationId).eq("object_type", "account");
  if (delError) throw new Error(`replaceIntegrationAccounts: delete failed: ${delError.message}`);
  if (!accounts.length) return;
  const { error } = await supabase.from("integration_objects").insert(
    accounts.map((a) => ({ tenant_id: tenantId, integration_id: integrationId, object_type: "account", external_id: a.externalId, raw: a.raw, normalized: {}, sync_job_id: syncJobId })),
  );
  if (error) throw new Error(`replaceIntegrationAccounts: insert failed: ${error.message}`);
}
