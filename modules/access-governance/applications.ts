import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import type { Account, AccountStatus, Application } from "@/lib/shared/types/access-governance";
import { toAccount, toApplication } from "./mappers";

/**
 * ACCESS-P0-01.1. `applications`/`accounts` have client-facing tenant-scoped
 * RLS (migration 0026) — runs as the calling user via supabaseServer().
 * This is the manual-entry fallback path when Integration Agent's imported
 * data isn't available yet, per the backlog's explicit allowance.
 */
export async function createApplication(
  tenantId: string,
  name: string,
  category?: string,
  sourceIntegrationId?: string,
  isExternal = false,
): Promise<Application> {
  if (!name.trim()) throw new ApiError(400, "INVALID_INPUT", "name is required");
  const supabase = await supabaseServer();
  // QA-P0-17: source_integration_id has no foreign key, so check it here.
  if (sourceIntegrationId) {
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("id")
      .eq("id", sourceIntegrationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (integrationError) throw new ApiError(500, "QUERY_FAILED", integrationError.message);
    if (!integration) throw new ApiError(404, "NOT_FOUND", "That integration is not in this organization");
  }
  const { data, error } = await supabase
    .from("applications")
    .insert({ tenant_id: tenantId, name, category: category ?? null, source_integration_id: sourceIntegrationId ?? null, is_external: isExternal })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create application");
  return toApplication(data);
}

export async function listApplications(tenantId: string): Promise<Application[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("applications").select().eq("tenant_id", tenantId).order("name").limit(DEFAULT_LIST_LIMIT);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toApplication);
}

export async function getApplication(tenantId: string, applicationId: string): Promise<Application | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("applications").select().eq("id", applicationId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toApplication(data) : null;
}

export async function createAccount(
  tenantId: string,
  agentId: string,
  applicationId: string,
  externalAccountRef: string,
  status: AccountStatus = "active",
): Promise<Account> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("accounts")
    .insert({ tenant_id: tenantId, agent_id: agentId, application_id: applicationId, external_account_ref: externalAccountRef, status })
    .select()
    .single();
  // QA-P0-17: 0076's same-tenant foreign keys refuse a reference to another
  // organization's row (23503). Say so, rather than a generic 500.
  if (error?.code === "23503") throw new ApiError(404, "NOT_FOUND", "That agent or application is not in this organization");
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create account");
  return toAccount(data);
}

export async function listAccountsForAgent(tenantId: string, agentId: string): Promise<Account[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("accounts").select().eq("tenant_id", tenantId).eq("agent_id", agentId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAccount);
}
