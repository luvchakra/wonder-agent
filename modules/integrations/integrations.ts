import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ConnectorCapabilities, Integration, IntegrationType } from "@/lib/shared/types/integrations";
import { toIntegration, toIntegrationType } from "./mappers";
import { createConnector } from "./registry";
import { getDecryptedCredential } from "./credentials";

export type CreateIntegrationInput = {
  integrationTypeId: string;
  name: string;
  config?: Record<string, unknown>;
  capabilities?: ConnectorCapabilities;
};

async function hasCredentialsFor(integrationIds: string[]): Promise<Set<string>> {
  if (integrationIds.length === 0) return new Set();
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("integration_id")
    .in("integration_id", integrationIds);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return new Set((data ?? []).map((r: { integration_id: string }) => r.integration_id));
}

/** Catalog data — readable by any authenticated user, no tenant scoping. */
export async function listIntegrationTypes(): Promise<IntegrationType[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("integration_types").select();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toIntegrationType);
}

/**
 * INTEGRATION-P0-01.2. Runs as the calling user via supabaseServer() — RLS's
 * tenant check on `integrations` is the isolation backstop; integration.create
 * permission is enforced by the caller via requirePermission().
 */
export async function createIntegration(
  tenantId: string,
  actorId: string,
  input: CreateIntegrationInput,
): Promise<Integration> {
  if (!input.name.trim()) throw new ApiError(400, "INVALID_INPUT", "name is required");

  const supabase = await supabaseServer();
  const { data: typeRow, error: typeError } = await supabase
    .from("integration_types")
    .select("default_capabilities")
    .eq("id", input.integrationTypeId)
    .maybeSingle();
  if (typeError) throw new ApiError(500, "QUERY_FAILED", typeError.message);
  if (!typeRow) throw new ApiError(400, "INVALID_INPUT", "Unknown integration type");

  const { data, error } = await supabase
    .from("integrations")
    .insert({
      tenant_id: tenantId,
      integration_type_id: input.integrationTypeId,
      name: input.name,
      config: input.config ?? {},
      capabilities: input.capabilities ?? typeRow.default_capabilities ?? {},
    })
    .select()
    .single();
  if (error || !data) {
    throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create integration");
  }

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "integration.created",
    objectType: "integration",
    objectId: data.id,
    outcome: "success",
    metadata: { integrationTypeId: input.integrationTypeId, name: input.name },
  });

  return toIntegration(data, false);
}

export async function getIntegration(tenantId: string, integrationId: string): Promise<Integration | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integrations")
    .select()
    .eq("id", integrationId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;

  const withCreds = await hasCredentialsFor([data.id]);
  return toIntegration(data, withCreds.has(data.id));
}

export async function listIntegrations(tenantId: string): Promise<Integration[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integrations")
    .select()
    // Belt-and-suspenders: RLS already scopes this to the caller's tenant;
    // this explicit filter costs nothing and documents intent.
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  const rows = data ?? [];
  const withCreds = await hasCredentialsFor(rows.map((r) => r.id));
  return rows.map((r) => toIntegration(r, withCreds.has(r.id)));
}

/**
 * INTEGRATION-P0-03.1's "must actually attempt a lightweight authenticated
 * call and report a real pass/fail" requirement — never a hardcoded success.
 * Verifies the caller's tenant owns this integration before touching its
 * (decrypted, service-role-only) credential.
 */
export async function testIntegrationConnection(
  tenantId: string,
  integrationId: string,
): Promise<{ ok: boolean; message?: string }> {
  const integration = await getIntegration(tenantId, integrationId);
  if (!integration) throw new ApiError(404, "INTEGRATION_NOT_FOUND");

  const secret = await getDecryptedCredential(tenantId, integrationId);
  const connector = createConnector(integration.integrationTypeId);
  await connector.authenticate(integration.config, secret);
  const result = await connector.testConnection();

  const supabase = await supabaseServer();
  await supabase
    .from("integrations")
    .update({ status: result.ok ? "connected" : "error" })
    .eq("id", integrationId);

  return result;
}
