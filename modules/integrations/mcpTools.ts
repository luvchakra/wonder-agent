import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { createConnector } from "./registry";
import { getDecryptedCredential } from "./credentials";
import { toIntegrationObject } from "./mappers";
import type { IntegrationObject } from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-04.1. Discovers an MCP server's declared tools and
 * persists them as integration_objects (object_type 'entitlement' — closest
 * fit among the existing enum values for "a capability the agent may be
 * granted"). This question was originally left flagged pending Runtime
 * Agent's own runtime_tools model; now that it exists
 * (modules/runtime-assurance/events.ts), it's confirmed to be a different
 * concept entirely — runtime_tools is populated only from observed runtime
 * events (DID: a tool the agent actually invoked), never from a
 * capability-discovery step, so it was never the right destination for
 * pre-usage MCP discovery data. 'entitlement' remains the correct
 * classification; see the Integration Agent audit log for the resolution.
 *
 * Tool -> agent association is deliberately NOT implemented here: per this
 * module's "consumes Identity Agent's agents list read-only; does not
 * create/modify agents rows itself," the actual link is created via
 * Identity's own linkAgentIdentity()
 * (POST /api/v1/agents/:id/identities, identityType: 'mcp_server') — a human
 * (or, later, Experience Agent's UI) reads the discovered tools from here
 * and pastes the chosen tool's externalId into Identity's existing
 * endpoint. Building a second "link" mutation here would duplicate a write
 * path Identity already owns.
 */
export async function discoverMcpTools(
  tenantId: string,
  integrationId: string,
): Promise<IntegrationObject[]> {
  const supabase = await supabaseServer();
  const { data: integration, error } = await supabase
    .from("integrations")
    .select()
    .eq("id", integrationId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!integration) throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  if (integration.integration_type_id !== "mcp") {
    throw new ApiError(400, "INVALID_INPUT", "Not an MCP integration");
  }

  const secret = await getDecryptedCredential(tenantId, integrationId);
  const connector = createConnector("mcp");
  await connector.authenticate(integration.config ?? {}, secret);
  const tools = (await connector.discover?.()) ?? [];

  const admin = supabaseServiceRole();
  const rows = [];
  for (const tool of tools) {
    const { data, error: upsertError } = await admin
      .from("integration_objects")
      .upsert(
        {
          tenant_id: tenantId,
          integration_id: integrationId,
          object_type: tool.objectType,
          external_id: tool.externalRef,
          raw: tool.summary,
          normalized: tool.summary,
        },
        { onConflict: "integration_id,object_type,external_id" },
      )
      .select()
      .single();
    if (upsertError) throw new ApiError(500, "CREATE_FAILED", upsertError.message);
    rows.push(data);
  }

  return rows.map(toIntegrationObject);
}
